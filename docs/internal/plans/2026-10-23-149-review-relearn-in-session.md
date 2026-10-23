# Relearn a failed card in the same sitting (#149) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card the learner fails comes back in the same sitting. The 10-minute step lasts exactly 10 minutes, a session whose last card fails offers a retry instead of ending, Extra practice re-asks a failed card once, and the daily review limit never strands a step until tomorrow.

**Architecture:** `src/lib/review.js` owns the scheduling rules. One rounding helper keyed on the attempt's `scheduleRule` makes rule 3 store a sub-day step to the minute, and live grades, previews and sync replay all go through it. A pure `learnAheadCards` lists the pending steps, and `buildReviewQueue` lets due steps past the review limit and admits listed early steps on request. `src/components/ReviewCenter.jsx` turns an empty queue with pending steps into a retry state, and re-queues an Extra practice failure once.

**Tech Stack:** Plain ES modules, React 19 (ReviewCenter), `node:test`, Puppeteer browser audits, axe-core.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/149 (binding, with its comment from #148: the rounding must depend on the attempt's rule, so rule-2 attempts replay unchanged; this fix is rule 3). Depends on #148 (merged in PR #194, main 97d3e2e). Related, not implemented here: #114 (edits the same session component; rebase on whichever lands first), #164 (practice-only sessions), #195 (sync duplicate attempts), #196 (FSRS Mastered inflation).

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`; rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist (`ALLOWLIST = []` in `scripts/a11y_audit.mjs` stays empty); theme tokens only (Paper, Night, Contrast, System), no hard-coded colours (`src/lib/themeContrast.test.mjs` rejects an undefined `var()`); 44 px touch targets and ≥ 16 px form text on phones; check 320 px, 393 px, 200% text and landscape.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (measure main 97d3e2e's numbers with `npm run size` before the gate and report both).
- Local-first: no network request, no paid or cloud AI, no tracking; learner data stays on the device.
- Persisted data: no new field. `scheduleRule: 3` is already kept by the attempt normalizer (#148 keeps integers 1 to 1,000), and `numberWithin(item.intervalDays, 0, 36_500, 0)` (`src/lib/db.js:1266`) keeps fractions, so `db.js`, the backup fixture and the merge code do not change. Sync replay already grades each attempt under its own rule (`src/lib/profileSync.js:441`); `src/lib/profileSync.test.mjs` gains the rule-2/rule-3 merge case.
- Never weaken an assertion. The assertions under "Assertions changed on purpose" change because the behaviour changes; every commit and the PR name them.
- Browser audits wait for what a check reads (`scripts/audit_waits.mjs`; `savedProfile(page, landed)` in `scripts/review_audit.mjs`), never a guessed delay. The page clock is advanced with the shim in Task 3, never by sleeping.
- Commits: concise imperative subject, short why-body, no trailers.
- Exact values from the issue:
  - Again sets `10 / 1_440` day under Classic and FSRS, due exactly 600,000 ms after `reviewedAt`, and reads "10 min" (today 0.01 day = 864,000 ms, "14 min").
  - Intervals under 1 day are rounded to the nearest minute; longer ones to 0.01 day; in both `gradeReviewItem` and `previewReviewIntervals`.
  - New attempts carry `scheduleRule: 3`. Attempts at rule 2 or below replay with 0.01-day rounding.
  - `learnAheadCards(items, now, { minutes: 20 })` returns active cards in a sub-day step that come due within 20 minutes, earliest first.
  - Retry state: "1 card to retry · due in 9 min" (the issue's example), with **Retry now** and **End session**; it never claims "Session complete" while a card is pending; a polite status announces each step once.
  - A step card that comes due mid-session rejoins the queue on the existing 30-second clock tick (`ReviewCenter.jsx:511-521`).
  - Extra practice: a card graded Again is re-queued once, after the rest of the session.
  - Cards in a sub-day step bypass the `reviewRemaining` slice; their grades still count in `reviewCompleted`; no session schema change.
  - `actionableReviewCount` stays "due now": the hero count, Home and the badges ignore cards reachable only by learning ahead.
  - Already-saved 0.01-day learning cards are not migrated.
  - The retry state works at 393×852, 320 px and 200% text, in Paper, Night and Contrast, by keyboard and VoiceOver, with 44 px targets, and axe is clean.
- Out of scope (the issue): configurable learning steps, the day boundary, practice-only sessions (#164); and #195, #196.

## Assertions changed on purpose

1. `scripts/unit_audit.mjs:354`: `lapse.item.intervalDays` from `0.01` to `10 / 1_440` (the issue's named change).
2. `src/lib/review.test.mjs:79`: the lapse's `intervalDays: 0.01` becomes `10 / 1_440`.
3. `src/lib/review.test.mjs:82-91`: the current rule is 3, not 2 (`REVIEW_SCHEDULE_RULE`, the default attempt rule and the malformed-rule fallback). The "later build" example moves from rule 3 to rule 4, and a rule-2 line is added.
4. `src/lib/review.test.mjs:97`: the preview's `again: 0.01` becomes `10 / 1_440`.
5. `scripts/review_audit.mjs:863`: the Again button reads `"10 min · 1"`, not `"14 min · 1"`.
6. `scripts/review_audit.mjs:988` and `:1007`: the Extra practice attempts record `scheduleRule` 3, not 2.
7. `src/lib/profileSync.test.mjs:301` and `:317`: the two grades that relied on the build's rule pass `{ scheduleRule: 2 }`, so the #148 tests keep testing rule 2. Their assertions are unchanged.
8. `scripts/review_audit.mjs:217-218` and `:254-255`: failing the last card now shows the retry state. The flow asserts it and ends the session from it before it reads the mistake notebook.

## Review Focus

- A step stored as 0.01 day by an earlier build (due 14.4 minutes after its review): learn-ahead and the limit bypass treat it as a step, and it is not rewritten. Tests: Task 2 (`legacy-in-5`, `legacy-due`).
- A step card coming due while another card's answer is revealed: the answer, its focus and the answer timer stay; the rejoined card waits its turn. Test: Task 3, scenario B.
- Several cards pending retry: the title reads "2 cards to retry · next due in 10 min", and Retry now presents them earliest first. Test: Task 3, scenario B.
- Undo (Cmd/Ctrl+Z) right after failing the last card: the card returns as the current card with its schedule restored, and failing it again is announced again. Test: Task 3, scenario A.
- Undo of a first Again in Extra practice: the card is not queued twice, and it still returns once when it fails again. Test: Task 4, scenario D.

## Rulings

- Ruling: the worktree was created with `git worktree add --no-track` from origin/main, not the native tool, which cannot set the branch name or path — Cost if wrong: it is removed by hand after merge.
- Ruling: rule 3 differs from rule 2 only below one day: the interval is rounded to the minute and the due time is the review time plus whole minutes × 60,000 ms. Intervals of a day or more keep 0.01-day rounding and today's `now + intervalDays × 86,400,000` due time, so rule-3 day intervals are byte-identical to rule 2 — Cost if wrong: none for replay; a later rule can change day intervals.
- Ruling: whole minutes make the due time exact by construction. The old formula is exact for real dates (200,000 random 2020–2100 review times checked) but drops a millisecond near the epoch (91 of 1,439 minute steps at 1970) — Cost if wrong: none.
- Ruling: a card is in a learning step when it is not new and `0 < intervalDays < 1`. That covers Classic's and FSRS's 10-minute step and legacy 0.01-day steps. A reviewed card stored with a 0 interval (a malformed import) is not a step — Cost if wrong: such a card still obeys the review limit.
- Ruling: the learn-ahead window is `now < dueAt ≤ now + 20 minutes`. A card due at `now` is already in the queue — Cost if wrong: none.
- Ruling: Retry now admits the pending cards through a `learnAheadIds` option on `buildReviewQueue` (unit-tested, never passed by `actionableReviewCount`). They are appended after the due and new cards, earliest first. A graded card leaves the admitted set, so a second Again asks again (the issue's decision 1) — Cost if wrong: one more tap per repeat failure.
- Ruling: learn-ahead and the retry state belong to the daily session. Extra practice re-queues a failed card once and ends when its queue is empty — Cost if wrong: a card failed twice in Extra practice waits for the daily queue.
- Ruling: when a pending card comes due while the retry state shows, the session presents it on the clock tick and focus moves to its prompt, with no extra status line (focus reads the prompt) — Cost if wrong: a learner who left the screen open finds the card instead of the panel.
- Ruling: the grade outcome is announced once the grade has landed. The grade stores "Rated X: next review in Y.", and the queue effect appends "N cards left.", "N cards to retry." or "Session complete." from the new queue, so a step that spends a limit slot, or an Extra practice re-queue, cannot make the count wrong. The status is cleared at each grade and undo, so two identical outcomes in a row are both announced — Cost if wrong: one empty status update per grade.
- Ruling: in the retry state the progress bar counts pending retry cards (`sessionDone + queue.length + retryCards.length`), so it never reads complete, and the header count reads "N · to retry" — Cost if wrong: two strings.
- Ruling: the session header's End session and Undo grow to 44 px tall on phones (≤ 740 px), because they are targets in the retry state (they were 42 px) — Cost if wrong: every session header is 2 px taller on phones.
- Ruling: a not-yet-due step card shown early (Retry now, an Extra practice second try) is labelled "Learning · 10 min interval", not "Review · …" — Cost if wrong: one label.
- Ruling: the per-card reset (hide the answer, reset confidence and the answer timer) is keyed on the shown card's id, not the queue's membership. Today any membership change hides a revealed answer, which a rejoining step would make common — Cost if wrong: none; the reset still runs for every new card.
- Ruling: a step card graded past the limit counts in `reviewCompleted`, as the issue says, so the hero can read "21/20 reviews" — Cost if wrong: a confusing ratio on days the limit binds.
- Ruling: copy. Title: "1 card to retry · due in N min", or "N cards to retry · next due in N min"; N is the minutes until the earliest is due, rounded up, at least 1. Body: "Retry now shows it early. If you end the session, it comes back when it is due." (plural: "them", "they come back when they are due"). Status: "Rated Again: next review in 10 min. 1 card to retry." and "Retrying 1 card." — Cost if wrong: copy edits.
- Ruling: the review audit advances the page's own clock: a `Date` shim installed with `evaluateOnNewDocument` (every `new Date()` and `Date.now()`), then a `focus` event runs the review center's clock refresh, the same `refresh` the 30-second interval calls — Cost if wrong: the interval timer itself is not exercised.
- Ruling: the a11y state reaches the retry state by burying a due card next to a pending step, so it stores no attempt, usage row or mistake to clean up — Cost if wrong: none.
- Ruling: the responsive surface fails the seeded due card live rather than seeding a step card, so the 10-minute window never depends on how long the earlier viewports took — Cost if wrong: one mistake entry per viewport context.
- Ruling: `scripts/cross_tab_audit.mjs` is not extended: no field is edited in the UI, and two tabs of one build cannot produce a two-rule merge; `profileSync.test.mjs` covers it — Cost if wrong: no browser-level two-tab evidence.

## Files

- Modify `src/lib/review.js`: rule 3 and its rounding helper (`gradeReviewItem`, both `previewReviewIntervals` branches), `isLearningStep`, `LEARN_AHEAD_MINUTES`, `learnAheadCards`, `buildReviewQueue` (limit bypass, `learnAheadIds`).
- Modify `src/lib/review.test.mjs`, `src/lib/profileSync.test.mjs`, `scripts/unit_audit.mjs`.
- Modify `src/components/ReviewCenter.jsx` (retry state, per-card reset, announcements, keyboard, focus, Extra practice re-queue) and `src/styles.css`.
- Modify `scripts/review_audit.mjs`, `scripts/a11y_audit.mjs`, `scripts/responsive_audit.mjs`.
- Docs (controller, after the gate): `docs/internal/PRODUCT_REQUIREMENTS.md`, `docs/FUNCTIONAL_TESTING.md`, `docs/guides/APP_GUIDE.md`, `docs/DEVICE_TESTING.md`.

---

### Task 1: Store the 10-minute step exactly under schedule rule 3

**Files:**
- Modify: `src/lib/review.js` (`REVIEW_SCHEDULE_RULE` at :264-268, `previewReviewIntervals` at :301-308, `gradeReviewItem` at :341-342)
- Test: `src/lib/review.test.mjs`, `src/lib/profileSync.test.mjs`, `scripts/unit_audit.mjs:354`, `scripts/review_audit.mjs:863, :988, :1007`

**Interfaces:**
- Produces: `export const REVIEW_SCHEDULE_RULE = 3;` (its comment names rule 3: a sub-day step is stored to the minute). An internal `MINUTE_STEP_SCHEDULE_RULE = 3` and helper `scheduledInterval(days, scheduleRule) => { intervalDays, dueInMs }`: it clamps to `[10 / 1_440, 36_500]`; under a rule ≥ 3 a clamped value under 1 day becomes `minutes / 1_440` with `dueInMs = minutes × 60_000` (`minutes = Math.round(days × 1_440)`); otherwise `Math.round(days × 100) / 100` with `dueInMs = intervalDays × 86_400_000`. `gradeReviewItem` stores its `intervalDays` and `nextDueAt = new Date(now.getTime() + dueInMs)`; both `previewReviewIntervals` branches return its `intervalDays` under `REVIEW_SCHEDULE_RULE`.

- [ ] **Step 1: Write the failing tests.** In `src/lib/review.test.mjs`, import `formatInterval` too and add:

```js
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
```

Make the changes listed under "Assertions changed on purpose" 2, 3 and 4 in this file. The rule test is renamed "attempts record schedule rule 3 and grade an older rule on request". It asserts `REVIEW_SCHEDULE_RULE === 3` and the default attempt rule 3, keeps the rule-1 line (`[25, 1]`), and adds `[10, 2]` for `{ scheduleRule: 2 }` ("rule 2 stays early-aware"). `{ scheduleRule: 4 }` gives `[10, 4]` ("a later build's rule stays early-aware"), and the malformed values fall back to 3.

In `scripts/unit_audit.mjs:354` make change 1. In `scripts/review_audit.mjs` make changes 5 and 6 (`:863`, `:988`, `:1007`).

In `src/lib/profileSync.test.mjs` make change 7, and add:

```js
test("a rule-2 and a rule-3 Again of one card merge to the same card in either order (#149)", () => {
  const gradedAt = new Date("2026-08-23T09:00:00.000Z");
  const card = { ...reviewRecord("step-rules", "Step rule card"), intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0, lastReviewedAt: new Date(gradedAt.getTime() - 10 * 86_400_000).toISOString(), dueAt: gradedAt.toISOString() };
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  // A tab on the #148 build fails the card and stores the 0.01-day step;
  // a tab on this build fails it a minute later and stores 10 minutes.
  const oldTab = gradeProfile(base, card.id, "again", gradedAt.toISOString(), "attempt-rule-2", { scheduleRule: 2 });
  const newTab = gradeProfile(base, card.id, "again", new Date(gradedAt.getTime() + 60_000).toISOString(), "attempt-rule-3");
  assert.deepEqual([oldTab.reviewItems[0].intervalDays, newTab.reviewItems[0].intervalDays], [0.01, 10 / 1_440]); // main: 0.01, 0.01
  const leftFirst = mergeProfileVersions(base, oldTab, newTab, { now: NOW, advanceRevision: false }).profile;
  const rightFirst = mergeProfileVersions(base, newTab, oldTab, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(leftFirst), reviewMergeProjection(rightFirst));
  assert.deepEqual(leftFirst.reviewAttempts.map((attempt) => [attempt.id, attempt.scheduleRule, attempt.nextIntervalDays, Date.parse(attempt.nextDueAt) - Date.parse(attempt.reviewedAt)]), [["attempt-rule-2", 2, 0.01, 864_000], ["attempt-rule-3", 3, 10 / 1_440, 600_000]]);
  const merged = leftFirst.reviewItems[0];
  assert.deepEqual([merged.intervalDays, Date.parse(merged.dueAt) - Date.parse(merged.lastReviewedAt), merged.lapses, merged.reviewCount], [10 / 1_440, 600_000, 2, 6]);
});
```

- [ ] **Step 2: Run against the unchanged `src/lib/review.js` and record every failure.** Run `node --test src/lib/review.test.mjs src/lib/profileSync.test.mjs` and `npm run audit:unit`. Expected: the two new #149 tests in `review.test.mjs` fail with main's 0.01 / 864,000 / "14 min"; changes 2–4 fail with 0.01 and rule 2; the new merge test fails at `[0.01, 0.01]`; `audit:unit` fails at `:354` (0.01). The two guard tests and the pinned #148 merge tests pass. Save the output for the PR.

- [ ] **Step 3: Implement** `REVIEW_SCHEDULE_RULE = 3` and `scheduledInterval` in `src/lib/review.js` as the Interfaces block states, and route line 341-342 and both preview branches (`:304`, `:307`) through it. Update the rule comment at :264-267.

- [ ] **Step 4: Run the tests.** `node --test src/lib/review.test.mjs src/lib/profileSync.test.mjs src/lib/fsrs.test.mjs src/lib/backup.test.mjs`, `npm run audit:unit`, `npm run audit:scale`, then `npm run build && npm run check:browser -- review` (the #148 block now reads "10 min · 1" and rule 3). Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/review.js src/lib/review.test.mjs src/lib/profileSync.test.mjs scripts/unit_audit.mjs scripts/review_audit.mjs
git commit -m "Store the 10-minute relearning step to the minute" -m "Every interval was rounded to 0.01 day, so the 10-minute step after Again was 14.4 minutes and the button read 14 min. New attempts record schedule rule 3, which stores a sub-day step to the minute, due exactly 600,000 ms later; rule 1 and 2 attempts replay with 0.01-day rounding, so merges stay deterministic. Assertions changed on purpose: unit_audit's lapse interval (0.01 to 10/1440), review.test's lapse, rule and preview values, and review_audit's 14 min label and rule 2 checks; two #148 sync tests now pin rule 2 explicitly."
```

### Task 2: Learn-ahead and the daily limit for learning steps

**Files:**
- Modify: `src/lib/review.js` (`buildReviewQueue` at :206-230; new exports beside it)
- Test: `src/lib/review.test.mjs`

**Interfaces:**
- Produces:
  - `export const LEARN_AHEAD_MINUTES = 20;`
  - `export const isLearningStep = (item) => boolean`: not new (`isNewReviewItem`) and `0 < intervalDays < 1`.
  - `export const learnAheadCards = (items, now = new Date(), { minutes = LEARN_AHEAD_MINUTES, timeZone = currentTimeZone() } = {}) => item[]`: learning steps that are not suspended, archived or buried today (`localDayKey(now, timeZone)`), with `now < Date.parse(dueAt) ≤ now + minutes × 60_000`, sorted by `dueAt`, then `id`.
  - `buildReviewQueue(items, settings, now, sessions, options)`, daily path: due learning steps bypass the `reviewRemaining` slice and keep their `dueAt` order among the due reviews, while other due reviews fill only the remaining slots. `options.learnAheadIds` (default none): the `learnAheadCards(items, now, { timeZone })` whose ids are listed, appended after the due and new cards, earliest first. The crunch path is unchanged. `actionableReviewCount` never passes `learnAheadIds`.

- [ ] **Step 1: Write the failing tests** in `src/lib/review.test.mjs` (import `actionableReviewCount`, `buildReviewQueue`, `emptyReviewSession`, `isLearningStep`, `LEARN_AHEAD_MINUTES`, `learnAheadCards`, `localDayKey`, `recordReviewUsage`):

```js
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
  assert.deepEqual([stepCard("s", 0), stepCard("l", 0, { intervalDays: 0.01 }), probeCard(), createReviewItem({ front: "n", back: "c" }, NOW), probeCard({ intervalDays: 0 })].map(isLearningStep), [true, true, false, false, false]);
});

test("due learning steps bypass the spent daily review limit; other reviews still wait (#149)", () => {
  const settings = { dailyNewLimit: 0, dailyReviewLimit: 2 };
  const cards = [probeCard({ id: "review-due", lastReviewedAt: iso(-4 * DAY_MS), intervalDays: 3, dueAt: iso(-DAY_MS) }), stepCard("step-due", -MINUTE_MS), stepCard("legacy-due", -2 * MINUTE_MS, { intervalDays: 0.01 })];
  const queue = (completed) => buildReviewQueue(cards, settings, NOW, todayUsage(completed), { timeZone: "UTC" }).map((item) => item.id);
  assert.deepEqual(queue(2), ["legacy-due", "step-due"]); // main: []
  assert.deepEqual(queue(1), ["review-due", "legacy-due", "step-due"]); // main: ["review-due"]
  assert.deepEqual(queue(0), ["review-due", "legacy-due", "step-due"]); // main: ["review-due", "legacy-due"]
  assert.equal(actionableReviewCount({ reviewItems: cards, reviewSettings: settings, reviewSessions: todayUsage(2) }, NOW, "UTC"), 2); // main: 0
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
  const cards = [stepCard("in-9", 9 * MINUTE_MS), stepCard("in-30", 30 * MINUTE_MS), probeCard({ id: "review-in-5", lastReviewedAt: iso(-3 * DAY_MS), intervalDays: 3, dueAt: iso(5 * MINUTE_MS) }), { ...createReviewItem({ front: "new", back: "card" }, at(-DAY_MS)), id: "fresh" }];
  const ids = (options) => buildReviewQueue(cards, settings, NOW, [], { timeZone: "UTC", ...options }).map((item) => item.id);
  assert.deepEqual(ids({}), ["fresh"]);
  assert.equal(actionableReviewCount({ reviewItems: cards, reviewSettings: settings, reviewSessions: [] }, NOW, "UTC"), 1);
  assert.deepEqual(ids({ learnAheadIds: ["in-9", "in-30", "review-in-5"] }), ["fresh", "in-9"]); // main: ["fresh"]
});
```

- [ ] **Step 2: Run against Task 1's code and record the failures.** First run as written: the file fails to load because `learnAheadCards` and its siblings are not exported (the right reason for new functions). Then, in a scratch copy only, drop the missing imports and stub them (`const learnAheadCards = () => []`, `const isLearningStep = () => false`, `const LEARN_AHEAD_MINUTES = undefined`). Run again and record each test's failing assertion; the `// main:` comments give the expected values. Save both outputs for the PR.

- [ ] **Step 3: Implement** the Interfaces block in `src/lib/review.js`, keeping the queue in one pass over the sorted due cards.

- [ ] **Step 4: Run the tests.** `node --test src/lib/review.test.mjs src/lib/review.scale.test.mjs src/lib/assessment.test.mjs src/lib/mastery.test.mjs`, `npm run audit:unit`, `npm run audit:scale`. Expected: all pass, the 10,000-card queue within its 2,000 ms budget.

- [ ] **Step 5: Commit**

```bash
git add src/lib/review.js src/lib/review.test.mjs
git commit -m "List learning steps due soon and let them past the review limit" -m "A card failed on the last review the daily limit allowed stayed hidden until tomorrow after its step had passed, and nothing could show a step a few minutes early. learnAheadCards lists active steps due within 20 minutes, earliest first; buildReviewQueue lets due steps bypass the review slice (their grades still count) and admits listed early steps on request. The shared due count never passes that option, so Home and the badges keep counting cards due now."
```

### Task 3: Offer a retry when the last card of a session fails

**Files:**
- Modify: `src/components/ReviewCenter.jsx` (state :479-509, queue :531-537 and :601-609, effect :634-645, `grade` :647-663, `undo` :673-679, keys :681-696, `startSession`/`endSession` :698-712, focus :714-740, session view :795-838)
- Modify: `src/styles.css` (after `.review-session-actions .review-reveal` at :3082; the `@media (max-width: 740px)` rule at :3153)
- Test: `scripts/review_audit.mjs`

**Interfaces:**
- Consumes (Task 2): `learnAheadCards`, `isLearningStep`, `buildReviewQueue(..., { learnAheadIds })`.
- Produces (Task 4 relies on these): a `pendingOutcomeRef` that `grade` fills with "Rated {label}: next review in {interval}." and the queue effect completes from the new queue ("{n} card(s) left." / "{n} card(s) to retry." / "Session complete."); `grade` and `undo` clear the status (`setAnnouncement("")`), and `undo` also clears the pending outcome. In `scripts/review_audit.mjs`: `installAdjustableClock`, `advanceClock(page, ms)`, `seedRelearn(page, …)`, `watchStatus(page)`/`statusLog(page)`, `focusAndHold(page, selector, text)`, the `relearnContext` and its `relearnPage()`.

- [ ] **Step 1: Write the failing browser checks** in `scripts/review_audit.mjs`.

First, change 8: after each `clickByText(page, ".review-rating", "Again")` at `:217` and `:254`, wait for `.review-retry`, assert its title starts with "1 card to retry", and click its End session (`.review-retry button`) before waiting for `.review-mistakes`.

Then add a `#149` section after the #148 `earlyContext` block's `finally`. It uses a fresh context, `relearnContext`, closed in `finally`. `relearnPage()` opens a new page in it at 393×852 (`isMobile`, `hasTouch`), adds `pageerror` → `errors`, installs `installAdjustableClock` with `evaluateOnNewDocument`, and opens `#/review`. Each scenario uses its own page and closes it in `finally`, so the clock restarts at real time and no older page syncs into it.

```js
// #149: the page's clock, advanced on demand. Every `new Date()` and `Date.now()`
// in the page runs `offset` ms ahead; a new page starts at real time.
function installAdjustableClock() {
  const RealDate = Date;
  let offset = 0;
  function AdjustableDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset);
  }
  AdjustableDate.prototype = RealDate.prototype;
  AdjustableDate.now = () => RealDate.now() + offset;
  AdjustableDate.parse = RealDate.parse;
  AdjustableDate.UTC = RealDate.UTC;
  window.Date = AdjustableDate;
  window.__lumenAdvanceClock = (ms) => { offset += ms; };
  // The opt-in app badge, recorded: a count, or 0 when cleared.
  window.__lumenBadges = [];
  navigator.setAppBadge = (count) => { window.__lumenBadges.push(count); return Promise.resolve(); };
  navigator.clearAppBadge = () => { window.__lumenBadges.push(0); return Promise.resolve(); };
}
// The review center refreshes its clock on window focus, as its 30-second tick does.
const advanceClock = (page, ms) => page.evaluate((delta) => { window.__lumenAdvanceClock(delta); window.dispatchEvent(new Event("focus")); }, ms);
// Every text an existing status line in the review views changes to: updates
// only (an inserted view's initial text is not an announcement), with
// consecutive repeats of one mutation batch folded and empty texts dropped.
const watchStatus = (page) => page.evaluate(() => {
  window.__lumenStatus = [];
  new MutationObserver((records) => {
    for (const record of records) {
      const node = record.type === "characterData" ? record.target.parentElement : record.target;
      if (node?.getAttribute?.("role") !== "status" || !node.closest(".review-session-page, .review-center-page")) continue;
      if (window.__lumenStatus.at(-1) !== node.textContent) window.__lumenStatus.push(node.textContent);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const statusLog = (page) => page.evaluate(() => window.__lumenStatus.filter(Boolean));
```

`seedRelearn(page, { cards, reviewSettings = {}, reviewCompletedToday = 0 })` read-modify-writes the stored profile in the page, as the #148 block does, then reloads and waits for `.review-center-page`.
- Each card is `{ id, front, intervalDays, repetitions, reviewCount, lapses = 0, ease = 2.5, reviewedAgoMs, dueInMs }` and becomes a basic card on `notes/part-05-supervised-learning/01-linear-regression.md` at the page's `Date.now()`.
- `reviewAttempts` and `mistakes` become `[]`, and `settings.dueBadgeEnabled` becomes `true`.
- `reviewSettings` is the stored one with `scheduler: "sm2"` and the given values over it.
- `reviewSessions` is `[]`, or one entry for the page's local day when `reviewCompletedToday > 0`. Its id is `${YYYY-MM-DD}@${zone}`, computed in the page with `Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })` and `zone = Intl.DateTimeFormat().resolvedOptions().timeZone`, as `localDayKey` builds it. Its other fields are those of `emptyReviewSession`.

`focusAndHold` is the focus-and-hold wait the #148 block uses for Crunch weak cards, taking a selector and text.

Scenario A, failing the only due card (keyboard only):
1. Seed one card `retry-solo`: interval 3, repetitions 2, reviewCount 2, reviewed 3 days ago, due 1 minute ago.
2. Assert the last badge is 1. Watch the status, then focus Start review and press Enter. When the prompt has focus, press Space; when the answer has focus, press 1.
3. Wait for `.review-retry` and assert, at 393×852:
   - `#review-retry-title` reads "1 card to retry · due in 10 min" and has focus.
   - The header reads "1" / "to retry", and the progress bar's `aria-valuetext` is "1 of 2 reviewed".
   - The panel's buttons are exactly "Retry now" and "End session".
   - Every button in `.review-session-page` is at least 44×44.
   - No text in the page includes "Session complete".
   - The last badge is 0, and the bottom navigation's Review item shows no count.
4. Via `savedProfile`, assert:
   - one attempt, with `scheduleRule` 3, `nextIntervalDays` 10/1440, and `nextDueAt − reviewedAt` = 600,000;
   - the card's `intervalDays` is 10/1440 and its `dueAt − lastReviewedAt` is 600,000.
5. Press Control+Z. The prompt of `retry-solo` takes focus, the header reads "1" / "remaining today", and the stored attempts become `[]`.
6. Press Space, then 1: the retry state is back.
7. Press Tab: the focused element is Retry now. Press Enter. The prompt takes focus, and the eyebrow starts with "Learning · 10 min interval".
8. Press Space, then 3. `.review-center-page` shows and the hero reads "0".
9. `statusLog` must equal `["Rated Again: next review in 10 min. 1 card to retry.", "Rated Again: next review in 10 min. 1 card to retry.", "Retrying 1 card.", "Rated Good: next review in 3 days. Session complete."]`.

Scenario B, rejoin and several retries:
1. Seed `rejoin-first` (due 2 hours ago) and `rejoin-second` (due 1 hour ago), both with interval 3, repetitions 2 and reviewCount 2. Watch the status. Start review (click).
2. On `rejoin-first`, press Space, then 1. On `rejoin-second`, press Space and wait for the answer to have focus.
3. `advanceClock(page, 10 × 60_000 + 1_000)`, then wait for the header to read "2". Assert the answer is still shown and still has focus, the prompt is still `rejoin-second`, and the four rating buttons are present.
4. Press 1 on `rejoin-second`. `rejoin-first` is shown next, with the "Learning · 10 min interval" eyebrow; press Space, then 1.
5. Assert the retry title reads "2 cards to retry · next due in 10 min". Press Tab, then Enter on Retry now.
6. The prompts that follow are `rejoin-second`, then `rejoin-first`; rate each Good (Space, 3).
7. `statusLog` must equal `["Rated Again: next review in 10 min. 1 card left.", "Rated Again: next review in 10 min. 1 card left.", "Rated Again: next review in 10 min. 2 cards to retry.", "Retrying 2 cards.", "Rated Good: next review in 3 days. 1 card left.", "Rated Good: next review in 3 days. Session complete."]`.

Scenario C, the spent daily limit:
1. Seed `limit-last` (due 2 hours ago) and `limit-waiting` (due 1 hour ago), both with interval 3, plus `{ dailyReviewLimit: 20 }` and `reviewCompletedToday: 19`. The hero reads "1".
2. Start review. The prompt is `limit-last`; press Space, then 1. Assert the retry state, and that the stored session for today counts 20 reviews.
3. Click End session in the panel. Assert the hero reads "0" and its status includes "1 due card waits for tomorrow". On `#/home`, the first `.today-widget strong` reads "0"; go back to `#/review`.
4. `advanceClock(page, 10 × 60_000 + 1_000)`. The hero reads "1". On `#/home` the due widget reads "1"; go back.
5. Start review. The prompt is `limit-last` (not `limit-waiting`); rate it Good.
6. The hero reads "0", and the stored session counts 21 reviews.

- [ ] **Step 2: Run against Task 2's code and record the failures.** Run `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review`.
  - Expected: the main flow fails first, at `.review-retry` after `:217` (the session ends instead).
  - In a scratch copy (not committed), skip the main flow and record each scenario's first failure. A, B and C each fail at their first retry-state or count wait; B fails at "2" because the step is not due 10 minutes later on this code.
  - Also run B with a 15-minute advance: it then fails because the revealed answer is hidden. That is the per-card-reset defect.
  - Save the output.

- [ ] **Step 3: Implement in `src/components/ReviewCenter.jsx`.**
  - **State.** `learnAheadIds` (`[]`), `pendingOutcomeRef` and `retryHeadingRef`. `startSession` and `endSession` reset `learnAheadIds` and the pending outcome.
  - **Queue.** `baseQueue` passes `learnAheadIds` only when `session && !crunch`, and its memo deps gain `learnAheadIds` and `session`.
  - **Retry cards.** `aheadCards` is `learnAheadCards(profile.reviewItems, queueNow, { timeZone })` in a daily session, else `[]`. `retryCards` is the `aheadCards` not in `queue`. `retrying` is `session && !crunch && !queue.length && retryCards.length > 0`.
  - **Queue effect.** Keyed on `queueSignature`, the `retryCards` signature and `session`. It keeps or picks `currentId`, completes a pending outcome into the status, and ends the session only when `queue` and `retryCards` are both empty. The reveal, confidence and `startedAt` resets move to an effect keyed on `sessionCardId`, which is declared above the key handler.
  - **`grade`.** It removes `current.id` from `learnAheadIds`, sets `pendingOutcomeRef` and clears the status. `queueLengthRef` and `left` go.
  - **Retry now.** It sets `learnAheadIds` to `retryCards`' ids and the status to "Retrying {n} card(s).".
  - **`undo`.** It also re-admits `lastAttempt.reviewItemId` to `learnAheadIds`, and clears the status and the pending outcome.
  - **Keys.** Cmd/Ctrl+Z is handled first; every other key returns when there is no `sessionCardId`.
  - **Focus.** When `retrying` turns true, scroll to the top and focus `retryHeadingRef` without scrolling.
  - **Session view.** It renders when `session && (current || retrying)`, keeping the `h1`, the status line, the header and the progress bar in place, so the live region stays mounted.
  - **Header and progress.** The header count reads `retryCards.length` with "to retry" when retrying. `sessionTotal` is `sessionDone + queue.length + retryCards.length`.
  - **Eyebrow.** A `"scheduled"` card that `isLearningStep` labels as "Learning · … interval".
  - **Retry panel.** It replaces the card and its actions:
    - `<section className="review-retry" aria-labelledby="review-retry-title">` with a `RotateCcw` icon;
    - `<h2 id="review-retry-title" tabIndex={-1}>` holding the title from the copy ruling, with its minutes counted to the earliest `retryCards` due time from `queueNow`;
    - a `<p>` with the body copy;
    - `.review-session-actions` with `button primary large` "Retry now" (with `RotateCcw`) and `button secondary large` "End session".
  
  In `src/styles.css`:
  - `.review-retry`: a column flex panel styled like `.review-flashcard` with tokens only (`--paper`, `--line`, `--shadow-md`, `--ink`, `--ink-soft`).
  - `.review-retry h2:focus:not(:focus-visible)`: no outline. Its actions wrap.
  - At ≤ 740 px, the panel's buttons take `flex: 1 1 10rem`, and `.review-session-header > .button` gains `min-height: 44px`.

- [ ] **Step 4: Run the checks.** Run `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review controls storage-blocked`, plus `node --test src/lib/themeContrast.test.mjs` and `npm run audit:app`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewCenter.jsx src/styles.css scripts/review_audit.mjs
git commit -m "Offer a retry instead of ending the session on a failed last card" -m "The session ended as soon as its queue emptied, so a card failed last was never asked again in short sessions. An empty queue with steps due within 20 minutes now shows '1 card to retry · due in N min' with Retry now and End session, a step that comes due mid-session rejoins on the clock tick without hiding a revealed answer, and the polite status announces each step once, composed after the grade lands. Session header buttons are 44 px on phones. The review audit's two Again-on-the-last-card steps now pass through the retry state on purpose."
```

### Task 4: Extra practice asks a failed card once more

**Files:**
- Modify: `src/components/ReviewCenter.jsx` (the queue at :601, `grade`, `undo`, `startSession`)
- Test: `scripts/review_audit.mjs` (the #149 section)

**Interfaces:**
- Consumes (Task 3): the deferred outcome, the cleared status on `undo`, and the review-audit helpers `relearnPage`, `seedRelearn`, `watchStatus`/`statusLog` and `focusAndHold`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing check**, scenario D, in the #149 section:
  1. Seed `crunch-a` (lapses 2, ease 1.8) and `crunch-b` (lapses 0). Both have interval 10, repetitions 4 and reviewCount 4, were reviewed a day ago, and are due in 9 days. Watch the status.
  2. Focus and hold Crunch weak cards and press Enter. The prompt is `crunch-a`; press Space, then 1.
  3. Press Control+Z. The prompt of `crunch-a` takes focus, and the header reads "2" / "practice cards left". Press Space, then 1 again.
  4. `crunch-b`: press Space, then 3.
  5. `crunch-a` returns, labelled "Learning · 10 min interval". Press Space, then 1. `.review-center-page` shows.
  6. The prompts shown are, in order, a, a, b, a.
  7. `statusLog` must equal `["Rated Again: next review in 10 min. 2 cards left.", "Rated Again: next review in 10 min. 2 cards left.", "Rated Good: next review in 10 days. 1 card left.", "Rated Again: next review in 10 min. Session complete."]`.
  8. The stored attempts are `[a again, b good, a again]`, all with `crunch: true` and `scheduleRule` 3.

- [ ] **Step 2: Run against Task 3's code and record the failure.** Run `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review`. Expected: scenario D fails at its first status ("1 card left.": the failed card is not re-queued). Save the output.

- [ ] **Step 3: Implement.**
  - `crunchFailedIds` and `crunchRetriedIds` (`[]`, reset in `startSession`).
  - In Extra practice, `queue` is the unseen `baseQueue` followed by the failed-but-not-retried cards: current items from `profile.reviewItems` that are not suspended, archived or buried today (`localDayKey(queueNow, timeZone)`), in fail order, deduplicated by id.
  - `grade`, in Extra practice: an id already in `crunchFailedIds` is added to `crunchRetriedIds`; otherwise an Again adds it to `crunchFailedIds`. It joins `sessionSeen` either way.
  - `undo`: when the undone id is in `crunchRetriedIds`, remove it there; otherwise remove it from `crunchFailedIds`.

- [ ] **Step 4: Run the checks.** `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewCenter.jsx scripts/review_audit.mjs
git commit -m "Ask a card failed in Extra practice once more at the end" -m "Every graded card in Extra practice joined the seen list the queue filters out, so a failed card never came back. A card's first Again now re-queues it once, after the rest of the session; its second grade ends that, and undo reverses the bookkeeping so a card is never queued twice."
```

### Task 5: Check the retry state's layout and accessibility in every theme

**Files:**
- Modify: `scripts/a11y_audit.mjs` (helpers at :54-90, `STATES` at :101-262)
- Modify: `scripts/responsive_audit.mjs` (:391-396)

**Interfaces:**
- Consumes (Task 3): `.review-retry`, `#review-retry-title`, the panel's buttons.

- [ ] **Step 1: Add the a11y state.** Generalize `storePracticeCard` into `storeAuditCards(page, ids, cards)`, which removes `ids` and adds `cards`, and keep `storePracticeCard(page, card)` as a call to it. Add the `review-retry` state on `ROUTES[4]`.
  - **Cards.** It stores two cards built at setup time:
    - `a11y-retry-due`: interval 3, repetitions 2, reviewCount 2, reviewed 3 days ago, due an hour ago.
    - `a11y-retry-step`: interval 10/1440, repetitions 0, reviewCount 3, lapses 1, reviewed a minute ago, due in 9 minutes.
  - **Setup.**
    1. Store the cards, then `reloadInTheme(page, '.review-deck-card[data-card-id="a11y-retry-due"]')`.
    2. Turn off the body gradient, as `extra-practice` does.
    3. Click Start review. When the prompt shows, click "Bury today".
  - **`ready`.** `.review-retry`.
  - **`verify`.**
    - The panel's right edge and the page's `scrollWidth` are within `document.documentElement.clientWidth`.
    - `document.activeElement.id` is `review-retry-title`.
    - On the phone pass, every button in `.review-session-page` is at least 44×44.
  - **`close`.**
    1. Click the panel's End session.
    2. Remove both cards with `storeAuditCards`, then `reloadInTheme(page, ".review-center-page")`.
    3. Assert that neither card is in the deck.
  
  Update the `STATES` comment to name this state.

- [ ] **Step 2: Add the responsive surface.** After `await inspect("review-answer", ".review-session-page");`:
  1. Click the `.review-rating` button containing "Again", and wait for `.review-retry`.
  2. `await inspect("review-retry", ".review-session-page")`, then `await reach(".review-retry .button.primary")`.
  3. The existing End session (`.review-session-header button`) step follows unchanged.

- [ ] **Step 3: Run both suites.** `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- a11y responsive`. Expected: pass; the a11y summary shows 6 more axe runs (one per theme and viewport) than before. Record the before and after counts. To prove the checks can fail, make three scratch mutations (not committed) and confirm each is reported:
  - `white-space: nowrap` on `.review-retry h2` fails the fit check at 320 px;
  - a hard-coded `color: #999` on the panel text is caught by axe or `themeContrast`;
  - removing the 44 px header rule fails the size check.

- [ ] **Step 4: Commit**

```bash
git add scripts/a11y_audit.mjs scripts/responsive_audit.mjs
git commit -m "Check the retry state's layout and accessibility" -m "The responsive audit now inspects the retry state at every size, 320px and 200% text included, and the accessibility audit scans it with axe in Paper, Night and Contrast at 393x852 and 1280x800, checking its fit, its focus and 44px targets. The a11y state reaches it by burying a due card beside a pending step, so it leaves no attempt, usage row or mistake behind."
```

---

## After the tasks (controller, not SDD tasks)

1. **Before/after evidence.** Copy every new and changed check onto a scratch worktree of main 97d3e2e, run it there, and record each failure and its message for the PR. The guards must pass there.
2. **Gate in the worktree.** Run `npm run check`, then the full `npm run check:browser`. Record `audit:app`'s and `npm run size`'s startup entry and install route screen bytes against main's numbers.
3. **Docs.**
   - `docs/internal/PRODUCT_REQUIREMENTS.md`: a dated verification-log row (LEARN-003 stays Partial).
   - `docs/FUNCTIONAL_TESTING.md`: a dated "Bugs reproduced" entry (the probe on main, each new check and its failure on main, budgets, gate results), and the new state in its accessibility list.
   - `docs/guides/APP_GUIDE.md`: the review bullet gains the exact 10-minute step, the retry state and Extra practice's second try.
   - `docs/DEVICE_TESTING.md`: a section for VoiceOver and iOS text sizes in the retry state (what is read, where focus lands, the announcement once per step).
4. **PR body.** What changed, the tests that fail before and pass after, the guards that pass on both, the assertions changed on purpose, gate results with any retries, budgets, the rulings, and `Closes #149` last.
