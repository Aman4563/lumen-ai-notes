/**
 * Audio bookmarks (AUDIO-001 slice, issue #17): saved positions inside a
 * document's full-lecture narration queue. Device-local like narration
 * resume positions — media positions are per-device state, not study data —
 * bounded at 100, newest first. The stored snippet lets the learner pick a
 * bookmark by what was being said, and the index seeds `speak`'s startIndex.
 */
const STORAGE_KEY = "lumen-audio-bookmarks-v1";
export const MAX_AUDIO_BOOKMARKS = 100;

const readAll = (storage) => {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAll = (storage, bookmarks) => {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bookmarks.slice(0, MAX_AUDIO_BOOKMARKS)));
  } catch {
    // Quota or private-mode failures never break narration.
  }
};

const normalize = (entry) => ({
  id: String(entry.id || "").slice(0, 80),
  documentId: String(entry.documentId || "").slice(0, 500),
  index: Math.max(0, Math.round(Number(entry.index) || 0)),
  snippet: String(entry.snippet || "").slice(0, 160),
  savedAt: String(entry.savedAt || "").slice(0, 40),
});

export const listAudioBookmarks = (documentId, storage = globalThis.localStorage) => readAll(storage)
  .map(normalize)
  .filter((entry) => entry.documentId === documentId);

export const addAudioBookmark = ({ documentId, index, snippet }, storage = globalThis.localStorage, now = new Date()) => {
  const bookmarks = readAll(storage).map(normalize);
  // One bookmark per (document, sentence): re-bookmarking refreshes it.
  const remaining = bookmarks.filter((entry) => !(entry.documentId === documentId && entry.index === index));
  const entry = normalize({
    id: `ab-${now.getTime().toString(36)}-${index}`,
    documentId,
    index,
    snippet,
    savedAt: now.toISOString(),
  });
  writeAll(storage, [entry, ...remaining]);
  return entry;
};

export const removeAudioBookmark = (id, storage = globalThis.localStorage) => {
  writeAll(storage, readAll(storage).map(normalize).filter((entry) => entry.id !== id));
};
