import { createId } from "./id.js";
import { normalizeMistakes } from "./mistakes.js";
import { normalizeAssessments } from "./assessment.js";
import {
  assertOwnedDataBudgetTransition,
  isOwnedDataKey,
  jsonBytes,
  MAX_BOARD_RECORDS,
  MAX_OWNED_DATA_BYTES,
  StorageBudgetError,
  summarizeOwnedData,
  summarizeOwnedRecordBytes,
} from "./storageBudget.js";

const DB_NAME = "lumen-ai-notes";
const DB_VERSION = 1;
const STORE = "study-data";
const FALLBACK_KEY = "lumen-ai-notes-fallback";
const FALLBACK_ENVELOPE_VERSION = 1;
const AUTHORITATIVE_SNAPSHOT_KEY = "__lumenAuthoritativeSnapshot";
const STORAGE_BUDGET_LEDGER_KEY = "__lumenStorageBudgetLedger";
const STORAGE_BUDGET_LEDGER_VERSION = 1;
export const PROFILE_VERSION = 4;

let databasePromise;
let memoryFallback = {};
let budgetLedgerCache;

const isInternalStorageKey = (key) => key === AUTHORITATIVE_SNAPSHOT_KEY || key === STORAGE_BUDGET_LEDGER_KEY;
const publicEntries = (entries) => Object.fromEntries(
  Object.entries(entries || {}).filter(([key]) => !isInternalStorageKey(key)),
);

const makeBudgetLedgerFromSummary = (summary, revision = 0) => {
  return {
    version: STORAGE_BUDGET_LEDGER_VERSION,
    revision: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(revision) || 0))),
    bytes: summary.bytes,
    boardRecords: summary.boardRecords,
    recordBytes: summary.recordBytes,
    updatedAt: new Date().toISOString(),
  };
};
const makeBudgetLedgerFromRecords = (records, revision = 0) => makeBudgetLedgerFromSummary(
  summarizeOwnedData(publicEntries(records)),
  revision,
);
const makeBudgetLedgerFromRecordBytes = (recordBytes, revision = 0) => makeBudgetLedgerFromSummary(
  summarizeOwnedRecordBytes(recordBytes),
  revision,
);

const normalizeBudgetLedger = (value) => {
  if (!value || value.version !== STORAGE_BUDGET_LEDGER_VERSION || !value.recordBytes || typeof value.recordBytes !== "object" || Array.isArray(value.recordBytes)) return null;
  const summary = summarizeOwnedRecordBytes(value.recordBytes);
  if (summary.bytes !== value.bytes || summary.boardRecords !== value.boardRecords) return null;
  // Invalid keys/byte values are removed by summarizeOwnedRecordBytes. Treat
  // that as corruption rather than silently trusting an incomplete ledger.
  if (Object.keys(summary.recordBytes).length !== Object.keys(value.recordBytes).length) return null;
  return {
    version: STORAGE_BUDGET_LEDGER_VERSION,
    revision: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(value.revision) || 0))),
    bytes: summary.bytes,
    boardRecords: summary.boardRecords,
    recordBytes: summary.recordBytes,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
};

const cacheBudgetLedger = (value) => {
  const normalized = normalizeBudgetLedger(value);
  if (normalized && (!budgetLedgerCache || normalized.revision >= budgetLedgerCache.revision)) budgetLedgerCache = normalized;
  return normalized;
};

const nextLedgerForRecord = (currentLedger, key, value, deleted = false) => {
  const recordBytes = { ...currentLedger.recordBytes };
  if (deleted) delete recordBytes[key];
  else recordBytes[key] = jsonBytes(value);
  const next = makeBudgetLedgerFromRecordBytes(recordBytes, currentLedger.revision + 1);
  assertOwnedDataBudgetTransition(currentLedger, next);
  return next;
};

const unknownBudgetError = () => new StorageBudgetError(
  "Lumen cannot safely measure the existing workspace while durable storage is unavailable. Retry when storage access recovers; no data was changed.",
  { code: "BUDGET_STATE_UNAVAILABLE" },
);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const makeFallbackEntry = (value, deleted = false) => ({
  __lumenFallback: FALLBACK_ENVELOPE_VERSION,
  revision: createId(),
  updatedAt: new Date().toISOString(),
  deleted,
  value: deleted ? undefined : value,
});
const unwrapFallbackEntry = (entry) => entry?.__lumenFallback === FALLBACK_ENVELOPE_VERSION
  ? { value: entry.value, deleted: Boolean(entry.deleted) }
  : { value: entry, deleted: false };
const hasAuthoritativeSnapshot = (entries) => entries?.[AUTHORITATIVE_SNAPSHOT_KEY]?.version === 1;
const visibleFallbackEntries = (entries) => Object.fromEntries(
  Object.entries(entries || {}).flatMap(([key, entry]) => {
    if (isInternalStorageKey(key)) return [];
    const candidate = unwrapFallbackEntry(entry);
    return candidate.deleted ? [] : [[key, candidate.value]];
  }),
);

const readFallback = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : memoryFallback;
  } catch {
    return memoryFallback;
  }
};

const writeFallback = (value) => {
  memoryFallback = value;
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(value));
    return true;
  } catch {
    // The in-memory copy still keeps the current session usable.
    return false;
  }
};

const fallbackBudgetLedger = (entries = readFallback()) => (
  normalizeBudgetLedger(entries?.[STORAGE_BUDGET_LEDGER_KEY]) || budgetLedgerCache || null
);

const mirrorBudgetLedger = (ledger) => {
  const normalized = cacheBudgetLedger(ledger);
  if (!normalized) return false;
  const entries = readFallback();
  const existing = normalizeBudgetLedger(entries[STORAGE_BUDGET_LEDGER_KEY]);
  if (existing && existing.revision > normalized.revision) {
    cacheBudgetLedger(existing);
    return true;
  }
  entries[STORAGE_BUDGET_LEDGER_KEY] = normalized;
  return writeFallback(entries);
};

const fallbackLedgerForMutation = (entries) => {
  if (hasAuthoritativeSnapshot(entries)) return makeBudgetLedgerFromRecords(visibleFallbackEntries(entries));
  return fallbackBudgetLedger(entries);
};

const persistFallbackOwnedMutation = (key, value, deleted, databaseError) => {
  const entries = readFallback();
  const currentLedger = fallbackLedgerForMutation(entries);
  if (!currentLedger) throw unknownBudgetError();
  const nextLedger = nextLedgerForRecord(currentLedger, key, value, deleted);
  if (hasAuthoritativeSnapshot(entries)) {
    if (deleted) delete entries[key];
    else entries[key] = makeFallbackEntry(value);
  } else {
    entries[key] = makeFallbackEntry(value, deleted);
  }
  entries[STORAGE_BUDGET_LEDGER_KEY] = nextLedger;
  if (!writeFallback(entries)) {
    throw new Error(deleted ? "The deletion could not be persisted" : "Persistent browser storage is unavailable", { cause: databaseError });
  }
  cacheBudgetLedger(nextLedger);
  return deleted ? undefined : value;
};

const removeFallbackKey = (key) => {
  const entries = readFallback();
  if (!(key in entries)) return;
  delete entries[key];
  writeFallback(entries);
};

const openDatabase = () => {
  if (!databasePromise) {
    const pending = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const timeout = setTimeout(() => fail(new Error("IndexedDB did not become available")), 1800);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        if (settled) {
          request.result?.close?.();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(request.result);
      };
      request.onerror = () => fail(request.error || new Error("IndexedDB could not be opened"));
      request.onblocked = () => fail(new Error("IndexedDB is blocked"));
    });
    databasePromise = pending;
    pending.catch(() => {
      if (databasePromise === pending) databasePromise = undefined;
    });
  }
  return databasePromise;
};

const withStore = async (mode, action) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = action(store);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Storage transaction was aborted"));
  });
};

class StorageUpdaterError extends Error {
  constructor(cause) {
    super("The storage updater could not produce a value", { cause });
    this.name = "StorageUpdaterError";
  }
}

