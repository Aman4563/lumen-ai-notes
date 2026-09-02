import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FSRS_DECAY,
  FSRS_DEFAULT_WEIGHTS,
  FSRS_FACTOR,
  fsrsGrade,
  initDifficulty,
  initStability,
  intervalForRetention,
  migrateItemsToFsrs,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  retrievability,
  seedFromSm2,
  seedFsrsItem,
} from "./fsrs.js";
import { createReviewItem, gradeReviewItem, previewReviewIntervals, restoreReviewItemFromAttempt } from "./review.js";

/**
 * Ground-truth vectors generated with ts-fsrs@3.5.7 (the last FSRS-4.5
 * engine; DECAY -0.5, FACTOR 19/81) under the canonical FSRS-4.5 default
 * weights from the algorithm wiki (cross-checked against fsrs-rs v0.6.4
 * DEFAULT_PARAMETERS), request_retention 0.9, maximum_interval 36500, fuzz
 * off. One card graded Good, Good, Again, Good, Hard, Easy at fixed day
 * offsets from 2026-01-01T00:00:00Z. Stability/difficulty are formula-exact
 * at every step (engine rounds to 8 decimals); scheduled_days applies on
 * transitions into Review (learning-step dues differ by design: Lumen uses a
 * 10-minute step where ts-fsrs uses 5 for relearning).
 */
const VECTORS = [
  { rating: "good", reviewedAt: "2026-01-01T00:00:00.000Z", stability: 3.7145, difficulty: 5.1618, state: "learning", scheduledDays: null },
  { rating: "good", reviewedAt: "2026-01-02T00:00:00.000Z", stability: 3.7145, difficulty: 5.1618, state: "review", scheduledDays: 4 },
  { rating: "again", reviewedAt: "2026-01-06T00:00:00.000Z", stability: 1.43323449, difficulty: 6.901155, state: "relearning", scheduledDays: null },
  { rating: "good", reviewedAt: "2026-01-07T00:00:00.000Z", stability: 1.43323449, difficulty: 6.901155, state: "review", scheduledDays: 1 },
  { rating: "hard", reviewedAt: "2026-01-17T00:00:00.000Z", stability: 4.69708208, difficulty: 7.71691249, state: "review", scheduledDays: 5 },
  { rating: "easy", reviewedAt: "2026-02-01T00:00:00.000Z", stability: 58.8665571, difficulty: 6.7680265, state: "review", scheduledDays: 59 },
];

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

test("the engine reproduces the ts-fsrs@3.5.7 ground-truth trajectory", () => {
  let item = { stability: 0, difficulty: 0, fsrsState: "", repetitions: 0, reviewCount: 0, lastReviewedAt: "", intervalDays: 0, ease: 2.5 };
  for (const [index, step] of VECTORS.entries()) {
    const graded = fsrsGrade(item, step.rating, new Date(step.reviewedAt), { requestRetention: 0.9 });
    close(graded.stability, step.stability, `step ${index + 1} stability`);
    close(graded.difficulty, step.difficulty, `step ${index + 1} difficulty`);
    assert.equal(graded.fsrsState, step.state, `step ${index + 1} state`);
    if (step.scheduledDays !== null) {
      assert.equal(graded.intervalDays, step.scheduledDays, `step ${index + 1} scheduled days`);
    }
    item = {
      ...item,
      stability: graded.stability,
      difficulty: graded.difficulty,
      fsrsState: graded.fsrsState,
      reviewCount: (item.reviewCount || 0) + 1,
      repetitions: step.rating === "again" ? 0 : (item.repetitions || 0) + 1,
      lastReviewedAt: step.reviewedAt,
    };
  }
});

test("core FSRS-4.5 formulas hold their spec identities", () => {
  for (const rating of [1, 2, 3, 4]) {
    close(initStability(rating), Math.max(FSRS_DEFAULT_WEIGHTS[rating - 1], 0.1), `S0(${rating})`);
    const difficulty = initDifficulty(rating);
    assert.ok(difficulty >= 1 && difficulty <= 10);
  }
  close(initDifficulty(3), FSRS_DEFAULT_WEIGHTS[4], "D0(Good) = w4");
  // Mean reversion pins Good-rated difficulty toward w4.
  close(nextDifficulty(FSRS_DEFAULT_WEIGHTS[4], 3), FSRS_DEFAULT_WEIGHTS[4], "reversion fixpoint");
  assert.equal(nextDifficulty(0.2, 4) >= 1, true, "difficulty clamps at 1");
  assert.equal(nextDifficulty(9.99, 1) <= 10, true, "difficulty clamps at 10");
  close(retrievability(7, 7), (1 + FSRS_FACTOR) ** FSRS_DECAY, "R(S, S)");
  assert.equal(intervalForRetention(20, 0.9), 20, "I(0.9, S) = S exactly at the default retention");
  assert.equal(intervalForRetention(20, 0.97) < 20, true, "higher retention shortens intervals");
  assert.equal(intervalForRetention(20, 0.7) > 20, true, "lower retention stretches intervals");
  assert.equal(intervalForRetention(20, 0.2), intervalForRetention(20, 0.7), "retention clamps to the sane band");
  // FSRS-4.5 applies NO min(S', S) cap after a lapse (the cap is FSRS-5+).
  // Prove the code path structurally with weights that push S' above S.
  const cappableWeights = FSRS_DEFAULT_WEIGHTS.map((weight, index) => (index === 11 ? 100 : weight));
  const uncapped = nextForgetStability(1, 1, 0.5, cappableWeights);
  assert.ok(uncapped > 1, `post-lapse stability must not be min-capped (${uncapped})`);
  assert.ok(nextRecallStability(5, 10, 0.9, 4) > nextRecallStability(5, 10, 0.9, 3), "easy bonus w16 raises stability");
  assert.ok(nextRecallStability(5, 10, 0.9, 2) < nextRecallStability(5, 10, 0.9, 3), "hard penalty w15 lowers stability");
});

