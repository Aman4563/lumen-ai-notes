import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { initialProfile, normalizeProfile } from "../src/lib/db.js";
import { createMistake } from "../src/lib/mistakes.js";
import { createReviewItem } from "../src/lib/review.js";
import { measureSelectsInThemes, selectContractProblems } from "./select_contract.mjs";

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

const FOCUSABLE_SELECTOR = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
const BACKGROUND_SELECTORS = [".app-sidebar", ".app-topbar", ".view-container", ".bottom-nav"];

// Openers focus themselves and record the exact element so the dialog audit can
// verify focus restoration to the true opener after close.
const openBySelector = (page, selector) => page.$eval(selector, (node) => {
  node.focus();
  window.__auditOpener = node;
  node.click();
});
const openByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(expected));
    if (!node) return false;
    node.focus();
    window.__auditOpener = node;
    node.click();
    return true;
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

const describeActiveElement = (page) => page.evaluate(() => {
  const active = document.activeElement;
  if (!active || active === document.body) return "document.body";
  const name = active.getAttribute?.("aria-label") || active.textContent?.replace(/\s+/g, " ").trim().slice(0, 48) || "";
  const className = typeof active.className === "string" && active.className ? `.${active.className.trim().split(/\s+/).join(".")}` : "";
  return `${active.tagName.toLocaleLowerCase()}${className}${name ? ` “${name}”` : ""}`;
});

