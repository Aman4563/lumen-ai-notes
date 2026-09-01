import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-controls-profile-"));
const runtimeErrors = [];
const findings = [];
let browser;

const inspectControls = async (page, surface) => {
  const result = await page.evaluate((surfaceName) => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return !node.closest("[inert]") && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    };
    const accessibleName = (node) => {
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelled = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "";
      return (node.getAttribute("aria-label") || labelled || node.textContent || node.getAttribute("title") || node.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
    };
    return [...document.querySelectorAll("button, a[href], select, textarea, input:not([type='hidden']), canvas[tabindex]")]
      .filter(visible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const coreTouchControl = node.matches(".bottom-nav button, .reader-actions button, .document-tools button, .board-page-controls button, .board-backgrounds button, .board-toolbar button, .teach-footer button, .notebook-actions button, .notebook-row-actions button, .library-view-controls button, .review-center-page button, .review-card-dialog button, .review-session-page button");
        return {
          surface: surfaceName,
          tag: node.tagName.toLocaleLowerCase(),
          name: accessibleName(node),
          className: typeof node.className === "string" ? node.className : "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          disabled: Boolean(node.disabled),
          coreTouchControl,
        };
      });
  }, surface);

  result.forEach((control) => {
    if (!control.name) findings.push(`${surface}: unnamed ${control.tag} (${control.className || "no class"})`);
    if (control.tag === "button" && (control.width < 32 || control.height < 32)) findings.push(`${surface}: undersized button “${control.name}” is ${control.width}×${control.height}px`);
    if (control.coreTouchControl && (control.width < 38 || control.height < 38)) findings.push(`${surface}: primary touch control “${control.name}” is only ${control.width}×${control.height}px`);
  });
  return result.length;
};

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(expected));
    node?.click();
    return Boolean(node);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });

  let inspected = 0;
  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block");
  inspected += await inspectControls(page, "home");

  await page.goto(`${baseUrl}#/library`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".library-page");
  inspected += await inspectControls(page, "library");

  const documentId = encodeURIComponent("notes/part-01-foundations/01-ai-ml-mental-model.md");
  await page.goto(`${baseUrl}#/read/${documentId}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".reader-view");
  inspected += await inspectControls(page, "reader");
  await clickByText(page, ".document-tools button", "Actions");
  await page.waitForSelector(".reader-action-menu");
  inspected += await inspectControls(page, "reader actions");
  await page.click('.reader-action-menu button[aria-label="Close lecture actions"]');

  await clickByText(page, ".document-tools button", "Teach");
  await page.waitForSelector(".teach-mode");
  inspected += await inspectControls(page, "teaching mode");
  await page.click('button[aria-label="Exit teaching mode"]');

  await clickByText(page, ".document-tools button", "Whiteboard");
  await page.waitForSelector(".board-canvas");
  inspected += await inspectControls(page, "whiteboard");

  await page.goto(`${baseUrl}#/notebook`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".notebook-page");
  inspected += await inspectControls(page, "notebook");

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page");
  inspected += await inspectControls(page, "review center");
  await clickByText(page, ".review-center-page button", "New card");
  await page.waitForSelector(".review-card-dialog");
  inspected += await inspectControls(page, "review authoring");
  const reviewFields = await page.$$(".review-card-dialog textarea");
  await reviewFields[0].type("Explain a validation split.");
  await reviewFields[1].type("A held-out subset used for model selection.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForSelector(".review-deck-card");
  inspected += await inspectControls(page, "review deck");
  await clickByText(page, ".review-hero button", "Start review");
  await page.waitForSelector(".review-session-page");
  inspected += await inspectControls(page, "review prompt");
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.waitForSelector(".review-ratings");
  inspected += await inspectControls(page, "review grading");

  await page.click('button[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  inspected += await inspectControls(page, "settings");

  assert.equal(runtimeErrors.length, 0, `browser errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(findings.length, 0, `control quality failures:\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  console.log(`Control audit passed: ${inspected} visible controls checked across home, library, reader, actions, teaching, whiteboard, notebook, review, and settings.`);
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
