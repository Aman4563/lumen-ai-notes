import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { pollValue } from "./audit_waits.mjs";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-review-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "lumen-review-downloads-"));
const fixtureDirectory = await mkdtemp(join(tmpdir(), "lumen-review-fixtures-"));
const errors = [];
let browser;

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const match = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    match?.click();
    return Boolean(match);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

// Issue #81: whether saved AI text rendered in `roots` is inert. Runs in the page.
function savedAiReport(roots) {
  const all = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  return {
    roots: roots.length,
    images: all("img").length,
    controls: all("[data-ai-citation], button:not(.code-copy), input, form, iframe, script").map((node) => node.outerHTML.slice(0, 120)),
    appLinks: all("a[href]").filter((link) => new URL(link.href, location.href).hostname === location.hostname).map((link) => link.getAttribute("href")),
    imageLinks: all('a[href^="https://tracker.example/pixel"]').map((link) => link.textContent.trim()),
    showsMarkup: roots.some((root) => root.textContent.includes('<button class="ai-tutor__citation"')),
  };
}

const assertSavedAiInert = (report, where, { imageLink = true } = {}) => {
  assert.ok(report.roots > 0, `${where}: the saved AI text was not found`);
  assert.equal(report.images, 0, `${where}: saved AI text rendered an <img>`);
  assert.deepEqual(report.controls, [], `${where}: saved AI text rendered a control`);
  assert.deepEqual(report.appLinks, [], `${where}: saved AI text linked to the app's own host`);
  if (imageLink) assert.deepEqual(report.imageLinks, ["Image: Tracking pixel (tracker.example)"], `${where}: the remote image was not shown as a link`);
  assert.equal(report.showsMarkup, true, `${where}: model markup was not shown as text`);
};

const readProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readonly");
    const get = transaction.objectStore("study-data").get("profile");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  };
}));
// The profile is saved on a debounce: read it once the save of the last
// action has landed instead of sleeping a guessed time first (#138).
const savedProfile = (page, landed) => pollValue(() => readProfile(page), landed);

// Focuses the first `selector` control whose text includes `text` once earlier focus
// moves have settled, and confirms it still has focus a few frames later; otherwise a
// key pressed next can land on another control. Resolves to whether it held.
const focusAndHold = (page, selector, text) => page.waitForFunction(async (scope, label) => {
  const control = [...document.querySelectorAll(scope)].find((node) => node.textContent.includes(label));
  if (!control) return false;
  control.focus();
  for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
  return document.activeElement === control;
}, { timeout: 5_000, polling: 200 }, selector, text).then(() => true, () => false);

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