// Full BUG-003 dialog contract: opener recorded, initial focus inside, Tab cycle
// trapped and wrapping, Shift+Tab wrap, Escape close, focus restoration, and
// inert background while open plus recovery after close.
const auditDialog = async (page, label, {
  open,
  containerSelector,
  close,
  whileOpen,
  extraInertSelectors = [],
  expectBackgroundClearAfterClose = true,
  checkOpenerRestore = true,
  afterClose,
}) => {
  await open();
  await page.waitForSelector(containerSelector, { timeout: 10_000 });

  const initialFocusInside = await page.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)?.contains(document.activeElement)),
    { timeout: 2_000 },
    containerSelector,
  ).then(() => true).catch(() => false);
  if (!initialFocusInside) findings.push(`${label}: initial focus did not land inside ${containerSelector} (active: ${await describeActiveElement(page)})`);

  const inertProblems = await page.evaluate(({ selector, backgroundSelectors }) => {
    const container = document.querySelector(selector);
    const problems = [];
    backgroundSelectors.forEach((backgroundSelector) => {
      [...document.querySelectorAll(backgroundSelector)].forEach((region) => {
        // A region that contains the dialog cannot be inert without disabling the dialog itself.
        if (container && region.contains(container)) return;
        if (!region.inert) problems.push(`${backgroundSelector} is not inert while the dialog is open`);
      });
    });
    return problems;
  }, { selector: containerSelector, backgroundSelectors: [...BACKGROUND_SELECTORS, ...extraInertSelectors] });
  inertProblems.forEach((problem) => findings.push(`${label}: ${problem}`));

  if (whileOpen) await whileOpen();

  const focusableCount = await page.evaluate((selector, focusableSelector) => {
    const container = document.querySelector(selector);
    if (!container) return 0;
    return [...container.querySelectorAll(focusableSelector)].filter((node) => !node.hidden && node.getClientRects().length > 0).length;
  }, containerSelector, FOCUSABLE_SELECTOR);
  if (!focusableCount) findings.push(`${label}: no focusable elements found inside ${containerSelector}`);

  await page.evaluate((selector) => {
    window.__tabSeen = new Set();
    const container = document.querySelector(selector);
    if (container?.contains(document.activeElement)) window.__tabSeen.add(document.activeElement);
  }, containerSelector);
  let wrapped = false;
  let escaped = false;
  for (let press = 0; press < focusableCount + 3 && !wrapped && !escaped; press += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      const active = document.activeElement;
      const inside = Boolean(container?.contains(active));
      const repeat = window.__tabSeen.has(active);
      window.__tabSeen.add(active);
      return { inside, repeat };
    }, containerSelector);
    if (!state.inside) {
      findings.push(`${label}: Tab press ${press + 1} of ${focusableCount + 3} moved focus outside the dialog (active: ${await describeActiveElement(page)})`);
      escaped = true;
    } else if (state.repeat) wrapped = true;
  }
  if (!wrapped && !escaped && focusableCount) findings.push(`${label}: Tab never wrapped back inside the dialog after ${focusableCount + 3} presses`);

  // A sheet may still be finishing its open transition (visibility, inert),
  // during which focus() is a silent no-op; retry briefly before judging.
  const focusedFirst = await page.waitForFunction((selector, focusableSelector) => {
    const container = document.querySelector(selector);
    const first = container ? [...container.querySelectorAll(focusableSelector)].filter((node) => !node.hidden && node.getClientRects().length > 0)[0] : null;
    first?.focus();
    return Boolean(first && document.activeElement === first);
  }, { timeout: 2_000, polling: 100 }, containerSelector, FOCUSABLE_SELECTOR).then(() => true, () => false);
  if (focusedFirst) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const wrappedToLast = await page.evaluate((selector, focusableSelector) => {
      const container = document.querySelector(selector);
      const focusable = container ? [...container.querySelectorAll(focusableSelector)].filter((node) => !node.hidden && node.getClientRects().length > 0) : [];
      return Boolean(focusable.length && document.activeElement === focusable.at(-1));
    }, containerSelector, FOCUSABLE_SELECTOR);
    if (!wrappedToLast) findings.push(`${label}: Shift+Tab from the first element did not wrap to the last (active: ${await describeActiveElement(page)})`);
  } else findings.push(`${label}: could not focus the first element inside ${containerSelector} for the Shift+Tab wrap check`);

  if (close) await close();
  else await page.keyboard.press("Escape");
  try {
    await page.waitForSelector(containerSelector, { hidden: true, timeout: 5_000 });
  } catch {
    findings.push(`${label}: Escape did not remove ${containerSelector}`);
    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      const closer = container?.closest(".modal-layer, .settings-overlay, body")
        ?.querySelector('.modal-scrim, [aria-label^="Close"], [aria-label^="Cancel"]');
      closer?.click();
    }, containerSelector);
    await page.waitForSelector(containerSelector, { hidden: true, timeout: 5_000 });
  }

  if (checkOpenerRestore) {
    // Focus restoration lands on a requestAnimationFrame tick; allow it to settle.
    const restored = await page.waitForFunction(
      () => Boolean(window.__auditOpener) && document.activeElement === window.__auditOpener,
      { timeout: 1_500 },
    ).then(() => true).catch(() => false);
    if (!restored) findings.push(`${label}: focus did not return to the opener after close (active: ${await describeActiveElement(page)})`);
  }

  if (expectBackgroundClearAfterClose) {
    // .app-sidebar is legitimately inert on the mobile viewport while closed,
    // so recovery is asserted on the regions that must become interactive again.
    // The cleanup lands in React's passive-effect flush, so allow it to settle.
    const cleared = await page.waitForFunction(
      (selectors) => !selectors.some((selector) => document.querySelector(selector)?.inert),
      { timeout: 2_000 },
      [".app-topbar", ".view-container", ".bottom-nav"],
    ).then(() => true).catch(() => false);
    if (!cleared) {
      const stuckInert = await page.evaluate((selectors) => selectors.filter((selector) => document.querySelector(selector)?.inert), [".app-topbar", ".view-container", ".bottom-nav"]);
      stuckInert.forEach((selector) => findings.push(`${label}: ${selector} remained inert after the dialog closed`));
    }
  }

  if (afterClose) await afterClose();
};

