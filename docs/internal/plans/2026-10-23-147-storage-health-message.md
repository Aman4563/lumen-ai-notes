# Storage health speaks plainly when storage is blocked (#147) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With site data blocked (Chrome's "Block third-party and all cookies", Safari's Block All Cookies), Settings → Storage health says in plain, themed words what still works and what does not, announces it once, and never shows the browser's raw exception text; the raw error name reaches only the device-evidence report.

**Architecture:** Root cause: `refresh()` in `src/components/StorageHealth.jsx` awaits one `Promise.all` in which `cacheUsage()` has no catch. One `caches.keys()` SecurityError therefore discards every measurement, including the quota estimate that Chrome still answers under its cookie blocking and the workspace budget, so the panel also reads "0 B / 0 B". The catch then renders `error.message` in a `role="status"` paragraph that is inserted already filled. Each measurement now settles on its own. A Cache Storage failure is classified by a new pure module, `src/lib/storageFailure.js` (kind, learner copy, bounded error name, cleanup-failure copy), and shown in the #139 notice's look with a separate announcer that speaks once per visit. `src/components/DeviceEvidence.jsx` records the error names its own probes meet.

**Tech Stack:** React 19 function components, plain ES modules, `node:test`, Puppeteer (`puppeteer-core`) browser audits with axe-core.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/147 (binding; it has no comments). It builds on #139 (PR #145, merged): `src/lib/safeStorage.js`, the Settings notice in `src/components/Settings.jsx`, and the `scripts/storage_blocked_audit.mjs` harness.

## Global Constraints

- Gate on Node 26 (`.nvmrc`): `npm run check` and the full `npm run check:browser`, every browser run through `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot`; rerun a failed suite alone with `LUMEN_BROWSER_RETRIES=0`.
- Machine hygiene: other agents run the same commands in other worktrees.
  - Bound every command: browser runs with `timeout 3600` (gate-slot may first wait for a free slot), the rest with a timeout suited to them.
  - Stop only processes you started, by recorded PID, never `pkill`/`killall` by pattern.
  - Never use ports 4173, 4187, 4194 or 11434.
- Accessibility: axe WCAG 2.2 AA with an empty allowlist (`ALLOWLIST = []` in `scripts/a11y_audit.mjs` stays empty). Theme tokens only (Paper, Night, Contrast, System), no hard-coded colours. 44 px touch targets and ≥ 16 px form text on phones. Check 320 px, 393 px, 200% text and landscape.
- Budgets: startup entry < 750,000 B; install route screens < 900,000 B (baseline on 97d3e2e: 623,709 B and 690,627 B). `src/lib/storageFailure.js` is imported only by the lazy `StorageHealth` and `DeviceEvidence` screens, never by `src/App.jsx`.
- Local-first: no new network request, no paid or cloud AI, no tracking; learner data stays on the device. The device-evidence report gains only error *names* (bounded identifiers), never error text.
- Persisted data: no new profile field, so the `normalizeProfile`/backup fixture/`mergeProfileVersions` rule is unaffected. Web Storage is never named in `src/` code outside `src/lib/safeStorage.js` (`src/lib/safeStorage.test.mjs` fails otherwise).
- Never weaken an existing assertion. The #139 audit matches the exact notice title "This browser is not saving preferences on this device" in every Settings status region, so no new copy may contain it.
- Browser audits wait for what a check reads (`scripts/audit_waits.mjs`: `waitForTheme`, `pollValue`); a fixed sleep only bounds a check that something must not happen.
- Commits: concise imperative subject, short why-body, no trailers.
- Exact values from the issue:
  - Failures mapped: `SecurityError`, `NotAllowedError`, `QuotaExceededError`, unknown. Here `SecurityError` and `NotAllowedError` → `"blocked"`, `QuotaExceededError` → `"full"`, any other value → `"unknown"`, decided by the error's name only.
  - "Never show raw exception text to learners; keep the raw name available to the device-evidence export only."
  - Acceptance: with storage blocked, Storage health shows a plain message and no raw error text at 393×852 and desktop, in Paper, Night and Contrast. The message is announced once to screen readers and uses theme tokens. The #139 harness asserts no raw exception text and fails on main first. `npm run check` and `npm run check:browser` pass and budgets hold.
