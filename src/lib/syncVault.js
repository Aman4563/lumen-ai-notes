import { mergeBoardVersions } from "./boardSync.js";
import { mergeProfileVersions } from "./profileSync.js";
import { normalizeBoardDocument } from "./db.js";
import { createId } from "./id.js";

/**
 * SYNC-001 v1 (issue #14): encrypted, account-free, file-based cross-device
 * sync per docs/SYNC_DESIGN.md. This module owns everything except the UI:
 * durable device identity, vault membership, the vault baseline (the last
 * successful merge result, kept in its OWN IndexedDB database so backups and
 * `getAllData` never see sync state), and the deterministic peer fold that
 * reuses the cross-tab merge machinery — no second merge algorithm.
 *
 * Transport is the `lumen.backup.enc.v2` container (vaultId + deviceId in
 * the authenticated header). Each device writes only its own file,
 * `<deviceId>.lumenc`; peers' files are always the `remote` merge argument.
 */
export const DEVICE_ID_STORAGE_KEY = "lumen-device-id-v1";
export const VAULT_CONFIG_STORAGE_KEY = "lumen-sync-vault-v1";
const BASELINE_DATABASE = "lumen-sync-baseline-v1";
const BASELINE_STORE = "baseline";
const BASELINE_KEY = "current";

/** Durable per-device identity — distinct from the per-tab writerId. */
export const getDeviceId = (storage = globalThis.localStorage) => {
  try {
    const stored = String(storage.getItem(DEVICE_ID_STORAGE_KEY) || "");
    if (/^[a-z0-9-]{8,80}$/i.test(stored)) return stored;
    const fresh = createId();
    storage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private-mode storage failures degrade to a session-scoped identity.
    return createId();
  }
};

export const syncFileNameFor = (deviceId) => `${deviceId}.lumenc`;

