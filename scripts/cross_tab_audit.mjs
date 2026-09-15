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
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
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

  let stored;
  const deadline = Date.now() + 15_000;
  do {
    await delay(150);
    stored = await readProfile(pageA);
  } while ((stored?.customDocuments?.length || 0) < 2 && Date.now() < deadline);
  console.log("Cross-tab audit: durable merge observed");

  const titles = new Set(stored.customDocuments.map((document) => document.title));
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

  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Cross-tab audit passed: simultaneous unique notes were atomically merged, broadcast, and durable after two-tab reload; background settings updates preserve an open mobile menu.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
