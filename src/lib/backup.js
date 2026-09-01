import {
  PROFILE_VERSION,
  normalizeBoardDocument,
  normalizeProfile,
} from "./db.js";

export const BACKUP_FORMAT = "lumen-ai-notes-backup";
export const BACKUP_VERSION = 4;
export const MIN_SUPPORTED_BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_BOARD_RECORDS = 250;
export const SECURE_CHECKSUM_ALGORITHM = "SHA-256";
export const FALLBACK_CHECKSUM_ALGORITHM = "FNV-1A-64-INSECURE-FALLBACK";
export const CANONICALIZATION = "LUMEN-CANONICAL-JSON-V1";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_ENVELOPE_KEYS = new Set([
  "format",
  "version",
  "profileVersion",
  "exportedAt",
  "kind",
  "recovery",
  "summary",
  "integrity",
  "data",
  // Accepted only while migrating old backup layouts.
  "records",
  "profile",
  "boards",
]);
const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 500_000;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isPlainRecord = (value) => {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export class BackupValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BackupValidationError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new BackupValidationError(code, message, details);
};

const encodeUtf8 = (value) => {
  const text = String(value);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);

  // Compatibility path for runtimes without TextEncoder. Canonical JSON
  // escapes lone surrogates, so iterating code points is unambiguous here.
  const bytes = [];
  for (const symbol of text) {
    const point = symbol.codePointAt(0);
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
  }
  return Uint8Array.from(bytes);
};

// Count UTF-8 bytes without allocating a second full-size Uint8Array. Large
// notebooks can be tens of megabytes, and Safari is particularly sensitive to
// the temporary memory amplification caused by TextEncoder.encode().
const utf8ByteLength = (value) => {
  const text = String(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
};

const inspectJsonTree = (root) => {
  const stack = [{ value: root, path: "$", depth: 0 }];
  const seen = new Set();
  let nodes = 0;

  while (stack.length) {
    const { value, path, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("TOO_COMPLEX", "Backup contains too many values to inspect safely");
    if (depth > MAX_JSON_DEPTH) fail("TOO_DEEP", `Backup nesting exceeds ${MAX_JSON_DEPTH} levels`, { path });

    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("MALFORMED_VALUE", "Backup contains a non-finite number", { path });
      continue;
    }
    if (typeof value !== "object") fail("MALFORMED_VALUE", "Backup contains a value JSON cannot represent", { path });
    if (seen.has(value)) fail("CYCLIC_VALUE", "Backup data must not contain circular references", { path });
    seen.add(value);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        if (!hasOwn(value, index)) fail("MALFORMED_VALUE", "Backup arrays must not contain empty slots", { path: `${path}[${index}]` });
        stack.push({ value: value[index], path: `${path}[${index}]`, depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainRecord(value)) fail("MALFORMED_VALUE", "Backup may contain only plain JSON objects", { path });
    const keys = Object.keys(value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (FORBIDDEN_KEYS.has(key)) fail("UNSAFE_KEY", `Unsafe object key \"${key}\" is not allowed`, { path: `${path}.${key}` });
      stack.push({ value: value[key], path: `${path}.${key}`, depth: depth + 1 });
    }
  }
};

/**
 * Deterministic JSON encoding used for checksums and downloaded backup files.
 * Object keys are sorted recursively; array order is preserved.
 */
export const canonicalStringify = (value) => {
  inspectJsonTree(value);
  // Native JSON serialization builds large strings far more economically than
  // recursive JS concatenation. The replacer returns keys in canonical order;
  // arrays keep their original order. Validation above preserves the stricter
  // safety/error contract (cycles, sparse arrays, unsafe keys, non-finite data).
  return JSON.stringify(value, (_key, item) => {
    if (!isPlainRecord(item)) return item;
    const ordered = Object.create(null);
    Object.keys(item).sort().forEach((key) => { ordered[key] = item[key]; });
    return ordered;
  });
};

// Visit canonical JSON in small lexical chunks. This is used for byte counts
// and the LAN fallback checksum so those operations never require another
// notebook-sized string.
const visitCanonical = (value, visit) => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    visit(JSON.stringify(Object.is(value, -0) ? 0 : value));
    return;
  }
  if (Array.isArray(value)) {
    visit("[");
    value.forEach((item, index) => {
      if (index) visit(",");
      visitCanonical(item, visit);
    });
    visit("]");
    return;
  }
  visit("{");
  Object.keys(value).sort().forEach((key, index) => {
    if (index) visit(",");
    visit(JSON.stringify(key));
    visit(":");
    visitCanonical(value[key], visit);
  });
  visit("}");
};

