import { createId } from "./id.js";

/**
 * Mistake notebook (LEARN-005): durable records of failed recall with an
 * error category, source links, repeat merging, and corrective scheduling.
 * Records live in the profile (`profile.mistakes`), merge across tabs like
 * other record collections, and travel through backups.
 */
export const MISTAKE_CATEGORIES = Object.freeze([
  { id: "misconception", label: "Misconception" },
  { id: "formula", label: "Formula" },
  { id: "code", label: "Code" },
  { id: "system-design", label: "System design" },
  { id: "interview", label: "Interview" },
]);

export const MAX_MISTAKES = 2_000;

const CATEGORY_IDS = new Set(MISTAKE_CATEGORIES.map((category) => category.id));

const text = (value, maximum) => String(value ?? "").trim().slice(0, maximum);

/** Maps a review card's type/tags onto the closest mistake category. */
export const categoryForReviewItem = (item) => {
  const tags = (item?.tags || []).map((tag) => String(tag).toLocaleLowerCase());
  if (tags.includes("interview") || item?.type === "production-scenario") return item?.type === "production-scenario" ? "system-design" : "interview";
  if (["debugging", "code-output"].includes(item?.type)) return "code";
  if (["formula", "derivation"].includes(item?.type)) return "formula";
  return "misconception";
};

export const createMistake = ({
  prompt,
  expected,
  response = "",
  category = "misconception",
  correction = "",
  hints = [],
  documentId = "",
  reviewItemId = "",
  tags = [],
}, now = new Date()) => ({
  id: createId(),
  prompt: text(prompt, 2_000),
  expected: text(expected, 4_000),
  response: text(response, 4_000),
  category: CATEGORY_IDS.has(category) ? category : "misconception",
  correction: text(correction, 4_000),
  hints: (Array.isArray(hints) ? hints : []).filter((hint) => typeof hint === "string").map((hint) => text(hint, 500)).filter(Boolean).slice(0, 5),
  documentId: text(documentId, 500),
  reviewItemId: text(reviewItemId, 200),
  tags: [...new Set((Array.isArray(tags) ? tags : []).map((tag) => text(tag, 40)).filter(Boolean))].slice(0, 10),
  occurrences: 1,
  firstSeenAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  correctedAt: "",
  updatedAt: now.toISOString(),
});

/**
 * Repeated mistakes merge instead of duplicating: the same review card, or
 * the same category+prompt pair, is one mistake with a rising occurrence
 * count. A recurrence of a corrected mistake reopens it.
 */
export const mistakeFingerprint = (mistake) => (mistake.reviewItemId
  ? `card\u0000${mistake.reviewItemId}`
  : `text\u0000${mistake.category}\u0000${String(mistake.prompt || "").trim().toLocaleLowerCase()}`);

export const recordMistake = (mistakes, draft, now = new Date()) => {
  const incoming = createMistake(draft, now);
  if (!incoming.prompt) return { mistakes, mistake: null, merged: false };
  const fingerprint = mistakeFingerprint(incoming);
  const existingIndex = (mistakes || []).findIndex((mistake) => mistakeFingerprint(mistake) === fingerprint);
  if (existingIndex === -1) {
    return { mistakes: [incoming, ...(mistakes || [])].slice(0, MAX_MISTAKES), mistake: incoming, merged: false };
  }
  const existing = mistakes[existingIndex];
  const merged = {
    ...existing,
    occurrences: Math.min((Number(existing.occurrences) || 1) + 1, 9_999),
    lastSeenAt: now.toISOString(),
    // A recurrence means the correction did not stick yet.
    correctedAt: "",
    response: incoming.response || existing.response,
    updatedAt: now.toISOString(),
  };
  const next = [...mistakes];
  next[existingIndex] = merged;
  return { mistakes: next, mistake: merged, merged: true };
};

