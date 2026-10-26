import assert from "node:assert/strict";
import test from "node:test";
import { masteryByPart } from "./mastery.js";
import { actionableReviewCount, buildReviewQueue, createReviewItem, emptyReviewSession, formatInterval, gradeReviewItem, isLearningStep, LEARN_AHEAD_MINUTES, learnAheadCards, localDayKey, previewReviewIntervals, recordReviewUsage, REVIEW_SCHEDULE_RULE, restoreReviewItemFromAttempt, reviewAnalytics, reviewStats } from "./review.js";

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

test("an early review counts the fraction of a day already waited", () => {
  const sixAndAHalf = probeCard({ lastReviewedAt: iso(-6.5 * DAY_MS), dueAt: iso(3.5 * DAY_MS) });
  assert.deepEqual(schedule(gradeReviewItem(sixAndAHalf, "good", NOW).item), { intervalDays: 16.25, ease: 2.5, repetitions: 4 }); // whole days would give 15
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
  // Failed a minute ago, still inside its 10-minute step: stored as 0.01 day before #149 and as
  // 10/1440 day since. Retry grades exactly such cards, so both must grade alike.
  for (const intervalDays of [0.01, 10 / 1_440]) {
    const step = probeCard({ intervalDays, repetitions: 0, reviewCount: 5, lapses: 1, lastReviewedAt: iso(-60_000), dueAt: iso(-60_000 + Math.round(intervalDays * DAY_MS)) });
    assert.deepEqual(schedule(gradeReviewItem(step, "hard", NOW).item), { intervalDays: 1, ease: 2.35, repetitions: 1 }, `hard from ${intervalDays}`);
    assert.deepEqual(schedule(gradeReviewItem(step, "good", NOW).item), { intervalDays: 3, ease: 2.5, repetitions: 1 }, `good from ${intervalDays}`);
    assert.deepEqual(schedule(gradeReviewItem(step, "easy", NOW).item), { intervalDays: 4, ease: 2.65, repetitions: 1 }, `easy from ${intervalDays}`);
  }
  const lapse = gradeReviewItem(probeCard(), "again", NOW).item;
  assert.deepEqual({ ...schedule(lapse), lapses: lapse.lapses }, { intervalDays: 10 / 1_440, ease: 2.3, repetitions: 0, lapses: 1 });
});

test("attempts record schedule rule 3 and grade an older rule on request", () => {
  assert.equal(REVIEW_SCHEDULE_RULE, 3);
  assert.equal(gradeReviewItem(probeCard(), "good", NOW).attempt.scheduleRule, 3);
  const legacy = gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: 1 });
  assert.deepEqual([legacy.item.intervalDays, legacy.attempt.scheduleRule], [25, 1], "rule 1 multiplies however early the review");
  const earlyAware = gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: 2 });
  assert.deepEqual([earlyAware.item.intervalDays, earlyAware.attempt.scheduleRule], [10, 2], "rule 2 stays early-aware");
  const newer = gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: 4 });
  assert.deepEqual([newer.item.intervalDays, newer.attempt.scheduleRule], [10, 4], "a later build's rule stays early-aware");
  for (const malformed of [0, -1, 2.5, "x", null]) {
    assert.equal(gradeReviewItem(probeCard(), "good", NOW, 0, { scheduleRule: malformed }).attempt.scheduleRule, 3);
  }
});