const atomicOwnedMutation = async (key, updater, { deleted = false, guardKey = "", guard = null } = {}) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const ledgerRequest = store.get(STORAGE_BUDGET_LEDGER_KEY);
    const valueRequest = store.get(key);
    const guardRequest = guardKey ? store.get(guardKey) : null;
    let ledgerReady = false;
    let valueReady = false;
    let guardReady = !guardRequest;
    let scanStarted = false;
    let mutationStarted = false;
    let nextValue;
    let committedLedger;
    let applied = false;
    let explicitError;

    const failInput = (error) => {
      explicitError = error instanceof StorageBudgetError ? error : new StorageUpdaterError(error);
      try { transaction.abort?.(); } catch { /* already aborting */ }
      reject(explicitError);
    };

    const commit = (currentLedger) => {
      if (mutationStarted) return;
      mutationStarted = true;
      try {
        if (guard && !guard(guardRequest.result)) {
          nextValue = valueRequest.result;
          return;
        }
        nextValue = deleted ? undefined : updater(valueRequest.result);
        committedLedger = nextLedgerForRecord(currentLedger, key, nextValue, deleted);
        applied = true;
        if (deleted) store.delete(key);
        else store.put(nextValue, key);
        store.put(committedLedger, STORAGE_BUDGET_LEDGER_KEY);
      } catch (error) {
        failInput(error);
      }
    };

    const rebuildFromStore = () => {
      if (scanStarted) return;
      scanStarted = true;
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      let keysReady = false;
      let valuesReady = false;
      const finish = () => {
        if (!keysReady || !valuesReady) return;
        try {
          const records = {};
          keysRequest.result.forEach((storedKey, index) => {
            if (!isInternalStorageKey(storedKey)) records[storedKey] = valuesRequest.result[index];
          });
          const priorRevision = Math.max(
            normalizeBudgetLedger(ledgerRequest.result)?.revision || 0,
            budgetLedgerCache?.revision || 0,
            normalizeBudgetLedger(readFallback()[STORAGE_BUDGET_LEDGER_KEY])?.revision || 0,
          );
          commit(makeBudgetLedgerFromRecords(records, priorRevision));
        } catch (error) {
          failInput(error);
        }
      };
      keysRequest.onsuccess = () => { keysReady = true; finish(); };
      valuesRequest.onsuccess = () => { valuesReady = true; finish(); };
      keysRequest.onerror = () => reject(keysRequest.error || new Error("The storage budget ledger could not be rebuilt"));
      valuesRequest.onerror = () => reject(valuesRequest.error || new Error("The storage budget ledger could not be rebuilt"));
    };

    const inspect = () => {
      if (!ledgerReady || !valueReady || !guardReady || mutationStarted || scanStarted) return;
      const ledger = normalizeBudgetLedger(ledgerRequest.result);
      if (!ledger) {
        rebuildFromStore();
        return;
      }
      try {
        const ledgerHasRecord = hasOwn(ledger.recordBytes, key);
        const storeHasRecord = valueRequest.result !== undefined;
        const targetMatches = ledgerHasRecord === storeHasRecord
          && (!storeHasRecord || ledger.recordBytes[key] === jsonBytes(valueRequest.result));
        if (!targetMatches) rebuildFromStore();
        else commit(ledger);
      } catch (error) {
        failInput(error);
      }
    };

    ledgerRequest.onsuccess = () => { ledgerReady = true; inspect(); };
    valueRequest.onsuccess = () => { valueReady = true; inspect(); };
    if (guardRequest) guardRequest.onsuccess = () => { guardReady = true; inspect(); };
    ledgerRequest.onerror = () => reject(ledgerRequest.error || new Error("The storage budget ledger could not be read"));
    valueRequest.onerror = () => reject(valueRequest.error || new Error("The stored record could not be read"));
    if (guardRequest) guardRequest.onerror = () => reject(guardRequest.error || new Error("The storage mutation guard could not be read"));
    transaction.oncomplete = () => {
      if (committedLedger) {
        cacheBudgetLedger(committedLedger);
        mirrorBudgetLedger(committedLedger);
      }
      resolve({ applied, value: nextValue, ledger: committedLedger });
    };
    transaction.onerror = () => reject(explicitError || transaction.error || new Error("Storage mutation failed"));
    transaction.onabort = () => reject(explicitError || transaction.error || new Error("Storage mutation was aborted"));
  });
};

const replaceDatabaseEntries = async (entries, { enforceBudget = false, fallbackOverlay = null, currentSnapshot = null } = {}) => {
  const db = await openDatabase();
  const safeEntries = publicEntries(entries);
  const committedLedger = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let nextLedger;
    let explicitError;

    const writeReplacement = (currentRecords = null, currentRevision = 0) => {
      try {
        nextLedger = makeBudgetLedgerFromRecords(safeEntries, currentRevision + 1);
        if (enforceBudget) {
          const currentLedger = makeBudgetLedgerFromRecords(currentRecords || {}, currentRevision);
          assertOwnedDataBudgetTransition(currentLedger, nextLedger);
        }
        store.clear();
        Object.entries(safeEntries).forEach(([key, value]) => store.put(value, key));
        store.put(nextLedger, STORAGE_BUDGET_LEDGER_KEY);
      } catch (error) {
        explicitError = error;
        try { transaction.abort?.(); } catch { /* already aborting */ }
        reject(error);
      }
    };

    if (!enforceBudget) {
      writeReplacement(null, budgetLedgerCache?.revision || 0);
    } else {
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      let keysReady = false;
      let valuesReady = false;
      const finish = () => {
        if (!keysReady || !valuesReady) return;
        const currentRecords = {};
        let currentRevision = 0;
        keysRequest.result.forEach((key, index) => {
          if (key === STORAGE_BUDGET_LEDGER_KEY) {
            currentRevision = normalizeBudgetLedger(valuesRequest.result[index])?.revision || 0;
          } else if (!isInternalStorageKey(key)) currentRecords[key] = valuesRequest.result[index];
        });
        currentRevision = Math.max(
          currentRevision,
          budgetLedgerCache?.revision || 0,
          normalizeBudgetLedger(fallbackOverlay?.[STORAGE_BUDGET_LEDGER_KEY])?.revision || 0,
        );
        if (currentSnapshot) {
          Object.keys(currentRecords).forEach((key) => delete currentRecords[key]);
          Object.assign(currentRecords, publicEntries(currentSnapshot));
        } else if (fallbackOverlay) {
          Object.entries(fallbackOverlay).forEach(([key, entry]) => {
            if (isInternalStorageKey(key)) return;
            const candidate = unwrapFallbackEntry(entry);
            if (candidate.deleted) delete currentRecords[key];
            else currentRecords[key] = candidate.value;
          });
        }
        writeReplacement(currentRecords, currentRevision);
      };
      keysRequest.onsuccess = () => { keysReady = true; finish(); };
      valuesRequest.onsuccess = () => { valuesReady = true; finish(); };
      keysRequest.onerror = () => reject(keysRequest.error || new Error("Stored keys could not be inspected before replacement"));
      valuesRequest.onerror = () => reject(valuesRequest.error || new Error("Stored records could not be inspected before replacement"));
    }
    transaction.oncomplete = () => resolve(nextLedger);
    transaction.onerror = () => reject(explicitError || transaction.error || new Error("Storage replacement failed"));
    transaction.onabort = () => reject(explicitError || transaction.error || new Error("Storage replacement was aborted"));
  });
  cacheBudgetLedger(committedLedger);
  mirrorBudgetLedger(committedLedger);
  return committedLedger;
};

const reconcileAuthoritativeSnapshot = async (fallback) => {
  const snapshot = visibleFallbackEntries(fallback);
  await replaceDatabaseEntries(snapshot);
  const ledger = budgetLedgerCache || makeBudgetLedgerFromRecords(snapshot);
  writeFallback({ [STORAGE_BUDGET_LEDGER_KEY]: ledger });
  return snapshot;
};

export const getData = async (key) => {
  if (isInternalStorageKey(key)) return undefined;
  const fallback = readFallback();
  if (hasAuthoritativeSnapshot(fallback)) {
    const snapshot = visibleFallbackEntries(fallback);
    try {
      await reconcileAuthoritativeSnapshot(fallback);
    } catch {
      // The authoritative snapshot remains the source of truth until the full
      // clear-and-replace transaction can be committed atomically.
    }
    return snapshot[key];
  }
  const hasFallback = hasOwn(fallback, key);
  try {
    const stored = await withStore("readonly", (store) => store.get(key));
    if (!hasFallback) return stored;

    // A fallback entry only remains when a newer IndexedDB mutation failed.
    // Reconcile it before trusting the older IndexedDB value, preventing data
    // from appearing to roll back after a transient Safari storage failure.
    const candidate = unwrapFallbackEntry(fallback[key]);
    try {
      if (isOwnedDataKey(key)) {
        await atomicOwnedMutation(key, () => candidate.value, { deleted: candidate.deleted });
      } else {
        await withStore("readwrite", (store) => candidate.deleted ? store.delete(key) : store.put(candidate.value, key));
      }
      removeFallbackKey(key);
    } catch {
      // Keep the journal entry for the next recovery attempt.
    }
    return candidate.deleted ? undefined : candidate.value;
  } catch {
    if (!hasFallback) return undefined;
    const candidate = unwrapFallbackEntry(fallback[key]);
    return candidate.deleted ? undefined : candidate.value;
  }
};

