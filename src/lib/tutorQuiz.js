import { withoutCitationLabels } from "./tutorFollowUps.js";

/**
 * Quiz follow-through (TFEAT-01): what a learner chose, how sure they were
 * and what they checked, per quiz message; the score once every question is
 * checked; misses as mistake-notebook drafts; and the prompts for "Explain
 * my mistake" and "New quiz on my weak spots". Quiz state is a per-tab
 * convenience in session storage, never part of the profile or a backup.
 */

export const QUIZ_STATE_KEY = "lumen.ai.quiz-state.v1";
const MAX_QUIZ_STATES = 30;
const MAX_QUESTIONS = 10;

/** "How sure are you?" before Check answer, lowest to highest. */
export const CONFIDENCE_LEVELS = Object.freeze([
  { id: "guess", label: "Guessing" },
  { id: "fair", label: "Fairly sure" },
  { id: "certain", label: "Certain" },
]);
const CONFIDENCE_RANK = new Map(CONFIDENCE_LEVELS.map((level, index) => [level.id, index + 1]));

const letter = (index) => String.fromCharCode(65 + index);

const clip = (value, maximum) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (maximum <= 0) return "";
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

const plain = (value) => withoutCitationLabels(value);

const record = (value, accept) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
  .filter(([key, item]) => key.length > 0 && key.length <= 200 && accept(item))
  .slice(0, MAX_QUESTIONS));

/** One quiz message's state, from untrusted storage or an update. */
export const normalizeQuizState = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    answers: record(source.answers, (item) => Number.isSafeInteger(item) && item >= 0 && item < 6),
    checked: record(source.checked, (item) => item === true),
    confidence: record(source.confidence, (item) => CONFIDENCE_RANK.has(item)),
    saved: record(source.saved, (item) => item === true),
    // question id -> the id of the "Explain my mistake" question it sent
    explained: record(source.explained, (item) => typeof item === "string" && item.length > 0 && item.length <= 200),
    summaryAnnounced: source.summaryAnnounced === true,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  };
};

const normalizeStates = (value) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
  .filter(([id]) => id.length > 0 && id.length <= 200)
  .map(([id, state]) => [id, normalizeQuizState(state)])
  .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
  .slice(0, MAX_QUIZ_STATES));

export const readQuizStates = (storage = globalThis.sessionStorage) => {
  try {
    return normalizeStates(JSON.parse(storage?.getItem(QUIZ_STATE_KEY) || "{}"));
  } catch {
    return {};
  }
};

export const writeQuizStates = (states, storage = globalThis.sessionStorage) => {
  try {
    const normalized = normalizeStates(states);
    if (Object.keys(normalized).length) storage?.setItem(QUIZ_STATE_KEY, JSON.stringify(normalized));
    else storage?.removeItem(QUIZ_STATE_KEY);
  } catch {
    // Without session storage a quiz simply starts fresh after a remount.
  }
};

/** Keeps only the quizzes still in the conversation; the same object when nothing changes. */
export const pruneQuizStates = (states, liveIds) => {
  const keys = Object.keys(states || {});
  const kept = keys.filter((id) => liveIds.has(id));
  return kept.length === keys.length ? states : Object.fromEntries(kept.map((id) => [id, states[id]]));
};

/**
 * The score once questions are checked. Misses are ordered for review:
 * the answers a learner was certain about first (the misses most worth
 * correcting), then fairly sure, then guesses, each in question order.
 */
export const quizSummary = (quiz, state) => {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const current = normalizeQuizState(state);
  const graded = questions.map((question, index) => ({
    question,
    index,
    chosen: current.answers[question.id],
    confidence: current.confidence[question.id] || "",
  })).filter((item) => current.checked[item.question.id] && Number.isSafeInteger(item.chosen));
  const misses = graded
    .filter((item) => item.chosen !== item.question.correctIndex)
    .sort((left, right) => (CONFIDENCE_RANK.get(right.confidence) || 0) - (CONFIDENCE_RANK.get(left.confidence) || 0) || left.index - right.index);
  return {
    total: questions.length,
    checked: graded.length,
    correct: graded.length - misses.length,
    complete: questions.length > 0 && graded.length === questions.length,
    misses,
    confidentMisses: misses.filter((item) => item.confidence === "certain").length,
  };
};

/**
 * Mistake-notebook drafts for the misses not saved yet, most confident
 * first. A question whose answer check disagreed with the quiz key
 * (`disputed`) is left out: the key itself may be wrong.
 */
