import assert from "node:assert/strict";
import test from "node:test";
import { masteryByPart } from "./mastery.js";
import { createReviewItem, gradeReviewItem, previewReviewIntervals, REVIEW_SCHEDULE_RULE, restoreReviewItemFromAttempt, reviewStats } from "./review.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);
const iso = (offsetMs) => at(offsetMs).toISOString();
const PART_DOC = "notes/part-05-supervised-learning/01-linear-regression.md";
// The #148 probe: a 10-day card last reviewed a day ago, due in nine days.
const probeCard = (extra = {}) => ({
  ...createReviewItem({ front: "What does dropout do at inference?", back: "Nothing; it is turned off.", documentId: PART_DOC }, at(-40 * DAY_MS)),
  id: "probe", intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0,
  stability: 10, difficulty: 5, fsrsState: "review", lastReviewedAt: iso(-DAY_MS), dueAt: iso(9 * DAY_MS), ...extra,
});
const schedule = (item) => ({ intervalDays: item.intervalDays, ease: item.ease, repetitions: item.repetitions });
// Three Crunch passes a minute apart, as in the issue's probe.
const crunchGoods = (card, scheduler = "sm2") => {
  const trail = [];
  for (let pass = 0, current = card; pass < 3; pass += 1) {
    const reviewedAt = at(pass * 60_000);
    const { item } = gradeReviewItem(current, "good", reviewedAt, 5_000, { scheduler, requestRetention: 0.9, crunch: true });
    trail.push({ item, reviewedAt });
    current = item;
  }
  return trail;
};

test("three early Good grades keep the probe card at 10 days under Classic", () => {
  const trail = crunchGoods(probeCard());
  assert.deepEqual(trail.map(({ item }) => item.intervalDays), [10, 10, 10]); // main: 25, 62.5, 156.25
  for (const { item, reviewedAt } of trail) {
    assert.equal(Date.parse(item.dueAt) - reviewedAt.getTime(), 10 * DAY_MS);
    assert.deepEqual(schedule(item), { intervalDays: 10, ease: 2.5, repetitions: 4 });
  }
});

test("FSRS still gives 13, 14 and 14 days for the probe card", () => {
  assert.deepEqual(crunchGoods(probeCard(), "fsrs").map(({ item }) => item.intervalDays), [13, 14, 14]);
});

test("early Hard and Easy keep the prior interval, ease and repetitions", () => {
  assert.deepEqual(schedule(gradeReviewItem(probeCard(), "hard", NOW).item), { intervalDays: 10, ease: 2.5, repetitions: 4 }); // main: 12, 2.35, 5
  assert.deepEqual(schedule(gradeReviewItem(probeCard(), "easy", NOW).item), { intervalDays: 10, ease: 2.5, repetitions: 4 }); // main: 32.5, 2.65, 5
});

test("an early review grows only from the time actually waited", () => {
  const sixDaysIn = probeCard({ lastReviewedAt: iso(-6 * DAY_MS), dueAt: iso(4 * DAY_MS) });
  assert.deepEqual(schedule(gradeReviewItem(sixDaysIn, "hard", NOW).item), { intervalDays: 10, ease: 2.5, repetitions: 4 });
  assert.deepEqual(schedule(gradeReviewItem(sixDaysIn, "good", NOW).item), { intervalDays: 15, ease: 2.5, repetitions: 4 });
  assert.deepEqual(schedule(gradeReviewItem(sixDaysIn, "easy", NOW).item), { intervalDays: 19.5, ease: 2.5, repetitions: 4 });
});

test("a due or overdue card is graded exactly as before", () => {
  const dueNow = probeCard({ lastReviewedAt: iso(-10 * DAY_MS), dueAt: iso(0) }); // graded at its exact due millisecond
  const overdue = probeCard({ lastReviewedAt: iso(-12 * DAY_MS), dueAt: iso(-2 * DAY_MS) });
  for (const card of [dueNow, overdue]) {
    assert.deepEqual(schedule(gradeReviewItem(card, "hard", NOW).item), { intervalDays: 12, ease: 2.35, repetitions: 5 });
    assert.deepEqual(schedule(gradeReviewItem(card, "good", NOW).item), { intervalDays: 25, ease: 2.5, repetitions: 5 });
    assert.deepEqual(schedule(gradeReviewItem(card, "easy", NOW).item), { intervalDays: 32.5, ease: 2.65, repetitions: 5 });
  }
});