const canonicalByteLength = (value) => {
  inspectJsonTree(value);
  let bytes = 0;
  visitCanonical(value, (chunk) => { bytes += utf8ByteLength(chunk); });
  return bytes;
};

const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const createFnv1a64 = () => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const update = (byte) => {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  };
  const write = (value) => {
    for (const symbol of String(value)) {
      const point = symbol.codePointAt(0);
      if (point <= 0x7f) update(point);
      else if (point <= 0x7ff) {
        update(0xc0 | (point >> 6));
        update(0x80 | (point & 0x3f));
      } else if (point <= 0xffff) {
        update(0xe0 | (point >> 12));
        update(0x80 | ((point >> 6) & 0x3f));
        update(0x80 | (point & 0x3f));
      } else {
        update(0xf0 | (point >> 18));
        update(0x80 | ((point >> 12) & 0x3f));
        update(0x80 | ((point >> 6) & 0x3f));
        update(0x80 | (point & 0x3f));
      }
    }
  };
  return { write, digest: () => hash.toString(16).padStart(16, "0") };
};

const canUseSecureDigest = (cryptoApi, secureContext) => (
  secureContext !== false
  && Boolean(cryptoApi?.subtle?.digest)
  && typeof TextEncoder !== "undefined"
);

const computeDigest = async (canonical, algorithm, cryptoApi) => {
  if (algorithm === SECURE_CHECKSUM_ALGORITHM) {
    if (!canUseSecureDigest(cryptoApi, true)) {
      fail("INTEGRITY_UNAVAILABLE", "This browser cannot verify the backup's SHA-256 checksum in the current context");
    }
    const digest = await cryptoApi.subtle.digest("SHA-256", encodeUtf8(canonical));
    return bytesToHex(new Uint8Array(digest));
  }
  if (algorithm === FALLBACK_CHECKSUM_ALGORITHM) {
    const state = createFnv1a64();
    state.write(canonical);
    return state.digest();
  }
  fail("UNSUPPORTED_CHECKSUM", `Unsupported backup checksum algorithm: ${String(algorithm || "missing")}`);
};

const computeCanonicalDigest = async (value, algorithm, cryptoApi) => {
  if (algorithm === FALLBACK_CHECKSUM_ALGORITHM) {
    inspectJsonTree(value);
    const state = createFnv1a64();
    visitCanonical(value, state.write);
    return state.digest();
  }
  return computeDigest(canonicalStringify(value), algorithm, cryptoApi);
};