export const readVaultConfig = (storage = globalThis.localStorage) => {
  try {
    const parsed = JSON.parse(storage.getItem(VAULT_CONFIG_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed.vaultId !== "string" || parsed.vaultId.length < 8 || parsed.vaultId.length > 200) return null;
    return {
      vaultId: parsed.vaultId,
      createdAt: String(parsed.createdAt || "").slice(0, 40),
      lastSyncAt: String(parsed.lastSyncAt || "").slice(0, 40),
    };
  } catch {
    return null;
  }
};

const writeVaultConfig = (storage, config) => {
  try {
    storage.setItem(VAULT_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch { /* storage failure surfaces on the next read as "no vault" */ }
  return config;
};

export const createVaultConfig = (storage = globalThis.localStorage, now = new Date()) =>
  writeVaultConfig(storage, { vaultId: createId(), createdAt: now.toISOString(), lastSyncAt: "" });

/** Joining via a peer's sync file adopts that file's vault id. */
export const adoptVaultConfig = (vaultId, storage = globalThis.localStorage, now = new Date()) =>
  writeVaultConfig(storage, { vaultId: String(vaultId).slice(0, 200), createdAt: now.toISOString(), lastSyncAt: "" });

export const recordVaultSync = (storage = globalThis.localStorage, now = new Date()) => {
  const config = readVaultConfig(storage);
  return config ? writeVaultConfig(storage, { ...config, lastSyncAt: now.toISOString() }) : null;
};

export const clearVaultConfig = (storage = globalThis.localStorage) => {
  try {
    storage.removeItem(VAULT_CONFIG_STORAGE_KEY);
  } catch { /* nothing to clear */ }
};

/**
 * Pre-decrypt admission check on a container header. Returns a typed refusal
 * rather than throwing so the import loop can report per-file outcomes.
 */
export const checkSyncHeader = (header, { vaultId, deviceId }) => {
  if (!header || typeof header.vaultId !== "string" || !header.vaultId) {
    return { ok: false, code: "NOT_SYNC_FILE", message: "This is an encrypted backup, not a sync file — restore it from the backup importer instead." };
  }
  if (header.vaultId !== vaultId) {
    return { ok: false, code: "VAULT_MISMATCH", message: "This sync file belongs to a different vault." };
  }
  if (header.deviceId === deviceId) {
    return { ok: false, code: "OWN_FILE", message: "This is this device's own sync file — only peer files fold in." };
  }
  return { ok: true, deviceId: header.deviceId };
};

const boardKeysOf = (records) => Object.keys(records || {}).filter((key) => key.startsWith("board:"));

/**
 * Folds peer snapshots into the local state in deviceId-sorted order (fold
 * order is therefore independent of file-selection order). The peer is
 * always the `remote` argument. A generation replacement (reset/restore on a
 * peer) resets the fold baseline to the replacement result, per design §6 —
 * folding later peers against the stale baseline would resurrect
 * pre-replacement records.
 */
export const foldPeerSnapshots = ({ baselineRecords = null, localRecords, peers, writerId = "", now = new Date().toISOString() }) => {
  const sorted = [...peers].sort((left, right) => (left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0));
  let baseProfile = baselineRecords?.profile ?? null;
  let baseBoards = Object.fromEntries(boardKeysOf(baselineRecords).map((key) => [key, baselineRecords[key]]));
  let profile = localRecords.profile;
  const boards = Object.fromEntries(boardKeysOf(localRecords).map((key) => [key, localRecords[key]]));
  const conflicts = [];
  let replacementApplied = false;

  for (const peer of sorted) {
    const merged = mergeProfileVersions(baseProfile, profile, peer.records.profile, { advanceRevision: false, writerId, now });
    profile = merged.profile;
    conflicts.push(...merged.conflicts);
    if (merged.replacementApplied) {
      replacementApplied = true;
      baseProfile = profile;
      baseBoards = {};
    }
    for (const key of boardKeysOf(peer.records)) {
      if (!(key in boards) && !(key in baseBoards)) {
        // A board this device never had adopts whole — merging against a
        // fabricated empty board would graft a spurious blank page onto it.
        boards[key] = normalizeBoardDocument(peer.records[key]);
        continue;
      }
      const fold = mergeBoardVersions(baseBoards[key] ?? null, boards[key] ?? null, peer.records[key], { advanceRevision: false, writerId, now });
      boards[key] = fold.board;
      conflicts.push(...fold.conflicts);
    }
  }
  return { profile, boards, conflicts, replacementApplied, peersFolded: sorted.length };
};

/*
 * Baseline persistence. A dedicated database keeps sync state invisible to
 * the app store: `getAllData` cannot enumerate it, backups cannot embed it,
 * and reset/restore cannot resurrect through it (generation fencing plus the
 * explicit reset on `replacementApplied` cover staleness).
 */
const openBaselineDatabase = () => new Promise((resolve, reject) => {
  const request = globalThis.indexedDB.open(BASELINE_DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(BASELINE_STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const loadSyncBaseline = async () => {
  if (!globalThis.indexedDB) return null;
  try {
    const db = await openBaselineDatabase();
    return await new Promise((resolve) => {
      const request = db.transaction(BASELINE_STORE, "readonly").objectStore(BASELINE_STORE).get(BASELINE_KEY);
      request.onsuccess = () => { resolve(request.result || null); db.close(); };
      request.onerror = () => { resolve(null); db.close(); };
    });
  } catch {
    return null;
  }
};

export const saveSyncBaseline = async (baseline) => {
  if (!globalThis.indexedDB) return false;
  try {
    const db = await openBaselineDatabase();
    return await new Promise((resolve) => {
      const transaction = db.transaction(BASELINE_STORE, "readwrite");
      transaction.objectStore(BASELINE_STORE).put(baseline, BASELINE_KEY);
      transaction.oncomplete = () => { resolve(true); db.close(); };
      transaction.onerror = () => { resolve(false); db.close(); };
    });
  } catch {
    return false;
  }
};

export const clearSyncBaseline = async () => {
  if (!globalThis.indexedDB) return;
  await new Promise((resolve) => {
    const request = globalThis.indexedDB.deleteDatabase(BASELINE_DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
};
