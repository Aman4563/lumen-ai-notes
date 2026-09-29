import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";
import { installSpeechMock } from "./speech_mock.mjs";

// Issue #139: where a browser blocks site storage, reading localStorage
// itself throws, and a full store throws on write. Main crashed every route
// ("Lumen could not render this screen") because a default parameter read the
// accessor outside its try. This audit opens every route, and runs reading,
// narration, review, the whiteboard and both tutor engines, under two failure
// shapes at a phone and a desktop size:
// - a throwing accessor: reading window.localStorage or sessionStorage
//   throws a SecurityError, as blocked storage does;
// - a refusing store: getItem and removeItem throw a SecurityError and
//   setItem a QuotaExceededError.
// Settings must then say, once and politely, that preferences are not being
// saved; with working storage it must not. A third shape is Chrome's own
// cookie blocking, set in the profile: Web Storage and IndexedDB both fail,
// so nothing is saved and Settings must not say study data is.
const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const baseUrl = (process.env.LUMEN_URL || "http://127.0.0.1:4173/").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-storage-blocked-"));

const LECTURE = "notes/part-01-foundations/01-ai-ml-mental-model.md";
const BOARD_DOCUMENT = "notes/00-roadmap.md";
const NOTICE = "This browser is not saving preferences on this device";
const STUDY_DATA_SENTENCE = "Notes, progress and reviews are saved separately";
const SYNC_WARNING = "Sync needs this browser to save settings on this device";
const CRASH = "could not render this screen";
// The error boundary's screens: the app-wide one and the in-shell route one.
// (Text alone would match the device-evidence checklist, which quotes it.)
const CRASH_SELECTOR = ".fatal-error, .route-error";
const THEMES = [["paper", "Paper"], ["dark", "Night"], ["contrast", "Contrast"]];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const MODES = [
  {
    name: "throwing accessor",
    install: () => {
      const blocked = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
      for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { configurable: true, get: blocked });
    },
  },
  {
    name: "refusing store",
    install: () => {
      const refuse = (name, message) => function refused() { throw new DOMException(message, name); };
      Storage.prototype.getItem = refuse("SecurityError", "The operation is insecure.");
      Storage.prototype.removeItem = refuse("SecurityError", "The operation is insecure.");
      Storage.prototype.setItem = refuse("QuotaExceededError", "The quota has been exceeded.");
    },
  },
];
const VIEWPORTS = [
  ["phone", { width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ["desktop", { width: 1280, height: 800, deviceScaleFactor: 1 }],
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(expected));
    node?.click();
    return Boolean(node);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

// A ready Mac tutor: the server configuration and one grounded answer.
const aiConfig = {
  ok: true,
  enabled: true,
  requestContract: AI_REQUEST_CONTRACT_ID,
  provider: "ollama-local",
  model: "audit-local-model",
  unavailableReason: null,
  endpoint: "/api/ai/respond",
  streamEndpoint: "/api/ai/respond/stream",
  streamProtocol: "lumen.ai.ndjson.v1",
  service: { configured: true, reachable: true, modelInstalled: true, modelIdentityRequired: true, modelIdentityVerified: true, completionCapable: true, toolCallingCapable: true, thinkingCapable: true, checkedAt: new Date().toISOString() },
  webSearch: { configured: false, reachable: false, available: false, macToolAvailable: false, requiresPerRequestOptIn: true, tool: "search_web", endpoint: "/api/local-search", maxResults: 5, maxRounds: 2 },
  supportedTasks: ["tutor", "explain", "socratic", "quiz", "flashcards", "interview", "summarize", "study_plan", "answer_feedback", "code_review"],
  structuredTasks: ["quiz", "flashcards", "study_plan", "answer_feedback"],
  responseProfiles: {
    default: "balanced",
    allowed: ["fast", "balanced", "deep"],
    outputTokens: { fast: 1_200, balanced: 3_000, deep: 4_096 },
    maxRequestUtf8Bytes: { fast: 10_000, balanced: 8_740, deep: 7_000 },
    deepUsesPrivateModelThinkingWhenSupported: true,
    providerThinkingReturned: false,
  },
  limits: { maxInputChars: 24_000, maxRequestUtf8Bytes: 8_740, maxOutputTokens: 4_096, requestTimeoutMs: 55_000, clientTimeoutMs: 70_000 },
  privacy: {
    localInference: true,
    paidRemoteApisUsed: false,
    apiKeyRequired: false,
    responseStorage: false,
    applicationServerStorage: false,
    apiKeyExposedToBrowser: false,
    browserCanSelectProviderOrModel: false,
    builtInRemoteToolsEnabled: false,
    webSearchDisabledByDefaultPerRequest: true,
    serviceEndpointsExposedToBrowser: false,
    dataSentWhenRequested: ["learner prompt", "selected curriculum context", "document title", "difficulty level", "bounded conversation history"],
  },
  usage: { tokenCountsReturnedAfterRequest: true, costEstimateReturned: false },
};
const jsonReply = (payload) => ({ status: 200, contentType: "application/json; charset=utf-8", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(payload) });
const installAiMocks = async (page) => {
  const calls = { respond: 0 };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/config") {
      request.respond(jsonReply(aiConfig)).catch(() => {});
      return;
    }
    if (url.pathname === "/api/ai/respond" || url.pathname === "/api/ai/respond/stream") {
      calls.respond += 1;
      let body = {};
      try { body = JSON.parse(request.postData() || "{}"); } catch { body = {}; }
      const label = String(body.context || "").match(/^\[(S\d+)\]/)?.[1] || "S1";
      const approach = { summary: "Answer from the library passages.", steps: ["Find the relevant passage.", "Answer with its citation."] };
      const response = {
        ok: true,
        requestId: "storage-blocked-audit",
        outputText: `A final holdout stays unbiased only while no development choice adapts to it. [${label}]`,
        data: null,
        status: "completed",
        model: "audit-local-model",
        usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 },
        webSearch: { requested: false, used: false, rounds: 0 },
        sources: [],
        approach,
      };
      if (!url.pathname.endsWith("/stream")) {
        request.respond(jsonReply(response)).catch(() => {});
        return;
      }
      const events = [
        { type: "start", protocol: "lumen.ai.ndjson.v1", requestId: response.requestId, model: response.model, responseFormat: "markdown", responseProfile: body.responseProfile, startedAt: new Date().toISOString() },
        { type: "approach", requestId: response.requestId, approach },
        { type: "delta", requestId: response.requestId, sequence: 0, text: response.outputText },
        { type: "complete", requestId: response.requestId, response },
      ];
      request.respond({ status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store", "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" }, body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` }).catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  });
  return calls;
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

// Saves are debounced, so poll until IndexedDB holds the expected value.
const waitForStored = async (page, key, predicate, message, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  do {
    if (predicate(await readStored(page, key).catch(() => null))) return;
    await delay(150);
  } while (Date.now() < deadline);
  assert.fail(message);
};

const settle = (page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const finite = document.getAnimations().filter((animation) => animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime));
  await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 2_000))]);
});