export const setData = async (key, value) => {
  if (isInternalStorageKey(key)) throw new TypeError("Reserved storage metadata cannot be changed directly");
  const fallback = readFallback();
  if (hasAuthoritativeSnapshot(fallback)) {
    if (isOwnedDataKey(key)) persistFallbackOwnedMutation(key, value, false);
    else {
      fallback[key] = makeFallbackEntry(value);
      if (!writeFallback(fallback)) throw new Error("Persistent browser storage is unavailable");
    }
    try {
      await reconcileAuthoritativeSnapshot(readFallback());
    } catch {
      // Keep the entire replacement snapshot journaled; a partial database
      // write would allow records removed by reset/restore to resurrect.
    }
    return key;
  }
  if (isOwnedDataKey(key)) {
    try {
      await atomicOwnedMutation(key, () => value);
      removeFallbackKey(key);
      return key;
    } catch (databaseError) {
      if (databaseError instanceof StorageBudgetError) throw databaseError;
      if (databaseError instanceof StorageUpdaterError) throw databaseError.cause;
      persistFallbackOwnedMutation(key, value, false, databaseError);
      return key;
    }
  }
  try {
    const result = await withStore("readwrite", (store) => store.put(value, key));
    removeFallbackKey(key);
    return result;
  } catch (databaseError) {
    const entries = readFallback();
    entries[key] = makeFallbackEntry(value);
    if (!writeFallback(entries)) throw new Error("Persistent browser storage is unavailable", { cause: databaseError });
    return key;
  }
};

/**
 * Atomically read, transform, and replace one record when IndexedDB is
 * available. Read/write transactions are serialized by the browser, which is
 * important for cross-tab profile reconciliation: a later tab sees the value
 * committed by an earlier tab before it computes its merge.
 *
 * The updater must be synchronous and side-effect free. When IndexedDB is
 * unavailable we retain the existing journal-backed fallback; the app's
 * BroadcastChannel/storage-event reconciliation closes races in that mode.
 */
export const updateData = async (key, updater) => {
  if (typeof updater !== "function") throw new TypeError("updateData requires an updater function");
  if (isInternalStorageKey(key)) throw new TypeError("Reserved storage metadata cannot be changed directly");
  const pendingFallback = readFallback();
  if (hasAuthoritativeSnapshot(pendingFallback)) {
    const currentValue = visibleFallbackEntries(pendingFallback)[key];
    const nextValue = updater(currentValue);
    await setData(key, nextValue);
    return nextValue;
  }
  if (isOwnedDataKey(key)) {
    try {
      const result = await atomicOwnedMutation(key, updater);
      removeFallbackKey(key);
      return result.value;
    } catch (databaseError) {
      if (databaseError instanceof StorageBudgetError) throw databaseError;
      if (databaseError instanceof StorageUpdaterError) throw databaseError.cause;
      // A localStorage journal cannot offer IndexedDB's compare-and-swap, but
      // it still applies the same aggregate budget before accepting a write.
      const currentValue = await getData(key);
      const nextValue = updater(currentValue);
      persistFallbackOwnedMutation(key, nextValue, false, databaseError);
      return nextValue;
    }
  }
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const readRequest = store.get(key);
      let nextValue;

      readRequest.onsuccess = () => {
        try {
          nextValue = updater(readRequest.result);
          store.put(nextValue, key);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      readRequest.onerror = () => reject(readRequest.error);
      transaction.oncomplete = () => {
        removeFallbackKey(key);
        resolve(nextValue);
      };
      transaction.onerror = () => reject(transaction.error || new Error("Storage update failed"));
      transaction.onabort = () => reject(transaction.error || new Error("Storage update was aborted"));
    });
  } catch (databaseError) {
    // This path cannot provide a transactional localStorage compare-and-swap.
    // It is intentionally paired with cross-tab message reconciliation in App.
    const currentValue = await getData(key);
    let nextValue;
    try {
      nextValue = updater(currentValue);
    } catch (updaterError) {
      throw updaterError;
    }
    try {
      await setData(key, nextValue);
      return nextValue;
    } catch (fallbackError) {
      throw new Error("The atomic storage update could not be persisted", { cause: fallbackError || databaseError });
    }
  }
};

/**
 * Atomically updates one record only while a second record satisfies `guard`.
 * Both reads and the optional write share one IndexedDB read/write transaction,
 * so a reset/restore of the profile and a whiteboard save have a defined order:
 * either the board commits before the replacement (and is cleared by it), or it
 * observes the new profile generation and is rejected.
 */
export const updateDataGuarded = async (key, guardKey, guard, updater) => {
  if (typeof guard !== "function" || typeof updater !== "function") {
    throw new TypeError("updateDataGuarded requires guard and updater functions");
  }
  if (isInternalStorageKey(key) || isInternalStorageKey(guardKey)) throw new TypeError("Reserved storage metadata cannot be changed directly");
  const pendingFallback = readFallback();
  if (hasAuthoritativeSnapshot(pendingFallback)) {
    const snapshot = visibleFallbackEntries(pendingFallback);
    if (!guard(snapshot[guardKey])) return { applied: false, value: snapshot[key] };
    const nextValue = updater(snapshot[key]);
    await setData(key, nextValue);
    return { applied: true, value: nextValue };
  }

  // Reconcile an outstanding journal entry before opening the guarded
  // transaction; otherwise it could inspect an older IndexedDB generation.
  if (hasOwn(pendingFallback, guardKey)) await getData(guardKey);
  if (hasOwn(pendingFallback, key)) await getData(key);

  if (isOwnedDataKey(key)) {
    try {
      const result = await atomicOwnedMutation(key, updater, { guardKey, guard });
      if (result.applied) removeFallbackKey(key);
      return { applied: result.applied, value: result.value };
    } catch (databaseError) {
      if (databaseError instanceof StorageBudgetError) throw databaseError;
      if (databaseError instanceof StorageUpdaterError) throw databaseError.cause;
      // localStorage cannot make the guard and write atomic, but updateData
      // still applies the aggregate budget to the accepted fallback value.
      const guardValue = await getData(guardKey);
      if (!guard(guardValue)) return { applied: false, value: await getData(key) };
      const value = await updateData(key, updater);
      return { applied: true, value };
    }
  }

  let updaterFailure;
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const valueRequest = store.get(key);
      const guardRequest = store.get(guardKey);
      let valueReady = false;
      let guardReady = false;
      let currentValue;
      let guardValue;
      let nextValue;
      let applied = false;
      let evaluated = false;

      const evaluate = () => {
        if (evaluated || !valueReady || !guardReady) return;
        evaluated = true;
        try {
          if (!guard(guardValue)) return;
          nextValue = updater(currentValue);
          applied = true;
          store.put(nextValue, key);
        } catch (error) {
          updaterFailure = error;
          transaction.abort();
        }
      };
      valueRequest.onsuccess = () => {
        currentValue = valueRequest.result;
        valueReady = true;
        evaluate();
      };
      guardRequest.onsuccess = () => {
        guardValue = guardRequest.result;
        guardReady = true;
        evaluate();
      };
      valueRequest.onerror = () => reject(valueRequest.error);
      guardRequest.onerror = () => reject(guardRequest.error);
      transaction.oncomplete = () => {
        if (applied) removeFallbackKey(key);
        resolve({ applied, value: applied ? nextValue : currentValue });
      };
      transaction.onerror = () => reject(updaterFailure || transaction.error || new Error("Guarded storage update failed"));
      transaction.onabort = () => reject(updaterFailure || transaction.error || new Error("Guarded storage update was aborted"));
    });
  } catch (databaseError) {
    if (updaterFailure) throw updaterFailure;
    // localStorage cannot provide a multi-record transaction. The generation
    // check still prevents ordinary stale writes and the replacement event
    // fences the remaining narrow fallback race.
    const guardValue = await getData(guardKey);
    if (!guard(guardValue)) return { applied: false, value: await getData(key) };
    const value = await updateData(key, updater);
    return { applied: true, value };
  }
};

