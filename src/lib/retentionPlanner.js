import { FSRS_DEFAULT_WEIGHTS, intervalForRetention } from "./fsrs.js";

/**
 * Retention-vs-workload analytics (issue #16, LEARN-003).
 *
 * The FSRS target retention is a dial between memory and time: higher
 * retention means shorter intervals and more daily reviews. In scheduling
 * steady state a card with interval I contributes ~1/I reviews per day, so
 * the expected daily workload at candidate retention R is the sum of
 * 1/intervalForRetention(S, R) over every FSRS-seeded active card. That
 * approximation is exact for a stable deck and honest enough for a planning
 * dial. Cards in learning/relearning steps join the curve through their
 * current stability (their post-graduation interval is I(R, S)); cards
 * without FSRS state (SM-2) are counted separately, never pretended in.
 */
export const RETENTION_CHOICES = Object.freeze([0.8, 0.85, 0.9, 0.95]);

export const retentionWorkloadCurve = (items = [], { retentions = RETENTION_CHOICES } = {}) => {
  const seeded = [];
  let unseeded = 0;
  for (const item of items) {
    if (item?.archived || item?.suspended) continue;
    if (Number(item?.stability) > 0 && ["review", "learning", "relearning"].includes(item?.fsrsState)) seeded.push(Number(item.stability));
    else unseeded += 1;
  }
  const rows = retentions.map((retention) => {
    let dailyReviews = 0;
    let intervalSum = 0;
    for (const stability of seeded) {
      const interval = Math.max(1, intervalForRetention(stability, retention));
      dailyReviews += 1 / interval;
      intervalSum += interval;
    }
    return {
      retention,
      dailyReviews: Math.round(dailyReviews * 10) / 10,
      averageIntervalDays: seeded.length ? Math.round((intervalSum / seeded.length) * 10) / 10 : 0,
    };
  });
  return { rows, seededCount: seeded.length, unseededCount: unseeded };
};

export { FSRS_DEFAULT_WEIGHTS };
