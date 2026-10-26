import { durableLocalStorage, guardStorage } from "./safeStorage.js";

/**
 * Full-lecture narration positions (AUDIO-001, issue #96): where narration
 * stopped in each lecture on this device. Media positions are per-device
 * state, not study data, so they live in localStorage and never sync.
 *
 * A position is `{v: 2, index, total, snippet, section}`: the queue index,
 * the queue length, the first 60 characters of that chunk, and the label of
 * its section. The snippet and section find the place again when an edit,
 * a pronunciation override or a new chunking rule shifts the indices.
 * Since issue #100 it also holds `blockIndex` and `start` when the lecture was
 * narrated by unit: the block of the page (`readableBlocks`) and the offset in
 * that block's text where the sentence starts, so a sentence that is spoken
 * differently now (an override, a new rule) is still found where it is.
 * Version 1 stored the bare index as a string; it is read as `{index}`.
 *
 * Storage goes through safeStorage.js (issue #139), which resolves it inside
 * `try`: the accessor itself throws where storage is blocked, and a full store
 * throws on write. The durable store keeps no memory copy, so a position that
 * could not be stored reads as none, and every call returns null instead of
 * breaking the Reader. An injected `storage` is guarded the same way.
 */
const KEY_PREFIX = "lumen-narration-";
export const POSITION_SNIPPET_LENGTH = 60;

const storageFor = (storage) => (storage === undefined ? durableLocalStorage : guardStorage(storage));

const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

/**
 * The place of a sentence in the page, `{ blockIndex, start }`, when both are
 * whole numbers; `{}` otherwise, since one of them alone names nothing. Spread
 * into a record, it leaves the keys out of those that have no place.
 */
export const unitPlace = (value) => {
  const blockIndex = wholeNumber(value?.blockIndex);
  const start = wholeNumber(value?.start);
  return blockIndex === null || start === null ? {} : { blockIndex, start };
};

export const normalizePosition = (value) => {
  if (typeof value === "number") {
    const index = wholeNumber(value);
    return index === null ? null : { v: 1, index, total: 0, snippet: "", section: "" };
  }
  const index = wholeNumber(value?.index);
  if (index === null) return null;
  return {
    v: 2,
    index,
    total: wholeNumber(value.total) ?? 0,
    snippet: String(value.snippet || "").slice(0, POSITION_SNIPPET_LENGTH),
    section: String(value.section || "").slice(0, 80),
    ...unitPlace(value),
  };
};

export const readPosition = (documentId, storage) => {
  try {
    const raw = storageFor(storage).getItem(`${KEY_PREFIX}${documentId}`);
    return raw === null ? null : normalizePosition(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const writePosition = (documentId, position, storage) => {
  const value = normalizePosition(position && typeof position === "object" ? position : null);
  if (!value) return null;
  return storageFor(storage).setItem(`${KEY_PREFIX}${documentId}`, JSON.stringify(value)) ? value : null;
};

export const clearPosition = (documentId, storage) => (storageFor(storage).removeItem(`${KEY_PREFIX}${documentId}`) ? true : null);

// A queue holds speech's entries (`{ text, … }`, issue #100) or plain strings.
const entryText = (entry) => (typeof entry === "string" ? entry : entry?.text || "");

// The entry that holds the saved place: of the entries of the saved block
// whose range holds the saved offset, the first that starts with the snippet,
// else the first of them. An announcement has the empty range [0, 0) and holds
// offset 0, like the first line of the same block; only the snippet tells
// them apart. -1 for none. Text entries have no unit and are skipped.
const unitEntryIndex = (saved, queue) => {
  if (saved.blockIndex === undefined) return -1;
  let first = -1;
  for (let index = 0; index < queue.length; index += 1) {
    const unit = queue[index]?.unit;
    if (!unit || unit.blockIndex !== saved.blockIndex) continue;
    if (unit.start > saved.start || saved.start >= Math.max(unit.end, unit.start + 1)) continue;
    if (!saved.snippet || entryText(queue[index]).startsWith(saved.snippet)) return index;
    if (first < 0) first = index;
  }
  return first;
};

/**
 * Finds a saved position in a freshly built queue. In order: the entry that
 * holds the saved block and offset (`how: "unit"`), when the snippet or the
 * queue length confirms it (one inserted paragraph shifts every later block,
 * and the coordinates then name another sentence); the chunk at `index` still
 * starts with the snippet; the nearest chunk that starts with it; the saved
 * `index` itself when the queue has the saved length and the same section
 * there (the sentence was reworded in place, as a pronunciation override
 * does); the start of the saved section; otherwise the beginning, reported as
 * `changed`. A version 1 index has no snippet and is only bounds-checked.
 * Resume never lands on the last chunk (a finished lecture clears its
 * position, so one pointing there is stale); `allowLast` lets a bookmark on
 * the closing sentence play it.
 */
export const locatePosition = (position, queue, sectionStarts = [], { allowLast = false } = {}) => {
  const saved = position && typeof position === "object" ? normalizePosition(position) : null;
  if (!saved) return { index: 0, how: "start" };
  const end = queue.length - (allowLast ? 0 : 1);
  const usable = (index) => Number.isInteger(index) && index >= 0 && index < end;
  const { snippet } = saved;
  const placed = unitEntryIndex(saved, queue);
  if (usable(placed) && (!snippet || entryText(queue[placed]).startsWith(snippet) || saved.total === queue.length)) return { index: placed, how: "unit" };
  if (!snippet) return usable(saved.index) ? { index: saved.index, how: "index" } : { index: 0, how: "changed" };
  const matches = (index) => usable(index) && entryText(queue[index]).startsWith(snippet);
  if (matches(saved.index)) return { index: saved.index, how: "exact" };
  let nearest = -1;
  queue.forEach((_, index) => {
    if (matches(index) && (nearest < 0 || Math.abs(index - saved.index) < Math.abs(nearest - saved.index))) nearest = index;
  });
  if (nearest >= 0) return { index: nearest, how: "snippet" };
  const sectionAt = (index) => sectionStarts.filter((start) => start.index <= index).at(-1)?.label || "";
  if (saved.total === queue.length && usable(saved.index) && sectionAt(saved.index) === saved.section) return { index: saved.index, how: "index" };
  const section = saved.section ? sectionStarts.find((start) => start.label === saved.section) : null;
  if (section && usable(section.index)) return { index: section.index, how: "section" };
  return { index: 0, how: "changed" };
};
