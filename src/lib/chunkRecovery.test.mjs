import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_RECOVERY_STORAGE_KEY,
  createChunkRecovery,
  isStaleChunkError,
  lectureLoadMessage,
  probeAppServer,
  recentServerProbe,
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

test("manual repair verifies the server, removes only Lumen app caches, unregisters the worker, and reloads", async () => {
  const storage = makeStorage();
  const deleted = [];
  const workerCalls = [];
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
        // update() would not reinstall the same worker URL, and SKIP_WAITING
        // would promote a waiting worker whose cache was just deleted.
        getRegistration: async () => ({
          unregister: async () => { workerCalls.push("unregister"); return true; },
          update: async () => { workerCalls.push("update"); },
          waiting: { postMessage: (message) => workerCalls.push(message.type) },
        }),
      },
    },
    storage,
    now: () => 44,
  });

  assert.deepEqual(deleted, ["lumen-ai-notes-vlegacy-10", "lumen-ai-notes-vrelease-2"]);
  assert.match(probe.url, /^https:\/\/lumen\.test\/app\/\?lumen-repair=44$/);
  assert.deepEqual(probe.options, { cache: "no-store", credentials: "same-origin" });
  assert.deepEqual(workerCalls, ["unregister"]);
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

test("does not spend the reload or cooldown while the app server is unreachable", async () => {
  const storage = makeStorage();
  let reloads = 0;
  let probes = 0;
  let reachable = false;
  let currentTime = 1_000;
  const recovery = createChunkRecovery({
    storage,
    now: () => currentTime,
    isOnline: () => true,
    reload: () => { reloads += 1; },
    probe: async () => { probes += 1; return reachable; },
  });
  const error = new TypeError("Failed to fetch dynamically imported module: http://lumen.test/assets/Reader-new.js");

  // Vite's preload listener and the lazy import both report one failure; they share one probe.
  const [fromListener, fromImport] = await Promise.all([recovery.recover(error), recovery.recover(error)]);
  assert.deepEqual([fromListener, fromImport], [false, false]);
  assert.equal(probes, 1);
  assert.equal(reloads, 0);
  assert.equal(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY), null, "an unreachable probe must not start the reload cooldown");
  assert.equal(recentServerProbe(error, { now: () => currentTime }), false);
  assert.equal(recentServerProbe(error, { now: () => currentTime + 5_001 }), undefined, "an old probe result must not describe a later failure");

  await assert.rejects(() => recovery.load(async () => { throw error; }), error);
  assert.equal(reloads, 0, "the failure reaches the in-shell boundary instead of reloading the cached shell");

  reachable = true;
  currentTime += 10;
  assert.equal(await recovery.recover(error), true);
  assert.equal(reloads, 1);
  assert.equal(recentServerProbe(error, { now: () => currentTime }), true);
  assert.equal(JSON.parse(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY)).attemptedAt, currentTime);
});

test("recovery skips the probe offline, during the cooldown, and for ordinary errors", async () => {
  let probes = 0;
  const storage = makeStorage();
  storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, JSON.stringify({ attemptedAt: 900, asset: "old" }));
  const probe = async () => { probes += 1; return true; };
  const stale = new Error("Unable to preload CSS for /assets/AiTutor-new.css");
  const coolingDown = createChunkRecovery({ storage, now: () => 1_000, isOnline: () => true, reload: () => assert.fail("must not reload"), probe });
  assert.equal(await coolingDown.recover(stale), false);
  const offline = createChunkRecovery({ storage: makeStorage(), isOnline: () => false, reload: () => assert.fail("must not reload"), probe });
  assert.equal(await offline.recover(stale), false);
  const online = createChunkRecovery({ storage: makeStorage(), isOnline: () => true, reload: () => assert.fail("must not reload"), probe });
  assert.equal(await online.recover(new Error("Whiteboard record is malformed")), false);
  assert.equal(probes, 0);
});

test("the server probe bypasses caches and treats any HTTP answer as reachable", async () => {
  let request;
  assert.equal(await probeAppServer({
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: false, status: 404 }; },
    now: () => 7,
  }), true);
  assert.equal(request.url, "/api/health?lumen-probe=7");
  assert.equal(request.options.cache, "no-store");
  assert.equal(await probeAppServer({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), false);
  assert.equal(await probeAppServer({
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 20,
  }), false, "a hung request (a sleeping server on the same Wi-Fi) must count as unreachable");
  assert.equal(await probeAppServer({ fetchImpl: undefined }), false);
});

test("a lecture that cannot be downloaded is explained in plain language", () => {
  const message = lectureLoadMessage("Failed to fetch dynamically imported module: http://127.0.0.1:4173/assets/03-cnns-DFp9kDII.js");
  assert.doesNotMatch(message, /dynamically imported|assets\//);
  assert.match(message, /not saved on this device yet/);
  assert.equal(lectureLoadMessage("The lecture source could not be loaded."), "The lecture source could not be loaded.");
});
