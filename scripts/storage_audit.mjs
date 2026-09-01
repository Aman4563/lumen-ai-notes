import assert from "node:assert/strict";

const backing = new Map();
const local = new Map();
let failTransactions = false;
let failOpen = false;
let fullScanRequests = 0;

globalThis.localStorage = {
  getItem: (key) => local.has(key) ? local.get(key) : null,
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: (key) => local.delete(key),
};

const clone = (value) => value === undefined ? undefined : structuredClone(value);

const createTransaction = () => {
  const transaction = { error: null, oncomplete: null, onerror: null, onabort: null };
  let pending = 0;
  let failed = false;
  const request = (operation) => {
    const result = { result: undefined, error: null, onsuccess: null, onerror: null };
    pending += 1;
    queueMicrotask(() => {
      if (failTransactions) {
        if (failed) return;
        failed = true;
        const error = new Error("Injected IndexedDB transaction failure");
        result.error = error;
        transaction.error = error;
        result.onerror?.();
        transaction.onerror?.();
        return;
      }
      result.result = operation();
      result.onsuccess?.();
      pending -= 1;
      if (!pending) queueMicrotask(() => transaction.oncomplete?.());
    });
    return result;
  };
  transaction.objectStore = () => ({
    get: (key) => request(() => clone(backing.get(key))),
    put: (value, key) => request(() => { backing.set(key, clone(value)); return key; }),
    delete: (key) => request(() => backing.delete(key)),
    clear: () => request(() => backing.clear()),
    getAllKeys: () => { fullScanRequests += 1; return request(() => [...backing.keys()]); },
    getAll: () => { fullScanRequests += 1; return request(() => [...backing.values()].map(clone)); },
  });
  return transaction;
};

const database = {
  objectStoreNames: { contains: () => true },
  createObjectStore() {},
  transaction: () => createTransaction(),
  close() {},
};

