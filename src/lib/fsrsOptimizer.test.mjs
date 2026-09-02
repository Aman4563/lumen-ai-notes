import assert from "node:assert/strict";
import { test } from "node:test";

import { FSRS_DEFAULT_WEIGHTS, fsrsGrade, initDifficulty, initStability, nextDifficulty, nextForgetStability, nextRecallStability, retrievability } from "./fsrs.js";
import {
  FSRS_WEIGHT_BOUNDS,
  MIN_CALIBRATION_LAPSES,
  MIN_CALIBRATION_PREDICTIONS,
  buildTrainingSequences,
  calibrationLoss,
  normalizeFsrsWeights,
  optimizeFsrsWeights,
} from "./fsrsOptimizer.js";

/** Deterministic pseudo-random in [0,1) — no Math.random anywhere. */
const pseudoRandom = (seed) => {
  let value = (seed * 2654435761) % 4294967296;
  value = (value * 1103515245 + 12345) % 2147483648;
  return value / 2147483648;
};

/**
 * A learner whose memory decays about twice as fast as the defaults predict:
 * recall outcomes are sampled from retrievability at DOUBLE the elapsed
 * time. Calibration should therefore beat the defaults on this history.
 */
const fastForgettingHistory = ({ cards = 60, steps = 8 } = {}) => {
  const attempts = [];
  const baseMs = Date.parse("2026-01-01T09:00:00.000Z");
  for (let card = 0; card < cards; card += 1) {
    let stability = 0;
    let difficulty = 0;
    let state = "";
    let atMs = baseMs + card * 3_600_000;
    for (let step = 0; step < steps; step += 1) {
      let rating;
      if (!state) {
        rating = 3;
        stability = initStability(rating, FSRS_DEFAULT_WEIGHTS);
        difficulty = initDifficulty(rating, FSRS_DEFAULT_WEIGHTS);
        state = "learning";
      } else if (state !== "review") {
        rating = 3;
        state = "review";
      } else {
        const elapsedDays = Math.min(64, 2 ** step);
        atMs += elapsedDays * 86_400_000;
        const trueRecall = retrievability(elapsedDays * 2, stability);
        const recalled = pseudoRandom(card * 1_000 + step) < trueRecall;
        rating = recalled ? 3 : 1;
        const observedRecall = retrievability(elapsedDays, stability);
        difficulty = nextDifficulty(difficulty, rating, FSRS_DEFAULT_WEIGHTS);
        stability = recalled
          ? nextRecallStability(difficulty, stability, observedRecall, rating, FSRS_DEFAULT_WEIGHTS)
          : nextForgetStability(difficulty, stability, observedRecall, FSRS_DEFAULT_WEIGHTS);
        if (!recalled) state = "relearning";
      }
      attempts.push({ id: `attempt-${card}-${step}`, reviewItemId: `card-${card}`, rating: rating === 1 ? "again" : "good", reviewedAt: new Date(atMs + step).toISOString() });
    }
  }
  return attempts;
};

test("calibration beats the defaults on a fast-forgetting learner, deterministically", () => {
  const attempts = fastForgettingHistory();
  const first = optimizeFsrsWeights(attempts);
  assert.equal(first.ok, true, `expected calibration to run: ${first.reason || ""}`);
  assert.ok(first.afterLogLoss < first.beforeLogLoss, `log-loss must improve (${first.beforeLogLoss} → ${first.afterLogLoss})`);
  assert.ok(first.predictions >= MIN_CALIBRATION_PREDICTIONS);
  assert.ok(first.lapses >= MIN_CALIBRATION_LAPSES);
  first.weights.forEach((weight, index) => {
    assert.ok(Number.isFinite(weight), `weight ${index} must be finite`);
    assert.ok(weight >= FSRS_WEIGHT_BOUNDS[index][0] && weight <= FSRS_WEIGHT_BOUNDS[index][1], `weight ${index}=${weight} escaped its bounds`);
  });
  const second = optimizeFsrsWeights(attempts);
  assert.deepEqual(second.weights, first.weights, "the same history must always yield the same weights");
  assert.notDeepEqual(first.weights, [...FSRS_DEFAULT_WEIGHTS], "calibration must actually move the weights");
});

