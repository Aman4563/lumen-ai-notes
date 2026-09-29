import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  checkDeviceStorage,
  createSafeStorage,
  deviceStorageSaves,
  durableLocalStorage,
  durableSessionStorage,
  guardStorage,
  safeLocalStorage,
  safeSessionStorage,
  subscribeDeviceStorage,
} from "./safeStorage.js";

const memoryStore = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    raw: map,
  };
};
const securityError = () => Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
const quotaError = () => Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });

// Replaces globalThis[name] for the callback: `get` is the accessor, so a
// throwing `get` reproduces storage blocked by policy or a private mode.
const withStorageGlobal = (name, get, callback) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, get });
  try {
    return callback();
  } finally {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  }
};

// Runs first: nothing has failed yet in this process.
test("a working store reads and writes through, and the probe leaves nothing behind", () => {
  const local = memoryStore();
  const session = memoryStore();
  withStorageGlobal("localStorage", () => local, () => withStorageGlobal("sessionStorage", () => session, () => {
    assert.equal(safeLocalStorage.setItem("lumen.test", "a"), true);
    assert.equal(local.raw.get("lumen.test"), "a", "the browser store holds the value");
    assert.equal(safeLocalStorage.getItem("lumen.test"), "a");
    local.raw.set("lumen.test", "from another tab");
    assert.equal(safeLocalStorage.getItem("lumen.test"), "from another tab", "a working store is read, not a memory copy");
    assert.equal(safeLocalStorage.removeItem("lumen.test"), true);
    assert.equal(safeLocalStorage.getItem("lumen.test"), null);
    assert.equal(durableSessionStorage.setItem("lumen.tab", "1"), true);
    assert.equal(session.raw.get("lumen.tab"), "1");
    assert.equal(safeLocalStorage.getItem("never-set"), null);

    assert.equal(checkDeviceStorage(), true);
    assert.equal(local.raw.size, 0, "the probe key was removed");
    assert.equal(deviceStorageSaves(), true);
  }));
});

test("an injected store keeps the contract: null or a throwing store never throws", () => {
  for (const store of [guardStorage(null), guardStorage(undefined), guardStorage({})]) {
    assert.equal(store.getItem("key"), null);
    assert.equal(store.setItem("key", "value"), false);
    assert.equal(store.removeItem("key"), false);
  }
  const throwing = guardStorage({
    getItem: () => { throw securityError(); },
    setItem: () => { throw quotaError(); },
    removeItem: () => { throw securityError(); },
  });
  assert.equal(throwing.getItem("key"), null);
  assert.equal(throwing.setItem("key", "value"), false, "a refused write is reported, not remembered");
  assert.equal(throwing.getItem("key"), null);
  assert.equal(throwing.removeItem("key"), false);
  const working = memoryStore();
  assert.equal(guardStorage(working).setItem("key", 5), true);
  assert.equal(working.raw.get("key"), "5", "values are stored as strings");
  assert.equal(deviceStorageSaves(), true, "an injected store never changes the device status");
});

test("a throwing accessor: preferences last the session, durable writes report failure", () => {
  const events = [];
  const unsubscribe = subscribeDeviceStorage(() => events.push(deviceStorageSaves()));
  try {
    withStorageGlobal("localStorage", () => { throw securityError(); }, () => {
      assert.equal(safeLocalStorage.getItem("lumen.ai.engine.v1"), null);
      assert.equal(deviceStorageSaves(), false, "a failed read marks this browser as not saving");
      assert.deepEqual(events, [false], "subscribers hear the change once");

      assert.equal(safeLocalStorage.setItem("lumen.ai.engine.v1", "phone-local"), false, "the browser did not store it");
      assert.equal(safeLocalStorage.getItem("lumen.ai.engine.v1"), "phone-local", "the choice holds for this session");
      assert.equal(safeLocalStorage.removeItem("lumen.ai.engine.v1"), false);
      assert.equal(safeLocalStorage.getItem("lumen.ai.engine.v1"), null, "a refused removal still hides the value");

      assert.equal(durableLocalStorage.setItem("lumen-narration-doc", "{}"), false);
      assert.equal(durableLocalStorage.getItem("lumen-narration-doc"), null, "a durable store never reads back a write that did not land");
      assert.equal(durableLocalStorage.removeItem("lumen-narration-doc"), false);
      assert.equal(checkDeviceStorage(), false);
      assert.deepEqual(events, [false], "later failures do not re-notify");
    });
  } finally {
    unsubscribe();
  }
});