export const deleteData = async (key) => {
  if (isInternalStorageKey(key)) throw new TypeError("Reserved storage metadata cannot be changed directly");
  const fallback = readFallback();
  if (hasAuthoritativeSnapshot(fallback)) {
    if (isOwnedDataKey(key)) persistFallbackOwnedMutation(key, undefined, true);
    else {
      delete fallback[key];
      if (!writeFallback(fallback)) throw new Error("The deletion could not be persisted");
    }
    try {
      await reconcileAuthoritativeSnapshot(readFallback());
    } catch {
      // Keep the authoritative snapshot for a later atomic reconciliation.
    }
    return undefined;
  }
  if (isOwnedDataKey(key)) {
    try {
      await atomicOwnedMutation(key, () => undefined, { deleted: true });
      removeFallbackKey(key);
      return undefined;
    } catch (databaseError) {
      if (databaseError instanceof StorageBudgetError) throw databaseError;
      if (databaseError instanceof StorageUpdaterError) throw databaseError.cause;
      return persistFallbackOwnedMutation(key, undefined, true, databaseError);
    }
  }
  try {
    const result = await withStore("readwrite", (store) => store.delete(key));
    removeFallbackKey(key);
    return result;
  } catch (databaseError) {
    const entries = readFallback();
    entries[key] = makeFallbackEntry(undefined, true);
    if (!writeFallback(entries)) throw new Error("The deletion could not be persisted", { cause: databaseError });
    return undefined;
  }
};

export const getAllData = async () => {
  const pendingSnapshot = readFallback();
  if (hasAuthoritativeSnapshot(pendingSnapshot)) {
    const snapshot = visibleFallbackEntries(pendingSnapshot);
    const snapshotLedger = makeBudgetLedgerFromRecords(snapshot, fallbackBudgetLedger(pendingSnapshot)?.revision || 0);
    mirrorBudgetLedger(snapshotLedger);
    try {
      await reconcileAuthoritativeSnapshot(pendingSnapshot);
    } catch {
      // Returning the snapshot (rather than stale IndexedDB records) preserves
      // the exact reset/restore result while storage is unavailable.
    }
    return snapshot;
  }
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      transaction.oncomplete = () => {
        const entries = {};
        let storedLedger = null;
        keysRequest.result.forEach((key, index) => {
          if (key === STORAGE_BUDGET_LEDGER_KEY) storedLedger = normalizeBudgetLedger(valuesRequest.result[index]);
          else if (!isInternalStorageKey(key)) entries[key] = valuesRequest.result[index];
        });
        const fallback = readFallback();
        Object.entries(fallback).forEach(([key, entry]) => {
          if (isInternalStorageKey(key)) return;
          const candidate = unwrapFallbackEntry(entry);
          if (candidate.deleted) delete entries[key];
          else entries[key] = candidate.value;
        });
        const fallbackLedger = normalizeBudgetLedger(fallback[STORAGE_BUDGET_LEDGER_KEY]);
        const logicalLedger = makeBudgetLedgerFromRecords(entries, Math.max(storedLedger?.revision || 0, fallbackLedger?.revision || 0));
        cacheBudgetLedger(logicalLedger);
        mirrorBudgetLedger(logicalLedger);
        resolve(entries);
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    const entries = {};
    Object.entries(readFallback()).forEach(([key, entry]) => {
      if (isInternalStorageKey(key)) return;
      const candidate = unwrapFallbackEntry(entry);
      if (!candidate.deleted) entries[key] = candidate.value;
    });
    return entries;
  }
};

/** Lightweight, non-sensitive byte inventory for Settings. The durable ledger
 * avoids serializing the learner's entire workspace again on memory-constrained
 * phones. */
export const getStorageBudgetSummary = async () => {
  if (!budgetLedgerCache) await getAllData();
  const ledger = budgetLedgerCache || makeBudgetLedgerFromRecords({});
  const recordBytes = { ...ledger.recordBytes };
  return {
    bytes: ledger.bytes,
    boardRecords: ledger.boardRecords,
    profileBytes: recordBytes.profile || 0,
    boardBytes: Object.entries(recordBytes).reduce((total, [key, value]) => key.startsWith("board:") ? total + value : total, 0),
    maximumBytes: MAX_OWNED_DATA_BYTES,
    maximumBoards: MAX_BOARD_RECORDS,
  };
};

export const replaceAllData = async (entries) => {
  const safeEntries = publicEntries(entries);
  const fallback = readFallback();
  try {
    await replaceDatabaseEntries(safeEntries, {
      enforceBudget: true,
      fallbackOverlay: hasAuthoritativeSnapshot(fallback) ? null : fallback,
      currentSnapshot: hasAuthoritativeSnapshot(fallback) ? visibleFallbackEntries(fallback) : null,
    });
    writeFallback({ [STORAGE_BUDGET_LEDGER_KEY]: budgetLedgerCache });
    return undefined;
  } catch (databaseError) {
    if (databaseError instanceof StorageBudgetError) throw databaseError;
    const currentLedger = hasAuthoritativeSnapshot(fallback)
      ? makeBudgetLedgerFromRecords(visibleFallbackEntries(fallback), fallbackBudgetLedger(fallback)?.revision || 0)
      : fallbackLedgerForMutation(fallback);
    if (!currentLedger) throw unknownBudgetError();
    const nextLedger = makeBudgetLedgerFromRecords(safeEntries, currentLedger.revision + 1);
    assertOwnedDataBudgetTransition(currentLedger, nextLedger);
    const journal = {
      [AUTHORITATIVE_SNAPSHOT_KEY]: {
        version: 1,
        revision: createId(),
        updatedAt: new Date().toISOString(),
      },
      [STORAGE_BUDGET_LEDGER_KEY]: nextLedger,
      ...Object.fromEntries(Object.entries(safeEntries).map(([key, value]) => [key, makeFallbackEntry(value)])),
    };
    if (!writeFallback(journal)) throw new Error("The imported backup could not be persisted", { cause: databaseError });
    cacheBudgetLedger(nextLedger);
    return undefined;
  }
};

export const initialProfile = {
  version: PROFILE_VERSION,
  syncMeta: {
    revision: 0,
    updatedAt: "",
    writerId: "",
    generation: "",
    replacedAt: "",
    replacementReason: "",
    conflicts: [],
  },
  progress: {},
  readingPositions: {},
  bookmarks: [],
  personalNotes: {},
  clippings: [],
  mistakes: [],
  collections: [],
  trash: [],
  assessments: [],
  goals: {
    targetParts: [],
    targetDate: "",
    dailyMinutes: 0,
  },
  activity: [],
  revisions: [],
  annotations: [],
  reviewItems: [],
  reviewAttempts: [],
  reviewSessions: [],
  reviewSettings: {
    scheduler: "sm2",
    requestRetention: 0.9,
    dailyNewLimit: 10,
    dailyReviewLimit: 50,
  },
  backupMeta: {
    lastExportAt: "",
    lastImportAt: "",
    lastRecoveryAt: "",
    lastIntegrity: "",
  },
  aiTutorHistory: [],
  aiTutorHistoryTombstones: [],
  edits: {},
  customDocuments: [],
  deletedCustomDocumentIds: [],
  recent: [],
  lastDocumentId: "",
  settings: {
    theme: "system",
    fontScale: 1,
    lineHeight: 1.72,
    contentWidth: "comfortable",
    voiceURI: "",
    speechLanguage: "auto",
    speechRate: 1,
    speechPitch: 1,
    speechVolume: 1,
    speechScope: "document",
    keepScreenAwake: false,
    // Explicit no-AI preference (AI-002): when false, AI surfaces and their
    // configuration checks stay off until the learner re-enables them.
    aiFeaturesEnabled: true,
    // Durable Mac-tutor messages kept locally; 0 keeps history session-only.
    aiHistoryRetention: 50,
    // Saved library searches (SEARCH-001); recents stay device-local.
    savedSearches: [],
    // Narration pronunciation overrides (AUDIO-001): [{ term, spoken }].
    pronunciations: [],
    // Opt-in app-icon badge with today's due-review count (PLAN-002).
    dueBadgeEnabled: false,
    narrationAutoAdvance: false,
  },
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteUnitRecord = (value) => Object.fromEntries(
  Object.entries(isRecord(value) ? value : {})
    .filter(([key, item]) => typeof key === "string" && Number.isFinite(Number(item)))
    .map(([key, item]) => [key, Math.max(0, Math.min(1, Number(item)))]),
);
const stringRecord = (value, maximumLength) => Object.fromEntries(
  Object.entries(isRecord(value) ? value : {})
    .filter(([key, item]) => typeof key === "string" && typeof item === "string")
    .map(([key, item]) => [key, maximumLength ? item.slice(0, maximumLength) : item]),
);
const uniqueStrings = (value, limit = 500) => [...new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : [])].slice(0, limit);

const sanitizeStructuredValue = (value, state = { nodes: 0 }, depth = 0) => {
  if (state.nodes >= 2_000 || depth > 6) return null;
  state.nodes += 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 20_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeStructuredValue(item, state, depth + 1));
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, item]) => [key.slice(0, 100), sanitizeStructuredValue(item, state, depth + 1)]),
  );
};

