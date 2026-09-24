import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-cross-tab-profile-"));
const errors = [];
let browser;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readonly");
    const profileRequest = transaction.objectStore("study-data").get("profile");
    profileRequest.onsuccess = () => resolve(profileRequest.result);
    profileRequest.onerror = () => reject(profileRequest.error);
  };
}));

const openCreateDialog = async (page, title, label) => {
  await page.bringToFront();
  await page.evaluate(() => { location.hash = "#/notebook"; });
  console.log(`Cross-tab audit: ${label} routed`);
  await page.waitForSelector(".notebook-page .notebook-actions .primary", { timeout: 15_000 });
  console.log(`Cross-tab audit: ${label} notebook ready`);
  await page.click(".notebook-page .notebook-actions .primary");
  console.log(`Cross-tab audit: ${label} new-note clicked`);
  await page.waitForSelector(".create-note-dialog input[required]");
  await page.type(".create-note-dialog input[required]", title);
  console.log(`Cross-tab audit: ${label} draft typed`);
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    // Both tabs must keep running: a starved runner can otherwise throttle or
    // freeze the background tab (CI saw tab B stop responding for minutes),
    // which tests Chrome's tab management instead of Lumen's merge.
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  });
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  for (const page of [pageA, pageB]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
  }

  await pageA.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  console.log("Cross-tab audit: initial page loaded");
  await pageA.waitForSelector(".app-shell");
  await pageB.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await pageB.waitForSelector(".app-shell");
  console.log("Cross-tab audit: two clean tabs hydrated");

  await openCreateDialog(pageA, "Concurrent note from tab A", "tab A");
  await openCreateDialog(pageB, "Concurrent note from tab B", "tab B");
  console.log("Cross-tab audit: concurrent drafts ready");
  await Promise.all([
    pageA.$eval('.create-note-dialog button[type="submit"]', (button) => button.click()),
    pageB.$eval('.create-note-dialog button[type="submit"]', (button) => button.click()),
  ]);
  console.log("Cross-tab audit: concurrent creates submitted");

  // Wait for both specific notes, not merely two records: on a slow runner the
  // second debounced save can land well after the first.
  const wanted = ["Concurrent note from tab A", "Concurrent note from tab B"];
  const submittedAt = Date.now();
  let stored;
  do {
    await delay(150);
    stored = await readProfile(pageA);
  } while (!wanted.every((title) => stored?.customDocuments?.some((document) => document.title === title)) && Date.now() - submittedAt < 45_000);
  console.log(`Cross-tab audit: durable merge observed after ${Date.now() - submittedAt} ms`);

  const titles = new Set(stored.customDocuments.map((document) => document.title));
  if (!wanted.every((title) => titles.has(title))) {
    // Distinguish a lost update from a slow one: what is durable, what each tab
    // still shows, and each tab's save state.
    const tabState = (page) => page.evaluate(() => ({
      saveStatus: document.querySelector(".save-status, [data-save-status]")?.textContent?.trim() || null,
      visibleNotes: [...document.querySelectorAll(".notebook-document-row, .document-card")].map((node) => node.textContent.trim().slice(0, 40)).slice(0, 6),
    })).catch((error) => ({ error: error.message }));
    console.error(JSON.stringify({ waitedMs: Date.now() - submittedAt, storedTitles: [...titles], revision: stored?.syncMeta?.revision, tabA: await tabState(pageA), tabB: await tabState(pageB), errors }));
  }
  assert.ok(titles.has("Concurrent note from tab A"), "tab A's unique note was overwritten");
  assert.ok(titles.has("Concurrent note from tab B"), "tab B's unique note was overwritten");
  assert.ok(stored.syncMeta.revision >= 2, "serialized cross-tab writes did not advance the profile revision");

  await Promise.all([
    pageA.reload({ waitUntil: "networkidle2", timeout: 30_000 }),
    pageB.reload({ waitUntil: "networkidle2", timeout: 30_000 }),
  ]);
  await delay(600);
  for (const page of [pageA, pageB]) {
    const reloaded = await readProfile(page);
    assert.deepEqual(
      new Set(reloaded.customDocuments.map((document) => document.title)),
      titles,
      "both tabs must converge on the same durable notes after reload",
    );
  }

  // A background profile commit also rebuilds the document map. Revalidating
  // that map must not dismiss mobile navigation while the user is choosing.
  await pageA.setViewport({ width: 390, height: 680 });
  await pageA.bringToFront();
  await pageA.locator('[aria-label="Open menu"]').click();
  await pageA.waitForSelector(".app-sidebar.open");
  await pageB.bringToFront();
  await pageB.locator('[aria-label="Open settings"]').click();
  await pageB.waitForSelector(".theme-choices");
  const night = (await pageB.$$(".theme-choices button"))[2];
  assert.ok(await night.evaluate((node) => node.textContent.includes("Night")), "Night theme control moved");
  await night.asLocator().click();
  await pageB.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await pageA.bringToFront();
  await pageA.waitForFunction(() => document.documentElement.dataset.theme === "dark", { timeout: 10_000 });
  await pageA.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await pageA.$eval(".app-sidebar", (node) => node.classList.contains("open") && !node.inert), true, "a background profile update dismissed mobile navigation");

  // Issue #52: opening a lecture by link records it in Recent once. Two idle
  // tabs on different lectures must not keep rewriting Recent at each other.
  const lectureA = "notes/part-01-foundations/01-ai-ml-mental-model.md";
  const lectureB = "notes/part-01-foundations/02-problem-framing-and-objectives.md";
  await pageA.evaluate((id) => { location.hash = `#/read/${encodeURIComponent(id)}`; }, lectureA);
  await pageA.waitForSelector(".markdown-body h1", { timeout: 15_000 });
  await delay(800);
  await pageB.evaluate((id) => { location.hash = `#/read/${encodeURIComponent(id)}`; }, lectureB);
  await pageB.waitForSelector(".markdown-body h1", { timeout: 15_000 });
  await delay(2_000);
  const settledRevision = (await readProfile(pageA)).syncMeta.revision;
  await delay(3_000);
  const idle = await readProfile(pageA);
  assert.ok(idle.syncMeta.revision - settledRevision <= 1, `two idle reader tabs kept rewriting the profile (${idle.syncMeta.revision - settledRevision} revisions in 3s)`);
  assert.deepEqual(idle.recent.slice(0, 2), [lectureB, lectureA], "the most recently opened lecture must lead Recent");

  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Cross-tab audit passed: simultaneous unique notes were atomically merged, broadcast, and durable after two-tab reload; background settings updates preserve an open mobile menu; two idle reader tabs leave Recent settled.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