export const quizMissDrafts = (quiz, state, { documentIds = [], disputed = new Set() } = {}) => {
  const current = normalizeQuizState(state);
  return quizSummary(quiz, current).misses
    .filter(({ question }) => !current.saved[question.id] && !disputed.has(question.id))
    .map(({ question, chosen, confidence }) => ({
      questionId: question.id,
      prompt: clip(plain(question.prompt), 2_000),
      expected: `${letter(question.correctIndex)}. ${clip(plain(question.options[question.correctIndex]), 1_000)}\n\n${clip(plain(question.explanation), 2_800)}`.trim(),
      response: `${letter(chosen)}. ${clip(plain(question.options[chosen]), 1_000)}`,
      category: "misconception",
      documentIds: documentIds.filter(Boolean).slice(0, 8),
      tags: confidence === "certain" ? ["ai-quiz", "ai-draft", "confident-miss"] : ["ai-quiz", "ai-draft"],
    }));
};

const FEEDBACK_ASK = "I chose the wrong answer. Explain why my answer is wrong, name the misconception behind it, and give the correct reasoning using the supplied sources. End with one short question that checks I now understand.";

/**
 * The "Explain my mistake" question: the quiz question, its options, the
 * learner's answer, the key and its explanation, without the quiz's [S#]
 * labels (the check is grounded in its own, freshly numbered passages). It
 * never exceeds `maxChars`: the explanation shrinks first, then the other
 * options, then the question itself.
 */
export const answerFeedbackPrompt = (question, chosenIndex, { maxChars = 4_000 } = {}) => {
  const options = Array.isArray(question?.options) ? question.options : [];
  const correctIndex = question?.correctIndex;
  const build = ({ questionChars, optionChars, explanationChars, otherOptions }) => {
    const lines = [`Quiz question: ${clip(plain(question?.prompt), questionChars)}`];
    if (otherOptions) {
      lines.push("Options:");
      options.forEach((option, index) => lines.push(`${letter(index)}. ${clip(plain(option), optionChars)}`));
    }
    lines.push(`My answer: ${letter(chosenIndex)}. ${clip(plain(options[chosenIndex]), optionChars)}`);
    lines.push(`Answer key: ${letter(correctIndex)}. ${clip(plain(options[correctIndex]), optionChars)}`);
    const explanation = clip(plain(question?.explanation), explanationChars);
    if (explanation) lines.push(`Key explanation: ${explanation}`);
    return `${lines.join("\n")}\n\n${FEEDBACK_ASK}`;
  };
  const attempts = [
    { questionChars: 900, optionChars: 400, explanationChars: 1_200, otherOptions: true },
    { questionChars: 900, optionChars: 400, explanationChars: 400, otherOptions: true },
    { questionChars: 600, optionChars: 240, explanationChars: 240, otherOptions: false },
    { questionChars: 300, optionChars: 120, explanationChars: 0, otherOptions: false },
    { questionChars: 120, optionChars: 60, explanationChars: 0, otherOptions: false },
  ];
  for (const attempt of attempts) {
    const text = build(attempt);
    if (text.length <= maxChars) return text;
  }
  return build(attempts.at(-1)).slice(0, Math.max(0, maxChars));
};

/** Library search words for an answer check: the question itself. */
export const feedbackRetrievalQuery = (question) => clip(plain(question?.prompt), 300);

/** "New quiz on my weak spots": the missed questions name the concepts. */
export const weakSpotQuiz = (misses) => {
  const questions = (Array.isArray(misses) ? misses : []).slice(0, 4).map((miss) => clip(plain(miss.question?.prompt), 200)).filter(Boolean);
  return {
    prompt: `Create 3 new multiple-choice questions on the ideas I got wrong in my last quiz:\n${questions.map((text) => `- ${text}`).join("\n")}\nTest the same concepts from a different angle and explain each answer.`,
    retrievalQuery: clip(questions.join(" "), 300),
  };
};

const exactKeys = (value, keys) => Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const boundedString = (value, maximum = 20_000) => typeof value === "string" && value.length <= maximum;
const requiredString = (value, maximum = 20_000) => boundedString(value, maximum) && Boolean(value.trim());
const boundedStringArray = (value, maximumItems) => Array.isArray(value)
  && value.length <= maximumItems
  && value.every((item) => boundedString(item, 4_000));

/**
 * The answer_feedback result, checked exactly as the server checks it
 * (server/ai/contracts.mjs). Provider output stays untrusted after the
 * server's own validation, and an invalid result is never kept.
 */
export const validateTutorAnswerFeedback = (value) => exactKeys(value, ["score", "correct", "feedback", "strengths", "gaps", "improvedAnswer", "nextQuestion"])
  && Number.isSafeInteger(value.score) && value.score >= 0 && value.score <= 100
  && typeof value.correct === "boolean"
  && requiredString(value.feedback) && boundedStringArray(value.strengths, 6) && boundedStringArray(value.gaps, 6)
  && requiredString(value.improvedAnswer) && (value.nextQuestion === null || requiredString(value.nextQuestion));
