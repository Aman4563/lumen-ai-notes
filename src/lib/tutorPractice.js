import { withoutCitationLabels } from "./tutorFollowUps.js";

/**
 * Interview practice (TFEAT-06), the part the tutor needs before the
 * authored bank loads: the grading question and its parsing, the reference
 * id prefix, and the per-tab practice state (session storage, never part of
 * the profile). Everything that reads the bank lives in tutorInterview.js,
 * which loads with it.
 */

export const PRACTICE_STATE_KEY = "lumen.ai.interview-practice.v1";
export const PRACTICE_SOURCE_PREFIX = "interview:";
const MAX_TRACKED = 30;
const MAX_PRACTICED = 100;
const ANSWER_MARKER = "\n\nMy answer: ";
const GRADE_ASK = "Grade my answer to this interview question against the model answer and rubric in the supplied interview reference. Say which rubric points my answer covers and which it misses. Credit only what my answer actually says.";

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/** The visible grading question; the learner's answer comes last. */
export const practiceGradingPrompt = (question, answer) => `${GRADE_ASK}\n\nInterview question: ${withoutCitationLabels(question?.prompt)}${ANSWER_MARKER}${clean(answer)}`;

/** The learner's answer, read back from a grading question. */
export const practiceAnswerFrom = (content) => {
  const text = clean(content);
  const at = text.indexOf(ANSWER_MARKER);
  return at < 0 ? "" : text.slice(at + ANSWER_MARKER.length).trim();
};

/** The bank question a graded answer is about, from its reference source. */
export const practiceQuestionIdFrom = (message) => {
  const id = String(message?.citationSources?.[0]?.id || "");
  return id.startsWith(PRACTICE_SOURCE_PREFIX) ? id.slice(PRACTICE_SOURCE_PREFIX.length) : "";
};

const record = (value, accept) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
  .filter(([key, item]) => key.length > 0 && key.length <= 200 && accept(item))
  .slice(-MAX_TRACKED));

const text = (value, maximum) => (typeof value === "string" ? value.slice(0, maximum) : "");

/** Practice state from untrusted storage or an update. */
export const normalizePracticeState = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    trackId: text(source.trackId, 40),
    questionId: text(source.questionId, 80),
    answer: text(source.answer, 8_000),
    // The id of the grading question sent for the current question.
    pendingId: text(source.pendingId, 200),
    practiced: (Array.isArray(source.practiced) ? source.practiced : []).filter((id) => typeof id === "string" && id.length <= 80).slice(-MAX_PRACTICED),
    // Per graded answer: the rubric points the learner ticked, and whether
    // they logged the question as missed or covered.
    ticks: record(source.ticks, (item) => Array.isArray(item) && item.length <= 6 && item.every((index) => Number.isSafeInteger(index) && index >= 0 && index < 6)),
    outcomes: record(source.outcomes, (item) => item === "missed" || item === "covered"),
  };
};

export const readPracticeState = (storage = globalThis.sessionStorage) => {
  try {
    return normalizePracticeState(JSON.parse(storage?.getItem(PRACTICE_STATE_KEY) || "{}"));
  } catch {
    return normalizePracticeState({});
  }
};

export const writePracticeState = (state, storage = globalThis.sessionStorage) => {
  try {
    storage?.setItem(PRACTICE_STATE_KEY, JSON.stringify(normalizePracticeState(state)));
  } catch {
    // Without session storage, practice simply starts fresh after a remount.
  }
};
