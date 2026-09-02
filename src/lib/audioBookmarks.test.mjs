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
