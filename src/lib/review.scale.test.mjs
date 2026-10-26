import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { buildReviewQueue, isNewReviewItem, reviewAnalytics, reviewStats } from "./review.js";

const DAY_MS = 86_400_000;

const makeScaleCards = (now) => Array.from({ length: 10_000 }, (_, index) => {
  const isNew = index % 2 === 0;
  const isFuture = index % 4 === 0;
  return {
    id: `card-${String(index).padStart(5, "0")}`,
    front: `Prompt ${index}`,
    back: `Answer ${index}`,
    dueAt: new Date(now.getTime() + (isFuture ? DAY_MS : -3_600_000)).toISOString(),
    createdAt: new Date(now.getTime() - index).toISOString(),
    suspended: false,
    archived: false,
    buriedOnDay: "",
    reviewCount: isNew ? 0 : 1,
    lastReviewedAt: isNew ? "" : new Date(now.getTime() - DAY_MS).toISOString(),
    repetitions: isNew ? 0 : 1,
    intervalDays: isNew ? 0 : 3,
    ease: 2.5,
    lapses: 0,
  };
});

test("10,000-card queue and statistics stay correct within the interaction budget", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const cards = makeScaleCards(now);

  const startedAt = performance.now();
  const queue = buildReviewQueue(cards, { dailyNewLimit: 10_000, dailyReviewLimit: 10_000 }, now, [], { timeZone: "UTC" });
  const stats = reviewStats(cards, now, "UTC");
  const elapsed = performance.now() - startedAt;

  assert.equal(queue.length, 7_500);
  assert.ok(queue.slice(0, 5_000).every((item) => !isNewReviewItem(item)), "due reviews must remain ahead of new cards");
  assert.ok(queue.slice(5_000).every(isNewReviewItem));
  assert.deepEqual(stats, { due: 7_500, overdue: 0, newCount: 5_000, learning: 5_000, mastered: 0, suspended: 0, archived: 0 });
  assert.ok(elapsed < 2_000, `10,000-card queue and stats took ${Math.round(elapsed)}ms (limit: 2000ms)`);

});

test("50,000-attempt analytics counts scheduled reviews in one pass and keeps streak, latency, and forecast", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const cards = makeScaleCards(now);
  // #151: realistic attempts, oldest first, 1,250 a day for 40 days. Within a day, slot s grades
  // card s % 625, so each card is graded twice a day (two devices before a sync). Slots ending
  // in 0–3 are Extra practice, a new card's first grade, a learning step and a legacy attempt
  // stored with a 0-day interval; the rest are scheduled reviews.
  const kinds = ["crunch", "new", "step", "legacy"];
  const attempts = Array.from({ length: 50_000 }, (_, index) => {
    const slot = index % 1_250;
    const kind = kinds[slot % 10] ?? "scheduled";
    return {
      id: `attempt-${index}`,
      reviewItemId: `card-${String(slot % 625).padStart(5, "0")}`,
      reviewedAt: new Date(now.getTime() - (39 - Math.floor(index / 1_250)) * DAY_MS).toISOString(),
      rating: kind === "crunch" ? (slot % 3 ? "again" : "good") : slot % 4 === 0 ? "again" : "good",
      elapsedMs: index % 1_000,
      sessionKind: kind === "crunch" ? "crunch" : kind === "new" ? "new" : "review",
      crunch: kind === "crunch",
      previousIntervalDays: kind === "new" || kind === "legacy" ? 0 : kind === "step" ? 10 / 1_440 : 1 + (slot % 30),
    };
  });
  // The rule, mirrored: a card's first counted attempt each day, outside Extra practice. Every
  // attempt within 30 days counts towards the median, and towards what main computes.
  let count7 = 0; let retained7 = 0; let count30 = 0; let retained30 = 0; let attemptsIn30 = 0; let retainedAll30 = 0;
  const latencies30 = [];
  const counted = new Set();
  attempts.forEach((attempt, index) => {
    const daysAgo = 39 - Math.floor(index / 1_250);
    const key = `${attempt.reviewItemId}|${daysAgo}`;
    const scheduled = attempt.sessionKind === "review" && !attempt.crunch && attempt.previousIntervalDays >= 1 && !counted.has(key);
    if (scheduled) counted.add(key);
    const retained = attempt.rating !== "again";
    if (scheduled && daysAgo <= 7) { count7 += 1; if (retained) retained7 += 1; }
    if (daysAgo <= 30) {
      attemptsIn30 += 1;
      if (retained) retainedAll30 += 1;
      latencies30.push(attempt.elapsedMs);
      if (scheduled) { count30 += 1; if (retained) retained30 += 1; }
    }
  });
  latencies30.sort((left, right) => left - right);
  assert.equal(count7, 5_000); // 8 days × 625 cards: one counted attempt per card and day
  assert.equal(count30, 19_375); // 31 days × 625

  const startedAt = performance.now();
  const analytics = reviewAnalytics(attempts, cards, now, "UTC");
  const elapsed = performance.now() - startedAt;

  assert.equal(analytics.scheduledReviews7, count7);
  assert.equal(analytics.scheduledReviews30, count30);
  assert.equal(analytics.retention7, Math.round((retained7 / count7) * 100)); // 75
  assert.equal(analytics.retention30, Math.round((retained30 / count30) * 100)); // 75
  assert.notEqual(analytics.retention30, Math.round((retainedAll30 / attemptsIn30) * 100), "the fixture must give a different figure than counting every attempt (main: 73)");
  assert.equal(analytics.medianLatencyMs, latencies30[Math.floor(latencies30.length / 2)]);
  assert.equal(analytics.streak, 40);
  assert.deepEqual(analytics.forecast, [0, 2_500, 0, 0, 0, 0, 0]);
  assert.ok(elapsed < 4_000, `50,000-attempt analytics took ${Math.round(elapsed)}ms (limit: 4000ms)`);
});
