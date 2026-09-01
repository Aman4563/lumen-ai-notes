import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_RECOVERY_STORAGE_KEY,
  createChunkRecovery,
  isStaleChunkError,
  repairApplicationFiles,
} from "./chunkRecovery.js";

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("recognizes Vite JS and extracted CSS chunk failures without classifying ordinary errors", () => {
  assert.equal(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/Whiteboard-old.js")), true);
  assert.equal(isStaleChunkError(new Error("Unable to preload CSS for http://127.0.0.1/assets/PhoneLocalAiTutor-old.css")), true);
  assert.equal(isStaleChunkError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isStaleChunkError(new TypeError("Load failed")), true);
  assert.equal(isStaleChunkError(new Error("AI cannot be reached")), false);
  assert.equal(isStaleChunkError(new Error("Whiteboard record is malformed")), false);
});

test("schedules only one automatic reload across the same tab and cooldown", () => {
  const storage = makeStorage();
  let reloads = 0;
  let currentTime = 10_000;
  const firstPage = createChunkRecovery({
    storage,
    now: () => currentTime,
    isOnline: () => true,
    reload: () => { reloads += 1; },
  });
  const error = new Error("Failed to fetch dynamically imported module: http://lumen.test/assets/Whiteboard-old.js");

  assert.equal(firstPage.schedule(error), true);
  assert.equal(firstPage.schedule(error), true);
  assert.equal(reloads, 1);

  // A document reload creates a new coordinator but sessionStorage persists.
  const reloadedPage = createChunkRecovery({
    storage,
    now: () => currentTime,
    isOnline: () => true,
    reload: () => { reloads += 1; },
  });
  assert.equal(reloadedPage.schedule(error), false);
  assert.equal(reloads, 1);

  currentTime += 60_001;
  assert.equal(reloadedPage.schedule(error), true);
  assert.equal(reloads, 2);
});

test("does not auto-reload offline or when a durable loop marker cannot be written", () => {
  let reloads = 0;
  const error = new Error("Unable to preload CSS for /assets/PhoneLocalAiTutor-old.css");
  const offline = createChunkRecovery({
    storage: makeStorage(),
    isOnline: () => false,
    reload: () => { reloads += 1; },
  });
  assert.equal(offline.schedule(error), false);

  const blockedStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("blocked"); },
  };
  const storageBlocked = createChunkRecovery({
    storage: blockedStorage,
    isOnline: () => true,
    reload: () => { reloads += 1; },
  });
  assert.equal(storageBlocked.schedule(error), false);
  assert.equal(reloads, 0);
});

test("a successful recoverable import clears a prior recovery marker", async () => {
  const storage = makeStorage();
  storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, JSON.stringify({ attemptedAt: 123, asset: "old" }));
  const recovery = createChunkRecovery({ storage });
  const loaded = { default: () => null };

  assert.equal(await recovery.load(async () => loaded), loaded);
  assert.equal(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY), null);
});

test("a repeated stale failure rejects to the error boundary instead of reloading again", async () => {
  const storage = makeStorage();
  storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, JSON.stringify({ attemptedAt: 5_000, asset: "old" }));
  let reloads = 0;
  const recovery = createChunkRecovery({
    storage,
    now: () => 5_100,
    isOnline: () => true,
    reload: () => { reloads += 1; },
  });
  const error = new Error("Failed to fetch dynamically imported module: /assets/Whiteboard-old.js");

  await assert.rejects(() => recovery.load(async () => { throw error; }), error);
  assert.equal(reloads, 0);
});

test("manual repair verifies the server, removes only Lumen app caches, updates the worker, and reloads", async () => {
  const storage = makeStorage();
  const deleted = [];
  const messages = [];
  let updated = 0;
  let reloads = 0;
  let probe;
  await repairApplicationFiles({
    cacheStorage: {
      keys: async () => ["lumen-ai-notes-vlegacy-10", "lumen-ai-notes-vrelease-2", "webllm/model", "another-app"],
      delete: async (key) => { deleted.push(key); return true; },
    },
    fetchImpl: async (url, options) => {
      probe = { url: String(url), options };
      return { ok: true, status: 200, headers: { get: () => "text/html; charset=utf-8" } };
    },
    location: { href: "https://lumen.test/app/#/ai", reload: () => { reloads += 1; } },
    navigatorObject: {
      onLine: true,
      serviceWorker: {
        getRegistration: async () => ({
          update: async () => { updated += 1; },
          waiting: { postMessage: (message) => messages.push(message) },
        }),
      },
    },
    storage,
    now: () => 44,
  });

  assert.deepEqual(deleted, ["lumen-ai-notes-vlegacy-10", "lumen-ai-notes-vrelease-2"]);
  assert.match(probe.url, /^https:\/\/lumen\.test\/app\/\?lumen-repair=44$/);
  assert.deepEqual(probe.options, { cache: "no-store", credentials: "same-origin" });
  assert.equal(updated, 1);
  assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(reloads, 1);
  assert.deepEqual(JSON.parse(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY)), { attemptedAt: 44, asset: "manual-repair" });
});

test("manual repair preserves cached offline files when the server probe fails", async () => {
  let cacheReads = 0;
  let reloads = 0;
  await assert.rejects(() => repairApplicationFiles({
    cacheStorage: { keys: async () => { cacheReads += 1; return []; }, delete: async () => true },
    fetchImpl: async () => { throw new Error("server unavailable"); },
    location: { href: "https://lumen.test/#/board/notes", reload: () => { reloads += 1; } },
    navigatorObject: { onLine: true },
  }), /server unavailable/);
  assert.equal(cacheReads, 0);
  assert.equal(reloads, 0);
});

test("manual repair refuses to remove offline files while the browser is offline", async () => {
  let fetched = 0;
  await assert.rejects(() => repairApplicationFiles({
    fetchImpl: async () => { fetched += 1; },
    location: { href: "https://lumen.test/", reload: () => assert.fail("must not reload") },
    navigatorObject: { onLine: false },
  }), /Connect to the Lumen server/);
  assert.equal(fetched, 0);
});
