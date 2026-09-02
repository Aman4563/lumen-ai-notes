import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import labBank from "../data/labs.v1.json" with { type: "json" };
import trackBank from "../data/interviewTracks.v1.json" with { type: "json" };
import { INTERVIEW_TRACKS_FORMAT, ROUND_TYPES, answerSecondsFor, buildTrackRound, normalizeTrackBank, trackCoverage } from "./interviewTracks.js";
import { LABS_FORMAT, checkLabAnswer, labMistakeDraft, normalizeLabBank } from "./labs.js";

const contentIndex = JSON.parse(readFileSync(new URL("../generated/content-index.json", import.meta.url)));
const documentIds = new Set(contentIndex.map((entry) => entry.id));

test("the authored interview bank is valid, complete, and anchored to real lectures", () => {
  assert.equal(trackBank.format, INTERVIEW_TRACKS_FORMAT);
  const { tracks, questions } = normalizeTrackBank(trackBank);
  assert.equal(tracks.length, 8, "all eight PRD tracks must be registered");
  const seeded = tracks.filter((track) => track.seeded);
  assert.equal(seeded.length, 6, "six tracks ship seeded this campaign");
  assert.ok(questions.length >= 48, `expected a substantial bank, got ${questions.length}`);
  for (const track of seeded) {
    const count = questions.filter((question) => question.trackIds.includes(track.id)).length;
    assert.ok(count >= 8, `track ${track.id} has only ${count} questions`);
  }
  for (const question of questions) {
    assert.ok(documentIds.has(question.documentId), `question ${question.id} anchors to a missing lecture: ${question.documentId}`);
    assert.ok(question.rubric.length >= 3, `question ${question.id} needs at least 3 rubric bullets`);
    assert.ok(question.modelAnswer.length >= 120, `question ${question.id} model answer is too thin`);
  }
  const roundTypesUsed = new Set(questions.map((question) => question.roundType));
  for (const round of ROUND_TYPES) {
    assert.ok(roundTypesUsed.has(round.id), `no questions use round type ${round.id}`);
  }
  const coverage = trackCoverage(trackBank);
  assert.equal(coverage.filter((entry) => !entry.seeded).every((entry) => entry.questionCount === 0), true, "unseeded tracks must not claim questions");
});

test("track rounds are deterministic, bounded, and missed-first", () => {
  const round = buildTrackRound(trackBank, { trackId: "mle" });
  assert.equal(round.ok, true);
  assert.ok(round.cards.length >= 1 && round.cards.length <= 6);
  assert.deepEqual(buildTrackRound(trackBank, { trackId: "mle" }).cards.map((card) => card.id), round.cards.map((card) => card.id), "same inputs, same round");
  const card = round.cards[0];
  assert.ok(card.front.includes("**"), "cards carry the round/seniority header");
  assert.ok(card.back.includes("**Rubric**"), "the revealed answer includes the rubric");
  assert.ok(card.answerSeconds >= 60 && card.answerSeconds <= 300);
  assert.ok(card.tags.includes("interview-track"));

  const missedId = round.cards.at(-1).id;
  const biased = buildTrackRound(trackBank, { trackId: "mle" }, [{ reviewItemId: missedId, correctedAt: "", tags: ["interview-track"] }]);
  assert.equal(biased.cards[0].id, missedId, "previously missed questions come first");

  assert.equal(buildTrackRound(trackBank, { trackId: "vision" }).ok, false, "unseeded tracks refuse with a reason");
  assert.equal(answerSecondsFor({ expectedMinutes: 10 }), 300, "answer time clamps at five minutes");
});

test("the authored lab bank is valid and its self-check literals behave", () => {
  assert.equal(labBank.format, LABS_FORMAT);
  const { labs } = normalizeLabBank(labBank);
  assert.equal(labs.length, 4, "four seed labs ship");
  const kinds = new Set(labs.map((lab) => lab.kind));
  assert.deepEqual([...kinds].sort(), ["debugging", "metrics", "python", "sql"]);
  for (const lab of labs) {
    assert.ok(documentIds.has(lab.documentId), `lab ${lab.id} anchors to a missing lecture: ${lab.documentId}`);
    assert.ok(lab.tasks.length >= 2, `lab ${lab.id} needs at least two checks`);
    assert.ok(lab.solution.length >= 100, `lab ${lab.id} needs a real worked solution`);
    for (const task of lab.tasks) {
      assert.ok(task.selfCheck.expected, `lab ${lab.id} task ${task.id} lacks an expected literal`);
      assert.ok(checkLabAnswer(task.selfCheck.expected, task.selfCheck.expected), "expected literals must pass their own check");
    }
  }
});

test("answer checking tolerates formatting, and misses draft into the notebook", () => {
  assert.equal(checkLabAnswer("1.5", " 1.50 "), true, "numeric answers ignore trailing zeros");
  assert.equal(checkLabAnswer("SELECT count(*)", "select COUNT(*)"), true, "case folds");
  assert.equal(checkLabAnswer("2.25", "2.3"), false, "wrong numbers still fail");
  assert.equal(checkLabAnswer('"alice"', "alice"), true, "surrounding quotes are forgiven");

  const { labs } = normalizeLabBank(labBank);
  const draft = labMistakeDraft(labs[0], labs[0].tasks[0], "my wrong answer");
  assert.equal(draft.category, "code");
  assert.ok(draft.tags.includes("lab"));
  assert.equal(draft.documentId, labs[0].documentId);
  assert.ok(draft.expected.includes(labs[0].tasks[0].selfCheck.expected));
});
