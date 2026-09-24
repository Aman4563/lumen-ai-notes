import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-annotation-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "lumen-annotation-downloads-"));
const errors = [];
let browser;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const target = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    target?.click();
    return Boolean(target);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

const readStored = (page, key) => page.evaluate((storageKey) => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const get = request.result.transaction("study-data", "readonly").objectStore("study-data").get(storageKey);
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  };
}), key);

// Polls the durable record so assertions never race the debounced profile save.
const waitForStored = async (page, key, predicate, message, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  do {
    const value = await readStored(page, key).catch(() => null);
    if (value && predicate(value)) return value;
    await delay(150);
  } while (Date.now() < deadline);
  return assert.fail(message);
};

const waitForDownload = async (matcher, message, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  do {
    const files = await readdir(downloadDirectory);
    const name = files.find((entry) => !entry.endsWith(".crdownload") && matcher(entry));
    if (name) {
      await delay(200);
      return join(downloadDirectory, name);
    }
    await delay(100);
  } while (Date.now() < deadline);
  return assert.fail(message);
};

const openHighlightsPanel = async (page) => {
  const alreadyOpen = await page.$(".reader-side-panel.open");
  if (!alreadyOpen) await page.$eval('button[aria-label="Table of contents"]', (button) => button.click());
  await page.waitForSelector(".side-panel-tabs button");
  await clickByText(page, ".side-panel-tabs button", "Highlights");
};

