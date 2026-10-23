import assert from "node:assert/strict";
import test from "node:test";
import { cleanupFailureMessage, OfflineCleanupError, STORAGE_FAILURE_COPY, storageErrorName, storageFailureKind } from "./storageFailure.js";

// Chrome's own words for a Cache Storage call under its cookie blocking (#147).
const CHROME_REFUSAL = "Failed to execute 'keys' on 'CacheStorage': An attempt was made to break through the security policy of the user agent.";
const RAW_WORDS = /Error|Exception|CacheStorage|StorageManager|Failed to execute|security policy/;

test("refused storage is blocked, a full store is full, and anything else is unknown", () => {
  assert.equal(storageFailureKind(new DOMException(CHROME_REFUSAL, "SecurityError")), "blocked");
  assert.equal(storageFailureKind(new DOMException("Permission denied.", "NotAllowedError")), "blocked");
  assert.equal(storageFailureKind(new DOMException("The quota has been exceeded.", "QuotaExceededError")), "full");
  for (const error of [new DOMException("The user denied permission to access the database.", "UnknownError"), new DOMException("The database connection is closing.", "InvalidStateError"), new TypeError("Failed to fetch"), new Error("SecurityError"), "SecurityError", undefined, null, {}, { name: 42 }]) {
    assert.equal(storageFailureKind(error), "unknown", `${error && typeof error === "object" ? error.name : String(error)} was not unknown`);
  }
});

test("an error name is kept only as a short identifier, and reading it never throws", () => {
  assert.equal(storageErrorName(new DOMException(CHROME_REFUSAL, "SecurityError")), "SecurityError");
  assert.equal(storageErrorName(new TypeError("Failed to fetch")), "TypeError");
  assert.equal(storageErrorName(new OfflineCleanupError("Offline files were kept.")), "OfflineCleanupError");
  const hostile = { get name() { throw new Error("boom"); } };
  for (const value of [hostile, { name: "<img src=x onerror=alert(1)>" }, { name: "Security Error" }, { name: "" }, { name: "x".repeat(65) }, { name: "9Lives" }, "SecurityError", undefined, null]) {
    assert.equal(storageErrorName(value), "Error");
  }
  assert.equal(storageFailureKind(hostile), "unknown");
});

test("each message is the plain copy that says what still works and what does not", () => {
  assert.deepEqual(STORAGE_FAILURE_COPY, {
    blocked: { title: "This browser is not saving offline files on this device", detail: "Reading online works as usual during this visit, but lectures will not open offline, and downloads such as the On-device Lite model are not saved." },
    full: { title: "This browser has no room for more offline files", detail: "Reading online works as usual during this visit, but new lectures may not open offline, and downloads such as the On-device Lite model may not be saved. Free up space on this device to make room." },
    unknown: { title: "Storage details are unavailable right now", detail: "Reading online works as usual during this visit, but lectures may not open offline, and downloads such as the On-device Lite model may not be saved." },
  });
  assert.ok(Object.isFrozen(STORAGE_FAILURE_COPY));
  for (const copy of Object.values(STORAGE_FAILURE_COPY)) {
    assert.ok(Object.isFrozen(copy));
    assert.doesNotMatch(`${copy.title} ${copy.detail}`, RAW_WORDS);
    // The #139 audit counts every status region that carries this title.
    assert.ok(!copy.title.includes("not saving preferences"));
  }
});

test("a cleanup failure shows authored words or a fixed sentence, never the browser's", () => {
  assert.equal(cleanupFailureMessage(new OfflineCleanupError("The server could not be reached. Offline files were kept."), 0), "Optional cache cleanup failed: The server could not be reached. Offline files were kept.");
  for (const error of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"), new DOMException(CHROME_REFUSAL, "SecurityError"), new Error("internal detail"), "boom", undefined]) {
    assert.equal(cleanupFailureMessage(error, 0), "Optional cache cleanup failed. Offline files were kept.");
  }
  assert.equal(cleanupFailureMessage(new TypeError("Failed to fetch"), 1), "Optional cache cleanup stopped after removing 1 optional cached asset. Open a lecture to download it again.");
  assert.equal(cleanupFailureMessage(new DOMException(CHROME_REFUSAL, "SecurityError"), 3), "Optional cache cleanup stopped after removing 3 optional cached assets. Open a lecture to download it again.");
  for (const removed of [-1, Number.NaN, 1.5, "2", undefined]) {
    assert.equal(cleanupFailureMessage(new TypeError("Failed to fetch"), removed), "Optional cache cleanup failed. Offline files were kept.");
  }
});
