import { BackupValidationError, MAX_BACKUP_BYTES, canonicalStringify } from "./backup.js";

/**
 * Password-protected backup container `lumen.backup.enc.v1` (issue #18).
 * See docs/ENCRYPTED_BACKUP_DESIGN.md for the full rationale. This module is
 * a pure transport wrapper: it encrypts the exact canonical JSON string that
 * createBackup produces and hands decrypted text to the unchanged
 * preflightBackup, so the plain v4 format stays byte-identical.
 *
 * Container: "LUMENENC" ‖ uint32-BE header length ‖ canonical header JSON ‖
 * AES-256-GCM ciphertext. The exact prefix bytes as written/read are the GCM
 * AAD — never a re-serialized header — so any header tamper fails
 * authentication.
 */
export const ENCRYPTED_BACKUP_FORMAT = "lumen.backup.enc.v1";
/**
 * v2 (SYNC-001, issue #14): the same container plus two authenticated header
 * fields — `vaultId` (shared by every device in a sync vault) and `deviceId`
 * (the writer). Both ride inside the AAD prefix, so a sync file cannot be
 * silently re-attributed to another vault or device. v1 files stay readable;
 * v1 headers still reject the sync fields as unknown.
 */
export const ENCRYPTED_BACKUP_FORMAT_V2 = "lumen.backup.enc.v2";
export const ENCRYPTED_MAGIC = new Uint8Array([0x4c, 0x55, 0x4d, 0x45, 0x4e, 0x45, 0x4e, 0x43]); // "LUMENENC"
export const PBKDF2_ITERATIONS = 600_000; // OWASP current PBKDF2-HMAC-SHA256 guidance
export const ITERATION_FLOOR = 100_000;
export const ITERATION_CEILING = 10_000_000;
export const MAX_ENCRYPTED_BACKUP_BYTES = MAX_BACKUP_BYTES + 64 * 1024;
const MAX_HEADER_BYTES = 16_384;
const GCM_TAG_BYTES = 16;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const requireCrypto = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== "function") {
    throw new BackupValidationError(
      "CRYPTO_UNAVAILABLE",
      "Encrypted backups need WebCrypto in a secure (HTTPS) context. There is no weak-crypto fallback.",
    );
  }
  return api;
};

const deriveKey = async (cryptoApi, password, salt, iterations, usage) => {
  const material = await cryptoApi.subtle.importKey(
    "raw",
    textEncoder.encode(String(password).normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
};

/**
 * Encrypts a canonical backup JSON string. Returns Blob-ready parts (prefix
 * bytes and ciphertext are kept separate so no concatenated copy is ever
 * materialized) plus the parsed header for display.
 */
export const encryptBackupJson = async (json, password, {
  cryptoApi,
  iterations = PBKDF2_ITERATIONS,
  exportedAt = new Date().toISOString(),
  vaultId,
  deviceId,
  unsafeTestSalt,
  unsafeTestIv,
} = {}) => {
  const api = requireCrypto(cryptoApi);
  if (typeof password !== "string" || password.length < 8) {
    throw new BackupValidationError("MALFORMED_ENC_HEADER", "The backup password must be at least 8 characters.");
  }
  const sync = vaultId !== undefined || deviceId !== undefined;
  if (sync && !(isSyncIdentity(vaultId) && isSyncIdentity(deviceId))) {
    throw new BackupValidationError("MALFORMED_ENC_HEADER", "Sync containers need both a vault id and a device id (1–200 characters).");
  }
  const salt = unsafeTestSalt || api.getRandomValues(new Uint8Array(16));
  const iv = unsafeTestIv || api.getRandomValues(new Uint8Array(12));
  const header = {
    format: sync ? ENCRYPTED_BACKUP_FORMAT_V2 : ENCRYPTED_BACKUP_FORMAT,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv), tagLength: 128 },
    compression: "none",
    exportedAt,
    ...(sync ? { vaultId, deviceId } : {}),
  };
  const headerBytes = textEncoder.encode(canonicalStringify(header));
  const prefix = new Uint8Array(ENCRYPTED_MAGIC.length + 4 + headerBytes.length);
  prefix.set(ENCRYPTED_MAGIC, 0);
  new DataView(prefix.buffer).setUint32(ENCRYPTED_MAGIC.length, headerBytes.length, false);
  prefix.set(headerBytes, ENCRYPTED_MAGIC.length + 4);

  const key = await deriveKey(api, password, salt, iterations, "encrypt");
  const ciphertext = new Uint8Array(await api.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: prefix, tagLength: 128 },
    key,
    textEncoder.encode(json),
  ));
  return { blobParts: [prefix, ciphertext], header };
};

export const sniffEncryptedBackup = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < ENCRYPTED_MAGIC.length) return false;
  return ENCRYPTED_MAGIC.every((byte, index) => view[index] === byte);
};

export const isEncryptedBackupFile = async (file) => {
  if (!file || typeof file.slice !== "function") return false;
  const head = new Uint8Array(await file.slice(0, ENCRYPTED_MAGIC.length).arrayBuffer());
  return sniffEncryptedBackup(head);
};

const malformed = (message, details) => new BackupValidationError("MALFORMED_ENC_HEADER", message, details);

const isSyncIdentity = (value) => typeof value === "string" && value.length >= 1 && value.length <= 200;