const normalizeAiTutorHistory = (value) => (Array.isArray(value) ? value : [])
  .slice(-50)
  .flatMap((message) => {
    if (!isRecord(message) || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim()) return [];
    const citationSources = (Array.isArray(message.citationSources) ? message.citationSources : []).slice(0, 8).flatMap((source) => {
      if (!isRecord(source) || typeof source.id !== "string" || typeof source.title !== "string") return [];
      const original = isRecord(source.original) ? source.original : source;
      return [{
        id: source.id.slice(0, 240),
        title: source.title.slice(0, 200),
        section: typeof source.section === "string" ? source.section.slice(0, 200) : "",
        // Citation labels are stable for the lifetime of a tutor session and
        // can legitimately pass 99 after searching many different library
        // passages. Preserve the label so persisted [S#] links still resolve.
        citationNumber: Math.max(1, Math.min(9_999, Math.round(Number(source.citationNumber) || 1))),
        original: {
          id: typeof original.id === "string" ? original.id.slice(0, 240) : "",
          documentId: typeof original.documentId === "string" ? original.documentId.slice(0, 240) : "",
          slug: typeof original.slug === "string" ? original.slug.slice(0, 240) : "",
          title: typeof original.title === "string" ? original.title.slice(0, 200) : "",
          section: typeof (original.section ?? original.heading) === "string" ? (original.section ?? original.heading).slice(0, 200) : "",
          anchor: typeof original.anchor === "string" ? original.anchor.slice(0, 240) : "",
        },
      }];
    });
    const webSources = (Array.isArray(message.webSources) ? message.webSources : []).slice(0, 8).flatMap((source, index) => {
      if (!isRecord(source) || typeof source.title !== "string" || typeof source.url !== "string") return [];
      let url;
      try {
        const candidate = new URL(source.url);
        if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) return [];
        candidate.hash = "";
        url = candidate.href.slice(0, 2_000);
      } catch {
        return [];
      }
      return [{
        index: Number.isSafeInteger(source.index) && source.index > 0 && source.index <= 99 ? source.index : index + 1,
        title: source.title.trim().slice(0, 300),
        url,
        snippet: typeof source.snippet === "string" ? source.snippet.trim().slice(0, 1_200) : "",
        source: typeof source.source === "string" ? source.source.trim().slice(0, 100) : "",
        publishedAt: typeof source.publishedAt === "string" ? source.publishedAt.trim().slice(0, 80) : "",
      }];
    }).filter((source) => source.title);
    const rawMemory = isRecord(message.conversationMemory) ? message.conversationMemory : null;
    const compactedMessages = Number.isSafeInteger(rawMemory?.compactedMessages)
      ? Math.max(0, Math.min(50, rawMemory.compactedMessages))
      : 0;
    const memorySummary = typeof rawMemory?.summary === "string" ? rawMemory.summary.trim().slice(0, 2_800) : "";
    const conversationMemory = compactedMessages && memorySummary ? { compactedMessages, summary: memorySummary } : null;
    const rawApproach = isRecord(message.approach) ? message.approach : null;
    const approachSummary = typeof rawApproach?.summary === "string" ? rawApproach.summary.trim().slice(0, 500) : "";
    const approachSteps = (Array.isArray(rawApproach?.steps) ? rawApproach.steps : [])
      .map((step) => typeof step === "string" ? step.trim().slice(0, 400) : "")
      .filter(Boolean)
      .slice(0, 6);
    const approach = approachSummary && approachSteps.length ? { summary: approachSummary, steps: approachSteps } : null;
    const rawUsage = isRecord(message.usage) ? message.usage : null;
    const usageKeys = ["inputTokens", "outputTokens", "totalTokens"];
    const usage = rawUsage && usageKeys.every((key) => Number.isSafeInteger(rawUsage[key]) && rawUsage[key] >= 0)
      ? Object.fromEntries(usageKeys.map((key) => [key, Math.min(rawUsage[key], 10_000_000)]))
      : null;
    const rawTrace = isRecord(message.retrievalTrace) ? message.retrievalTrace : null;
    const boundedCount = (candidate, maximum = 100_000) => Number.isSafeInteger(candidate)
      ? Math.max(0, Math.min(maximum, candidate))
      : null;
    const boundedRatio = (candidate) => Number.isFinite(candidate) ? Math.max(0, Math.min(1, candidate)) : null;
    const retrievalTrace = rawTrace ? {
      strategy: typeof (rawTrace.strategy ?? rawTrace.mode) === "string" ? (rawTrace.strategy ?? rawTrace.mode).trim().slice(0, 80) : "",
      summary: typeof rawTrace.summary === "string" ? rawTrace.summary.trim().slice(0, 500) : "",
      candidates: boundedCount(rawTrace.candidates ?? rawTrace.corpus?.documentsScanned),
      matchedDocuments: boundedCount(rawTrace.matchedDocuments ?? rawTrace.selection?.matchedDocuments),
      passages: boundedCount(rawTrace.passages ?? rawTrace.selection?.returnedPassages, 8),
      confidenceLevel: typeof (rawTrace.confidenceLevel ?? rawTrace.confidence?.level) === "string" ? (rawTrace.confidenceLevel ?? rawTrace.confidence.level).trim().slice(0, 40) : "",
      confidenceScore: boundedRatio(rawTrace.confidenceScore ?? rawTrace.confidence?.score),
      confidenceCoverage: boundedRatio(rawTrace.confidenceCoverage ?? rawTrace.confidence?.coverage),
      lexicalStrength: boundedRatio(rawTrace.lexicalStrength ?? rawTrace.confidence?.lexicalStrength),
      diversity: boundedRatio(rawTrace.diversity ?? rawTrace.confidence?.diversity),
      webFallbackRecommended: rawTrace.webFallbackRecommended === true || rawTrace.webFallback?.recommended === true,
      webFallbackCode: typeof (rawTrace.webFallbackCode ?? rawTrace.webFallback?.code) === "string" ? (rawTrace.webFallbackCode ?? rawTrace.webFallback.code).trim().slice(0, 80) : "",
      webFallbackReason: typeof (rawTrace.webFallbackReason ?? rawTrace.webFallback?.reason) === "string" ? (rawTrace.webFallbackReason ?? rawTrace.webFallback.reason).trim().slice(0, 240) : "",
      budgetTruncated: rawTrace.budgetTruncated === true || rawTrace.budget?.truncated === true,
      returnedBytes: boundedCount(rawTrace.returnedBytes ?? rawTrace.budget?.returnedBytes, 10_000_000),
      maximumBytes: boundedCount(rawTrace.maximumBytes ?? rawTrace.budget?.maximumBytes, 10_000_000),
    } : null;
    return [{
      id: typeof message.id === "string" && message.id ? message.id.slice(0, 200) : createId(),
      role: message.role,
      content: message.content.trim().slice(0, 40_000),
      mode: typeof message.mode === "string" ? message.mode.slice(0, 40) : "",
      createdAt: typeof message.createdAt === "string" && Number.isFinite(Date.parse(message.createdAt)) ? message.createdAt : new Date().toISOString(),
      requestId: typeof message.requestId === "string" ? message.requestId.slice(0, 240) : null,
      data: isRecord(message.data) || Array.isArray(message.data) ? sanitizeStructuredValue(message.data) : null,
      citationSources,
      webSources,
      webFallbackStatus: ["off", "armed", "not-needed", "searching", "used", "failed"].includes(message.webFallbackStatus)
        ? message.webFallbackStatus
        : "off",
      conversationMemory,
      retrievalTrace,
      approach,
      usage,
      responseProfile: ["fast", "balanced", "deep"].includes(message.responseProfile) ? message.responseProfile : "balanced",
      durationMs: Number.isFinite(message.durationMs) ? Math.max(0, Math.min(Math.round(message.durationMs), 315_000)) : null,
      incomplete: message.incomplete === true,
      truncated: message.truncated === true,
    }];
  });