- Exact copy and values (rulings below):
  - blocked: title "This browser is not saving offline files on this device"; detail "Reading online works as usual during this visit, but lectures will not open offline, and downloads such as the On-device Lite model are not saved."
  - full: title "This browser has no room for more offline files"; detail "Reading online works as usual during this visit, but new lectures may not open offline, and downloads such as the On-device Lite model may not be saved. Free up space on this device to make room."
  - unknown: title "Storage details are unavailable right now"; detail "Reading online works as usual during this visit, but lectures may not open offline, and downloads such as the On-device Lite model may not be saved."
  - Announcement: text `${title}. ${detail}`, filled 250 ms after the message appears, emptied 5,000 ms later, once per visit per kind (Settings' #139 constants).
  - A measurement that failed reads "Not measured".
  - Cleanup failures:
    - An `OfflineCleanupError` keeps today's wording: `Optional cache cleanup failed: ${error.message}`.
    - Any other error with nothing removed: "Optional cache cleanup failed. Offline files were kept."
    - With `n` removed: `Optional cache cleanup stopped after removing ${n} optional cached asset${n === 1 ? "" : "s"}. Open a lecture to download it again.`
  - Device-evidence fields:
    - `auto.cacheStorageError` and `auto.storageManagerError`: `""` when the probe answered, else `storageErrorName(error)`.
    - The grid shows "Offline caches" as `unavailable (${name})` and "Persistent storage" as `query failed (${name})`, followed by the estimate when there is one.
- Out of scope: raw error text elsewhere in the app (App toasts); Safari's own blocking, which stays a device step.

## Review Focus

- Browser text that arrives as a `TypeError` or `SyntaxError` (a failed fetch, an HTML page where JSON was expected) during "Remove optional offline files". The toast must show fixed copy, not the browser's words. Test: Task 1, `cleanupFailureMessage`.
- Rejection values that are not errors (a string, `undefined`, an object whose `name` getter throws or is no identifier) must give `"unknown"`/`"Error"` and never throw. Test: Task 1.
- Refresh while the failure persists keeps the message and does not announce it again. Test: Task 2, the cookie-blocked flow.
- A failure that clears on Refresh: the message goes, and no status region keeps its text. Test: Task 2, the injected flow's estimate-only step.
- A cleanup that fails after removing some files must say how many it removed, not that files were kept. Test: Task 1.

## Rulings

- Ruling: the copy is mine, in the #139 register ("This browser is not … on this device", "during this visit"), with a distinct lead sentence. The "unknown" title reuses the Storage health error boundary's wording ("Storage details are unavailable right now"). The #139 audit counts any status region that contains the notice title, so reusing it would break those checks. Cost if wrong: a copy edit in `storageFailure.js`, its test and the harness constants.
- Ruling: a StorageManager (quota estimate) failure alone shows no message, only the plain heading line "Browser quota estimate unavailable". When Cache Storage fails too, the Cache Storage kind decides the message. Only Cache Storage decides whether offline files are saved, and Chrome's cookie blocking answers the estimate (probe on 2026-10-23: quota 10 GB, usage 0) while it refuses every Cache Storage call. Cost if wrong: a browser that refuses only the estimate gets no sentence on what still works, although the issue lists StorageManager among the mapped failures.
- Ruling: the message is announced once per visit per failure kind, through an always-present, visually hidden status region (the #139 pattern). Refresh and reopening Settings never repeat it, and the region shows text only while it equals the visible message. Cost if wrong: a learner who reopens Settings later is not told again (the message stays on screen).
- Ruling: a measurement that failed reads "Not measured", never 0 B: Offline assets, and the workspace line, Study profile and Whiteboards when the budget summary failed (the workspace meter is then omitted). Cost if wrong: none known; "0 B · 0 files" presented a failed measurement as a real zero.
- Ruling: the cleanup toast is in scope ("Never show raw exception text to learners"). Authored messages throw `OfflineCleanupError`; anything else gets fixed copy that counts what was removed. This is unit-tested only, with no browser case: cleanup is disabled whenever Cache Storage was not measured, so blocked storage cannot reach it. Cost if wrong: a little more change than the panel message alone.
- Ruling: `DeviceEvidence` records the raw names from its own probes as `cacheStorageError` and `storageManagerError`. Its Automatic checks grid, which mirrors the exported `auto` object, shows them too; error text never appears. Cost if wrong: someone who opens Device evidence sees a name such as "SecurityError".
- Ruling: the message sits right under the panel heading, as `.storage-health-message`, with the #139 notice's tokens (`--gold-soft`, `--ai-warn`, `--ink`) through grouped selectors. It does not share `.settings-storage-notice`, which the #139 audit's `noticeState` queries. Cost if wrong: none; these pairs are already pinned in `src/lib/themeContrast.test.mjs`.
- Ruling: the browser checks are three new cases in the #139 harness: Chrome's cookie blocking at 393×852 and 1280×800, and an injected `NotAllowedError`, `QuotaExceededError` and `TypeError` on a working browser. They are not added inside `siteDataBlockedFlows`, whose first-open Save-status and later theme-toast checks depend on order. Cost if wrong: about 20 s more suite time.

## Files

- Create `src/lib/storageFailure.js` and `src/lib/storageFailure.test.mjs` (picked up by `audit:ai`'s `src/lib/*.test.mjs` glob).
- Modify `src/components/StorageHealth.jsx` (`removeOptionalCache` :64-102, state :105, `refresh` :107-135, `clearOptional` :139-149, render :151-161).
- Modify `src/styles.css` (the #139 notice rules at :8754-8759).
- Modify `src/components/DeviceEvidence.jsx` (checks :109-125, probes :138-151, grid rows :268-269).
- Modify `scripts/storage_blocked_audit.mjs` (header comment, imports, `installAiMocks`, new helpers and flows, case list, summary line).
- Docs (after the gate, not an SDD task): `docs/internal/PRODUCT_REQUIREMENTS.md`, `docs/FUNCTIONAL_TESTING.md`, `docs/guides/APP_GUIDE.md` ("Data and privacy model"), `docs/DEVICE_TESTING.md` (the #139 section).

---

### Task 1: Classify storage failures and write their plain copy

**Files:**
- Create: `src/lib/storageFailure.js`
- Test: `src/lib/storageFailure.test.mjs`

**Interfaces:**
- Produces:
  - `export const STORAGE_FAILURE_COPY`: frozen `{ blocked, full, unknown }`, each a frozen `{ title: string, detail: string }` holding the exact copy in Global Constraints.
  - `export const storageErrorName = (error: unknown) => string`: returns `error.name` when it is a string matching `/^[A-Za-z][A-Za-z0-9_]{0,63}$/`, otherwise `"Error"`. It reads the name inside `try` and never throws.
  - `export const storageFailureKind = (error: unknown) => "blocked" | "full" | "unknown"`: decided by `storageErrorName(error)` alone (names in Global Constraints).
  - `export class OfflineCleanupError extends Error`: thrown only by Storage health's own cleanup checks, and its message is written for learners. Its `name` is `"OfflineCleanupError"`.
  - `export const cleanupFailureMessage = (error: unknown, removed: unknown) => string`: an `OfflineCleanupError` wins. Otherwise `removed` counts only when it is an integer > 0. The exact strings are in Global Constraints.

- [ ] **Step 1: Write the failing test** in `src/lib/storageFailure.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { cleanupFailureMessage, OfflineCleanupError, STORAGE_FAILURE_COPY, storageErrorName, storageFailureKind } from "./storageFailure.js";

// Chrome's own words for a Cache Storage call under its cookie blocking (#147).
const CHROME_REFUSAL = "Failed to execute 'keys' on 'CacheStorage': An attempt was made to break through the security policy of the user agent.";
const RAW_WORDS = /Error|Exception|CacheStorage|StorageManager|Failed to execute|security policy/;

test("refused storage is blocked, a full store is full, and anything else is unknown", () => {
  assert.equal(storageFailureKind(new DOMException(CHROME_REFUSAL, "SecurityError")), "blocked");
  assert.equal(storageFailureKind(new DOMException("Permission denied.", "NotAllowedError")), "blocked");
  assert.equal(storageFailureKind(new DOMException("The quota has been exceeded.", "QuotaExceededError")), "full");
  for (const error of [new DOMException("The user denied permission to access the database.", "UnknownError"), new DOMException("The database connection is closing.", "InvalidStateError"), new TypeError("Failed to fetch"), new Error("SecurityError"), "SecurityError", undefined, null, {}, { name: 42 }]) {
    assert.equal(storageFailureKind(error), "unknown", `${error && typeof error === "object" ? error.name : String(error)} was not unknown`);
  }
});

test("an error name is kept only as a short identifier, and reading it never throws", () => {
  assert.equal(storageErrorName(new DOMException(CHROME_REFUSAL, "SecurityError")), "SecurityError");
  assert.equal(storageErrorName(new TypeError("Failed to fetch")), "TypeError");
  assert.equal(storageErrorName(new OfflineCleanupError("Offline files were kept.")), "OfflineCleanupError");
  const hostile = { get name() { throw new Error("boom"); } };
  for (const value of [hostile, { name: "<img src=x onerror=alert(1)>" }, { name: "Security Error" }, { name: "" }, { name: "x".repeat(65) }, { name: "9Lives" }, "SecurityError", undefined, null]) {
    assert.equal(storageErrorName(value), "Error");
  }
  assert.equal(storageFailureKind(hostile), "unknown");
});

test("each message is the plain copy that says what still works and what does not", () => {
  assert.deepEqual(STORAGE_FAILURE_COPY, {
    blocked: { title: "This browser is not saving offline files on this device", detail: "Reading online works as usual during this visit, but lectures will not open offline, and downloads such as the On-device Lite model are not saved." },
    full: { title: "This browser has no room for more offline files", detail: "Reading online works as usual during this visit, but new lectures may not open offline, and downloads such as the On-device Lite model may not be saved. Free up space on this device to make room." },
    unknown: { title: "Storage details are unavailable right now", detail: "Reading online works as usual during this visit, but lectures may not open offline, and downloads such as the On-device Lite model may not be saved." },
  });
  assert.ok(Object.isFrozen(STORAGE_FAILURE_COPY));
  for (const copy of Object.values(STORAGE_FAILURE_COPY)) {
    assert.ok(Object.isFrozen(copy));
    assert.doesNotMatch(`${copy.title} ${copy.detail}`, RAW_WORDS);
    // The #139 audit counts every status region that carries this title.
    assert.ok(!copy.title.includes("not saving preferences"));
  }
});

test("a cleanup failure shows authored words or a fixed sentence, never the browser's", () => {
  assert.equal(cleanupFailureMessage(new OfflineCleanupError("The server could not be reached. Offline files were kept."), 0), "Optional cache cleanup failed: The server could not be reached. Offline files were kept.");
  for (const error of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"), new DOMException(CHROME_REFUSAL, "SecurityError"), new Error("internal detail"), "boom", undefined]) {
    assert.equal(cleanupFailureMessage(error, 0), "Optional cache cleanup failed. Offline files were kept.");
  }
  assert.equal(cleanupFailureMessage(new TypeError("Failed to fetch"), 1), "Optional cache cleanup stopped after removing 1 optional cached asset. Open a lecture to download it again.");
  assert.equal(cleanupFailureMessage(new DOMException(CHROME_REFUSAL, "SecurityError"), 3), "Optional cache cleanup stopped after removing 3 optional cached assets. Open a lecture to download it again.");
  for (const removed of [-1, Number.NaN, 1.5, "2", undefined]) {
    assert.equal(cleanupFailureMessage(new TypeError("Failed to fetch"), removed), "Optional cache cleanup failed. Offline files were kept.");
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test src/lib/storageFailure.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./storageFailure.js` (the module does not exist on main).

- [ ] **Step 3: Implement `src/lib/storageFailure.js`** with the five exports above. Open with a header comment: what #147 found (the raw `caches.keys()` SecurityError text in Storage health), that kinds are decided by the error's name and never its text, and that only `DeviceEvidence` records names. Never name the Web Storage globals in code.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test src/lib/storageFailure.test.mjs && npm run audit:ai`
Expected: PASS: 4 new tests; `audit:ai` reports no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storageFailure.js src/lib/storageFailure.test.mjs
git commit -m "Map storage failures to plain Storage health copy" -m "Issue #147: Storage health showed the browser's own CacheStorage text under cookie blocking. Name-based kinds, the learner copy and the cleanup-failure wording live in one pure module so the panel and device evidence share them."
```

### Task 2: Storage health settles each measurement and explains a Cache Storage failure

**Files:**
- Modify: `src/components/StorageHealth.jsx`
- Modify: `src/styles.css` (:8754-8759)
- Test: `scripts/storage_blocked_audit.mjs`

**Interfaces:**
- Consumes: Task 1's `STORAGE_FAILURE_COPY`, `storageFailureKind`, `OfflineCleanupError`, `cleanupFailureMessage`.
- Produces (DOM contract the harness and Task 3 read):
  - `.storage-health .storage-health-message`: a div with no live role, placed right after `.storage-health-heading`, holding `svg[aria-hidden="true"]` (`AlertTriangle`), then a div with `strong` (title) and `span` (detail).
  - `p.visually-hidden.storage-health-announcer[role="status"]`, always rendered inside `.storage-health`. It is empty except during its announcement, and shows text only while that text equals the current message.
  - "Not measured" in the "Offline assets" `dd` when Cache Storage failed. When the budget summary failed, it replaces the `.storage-budget-line strong` and the "Study profile"/"Whiteboards" `dd`s, and the workspace meter is omitted.
  - `.storage-cleanup` is disabled while loading, or when Cache Storage was not measured or holds no files.

- [ ] **Step 1: Write the failing browser checks** in `scripts/storage_blocked_audit.mjs`.
  - Add `import { waitForTheme } from "./audit_waits.mjs";`.
  - Extend the header comment with one sentence on #147.
  - Add these helpers and flows after `studyDataRecoversFlows`:

```js
// Issue #147: Storage health with failing Cache Storage. Chrome's cookie
// blocking rejects every Cache Storage call with a SecurityError whose text
// the panel used to show; the other kinds are injected into a working
// browser. The copy is pinned in src/lib/storageFailure.test.mjs.
const OFFLINE_FILES_BLOCKED = "This browser is not saving offline files on this device";
const OFFLINE_FILES_FULL = "This browser has no room for more offline files";
const STORAGE_DETAILS_UNAVAILABLE = "Storage details are unavailable right now";
const HEALTH_TITLES = [OFFLINE_FILES_BLOCKED, OFFLINE_FILES_FULL, STORAGE_DETAILS_UNAVAILABLE];
// Words only a browser's own error text uses; the injected errors carry the marker.
const RAW_STORAGE_ERROR = /Failed to execute|CacheStorage|StorageManager|security policy|DOMException|SecurityError|NotAllowedError|QuotaExceededError|UnknownError|TypeError/;
const RAW_MARKER = "lumen-raw-147";
const REFRESH_HEALTH = ".settings-drawer .storage-health button[aria-label='Refresh storage estimate']";
// The message wears the #139 notice's tokens in every theme.
const HEALTH_TOKEN_SAMPLES = [
  { selector: ".settings-drawer .storage-health-message", property: "backgroundColor", token: "--gold-soft" },
  { selector: ".settings-drawer .storage-health-message strong", property: "color", token: "--ai-warn" },
  { selector: ".settings-drawer .storage-health-message span", property: "color", token: "--ink" },
];
const storageHealthReady = (page) => page.waitForFunction((selector) => {
  const refresh = document.querySelector(selector);
  return Boolean(refresh) && !refresh.disabled;
}, { timeout: 15_000 }, REFRESH_HEALTH).catch(() => assert.fail("Storage health never finished measuring"));
const storageHealthState = (page) => page.$eval(".settings-drawer .storage-health", (panel) => {
  const message = panel.querySelector(".storage-health-message");
  const row = (label) => [...panel.querySelectorAll(".storage-breakdown > div")].find((item) => item.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent || "";
  return {
    text: panel.innerText,
    title: message?.querySelector("strong")?.textContent || "",
    detail: message?.querySelector("span")?.textContent || "",
    visible: Boolean(message?.getClientRects().length),
    quotaLine: panel.querySelector(".storage-health-heading small")?.textContent || "",
    workspace: panel.querySelector(".storage-budget-line strong")?.textContent || "",
    offlineAssets: row("Offline assets"),
    announced: [...panel.querySelectorAll("[role='status']")].map((node) => node.textContent).join(" | "),
  };
});
// Counts the times a status region in Storage health filled with `title`, and
// how many of those regions had been on screen empty first: a region inserted
// already filled may never be announced.
const watchHealthAnnouncements = (page, title) => page.evaluate((expected) => {
  const result = { fills: 0, filledAfterEmpty: 0 };
  window.__lumenAuditHealth = result;
  const seenEmpty = new WeakSet();
  const holding = new WeakSet();
  const scan = () => {
    for (const region of document.querySelectorAll(".storage-health [role='status']")) {
      if (!region.textContent.trim()) {
        seenEmpty.add(region);
        holding.delete(region);
      } else if (region.textContent.includes(expected) && !holding.has(region)) {
        holding.add(region);
        result.fills += 1;
        if (seenEmpty.has(region)) result.filledAfterEmpty += 1;
      }
    }
  };
  new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  scan();
}, title);
const healthAnnouncements = (page) => page.evaluate(() => window.__lumenAuditHealth);
// Changes what the browser answers with `install`, presses Refresh and waits
// until Storage health shows `title` ("" for no message).
const refreshHealth = async (page, title, install, ...args) => {
  await page.evaluate(install, ...args);
  await page.$eval(REFRESH_HEALTH, (button) => button.click());
  await page.waitForFunction((selector, expected) => {
    const refresh = document.querySelector(selector);
    const shown = document.querySelector(".settings-drawer .storage-health-message strong")?.textContent || "";
    return Boolean(refresh) && !refresh.disabled && shown === expected;
  }, { timeout: 15_000 }, REFRESH_HEALTH, title)
    .catch(async () => assert.fail(`after Refresh Storage health did not show ${title ? `“${title}”` : "no message"}: ${JSON.stringify(await storageHealthState(page))}`));
  return storageHealthState(page);
};
// Every Cache Storage listing fails with `name` and the marker as its text;
// "TypeError" stands for a failure that is no storage refusal at all.
const refuseCacheKeys = (marker, name) => {
  window.__lumenAuditKeys ||= CacheStorage.prototype.keys;
  CacheStorage.prototype.keys = function keys() {
    return Promise.reject(name === "TypeError" ? new TypeError(`${marker} TypeError`) : new DOMException(`${marker} ${name}`, name));
  };
};
// Cache Storage answers again; the quota estimate is refused instead.
const refuseEstimateOnly = (marker) => {
  CacheStorage.prototype.keys = window.__lumenAuditKeys;
  StorageManager.prototype.estimate = function estimate() {
    return Promise.reject(new DOMException(`${marker} NotAllowedError`, "NotAllowedError"));
  };
};

// Chrome's cookie blocking: the message, never the browser's words, announced
// once, kept on Refresh and reopening, in the theme's tokens, axe-clean, and
// fitting a 320 px phone at 200% text and phone landscape.
const storageHealthBlockedFlows = (viewportName) => async ({ page, open }) => {
  await open("#/home", ".welcome-block");
  const refusal = await page.evaluate(() => caches.keys().then(() => null, (error) => ({ name: error.name, message: error.message })));
  assert.ok(refusal?.message, `Chrome's cookie blocking did not refuse Cache Storage, so this case proves nothing: ${JSON.stringify(refusal)}`);
  await watchHealthAnnouncements(page, OFFLINE_FILES_BLOCKED);
  await openSettings(page);
  await storageHealthReady(page);
  const first = await storageHealthState(page);
  assert.ok(!first.text.includes(refusal.message) && !RAW_STORAGE_ERROR.test(first.text), `Storage health showed the browser's own error text: ${JSON.stringify(first.text)}`);
  assert.ok(first.visible && first.title === OFFLINE_FILES_BLOCKED, `Storage health did not say offline files are not being saved: ${JSON.stringify(first)}`);
  assert.ok(first.detail.startsWith("Reading online works as usual during this visit") && first.detail.includes("lectures will not open offline"), `the message did not say what still works and what does not: “${first.detail}”`);
  assert.equal(first.offlineAssets, "Not measured", "a Cache Storage the browser refused was shown as a measured size");
  assert.match(first.quotaLine, / used by this origin$/, "the quota estimate, which Chrome still answers, was dropped with the refused Cache Storage");
  assert.doesNotMatch(first.workspace, /\/ 0 B$/, "the workspace limit read 0 B");
  await page.waitForFunction(() => window.__lumenAuditHealth.fills > 0, { timeout: 8_000 })
    .catch(() => assert.fail("Storage health did not announce its message"));
  assert.deepEqual(await healthAnnouncements(page), { fills: 1, filledAfterEmpty: 1 }, "the Storage health message went into a status region that was never on screen empty");
  for (const [theme, label] of THEMES) {
    await clickByText(page, ".theme-choices button", label);
    const applied = await waitForTheme(page, theme, { samples: HEALTH_TOKEN_SAMPLES });
    assert.ok(applied.ok, `${label}: the Storage health message did not wear the theme's tokens: ${applied.reason}`);
    const violations = await axeViolations(page, ".settings-drawer");
    stats.axeRuns += 1;
    assert.deepEqual(violations, [], `${label}: axe found violations in Settings with the Storage health message`);
  }
  await page.waitForFunction(() => ![...document.querySelectorAll(".storage-health [role='status']")].some((node) => node.textContent.trim()), { timeout: 10_000 })
    .catch(() => assert.fail("the Storage health message stayed in a status region after it was announced, so browse mode reads it twice"));
  await page.$eval(REFRESH_HEALTH, (button) => button.click());
  await storageHealthReady(page);
  await closeSettings(page);
  await openSettings(page);
  await storageHealthReady(page);
  const reopened = await storageHealthState(page);
  assert.ok(reopened.visible && reopened.title === OFFLINE_FILES_BLOCKED && !reopened.text.includes(refusal.message) && !RAW_STORAGE_ERROR.test(reopened.text), `after Refresh and reopening Settings Storage health changed: ${JSON.stringify(reopened)}`);
  await delay(600); // bounds a check that something must not happen: the announcement waits 250 ms
  assert.equal((await healthAnnouncements(page)).fills, 1, "Refresh or reopening Settings announced the Storage health message again");
  if (viewportName === "phone") {
    for (const [label, viewport, fontSize] of [
      ["at 320 px and 200% text", { width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, "32px"],
      ["in phone landscape", { width: 852, height: 393, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, ""],
    ]) {
      await page.setViewport(viewport);
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      await settle(page);
      const layout = await page.$eval(".settings-drawer .storage-health-message", (message) => {
        const box = message.getBoundingClientRect();
        const text = [...message.querySelectorAll("strong, span")].map((node) => node.getBoundingClientRect().right);
        return { scrollWidth: message.scrollWidth, clientWidth: message.clientWidth, left: box.left, right: box.right, textRight: Math.max(...text), viewport: document.documentElement.clientWidth };
      });
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1 && layout.left >= 0 && layout.right <= layout.viewport + 1 && layout.textRight <= layout.right + 1, `${label} the Storage health message does not fit: ${JSON.stringify(layout)}`);
    }
  }
};

// Each other kind, injected into a working browser, gets its own plain
// message; a refused estimate alone keeps the plain quota line.
const injectedHealthFailureFlows = async ({ page, open }) => {
  await open("#/home", ".welcome-block");
  await openSettings(page);
  await storageHealthReady(page);
  const healthy = await storageHealthState(page);
  assert.ok(!healthy.visible && healthy.offlineAssets !== "Not measured" && !healthy.announced.trim(), `with working storage Storage health reported a failure: ${JSON.stringify(healthy)}`);
  for (const [name, title] of [["NotAllowedError", OFFLINE_FILES_BLOCKED], ["QuotaExceededError", OFFLINE_FILES_FULL], ["TypeError", STORAGE_DETAILS_UNAVAILABLE]]) {
    const state = await refreshHealth(page, title, refuseCacheKeys, RAW_MARKER, name);
    assert.ok(!state.text.includes(RAW_MARKER) && !RAW_STORAGE_ERROR.test(state.text), `a Cache Storage ${name} showed the browser's own text: ${JSON.stringify(state.text)}`);
    assert.equal(state.offlineAssets, "Not measured", `a Cache Storage ${name} was shown as a measured size`);
  }
  // The last message is announced; once it has gone, no status region keeps it.
  await page.waitForFunction((title) => [...document.querySelectorAll(".storage-health [role='status']")].some((node) => node.textContent.includes(title)), { timeout: 8_000 }, STORAGE_DETAILS_UNAVAILABLE)
    .catch(() => assert.fail("Storage health did not announce a Cache Storage failure"));
  const estimateOnly = await refreshHealth(page, "", refuseEstimateOnly, RAW_MARKER);
  assert.equal(estimateOnly.quotaLine, "Browser quota estimate unavailable", "a refused quota estimate did not say the estimate is unavailable");
  assert.ok(!estimateOnly.text.includes(RAW_MARKER) && !RAW_STORAGE_ERROR.test(estimateOnly.text), `a refused quota estimate showed the browser's own text: ${JSON.stringify(estimateOnly.text)}`);
  assert.notEqual(estimateOnly.offlineAssets, "Not measured", "with Cache Storage answering again, offline assets were not measured");
  assert.ok(!HEALTH_TITLES.some((title) => estimateOnly.announced.includes(title)), `a status region kept a message that had gone: “${estimateOnly.announced}”`);
};
```

  Register the cases:
  - After the nearly-full-store case: `await runCase("Storage health with failing Cache Storage", { viewport: VIEWPORTS[0][1] }, injectedHealthFailureFlows);`
  - In the `blockedBrowser` loop, after each `blocked site data at ${viewportName}` case: `await runCase(\`Storage health with blocked site data at ${viewportName}\`, { viewport, browserInstance: blockedBrowser }, storageHealthBlockedFlows(viewportName));`
  - Extend the summary `console.log` with one clause on these checks.

- [ ] **Step 2: Run against the pre-change code and watch the new cases fail**

Run, in the worktree: `npm run build && LUMEN_BROWSER_RETRIES=0 timeout 3600 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- storage-blocked`.
Expected: FAIL in exactly the three new cases; the ten #139 cases pass:
- Both "Storage health with blocked site data" cases fail with `Storage health showed the browser's own error text: "…Failed to execute 'keys' on 'CacheStorage': An attempt was made to break through the security policy of the user agent.…"`.
- "Storage health with failing Cache Storage" fails with `after Refresh Storage health did not show “This browser is not saving offline files on this device”: {…lumen-raw-147 NotAllowedError…}`.

Quote the exact first lines in the report (they go into docs/FUNCTIONAL_TESTING.md).

- [ ] **Step 3: Rework `src/components/StorageHealth.jsx` and `src/styles.css`**
  - Comment the root cause where `refresh` lives: one refused Cache Storage call used to abort `Promise.all` and discard the estimate and budget.
  - Module scope: `ANNOUNCE_DELAY_MS = 250`, `ANNOUNCE_CLEAR_MS = 5_000` (commented as Settings' #139 values) and `announcedKinds = new Set()` (once per visit; the component remounts on every Settings open).
  - A local `settle(measure)` returns `{ value }` or `{ error }`, so a synchronous throw inside `measure` is caught too.
  - State: `{ status: "loading", usage: 0, quota: 0, budget: null, cache: null, webllm: null, failure: "" }`. `budget` is `getStorageBudgetSummary()`'s object; `cache` and `webllm` are `{ bytes, requests }` or `null` when refused; `failure` is `""` or a kind. Error text is never stored.
  - `refresh`:
    - Set `status: "loading"`, keeping the previous `failure` so the message does not flicker.
    - Settle `() => navigator.storage?.estimate?.()`, `getStorageBudgetSummary`, `cacheUsage` and `webllmCacheUsage` together.
    - Then set `status: "ready"`, usage and quota from the estimate's value (0 when absent), the three values or `null`, and `failure: cache.error ? storageFailureKind(cache.error) : ""`. Per the ruling, the estimate's own failure is not shown.
  - Render:
    - The message from `STORAGE_FAILURE_COPY[state.failure]`, and the announcer. The announcer is filled by a timer `ANNOUNCE_DELAY_MS` after a kind not yet in `announcedKinds` appears; the kind is added when it fills, and the region is emptied `ANNOUNCE_CLEAR_MS` later. It renders `announced === messageText ? announced : ""`, the same way as `Settings.jsx`'s notice.
    - "Not measured", the meters and the cleanup disabling per the Interfaces block; the On-device AI model row shows when `state.webllm?.bytes > 0`.
  - Cleanup:
    - `removeOptionalCache(progress)` throws `OfflineCleanupError` (same three texts) for its own checks, and adds each successful `cache.delete` to `progress.removed`.
    - `clearOptional` keeps the success toast word for word. On failure it shows `cleanupFailureMessage(error, progress.removed)` as an error. It awaits `refresh()` after either outcome.
  - CSS:
    - Add `.storage-health-message` to each of the five `.settings-storage-notice` selectors, with the comment naming #147.
    - Then add `.storage-health-message { margin: 14px 0 0; }`. No new colours.

- [ ] **Step 4: Build, run and watch everything pass**

Run: `npm run audit:ai && npm run audit:app && LUMEN_BROWSER_RETRIES=0 timeout 3600 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- storage-blocked`
Expected: PASS: `audit:ai` reports no failures (including `themeContrast` and `safeStorage`). `audit:app` passes, with startup and install budgets within limits (record both numbers). `storage-blocked` passes all 13 cases on the first attempt.

- [ ] **Step 5: Commit**

```bash
git add src/components/StorageHealth.jsx src/styles.css scripts/storage_blocked_audit.mjs
git commit -m "Explain blocked Cache Storage in Storage health" -m "Issue #147: under cookie blocking one refused caches.keys() aborted every measurement and the panel showed the browser's own error text in a status region inserted already filled. Each measurement now settles alone; a Cache Storage failure shows plain copy in the #139 notice's tokens, announced once per visit, and unmeasured sizes read Not measured."
```

### Task 3: Device evidence records the raw error names

**Files:**
- Modify: `src/components/DeviceEvidence.jsx`
- Test: `scripts/storage_blocked_audit.mjs`

**Interfaces:**
- Consumes: Task 1's `storageErrorName`; Task 2's flows `storageHealthBlockedFlows` and `injectedHealthFailureFlows` (the estimate stays refused at the end of the latter).
- Produces: `auto.cacheStorageError` and `auto.storageManagerError` in every report (`""` when the probe answered), plus the grid text in Global Constraints.

- [ ] **Step 1: Write the failing checks**
  - Add `pollValue` to the `audit_waits.mjs` import.
  - In `installAiMocks`, start with `const calls = { respond: 0, evidence: [] };`. Before the final `request.continue()`, record every POST to `/api/evidence`: `calls.evidence.push(JSON.parse(request.postData() || "null"))`, guarded with `try`.
  - Add the helper below.
  - Give both #147 flows `calls` in their parameters, and append the steps below.

```js
// The auto-probe the device-evidence page posts the moment its checks exist:
// the same `auto` object its downloaded and copied reports carry.
const postedAutoProbe = async (calls) => {
  const report = await pollValue(() => calls.evidence.find((payload) => payload?.kind === "auto-probe") || null, Boolean, { timeout: 10_000 });
  assert.ok(report, "the device-evidence page posted no auto-probe");
  return report;
};
const evidenceRow = (page, label) => page.$$eval(".evidence-grid > div", (rows, term) => rows.find((row) => row.querySelector("dt")?.textContent === term)?.querySelector("dd")?.textContent || "", label);
```

  At the end of `storageHealthBlockedFlows`:

```js
  await open("#/device-evidence", ".device-evidence-page");
  await page.waitForSelector(".evidence-grid", { timeout: 10_000 });
  const report = await postedAutoProbe(calls);
  assert.equal(report.auto.cacheStorageError, refusal.name, "the device-evidence report did not record Cache Storage's error name");
  assert.equal(report.auto.storageManagerError, "", "the device-evidence report recorded a StorageManager error Chrome never raised");
  assert.ok(!JSON.stringify(report).includes(refusal.message), "the device-evidence report carried the browser's error text, not only its name");
  assert.equal(await evidenceRow(page, "Offline caches"), `unavailable (${refusal.name})`, "the device-evidence page did not show Cache Storage's error name");
```

  At the end of `injectedHealthFailureFlows`:

```js
  await closeSettings(page);
  await page.evaluate(() => { location.hash = "#/device-evidence"; });
  await page.waitForSelector(".device-evidence-page .evidence-grid", { timeout: 15_000 });
  const report = await postedAutoProbe(calls);
  assert.equal(report.auto.storageManagerError, "NotAllowedError", "the device-evidence report did not record StorageManager's error name");
  assert.equal(report.auto.cacheStorageError, "", "with Cache Storage answering, the device-evidence report recorded a Cache Storage error");
  assert.ok(!JSON.stringify(report).includes(RAW_MARKER), "the device-evidence report carried the browser's error text, not only its name");
  assert.equal(await evidenceRow(page, "Persistent storage"), "query failed (NotAllowedError)", "the device-evidence page did not show StorageManager's error name");
```

  Extend the summary clause: device evidence recorded the error's name only.

- [ ] **Step 2: Run against Task 2's build and watch the three #147 cases fail**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 timeout 3600 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- storage-blocked`
Expected: FAIL. Both blocked cases fail with "the device-evidence report did not record Cache Storage's error name" (`undefined` against `"SecurityError"`). The injected case fails with "the device-evidence report did not record StorageManager's error name". The ten #139 cases pass.

- [ ] **Step 3: Implement in `src/components/DeviceEvidence.jsx`**
  - Add `cacheStorageError: ""` and `storageManagerError: ""` to `checks`.
  - In the two probe catches, set them to `storageErrorName(error)`; the StorageManager catch still sets `persistentStorage = "query failed"`.
  - Render the grid rows per Global Constraints.
  - Leave everything else unchanged (format id, the posting, the human checks).

- [ ] **Step 4: Build, run and watch everything pass**

Run: `npm run audit:app && LUMEN_BROWSER_RETRIES=0 timeout 3600 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- storage-blocked`
Expected: PASS: budgets within limits; all 13 cases pass on the first attempt.

- [ ] **Step 5: Commit**

```bash
git add src/components/DeviceEvidence.jsx scripts/storage_blocked_audit.mjs
git commit -m "Record storage error names in the device-evidence report" -m "Issue #147 keeps the raw error out of Storage health but available for diagnosis: the device-evidence probes now record the bounded name of a Cache Storage or StorageManager failure, never its text."
```

---

## As built

All three tasks shipped as planned (`b980974`, `2e9fe89`, `ce9dbd7`, `868c50c` after the rebase onto main 986b759). The task reviews changed three things.

- **The workspace budget.** Under cookie blocking, `getAllData()` falls back without caching a ledger, so `getStorageBudgetSummary()` answered with an empty ledger. The panel showed "2 B / 20.0 MB" and "Study profile 0 B" for a workspace it could not measure, which breaks this plan's own "Not measured" ruling.
  - The summary now rejects with db.js's existing `BUDGET_STATE_UNAVAILABLE` error when no ledger was measured. That adds `src/lib/db.js` and `scripts/storage_audit.mjs` to the files.
  - The blocked cases also require the workspace, Study profile and Whiteboards to read "Not measured" and the workspace meter to be absent.
  - Cost noted in the ledger: during an IndexedDB outage with a journal ledger present, the panel reads "Not measured" until the next save.
- **The Refresh no-repeat check.** It now runs, with a bounded wait, before Settings closes. Closing unmounts the panel and would cancel an announcement that Refresh armed.
- **Device evidence.** `DeviceEvidence` uses `storageErrorName` in both probe catches. A comment notes that `""` means no error was raised.

Deferred minors (not fixed; listed for the final whole-branch review):
- tests that do not pin the object-lookup and `instanceof` guards in `storageFailure.js`;
- a kind that could be announced twice within 5 s, if failures changed A → none → A;
- the announcer effects mirrored from Settings rather than shared;
- no check that the message does not flicker on Refresh;
- `installAiMocks` now also records device-evidence posts;
- the `JSON.stringify` text check that could pass vacuously for a message with quotes.

Budgets at 868c50c, against main 986b759:
- startup entry 623,753 B (+44: the shared `storageFailure` chunk in the preload list);
- install route screens 695,105 B in 42 files (+2,115);
- warm tools unchanged at 304,647 B.