test("migration seeds from replayable history first, labeled SM-2 heuristic second", () => {
  const attempts = VECTORS.map((step, index) => ({
    id: `a-${index}`,
    reviewItemId: "card-1",
    rating: step.rating,
    reviewedAt: step.reviewedAt,
  }));
  const historyItem = { id: "card-1", reviewCount: 6, repetitions: 3, lastReviewedAt: VECTORS.at(-1).reviewedAt, intervalDays: 59, ease: 2.5, stability: 0, difficulty: 0, fsrsState: "" };
  const replayed = seedFsrsItem(historyItem, attempts, { requestRetention: 0.9 });
  assert.equal(replayed.seededFrom, "history");
  close(replayed.stability, 58.8665571, "replayed stability matches the vector trajectory");
  close(replayed.difficulty, 6.7680265, "replayed difficulty matches the vector trajectory");

  const truncatedItem = { ...historyItem, id: "card-2", reviewCount: 9 };
  const fallback = seedFsrsItem(truncatedItem, [], {});
  assert.equal(fallback.seededFrom, "sm2", "a truncated trail falls back to the SM-2 heuristic");
  assert.equal(fallback.stability, 59, "Tier-2 stability = intervalDays because I(0.9, S) = S");
  close(fallback.difficulty, FSRS_DEFAULT_WEIGHTS[4], "ease 2.5 maps to D0(Good)");
  close(seedFromSm2({ intervalDays: 10, ease: 1.3 }).difficulty, 10, "ease 1.3 maps to maximum difficulty");

  const newItem = { id: "card-3", reviewCount: 0, repetitions: 0, lastReviewedAt: "", intervalDays: 0, ease: 2.5, stability: 0, difficulty: 0, fsrsState: "" };
  assert.equal(seedFsrsItem(newItem, [], {}), null, "new cards stay unseeded");

  const bulk = migrateItemsToFsrs([historyItem, truncatedItem, newItem], attempts, {});
  assert.equal(bulk.fromHistory, 1);
  assert.equal(bulk.fromSm2, 1);
  assert.equal(bulk.items[2].fsrsState, "", "bulk migration never touches new cards");
});

test("gradeReviewItem under the fsrs scheduler keeps legacy fields and undo intact", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const card = createReviewItem({ front: "Q", back: "A" }, now);
  assert.equal(card.stability, 0);
  assert.equal(card.fsrsState, "");

  const first = gradeReviewItem(card, "good", now, 800, { scheduler: "fsrs", requestRetention: 0.9 });
  close(first.item.stability, 3.7145, "first Good stores S0(Good)");
  assert.equal(first.item.fsrsState, "learning");
  assert.equal(first.item.repetitions, 1, "legacy repetitions keep counting");
  assert.equal(first.item.ease, card.ease, "ease is frozen under FSRS");
  assert.equal(first.attempt.previousState.stability, 0, "undo snapshot carries FSRS fields");

  const restored = restoreReviewItemFromAttempt(first.item, first.attempt);
  assert.equal(restored.stability, 0, "undo restores the pre-grade FSRS state");
  assert.equal(restored.fsrsState, "");

  const graduated = gradeReviewItem(first.item, "good", new Date("2026-01-02T00:00:00.000Z"), 500, { scheduler: "fsrs", requestRetention: 0.9 });
  assert.equal(graduated.item.intervalDays, 4, "legacy intervalDays mirrors the FSRS interval");
  assert.equal(graduated.item.fsrsState, "review");

  const preview = previewReviewIntervals(graduated.item, { scheduler: "fsrs", requestRetention: 0.9 });
  assert.ok(preview.hard < preview.good && preview.good < preview.easy, "preview honors the interval-ordering rules");
  const sm2Preview = previewReviewIntervals(graduated.item);
  assert.notDeepEqual(preview, sm2Preview, "the two schedulers genuinely differ");

  // An SM-2-era card graded under FSRS receives the inline Tier-2 seed.
  const legacy = { ...createReviewItem({ front: "L", back: "A" }, now), repetitions: 4, reviewCount: 5, lastReviewedAt: "2025-12-01T00:00:00.000Z", intervalDays: 20, ease: 2.5, dueAt: "2026-01-01T00:00:00.000Z" };
  const seededGrade = gradeReviewItem(legacy, "good", now, 900, { scheduler: "fsrs", requestRetention: 0.9 });
  assert.ok(seededGrade.item.stability > 0, "grading an unseeded legacy card seeds it inline");
  assert.equal(seededGrade.item.fsrsState, "review");
});