const BOARD_TOOLS = new Set(["pen", "marker", "eraser", "line", "rectangle", "ellipse", "arrow", "text", "sticky"]);
export const normalizeBoardStrokes = (value) => (Array.isArray(value) ? value : [])
  .slice(0, 5_000)
  .filter((stroke) => isRecord(stroke) && Array.isArray(stroke.points))
  .map((stroke) => ({
    id: typeof stroke.id === "string" ? stroke.id.slice(0, 200) : createId(),
    tool: BOARD_TOOLS.has(stroke.tool) ? stroke.tool : "pen",
    color: typeof stroke.color === "string" && /^#[0-9a-f]{3,8}$/i.test(stroke.color) ? stroke.color : "#17283e",
    fill: typeof stroke.fill === "string" && /^#[0-9a-f]{3,8}$/i.test(stroke.fill) ? stroke.fill : "#fff1a8",
    width: Math.max(0.5, Math.min(100, Number(stroke.width) || 3)),
    fontSize: Math.max(12, Math.min(72, Number(stroke.fontSize) || 24)),
    text: typeof stroke.text === "string" ? stroke.text.slice(0, 10_000) : "",
    // Locked objects stay selectable but refuse mutation (BOARD-001).
    locked: stroke.locked === true,
    points: stroke.points
      .slice(0, 20_000)
      .filter((point) => isRecord(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      .map((point) => ({ x: Math.max(0, Math.min(1, Number(point.x))), y: Math.max(0, Math.min(1, Number(point.y))) })),
  }))
  .filter((stroke) => stroke.points.length);

export const normalizeBoardDocument = (value) => {
  const fallbackPage = { id: createId(), name: "Page 1", objects: normalizeBoardStrokes(Array.isArray(value) ? value : []) };
  if (!isRecord(value) || !Array.isArray(value.pages)) return {
    version: 2,
    activePageId: fallbackPage.id,
    background: "grid",
    pages: [fallbackPage],
    syncMeta: { revision: 0, updatedAt: "", writerId: "", conflicts: [] },
  };
  const seen = new Set();
  // The editor ordinarily caps a board at 20 pages. A slightly wider storage
  // bound allows two tabs that each add the twentieth page concurrently to be
  // merged without silently discarding either page.
  const pages = value.pages.slice(0, 40).filter((page) => isRecord(page)).map((page, index) => {
    let id = typeof page.id === "string" && page.id && !seen.has(page.id) ? page.id.slice(0, 200) : createId();
    if (seen.has(id)) id = createId();
    seen.add(id);
    return {
      id,
      name: typeof page.name === "string" && page.name.trim() ? page.name.trim().slice(0, 60) : `Page ${index + 1}`,
      objects: normalizeBoardStrokes(page.objects || page.strokes),
    };
  });
  if (!pages.length) pages.push(fallbackPage);
  return {
    version: 2,
    activePageId: pages.some((page) => page.id === value.activePageId) ? value.activePageId : pages[0].id,
    background: ["grid", "dots", "plain"].includes(value.background) ? value.background : "grid",
    pages,
    syncMeta: {
      revision: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(value.syncMeta?.revision) || 0))),
      updatedAt: typeof value.syncMeta?.updatedAt === "string" && Number.isFinite(Date.parse(value.syncMeta.updatedAt)) ? value.syncMeta.updatedAt : "",
      writerId: typeof value.syncMeta?.writerId === "string" ? value.syncMeta.writerId.slice(0, 200) : "",
      conflicts: (Array.isArray(value.syncMeta?.conflicts) ? value.syncMeta.conflicts : []).slice(-100).flatMap((conflict) => {
        if (!isRecord(conflict) || typeof conflict.id !== "string" || typeof conflict.kind !== "string") return [];
        return [{
          id: conflict.id.slice(0, 200),
          kind: conflict.kind.slice(0, 80),
          pageId: typeof conflict.pageId === "string" ? conflict.pageId.slice(0, 200) : "",
          objectId: typeof conflict.objectId === "string" ? conflict.objectId.slice(0, 200) : "",
          preservedId: typeof conflict.preservedId === "string" ? conflict.preservedId.slice(0, 200) : "",
          detectedAt: typeof conflict.detectedAt === "string" && Number.isFinite(Date.parse(conflict.detectedAt)) ? conflict.detectedAt : "",
        }];
      }),
    },
  };
};