const constantTimeEqual = (left, right) => {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const safeBoardKey = (key) => {
  if (typeof key !== "string" || !key.startsWith("board:") || key.length > 600 || key.length <= 6) return false;
  if (/[^\x20-\x7e]/.test(key)) return false;
  const segments = key.slice(6).split(/[./:\\-]+/u);
  return !segments.some((segment) => FORBIDDEN_KEYS.has(segment.toLowerCase()));
};

const countRecord = (value) => (isRecord(value) ? Object.keys(value).length : 0);
const countArray = (value) => (Array.isArray(value) ? value.length : 0);

/** Derive a human-readable inventory from already-sanitized backup records. */
export const summarizeBackupData = (records, options = {}) => {
  const profile = isRecord(records?.profile) ? records.profile : {};
  const boards = Object.entries(isRecord(records) ? records : {}).filter(([key]) => safeBoardKey(key));
  const boardPages = boards.reduce((total, [, board]) => total + countArray(board?.pages), 0);
  const boardObjects = boards.reduce((total, [, board]) => total + (
    Array.isArray(board?.pages)
      ? board.pages.reduce((pageTotal, page) => pageTotal + countArray(page?.objects), 0)
      : countArray(board)
  ), 0);
  const payloadBytes = Number.isFinite(options.payloadBytes)
    ? options.payloadBytes
    : utf8ByteLength(canonicalStringify(records));

  return {
    payloadBytes,
    fileBytes: 0,
    counts: {
      records: Object.keys(isRecord(records) ? records : {}).length,
      boards: boards.length,
      boardPages,
      boardObjects,
      customDocuments: countArray(profile.customDocuments),
      bookmarks: countArray(profile.bookmarks),
      personalNotes: countRecord(profile.personalNotes),
      edits: countRecord(profile.edits),
      clippings: countArray(profile.clippings),
      annotations: countArray(profile.annotations),
      reviewItems: countArray(profile.reviewItems),
      reviewAttempts: countArray(profile.reviewAttempts),
      aiTutorMessages: countArray(profile.aiTutorHistory),
    },
  };
};

const normalizationDeltaWarnings = (raw, normalized, label) => {
  const warnings = [];
  const rawCanonical = canonicalStringify(raw);
  const normalizedCanonical = canonicalStringify(normalized);
  if (rawCanonical !== normalizedCanonical) warnings.push(`${label} was normalized to the current safe schema.`);
  return warnings;
};

/**
 * Keep only storage records the app owns, reject unsafe/unknown keys, and run
 * every value through the same bounded normalizers used by runtime storage.
 */
export const sanitizeBackupData = (records, { allowUnknownLegacyKeys = false, reportNormalization = true } = {}) => {
  if (!isPlainRecord(records)) fail("MALFORMED_DATA", "Backup data must be a JSON object");
  inspectJsonTree(records);
  if (!hasOwn(records, "profile") || !isPlainRecord(records.profile)) {
    fail("MISSING_PROFILE", "Backup does not contain a valid profile record");
  }

  const output = Object.create(null);
  const warnings = [];
  let boardCount = 0;

  for (const key of Object.keys(records)) {
    if (key === "profile") {
      output.profile = normalizeProfile(records.profile);
      if (reportNormalization) warnings.push(...normalizationDeltaWarnings(records.profile, output.profile, "Profile"));
      continue;
    }
    if (safeBoardKey(key)) {
      boardCount += 1;
      if (boardCount > MAX_BOARD_RECORDS) fail("TOO_MANY_BOARDS", `Backup exceeds the ${MAX_BOARD_RECORDS}-whiteboard safety limit`);
      if (!Array.isArray(records[key]) && !isPlainRecord(records[key])) {
        fail("MALFORMED_BOARD", `Whiteboard record \"${key}\" is malformed`);
      }
      output[key] = normalizeBoardDocument(records[key]);
      if (reportNormalization) warnings.push(...normalizationDeltaWarnings(records[key], output[key], `Whiteboard ${key.slice(6)}`));
      continue;
    }
    if (FORBIDDEN_KEYS.has(key) || key.startsWith("board:")) {
      fail("UNSAFE_KEY", `Unsafe storage record key \"${key}\" is not allowed`);
    }
    if (!allowUnknownLegacyKeys) fail("UNKNOWN_RECORD", `Unknown storage record \"${key}\" is not allowed`);
    warnings.push(`Legacy storage record \"${key}\" was not imported.`);
  }

  return { data: output, warnings };
};

const normalizeExportedAt = (value) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) fail("INVALID_DATE", "Backup export time is invalid");
  return date.toISOString();
};

const normalizeRecoveryMetadata = (value) => {
  if (!isRecord(value)) return undefined;
  const result = {};
  if (typeof value.reason === "string" && value.reason.trim()) result.reason = value.reason.trim().slice(0, 300);
  if (typeof value.incomingChecksum === "string" && value.incomingChecksum) result.incomingChecksum = value.incomingChecksum.slice(0, 128);
  if (typeof value.incomingExportedAt === "string" && Number.isFinite(Date.parse(value.incomingExportedAt))) {
    result.incomingExportedAt = new Date(value.incomingExportedAt).toISOString();
  }
  if (Number.isInteger(value.incomingVersion)) result.incomingVersion = value.incomingVersion;
  return Object.keys(result).length ? result : undefined;
};

