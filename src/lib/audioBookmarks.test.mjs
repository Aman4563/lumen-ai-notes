import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_AUDIO_BOOKMARKS, addAudioBookmark, listAudioBookmarks, removeAudioBookmark } from "./audioBookmarks.js";

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
};

test("audio bookmarks save per document, dedupe per sentence, and stay bounded", () => {
  const storage = memoryStorage();
  const now = new Date("2026-09-02T12:00:00.000Z");
  addAudioBookmark({ documentId: "doc-a", index: 5, snippet: "the learning rate controls" }, storage, now);
  addAudioBookmark({ documentId: "doc-b", index: 2, snippet: "other doc" }, storage, now);
  addAudioBookmark({ documentId: "doc-a", index: 9, snippet: "momentum damps oscillation" }, storage, new Date(now.getTime() + 1000));

  const forA = listAudioBookmarks("doc-a", storage);
  assert.equal(forA.length, 2);
  assert.equal(forA[0].index, 9, "newest first");
  assert.equal(listAudioBookmarks("doc-b", storage).length, 1);

  // Re-bookmarking the same sentence refreshes instead of duplicating.
  addAudioBookmark({ documentId: "doc-a", index: 5, snippet: "updated snippet" }, storage, new Date(now.getTime() + 2000));
  const refreshed = listAudioBookmarks("doc-a", storage);
  assert.equal(refreshed.length, 2);
  assert.equal(refreshed[0].snippet, "updated snippet");

  const [victim] = refreshed;
  removeAudioBookmark(victim.id, storage);
  assert.equal(listAudioBookmarks("doc-a", storage).length, 1);

  for (let index = 0; index < MAX_AUDIO_BOOKMARKS + 20; index += 1) {
    addAudioBookmark({ documentId: "doc-c", index, snippet: `s${index}` }, storage, new Date(now.getTime() + 3000 + index));
  }
  assert.ok(listAudioBookmarks("doc-c", storage).length <= MAX_AUDIO_BOOKMARKS, "the store is bounded");

  const hostile = memoryStorage();
  hostile.setItem("lumen-audio-bookmarks-v1", "{not json");
  assert.deepEqual(listAudioBookmarks("doc-a", hostile), [], "corrupt storage degrades to empty");
  // Entries that are not objects are dropped instead of throwing in the Reader.
  hostile.setItem("lumen-audio-bookmarks-v1", JSON.stringify([null, 5, "x", { id: "ab-1", documentId: "doc-a", index: 4, snippet: "kept" }]));
  assert.deepEqual(listAudioBookmarks("doc-a", hostile).map((entry) => entry.snippet), ["kept"], "corrupt entries degrade to the valid ones");
  assert.ok(addAudioBookmark({ documentId: "doc-a", index: 7, total: 9, snippet: "new", section: "" }, hostile), "a store with corrupt entries still saves");
  assert.equal(listAudioBookmarks("doc-a", hostile).length, 2);
});

// Issue #96 (AM9): where storage is blocked, reading the localStorage accessor
// itself throws. Main read it in a default parameter, outside the guard.
test("a throwing storage accessor lists no bookmarks and saves none, without throwing", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" }); },
  });
  try {
    assert.deepEqual(listAudioBookmarks("doc-a"), []);
    assert.equal(addAudioBookmark({ documentId: "doc-a", index: 3, snippet: "a sentence" }), null, "a bookmark that could not be stored is reported as not saved");
    assert.doesNotThrow(() => removeAudioBookmark("ab-1"));
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }

  const full = { getItem: () => null, setItem: () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); } };
  assert.equal(addAudioBookmark({ documentId: "doc-a", index: 3, snippet: "a sentence" }, full), null);
});