test("the rating preview grades at the given time", () => {
  const card = probeCard();
  const preview = previewReviewIntervals(card, { now: NOW });
  assert.deepEqual(preview, { again: 10 / 1_440, hard: 10, good: 10, easy: 10 }); // main: 12, 25, 32.5
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

const STEP_DAYS = 10 / 1_440;
const STEP_MS = 600_000;

test("Again sets a 10-minute step due exactly 600,000 ms later under Classic and FSRS (#149)", () => {
  const fresh = createReviewItem({ front: "q", back: "a" }, NOW);
  for (const [scheduler, card, rating] of [["sm2", probeCard(), "again"], ["fsrs", probeCard(), "again"], ["fsrs", fresh, "hard"]]) {
    const { item, attempt } = gradeReviewItem(card, rating, NOW, 0, { scheduler, requestRetention: 0.9 });
    assert.equal(item.intervalDays, STEP_DAYS, `${scheduler} ${rating}`); // main: 0.01
    assert.equal(Date.parse(item.dueAt) - NOW.getTime(), STEP_MS); // main: 864,000
    assert.deepEqual([attempt.nextIntervalDays, Date.parse(attempt.nextDueAt) - Date.parse(attempt.reviewedAt), attempt.scheduleRule], [STEP_DAYS, STEP_MS, 3]);
    assert.equal(formatInterval(item.intervalDays), "10 min"); // main: "14 min"
  }
});

test("the Again button previews the 10-minute step under both schedulers (#149)", () => {
  for (const scheduler of ["sm2", "fsrs"]) {
    const again = previewReviewIntervals(probeCard(), { scheduler, requestRetention: 0.9, now: NOW }).again;
    assert.deepEqual([again, formatInterval(again)], [STEP_DAYS, "10 min"]); // main: 0.01, "14 min"
  }
});

// Guards: these pass on main and must keep passing.
test("an attempt graded under rule 2 or below keeps the 0.01-day step (#149)", () => {
  for (const scheduleRule of [1, 2]) for (const scheduler of ["sm2", "fsrs"]) {
    const { item, attempt } = gradeReviewItem(probeCard(), "again", NOW, 0, { scheduler, requestRetention: 0.9, scheduleRule });
    assert.deepEqual([item.intervalDays, Date.parse(item.dueAt) - NOW.getTime(), attempt.scheduleRule], [0.01, 864_000, scheduleRule]);
  }
});

test("rule 3 grades a day or more exactly as rule 2 (#149)", () => {
  const dueNow = probeCard({ lastReviewedAt: iso(-10 * DAY_MS), dueAt: iso(0) });
  for (const card of [dueNow, probeCard()]) for (const rating of ["hard", "good", "easy"]) {
    const pick = ({ item }) => [item.intervalDays, item.dueAt, item.ease, item.repetitions];
    assert.deepEqual(pick(gradeReviewItem(card, rating, NOW, 0, { scheduleRule: 3 })), pick(gradeReviewItem(card, rating, NOW, 0, { scheduleRule: 2 })));
  }
});

const MINUTE_MS = 60_000;
// A card failed earlier and now in its 10-minute step, due `dueInMs` from NOW.
const stepCard = (id, dueInMs, extra = {}) => probeCard({ id, intervalDays: 10 / 1_440, repetitions: 0, reviewCount: 5, lapses: 1, lastReviewedAt: iso(dueInMs - 10 * MINUTE_MS), dueAt: iso(dueInMs), ...extra });
const todayUsage = (reviewCompleted) => [{ ...emptyReviewSession(NOW, "UTC"), reviewCompleted }];

test("learnAheadCards returns active learning steps due within 20 minutes, earliest first (#149)", () => {
  assert.equal(LEARN_AHEAD_MINUTES, 20);
  const cards = [
    stepCard("in-20", 20 * MINUTE_MS), stepCard("in-9-b", 9 * MINUTE_MS), stepCard("in-9-a", 9 * MINUTE_MS),
    stepCard("legacy-in-5", 5 * MINUTE_MS, { intervalDays: 0.01 }), // stored before #149
    stepCard("in-21", 21 * MINUTE_MS), stepCard("due-now", 0), stepCard("overdue", -MINUTE_MS),
    stepCard("suspended", 5 * MINUTE_MS, { suspended: true }), stepCard("archived", 5 * MINUTE_MS, { archived: true }),
    stepCard("buried", 5 * MINUTE_MS, { buriedOnDay: localDayKey(NOW, "UTC") }),
    probeCard({ id: "review-in-5", lastReviewedAt: iso(-3 * DAY_MS), intervalDays: 3, dueAt: iso(5 * MINUTE_MS) }),
    { ...createReviewItem({ front: "new", back: "card" }, NOW), id: "new-in-5", dueAt: iso(5 * MINUTE_MS) },
  ];
  assert.deepEqual(learnAheadCards(cards, NOW, { timeZone: "UTC" }).map((item) => item.id), ["legacy-in-5", "in-9-a", "in-9-b", "in-20"]);
  assert.deepEqual(learnAheadCards(cards, NOW, { minutes: 10, timeZone: "UTC" }).map((item) => item.id), ["legacy-in-5", "in-9-a", "in-9-b"]);
  assert.deepEqual([stepCard("s", 0), stepCard("l", 0, { intervalDays: 0.01 }), probeCard(), createReviewItem({ front: "n", back: "c" }, NOW), probeCard({ intervalDays: 0 }), probeCard({ intervalDays: 1 })].map(isLearningStep), [true, true, false, false, false, false]); // a 1-day card is not a step
});

test("due learning steps bypass the spent daily review limit; other reviews still wait (#149)", () => {
  const settings = { dailyNewLimit: 0, dailyReviewLimit: 2 };
  const cards = [probeCard({ id: "review-due", lastReviewedAt: iso(-4 * DAY_MS), intervalDays: 3, dueAt: iso(-DAY_MS) }), stepCard("step-due", -MINUTE_MS), stepCard("legacy-due", -2 * MINUTE_MS, { intervalDays: 0.01 })];
  const queue = (completed) => buildReviewQueue(cards, settings, NOW, todayUsage(completed), { timeZone: "UTC" }).map((item) => item.id);
  assert.deepEqual(queue(2), ["legacy-due", "step-due"]); // main: []
  assert.deepEqual(queue(1), ["review-due", "legacy-due", "step-due"]); // main: ["review-due"]
  assert.deepEqual(queue(0), ["review-due", "legacy-due", "step-due"]); // main: ["review-due", "legacy-due"]
  assert.equal(actionableReviewCount({ reviewItems: cards, reviewSettings: settings, reviewSessions: todayUsage(2) }, NOW, "UTC"), 2); // main: 0
  // A step takes a review slot while one remains: sorted between two reviews, it leaves the later review no place (limit 2, nothing done today).
  const around = [probeCard({ id: "review-early", lastReviewedAt: iso(-5 * DAY_MS), intervalDays: 3, dueAt: iso(-2 * DAY_MS) }), stepCard("step-mid", -MINUTE_MS), probeCard({ id: "review-late", lastReviewedAt: iso(-3 * DAY_MS - 30_000), intervalDays: 3, dueAt: iso(-30_000) })];
  assert.deepEqual(buildReviewQueue(around, settings, NOW, todayUsage(0), { timeZone: "UTC" }).map((item) => item.id), ["review-early", "step-mid"]); // main: ["review-early", "step-mid"]
});

test("every card the daily queue shows can be graded today: a due step takes a review slot while one remains (#149)", () => {
  const settings = { dailyNewLimit: 0, dailyReviewLimit: 2 };
  const review = (id, dueInMs) => probeCard({ id, intervalDays: 3, repetitions: 2, reviewCount: 2, lastReviewedAt: iso(dueInMs - 3 * DAY_MS), dueAt: iso(dueInMs) });
  for (const cards of [
    [review("review-early", -2 * DAY_MS), stepCard("step-mid", -MINUTE_MS), review("review-late", -30_000)],
    [review("r1", -2 * DAY_MS), stepCard("step-yesterday", -DAY_MS), review("r2", -12 * 3_600_000), review("r3", -MINUTE_MS)],
  ]) {
    let items = cards, sessions = todayUsage(0), now = NOW;
    const shown = buildReviewQueue(items, settings, now, sessions, { timeZone: "UTC" }).map((item) => item.id);
    const graded = [];
    for (let queue; (queue = buildReviewQueue(items, settings, now, sessions, { timeZone: "UTC" })).length && graded.length < 10;) {
      const usage = recordReviewUsage(sessions, queue[0], now, { timeZone: "UTC" });
      const { item } = gradeReviewItem(queue[0], "good", now, 0, { sessionKind: usage.kind, sessionKey: usage.sessionKey });
      graded.push(item.id);
      items = items.map((entry) => (entry.id === item.id ? item : entry));
      sessions = usage.sessions;
      now = new Date(now.getTime() + 1_000);
    }
    assert.deepEqual(graded, shown); // fe4a359: each case shows 3 and grades 2
  }
});

test("a card failed on the last allowed review is due again 10 minutes later the same day (#149)", () => {
  const settings = { dailyNewLimit: 0, dailyReviewLimit: 2 };
  const card = probeCard({ id: "last-allowed", lastReviewedAt: iso(-4 * DAY_MS), intervalDays: 3, dueAt: iso(-DAY_MS) });
  const usage = recordReviewUsage(todayUsage(1), card, NOW, { timeZone: "UTC" });
  const { item } = gradeReviewItem(card, "again", NOW, 0, { sessionKind: usage.kind, sessionKey: usage.sessionKey });
  assert.equal(usage.sessions[0].reviewCompleted, 2, "the failing grade spends the last review");
  const view = (offsetMs) => {
    const now = new Date(NOW.getTime() + offsetMs);
    return { queue: buildReviewQueue([item], settings, now, usage.sessions, { timeZone: "UTC" }).map((entry) => entry.id), ahead: learnAheadCards([item], now, { timeZone: "UTC" }).map((entry) => entry.id) };
  };
  assert.deepEqual(view(9 * MINUTE_MS), { queue: [], ahead: ["last-allowed"] });
  assert.deepEqual(view(10 * MINUTE_MS), { queue: ["last-allowed"], ahead: [] }); // main: [] until tomorrow
});

test("learning ahead never counts as due: only listed steps in the window are admitted (#149)", () => {
  const settings = { dailyNewLimit: 5, dailyReviewLimit: 50 };
  // "in-12" is inside the window but never listed, so it must stay out.
  const cards = [stepCard("in-9", 9 * MINUTE_MS), stepCard("in-12", 12 * MINUTE_MS), stepCard("in-30", 30 * MINUTE_MS), probeCard({ id: "review-in-5", lastReviewedAt: iso(-3 * DAY_MS), intervalDays: 3, dueAt: iso(5 * MINUTE_MS) }), { ...createReviewItem({ front: "new", back: "card" }, at(-DAY_MS)), id: "fresh" }];
  const ids = (options) => buildReviewQueue(cards, settings, NOW, [], { timeZone: "UTC", ...options }).map((item) => item.id);
  assert.deepEqual(ids({}), ["fresh"]);
  assert.equal(actionableReviewCount({ reviewItems: cards, reviewSettings: settings, reviewSessions: [] }, NOW, "UTC"), 1);
  assert.deepEqual(ids({ learnAheadIds: ["in-9", "in-30", "review-in-5"] }), ["fresh", "in-9"]); // main: ["fresh"]
});

// #151: an attempt as the app stores it, oldest first. A previous interval of a day or more
// means the card was in review when graded.
const graded = (offsetMs, reviewItemId, rating, extra = {}) => ({
  id: `${reviewItemId}@${offsetMs}`, reviewItemId, rating, elapsedMs: 4_000, reviewedAt: iso(offsetMs),
  previousIntervalDays: 3, sessionKind: "review", crunch: false, ...extra,
});
const minutes = (count) => count * MINUTE_MS; // MINUTE_MS is defined above, for #149
const YESTERDAY = -DAY_MS; // 2026-01-14T12:00:00Z
// The issue's fixture: 10 scheduled reviews (r1 and r2 Again), both failures passed 10 minutes
// later, 3 new cards' first grades and 20 Extra practice grades (half Again).
const scheduledTen = Array.from({ length: 10 }, (_, index) => graded(YESTERDAY + minutes(index), `r${index + 1}`, index < 2 ? "again" : "good"));
const sameDayRegrades = ["r1", "r2"].map((id, index) => graded(YESTERDAY + minutes(20 + index), id, "good", { previousIntervalDays: 10 / 1_440 }));
const newCardFirstGrades = ["n1", "n2", "n3"].map((id, index) => graded(YESTERDAY + minutes(30 + index), id, "good", { previousIntervalDays: 0, sessionKind: "new" }));
const crunchTwenty = Array.from({ length: 20 }, (_, index) => graded(YESTERDAY + minutes(40 + index), `r${(index % 10) + 1}`, index % 2 ? "good" : "again", { sessionKind: "crunch", crunch: true }));
const recall = (attempts, timeZone = "UTC") => {
  const { retention7, retention30, scheduledReviews7, scheduledReviews30, retentionTrend } = reviewAnalytics(attempts, [], NOW, timeZone);
  return { retention7, retention30, scheduledReviews7, scheduledReviews30, thisWeek: retentionTrend[11] };
};
const eightyOfTen = { retention7: 80, retention30: 80, scheduledReviews7: 10, scheduledReviews30: 10, thisWeek: { count: 10, percent: 80 } };

test("recall counts only scheduled reviews: the issue's fixture reads 80% of 10 (#151)", () => {
  assert.deepEqual(recall([...scheduledTen, ...sameDayRegrades, ...newCardFirstGrades, ...crunchTwenty]), eightyOfTen); // main: 66% of 35
});

test("Extra practice attempts are left out of recall (#151)", () => {
  assert.deepEqual(recall([...scheduledTen, ...crunchTwenty]), eightyOfTen); // main: 60% of 30
  // Either flag alone marks Extra practice: the normalizer fills a missing kind with "review".
  const oneFlag = [graded(YESTERDAY + minutes(70), "x1", "again", { crunch: true }), graded(YESTERDAY + minutes(71), "x2", "again", { sessionKind: "crunch" })];
  assert.deepEqual(recall([...scheduledTen, ...oneFlag]), eightyOfTen); // main: 67% of 12
});

test("a new card's first grade is left out of recall (#151)", () => {
  assert.deepEqual(recall([...scheduledTen, ...newCardFirstGrades]), eightyOfTen); // main: 85% of 13
});

test("a re-grade after a same-day failure is left out of recall (#151)", () => {
  assert.deepEqual(recall([...scheduledTen, ...sameDayRegrades]), eightyOfTen); // main: 83% of 12
});

test("only a card's first scheduled review of a local day counts (#151)", () => {
  // Graded on two devices before a sync merged them, both a day or more into the interval:
  // the first counts though it failed, and the second never does.
  const twice = [graded(YESTERDAY, "s1", "again"), graded(YESTERDAY + minutes(90), "s1", "good")];
  assert.deepEqual(recall(twice), { retention7: 0, retention30: 0, scheduledReviews7: 1, scheduledReviews30: 1, thisWeek: { count: 1, percent: 0 } }); // main: 50% of 2
  // The same card on two days counts on each.
  const twoDays = [graded(-3 * DAY_MS, "s1", "good"), graded(YESTERDAY, "s1", "again")];
  assert.deepEqual(recall(twoDays), { retention7: 50, retention30: 50, scheduledReviews7: 2, scheduledReviews30: 2, thisWeek: { count: 2, percent: 50 } });
});

test("the learner's local day decides which attempts share a day (#151)", () => {
  // NOW is 07:00 on 15 January in New York (UTC−5).
  const attempts = [
    graded(-33 * 3_600_000, "t2", "good"), // 03:00Z on the 14th: 22:00 on the 13th in New York
    graded(-30 * 3_600_000, "t2", "good"), // 06:00Z on the 14th: 01:00 on the 14th, a new local day
    graded(-12.5 * 3_600_000, "t1", "good"), // 23:30Z on the 14th: 18:30 on the 14th
    graded(-7.5 * 3_600_000, "t1", "again"), // 04:30Z on the 15th: 23:30 on the 14th, the same local day
  ];
  assert.deepEqual(recall(attempts, "America/New_York"), { retention7: 100, retention30: 100, scheduledReviews7: 3, scheduledReviews30: 3, thisWeek: { count: 3, percent: 100 } }); // main: 75% of 4
  assert.deepEqual(recall(attempts, "UTC"), { retention7: 67, retention30: 67, scheduledReviews7: 3, scheduledReviews30: 3, thisWeek: { count: 3, percent: 67 } });
});

test("legacy attempts without an interval and learning steps are left out of recall (#151)", () => {
  const legacy = graded(YESTERDAY + minutes(5), "l1", "again");
  delete legacy.previousIntervalDays; // recorded before intervals were stored
  const attempts = [
    graded(YESTERDAY, "k1", "good"),
    legacy,
    graded(YESTERDAY + minutes(6), "l2", "again", { previousIntervalDays: 0 }), // as the normalizer stores such an attempt
    graded(YESTERDAY + minutes(7), "l3", "again", { previousIntervalDays: 0.5 }), // a step under a day
    graded(YESTERDAY + minutes(8), "l4", "again", { previousIntervalDays: 1 }), // exactly a day: in review, counts
  ];
  assert.deepEqual(recall(attempts), { retention7: 50, retention30: 50, scheduledReviews7: 2, scheduledReviews30: 2, thisWeek: { count: 2, percent: 50 } }); // main: 20% of 5
});

test("with only excluded attempts recall reads nothing yet (#151)", () => {
  const analytics = reviewAnalytics([...sameDayRegrades, ...newCardFirstGrades, ...crunchTwenty], [], NOW, "UTC");
  assert.deepEqual([analytics.retention7, analytics.retention30, analytics.scheduledReviews7, analytics.scheduledReviews30], [null, null, 0, 0]); // main: 60, 60, undefined, undefined
  assert.ok(analytics.retentionTrend.every((week) => week.count === 0 && week.percent === null));
});

test("the 7- and 30-day figures and the 12-week trend count by the same rule (#151)", () => {
  const crunch = { crunch: true, sessionKind: "crunch" };
  const analytics = reviewAnalytics([
    graded(-80 * DAY_MS, "w1", "good"), // 11 weeks ago
    graded(-80 * DAY_MS + minutes(5), "w2", "again", crunch),
    graded(-25 * DAY_MS, "w3", "again"),
    graded(-20 * DAY_MS, "w4", "good"),
    graded(-11 * DAY_MS, "w5", "good"),
    graded(-10 * DAY_MS, "w6", "good"),
    graded(-10 * DAY_MS + minutes(60), "w6", "good"), // the same card that day
    graded(-3 * DAY_MS, "w7", "good", { sessionKind: "new", previousIntervalDays: 0 }),
    graded(-2 * DAY_MS, "w8", "again"),
    graded(YESTERDAY, "w9", "good"),
    graded(YESTERDAY + minutes(10), "w10", "good", crunch),
  ], [], NOW, "UTC");
  assert.deepEqual([analytics.retention7, analytics.scheduledReviews7], [50, 2]); // main: 75% of 4
  assert.deepEqual([analytics.retention30, analytics.scheduledReviews30], [67, 6]); // main: 78% of 9
  assert.deepEqual(analytics.retentionTrend.map(({ count, percent }) => [count, percent]), [
    [1, 100], [0, null], [0, null], [0, null], [0, null], [0, null], [0, null], [0, null],
    [1, 0], [1, 100], [2, 100], [2, 50],
  ]); // main: [2, 50] first, then [3, 100] and [4, 75] last
});

test("median answer time still uses every attempt in 30 days (#151)", () => {
  const attempts = [...scheduledTen, ...sameDayRegrades, ...newCardFirstGrades, ...crunchTwenty].map((attempt, index) => ({ ...attempt, elapsedMs: (index + 1) * 1_000 }));
  // 35 attempts taking 1 to 35 s: the median is the 18th, though the scheduled ten took 1 to 10 s.
  assert.equal(reviewAnalytics(attempts, [], NOW, "UTC").medianLatencyMs, 18_000);
});
