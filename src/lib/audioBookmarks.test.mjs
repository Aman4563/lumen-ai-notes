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
