import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { initialProfile, normalizeProfile } from "../src/lib/db.js";
import { createReviewItem } from "../src/lib/review.js";

const baseUrl = (process.env.LUMEN_URL || "http://127.0.0.1:4187/").replace(/\/$/, "");
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-responsive-"));
const artifactDirectory = process.env.LUMEN_LAYOUT_ARTIFACTS || join(tmpdir(), "lumen-responsive-results");
await mkdir(artifactDirectory, { recursive: true });
const viewports = [
  ["small-phone", 320, 568], ["phone", 360, 640], ["large-phone", 430, 932],
  ["phone-landscape", 568, 320], ["tablet", 768, 1024], ["tablet-landscape", 1024, 768],
  ["laptop", 1280, 800], ["desktop", 1920, 1080], ["large-text", 768, 1024, 2],
  ["phone-large-text", 360, 800, 2], ["phone-keyboard", 390, 360],
].filter(([name]) => !process.env.LUMEN_LAYOUT_CASES || process.env.LUMEN_LAYOUT_CASES.split(",").includes(name));
const documentId = "custom/responsive-fixture";
const longWord = "TransformerRuntimeConfiguration".repeat(5);
const raw = `# ${longWord}\n\nA long reference: https://example.com/${longWord}\n\n## Reading on every screen\n\n${"A source paragraph that should wrap without cutting off words or controls. ".repeat(8)}\n\n| Configuration | Description |\n| --- | --- |\n| ${longWord} | ${longWord} |\n\n\`\`\`python\nconfiguration = "${longWord.repeat(2)}"\n\`\`\`\n\n$$\nf(x) = \\sum_{i=1}^{n} w_i x_i\n$$\n\n## Next section\n\nKeep navigation and study controls reachable.`;
const seededProfile = normalizeProfile({
  ...initialProfile,
  settings: { ...initialProfile.settings, theme: "paper" },
  customDocuments: [{ id: documentId, title: longWord, raw, tags: ["responsive"], collectionId: "layout" }],
  collections: [{ id: "layout", name: longWord }],
  lastDocumentId: documentId, recent: [documentId], bookmarks: [documentId],
  personalNotes: { [documentId]: `A note with ${longWord}` },
  clippings: [{ id: "layout-clip", documentId, text: longWord, note: raw }],
  reviewItems: [
    createReviewItem({ front: `Explain ${longWord}`, back: raw, documentId }),
    ...[1, 2, 3].map((index) => ({ ...createReviewItem({ front: `Readiness ${index}: ${longWord}`, back: raw, documentId: "notes/part-01-foundations/01-ai-ml-mental-model.md" }), dueAt: "2099-01-01T00:00:00.000Z" })),
  ],
  aiTutorHistory: [
    { id: "layout-user", role: "user", mode: "explain", content: `Explain ${longWord}`, createdAt: new Date().toISOString() },
    { id: "layout-answer", role: "assistant", mode: "explain", content: raw, createdAt: new Date().toISOString() },
  ],
});
const results = [];
const runtimeErrors = [];
const controls = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profileDirectory,
  args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
});

const click = (page, selector) => page.$eval(selector, (node) => node.click());
const clickText = async (page, selector, label) => {
  assert.ok(await page.$$eval(selector, (nodes, text) => {
    const target = nodes.find((node) => node.textContent.trim().includes(text));
    target?.click();
    return Boolean(target);
  }, label), `Missing ${label}`);
};

