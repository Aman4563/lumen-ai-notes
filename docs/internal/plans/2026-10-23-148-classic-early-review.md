# Classic early-review scheduling (#148) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under the default Classic scheduler, a card graded before its interval has elapsed (Extra practice / "Crunch weak cards") grows from the time actually waited instead of multiplying its interval, and sync replays every attempt under the rule it was graded with.

**Architecture:** One function, `intervalForRating` in `src/lib/review.js`, decides Classic intervals for live grades, rating previews and sync replay. It gains the grade time and a schedule rule: rule 1 is today's math, rule 2 adds the early-review branch. `gradeReviewItem` stamps the rule on each attempt; the attempt normalizer (`src/lib/db.js`) keeps it and `replayReviewAttempt` (`src/lib/profileSync.js`) passes it back, so every device rebuilds the same card.

**Tech Stack:** Plain ES modules, React 19 (ReviewCenter), `node:test`, Puppeteer browser audits, axe-core.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/148 (binding, with its comments). Related, not implemented here: #149 (bumps the rule to 3 for minute-precision steps), #164 (practice-only sessions build on this rule), #114 (also edits `gradeReviewItem` metadata and `reviewAttemptEvent`; whichever lands second rebases).

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`; rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist (`ALLOWLIST = []` in `scripts/a11y_audit.mjs` stays empty); theme tokens only (Paper, Night, Contrast, System), no hard-coded colours; 44 px touch targets and ≥ 16 px form text on phones; check 320 px, 393 px, 200% text and landscape.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (baseline on 45826f7: 623,582 B and 690,571 B).
- Local-first: no network request, no paid or cloud AI, no tracking; learner data stays on the device.
- Persisted data: the new attempt field `scheduleRule` changes the `normalizeProfile` attempt normalizer (`src/lib/db.js`), the backup round-trip fixture (`src/lib/backup.test.mjs`) and the `mergeProfileVersions` replay (`src/lib/profileSync.js`) with a case in `src/lib/profileSync.test.mjs`, all in one task.
- Never weaken an existing assertion; every test of new behaviour must fail on main for the stated reason.
- Browser audits wait for what a check reads, never a guessed delay (`.github/CONTRIBUTING.md`, #138): `scripts/audit_waits.mjs` provides `settled`, `waitForTheme` and `pollValue`; `scripts/review_audit.mjs` reads saved state with `savedProfile(page, landed)`. A fixed sleep may only bound a check that something must not happen.
- Commits: concise imperative subject, short why-body, no trailers.
- Exact values from the issue:
  - A review is *early* when the card is in review (prior interval ≥ 1 day, not new) and elapsed time is below the prior interval.
  - Early Good → `max(prior, elapsed × ease)`; early Hard → `max(prior, elapsed × 1.2)`; early Easy → `max(prior, elapsed × ease × 1.3)`.
  - Early Hard, Good and Easy keep `ease` and `repetitions`. Again is unchanged. New cards, sub-day steps and FSRS keep today's rules.
  - `previewReviewIntervals` takes `now`, so the rating buttons show the true interval.
  - New attempts carry `scheduleRule: 2`; attempts without it replay under rule 1.
  - Notice copy: "Extra practice doesn't use today's limits. A card you answer early keeps its current interval."
  - Probe: a 10-day card last reviewed 1 day ago stays at 10 days after three early Good grades (today 25 → 62.5 → 156.25); FSRS still gives 13 → 14 → 14.
  - Mastered = 3+ repetitions and a 14-day interval; four quick Crunch sessions take a new card to 18.75 days today.
  - Layout: the notice wraps without overflow at 393×852, 320 px and 200% text, in Paper, Night and Contrast; axe clean.
- Out of scope (decisions in the issue): no practice-only mode (#164), no rewrite of cards already inflated, no change to the 0.01-day rounding (#149).

## Review Focus

- A last review later than `now` (another device's clock ran ahead): elapsed counts as 0, the card keeps its prior interval, and nothing becomes NaN or shorter. Test in Task 1.
- A reviewed card with no `lastReviewedAt` (older data: `reviewCount > 0`, `lastReviewedAt: ""`): today's rule applies (25 days), never "early forever". Test in Task 1.
- The exact due millisecond (elapsed equals the interval): not early, graded as today (25 days). Test in Task 1.
- A card made due by "Schedule corrective review" (`dueAt` now, last review 2 days ago, 10-day interval): early under the elapsed definition, so it keeps 10 days. Test in Task 1.
- A rule from a newer build (3) or a malformed rule (0, 2.5, "x", 5,000): the normalizer keeps 3, caps at 1,000 and stores no rule for the rest, which replay as rule 1; grading under rule 3 stays early-aware. Tests in Tasks 1 and 2.

## Rulings

- Ruling: early-ness compares whole milliseconds with a strict `<`: `max(0, now − lastReviewedAt) < Math.round(intervalDays × 86_400_000)`, using fractional days for the formula, not FSRS's floored days. Every stored due time equals the last review plus the rounded interval exactly (checked for all 3,650,000 0.01-day intervals), so a due or overdue card can never read as early. Cost if wrong: near-due early reviews get slightly different intervals than a floored rule (a card 15 minutes short of due grows to about 25, not 22.5).
- Ruling: a card made due by "Schedule corrective review" (`App.jsx` resets only `dueAt`) is early when its last review is more recent than its interval, as the issue defines early by elapsed time. Cost if wrong: a corrective review of a card already in review keeps its interval instead of multiplying it.
- Ruling (revised after Task 2's review): the normalizer keeps a valid rule (an integer from 1 to 1,000, capping larger ones) and stores nothing for an attempt without one or with a malformed one; such an attempt replays under rule 1, and the event identity compares the normalized rule. Writing `scheduleRule: 1` onto every older attempt grew existing profiles by about 17 bytes per attempt in one save, and the 20 MiB workspace budget refuses any growing save above the cap, so a learner near it would have every save refused after the upgrade. The scheduler treats rule ≥ 2 as early-aware, so #149's rule 3 needs no normalizer change. Cost if wrong: an absent rule and an explicit 1 are two spellings of rule 1; the identity and replay normalize both.
- Ruling: the regression guards (due and overdue cards, sub-day steps, new cards, Again, FSRS 13 → 14 → 14, undo) pass on main by design; every check of new behaviour fails on main first. Cost if wrong: none for correctness; the PR names which tests are guards.
- Ruling: the notice keeps the issue's words with the app's typographic apostrophes (’), as every ReviewCenter string does ("Today’s queue"). Cost if wrong: a one-character copy edit.
- Ruling: FSRS keeps today's rules entirely, including `repetitions + 1` on early grades, so Crunch under FSRS can still move Mastered (the probe card reaches 14 days after two passes). Cost if wrong: FSRS learners still see Mastered inflate; it needs its own issue.
- Ruling: `scripts/cross_tab_audit.mjs` is not extended: `scheduleRule` is never edited in the UI, and two tabs of one build cannot produce a two-rule merge; `profileSync.test.mjs` covers it. Cost if wrong: no browser-level two-tab evidence for the field.
- Ruling: the notice's layout and axe criterion is covered by a new `responsive_audit` surface (320 px, 200% text, landscape; Paper) and a new `a11y_audit` state that writes one card into the stored profile and removes it again (Paper, Night and Contrast at 393×852 and 1280×800, with a fit check), so the route scans keep their empty deck. Cost if wrong: about 12 extra reloads in the a11y suite.

## Files

- Modify `src/lib/review.js`: the rule constants and helper, the early branch in `intervalForRating`, `gradeReviewItem` stamping, `previewReviewIntervals({ now })`.
- Create `src/lib/review.test.mjs` (picked up by `audit:ai`'s `src/lib/*.test.mjs` glob; #149 adds to it later).
- Modify `src/lib/db.js` (attempt normalizer), `src/lib/profileSync.js` (event and replay).
- Modify `scripts/unit_audit.mjs`, `src/lib/backup.test.mjs`, `src/lib/profileSync.test.mjs`.
- Modify `src/components/ReviewCenter.jsx` (two preview calls, the notice) and `scripts/review_audit.mjs`.
- Modify `scripts/responsive_audit.mjs` and `scripts/a11y_audit.mjs`.
- Docs (after the gate, not an SDD task): `docs/internal/PRODUCT_REQUIREMENTS.md`, `docs/FUNCTIONAL_TESTING.md`, `docs/guides/APP_GUIDE.md`, `docs/DEVICE_TESTING.md`.

---

### Task 1: Early-aware Classic grading and the schedule rule

**Files:**
- Modify: `src/lib/review.js` (`intervalForRating` at :264-272, `previewReviewIntervals` at :274-281, `gradeReviewItem` at :297-346)
- Create: `src/lib/review.test.mjs`

**Interfaces:**
- Produces:
  - `export const REVIEW_SCHEDULE_RULE = 2;` the rule new attempts record. Comment: rule 1 multiplied the interval however recently the card was reviewed (attempts recorded before #148 carry no rule and replay under it); rule 2 grows an early review from the elapsed time; #149 bumps this constant.
  - `export const normalizeScheduleRule = (value, fallback = 1) => number`: `Number(value)` when it is an integer ≥ 1 (capped at 1,000), otherwise `fallback`.
  - `gradeReviewItem(item, rating, now, elapsedMs, metadata)`: `metadata.scheduleRule` is optional and resolves through `normalizeScheduleRule(metadata.scheduleRule, REVIEW_SCHEDULE_RULE)`. The returned attempt gains `scheduleRule` (that resolved value), after `crunch`.
  - `previewReviewIntervals(item, { scheduler = "sm2", requestRetention, weights, now = new Date() })`: both schedulers grade at `now`; Classic uses `REVIEW_SCHEDULE_RULE`.
- Internal: `intervalForRating(item, rating, now, scheduleRule)`; the early branch applies only when `scheduleRule >= 2` (a module constant for the early-aware threshold, separate from `REVIEW_SCHEDULE_RULE`).

- [ ] **Step 1: Write the failing tests** in `src/lib/review.test.mjs`:

```js
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
```

- [ ] **Step 2: Run against the unchanged code and record every failure**

Run: `node --test src/lib/review.test.mjs`
Expected: the file fails to load (`REVIEW_SCHEDULE_RULE` is not exported). Temporarily delete that name from the import and the `assert.equal(REVIEW_SCHEDULE_RULE, 2)` line, rerun, and record which tests fail with which values: the probe gives `[25, 62.5, 156.25]`; early Hard/Easy give `12/2.35/5` and `32.5/2.65/5`; six days in gives `12/25/32.5`; the preview gives `{ again: 0.01, hard: 12, good: 25, easy: 32.5 }` and FSRS Good 225; Mastered counts `{ tile: 2, ladder: 2 }` and the new card `[1, 3, 7.5, 18.75]`; `scheduleRule` is `undefined`; the corrective-review card gives 25. The FSRS, due/overdue, new/step/Again and undo tests pass (guards). Restore the two lines.

- [ ] **Step 3: Implement in `src/lib/review.js`**

Add the constants and `normalizeScheduleRule` from the Interfaces block. In `intervalForRating(item, rating, now, scheduleRule)`, before today's Hard/Good/Easy branches: when `rating !== "again"`, `scheduleRule >= 2`, the card is not new (`isNewReviewItem`), `priorInterval >= 1`, `Date.parse(item.lastReviewedAt)` is finite and `max(0, now − lastReviewedAt) < Math.round(priorInterval × DAY_MS)`, return `{ intervalDays: Math.max(priorInterval, elapsedDays × factor), ease: priorEase, repetitions: Number(item.repetitions) || 0 }` with factor 1.2 (hard), `priorEase` (good), `priorEase × 1.3` (easy) and `elapsedDays = elapsedMs / DAY_MS`. Everything else, and the 0.01-day rounding in `gradeReviewItem` and `previewReviewIntervals`, stays as it is. `gradeReviewItem` resolves the rule once, passes it to `intervalForRating` on the Classic path and stamps it on the attempt; the FSRS path ignores it. `previewReviewIntervals` passes `now` to `fsrsGrade` and `intervalForRating`.

- [ ] **Step 4: Run the tests**

Run: `node --test src/lib/review.test.mjs src/lib/fsrs.test.mjs src/lib/profileSync.test.mjs src/lib/mastery.test.mjs && npm run audit:unit && npm run audit:scale`
Expected: all pass (the existing suites are unchanged by this task).

- [ ] **Step 5: Commit**

```bash
git add src/lib/review.js src/lib/review.test.mjs
git commit -m "Grow early Classic reviews from the time actually waited" -m "A Good in Extra practice multiplied a 10-day interval by ease a day after the last review, so three Crunch passes pushed the card to 156 days and counted it Mastered. An early Hard, Good or Easy now takes the larger of the prior interval and the elapsed time times its factor, and keeps ease and repetitions. New attempts record scheduleRule 2 so replay can tell the rules apart. Due cards, learning steps, new cards and FSRS are graded as before, and the rating preview grades at the time it is shown."
```

### Task 2: Keep each attempt's rule through storage, backup and sync

**Files:**
- Modify: `src/lib/db.js` (attempt normalizer, :1274-1304)
- Modify: `src/lib/profileSync.js` (`reviewAttemptEvent` :409-419, `replayReviewAttempt` :427-445)
- Test: `scripts/unit_audit.mjs`, `src/lib/backup.test.mjs`, `src/lib/profileSync.test.mjs`

**Interfaces:**
- Consumes: `normalizeScheduleRule` from Task 1 (`src/lib/review.js`).
- Produces: a normalized attempt keeps a valid `scheduleRule` (an integer 1–1,000, capped) and has no `scheduleRule` key when the stored attempt had none or a malformed one, so older attempts keep their size; `reviewAttemptEvent` includes `scheduleRule: normalizeScheduleRule(attempt?.scheduleRule)`, so an absent rule and 1 compare equal; replay grades each attempt with `scheduleRule: normalizeScheduleRule(attempt.scheduleRule)`, so an attempt without a rule replays under rule 1, never the current rule. The rewritten attempt keeps its own rule (the existing `...attempt` spread).

- [ ] **Step 1: Write the failing tests**

`scripts/unit_audit.mjs`, a new block after the Hard/Easy scheduling block (`normalizeProfile` accepts this partial profile; no new import is needed):

```js
// Issue #148: the attempt normalizer keeps scheduleRule. Attempts recorded
// before it, and malformed values, store no rule (they replay as rule 1), so
// older attempts keep their size; a later build's rule (#149 writes 3) survives.
{
  const card = createReviewItem({ front: "rule card", back: "a" }, new Date("2026-08-21T12:00:00.000Z"));
  const attempt = (id, extra = {}) => ({ id, reviewItemId: card.id, rating: "good", reviewedAt: "2026-08-21T12:00:00.000Z", ...extra });
  const normalized = normalizeProfile({ reviewItems: [card], reviewAttempts: [attempt("current", { scheduleRule: 2 }), attempt("legacy"), attempt("newer", { scheduleRule: 3 }), attempt("fraction", { scheduleRule: 2.5 }), attempt("zero", { scheduleRule: 0 }), attempt("text", { scheduleRule: "x" }), attempt("huge", { scheduleRule: 5_000 })] }).reviewAttempts;
  assert.deepEqual(normalized.map((entry) => [entry.id, entry.scheduleRule]), [["current", 2], ["legacy", undefined], ["newer", 3], ["fraction", undefined], ["zero", undefined], ["text", undefined], ["huge", 1_000]], "the attempt normalizer must keep scheduleRule");
  assert.deepEqual(normalized.filter((entry) => !("scheduleRule" in entry)).map((entry) => entry.id), ["legacy", "fraction", "zero", "text"], "an attempt without a valid rule stores none, so older attempts keep their size");
}
```

`src/lib/backup.test.mjs`: add to the `records()` profile

```js
    reviewAttempts: [
      { id: "attempt-rule-2", reviewItemId: "card-1", rating: "good", elapsedMs: 1_200, reviewedAt: fixedTime, sessionKind: "crunch", crunch: true, scheduleRule: 2 },
      { id: "attempt-legacy", reviewItemId: "card-1", rating: "again", elapsedMs: 900, reviewedAt: fixedTime, sessionKind: "review" },
    ],
```

and to the v4 round-trip test, after the mistake assertions:

```js
  assert.deepEqual(checked.data.profile.reviewAttempts.map((attempt) => [attempt.id, attempt.scheduleRule]), [["attempt-rule-2", 2], ["attempt-legacy", undefined]], "scheduleRule survives a backup round trip, and an attempt without one restores without one");
```

`src/lib/profileSync.test.mjs`: give `gradeProfile` an optional sixth argument `{ scheduleRule, olderBuild = false } = {}` that passes `scheduleRule` into `gradeReviewItem`'s metadata and, when `olderBuild`, deletes `scheduleRule` from the stored attempt (an older build never wrote it). Then add:

```js
test("a rule-1 and a rule-2 grade of one card merge to the same card in either order (#148)", () => {
  const gradedAt = new Date("2026-08-23T09:00:00.000Z");
  const card = { ...reviewRecord("rule-review", "Rule card"), intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0, lastReviewedAt: new Date(gradedAt.getTime() - 86_400_000).toISOString(), dueAt: new Date(gradedAt.getTime() + 9 * 86_400_000).toISOString() };
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  // This build grades early: the card keeps 10 days and the attempt records rule 2.
  const newTab = gradeProfile(base, card.id, "good", gradedAt.toISOString(), "attempt-rule-2");
  // A tab still on an older build grades a minute later; it multiplied and wrote no rule.
  const oldTab = gradeProfile(base, card.id, "good", new Date(gradedAt.getTime() + 60_000).toISOString(), "attempt-rule-1", { scheduleRule: 1, olderBuild: true });
  const leftFirst = mergeProfileVersions(base, oldTab, newTab, { now: NOW, advanceRevision: false }).profile;
  const rightFirst = mergeProfileVersions(base, newTab, oldTab, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(leftFirst), reviewMergeProjection(rightFirst));
  assert.deepEqual(leftFirst.reviewAttempts.map((attempt) => [attempt.id, attempt.scheduleRule, attempt.nextIntervalDays]), [["attempt-rule-2", 2, 10], ["attempt-rule-1", undefined, 25]]);
  const merged = leftFirst.reviewItems[0];
  assert.deepEqual([merged.intervalDays, merged.repetitions, merged.reviewCount], [25, 5, 6]);
});

// The rule is part of the event identity: an attempt whose rule an older build
// dropped is a changed event, and its card is rebuilt under rule 1.
test("an attempt that loses its rule in an older build is replayed under rule 1 (#148)", () => {
  const gradedAt = new Date("2026-08-23T09:00:00.000Z");
  const card = { ...reviewRecord("lost-rule", "Lost rule card"), intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0, lastReviewedAt: new Date(gradedAt.getTime() - 86_400_000).toISOString(), dueAt: new Date(gradedAt.getTime() + 9 * 86_400_000).toISOString() };
  const base = gradeProfile(normalizeProfile({ ...initialProfile, reviewItems: [card] }), card.id, "good", gradedAt.toISOString(), "attempt-kept");
  assert.deepEqual([base.reviewItems[0].intervalDays, base.reviewAttempts[0].scheduleRule], [10, 2]);
  const stripped = normalizeProfile({ ...base, reviewAttempts: base.reviewAttempts.map(({ scheduleRule: _dropped, ...attempt }) => attempt) });
  const merged = mergeProfileVersions(base, base, stripped, { now: NOW, advanceRevision: false }).profile;
  assert.equal("scheduleRule" in merged.reviewAttempts[0], false);
  assert.deepEqual([merged.reviewItems[0].intervalDays, merged.reviewItems[0].repetitions], [25, 5]);
});
```

- [ ] **Step 2: Run against Task 1's code and record the failures**

Run: `npm run audit:unit; node --test src/lib/backup.test.mjs src/lib/profileSync.test.mjs`
Expected: unit audit fails "the attempt normalizer must keep scheduleRule" (every rule `undefined`); the backup test fails with `[["attempt-rule-2", undefined], ["attempt-legacy", undefined]]`; the merge test fails with `[["attempt-rule-2", undefined, 10], ["attempt-rule-1", undefined, 10]]` (the dropped rule replays as the current rule). On main the same merge gives intervals 25 and 62.5; the controller records that in the final run against main.

- [ ] **Step 3: Implement**

`src/lib/db.js`: import `normalizeScheduleRule` from `./review.js`; the attempt normalizer keeps `scheduleRule` after `crunch` only when `normalizeScheduleRule(attempt.scheduleRule, 0)` is non-zero (spread conditionally, so an attempt without a valid rule stores no key). `src/lib/profileSync.js`: import `normalizeScheduleRule`; `reviewAttemptEvent` adds `scheduleRule: normalizeScheduleRule(attempt?.scheduleRule)`; `replayReviewAttempt` passes `scheduleRule: normalizeScheduleRule(attempt.scheduleRule)` in the `gradeReviewItem` metadata. Nothing else in the merge changes.

- [ ] **Step 4: Run the tests**

Run: `npm run audit:unit && node --test src/lib/backup.test.mjs src/lib/profileSync.test.mjs src/lib/review.test.mjs && npm run audit:scale && npm run audit:storage && npm run audit:backup-memory`
Expected: all pass, the 50,000-attempt scale case still under its 4,000 ms limit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/lib/profileSync.js scripts/unit_audit.mjs src/lib/backup.test.mjs src/lib/profileSync.test.mjs
git commit -m "Keep each review attempt's schedule rule through storage and sync" -m "Sync rebuilds a card by replaying its attempts, so the rule an attempt was graded under must survive normalization, backups and merges. Attempts recorded before #148 read as rule 1 and keep the old math; a later build's rule is kept, not clamped. A rule-1 and a rule-2 grade of one card now merge to the same card in either order."
```

### Task 3: Show the true interval and the corrected notice in Extra practice

**Files:**
- Modify: `src/components/ReviewCenter.jsx` (`grade` at :650, the session render at :797, the notice at :810)
- Test: `scripts/review_audit.mjs`

**Interfaces:**
- Consumes: `previewReviewIntervals(item, { …, now })` from Task 1; the normalizer keeping `scheduleRule` from Task 2.

- [ ] **Step 1: Write the failing browser check** in `scripts/review_audit.mjs`, as a fresh browser context between the saved-AI context's `finally` and the final `errors` assertion (the main flow switches to FSRS and seeds 10,000 cards, so it cannot host this). At 393×852 (`isMobile`, `hasTouch`), open `#/review`, then read-modify-write the stored profile (as the saved-AI section does) with `reviewAttempts: []` and two Classic cards on `notes/part-05-supervised-learning/01-linear-regression.md`, then reload:
  - `early-probe` ("Early probe: what does dropout do at inference?"): `intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0`, last review a day ago, due in nine days;
  - `early-mastered` ("Early mastered: what does L2 regularization penalize?"): `intervalDays: 30, repetitions: 5, reviewCount: 5`, last review three days ago, due in 27 days.

  Then assert, with these messages:
  - before: `.review-hero strong` is "0"; the `.review-stat-grid` article whose span reads "Mastered" shows "1"; on `#/home` the `.mastery-row` whose `.mastery-part` is "05" includes "1/2 cards mastered".
  - keyboard only: focus the "Crunch weak cards" button and press Enter. `.review-crunch-notice` text (trimmed) equals `Extra practice doesn’t use today’s limits. A card you answer early keeps its current interval.`; its right edge ≤ `innerWidth` and `document.documentElement.scrollWidth` ≤ `innerWidth` ("the Extra practice notice must wrap inside a 393px phone").
  - for each card (identify it by its `.review-question` text): wait until the prompt has focus (`document.activeElement` has class `review-question`), press Space, then read `.review-rating span` texts. Probe: `["14 min · 1", "10 days · 2", "10 days · 3", "10 days · 4"]` ("Extra practice must preview early-aware intervals"; main shows `12 days`, `25 days`, `1 mo`). Mastered card: Good reads `1 mo · 3` (main `3 mo · 3`). Press "3"; the status region then includes `Rated Good: next review in 10 days` (probe) or `Rated Good: next review in 1 mo` (mastered).
  - after the session returns to `.review-center-page`, read the stored profile with the file's `savedProfile(page, landed)` until it holds both attempts: probe `intervalDays` 10, `repetitions` 4, `ease` 2.5; mastered `intervalDays` 30, `repetitions` 5; for each, `Date.parse(item.dueAt) - Date.parse(attempt.reviewedAt) === intervalDays * 86_400_000` ("an early Crunch grade must keep the interval: dueAt is now + 10 days, not + 25"), `attempt.crunch === true`, `attempt.sessionKind === "crunch"`, `attempt.scheduleRule === 2`.
  - the Mastered tile still reads "1" (main "2"), the hero still "0", and the Part 05 row still includes "1/2 cards mastered" (main "2/2").
  - reload: both stored attempts still have `scheduleRule === 2` ("scheduleRule must survive a reload").
  - add "early Crunch grades that keep their interval and Mastered count" to the final "Review audit passed" line; push page errors into `errors`; close the context in `finally`.
  - every wait in the section waits for what it reads (`waitForSelector`, `waitForFunction`, `savedProfile`); no fixed sleeps.

- [ ] **Step 2: Run against the unchanged UI and record the failure**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review` (on Task 2's code, so storage keeps the rule).
Expected: FAIL on the notice text, the old copy. That is the only UI change left: `previewReviewIntervals` already defaults `now` to the wall clock, so the buttons preview early-aware intervals on Task 2's code. Against main the same check also fails on the previews ("25 days"), the stored interval, the rule and the Mastered tile; the controller records that in the final run against main.

- [ ] **Step 3: Implement in `src/components/ReviewCenter.jsx`**

Pass `now: new Date()` to the preview in `grade` (:650) and `now: queueNow` to the session render's preview (:797), so the buttons, queue and stats read one clock. Replace the notice text with `Extra practice doesn’t use today’s limits. A card you answer early keeps its current interval.`, keeping its `Flame` icon, element and class.

- [ ] **Step 4: Run the check**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- review`
Expected: PASS, with the new phrase in the summary line.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewCenter.jsx scripts/review_audit.mjs
git commit -m "Show early-aware intervals and an accurate notice in Extra practice" -m "The rating buttons previewed the multiplied interval and the notice said only that attempts were kept apart from daily limits, which read as if the schedule were untouched. The preview now grades at the time it is shown, and the notice says a card answered early keeps its current interval. The review audit runs a keyboard-only Crunch session on cards that are not due and checks the intervals, due dates, schedule rule, Mastered tile and Part ladder."
```

### Task 4: Check the notice's layout and accessibility in every theme

**Files:**
- Modify: `scripts/responsive_audit.mjs` (after `inspect("review-answer", …)`)
- Modify: `scripts/a11y_audit.mjs` (`STATES` and the state runner)

**Interfaces:**
- Consumes: the Task 3 notice (`.review-crunch-notice`) and the "Crunch weak cards" / "End session" buttons.
- Produces: a `review-crunch` responsive surface and an `extra-practice` a11y state; an optional `verify(page, label)` hook on `STATES` entries, run after axe.

- [ ] **Step 1: Add the responsive surface.** After `await inspect("review-answer", ".review-session-page");`: click "End session" (`.review-session-header button`), wait for `.review-hero-actions`, click "Crunch weak cards", wait for `.review-crunch-notice`, `await inspect("review-crunch", ".review-session-page")`, then click "End session" and wait for `.review-hero`. The seeded profile already has active cards.

- [ ] **Step 2: Add the a11y state.** Add a helper that read-modify-writes `reviewItems` in the stored profile (`study-data` store, key `profile`; never a whole-profile `put` from a fixture, which would reset the theme). Add a `STATES` entry `extra-practice` on `ROUTES[4]`:
  - `setup`: add a card `a11y-practice` ("Which split tunes hyperparameters?" / "The validation split."; `intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4`, last review a day ago, due in nine days), reload, wait for `.review-deck-card[data-card-id="a11y-practice"]`, click "Crunch weak cards";
  - `ready`: `.review-crunch-notice`;
  - `verify`: `check()` that the notice's right edge ≤ `innerWidth` and `document.documentElement.scrollWidth` ≤ `innerWidth`, message `${label}: the Extra practice notice overflows (…)`;
  - `close`: click "End session", remove `a11y-practice` from the stored profile, reload, wait for `.review-center-page`.

  In the runner, call `if (state.verify) await state.verify(page, label);` right after `await runAxe(page, label);`. Update the comment above `STATES` to mention the new state. After each reload, wait for the element the next step reads (the seeded deck card, `.review-center-page`); the runner's `settle(page, label)` already waits for transitions before axe. No fixed sleeps.

- [ ] **Step 3: Run both suites**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- responsive a11y`
Expected: PASS; the a11y summary lists `extra-practice` among its states (8 states) with 0 allowlisted nodes, and the responsive results include `review-crunch` for every viewport. If axe reports a violation on the session page (it was never scanned before), fix it with theme tokens in this task and name it in the commit body.

- [ ] **Step 4: Commit**

```bash
git add scripts/responsive_audit.mjs scripts/a11y_audit.mjs
git commit -m "Check the Extra practice notice's layout and accessibility" -m "The Crunch session was never measured or scanned. The responsive audit now inspects it at every size, 320px and 200% text included, and the accessibility audit scans it with axe in Paper, Night and Contrast at 393x852 and 1280x800 and checks that the notice fits. The a11y state adds its card to the stored profile and removes it again, so the route scans keep their empty deck."
```

---

## After the tasks (controller, not SDD tasks)

1. Before/after evidence: copy every new and changed check onto a scratch worktree of 45826f7, run it there, and record each failure and its message for the PR.
2. Gate in the worktree: `npm run check`, then the full `npm run check:browser`; record `audit:app`'s startup entry and install route screen bytes against the baseline above.
3. Docs: a dated verification-log row in `docs/internal/PRODUCT_REQUIREMENTS.md` (LEARN-003 stays Partial); a dated "Bugs reproduced" entry in `docs/FUNCTIONAL_TESTING.md` (the probe values on main, each new check and its failure on main, budgets, gate results) plus the new state in its "Accessibility checks" list; a bullet in `docs/guides/APP_GUIDE.md` on review and Extra practice; a `docs/DEVICE_TESTING.md` section for VoiceOver in Extra practice (the notice, the rating buttons' names and intervals, the "Rated Good: next review in 10 days" announcement) at 393×852 and 200% text.
4. PR body: what changed, the tests that fail before and pass after, the guards that pass on both, gate results with any retries, budgets, the deferred FSRS Mastered note, and `Closes #148` last.