// Review round 1: one refused large write (the IndexedDB fallback journal
// over the quota) kept Settings saying "not saving preferences" for the rest
// of the visit, although small preferences still saved.
test("a refused large write marks the status false only until a probe succeeds", () => {
  const events = [];
  const unsubscribe = subscribeDeviceStorage(() => events.push(deviceStorageSaves()));
  const quotaLimited = memoryStore();
  const store = quotaLimited.setItem;
  quotaLimited.setItem = (key, value) => {
    if (String(value).length > 1_000) throw quotaError();
    store(key, value);
  };
  try {
    withStorageGlobal("localStorage", () => quotaLimited, () => {
      assert.equal(checkDeviceStorage(), true, "the probe runs although an earlier access failed");
      assert.equal(deviceStorageSaves(), true, "a successful probe clears the earlier failure");
      events.length = 0;
      assert.equal(durableLocalStorage.setItem("lumen-ai-notes-fallback", "x".repeat(5_000)), false, "the large journal write is refused");
      assert.equal(deviceStorageSaves(), false);
      assert.equal(safeLocalStorage.setItem("lumen.ai.engine.v1", "phone-local"), true, "a small preference still lands");
      assert.equal(checkDeviceStorage(), true, "the probe sees small writes landing");
      assert.equal(deviceStorageSaves(), true, "so the device status recovers");
      assert.deepEqual(events, [false, true], "subscribers hear both changes");
      assert.equal(quotaLimited.raw.has("lumen.storage-probe.v1"), false, "the probe key was removed");
    });
    withStorageGlobal("localStorage", () => { throw securityError(); }, () => {
      assert.equal(checkDeviceStorage(), false, "a blocked store fails the probe");
      assert.equal(deviceStorageSaves(), false);
    });
  } finally {
    unsubscribe();
  }
});

// db.js tells a refused journal read from an empty journal by this value.
test("getItem returns the caller's value only for a refused read", () => {
  const unreadable = Symbol("unreadable");
  withStorageGlobal("localStorage", () => { throw securityError(); }, () => {
    assert.equal(durableLocalStorage.getItem("lumen-ai-notes-fallback", unreadable), unreadable);
    assert.equal(durableLocalStorage.getItem("lumen-ai-notes-fallback"), null, "without one a refused read is null");
  });
  withStorageGlobal("localStorage", () => memoryStore(), () => {
    assert.equal(durableLocalStorage.getItem("lumen-ai-notes-fallback", unreadable), null, "a missing key is null, not unreadable");
  });
  assert.equal(guardStorage({ getItem: () => { throw quotaError(); } }).getItem("key", unreadable), unreadable);
});

test("a full store that also refuses reads: the same fallbacks, with values kept apart per store", () => {
  const refusing = {
    getItem: () => { throw securityError(); },
    setItem: () => { throw quotaError(); },
    removeItem: () => { throw securityError(); },
  };
  withStorageGlobal("sessionStorage", () => refusing, () => {
    assert.equal(safeSessionStorage.setItem("lumen.ai.tutor-draft.v1", "{\"prompt\":\"draft\"}"), false);
    assert.equal(safeSessionStorage.getItem("lumen.ai.tutor-draft.v1"), "{\"prompt\":\"draft\"}");
    assert.equal(durableSessionStorage.getItem("lumen.ai.tutor-draft.v1"), null, "the durable store does not see the session copy");
    assert.equal(durableSessionStorage.setItem("lumen:chunk-recovery-v1", "{}"), false);
    assert.equal(durableSessionStorage.getItem("lumen:chunk-recovery-v1"), null, "a recovery marker that did not land reads as absent");
  });
  // The store recovers: the browser copy wins again once a write lands.
  const local = memoryStore();
  withStorageGlobal("localStorage", () => local, () => {
    assert.equal(safeLocalStorage.setItem("lumen.ai.engine.v1", "mac-local"), true);
    local.raw.set("lumen.ai.engine.v1", "phone-local");
    assert.equal(safeLocalStorage.getItem("lumen.ai.engine.v1"), "phone-local", "a landed write drops the memory copy");
  });
});

