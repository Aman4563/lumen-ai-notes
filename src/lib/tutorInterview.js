import { ROUND_TYPES, buildTrackRound, mistakeCategoryForRoundType, normalizeTrackBank } from "./interviewTracks.js";
import { withoutCitationLabels } from "./tutorFollowUps.js";
import { PRACTICE_SOURCE_PREFIX } from "./tutorPractice.js";

/**
 * Interview practice from the authored bank (TFEAT-06). A question from a
 * track is answered in the tutor and graded against its own model answer
 * and rubric, which travel as one supplied reference source so the model's
 * [S#] labels resolve to real evidence. The rubric, not the model's
 * (generous) score, is what the learner acts on. This module loads with the
 * bank, only when the tutor needs it; tutorPractice.js holds the rest.
 */

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

/** Everything the tutor asks of a loaded bank. */
export const createPracticeKit = (bank) => ({
  tracks: practiceTracks(bank),
  questions: new Map(normalizeTrackBank(bank).questions.map((question) => [question.id, question])),
  next: (options) => nextPracticeQuestion(bank, options),
  reference: practiceReference,
  missDraft: practiceMissDraft,
});
