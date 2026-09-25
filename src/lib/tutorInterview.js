import { ROUND_TYPES, buildTrackRound, mistakeCategoryForRoundType, normalizeTrackBank } from "./interviewTracks.js";
import { withoutCitationLabels } from "./tutorFollowUps.js";

/**
 * Interview practice from the authored bank (TFEAT-06). A question from a
 * track is answered in the tutor and graded against its own model answer
 * and rubric, which travel as one supplied reference source so the model's
 * [S#] labels resolve to real evidence. The rubric, not the model's
 * (generous) score, is what the learner acts on. Practice state is a
 * per-tab convenience in session storage, never part of the profile.
 */

export const PRACTICE_STATE_KEY = "lumen.ai.interview-practice.v1";
export const PRACTICE_SOURCE_PREFIX = "interview:";
const MAX_TRACKED = 30;
const MAX_PRACTICED = 100;
const ANSWER_MARKER = "\n\nMy answer: ";
const GRADE_ASK = "Grade my answer to this interview question against the model answer and rubric in the supplied interview reference. Say which rubric points my answer covers and which it misses. Credit only what my answer actually says.";

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
const plain = (value) => withoutCitationLabels(value);

export const roundLabel = (roundType) => ROUND_TYPES.find((round) => round.id === roundType)?.label || "Interview";

/**
 * The question shown to the learner: never its model answer, which stays
 * out of the page until the answer is graded.
 */
export const practiceQuestionCard = (question) => ({
  id: question.id,
  prompt: plain(question.prompt),
  meta: `${roundLabel(question.roundType)} · ${question.seniority} · about ${question.expectedMinutes} min`,
});

/**
 * The supplied reference for grading: question, model answer and rubric,
 * without any label of its own (its [S#] number is assigned by the tutor).
 * `original` points citations at the question's lecture.
 */
export const practiceReference = (question) => ({
  id: `${PRACTICE_SOURCE_PREFIX}${question.id}`,
  title: `Interview reference: ${question.id}`,
  section: roundLabel(question.roundType),
  text: [
    `Question: ${plain(question.prompt)}`,
    `Model answer: ${plain(question.modelAnswer)}`,
    `Rubric:\n${question.rubric.map((bullet) => `- ${plain(bullet)}`).join("\n")}`,
  ].join("\n\n"),
  original: { id: `${PRACTICE_SOURCE_PREFIX}${question.id}`, documentId: question.documentId, title: `Interview reference: ${question.id}` },
});

/** The visible grading question; the learner's answer comes last. */
export const practiceGradingPrompt = (question, answer) => `${GRADE_ASK}\n\nInterview question: ${plain(question?.prompt)}${ANSWER_MARKER}${clean(answer)}`;

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

/** Seeded tracks, for the track picker. */
export const practiceTracks = (bank) => normalizeTrackBank(bank).tracks.filter((track) => track.seeded);

/**
 * The next question to practise on a track: the order of a track round
 * (questions with open interview mistakes first, then by seniority), skipping
 * what was practised in this tab and the question being skipped. When every
 * question was practised, the round starts over.
 */
export const nextPracticeQuestion = (bank, { trackId, mistakes = [], practiced = [], skip = "" } = {}) => {
  const round = buildTrackRound(bank, { trackId, limit: 12 }, mistakes);
  if (!round.ok) return null;
  const questions = new Map(normalizeTrackBank(bank).questions.map((question) => [question.id, question]));
  const order = round.cards.map((card) => card.id);
  const done = new Set(practiced);
  const id = order.find((candidate) => !done.has(candidate) && candidate !== skip)
    || order.find((candidate) => candidate !== skip)
    || order[0];
  return questions.get(id) || null;
};

/** One question from the bank by id, or null. */
export const practiceQuestionById = (bank, id) => normalizeTrackBank(bank).questions.find((question) => question.id === id) || null;

/**
 * The mistake-notebook draft for "Missed points": linked to the question
 * (reviewItemId) and tagged like a timed track round, so it merges with a
 * round's miss of the same question and comes first in the next round.
 */
export const practiceMissDraft = (question, { answer = "", trackId = "" } = {}) => ({
  prompt: plain(question.prompt),
  expected: plain(question.modelAnswer),
  response: clean(answer).slice(0, 4_000),
  reviewItemId: question.id,
  category: mistakeCategoryForRoundType(question.roundType),
  tags: [...new Set(["interview-track", trackId || question.trackIds[0], question.roundType, "interview"].filter(Boolean))],
  documentIds: [question.documentId].filter(Boolean),
});

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
