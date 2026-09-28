import { createId } from "./id.js";

/**
 * SYNC-001 device identity and vault membership. Settings renders these on
 * every open, and creating or leaving a vault writes them, so they stay in the
 * startup bundle: leaving a vault works offline from the first launch. The
 * encrypted fold and the rest of the baseline store (`syncVault.js`) load
 * with the backup tools on first use.
 */
export const DEVICE_ID_STORAGE_KEY = "lumen-device-id-v1";
export const VAULT_CONFIG_STORAGE_KEY = "lumen-sync-vault-v1";
// The sync baseline lives in its own IndexedDB database (see syncVault.js).
export const SYNC_BASELINE_DATABASE = "lumen-sync-baseline-v1";

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

/** Leaving a vault removes its baseline with the membership: one database delete. */
export const clearSyncBaseline = async () => {
  if (!globalThis.indexedDB) return;
  await new Promise((resolve) => {
    const request = globalThis.indexedDB.deleteDatabase(SYNC_BASELINE_DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
};
