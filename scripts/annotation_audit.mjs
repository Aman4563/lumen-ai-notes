import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-annotation-profile-"));
const errors = [];
let browser;

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const target = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    target?.click();
    return Boolean(target);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profileDirectory, args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());

  const documentId = "notes/part-01-foundations/01-ai-ml-mental-model.md";
  await page.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body h1");
  const quote = await page.$eval(".markdown-body", (article) => {
    const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 120);
    const textNode = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 40) || paragraph.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(textNode.nodeValue.length, 90));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return range.toString();
  });
  assert.ok(quote.trim().length > 30);
  await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((button) => button.textContent.includes("Highlight selection")));
  await clickByText(page, ".document-tools button", "Highlight selection");
  await page.waitForSelector(".annotation-dialog");
  await page.click(".annotation-color-options .coral");
  await page.select(".annotation-dialog select", "interview");
  await page.type(".annotation-dialog textarea", "Explain the production trade-off without looking.");
  await page.type(".annotation-dialog input", "foundations, interview");
  await clickByText(page, ".annotation-dialog button", "Create highlight");
  await page.waitForSelector(".annotation-dialog", { hidden: true });
  await page.waitForFunction(() => CSS.highlights?.get("lumen-coral")?.size === 1);

  await page.click('button[aria-label="Table of contents"]');
  await clickByText(page, ".side-panel-tabs button", "Highlights");
  await page.waitForSelector(".reader-annotation-card.coral");
  assert.ok((await page.$eval(".reader-annotation-card", (node) => node.textContent)).includes("production trade-off"));
  assert.ok((await page.$eval(".reader-annotation-card", (node) => node.textContent)).includes("interview"));
  await page.$eval('button[aria-label="Edit highlight"]', (button) => button.click());
  await page.waitForSelector(".annotation-dialog");
  await page.click(".annotation-color-options .teal");
  await page.type(".annotation-dialog textarea", " Updated.");
  await clickByText(page, ".annotation-dialog button", "Save changes");
  await page.waitForFunction(() => CSS.highlights?.get("lumen-teal")?.size === 1 && !CSS.highlights?.get("lumen-coral"));

  await page.$eval('button[aria-label="Create review card from highlight"]', (button) => button.click());
  await page.waitForSelector(".review-card-dialog");
  assert.ok((await page.$$eval(".review-card-dialog textarea", (nodes) => nodes[1]?.value || "")).includes(quote.trim().slice(0, 30)));
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await new Promise((resolve) => setTimeout(resolve, 700));

  const persisted = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onsuccess = () => { const get = request.result.transaction("study-data", "readonly").objectStore("study-data").get("profile"); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); };
    request.onerror = () => reject(request.error);
  }));
  assert.equal(persisted.annotations.length, 1);
  assert.equal(persisted.annotations[0].color, "teal");
  assert.equal(persisted.annotations[0].purpose, "interview");
  assert.equal(persisted.reviewItems[0].sourceAnnotationId, persisted.annotations[0].id);
  assert.ok(persisted.annotations[0].prefix.length > 0 || persisted.annotations[0].suffix.length > 0);
  assert.ok(persisted.annotations[0].sourceHash.startsWith("fnv1a-"));

  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => CSS.highlights?.get("lumen-teal")?.size === 1);
  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Annotation audit passed: anchored creation, inline rendering, metadata edit, review conversion, schema, and reload persistence verified.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
