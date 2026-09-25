import assert from "node:assert/strict";
import test from "node:test";

import trackBank from "../data/interviewTracks.v1.json" with { type: "json" };
import { buildTrackRound, normalizeTrackBank } from "./interviewTracks.js";
import { createMistake } from "./mistakes.js";
import { buildTutorContext } from "./tutorGrounding.js";
import {
  createPracticeKit,
  nextPracticeQuestion,
  practiceMissDraft,
  practiceQuestionById,
  practiceQuestionCard,
  practiceReference,
  practiceTracks,
} from "./tutorInterview.js";
import {
  PRACTICE_STATE_KEY,
  normalizePracticeState,
  practiceAnswerFrom,
  practiceGradingPrompt,
  practiceQuestionIdFrom,
  readPracticeState,
  writePracticeState,
} from "./tutorPractice.js";

const { questions } = normalizeTrackBank(trackBank);
const question = questions.find((item) => item.id === "mle-01");

test("the question card never carries the model answer or rubric", () => {
  const card = practiceQuestionCard(question);
  assert.deepEqual(Object.keys(card).sort(), ["id", "meta", "prompt"]);
  assert.equal(card.prompt, question.prompt);
  assert.match(card.meta, /^Rapid fundamentals · junior · about 2 min$/);
  assert.equal(JSON.stringify(card).includes(question.modelAnswer.slice(0, 40)), false);
});

test("the reference is one labelled-by-the-tutor source that fits whole in every bank entry", () => {
  const reference = practiceReference(question);
  assert.equal(reference.id, "interview:mle-01");
  assert.equal(reference.title, "Interview reference: mle-01");
  assert.equal(reference.original.documentId, question.documentId, "citations would open an unknown lesson");
  assert.match(reference.text, /^Question: [\s\S]+\n\nModel answer: [\s\S]+\n\nRubric:\n- /);
  assert.equal(/\[[SW]\d+\]/.test(reference.text), false, "the bank text declared its own citation label");
  for (const entry of questions) {
    const built = buildTutorContext([{ ...practiceReference(entry), citationNumber: 12 }], 3_000);
    assert.deepEqual(built.includedCitationNumbers, [12], `${entry.id} did not fit a 3,000-character context`);
    assert.equal(built.context.includes("clipped by Lumen"), false, `${entry.id} was clipped in a 3,000-character context`);
  }
});

test("the learner's answer is read back from the visible grading question", () => {
  const answer = "High variance.\n\nMy answer: also more data. L1 zeroes weights.";
  const prompt = practiceGradingPrompt(question, `  ${answer}  `);
  assert.match(prompt, /^Grade my answer to this interview question against the model answer and rubric/);
  assert.ok(prompt.includes(`Interview question: ${question.prompt}`));
  assert.equal(practiceAnswerFrom(prompt), answer, "an answer quoting the marker was cut");
  assert.equal(practiceAnswerFrom("Explain ridge."), "");
  assert.equal(practiceQuestionIdFrom({ citationSources: [{ id: "interview:mle-01" }] }), "mle-01");
  assert.equal(practiceQuestionIdFrom({ citationSources: [{ id: "notes/x.md" }] }), "");
  assert.equal(practiceQuestionById(trackBank, "mle-01").id, "mle-01");
  assert.equal(practiceQuestionById(trackBank, "missing"), null);
});

test("a logged miss merges with a track round's and comes first next time", () => {
  const track = practiceTracks(trackBank)[0];
  const round = buildTrackRound(trackBank, { trackId: track.id, limit: 12 });
  const target = practiceQuestionById(trackBank, round.cards.at(-1).id);
  const draft = practiceMissDraft(target, { answer: "I would retrain.", trackId: track.id });
  assert.equal(draft.reviewItemId, target.id);
  assert.deepEqual(draft.tags.slice(0, 1), ["interview-track"]);
  assert.ok(draft.tags.includes(track.id) && draft.tags.includes(target.roundType) && draft.tags.includes("interview"));
  assert.equal(draft.category, round.cards.at(-1).mistakeCategory, "the category differs from a timed round's");
  assert.deepEqual(draft.documentIds, [target.documentId]);
  const mistake = createMistake(draft);
  assert.equal(buildTrackRound(trackBank, { trackId: track.id }, [mistake]).cards[0].id, target.id, "a tutor miss did not move its question first");
  assert.equal(nextPracticeQuestion(trackBank, { trackId: track.id, mistakes: [mistake] }).id, target.id);
});

test("next question walks the round, skipping practised questions, then starts over", () => {
  const trackId = "mle";
  const order = buildTrackRound(trackBank, { trackId, limit: 12 }).cards.map((card) => card.id);
  assert.equal(nextPracticeQuestion(trackBank, { trackId }).id, order[0]);
  assert.equal(nextPracticeQuestion(trackBank, { trackId, practiced: [order[0]] }).id, order[1]);
  assert.equal(nextPracticeQuestion(trackBank, { trackId, skip: order[0] }).id, order[1], "Skip returned the same question");
  assert.equal(nextPracticeQuestion(trackBank, { trackId, practiced: order, skip: order[0] }).id, order[1], "a finished track did not start over");
  assert.equal(nextPracticeQuestion(trackBank, { trackId: "missing" }), null);
  assert.equal(nextPracticeQuestion(null, { trackId }), null);
});

test("practice state is bounded, typed and survives storage failures", () => {
  const storage = new Map();
  const fake = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  writePracticeState({ trackId: "mle", questionId: "mle-01", answer: "Draft", ticks: { m1: [0, 2], bad: ["x"] }, outcomes: { m1: "missed", m2: "maybe" }, practiced: ["mle-02", 7] }, fake);
  assert.ok(storage.has(PRACTICE_STATE_KEY));
  assert.deepEqual(readPracticeState(fake), {
    trackId: "mle",
    questionId: "mle-01",
    answer: "Draft",
    pendingId: "",
    practiced: ["mle-02"],
    ticks: { m1: [0, 2] },
    outcomes: { m1: "missed" },
  });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readPracticeState(broken), normalizePracticeState({}));
  assert.doesNotThrow(() => writePracticeState({}, broken));
  const many = normalizePracticeState({ outcomes: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`m${index}`, "covered"])) });
  assert.equal(Object.keys(many.outcomes).length, 30);
  assert.equal(many.outcomes.m39, "covered", "the newest outcomes were dropped");
});

test("the practice kit answers everything the tutor asks of a loaded bank", () => {
  const kit = createPracticeKit(trackBank);
  assert.deepEqual(kit.tracks, practiceTracks(trackBank));
  assert.equal(kit.questions.get("mle-01").id, "mle-01");
  assert.equal(kit.next({ trackId: "mle" }).id, nextPracticeQuestion(trackBank, { trackId: "mle" }).id);
  assert.deepEqual(kit.reference(question), practiceReference(question));
  assert.deepEqual(kit.missDraft(question, { answer: "A", trackId: "mle" }), practiceMissDraft(question, { answer: "A", trackId: "mle" }));
});
