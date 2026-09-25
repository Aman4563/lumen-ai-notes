/**
 * "Work through with tutor" bridges (TFEAT-07): a prepared question another
 * screen hands to the AI tutor. It is only ever placed in the question box
 * for the learner to review and send; nothing here sends. Each field is
 * clipped so the whole question fits every engine's prompt limit.
 */

const FIELD_CHARS = 600;

const clip = (value, maximum) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

// A cloze prompt's blanks hold their answers; show them as blanks.
const withBlanks = (value) => String(value ?? "").replace(/\{\{[^{}]+\}\}/g, "___");

/**
 * A mistake-notebook entry, worked through Socratically: the question, the
 * expected answer and what the learner answered, each at most 600
 * characters. The mistake's lesson is the retrieval hint, and its question
 * and expected answer are the library search words (the instructions name
 * no topic).
 */
export const mistakeTutorRequest = (mistake) => {
  const response = clip(mistake?.response, FIELD_CHARS);
  const lines = [
    "Work through this mistake with me, one question at a time. Start by asking what I think went wrong, and do not give me the answer straight away.",
    "",
    `Question: ${clip(withBlanks(mistake?.prompt), FIELD_CHARS)}`,
    `Expected answer: ${clip(mistake?.expected, FIELD_CHARS)}`,
  ];
  if (response && response !== "self-graded") lines.push(`My answer: ${response}`);
  return {
    modeId: "socratic",
    prompt: lines.join("\n"),
    origin: "mistake notebook",
    label: clip(withBlanks(mistake?.prompt), 80),
    documentId: String(mistake?.documentId || "").slice(0, 240),
    retrievalQuery: clip(`${withBlanks(mistake?.prompt)} ${mistake?.expected ?? ""}`, 300),
  };
};

/**
 * The misses of a finished readiness check, explained: up to five, each
 * with its expected answer and the learner's own, clipped to fit. The first
 * missed question's lesson is the retrieval hint and the missed questions
 * are the library search words.
 */
export const assessmentMissesRequest = (drafts, { partTitle = "" } = {}) => {
  const misses = (Array.isArray(drafts) ? drafts : []).filter((draft) => clip(draft?.prompt, 10)).slice(0, 5);
  if (!misses.length) return null;
  const part = clip(partTitle, 120);
  const lines = misses.map((draft, index) => {
    const response = clip(draft.response, 160);
    return `${index + 1}. ${clip(withBlanks(draft.prompt), 220)}\n   Expected: ${clip(draft.expected, 200)}${response && response !== "self-graded" ? `\n   I answered: ${response}` : ""}`;
  });
  return {
    modeId: "explain",
    prompt: `Explain the questions I missed in my readiness check${part ? ` for ${part}` : ""}: for each, the idea behind it, why the expected answer is right, and the mistake I most likely made.\n\n${lines.join("\n")}`,
    origin: "readiness check",
    label: part || "your misses",
    documentId: String(misses.find((draft) => draft.documentId)?.documentId || "").slice(0, 240),
    retrievalQuery: clip(misses.map((draft) => withBlanks(draft.prompt)).join(" "), 300),
  };
};
