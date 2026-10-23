# Server test temp cleanup (#193) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run of the server tests removes the `lumen-server-test-dist-*` directory it creates, whether its tests pass or fail, and a test proves it.

**Architecture:** `server/ai/server.test.mjs` already makes its app-shell fixture with `mkdtemp` (line 28) but never removes it; it gains a top-level `after()` hook, registered right after the `mkdtemp`. A new `server/ai/server.cleanup.test.mjs` runs that file in a child process whose temp folder is private and empty, once passing and once with a forced failure, and requires the folder to be empty afterwards.

**Tech Stack:** Node 26 `node:test`, `node:child_process`, `node:fs/promises`.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/193 (binding, with its comments; none so far). Found while verifying #138 (merged); no dependencies.

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`, run through the machine-wide `gate-slot` lock; rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist; theme tokens only (Paper, Night, Contrast, System); 44 px touch targets and ≥ 16 px form text on phones; 320 px, 393 px, 200% text and landscape. This change touches no UI; the browser gate must pass unchanged.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (last recorded on main after #148: 623,709 B and 690,627 B). No app code changes, so both stay as they are.
- Local-first: no network request, no paid or cloud AI, no tracking; learner data stays on the device. Not affected (test-only).
- Persisted data: a new profile field needs the `db.js` normalizer, the backup fixture, the `profileSync` merge and its test together. Not affected: no profile field changes.
- Never weaken an existing assertion; the new check must fail on main for the stated reason (a leftover `lumen-server-test-dist-*` entry).
- Stay within the server test files; the `audit:ai` glob `server/**/*.test.mjs` already picks up a new file in `server/ai/`.
- Commits: concise imperative subject, short why-body, no trailers.
- Exact values from the issue:
  - The directory prefix is `lumen-server-test-dist-`, in the system temp folder (`os.tmpdir()`).
  - Create it with `fs.mkdtemp`; remove it in an `after()` hook that runs even when a test fails.
  - After `npm run audit:ai` passes or fails, no `lumen-server-test-dist-*` directory created by that run remains.
  - A test asserts the cleanup (the issue's example: counting matching directories before and after the suite in a child process); it fails on main first.
  - `npm run check` passes.

## Review Focus

- Concurrent runs share the real temp folder (other worktrees, and `audit:ai`'s own `server.test.mjs` process beside the new file) and create matching directories at any moment: the check reads only its child's private folder. Pinned by `runServerSuite` (Task 1).
- The runner's environment (`NODE_TEST_CONTEXT=child-v8`, `NODE_TEST_WORKER_ID`) leaks into the child: a nested `node --test` then skips every file and exits 0, and a direct run reports in the runner's serialized format instead of TAP. The helper drops every `NODE_TEST*` key, both tests require `# pass` > 0, and Step 2 runs the check through `node --test`, as `audit:ai` does.
- A failure while building the fixture (the `writeFile` after the `mkdtemp`) comes while the file loads, before its first test starts: node:test rethrows the error and runs no hook, wherever the hook is registered (exit 7 run directly, 1 under `node --test`, on Node 26.12.1). A throw after a test has started does run the hook. First accepted as a known gap, it is closed in Task 2: the write's own `catch` removes the folder before rethrowing, and a third test pins it. A `before()` hook was rejected (see Task 2).
- A slow runner (2-vCPU CI; the suite generates an RSA key and has a 20 s TLS case): the child is bounded at 120 s, far above its ~1 s local run, and a killed child fails both tests on its exit status.
- The check's own folders: each is removed by `t.after`, even when an assertion fails. Step 2 confirms it on main, where both tests fail.

## Rulings