globalThis.indexedDB = {
  open: () => {
    const request = { result: database, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
    queueMicrotask(() => {
      if (failOpen) {
        request.error = new Error("Injected open failure");
        request.onerror?.();
      } else request.onsuccess?.();
    });
    return request;
  },
};

const db = await import("../src/lib/db.js?storage-audit-main");
await db.setData("profile", { revision: "old", notes: ["old"] });
assert.equal(backing.get("profile").revision, "old");
const scansAfterLedgerMigration = fullScanRequests;
const atomicallyUpdated = await db.updateData("profile", (current) => ({ ...current, revision: "atomic", notes: [...current.notes, "merged"] }));
assert.deepEqual(atomicallyUpdated, { revision: "atomic", notes: ["old", "merged"] }, "atomic update should return the committed transform");
assert.deepEqual(backing.get("profile"), atomicallyUpdated, "atomic update should commit the read/transform/write transaction");
assert.equal(fullScanRequests, scansAfterLedgerMigration, "ordinary autosaves should use the per-record ledger instead of scanning every board");

await db.setData("profile", { syncMeta: { generation: "generation-a" } });
await db.setData("board:guarded", { objects: ["base"] });
const guardedCommit = await db.updateDataGuarded(
  "board:guarded",
  "profile",
  (profile) => profile?.syncMeta?.generation === "generation-a",
  (current) => ({ objects: [...current.objects, "safe"] }),
);
assert.equal(guardedCommit.applied, true, "a board save should commit while its profile generation is current");
assert.deepEqual(backing.get("board:guarded").objects, ["base", "safe"]);
await db.setData("profile", { syncMeta: { generation: "generation-b" } });
const fencedCommit = await db.updateDataGuarded(
  "board:guarded",
  "profile",
  (profile) => profile?.syncMeta?.generation === "generation-a",
  () => ({ objects: ["stale board resurrected after reset"] }),
);
assert.equal(fencedCommit.applied, false, "a stale board save must be rejected after profile replacement");
assert.deepEqual(backing.get("board:guarded").objects, ["base", "safe"], "the rejected save must not mutate the board record");
await db.setData("profile", { revision: "old", notes: ["old"] });

failTransactions = true;
await db.setData("profile", { revision: "new", notes: ["new work"] });
assert.equal(backing.get("profile").revision, "old", "injected outage should leave the old IndexedDB snapshot in place");
assert.match(local.get("lumen-ai-notes-fallback"), /new work/, "failed write must enter the fallback journal");

failTransactions = false;
assert.deepEqual(await db.getData("profile"), { revision: "new", notes: ["new work"] }, "recovery must return the newer fallback snapshot");
assert.equal(backing.get("profile").revision, "new", "recovery must reconcile the journal back into IndexedDB");
assert.equal(JSON.parse(local.get("lumen-ai-notes-fallback")).profile, undefined, "reconciled fallback entry must be removed");

failTransactions = true;
await db.deleteData("profile");
failTransactions = false;
assert.equal((await db.getAllData()).profile, undefined, "a fallback tombstone must hide stale IndexedDB data");
assert.equal(await db.getData("profile"), undefined, "recovery must not resurrect a deleted record");
assert.equal(backing.has("profile"), false, "tombstone recovery must remove the stale IndexedDB record");

failOpen = true;
const retryDb = await import("../src/lib/db.js?storage-audit-retry");
assert.equal(await retryDb.getData("retry-key"), undefined);
failOpen = false;
await retryDb.setData("retry-key", { ok: true });
assert.deepEqual(await retryDb.getData("retry-key"), { ok: true }, "a rejected database-open promise must reset so a later call can recover");

await db.setData("board:removed-by-restore", { pages: ["private old work"] });
failTransactions = true;
await db.replaceAllData({ profile: { revision: "restored", notes: ["imported"] } });
assert.equal(backing.has("board:removed-by-restore"), true, "the injected outage leaves stale database records physically present");
assert.equal((await db.getAllData())["board:removed-by-restore"], undefined, "an authoritative fallback snapshot must hide records omitted by restore");
assert.deepEqual(await db.getData("profile"), { revision: "restored", notes: ["imported"] }, "reads during the outage must use the complete replacement snapshot");
failTransactions = false;
const reconciled = await db.getAllData();
assert.equal(reconciled["board:removed-by-restore"], undefined, "recovery must atomically clear omitted records instead of resurrecting them");
assert.equal(backing.has("board:removed-by-restore"), false, "reconciliation must physically delete records omitted by reset/restore");
assert.deepEqual(backing.get("profile"), { revision: "restored", notes: ["imported"] });

const { MAX_OWNED_DATA_BYTES, StorageBudgetError } = await import("../src/lib/storageBudget.js");
const mebibyte = 1024 * 1024;

await assert.rejects(
  db.replaceAllData({ profile: { raw: "r".repeat(MAX_OWNED_DATA_BYTES) } }),
  (error) => error instanceof StorageBudgetError && error.code === "BYTE_LIMIT",
  "an oversized restore must be rejected before clearing the current workspace",
);
assert.deepEqual(backing.get("profile"), { revision: "restored", notes: ["imported"] }, "a rejected restore must leave the old workspace intact");

await db.replaceAllData({
  profile: { raw: "p".repeat(11 * mebibyte) },
  "board:aggregate": { raw: "b".repeat(8 * mebibyte) },
});
const aggregateBefore = backing.get("board:aggregate");
await assert.rejects(
  db.updateData("board:aggregate", () => ({ raw: "b".repeat(10 * mebibyte) })),
  (error) => error instanceof StorageBudgetError
    && error.code === "BYTE_LIMIT"
    && error.details.bytes > MAX_OWNED_DATA_BYTES,
  "a board autosave must include the profile and every other board in its budget",
);
assert.deepEqual(backing.get("board:aggregate"), aggregateBefore, "a rejected aggregate overshoot must not partially write the board");

failTransactions = true;
await assert.rejects(
  db.replaceAllData({ profile: { raw: "r".repeat(MAX_OWNED_DATA_BYTES) } }),
  (error) => error instanceof StorageBudgetError && error.code === "BYTE_LIMIT",
  "the authoritative fallback restore path must enforce the same byte budget",
);
assert.doesNotMatch(local.get("lumen-ai-notes-fallback"), /lumenAuthoritativeSnapshot/, "a rejected fallback restore must not replace the journal snapshot");
await assert.rejects(
  db.setData("board:aggregate", { raw: "b".repeat(10 * mebibyte) }),
  (error) => error instanceof StorageBudgetError && error.code === "BYTE_LIMIT",
  "the fallback journal must enforce the same aggregate limit",
);
assert.doesNotMatch(local.get("lumen-ai-notes-fallback"), /"raw":"b{1000}/, "a rejected fallback write must not enter the journal");
await db.setData("board:aggregate", { raw: "smaller" });
assert.match(local.get("lumen-ai-notes-fallback"), /smaller/, "a shrinking fallback write should remain available during the outage");
failTransactions = false;
assert.equal((await db.getData("board:aggregate")).raw, "smaller", "an accepted, budgeted fallback write must reconcile to IndexedDB");

const maximumBoardWorkspace = { profile: { compact: true } };
for (let index = 0; index < 250; index += 1) maximumBoardWorkspace[`board:${index}`] = { pages: [] };
await db.replaceAllData(maximumBoardWorkspace);
await assert.rejects(
  db.setData("board:250", { pages: [] }),
  (error) => error instanceof StorageBudgetError
    && error.code === "BOARD_LIMIT"
    && error.details.boardRecords === 251,
  "the 251st durable board must be rejected before it is written",
);
assert.equal(backing.has("board:250"), false);
assert.equal(backing.has("__lumenStorageBudgetLedger"), true, "the database should retain its internal incremental ledger");
const exportedWorkspace = await db.getAllData();
assert.equal(Object.hasOwn(exportedWorkspace, "__lumenStorageBudgetLedger"), false, "internal budget metadata must never leak into backup/export records");
assert.equal(Object.keys(exportedWorkspace).filter((key) => key.startsWith("board:")).length, 250);

// Simulate a pre-budget app version that already stored more than 20 MiB and
// has no ledger. Reads/exports and reductions remain possible; growth does not.
backing.clear();
backing.set("profile", { raw: "l".repeat(MAX_OWNED_DATA_BYTES + 4096) });
local.clear();
const legacyExport = await db.getAllData();
assert.ok(legacyExport.profile.raw.length > MAX_OWNED_DATA_BYTES, "legacy oversized state must remain readable and exportable");
await db.setData("profile", { raw: "l".repeat(MAX_OWNED_DATA_BYTES + 2048) });
const shrunkLegacyLength = backing.get("profile").raw.length;
await assert.rejects(
  db.setData("profile", { raw: "l".repeat(MAX_OWNED_DATA_BYTES + 3072) }),
  (error) => error instanceof StorageBudgetError && error.code === "BYTE_LIMIT",
  "legacy state above the cap must not grow farther",
);
assert.equal(backing.get("profile").raw.length, shrunkLegacyLength);
await db.deleteData("profile");
assert.equal(backing.has("profile"), false, "legacy oversized state must always be removable");

console.log("Storage audit passed: recovery, generation fencing, aggregate byte/board budgets, fallback parity, hidden ledger metadata, and legacy shrink/delete verified.");
