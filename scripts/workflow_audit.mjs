import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";

/**
 * Minimal EPUB fixture (issue #12), zipped by hand: local headers + central
 * directory + EOCD. The importer never checks CRCs, so they stay zero.
 */
const buildAuditEpubBase64 = () => {
  const files = [
    ["META-INF/container.xml", '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/book.opf", '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Audit Field Notes</dc:title></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'],
    ["OEBPS/one.xhtml", "<html><head><title>Optimizers</title></head><body><h1>Optimizers</h1><p>Momentum accumulates a running average of gradients so descent keeps moving through flat regions.</p></body></html>"],
    ["OEBPS/two.xhtml", "<html><head><title>Schedulers</title></head><body><h1>Schedulers</h1><p>Cosine decay anneals the learning rate smoothly toward zero across the training budget.</p></body></html>"],
  ];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf-8");
    const raw = Buffer.from(content, "utf-8");
    const data = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, eocd]).toString("base64");
};

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-workflow-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "lumen-workflow-downloads-"));
const runtimeErrors = [];
let browser;
let acceptDialogs = true;
let nativeDialogs = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(expected));
    node?.click();
    return Boolean(node);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

const readStored = (page, key) => page.evaluate((storageKey) => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readonly");
    const get = transaction.objectStore("study-data").get(storageKey);
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  };
}), key);