const integrityCore = (envelope) => {
  const core = {
    format: envelope.format,
    version: envelope.version,
    profileVersion: envelope.profileVersion,
    exportedAt: envelope.exportedAt,
    kind: envelope.kind,
    data: envelope.data,
  };
  if (envelope.recovery) core.recovery = envelope.recovery;
  return core;
};

const finalizeFileSize = (envelope) => {
  // fileBytes is the only self-referential field. Measure the canonical tree
  // with the numeric placeholder `0`, then solve for the extra decimal digits.
  // This lets us create the notebook-sized download string exactly once.
  envelope.summary.fileBytes = 0;
  const placeholderBytes = canonicalByteLength(envelope);
  let bytes = placeholderBytes;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const candidate = placeholderBytes + String(bytes).length - 1;
    if (candidate === bytes) break;
    bytes = candidate;
  }
  envelope.summary.fileBytes = bytes;
  let json = canonicalStringify(envelope);
  const measured = utf8ByteLength(json);
  if (measured !== bytes) {
    // Defensive compatibility fallback if the envelope schema ever changes.
    envelope.summary.fileBytes = measured;
    json = canonicalStringify(envelope);
    bytes = utf8ByteLength(json);
  }
  return { json, bytes };
};

/**
 * Build a schema-v4 backup and its download-ready canonical JSON.
 */
export const createBackup = async (records, options = {}) => {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_BACKUP_BYTES;
  // Runtime records have already passed the same normalizers. Re-normalize for
  // safety, but skip the expensive whole-tree before/after warning comparison
  // on export; import preflight still reports every migration/normalization.
  const { data, warnings } = sanitizeBackupData(records, { reportNormalization: false });
  const exportedAt = normalizeExportedAt(options.exportedAt ?? options.now);
  const secureContext = options.secureContext ?? globalThis.isSecureContext;
  const cryptoApi = options.cryptoApi ?? globalThis.crypto;
  const algorithm = canUseSecureDigest(cryptoApi, secureContext)
    ? SECURE_CHECKSUM_ALGORITHM
    : FALLBACK_CHECKSUM_ALGORITHM;
  const kind = options.kind === "recovery" ? "recovery" : "manual";
  const recovery = kind === "recovery" ? normalizeRecoveryMetadata(options.recovery) : undefined;
  const summary = summarizeBackupData(data, { payloadBytes: canonicalByteLength(data) });
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    profileVersion: PROFILE_VERSION,
    exportedAt,
    kind,
    ...(recovery ? { recovery } : {}),
    summary,
    integrity: {
      algorithm,
      digest: "",
      canonicalization: CANONICALIZATION,
      scope: "envelope-core",
      cryptographic: algorithm === SECURE_CHECKSUM_ALGORITHM,
    },
    data,
  };

  envelope.integrity.digest = await computeCanonicalDigest(integrityCore(envelope), algorithm, cryptoApi);
  const finalized = finalizeFileSize(envelope);
  const json = finalized.json;
  const fileBytes = finalized.bytes;
  if (fileBytes > maxBytes) {
    fail("TOO_LARGE", `Backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB safety limit`, { bytes: fileBytes, maxBytes });
  }

  if (algorithm === FALLBACK_CHECKSUM_ALGORITHM) {
    warnings.push("This backup uses a deterministic non-cryptographic integrity checksum because secure SHA-256 is unavailable in the current browser context.");
  }
  return { envelope, json, summary: envelope.summary, warnings };
};

