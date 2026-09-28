/**
 * Full-lecture narration positions (AUDIO-001, issue #96): where narration
 * stopped in each lecture on this device. Media positions are per-device
 * state, not study data, so they live in localStorage and never sync.
 *
 * A position is `{v: 2, index, total, snippet, section}`: the queue index,
 * the queue length, the first 60 characters of that chunk, and the label of
 * its section. The snippet and section find the place again when an edit,
 * a pronunciation override or a new chunking rule shifts the indices.
 * Version 1 stored the bare index as a string; it is read as `{index}`.
 *
 * Storage is resolved inside `try`: the accessor itself throws where storage
 * is blocked, and a full store throws on write. Every call then returns null
 * instead of breaking the Reader.
 */
const KEY_PREFIX = "lumen-narration-";
export const POSITION_SNIPPET_LENGTH = 60;

const storageFor = (storage) => (storage === undefined ? globalThis.localStorage : storage);

const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

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
  try {
    const value = normalizePosition(position && typeof position === "object" ? position : null);
    if (!value) return null;
    storageFor(storage).setItem(`${KEY_PREFIX}${documentId}`, JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
};

export const clearPosition = (documentId, storage) => {
  try {
    storageFor(storage).removeItem(`${KEY_PREFIX}${documentId}`);
    return true;
  } catch {
    return null;
  }
};

/**
 * Finds a saved position in a freshly built queue. In order: the chunk at
 * `index` still starts with the snippet; the nearest chunk that starts with
 * it; the start of the saved section; otherwise the beginning, reported as
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
  if (!snippet) return usable(saved.index) ? { index: saved.index, how: "index" } : { index: 0, how: "changed" };
  const matches = (index) => usable(index) && queue[index].startsWith(snippet);
  if (matches(saved.index)) return { index: saved.index, how: "exact" };
  let nearest = -1;
  queue.forEach((_, index) => {
    if (matches(index) && (nearest < 0 || Math.abs(index - saved.index) < Math.abs(nearest - saved.index))) nearest = index;
  });
  if (nearest >= 0) return { index: nearest, how: "snippet" };
  const section = saved.section ? sectionStarts.find((start) => start.label === saved.section) : null;
  if (section && usable(section.index)) return { index: section.index, how: "section" };
  return { index: 0, how: "changed" };
};
