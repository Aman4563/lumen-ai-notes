import {
  FSRS_DEFAULT_WEIGHTS,
  initDifficulty,
  initStability,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  retrievability,
} from "./fsrs.js";

/**
 * Per-learner FSRS-4.5 weight calibration (issue #16).
 *
 * The learner's review history is the training set: every review of a card
 * already in the `review` state is a labeled prediction — the scheduler's
 * retrievability at review time against whether the learner actually
 * recalled (any grade above Again). Calibration replays the whole history
 * under candidate weights and minimizes mean binary log-loss with a
 * sign-based descent (Rprop-lite): deterministic, derivative-free per-weight
 * steps that grow 1.2× while the numeric-gradient sign holds and halve on a
 * flip. A small L2 pull toward the published defaults keeps low-data runs
 * from wandering, per-weight clamps mirror the official optimizer's bounds,
 * and a result is only accepted when it measurably beats the defaults on the
 * same data. No randomness anywhere — the same history always yields the
 * same weights.
 *
 * Replay for training is the smooth (unrounded) mirror of `fsrsGrade`:
 * scheduler parity rounding would only quantize the loss surface.
 */
export const MIN_CALIBRATION_PREDICTIONS = 50;
export const MIN_CALIBRATION_LAPSES = 5;
const ITERATIONS = 40;
const L2_LAMBDA = 0.001;
const DAY_MS = 86_400_000;
const RATING_NUMBERS = { again: 1, hard: 2, good: 3, easy: 4 };

/** Approximation of the official FSRS-4.5 optimizer's per-weight clamps. */
export const FSRS_WEIGHT_BOUNDS = Object.freeze([
  [0.1, 100], [0.1, 100], [0.1, 100], [0.1, 100],
  [1, 10], [0.1, 5], [0.1, 5], [0, 0.75],
  [0, 4], [0.05, 0.8], [0.01, 3], [0.2, 5],
  [0.01, 0.25], [0.01, 0.9], [0.01, 3], [0, 1], [1, 6],
]);

const clampWeight = (value, index) => Math.min(FSRS_WEIGHT_BOUNDS[index][1], Math.max(FSRS_WEIGHT_BOUNDS[index][0], value));

export const normalizeFsrsWeights = (value) => {
  if (!Array.isArray(value) || value.length !== FSRS_DEFAULT_WEIGHTS.length) return null;
  const weights = value.map(Number);
  if (weights.some((weight) => !Number.isFinite(weight))) return null;
  return weights.map((weight, index) => clampWeight(weight, index));
};

/**
 * Chronological review-state chains per card. Only attempts whose card was
 * already in the `review` state produce (prediction, outcome) pairs; first
 * reviews and learning-step graduations shape state but predict nothing.
 */
export const buildTrainingSequences = (attempts = []) => {
  const byCard = new Map();
  for (const attempt of attempts) {
    const rating = RATING_NUMBERS[attempt?.rating];
    const reviewedMs = Date.parse(attempt?.reviewedAt || "");
    if (!rating || !Number.isFinite(reviewedMs) || !attempt.reviewItemId) continue;
    if (!byCard.has(attempt.reviewItemId)) byCard.set(attempt.reviewItemId, []);
    byCard.get(attempt.reviewItemId).push({ rating, reviewedMs });
  }
  const sequences = [...byCard.values()];
  for (const sequence of sequences) sequence.sort((left, right) => left.reviewedMs - right.reviewedMs);
  return sequences;
};

const EPSILON = 1e-6;

/** Mean BCE of the history replayed under `weights`, plus the L2 pull. */
export const calibrationLoss = (sequences, weights, { lambda = L2_LAMBDA } = {}) => {
  let loss = 0;
  let predictions = 0;
  let lapses = 0;
  for (const sequence of sequences) {
    let stability = 0;
    let difficulty = 0;
    let state = "";
    let lastReviewedMs = 0;
    for (const review of sequence) {
      const { rating, reviewedMs } = review;
      if (!state) {
        stability = initStability(rating, weights);
        difficulty = initDifficulty(rating, weights);
        state = rating === 4 ? "review" : "learning";
        lastReviewedMs = reviewedMs;
        continue;
      }
      if (state === "learning" || state === "relearning") {
        if (rating >= 3) state = "review";
        lastReviewedMs = reviewedMs;
        continue;
      }
      const elapsedDays = Math.max(0, Math.floor((reviewedMs - lastReviewedMs) / DAY_MS));
      const recall = Math.min(1 - EPSILON, Math.max(EPSILON, retrievability(elapsedDays, stability)));
      const recalled = rating > 1;
      loss += recalled ? -Math.log(recall) : -Math.log(1 - recall);
      predictions += 1;
      if (!recalled) lapses += 1;
      difficulty = nextDifficulty(difficulty, rating, weights);
      if (rating === 1) {
        stability = nextForgetStability(difficulty, stability, recall, weights);
        state = "relearning";
      } else {
        stability = nextRecallStability(difficulty, stability, recall, rating, weights);
      }
      lastReviewedMs = reviewedMs;
    }
  }
  if (!predictions) return { loss: Infinity, predictions: 0, lapses: 0 };
  let regularization = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const scale = Math.max(Math.abs(FSRS_DEFAULT_WEIGHTS[index]), 0.1);
    regularization += ((weights[index] - FSRS_DEFAULT_WEIGHTS[index]) / scale) ** 2;
  }
  return { loss: loss / predictions + lambda * regularization, predictions, lapses };
};