export const updateMistake = (mistakes, id, patch, now = new Date()) => (mistakes || []).map((mistake) => {
  if (mistake.id !== id) return mistake;
  return {
    ...mistake,
    ...(patch.correction !== undefined ? { correction: text(patch.correction, 4_000) } : {}),
    ...(patch.category !== undefined && CATEGORY_IDS.has(patch.category) ? { category: patch.category } : {}),
    ...(patch.hints !== undefined ? { hints: (Array.isArray(patch.hints) ? patch.hints : []).filter((hint) => typeof hint === "string").map((hint) => text(hint, 500)).filter(Boolean).slice(0, 5) } : {}),
    ...(patch.correctedAt !== undefined ? { correctedAt: typeof patch.correctedAt === "string" ? patch.correctedAt : "" } : {}),
    updatedAt: now.toISOString(),
  };
});

/** Normalizes an untrusted stored array (db.js delegates here). */
export const normalizeMistakes = (input) => (Array.isArray(input) ? input : [])
  .filter((mistake) => mistake && typeof mistake === "object" && typeof mistake.prompt === "string" && mistake.prompt.trim())
  .slice(0, MAX_MISTAKES)
  .map((mistake) => ({
    id: typeof mistake.id === "string" ? mistake.id : createId(),
    prompt: text(mistake.prompt, 2_000),
    expected: text(mistake.expected, 4_000),
    response: text(mistake.response, 4_000),
    category: CATEGORY_IDS.has(mistake.category) ? mistake.category : "misconception",
    correction: text(mistake.correction, 4_000),
    hints: (Array.isArray(mistake.hints) ? mistake.hints : []).filter((hint) => typeof hint === "string").map((hint) => text(hint, 500)).filter(Boolean).slice(0, 5),
    documentId: text(mistake.documentId, 500),
    reviewItemId: text(mistake.reviewItemId, 200),
    tags: [...new Set((Array.isArray(mistake.tags) ? mistake.tags : []).map((tag) => text(tag, 40)).filter(Boolean))].slice(0, 10),
    occurrences: Number.isSafeInteger(mistake.occurrences) && mistake.occurrences > 0 ? Math.min(mistake.occurrences, 9_999) : 1,
    firstSeenAt: typeof mistake.firstSeenAt === "string" ? mistake.firstSeenAt : new Date().toISOString(),
    lastSeenAt: typeof mistake.lastSeenAt === "string" ? mistake.lastSeenAt : new Date().toISOString(),
    correctedAt: typeof mistake.correctedAt === "string" ? mistake.correctedAt : "",
    updatedAt: typeof mistake.updatedAt === "string" ? mistake.updatedAt : new Date().toISOString(),
  }));

/** Aggregate view of the notebook for analytics surfaces (LEARN-005). */
export const mistakeAnalytics = (mistakes = []) => {
  const byCategory = Object.fromEntries(MISTAKE_CATEGORIES.map((category) => [category.id, 0]));
  let open = 0;
  let corrected = 0;
  for (const mistake of mistakes) {
    if (mistake.correctedAt) corrected += 1;
    else open += 1;
    if (byCategory[mistake.category] !== undefined && !mistake.correctedAt) byCategory[mistake.category] += 1;
  }
  const mostRepeated = mistakes
    .filter((mistake) => !mistake.correctedAt && (Number(mistake.occurrences) || 1) > 1)
    .sort((left, right) => (right.occurrences - left.occurrences)
      || Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0)
      || String(left.id).localeCompare(String(right.id)))
    .slice(0, 3);
  return { open, corrected, byCategory, mostRepeated };
};

/**
 * Undo for a notebook deletion (REV-11): puts the removed record back at its
 * old position unless a record with the same id already exists (another tab
 * restored or merged it back), and keeps the collection within its bound.
 * Shared by mistakes and clippings.
 */
export const reinsertRecord = (records, record, index = 0, limit = MAX_MISTAKES) => {
  const list = Array.isArray(records) ? records : [];
  if (!record?.id || list.some((entry) => entry.id === record.id)) return list;
  const at = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, list.length));
  return [...list.slice(0, at), record, ...list.slice(at)].slice(0, limit);
};
