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

test("50,000-attempt analytics uses one pass and preserves retention, streak, latency, and forecast", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const attempts = Array.from({ length: 50_000 }, (_, index) => ({
    reviewedAt: new Date(now.getTime() - (index % 40) * DAY_MS).toISOString(),
    rating: index % 5 === 0 ? "again" : "good",
    elapsedMs: index % 1_000,
  }));
  const cards = makeScaleCards(now);

  let count7 = 0;
  let retained7 = 0;
  let count30 = 0;
  let retained30 = 0;
  const latencies30 = [];
  for (let index = 0; index < attempts.length; index += 1) {
    const dayOffset = index % 40;
    const retained = index % 5 !== 0;
    if (dayOffset <= 7) { count7 += 1; if (retained) retained7 += 1; }
    if (dayOffset <= 30) {
      count30 += 1;
      if (retained) retained30 += 1;
      latencies30.push(index % 1_000);
    }
  }
  latencies30.sort((left, right) => left - right);

  const startedAt = performance.now();
  const analytics = reviewAnalytics(attempts, cards, now, "UTC");
  const elapsed = performance.now() - startedAt;

  assert.equal(analytics.retention7, Math.round((retained7 / count7) * 100));
  assert.equal(analytics.retention30, Math.round((retained30 / count30) * 100));
  assert.equal(analytics.medianLatencyMs, latencies30[Math.floor(latencies30.length / 2)]);
  assert.equal(analytics.streak, 40);
  assert.deepEqual(analytics.forecast, [0, 2_500, 0, 0, 0, 0, 0]);
  assert.ok(elapsed < 4_000, `50,000-attempt analytics took ${Math.round(elapsed)}ms (limit: 4000ms)`);
});