test("createSafeStorage looks the store up on every call", () => {
  let current = null;
  const store = createSafeStorage(() => current, { remember: true });
  assert.equal(store.setItem("key", "memory"), false);
  current = memoryStore();
  assert.equal(store.setItem("key", "browser"), true);
  assert.equal(current.raw.get("key"), "browser");
  assert.equal(store.getItem("key"), "browser");
});

// ---------------------------------------------------------------------------
// Issue #139: no code in src/ may touch Web Storage except this helper. A
// default parameter such as `storage = globalThis.localStorage` evaluates the
// accessor outside the function's `try`, which crashed every route.

// Drops comments and keeps strings, so `globalThis["localStorage"]` is still
// caught while prose such as "they live in localStorage" is not.
const stripComments = (source) => {
  let output = "";
  let quote = "";
  let previous = "";
  const regexMayStart = () => previous === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous) || /(?:^|[^\w$.])(?:return|typeof|case|in|of|new|delete|void|throw|yield|await)$/.test(output.trimEnd());
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 1;
      } else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      index = (end === -1 ? source.length : end) - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Keep the comment's line breaks so reported line numbers stay true.
      output += ` ${source.slice(index, stop).replace(/[^\n]/g, "")}`;
      index = stop - 1;
      continue;
    }
    if (char === "/" && regexMayStart()) {
      // A regular expression literal, copied through its closing slash.
      let inClass = false;
      output += char;
      for (index += 1; index < source.length; index += 1) {
        const inner = source[index];
        output += inner;
        if (inner === "\\") {
          output += source[index + 1] ?? "";
          index += 1;
        } else if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if ((inner === "/" && !inClass) || inner === "\n") break;
      }
      previous = "/";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    output += char;
    if (!/\s/.test(char)) previous = char;
  }
  return output;
};

const STORAGE_NAME = /\b(?:localStorage|sessionStorage)\b/;

test("the comment stripper keeps code and strings and drops comments", () => {
  const sample = [
    "// they live in localStorage and never sync",
    "/* sessionStorage is per tab */ const url = \"https://example.com\"; const x = localStorage;",
    "const pattern = /\\/\\//g; const y = globalThis[\"sessionStorage\"]; // trailing localStorage note",
    "const z = a / b; /** a doc comment naming localStorage */",
  ].join("\n");
  const stripped = stripComments(sample);
  assert.match(stripped, /https:\/\/example\.com/, "a URL in a string is not a comment");
  assert.match(stripped, /const x = localStorage;/);
  assert.match(stripped, /globalThis\["sessionStorage"\]/, "bracket access is still found");
  assert.doesNotMatch(stripped, /live in|per tab|trailing|doc comment/);
});

test("no source outside the helper names localStorage or sessionStorage", () => {
  const sourceRoot = new URL("../", import.meta.url);
  const helper = new URL("./safeStorage.js", import.meta.url).href;
  const files = readdirSync(sourceRoot, { recursive: true })
    .filter((name) => /\.(?:js|jsx|mjs)$/.test(name) && !/\.test\.mjs$/.test(name))
    .map((name) => new URL(name, sourceRoot));
  assert.ok(files.length > 50, `expected the app sources, found ${files.length} files`);
  assert.ok(files.some((file) => file.href === helper), "the scan reaches src/lib");
  assert.match(stripComments(readFileSync(new URL(helper), "utf8")), STORAGE_NAME, "the scan would see a direct access");
  const offenders = files
    .filter((file) => file.href !== helper)
    .flatMap((file) => stripComments(readFileSync(file, "utf8")).split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => STORAGE_NAME.test(line))
      .map(({ line, index }) => `src/${file.href.slice(sourceRoot.href.length)}:${index + 1}: ${line.trim().slice(0, 120)}`));
  assert.deepEqual(offenders, [], `use src/lib/safeStorage.js instead of Web Storage directly:\n${offenders.join("\n")}`);
});