try {
  for (const [device, width, height, textScale = 1] of viewports) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push({ device, error: error.message }));
    page.on("dialog", (dialog) => dialog.accept());
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: false, hasTouch: width <= 1024 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${baseUrl}/#/home`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".welcome-block");
    await page.evaluate((profile) => new Promise((resolve, reject) => {
      const open = indexedDB.open("lumen-ai-notes", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("study-data", "readwrite");
        tx.objectStore("study-data").put(profile, "profile");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }), seededProfile);
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector(".welcome-block");
    await page.evaluate((scale) => { document.documentElement.style.fontSize = `${16 * scale}px`; }, textScale);

    const reach = async (selector, activate = false) => {
      await page.waitForSelector(".toast", { hidden: true, timeout: 10_000 });
      const handle = await page.waitForSelector(selector);
      await handle.evaluate((node) => node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const reachable = await handle.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return box.width > 0 && box.height > 0 && node.contains(document.elementFromPoint(x, y));
      });
      controls.push({ device, selector, reachable });
      if (!reachable) await page.screenshot({ path: join(artifactDirectory, `${device}-control-${controls.length}.png`) });
      if (activate && reachable) await handle.click();
      else if (activate) await handle.evaluate((node) => node.click());
    };

    const inspect = async (surface, rootSelector, { dialog = false, canvas = false } = {}) => {
      await page.waitForSelector(rootSelector);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const finding = await page.evaluate(({ selector, dialog, canvas }) => {
        const root = document.querySelector(selector);
        const rect = root.getBoundingClientRect();
        const visible = (node) => {
          const style = getComputedStyle(node);
          return node.getClientRects().length && style.visibility !== "hidden" && !node.closest('[inert], [aria-hidden="true"]');
        };
        const hasScrollOwner = (node) => {
          for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 2 && box.left >= -2 && box.right <= innerWidth + 2) return true;
          }
          return false;
        };
        const overflow = [...root.querySelectorAll("h1, h2, h3, p, button, input, select, textarea, canvas, article, section, div, .page-title")]
          .filter(visible).flatMap((node) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && (box.left < -2 || box.right > innerWidth + 2) && !hasScrollOwner(node)
              ? [{ tag: node.tagName, className: node.getAttribute("class"), text: (node.textContent || "").slice(0, 55), left: Math.round(box.left), right: Math.round(box.right) }] : [];
          }).slice(0, 8);
        const problems = [];
        if (document.documentElement.scrollWidth > innerWidth + 2) problems.push(`Page width ${document.documentElement.scrollWidth} exceeds ${innerWidth}`);
        if (overflow.length) problems.push("Content extends beyond the viewport");
        if (dialog && (rect.top < -2 || rect.bottom > innerHeight + 2 || rect.left < -2 || rect.right > innerWidth + 2)) problems.push("Dialog extends beyond the viewport");
        if (canvas) {
          const drawing = root.querySelector(".board-canvas")?.getBoundingClientRect();
          if (!drawing || drawing.width < 180 || drawing.height < 120) problems.push(`Drawing area is ${Math.round(drawing?.width || 0)}×${Math.round(drawing?.height || 0)}`);
        }
        return { problems, overflow, bounds: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), bottom: Math.round(rect.bottom) } };
      }, { selector: rootSelector, dialog, canvas });
      const result = { device, width, height, textScale, surface, ok: finding.problems.length === 0, ...finding };
      results.push(result);
      const representative = ["small-phone", "phone-landscape", "tablet-landscape"].includes(device) && ["reader", "teaching", "whiteboard", "ai-mac"].includes(surface);
      if (!result.ok || representative || process.env.LUMEN_LAYOUT_SCREENSHOTS === "1") await page.screenshot({ path: join(artifactDirectory, `${device}-${surface}.png`) });
      console.log(JSON.stringify(result));
    };
    const navigate = async (route, selector) => {
      await page.evaluate((hash) => { location.hash = hash; window.scrollTo(0, 0); }, `#/${route}`);
      await page.waitForSelector(selector);
    };
    await inspect("home", ".dashboard-page");
    await inspect("topbar", ".app-topbar");
    if (width <= 980) {
      await inspect("bottom-navigation", ".bottom-nav", { dialog: true });
      for (let index = 1; index <= await page.$$eval(".bottom-nav button", (nodes) => nodes.length); index += 1) await reach(`.bottom-nav button:nth-child(${index})`);
    }
    if (width <= 980) await reach('[aria-label="Open menu"]', true);
    await inspect("navigation", ".app-sidebar", { dialog: true });
    await reach(".sidebar-parts button:last-child");
    await reach(".sidebar-settings");
    if (width <= 980) await reach(".sidebar-close", true);
    await click(page, ".mastery-check");
    await inspect("assessment", ".assessment-dialog", { dialog: true });
    await reach(".assessment-dialog .button.primary");
    await page.keyboard.press("Escape");
    await navigate("library", ".library-page");
    await inspect("library", ".library-page");
    await navigate(`read/${encodeURIComponent(documentId)}`, ".reader-view");
    await page.waitForSelector(".markdown-body h1");
    await inspect("reader", ".reader-view");
    for (const [surface, opener, panel, closer] of [
      ["reader-notes", '[aria-label="Personal notes"]', ".reader-side-panel.open", '.reader-side-panel [aria-label="Close panel"]'],
      ["appearance", '[aria-label="Reading appearance"]', ".display-popover", '[aria-label="Close appearance"]'],
      ["narration", '[aria-label="Listen"]', ".speech-popover", '.speech-popover button[aria-label^="Close"]'],
      ["reader-actions", '[aria-label="Open lecture actions"]', ".reader-action-menu", '.reader-action-menu [aria-label="Close lecture actions"]'],
    ]) {
      await reach(opener, true);
      await inspect(surface, panel, { dialog: width <= 980 || surface === "reader-actions" });
      // The desktop notes panel stays in the reader layout; its close header is mobile-only.
      await reach(surface === "reader-notes" && width > 980 ? opener : closer, true);
      await page.waitForSelector(panel, { hidden: true }).catch(() => {});
    }
    await reach('[aria-label="Open lecture actions"]', true);
    await reach(".reader-action-grid button:first-child", true);
    await inspect("reader-find", ".reader-view");
    await reach('[aria-label="Close find"]', true);
    await page.$eval(".markdown-body p", (paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((node) => node.textContent.includes("Highlight selection")));
    await clickText(page, ".document-tools button", "Highlight selection");
    await inspect("annotation", ".annotation-dialog", { dialog: true });
    await reach(".annotation-dialog .button.primary", true);
    await page.waitForSelector(".annotation-dialog", { hidden: true });
    await page.evaluate(() => getSelection().removeAllRanges());
    await clickText(page, ".document-tools button", "Edit copy");
    await inspect("editor", ".editor-shell");
    await clickText(page, ".document-tools button", "Close editor");
    await clickText(page, ".document-tools button", "Teach");
    await inspect("teaching", ".teach-mode", { dialog: true });
    await reach('[aria-label="Exit teaching mode"]', true);
    await navigate(`board/${encodeURIComponent(documentId)}`, ".board-view");
    await inspect("whiteboard", ".board-view", { canvas: true });
    await reach('[aria-label="Plain background"]', true);
    await reach('[aria-label="Rename whiteboard page"]', true);
    await inspect("board-rename", ".board-rename-dialog", { dialog: true });
    await reach(".board-rename-dialog .button.primary");
    await page.keyboard.press("Escape");
    await reach('[aria-label="Text"]', true);
    await reach(".board-canvas", true);
    await inspect("board-text", ".board-text-dialog", { dialog: true });
    await reach(".board-text-dialog .button.primary");
    await page.keyboard.press("Escape");
    await navigate("notebook", ".notebook-page");
    await inspect("notebook", ".notebook-page");
    await reach('.notebook-row-actions [aria-label^="Organize "]', true);
    await inspect("organize-note", ".manage-doc-dialog", { dialog: true });
    await reach(".manage-doc-dialog .button.primary");
    await page.keyboard.press("Escape");
    await clickText(page, ".notebook-actions button", "New note");
    await inspect("create-note", ".create-note-dialog", { dialog: true });
    await reach(".create-note-dialog .button.primary");
    await page.keyboard.press("Escape");
    await navigate("review", ".review-center-page");
    await inspect("review", ".review-center-page");
    await clickText(page, ".review-center-page button", "New card");
    await inspect("review-dialog", ".review-card-dialog", { dialog: true });
    await reach(".review-card-dialog .button.primary");
    await page.keyboard.press("Escape");
    await clickText(page, ".review-hero button", "Start review");
    await inspect("review-session", ".review-session-page");
    await clickText(page, ".review-session-page button", "Show answer");
    await inspect("review-answer", ".review-session-page");
    await navigate("ai", ".ai-tutor");
    await inspect("ai-mac", ".ai-learning-studio");
    await click(page, '[data-ai-engine-option="phone-local"]');
    await inspect("ai-phone", ".phone-tutor");
    await click(page, '[aria-label="Open settings"]');
    await inspect("settings", ".settings-drawer", { dialog: true });
    await click(page, ".install-card button");
    await inspect("install", ".install-sheet", { dialog: true });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await navigate("device-evidence", ".device-evidence-page");
    await inspect("device-evidence", ".device-evidence-page");
    await context.close();
  }
  const failed = results.filter((result) => !result.ok);
  const unreachable = controls.filter((control) => !control.reachable);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, controls: controls.length, unreachable, runtimeErrors, artifacts: artifactDirectory }));
  if (failed.length || unreachable.length || runtimeErrors.length) process.exitCode = 1;
} finally {
  await writeFile(join(artifactDirectory, "results.json"), JSON.stringify({ results, controls, runtimeErrors }, null, 2));
  await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