/**
 * Reads the header without deriving any key — used both by decryption and by
 * the pre-password dialog (exportedAt display). Every bound is enforced here
 * because the header is attacker-controlled until the GCM tag verifies.
 */
export const readEncryptedHeader = (bytes) => {
  if (!sniffEncryptedBackup(bytes)) throw malformed("This file does not start with the encrypted-backup signature.");
  if (bytes.length < ENCRYPTED_MAGIC.length + 4) throw malformed("The encrypted file is truncated before its header length.");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(ENCRYPTED_MAGIC.length, false);
  if (headerLength < 1 || headerLength > MAX_HEADER_BYTES) {
    throw malformed(`The encrypted header length ${headerLength} is outside 1–${MAX_HEADER_BYTES}.`);
  }
  const prefixLength = ENCRYPTED_MAGIC.length + 4 + headerLength;
  if (prefixLength + GCM_TAG_BYTES > bytes.length) throw malformed("The encrypted file is smaller than its declared header plus an authentication tag.");
  let header;
  try {
    header = JSON.parse(textDecoder.decode(bytes.subarray(ENCRYPTED_MAGIC.length + 4, prefixLength)));
  } catch {
    throw malformed("The encrypted header is not valid JSON.");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw malformed("The encrypted header must be an object.");
  if (header.format !== ENCRYPTED_BACKUP_FORMAT && header.format !== ENCRYPTED_BACKUP_FORMAT_V2) {
    throw new BackupValidationError("UNSUPPORTED_ENC_FORMAT", `Unsupported encrypted-backup format ${JSON.stringify(header.format ?? null)}.`);
  }
  // Each version rejects fields it does not define — a v1 file can never
  // smuggle sync attribution, and future fields force an explicit bump.
  const allowedKeys = new Set(["format", "kdf", "cipher", "compression", "exportedAt"]);
  if (header.format === ENCRYPTED_BACKUP_FORMAT_V2) {
    allowedKeys.add("vaultId");
    allowedKeys.add("deviceId");
    if (!isSyncIdentity(header.vaultId) || !isSyncIdentity(header.deviceId)) {
      throw malformed("A sync container must carry a vault id and a device id (1–200 characters).");
    }
  }
  for (const key of Object.keys(header)) {
    if (!allowedKeys.has(key)) throw new BackupValidationError("UNSUPPORTED_ENC_FORMAT", `Unknown encrypted-header field "${key}".`);
  }
  if (header.compression !== "none") throw new BackupValidationError("UNSUPPORTED_ENC_FORMAT", "Unsupported compression in the encrypted header.");
  const kdf = header.kdf;
  if (!kdf || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || typeof kdf.salt !== "string") throw malformed("The key-derivation parameters are malformed.");
  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations < ITERATION_FLOOR || kdf.iterations > ITERATION_CEILING) {
    throw malformed(`PBKDF2 iterations must be between ${ITERATION_FLOOR.toLocaleString()} and ${ITERATION_CEILING.toLocaleString()}.`);
  }
  const cipher = header.cipher;
  if (!cipher || cipher.name !== "AES-GCM" || cipher.tagLength !== 128 || typeof cipher.iv !== "string") throw malformed("The cipher parameters are malformed.");
  let salt;
  let iv;
  try {
    salt = fromBase64(kdf.salt);
    iv = fromBase64(cipher.iv);
  } catch {
    throw malformed("The salt or IV is not valid base64.");
  }
  if (salt.length < 16 || salt.length > 32) throw malformed("The salt must be 16–32 bytes.");
  if (iv.length !== 12) throw malformed("The AES-GCM IV must be exactly 12 bytes.");
  return { header, salt, iv, prefixLength };
};

/** Decrypts a container to the canonical backup JSON string. */
export const decryptBackupFile = async (fileOrBuffer, password, { cryptoApi, maxBytes = MAX_ENCRYPTED_BACKUP_BYTES } = {}) => {
  const api = requireCrypto(cryptoApi);
  const size = typeof fileOrBuffer?.size === "number" ? fileOrBuffer.size : fileOrBuffer?.byteLength ?? 0;
  if (size > maxBytes) {
    throw new BackupValidationError("TOO_LARGE", `Encrypted backups are limited to ${Math.round(maxBytes / (1024 * 1024))} MB.`, { size });
  }
  const buffer = typeof fileOrBuffer?.arrayBuffer === "function" ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  const bytes = new Uint8Array(buffer);
  const { header, salt, iv, prefixLength } = readEncryptedHeader(bytes);
  // The AAD is the exact prefix as read from the file — never re-serialized.
  const prefix = bytes.subarray(0, prefixLength);
  const ciphertext = bytes.subarray(prefixLength);
  const key = await deriveKey(api, password, salt, header.kdf.iterations, "decrypt");
  let plaintext;
  try {
    plaintext = await api.subtle.decrypt({ name: "AES-GCM", iv, additionalData: prefix, tagLength: 128 }, key, ciphertext);
  } catch {
    throw new BackupValidationError(
      "WRONG_PASSWORD",
      "The password is wrong, or the file was modified — under authenticated encryption the two are indistinguishable.",
      { reason: "gcm-auth-failure" },
    );
  }
  return textDecoder.decode(plaintext);
};