const editSourceCopy = async (page, mutate, argument) => {
  await clickByText(page, ".document-tools button", "Edit copy");
  await page.waitForSelector(".markdown-editor");
  const applied = await page.$eval(".markdown-editor", (textarea, mutatorSource, payload) => {
    const next = new Function(`return (${mutatorSource});`)()(textarea.value, payload);
    if (typeof next !== "string") return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, next);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, mutate.toString(), argument);
  assert.ok(applied, "the markdown editor mutation could not be applied");
  await clickByText(page, ".editor-toolbar button", "Save");
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

  // READER-1: mid-lecture on a phone, a selection gets Highlight/Clip/Ask AI
  // right above the bottom navigation instead of only in the top tool row.
  await page.$eval(".reader-scroll", (node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.5; node.dispatchEvent(new Event("scroll")); });
  await delay(250);
  const midQuote = await page.evaluate(() => {
    const top = document.querySelector(".reader-scroll").getBoundingClientRect().top;
    const paragraph = [...document.querySelectorAll(".markdown-body p")].find((node) => { const box = node.getBoundingClientRect(); return box.top > top + 40 && box.bottom < innerHeight - 260 && node.textContent.trim().length > 40; });
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return paragraph.textContent.replace(/\s+/g, " ").trim();
  });
  await page.waitForSelector(".selection-toolbar", { visible: true, timeout: 5_000 });
  const selectionTools = await page.$eval(".selection-toolbar", (bar) => {
    const box = bar.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, navTop: nav?.top ?? innerHeight, labels: [...bar.querySelectorAll("button")].map((button) => button.textContent.trim()) };
  });
  assert.ok(selectionTools.top >= 0 && selectionTools.bottom <= selectionTools.navTop, `selection tools are off-screen or under the bottom nav: ${JSON.stringify(selectionTools)}`);
  assert.ok(["Highlight", "Clip"].every((label) => selectionTools.labels.includes(label)), `selection tools are missing actions: ${selectionTools.labels.join(", ")}`);
  await page.click(".selection-toolbar button:first-child");
  await page.waitForSelector(".annotation-dialog");
  assert.equal((await page.$eval(".annotation-dialog blockquote", (node) => node.textContent)).replace(/\s+/g, " ").trim(), midQuote, "the selection toolbar highlighted a different passage");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".annotation-dialog", { hidden: true });
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.waitForSelector(".selection-toolbar", { hidden: true, timeout: 5_000 });
  await page.$eval(".reader-scroll", (node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });

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
  // Losing connectivity rerenders the app while the learner is editing.
  // The unsaved color/comment/tags must survive that unrelated update.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await delay(100);
  assert.equal(await page.$eval(".annotation-color-options .coral", (button) => button.getAttribute("aria-pressed")), "true", "a background update reset the chosen highlight color");
  assert.equal(await page.$eval(".annotation-dialog textarea", (field) => field.value), "Explain the production trade-off without looking.", "a background update erased the unsaved comment");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await clickByText(page, ".annotation-dialog button", "Create highlight");
  await page.waitForSelector(".annotation-dialog", { hidden: true });
  await page.waitForFunction(() => CSS.highlights?.get("lumen-coral")?.size === 1).catch(async (error) => {
    console.error(JSON.stringify({ highlights: await page.evaluate(() => [...(CSS.highlights?.entries() || [])].map(([name, ranges]) => ({ name, size: ranges.size }))), annotations: (await readStored(page, "profile"))?.annotations, errors }));
    throw error;
  });

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

  const initialAnnotation = persisted.annotations[0];

  // 1. RELOCATION: prepend a paragraph so the quote survives but every offset shifts.
  const relocationMarker = "Relocation audit paragraph: every original offset in this lecture now shifts forward.";
  await editSourceCopy(page, (value, marker) => `${marker}\n\n${value}`, relocationMarker);
  await page.waitForFunction((marker) => document.querySelector(".markdown-body")?.innerText.includes(marker), {}, relocationMarker);
  await openHighlightsPanel(page);
  await page.waitForSelector(".reader-annotation-card.teal");
  // With edit-save reconciliation the "Relocated" state is transient: the
  // fresh offsets persist and the very next resolution settles back to exact,
  // so the durable contract is a shifted stored start with surviving paint
  // and no lingering badge (the unit suite still pins the relocated status).
  await page.waitForFunction(() => CSS.highlights?.get("lumen-teal")?.size === 1);
  // A saved edit is the explicit reconcile point: confidently relocated
  // anchors persist their fresh offsets and refreshed prefix/suffix context
  // (LEARN-001 write-back, 2026-09-01). Everyday renders never write back.
  const relocatedProfile = await waitForStored(
    page,
    "profile",
    (value) => value.edits?.[documentId]?.includes(relocationMarker)
      && Number.isSafeInteger(value.annotations?.[0]?.start)
      && value.annotations[0].start !== initialAnnotation.start,
    "the relocated offsets were not reconciled after the source edit was saved",
  );
  assert.ok(relocatedProfile.annotations[0].start > initialAnnotation.start, "a prepended paragraph must shift the stored start forward");
  assert.equal(relocatedProfile.annotations[0].quote, initialAnnotation.quote, "reconciliation must not rewrite the stored quote");
  assert.equal(relocatedProfile.annotations[0].id, initialAnnotation.id, "reconciliation must not change the annotation id");
  assert.ok(relocatedProfile.annotations[0].updatedAt > initialAnnotation.updatedAt, "the reconciled record must carry a newer updatedAt for cross-tab merging");
  await page.waitForFunction(() => {
    const badge = document.querySelector(".reader-annotation-card small");
    return !badge || badge.textContent !== "Relocated";
  }, { timeout: 8_000 });

  // 2. ORPHAN: delete the quoted passage entirely; the annotation must degrade
  // to "Needs relink" with navigation disabled and Relink gated on a selection.
  const orphanFiller = "The original opening passage left this lecture entirely during the orphan audit.";
  await editSourceCopy(page, (value, payload) => {
    // The markdown source is hard-wrapped, so match the rendered quote with
    // flexible whitespace instead of assuming a verbatim substring.
    const pattern = payload.quote.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const match = value.match(new RegExp(pattern));
    if (!match) return null;
    return value.replace(match[0], payload.filler);
  }, { quote: initialAnnotation.quote, filler: orphanFiller });
  await page.waitForFunction((filler) => document.querySelector(".markdown-body")?.innerText.includes(filler), {}, orphanFiller);
  await openHighlightsPanel(page);
  await page.waitForFunction(() => document.querySelector(".reader-annotation-card small.orphaned")?.textContent === "Needs relink");
  await page.waitForFunction(() => !CSS.highlights?.get("lumen-teal"));
  assert.equal(await page.$eval(".reader-annotation-card .annotation-quote", (button) => button.disabled), true, "an orphaned annotation must disable quote navigation");
  const relinkState = await page.$$eval(".reader-annotation-card .annotation-card-actions .text-button", (buttons) => {
    const relink = buttons.find((button) => button.textContent.trim() === "Relink");
    return relink ? { present: true, disabled: relink.disabled } : { present: false };
  });
  assert.deepEqual(relinkState, { present: true, disabled: true }, "Relink must be offered but stay disabled until a live selection exists");

  // 3. RELINK: append a replacement passage, select it, and repair the anchor.
  const relinkTarget = "The relink audit sentence anchors this highlight to freshly rewritten prose.";
  await editSourceCopy(page, (value, sentence) => `${value.replace(/\s*$/, "")}\n\n${sentence}\n`, relinkTarget);
  await page.waitForFunction((sentence) => document.querySelector(".markdown-body")?.innerText.includes(sentence), {}, relinkTarget);
  await openHighlightsPanel(page);
  await page.waitForFunction(() => document.querySelector(".reader-annotation-card small.orphaned"));
  const relinkSelection = await page.$eval(".markdown-body", (article, sentence) => {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.includes(sentence)) node = walker.nextNode();
    if (!node) return "";
    const start = node.nodeValue.indexOf(sentence);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + sentence.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return range.toString();
  }, relinkTarget);
  assert.equal(relinkSelection, relinkTarget, "could not select the relink replacement passage");
  await page.waitForFunction(() => {
    const relink = [...document.querySelectorAll(".reader-annotation-card .text-button")].find((button) => button.textContent.trim() === "Relink");
    return Boolean(relink) && !relink.disabled;
  });
  await page.$$eval(".reader-annotation-card .text-button", (buttons) => buttons.find((button) => button.textContent.trim() === "Relink")?.click());
  await page.waitForFunction((sentence) => {
    const card = document.querySelector(".reader-annotation-card");
    return Boolean(card) && !card.querySelector("small") && card.querySelector("blockquote")?.textContent === sentence;
  }, {}, relinkTarget);
  await page.waitForFunction(() => CSS.highlights?.get("lumen-teal")?.size === 1);
  const relinkedProfile = await waitForStored(page, "profile", (value) => value.annotations?.[0]?.quote === relinkTarget, "the relinked anchor was not persisted");
  assert.equal(relinkedProfile.annotations[0].id, initialAnnotation.id, "relink must preserve the annotation id");
  assert.notEqual(relinkedProfile.annotations[0].start, initialAnnotation.start, "relink must rewrite the stored start offset");
  assert.ok(relinkedProfile.annotations[0].sourceHash.startsWith("fnv1a-"), "relink must store a hashed source fingerprint");
  assert.notEqual(relinkedProfile.annotations[0].sourceHash, initialAnnotation.sourceHash, "relink must rehash the edited source");
  assert.equal(relinkedProfile.reviewItems[0].sourceAnnotationId, initialAnnotation.id, "the review card must keep its highlight link across relink");

  // 4. BACKUP RESTORE: export, destroy, then restore the annotation and its
  // review-card link through the two-phase preflight dialog.
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await page.$eval('button[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".settings-drawer");
  await clickByText(page, ".settings-drawer button", "Export backup");
  const backupPath = await waitForDownload((name) => name.startsWith("lumen-notes-backup-") && name.endsWith(".json"), "backup JSON was not downloaded");
  const backupEnvelope = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backupEnvelope.data.profile.annotations.length, 1, "the backup omitted the annotation");
  assert.equal(backupEnvelope.data.profile.annotations[0].id, initialAnnotation.id, "the backup captured a different annotation id");
  assert.equal(backupEnvelope.data.profile.reviewItems[0].sourceAnnotationId, initialAnnotation.id, "the backup lost the review card's highlight link");
  await page.$eval(".settings-close", (button) => button.click());
  await page.waitForSelector(".settings-drawer", { hidden: true });

  await openHighlightsPanel(page);
  await page.waitForSelector(".reader-annotation-card");
  await page.$eval('.reader-annotation-card button[aria-label="Delete highlight"]', (button) => button.click());
  await page.waitForSelector(".reader-annotation-card", { hidden: true });
  await waitForStored(page, "profile", (value) => value.annotations?.length === 0 && value.reviewItems?.[0]?.sourceAnnotationId === "", "annotation deletion did not persist and unlink the review card");

  await page.$eval('button[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector('.settings-drawer input[type="file"]');
  const importInput = await page.$('.settings-drawer input[type="file"]');
  await importInput.uploadFile(backupPath);
  await page.waitForSelector(".backup-preflight-dialog");
  assert.ok((await page.$eval(".backup-preflight-dialog", (node) => node.textContent)).includes("Review this backup"), "the restore preflight did not open on the review phase");
  await page.$eval(".backup-acknowledgement input", (input) => input.click());
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".backup-preflight-dialog .modal-actions button")].find((node) => node.textContent.includes("Create recovery file"));
    return Boolean(button) && !button.disabled;
  });
  await clickByText(page, ".backup-preflight-dialog .modal-actions button", "Create recovery file");
  await waitForDownload((name) => name.startsWith("lumen-recovery-before-restore-") && name.endsWith(".json"), "recovery JSON was not downloaded");
  await page.waitForFunction(() => [...document.querySelectorAll(".backup-preflight-dialog .modal-actions button")].some((node) => node.textContent.includes("Restore now")));
  await page.$eval(".backup-acknowledgement input", (input) => input.click());
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".backup-preflight-dialog .modal-actions button")].find((node) => node.textContent.includes("Restore now"));
    return Boolean(button) && !button.disabled;
  });
  const restoredNavigation = page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 });
  await clickByText(page, ".backup-preflight-dialog .modal-actions button", "Restore now");
  await restoredNavigation;
  await page.waitForSelector(".markdown-body h1");
  await page.waitForFunction(() => CSS.highlights?.get("lumen-teal")?.size === 1);
  const restoredProfile = await readStored(page, "profile");
  assert.equal(restoredProfile.annotations.length, 1, "restore did not bring the annotation back");
  assert.equal(restoredProfile.annotations[0].id, initialAnnotation.id, "restore changed the annotation id");
  assert.equal(restoredProfile.annotations[0].quote, relinkTarget, "restore lost the relinked quote");
  assert.equal(restoredProfile.reviewItems[0].sourceAnnotationId, initialAnnotation.id, "restore did not repair the review card's highlight link");

  // 5. FALLBACK: without the CSS Custom Highlight API the reader must warn,
  // stay error-free, and still resolve card navigation.
  const fallbackPage = await browser.newPage();
  await fallbackPage.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  fallbackPage.on("pageerror", (error) => errors.push(error.message));
  fallbackPage.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
  await fallbackPage.evaluateOnNewDocument(() => {
    delete window.Highlight;
    try { delete CSS.highlights; } catch { /* the namespace property may be non-configurable */ }
  });
  await fallbackPage.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await fallbackPage.waitForSelector(".markdown-body h1");
  assert.equal(await fallbackPage.evaluate(() => typeof window.Highlight), "undefined", "the Highlight API removal did not apply to the fallback page");
  await openHighlightsPanel(fallbackPage);
  await fallbackPage.waitForSelector(".reader-annotation-card");
  await fallbackPage.waitForSelector(".inline-warning");
  assert.ok((await fallbackPage.$eval(".inline-warning", (node) => node.textContent)).includes("cannot paint inline highlights"), "the fallback notice text changed");
  assert.equal(await fallbackPage.$eval(".reader-annotation-card .annotation-quote", (button) => button.disabled), false, "the annotation must stay navigable without highlight painting");
  await fallbackPage.$eval(".reader-annotation-card .annotation-quote", (button) => button.click());
  await fallbackPage.waitForFunction((sentence) => getSelection().toString().includes(sentence), {}, relinkTarget);
  await fallbackPage.close();

  // 6. NOTEBOOK COPY/EXPORT: the Highlights section's per-card copy and
  // Markdown export actions.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__lumenCopiedText = String(value); } } });
  });
  await clickByText(page, ".bottom-nav button", "Notebook");
  await page.waitForSelector(".notebook-page");
  await page.waitForSelector(".notebook-annotation-card");
  assert.ok((await page.$eval(".notebook-annotation-card blockquote", (node) => node.textContent)).includes(relinkTarget), "the notebook card does not show the restored quote");
  await page.$eval('.notebook-annotation-card button[aria-label="Copy highlight"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Highlight copied"));
  assert.equal(await page.$eval(".toast", (node) => node.getAttribute("role")), "status", "the copy toast is not a status live region");
  assert.ok((await page.evaluate(() => window.__lumenCopiedText || "")).includes(relinkTarget), "the copied highlight text did not reach the clipboard");
  await page.$eval('button[aria-label="Export the listed highlights as Markdown"]', (button) => button.click());
  const exportPath = await waitForDownload((name) => name.startsWith("lumen-highlights-") && name.endsWith(".md"), "the highlights Markdown export was not downloaded");
  const exportedMarkdown = await readFile(exportPath, "utf8");
  assert.ok(exportedMarkdown.startsWith("# Lumen highlights (1)"), "the highlights export header is missing");
  assert.ok(exportedMarkdown.includes(relinkTarget), "the highlights export omitted the highlighted quote");

  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Annotation audit passed: anchored creation, inline rendering, metadata edit, review conversion, schema, reload persistence, relocation after source edits (with offsets reconciled at edit-save and refreshed anchor context), orphan detection with gated relink, manual relink repair preserving ids and review links, backup export/two-phase preflight restore of annotations and linked review cards, the non-CSS-Highlight fallback reader, and Notebook highlight copy plus Markdown export verified.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(downloadDirectory, { recursive: true, force: true });
}
