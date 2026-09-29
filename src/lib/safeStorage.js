/**
 * Web Storage that never breaks the app (issue #139).
 *
 * Reading `localStorage` or `sessionStorage` can throw: where a browser blocks
 * site storage (a policy, some private modes, a sandboxed frame) the accessor
 * itself throws a SecurityError, and a full store throws a QuotaExceededError
 * on write. Every Lumen read and write goes through this module, which looks
 * the store up inside `try` on every call and never throws.
 * src/lib/safeStorage.test.mjs fails if code elsewhere in src/ names either
 * store, so a default parameter can never evaluate the accessor again.
 *
 * Two kinds of store:
 * - `safeLocalStorage` and `safeSessionStorage` hold per-browser conveniences
 *   (the AI engine choice, the reader panel, recent searches, the local-model
 *   disclosure, tutor drafts). A change the browser would not store is kept
 *   in memory, so it still holds until Lumen closes.
 * - `durableLocalStorage` and `durableSessionStorage` have no memory copy: a
 *   read returns only what the browser really stored. They serve callers that
 *   must know a write landed: download consent and its revocation, the
 *   chunk-recovery marker (a marker that would not survive the reload could
 *   loop), narration positions and audio bookmarks (reported as not saved),
 *   the IndexedDB fallback journal and the cross-tab sync signals.
 *
 * `getItem(key, unavailable = null)` returns the stored string, null when
 * nothing is stored, and `unavailable` when the browser refused the read.
 * Pass a sentinel such as a Symbol: `undefined` would select the null default.
 * `setItem` and `removeItem` return true only when the browser store took the
 * change. Study data lives in IndexedDB and never depends on Web Storage.
 */

const failedAreas = new Set();
const listeners = new Set();

const noteFailure = (area) => {
  if (!area || failedAreas.has(area)) return;
  failedAreas.add(area);
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* a listener never breaks storage */ }
  }
};

const openStore = (resolve) => {
  const store = resolve();
  if (!store) throw new TypeError("Web Storage is unavailable.");
  return store;
};

/**
 * A Storage-shaped object over `resolve()`, which is called inside `try` on
 * every access. `area` ("local" or "session") reports failures to the device
 * status below; `remember` keeps refused changes in memory for this session.
 */
export const createSafeStorage = (resolve, { area = "", remember = false } = {}) => {
  const memory = remember ? new Map() : null;
  return Object.freeze({
    getItem(key, unavailable = null) {
      const name = String(key);
      if (memory?.has(name)) return memory.get(name);
      try {
        const value = openStore(resolve).getItem(name);
        return typeof value === "string" ? value : null;
      } catch {
        noteFailure(area);
        return unavailable;
      }
    },
    setItem(key, value) {
      const name = String(key);
      const text = String(value);
      try {
        openStore(resolve).setItem(name, text);
        memory?.delete(name);
        return true;
      } catch {
        noteFailure(area);
        memory?.set(name, text);
        return false;
      }
    },
    removeItem(key) {
      const name = String(key);
      try {
        openStore(resolve).removeItem(name);
        memory?.delete(name);
        return true;
      } catch {
        noteFailure(area);
        // A removal the browser refused still hides the stored value here.
        memory?.set(name, null);
        return false;
      }
    },
  });
};

const localArea = () => globalThis.localStorage;
const sessionArea = () => globalThis.sessionStorage;

export const safeLocalStorage = createSafeStorage(localArea, { area: "local", remember: true });
export const safeSessionStorage = createSafeStorage(sessionArea, { area: "session", remember: true });
export const durableLocalStorage = createSafeStorage(localArea, { area: "local" });
export const durableSessionStorage = createSafeStorage(sessionArea, { area: "session" });

/** Guards a store a caller passed in (a test double, or null): same contract, no memory copy. */
export const guardStorage = (storage) => createSafeStorage(() => storage);

const PROBE_KEY = "lumen.storage-probe.v1";

/**
 * Whether this browser is saving Lumen's per-device preferences. It turns
 * false for the rest of the session once any localStorage access fails.
 */
export const deviceStorageSaves = () => !failedAreas.has("local");

export const subscribeDeviceStorage = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Writes, reads back and removes a probe key; a failure updates `deviceStorageSaves`. */
export const checkDeviceStorage = () => {
  if (!deviceStorageSaves()) return false;
  if (!durableLocalStorage.setItem(PROBE_KEY, "1")) return false;
  if (durableLocalStorage.getItem(PROBE_KEY) !== "1") {
    noteFailure("local");
    return false;
  }
  return durableLocalStorage.removeItem(PROBE_KEY);
};