/**
 * Calibrates the 17 weights against the learner's history. Returns a typed
 * refusal when the data cannot support optimization, and returns the
 * defaults verdict honestly when descent cannot beat them.
 */
export const optimizeFsrsWeights = (attempts = [], {
  minPredictions = MIN_CALIBRATION_PREDICTIONS,
  minLapses = MIN_CALIBRATION_LAPSES,
  iterations = ITERATIONS,
} = {}) => {
  const sequences = buildTrainingSequences(attempts);
  const baseline = calibrationLoss(sequences, [...FSRS_DEFAULT_WEIGHTS]);
  if (baseline.predictions < minPredictions) {
    return { ok: false, code: "NOT_ENOUGH_REVIEWS", reason: `Calibration needs at least ${minPredictions} spaced reviews; the history has ${baseline.predictions}. Keep reviewing — every graded card adds signal.` };
  }
  if (baseline.lapses < minLapses) {
    return { ok: false, code: "NOT_ENOUGH_LAPSES", reason: `Calibration needs at least ${minLapses} lapses (Again grades on spaced reviews) to see where memory actually fails; the history has ${baseline.lapses}.` };
  }

  const weights = [...FSRS_DEFAULT_WEIGHTS];
  const steps = FSRS_DEFAULT_WEIGHTS.map((weight) => Math.max(Math.abs(weight), 0.1) * 0.03);
  const previousSigns = new Array(weights.length).fill(0);
  let current = baseline.loss;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < weights.length; index += 1) {
      const h = Math.max(1e-4, Math.abs(weights[index]) * 1e-3);
      const up = [...weights];
      up[index] = clampWeight(weights[index] + h, index);
      const down = [...weights];
      down[index] = clampWeight(weights[index] - h, index);
      const gradient = (calibrationLoss(sequences, up).loss - calibrationLoss(sequences, down).loss) / (up[index] - down[index] || h);
      const sign = Math.sign(gradient);
      if (sign === 0) continue;
      const scale = Math.max(Math.abs(FSRS_DEFAULT_WEIGHTS[index]), 0.1);
      if (sign === previousSigns[index]) steps[index] = Math.min(steps[index] * 1.2, scale * 0.1);
      else if (previousSigns[index] !== 0) steps[index] = Math.max(steps[index] * 0.5, scale * 0.001);
      previousSigns[index] = sign;
      const candidateWeights = [...weights];
      candidateWeights[index] = clampWeight(weights[index] - sign * steps[index], index);
      const candidate = calibrationLoss(sequences, candidateWeights).loss;
      if (candidate < current) {
        weights[index] = candidateWeights[index];
        current = candidate;
      } else {
        steps[index] = Math.max(steps[index] * 0.5, scale * 0.001);
      }
    }
  }

  const rounded = weights.map((weight, index) => clampWeight(Math.round(weight * 1e4) / 1e4, index));
  const after = calibrationLoss(sequences, rounded);
  if (!(after.loss < baseline.loss - 1e-4)) {
    return { ok: false, code: "DEFAULTS_ALREADY_FIT", reason: "The published FSRS weights already fit this review history — calibration found nothing meaningfully better.", beforeLogLoss: baseline.loss, afterLogLoss: after.loss, predictions: baseline.predictions };
  }
  return {
    ok: true,
    weights: rounded,
    beforeLogLoss: Math.round(baseline.loss * 1e6) / 1e6,
    afterLogLoss: Math.round(after.loss * 1e6) / 1e6,
    predictions: baseline.predictions,
    lapses: baseline.lapses,
  };
};
