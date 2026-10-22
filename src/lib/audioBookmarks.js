import { durableLocalStorage, guardStorage } from "./safeStorage.js";

/**
 * Audio bookmarks (AUDIO-001 slice, issue #17): saved positions inside a
 * document's full-lecture narration queue. Device-local like narration
 * resume positions — media positions are per-device state, not study data —
 * bounded at 100, newest first. The stored snippet lets the learner pick a
 * bookmark by what was being said. Since issue #96 a bookmark also keeps the
 * queue length and its section label, so `locatePosition` in
 * narrationPositions.js finds it again after an edit shifts the indices.
 *
 * Storage goes through safeStorage.js (issue #139), which resolves it inside
 * `try`. The durable store keeps no memory copy: where storage is blocked or
 * full the list is empty and saving reports failure instead of breaking the
 * Reader. An injected `storage` is guarded the same way.
 */
const STORAGE_KEY = "lumen-audio-bookmarks-v1";
export const MAX_AUDIO_BOOKMARKS = 100;

const storageFor = (storage) => (storage === undefined ? durableLocalStorage : guardStorage(storage));

const readAll = (storage) => {
  try {
    const parsed = JSON.parse(storageFor(storage).getItem(STORAGE_KEY) || "[]");
    // Entries that are not objects (a hand-edited or damaged store) are dropped.
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
};

// Quota or private-mode failures return false and never break narration.
const writeAll = (storage, bookmarks) => storageFor(storage).setItem(STORAGE_KEY, JSON.stringify(bookmarks.slice(0, MAX_AUDIO_BOOKMARKS)));

const count = (value) => Math.max(0, Math.round(Number(value) || 0));

const normalize = (entry) => ({
  id: String(entry.id || "").slice(0, 80),
  documentId: String(entry.documentId || "").slice(0, 500),
  // Version 2 entries carry the position fields locatePosition reads.
  v: entry.v === 2 ? 2 : 1,
  index: count(entry.index),
  total: count(entry.total),
  snippet: String(entry.snippet || "").slice(0, 160),
  section: String(entry.section || "").slice(0, 80),
  savedAt: String(entry.savedAt || "").slice(0, 40),
});

export const listAudioBookmarks = (documentId, storage) => readAll(storage)
  .map(normalize)
  .filter((entry) => entry.documentId === documentId);

/** Saves a bookmark and returns it, or null when this device could not store it. */
export const addAudioBookmark = ({ documentId, index, total, snippet, section }, storage, now = new Date()) => {
  const bookmarks = readAll(storage).map(normalize);
  // One bookmark per (document, sentence): re-bookmarking refreshes it.
  const remaining = bookmarks.filter((entry) => !(entry.documentId === documentId && entry.index === index));
  const entry = normalize({
    id: `ab-${now.getTime().toString(36)}-${index}`,
    documentId,
    v: 2,
    index,
    total,
    snippet,
    section,
    savedAt: now.toISOString(),
  });
  return writeAll(storage, [entry, ...remaining]) ? entry : null;
};

export const removeAudioBookmark = (id, storage) => {
  writeAll(storage, readAll(storage).map(normalize).filter((entry) => entry.id !== id));
};