- Ruling: the child runs `node --test-reporter=tap server/ai/server.test.mjs`, not a nested `node --test` — a nested runner that inherits `NODE_TEST_CONTEXT` warns "run() is being called recursively" and skips every file with exit 0 (observed), and the direct run is the same per-file process `audit:ai` starts, with one process to time out — cost if wrong: the runner's own process handling goes unexercised, and none of it affects `after()`.
- Ruling: the child gets a private, empty `TMPDIR` (and `TMP`, `TEMP`) and must leave it empty, instead of counting matching names in the shared temp folder before and after — counts there race with every concurrent run, and "empty" also catches any other entry the suite might leave. The child is plain `node`, never npm: npm 11 writes its own `node-compile-cache` into the temp folder whenever it runs (observed; no test or `node --test` does) — cost if wrong: a future temp entry the suite keeps on purpose, or a Node release that caches compiled modules in the temp folder by default, fails the check by name (the TLS test already removes its directory; `NODE_DISABLE_COMPILE_CACHE=1` in the child's env would answer the second).
- Ruling: the failing run comes from an `--import=data:text/javascript,…` preload that registers one always-failing test, "forced failure", so `server.test.mjs` gains no test-only switch and all its real tests still run — cost if wrong: if a later Node stopped loading `data:` preloads, the failing-run test fails loudly on its exit status, never passes vacuously.
- Ruling: the check lives in a new `server/ai/server.cleanup.test.mjs` (the `<subject>.<aspect>.test.mjs` pattern of `src/lib/review.scale.test.mjs`), not inside `server.test.mjs`, whose child would then spawn itself — cost if wrong: a rename.
- Ruling: one task holds the check and the fix; docs are written after the gate, not as an SDD task — cost: none; the task review sees both halves.
- Ruling: the issue's "create the directory with `fs.mkdtemp`" already holds on main (`server.test.mjs:28`); only the `after()` removal is added — cost: none.
- Ruling: the directories main already left in this Mac's temp folder (194 on 2026-10-23) are not removed by the branch or the orchestrator, because another worktree's run may be using one — cost if wrong: they stay until removed by hand.
- Ruling: no REA capture (no reference-platform flow is involved); `docs/guides/APP_GUIDE.md` and `docs/DEVICE_TESTING.md` stay unchanged (nothing learner-visible or device-only) — cost: none.
- Ruling: the plan is executed without human review, as the brief directs — cost if wrong: a misreading of the issue reaches the PR, where it is reviewed.

## Files

- Modify `server/ai/server.test.mjs` (the `node:test` import at :8; the fixture at :28-29).
- Create `server/ai/server.cleanup.test.mjs`.
- Docs after the gate: `docs/internal/PRODUCT_REQUIREMENTS.md` (verification log row), `docs/FUNCTIONAL_TESTING.md` (dated entry).

---

### Task 1: Remove the fixture when the suite ends, and prove it

**Files:**
- Create: `server/ai/server.cleanup.test.mjs`
- Modify: `server/ai/server.test.mjs:8,28-29`

**Interfaces (file-local):**
- `SERVER_SUITE = fileURLToPath(new URL("./server.test.mjs", import.meta.url))`.
- `FORCED_FAILURE = 'data:text/javascript,import { test } from "node:test"; test("forced failure", () => { throw new Error("forced failure"); });'`
- `runServerSuite(t, { preload } = {}) => Promise<{ status, output, pass, fail, leftovers }>`:
  - makes a private folder with `mkdtemp(join(tmpdir(), "lumen-server-cleanup-test-"))` and at once registers `t.after(() => rm(folder, { recursive: true, force: true }))`;
  - runs `spawnSync(process.execPath, ["--test-reporter=tap", ...(preload ? [`--import=${preload}`] : []), SERVER_SUITE], { env, encoding: "utf8", timeout: 120_000 })`, where `env` is `process.env` without any key starting with `NODE_TEST`, with `TMPDIR`, `TMP` and `TEMP` set to the folder (`os.tmpdir()` reads `TMPDIR` on POSIX, `TEMP`/`TMP` on Windows);
  - returns `output` (stdout, then stderr, then the child's signal or spawn error when there is one), `pass` and `fail` parsed from TAP's `# pass N` and `# fail N` lines (`NaN` when missing), and `leftovers`, the folder's sorted `readdir`.

- [x] **Step 1: Write the failing tests** in `server/ai/server.cleanup.test.mjs`, under a short header comment saying why: an `after()` hook can only be observed from outside its process; the real temp folder is shared with concurrent runs; the runner's `NODE_TEST*` keys would change how the child runs and reports.

```js
test("the server suite leaves nothing in its temp folder after a passing run", async (t) => {
  const run = await runServerSuite(t);
  assert.equal(run.status, 0, `the server suite did not pass in the child:\n${run.output}`);
  assert.ok(run.pass > 0, `the child ran no tests:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after a passing run`);
});

test("the server suite leaves nothing in its temp folder after a failing run", async (t) => {
  const run = await runServerSuite(t, { preload: FORCED_FAILURE });
  assert.equal(run.status, 1, `the forced failure did not fail the child:\n${run.output}`);
  assert.match(run.output, /^not ok \d+ - forced failure$/m);
  assert.ok(run.fail >= 1 && run.pass > 0, `the child did not run the suite:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after a failing run`);
});
```

- [x] **Step 2: Run them against main's `server.test.mjs` and watch them fail for the right reason**

Run from the worktree root, through the runner as `audit:ai` does:
`OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 300 node --test server/ai/server.cleanup.test.mjs; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"`
Expected: exit 1; both tests fail only at the leftovers assertion, each naming one `lumen-server-test-dist-XXXXXX`; the status, count and forced-failure assertions hold; `ls -A` prints nothing and `rmdir` succeeds (the check removed its own folders although it failed).

- [x] **Step 3: Remove the fixture in `server/ai/server.test.mjs`**

Add `after` to the `node:test` import. On the line right after the `mkdtemp`, before the `writeFile`, register `after(() => rm(fixtureDistDirectory, { recursive: true, force: true }));` with a one-line comment that it runs when the file's tests end, passed or failed. Nothing else changes.

- [x] **Step 4: Run the tests and watch them pass**

Run: `OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 300 node --test server/ai/server.cleanup.test.mjs server/ai/server.test.mjs; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"`
Expected: exit 0, 32 tests pass (2 + 30), nothing listed.
Run `audit:ai`'s file set without npm (npm adds its own `node-compile-cache`): `OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 600 node --test 'server/**/*.test.mjs' 'src/lib/*.test.mjs'; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"`
Expected: exit 0, 617/617 pass (615 on main + 2), nothing listed (main leaves one `lumen-server-test-dist-*`).
Run: `timeout 600 npm run audit:ai`. Expected: exit 0, 617/617 pass.

- [x] **Step 5: Commit**

```bash
git add server/ai/server.test.mjs server/ai/server.cleanup.test.mjs
git commit -m "Remove the server tests' fixture directory when the suite ends" -m "<why-body: every audit:ai run left a lumen-server-test-dist-* directory in the system temp folder; the new check runs server.test.mjs in a child with a private temp folder, passing and with a forced failure, and fails on main>"
```

## After the task (orchestrator, not SDD)

- The acceptance criterion against the literal command: list `lumen-server-test-dist-*` in the real `os.tmpdir()` before and after a plain `npm run audit:ai`. On main one name was added (`lumen-server-test-dist-ZLJlG8`, 193 to 194); on the branch none may be.
- Gate: `npm run check`, then the full browser gate through `gate-slot`; record `audit:app`'s budget numbers.
- Docs: a dated verification-log row in `docs/internal/PRODUCT_REQUIREMENTS.md` and a dated entry in `docs/FUNCTIONAL_TESTING.md`.

## As built

- Task 1 landed as planned. On main both new tests failed only at the leftovers assertion, each naming one `lumen-server-test-dist-*`; on the branch the two files ran 32/32 and `audit:ai` 617/617 (622/622 after the rebase onto main 986b759).
- The final review found the Review Focus claim about the hook's line order false; it is corrected above. node:test rethrows an error raised before the first test starts and runs no hook, so registering the hook before the `writeFile` is harmless, not protective. A deferred suggestion to explain that order in a comment was dropped for the same reason.
- `output` also names the child's signal and spawn error, so a child stopped by the 120 s bound says so: with the bound cut to 50 ms for one run it read `(child killed by SIGTERM)` and `… ETIMEDOUT`, and nothing was left behind.
- The failing-run test keeps `run.fail >= 1`: the passing-run test already fails if the fixture is removed mid-suite in a normal run.
- Known risks:
  - A failure while building the fixture, before the first test starts, leaves its directory (accepted; building it in a `before()` hook would close it).
  - An interrupted run (Ctrl-C, SIGTERM, a cancelled CI job) leaves the fixture, and the check's private folder too: no hook runs when the process is killed.
- Rulings made during execution:
  - Ruling: the fixture-build gap is recorded, not closed — the issue reads "passes or fails" as test outcomes, and the gap takes a failed 63-byte write into a folder `mkdtemp` has just made — cost if wrong: on a full disk a failed run can leave one fixture directory.
  - Ruling: no comment explains the hook's order — the order protects nothing — cost: none.
  - Ruling: `run.fail` stays `>= 1` — the acceptance criterion is about leftovers, not hook timing — cost if wrong: a Node change that ran `after()` hooks early in the forced-failure arrangement would go unnoticed by that test.
  - Ruling: main moved during the work (#199), so the branch was rebased before these docs were written and gated once on the rebased head (8b45059); the docs commit on top changes no file the gate or the build loads — cost if wrong: none beyond order.
  - Ruling: the worktree was made with `git worktree add` at the brief's path, since the native worktree tool cannot name the branch — cost if wrong: it is removed by hand after merge.

## Follow-up: a failed fixture build

Before merging PR #202, the reviewer would not leave one leak open. The issue says no `lumen-server-test-dist-*` directory may remain after the suite passes or fails, yet a failure while writing the fixture, before the first test starts, left it.

### Task 2: Remove the fixture when writing it fails, and prove it

**Files:**
- Modify: `server/ai/server.cleanup.test.mjs` (the header comment at :9-10; a new constant after `FORCED_FAILURE`; a third test at the end)
- Modify: `server/ai/server.test.mjs:31` (the fixture write)

**Interfaces (file-local):**
- Consumes Task 1's `runServerSuite(t, { preload } = {})` unchanged.
- `FIXTURE_WRITE_FAILURE` is a preload that makes the fixture's write reject. Every other write goes through.

```js
const FIXTURE_WRITE_FAILURE = `data:text/javascript,${encodeURIComponent([
  'import fsp from "node:fs/promises";',
  'import { syncBuiltinESMExports } from "node:module";',
  "const { writeFile } = fsp;",
  'fsp.writeFile = (path, ...rest) => (String(path).includes("lumen-server-test-dist-") ? Promise.reject(new Error("forced fixture write failure")) : writeFile(path, ...rest));',
  "syncBuiltinESMExports();",
].join("\n"))}`;
```

Decided, with evidence from scratch runs on Node 26.12.1:
- The fixture build stays at top level; it does not move into a `before()` hook. Here is what a `before()` hook did when a test was registered ahead of the file's hooks, as the failing-run test's preload does:
  - node:test ran the root `after()` while `before()` was still creating the folder.
  - It never ran `after()` again, so the folder leaked.
  - The instrumented log read "before start", then "after undefined", then "before made …".
- The `mkdtemp` line, the `after()` hook and its comment stay as they are.
- `syncBuiltinESMExports()` is what makes `server.test.mjs`'s named `writeFile` import resolve to the patched function. On 6d820b7 the preload made the run exit 7 with the forced message and leave the folder.

- [ ] **Step 1: Write the failing test** at the end of `server/ai/server.cleanup.test.mjs`. Also change the header comment's "in a child, passing and failing." to "in a child: passing, failing, and with its fixture write failing." (re-wrap the comment lines as needed).

```js
test("the server suite leaves nothing in its temp folder when writing its fixture fails", async (t) => {
  const run = await runServerSuite(t, { preload: FIXTURE_WRITE_FAILURE });
  assert.ok(run.status > 0, `the fixture write failure did not fail the child:\n${run.output}`);
  assert.match(run.output, /forced fixture write failure/, `the child never reached the fixture write:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after writing its fixture failed`);
});
```

- [ ] **Step 2: Watch it fail on this branch and on main, for the right reason**

On this branch, with `server.test.mjs` unmodified from 6d820b7: `OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 300 node --test server/ai/server.cleanup.test.mjs; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"`

Expected:
- exit 1;
- the two Task 1 tests pass;
- the new test fails only at the leftovers assertion, naming one `lumen-server-test-dist-XXXXXX`;
- `ls -A` prints nothing.

On main:
1. Make a detached scratch worktree at `origin/main` (986b759) in the scratchpad and symlink its `node_modules`.
2. Copy in the branch's `server/ai/server.cleanup.test.mjs`.
3. Run the same command there. Expected: exit 1, and all three tests fail only at their leftovers assertions.
4. Remove the scratch worktree with `git worktree remove --force` (it holds the symlink and the copied file).

- [ ] **Step 3: Remove the folder when the fixture write fails** in `server/ai/server.test.mjs`. Wrap the `await writeFile(...)` at :31 in `try { … } catch (error) { await rm(fixtureDistDirectory, { recursive: true, force: true }); throw error; }`. Put a one-line comment above it saying that a failure there comes before the first test starts, when node:test runs no hook. Nothing else changes.

- [ ] **Step 4: Watch it pass**

| Run | Expected |
|---|---|
| `OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 300 node --test server/ai/server.cleanup.test.mjs server/ai/server.test.mjs; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"` | exit 0; 33/33 (3 + 30); nothing listed |
| `OUTER=$(mktemp -d) && TMPDIR=$OUTER timeout 600 node --test 'server/**/*.test.mjs' 'src/lib/*.test.mjs'; echo "exit $?"; ls -A "$OUTER"; rmdir "$OUTER"` | exit 0; 623/623 (622 + 1); nothing listed |
| `timeout 600 npm run audit:ai` | exit 0; 623/623 |

- [ ] **Step 5: Commit** both files as "Remove the server tests' fixture when writing it fails". The why-body: a failed fixture write came before the first test, when node:test runs no hook, and left the folder. The new test makes that write reject through a preload, and it fails on main and on the previous head.