test("new cards, sub-day steps and Again keep today's rules", () => {
  const fresh = createReviewItem({ front: "q", back: "a" }, NOW);
  assert.deepEqual(["hard", "good", "easy"].map((rating) => gradeReviewItem(fresh, rating, NOW).item.intervalDays), [1, 1, 4]);
  // Failed a minute ago, still inside its 10-minute step (stored as 0.01 day).
  const step = probeCard({ intervalDays: 0.01, repetitions: 0, reviewCount: 5, lapses: 1, lastReviewedAt: iso(-60_000), dueAt: iso(804_000) });
  assert.deepEqual(schedule(gradeReviewItem(step, "hard", NOW).item), { intervalDays: 1, ease: 2.35, repetitions: 1 });
  assert.deepEqual(schedule(gradeReviewItem(step, "good", NOW).item), { intervalDays: 3, ease: 2.5, repetitions: 1 });
  assert.deepEqual(schedule(gradeReviewItem(step, "easy", NOW).item), { intervalDays: 4, ease: 2.65, repetitions: 1 });
  const lapse = gradeReviewItem(probeCard(), "again", NOW).item;
  assert.deepEqual({ ...schedule(lapse), lapses: lapse.lapses }, { intervalDays: 0.01, ease: 2.3, repetitions: 0, lapses: 1 });
});

test("attempts record schedule rule 2 and grade an older rule on request", () => {
  assert.equal(REVIEW_SCHEDULE_RULE, 2);
  assert.equal(gradeReviewItem(probeCard(), "good", NOW).attempt.scheduleRule, 2);
  const legacy = gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: 1 });
  assert.deepEqual([legacy.item.intervalDays, legacy.attempt.scheduleRule], [25, 1], "rule 1 multiplies however early the review");
  const newer = gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: 3 });
  assert.deepEqual([newer.item.intervalDays, newer.attempt.scheduleRule], [10, 3], "a later build's rule stays early-aware");
  for (const malformed of [0, -1, 2.5, "x", null]) {
    assert.equal(gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: malformed }).attempt.scheduleRule, 2);
  }
});

test("the rating preview grades at the given time", () => {
  const card = probeCard();
  const preview = previewReviewIntervals(card, { now: NOW });
  assert.deepEqual(preview, { again: 0.01, hard: 10, good: 10, easy: 10 }); // main: 12, 25, 32.5
  for (const rating of ["again", "hard", "good", "easy"]) assert.equal(preview[rating], gradeReviewItem(card, rating, NOW).item.intervalDays);
  assert.equal(previewReviewIntervals(card, { scheduler: "fsrs", requestRetention: 0.9, now: NOW }).good, 13); // main grades at the wall clock
});

test("Crunch on cards that are not due leaves Mastered and the Part ladder unchanged", () => {
  const documents = [{ id: PART_DOC, source: "builtin", partNumber: 5, partTitle: "Supervised learning" }];
  const mastered = probeCard({ id: "mastered", intervalDays: 30, repetitions: 5, reviewCount: 5, lastReviewedAt: iso(-3 * DAY_MS), dueAt: iso(27 * DAY_MS) });
  const counts = (items) => ({ tile: reviewStats(items, NOW, "UTC").mastered, ladder: masteryByPart(documents, { progress: {}, reviewItems: items }, NOW)[0].masteredCards });
  const before = [probeCard(), mastered];
  assert.deepEqual(counts(before), { tile: 1, ladder: 1 });
  assert.deepEqual(counts(before.map((card) => crunchGoods(card).at(-1).item)), { tile: 1, ladder: 1 }); // main: 2 and 2
  let fresh = createReviewItem({ front: "new", back: "card", documentId: PART_DOC }, NOW);
  const trail = [];
  for (let pass = 0; pass < 4; pass += 1) {
    fresh = gradeReviewItem(fresh, "good", at(pass * 60_000), 0, { crunch: true }).item;
    trail.push(fresh.intervalDays);
  }
  assert.deepEqual(trail, [1, 1, 1, 1]); // main: 1, 3, 7.5, 18.75
  assert.equal(reviewStats([fresh], NOW, "UTC").mastered, 0);
});

test("unusual review times never inflate or break an early grade", () => {
  const ahead = gradeReviewItem(probeCard({ lastReviewedAt: iso(60 * 60_000) }), "good", NOW).item; // another device's clock ran ahead
  assert.deepEqual([ahead.intervalDays, Date.parse(ahead.dueAt) - NOW.getTime()], [10, 10 * DAY_MS]);
  assert.equal(gradeReviewItem(probeCard({ lastReviewedAt: "" }), "good", NOW).item.intervalDays, 25, "no review time: today's rule");
  assert.equal(gradeReviewItem(probeCard({ lastReviewedAt: iso(-2 * DAY_MS), dueAt: iso(0) }), "good", NOW).item.intervalDays, 10, "made due by corrective review");
});

test("undo restores an early grade exactly", () => {
  const card = probeCard();
  const graded = gradeReviewItem(card, "good", NOW, 0, { crunch: true });
  const restored = restoreReviewItemFromAttempt(graded.item, graded.attempt);
  for (const field of ["dueAt", "intervalDays", "ease", "repetitions", "reviewCount", "lapses", "lastReviewedAt"]) assert.equal(restored[field], card[field], field);
});