export const normalizeProfile = (value) => {
  const input = isRecord(value) ? value : {};
  const rawSettings = isRecord(input.settings) ? input.settings : {};
  const numberWithin = (candidate, minimum, maximum, fallback) => {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
  };
  const seenCustomIds = new Set();
  const customDocuments = (Array.isArray(input.customDocuments) ? input.customDocuments : [])
    .filter((doc) => {
      if (!isRecord(doc) || typeof doc.id !== "string" || !doc.id.startsWith("custom/") || typeof doc.raw !== "string" || seenCustomIds.has(doc.id)) return false;
      seenCustomIds.add(doc.id);
      return true;
    })
    .slice(0, 500)
    .map((doc) => ({
      id: doc.id,
      title: typeof doc.title === "string" && doc.title.trim() ? doc.title.trim().slice(0, 180) : "Untitled note",
      raw: doc.raw,
      createdAt: typeof doc.createdAt === "string" ? doc.createdAt : new Date().toISOString(),
      updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : (doc.createdAt || new Date().toISOString()),
      tags: uniqueStrings(doc.tags, 20).map((tag) => tag.slice(0, 40)),
      collectionId: typeof doc.collectionId === "string" ? doc.collectionId.slice(0, 200) : "",
      archived: Boolean(doc.archived),
      pinned: Boolean(doc.pinned),
    }));
  const validCustomIds = new Set(customDocuments.map((doc) => doc.id));
  const clippings = (Array.isArray(input.clippings) ? input.clippings : [])
    .filter((clip) => isRecord(clip) && typeof clip.documentId === "string" && typeof clip.text === "string")
    .slice(0, 2_000)
    .map((clip) => ({
      id: typeof clip.id === "string" ? clip.id : createId(),
      documentId: clip.documentId,
      // AI-tutor answers saved to the notebook are ordinary clippings with a
      // declared origin/title so the UI can label them as generated drafts.
      origin: clip.origin === "ai-tutor" ? "ai-tutor" : "",
      title: typeof clip.title === "string" ? clip.title.slice(0, 200) : "",
      text: clip.text.trim().slice(0, 4_000),
      note: typeof clip.note === "string" ? clip.note.slice(0, 4_000) : "",
      pinned: Boolean(clip.pinned),
      anchor: isRecord(clip.anchor) ? {
        quote: typeof clip.anchor.quote === "string" ? clip.anchor.quote.slice(0, 4_000) : "",
        prefix: typeof clip.anchor.prefix === "string" ? clip.anchor.prefix.slice(-160) : "",
        suffix: typeof clip.anchor.suffix === "string" ? clip.anchor.suffix.slice(0, 160) : "",
        start: Math.max(0, Number(clip.anchor.start) || 0),
        end: Math.max(0, Number(clip.anchor.end) || 0),
        headingId: typeof clip.anchor.headingId === "string" ? clip.anchor.headingId.slice(0, 300) : "",
        sourceHash: typeof clip.anchor.sourceHash === "string" ? clip.anchor.sourceHash.slice(0, 100) : "",
      } : null,
      createdAt: typeof clip.createdAt === "string" ? clip.createdAt : new Date().toISOString(),
      updatedAt: typeof clip.updatedAt === "string" ? clip.updatedAt : (clip.createdAt || new Date().toISOString()),
    }))
    .filter((clip) => clip.text);
  const annotations = (Array.isArray(input.annotations) ? input.annotations : [])
    .filter((annotation) => isRecord(annotation) && typeof annotation.documentId === "string" && typeof annotation.quote === "string")
    .slice(0, 5_000)
    .map((annotation) => ({
      id: typeof annotation.id === "string" ? annotation.id.slice(0, 200) : createId(),
      documentId: annotation.documentId.slice(0, 500),
      quote: annotation.quote.trim().slice(0, 4_000),
      prefix: typeof annotation.prefix === "string" ? annotation.prefix.slice(-160) : "",
      suffix: typeof annotation.suffix === "string" ? annotation.suffix.slice(0, 160) : "",
      start: Math.max(0, Number(annotation.start) || 0),
      end: Math.max(0, Number(annotation.end) || 0),
      headingId: typeof annotation.headingId === "string" ? annotation.headingId.slice(0, 300) : "",
      sourceHash: typeof annotation.sourceHash === "string" ? annotation.sourceHash.slice(0, 100) : "",
      color: ["gold", "coral", "teal", "violet"].includes(annotation.color) ? annotation.color : "gold",
      purpose: ["important", "question", "definition", "interview"].includes(annotation.purpose) ? annotation.purpose : "important",
      comment: typeof annotation.comment === "string" ? annotation.comment.slice(0, 4_000) : "",
      tags: uniqueStrings(annotation.tags, 20).map((tag) => tag.slice(0, 40)),
      createdAt: typeof annotation.createdAt === "string" ? annotation.createdAt : new Date().toISOString(),
      updatedAt: typeof annotation.updatedAt === "string" ? annotation.updatedAt : (annotation.createdAt || new Date().toISOString()),
    }))
    .filter((annotation) => annotation.quote);
  const reviewTypes = new Set(["basic", "cloze", "formula", "derivation", "compare", "debugging", "code-output", "production-scenario"]);
  const reviewItems = (Array.isArray(input.reviewItems) ? input.reviewItems : [])
    .filter((item) => isRecord(item) && typeof item.front === "string" && typeof item.back === "string")
    .slice(0, 10_000)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.slice(0, 200) : createId(),
      type: reviewTypes.has(item.type) ? item.type : "basic",
      front: item.front.trim().slice(0, 10_000),
      back: item.back.trim().slice(0, 20_000),
      documentId: typeof item.documentId === "string" ? item.documentId.slice(0, 500) : "",
      sourceAnnotationId: typeof item.sourceAnnotationId === "string" ? item.sourceAnnotationId.slice(0, 200) : "",
      sourceClippingId: typeof item.sourceClippingId === "string" ? item.sourceClippingId.slice(0, 200) : "",
      tags: uniqueStrings(item.tags, 30).map((tag) => tag.slice(0, 40)),
      suspended: Boolean(item.suspended),
      archived: Boolean(item.archived),
      buriedOnDay: typeof item.buriedOnDay === "string" ? item.buriedOnDay.slice(0, 160) : "",
      dueAt: typeof item.dueAt === "string" && Number.isFinite(Date.parse(item.dueAt)) ? item.dueAt : new Date().toISOString(),
      intervalDays: numberWithin(item.intervalDays, 0, 36_500, 0),
      ease: numberWithin(item.ease, 1.3, 3.5, 2.5),
      repetitions: Math.round(numberWithin(item.repetitions, 0, 100_000, 0)),
      reviewCount: Math.round(numberWithin(item.reviewCount, 0, 1_000_000, item.lastReviewedAt ? Math.max(1, Number(item.repetitions) || 0) : 0)),
      lapses: Math.round(numberWithin(item.lapses, 0, 100_000, 0)),
      // FSRS-4.5 opt-in scheduler state; 0/empty means unseeded.
      stability: numberWithin(item.stability, 0, 36_500, 0),
      difficulty: numberWithin(item.difficulty, 0, 10, 0),
      fsrsState: ["", "learning", "review", "relearning"].includes(item.fsrsState) ? item.fsrsState : "",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : (item.createdAt || new Date().toISOString()),
      lastReviewedAt: typeof item.lastReviewedAt === "string" && Number.isFinite(Date.parse(item.lastReviewedAt)) ? item.lastReviewedAt : "",
    }))
    .filter((item) => item.front && item.back);
  const reviewItemIds = new Set(reviewItems.map((item) => item.id));
  const reviewAttempts = (Array.isArray(input.reviewAttempts) ? input.reviewAttempts : [])
    .filter((attempt) => isRecord(attempt) && reviewItemIds.has(attempt.reviewItemId) && ["again", "hard", "good", "easy"].includes(attempt.rating))
    .slice(-50_000)
    .map((attempt) => ({
      id: typeof attempt.id === "string" ? attempt.id.slice(0, 200) : createId(),
      reviewItemId: attempt.reviewItemId,
      rating: attempt.rating,
      elapsedMs: Math.round(numberWithin(attempt.elapsedMs, 0, 3_600_000, 0)),
      reviewedAt: typeof attempt.reviewedAt === "string" ? attempt.reviewedAt : new Date().toISOString(),
      previousDueAt: typeof attempt.previousDueAt === "string" ? attempt.previousDueAt : "",
      nextDueAt: typeof attempt.nextDueAt === "string" ? attempt.nextDueAt : "",
      previousIntervalDays: numberWithin(attempt.previousIntervalDays, 0, 36_500, 0),
      nextIntervalDays: numberWithin(attempt.nextIntervalDays, 0, 36_500, 0),
      confidence: Math.round(numberWithin(attempt.confidence, 1, 5, 3)),
      sessionKind: ["new", "review", "crunch"].includes(attempt.sessionKind) ? attempt.sessionKind : "review",
      sessionKey: typeof attempt.sessionKey === "string" ? attempt.sessionKey.slice(0, 160) : "",
      crunch: Boolean(attempt.crunch),
      previousState: isRecord(attempt.previousState) ? {
        dueAt: typeof attempt.previousState.dueAt === "string" ? attempt.previousState.dueAt : "",
        intervalDays: numberWithin(attempt.previousState.intervalDays, 0, 36_500, 0),
        ease: numberWithin(attempt.previousState.ease, 1.3, 3.5, 2.5),
        repetitions: Math.round(numberWithin(attempt.previousState.repetitions, 0, 100_000, 0)),
        reviewCount: Math.round(numberWithin(attempt.previousState.reviewCount, 0, 1_000_000, 0)),
        lapses: Math.round(numberWithin(attempt.previousState.lapses, 0, 100_000, 0)),
        stability: numberWithin(attempt.previousState.stability, 0, 36_500, 0),
        difficulty: numberWithin(attempt.previousState.difficulty, 0, 10, 0),
        fsrsState: ["", "learning", "review", "relearning"].includes(attempt.previousState.fsrsState) ? attempt.previousState.fsrsState : "",
        lastReviewedAt: typeof attempt.previousState.lastReviewedAt === "string" ? attempt.previousState.lastReviewedAt : "",
        updatedAt: typeof attempt.previousState.updatedAt === "string" ? attempt.previousState.updatedAt : "",
      } : null,
    }));
  const reviewSessions = (Array.isArray(input.reviewSessions) ? input.reviewSessions : [])
    .filter((session) => isRecord(session) && typeof session.id === "string" && /^\d{4}-\d{2}-\d{2}@/.test(session.id))
    .slice(-730)
    .map((session) => ({
      id: session.id.slice(0, 160),
      localDate: typeof session.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(session.localDate) ? session.localDate : session.id.slice(0, 10),
      timeZone: typeof session.timeZone === "string" ? session.timeZone.slice(0, 100) : "UTC",
      newIntroduced: Math.round(numberWithin(session.newIntroduced, 0, 100_000, 0)),
      reviewCompleted: Math.round(numberWithin(session.reviewCompleted, 0, 100_000, 0)),
      crunchCompleted: Math.round(numberWithin(session.crunchCompleted, 0, 100_000, 0)),
      reviewedItemIds: uniqueStrings(session.reviewedItemIds, 10_000).filter((id) => reviewItemIds.has(id)),
      createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString(),
      updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
    }));
  const rawReviewSettings = isRecord(input.reviewSettings) ? input.reviewSettings : {};

  const isoOr = (candidate, fallback) => (typeof candidate === "string" && Number.isFinite(Date.parse(candidate)) ? candidate : fallback);
  const seenIds = () => {
    const seen = new Set();
    return (id) => !seen.has(id) && (seen.add(id), true);
  };
  const freshCollectionIds = seenIds();
  const collections = (Array.isArray(input.collections) ? input.collections : [])
    .filter((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string" && entry.name.trim() && freshCollectionIds(entry.id))
    .slice(0, 100)
    .map((entry) => ({
      id: entry.id.slice(0, 200),
      name: entry.name.trim().slice(0, 60),
      createdAt: isoOr(entry.createdAt, new Date().toISOString()),
      updatedAt: isoOr(entry.updatedAt, isoOr(entry.createdAt, new Date().toISOString())),
    }));
  const freshTrashIds = seenIds();
  const trash = (Array.isArray(input.trash) ? input.trash : [])
    .filter((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.documentId === "string" && typeof entry.raw === "string" && freshTrashIds(entry.id))
    .sort((left, right) => String(right.deletedAt || "").localeCompare(String(left.deletedAt || "")))
    .slice(0, 100)
    .map((entry) => ({
      id: entry.id.slice(0, 200),
      documentId: entry.documentId.slice(0, 500),
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim().slice(0, 180) : "Untitled note",
      raw: entry.raw.slice(0, 2 * 1024 * 1024),
      tags: uniqueStrings(entry.tags, 20).map((tag) => tag.slice(0, 40)),
      collectionId: typeof entry.collectionId === "string" ? entry.collectionId.slice(0, 200) : "",
      deletedAt: isoOr(entry.deletedAt, new Date().toISOString()),
      updatedAt: isoOr(entry.updatedAt, isoOr(entry.deletedAt, new Date().toISOString())),
    }));
  const freshActivityIds = seenIds();
  const activity = (Array.isArray(input.activity) ? input.activity : [])
    .filter((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.kind === "string" && freshActivityIds(entry.id))
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")))
    .slice(0, 500)
    .map((entry) => ({
      id: entry.id.slice(0, 200),
      at: isoOr(entry.at, new Date().toISOString()),
      kind: entry.kind.toLocaleLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "event",
      label: typeof entry.label === "string" ? entry.label.slice(0, 200) : "",
      refId: typeof entry.refId === "string" ? entry.refId.slice(0, 500) : "",
      updatedAt: isoOr(entry.updatedAt, isoOr(entry.at, new Date().toISOString())),
    }));
  const freshRevisionIds = seenIds();
  const perDocumentRevisions = new Map();
  const revisions = (Array.isArray(input.revisions) ? input.revisions : [])
    .filter((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.documentId === "string" && typeof entry.text === "string" && freshRevisionIds(entry.id))
    .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")))
    .filter((entry) => {
      const count = perDocumentRevisions.get(entry.documentId) || 0;
      if (count >= 5) return false;
      perDocumentRevisions.set(entry.documentId, count + 1);
      return true;
    })
    .slice(0, 60)
    .map((entry) => ({
      id: entry.id.slice(0, 200),
      documentId: entry.documentId.slice(0, 500),
      text: entry.text.slice(0, 400_000),
      label: typeof entry.label === "string" ? entry.label.slice(0, 120) : "",
      savedAt: isoOr(entry.savedAt, new Date().toISOString()),
      updatedAt: isoOr(entry.updatedAt, isoOr(entry.savedAt, new Date().toISOString())),
    }));

  return {
    ...initialProfile,
    version: PROFILE_VERSION,
    syncMeta: {
      revision: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(input.syncMeta?.revision) || 0))),
      updatedAt: typeof input.syncMeta?.updatedAt === "string" && Number.isFinite(Date.parse(input.syncMeta.updatedAt)) ? input.syncMeta.updatedAt : "",
      writerId: typeof input.syncMeta?.writerId === "string" ? input.syncMeta.writerId.slice(0, 200) : "",
      generation: typeof input.syncMeta?.generation === "string" ? input.syncMeta.generation.slice(0, 200) : "",
      replacedAt: typeof input.syncMeta?.replacedAt === "string" && Number.isFinite(Date.parse(input.syncMeta.replacedAt)) ? input.syncMeta.replacedAt : "",
      replacementReason: ["reset", "restore"].includes(input.syncMeta?.replacementReason) ? input.syncMeta.replacementReason : "",
      conflicts: (Array.isArray(input.syncMeta?.conflicts) ? input.syncMeta.conflicts : []).slice(-100).flatMap((conflict) => {
        if (!isRecord(conflict) || typeof conflict.id !== "string") return [];
        return [{
          id: conflict.id.slice(0, 240),
          kind: typeof conflict.kind === "string" ? conflict.kind.slice(0, 80) : "concurrent-update",
          collection: typeof conflict.collection === "string" ? conflict.collection.slice(0, 80) : "profile",
          recordId: typeof conflict.recordId === "string" ? conflict.recordId.slice(0, 240) : "",
          preservedRecordId: typeof conflict.preservedRecordId === "string" ? conflict.preservedRecordId.slice(0, 240) : "",
          detectedAt: typeof conflict.detectedAt === "string" && Number.isFinite(Date.parse(conflict.detectedAt)) ? conflict.detectedAt : "",
        }];
      }),
    },
    progress: finiteUnitRecord(input.progress),
    readingPositions: finiteUnitRecord(input.readingPositions || input.progress),
    personalNotes: stringRecord(input.personalNotes, 100_000),
    edits: stringRecord(input.edits, 5 * 1024 * 1024),
    settings: {
      theme: ["system", "paper", "dark", "contrast"].includes(rawSettings.theme) ? rawSettings.theme : initialProfile.settings.theme,
      fontScale: numberWithin(rawSettings.fontScale, 0.85, 1.35, initialProfile.settings.fontScale),
      lineHeight: numberWithin(rawSettings.lineHeight, 1.45, 2, initialProfile.settings.lineHeight),
      contentWidth: ["focused", "comfortable", "wide"].includes(rawSettings.contentWidth) ? rawSettings.contentWidth : initialProfile.settings.contentWidth,
      voiceURI: typeof rawSettings.voiceURI === "string" ? rawSettings.voiceURI.slice(0, 500) : "",
      speechLanguage: typeof rawSettings.speechLanguage === "string" && /^(auto|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(rawSettings.speechLanguage)
        ? rawSettings.speechLanguage.slice(0, 80)
        : initialProfile.settings.speechLanguage,
      speechRate: numberWithin(rawSettings.speechRate, 0.6, 1.6, initialProfile.settings.speechRate),
      speechPitch: numberWithin(rawSettings.speechPitch, 0.7, 1.3, initialProfile.settings.speechPitch),
      speechVolume: numberWithin(rawSettings.speechVolume, 0, 1, initialProfile.settings.speechVolume),
      speechScope: ["sentence", "section", "selection", "document"].includes(rawSettings.speechScope)
        ? rawSettings.speechScope
        : initialProfile.settings.speechScope,
      keepScreenAwake: Boolean(rawSettings.keepScreenAwake),
      dueBadgeEnabled: Boolean(rawSettings.dueBadgeEnabled),
      narrationAutoAdvance: rawSettings.narrationAutoAdvance === true,
      aiFeaturesEnabled: rawSettings.aiFeaturesEnabled !== false,
      aiHistoryRetention: [0, 10, 25, 50].includes(rawSettings.aiHistoryRetention)
        ? rawSettings.aiHistoryRetention
        : initialProfile.settings.aiHistoryRetention,
      savedSearches: [...new Set((Array.isArray(rawSettings.savedSearches) ? rawSettings.savedSearches : [])
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim().slice(0, 120)))].slice(0, 20),
      pronunciations: (Array.isArray(rawSettings.pronunciations) ? rawSettings.pronunciations : [])
        .filter((entry) => isRecord(entry) && typeof entry.term === "string" && typeof entry.spoken === "string" && entry.term.trim() && entry.spoken.trim())
        .map((entry) => ({ term: entry.term.trim().slice(0, 60), spoken: entry.spoken.trim().slice(0, 120) }))
        .slice(0, 50),
    },
    bookmarks: uniqueStrings(input.bookmarks),
    customDocuments,
    deletedCustomDocumentIds: uniqueStrings(input.deletedCustomDocumentIds, 1_000).map((id) => id.slice(0, 500)),
    clippings,
    mistakes: normalizeMistakes(input.mistakes),
    assessments: normalizeAssessments(input.assessments),
    goals: {
      targetParts: [...new Set((Array.isArray(input.goals?.targetParts) ? input.goals.targetParts : [])
        .filter((part) => Number.isInteger(part) && part >= 1 && part <= 23))].slice(0, 23),
      targetDate: typeof input.goals?.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.goals.targetDate) ? input.goals.targetDate : "",
      dailyMinutes: [0, 15, 30, 60].includes(input.goals?.dailyMinutes) ? input.goals.dailyMinutes : 0,
    },
    collections,
    trash,
    activity,
    revisions,
    annotations,
    reviewItems,
    reviewAttempts,
    reviewSessions,
    reviewSettings: {
      scheduler: ["sm2", "fsrs"].includes(rawReviewSettings.scheduler) ? rawReviewSettings.scheduler : "sm2",
      requestRetention: numberWithin(rawReviewSettings.requestRetention, 0.7, 0.97, 0.9),
      dailyNewLimit: Math.round(numberWithin(rawReviewSettings.dailyNewLimit, 1, 100, initialProfile.reviewSettings.dailyNewLimit)),
      dailyReviewLimit: Math.round(numberWithin(rawReviewSettings.dailyReviewLimit, 1, 500, initialProfile.reviewSettings.dailyReviewLimit)),
    },
    backupMeta: {
      lastExportAt: typeof input.backupMeta?.lastExportAt === "string" && Number.isFinite(Date.parse(input.backupMeta.lastExportAt)) ? input.backupMeta.lastExportAt : "",
      lastImportAt: typeof input.backupMeta?.lastImportAt === "string" && Number.isFinite(Date.parse(input.backupMeta.lastImportAt)) ? input.backupMeta.lastImportAt : "",
      lastRecoveryAt: typeof input.backupMeta?.lastRecoveryAt === "string" && Number.isFinite(Date.parse(input.backupMeta.lastRecoveryAt)) ? input.backupMeta.lastRecoveryAt : "",
      lastIntegrity: ["SHA-256", "FNV-1A-64-INSECURE-FALLBACK"].includes(input.backupMeta?.lastIntegrity) ? input.backupMeta.lastIntegrity : "",
    },
    aiTutorHistory: normalizeAiTutorHistory(input.aiTutorHistory),
    aiTutorHistoryTombstones: uniqueStrings(input.aiTutorHistoryTombstones, 1_000).map((id) => id.slice(0, 200)),
    recent: uniqueStrings(input.recent, 50),
    lastDocumentId: typeof input.lastDocumentId === "string" && (input.lastDocumentId.startsWith("notes/") || validCustomIds.has(input.lastDocumentId)) ? input.lastDocumentId : "",
  };
};
