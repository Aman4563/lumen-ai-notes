import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = new URL(process.env.LUMEN_URL || "http://127.0.0.1:4173/");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-chunk-recovery-profile-"));
let browser;

const navigationWasReload = (page) => page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type === "reload");

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // Force each lazy request through DevTools interception instead of allowing a
  // prior shell-cache response to hide the simulated missing deployment file.
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);

  await page.goto(baseUrl.href, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block");
  await page.evaluate(() => localStorage.setItem("lumen:chunk-recovery-audit", "preserve"));

  let blockWhiteboard = true;
  let blockedWhiteboard = 0;
  let blockPhoneCss = false;
  let blockedPhoneCss = 0;
  let missingWhiteboard = false;
  let missingStorageHealth = false;
  const observedAssets = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/assets/")) observedAssets.push(pathname);
    // A file that is missing from the deployment itself, on every request.
    if ((missingWhiteboard && /\/assets\/Whiteboard-[^/]+\.js$/.test(pathname)) || (missingStorageHealth && /\/assets\/StorageHealth-[^/]+\.js$/.test(pathname))) {
      void request.respond({ status: 404, contentType: "text/plain", body: "missing" });
      return;
    }
    if (blockWhiteboard && /\/assets\/Whiteboard-[^/]+\.js$/.test(pathname)) {
      blockWhiteboard = false;
      blockedWhiteboard += 1;
      void request.abort("failed");
      return;
    }
    if (blockPhoneCss && /\/assets\/PhoneLocalAiTutor-[^/]+\.css$/.test(pathname)) {
      blockPhoneCss = false;
      blockedPhoneCss += 1;
      void request.abort("failed");
      return;
    }
    void request.continue();
  });

  const documentId = encodeURIComponent("notes/00-roadmap.md");
  await page.goto(new URL(`#/board/${documentId}`, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForSelector(".advanced-board", { timeout: 30_000 });
  assert.equal(blockedWhiteboard, 1, `the stale Whiteboard chunk request was not simulated exactly once; observed ${observedAssets.join(", ")}`);
  assert.equal(await navigationWasReload(page), true, "a stale Whiteboard chunk did not trigger the bounded reload");
  assert.equal(await page.evaluate(() => localStorage.getItem("lumen:chunk-recovery-audit")), "preserve", "chunk recovery removed local browser data");
  assert.equal(await page.$(".fatal-error"), null, "Whiteboard remained on the fatal error screen after a fresh chunk became available");

  await page.goto(new URL("#/ai", baseUrl).href, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector('[data-ai-engine-option="phone-local"]');
  assert.equal(await page.evaluate(() => sessionStorage.getItem("lumen:chunk-recovery-v1")), null, "Whiteboard recovery left its cooldown marker after the fresh chunk loaded");
  blockPhoneCss = true;
  let resolvePhoneReload;
  const phoneReloaded = new Promise((resolve) => { resolvePhoneReload = resolve; });
  const handlePhoneReload = () => resolvePhoneReload(true);
  page.once("load", handlePhoneReload);
  await page.click('[data-ai-engine-option="phone-local"]');
  const phoneReloadObserved = await Promise.race([
    phoneReloaded,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  page.off("load", handlePhoneReload);
  assert.equal(phoneReloadObserved, true, `stale on-device tutor CSS did not reload; blocked=${blockedPhoneCss}; assets=${observedAssets.join(", ")}`);
  await page.waitForSelector('[data-ai-engine-option="phone-local"]', { timeout: 30_000 });
  assert.equal(blockedPhoneCss, 1, "the stale on-device tutor CSS request was not simulated exactly once");
  assert.equal(await navigationWasReload(page), true, "stale on-device tutor CSS did not trigger the bounded reload");

  // The repaired document may already restore the remembered engine; choosing
  // it again is harmless and verifies the now-available CSS/module pair works.
  await page.click('[data-ai-engine-option="phone-local"]');
  await page.waitForSelector(".phone-local-ai", { timeout: 30_000 });
  assert.equal(await page.$(".fatal-error"), null, "on-device tutor remained on the fatal error screen after recovery");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("lumen:chunk-recovery-v1")), null, "successful lazy loading did not clear the recovery cooldown marker");

  const routeError = () => page.evaluate(() => ({
    title: document.querySelector(".route-error h1")?.textContent || "",
    actions: [...document.querySelectorAll(".route-error button")].map((button) => button.textContent.trim()),
    bottomNav: Boolean(document.querySelector(".bottom-nav button")),
    fatal: Boolean(document.querySelector(".fatal-error")),
    // The panel lives inside the one <main id="main-content"> landmark.
    inMain: Boolean(document.querySelector("#main-content .route-error")),
    mains: document.querySelectorAll("main, [role='main']").length,
    headingFocused: document.activeElement === document.querySelector(".route-error h1"),
  }));
  const goHomeFromRouteError = async () => {
    await page.$$eval(".route-error button", (buttons) => buttons.find((button) => button.textContent.includes("Go to Home")).click());
    await page.waitForSelector(".welcome-block", { timeout: 15_000 });
    assert.equal(await page.$(".route-error"), null, "navigating Home did not clear the failed screen");
  };

  // Offline, a screen that was never downloaded stays inside the shell and
  // says so; it neither reloads nor replaces the app.
  await page.setOfflineMode(true);
  await page.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Read").click());
  await page.waitForSelector(".route-error", { timeout: 30_000 });
  const offlineScreen = await routeError();
  assert.equal(offlineScreen.title, "This screen is not available offline yet", "an offline chunk failure was not explained as offline");
  assert.equal(offlineScreen.bottomNav, true, "an offline chunk failure removed the bottom navigation");
  assert.equal(offlineScreen.fatal, false, "an offline chunk failure replaced the whole app");
  assert.ok(offlineScreen.actions.some((label) => label.includes("Go to Home")), "the offline screen has no way back to Home");
  assert.equal(offlineScreen.inMain && offlineScreen.mains === 1, true, `the failed screen left the single main landmark (${offlineScreen.mains} mains, inside #main-content: ${offlineScreen.inMain})`);
  await goHomeFromRouteError();
  // React.lazy rethrows the failed import at once, so on a second visit the
  // panel is present when route focus runs and its heading takes focus.
  await page.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Read").click());
  await page.waitForSelector(".route-error h1", { timeout: 15_000 });
  await page.waitForFunction(() => document.activeElement === document.querySelector(".route-error h1"), { timeout: 5_000 }).catch(() => {});
  assert.equal((await routeError()).headingFocused, true, "returning to a failed screen did not move route focus to its heading");
  await goHomeFromRouteError();
  await page.setOfflineMode(false);

  // A file missing from the deployment while the server is reachable: one
  // bounded reload, then an in-shell repair prompt instead of the fatal screen.
  missingWhiteboard = true;
  let resolveBoardReload;
  const boardReloaded = new Promise((resolve) => { resolveBoardReload = resolve; });
  const handleBoardReload = () => resolveBoardReload(true);
  page.once("load", handleBoardReload);
  await page.evaluate((id) => { location.hash = `#/board/${id}`; }, documentId);
  const boardReloadObserved = await Promise.race([boardReloaded, new Promise((resolve) => setTimeout(() => resolve(false), 15_000))]);
  page.off("load", handleBoardReload);
  assert.equal(boardReloadObserved, true, "a missing Whiteboard chunk did not get its one bounded reload");
  await page.waitForFunction(() => document.querySelector(".route-error h1")?.textContent === "Lumen needs fresh app files", { timeout: 30_000 });
  const staleScreen = await routeError();
  assert.equal(staleScreen.bottomNav, true, "a missing chunk after recovery removed the bottom navigation");
  assert.equal(staleScreen.fatal, false, "a missing chunk after recovery replaced the whole app");
  assert.ok(staleScreen.actions.some((label) => label.includes("Repair app files")), "a missing deployment file did not offer app-file repair");
  assert.equal(await page.evaluate(() => localStorage.getItem("lumen:chunk-recovery-audit")), "preserve", "the in-shell failure removed local browser data");
  await goHomeFromRouteError();
  missingWhiteboard = false;

  // Storage health is optional: when it cannot load, Settings and backup
  // export stay usable. The recovery reload was already spent above.
  missingStorageHealth = true;
  await page.$eval('[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".storage-health-unavailable", { timeout: 30_000 });
  assert.equal(await page.$(".fatal-error"), null, "a missing Storage health chunk replaced the whole app");
  assert.equal(await page.$$eval(".settings-drawer button", (buttons) => buttons.some((button) => /Export (?:encrypted )?backup/.test(button.textContent) && !button.disabled)), true, "a missing Storage health chunk made backup export unavailable");
  await page.$eval(".settings-close", (button) => button.click());
  missingStorageHealth = false;

  console.log("Chunk recovery audit passed: stale Whiteboard JS and on-device tutor CSS each recovered with local data preserved; offline and missing screens stayed inside the shell, and Settings kept backup export without Storage health.");
} finally {
  await browser?.close().catch(() => {});
  await rm(profileDirectory, { recursive: true, force: true });
}
