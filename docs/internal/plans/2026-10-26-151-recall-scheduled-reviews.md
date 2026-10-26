# Recall counts scheduled reviews only (#151) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every recall figure in the Review center (7-day recall, 30-day recall, the 12-week trend) counts only scheduled reviews, shows its sample size, and, with Adaptive on, sits beside the target retention, so the learner and the retention dial read one comparable number.

**Architecture:** One rule inside `reviewAnalytics` (`src/lib/review.js`). An attempt counts when it comes from a review session, is not Extra practice and is of a card already in review, and when it is the card's first such attempt that local day. The existing single pass gains a `Set` of `reviewItemId|day` and returns two counts. `ReviewCenter.jsx` prints the counts and the target. Median answer time and the streak keep every attempt.

**Tech Stack:** Plain ES modules, React 19 (`ReviewCenter.jsx`), CSS tokens (`src/styles.css`), `node:test`, Puppeteer browser audits, axe-core.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/151 (binding; no comments). Related, not implemented here:
- #152 replaces `streak` in the same return value and starts after this merges.
- #164 will add practice-only sessions to the rule.
- #176 builds a scheduler-fit report on this definition.
- #175 (estimated knowledge), #165 (per-card history) and #122 (audio attempts) are out of scope.

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`, every browser run through `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot` (it waits for a free slot). Rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`. `check:browser` serves `dist/`, so `npm run build` first.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist (`ALLOWLIST = []` in `scripts/a11y_audit.mjs` stays empty). Use theme tokens only (Paper, Night, Contrast, System), no hard-coded colours. Phones need 44 px touch targets and ≥ 16 px form text. Check 320 px, 393 px, 200% text and landscape.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (`npm run size`; the last recorded figures, at #149, were 623,762 B and 697,565 B).
- Local-first: no network request, no paid or cloud AI, no tracking. Learner data stays on the device.
- Persisted data: no new profile or attempt field. `sessionKind`, `crunch`, `previousIntervalDays`, `reviewItemId` and `reviewedAt` are already stored and normalized (`src/lib/db.js` attempt normalizer). Nothing in the backup fixture, `profileSync` or `audit:sync` changes.
- Never weaken an existing assertion. Every test of new behaviour fails on main for the stated reason. The one assertion changed on purpose (`scripts/review_audit.mjs:245`) is named in its commit and in the PR.
- Browser audits wait for what a check reads (`scripts/audit_waits.mjs`: `settled`, `waitForTheme`, `pollValue`), never for a guessed delay.
- Commits: concise imperative subject, short why-body, no trailers. Push the branch after every task.
- Exact values from the issue:
  - An attempt counts when all of these hold:
    - `sessionKind === "review"`;
    - `crunch` is false;
    - `previousIntervalDays >= 1`;
    - it is the card's first such attempt that local day (`localDayKey`).
  - Recall is the share of counted attempts not rated Again. `retention7`, `retention30` and `retentionTrend` all use it, in the single pass, with a `Set` of `reviewItemId|day`.
  - The issue's fixture is 10 scheduled reviews (2 Again), 2 same-day re-grades, 3 first grades of new cards and 20 Crunch attempts. The 30-day tile shows **80%** and **"10 scheduled reviews"** (main: a blended 66% over 35 attempts).
  - The issue's example, 10 due cards with 2 failed and re-passed 10 minutes later, reads 80% (8 of 10), not 83% (10 of 12).
  - The tiles keep their names and add the sample size. With Adaptive on, the 30-day tile adds **"Target 90%"** and follows the dial. The trend bars' accessible label says **"scheduled reviews"**.
  - Decisions: fix the definition, not the dashboard (no young/mature split, #176). Exclude legacy attempts that lack `previousIntervalDays` (the normalizer stores 0, `src/lib/db.js:1297`). Median answer time keeps all attempts.
  - Scale: 50,000 attempts analysed in under **4,000 ms** (`src/lib/review.scale.test.mjs`).
  - Layout: the tiles fit at 393×852, 320 px and 200% text, in Paper, Night and Contrast. Keyboard and VoiceOver users reach value, count and target in reading order. axe is clean.
- Shape change to `reviewAnalytics` (name it in the PR for #152): two new numbers, `scheduledReviews7` and `scheduledReviews30`. `streak` is untouched. `retentionTrend` entries keep `{ count, percent }`, where `count` now counts scheduled reviews.

## Review Focus

- A learner who has only graded new cards or Extra practice: recall reads "—" with "0 scheduled reviews", and the trend shows its empty message, never a blended figure. Tests in Task 1 (all-excluded) and Task 2 (`review_audit:245`).
- Older data flagged one way only (`crunch: true` with `sessionKind: "review"`, as the normalizer fills a missing kind, or `sessionKind: "crunch"` with `crunch: false`): Extra practice either way, never counted. Test in Task 1.
- A learner outside UTC: two attempts on one local day but two UTC days are one day, and the reverse are two. Test in Task 1 (New York).
- The same card reviewed on two devices before a sync, both a day or more into their interval: only the first counts, even when it failed. Test in Task 1.
- Switching back to Classic hides the target, and the target follows both the select and the workload planner. Test in Task 2.

## Rulings

- Ruling: the worktree was made with `git worktree add` on `origin/main`, not a native worktree tool — the dispatch fixes the path, branch and base — none.
- Ruling: no REA re-capture of a reference platform — the issue pins a metric definition (Anki's true retention, cited), not an interaction flow — a detail of Anki's table goes unchecked, though the issue's definition binds anyway.
- Ruling: the plan goes straight to execution without human review — the brief says not to stop — a design gap surfaces at the task or final review instead.
- Ruling: there is no practice-only check — #164 is not merged, so no such flag exists — #164 must add its flag to `isScheduledReview`.
- Ruling: the return gains `scheduledReviews7` and `scheduledReviews30` beside `retention7`/`retention30`; `streak` and the `retentionTrend` entry shape are unchanged — #152 then rebases onto two added lines — a consumer reading `retentionTrend[i].count` as all attempts now reads scheduled reviews (only ReviewCenter reads it).
- Ruling: "first such attempt that local day" is the first in array order, and whether an attempt counts is decided once, before any window check. Stored attempts are oldest first: the app appends, sync sorts ascending (`profileSync.js:263`), and the normalizer keeps order. The issue fixes a single pass with a `Set` — an imported array out of time order would count its first-listed attempt of the day instead of its earliest.
- Ruling: the count reads `${n} scheduled review${n === 1 ? "" : "s"}`, so none reads "0 scheduled reviews" beside "—" — a thin or empty sample is made visible (Decision 2) — a copy edit.
- Ruling: both recall tiles show their sample size ("the tiles keep their names and add the sample size", plural); only the 30-day tile shows the target — none.
- Ruling: the 30-day tile reads, top to bottom and in DOM order, value, "30-day recall", count, then target (Adaptive only), each on its own line. Reading order then equals visual order and lists value, count and target as the criterion does. "Beside the 30-day value" is read as within the 30-day tile next to its value; at 320 px and 200% text a same-line target would wrap anyway — moving the target onto the value's line is a CSS-only change.
- Ruling: the trend's visible subtitle "Weekly retention trend" stays. Its `role="img"` label, the bar titles and the empty-state line say "scheduled reviews" — the issue asks only for the accessible label — sighted users rely on the tiles' captions for the definition.
- Ruling: the 12-week trend's overflow at 320 px is fixed here. On main, with any graded review, its chart ends 22 px outside the article and the page scrolls to 326 px (measured on 1a20c29; `audit:responsive` seeds no attempts, so it never saw this). The criterion requires the recall surfaces to fit at 320 px — the cost is a CSS change outside the issue's literal list.
- Ruling: the fit matrix is 393×852, 320×568 and 360×800 at 200% text (the responsive audit's phone-large-text size), in Paper, Night and Contrast, plus axe and fit at 393×852 and 1280×800 in every theme — 320 px at 200% text is not a repo convention — a layout that only breaks at 320 px and 200% text together goes unseen.
- Ruling: the 7-day forecast's weekday ticks clip by 3–5 px at 200% text on main. That is not a recall figure, so it is out of scope and reported as a follow-up.
- Ruling: the PRD's LEARN-003 delivered line ("7/30-day retention") is not edited. The issue says to record the corrected definition in the verification log, and #152 edits that same line. The log row uses legend words only and leaves the header date to #99. LEARN-003 stays `Partial` — the delivered line keeps "retention" until #152 or #99 rewords it.
- Ruling: one new unit check passes on main by design and is named as a guard in the PR: the median over every attempt (Decision 3). Every other new check fails on main first, checked on a scratch copy of main's `review.js` against a prototype of the rule (main: 66% of 35 on the fixture) — none.

## Files

- Modify `src/lib/review.js` (`reviewAnalytics`, :456-527).
- Modify `src/lib/review.test.mjs`, `src/lib/review.scale.test.mjs` (:46-81), `scripts/unit_audit.mjs` (the trend block at :300-316).
- Modify `src/components/ReviewCenter.jsx` (the 30-day tile at :994, the 7-day tile at :998, the trend at :1001; helpers near :983-986), `src/styles.css` (stat grid :2917-2940, analytics :2942-2965, the ≤900/≤740 px blocks :3121-3165, trend :6857-6867).
- Modify `scripts/review_audit.mjs` (:245 and a new #151 block before the final `errors` assertion), `scripts/a11y_audit.mjs` (a new state).
- Docs (Task 3, after the gate): `docs/internal/PRODUCT_REQUIREMENTS.md`, `docs/FUNCTIONAL_TESTING.md`, `docs/guides/APP_GUIDE.md`, `docs/DEVICE_TESTING.md`.

---

### Task 1: Count scheduled reviews only in `reviewAnalytics`

**Files:**
- Modify: `src/lib/review.js:456-527`
- Test: `src/lib/review.test.mjs` (append), `src/lib/review.scale.test.mjs:46-81` (rewrite that test), `scripts/unit_audit.mjs:300-316` (rewrite that block)

**Interfaces:**
- Produces: `reviewAnalytics(attempts = [], items = [], now = new Date(), timeZone = currentTimeZone())` returns `{ retention7: number|null, retention30: number|null, scheduledReviews7: number, scheduledReviews30: number, medianLatencyMs: number|null, streak: number, forecast: number[7], retentionTrend: Array<{ count: number, percent: number|null }> /* 12, oldest first */ }`. `scheduledReviewsN` is the number of counted attempts in that window, and `retentionN` is null exactly when it is 0. `retentionTrend[i].count` counts scheduled reviews.
- Internal: a module-private `isScheduledReview(attempt)` (`sessionKind === "review" && !crunch && Number(previousIntervalDays) >= 1`). Its comment says #164 adds practice-only sessions here.

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/review.test.mjs`, adding `reviewAnalytics` to its `./review.js` import:

```js
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
```

Rewrite the 50,000-attempt test in `src/lib/review.scale.test.mjs` (:46-81). Keep the 10,000-card test and `makeScaleCards` as they are, and keep the `streak`, forecast and timing lines exactly as they are (#152 edits the streak line):

```js
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
```

On main the test fails at `scheduledReviews7` (undefined); a prototype of the rule passes it in about 140 ms.

Rewrite the trend block in `scripts/unit_audit.mjs` (:300-316). The attempts are oldest first, every attempt carries the stored fields, and new expectations are added (the forecast case at :268-270 is untouched):

```js
// 12-week retention trend buckets attempts oldest-first with null-safe weeks. Since #151 it
// counts scheduled reviews only: a card in review's first attempt of the day, outside Extra practice.
{
  const trendNow = new Date("2026-08-21T12:00:00.000Z");
  const attempt = (daysAgo, rating, extra = {}) => ({ reviewItemId: `trend-${daysAgo}`, reviewedAt: new Date(trendNow.getTime() - daysAgo * 86_400_000).toISOString(), rating, elapsedMs: 1_000, sessionKind: "review", crunch: false, previousIntervalDays: 3, ...extra });
  const crunch = (daysAgo) => attempt(daysAgo, "good", { reviewItemId: `trend-${daysAgo}-crunch`, sessionKind: "crunch", crunch: true });
  const analytics = reviewAnalytics([
    attempt(200, "good"),                                                 // outside the window
    attempt(80, "again"), crunch(80),                                     // week -11: 0%
    attempt(11, "good"), attempt(10, "good"),                             // week -1: 100%
    attempt(3, "good", { sessionKind: "new", previousIntervalDays: 0 }),  // a first grade
    attempt(2, "again"), attempt(2, "good"),                              // the same card twice that day
    attempt(1, "good"), crunch(1),                                        // current week: 50%
  ], [], trendNow, "UTC");
  const trend = analytics.retentionTrend;
  assert.equal(trend.length, 12);
  assert.equal(trend[11].percent, 50);
  assert.equal(trend[11].count, 2, "the current week counts its two scheduled reviews, not the first grade, the re-grade or Extra practice");
  assert.equal(trend[10].percent, 100);
  assert.equal(trend[0].percent, 0, "the oldest bucket holds the ~80-day-old lapse, not the Extra practice pass beside it");
  assert.equal(trend[5].percent, null, "weeks without attempts stay null, not zero");
  // The review-stats shape both suites assert: recall and its sample sizes.
  assert.deepEqual([analytics.retention7, analytics.scheduledReviews7, analytics.retention30, analytics.scheduledReviews30], [50, 2, 75, 4]);
  // An attempt recorded before intervals were stored normalizes to a 0-day interval and never counts.
  const legacyCard = createReviewItem({ front: "legacy recall", back: "a" }, trendNow);
  const [legacy] = normalizeProfile({ reviewItems: [legacyCard], reviewAttempts: [{ id: "legacy", reviewItemId: legacyCard.id, rating: "good", reviewedAt: new Date(trendNow.getTime() - 86_400_000).toISOString() }] }).reviewAttempts;
  assert.deepEqual([legacy.sessionKind, legacy.previousIntervalDays, legacy.crunch], ["review", 0, false]);
  assert.equal(reviewAnalytics([legacy], [], trendNow, "UTC").scheduledReviews30, 0, "a legacy attempt is left out of recall");
}
```

- [ ] **Step 2: Run the tests to verify they fail for the right reason**

Run: `node --test src/lib/review.test.mjs src/lib/review.scale.test.mjs; node scripts/unit_audit.mjs`
Expected: FAIL. Every new `review.test.mjs` test except the median guard fails with main's blended figure or `scheduledReviews*` undefined, as the `// main:` comments say. The scale test fails at `scheduledReviews7`, and `unit_audit` fails at `trend[11].percent` (80 !== 50). Record the output for the PR.

- [ ] **Step 3: Implement the rule in `reviewAnalytics`**

- Add `isScheduledReview` above `reviewAnalytics`, and a JSDoc on `reviewAnalytics` stating the one definition (the four conditions, oldest-first order, recall as the non-Again share, and that median answer time and the streak use every attempt).
- In the loop, compute the local day once (`localDayKey(new Date(reviewedAt), timeZone).split("@")[0]`) for both `activeDays` and the key. Decide `counted` once per attempt, before any window check: `isScheduledReview(attempt)` and the `${attempt.reviewItemId}|${day}` key not yet in the `Set` (then add it).
- Only counted attempts enter the 7-day, 30-day and trend counters. Latencies stay over every attempt in 30 days.
- Return `scheduledReviews7: count7, scheduledReviews30: count30` right after `retention30`. Leave the `streak` computation and line untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/review.test.mjs src/lib/review.scale.test.mjs && node scripts/unit_audit.mjs && npm run audit:ai`
Expected: PASS. The scale test reports well under 4,000 ms.

- [ ] **Step 5: Commit**

```bash
git add src/lib/review.js src/lib/review.test.mjs src/lib/review.scale.test.mjs scripts/unit_audit.mjs
git commit -m "Count only scheduled reviews in recall figures" -m "Recall counted Extra practice, first grades and same-day re-grades, so it could not be compared with the target retention. reviewAnalytics now counts a card in review's first attempt of the local day outside Extra practice, and returns the sample sizes (#151)."
```

---

### Task 2: Show the sample size and target on the recall tiles

**Files:**
- Modify: `src/components/ReviewCenter.jsx` (:983-1001), `src/styles.css` (stat grid, analytics, ≤900/≤740 px blocks, trend)
- Test: `scripts/review_audit.mjs` (:245 and a new #151 block), `scripts/a11y_audit.mjs` (a new state)

**Interfaces:**
- Consumes: Task 1's `scheduledReviews7`, `scheduledReviews30`, and `retentionTrend[i].count` as scheduled reviews.
- Produces (DOM the audits read):
  - `article.review-recall-tile`, the 30-day stat tile. Its children in this order: `<svg>`, `<strong>` value (`80%` or `—`), `<span>30-day recall</span>`, `<span class="review-recall-count">10 scheduled reviews</span>` and, only with Adaptive on, `<span class="review-recall-target">Target 90%</span>`.
  - `article.review-recall-week`, the 7-day analytics tile: `<svg>`, then a `<div>` of `<strong>` value, `<span>7-day recall</span>` and `<span class="review-recall-count">`.
  - The trend keeps `.review-retention-trend` and its `[role="img"]`.
- Copy (exact):
  - The count: `${n} scheduled review${n === 1 ? "" : "s"}`, through one module-level `scheduledReviewsLabel(count)` in `ReviewCenter.jsx`.
  - The target: `Target ${Math.round((profile.reviewSettings.requestRetention ?? 0.9) * 100)}%`, shown when `(profile.reviewSettings.scheduler || "sm2") === "fsrs"`.
  - The trend's label: `Twelve-week recall on scheduled reviews, oldest first: ${weeks.map((week) => week.percent === null ? "no scheduled reviews" : `${week.percent}% of ${scheduledReviewsLabel(week.count)}`).join(", ")}`.
  - The trend's bar titles: `${weeksAgo(index)}: ${week.percent}% recalled over ${scheduledReviewsLabel(week.count)}`, or `${weeksAgo(index)}: no scheduled reviews` for an empty week.
  - The trend's empty state: "Your weekly recall trend appears after your first scheduled reviews." The subtitle "Weekly retention trend" stays.

- [ ] **Step 1: Write the failing browser checks**

`scripts/review_audit.mjs:245`, changed on purpose (say so in the commit). A new card's first grade is not a scheduled review, so after it the tile reads "—" and "0 scheduled reviews":

```js
  assert.deepEqual(await page.$eval(".review-recall-tile", (tile) => [tile.querySelector("strong").textContent, tile.querySelector(".review-recall-count")?.textContent]), ["—", "0 scheduled reviews"], "a new card's first grade must not count as recall (#151)");
```

A new block, before `assert.deepEqual(errors, [], …)`, in its own browser context. Its page runs at 393×852 (`isMobile`, `hasTouch`) with `await page.emulateTimezone("UTC")`.

- `seedRecall(page, { theme = "paper", reviewSettings = {}, extraCards = [] })` replaces the cards, attempts, mistakes and daily usage by a read-modify-write of the stored profile (as `seedRelearn` does). It merges `settings.theme` and `reviewSettings` (`scheduler: "sm2"`, `requestRetention: 0.9`, then the argument), reloads, waits for `.review-center-page` and asserts `waitForTheme(page, theme)` is ok. It stores the issue's fixture, every attempt yesterday from 12:00 UTC (computed in the page from `Date.UTC` of today's UTC date minus 12 h), oldest first:
  - cards `r01`–`r10`, in review: `intervalDays: 3, repetitions: 2, reviewCount: 3`, lapses 1 on `r01`/`r02`, due in 2 days;
  - cards `n01`–`n03`, graded once: `intervalDays: 1, reviewCount: 1`, due in 1 day;
  - 10 scheduled reviews of `r01`–`r10` at 12:00 + i min (`r01`, `r02` Again): `sessionKind: "review", crunch: false, previousIntervalDays: 3`;
  - 2 re-grades of `r01`, `r02` at 12:20 and 12:21, Good, `previousIntervalDays: 10 / 1_440`;
  - 3 first grades of `n01`–`n03` at 12:30–12:32, Good, `sessionKind: "new", previousIntervalDays: 0`;
  - 20 Extra practice grades of `r01`–`r10` twice from 12:40, Again and Good alternately, `sessionKind: "crunch", crunch: true, previousIntervalDays: 3`.

  Each attempt carries `id`, `elapsedMs: 4_000`, `confidence: 3`, `sessionKey` (yesterday's `YYYY-MM-DD@UTC`), `scheduleRule: 3`, `previousDueAt`, `nextDueAt` and `nextIntervalDays`. `extraCards` are appended to the cards, and the normalizer drops any attempt whose card is missing.
- `recallFit(page)` returns problems, empty when everything fits. For each of `.review-recall-tile`, `.review-recall-week` and `.review-retention-trend`, it lists every visible descendant whose box leaves the article by more than 1 px, and every `HTMLElement` descendant whose `scrollWidth` exceeds its `clientWidth` by more than 1. It also reports `document.documentElement.scrollWidth > document.documentElement.clientWidth`.

The checks, in order:

1. **Classic** (`seedRecall(page, { extraCards: [r11] })`, where `r11` is a card in review with a 3-day interval, last reviewed 3 days ago and due an hour ago):
   - `.review-recall-tile` reads `80%` and `10 scheduled reviews`, with no `.review-recall-target`.
   - `.review-recall-week` reads `80%` and `10 scheduled reviews`.
   - The trend's `[role="img"]` label contains "scheduled reviews" and ends with "80% of 10 scheduled reviews". Its last bar's `title` is "This week: 80% recalled over 10 scheduled reviews".
2. **A real grade counts; Extra practice does not.**
   - Start review, Show answer, then Good on `r11`. Wait until the tile reads `82%` and `11 scheduled reviews`.
   - Crunch weak cards, Show answer and Good on its first card, then End session. The tile still reads `82%` and `11 scheduled reviews`.
   - The stored profile, read through `savedProfile`, holds 37 attempts.
3. **Adaptive** (`seedRecall(page, { reviewSettings: { scheduler: "fsrs" } })`):
   - The tile's `strong, span` texts in DOM order are `["80%", "30-day recall", "10 scheduled reviews", "Target 90%"]`. Their `top` values do not decrease, and none is inside `[aria-hidden="true"]`.
   - `page.select('select[aria-label="Target retention"]', "0.85")` makes it "Target 85%". Clicking the workload planner's "95%" button makes it "Target 95%".
   - Selecting `sm2` in `select[aria-label="Scheduling algorithm"]` removes `.review-recall-target`.
4. **Fit.** For each theme in `paper`, `dark` and `contrast`, run `seedRecall(page, { theme, reviewSettings: { scheduler: "fsrs" } })`. Then, for each of `[393, 852, 1]`, `[320, 568, 1]` and `[360, 800, 2]`:
   - `setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true })`, then set `document.documentElement.style.fontSize = `${16 * scale}px``;
   - `await settled(page, label)` (import it from `./audit_waits.mjs`);
   - assert `recallFit(page)` is empty, with the theme and size in the message.

   Restore 393×852 afterwards.

Add the checks to the closing `console.log` summary ("…, and recall that counts scheduled reviews only: 80% of 10 on the issue's fixture, …").

`scripts/a11y_audit.mjs`: add a state `review-recall` after `review-retry`, with `route: ROUTES[4]`:
- `storeRecallAudit(page, on)` is a read-modify-write that keeps everything else.
  - On: it adds cards `a11y-recall-1` and `a11y-recall-2` (in review, 3-day interval, due in 2 days) and one scheduled review of each yesterday, Good and Again (`sessionKind: "review", crunch: false, previousIntervalDays: 3`). It sets `reviewSettings.scheduler = "fsrs"`.
  - Off: it removes those cards and attempts by id and sets `scheduler: "sm2"`.
- `setup`: `storeRecallAudit(page, true)`, `reloadInTheme(page, ".review-recall-target")`, then remove the body gradient as the sibling states do.
- `ready`: `.review-recall-target`.
- `verify(page, label)`: the three recall articles fit, using the same checks as `recallFit` against the layout viewport, `check(...)`-style.
- `close`: `storeRecallAudit(page, false)` and `reloadInTheme(page, ".review-center-page")`. Then assert no `.review-recall-target` and no `.review-deck-card` remain, so the next route scans see an empty deck under Classic.
- Update the STATES comment that lists the states needing cards.

- [ ] **Step 2: Run them to verify they fail for the right reason**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- review a11y`
Expected: FAIL. `audit:review` fails at line 245 (`.review-recall-tile` missing), and `audit:a11y` reports "the state could not be scanned" for `review-recall` in every theme and viewport. Record the first failing message of each.

- [ ] **Step 3: Implement the tiles, the trend copy and the layout**

- JSX: as in the Interfaces block; derive `adaptive` and `targetRetention` once beside `trendHasData`.
- CSS, tokens only (the count and target take the sibling spans' existing colour and size rules):
  - Above 900 px the 30-day tile's icon spans every text row: its rows are explicit, so the count and target don't land in implicit rows under the icon.
  - At 900 px and below the tile stays the centred stack it is today.
  - Text wraps at word boundaries with nothing clipped.
  - Make the 12-week trend fit at 320 px with graded reviews; the chart stays beside its heading at 393 px and wider.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- review a11y responsive visual`
Expected: PASS for all four suites (axe clean, `review-recall` scanned in Paper, Night and Contrast at 393×852 and 1280×800).

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewCenter.jsx src/styles.css scripts/review_audit.mjs scripts/a11y_audit.mjs
git commit -m "Show scheduled-review counts and the target on recall tiles" -m "The tiles now say how many scheduled reviews they count and, with Adaptive on, the target retention beside the 30-day value; the 12-week trend fits at 320 px. review_audit's first-grade check now expects '—' and '0 scheduled reviews': a new card's first grade is not recall (#151)."
```

---

### Task 3: Record the change (after the full gate)

**Files:** `docs/internal/PRODUCT_REQUIREMENTS.md`, `docs/FUNCTIONAL_TESTING.md`, `docs/guides/APP_GUIDE.md`, `docs/DEVICE_TESTING.md`

This runs after `npm run check` and the full `npm run check:browser` pass on the finished branch, and uses their results and `npm run size`'s figures.

- [ ] **Step 1: PRD.** Append one dated row (`date +%F`) to the verification log, in the existing three-column shape: "Recall counts scheduled reviews only (issue #151; LEARN-003)". It covers:
  - what main showed: 66% of 35 on the fixture, and 83% for the issue's example;
  - the rule and the two new return fields;
  - the tiles, target and trend copy;
  - the 320 px trend fix;
  - the tests that fail before and pass after;
  - the budgets.

  It says LEARN-003 stays `Partial`. Edit no other row, and leave the header date and the LEARN-003 delivered line alone.
- [ ] **Step 2: FUNCTIONAL_TESTING.** Add "## Bugs reproduced on <date>: recall percentages count Crunch, first and same-day grades (#151)" after the last entry, in the house style: against main, then what changed, then how each is now checked.
- [ ] **Step 3: APP_GUIDE.** In the review-cards bullet, add one sentence: the 7-day and 30-day recall figures and the 12-week trend count only scheduled reviews (a card's first grade of the day once it is in review, outside Extra practice). Each tile shows how many it counts, and with Adaptive on the 30-day tile shows the target retention.
- [ ] **Step 4: DEVICE_TESTING.** Add "## Recall tile checks that need a device (issue #151)" after the #149 section. It lists what Chrome covers, then three device checks:
  - VoiceOver reads the 30-day tile as value, "30-day recall", count, then target, with the icon silent;
  - Larger Text wraps the tiles inside the screen in portrait and landscape, in Paper, Night and Contrast;
  - the target follows the Retention picker.
- [ ] **Step 5: Commit** `git commit -m "Record the scheduled-review recall definition (#151)"` with a short body.