test("bookmarks keep the queue length and section that relocate them", () => {
  const storage = memoryStorage();
  const saved = addAudioBookmark({ documentId: "doc-a", index: 12, total: 107, snippet: "Momentum damps oscillation.", section: "4. Learning as objective optimization" }, storage, new Date("2026-09-28T09:00:00.000Z"));
  assert.deepEqual(listAudioBookmarks("doc-a", storage), [saved]);
  assert.equal(saved.v, 2);
  assert.equal(saved.total, 107);
  assert.equal(saved.section, "4. Learning as objective optimization");
  const legacy = memoryStorage();
  legacy.setItem("lumen-audio-bookmarks-v1", JSON.stringify([{ id: "ab-old", documentId: "doc-a", index: 5, snippet: "old", savedAt: "2026-09-02T12:00:00.000Z" }]));
  assert.deepEqual(listAudioBookmarks("doc-a", legacy).map(({ v, index, total, section }) => ({ v, index, total, section })), [{ v: 1, index: 5, total: 0, section: "" }], "a version 1 bookmark still lists");
});

// Issue #100: a bookmark also names the block and offset of its sentence, so
// it is found again by where it is when the words were reworded.
test("bookmarks keep the block and offset of their sentence", () => {
  const storage = memoryStorage();
  const now = new Date("2026-10-26T09:00:00.000Z");
  const saved = addAudioBookmark({ documentId: "doc-a", index: 12, total: 107, snippet: "Row 2. Situation: High latency", section: "6. Task taxonomy", blockIndex: 3, start: 40 }, storage, now);
  assert.equal(saved.blockIndex, 3);
  assert.equal(saved.start, 40);
  assert.deepEqual(listAudioBookmarks("doc-a", storage), [saved], "both fields list back");
  // The first block and the first offset are places too.
  const first = addAudioBookmark({ documentId: "doc-a", index: 0, total: 107, snippet: "Title.", section: "", blockIndex: 0, start: 0 }, storage, new Date(now.getTime() + 1000));
  assert.deepEqual(first && [first.blockIndex, first.start], [0, 0]);
  // One saved without them lists without them (and has no such keys).
  const bare = addAudioBookmark({ documentId: "doc-a", index: 20, total: 107, snippet: "A sentence.", section: "" }, storage, new Date(now.getTime() + 2000));
  assert.equal("blockIndex" in bare || "start" in bare, false);
  assert.deepEqual(listAudioBookmarks("doc-a", storage).find((entry) => entry.index === 20), bare);
  // A bookmark stored before issue #100, and damaged coordinates, list without them.
  const stored = memoryStorage();
  stored.setItem("lumen-audio-bookmarks-v1", JSON.stringify([
    { id: "ab-old", documentId: "doc-a", v: 2, index: 5, total: 9, snippet: "old", section: "", savedAt: "2026-09-28T09:00:00.000Z" },
    { id: "ab-half", documentId: "doc-a", v: 2, index: 6, total: 9, snippet: "half", section: "", blockIndex: 2, savedAt: "2026-09-28T09:00:00.000Z" },
    { id: "ab-bad", documentId: "doc-a", v: 2, index: 7, total: 9, snippet: "bad", section: "", blockIndex: -1, start: 1.5, savedAt: "2026-09-28T09:00:00.000Z" },
    { id: "ab-new", documentId: "doc-a", v: 2, index: 8, total: 9, snippet: "new", section: "", blockIndex: 4, start: 17, savedAt: "2026-09-28T09:00:00.000Z" },
  ]));
  const listed = listAudioBookmarks("doc-a", stored);
  assert.deepEqual(listed.map((entry) => ["blockIndex" in entry, "start" in entry]), [[false, false], [false, false], [false, false], [true, true]]);
  assert.deepEqual(listed.at(-1), { id: "ab-new", documentId: "doc-a", v: 2, index: 8, total: 9, snippet: "new", section: "", savedAt: "2026-09-28T09:00:00.000Z", blockIndex: 4, start: 17 });
  // Re-bookmarking the sentence refreshes it with its new place.
  const again = addAudioBookmark({ documentId: "doc-a", index: 12, total: 110, snippet: "Row 2. Situation: High latency", section: "6. Task taxonomy", blockIndex: 4, start: 40 }, storage, new Date(now.getTime() + 3000));
  assert.equal(listAudioBookmarks("doc-a", storage).filter((entry) => entry.index === 12).length, 1);
  assert.deepEqual(listAudioBookmarks("doc-a", storage)[0], again);
});