// Issue #92: every select is the one themed control. A seeded profile makes
// each select-hosting screen render its selects (highlights, collections, an
// FSRS scheduler, a mistake); each screen is measured in Paper, Night and
// Contrast on a 393px touch phone and on a 1280px desktop.
const selectDocumentId = "custom/select-contract";
const selectProfile = normalizeProfile({
  ...initialProfile,
  settings: { ...initialProfile.settings, theme: "paper" },
  customDocuments: [{
    id: selectDocumentId,
    title: "Select contract lecture",
    raw: "# Select contract lecture\n\nA held-out split estimates how a model generalizes to data it has not seen.\n\nThe validation split chooses hyperparameters, and the test split stays untouched until the end.\n\n## Second section\n\nKeep every control on the theme.",
    tags: ["audit"],
    collectionId: "select-audit",
  }],
  collections: [{ id: "select-audit", name: "Audit collection" }],
  annotations: [{ documentId: selectDocumentId, quote: "A held-out split estimates how a model generalizes", purpose: "definition" }],
  reviewItems: [createReviewItem({ front: "What does the validation split choose?", back: "Hyperparameters, before the final test.", documentId: selectDocumentId })],
  reviewSettings: { ...initialProfile.reviewSettings, scheduler: "fsrs" },
  mistakes: [createMistake({ prompt: "What may the test split influence?", expected: "Nothing until choices are frozen.", category: "misconception", documentId: selectDocumentId })],
});
const SELECT_VIEWPORTS = [
  ["phone", { width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ["desktop", { width: 1280, height: 800, deviceScaleFactor: 1 }],
];

const auditThemedSelects = async () => {
  let measured = 0;
  for (const [viewportName, viewport] of SELECT_VIEWPORTS) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(`selects/${viewportName}: ${error.message}`));
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${baseUrl}#/home`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".welcome-block");
    await page.evaluate((profile) => new Promise((resolve, reject) => {
      const open = indexedDB.open("lumen-ai-notes", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("study-data", "readwrite");
        transaction.objectStore("study-data").put(profile, "profile");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    }), selectProfile);
    await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".welcome-block");

    const phone = viewportName === "phone";
    const check = async (surface, expected) => {
      // Wait for the screen's selects (some load lazily), then measure.
      await page.waitForFunction((count) => [...document.querySelectorAll("select")].filter((node) => node.getClientRects().length && !node.closest("[inert]")).length >= count, { timeout: 10_000 }, expected)
        .catch(() => findings.push(`selects/${viewportName}/${surface}: expected at least ${expected} visible select(s)`));
      const byTheme = await measureSelectsInThemes(page);
      const grouped = new Map();
      for (const [theme, records] of Object.entries(byTheme)) {
        measured += records.length;
        for (const problem of selectContractProblems(records, { surface: `selects/${viewportName}/${surface}`, phone })) grouped.set(problem, [...(grouped.get(problem) || []), theme]);
      }
      for (const [problem, themes] of grouped) findings.push(`${problem} [${themes.join(", ")}]`);
    };
    const navigate = async (hash, ready) => {
      await page.evaluate((value) => { location.hash = value; }, hash);
      await page.waitForSelector(ready, { timeout: 20_000 });
    };
    const closeWithEscape = async (selector) => {
      await page.keyboard.press("Escape");
      await page.waitForSelector(selector, { hidden: true, timeout: 5_000 });
    };

    await navigate("#/library", ".library-page");
    await check("library", 1);

    await navigate(`#/read/${encodeURIComponent(selectDocumentId)}`, ".reader-view .markdown-body h1");
    await openBySelector(page, '[aria-label="Listen"]');
    await page.waitForSelector(".speech-popover");
    await check("reader listen", 2);
    const language = 'select[aria-label="Narration language"]';
    if (await page.$eval(language, (select) => !select.disabled && getComputedStyle(select).appearance === "base-select")) {
      // A mouse gets the in-page picker (customizable select); its Escape must
      // close only the picker, never the Listen sheet around it.
      await page.click(language);
      const opened = await page.waitForFunction((selector) => document.querySelector(selector).matches(":open"), { timeout: 2_000 }, language).then(() => true, () => false);
      await page.keyboard.press("Escape");
      await page.waitForFunction((selector) => !document.querySelector(selector)?.matches(":open"), { timeout: 2_000 }, language).catch(() => {});
      const after = await page.evaluate((selector) => ({ sheetOpen: Boolean(document.querySelector(".speech-popover")), pickerOpen: Boolean(document.querySelector(selector)?.matches(":open")) }), language);
      if (!opened) findings.push(`selects/${viewportName}/reader listen: clicking the language select did not open its picker`);
      else if (!after.sheetOpen || after.pickerOpen) findings.push(`selects/${viewportName}/reader listen: Escape in the select picker ${after.sheetOpen ? "left the picker open" : "also closed the Listen sheet"}`);
      if (!after.sheetOpen) await openBySelector(page, '[aria-label="Listen"]');
    }
    await page.waitForSelector(".speech-popover");
    await page.$eval('.speech-popover button[aria-label^="Close"]', (button) => button.click());
    await page.waitForSelector(".speech-popover", { hidden: true, timeout: 5_000 });
    await page.$$eval(".markdown-body p", (paragraphs) => {
      const range = document.createRange();
      range.selectNodeContents(paragraphs.at(-2));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((node) => node.textContent.includes("Highlight selection")), { timeout: 5_000 });
    await clickByText(page, ".document-tools button", "Highlight selection");
    await page.waitForSelector(".annotation-dialog");
    await check("highlight dialog", 1);
    await closeWithEscape(".annotation-dialog");
    await page.evaluate(() => getSelection().removeAllRanges());
    await clickByText(page, ".document-tools button", "Teach");
    await page.waitForSelector(".teach-mode");
    await check("teaching mode", 1);
    await page.$eval('[aria-label="Exit teaching mode"]', (button) => button.click());
    await page.waitForSelector(".teach-mode", { hidden: true, timeout: 5_000 });

    await navigate(`#/board/${encodeURIComponent(selectDocumentId)}`, ".board-canvas");
    await check("whiteboard", 1);

    await navigate("#/notebook", ".notebook-page");
    await clickByText(page, ".notebook-heading-actions button", "Select");
    await page.waitForSelector(".batch-check input");
    await page.$eval(".batch-check input", (input) => input.click());
    await page.waitForSelector(".batch-toolbar select");
    await check("notebook (highlights, batch)", 2);
    await clickByText(page, ".notebook-heading-actions button", "Done selecting");
    await page.$eval('.notebook-row-actions [aria-label^="Organize "]', (button) => button.click());
    await page.waitForSelector(".manage-doc-dialog");
    await check("organize dialog", 1);
    await closeWithEscape(".manage-doc-dialog");

    await navigate("#/review", ".review-center-page");
    await page.waitForSelector(".interview-track-strip select", { timeout: 15_000 });
    await check("review (limits, tracks, mistakes)", 7);
    await clickByText(page, ".review-center-page button", "New card");
    await page.waitForSelector(".review-card-dialog");
    await check("new card dialog", 1);
    await closeWithEscape(".review-card-dialog");
    await clickByText(page, ".mistake-controls button", "Log mistake");
    await page.waitForSelector(".mistake-dialog");
    await check("log mistake dialog", 1);
    await closeWithEscape(".mistake-dialog");

    await page.$eval('button[aria-label="Open settings"]', (button) => button.click());
    await page.waitForSelector(".settings-drawer");
    await check("settings", 1);
    await closeWithEscape(".settings-drawer");

    await navigate("#/ai", ".ai-learning-studio");
    await page.$eval('[data-ai-engine-option="phone-local"]', (button) => button.click());
    await page.waitForSelector(".phone-tutor__composer select");
    await check("on-device tutor", phone ? 3 : 2);
    // The composer's Depth and Answer length show their whole value at 16px
    // (Answer length once read “Standard · 640 t”).
    const clipped = await page.$$eval(".phone-tutor__composer-head select", (selects) => {
      const canvas = document.createElement("canvas").getContext("2d");
      return selects.flatMap((select) => {
        const style = getComputedStyle(select);
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = select.selectedOptions[0]?.textContent || "";
        const room = select.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        const needed = canvas.measureText(text).width;
        return needed > room + 0.5 ? [`“${text}” needs ${Math.ceil(needed)}px of ${Math.floor(room)}px`] : [];
      });
    });
    clipped.forEach((problem) => findings.push(`selects/${viewportName}/on-device tutor: the composer select clips its value: ${problem}`));
    await context.close();
  }
  return measured;
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
  // Issue #52: the fresh-profile reading tile is a live control, and the
  // curriculum map is one Tab stop whose arrow keys walk the Parts in order.
  assert.equal(await page.$eval(".today-widget--wide", (node) => node.disabled), false, "the fresh-profile Start reading tile must not be disabled");
  assert.equal((await page.$$('.concept-node[tabindex="0"]')).length, 1, "the curriculum map must be exactly one Tab stop");
  await page.focus('.concept-node[tabindex="0"]');
  const mapStart = Number(await page.evaluate(() => document.activeElement?.dataset.part));
  await page.keyboard.press("ArrowRight");
  assert.equal(Number(await page.evaluate(() => document.activeElement?.dataset.part)), mapStart + 1, "ArrowRight must move map focus to the next Part");

  await page.goto(`${baseUrl}#/library`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".library-page");
  inspected += await inspectControls(page, "library");

  const documentId = encodeURIComponent("notes/part-01-foundations/01-ai-ml-mental-model.md");
  await page.goto(`${baseUrl}#/read/${documentId}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".reader-view");
  inspected += await inspectControls(page, "reader");
  await auditDialog(page, "reader actions menu", {
    open: () => openByText(page, ".document-tools button", "Actions"),
    containerSelector: ".reader-action-menu",
    whileOpen: async () => { inspected += await inspectControls(page, "reader actions"); },
  });

  // Reader phone side panel (READER-2): closed, it is inert and hidden; open,
  // it is a modal sheet with the full focus contract.
  const closedPanel = await page.$eval(".reader-side-panel", (panel) => ({ inert: panel.inert, hidden: panel.getAttribute("aria-hidden"), visibility: getComputedStyle(panel).visibility }));
  if (!closedPanel.inert || closedPanel.hidden !== "true") findings.push(`reader side panel: closed phone panel is still reachable (${JSON.stringify(closedPanel)})`);
  await page.$eval(".reader-scroll", (node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.4; node.dispatchEvent(new Event("scroll")); });
  await auditDialog(page, "reader outline sheet", {
    open: () => openBySelector(page, 'button[aria-label="Table of contents"]'),
    containerSelector: ".reader-side-panel.open",
    whileOpen: async () => {
      inspected += await inspectControls(page, "reader outline sheet");
      // The reader marks the current section after the scroll settles; wait for it
      // instead of racing the observer (the assertion below still requires it).
      await page.waitForSelector('.reader-side-panel .outline-list [aria-current="location"]', { timeout: 5_000 }).catch(() => {});
      const sheet = await page.$eval(".reader-side-panel", (panel) => ({ role: panel.getAttribute("role"), modal: panel.getAttribute("aria-modal"), current: panel.querySelector('.outline-list [aria-current="location"]')?.textContent || "" }));
      if (sheet.role !== "dialog" || sheet.modal !== "true") findings.push(`reader outline sheet: open phone sheet is not a modal dialog (${JSON.stringify(sheet)})`);
      if (!sheet.current) findings.push("reader outline sheet: the section being read is not marked aria-current in the outline");
    },
  });

  // Teaching Mode (READER-5): the phone layout hides nothing that the focus
  // trap still counts, so Tab and Shift+Tab wrap inside the dialog.
  await auditDialog(page, "teaching mode", {
    open: () => openByText(page, ".document-tools button", "Teach"),
    containerSelector: ".teach-mode",
    whileOpen: async () => {
      inspected += await inspectControls(page, "teaching mode");
      if (!(await page.$eval('select[aria-label="Jump to teaching section"]', (select) => select.getClientRects().length > 0))) findings.push("teaching mode: the phone layout hides the section picker");
    },
  });

  await clickByText(page, ".document-tools button", "Whiteboard");
  await page.waitForSelector(".board-canvas");
  inspected += await inspectControls(page, "whiteboard");

  await page.goto(`${baseUrl}#/notebook`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".notebook-page");
  inspected += await inspectControls(page, "notebook");
  await auditDialog(page, "create-note dialog", {
    open: () => openByText(page, ".notebook-actions button", "New note"),
    containerSelector: "form.create-note-dialog",
    whileOpen: async () => { inspected += await inspectControls(page, "create note dialog"); },
    // Opener restore is deferred a frame past inert cleanup in the app
    // (useModalKeyboard/ReviewCardDialog), fixing the 2026-09-01 BUG-003
    // focus-restoration defect this check previously documented.
  });

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page");
  inspected += await inspectControls(page, "review center");
  await auditDialog(page, "review card dialog", {
    open: () => openByText(page, ".review-center-page button", "New card"),
    containerSelector: "form.review-card-dialog",
    whileOpen: async () => { inspected += await inspectControls(page, "review authoring"); },
    // Opener restore is deferred a frame past inert cleanup in the app
    // (useModalKeyboard/ReviewCardDialog), fixing the 2026-09-01 BUG-003
    // focus-restoration defect this check previously documented.
  });
  await clickByText(page, ".review-center-page button", "New card");
  await page.waitForSelector(".review-card-dialog");
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

  // Pass 1: complete focus-cycle contract for the settings drawer on its own.
  await auditDialog(page, "settings drawer", {
    open: () => openBySelector(page, 'button[aria-label="Open settings"]'),
    containerSelector: ".settings-drawer",
    // Opener restore is deferred a frame past inert cleanup in the app
    // (useModalKeyboard/ReviewCardDialog), fixing the 2026-09-01 BUG-003
    // focus-restoration defect this check previously documented.
  });

  // Pass 2: reopen for the static control inspection, then audit the nested
  // install sheet, whose close must hand back a functional settings drawer.
  await openBySelector(page, 'button[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  inspected += await inspectControls(page, "settings");
  await auditDialog(page, "install sheet (nested)", {
    open: () => openBySelector(page, ".install-card button"),
    containerSelector: ".install-sheet",
    whileOpen: async () => { inspected += await inspectControls(page, "install sheet"); },
    extraInertSelectors: [".settings-overlay"],
    expectBackgroundClearAfterClose: false,
    // Opener restore is deferred a frame past inert cleanup in the app
    // (useModalKeyboard/ReviewCardDialog), fixing the 2026-09-01 BUG-003
    // focus-restoration defect this check previously documented.
    afterClose: async () => {
      const overlayInert = await page.waitForFunction(
        () => document.querySelector(".settings-overlay")?.inert !== true,
        { timeout: 2_000 },
      ).then(() => false).catch(() => true);
      if (overlayInert) findings.push("install sheet (nested): .settings-overlay remained inert after the install sheet closed");
      assert.ok(await page.$(".settings-drawer"), "settings drawer disappeared after closing the nested install sheet");
      const focusInDrawer = await page.waitForFunction(
        () => Boolean(document.querySelector(".settings-drawer")?.contains(document.activeElement)),
        { timeout: 2_000 },
      ).then(() => true).catch(() => false);
      if (!focusInDrawer) findings.push(`install sheet (nested): focus did not return into the settings drawer (active: ${await describeActiveElement(page)})`);
    },
  });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".settings-drawer", { hidden: true, timeout: 5_000 });
  await page.waitForFunction(
    () => ![".app-topbar", ".view-container", ".bottom-nav"].some((selector) => document.querySelector(selector)?.inert),
    { timeout: 2_000 },
  ).catch(() => findings.push("settings drawer: background regions remained inert after the final close"));

  const selectsMeasured = await auditThemedSelects();

  assert.equal(runtimeErrors.length, 0, `browser errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(findings.length, 0, `control quality failures:\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  console.log(`Control audit passed: ${inspected} visible controls checked across home, library, reader, actions, teaching, whiteboard, notebook, review, and settings; dialog focus cycles verified (inert background, Tab trap and wrap, Shift+Tab wrap, Escape close, focus containment) for the reader actions menu, reader outline sheet, teaching mode, create-note dialog, review card dialog, settings drawer, and nested install sheet; opener focus-restore verified for all seven dialogs; and ${selectsMeasured} select measurements (Paper, Night and Contrast at 393px touch and 1280px) kept the themed select contract on every screen that hosts one.`);
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
