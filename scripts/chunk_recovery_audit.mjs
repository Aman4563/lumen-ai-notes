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
  const observedAssets = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/assets/")) observedAssets.push(pathname);
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

  // Engine selection is intentionally in-memory, so choose it again after the
  // repaired document loads and verify the now-available CSS/module pair works.
  await page.click('[data-ai-engine-option="phone-local"]');
  await page.waitForSelector(".phone-local-ai", { timeout: 30_000 });
  assert.equal(await page.$(".fatal-error"), null, "on-device tutor remained on the fatal error screen after recovery");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("lumen:chunk-recovery-v1")), null, "successful lazy loading did not clear the recovery cooldown marker");

  console.log("Chunk recovery audit passed: stale Whiteboard JS and on-device tutor CSS each recovered with local data preserved.");
} finally {
  await browser?.close().catch(() => {});
  await rm(profileDirectory, { recursive: true, force: true });
}
