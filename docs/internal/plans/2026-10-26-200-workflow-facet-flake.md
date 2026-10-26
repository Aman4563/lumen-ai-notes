# Workflow audit facet-chip flake (#200) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The workflow audit's facet-chip check stops failing about 2 in 20 runs: it clicks a chip that is on the page and waits until exactly that chip's Part is the active filter, and 20 consecutive `workflow` runs with `LUMEN_BROWSER_RETRIES=0` under moderate load pass it and the outline-sheet case (g).

**Architecture:** Test-only change in `scripts/workflow_audit.mjs`. The facet chip is found, read and clicked in one page task, so the click cannot land on a chip React has already removed; the wait after it uses `pollValue` from `scripts/audit_waits.mjs` (#138) and asserts the exact Part it waited for. No app code changes: the app never loses a click on a chip that is on the page.

**Tech Stack:** Node 26, puppeteer-core 25.8.0, React 19.2.8 (the app under test), `scripts/audit_waits.mjs`.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/200 (binding, with its comment: the flake forced a CI re-run on PR #202, run 39945231427 attempt 1). Found while verifying #150 (merged); no dependencies.

## Root cause (proven before planning)

- `page.$eval(sel, fn)` is two round trips in puppeteer-core 25.8.0 (`lib/puppeteer/api/ElementHandle.js:493-497`): `this.$(sel)` returns a handle, then `handle.evaluate(fn)` runs.
- The Library keeps showing the previous result set until the newest search returns (latest-wins, `src/App.jsx` `LibraryView`), and rebuilds the facet chips each time a set lands. While "gradients" is typed, the chips are rebuilt six or seven times; the first chip moves between Parts (Part 1 for the "g" and "grad" sets, Part 2 for the final set, which has no Part 1). Every wait before the click (the grid mentions "gradient", `.library-facets` exists) already passes on an earlier prefix's set.
- When the final set lands between the two round trips and drops the found chip's Part, React removes that button; `node.click()` then fires on a detached node, React's root listener never sees it, the active filter stays "All", and the 5 s wait fails with "clicking a facet chip did not focus its Part".
- Reproduced deterministically with a scratch probe (not committed): the worker's "g" results land, later result sets are held 1.5 s, the audit's literal `$eval` path runs with a pause between its two round trips until the chips re-render. Result: 3 of 3 failures, the clicked chip `isConnected: false`, the exact CI message. Unpinned, 0 of 6 failed; the final set usually lands before the test reads a chip.
- A real tap is hit-tested when it happens, so it reaches a chip that is on the page; in every probe run, a click on an attached chip focused its Part.

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`, every browser run through `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot`; rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist; theme tokens only (Paper, Night, Contrast, System); 44 px touch targets and >= 16 px form text on phones; 320 px, 393 px, 200% text and landscape. No UI changes; the browser gate must pass unchanged.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (baseline on this branch before rebasing: 623,709 B and 692,990 B). No app code changes.
- Local-first: no paid or cloud AI, no tracking, no network request; learner data stays on the device. Not affected (test-only).
- Persisted data: a new profile field needs the `db.js` normalizer, the backup fixture, the `profileSync` merge and its test together. Not affected.
- Stay within `scripts/workflow_audit.mjs` (other orchestrators work in parallel); `scripts/audit_waits.mjs` is used, not changed.
- Commits: concise imperative subject, short why-body, no trailers.
- Exact values from the issue:
  - 20 consecutive `workflow` runs with `LUMEN_BROWSER_RETRIES=0` under moderate load (at most one extra build loop) pass both checks: "clicking a facet chip did not focus its Part" and case (g) "Jump to second behind the outline sheet".
  - No assertion is weakened, and each wait asserts what it waited for.
  - If an app race is found, a check that fails before the fix pins it (none found; see Rulings).

## Review Focus

- A result set landing between finding the chip and clicking it: impossible after Task 1, because one page task finds and clicks the chip.
- The clicked chip belongs to an earlier prefix's set (for example "g"): its Part must still become the active filter, and the check asserts that exact Part. Probe `MODE=fixed` covers it in Step 2.
- A facet for a Part with no filter-row chip: the old predicate (`!== "All"`) passed when no chip was active; the new one fails. Checked: built-in Part numbers are 0-23, facets use 1-23 (`partNumber >= 1`), and `parts` in `src/lib/content.js` is 1-23.
- The first chip is "My uploads": facets sort uploads last and render only with two or more keys, so the first chip is a Part; the existing label assertion still rejects anything else.
- No chip on the page at the click (the facets vanished): the page task returns `null`, and the check fails with its own message instead of a TypeError.

## Rulings

- Ruling: fix the test, not the app. A real tap is hit-tested at event time and cannot reach a detached chip, and every click on an attached chip focused its Part. Cost if wrong: a learner could lose a tap only in the few milliseconds when a result set lands mid-tap; no report or probe shows it.
- Ruling: case (g) gets no code change in this branch. Evidence: a scratch probe ran (g)'s exact steps 24 times under 4x CPU throttling with zero failures, and no CI run since #150 shows its message. The probe also showed that `goto` between hash routes is a same-document navigation, so (g) runs on the page case (f) left. The #150 diagnostic names the tap's target if (g) fails. Cost if wrong: one extra 20-run block after a fix written from that message.
- Ruling: Task 2 (the card click at line 1522) joins this branch. The issue's acceptance is 20 consecutive passing `workflow` runs, the first block failed there, and it is the same race in the same file. Cost if wrong: the branch fixes one check beyond the two the issue names.
- Ruling: the scratch probe is the before/after evidence for a test-harness race and is described in the PR, not committed; the acceptance is the 20-run proof. Cost if wrong: a future regression of the two-round-trip pattern is caught by the next flake, not by a dedicated check.

---

### Task 1: Click the facet chip in one task and wait for its exact Part

**Files:**
- Modify: `scripts/workflow_audit.mjs:7` (import `pollValue` beside `settled`)
- Modify: `scripts/workflow_audit.mjs:1444-1449` (the facet block after the plural-folding wait)

**Interfaces:**
- Consumes: `pollValue(read, predicate, { timeout, interval })` from `scripts/audit_waits.mjs` (returns the last value read; the caller asserts).
- Produces: nothing other tasks use.

- [ ] **Step 1: Replace the facet block.** Keep `await page.waitForSelector(".library-facets", { timeout: 5_000 });`. Then one `page.evaluate` finds `document.querySelector(".library-facets button")`, returns `null` if absent, otherwise records `{ label: chip.textContent, part: chip.getAttribute("aria-label").split(":")[0] }`, calls `chip.click()`, and returns the record. Assert it is not null (message: `no facet chip was on the page to click`). Keep the existing `assert.match(facet.label, /Part \d+\s*\d+/, ...)` with its message. Then `const active = await pollValue(() => page.$eval(".filter-row", (row) => row.querySelector("button.active")?.textContent ?? "no active chip"), (text) => text === facet.part, { timeout: 5_000 });` and `assert.equal(active, facet.part, \`clicking a facet chip did not focus its Part: clicked “${facet.label}”, the active filter is ${active}\`)`. A two-line comment states why the chip is found and clicked in one task (the chips are rebuilt as result sets land; a chip found in one round trip can be gone by the next, and its click would reach no one). The two lines after it (click "All", Clear search) stay as they are.

- [ ] **Step 2: Prove it against the pinned race.** The orchestrator runs the scratch probe with the new sequence: `MODE=fixed` (click while later result sets are held) and `MODE=fixed-late` (click after the final set lands), 3 iterations each under the pinned state. Expected: 6 of 6 pass, where the audit's old path failed 3 of 3.

- [ ] **Step 3: Run the suite once.** Run: `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot env LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow` (after `npm run build`). Expected: `{"audit":"workflow","ok":true,...}` with no `attempts`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/workflow_audit.mjs
git commit -m "Click the facet chip in one task and wait for its Part"
```

### Task 2: Open the uploaded note's card in the task that finds it

Found by the first 20-run block: run 10 of 20 failed with "Waiting for selector `.reader-view` failed" (`workflow_audit.mjs:1523`). It is the same race as Task 1. After Clear, the Library lists every document, so the wait for "Uploaded Persistence Proof" in the grid passes before the typed search lands. `page.$eval(".document-grid .document-card", click)` then finds the first card from an earlier prefix's set ("AI/ML Curriculum Navigator", sorted by title) and clicks it a round trip later, after the final set has removed it. A click that does land on such a card opens the wrong lecture. Reproduced with the scratch probe: on the old path, 2 of 3 runs clicked a detached card and no reader opened. Opening the card titled "Uploaded Persistence Proof" in one page task opened that note 3 of 3 times.

**Files:**
- Modify: `scripts/workflow_audit.mjs:1522-1523` (the card click before "Edit copy")

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing other tasks use.

- [ ] **Step 1: Replace line 1522's `$eval` click.** Add a two-line comment on why. One `page.evaluate((title) => ..., "Uploaded Persistence Proof")` finds the first `.document-grid .document-card` whose `strong` text includes the title, clicks it, and returns whether it found one. Then `assert.ok(found, "the uploaded note's card was not in the grid to open")`. Keep `await page.waitForSelector(".reader-view");`. Then `await page.waitForFunction((title) => document.querySelector(".reader-view .markdown-body h1")?.textContent.includes(title), { timeout: 10_000 }, "Uploaded Persistence Proof").catch(() => assert.fail("the card opened another lecture, not the uploaded note"));`. The upload's Markdown is `# Uploaded Persistence Proof` (line 1143), so the note's `h1` is its title. Lines 1518-1520 (type, wait, sort by title) stay as they are.

- [ ] **Step 2: Prove it against the pinned race.** Done by the orchestrator: probe `MODE=card` failed 2 of 3, and `MODE=card-fixed` opened the note 3 of 3 times.

- [ ] **Step 3: Run the suite once.** Run: `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot env LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow`. Expected: `{"audit":"workflow","ok":true,...}` with no `attempts`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/workflow_audit.mjs
git commit -m "Open the uploaded note's card in the task that finds it"
```

## Verification (orchestrator, after Task 2)

- `npm run check` (budgets from `audit:app`), then the full `gate-slot npm run check:browser`.
- 20-run proof: a scratch worktree of origin/main runs one `npm run build` loop as the load (PID recorded, stopped by PID), never this tree, whose `dist/` the audit serves. One slot is held for the whole block: `gate-slot bash -c 'for i in $(seq 20); do LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow || exit 1; done'`, logged with each run's result and duration. Any failure of either check stops the block and goes back to debugging.
- Report only, not changed here: whether the plural-folding wait just above the facets (`grid.innerText` includes "gradient") is already true with an empty query.
- Docs: a dated row in the docs/internal/PRODUCT_REQUIREMENTS.md verification log and a dated docs/FUNCTIONAL_TESTING.md entry describing the race and how the check now avoids it. No learner-visible change, so no APP_GUIDE or DEVICE_TESTING edit.
