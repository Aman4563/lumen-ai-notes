/**
 * FSRS-4.5 scheduler (issue #16, opt-in — SM-2 stays the default).
 *
 * Formulas and default weights follow the FSRS-4.5 specification at
 * https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm,
 * cross-validated against ts-fsrs@3.5.7 (the last FSRS-4.5 engine) and
 * fsrs-rs v0.6.4 DEFAULT_PARAMETERS. Ground-truth vectors generated with
 * ts-fsrs@3.5.7 pin this implementation in fsrs.test.mjs.
 *
 * Version discipline: FSRS-5/6 changed D0, the mean-reversion target, the
 * decay constant, and the weight count — never mix constants across versions
 * or validate against a newer engine.
 */
export const FSRS_DEFAULT_WEIGHTS = Object.freeze([
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
]);
export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81;
export const FSRS_DEFAULT_RETENTION = 0.9;
export const FSRS_STATES = Object.freeze(["", "learning", "review", "relearning"]);

const DAY_MS = 86_400_000;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
// ts-fsrs rounds stored stability/difficulty to 8 decimals after every
// review; matching it keeps multi-step trajectories byte-comparable.
const round8 = (value) => Math.round(value * 1e8) / 1e8;

export const initStability = (rating, weights = FSRS_DEFAULT_WEIGHTS) => Math.max(weights[rating - 1], 0.1);

export const initDifficulty = (rating, weights = FSRS_DEFAULT_WEIGHTS) => clamp(weights[4] - (rating - 3) * weights[5], 1, 10);

/** Mean reversion targets D0(Good) = w4 in FSRS-4.5 (FSRS-5 moved it). */
export const nextDifficulty = (difficulty, rating, weights = FSRS_DEFAULT_WEIGHTS) => clamp(
  weights[7] * weights[4] + (1 - weights[7]) * (difficulty - weights[6] * (rating - 3)),
  1,
  10,
);

export const retrievability = (elapsedDays, stability) => (1 + FSRS_FACTOR * (Math.max(0, elapsedDays) / stability)) ** FSRS_DECAY;

export const nextRecallStability = (difficulty, stability, recall, rating, weights = FSRS_DEFAULT_WEIGHTS) => stability * (
  1 + Math.exp(weights[8])
    * (11 - difficulty)
    * stability ** -weights[9]
    * (Math.exp(weights[10] * (1 - recall)) - 1)
    * (rating === 2 ? weights[15] : 1)
    * (rating === 4 ? weights[16] : 1)
);

/** No min(S', S) cap in FSRS-4.5 — the cap arrived in FSRS-5+. */
export const nextForgetStability = (difficulty, stability, recall, weights = FSRS_DEFAULT_WEIGHTS) => weights[11]
  * difficulty ** -weights[12]
  * ((stability + 1) ** weights[13] - 1)
  * Math.exp(weights[14] * (1 - recall));

export const intervalForRetention = (stability, retention = FSRS_DEFAULT_RETENTION, maximumDays = 36_500) => {
  const bounded = clamp(retention, 0.7, 0.97);
  return clamp(Math.round(stability * ((bounded ** (1 / FSRS_DECAY) - 1) / FSRS_FACTOR)), 1, maximumDays);
};

const RATING_NUMBERS = { again: 1, hard: 2, good: 3, easy: 4 };
const LEARNING_STEP_DAYS = 10 / 1_440; // Lumen keeps its 10-minute step for Again/learning.

const isUnseeded = (item) => !(Number(item.stability) > 0) || !FSRS_STATES.includes(item.fsrsState) || item.fsrsState === "";

const isNewItem = (item) => (Number(item.repetitions) || 0) === 0 && !item.lastReviewedAt && (Number(item.reviewCount) || 0) === 0;

/**
 * Tier-2 seeding for cards with SM-2 history but no replayable attempt trail:
 * S = intervalDays because I(0.9, S) = S exactly (wiki), and a labeled linear
 * heuristic maps ease 2.5 → D0(Good) = w4 and ease 1.3 → 10. Neither the wiki
 * nor ts-fsrs prescribes an official SM-2 conversion — Tier 1 replay is the
 * faithful path; this is the explicit fallback.
 */
export const seedFromSm2 = (item, weights = FSRS_DEFAULT_WEIGHTS) => ({
  stability: clamp(Number(item.intervalDays) || 0.1, 0.1, 36_500),
  difficulty: clamp(weights[4] + (2.5 - (Number(item.ease) || 2.5)) * ((10 - weights[4]) / 1.2), 1, 10),
  fsrsState: "review",
});

/**
 * Grades one card under FSRS-4.5. Pure: the caller owns persistence. Unseeded
 * non-new cards receive the Tier-2 seed inline so sync replay stays
 * deterministic without needing the attempt stream.
 */