test("thin or degenerate histories refuse typed instead of overfitting", () => {
  const few = fastForgettingHistory({ cards: 3, steps: 4 });
  assert.equal(optimizeFsrsWeights(few).code, "NOT_ENOUGH_REVIEWS");

  const allRecall = [];
  const baseMs = Date.parse("2026-01-01T09:00:00.000Z");
  for (let card = 0; card < 30; card += 1) {
    for (let step = 0; step < 6; step += 1) {
      allRecall.push({ id: `a-${card}-${step}`, reviewItemId: `card-${card}`, rating: "good", reviewedAt: new Date(baseMs + card * 3_600_000 + step * 3 * 86_400_000).toISOString() });
    }
  }
  assert.equal(optimizeFsrsWeights(allRecall).code, "NOT_ENOUGH_LAPSES");
});

test("training sequences drop malformed attempts and sort by time", () => {
  const sequences = buildTrainingSequences([
    { reviewItemId: "card-1", rating: "good", reviewedAt: "2026-01-02T00:00:00.000Z" },
    { reviewItemId: "card-1", rating: "again", reviewedAt: "2026-01-01T00:00:00.000Z" },
    { reviewItemId: "card-1", rating: "nonsense", reviewedAt: "2026-01-03T00:00:00.000Z" },
    { reviewItemId: "", rating: "good", reviewedAt: "2026-01-03T00:00:00.000Z" },
    { reviewItemId: "card-1", rating: "good", reviewedAt: "not a date" },
  ]);
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0].map((review) => review.rating), [1, 3]);
});

test("loss is finite on same-day lapses and infinite only without predictions", () => {
  const sameDay = buildTrainingSequences([
    { reviewItemId: "card-1", rating: "easy", reviewedAt: "2026-01-01T00:00:00.000Z" },
    { reviewItemId: "card-1", rating: "again", reviewedAt: "2026-01-01T01:00:00.000Z" },
  ]);
  assert.ok(Number.isFinite(calibrationLoss(sameDay, [...FSRS_DEFAULT_WEIGHTS]).loss), "an elapsed-0 lapse must not produce -Infinity");
  assert.equal(calibrationLoss([], [...FSRS_DEFAULT_WEIGHTS]).loss, Infinity);
});

test("stored weights normalize with clamps and reject malformed shapes", () => {
  assert.equal(normalizeFsrsWeights(null), null);
  assert.equal(normalizeFsrsWeights([1, 2, 3]), null);
  assert.equal(normalizeFsrsWeights([...FSRS_DEFAULT_WEIGHTS.slice(0, 16), Number.NaN]), null);
  const clamped = normalizeFsrsWeights(FSRS_DEFAULT_WEIGHTS.map(() => 10_000));
  assert.ok(clamped.every((weight, index) => weight === FSRS_WEIGHT_BOUNDS[index][1]));
});

test("custom weights change real scheduling through fsrsGrade", () => {
  const item = { stability: 10, difficulty: 5, fsrsState: "review", repetitions: 3, reviewCount: 3, lastReviewedAt: "2026-01-01T00:00:00.000Z" };
  const now = new Date("2026-01-11T00:00:00.000Z");
  const withDefaults = fsrsGrade(item, "good", now);
  const softer = [...FSRS_DEFAULT_WEIGHTS];
  softer[8] = 0.5; // shrink the recall-stability gain
  const withCustom = fsrsGrade(item, "good", now, { weights: softer });
  assert.ok(withCustom.stability < withDefaults.stability, "a smaller w8 must grow stability more slowly");
  assert.ok(withCustom.intervalDays <= withDefaults.intervalDays);
});