// #149: replaces the stored cards, attempts, mistakes and daily usage, as the #148
// block does, at the page's own clock and time zone, then reloads. Each card is a
// basic Part 05 card reviewed `reviewedAgoMs` ago and due in `dueInMs` (negative:
// overdue); Classic scheduling and the app badge are on, and `reviewCompletedToday`
// reviews are spent today. Resolves to today's usage key, built in the page as
// localDayKey builds it.
const seedRelearn = async (page, { cards, reviewSettings = {}, reviewCompletedToday = 0 }) => {
  const todayKey = await page.evaluate((seed) => new Promise((resolve, reject) => {
    const base = Date.now();
    const stamp = (offset) => new Date(base + offset).toISOString();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(base)).map((part) => [part.type, part.value]));
    const key = `${day.year}-${day.month}-${day.day}@${zone}`;
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const profile = get.result && typeof get.result === "object" ? get.result : {};
        profile.reviewItems = seed.cards.map(({ id, front, intervalDays, repetitions, reviewCount, lapses = 0, ease = 2.5, reviewedAgoMs, dueInMs }) => ({
          id, type: "basic", front, back: `The answer to ${id}.`, tags: [],
          documentId: "notes/part-05-supervised-learning/01-linear-regression.md",
          suspended: false, archived: false, buriedOnDay: "", intervalDays, ease, repetitions, reviewCount, lapses,
          lastReviewedAt: stamp(-reviewedAgoMs), dueAt: stamp(dueInMs), createdAt: stamp(-60 * 86_400_000), updatedAt: stamp(-reviewedAgoMs),
        }));
        profile.reviewAttempts = [];
        profile.mistakes = [];
        profile.settings = { ...profile.settings, dueBadgeEnabled: true };
        profile.reviewSettings = { ...profile.reviewSettings, scheduler: "sm2", ...seed.reviewSettings };
        // The fields of emptyReviewSession, with today's spent reviews.
        profile.reviewSessions = seed.reviewCompletedToday > 0
          ? [{ id: key, localDate: key.split("@")[0], timeZone: zone, newIntroduced: 0, reviewCompleted: seed.reviewCompletedToday, crunchCompleted: 0, reviewedItemIds: [], createdAt: stamp(0), updatedAt: stamp(0) }]
          : [];
        store.put(profile, "profile");
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onerror = () => reject(transaction.error);
    };
  }), { cards, reviewSettings, reviewCompletedToday });
  await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page", { timeout: 10_000 });
  return todayKey;
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  await clickByText(page, ".review-center-page button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const fields = await page.$$(".review-card-dialog textarea");
  assert.equal(fields.length, 2, "review dialog did not expose prompt and answer fields");
  await fields[0].type("Why does data leakage invalidate an offline evaluation?");
  await fields[1].type("It exposes information unavailable at inference time, so the measured metric overestimates production generalization.");
  await page.type(".review-card-dialog input", "evaluation, interview");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForSelector(".review-deck-card");
  assert.equal((await page.$eval(".review-deck-card .review-card-copy .review-markdown", (node) => node.textContent)).trim(), "Why does data leakage invalidate an offline evaluation?");
  assert.equal(await page.$eval(".review-hero strong", (node) => node.textContent), "1");

  // LEARN-002: an exact duplicate is rejected with a warning and no deck growth.
  await clickByText(page, ".review-title button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const duplicateFields = await page.$$(".review-card-dialog textarea");
  await duplicateFields[0].type("Why does data leakage invalidate an offline evaluation?");
  await duplicateFields[1].type("It exposes information unavailable at inference time, so the measured metric overestimates production generalization.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.toLowerCase().includes("already exist"), { timeout: 5_000 })
    .catch(() => assert.fail("duplicate card creation did not warn"));
  await page.$eval(".review-card-dialog button[aria-label='Close review card dialog']", (node) => node.click());
  await page.waitForFunction(() => !document.querySelector(".review-card-dialog"));
  assert.equal(await page.$eval(".review-hero strong", (node) => node.textContent), "1", "a duplicate card must not grow the deck");

  // Issue #54 (REV-5): Home's due widget and Review button use the same
  // actionable count as the review queue.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForSelector(".today-widgets");
  assert.equal(await page.$eval(".today-widget strong", (node) => node.textContent), "1", "Home's due widget must match the review queue");
  assert.ok((await page.$eval(".dashboard-method-actions .button.primary", (node) => node.textContent)).includes("Review 1 due"), "Home's Review button must match the review queue");
  await page.evaluate(() => { location.hash = "#/review"; });
  await page.waitForSelector(".review-hero");

  await clickByText(page, ".review-hero button", "Start review");
  await page.waitForSelector(".review-session-page");
  // Issue #54 (REV-6/REV-7): the progress bar starts empty with progressbar
  // semantics, and focus follows the prompt and then the revealed answer.
  await page.waitForFunction(() => document.activeElement?.classList.contains("review-question"), { timeout: 5_000 })
    .catch(() => assert.fail("starting a session must focus the card prompt"));
  assert.deepEqual(await page.$eval(".review-progress", (node) => [node.getAttribute("role"), node.getAttribute("aria-valuenow"), node.getAttribute("aria-valuemax"), node.querySelector("span").style.width]), ["progressbar", "0", "1", "0%"], "an ungraded session must show an empty progressbar");
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.waitForSelector(".review-answer");
  assert.ok((await page.$eval(".review-answer", (node) => node.textContent)).includes("overestimates production generalization"));
  await page.waitForFunction(() => document.activeElement?.classList.contains("review-answer"), { timeout: 5_000 })
    .catch(() => assert.fail("revealing must move focus to the answer"));
  // Issue #54 (REV-2): on an iPhone SE-sized screen every grade button stays
  // above the fixed bottom navigation without scrolling.
  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.waitForSelector(".toast", { hidden: true, timeout: 10_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const gradeReach = await page.evaluate(() => {
    const navTop = document.querySelector(".bottom-nav").getBoundingClientRect().top;
    return [...document.querySelectorAll(".review-rating")].map((button) => {
      const box = button.getBoundingClientRect();
      return box.bottom <= navTop && button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });
  });
  assert.deepEqual(gradeReach, [true, true, true, true], "grade buttons must be visible above the bottom navigation at 375x667");
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await clickByText(page, ".review-rating", "Good");
  try {
    await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  } catch (error) {
    console.error("Review state after grading:", await page.evaluate(() => document.body.innerText.slice(0, 4_000)), errors);
    throw error;
  }
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "0");
  assert.ok((await page.$eval(".review-center-page [role='status']", (node) => node.textContent)).includes("Rated Good: next review in 1 day"), "the grade outcome must be announced");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("1 day interval"), "Good rating did not schedule a one-day interval");
  assert.ok((await page.$eval(".review-stat-grid", (node) => node.textContent)).includes("100%"), "recall rate was not updated");
  // Issue #54 (REV-5): ending a crunch practice session returns the hero to
  // today's queue; it used to keep counting the weak-card practice pool.
  await clickByText(page, ".review-hero-actions button", "Crunch weak cards");
  await page.waitForFunction(() => document.querySelector(".review-session-header")?.textContent.includes("practice cards left"), { timeout: 5_000 });
  await clickByText(page, ".review-session-header button", "End session");
  await page.waitForSelector(".review-center-page");
  assert.equal(await page.$eval(".review-hero strong", (node) => node.textContent), "0", "after crunch practice the hero must count today's queue, not the practice pool");

  await clickByText(page, ".review-hero-actions button", "Undo last grade");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("New"), "undo did not restore the pre-grade schedule");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.$eval("button[aria-label=\"Confidence 4 of 5\"]", (node) => node.click());
  await clickByText(page, ".review-rating", "Good");
  await page.waitForSelector(".review-center-page");

  await page.$eval('button[aria-label="Edit review card"]', (node) => node.click());
  await page.waitForSelector(".review-card-dialog");
  await page.focus(".review-card-dialog textarea");
  // Place the caret at the end of the text: at the 16px phone field size the
  // prompt wraps, and End only reaches the end of the first visual line.
  await page.$eval(".review-card-dialog textarea", (node) => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.type(" [edited]");
  await clickByText(page, ".review-card-dialog button", "Save changes");
  await page.waitForSelector(".review-deck-card");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("[edited]"), "card edit was not saved");
  await page.$eval('button[aria-label="Archive review card"]', (node) => { node.focus(); node.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll(".review-deck-tools button")].some((node) => node.textContent.includes("Archived (1)")), { timeout: 5_000 });
  // Issue #54 (REV-7): the archived row's button is gone, so focus moves to
  // the deck heading (the list is now empty) and a toast confirms the change.
  await page.waitForFunction(() => document.activeElement === document.querySelector(".review-deck-heading h2"), { timeout: 5_000 })
    .catch(() => assert.fail("archiving the last card must move focus to the deck heading"));
  assert.ok((await page.$eval(".toast", (node) => node.textContent)).includes("Card archived"), "archiving must be confirmed");
  await clickByText(page, ".review-deck-tools button", "Archived (1)");
  await page.waitForSelector('button[aria-label="Restore review card"]');
  await page.$eval('button[aria-label="Restore review card"]', (node) => node.click());
  await clickByText(page, ".review-deck-tools button", "Show active");
  await page.waitForSelector(".review-deck-card");

  const stored = await savedProfile(page, (profile) => profile.reviewItems[0].front.endsWith("[edited]") && profile.reviewItems[0].archived === false);
  assert.equal(stored.version, 4);
  assert.equal(stored.reviewItems.length, 1);
  assert.equal(stored.reviewItems[0].repetitions, 1);
  assert.equal(stored.reviewAttempts.length, 1);
  assert.equal(stored.reviewAttempts[0].rating, "good");
  assert.equal(stored.reviewAttempts[0].confidence, 4);
  assert.equal(stored.reviewSessions.length, 1);
  assert.equal(stored.reviewSessions[0].newIntroduced, 1, "undo must reverse the first ledger increment before the re-grade");
  assert.ok(stored.reviewItems[0].front.endsWith("[edited]"));

  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".review-deck-card");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("1 day interval"), "scheduled card did not survive reload");

  // LEARN-005 mistake notebook: a failed recall logs a mistake, repeats merge,
  // the correction persists, and corrective review reschedules the card.
  await clickByText(page, ".review-title button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const mistakeFields = await page.$$(".review-card-dialog textarea");
  await mistakeFields[0].type("Which split tunes hyperparameters?");
  await mistakeFields[1].type("The validation split, never the test split.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await clickByText(page, ".review-rating", "Again");
  // Issue #149: failing the last card offers to retry it instead of ending the
  // session; ending it from there reaches the notebook.
  await page.waitForSelector(".review-retry", { timeout: 5_000 })
    .catch(() => assert.fail("failing the last card must offer to retry it"));
  assert.ok((await page.$eval("#review-retry-title", (node) => node.textContent)).startsWith("1 card to retry"), "the retry panel must name the one card to retry");
  await clickByText(page, ".review-retry button", "End session");
  await page.waitForSelector(".review-mistakes");
  assert.equal((await page.$$(".mistake-card")).length, 1, "an Again grade did not log exactly one mistake");
  const mistakeCopy = await page.$eval(".mistake-card", (node) => node.textContent);
  assert.ok(mistakeCopy.includes("Which split tunes hyperparameters?"), "the mistake did not capture the failed prompt");
  assert.ok(mistakeCopy.includes("Misconception"), "the mistake category chip is missing");

  await page.type(".mistake-card textarea", "Only validation data may steer choices; the test split stays untouched.");
  // The field commits on blur so per-keystroke profile writes cannot drop keys.
  await page.$eval(".mistake-card textarea", (node) => node.blur());
  const withMistake = await savedProfile(page, (profile) => profile.mistakes[0].correction.includes("stays untouched"));
  assert.equal(withMistake.mistakes.length, 1);
  assert.equal(withMistake.mistakes[0].occurrences, 1);
  assert.ok(withMistake.mistakes[0].correction.includes("stays untouched"), "the correction was not persisted");
  // Issue #54 (REV-19): a correction still being typed is committed when the
  // page is hidden, before the app's pagehide flush saves the profile.
  await page.focus(".mistake-card textarea");
  await page.keyboard.type("Test data is for the final report only. ");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  {
    const deadline = Date.now() + 5_000;
    let saved = "";
    while (Date.now() < deadline && !saved.includes("final report only")) {
      saved = (await readProfile(page)).mistakes[0]?.correction || "";
      if (!saved.includes("final report only")) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(saved.includes("final report only"), "an unblurred correction must be saved when the page is hidden");
  }
  await page.$eval(".mistake-card textarea", (node) => node.blur());
  assert.equal(withMistake.mistakes[0].reviewItemId, withMistake.reviewItems.find((item) => item.front.startsWith("Which split")).id, "the mistake lost its card link");

  // The lapsed card sits in a short relearning delay; corrective scheduling
  // must make it due immediately.
  await clickByText(page, ".mistake-card button", "Schedule corrective review");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await clickByText(page, ".review-rating", "Again");
  await page.waitForSelector(".review-retry", { timeout: 5_000 })
    .catch(() => assert.fail("failing the corrective card, the last one, must offer to retry it"));
  assert.ok((await page.$eval("#review-retry-title", (node) => node.textContent)).startsWith("1 card to retry"), "the retry panel must name the one card to retry");
  await clickByText(page, ".review-retry button", "End session");
  await page.waitForSelector(".review-mistakes");
  await page.waitForFunction(() => document.querySelector(".mistake-card")?.textContent.includes("×2"), { timeout: 5_000 });
  assert.equal((await page.$$(".mistake-card")).length, 1, "a repeated failure duplicated the mistake instead of merging");

  // Corrective scheduling for an UNLINKED mistake must create a new tagged
  // card and back-link it (the delete leaves the mistake without its card).
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".review-deck-card")];
    const target = cards.find((card) => card.textContent.includes("Which split tunes hyperparameters?"));
    target?.querySelector('button[aria-label="Delete review card"]')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".review-deck-card")].some((card) => card.textContent.includes("Which split tunes hyperparameters?")), { timeout: 5_000 });
  await clickByText(page, ".mistake-card button", "Schedule corrective review");
  await page.waitForFunction(() => [...document.querySelectorAll(".review-deck-card")].some((card) => card.textContent.includes("Which split tunes hyperparameters?")), { timeout: 5_000 })
    .catch(() => assert.fail("an unlinked mistake did not create a corrective card"));
  // Wait for the new card itself: the stored profile from before the delete
  // also has a card with this prompt, linked to the mistake.
  const relinked = await savedProfile(page, (profile) => profile.reviewItems.some((item) => item.front === "Which split tunes hyperparameters?" && item.tags.includes("mistake")));
  const correctiveCard = relinked.reviewItems.find((item) => item.front === "Which split tunes hyperparameters?");
  assert.ok(correctiveCard.tags.includes("mistake"), "the corrective card must carry the mistake tag");
  assert.equal(relinked.mistakes[0].reviewItemId, correctiveCard.id, "the mistake must back-link to its new corrective card");

  await clickByText(page, ".mistake-card button", "Mark corrected");
  await page.waitForFunction(() => !document.querySelector(".mistake-card"), { timeout: 5_000 });
  await page.$eval(".mistake-corrected-toggle input", (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".mistake-card")?.textContent.includes("Corrected"), { timeout: 5_000 });
  const categoryFilter = await page.$(".mistake-controls select");
  await categoryFilter.select("code");
  await page.waitForFunction(() => !document.querySelector(".mistake-card"), { timeout: 5_000 });
  await categoryFilter.select("misconception");
  await page.waitForFunction(() => Boolean(document.querySelector(".mistake-card")), { timeout: 5_000 });
  await categoryFilter.select("all");
  await page.$eval(".mistake-corrected-toggle input", (node) => node.click());

  // Manual capture: the Log-mistake dialog records a categorized entry, and
  // repeating the same prompt merges instead of duplicating.
  // The closed phone drawer is inert (React's prop), and the App dialogs used
  // above (the card editor) must have left it that way.
  assert.equal(await page.$eval(".app-sidebar", (node) => node.inert), true, "an earlier dialog re-exposed the closed phone drawer");
  await page.$$eval(".review-mistakes button", (nodes) => { const opener = nodes.find((node) => node.textContent.includes("Log mistake")); opener?.focus(); opener?.click(); });
  await page.waitForSelector(".mistake-dialog");
  // Issue #54 (REV-8): the dialog renders outside the view and makes the app
  // shell inert while open.
  assert.deepEqual(await page.evaluate(() => [document.querySelector(".mistake-dialog").closest(".view-container") === null, ...[".app-topbar", ".view-container", ".bottom-nav"].map((selector) => document.querySelector(selector).inert)]), [true, true, true, true], "the mistake dialog must inert the background it covers");
  // The dialog shares the App's modal flag: the shortcut sheet opened over it
  // and closed again must not re-expose the shell behind the mistake dialog.
  // The sheet on top owns the keyboard: Tab stays in it, and Escape closes
  // only the sheet, keeping the mistake draft.
  await page.$eval(".mistake-dialog .modal-actions .button.ghost", (node) => node.focus());
  await page.keyboard.press("?");
  await page.waitForSelector(".shortcuts-dialog", { timeout: 5_000 });
  await page.waitForFunction(() => document.activeElement?.closest(".shortcuts-dialog"), { timeout: 5_000 })
    .catch(() => assert.fail("the shortcut sheet did not take focus over the mistake dialog"));
  await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest(".shortcuts-dialog"))), "Tab in the shortcut sheet moved focus to the mistake dialog behind it");
  await page.keyboard.press("Escape");
  // Moving focus right after the sheet closes must stick: the sheet's deferred
  // restore may only reclaim focus that was lost, never a field in use.
  assert.ok(await page.evaluate(async () => {
    document.querySelector(".mistake-dialog textarea")?.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return document.activeElement === document.querySelector(".mistake-dialog textarea");
  }), "closing the shortcut sheet pulled focus away from the field the learner moved to");
  await page.waitForSelector(".shortcuts-dialog", { hidden: true, timeout: 5_000 });
  assert.deepEqual(await page.evaluate(() => [Boolean(document.querySelector(".mistake-dialog")), ...[".app-topbar", ".view-container", ".bottom-nav"].map((selector) => document.querySelector(selector).inert)]), [true, true, true, true], "Escape in a dialog opened over the mistake dialog closed it too or re-exposed the shell behind it");
  const manualFields = await page.$$(".mistake-dialog textarea");
  await manualFields[0].type("Wrote the softmax gradient with the wrong sign");
  await manualFields[1].type("The Jacobian diagonal is p_i(1 - p_i); off-diagonals are -p_i p_j.");
  await page.select(".mistake-dialog select", "formula");
  // A background app update must not reinitialize the learner's open draft.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForSelector(".offline-dot");
  assert.equal(await manualFields[0].evaluate((node) => node.value), "Wrote the softmax gradient with the wrong sign", "a background update reset the mistake prompt");
  assert.equal(await manualFields[1].evaluate((node) => node.value), "The Jacobian diagonal is p_i(1 - p_i); off-diagonals are -p_i p_j.", "a background update reset the expected answer");
  assert.equal(await page.$eval(".mistake-dialog select", (node) => node.value), "formula", "a background update reset the mistake category");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await clickByText(page, ".mistake-dialog button", "Log mistake");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient") && card.textContent.includes("Formula")), { timeout: 5_000 });
  await page.waitForFunction(() => !document.querySelector(".mistake-dialog"));
  assert.deepEqual(await page.evaluate(() => [".app-sidebar", ".app-topbar", ".view-container", ".bottom-nav"].map((selector) => document.querySelector(selector).inert)), [true, false, false, false], "closing the dialog must restore the shell and keep the closed phone drawer inert");
  await page.waitForFunction(() => document.activeElement?.closest(".review-mistakes") && document.activeElement.textContent.includes("Log mistake"), { timeout: 5_000 })
    .catch(() => assert.fail("closing the mistake dialog must return focus to Log mistake"));
  await clickByText(page, ".review-mistakes button", "Log mistake");
  await page.waitForSelector(".mistake-dialog");
  const repeatFields = await page.$$(".mistake-dialog textarea");
  await repeatFields[0].type("Wrote the softmax gradient with the wrong sign");
  await repeatFields[1].type("Different expected text, same failure.");
  await page.select(".mistake-dialog select", "formula");
  await clickByText(page, ".mistake-dialog button", "Log mistake");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient") && card.textContent.includes("×2")), { timeout: 5_000 })
    .catch(() => assert.fail("a repeated manual mistake did not merge"));

  // LEARN-005: the notebook exports to Markdown with category and occurrences.
  await clickByText(page, ".mistake-controls button", "Export");
  {
    let exportPath = "";
    const exportDeadline = Date.now() + 10_000;
    while (Date.now() < exportDeadline && !exportPath) {
      const files = await readdir(downloadDirectory);
      const name = files.find((file) => file.startsWith("lumen-mistakes-") && file.endsWith(".md"));
      if (name) exportPath = join(downloadDirectory, name);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(exportPath, "the mistakes Markdown export was not downloaded");
    const exported = await readFile(exportPath, "utf8");
    assert.match(exported, /# Mistake notebook/);
    assert.ok(exported.includes("softmax gradient") && exported.includes("Category: Formula") && exported.includes("×2"), "the export is missing the merged mistake's details");
  }
  const deleteSoftmaxMistake = async () => {
    await page.evaluate(() => {
      const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("softmax gradient"));
      card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
    });
    await page.waitForFunction(() => ![...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient")), { timeout: 5_000 });
  };
  const softmaxSlot = await page.$$eval(".mistake-list > *", (nodes) => nodes.findIndex((node) => node.textContent.includes("softmax gradient")));
  await deleteSoftmaxMistake();
  // Issue #54 (REV-11): a deleted mistake offers a focused Undo that restores
  // the same merged entry.
  await page.waitForFunction(() => document.activeElement?.closest(".undo-strip") && document.activeElement.textContent.includes("Undo"), { timeout: 5_000 })
    .catch(() => assert.fail("deleting a mistake must focus an Undo control"));
  // The strip takes the deleted entry's place in the list and scrolls on
  // screen (smoothly), not at the top of the notebook out of sight.
  assert.deepEqual(await page.evaluate(() => {
    const strip = document.querySelector(".undo-strip");
    return [[...strip.parentElement.children].indexOf(strip), strip.parentElement.classList.contains("mistake-list")];
  }), [softmaxSlot, true], "the mistake Undo strip must take the deleted entry's place");
  await page.waitForFunction(() => {
    const box = document.querySelector(".undo-strip")?.getBoundingClientRect();
    const top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
    const nav = document.querySelector(".bottom-nav");
    const bottom = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : innerHeight;
    return box && box.top >= top && box.bottom <= bottom;
  }, { timeout: 5_000 }).catch(() => assert.fail("the mistake Undo strip must scroll into view, clear of the top bar and bottom navigation"));
  // The strip must not expire while Undo holds focus, even after the pointer
  // passes over it and leaves (hover and focus pause it independently).
  await page.$eval(".undo-strip", (node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
  const stripCenter = await page.$eval(".undo-strip > span", (node) => {
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, hit: Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".undo-strip")) };
  });
  assert.ok(stripCenter.hit, "the Undo strip must be uncovered for the hover check");
  await page.mouse.move(stripCenter.x, stripCenter.y, { steps: 4 });
  await page.mouse.move(2, 2, { steps: 4 });
  await new Promise((resolve) => setTimeout(resolve, 10_600));
  assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest(".undo-strip"))), "a focused Undo strip expired after the pointer left it, dropping focus");
  await clickByText(page, ".undo-strip button", "Undo");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient") && card.textContent.includes("×2")), { timeout: 5_000 })
    .catch(() => assert.fail("Undo did not restore the deleted mistake"));
  await deleteSoftmaxMistake();

  // INTERVIEW-002 slice: a timed interview round runs prep → answer → reveal,
  // and a missed question lands in the mistake notebook under Interview.
  await clickByText(page, ".review-hero-actions button", "Interview round");
  await page.waitForSelector(".interview-round .interview-timer", { timeout: 5_000 });
  const roundTotal = Number((await page.$eval(".interview-round .review-session-header strong", (node) => node.textContent)).split("/")[1]);
  assert.ok(roundTotal >= 1, "the interview round must include the interview-tagged card");
  assert.match(await page.$eval(".interview-round .interview-timer", (node) => node.textContent), /0:(30|29|28)/, "the prep countdown must start near 30 seconds");
  assert.ok((await page.$eval(".interview-round .eyebrow", (node) => node.textContent)).includes("Structure your answer"), "the prep phase must coach structuring first");
  for (let question = 0; question < roundTotal; question += 1) {
    await clickByText(page, ".interview-round button", "Start answering");
    await page.waitForFunction(() => document.querySelector(".interview-round .eyebrow")?.textContent.includes("interviewer is listening"), { timeout: 5_000 });
    await clickByText(page, ".interview-round button", "Show expected answer");
    await page.waitForSelector(".interview-round .review-answer", { timeout: 5_000 });
    await clickByText(page, ".interview-round button", question === 0 ? "Missed it" : "Answered well");
  }
  await page.waitForFunction(() => document.querySelector(".interview-summary"), { timeout: 5_000 });
  assert.equal(await page.$eval(".interview-round .review-session-header strong", (node) => node.textContent), `${roundTotal - 1}/${roundTotal}`, "the summary must count the miss");
  assert.ok((await page.$eval(".interview-summary h3", (node) => node.textContent)).includes("1 miss"), "the summary must state the miss was logged");
  await clickByText(page, ".interview-round button", "Back to review center");
  await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("data leakage") && card.textContent.includes("Interview")), { timeout: 5_000 })
    .catch(() => assert.fail("an interview miss did not create an Interview-category mistake"));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("data leakage") && node.textContent.includes("Interview"));
    card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("data leakage") && card.textContent.includes("Interview")), { timeout: 5_000 });

  // Clean up the second card so the original deck assertions stay untouched.
  await page.waitForSelector(".review-deck-card");
  const deleteButtons = await page.$$('button[aria-label="Delete review card"]');
  assert.ok(deleteButtons.length >= 1, "delete control missing for cleanup");
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".review-deck-card")];
    const target = cards.find((card) => card.textContent.includes("Which split tunes hyperparameters?"));
    target?.querySelector('button[aria-label="Delete review card"]')?.click();
  });

  // Issue #54 (REV-1/REV-9): a lumen.cards.v1 deck imports through a real,
  // keyboard-operable Import button, reports its counts, and never throws.
  const deckCount = async () => Number((await page.$eval(".review-deck-heading h2", (node) => node.textContent)).match(/^(\d+)/)?.[1]);
  await page.waitForFunction(() => ![...document.querySelectorAll(".review-deck-card")].some((card) => card.textContent.includes("Which split tunes hyperparameters?")), { timeout: 5_000 });
  // Deleting hands focus to the next row a frame later (REV-7). Wait for it,
  // or it can land between focusing Import and pressing Enter below.
  await page.waitForFunction(() => document.activeElement?.closest(".review-card-actions") || document.activeElement === document.querySelector(".review-deck-heading h2"), { timeout: 5_000 })
    .catch(() => assert.fail("deleting a card must move focus to the next row or the deck heading"));
  const cardsBefore = await deckCount();
  const deckFile = join(fixtureDirectory, "import-deck.json");
  await writeFile(deckFile, JSON.stringify({ format: "lumen.cards.v1", exportedAt: new Date().toISOString(), cards: [
    { type: "basic", front: "Imported: what does dropout do during training?", back: "It randomly zeroes activations so units cannot co-adapt.", tags: ["imported"] },
    { type: "cloze", front: "Imported: early stopping halts training when {{validation loss}} stops improving.", back: "validation loss", tags: ["imported"] },
  ] }));
  // Focus Import only once earlier focus moves (the delete's row handoff, an
  // Undo strip taking focus) have settled, and confirm it is still there a
  // few frames later; otherwise Enter can land on another control.
  const importFocused = await page.waitForFunction(async () => {
    const button = [...document.querySelectorAll(".review-deck-tools button")].find((node) => node.textContent.trim() === "Import");
    if (!button) return false;
    button.focus();
    for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    return document.activeElement === button;
  }, { timeout: 5_000, polling: 200 }).then(() => true, () => false);
  assert.ok(importFocused, "the deck Import control must be a focusable button that keeps focus");
  // Keyboard operability is the app's job: Enter on Import must open the
  // picker, i.e. click the hidden file input. The native chooser that Chrome
  // then shows is not the app's, and headless Linux CI intermittently never
  // reported it, so the audit supplies the file through the input directly.
  await page.evaluate(() => {
    const input = document.querySelector('.review-deck-heading input[type="file"]');
    window.__deckImportPicked = false;
    input?.addEventListener("click", (event) => { window.__deckImportPicked = true; event.preventDefault(); }, { once: true });
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__deckImportPicked, { timeout: 5_000 })
    .catch(async () => assert.fail(`Enter on the deck Import button did not open the file picker (focus: ${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)})`));
  const deckInput = await page.$('.review-deck-heading input[type="file"]');
  await deckInput.uploadFile(deckFile);
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 cards imported"), { timeout: 5_000 })
    .catch(() => assert.fail("importing a card deck did not confirm the imported count"));
  await page.waitForFunction((expected) => Number(document.querySelector(".review-deck-heading h2")?.textContent.match(/^(\d+)/)?.[1]) === expected, { timeout: 5_000 }, cardsBefore + 2)
    .catch(() => assert.fail("imported cards did not appear in the deck"));
  const importDeck = (json) => page.$eval('.review-deck-tools input[type="file"]', (input, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "deck.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, json);
  await importDeck(await readFile(deckFile, "utf8"));
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("already in your deck"), { timeout: 5_000 })
    .catch(() => assert.fail("re-importing the same deck did not report the duplicates"));
  await importDeck("{ not json");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Import failed"), { timeout: 5_000 })
    .catch(() => assert.fail("a malformed card file did not surface an import error"));
  assert.equal(await deckCount(), cardsBefore + 2, "duplicate and malformed imports must not grow the deck");
  const imported = (await savedProfile(page, (profile) => profile.reviewItems.filter((item) => item.front.startsWith("Imported:")).length === 2)).reviewItems.filter((item) => item.front.startsWith("Imported:"));
  assert.equal(imported.length, 2, "both imported cards must persist");
  assert.ok(imported.every((item) => item.reviewCount === 0 && item.tags.includes("imported")), "imported cards start fresh and keep their tags");

  // Issue #54 (REV-22): at phone width every Daily limits picker keeps its
  // one-word label on one line and a usable select, in both schedulers.
  const assertLimitsStripReadable = async (mode) => {
    const pickers = await page.$$eval(".review-settings-strip label", (labels) => labels.map((label) => {
      const text = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(text);
      return { name: text.textContent.trim(), lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, select: Math.round(label.querySelector("select").getBoundingClientRect().width) };
    }));
    assert.ok(pickers.length >= 3 && pickers.every((picker) => picker.lines === 1 && picker.select >= 60), `the ${mode} Daily limits strip collapsed at phone width: ${JSON.stringify(pickers)}`);
  };
  await assertLimitsStripReadable("classic");

  // Issue #16: enabling the Adaptive (FSRS) scheduler migrates existing
  // cards once (history replay or SM-2 seed) and grades store FSRS state.
  await page.select('select[aria-label="Scheduling algorithm"]', "fsrs");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Adaptive scheduling enabled"), { timeout: 5_000 })
    .catch(() => assert.fail("enabling FSRS did not confirm the calibration"));
  await page.waitForSelector('select[aria-label="Target retention"]', { timeout: 5_000 });
  await assertLimitsStripReadable("FSRS");
  const fsrsProfile = await savedProfile(page, (profile) => profile.reviewSettings.scheduler === "fsrs" && profile.reviewItems.some((item) => item.reviewCount > 0 && item.stability > 0));
  assert.equal(fsrsProfile.reviewSettings.scheduler, "fsrs");
  const seasoned = fsrsProfile.reviewItems.find((item) => item.reviewCount > 0);
  assert.ok(seasoned, "a reviewed card must exist for the migration check");
  assert.ok(seasoned.stability > 0 && seasoned.fsrsState !== "", `migration must seed reviewed cards (stability ${seasoned.stability}, state ${seasoned.fsrsState})`);
  // Issue #148: the notice must say the same under FSRS, so no Classic-only promise comes back.
  await clickByText(page, ".review-hero-actions button", "Crunch weak cards");
  await page.waitForSelector(".review-session-page .review-crunch-notice", { timeout: 5_000 });
  assert.equal(await page.$eval(".review-crunch-notice", (node) => node.textContent.trim()), "Extra practice doesn’t use today’s limits. Your answers still reschedule cards: the rating buttons show when each card comes back.", "under FSRS the Extra practice notice must say that answers still reschedule cards");
  await clickByText(page, ".review-session-header button", "End session");
  await page.waitForSelector(".review-center-page");
  // Issue #16: the workload planner shows steady-state daily reviews per
  // retention choice, monotone in retention, and switches the setting.
  await page.waitForSelector(".review-workload-strip", { timeout: 5_000 });
  const workloads = await page.$$eval(".review-workload-options button span", (nodes) => nodes.map((node) => Number(node.textContent.match(/~([\d.]+)\//)?.[1])));
  assert.equal(workloads.length, 4, "four retention choices must render");
  for (let index = 1; index < workloads.length; index += 1) {
    assert.ok(workloads[index] >= workloads[index - 1], `workload must not fall as retention rises (${workloads.join(", ")})`);
  }
  await clickByText(page, ".review-workload-options button", "95%");
  await page.waitForFunction(() => document.querySelector('select[aria-label="Target retention"]')?.value === "0.95", { timeout: 5_000 })
    .catch(() => assert.fail("choosing a planner option did not update the retention setting"));
  await page.select('select[aria-label="Target retention"]', "0.9");

  // Issue #16: calibration refuses honestly on a thin history instead of
  // overfitting a handful of grades (successful fits are unit-tested). The
  // refusal waits on the optimizer's lazily loaded chunk; if it does not
  // come, say what the page shows (#138: a server-written 400 once failed
  // that chunk and chunk recovery reloaded the page under the audit).
  const documentBeforeCalibrate = await page.evaluate(() => performance.timeOrigin);
  await clickByText(page, ".review-calibrate button", "Calibrate from my history");
  const refused = await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Calibration needs at least 50 spaced reviews"), { timeout: 10_000 }).then(() => true, () => false);
  if (!refused) {
    const shown = await page.evaluate((before) => ({
      toast: document.querySelector(".toast")?.textContent || null,
      reloaded: performance.timeOrigin !== before,
      chunkRecovery: sessionStorage.getItem("lumen:chunk-recovery-v1"),
      visibility: document.visibilityState,
    }), documentBeforeCalibrate).catch((error) => ({ unreadable: error.message }));
    assert.fail(`thin-history calibration did not refuse with the typed reason: ${JSON.stringify({ ...shown, load: loadavg()[0].toFixed(1) })}`);
  }
  await page.select('select[aria-label="Scheduling algorithm"]', "sm2");
  await page.waitForFunction(() => document.querySelector('select[aria-label="Scheduling algorithm"]')?.value === "sm2" && !document.querySelector('select[aria-label="Target retention"]'), { timeout: 10_000 });

  // Issue #10: an authored track round runs through the interview timers,
  // and a worksheet lab check logs a miss into the notebook.
  await page.waitForSelector(".interview-track-strip", { timeout: 10_000 });
  await page.select('select[aria-label="Interview track"]', "mle");
  await clickByText(page, ".interview-track-strip button", "Start track round");
  await page.waitForSelector(".interview-round .interview-timer", { timeout: 5_000 });
  const trackQuestion = await page.$eval(".interview-round .review-question", (node) => node.textContent);
  assert.ok(trackQuestion.length > 40, "the track round must render an authored question");
  await clickByText(page, ".interview-round button", "Start answering");
  await clickByText(page, ".interview-round button", "Show expected answer");
  await page.waitForFunction(() => document.querySelector(".interview-round .review-answer")?.textContent.includes("Rubric"), { timeout: 5_000 })
    .catch(() => assert.fail("the revealed track answer did not include its rubric"));
  await clickByText(page, ".interview-round button", "End round");
  await page.waitForSelector(".review-center-page");

  await page.waitForSelector(".lab-strip .lab-tile", { timeout: 10_000 });
  await page.$eval(".lab-strip .lab-tile", (node) => node.click());
  await page.waitForSelector(".lab-bench .lab-task", { timeout: 5_000 });
  await page.type(".lab-task input", "definitely-wrong-answer");
  await clickByText(page, ".lab-task button", "Check answer");
  await page.waitForFunction(() => document.querySelector(".lab-outcome.is-incorrect")?.textContent.includes("mistake notebook"), { timeout: 5_000 })
    .catch(() => assert.fail("a wrong lab check did not report the notebook capture"));
  await clickByText(page, ".review-session-header button", "Exit lab");
  await page.waitForSelector(".review-center-page");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("Code")), { timeout: 5_000 })
    .catch(() => assert.fail("the lab miss did not land as a code-category mistake"));
  // The next step leaves the page and edits the stored profile directly, so
  // the miss is stored, deleted, and the deletion stored before it does.
  const isCodeMiss = (mistake) => mistake.category === "code";
  assert.ok((await savedProfile(page, (profile) => profile.mistakes.some(isCodeMiss))).mistakes.some(isCodeMiss), "the lab miss was not stored");
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("Code"));
    card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
  });
  assert.ok(!(await savedProfile(page, (profile) => !profile.mistakes.some(isCodeMiss))).mistakes.some(isCodeMiss), "deleting the lab miss was not stored");

  // Issue #54 (REV-19/REV-11): burst typing into a clipping note keeps every
  // character with several clippings, and a deleted clipping can be undone.
  await page.goto(`${baseUrl}manifest.webmanifest`, { waitUntil: "load" });
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const profile = get.result;
        const stamp = new Date().toISOString();
        profile.clippings = [1, 2].map((index) => ({ id: `audit-clip-${index}`, documentId: "notes/part-01-foundations/01-ai-ml-mental-model.md", text: `Audit clipping ${index}: attention weighs every token against every other token.`, note: "", createdAt: stamp, updatedAt: stamp }));
        // Three cloze cards give Part 07 an all-cloze readiness check.
        profile.reviewItems = [...profile.reviewItems, ...["chain rule", "learning rate", "batch normalization"].map((answer, index) => ({
          id: `audit-cloze-${index}`, type: "cloze", front: `Deep learning fact ${index}: the {{${answer}}} matters.`, back: answer,
          documentId: "notes/part-07-deep-learning/01-neural-networks-and-backprop.md", tags: [], suspended: false, archived: false, buriedOnDay: "",
          dueAt: stamp, intervalDays: 1, ease: 2.5, repetitions: 1, reviewCount: 1, lapses: 0, createdAt: stamp, updatedAt: stamp, lastReviewedAt: stamp,
        }))];
        store.put(profile, "profile");
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.goto(`${baseUrl}#/notebook`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector('.clipping-card[data-clipping-id="audit-clip-1"] textarea');
  const burst = "Attention cost grows quadratically with sequence length, which is why long contexts need tricks.";
  await page.focus('.clipping-card[data-clipping-id="audit-clip-1"] textarea');
  await page.keyboard.type(burst, { delay: 0 });
  assert.equal(await page.$eval('.clipping-card[data-clipping-id="audit-clip-1"] textarea', (node) => node.value), burst, "burst typing dropped characters from the clipping note");
  await page.$eval('.clipping-card[data-clipping-id="audit-clip-1"] textarea', (node) => node.blur());
  assert.equal((await savedProfile(page, (profile) => profile.clippings.find((clip) => clip.id === "audit-clip-1").note === burst)).clippings.find((clip) => clip.id === "audit-clip-1")?.note, burst, "the clipping note must persist in full");
  await page.$eval('.clipping-card[data-clipping-id="audit-clip-1"] button[aria-label="Delete clipping"]', (node) => node.click());
  await page.waitForFunction(() => !document.querySelector('.clipping-card[data-clipping-id="audit-clip-1"]') && document.querySelector(".undo-strip"), { timeout: 5_000 });
  assert.ok(await page.evaluate(() => document.querySelector(".clipping-grid")?.firstElementChild?.classList.contains("undo-strip")), "the clipping Undo strip must take the deleted card's place");
  await clickByText(page, ".undo-strip button", "Undo");
  await page.waitForSelector('.clipping-card[data-clipping-id="audit-clip-1"]', { timeout: 5_000 });
  const restoredClippings = (await savedProfile(page, (profile) => profile.clippings.length === 2)).clippings;
  assert.deepEqual(restoredClippings.map((clip) => clip.id), ["audit-clip-1", "audit-clip-2"], "Undo must restore the clipping in its original place");
  assert.equal(restoredClippings[0].note, burst, "the restored clipping keeps its note");

  // Issue #54 (REV-15): Enter in a cloze blank submits the answer and the
  // next question takes focus; closing mid-check asks before discarding.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForSelector(".mastery-grid");
  await page.evaluate(() => [...document.querySelectorAll(".mastery-row")].find((node) => node.querySelector(".mastery-part")?.textContent === "07")?.querySelector(".mastery-check")?.click());
  await page.waitForSelector(".assessment-dialog", { timeout: 5_000 });
  await clickByText(page, ".assessment-dialog button", "Start");
  await page.waitForSelector(".assessment-cloze input", { timeout: 5_000 });
  await page.focus(".assessment-cloze input");
  await page.keyboard.type("chain rule");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "assessment-title" && document.activeElement.textContent.includes("Question 2 of 3"), { timeout: 5_000 })
    .catch(() => assert.fail("Enter in a cloze blank must submit and focus the next question"));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".assessment-leave", { timeout: 5_000 });
  await clickByText(page, ".assessment-leave button", "Leave and discard");
  await page.waitForFunction(() => !document.querySelector(".assessment-dialog"), { timeout: 5_000 });

  await page.evaluate(() => { location.hash = "#/review"; });
  await page.waitForSelector(".review-center-page");

  // Exercise the maximum persisted deck size. The center must keep the DOM
  // bounded on an iPhone instead of rendering 10,000 Markdown cards at once.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const profile = get.result;
        const template = profile.reviewItems[0];
        profile.reviewItems = Array.from({ length: 10_000 }, (_, index) => ({
          ...template,
          id: `scale-review-${String(index).padStart(5, "0")}`,
          front: `Scale prompt ${index}`,
          back: `Scale answer ${index}`,
        }));
        store.put(profile, "profile");
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 24 && document.querySelector(".review-deck-heading h2")?.textContent.includes("10000 active"));
  assert.equal(await page.$$eval(".review-deck-card", (nodes) => nodes.length), 24, "large deck page must render only the bounded page size");
  assert.equal((await page.$eval(".review-deck-card .review-card-copy", (node) => node.textContent)).trim().startsWith("Scale prompt 0"), true);
  assert.equal((await page.$eval(".review-deck-pagination", (node) => node.getAttribute("aria-label"))), "Review card pages");
  const touchSize = await page.$eval('button[aria-label="Next review card page"]', (button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  assert.ok(touchSize.width >= 44 && touchSize.height >= 44, `pagination touch target is ${touchSize.width}×${touchSize.height}`);
  await page.$eval("button[aria-label=\"Next review card page\"]", (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".review-deck-pagination")?.textContent.includes("Page 2 of 417"));
  assert.equal((await page.$eval(".review-deck-card .review-card-copy", (node) => node.textContent)).trim().startsWith("Scale prompt 24"), true);
  await page.$eval("button[aria-label=\"Last review card page\"]", (node) => node.click());
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 16 && document.querySelector(".review-deck-pagination")?.textContent.includes("Page 417 of 417"));

  const search = await page.$('.review-deck-tools input[aria-label="Search review cards"]');
  await search.type("Scale prompt 9999");
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 1 && document.querySelector(".review-deck-range")?.textContent.includes("1–1 of 1"));
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("Scale prompt 9999"), "search must reset a large deck to its matching first page");

  // Issue #81: saved AI output renders as untrusted text. A fresh context
  // seeds an AI flashcard, a card made from an AI clipping before the
  // ai-draft tag existed, that clipping, and a learner card. Any request to
  // the tracking host a model image points at is recorded and refused.
  const savedAiContext = await browser.createBrowserContext();
  try {
    const aiPage = await savedAiContext.newPage();
    await aiPage.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    aiPage.on("pageerror", (error) => errors.push(error.message));
    const trackerRequests = [];
    await aiPage.setRequestInterception(true);
    aiPage.on("request", (request) => {
      if (new URL(request.url()).hostname === "tracker.example") {
        trackerRequests.push(request.url());
        void request.abort();
        return;
      }
      void request.continue();
    });
    await aiPage.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
    await aiPage.waitForSelector(".review-center-page");
    const appOrigin = new URL(baseUrl).origin;
    const hostile = (label) => [
      `${label} <button class="ai-tutor__citation" type="button" data-ai-citation="S1">Open the forged source</button>`,
      "",
      '<img src="https://tracker.example/raw.png" onerror="window.__lumenSavedAiXss = true">',
      "",
      "![Tracking pixel](https://tracker.example/pixel.png?q=saved-prompt)",
      "",
      `[Open the app copy](${appOrigin}/#/read/notes/part-02-mathematics/06-experiments-and-information.md)`,
    ].join("\n");
    await aiPage.evaluate(({ flashcardBack, savedAnswer }) => new Promise((resolve, reject) => {
      const request = indexedDB.open("lumen-ai-notes", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("study-data", "readwrite");
        const store = transaction.objectStore("study-data");
        const get = store.get("profile");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const profile = get.result && typeof get.result === "object" ? get.result : {};
          const now = new Date().toISOString();
          profile.clippings = [{ id: "audit-ai-clip", documentId: "", origin: "ai-tutor", title: "AI tutor answer", text: savedAnswer, note: "AI-generated draft saved from the tutor.", createdAt: now, updatedAt: now }];
          const card = (id, front, back, extra) => ({ id, type: "basic", front, back, tags: [], dueAt: now, createdAt: now, updatedAt: now, ...extra });
          profile.reviewItems = [
            card("audit-ai-flashcard", "AI flashcard: which control is real?", flashcardBack, { tags: ["ai-draft", "interview"] }),
            card("audit-legacy-card", "Explain this saved answer.", savedAnswer, { sourceClippingId: "audit-ai-clip" }),
            card("audit-learner-card", "Learner card: press <kbd>Ctrl</kbd>", "My own answer."),
          ];
          profile.reviewAttempts = [];
          store.put(profile, "profile");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    }), { flashcardBack: hostile("Flashcard answer."), savedAnswer: hostile("Saved answer.") });
    await aiPage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await aiPage.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 3, { timeout: 10_000 });

    const deckCard = (id) => aiPage.$$eval(`.review-deck-card[data-card-id="${id}"] .review-markdown`, savedAiReport);
    assertSavedAiInert(await deckCard("audit-ai-flashcard"), "AI flashcard in the deck");
    assertSavedAiInert(await deckCard("audit-legacy-card"), "card from an AI clipping in the deck");
    // The pre-#81 card gains ai-draft when the profile loads, so its
    // provenance no longer depends on the clipping still existing.
    assert.deepEqual(await aiPage.$$eval('.review-deck-card[data-card-id="audit-legacy-card"] .review-tags span', (tags) => tags.map((tag) => tag.textContent)), ["ai-draft"], "a card made from an AI clipping did not gain ai-draft on load");
    assert.ok(await aiPage.$('.review-deck-card[data-card-id="audit-learner-card"] .review-markdown kbd'), "a learner card lost the Reader renderer's author HTML");

    // Every card in a session: the prompt and the revealed answer.
    await clickByText(aiPage, ".review-hero button", "Start review");
    for (let index = 0; index < 3; index += 1) {
      await aiPage.waitForSelector(".review-session-page .review-question");
      await clickByText(aiPage, ".review-session-page button", "Show answer");
      await aiPage.waitForSelector(".review-answer .review-markdown");
      const prompt = await aiPage.$eval(".review-question", (node) => node.textContent);
      const report = await aiPage.$$eval(".review-question, .review-answer .review-markdown", savedAiReport);
      if (prompt.startsWith("Learner card")) assert.ok(await aiPage.$(".review-question kbd"), "a learner card in a session lost its author HTML");
      else assertSavedAiInert(report, `review session card “${prompt.slice(0, 40)}”`);
      await clickByText(aiPage, ".review-rating", "Good");
    }
    await aiPage.waitForSelector(".review-center-page");

    // The interview round draws the ai-draft card tagged interview.
    await clickByText(aiPage, ".review-hero-actions button", "Interview round");
    await clickByText(aiPage, ".interview-round button", "Start answering");
    await clickByText(aiPage, ".interview-round button", "Show expected answer");
    await aiPage.waitForSelector(".interview-round .review-answer");
    assertSavedAiInert(await aiPage.$$eval(".interview-round .review-markdown", savedAiReport), "interview round");
    await clickByText(aiPage, ".review-session-header button", "End round");
    await aiPage.waitForSelector(".review-center-page");

    // Editing keeps the provenance: the preview is untrusted, and clearing
    // the tags field does not drop ai-draft.
    for (const id of ["audit-legacy-card", "audit-ai-flashcard"]) {
      await aiPage.$eval(`.review-deck-card[data-card-id="${id}"] button[aria-label="Edit review card"]`, (button) => button.click());
      await aiPage.waitForSelector(".review-card-dialog .review-ai-note");
      await clickByText(aiPage, ".review-card-dialog button", "Preview");
      assertSavedAiInert(await aiPage.$$eval(".review-markdown-preview .review-markdown", savedAiReport), `edit preview of ${id}`);
      await aiPage.$eval(".review-card-dialog input.text-input", (input) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await clickByText(aiPage, ".review-card-dialog button", "Save changes");
      await aiPage.waitForFunction(() => !document.querySelector(".review-card-dialog"), { timeout: 5_000 });
    }
    const editDeadline = Date.now() + 5_000;
    let editedTags = [];
    while (Date.now() < editDeadline) {
      editedTags = (await readProfile(aiPage)).reviewItems.filter((item) => item.id.startsWith("audit-ai-flashcard") || item.id === "audit-legacy-card").map((item) => item.tags);
      if (editedTags.length === 2 && editedTags.every((tags) => tags.length === 1)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(editedTags, [["ai-draft"], ["ai-draft"]], "an edit dropped the ai-draft provenance");

    // The Notebook shows the saved answer as plain text.
    await aiPage.evaluate(() => { location.hash = "#/notebook"; });
    await aiPage.waitForSelector(".clipping-card--ai blockquote");
    assertSavedAiInert(await aiPage.$$eval(".clipping-card--ai blockquote", savedAiReport), "Notebook clipping", { imageLink: false });

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(trackerRequests, [], "a remote image in saved AI text was fetched");
    assert.equal(await aiPage.evaluate(() => window.__lumenSavedAiXss === true), false, "a model-authored event handler ran");
    await aiPage.close();
  } finally {
    await savedAiContext.close();
  }

  // Issue #148: Extra practice grades cards that are not due, and used to
  // multiply their interval on every pass. The main flow above switches to
  // FSRS and seeds 10,000 cards, so a fresh Classic context hosts this: two
  // cards that are a day or three into a long interval are crunched with the
  // keyboard alone. The buttons must preview the interval the grade stores, the
  // grade must keep it, Mastered and the Part 05 ladder must not move, and the
  // schedule rule the attempt was graded under must be stored and survive a reload.
  const earlyContext = await browser.createBrowserContext();
  try {
    const earlyPage = await earlyContext.newPage();
    await earlyPage.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    earlyPage.on("pageerror", (error) => errors.push(error.message));
    // Per card: how it is seeded, what its buttons must read, what is announced,
    // what a quick grade must leave stored, and what multiplying would have stored.
    const earlyCards = [
      {
        id: "early-probe",
        front: "Early probe: what does dropout do at inference?",
        back: "Nothing: it is switched off, so every unit is active.",
        seed: { intervalDays: 10, ease: 2.5, repetitions: 4, reviewCount: 4, lapses: 0 },
        waitedDays: 1,
        previews: [[0, "10 min · 1"], [1, "10 days · 2"], [2, "10 days · 3"], [3, "10 days · 4"]],
        announced: "Rated Good: next review in 10 days",
        kept: { intervalDays: 10, repetitions: 4, ease: 2.5 },
        multipliedDays: 25,
      },
      {
        id: "early-mastered",
        front: "Early mastered: what does L2 regularization penalize?",
        back: "The squared size of the weights, which shrinks large coefficients.",
        seed: { intervalDays: 30, repetitions: 5, reviewCount: 5 },
        waitedDays: 3,
        previews: [[2, "1 mo · 3"]],
        announced: "Rated Good: next review in 1 mo",
        kept: { intervalDays: 30, repetitions: 5 },
        multipliedDays: 75,
      },
    ];
    await earlyPage.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
    await earlyPage.waitForSelector(".review-center-page");
    // Both cards were last reviewed `waitedDays` ago and are due exactly their
    // interval after that review, as the app schedules them: neither is due now.
    await earlyPage.evaluate((cards) => new Promise((resolve, reject) => {
      const request = indexedDB.open("lumen-ai-notes", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("study-data", "readwrite");
        const store = transaction.objectStore("study-data");
        const get = store.get("profile");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const profile = get.result && typeof get.result === "object" ? get.result : {};
          const base = Date.now();
          const stamp = (days) => new Date(base + days * 86_400_000).toISOString();
          profile.reviewItems = cards.map((card) => ({
            id: card.id, type: "basic", front: card.front, back: card.back, tags: [],
            documentId: "notes/part-05-supervised-learning/01-linear-regression.md",
            suspended: false, archived: false, buriedOnDay: "", ease: 2.5, lapses: 0, ...card.seed,
            lastReviewedAt: stamp(-card.waitedDays), dueAt: stamp(card.seed.intervalDays - card.waitedDays),
            createdAt: stamp(-60), updatedAt: stamp(-card.waitedDays),
          }));
          profile.reviewAttempts = [];
          store.put(profile, "profile");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    }), earlyCards);
    await earlyPage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await earlyPage.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 2, { timeout: 10_000 })
      .catch(() => assert.fail("the two seeded cards did not load into the deck"));

    const masteredTile = () => earlyPage.$$eval(".review-stat-grid article", (tiles) => tiles.find((tile) => tile.querySelector("span")?.textContent === "Mastered")?.querySelector("strong")?.textContent ?? null);
    // Part 05's row on Home, read once it shows its cards; back on the review
    // center afterwards.
    const partFiveRow = async () => {
      await earlyPage.evaluate(() => { location.hash = "#/home"; });
      await earlyPage.waitForFunction(() => /\d+\/\d+ cards mastered/.test([...document.querySelectorAll(".mastery-row")].find((row) => row.querySelector(".mastery-part")?.textContent === "05")?.textContent ?? ""), { timeout: 10_000 })
        .catch(() => assert.fail("Home did not show the cards mastered in Part 05"));
      const row = await earlyPage.evaluate(() => [...document.querySelectorAll(".mastery-row")].find((node) => node.querySelector(".mastery-part")?.textContent === "05").textContent);
      await earlyPage.evaluate(() => { location.hash = "#/review"; });
      await earlyPage.waitForSelector(".review-center-page", { timeout: 5_000 });
      return row;
    };
    assert.equal(await earlyPage.$eval(".review-hero strong", (node) => node.textContent), "0", "cards that are not due must leave today's queue empty");
    assert.equal(await masteredTile(), "1", "only the 30-day card is Mastered before Extra practice");
    const partFiveBefore = await partFiveRow();
    assert.ok(partFiveBefore.includes("1/2 cards mastered"), `Part 05 must start with one of its two cards mastered: ${partFiveBefore}`);

    // Keyboard only from here: Enter starts Extra practice, Space reveals, 3 rates Good.
    // Focus the button once earlier focus moves have settled, and confirm it is
    // still there a few frames later, or Enter can land on another control.
    const crunchFocused = await focusAndHold(earlyPage, ".review-hero-actions button", "Crunch weak cards");
    assert.ok(crunchFocused, "the Crunch weak cards control must be a focusable button that keeps focus");
    await earlyPage.keyboard.press("Enter");
    await earlyPage.waitForSelector(".review-session-page .review-crunch-notice", { timeout: 5_000 });
    const notice = await earlyPage.$eval(".review-crunch-notice", (node) => ({
      text: node.textContent.trim(),
      right: node.getBoundingClientRect().right,
      scrollWidth: document.documentElement.scrollWidth,
      // Not innerWidth: on a phone-emulated page Chrome grows it to fit overflowing content, so it can never fail.
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.equal(notice.text, "Extra practice doesn’t use today’s limits. Your answers still reschedule cards: the rating buttons show when each card comes back.", "the Extra practice notice must say that answers still reschedule cards and point to the rating buttons");
    assert.ok(notice.right <= notice.clientWidth && notice.scrollWidth <= notice.clientWidth, `the Extra practice notice must wrap inside a 393px phone: ${JSON.stringify(notice)}`);

    const handled = [];
    for (let turn = 1; turn <= earlyCards.length; turn += 1) {
      // The prompt of a card not yet graded holds focus: the next card is shown.
      await earlyPage.waitForFunction((done) => document.activeElement?.classList.contains("review-question") && !done.includes(document.activeElement.textContent.trim()), { timeout: 5_000 }, handled)
        .catch(() => assert.fail(`Extra practice did not focus the prompt of card ${turn}`));
      const prompt = (await earlyPage.$eval(".review-question", (node) => node.textContent)).trim();
      const card = earlyCards.find((entry) => entry.front === prompt);
      assert.ok(card, `Extra practice showed a card that was not seeded: ${prompt}`);
      handled.push(prompt);
      await earlyPage.keyboard.press("Space");
      // The answer takes focus in an effect of the same render that re-attaches the
      // key handler with the card revealed (ReviewCenter.jsx), so once the answer
      // has focus, key 3 rates the card.
      await earlyPage.waitForFunction(() => document.activeElement?.classList.contains("review-answer") && document.querySelectorAll(".review-rating span").length === 4, { timeout: 5_000 })
        .catch(() => assert.fail(`revealing the answer of “${card.id}” did not show the rating buttons`));
      const buttons = await earlyPage.$$eval(".review-rating span", (nodes) => nodes.map((node) => node.textContent));
      assert.deepEqual(card.previews.map(([index]) => [index, buttons[index]]), card.previews, `Extra practice must preview early-aware intervals: “${card.id}” reads ${JSON.stringify(buttons)}`);
      await earlyPage.keyboard.press("3");
      await earlyPage.waitForFunction((text) => [...document.querySelectorAll(".review-session-page [role='status'], .review-center-page [role='status']")].some((node) => node.textContent.includes(text)), { timeout: 5_000 }, card.announced)
        .catch(async () => assert.fail(`rating “${card.id}” Good must announce “${card.announced}”: ${JSON.stringify(await earlyPage.$$eval("[role='status']", (nodes) => nodes.map((node) => node.textContent)))}`));
    }
    assert.deepEqual(handled.slice().sort(), earlyCards.map((card) => card.front).sort(), "Extra practice must show each seeded card once");
    await earlyPage.waitForSelector(".review-center-page", { timeout: 5_000 });

    const crunched = await savedProfile(earlyPage, (profile) => earlyCards.every((card) => profile.reviewAttempts?.some((attempt) => attempt.reviewItemId === card.id)));
    assert.equal(crunched.reviewAttempts.length, 2, "each Extra practice grade must store one attempt");
    for (const card of earlyCards) {
      const item = crunched.reviewItems.find((entry) => entry.id === card.id);
      const attempt = crunched.reviewAttempts.find((entry) => entry.reviewItemId === card.id);
      assert.ok(item && attempt, `“${card.id}” and its attempt must be stored`);
      assert.deepEqual(Object.fromEntries(Object.keys(card.kept).map((field) => [field, item[field]])), card.kept, `“${card.id}” must keep its interval, repetitions and ease through an early Crunch grade`);
      assert.equal(Date.parse(item.dueAt) - Date.parse(attempt.reviewedAt), card.kept.intervalDays * 86_400_000, `an early Crunch grade must keep the interval: dueAt is now + ${card.kept.intervalDays} days, not + ${card.multipliedDays}`);
      assert.equal(attempt.crunch, true, `the attempt on “${card.id}” must be marked as Extra practice`);
      assert.equal(attempt.sessionKind, "crunch", `the attempt on “${card.id}” must be an Extra practice session`);
      assert.equal(attempt.scheduleRule, 3, `the attempt on “${card.id}” must record the schedule rule it was graded under`);
    }
    assert.equal(await earlyPage.$eval(".review-hero strong", (node) => node.textContent), "0", "Extra practice must leave today's queue empty");
    assert.equal(await masteredTile(), "1", "early Crunch grades must not raise the Mastered count: the 10-day card stays at 10 days");
    const partFiveAfter = await partFiveRow();
    assert.ok(partFiveAfter.includes("1/2 cards mastered"), `early Crunch grades must not raise Part 05's mastered cards: ${partFiveAfter}`);

    await earlyPage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await earlyPage.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 2, { timeout: 10_000 })
      .catch(() => assert.fail("the graded cards did not load into the deck after a reload"));
    // A bare reload saves nothing (the app writes only when the profile changes),
    // so reading the record again would only repeat the read above. Change a
    // setting, so the stored attempts pass through hydrate, merge and write again.
    const newLimit = (await earlyPage.evaluateHandle(() => [...document.querySelectorAll(".review-settings-strip label")].find((label) => label.firstChild?.textContent.trim() === "New")?.querySelector("select"))).asElement();
    assert.ok(newLimit, "the Daily limits strip must offer a New picker");
    assert.notEqual(crunched.reviewSettings.dailyNewLimit, 20, "the reload check must change the stored new-card limit, or it would read the record it already verified");
    await newLimit.select("20");
    const reloaded = await savedProfile(earlyPage, (profile) => profile.reviewSettings?.dailyNewLimit === 20);
    assert.equal(reloaded.reviewSettings?.dailyNewLimit, 20, "the Daily limits change made after the reload was not saved");
    assert.deepEqual(reloaded.reviewAttempts.map((attempt) => [attempt.reviewItemId, attempt.scheduleRule]).sort(), [["early-mastered", 3], ["early-probe", 3]], "scheduleRule must survive a reload");
    await earlyPage.close();
  } finally {
    await earlyContext.close();
  }

  // Issue #149: failing the last card of a session ended it, so the card was never
  // asked again in a short sitting. A fresh Classic context hosts these checks. Each
  // scenario has its own page, closed when it ends, so its clock starts at real time
  // and no older page syncs into it; the page clock is advanced, never slept through.
  const relearnContext = await browser.createBrowserContext();
  try {
    // A zone where it is now about midday, so no clock advance crosses the page's
    // local midnight: reviews seeded as spent today would then belong to yesterday.
    // Etc/GMT names invert the sign (Etc/GMT-5 is UTC+5), and the page reports a
    // zero offset as UTC.
    const middayZone = () => {
      const offset = 12 - new Date().getUTCHours();
      return offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    };
    const relearnPage = async () => {
      const relearn = await relearnContext.newPage();
      await relearn.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      relearn.on("pageerror", (error) => errors.push(error.message));
      await relearn.evaluateOnNewDocument(installAdjustableClock);
      const zone = middayZone();
      await relearn.emulateTimezone(zone);
      await relearn.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
      await relearn.waitForSelector(".review-center-page");
      assert.equal(await relearn.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), zone, "the #149 page must run in the emulated midday zone");
      return relearn;
    };
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    // A card three days into a three-day interval, due `dueInMs` from now.
    const dueCard = (id, front, dueInMs) => ({ id, front, intervalDays: 3, repetitions: 2, reviewCount: 2, reviewedAgoMs: 3 * DAY, dueInMs });
    const waitForHero = (page, count, why) => page.waitForFunction((expected) => document.querySelector(".review-hero strong")?.textContent === expected, { timeout: 5_000 }, count)
      .catch(async () => assert.fail(`${why}: the hero must read ${count}, not ${await page.evaluate(() => document.querySelector(".review-hero strong")?.textContent ?? "nothing")}`));
    // The prompt of `card` holds focus: it is the card shown.
    const promptFocused = (page, card) => page.waitForFunction((front) => document.activeElement?.classList.contains("review-question") && document.activeElement.textContent.trim() === front, { timeout: 5_000 }, card.front)
      .catch(async () => assert.fail(`the prompt of “${card.id}” must take focus; shown: ${await page.evaluate(() => document.querySelector(".review-question")?.textContent.trim() || (document.querySelector(".review-retry") ? "the retry panel" : document.querySelector(".page")?.className) || "nothing")}`));
    // Space reveals the answer; once the answer has focus the key handler sees the
    // reveal (as in the #148 block), so `key` rates the card. The grade clears the
    // status at once and its outcome lands a render later: wait for it, or a key
    // pressed next can preempt that render and its own status replaces the outcome.
    const revealAndRate = async (page, card, key) => {
      await promptFocused(page, card);
      await page.keyboard.press("Space");
      await page.waitForFunction(() => document.activeElement?.classList.contains("review-answer") && document.querySelectorAll(".review-rating").length === 4, { timeout: 5_000 })
        .catch(() => assert.fail(`revealing “${card.id}” must focus its answer and show the rating buttons`));
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.querySelector(".review-session-page [role='status'], .review-center-page [role='status']")?.textContent, { timeout: 5_000 })
        .catch(() => assert.fail(`rating “${card.id}” must be announced`));
    };
    // The retry panel replaces the card, and its title takes focus.
    const retryShown = async (page, why) => {
      await page.waitForSelector(".review-retry", { timeout: 5_000 })
        .catch(() => assert.fail(`${why} must offer a retry instead of ending the session`));
      await page.waitForFunction(() => document.activeElement?.id === "review-retry-title", { timeout: 5_000 })
        .catch(() => assert.fail(`${why}: the retry panel's title must take focus`));
    };
    // From the focused retry title, Tab reaches Retry now and Enter takes it.
    const retryNowByKeyboard = async (page) => {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.closest(".review-retry") ? document.activeElement.textContent.trim() : null), "Retry now", "Tab from the retry title must reach Retry now");
      await page.keyboard.press("Enter");
    };
    const sessionHeader = (page) => page.$eval(".review-session-header > div", (node) => [node.querySelector("strong")?.textContent, node.querySelector("span")?.textContent]);
    const eyebrow = (page) => page.$eval(".review-flashcard .eyebrow", (node) => node.textContent);
    const lastBadge = (page, expected) => pollValue(() => page.evaluate(() => window.__lumenBadges.at(-1)), (value) => value === expected);
    // The count on each navigation Review item, "" when it shows none. The bottom
    // navigation has no Review item: on a phone the count is on the menu drawer's.
    const reviewNavCounts = (page) => page.$$eval(".sidebar-primary button, .bottom-nav button", (buttons) => buttons
      .filter((button) => button.querySelector(":scope > span")?.textContent === "Review")
      .map((button) => button.querySelector("small")?.textContent ?? ""));

    // Scenario A, keyboard only: failing the only due card offers a retry and never
    // says the session is complete; undo brings the card back; Retry now shows it
    // early; and each outcome is announced once, a repeated one included.
    const solo = dueCard("retry-solo", "Retry solo: what does a learning step wait for?", -MINUTE);
    const soloPage = await relearnPage();
    try {
      await seedRelearn(soloPage, { cards: [solo] });
      assert.equal(await lastBadge(soloPage, 1), 1, "the app badge must count the due card");
      assert.deepEqual(await reviewNavCounts(soloPage), ["1 due"], "the navigation's Review item must count the due card");
      await watchStatus(soloPage);
      assert.ok(await focusAndHold(soloPage, ".review-hero-actions button", "Start review"), "the Start review control must be a focusable button that keeps focus");
      await soloPage.keyboard.press("Enter");
      await revealAndRate(soloPage, solo, "1");
      await retryShown(soloPage, "failing the only due card");
      const panel = await soloPage.evaluate(() => ({
        title: document.querySelector("#review-retry-title").textContent,
        progress: document.querySelector(".review-progress").getAttribute("aria-valuetext"),
        buttons: [...document.querySelectorAll(".review-retry button")].map((button) => button.textContent.trim()),
        undersized: [...document.querySelectorAll(".review-session-page button")].flatMap((button) => {
          const box = button.getBoundingClientRect();
          return box.width < 44 || box.height < 44 ? [`${button.textContent.trim()} ${Math.round(box.width)}×${Math.round(box.height)}`] : [];
        }),
        claimsComplete: document.body.textContent.includes("Session complete"),
      }));
      assert.equal(panel.title, "1 card to retry · due in 10 min", "the retry title must name the card and when its step is due");
      assert.deepEqual(await sessionHeader(soloPage), ["1", "to retry"], "the session header must count the card to retry");
      assert.equal(panel.progress, "1 of 2 reviewed", "the progress bar must count the card to retry as still to review");
      assert.deepEqual(panel.buttons, ["Retry now", "End session"], "the retry panel must offer exactly Retry now and End session");
      assert.deepEqual(panel.undersized, [], "every session button must be at least 44×44 at 393×852");
      assert.equal(panel.claimsComplete, false, "a card is pending, so nothing may say the session is complete");
      assert.equal(await lastBadge(soloPage, 0), 0, "the app badge must clear while the card waits out its step");
      assert.deepEqual(await reviewNavCounts(soloPage), [""], "the navigation's Review item must show no count while the card waits out its step");
      const failed = await savedProfile(soloPage, (profile) => profile.reviewAttempts?.length === 1);
      assert.equal(failed.reviewAttempts.length, 1, "failing the card must store one attempt");
      const [attempt] = failed.reviewAttempts;
      assert.equal(attempt.scheduleRule, 3, "the attempt must record schedule rule 3");
      assert.equal(attempt.nextIntervalDays, 10 / 1_440, "Again must store the 10-minute step");
      assert.equal(Date.parse(attempt.nextDueAt) - Date.parse(attempt.reviewedAt), 600_000, "the step must come due exactly 10 minutes after the grade");
      const stepped = failed.reviewItems.find((item) => item.id === solo.id);
      assert.equal(stepped.intervalDays, 10 / 1_440, "the card must store the 10-minute step");
      assert.equal(Date.parse(stepped.dueAt) - Date.parse(stepped.lastReviewedAt), 600_000, "the card must be due exactly 10 minutes after its review");

      // Undo right after the failure: the card returns, due, with its schedule restored.
      await soloPage.keyboard.down("Control");
      await soloPage.keyboard.press("z");
      await soloPage.keyboard.up("Control");
      await promptFocused(soloPage, solo);
      assert.deepEqual(await sessionHeader(soloPage), ["1", "remaining today"], "undo must bring the card back into today's queue");
      assert.deepEqual((await savedProfile(soloPage, (profile) => profile.reviewAttempts?.length === 0)).reviewAttempts, [], "undo must remove the attempt");
      await revealAndRate(soloPage, solo, "1");
      await retryShown(soloPage, "failing the card again after undo");
      await retryNowByKeyboard(soloPage);
      await promptFocused(soloPage, solo);
      const early = await eyebrow(soloPage);
      assert.ok(early.startsWith("Learning · 10 min interval"), `a step shown early must read as learning: ${early}`);
      await revealAndRate(soloPage, solo, "3");
      await soloPage.waitForSelector(".review-center-page", { timeout: 5_000 })
        .catch(() => assert.fail("rating the retried card Good must end the session"));
      await waitForHero(soloPage, "0", "the retried card is done for today");
      assert.deepEqual(await pollValue(() => statusLog(soloPage), (log) => log.at(-1)?.includes("Session complete")), [
        "Rated Again: next review in 10 min. 1 card to retry.",
        "Rated Again: next review in 10 min. 1 card to retry.",
        "Retrying 1 card.",
        "Rated Good: next review in 3 days. Session complete.",
      ], "each outcome must be announced once, after its grade lands");
    } finally {
      await soloPage.close();
    }

    // Scenario B: a step that comes due while another card's answer is revealed rejoins
    // the queue on the clock refresh without hiding that answer, and waits its turn;
    // then two cards pending retry are counted and come back earliest first.
    const first = dueCard("rejoin-first", "Rejoin first: why hold out a validation split?", -2 * HOUR);
    const second = dueCard("rejoin-second", "Rejoin second: what does early stopping watch?", -HOUR);
    const rejoinPage = await relearnPage();
    try {
      await seedRelearn(rejoinPage, { cards: [first, second] });
      await watchStatus(rejoinPage);
      await clickByText(rejoinPage, ".review-hero button", "Start review");
      await revealAndRate(rejoinPage, first, "1");
      await promptFocused(rejoinPage, second);
      await rejoinPage.keyboard.press("Space");
      await rejoinPage.waitForFunction(() => document.activeElement?.classList.contains("review-answer"), { timeout: 5_000 })
        .catch(() => assert.fail(`revealing “${second.id}” must focus its answer`));
      await advanceClock(rejoinPage, 10 * MINUTE + 1_000);
      await rejoinPage.waitForFunction(() => document.querySelector(".review-session-header strong")?.textContent === "2", { timeout: 5_000 })
        .catch(async () => assert.fail(`ten minutes on, the failed step must rejoin the queue: the header reads ${await rejoinPage.evaluate(() => document.querySelector(".review-session-header strong")?.textContent ?? "nothing")}`));
      // Read across a frame boundary, so a reset that follows the rejoin has landed.
      await rejoinPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await rejoinPage.evaluate(() => ({
        answer: Boolean(document.querySelector(".review-answer")),
        focused: Boolean(document.activeElement?.classList.contains("review-answer")),
        prompt: document.querySelector(".review-question")?.textContent.trim(),
        ratings: document.querySelectorAll(".review-rating").length,
      })), { answer: true, focused: true, prompt: second.front, ratings: 4 }, "a card rejoining the queue must leave the revealed answer, its focus and the rating buttons in place");
      await rejoinPage.keyboard.press("1");
      await promptFocused(rejoinPage, first);
      const rejoined = await eyebrow(rejoinPage);
      assert.ok(rejoined.startsWith("Learning · 10 min interval"), `the rejoined step must read as learning: ${rejoined}`);
      await revealAndRate(rejoinPage, first, "1");
      await retryShown(rejoinPage, "failing the last card with another step pending");
      assert.equal(await rejoinPage.$eval("#review-retry-title", (node) => node.textContent), "2 cards to retry · next due in 10 min", "the retry title must count both cards and say when the next is due");
      await retryNowByKeyboard(rejoinPage);
      await revealAndRate(rejoinPage, second, "3");
      await revealAndRate(rejoinPage, first, "3");
      await rejoinPage.waitForSelector(".review-center-page", { timeout: 5_000 })
        .catch(() => assert.fail("rating both retried cards Good must end the session"));
      assert.deepEqual(await pollValue(() => statusLog(rejoinPage), (log) => log.at(-1)?.includes("Session complete")), [
        "Rated Again: next review in 10 min. 1 card left.",
        "Rated Again: next review in 10 min. 1 card left.",
        "Rated Again: next review in 10 min. 2 cards to retry.",
        "Retrying 2 cards.",
        "Rated Good: next review in 3 days. 1 card left.",
        "Rated Good: next review in 3 days. Session complete.",
      ], "each outcome must be announced once, after its grade lands");
    } finally {
      await rejoinPage.close();
    }

    // Scenario C: a card failed on the last review today's limit allows waits out its
    // step and comes back past the spent limit, while the due count stays "due now".
    const last = dueCard("limit-last", "Limit last: what does the learning rate scale?", -2 * HOUR);
    const waiting = dueCard("limit-waiting", "Limit waiting: what does weight decay shrink?", -HOUR);
    const limitPage = await relearnPage();
    try {
      const todayKey = await seedRelearn(limitPage, { cards: [last, waiting], reviewSettings: { dailyReviewLimit: 20 }, reviewCompletedToday: 19 });
      const reviewsToday = (profile) => profile.reviewSessions?.find((session) => session.id === todayKey)?.reviewCompleted;
      // Home's due widget, read on Home; back on the review center afterwards.
      const homeDue = async () => {
        await limitPage.evaluate(() => { location.hash = "#/home"; });
        await limitPage.waitForSelector(".today-widgets");
        const due = await limitPage.$eval(".today-widget strong", (node) => node.textContent);
        await limitPage.evaluate(() => { location.hash = "#/review"; });
        await limitPage.waitForSelector(".review-center-page", { timeout: 5_000 });
        return due;
      };
      await waitForHero(limitPage, "1", "one of today's 20 reviews is left");
      await clickByText(limitPage, ".review-hero button", "Start review");
      await revealAndRate(limitPage, last, "1");
      await retryShown(limitPage, "failing the card on the last review the limit allows");
      assert.equal(reviewsToday(await savedProfile(limitPage, (profile) => reviewsToday(profile) === 20)), 20, "the failed review must spend the last of today's 20 reviews");
      await clickByText(limitPage, ".review-retry button", "End session");
      await waitForHero(limitPage, "0", "after the session ends nothing is due now");
      const heroStatus = await limitPage.$eval("#review-hero-status", (node) => node.textContent);
      assert.ok(heroStatus.includes("1 due card waits for tomorrow"), `the card the spent limit holds back must wait for tomorrow: ${heroStatus}`);
      assert.equal(await homeDue(), "0", "Home's due widget must not count a step that is not due yet");
      await advanceClock(limitPage, 10 * MINUTE + 1_000);
      await waitForHero(limitPage, "1", "ten minutes on, the step is due past the spent limit");
      assert.equal(await homeDue(), "1", "Home's due widget must count the step once it is due");
      await clickByText(limitPage, ".review-hero button", "Start review");
      await revealAndRate(limitPage, last, "3");
      await limitPage.waitForSelector(".review-center-page", { timeout: 5_000 })
        .catch(() => assert.fail("rating the step Good must end the session: the waiting card has no review left today"));
      await waitForHero(limitPage, "0", "the step is done and the waiting card has no review left today");
      assert.equal(reviewsToday(await savedProfile(limitPage, (profile) => reviewsToday(profile) === 21)), 21, "the step graded past the limit must still count in today's reviews");
    } finally {
      await limitPage.close();
    }
  } finally {
    await relearnContext.close();
  }
  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Review audit passed: creation, grading, confidence, ledger limits, undo, edit, archive/restore, mistake notebook (auto-log on Again, merge on repeat, manual capture, persisted corrections, linked and unlinked corrective scheduling, corrected/category filters), duplicate-card rejection, Home due-count agreement, crunch practice leaving today's queue count intact, session progress/focus/announcement and short-phone grade reach, archive focus handoff, keyboard deck import with duplicate and malformed-file feedback, phone Daily limits strip, inert mistake dialog, in-place on-screen mistake and clipping undo (focused strips never expire), burst-typed clipping notes, corrections saved on page hide, cloze Enter-to-submit and the leave guard in a readiness check, timed interview round with miss capture, FSRS opt-in with one-time migration, honest thin-history calibration refusal, the retention-vs-workload planner, authored track rounds with rubric reveal, worksheet-lab miss capture, analytics, reload persistence, 10,000-card mobile pagination, saved AI cards rendered as untrusted text (no forged control, image fetch or app link in the deck, session, interview round or edit preview; ai-draft kept through edits), the Extra practice notice under Classic and FSRS, early Crunch grades that keep their interval and Mastered count, and a retry offered for a failed last card (a 10-minute step due to the minute, undo, Retry now showing steps early by keyboard, a step rejoining mid-session without hiding a revealed answer, each outcome announced once, 44px session targets, and a step back past a spent daily limit that Home counts only once due) verified.");
} finally {
  if (browser) await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(downloadDirectory, { recursive: true, force: true });
  await rm(fixtureDirectory, { recursive: true, force: true });
}
