import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";

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
    explanation: "The test split is a final untouched estimate; using it for choices leaks evaluation information into development. [S1]",
    difficulty: "interview",
  }],
});

const jsonResponse = (payload, status = 200) => ({
  status,
  contentType: "application/json; charset=utf-8",
  headers: { "Cache-Control": "no-store", "X-Request-Id": "ai-ui-audit" },
  body: JSON.stringify(payload),
});

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const target = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    target?.click();
    return Boolean(target);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

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

const installAiMocks = async (page, configFactory, { failFirstResponse = false, failFirstResponseCode = "AI_LOCAL_MODEL_ERROR", abortFirstResponse = false, pairResponder = null } = {}) => {
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
      let body = {};
      try { body = JSON.parse(request.postData() || "{}"); } catch { body = {}; }
      calls.respond.push({ method: request.method(), url: request.url(), headers: request.headers(), body });
      if (abortFirstResponse && calls.respond.length === 1) {
        void request.abort("connectionfailed");
        return;
      }
      if (failFirstResponse && calls.respond.length === 1) {
        void request.respond(jsonResponse({
          ok: false,
          requestId: "audit-retry-failure",
          error: { code: failFirstResponseCode, message: "Temporary local-model failure." },
        }, 503));
        return;
      }
      if (body.task === "quiz") {
        void request.respond(jsonResponse({
          ok: true,
          requestId: "audit-quiz-request",
          outputText: JSON.stringify(quizData),
          data: quizData,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 320, outputTokens: 180, totalTokens: 500 },
          webSearch: { requested: false, used: false, rounds: 0 },
          sources: [],
        }));
      } else {
        const localCitation = body.context.match(/^\[(S\d+)\]/)?.[1] || "S1";
        const outputText = `## Holdout evaluation\n\nA **final holdout** remains useful only when development decisions cannot adapt to it. Repeated test inspection causes evaluation leakage. [${localCitation}]\n\n| Signal | Risk |\n| --- | --- |\n| Repeated inspection | Optimistic estimate |\n\nThe mean loss is $L = \\frac{1}{n}\\sum_i \\ell_i$.\n\n\`\`\`python\nscore = evaluate(frozen_model, holdout)\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  TRAIN[Development decisions] --> HOLDOUT[Final holdout]\n  HOLDOUT --> ESTIMATE[Unbiased estimate]\n\`\`\`\n\nCurrent release evidence is separately cited as [W1].`;
        const sources = body.webSearch ? [{ title: "PyTorch release notes", url: "https://pytorch.org/blog/releases/#stable", snippet: "Current release evidence." }] : [];
        const approach = { summary: "Ground in the local library, then use approved current evidence where needed.", steps: ["Locate relevant library evidence.", "Attach the approved web result.", "Present a concise answer with citations."] };
        const response = {
          ok: true,
          requestId: "audit-explain-request",
          outputText,
          data: null,
          status: "completed",
          model: "audit-local-model",
          usage: { inputTokens: 240, outputTokens: 46, totalTokens: 286 },
          webSearch: { requested: body.webSearch === true, used: body.webSearch === true, rounds: body.webSearch ? 1 : 0 },
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
          void request.respond({ status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store", "X-Request-Id": response.requestId, "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" }, body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
        } else void request.respond(jsonResponse(response));
      }
      return;
    }
    void request.continue();
  });
  return calls;
};

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
  assert.equal(
    await page.$eval('.ai-tutor__response-profiles input[value="deep"]', (input) => input.disabled),
    false,
    "Deep profile was unavailable although the model attests thinking support",
  );

  await page.waitForSelector(".ai-tutor__source.is-selected", { timeout: 10_000 });
  const disclosure = await page.$eval(".ai-tutor__privacy-body", (node) => node.textContent.replace(/\s+/g, " "));
  assert.match(disclosure, /local Ollama model running on the Lumen server/i);
  assert.match(disclosure, /no paid remote-model API/i);
  assert.match(disclosure, /saves up to 50 normalized tutor messages and web-source links locally/i);
  assert.match(disclosure, /includes them in exported backups/i);
  assert.match(disclosure, /Clear conversation/i);
  assert.match(disclosure, /no paid-provider key is accepted or exposed/i);

  // Web egress is available only after the complete-library sufficiency
  // check. Moving to any narrower source scope must clear and disable it.
  await page.click(".ai-tutor__web-search input");
  await page.click(".ai-tutor__source-panel-toggle");
  await clickByText(page, ".ai-tutor__source-modes button", "No library");
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "leaving Library first did not clear web fallback");
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.disabled), true, "web fallback remained enabled without whole-library retrieval");
  await clickByText(page, ".ai-tutor__source-modes button", "Library first");
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.disabled), false, "Library first did not restore the eligible web-fallback control");

  const sendSelector = ".ai-tutor__send";
  await page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "How does Double DQN reduce overestimation bias, and what is the latest implementation guidance?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "web search was not off by default");
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), true, "send was enabled before explicit consent");
  await page.click(".ai-tutor__consent input");
  assert.equal(await page.$eval(sendSelector, (button) => button.disabled), false, "one-time local disclosure acknowledgement did not enable a valid grounded request");
  await page.click(".ai-tutor__web-search input");
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
  assert.equal((await page.$$(".ai-tutor__response-text h2")).length, 1, "Markdown heading did not render");
  await page.waitForSelector('.ai-tutor__message--assistant .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 15_000 }).catch(async (error) => {
    const diagnostic = await page.$eval(".ai-tutor__message--assistant .diagram-shell", (node) => node.closest(".ai-tutor__response-text")?.outerHTML || node.outerHTML).catch(() => "<diagram shell missing>");
    error.message += `\nDiagram DOM: ${diagnostic.slice(0, 2_000)}\nRuntime errors: ${runtimeErrors.join(" | ") || "none"}`;
    throw error;
  });
  assert.equal(await page.$('.ai-tutor__message--assistant .diagram-diagnostic'), null, "valid tutor Mermaid displayed a failure diagnostic");
  const lightDiagramRenderCount = await page.$eval(".ai-tutor__message--assistant .mermaid", (node) => Number(node.dataset.diagramRenderCount));
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForFunction((before) => Number(document.querySelector(".ai-tutor__message--assistant .mermaid")?.dataset.diagramRenderCount) > before, { timeout: 15_000 }, lightDiagramRenderCount);
  assert.match(await page.$eval(".ai-tutor__message--assistant .mermaid svg", (node) => node.textContent), /Development decisions/iu, "theme rerender used SVG text instead of the preserved Mermaid definition");
  assert.equal(await page.$('.ai-tutor__message--assistant .diagram-diagnostic'), null, "theme change corrupted a valid tutor diagram");
  await page.evaluate(() => { document.documentElement.dataset.theme = "paper"; });
  assert.match(await page.$eval(".ai-tutor__message--assistant .ai-tutor__web-status.is-used", (node) => node.textContent), /evidence used/i, "completed current-web request did not visibly report that web evidence was used");
  await clickByText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Approach");
  assert.match(await page.$eval(".ai-tutor__approach", (node) => node.textContent.replace(/\s+/g, " ")), /Library retrieval attached [1-9]/i, "whole-library retrieval trace was not visible in the Approach panel");
  assert.equal((await page.$$(".ai-tutor__consent input")).length, 0, "remembered local disclosure unexpectedly asked for every request");
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "one-request web authorization was not consumed");
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
  assert.equal(
    await page.$eval(".ai-tutor__message--assistant .ai-tutor__message-actions", (node) => [...node.querySelectorAll("button")].find((button) => /saved to notes/i.test(button.textContent))?.disabled),
    true,
    "the save action did not disable after saving",
  );

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

  await page.evaluate(() => { window.location.hash = "#/ai"; });
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await page.waitForSelector(".ai-tutor__message--assistant", { timeout: 10_000 });
  await clickByText(page, ".ai-tutor__mode-tabs button", "Quiz");
  assert.equal(await page.$eval(".ai-tutor__mode-tabs button[aria-pressed='true']", (button) => button.textContent.trim()), "Quiz");
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
  await page.click(".ai-tutor__quiz-options label:nth-child(2) input");
  await clickByText(page, ".ai-tutor__quiz-question button", "Check answer");
  await page.waitForSelector(".ai-tutor__quiz-feedback.is-correct");
  assert.match(await page.$eval(".ai-tutor__quiz-feedback", (node) => node.textContent), /final untouched estimate/i);

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
  await retryConsent.page.click(".ai-tutor__web-search input");
  await retryConsent.page.click(sendSelector);
  await retryConsent.page.waitForSelector(".ai-tutor__request-error", { timeout: 10_000 });
  assert.equal(retryConsent.calls.respond.length, 1, "initial retry fixture request count was wrong");
  assert.match(await retryConsent.page.$eval(".ai-tutor__request-error .ai-tutor__web-status.is-failed", (node) => node.textContent), /fallback failed/i, "failed current-web request did not visibly identify the failed fallback");
  assert.equal(await retryConsent.page.$eval(".ai-tutor__request-error button", (button) => button.disabled), true, "web-search retry did not require renewed one-request authorization");
  await retryConsent.page.click(".ai-tutor__web-search input");
  assert.equal(await retryConsent.page.$eval(".ai-tutor__request-error button", (button) => button.disabled), false, "renewed web authorization did not enable retry");
  await retryConsent.page.click(".ai-tutor__request-error button");
  await retryConsent.page.waitForSelector(".ai-tutor__message--assistant", { timeout: 10_000 });
  assert.equal(retryConsent.calls.respond.length, 2, "retry was not sent exactly once after renewed consent");
  assert.equal(retryConsent.calls.respond[1].body.webSearch, true, "retry lost the disclosed web-search scope");
  assert.equal(await retryConsent.page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "retry web authorization was not consumed");
  await retryConsent.page.close();

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
  await staleConfig.page.click(sendSelector);
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
  await lostServer.page.click(sendSelector);
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
        const put = store.put(profile, "profile");
        put.onerror = () => reject(put.error);
        put.onsuccess = () => resolve();
      };
    };
  }));
  await noteScenario.page.evaluate(() => { window.location.hash = "#/ai"; });
  await noteScenario.page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await noteScenario.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  await noteScenario.page.$eval(".ai-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Explain the zephyrine-quorum trick from my notes.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (await noteScenario.page.$(".ai-tutor__consent input")) await noteScenario.page.click(".ai-tutor__consent input");
  await noteScenario.page.$eval(sendSelector, (button) => button.click());
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
  await noteScenario.page.close();

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
  await pairing.page.$eval(".ai-tutor__pairing input", (input) => { input.value = ""; });
  await pairing.page.type(".ai-tutor__pairing input", "correct-horse-battery");
  await pairing.page.$eval(".ai-tutor__pairing button[type='submit']", (button) => button.click());
  await pairing.page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
  assert.equal(pairing.calls.pair.length, 2, "pairing attempts were not sent exactly twice");
  assert.equal(pairing.calls.respond.length, 0, "an unpaired browser reached the AI response endpoint");
  assert.equal(await pairing.page.$(".ai-tutor__pairing"), null, "the pairing panel remained after a successful pairing");
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
  await clickByText(disabled.page, ".ai-tutor__connection button", "Check again");
  await disabled.page.waitForFunction(() => document.querySelector(".ai-tutor__connection--disabled"), { timeout: 8_000 });
  assert.ok(disabled.calls.config.length >= 2, "disabled-state configuration retry did not recheck the server");
  assert.equal(disabled.calls.respond.length, 0, "disabled configuration reached the AI response endpoint");
  await disabled.page.close();

  assert.deepEqual(runtimeErrors, [], `runtime errors: ${runtimeErrors.join(" | ")}`);
  console.log("AI UI audit passed: canonical fitted request bytes, request-contract handshake and version-skew fail-closed guidance, thinking-gated Deep profile, learner pairing gate with typed rejection, remembered local disclosure, one-request web authorization/retry, visible web states, sanitized evidence links, grounded citations including the exact personal-note deep link, validated quiz, answer-to-note clipping, bounded persistence/clear, and fail-closed states verified without a real model or search call.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
