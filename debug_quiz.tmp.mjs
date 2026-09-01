import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

import { AI_REQUEST_CONTRACT_ID } from "./src/lib/aiContract.js";

const baseUrl = "http://127.0.0.1:4173/";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-debug-quiz-"));

const supportedTasks = ["tutor", "explain", "socratic", "quiz", "flashcards", "interview", "summarize", "study_plan", "answer_feedback", "code_review"];
const secureConfig = {
  ok: true, enabled: true, requestContract: AI_REQUEST_CONTRACT_ID, provider: "ollama-local", model: "audit-local-model",
  unavailableReason: null, endpoint: "/api/ai/respond", streamEndpoint: "/api/ai/respond/stream", streamProtocol: "lumen.ai.ndjson.v1",
  service: { configured: true, reachable: true, modelInstalled: true, modelIdentityRequired: true, modelIdentityVerified: true, completionCapable: true, toolCallingCapable: true, thinkingCapable: true, checkedAt: new Date().toISOString() },
  webSearch: { configured: true, reachable: true, available: true, macToolAvailable: true, requiresPerRequestOptIn: true, tool: "search_web", endpoint: "/api/local-search", maxResults: 5, maxRounds: 2 },
  supportedTasks,
  structuredTasks: ["quiz", "flashcards", "study_plan", "answer_feedback"],
  responseProfiles: { default: "balanced", allowed: ["fast", "balanced", "deep"], outputTokens: { fast: 1_200, balanced: 3_000, deep: 4_096 }, maxRequestUtf8Bytes: { fast: 10_000, balanced: 8_740, deep: 7_000 }, deepUsesPrivateModelThinkingWhenSupported: true, providerThinkingReturned: false },
  limits: { maxInputChars: 24_000, maxRequestUtf8Bytes: 8_740, maxOutputTokens: 4_096, requestTimeoutMs: 55_000, clientTimeoutMs: 70_000 },
  privacy: { localInference: true, paidRemoteApisUsed: false, apiKeyRequired: false, responseStorage: false, applicationServerStorage: false, apiKeyExposedToBrowser: false, browserCanSelectProviderOrModel: false, builtInRemoteToolsEnabled: false, webSearchDisabledByDefaultPerRequest: true, serviceEndpointsExposedToBrowser: false, dataSentWhenRequested: [] },
  usage: { tokenCountsReturnedAfterRequest: true, costEstimateReturned: false },
};
const quizData = { title: "T", instructions: "I", questions: [{ id: "q1", prompt: "P? [S1]", options: ["a", "b"], correctIndex: 1, explanation: "E [S1]", difficulty: "interview" }] };
const jsonResponse = (payload, status = 200) => ({ status, contentType: "application/json; charset=utf-8", headers: { "Cache-Control": "no-store", "X-Request-Id": "dbg" }, body: JSON.stringify(payload) });

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profileDirectory, args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"] });
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });
const respondBodies = [];
await page.setRequestInterception(true);
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname === "/api/ai/config") { void request.respond(jsonResponse(secureConfig)); return; }
  if (url.pathname === "/api/ai/respond" || url.pathname === "/api/ai/respond/stream") {
    let body = {};
    try { body = JSON.parse(request.postData() || "{}"); } catch {}
    respondBodies.push({ path: url.pathname, task: body.task, format: body.responseFormat });
    if (body.task === "quiz") {
      void request.respond(jsonResponse({ ok: true, requestId: "dbg-quiz", outputText: JSON.stringify(quizData), data: quizData, status: "completed", model: "audit-local-model", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, webSearch: { requested: false, used: false, rounds: 0 }, sources: [] }));
      return;
    }
    const localCitation = (body.context || "").match(/^\[(S\d+)\]/)?.[1] || "S1";
    const requestId = "dbg-stream";
    const response = { ok: true, requestId, status: "completed", model: "audit-local-model", outputText: `Grounded answer with [${localCitation}] and web evidence [W1].`, data: null, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, webSearch: { requested: body.webSearch === true, used: body.webSearch === true, rounds: body.webSearch ? 1 : 0 }, sources: body.webSearch ? [{ title: "PyTorch releases", url: "https://pytorch.org/blog/releases/", snippet: "Release history.", source: "pytorch.org" }] : [], approach: { summary: "Answered from supplied evidence.", steps: ["Read sources", "Compose"] } };
    const events = [
      { type: "start", requestId, model: response.model, responseFormat: "markdown", responseProfile: body.responseProfile || "balanced", protocol: "lumen.ai.ndjson.v1" },
      { type: "approach", requestId, approach: response.approach },
      ...(body.webSearch ? [{ type: "source", requestId, index: 1, source: response.sources[0] }] : []),
      { type: "delta", requestId, sequence: 0, text: response.outputText.slice(0, 10) },
      { type: "delta", requestId, sequence: 1, text: response.outputText.slice(10) },
      { type: "complete", requestId, response },
    ];
    void request.respond({ status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store", "X-Request-Id": requestId, "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" }, body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
    return;
  }
  void request.continue();
});
await page.goto(`${baseUrl}#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
// acknowledge disclosure via the checkbox like the audit does
await page.waitForSelector(".ai-tutor__consent input", { timeout: 10_000 });
await page.$eval(".ai-tutor__composer textarea", (field) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(field, "How does Double DQN reduce overestimation bias?");
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click(".ai-tutor__consent input");
await page.click(".ai-tutor__send");
await page.waitForSelector(".ai-tutor__message--assistant", { timeout: 15_000 });
console.log("first response done, respond calls:", respondBodies.length);
// save to notes
await page.$$eval(".ai-tutor__message--assistant .ai-tutor__message-actions button", (ns) => ns.find((n) => /save to notes/i.test(n.textContent))?.click());
await new Promise((r) => setTimeout(r, 700));
// citation navigate
await page.evaluate(async () => {
  for (let attempt = 0; attempt < 6 && !window.location.hash.startsWith("#/read/"); attempt += 1) {
    document.querySelector(".ai-tutor__message--assistant button.ai-tutor__citation[data-ai-citation]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});
console.log("hash after citation:", await page.evaluate(() => window.location.hash));
await page.evaluate(() => { window.location.hash = "#/ai"; });
await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 10_000 });
await page.waitForSelector(".ai-tutor__message--assistant", { timeout: 10_000 });
await page.$$eval(".ai-tutor__mode-tabs button", (nodes) => nodes.find((n) => n.textContent.includes("Quiz"))?.click());
console.log("pressed:", await page.$eval(".ai-tutor__mode-tabs button[aria-pressed='true']", (b) => b.textContent.trim()));
console.log("send disabled:", await page.$eval(".ai-tutor__send", (b) => b.disabled));
await page.click(".ai-tutor__send");
await new Promise((r) => setTimeout(r, 2500));
console.log("respond calls:", JSON.stringify(respondBodies));
console.log("quiz present:", Boolean(await page.$(".ai-tutor__quiz")));
console.log("send text now:", await page.$eval(".ai-tutor__send", (b) => b.textContent.trim()));
await browser.close();
await rm(profileDirectory, { recursive: true, force: true });