const axeViolations = async (page, selector) => {
  if (!await page.evaluate(() => typeof window.axe !== "undefined")) await page.evaluate(axeSource);
  return page.evaluate(async (context, tags) => {
    const result = await window.axe.run(document.querySelector(context), { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return result.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id} on ${node.target.join(" ")}`));
  }, selector, AXE_TAGS);
};

const failures = [];
const stats = { cases: 0, routes: 0, loads: 0, axeRuns: 0 };
let browser;

// Runs one mode at one size in a fresh profile; failures are collected so one
// broken flow cannot hide the others.
const runCase = async (label, { install, viewport, browserInstance = browser }, run) => {
  const context = await browserInstance.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  stats.cases += 1;
  try {
    await page.setViewport(viewport);
    if (install) await page.evaluateOnNewDocument(install);
    await page.evaluateOnNewDocument(installSpeechMock, {});
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
    const calls = await installAiMocks(page);
    const crashed = () => page.evaluate((selector) => Boolean(document.querySelector(selector)), CRASH_SELECTOR);
    const assertRendered = async (where) => assert.equal(await crashed(), false, `${where} showed “Lumen ${CRASH}” (${errors.slice(-2).join(" | ") || "no browser error"})`);
    // Each route is a real document load, so every route is also an entry
    // point. A goto that changes only the hash stays in the same document, so
    // the page leaves through about:blank, and a marker proves it did.
    const open = async (hash, ready) => {
      stats.routes += 1;
      await page.evaluate(() => { window.__lumenAuditEarlierDocument = true; }).catch(() => {});
      await page.goto("about:blank", { timeout: 30_000 });
      await page.goto(`${baseUrl}/${hash}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      assert.equal(await page.evaluate(() => window.__lumenAuditEarlierDocument === true), false, `${hash} did not load as a new document`);
      stats.loads += 1;
      await page.waitForFunction((selector, crash) => document.querySelector(selector) || document.querySelector(crash), { timeout: 20_000 }, ready, CRASH_SELECTOR)
        .catch(() => assert.fail(`${hash} never showed ${ready}`));
      await assertRendered(hash);
      assert.ok(await page.$(ready), `${hash} never showed ${ready}`);
    };
    await run({ page, context, open, assertRendered, calls });
    await assertRendered("the last screen");
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  } catch (error) {
    failures.push(`${label}: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close().catch(() => {});
  }
};

const openSettings = async (page) => {
  await page.$eval('button[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".settings-drawer .theme-choices", { timeout: 10_000 });
};
const closeSettings = async (page) => {
  await page.$eval(".settings-close", (button) => button.click());
  await page.waitForSelector(".settings-drawer", { hidden: true });
};
// What a screen reader is offered: the visible notice, and the text of any
// status region in Settings that carries it.
const noticeState = (page) => page.evaluate((title) => {
  const notice = document.querySelector(".settings-drawer .settings-storage-notice");
  const announced = [...document.querySelectorAll(".settings-drawer [role='status']")].map((node) => node.textContent).filter((text) => text.includes(title));
  return {
    visible: Boolean(notice?.getClientRects().length),
    text: notice?.querySelector("strong")?.textContent || "",
    detail: notice?.querySelector("span")?.textContent || "",
    announced: announced.join(" | "),
    announcedRegions: announced.length,
  };
}, NOTICE);

// Samples every frame from before Settings opens: a polite region is announced
// when its text changes, so the region that carries the notice must have been
// on screen and empty in an earlier frame (not inserted already filled).
const watchAnnouncement = (page) => page.evaluate((title) => {
  const seenEmpty = new WeakSet();
  const result = { frames: 0, filled: false, filledAfterEmptyFrame: false };
  window.__lumenAuditAnnouncement = result;
  const sample = () => {
    result.frames += 1;
    for (const region of document.querySelectorAll(".settings-drawer [role='status']")) {
      if (!region.textContent.trim()) seenEmpty.add(region);
      else if (region.textContent.includes(title) && !result.filled) {
        result.filled = true;
        result.filledAfterEmptyFrame = seenEmpty.has(region);
      }
    }
    if (!result.filled && result.frames < 1_800) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}, NOTICE);
const expectAnnouncement = async (page) => {
  await page.waitForFunction(() => window.__lumenAuditAnnouncement?.filled, { timeout: 8_000 })
    .catch(() => assert.fail("Settings did not announce that preferences are not being saved"));
  const announcement = await page.evaluate(() => window.__lumenAuditAnnouncement);
  assert.ok(announcement.filledAfterEmptyFrame, `the storage notice went into a status region that was never on screen empty, so it may not be announced: ${JSON.stringify(announcement)}`);
};
// The announcement leaves its region once read, so browse mode meets the
// notice once, and a later change can never leave stale text behind.
const expectAnnouncementCleared = (page) => page.waitForFunction((title) => ![...document.querySelectorAll(".settings-drawer [role='status']")].some((node) => node.textContent.includes(title)), { timeout: 10_000 }, NOTICE)
  .catch(() => assert.fail("the storage notice stayed in a status region after it was announced, so browse mode reads it twice"));

// With a passphrase entered, only failing storage keeps a vault from being
// created or joined, and the sync card says why.
const syncState = (page) => page.evaluate((warning) => {
  const card = document.querySelector(".settings-drawer .sync-card");
  const button = (label) => [...card.querySelectorAll("button")].find((node) => node.textContent.includes(label));
  return {
    warning: [...card.querySelectorAll(".inline-warning")].some((node) => node.textContent.includes(warning) && node.getClientRects().length),
    createDisabled: button("Create sync vault")?.disabled,
    joinDisabled: button("Join via a peer")?.disabled,
  };
}, SYNC_WARNING);
const typePassphrase = async (page) => {
  await page.$eval('.settings-drawer input[aria-label="Sync vault passphrase"]', (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(field, "blocked storage vault passphrase");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// Every route and the core flows, with storage failing in `mode`.
const blockedStorageFlows = (viewportName) => async ({ page, open, assertRendered, calls }) => {
  await open("#/home", ".welcome-block");

  // Library: a committed search shows as a recent search for this visit.
  await open("#/library", ".library-page");
  await page.type('input[aria-label="Search library"]', "gradient");
  await page.waitForFunction(() => [...document.querySelectorAll(".library-page .document-card")].some((card) => /gradient/i.test(card.textContent)), { timeout: 10_000 })
    .catch(() => assert.fail("the library search found nothing for “gradient”"));
  await page.keyboard.press("Enter");
  await page.$eval('button[aria-label="Clear search"]', (button) => button.click());
  await page.waitForSelector('button[aria-label="Repeat recent search gradient"]', { timeout: 5_000 })
    .catch(() => assert.fail("a committed library search was not kept for this visit"));

  // Reader and Listen: full-lecture narration plays and advances while every
  // position write is refused; a bookmark reports that it was not saved.
  await open(`#/read/${encodeURIComponent(LECTURE)}`, ".reader-view .markdown-body h1");
  await page.$eval('button[aria-label="Listen"]', (button) => button.click());
  await page.waitForSelector('.speech-popover[role="dialog"]', { timeout: 5_000 });
  await clickByText(page, ".speech-controls button", "Read full lecture");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]', { timeout: 5_000 })
    .catch(() => assert.fail("full-lecture narration did not start"));
  for (let step = 2; step <= 4; step += 1) {
    await page.evaluate(() => window.speechSynthesis.current?.onend?.());
    await page.waitForFunction((expected) => Number(document.querySelector(".audio-label strong")?.textContent.match(/(\d+)\//)?.[1]) === expected, { timeout: 5_000 }, step)
      .catch(() => assert.fail(`narration did not advance to sentence ${step}`));
  }
  await page.$eval('button[aria-label="Bookmark this sentence"]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("could not save the bookmark"), { timeout: 5_000 })
    .catch(() => assert.fail("a bookmark that could not be stored was not reported"));
  await page.$eval('button[aria-label="Stop narration"]', (button) => button.click());
  await assertRendered("the Reader after narration");

  // Review: create a card, study it and grade it.
  await open("#/review", ".review-center-page");
  await clickByText(page, ".review-center-page button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const fields = await page.$$(".review-card-dialog textarea");
  await fields[0].type("Why must the final holdout stay untouched?");
  await fields[1].type("Choices tuned on it leak evaluation information.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForSelector(".review-deck-card", { timeout: 5_000 });
  await clickByText(page, ".review-hero button", "Start review");
  await page.waitForSelector(".review-session-page", { timeout: 5_000 });
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.waitForSelector(".review-answer", { timeout: 5_000 });
  await clickByText(page, ".review-rating", "Good");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "0", { timeout: 5_000 })
    .catch(() => assert.fail("grading the card did not clear today's queue"));

  await open("#/notebook", ".notebook-page");

  // Whiteboard: a drawn arrow is saved to IndexedDB while the cross-tab
  // storage signal is refused.
  await open(`#/board/${encodeURIComponent(BOARD_DOCUMENT)}`, ".board-canvas");
  const arrowPanel = await page.$eval('button[aria-label="Arrow"]', (node) => {
    const panel = node.closest("[data-board-panel]");
    return panel?.hidden ? panel.getAttribute("data-board-panel") : "";
  });
  if (arrowPanel) await page.click(`[data-board-toggle="${arrowPanel}"]`);
  await page.click('button[aria-label="Arrow"]');
  await page.waitForFunction(() => Number(document.querySelector(".board-canvas")?.dataset.pageWidth) > 0);
  const box = await page.$eval(".board-canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left + Number(canvas.dataset.pageLeft), top: rect.top + Number(canvas.dataset.pageTop), width: Number(canvas.dataset.pageWidth), height: Number(canvas.dataset.pageHeight) };
  });
  await page.mouse.move(box.left + box.width * 0.2, box.top + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.left + box.width * 0.7, box.top + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".board-hint")?.textContent.includes("1 object"), { timeout: 5_000 })
    .catch(() => assert.fail("the arrow was not drawn"));
  await waitForStored(page, `board:${BOARD_DOCUMENT}`, (board) => board?.pages?.[0]?.objects?.length === 1, "the drawn arrow was not saved to IndexedDB");

  // The Mac tutor: acknowledge the disclosure in the UI and get an answer.
  await open("#/ai", ".ai-learning-studio");
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 })
    .catch(() => assert.fail("the Mac tutor never became ready"));
  await page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Why must the final holdout stay untouched?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click(".ai-tutor__consent input");
  await page.waitForFunction(() => document.querySelector(".ai-tutor__send")?.disabled === false, { timeout: 5_000 })
    .catch(() => assert.fail("acknowledging the local-model disclosure did not enable Send"));
  await page.$eval(".ai-tutor__send", (button) => button.click());
  await page.waitForFunction(() => [...document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)")].some((node) => node.textContent.includes("final holdout")), { timeout: 15_000 })
    .catch(async () => assert.fail(`the Mac tutor answer never arrived (${calls.respond} requests): ${await page.evaluate(() => (document.querySelector(".ai-tutor")?.innerText || "").replace(/\s+/g, " ").slice(-700))}`));

  // On-device Lite renders, and the engine choice (localStorage) and an
  // unsent Mac draft (sessionStorage) hold for this visit although neither
  // can be stored.
  const draft = "Which choices may the validation split drive?";
  await page.$eval(".ai-tutor__composer textarea", (field, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, draft);
  await page.$eval('[data-ai-engine-option="phone-local"]', (button) => button.click());
  await page.waitForSelector(".ai-learning-studio[data-ai-engine='phone-local'] .phone-tutor", { timeout: 15_000 })
    .catch(() => assert.fail("On-device Lite did not render"));
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForSelector(".welcome-block", { timeout: 10_000 });
  await page.evaluate(() => { location.hash = "#/ai"; });
  await page.waitForSelector(".ai-learning-studio", { timeout: 10_000 });
  assert.equal(await page.$eval(".ai-learning-studio", (node) => node.dataset.aiEngine), "phone-local", "the engine choice reset on a route change");
  await page.waitForSelector(".phone-tutor", { timeout: 15_000 });
  await assertRendered("On-device Lite");
  await page.$eval('[data-ai-engine-option="mac-local"]', (button) => button.click());
  await page.waitForSelector(".ai-tutor__composer textarea", { timeout: 10_000 });
  assert.equal(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), draft, "the unsent Mac tutor draft was lost across an engine switch and a route change");

  await open("#/device-evidence", ".device-evidence-page");

  // Settings: the notice shows and is announced once; Settings still works.
  await open("#/home", ".welcome-block");
  await watchAnnouncement(page);
  await openSettings(page);
  await expectAnnouncement(page);
  const first = await noticeState(page);
  assert.ok(first.visible && first.text === NOTICE, `the storage notice was not shown: ${JSON.stringify(first)}`);
  assert.equal(first.announcedRegions, 1, "the notice was announced more than once");
  // IndexedDB works in this mode, and Settings says so once a write proved it.
  assert.ok(first.detail.includes(STUDY_DATA_SENTENCE) && first.announced.includes(STUDY_DATA_SENTENCE), `with IndexedDB working the notice did not say study data is saved: ${JSON.stringify(first)}`);
  for (const [theme, label] of THEMES) {
    await clickByText(page, ".theme-choices button", label);
    await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, { timeout: 5_000 }, theme);
    await settle(page);
    const violations = await axeViolations(page, ".settings-drawer");
    stats.axeRuns += 1;
    assert.deepEqual(violations, [], `${label}: axe found violations in Settings with the storage notice`);
  }
  await expectAnnouncementCleared(page);
  assert.ok((await noticeState(page)).visible, "the visible storage notice left with its announcement");
  await clickByText(page, ".theme-choices button", "Paper");
  await closeSettings(page);
  await openSettings(page);
  await delay(600);
  const reopened = await noticeState(page);
  assert.ok(reopened.visible, "the storage notice disappeared on reopening Settings");
  assert.equal(reopened.announced, "", "reopening Settings announced the storage notice again");
  // A vault would be forgotten when Lumen closes, so sync says so and stays off.
  await typePassphrase(page);
  assert.deepEqual(await syncState(page), { warning: true, createDisabled: true, joinDisabled: true }, "with storage failing, the sync card let a vault be created or joined, or did not say why not");
  // The theme was saved to IndexedDB, which blocked Web Storage never touches.
  await waitForStored(page, "profile", (profile) => profile?.settings?.theme === "paper", "a Settings change was not saved while Web Storage failed");

  // The notice fits a 320 px phone at 200% text.
  if (viewportName === "phone") {
    await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    await settle(page);
    const layout = await page.evaluate(() => {
      const notice = document.querySelector(".settings-storage-notice");
      const box = notice.getBoundingClientRect();
      const text = [...notice.querySelectorAll("strong, span")].map((node) => node.getBoundingClientRect().right);
      return { scrollWidth: notice.scrollWidth, clientWidth: notice.clientWidth, left: box.left, right: box.right, textRight: Math.max(...text), viewport: document.documentElement.clientWidth };
    });
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1 && layout.left >= 0 && layout.right <= layout.viewport + 1 && layout.textRight <= layout.right + 1, `at 320 px and 200% text the storage notice does not fit: ${JSON.stringify(layout)}`);
  }
};

// Chrome's own cookie blocking, set in the profile (not an injected mock):
// localStorage throws and IndexedDB will not open, so nothing lasts.
const ROUTES = [
  ["#/home", ".welcome-block"],
  ["#/library", ".library-page"],
  [`#/read/${encodeURIComponent(LECTURE)}`, ".reader-view .markdown-body h1"],
  ["#/review", ".review-center-page"],
  ["#/notebook", ".notebook-page"],
  [`#/board/${encodeURIComponent(BOARD_DOCUMENT)}`, ".board-canvas"],
  ["#/ai", ".ai-learning-studio"],
  ["#/device-evidence", ".device-evidence-page"],
];
const waitForFiles = async (directory, pattern) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = (await readdir(directory)).filter((name) => pattern.test(name));
    if (found.length) return found;
    await delay(100);
  }
  return [];
};
const saveStatusText = (page) => page.evaluate(() => [...document.querySelectorAll(".settings-drawer .microcopy")].map((node) => node.textContent).find((text) => text.includes("Save status:"))?.match(/Save status: (\w+)/)?.[1] || "");
const siteDataBlockedFlows = (viewportName) => async ({ page, context, open }) => {
  await open("#/home", ".welcome-block");
  const blocked = await page.evaluate(async () => {
    let local = "saves";
    try { localStorage.getItem("lumen.audit"); } catch (error) { local = error.name; }
    const database = await new Promise((resolve) => {
      try {
        const request = indexedDB.open("lumen-storage-blocked-audit");
        request.onsuccess = () => { request.result.close(); resolve("saves"); };
        request.onerror = () => resolve(request.error?.name || "error");
      } catch (error) {
        resolve(error.name);
      }
    });
    return { local, database };
  });
  assert.ok(blocked.local !== "saves" && blocked.database !== "saves", `Chrome's cookie blocking did not block site storage, so this case proves nothing: ${JSON.stringify(blocked)}`);

  // First open, before anything tried to save: Save status still reads
  // "saved", so the notice must not lean on it to say study data is saved.
  await watchAnnouncement(page);
  await openSettings(page);
  await expectAnnouncement(page);
  const first = await noticeState(page);
  assert.ok(first.visible && first.text === NOTICE, `the storage notice was not shown: ${JSON.stringify(first)}`);
  assert.ok(!first.detail.includes(STUDY_DATA_SENTENCE) && !first.announced.includes(STUDY_DATA_SENTENCE), `with IndexedDB blocked as well, Settings said study data is saved: ${JSON.stringify(first)}`);
  await typePassphrase(page);
  assert.deepEqual(await syncState(page), { warning: true, createDisabled: true, joinDisabled: true }, "with site data blocked, the sync card let a vault be created or joined, or did not say why not");
  await closeSettings(page);

  // Every route still renders as an entry point.
  if (viewportName === "phone") {
    for (const [hash, ready] of ROUTES.slice(1)) await open(hash, ready);
  }

  // Export works: the backup downloads, although its export date cannot be
  // recorded, and the toast says so instead of "Backup failed".
  const downloads = await mkdtemp(join(profileDirectory, "downloads-"));
  const session = await page.createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, browserContextId: context.id });
  await open("#/home", ".welcome-block");
  await openSettings(page);
  await clickByText(page, ".settings-drawer button", "Export backup");
  await page.waitForFunction(() => /Backup/.test(document.querySelector(".toast")?.textContent || ""), { timeout: 15_000 })
    .catch(() => assert.fail("Export backup showed no result"));
  const exported = await page.$eval(".toast", (node) => node.textContent);
  assert.ok(!exported.includes("Backup failed") && exported.includes("downloaded"), `a backup that downloaded was reported as “${exported}”`);
  assert.equal((await waitForFiles(downloads, /^lumen-notes-backup-.*\.json$/)).length, 1, "Export backup did not download its file");

  // A change cannot be saved: the toast points to a backup (storage is
  // blocked, not full), Save status turns to "error" and the notice still
  // makes no claim about study data.
  await clickByText(page, ".theme-choices button", "Night");
  await page.waitForFunction(() => (document.querySelector(".toast")?.textContent || "").includes("before closing or reloading"), { timeout: 15_000 })
    .catch(() => assert.fail("a change that could not be saved was not reported"));
  const unsaved = await page.$eval(".toast", (node) => node.textContent);
  assert.ok(unsaved.includes("export a backup") && !unsaved.includes("reduce local data"), `blocked storage was reported as full: “${unsaved}”`);
  await page.waitForFunction(() => [...document.querySelectorAll(".settings-drawer .microcopy")].some((node) => node.textContent.includes("Save status: error")), { timeout: 10_000 })
    .catch(async () => assert.fail(`Save status did not turn to "error" (it reads "${await saveStatusText(page)}")`));
  const after = await noticeState(page);
  assert.ok(after.visible && !after.detail.includes(STUDY_DATA_SENTENCE), `after a failed save the notice said study data is saved: ${JSON.stringify(after)}`);
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  for (const mode of MODES) {
    for (const [viewportName, viewport] of VIEWPORTS) {
      await runCase(`${mode.name} at ${viewportName}`, { install: mode.install, viewport }, blockedStorageFlows(viewportName));
    }
  }
  // Control: with working storage there is no notice, sync works, and
  // preferences are really stored, so they survive a reload.
  await runCase("working storage", { viewport: VIEWPORTS[0][1] }, async ({ page, open }) => {
    await open("#/ai", ".ai-learning-studio");
    await page.$eval('[data-ai-engine-option="phone-local"]', (button) => button.click());
    await page.waitForSelector(".ai-learning-studio[data-ai-engine='phone-local']", { timeout: 10_000 });
    await page.evaluate(() => { window.__lumenAuditEarlierDocument = true; });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".ai-learning-studio", { timeout: 20_000 });
    assert.equal(await page.evaluate(() => window.__lumenAuditEarlierDocument === true), false, "the page did not reload");
    assert.equal(await page.evaluate(() => localStorage.getItem("lumen.ai.engine.v1")), "phone-local", "the engine choice never reached localStorage");
    assert.equal(await page.$eval(".ai-learning-studio", (node) => node.dataset.aiEngine), "phone-local", "the engine choice did not survive a reload");
    await openSettings(page);
    await delay(500);
    assert.equal((await noticeState(page)).visible, false, "Settings claimed storage was failing while it works");
    await typePassphrase(page);
    assert.deepEqual(await syncState(page), { warning: false, createDisabled: false, joinDisabled: false }, "with working storage the sync card still blocked Create and Join");
    assert.equal(await page.evaluate(() => localStorage.getItem("lumen.storage-probe.v1")), null, "the storage probe left its key behind");
  });

  // Chrome's cookie blocking comes from the profile, so it needs a browser
  // of its own; its contexts inherit the block.
  const blockedProfile = join(profileDirectory, "site-data-blocked");
  await mkdir(join(blockedProfile, "Default"), { recursive: true });
  await writeFile(join(blockedProfile, "Default", "Preferences"), JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } }));
  const blockedBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: blockedProfile,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  try {
    for (const [viewportName, viewport] of VIEWPORTS) {
      await runCase(`blocked site data at ${viewportName}`, { viewport, browserInstance: blockedBrowser }, siteDataBlockedFlows(viewportName));
    }
  } finally {
    await blockedBrowser.close();
  }

  assert.deepEqual(failures, [], `blocked-storage failures:\n- ${failures.join("\n- ")}`);
  console.log(`Blocked-storage audit passed: ${stats.cases} cases (${MODES.map((mode) => mode.name).join(" and ")} and Chrome's own cookie blocking at 393x852 and 1280x800, plus working storage) loaded ${stats.loads} routes as new documents (Home, Library, Reader with Listen, Review, Notebook, Board, both AI engines, device evidence, Settings) without “Lumen ${CRASH}”; library search, narration and bookmarks, review grading, whiteboard saving and a Mac tutor answer worked, and the engine choice and an unsent draft held for the visit; Settings announced the notice once through a region that was empty first and cleared after, kept it on reopening, said study data is saved only after IndexedDB took a write, kept sync off, fit 320 px at 200% text and passed ${stats.axeRuns} axe runs in Paper, Night and Contrast; with IndexedDB blocked too, Export backup downloaded and said so; with working storage the engine choice survived a real reload.`);
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
