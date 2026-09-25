/**
 * "Work through with tutor" bridges (TFEAT-07): a prepared question another
 * screen hands to the AI tutor. It is only ever placed in the question box
 * for the learner to review and send; nothing here sends. Each field is
 * clipped so the whole question fits every engine's prompt limit.
 */

/**
 * The smallest question box a prepared question can land in: On-device
 * Lite's. The Mac tutor accepts more, but the learner may have either
 * engine open, so every prepared question fits this whole.
 */
export const TUTOR_BRIDGE_PROMPT_CHARS = 1_800;

const clip = (value, maximum) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

// Field budgets, largest first: the first that fits is used, so a question
// is shortened only as much as it must be, the learner's answer first.
const MISTAKE_BUDGETS = Object.freeze([
  { question: 600, expected: 600, response: 600 },
  { question: 600, expected: 600, response: 360 },
  { question: 600, expected: 420, response: 300 },
  { question: 480, expected: 360, response: 240 },
  { question: 360, expected: 300, response: 200 },
]);
const MISS_BUDGETS = Object.freeze([
  { question: 220, expected: 200, response: 160 },
  { question: 160, expected: 140, response: 110 },
  { question: 120, expected: 100, response: 80 },
  { question: 90, expected: 70, response: 50 },
]);

const fitPrompt = (build, budgets) => {
  for (const budget of budgets) {
    const prompt = build(budget);
    if (prompt.length <= TUTOR_BRIDGE_PROMPT_CHARS) return prompt;
  }
  return build(budgets.at(-1)).slice(0, TUTOR_BRIDGE_PROMPT_CHARS);
};

// A cloze prompt's blanks hold their answers; show them as blanks.
const withBlanks = (value) => String(value ?? "").replace(/\{\{[^{}]+\}\}/g, "___");

/**
 * A mistake-notebook entry, worked through Socratically: the question, the
 * expected answer and what the learner answered, each at most 600
 * characters and together within TUTOR_BRIDGE_PROMPT_CHARS. The mistake's
 * lesson is the retrieval hint, and its question and expected answer are the
 * library search words (the instructions name no topic).
 */
export const mistakeTutorRequest = (mistake) => {
  const response = clip(mistake?.response, 20);
  const answered = Boolean(response) && response !== "self-graded";
  const prompt = fitPrompt((budget) => [
    "Work through this mistake with me, one question at a time. Start by asking what I think went wrong, and do not give me the answer straight away.",
    "",
    `Question: ${clip(withBlanks(mistake?.prompt), budget.question)}`,
    `Expected answer: ${clip(mistake?.expected, budget.expected)}`,
    ...(answered ? [`My answer: ${clip(mistake?.response, budget.response)}`] : []),
  ].join("\n"), MISTAKE_BUDGETS);
  return {
    modeId: "socratic",
    prompt,
    origin: "mistake notebook",
    label: clip(withBlanks(mistake?.prompt), 80),
    documentId: String(mistake?.documentId || "").slice(0, 240),
    retrievalQuery: clip(`${withBlanks(mistake?.prompt)} ${mistake?.expected ?? ""}`, 300),
  };
};

/**
 * The misses of a finished readiness check, explained: up to five, each
 * with its expected answer and the learner's own, clipped so the question
 * fits TUTOR_BRIDGE_PROMPT_CHARS. The first missed question's lesson is the
 * retrieval hint and the missed questions are the library search words.
 */
export const assessmentMissesRequest = (drafts, { partTitle = "" } = {}) => {
  const misses = (Array.isArray(drafts) ? drafts : []).filter((draft) => clip(draft?.prompt, 10)).slice(0, 5);
  if (!misses.length) return null;
  const part = clip(partTitle, 120);
  const prompt = fitPrompt((budget) => {
    const lines = misses.map((draft, index) => {
      const response = clip(draft.response, budget.response);
      return `${index + 1}. ${clip(withBlanks(draft.prompt), budget.question)}\n   Expected: ${clip(draft.expected, budget.expected)}${response && response !== "self-graded" ? `\n   I answered: ${response}` : ""}`;
    });
    return `Explain the questions I missed in my readiness check${part ? ` for ${part}` : ""}: for each, the idea behind it, why the expected answer is right, and the mistake I most likely made.\n\n${lines.join("\n")}`;
  }, MISS_BUDGETS);
  return {
    modeId: "explain",
    prompt,
    origin: "readiness check",
    label: part || "your misses",
    documentId: String(misses.find((draft) => draft.documentId)?.documentId || "").slice(0, 240),
    retrievalQuery: clip(misses.map((draft) => withBlanks(draft.prompt)).join(" "), 300),
  };
};
