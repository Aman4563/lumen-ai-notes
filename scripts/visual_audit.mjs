import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "lumen-visual-audit-"));
const failures = [];
const runtimeErrors = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
});

try {
  const page = await browser.newPage();
  // iPhone 16 Pro logical viewport in portrait orientation.
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block", { timeout: 10_000 });

  const home = await page.evaluate(() => ({
    width: window.innerWidth,
    rootWidth: document.documentElement.scrollWidth,
    title: document.title,
    lectureCount: document.querySelectorAll(".part-tile").length,
    overflow: [...document.querySelectorAll("body *")]
      .filter((node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && !node.closest('[aria-hidden="true"], [inert]');
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, className: node.className?.baseVal || node.className || "", left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((item) => item.width > 1 && (item.left < -1 || item.right > window.innerWidth + 1))
      .slice(0, 12),
  }));
  assert(home.title === "Lumen AI Notes", "home title did not render");
  assert(home.lectureCount > 0, "curriculum cards did not render");
  assert(home.rootWidth <= home.width + 1, `home has horizontal overflow: ${home.rootWidth}px in a ${home.width}px viewport`);

  const readerId = encodeURIComponent("notes/part-01-foundations/01-ai-ml-mental-model.md");
  await page.goto(`${baseUrl}#/read/${readerId}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body math", { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll(".diagram-shell svg").length > 0, { timeout: 15_000 }).catch(() => {});
  const reader = await page.evaluate(() => ({
    title: document.querySelector(".markdown-body h1")?.textContent || "",
    math: document.querySelectorAll(".markdown-body math").length,
    diagrams: document.querySelectorAll(".diagram-shell svg").length,
    diagramNodes: [...document.querySelectorAll(".diagram-shell")].map((node) => node.outerHTML.slice(0, 500)),
    width: window.innerWidth,
    rootWidth: document.documentElement.scrollWidth,
  }));
  assert(reader.title.length > 0, "reader heading did not render");
  assert(reader.math > 0, "native MathML formulas did not render into the reader DOM");
  assert(reader.diagrams > 0, "Mermaid diagram did not render to SVG");
  assert(reader.rootWidth <= reader.width + 1, `reader has horizontal overflow: ${reader.rootWidth}px in a ${reader.width}px viewport`);

  const readerDiagramBeforeTheme = await page.$eval(".diagram-shell .mermaid", (node) => ({
    count: Number(node.dataset.diagramRenderCount),
    sourceLabel: node.querySelector("svg")?.textContent || "",
    originalTheme: document.documentElement.getAttribute("data-theme"),
    dark: getComputedStyle(document.documentElement).colorScheme.includes("dark"),
  }));
  const alternateTheme = readerDiagramBeforeTheme.dark ? "paper" : "dark";
  await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, alternateTheme);
  await page.waitForFunction((count) => Number(document.querySelector(".diagram-shell .mermaid")?.dataset.diagramRenderCount) > count, { timeout: 15_000 }, readerDiagramBeforeTheme.count).catch(() => {});
  const readerDiagramAfterTheme = await page.$eval(".diagram-shell .mermaid", (node) => ({
    count: Number(node.dataset.diagramRenderCount),
    sourceLabel: node.querySelector("svg")?.textContent || "",
    failed: Boolean(node.querySelector(".diagram-diagnostic")),
  }));
  assert(readerDiagramAfterTheme.count > readerDiagramBeforeTheme.count, "Reader Mermaid did not rerender after a theme change");
  assert(readerDiagramAfterTheme.sourceLabel.includes("Artificial Intelligence"), "Reader theme rerender lost the original Mermaid definition");
  assert(!readerDiagramAfterTheme.failed, "Reader theme rerender converted a valid built-in diagram into an error");
  await page.evaluate((theme) => {
    if (theme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
  }, readerDiagramBeforeTheme.originalTheme);

  const teachClicked = await page.$$eval(".document-tools .text-button", (buttons) => {
    const button = buttons.find((item) => item.textContent.includes("Teach"));
    button?.click();
    return Boolean(button);
  });
  assert(teachClicked, "teaching mode control was not found");
  const teachMode = await page.waitForSelector(".teach-mode", { timeout: 8_000 }).catch(() => null);
  assert(Boolean(teachMode), "teaching mode did not open");
  if (teachMode) {
    assert(await page.$(".teach-card"), "teaching mode did not render a teaching card");
    await page.click('button[aria-label="Next section"]');
    const teachingDiagram = await page.waitForSelector('.teach-mode .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 15_000 }).catch(() => null);
    assert(Boolean(teachingDiagram), "teaching mode did not render the built-in Mermaid diagram");
    assert(!(await page.$(".teach-mode .diagram-diagnostic")), "teaching mode displayed an error for a valid built-in diagram");
    await page.click('button[aria-label="Exit teaching mode"]');
  }

  const boardClicked = await page.$$eval(".document-tools .text-button", (buttons) => {
    const button = buttons.find((item) => item.textContent.includes("Whiteboard"));
    button?.click();
    return Boolean(button);
  });
  assert(boardClicked, "whiteboard control was not found");
  const boardCanvas = await page.waitForSelector(".board-canvas", { timeout: 8_000 }).catch(() => null);
  assert(Boolean(boardCanvas), "whiteboard did not open");
  if (boardCanvas) {
    const board = await page.$eval(".board-canvas", (canvas) => ({ width: canvas.width, height: canvas.height }));
    assert(board.width > 0 && board.height > 0, "whiteboard canvas has no drawing surface");
  }

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page");
  const review = await page.evaluate(() => ({ width: innerWidth, rootWidth: document.documentElement.scrollWidth, statCount: document.querySelectorAll(".review-stat-grid article").length }));
  assert(review.rootWidth <= review.width + 1, `review center has horizontal overflow: ${review.rootWidth}px in a ${review.width}px viewport`);
  assert(review.statCount === 4, "review center did not render all mastery summaries");
  await page.$eval(".review-title > button", (button) => button.click());
  await page.waitForSelector(".review-card-dialog");
  const reviewDialog = await page.$eval(".review-card-dialog", (node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
  assert(reviewDialog.left >= -1 && reviewDialog.right <= review.width + 1, "review authoring dialog overflows horizontally");
  assert(reviewDialog.top >= -1 && reviewDialog.bottom <= 875, "review authoring dialog is not contained in the iPhone viewport");

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block");
  const cachedUrls = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const cacheName = (await caches.keys()).find((name) => name.startsWith("lumen-ai-notes-v"));
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => request.url);
  });
  const cachedCount = cachedUrls.length;
  assert(cachedCount >= 7, `offline cache is missing the application shell (${cachedCount} requests)`);
  assert(cachedUrls.some((url) => url.endsWith("/manifest.webmanifest")), "offline cache omitted the web app manifest");
  assert(cachedUrls.some((url) => /01-ai-ml-mental-model[^/]*\.js$/.test(url)), "visited lecture source was not cached on demand");
  assert(!cachedUrls.some((url) => /content-search[^/]*\.js$/.test(url)), "unused full-text search corpus was eagerly cached");

  await page.setOfflineMode(true);
  await page.goto(`${baseUrl}#/read/${readerId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector(".markdown-body h1", { timeout: 10_000 });
  const offlineLecture = await page.$eval(".markdown-body", (node) => ({ text: node.textContent.length, heading: node.querySelector("h1")?.textContent || "" }));
  assert(offlineLecture.text > 10_000, "visited lecture did not fully reload from the proportional offline cache");
  assert(offlineLecture.heading === reader.title, "offline lecture heading did not match the visited source");
  await page.setOfflineMode(false);

  assert(runtimeErrors.length === 0, `browser errors: ${runtimeErrors.join(" | ")}`);

  if (failures.length) {
    console.error("Visual audit failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
    console.error("Current page excerpt:\n" + (await page.$eval("body", (body) => body.innerText.slice(0, 2_000))).replace(/\n{3,}/g, "\n\n"));
    if (home.overflow.length) console.error("Overflowing elements:\n" + JSON.stringify(home.overflow, null, 2));
    if (reader.diagramNodes.length) console.error("Diagram DOM:\n" + reader.diagramNodes.join("\n"));
    if (runtimeErrors.length) console.error("Runtime errors:\n" + runtimeErrors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Visual audit passed.");
    console.log(`Viewport: ${home.width}px; formulas: ${reader.math}; diagrams: ${reader.diagrams}; cached requests: ${cachedCount}`);
  }
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