const parseInput = async (input, maxBytes) => {
  if (typeof input === "string") {
    const bytes = utf8ByteLength(input);
    if (bytes > maxBytes) fail("TOO_LARGE", `Backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB safety limit`, { bytes, maxBytes });
    try {
      return { parsed: JSON.parse(input), inputBytes: bytes };
    } catch (error) {
      fail("MALFORMED_JSON", "Backup is not valid JSON", { cause: error.message });
    }
  }
  if (input && typeof input.text === "function") {
    if (Number.isFinite(input.size) && input.size > maxBytes) {
      fail("TOO_LARGE", `Backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB safety limit`, { bytes: input.size, maxBytes });
    }
    return parseInput(await input.text(), maxBytes);
  }
  inspectJsonTree(input);
  const canonical = canonicalStringify(input);
  const bytes = utf8ByteLength(canonical);
  if (bytes > maxBytes) fail("TOO_LARGE", `Backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB safety limit`, { bytes, maxBytes });
  return { parsed: input, inputBytes: bytes };
};

const extractLegacyData = (parsed, version, warnings) => {
  if (isPlainRecord(parsed.data)) return parsed.data;
  if (version > 1) fail("MALFORMED_DATA", "Backup data record is missing or malformed");

  const legacy = Object.create(null);
  if (isPlainRecord(parsed.records)) return parsed.records;
  if (isPlainRecord(parsed.profile)) legacy.profile = parsed.profile;
  if (isPlainRecord(parsed.boards)) {
    for (const [key, board] of Object.entries(parsed.boards)) {
      const storageKey = key.startsWith("board:") ? key : `board:${key}`;
      legacy[storageKey] = board;
    }
  }
  if (!legacy.profile) fail("MALFORMED_DATA", "Legacy backup does not contain a profile record");
  warnings.push("Version 1 backup layout was migrated to the current record layout.");
  return legacy;
};

const checkEnvelopeKeys = (parsed, version, warnings) => {
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(key)) {
      if (version === BACKUP_VERSION) fail("UNKNOWN_ENVELOPE_FIELD", `Unknown backup envelope field \"${key}\" is not allowed`);
      warnings.push(`Unknown legacy envelope field \"${key}\" was ignored.`);
    }
  }
};

const validateVersion = (value) => {
  if (!Number.isInteger(value)) fail("UNSUPPORTED_VERSION", "Backup version must be an integer");
  if (value > BACKUP_VERSION) fail("FUTURE_VERSION", `Backup version ${value} is newer than this app supports`, { supported: BACKUP_VERSION });
  if (value < MIN_SUPPORTED_BACKUP_VERSION) fail("UNSUPPORTED_VERSION", `Backup version ${value} is no longer supported`, { minimum: MIN_SUPPORTED_BACKUP_VERSION });
  return value;
};

const validateIntegrity = async (parsed, data, version, cryptoApi, warnings) => {
  if (!isPlainRecord(parsed.integrity)) {
    if (version === BACKUP_VERSION) fail("MISSING_CHECKSUM", "Current backups must include an integrity checksum");
    warnings.push("Legacy backup has no checksum, so its original integrity cannot be verified.");
    return { verified: false, algorithm: "none", digest: "" };
  }
  const { algorithm, digest, canonicalization, scope } = parsed.integrity;
  if (canonicalization !== CANONICALIZATION || scope !== "envelope-core") {
    fail("UNSUPPORTED_CHECKSUM", "Backup uses an unsupported integrity format");
  }
  if (typeof digest !== "string" || !digest) fail("MISSING_CHECKSUM", "Backup checksum is missing");
  const core = integrityCore({
    format: parsed.format,
    version,
    profileVersion: parsed.profileVersion,
    exportedAt: parsed.exportedAt,
    kind: parsed.kind,
    recovery: parsed.recovery,
    data,
  });
  const expected = await computeCanonicalDigest(core, algorithm, cryptoApi);
  if (!constantTimeEqual(expected, digest)) fail("CHECKSUM_MISMATCH", "Backup integrity check failed; the file may be corrupted or incomplete");
  if (algorithm === FALLBACK_CHECKSUM_ALGORITHM) {
    warnings.push("Backup integrity was checked with its non-cryptographic fallback checksum; this detects accidental corruption but is not tamper-resistant.");
  }
  return { verified: true, algorithm, digest: digest.toLowerCase() };
};

/**
 * Parse, authenticate, migrate, normalize, and inventory a backup without
 * changing IndexedDB. Callers should display this result before confirmation.
 */