export const fsrsGrade = (item, ratingId, now = new Date(), {
  requestRetention = FSRS_DEFAULT_RETENTION,
  weights = FSRS_DEFAULT_WEIGHTS,
} = {}) => {
  const rating = RATING_NUMBERS[ratingId];
  if (!rating) throw new Error("Unknown review rating");

  if (isNewItem(item) && isUnseeded(item)) {
    const stability = round8(initStability(rating, weights));
    const difficulty = round8(initDifficulty(rating, weights));
    if (rating === 4) {
      return { stability, difficulty, fsrsState: "review", intervalDays: intervalForRetention(stability, requestRetention), lapse: false };
    }
    return { stability, difficulty, fsrsState: "learning", intervalDays: LEARNING_STEP_DAYS, lapse: false };
  }

  const seeded = isUnseeded(item) ? { ...item, ...seedFromSm2(item, weights) } : item;
  const stability = Number(seeded.stability);
  const difficulty = Number(seeded.difficulty);
  const state = seeded.fsrsState || "review";

  if (state === "learning" || state === "relearning") {
    // FSRS-4.5 has no short-term memory model: graduating keeps S/D as-is.
    if (rating >= 3) {
      return { stability, difficulty, fsrsState: "review", intervalDays: intervalForRetention(stability, requestRetention), lapse: false };
    }
    return { stability, difficulty, fsrsState: state, intervalDays: LEARNING_STEP_DAYS, lapse: false };
  }

  const lastReviewedMs = Date.parse(seeded.lastReviewedAt || "") || now.getTime();
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - lastReviewedMs) / DAY_MS));
  // ts-fsrs also stores retrievability rounded to 8 decimals before use.
  const recall = round8(retrievability(elapsedDays, stability));
  const nextD = round8(nextDifficulty(difficulty, rating, weights));

  if (rating === 1) {
    return {
      stability: round8(nextForgetStability(difficulty, stability, recall, weights)),
      difficulty: nextD,
      fsrsState: "relearning",
      intervalDays: LEARNING_STEP_DAYS,
      lapse: true,
    };
  }

  // Per-rating stabilities feed the ts-fsrs interval-ordering rules so a
  // Hard interval can never exceed Good, nor Good reach Easy.
  const stabilityFor = (candidate) => round8(nextRecallStability(difficulty, stability, recall, candidate, weights));
  let hardInterval = intervalForRetention(stabilityFor(2), requestRetention);
  let goodInterval = intervalForRetention(stabilityFor(3), requestRetention);
  hardInterval = Math.min(hardInterval, goodInterval);
  goodInterval = Math.max(goodInterval, hardInterval + 1);
  const easyInterval = Math.max(intervalForRetention(stabilityFor(4), requestRetention), goodInterval + 1);

  return {
    stability: stabilityFor(rating),
    difficulty: nextD,
    fsrsState: "review",
    intervalDays: rating === 2 ? hardInterval : rating === 3 ? goodInterval : easyInterval,
    lapse: false,
  };
};

/**
 * One-time migration when the learner enables FSRS. Tier 1 replays the card's
 * complete attempt history (rating + reviewedAt) through the engine from a
 * New card; the trail is complete only when the stored attempts cover every
 * recorded review (the rolling attempt log caps at 50,000 and drops deleted
 * cards). Anything else falls back to the labeled Tier-2 SM-2 seed. New
 * cards stay untouched.
 */
export const seedFsrsItem = (item, attempts = [], options = {}) => {
  if (!isUnseeded(item)) return null;
  if (isNewItem(item)) return null;
  const trail = attempts
    .filter((attempt) => attempt.reviewItemId === item.id)
    .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) || String(left.id).localeCompare(String(right.id)));
  if (trail.length > 0 && trail.length >= (Number(item.reviewCount) || 0)) {
    let replayed = { stability: 0, difficulty: 0, fsrsState: "", repetitions: 0, reviewCount: 0, lastReviewedAt: "", intervalDays: 0, ease: 2.5 };
    for (const attempt of trail) {
      const graded = fsrsGrade(replayed, attempt.rating, new Date(Date.parse(attempt.reviewedAt)), options);
      replayed = {
        ...replayed,
        stability: graded.stability,
        difficulty: graded.difficulty,
        fsrsState: graded.fsrsState,
        reviewCount: (replayed.reviewCount || 0) + 1,
        repetitions: attempt.rating === "again" ? 0 : (replayed.repetitions || 0) + 1,
        lastReviewedAt: attempt.reviewedAt,
      };
    }
    return { stability: replayed.stability, difficulty: replayed.difficulty, fsrsState: replayed.fsrsState, seededFrom: "history" };
  }
  return { ...seedFromSm2(item), seededFrom: "sm2" };
};

export const migrateItemsToFsrs = (items = [], attempts = [], options = {}) => {
  let fromHistory = 0;
  let fromSm2 = 0;
  const migrated = items.map((item) => {
    const seed = seedFsrsItem(item, attempts, options);
    if (!seed) return item;
    if (seed.seededFrom === "history") fromHistory += 1;
    else fromSm2 += 1;
    return { ...item, stability: seed.stability, difficulty: seed.difficulty, fsrsState: seed.fsrsState };
  });
  return { items: migrated, fromHistory, fromSm2 };
};
