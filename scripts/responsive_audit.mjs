import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { initialProfile, normalizeProfile } from "../src/lib/db.js";
import { createReviewItem } from "../src/lib/review.js";
import { auditViewportScrolling } from "./viewport_scrolling_audit.mjs";

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
      // Even a reduced-motion animation can be between compositor frames on CI.
      // Measure the settled panel, not its temporary entrance transform.
      await page.$eval(rootSelector, async (root) => {
        root.getBoundingClientRect();
        await Promise.all(root.getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})));
      });
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
        if (document.documentElement.scrollWidth > innerWidth + 2) {
          problems.push(`Page width ${document.documentElement.scrollWidth} exceeds ${innerWidth}`);
          // Name the culprit even when it sits behind a modal (inert or hidden
          // regions are skipped by the visible-overflow scan above).
          if (!overflow.length) overflow.push(...[...document.body.querySelectorAll("*")].flatMap((node) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.right > innerWidth + 2 && !hasScrollOwner(node)
              ? [{ tag: node.tagName, className: node.getAttribute("class"), text: (node.textContent || "").slice(0, 55), left: Math.round(box.left), right: Math.round(box.right), hidden: !visible(node) }] : [];
          }).slice(-8));
        }
        if (overflow.length) problems.push("Content extends beyond the viewport");
        if (dialog && (rect.top < -2 || rect.bottom > innerHeight + 2 || rect.left < -2 || rect.right > innerWidth + 2)) problems.push("Dialog extends beyond the viewport");
        if (canvas) {
          const drawing = root.querySelector(".board-canvas")?.getBoundingClientRect();
          if (!drawing || drawing.width < 180 || drawing.height < 120) problems.push(`Drawing area is ${Math.round(drawing?.width || 0)}×${Math.round(drawing?.height || 0)}`);
          // The element box alone hid a landscape board with 13–73px of canvas
          // showing above the fixed bottom navigation (issue #55): measure the
          // part a learner can actually draw on, with undo on screen too.
          const nav = document.querySelector(".bottom-nav");
          const navTop = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : innerHeight;
          const topbarBottom = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom || 0;
          const toolbar = root.querySelector(".board-toolbar")?.getBoundingClientRect();
          if (drawing) {
            const visibleTop = Math.max(drawing.top, topbarBottom, toolbar && toolbar.top < drawing.top ? toolbar.bottom : 0);
            const visibleHeight = Math.min(drawing.bottom, navTop, innerHeight) - visibleTop;
            const visibleWidth = Math.min(drawing.right, innerWidth) - Math.max(drawing.left, 0);
            if (visibleHeight < 120 || visibleWidth < 180) problems.push(`Visible drawing area is ${Math.round(visibleWidth)}×${Math.round(visibleHeight)} above the navigation`);
          }
          const undo = root.querySelector('[aria-label="Undo"]')?.getBoundingClientRect();
          if (!undo?.width || undo.top < topbarBottom - 1 || undo.bottom > navTop + 1) problems.push("Undo is not on screen with the drawing area");
        }
        return { problems, overflow, bounds: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), bottom: Math.round(rect.bottom) } };
      }, { selector: rootSelector, dialog, canvas });
      const result = { device, width, height, textScale, surface, ok: finding.problems.length === 0, ...finding };
      results.push(result);
      const representative = ["small-phone", "phone-landscape", "tablet-landscape"].includes(device) && ["reader", "teaching", "whiteboard", "ai-mac"].includes(surface);
      if (!result.ok || representative || process.env.LUMEN_LAYOUT_SCREENSHOTS === "1") await page.screenshot({ path: join(artifactDirectory, `${device}-${surface}.png`) });
      console.log(JSON.stringify(result));
    };
    // Issue #52: a squeezed grid or flex track must never stack a Home or
    // Library label a few glyphs per line (the study card once collapsed to a
    // 17px column, and mastery rows showed "readines/s"). Overflow checks
    // cannot see this, so look for ordinary words split across lines at
    // normal text size; the seeded overlong fixture words are exempt.
    const inspectWords = async (surface, rootSelector) => {
      if (textScale !== 1) return;
      const split = await page.$eval(rootSelector, (root) => {
        const found = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const element = node.parentElement;
          // Line-clamped excerpts hide their overflow lines on purpose.
          if (!element || element.closest("svg, pre, code, table, [inert], [aria-hidden='true']") || !element.getClientRects().length) continue;
          if ([element, element.parentElement].some((box) => box && getComputedStyle(box).webkitLineClamp !== "none")) continue;
          for (const match of node.textContent.matchAll(/[A-Za-z]+/g)) {
            if (match[0].length < 4 || match[0].length > 20) continue;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            if (new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size > 1) {
              found.push(`${element.getAttribute("class") || element.tagName}: “${match[0]}”`);
              break;
            }
          }
        }
        return found.slice(0, 8);
      });
      const result = { device, width, height, textScale, surface, ok: split.length === 0, problems: split.length ? ["Words split mid-word across lines"] : [], split };
      results.push(result);
      if (!result.ok) await page.screenshot({ path: join(artifactDirectory, `${device}-${surface}.png`), fullPage: true });
      console.log(JSON.stringify(result));
    };
    const navigate = async (route, selector) => {
      await page.evaluate((hash) => { location.hash = hash; window.scrollTo(0, 0); }, `#/${route}`);
      await page.waitForSelector(selector);
    };
    await inspect("home", ".dashboard-page");
    await inspectWords("home-words", ".dashboard-page");
    await inspect("topbar", ".app-topbar");
    if (width <= 980) {
      await inspect("bottom-navigation", ".bottom-nav", { dialog: true });
      for (let index = 1; index <= await page.$$eval(".bottom-nav button", (nodes) => nodes.length); index += 1) await reach(`.bottom-nav button:nth-child(${index})`);
    }
    if (width <= 980) await reach('[aria-label="Open menu"]', true);
    await inspect("navigation", ".app-sidebar", { dialog: true });
    await reach(".sidebar-parts button:last-child");
    await reach(".sidebar-settings");
    if (width <= 980) {
      // Hit testing skips the inert background, so lift it for one probe to
      // prove the drawer paints above the bottom navigation (SHELL-1).
      const aboveNavigation = await page.evaluate(() => {
        const main = document.querySelector(".app-main");
        const box = document.querySelector(".sidebar-settings").getBoundingClientRect();
        main.inert = false;
        const onTop = Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".sidebar-settings"));
        main.inert = true;
        return onTop;
      });
      controls.push({ device, selector: ".sidebar-settings above .bottom-nav", reachable: aboveNavigation });
      await reach(".sidebar-close", true);
    }
    await click(page, ".mastery-check");
    await inspect("assessment", ".assessment-dialog", { dialog: true });
    await reach(".assessment-dialog .button.primary");
    await page.focus(".assessment-dialog .button.primary");
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForSelector(".sidebar-settings .offline-dot");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.$eval(".assessment-dialog .button.primary", (node) => document.activeElement === node), true, "Background updates moved focus out of the assessment control");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForSelector(".sidebar-settings .online-dot");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".assessment-dialog", { hidden: true });
    await navigate("library", ".library-page");
    await inspect("library", ".library-page");
    await inspectWords("library-words", ".library-page");
    await navigate(`read/${encodeURIComponent(documentId)}`, ".reader-view");
    await page.waitForSelector(".markdown-body h1");
    await inspect("reader", ".reader-view");
    if (textScale === 1) {
      // READER-8: small laptops start with the outline hidden so the lecture
      // keeps a readable column. READER-7: line length visibly changes
      // wherever the screen has room, and explains itself where it cannot.
      const readerLayout = await page.evaluate(async () => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const panel = getComputedStyle(document.querySelector(".reader-side-panel"));
        const article = () => Math.round(document.querySelector(".markdown-body").getBoundingClientRect().width);
        const state = { panelShown: panel.display !== "none" && panel.visibility !== "hidden", article: article(), widths: {} };
        document.querySelector('[aria-label="Reading appearance"]').click();
        await frame();
        const buttons = [...document.querySelectorAll(".display-popover .segmented button")];
        state.note = document.querySelector(".display-popover .width-note")?.textContent || "";
        // Measure only once the reader has applied the chosen width; a fixed
        // frame count raced the settings update on loaded CI machines.
        const applied = async (value) => {
          for (let tries = 0; tries < 120 && !document.querySelector(`.reader-layout.width-${value}`); tries += 1) await frame();
          await frame();
        };
        for (const button of buttons) { const value = button.textContent.trim(); button.click(); await applied(value); state.widths[value] = article(); }
        buttons.find((button) => button.textContent.trim() === "comfortable")?.click();
        document.querySelector('[aria-label="Close appearance"]').click();
        await frame();
        return state;
      });
      const problems = [];
      if (width > 980 && width < 1240 && (readerLayout.panelShown || readerLayout.article < 560)) problems.push(`Outline squeezes the lecture to ${readerLayout.article}px`);
      const { focused, comfortable, wide } = readerLayout.widths;
      const offered = Object.keys(readerLayout.widths).length > 0;
      if (offered && !(focused < wide)) problems.push(`Line length has no visible effect: ${JSON.stringify(readerLayout.widths)}`);
      if (!offered && !readerLayout.note) problems.push("Line length is hidden without an explanation");
      if ([768, 1920].includes(width) && !(focused < comfortable && comfortable < wide)) problems.push(`Line length options are not distinct: ${JSON.stringify(readerLayout.widths)}`);
      if (width <= 430 && offered) problems.push("Phone offers a line-length control that cannot change anything");
      results.push({ device, width, height, textScale, surface: "reader-layout", ok: problems.length === 0, problems, ...readerLayout });
      if (problems.length) console.log(JSON.stringify(results.at(-1)));
    }
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
    // Compact boards keep page and view options in a panel: open it first.
    const revealBoardPanel = async (selector) => {
      const panel = await page.$eval(selector, (node) => {
        const container = node.closest("[data-board-panel]");
        return container?.hidden ? container.getAttribute("data-board-panel") : "";
      });
      if (panel) await reach(`[data-board-toggle="${panel}"]`, true);
    };
    await revealBoardPanel('[aria-label="Plain background"]');
    await reach('[aria-label="Plain background"]', true);
    await revealBoardPanel('[aria-label="Rename whiteboard page"]');
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
    // The close control stays reachable after scrolling the long drawer (SHELL-3).
    await page.$eval(".settings-drawer", (drawer) => { drawer.scrollTop = drawer.scrollHeight; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    controls.push({ device, selector: ".settings-close after scrolling", reachable: await page.$eval(".settings-close", (node) => {
      const box = node.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }) });
    await page.$eval(".settings-drawer", (drawer) => { drawer.scrollTop = 0; });
    await click(page, ".install-card button");
    await inspect("install", ".install-sheet", { dialog: true });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await navigate("device-evidence", ".device-evidence-page");
    await inspect("device-evidence", ".device-evidence-page");
    await context.close();
  }
  await auditViewportScrolling({ browser, baseUrl, artifactDirectory, results, runtimeErrors });
  const failed = results.filter((result) => !result.ok);
  const unreachable = controls.filter((control) => !control.reachable);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, controls: controls.length, unreachable, runtimeErrors, artifacts: artifactDirectory }));
  if (failed.length || unreachable.length || runtimeErrors.length) process.exitCode = 1;
} finally {
  await writeFile(join(artifactDirectory, "results.json"), JSON.stringify({ results, controls, runtimeErrors }, null, 2));
  await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