export const preflightBackup = async (input, options = {}) => {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_BACKUP_BYTES;
  const cryptoApi = options.cryptoApi ?? globalThis.crypto;
  const { parsed, inputBytes } = await parseInput(input, maxBytes);
  inspectJsonTree(parsed);
  if (!isPlainRecord(parsed)) fail("MALFORMED_ENVELOPE", "Backup must contain a JSON object");
  if (parsed.format !== BACKUP_FORMAT) fail("WRONG_FORMAT", "This file is not a Lumen backup");
  const sourceVersion = validateVersion(parsed.version);
  const warnings = [];
  checkEnvelopeKeys(parsed, sourceVersion, warnings);
  const rawData = extractLegacyData(parsed, sourceVersion, warnings);

  const exportedAt = typeof parsed.exportedAt === "string" && Number.isFinite(Date.parse(parsed.exportedAt))
    ? new Date(parsed.exportedAt).toISOString()
    : "";
  if (!exportedAt) {
    if (sourceVersion === BACKUP_VERSION) fail("INVALID_DATE", "Backup export time is missing or invalid");
    warnings.push("Legacy backup has no reliable export timestamp.");
  }
  if (sourceVersion === BACKUP_VERSION && parsed.profileVersion !== PROFILE_VERSION) {
    if (Number(parsed.profileVersion) > PROFILE_VERSION) fail("FUTURE_PROFILE", `Profile schema ${parsed.profileVersion} is newer than this app supports`);
    fail("INVALID_PROFILE_VERSION", `Version ${BACKUP_VERSION} backups must use profile schema ${PROFILE_VERSION}`);
  }
  if (Number(rawData.profile?.version) > PROFILE_VERSION) {
    fail("FUTURE_PROFILE", `Profile schema ${rawData.profile.version} is newer than this app supports`);
  }

  // Integrity covers the exact stored data and runs before any lossy migration.
  const integrity = await validateIntegrity(parsed, rawData, sourceVersion, cryptoApi, warnings);
  const { data, warnings: normalizationWarnings } = sanitizeBackupData(rawData, {
    allowUnknownLegacyKeys: sourceVersion < BACKUP_VERSION,
  });
  warnings.push(...normalizationWarnings);
  if (sourceVersion < BACKUP_VERSION) warnings.unshift(`Backup version ${sourceVersion} will be migrated to version ${BACKUP_VERSION}.`);
  if (Number(rawData.profile?.version || sourceVersion) < PROFILE_VERSION) {
    warnings.push(`Profile schema was upgraded to version ${PROFILE_VERSION}.`);
  }

  const summary = summarizeBackupData(data);
  summary.inputBytes = inputBytes;
  const canonicalImportBytes = summary.payloadBytes;
  if (canonicalImportBytes > maxBytes) fail("TOO_LARGE", "Normalized backup data exceeds the restore safety limit", { bytes: canonicalImportBytes, maxBytes });

  return {
    ok: true,
    sourceVersion,
    targetVersion: BACKUP_VERSION,
    migrationRequired: sourceVersion !== BACKUP_VERSION || Number(rawData.profile?.version) !== PROFILE_VERSION,
    exportedAt,
    kind: parsed.kind === "recovery" ? "recovery" : "manual",
    data,
    summary,
    integrity,
    warnings: [...new Set(warnings)],
  };
};

export const validateBackup = preflightBackup;

/**
 * Snapshot the current app-owned records immediately before a restore. Only
 * profile/board records are copied, and incoming metadata stores identifiers,
 * never the incoming backup itself, so recovery snapshots cannot nest.
 */
export const createRecoverySnapshot = async (currentRecords, options = {}) => {
  const incoming = options.incomingPreflight || options.incoming || {};
  return createBackup(currentRecords, {
    ...options,
    kind: "recovery",
    recovery: {
      reason: options.reason || "Created automatically before restoring another backup",
      incomingChecksum: incoming.integrity?.digest || "",
      incomingExportedAt: incoming.exportedAt || "",
      incomingVersion: incoming.sourceVersion,
    },
  });
};
