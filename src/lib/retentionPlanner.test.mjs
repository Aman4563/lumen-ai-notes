import assert from "node:assert/strict";
import { test } from "node:test";

import { intervalForRetention } from "./fsrs.js";
import { RETENTION_CHOICES, retentionWorkloadCurve } from "./retentionPlanner.js";

const card = (stability, extra = {}) => ({ stability, fsrsState: "review", ...extra });

test("workload matches the 1/interval steady-state sum and rises with retention", () => {
  const items = [card(10), card(40), card(100)];
  const { rows, seededCount, unseededCount } = retentionWorkloadCurve(items);
  assert.equal(seededCount, 3);
  assert.equal(unseededCount, 0);
  assert.equal(rows.length, RETENTION_CHOICES.length);
  const expected90 = [10, 40, 100].reduce((sum, stability) => sum + 1 / Math.max(1, intervalForRetention(stability, 0.9)), 0);
  assert.equal(rows[2].retention, 0.9);
  assert.equal(rows[2].dailyReviews, Math.round(expected90 * 10) / 10);
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index].dailyReviews >= rows[index - 1].dailyReviews, "higher retention can never cost fewer reviews");
    assert.ok(rows[index].averageIntervalDays <= rows[index - 1].averageIntervalDays, "higher retention can never lengthen intervals");
  }
});

test("archived/suspended cards drop; learning cards join via stability; SM-2 cards count separately", () => {
  const items = [
    card(10),
    card(10, { archived: true }),
    card(10, { suspended: true }),
    { stability: 5, fsrsState: "learning" },
    { intervalDays: 6 },
  ];
  const { rows, seededCount, unseededCount } = retentionWorkloadCurve(items);
  assert.equal(seededCount, 2, "the learning card contributes its post-graduation interval");
  assert.equal(unseededCount, 1, "the SM-2 card is counted, never faked into the curve");
  assert.ok(rows.every((row) => Number.isFinite(row.dailyReviews)));
});

test("an empty deck yields a flat zero curve", () => {
  const { rows, seededCount } = retentionWorkloadCurve([]);
  assert.equal(seededCount, 0);
  assert.ok(rows.every((row) => row.dailyReviews === 0 && row.averageIntervalDays === 0));
});
