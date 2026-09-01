import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-workflow-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "lumen-workflow-downloads-"));
const runtimeErrors = [];
let browser;
let acceptDialogs = true;

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
  page.on("dialog", (dialog) => acceptDialogs ? dialog.accept() : dialog.dismiss());

  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });

  const documentId = "notes/part-01-foundations/01-ai-ml-mental-model.md";
  await page.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body h1", { timeout: 15_000 });

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

  await page.click('button[aria-label="Open menu"]');
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

  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".markdown-editor");
  await page.$eval(".markdown-editor", (textarea) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, `${textarea.value}\n\n## Production audit marker\n\nThis edit must persist across a complete reload.\n`);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickByText(page, ".editor-toolbar button", "Save");
  await page.waitForFunction(() => document.querySelector(".markdown-body")?.innerText.includes("Production audit marker"));

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

  await page.click(".document-grid .document-card");
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
  assert.ok(reloadedText.includes("Acceptance Study Note Updated"), "created note did not survive reload");
  assert.ok(reloadedText.toLocaleLowerCase().includes("uploaded persistence proof"), "uploaded note did not survive reload");
  assert.ok(reloadedText.includes("SDE-III systems interview"), "personal note did not survive reload");

  await page.click('button[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  await clickByText(page, ".settings-drawer button", "Export backup");
  let backupPath;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = await readdir(downloadDirectory);
    const backupName = files.find((name) => name.endsWith(".json"));
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
  assert.equal(backup.summary.counts.customDocuments, 2);
  assert.ok(backup.data.profile.clippings.length === 1, "backup omitted clippings");
  assert.equal(backup.data.profile.clippings[0].note, "Connect this excerpt to model-system tradeoffs.");
  assert.equal(backup.data.profile.reviewItems.length, 1, "backup omitted the source-linked review card");
  assert.equal(backup.data.profile.reviewItems[0].sourceClippingId, backup.data.profile.clippings[0].id, "review card lost its clipping source link");
  assert.ok(backup.data.profile.customDocuments.length === 2, "backup omitted created or uploaded notes");

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
  assert.equal(storedProfile.customDocuments.length, 2);
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
  assert.equal(runtimeErrors.length, 0, `browser errors: ${runtimeErrors.join(" | ")}`);

  console.log("Workflow audit passed.");
  console.log("Verified narration, bookmark, note, clipping, progress, edit, teaching, whiteboard history, the complete straight-line matrix (mouse, pen pressure, tap rejection, undo/redo, move/recolor/resize, page-switch and reload persistence, PNG export), create, upload, search, routing, reload persistence, and backup.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(downloadDirectory, { recursive: true, force: true });
}