// Polls the persisted record until the predicate holds, so assertions target the
// durable IndexedDB state rather than racing the debounced whiteboard save.
const waitForStored = async (page, key, predicate, message, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  do {
    const value = await readStored(page, key).catch(() => null);
    if (value && predicate(value)) return value;
    await delay(150);
  } while (Date.now() < deadline);
  return assert.fail(message);
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
  await page.evaluateOnNewDocument(() => {
    class TestUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }
    const listeners = new Map();
    const synthesis = {
      current: null,
      getVoices: () => [{ name: "Test Voice", lang: "en-IN", voiceURI: "test-voice", default: true, localService: true }],
      speak(utterance) { this.current = utterance; },
      cancel() { this.current = null; },
      pause() {},
      resume() {},
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    };
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: TestUtterance });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__lumenCopiedText = String(value); } } });
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });
  page.on("dialog", (dialog) => {
    nativeDialogs += 1;
    return acceptDialogs ? dialog.accept() : dialog.dismiss();
  });

  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });

  const documentId = "notes/part-01-foundations/01-ai-ml-mental-model.md";
  await page.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body h1", { timeout: 15_000 });
  // READER-13: every lecture tool is on screen on a phone; none hides in an
  // unmarked sideways scroller.
  const hiddenTools = await page.$$eval(".document-tools button", (buttons) => buttons
    .filter((button) => button.getClientRects().length)
    .filter((button) => { const box = button.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth; })
    .map((button) => button.textContent.trim()));
  assert.deepEqual(hiddenTools, [], "lecture tools overflow the phone screen");

  await page.click('button[aria-label="Open menu"]');
  await page.waitForFunction(() => document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.waitForFunction(() => document.querySelector(".app-sidebar")?.getBoundingClientRect().left >= -1);
  assert.equal(await page.$eval('.menu-button', (button) => button.getAttribute("aria-expanded")), "true", "menu did not expose its open state");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close menu", "focus did not enter the opened sidebar");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "opening the mobile sidebar did not lock body scrolling");
  assert.equal(await page.$eval(".app-main", (node) => node.inert), true, "opening the mobile sidebar did not make the background inert");
  await page.click('.sidebar-close');
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.waitForFunction(() => !document.querySelector(".app-main")?.inert);
  assert.equal(await page.$eval('.menu-button', (button) => button.getAttribute("aria-expanded")), "false", "sidebar close did not update menu state");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("menu-button")), true, "closing the sidebar did not return focus to the menu opener");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "closing the sidebar did not restore body scrolling");
  await page.$eval('button[aria-label="Open menu"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.waitForFunction(() => !document.querySelector(".app-main")?.inert);
  await page.$eval('button[aria-label="Open menu"]', (button) => button.click());
  await page.waitForSelector('.sidebar-scrim');
  await page.mouse.click(390, 430);
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.$eval('button[aria-label="Open menu"]', (button) => { button.click(); button.click(); });
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open") && !document.querySelector(".sidebar-scrim"));
  await page.waitForFunction(() => !document.querySelector(".app-main")?.inert);
  await page.$eval('button[aria-label="Open menu"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".app-sidebar")?.getBoundingClientRect().left >= -1);
  await page.click(".sidebar-close");
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open"));
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  // CONTENT-002: the standalone HTML export downloads a self-contained page.
  await page.$eval('button[aria-label="Open lecture actions"]', (button) => button.click());
  await page.waitForSelector(".reader-action-menu");
  await clickByText(page, ".reader-action-grid button", "Export HTML");
  {
    let htmlPath = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !htmlPath) {
      const files = await readdir(downloadDirectory);
      const htmlName = files.find((name) => name.endsWith(".html"));
      if (htmlName) htmlPath = join(downloadDirectory, htmlName);
      else await delay(100);
    }
    assert.ok(htmlPath, "HTML export was not downloaded");
    const exported = await readFile(htmlPath, "utf8");
    assert.match(exported, /^<!doctype html>/);
    assert.ok(exported.includes("Exported from Lumen AI Notes"), "HTML export is missing its provenance footer");
    assert.doesNotMatch(exported, /src="https?:/, "HTML export must not reference external assets");
  }

  // Issue #12: Print / Save PDF opens the browser print dialog over the
  // print stylesheet. Headless Chrome has no dialog, so stub window.print.
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
  await page.$eval('button[aria-label="Open lecture actions"]', (button) => button.click());
  await page.waitForSelector(".reader-action-menu");
  await clickByText(page, ".reader-action-grid button", "Print / Save PDF");
  await page.waitForFunction(() => window.__printCalls === 1, { timeout: 5_000 })
    .catch(() => assert.fail("the Print / Save PDF action did not invoke window.print"));

  // Quick-insert: a lecture selection lands in the AI tutor prompt.
  await page.$eval(".markdown-body", (article) => {
    const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 80);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((button) => button.classList.contains("selection-ready") && button.textContent.includes("Ask AI")), { timeout: 5_000 });
  await clickByText(page, ".document-tools button", "Ask AI");
  await page.waitForSelector(".ai-tutor__composer textarea", { timeout: 20_000 });
  const insertedPrompt = await page.$eval(".ai-tutor__composer textarea", (field) => field.value);
  assert.ok(insertedPrompt.includes("Explain this excerpt"), "the selection was not inserted into the AI prompt");
  await page.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body h1", { timeout: 15_000 });

  await page.$eval('button[aria-label="Open menu"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".app-sidebar")?.classList.contains("open"));
  await clickByText(page, ".sidebar-primary button", "Library");
  await page.waitForSelector(".library-page");
  await page.waitForFunction(() => !document.querySelector(".app-sidebar")?.classList.contains("open") && !document.querySelector(".sidebar-scrim"));
  await page.click('button[aria-label="Open menu"]');
  await clickByText(page, ".sidebar-primary button", "Read");
  await page.waitForSelector(".reader-view");

  await page.click(".markdown-body .code-copy");
  await page.waitForFunction(() => window.__lumenCopiedText?.length > 10);
  assert.ok((await page.evaluate(() => window.__lumenCopiedText)).length > 10, "code copy did not write the code block to the clipboard");

  await clickByText(page, ".document-tools button", "Actions");
  await page.waitForSelector(".reader-action-menu");
  await clickByText(page, ".reader-action-grid button", "Find in lecture");
  await page.waitForSelector(".reader-find input");
  await page.type(".reader-find input", "machine learning");
  await page.waitForFunction(() => document.querySelector(".reader-find > span")?.textContent.includes("/"));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".reader-find", { hidden: true });

  await clickByText(page, ".document-tools button", "Actions");
  await clickByText(page, ".reader-action-grid button", "Mark complete");
  await page.waitForFunction(() => document.querySelector(".complete-label")?.textContent.includes("Completed"));

  await page.click('button[aria-label="Bookmark"]');
  await page.click('button[aria-label="Personal notes"]');
  await page.waitForSelector('.personal-note-panel textarea');
  await page.type('.personal-note-panel textarea', "Use this for the SDE-III systems interview.");
  await page.click('.side-panel-mobile-head button[aria-label="Close panel"]');

  const selection = await page.$eval(".markdown-body", (article) => {
    const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 90);
    if (!paragraph) return "";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return paragraph.textContent.replace(/\s+/g, " ").trim().slice(0, 4_000);
  });
  assert.ok(selection.length > 90, "test lecture did not expose a selectable paragraph");
  await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((button) => button.textContent.includes("Clip selection")));
  await clickByText(page, ".document-tools button", "Clip selection");

  // Use a DOM click here because Safari-style retained text selection can keep
  // a transient native selection layer over the toolbar coordinates.
  await page.$eval('button[aria-label="Listen"]', (button) => button.click());
  await page.waitForSelector(".speech-popover");
  await clickByText(page, ".speech-popover button", "Read");
  await page.waitForSelector('.audio-bar');
  assert.equal(await page.$eval('.audio-bar', (node) => node.getAttribute("aria-label")), "Narration controls");
  await page.$eval('button[aria-label="Pause narration"]', (button) => button.click());
  await page.waitForSelector('button[aria-label="Resume narration"]');
  await page.$eval('button[aria-label="Resume narration"]', (button) => button.click());
  await page.waitForSelector('button[aria-label="Pause narration"]');
  await page.$eval('button[aria-label="Stop narration"]', (button) => button.click());

  await page.$eval(".reader-scroll", (node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.62; node.dispatchEvent(new Event("scroll")); });
  await delay(700);
  // READER-6: the minutes-left estimate is visible, not under the toolbar.
  const timeLeft = await page.$eval(".reading-time-left", (node) => {
    const box = node.getBoundingClientRect();
    return { text: node.textContent, visible: node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
  }).catch(() => null);
  assert.ok(timeLeft?.visible && /min/u.test(timeLeft.text), `the minutes-left estimate is not visible: ${JSON.stringify(timeLeft)}`);
  // A text-size change keeps the passage being read in place instead of
  // jumping to the same scroll fraction of a longer article.
  const readingAnchor = await page.evaluate(() => {
    const top = document.querySelector(".reader-scroll").getBoundingClientRect().top;
    const block = [...document.querySelector(".markdown-body").children].find((node) => node.getBoundingClientRect().bottom > top + 1);
    block.dataset.auditAnchor = "true";
    return Math.round(block.getBoundingClientRect().top - top);
  });
  await page.$eval('button[aria-label="Reading appearance"]', (button) => button.click());
  await page.waitForSelector(".display-popover");
  await page.$eval('.display-popover input[type="range"]', (input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "1.3");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await delay(400);
  const anchorAfterResize = await page.evaluate(() => Math.round(document.querySelector("[data-audit-anchor]").getBoundingClientRect().top - document.querySelector(".reader-scroll").getBoundingClientRect().top));
  assert.ok(Math.abs(anchorAfterResize - readingAnchor) <= 24, `a text-size change moved the reading position (${readingAnchor}px to ${anchorAfterResize}px)`);
  // Restoring the text size re-anchors again. A jump the reader makes
  // itself (Back to top) must end that hold, so late layout, such as a
  // diagram finishing below, cannot pull the page back to the old passage.
  // Reduced motion makes the jump instant and one evaluate keeps every step
  // inside the hold's 900 ms window.
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const afterBackToTop = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const textSize = document.querySelector('.display-popover input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(textSize, "1");
    textSize.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
    document.querySelector('button[aria-label="Open lecture actions"]').click();
    await frame();
    [...document.querySelectorAll(".reader-action-grid button")].find((button) => button.textContent.includes("Back to top")).click();
    await frame();
    const lateLayout = document.createElement("div");
    lateLayout.style.height = "600px";
    document.querySelector(".markdown-body").append(lateLayout);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    lateLayout.remove();
    return Math.round(document.querySelector(".reader-scroll").scrollTop);
  });
  await page.emulateMediaFeatures([]);
  assert.ok(afterBackToTop < 400, `late layout pulled Back to top back to the old passage (scrollTop ${afterBackToTop})`);
  // Return to the 62% reading place that later persistence checks expect.
  await page.$eval(".reader-scroll", (node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.62; node.dispatchEvent(new Event("scroll")); });
  await delay(400);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".display-popover", { hidden: true });

  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".markdown-editor");
  await page.$eval(".markdown-editor", (textarea) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, `${textarea.value}\n\n## Production audit marker\n\nThis edit must persist across a complete reload. Its weights $w^T x$ render as math.\n`);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickByText(page, ".editor-toolbar button", "Save");
  await page.waitForFunction(() => document.querySelector(".markdown-body")?.innerText.includes("Production audit marker"));
  // READER-22: TeX in an edited copy renders through the sanitized KaTeX path.
  await page.waitForSelector(".markdown-body .katex", { timeout: 10_000 })
    .catch(() => assert.fail("TeX in an edited copy did not render as math"));

  // READER-9: Reset asks inside the app before discarding anything, and
  // Keep editing leaves the unsaved draft untouched.
  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".markdown-editor");
  await page.$eval(".markdown-editor", (textarea) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, `${textarea.value}\nUnsaved reset guard marker.\n`);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const dialogsBeforeReset = nativeDialogs;
  await clickByText(page, ".editor-toolbar button", "Reset");
  await page.waitForSelector(".reset-confirm");
  assert.equal(nativeDialogs, dialogsBeforeReset, "Reset used a native dialog instead of the in-app confirmation");
  assert.match(await page.$eval(".reset-confirm", (node) => node.textContent), /unsaved changes/u, "the reset confirmation did not mention the unsaved changes it keeps");
  await clickByText(page, ".reset-confirm button", "Keep editing");
  await page.waitForSelector(".reset-confirm", { hidden: true });
  assert.ok((await page.$eval(".markdown-editor", (node) => node.value)).includes("Unsaved reset guard marker."), "cancelling Reset lost the unsaved draft");
  await clickByText(page, ".document-tools button", "Close editor");
  await page.waitForSelector(".markdown-editor", { hidden: true });

  await clickByText(page, ".document-tools button", "Teach");
  await page.waitForSelector(".teach-mode");
  await page.click('button[aria-label="Hide teaching content for recall"]');
  await page.waitForSelector(".teach-recall");
  await clickByText(page, ".teach-recall button", "Reveal section");
  await page.waitForSelector(".teaching-markdown");
  await page.click('button[aria-label="Increase teaching text size"]');
  await page.click('button[aria-label="Reset teaching timer"]');
  await page.click('button[aria-label="Next section"]');
  assert.ok((await page.$eval(".teach-section-label", (node) => node.textContent)).includes("02"), "teaching mode did not advance sections");
  await page.click('button[aria-label="Exit teaching mode"]');

  await clickByText(page, ".document-tools button", "Whiteboard");
  await page.waitForSelector(".board-canvas");
  const canvasBox = await page.$eval(".board-canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  await page.click('button[aria-label="Straight line"]');
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: canvasBox.left + canvasBox.width * 0.14, y: canvasBox.top + canvasBox.height * 0.14 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: canvasBox.left + canvasBox.width * 0.72, y: canvasBox.top + canvasBox.height * 0.2 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("1 object"));

  await page.click('button[aria-label="Arrow"]');
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.2, canvasBox.top + canvasBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.78, canvasBox.top + canvasBox.height * 0.68, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));
  await page.click('button[aria-label="Clear current page"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("0 objects"));
  await page.click('button[aria-label="Undo"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));

  await page.click('button[aria-label="Text"]');
  await page.mouse.click(canvasBox.left + canvasBox.width * 0.28, canvasBox.top + canvasBox.height * 0.2);
  await page.waitForSelector(".board-text-dialog");
  await page.type('.board-text-dialog textarea', "Gradient flow");
  await clickByText(page, ".board-text-dialog button", "Add to board");
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("3 objects"));

  await page.click('button[aria-label="Sticky note"]');
  await page.mouse.click(canvasBox.left + canvasBox.width * 0.12, canvasBox.top + canvasBox.height * 0.58);
  await page.waitForSelector(".board-text-dialog");
  await page.type('.board-text-dialog textarea', "Explain the optimization trade-off");
  await clickByText(page, ".board-text-dialog button", "Add to board");
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("4 objects"));

  await page.click('button[aria-label="Ellipse"]');
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.42, canvasBox.top + canvasBox.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.72, canvasBox.top + canvasBox.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("5 objects"));

  await page.click('button[aria-label="Select and move objects"]');
  await page.mouse.click(canvasBox.left + canvasBox.width * 0.16, canvasBox.top + canvasBox.height * 0.63);
  await page.waitForSelector('button[aria-label="Duplicate selected object"]');
  await page.click('button[aria-label="Duplicate selected object"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("6 objects"));
  await page.click('button[aria-label="Delete selected object"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("5 objects"));

  await page.click('button[aria-label="Dot background"]');
  await page.click('button[aria-label="Add whiteboard page"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 pages"));
  await page.click('button[aria-label="Duplicate whiteboard page"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("3 pages"));
  await page.$eval('.board-page-controls select', (select) => { select.value = select.options[0].value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("5 objects"));
  await page.click('button[aria-label="Rename whiteboard page"]');
  await page.waitForSelector(".board-rename-dialog input");
  await page.$eval(".board-rename-dialog input", (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "Core concepts");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickByText(page, ".board-rename-dialog button", "Save name");
  await page.waitForFunction(() => document.querySelector(".board-page-controls select")?.selectedOptions[0]?.textContent.includes("Core concepts"));

  // BUG-002 line matrix on the empty page 2: mouse line, pen-pressure line,
  // rejected tap, undo/redo, move/recolor/resize, page-switch + reload
  // persistence, and PNG export.
  const boardKey = `board:${documentId}`;
  await page.$eval(".board-page-controls select", (select) => { select.value = select.options[1].value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("0 objects"));
  await page.click('button[aria-label="Straight line"]');

  await page.mouse.move(canvasBox.left + canvasBox.width * 0.15, canvasBox.top + canvasBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.6, canvasBox.top + canvasBox.height * 0.35, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("1 object"));
  const mouseLineBoard = await waitForStored(page, boardKey, (stored) => stored.pages?.[1]?.objects?.length === 1, "mouse-drawn line was not persisted");
  const mouseLine = mouseLineBoard.pages[1].objects[0];
  assert.equal(mouseLine.tool, "line", "mouse-drawn object is not a line");
  assert.equal(mouseLine.points.length, 2, "mouse-drawn line does not store exactly two points");

  // CDP mouse events with pointerType "pen" reach the page as real pen pointer
  // events; force maps to PointerEvent.pressure (verified: pressure 0.9 arrives).
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: canvasBox.left + canvasBox.width * 0.15, y: canvasBox.top + canvasBox.height * 0.6, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: 0.9 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvasBox.left + canvasBox.width * 0.4, y: canvasBox.top + canvasBox.height * 0.65, button: "left", buttons: 1, pointerType: "pen", force: 0.9 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: canvasBox.left + canvasBox.width * 0.6, y: canvasBox.top + canvasBox.height * 0.7, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));
  const penBoard = await waitForStored(page, boardKey, (stored) => stored.pages?.[1]?.objects?.length === 2, "pen-drawn line was not persisted");
  const penLine = penBoard.pages[1].objects[1];
  assert.equal(penLine.tool, "line", "pen-drawn object is not a line");
  assert.equal(penLine.points.length, 2, "pen-drawn line does not store exactly two points");
  assert.notEqual(penLine.width, mouseLine.width, "pen pressure did not change the stored stroke width, so the pen pointer path was not exercised");

  await page.mouse.move(canvasBox.left + canvasBox.width * 0.8, canvasBox.top + canvasBox.height * 0.85);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Drag across the board"));
  assert.equal(await page.$eval(".toast", (node) => node.getAttribute("role")), "status", "tap-rejection toast is not exposed as a status live region");
  assert.ok((await page.$eval(".board-hint", (node) => node.textContent)).includes("2 objects"), "a rejected zero-length tap changed the object count");

  assert.equal(await page.$eval('button[aria-label="Redo"]', (button) => button.disabled), true, "Redo was enabled before any undo");
  await page.click('button[aria-label="Undo"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("1 object"));
  assert.equal(await page.$eval('button[aria-label="Redo"]', (button) => button.disabled), false, "undoing the pen line did not enable Redo");
  await page.click('button[aria-label="Redo"]');
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));
  assert.equal(await page.$eval('button[aria-label="Redo"]', (button) => button.disabled), true, "Redo did not disable again after restoring the pen line");

  await page.click('button[aria-label="Select and move objects"]');
  const grabX = canvasBox.left + canvasBox.width * 0.375;
  const grabY = canvasBox.top + canvasBox.height * 0.325;
  await page.mouse.click(grabX, grabY);
  await page.waitForSelector('button[aria-label="Duplicate selected object"]');
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + canvasBox.width * 0.1, grabY + canvasBox.height * 0.18, { steps: 5 });
  await page.mouse.up();
  await waitForStored(page, boardKey, (stored) => {
    const object = stored.pages?.[1]?.objects?.find((item) => item.id === mouseLine.id);
    return Boolean(object) && (object.points[0].x !== mouseLine.points[0].x || object.points[0].y !== mouseLine.points[0].y);
  }, "dragging the selected line did not persist moved points");
  await page.click('button[aria-label="Use color #e36f4a"]');
  await waitForStored(page, boardKey, (stored) => stored.pages?.[1]?.objects?.find((item) => item.id === mouseLine.id)?.color === "#e36f4a", "recoloring the selected line was not persisted");
  await page.$eval('input[aria-label="Stroke size"]', (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitForStored(page, boardKey, (stored) => stored.pages?.[1]?.objects?.find((item) => item.id === mouseLine.id)?.width === 8, "resizing the selected line stroke was not persisted");

  // BOARD-001 multi-select: a marquee over both lines selects them, arrows
  // nudge the group, and copy/paste round-trips through the keyboard.
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.05, canvasBox.top + canvasBox.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(canvasBox.left + canvasBox.width * 0.95, canvasBox.top + canvasBox.height * 0.95, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 objects selected"), { timeout: 5_000 })
    .catch(() => assert.fail("the marquee did not select both lines"));
  const beforeNudge = await readStored(page, boardKey);
  const nudgeReference = beforeNudge.pages[1].objects.find((item) => item.id === mouseLine.id).points[0].x;
  await page.keyboard.press("ArrowRight");
  await waitForStored(page, boardKey, (stored) => {
    const moved = stored.pages?.[1]?.objects?.find((item) => item.id === mouseLine.id);
    return Boolean(moved) && Math.abs(moved.points[0].x - nudgeReference - 0.01) < 0.001;
  }, "arrow nudging did not move the selected group by one percent");
  await page.keyboard.down("Control");
  await page.keyboard.press("c");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 objects copied"), { timeout: 5_000 })
    .catch(() => assert.fail("copying the selection did not confirm"));
  await page.keyboard.down("Control");
  await page.keyboard.press("v");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("4 objects"), { timeout: 5_000 })
    .catch(() => assert.fail("pasting did not add the copied objects"));
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"), { timeout: 5_000 })
    .catch(() => assert.fail("deleting the pasted group did not restore the two-line page"));

  // BOARD-003: the SVG export is a valid standalone image of the page.
  await page.click('button[aria-label="Export current whiteboard page as SVG"]');
  {
    let svgPath = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !svgPath) {
      const files = await readdir(downloadDirectory);
      const svgName = files.find((name) => name.endsWith(".svg"));
      if (svgName) svgPath = join(downloadDirectory, svgName);
      else await delay(100);
    }
    assert.ok(svgPath, "whiteboard SVG was not downloaded");
    const svgText = await readFile(svgPath, "utf8");
    assert.match(svgText, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok((svgText.match(/<path |<polyline /g) || []).length >= 2, "the SVG export is missing the drawn lines");
  }

  // BOARD-003 zoom: stepping in changes the level readout; reset restores it.
  assert.equal(await page.$eval('button[aria-label="Zoom out"]', (button) => button.disabled), true, "zoom out must disable at 100%");
  await page.$eval('button[aria-label="Zoom in"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".board-zoom-level")?.textContent === "125%", { timeout: 5_000 })
    .catch(() => assert.fail("zooming in did not reach 125%"));
  await page.$eval('button[aria-label="Reset zoom"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".board-zoom-level")?.textContent === "100%", { timeout: 5_000 })
    .catch(() => assert.fail("reset did not restore the identity view"));

  // Issue #11: lock refuses deletion, z-order reorders persist, snapped lines
  // land on the 24px grid, and the JSON interchange round-trips undoably.
  await page.mouse.click(grabX + canvasBox.width * 0.1, grabY + canvasBox.height * 0.18);
  await page.waitForSelector('button[aria-label="Lock selection"]', { timeout: 5_000 });
  await page.$eval('button[aria-label="Lock selection"]', (button) => button.click());
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("locked"), { timeout: 5_000 })
    .catch(() => assert.fail("deleting a locked object did not refuse with the lock notice"));
  assert.ok((await page.$eval(".board-hint", (node) => node.textContent)).includes("2 objects"), "a locked object was deleted");
  await page.$eval('button[aria-label="Unlock selection"]', (button) => button.click());

  const orderBefore = (await readStored(page, boardKey)).pages[1].objects.map((item) => item.id);
  await page.$eval('button[aria-label="Bring selection forward"]', (button) => button.click());
  await waitForStored(page, boardKey, (stored) => {
    const order = stored.pages[1].objects.map((item) => item.id);
    return JSON.stringify(order) !== JSON.stringify(orderBefore);
  }, "bringing forward did not persist the new z-order");
  await page.$eval('button[aria-label="Send selection backward"]', (button) => button.click());
  await waitForStored(page, boardKey, (stored) => JSON.stringify(stored.pages[1].objects.map((item) => item.id)) === JSON.stringify(orderBefore), "sending backward did not restore the original order");
  await page.keyboard.press("Escape");

  await page.$eval('button[aria-label="Snap to grid"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector('button[aria-label="Snap to grid"]')?.getAttribute("aria-pressed") === "true", { timeout: 5_000 })
    .catch(() => assert.fail("the snap toggle did not arm"));
  await page.$eval('button[aria-label="Straight line"]', (button) => button.click());
  // The canvas rect can differ from the line-matrix measurement (toolbar rows
  // appear and disappear) — measure fresh for both drawing and assertion.
  const snapBox = await page.$eval(".board-canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(snapBox.left + snapBox.width * 0.31, snapBox.top + snapBox.height * 0.11);
  await page.mouse.down();
  await page.mouse.move(snapBox.left + snapBox.width * 0.52, snapBox.top + snapBox.height * 0.23, { steps: 4 });
  await page.mouse.up();
  await waitForStored(page, boardKey, (stored) => stored.pages[1].objects.length === 3, "the snapped line was not persisted");
  {
    const stored = await readStored(page, boardKey);
    const snapped = stored.pages[1].objects[2];
    for (const point of snapped.points) {
      const pixelX = point.x * snapBox.width;
      const pixelY = point.y * snapBox.height;
      assert.ok(Math.abs(pixelX - Math.round(pixelX / 24) * 24) < 0.6, `snapped x ${pixelX} is off-grid`);
      assert.ok(Math.abs(pixelY - Math.round(pixelY / 24) * 24) < 0.6, `snapped y ${pixelY} is off-grid`);
    }
  }
  await page.$eval('button[aria-label="Snap to grid"]', (button) => button.click());
  await page.$eval('button[aria-label="Select and move objects"]', (button) => button.click());
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    buttons.find((node) => node.getAttribute("aria-label") === "Undo")?.click();
  });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));

  // Issue #11: rotation — the handle above a single selection spins the
  // object about its bounds center; hit-testing follows the rotated shape;
  // the SVG export carries the transform.
  {
    const resetDisabled = await page.$eval(".board-zoom-level", (button) => button.disabled);
    if (!resetDisabled) {
      await page.$eval(".board-zoom-level", (button) => button.click());
      await delay(150);
    }
    const rotateBox = await page.$eval(".board-canvas", (canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await page.$eval('button[aria-label="Rectangle"]', (button) => button.click());
    await page.mouse.move(rotateBox.left + rotateBox.width * 0.6, rotateBox.top + rotateBox.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(rotateBox.left + rotateBox.width * 0.8, rotateBox.top + rotateBox.height * 0.7, { steps: 4 });
    await page.mouse.up();
    await waitForStored(page, boardKey, (stored) => stored.pages[1].objects.length === 3, "the rotation-test rectangle was not persisted");
    await page.$eval('button[aria-label="Select and move objects"]', (button) => button.click());
    await page.mouse.click(rotateBox.left + rotateBox.width * 0.7, rotateBox.top + rotateBox.height * 0.65);
    await page.waitForSelector(".board-selection-actions", { timeout: 5_000 });
    // Selecting grows the toolbar and RESIZES the canvas — measure fresh, or
    // every client coordinate below maps to the wrong world point.
    const selectedBox = await page.$eval(".board-canvas", (canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const centerX = selectedBox.left + selectedBox.width * 0.7;
    const centerY = selectedBox.top + selectedBox.height * 0.65;
    // Grab the rotate handle (top-center, 33px above the box) and swing the
    // pointer to due-east of the center: −90° of handle travel = +90° spin.
    const handleY = selectedBox.top + selectedBox.height * 0.6 - 33;
    await page.mouse.move(centerX, handleY);
    await page.mouse.down();
    await page.mouse.move(centerX + 50, (handleY + centerY) / 2, { steps: 3 });
    await page.mouse.move(centerX + 80, centerY, { steps: 5 });
    await page.mouse.up();
    const rotatedBoard = await waitForStored(page, boardKey, (stored) => Math.abs((stored.pages[1].objects[2].rotation || 0) - Math.PI / 2) < 0.05, "the rectangle's rotation did not persist near 90°");
    const rotation = rotatedBoard.pages[1].objects[2].rotation;
    // Hit-test in the rotated frame: a point below center at ~45% of the
    // object's pixel WIDTH is inside the rotated rectangle (its long side is
    // now vertical) but outside the unrotated bounds plus margin. Deselecting
    // resizes the canvas again, so measure a third time.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".board-selection-actions"), { timeout: 5_000 });
    const deselectedBox = await page.$eval(".board-canvas", (canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await page.mouse.click(deselectedBox.left + deselectedBox.width * 0.7, deselectedBox.top + deselectedBox.height * 0.65 + Math.round(deselectedBox.width * 0.09));
    await page.waitForSelector(".board-selection-actions", { timeout: 5_000 })
      .catch(() => assert.fail(`clicking inside the rotated footprint (rotation ${rotation}) did not select the object`));
    // SVG export carries the center-anchored transform.
    const svgExportStarted = Date.now();
    await page.$eval('button[aria-label="Export current whiteboard page as SVG"]', (button) => button.click());
    let rotatedSvg = "";
    const svgDeadline = Date.now() + 10_000;
    while (Date.now() < svgDeadline && !rotatedSvg) {
      for (const name of await readdir(downloadDirectory)) {
        if (!name.endsWith(".svg")) continue;
        const candidate = await readFile(join(downloadDirectory, name), "utf8").catch(() => "");
        if (candidate.includes('transform="rotate(')) rotatedSvg = candidate;
      }
      if (!rotatedSvg) await delay(150);
    }
    assert.ok(rotatedSvg, `no exported SVG carried the rotation transform within ${Date.now() - svgExportStarted}ms`);
    assert.match(rotatedSvg, /transform="rotate\((8[5-9]|9[0-5])\./, "the exported rotation must be near 90 degrees");
    // Clean up: delete the test rectangle so later object-count pins hold.
    await page.keyboard.press("Delete");
    await waitForStored(page, boardKey, (stored) => stored.pages[1].objects.length === 2, "deleting the rotation-test rectangle did not persist");
  }

  await page.$eval('button[aria-label="Export the whole board as JSON"]', (button) => button.click());
  {
    let boardJsonPath = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !boardJsonPath) {
      const files = await readdir(downloadDirectory);
      const name = files.find((file) => file.endsWith("-board.json"));
      if (name) boardJsonPath = join(downloadDirectory, name);
      else await delay(100);
    }
    assert.ok(boardJsonPath, "the board JSON export was not downloaded");
    const exported = JSON.parse(await readFile(boardJsonPath, "utf8"));
    assert.equal(exported.format, "lumen.board.v1");
    assert.ok(exported.pages.length >= 2, "the export must carry every page");
    assert.equal(exported.pages.flatMap((pageEntry) => pageEntry.objects).some((objectEntry) => "id" in objectEntry), false, "object ids must never travel");
    await page.$eval('input[type="file"][accept*="json"]', (input, payload) => {
      const file = new File([payload], "reimport-board.json", { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, JSON.stringify(exported));
    await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("imported"), { timeout: 5_000 })
      .catch(() => assert.fail("importing the board JSON did not confirm"));
    // Empty pages deliberately do not import; expect 3 + the non-empty count.
    const expectedPages = 3 + exported.pages.filter((pageEntry) => pageEntry.objects.length).length;
    await page.waitForFunction((total) => document.querySelector(".board-hint")?.textContent.includes(`${total} pages`), { timeout: 5_000 }, expectedPages)
      .catch(() => assert.fail("imported pages did not append"));
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      buttons.find((node) => node.getAttribute("aria-label") === "Undo")?.click();
    });
    await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("3 pages"), { timeout: 5_000 })
      .catch(() => assert.fail("the board import was not undoable"));
  }

  await page.$eval(".board-page-controls select", (select) => { select.value = select.options[0].value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("5 objects"));
  await page.$eval(".board-page-controls select", (select) => { select.value = select.options[1].value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("2 objects"));
  await waitForStored(page, boardKey, (stored) => stored.activePageId === stored.pages[1].id && stored.pages[1].objects.length === 2, "line-matrix page state was not persisted before reload");
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".board-canvas", { timeout: 15_000 });
  await page.waitForFunction(() => {
    const hint = document.querySelector(".board-hint")?.textContent || "";
    return hint.includes("2 objects") && hint.includes("3 pages");
  }, { timeout: 15_000 });

  await page.click('button[aria-label="Export current whiteboard page as PNG"]');
  let boardPngPath;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = await readdir(downloadDirectory);
    const pngName = files.find((name) => name.endsWith(".png"));
    if (pngName) {
      boardPngPath = join(downloadDirectory, pngName);
      break;
    }
    await delay(100);
  }
  assert.ok(boardPngPath, "whiteboard PNG was not downloaded");
  await delay(150);
  const pngBytes = await readFile(boardPngPath);
  assert.ok(pngBytes.length > 0, "exported whiteboard PNG is empty");
  assert.deepEqual([...pngBytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "exported whiteboard file does not start with the PNG signature");

  await clickByText(page, ".bottom-nav button", "Notebook");
  await page.waitForSelector(".notebook-page");
  const notebookText = await page.$eval(".notebook-page", (node) => node.innerText);
  assert.match(notebookText, /1\s+Bookmarks/);
  assert.match(notebookText, /1\s+Annotations/);
  assert.match(notebookText, /1\s+Edited copies/);
  assert.match(notebookText, /1\s+Clippings/);
  await page.type('.clipping-card textarea', "Connect this excerpt to model-system tradeoffs.");
  await page.click('button[aria-label="Create review card from clipping"]');
  await page.waitForSelector(".review-card-dialog");
  await page.waitForFunction((expected) => (
    [...document.querySelectorAll(".review-card-dialog textarea")][1]?.value.includes(expected)
  ), {}, selection.slice(0, 40));
  const clippingReviewAnswer = await page.$$eval(".review-card-dialog textarea", (nodes) => nodes[1]?.value || "");
  assert.ok(clippingReviewAnswer.includes(selection.slice(0, 40)), `clipping text was not carried into the review answer (received ${clippingReviewAnswer.length} characters)`);
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForSelector(".review-card-dialog", { hidden: true });
  await page.click('button[aria-label="Copy clipping"]');
  await page.waitForFunction((expected) => window.__lumenCopiedText?.includes(expected.slice(0, 40)), {}, selection);
  await page.type(".notebook-search input", "SDE-III systems interview");
  await page.waitForFunction(() => document.querySelectorAll(".note-card").length === 1);
  await page.click('.notebook-search button[aria-label="Clear notebook search"]');

  await clickByText(page, ".notebook-actions button", "New note");
  await page.waitForSelector(".create-note-dialog");
  await page.type('.create-note-dialog input[placeholder*="Transformer"]', "Acceptance Study Note");
  await page.type('.create-note-dialog input[placeholder*="transformers"]', "production, interview");
  await clickByText(page, ".create-note-dialog button", "Create and edit");
  await page.waitForSelector(".markdown-editor", { timeout: 15_000 });
  await page.$eval(".markdown-editor", (textarea) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, "# Acceptance Study Note Updated\n\nA production persistence proof for search and editing.\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickByText(page, ".editor-toolbar button", "Save");

  // CONTENT-001 revisions: the pre-save text became a revision; the history
  // dialog (in the editing surface) diffs it against the current draft and
  // can load it back. Saving closes the editor, so reopen it first.
  await page.waitForFunction(() => !document.querySelector(".editor-toolbar"), { timeout: 5_000 });
  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".editor-toolbar");
  await page.waitForFunction(() => [...document.querySelectorAll(".editor-toolbar button")].some((button) => button.textContent.includes("History (1)")), { timeout: 5_000 })
    .catch(() => assert.fail("saving over existing content did not create a revision"));
  await clickByText(page, ".editor-toolbar button", "History (1)");
  await page.waitForSelector(".revision-dialog");
  // READER-10: the history dialog is modal (focus inside, background inert)
  // and closes on Escape.
  assert.equal(await page.evaluate(() => document.querySelector(".revision-dialog").contains(document.activeElement) && document.querySelector(".reader-scroll").inert), true, "revision history did not take focus or make the reader inert");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".revision-dialog", { hidden: true });
  await clickByText(page, ".editor-toolbar button", "History (1)");
  await page.waitForSelector(".revision-dialog");
  await page.waitForFunction(() => [...document.querySelectorAll(".revision-dialog .diff-line.diff-removed")].some((line) => line.textContent.includes("Start writing here")), { timeout: 5_000 })
    .catch(() => assert.fail("the revision diff did not show the replaced line"));
  await clickByText(page, ".revision-dialog button", "Load into editor");
  await page.waitForFunction(() => document.querySelector(".markdown-editor")?.value.includes("Start writing here"), { timeout: 5_000 })
    .catch(() => assert.fail("loading a revision did not fill the editor"));
  await page.$eval(".markdown-editor", (textarea) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, "# Acceptance Study Note Updated\n\nA production persistence proof for search and editing.\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickByText(page, ".editor-toolbar button", "Save");
  await clickByText(page, ".bottom-nav button", "Notebook");
  await page.waitForFunction(() => document.querySelector(".notebook-page")?.innerText.includes("Acceptance Study Note Updated"));

  await page.$eval('.notebook-actions input[type="file"]', (input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# Uploaded Persistence Proof\n\nUploaded Markdown remains searchable."], "uploaded-proof.md", { type: "text/markdown" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".notebook-page")?.innerText.toLocaleLowerCase().includes("uploaded persistence proof"));
  assert.equal(await page.$$eval(".notebook-document-row", (rows) => rows.length), 2, "created and uploaded document controls were not rendered");
  await page.$eval('.notebook-document-row button[aria-label^="Duplicate"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 3);
  await page.$eval('.notebook-document-row button[aria-label^="Delete"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 2);

  // DATA-003 recoverable trash: the deleted duplicate sits in the 30-day
  // trash, restores under a fresh id, and delete-forever really removes it.
  await page.waitForSelector(".notebook-trash .trash-row", { timeout: 5_000 });
  const trashCopy = await page.$eval(".notebook-trash .trash-row", (node) => node.textContent);
  assert.ok(trashCopy.includes("copy") && trashCopy.includes("30 days left"), `trash row did not show title and retention: ${trashCopy}`);
  await clickByText(page, ".notebook-trash .trash-row button", "Restore");
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 3, { timeout: 5_000 })
    .catch(() => assert.fail("restoring from trash did not return the document to the notebook"));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".notebook-document-row")].find((node) => node.textContent.includes("copy"));
    row?.querySelector('button[aria-label^="Delete"]')?.click();
  });
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 2);
  await page.$eval('.notebook-trash button[aria-label$="forever"]', (button) => button.click());
  await page.waitForFunction(() => !document.querySelector(".notebook-trash"), { timeout: 5_000 })
    .catch(() => assert.fail("delete-forever did not empty the trash"));

  // CONTENT-001 duplicate detection: identical content is skipped, not doubled.
  await page.$eval('.notebook-actions input[type="file"]', (input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# Uploaded Persistence Proof\n\nUploaded Markdown remains searchable."], "uploaded-proof-again.md", { type: "text/markdown" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("duplicate"), { timeout: 5_000 })
    .catch(() => assert.fail("a duplicate upload did not warn"));
  assert.equal(await page.$$eval(".notebook-document-row", (rows) => rows.length), 2, "a duplicate upload must not grow the notebook");

  // CONTENT-001 organize: rename, pin, and a new collection with filter chips.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".notebook-document-row")].find((node) => node.textContent.includes("Acceptance Study Note Updated"));
    row?.querySelector('button[aria-label^="Organize"]')?.click();
  });
  await page.waitForSelector(".manage-doc-dialog");
  await page.$eval(".manage-doc-dialog input.text-input", (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "Acceptance Study Note Organized");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.select(".manage-doc-dialog select", "__new__");
  await page.type('.manage-doc-dialog input[placeholder*="Interview prep"]', "Interview prep");
  await page.$eval('.manage-doc-dialog .setting-toggle input[type="checkbox"]', (input) => input.click());
  await clickByText(page, ".manage-doc-dialog button", "Save");
  await page.waitForFunction(() => document.querySelector(".notebook-page")?.innerText.includes("Acceptance Study Note Organized"), { timeout: 5_000 });
  await page.waitForSelector(".collection-chips");
  await page.waitForFunction(() => [...document.querySelectorAll(".collection-chips button")].some((chip) => chip.textContent.includes("Interview prep (1)")), { timeout: 5_000 })
    .catch(async () => {
      const chips = await page.$$eval(".collection-chips button", (nodes) => nodes.map((node) => node.textContent));
      const stored = await readStored(page, "profile");
      assert.fail(`collection chip missing; chips=${JSON.stringify(chips)} collections=${JSON.stringify(stored?.collections)} docs=${JSON.stringify((stored?.customDocuments || []).map((doc) => ({ title: doc.title, collectionId: doc.collectionId })))}`);
    });
  await clickByText(page, ".collection-chips button", "Interview prep (1)");
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 1);
  assert.ok(await page.$(".pinned-marker"), "the pinned marker did not render");
  await clickByText(page, ".collection-chips button", "All (2)");
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 2);
  assert.ok((await page.$eval(".notebook-document-row", (node) => node.textContent)).includes("Organized"), "the pinned document must sort first");

  // Archive hides from the default list but stays reachable via the chip.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".notebook-document-row")].find((node) => node.textContent.includes("Uploaded Persistence Proof"));
    row?.querySelector('button[aria-label^="Organize"]')?.click();
  });
  await page.waitForSelector(".manage-doc-dialog");
  await page.$eval(".manage-doc-dialog .setting-toggle:last-of-type input", (input) => input.click());
  await clickByText(page, ".manage-doc-dialog button", "Save");
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length === 1, { timeout: 5_000 })
    .catch(() => assert.fail("archiving did not hide the document from the default list"));
  await clickByText(page, ".collection-chips button", "Archived (1)");
  await page.waitForFunction(() => document.querySelector(".notebook-page")?.innerText.includes("Uploaded Persistence Proof"));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".notebook-document-row")].find((node) => node.textContent.includes("Uploaded Persistence Proof"));
    row?.querySelector('button[aria-label^="Organize"]')?.click();
  });
  await page.waitForSelector(".manage-doc-dialog");
  await page.$eval(".manage-doc-dialog .setting-toggle:last-of-type input", (input) => input.click());
  await clickByText(page, ".manage-doc-dialog button", "Save");
  await page.waitForFunction(() => document.querySelectorAll(".collection-chips button").length === 2, { timeout: 5_000 });

  // The archive round-trip leaves the (now empty) Archived filter active;
  // return to All so new uploads are visible.
  await clickByText(page, ".collection-chips button", "All (");
  // Issue #12: HTML upload converts to Markdown; the link audit reports a
  // broken internal link; batch select archives and restores two documents.
  await page.$eval('.notebook-actions input[type="file"]', (input) => {
    const html = "<html><head><title>HTML Import Proof</title></head><body><h1>HTML Import Proof</h1><p>Converted <strong>cleanly</strong>.</p><p><a href=\"./missing-lecture.md\">a broken internal link</a></p><script>evil()</scr" + "ipt></body></html>";
    const transfer = new DataTransfer();
    transfer.items.add(new File([html], "import-proof.html", { type: "text/html" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".notebook-page")?.innerText.includes("HTML Import Proof"), { timeout: 5_000 })
    .catch(() => assert.fail("the HTML upload did not import"));
  {
    const stored = await waitForStored(page, "profile", (profile) => profile.customDocuments.some((doc) => doc.title === "HTML Import Proof"), "the converted document was not persisted");
    const imported = stored.customDocuments.find((doc) => doc.title === "HTML Import Proof");
    assert.ok(imported.raw.includes("**cleanly**"), "HTML did not convert to Markdown emphasis");
    assert.equal(imported.raw.includes("evil()"), false, "script content leaked through the importer");
  }
  await clickByText(page, ".notebook-heading-actions button", "Check links");
  await page.waitForSelector(".link-report.has-findings", { timeout: 5_000 });
  assert.ok((await page.$eval(".link-report", (node) => node.textContent)).includes("missing-lecture.md"), "the link audit missed the broken link");
  await page.$eval('.link-report button[aria-label="Dismiss link report"]', (button) => button.click());

  await clickByText(page, ".notebook-heading-actions button", "Select");
  await page.$$eval(".batch-check input", (boxes) => boxes.slice(0, 2).forEach((box) => box.click()));
  await page.waitForSelector(".batch-toolbar", { timeout: 5_000 });
  await clickByText(page, ".batch-toolbar button", "Archive");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 documents updated"), { timeout: 5_000 })
    .catch(() => assert.fail("batch archive did not confirm"));
  await clickByText(page, ".collection-chips button", "Archived");
  await page.waitForFunction(() => document.querySelectorAll(".notebook-document-row").length >= 2, { timeout: 5_000 });
  await clickByText(page, ".notebook-heading-actions button", "Select");
  await page.$$eval(".batch-check input", (boxes) => boxes.slice(0, 2).forEach((box) => box.click()));
  await page.waitForSelector(".batch-toolbar");
  await page.evaluate(() => {
    const select = document.querySelector('.batch-toolbar select[aria-label="Assign selection to a collection"]');
    select.value = "__none__";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 documents updated"), { timeout: 5_000 });
  // Unarchive them back (the toolbar flips to Unarchive in the archived view).
  await clickByText(page, ".notebook-heading-actions button", "Select");
  await page.$$eval(".batch-check input", (boxes) => boxes.slice(0, 2).forEach((box) => box.click()));
  await page.waitForSelector(".batch-toolbar");
  await clickByText(page, ".batch-toolbar button", "Unarchive");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 documents updated"), { timeout: 5_000 });
  await clickByText(page, ".collection-chips button", "All (");

  // Issue #12: an EPUB fans out to one document per spine chapter through
  // the dependency-free zip reader, and the toast carries the book report.
  await page.$eval('.notebook-actions input[type="file"]', (input, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "field-notes.epub", { type: "application/epub+zip" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, buildAuditEpubBase64());
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("2 chapters"), { timeout: 5_000 })
    .catch(() => assert.fail("the EPUB upload did not report its chapters"));
  {
    const stored = await waitForStored(page, "profile", (profile) => profile.customDocuments.some((doc) => doc.title === "Audit Field Notes: Schedulers"), "EPUB chapters were not persisted");
    const chapterOne = stored.customDocuments.find((doc) => doc.title === "Audit Field Notes: Optimizers");
    assert.ok(chapterOne, "the first spine chapter is missing");
    assert.ok(chapterOne.raw.includes("# Optimizers"), "EPUB XHTML did not convert to Markdown");
    assert.deepEqual(chapterOne.tags, ["epub"], "EPUB documents must carry the epub tag");
  }

  // Issues #7/#17: the device-evidence page probes capabilities, records a
  // manual verdict, and downloads a dated report.
  await page.goto(`${baseUrl}#/device-evidence`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".evidence-grid", { timeout: 10_000 });
  const evidenceText = (await page.$eval(".device-evidence-page", (node) => node.innerText)).toLocaleLowerCase();
  assert.ok(evidenceText.includes("secure context"), "auto checks did not render");
  assert.ok(evidenceText.includes("speech voices"), "the voice inventory row is missing");
  // Assisted check (machine-verified): run it and drive the mocked synthesis
  // to completion — the page must record its own pass with the voice used.
  await clickByText(page, ".evidence-assisted button", "Run speech check");
  await page.waitForFunction(() => window.speechSynthesis?.current, { timeout: 5_000 });
  await page.evaluate(() => window.speechSynthesis.current.onend());
  await page.waitForFunction(() => document.querySelector(".evidence-assisted-verdict")?.textContent.includes("pass"), { timeout: 5_000 })
    .catch(() => assert.fail("the assisted speech check did not record its own verdict"));
  await page.evaluate(() => {
    const check = document.querySelector(".evidence-checklist .evidence-check");
    [...check.querySelectorAll(".evidence-verdict button")].find((button) => button.textContent.includes("Pass"))?.click();
  });
  await page.type(".evidence-checklist .evidence-check .text-input", "desktop-audit smoke entry");
  // Simulate a failed endpoint explicitly: the same audit also runs against
  // the integrated server, where a real report upload should succeed.
  await page.setRequestInterception(true);
  const failEvidenceUpload = (request) => {
    if (new URL(request.url()).pathname === "/api/evidence") {
      void request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    } else void request.continue();
  };
  page.on("request", failEvidenceUpload);
  await clickByText(page, ".evidence-actions button", "Send report to the Mac");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Could not reach the Mac"), { timeout: 5_000 })
    .catch(() => assert.fail("the send action did not report its failure honestly"));
  await page.setRequestInterception(false);
  page.off("request", failEvidenceUpload);
  await clickByText(page, ".evidence-actions button", "Download JSON");
  {
    let evidencePath = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !evidencePath) {
      const files = await readdir(downloadDirectory);
      const name = files.find((file) => file.startsWith("lumen-device-evidence-") && file.endsWith(".json"));
      if (name) evidencePath = join(downloadDirectory, name);
      else await delay(100);
    }
    assert.ok(evidencePath, "the evidence report was not downloaded");
    const report = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.equal(report.format, "lumen.device-evidence.v1");
    assert.equal(typeof report.auto.secureContext, "boolean");
    assert.ok(report.auto.voices.total >= 1, "the voice inventory must reflect the mocked voice");
    const first = report.manual[0];
    assert.equal(first.result, "pass");
    assert.equal(first.verifiedBy, "human");
    assert.equal(first.note, "desktop-audit smoke entry");
    assert.ok(report.manual.length >= 8, "every tracker checklist item must be in the report");
    assert.ok(report.manual.slice(1).every((entry) => entry.result === "" && entry.verifiedBy === ""), "unanswered checks must export empty, never fabricated");
    const speechAssist = report.assisted.find((entry) => entry.id === "speech-liveness");
    assert.equal(speechAssist.result, "pass", "the assisted speech verdict must ride the report");
    assert.equal(speechAssist.verifiedBy, "automation");
    assert.ok(speechAssist.note.includes("on-device"), "the assisted note must name the voice class used");
  }
  await clickByText(page, ".bottom-nav button", "Notebook");
  await page.waitForSelector(".notebook-page");

  // DATA-003 activity ledger: the Home panel narrates the content operations.
  await clickByText(page, ".bottom-nav button", "Home");
  await page.waitForSelector(".activity-list", { timeout: 5_000 });
  const activityText = await page.$eval(".activity-list", (node) => node.innerText);
  assert.ok(activityText.includes("narchived 2 documents") && activityText.includes("Uploaded"), `activity ledger is missing the recent batch and upload entries: ${activityText.slice(0, 200)}`);
  await clickByText(page, ".bottom-nav button", "Notebook");
  await page.waitForSelector(".notebook-page");

  await clickByText(page, ".bottom-nav button", "Library");
  await page.waitForSelector(".library-search input");
  await page.click('button[aria-label="List layout"]');
  assert.ok(await page.$(".document-grid.list-layout"), "library list layout did not activate");
  await page.type(".library-search input", "Uploaded Persistence Proof");
  await page.waitForFunction(() => document.querySelector(".library-results-meta")?.textContent.includes("1 results"));
  assert.equal(await page.$eval('.library-view-controls select', (select) => select.selectedOptions[0].textContent), "Relevance", "search did not default to relevance sorting");
  await page.select('.library-view-controls select', "title");
  // Library search now resolves asynchronously in a Web Worker after the corpus
  // lazy-loads, so wait for the uploaded title instead of asserting immediately.
  await page.waitForFunction(
    () => document.querySelector(".document-grid")?.innerText.includes("Uploaded Persistence Proof"),
    { timeout: 10_000 },
  ).catch(() => assert.fail("uploaded document was not searchable"));

  // SEARCH-001 advanced lexical slice: saved searches, typo tolerance,
  // exclusions, and highlighted snippets.
  await page.click('button[aria-label="Save this search"]');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Remove this saved search"]'), { timeout: 5_000 });
  await page.click('button[aria-label="Clear search"]');
  await page.waitForSelector(".library-search-shortcuts", { timeout: 5_000 });
  assert.ok(
    (await page.$eval(".library-search-shortcuts", (node) => node.textContent)).includes("Uploaded Persistence Proof"),
    "the saved search chip did not appear",
  );
  await page.$$eval(".library-search-shortcuts .search-chip button", (nodes) => nodes.find((node) => node.getAttribute("aria-label")?.startsWith("Run saved search"))?.click());
  await page.waitForFunction(
    () => document.querySelector(".library-search input")?.value === "Uploaded Persistence Proof"
      && document.querySelector(".document-grid")?.innerText.includes("Uploaded Persistence Proof"),
    { timeout: 10_000 },
  );
  await page.click('button[aria-label="Grid layout"]');
  await page.waitForFunction(() => Boolean(document.querySelector(".document-card mark")), { timeout: 5_000 })
    .catch(() => assert.fail("matched search terms were not highlighted in the snippet"));

  // A one-character typo in a long term must still find the document.
  await page.click('button[aria-label="Clear search"]');
  await page.type(".library-search input", "Uploaded Persistance Proof");
  await page.waitForFunction(
    () => document.querySelector(".document-grid")?.innerText.includes("Uploaded Persistence Proof"),
    { timeout: 10_000 },
  ).catch(() => assert.fail("typo tolerance did not surface the uploaded document"));

  // The -term operator excludes documents containing the term.
  await page.click('button[aria-label="Clear search"]');
  await page.type(".library-search input", "uploaded -persistence");
  await page.waitForFunction(
    () => {
      const grid = document.querySelector(".document-grid")?.innerText || "";
      const meta = document.querySelector(".library-results-meta")?.textContent || "";
      return meta.length > 0 && !grid.includes("Uploaded Persistence Proof");
    },
    { timeout: 10_000 },
  ).catch(() => assert.fail("-term exclusion still returned the excluded document"));
  // Field filters, plural folding, and per-Part facet counts (Wave 8).
  await page.click('button[aria-label="Clear search"]');
  await page.type(".library-search input", "title:uploaded");
  await page.waitForFunction(
    () => document.querySelector(".library-results-meta")?.textContent.includes("1 results")
      && document.querySelector(".document-grid")?.innerText.includes("Uploaded Persistence Proof"),
    { timeout: 10_000 },
  ).catch(() => assert.fail("the title: field filter did not restrict to title matches"));
  await page.click('button[aria-label="Clear search"]');
  await page.type(".library-search input", "gradients");
  await page.waitForFunction(
    () => (document.querySelector(".document-grid")?.innerText || "").toLocaleLowerCase().includes("gradient"),
    { timeout: 10_000 },
  ).catch(() => assert.fail("plural folding did not match the singular form"));
  await page.waitForSelector(".library-facets", { timeout: 5_000 });
  const facetLabel = await page.$eval(".library-facets button", (node) => node.textContent);
  assert.match(facetLabel, /Part \d+\s*\d+/, `facet chips must show a part and its count, saw “${facetLabel}”`);
  await page.$eval(".library-facets button", (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".filter-row button.active")?.textContent !== "All", { timeout: 5_000 })
    .catch(() => assert.fail("clicking a facet chip did not focus its Part"));
  await page.$$eval(".filter-row button", (nodes) => nodes.find((node) => node.textContent === "All")?.click());
  await page.click('button[aria-label="Clear search"]');
  // The worker caps ranked results at 100, while the pre-search candidate list
  // shows every document — wait for a settled (capped) count before reading,
  // and require two identical consecutive reads: while the background index
  // is still filling, early queries return partial counts that then grow.
  const settledResultCount = async () => {
    await page.waitForFunction(() => {
      const match = document.querySelector(".library-results-meta")?.textContent.match(/(\d+) results/);
      return match && Number(match[1]) <= 100;
    }, { timeout: 10_000 });
    let previous = -1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await page.$eval(".library-results-meta", (node) => Number(node.textContent.match(/(\d+) results/)?.[1] || 0));
      if (current === previous) return current;
      previous = current;
      await delay(500);
    }
    return previous;
  };
  let formulaCount = 0;
  let plainCount = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.type(".library-search input", "has:formula attention");
    formulaCount = await settledResultCount();
    await page.click('button[aria-label="Clear search"]');
    await page.type(".library-search input", "attention");
    plainCount = await settledResultCount();
    if (formulaCount > 0 && formulaCount <= plainCount) break;
    // Index still filling between the two reads — clear and try again.
    await page.click('button[aria-label="Clear search"]');
    await delay(1_000);
  }
  assert.ok(formulaCount > 0 && formulaCount <= plainCount, `has:formula must narrow results (${formulaCount} of ${plainCount})`);

  await page.click('button[aria-label="Clear search"]');
  await page.$$eval(".library-search-shortcuts .search-chip button", (nodes) => nodes.find((node) => node.getAttribute("aria-label")?.startsWith("Remove saved search"))?.click());
  await page.waitForFunction(() => !document.querySelector('.library-search-shortcuts .search-chip button[aria-label^="Remove saved search"]'), { timeout: 5_000 });
  await page.type(".library-search input", "Uploaded Persistence Proof");
  await page.waitForFunction(() => document.querySelector(".document-grid")?.innerText.includes("Uploaded Persistence Proof"), { timeout: 10_000 });
  await page.select('.library-view-controls select', "title");

  await page.$eval(".document-grid .document-card", (node) => node.click());
  await page.waitForSelector(".reader-view");
  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".markdown-editor");
  await page.type(".markdown-editor", "\nUnsaved navigation guard marker.");
  acceptDialogs = false;
  await page.goBack({ waitUntil: "domcontentloaded" });
  await delay(250);
  assert.ok(await page.$(".markdown-editor"), "canceling Back did not preserve the dirty editor");
  assert.ok(new URL(page.url()).hash.startsWith("#/read/"), "canceling Back did not restore the reader route");
  acceptDialogs = true;
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".library-page");
  assert.equal(new URL(page.url()).hash, "#/library", "browser Back did not restore the prior application route");

  await clickByText(page, ".bottom-nav button", "Notebook");
  await delay(900);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".notebook-page");
  const reloadedText = await page.$eval(".notebook-page", (node) => node.innerText);
  assert.ok(reloadedText.includes("Acceptance Study Note Organized"), "created note (renamed via Organize) did not survive reload");
  assert.ok(reloadedText.toLocaleLowerCase().includes("uploaded persistence proof"), "uploaded note did not survive reload");
  assert.ok(reloadedText.includes("SDE-III systems interview"), "personal note did not survive reload");

  await page.click('button[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  await clickByText(page, ".settings-drawer button", "Export backup");
  let backupPath;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = await readdir(downloadDirectory);
    const backupName = files.find((name) => name.startsWith("lumen-notes-backup-") && name.endsWith(".json"));
    if (backupName) {
      backupPath = join(downloadDirectory, backupName);
      break;
    }
    await delay(100);
  }
  assert.ok(backupPath, "backup JSON was not downloaded");
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.format, "lumen-ai-notes-backup");
  assert.equal(backup.version, 4);
  assert.equal(backup.profileVersion, 4);
  assert.equal(backup.integrity.algorithm, "SHA-256");
  assert.equal(backup.integrity.cryptographic, true);
  assert.match(backup.integrity.digest, /^[0-9a-f]{64}$/);
  assert.equal(backup.summary.counts.customDocuments, 5, "created + uploaded + the HTML import proof + two EPUB chapters");
  assert.ok(backup.data.profile.clippings.length === 1, "backup omitted clippings");
  assert.equal(backup.data.profile.clippings[0].note, "Connect this excerpt to model-system tradeoffs.");
  assert.equal(backup.data.profile.reviewItems.length, 1, "backup omitted the source-linked review card");
  assert.equal(backup.data.profile.reviewItems[0].sourceClippingId, backup.data.profile.clippings[0].id, "review card lost its clipping source link");
  assert.ok(backup.data.profile.customDocuments.length === 5, "backup omitted created, uploaded, HTML-imported, or EPUB notes");

  // Issue #14 (SYNC-001): create a vault, export this device's sync file,
  // then fold a peer's file end to end — vault admission, decrypt, merge,
  // and idempotent re-import all proven against the real UI.
  const vaultPassphrase = "orbit-lantern-42-vault";
  await page.$eval('.sync-card input[type="password"]', (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, vaultPassphrase);
  await clickByText(page, ".sync-card button", "Create sync vault");
  await page.waitForSelector(".sync-status-line", { timeout: 5_000 });
  await clickByText(page, ".sync-card button", "Export my sync file");
  let syncFilePath = "";
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !syncFilePath) {
      const files = await readdir(downloadDirectory);
      const name = files.find((entry) => entry.endsWith(".lumenc"));
      if (name) syncFilePath = join(downloadDirectory, name);
      else await delay(150);
    }
  }
  assert.ok(syncFilePath, "the sync file did not download");
  const { decryptBackupFile, encryptBackupJson, readEncryptedHeader } = await import("../src/lib/backupCrypto.js");
  const { createBackup, preflightBackup } = await import("../src/lib/backup.js");
  const syncBytes = new Uint8Array(await readFile(syncFilePath));
  const syncHeader = readEncryptedHeader(syncBytes).header;
  assert.equal(syncHeader.format, "lumen.backup.enc.v2", "sync files must use the v2 container");
  assert.ok(syncHeader.vaultId && syncHeader.deviceId, "sync headers carry vault and device identity");
  assert.ok(syncFilePath.endsWith(`${syncHeader.deviceId}.lumenc`), "the file is named after its writing device");
  const syncChecked = await preflightBackup(await decryptBackupFile(syncBytes.buffer, vaultPassphrase));
  const peerRecords = {
    ...syncChecked.data,
    profile: {
      ...syncChecked.data.profile,
      customDocuments: [
        { id: "custom/peer-sync.md", title: "Synced Over The Vault", raw: "# Synced Over The Vault\n\nWritten on the peer device.", createdAt: "2026-09-02T09:00:00.000Z", updatedAt: "2026-09-02T09:00:00.000Z", tags: [] },
        ...syncChecked.data.profile.customDocuments,
      ],
    },
  };
  const peerBackup = await createBackup(peerRecords, { exportedAt: new Date().toISOString(), secureContext: true });
  const peerEncrypted = await encryptBackupJson(peerBackup.json, vaultPassphrase, { vaultId: syncHeader.vaultId, deviceId: "peer-device-0001", iterations: 100_000 });
  const peerPath = join(downloadDirectory, "peer-device-0001.lumenc");
  await writeFile(peerPath, Buffer.concat(peerEncrypted.blobParts.map((part) => Buffer.from(part))));
  const syncInput = await page.$('.sync-card input[type="file"]');
  await syncInput.uploadFile(peerPath);
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Merged 1 peer file"), { timeout: 20_000 })
    .catch(() => assert.fail("the peer sync file did not fold in"));
  await waitForStored(page, "profile", (profile) => profile.customDocuments.some((doc) => doc.id === "custom/peer-sync.md"), "the peer's document did not arrive through sync");
  // Idempotence: folding the same peer file again must not duplicate.
  // Dismiss the first toast so the wait below sees the SECOND import's toast.
  await page.$eval('.toast button[aria-label="Dismiss notification"]', (button) => button.click());
  await page.waitForFunction(() => !document.querySelector(".toast"), { timeout: 5_000 });
  await syncInput.uploadFile(peerPath);
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Export your sync file now"), { timeout: 20_000 });
  {
    const stored = await readStored(page, "profile");
    assert.equal(stored.customDocuments.filter((doc) => doc.title === "Synced Over The Vault").length, 1, "re-importing the same sync file duplicated records");
    assert.equal(stored.customDocuments.length, 6, "sync fold changed unrelated documents");
  }

  await clickByText(page, ".theme-choices button", "Night");
  await clickByText(page, ".settings-drawer button", "Restore reading defaults");
  assert.ok(await page.$('.theme-choices button.active:nth-child(1)'), "reading defaults did not restore the system theme");
  await clickByText(page, ".settings-drawer button", "Show installation steps");
  await page.waitForSelector(".install-sheet");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".install-sheet", { hidden: true });

  const storedProfile = await readStored(page, "profile");
  const storedBoard = await readStored(page, `board:${documentId}`);
  assert.ok(storedProfile.bookmarks.includes(documentId), "bookmark was not persisted");
  assert.equal(storedProfile.personalNotes[documentId], "Use this for the SDE-III systems interview.");
  assert.ok(storedProfile.edits[documentId].includes("Production audit marker"), "edited source was not persisted");
  assert.ok(storedProfile.progress[documentId] >= 0.6, "maximum reading progress was not persisted");
  assert.ok(storedProfile.readingPositions[documentId] >= 0.6, "reading position was not persisted");
  assert.equal(storedProfile.clippings.length, 1);
  assert.equal(storedProfile.customDocuments.length, 6, "5 local + 1 arrived through the sync vault");
  assert.equal(storedBoard.version, 2, "whiteboard was not stored in the versioned document format");
  assert.equal(storedBoard.background, "dots", "whiteboard background was not persisted");
  assert.equal(storedBoard.pages.length, 3, "whiteboard pages were not persisted");
  assert.equal(storedBoard.pages[0].name, "Core concepts", "whiteboard page rename was not persisted");
  assert.equal(storedBoard.pages[0].objects.length, 5, "advanced whiteboard objects were not persisted");
  assert.ok(storedBoard.pages[0].objects.some((object) => object.tool === "line" && object.points.length === 2), "touch-drawn straight line was not persisted");
  const lineMatrixObjects = storedBoard.pages[1].objects;
  assert.equal(lineMatrixObjects.length, 2, "line-matrix page did not persist both lines");
  assert.ok(lineMatrixObjects.every((object) => object.tool === "line" && object.points.length === 2), "line-matrix page contains a non two-point line object");
  const storedMouseLine = lineMatrixObjects.find((object) => object.id === mouseLine.id);
  const storedPenLine = lineMatrixObjects.find((object) => object.id === penLine.id);
  assert.equal(storedMouseLine.color, "#e36f4a", "recolored line did not survive to the end of the session");
  assert.equal(storedMouseLine.width, 8, "resized line stroke did not survive to the end of the session");
  assert.notEqual(storedPenLine.width, mouseLine.width, "pen-pressure stroke width did not survive to the end of the session");
  // Issue #9: a per-Part readiness check builds from the learner's own cards,
  // grades with the self rubric, records an assessment, and feeds misses into
  // the mistake notebook.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onsuccess = () => {
        const profile = get.result;
        const stamp = new Date().toISOString();
        // Part 02 has no cards from earlier flows, so the pool is exactly
        // these four: three prose answers (choice questions — each has three
        // distinct distractors) plus one numeric answer (auto-graded).
        const partDoc = "notes/part-02-mathematics/01-notation-algebra-functions.md";
        profile.reviewItems = [...(profile.reviewItems || []), ...[1, 2, 3, 4].map((index) => ({
          id: `readiness-card-${index}`,
          type: "basic",
          front: `Readiness prompt ${index}?`,
          back: index === 4 ? "42" : `Readiness answer ${index}`,
          documentId: partDoc,
          tags: [],
          suspended: false,
          archived: false,
          buriedOnDay: "",
          dueAt: stamp,
          intervalDays: 1,
          ease: 2.5,
          repetitions: 1,
          reviewCount: 1,
          lapses: 0,
          createdAt: stamp,
          updatedAt: stamp,
          lastReviewedAt: stamp,
        }))];
        store.put(profile, "profile");
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await clickByText(page, ".bottom-nav button", "Home");
  await page.waitForSelector(".mastery-grid");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".mastery-row")].find((node) => node.querySelector(".mastery-part")?.textContent === "02");
    row?.querySelector(".mastery-check")?.click();
  });
  await page.waitForSelector(".assessment-dialog", { timeout: 5_000 });
  await clickByText(page, ".assessment-dialog button", "Start");
  // Answer helper: choice questions pick right/wrong by text; the numeric
  // question types a tolerant variant of the answer ("42.0" for "42").
  const answerRound = async (wrongOnQuestions) => {
    for (let answered = 0; answered < 4; answered += 1) {
      await page.waitForFunction(() => document.querySelector(".assessment-options") || document.querySelector(".assessment-numeric"), { timeout: 5_000 });
      if (await page.$(".assessment-numeric")) {
        await page.$eval(".assessment-numeric input", (input, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, wrongOnQuestions.has(answered) ? "41" : "42.0");
        await clickByText(page, ".assessment-numeric button", "Submit answer");
        continue;
      }
      const prompt = await page.$eval(".assessment-prompt", (node) => node.textContent);
      const cardNumber = prompt.match(/Readiness prompt (\d)/)?.[1];
      await page.$$eval(".assessment-option", (options, expected) => {
        const right = options.find((option) => option.textContent.trim() === expected);
        const wrong = options.find((option) => option.textContent.trim() !== expected);
        (expected ? right : wrong)?.click();
      }, wrongOnQuestions.has(answered) ? "" : `Readiness answer ${cardNumber}`);
      await clickByText(page, ".assessment-options .button", "Submit answer");
    }
    await page.waitForFunction(() => document.querySelector(".assessment-dialog h2")?.textContent.includes("%"), { timeout: 5_000 });
  };
  // Round 1: miss two of four (questions 2 and 3) → 50%.
  await answerRound(new Set([1, 2]));
  assert.ok((await page.$eval(".assessment-dialog", (node) => node.textContent)).includes("2 misses added to your mistake notebook"), "misses did not report to the notebook");
  assert.equal((await page.$$(".assessment-missed-link")).length, 2, "each missed question must link its source lecture");
  // Retry (issue #9): same frozen questions, a fresh attempt, all correct.
  await clickByText(page, ".assessment-dialog button", "Retry this check");
  await answerRound(new Set());
  assert.ok((await page.$eval(".assessment-dialog h2", (node) => node.textContent)).includes("100%"), "the retry round must score 100%");
  await clickByText(page, ".assessment-dialog button", "Done");
  const assessedProfile = await waitForStored(page, "profile", (stored) => (stored.assessments || []).length === 2, "both assessment attempts must persist");
  const percents = assessedProfile.assessments.map((record) => record.percent).sort((left, right) => left - right);
  assert.deepEqual(percents, [50, 100], "the two attempts must score 50% then 100%");
  assert.ok(assessedProfile.assessments.every((record) => record.questions.length === 4), "questions must be embedded frozen in each record");
  assert.ok(assessedProfile.assessments.some((record) => record.questions.some((question) => question.type === "numeric")), "the numeric question type must be recorded");
  assert.ok(assessedProfile.mistakes.filter((mistake) => (mistake.tags || []).includes("assessment")).length >= 2, "assessment misses must land in the mistake notebook");
  await page.waitForFunction(() => document.querySelector(".mastery-grid")?.textContent.includes("last check 100%"), { timeout: 5_000 })
    .catch(() => assert.fail("the mastery row did not surface the latest readiness score"));

  assert.equal(runtimeErrors.length, 0, `browser errors: ${runtimeErrors.join(" | ")}`);

  console.log("Workflow audit passed.");
  console.log("Verified narration, bookmark, note, clipping, progress, edit, teaching, whiteboard history, the complete straight-line matrix (mouse, pen pressure, tap rejection, undo/redo, move/recolor/resize, marquee multi-select with group nudge, copy/paste, lock refusal, persisted z-order, grid snapping, handle rotation with rotated-frame hit-testing and SVG transform export, undoable JSON interchange, page-switch and reload persistence, PNG and SVG export), create, upload, duplicate-upload rejection, organize (rename, pin-first ordering, collection chips, archive round-trip), 30-day trash (restore under a fresh id, delete forever), HTML-to-Markdown import with script stripping, EPUB chapter fan-out with its lossy report, the print/PDF action, the broken-link audit, batch select/assign/archive/trash, the Home activity ledger, the device-evidence capture page (probed capabilities, the self-recording assisted speech check, honest send-failure off the LAN serve, recorded human verdict, exported dated report with unanswered checks left honestly empty), per-Part readiness checks with choice/numeric auto-grading, missed-question source links, an in-place retry, and mistake capture, the sync vault (v2 container identity, peer fold with tombstone-safe merge, idempotent re-import), advanced search (saved-search chips, typo tolerance, -term exclusion, title:/has:formula field filters, plural folding, facet counts, highlighted snippets), routing, reload persistence, and backup.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(downloadDirectory, { recursive: true, force: true });
}
