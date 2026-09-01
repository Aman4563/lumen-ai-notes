import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import puppeteer from "puppeteer-core";

const baseUrl = new URL(process.env.LUMEN_URL || "http://127.0.0.1:4202/");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-live-ai-smoke-"));
const focusedQuestion = [
  "From my local library, how does Double DQN split action selection and action evaluation between its two networks, and which bias does that reduce?",
  "Answer in under 180 words. Use a Markdown level-2 heading, one inline [S#] library citation, and the Double DQN target in a $$...$$ display-math block (not a code fence).",
].join(" ");
const targetLectureTitle = "Chapter 2 — Monte Carlo, TD, Q-Learning, and DQN";
const apiResponses = [];
const apiRequestPaths = [];
const aiRequests = [];
const runtimeErrors = [];
const failedRequests = [];
let streamTransportStartedAt = null;
let streamTransportFinishedAt = null;
let resolveStreamTransport;
let streamTransportSettled = false;
let browser;

const streamTransport = new Promise((resolve) => {
  resolveStreamTransport = (value) => {
    if (streamTransportSettled) return;
    streamTransportSettled = true;
    resolve(value);
  };
});

const parseUrl = (value) => {
  try { return new URL(value); } catch { return null; }
};

const parseNdjson = (body) => String(body || "")
  .split(/\r?\n/u)
  .filter((line) => line.trim())
  .map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`stream line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const closeBrowser = async (instance) => {
  if (!instance) return;
  const closePromise = instance.close().then(() => true, () => false);
  const closed = await Promise.race([
    closePromise,
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!closed) {
    instance.process()?.kill("SIGKILL");
    await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: [
      "--allow-insecure-localhost",
      "--ignore-certificate-errors",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // Chrome does not consistently retain a Fetch-stream response body for
  // Puppeteer's request.response().text() after the page has consumed it. Tee
  // the response in the page instead so this audit validates the actual NDJSON
  // bytes without mistaking that DevTools limitation for a product failure.
  await page.evaluateOnNewDocument(() => {
    const originalFetch = window.fetch.bind(window);
    window.__lumenLiveAiStreamCapture = null;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const input = args[0];
        const init = args[1] || {};
        const requestUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.href);
        const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (requestUrl.pathname === "/api/ai/respond/stream" && method === "POST") {
          window.__lumenLiveAiStreamCapture = response.clone().text().then(
            (body) => ({ body, error: "" }),
            (error) => ({ body: "", error: error?.message || "stream capture failed" }),
          );
        }
      } catch (error) {
        window.__lumenLiveAiStreamCapture = Promise.resolve({ body: "", error: error?.message || "stream capture failed" });
      }
      return response;
    };
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = parseUrl(request.url());
    if (!url || !url.pathname.startsWith("/api/")) return;
    apiRequestPaths.push(url.pathname);
    if (url.pathname !== "/api/ai/respond/stream" || request.method() !== "POST") return;
    streamTransportStartedAt = performance.now();
    try {
      aiRequests.push(JSON.parse(request.postData() || "{}"));
    } catch {
      aiRequests.push(null);
    }
  });
  page.on("response", (response) => {
    const url = parseUrl(response.url());
    if (url?.pathname.startsWith("/api/ai/")) {
      apiResponses.push({
        path: url.pathname,
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
      });
    }
  });
  page.on("requestfailed", (request) => {
    const url = parseUrl(request.url());
    failedRequests.push(`${url?.pathname || request.url()}: ${request.failure()?.errorText || "failed"}`);
    if (url?.pathname === "/api/ai/respond/stream") {
      streamTransportFinishedAt = performance.now();
      resolveStreamTransport({ error: request.failure()?.errorText || "stream request failed", body: "", events: [] });
    }
  });
  page.on("requestfinished", (request) => {
    const url = parseUrl(request.url());
    if (url?.pathname !== "/api/ai/respond/stream" || request.method() !== "POST") return;
    streamTransportFinishedAt = performance.now();
    void (async () => {
      try {
        const response = await request.response();
        const body = response ? await response.text() : "";
        resolveStreamTransport({ body, events: parseNdjson(body), error: "" });
      } catch (error) {
        resolveStreamTransport({ body: "", events: [], error: error.message });
      }
    })();
  });

  // A brand-new Chrome profile goes directly to the tutor. No reader route or
  // lecture link is opened before the question, making the retrieved DQN
  // chapter an unopened-library test rather than a current-document test.
  await page.goto(new URL("#/ai", baseUrl).href, { waitUntil: "networkidle2", timeout: 45_000 });
  assert.equal(await page.evaluate(() => window.location.hash), "#/ai", "the smoke test did not stay on the direct AI route");
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 45_000 });

  const config = await page.evaluate(async () => {
    const response = await fetch("/api/ai/config", { credentials: "same-origin", cache: "no-store" });
    return response.json();
  });
  assert.equal(config.ok, true, "the integrated AI config endpoint did not return an enabled envelope");
  assert.equal(config.model, "qwen3.5:4b", "the live smoke did not use the required local Qwen 3.5 4B model");
  assert.equal(config.service?.reachable, true, "Ollama was not reachable from the integrated server");
  assert.equal(config.service?.modelInstalled, true, "qwen3.5:4b was not installed");
  assert.equal(config.service?.completionCapable, true, "qwen3.5:4b did not pass the completion probe");
  assert.equal(config.streamEndpoint, "/api/ai/respond/stream", "the server did not advertise the streaming endpoint");
  assert.equal(config.streamProtocol, "lumen.ai.ndjson.v1", "the server did not advertise the validated NDJSON protocol");
  assert.equal(config.responseProfiles?.default, "balanced", "Balanced was not the server default response profile");
  assert.ok(Number.isSafeInteger(config.responseProfiles?.outputTokens?.balanced), "the server omitted the Balanced output cap");

  const connection = await page.$eval(".ai-tutor__connection", (node) => ({ className: node.className, text: node.textContent.trim() }));
  assert.match(connection.className, /--ready/u, `AI did not become ready: ${connection.text}`);
  assert.match(await page.$eval(".ai-tutor__source-modes [aria-checked='true']", (node) => node.textContent), /Library first/iu, "Library first was not selected by default");
  assert.match(await page.$eval(".ai-tutor__response-profiles input:checked", (input) => input.value), /^balanced$/u, "Balanced was not selected in the tutor UI");
  assert.equal(await page.$eval(".ai-tutor__web-search input", (input) => input.checked), false, "web fallback was not off for the library answer");

  await page.$eval(".ai-tutor__composer textarea", (field, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, focusedQuestion);
  await page.click(".ai-tutor__consent input");
  assert.equal(await page.$eval(".ai-tutor__send", (button) => button.disabled), false, "the valid local request remained disabled after consent");

  const sentAt = performance.now();
  await page.click(".ai-tutor__send");
  await page.waitForSelector(".ai-tutor__message--streaming[aria-busy='true'] .ai-tutor__live-badge", { timeout: 10_000 });
  const liveCardVisibleAt = performance.now();
  assert.equal(streamTransportFinishedAt, null, "the Live response card appeared only after the stream had already completed");
  const liveSnapshot = await page.$eval(".ai-tutor__message--streaming", (node) => ({
    busy: node.getAttribute("aria-busy"),
    live: node.querySelector(".ai-tutor__live-badge")?.textContent.trim() || "",
    status: node.textContent.replace(/\s+/g, " ").trim(),
  }));
  assert.equal(liveSnapshot.busy, "true", "the live progress card was not active during inference");
  assert.match(liveSnapshot.live, /Live/iu, "the in-progress response was not visibly labeled Live");
  assert.ok(liveSnapshot.status.length > 0, "the grounded request exposed no live progress status");

  await page.waitForFunction(() => (
    !document.querySelector(".ai-tutor__message--streaming")
    && Boolean(document.querySelector(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming) .ai-tutor__response-text"))
  ), { timeout: 240_000, polling: 50 });
  const terminalVisibleAt = performance.now();
  const capturedTransport = await page.evaluate(async () => {
    if (!window.__lumenLiveAiStreamCapture) {
      return { body: "", error: "the page did not capture the streamed response" };
    }
    return Promise.race([
      window.__lumenLiveAiStreamCapture,
      new Promise((resolve) => setTimeout(() => resolve({ body: "", error: "timed out waiting for the recorded stream body" }), 10_000)),
    ]);
  });
  const transport = {
    ...capturedTransport,
    events: capturedTransport.error ? [] : parseNdjson(capturedTransport.body),
  };

  const terminal = await page.$eval(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming):last-of-type", (node) => ({
    answer: node.querySelector(".ai-tutor__response-text")?.textContent.trim() || "",
    html: node.querySelector(".ai-tutor__response-text")?.innerHTML.slice(0, 4_000) || "",
    headings: node.querySelectorAll(".ai-tutor__response-text h1, .ai-tutor__response-text h2, .ai-tutor__response-text h3, .ai-tutor__response-text h4, .ai-tutor__response-text h5, .ai-tutor__response-text h6").length,
    katex: node.querySelectorAll(".ai-tutor__response-text .katex").length,
    displayMath: node.querySelectorAll(".ai-tutor__response-text .katex-display").length,
    rawDisplayDelimiters: node.querySelector(".ai-tutor__response-text")?.textContent.includes("$$") || false,
    actions: [...node.querySelectorAll(".ai-tutor__message-actions button")].map((button) => button.textContent.replace(/\s+/g, " ").trim()),
  }));
  const requestError = await page.$eval("body", (body) => body.querySelector(".ai-tutor__request-error")?.textContent.trim() || "");
  const rawOutput = transport.events.find((event) => event.type === "complete")?.response?.outputText || "";
  assert.equal(requestError, "", `AI request failed in the real UI: ${requestError}`);
  assert.ok(terminal.answer.length > 80, "the terminal UI did not render a usable assistant answer");
  assert.match(terminal.answer, /Double DQN/iu, "the answer did not address Double DQN");
  assert.match(terminal.answer, /online(?:\s+Q)?[-\s]network/iu, "the answer omitted the online network's role");
  assert.match(terminal.answer, /target(?:\s+Q)?[-\s]network/iu, "the answer omitted the target network's role");
  assert.ok(terminal.headings >= 1, `the model's Markdown heading did not render as a heading element; raw output was: ${rawOutput.slice(0, 1_200)}`);
  assert.ok(terminal.katex >= 1 && terminal.displayMath >= 1, `the model's display formula did not render through KaTeX; rendered text was: ${terminal.answer.slice(0, 1_200)}; HTML was: ${terminal.html.slice(0, 1_200)}; raw output was: ${rawOutput.slice(0, 1_200)}`);
  assert.equal(terminal.rawDisplayDelimiters, false, "raw $$ delimiters remained visible after Markdown rendering");
  assert.ok(terminal.actions.some((label) => /^Sources\s+\d+/u.test(label)), "the terminal answer did not expose attached provenance");

  assert.equal(aiRequests.length, 1, "the fresh tutor did not make exactly one streamed local-model request");
  const request = aiRequests[0];
  assert.ok(request && typeof request === "object", "the streamed request body was not valid JSON");
  assert.equal(request.responseProfile, "balanced", "the UI did not send the Balanced response profile");
  assert.equal(request.maxOutputTokens, config.responseProfiles.outputTokens.balanced, "the request did not use the server-advertised Balanced output cap");
  assert.ok(request.maxOutputTokens <= config.limits.maxOutputTokens, "the Balanced output cap exceeded the server ceiling");
  assert.equal(request.webSearch, false, "the library answer unexpectedly enabled web search");
  assert.match(request.prompt, /Double DQN/iu, "the focused learner question was not sent");
  assert.match(request.context, new RegExp(escapeRegExp(targetLectureTitle), "u"), "Library first did not attach the unopened DQN lecture");
  assert.match(request.context, /Double DQN uses online network to select and target network to evaluate/iu, "the retrieved context omitted the answer-bearing DQN passage");
  assert.match(request.context, /^\[S\d+\]\s+/mu, "the retrieved library context did not include stable source provenance");
  assert.doesNotMatch(request.documentTitle, /General AI\/ML learning question/iu, "the retrieved request was mislabeled as an ungrounded general question");
  assert.equal(apiRequestPaths.includes("/api/local-search"), false, "the library answer contacted the local web-search gateway");

  assert.equal(transport.error, "", `could not record the streamed response: ${transport.error}`);
  const events = transport.events;
  const deltas = events.filter((event) => event.type === "delta");
  const completeEvents = events.filter((event) => event.type === "complete");
  assert.equal(events[0]?.type, "start", "the NDJSON stream did not begin with a start event");
  assert.equal(events[0]?.protocol, "lumen.ai.ndjson.v1", "the streamed response used the wrong protocol");
  assert.equal(events[0]?.responseProfile, "balanced", "the stream did not confirm the Balanced profile");
  assert.equal(events[1]?.type, "approach", "the stream did not publish its disclosure-safe approach before progress/content");
  assert.ok(deltas.length > 1, "the real response was not delivered as multiple token/text deltas");
  assert.deepEqual(deltas.map((event) => event.sequence), deltas.map((_, index) => index), "streamed deltas were missing or out of order");
  assert.equal(completeEvents.length, 1, "the stream did not contain exactly one terminal completion event");
  assert.equal(events.at(-1)?.type, "complete", "the NDJSON stream did not end with its terminal completion event");
  assert.equal(events.some((event) => event.type === "error"), false, "the NDJSON stream contained a terminal error");
  assert.equal(completeEvents[0].response.outputText, deltas.map((event) => event.text).join(""), "the terminal answer did not match the accumulated stream");
  assert.equal(completeEvents[0].response.sources.length, 0, "a web source appeared even though web search stayed off");

  const assistantNode = await page.$(".ai-tutor__message--assistant:not(.ai-tutor__message--streaming):last-of-type");
  const sourcesButton = await assistantNode.evaluateHandle((node) => [...node.querySelectorAll(".ai-tutor__message-actions button")].find((button) => /^Sources\s+\d+/u.test(button.textContent.replace(/\s+/g, " ").trim())));
  const sourcesElement = sourcesButton.asElement();
  assert.ok(sourcesElement, "the Sources control was not addressable");
  await sourcesElement.click();
  await page.waitForSelector(".ai-tutor__evidence .ai-tutor__message-sources", { timeout: 5_000 });
  const visibleEvidence = await assistantNode.$eval(".ai-tutor__evidence", (node) => node.textContent.replace(/\s+/g, " ").trim());
  assert.match(visibleEvidence, new RegExp(escapeRegExp(targetLectureTitle), "u"), "the visible Sources panel omitted the unopened DQN lecture provenance");

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(viewport.scrollWidth <= viewport.clientWidth + 2, `the 393px tutor introduced horizontal page overflow (${viewport.scrollWidth}px > ${viewport.clientWidth}px)`);
  assert.deepEqual(failedRequests, [], `browser request failures: ${failedRequests.join(" | ")}`);
  assert.deepEqual(runtimeErrors, [], `browser runtime errors: ${runtimeErrors.join(" | ")}`);

  const metrics = {
    liveCardMs: Math.round(liveCardVisibleAt - sentAt),
    validatedAnswerVisibleMs: Math.round(terminalVisibleAt - sentAt),
    totalUiMs: Math.round(terminalVisibleAt - sentAt),
    transportMs: streamTransportStartedAt === null || streamTransportFinishedAt === null
      ? null
      : Math.round(streamTransportFinishedAt - streamTransportStartedAt),
  };

  console.log(JSON.stringify({
    ok: true,
    origin: baseUrl.origin,
    viewport,
    connection,
    model: config.model,
    profile: {
      id: request.responseProfile,
      requestedOutputTokens: request.maxOutputTokens,
      serverMaximumOutputTokens: config.limits.maxOutputTokens,
    },
    grounding: {
      mode: "library-first",
      targetLecture: targetLectureTitle,
      freshProfile: true,
      directRoute: "#/ai",
      contextCharacters: request.context.length,
      stableSourceLabels: [...request.context.matchAll(/^\[(S\d+)\]\s+(.+)$/gmu)].map((match) => ({ citation: match[1], title: match[2] })),
      visibleEvidence,
      webRequestFlag: request.webSearch,
      localSearchRequests: apiRequestPaths.filter((path) => path === "/api/local-search").length,
      streamedWebSources: completeEvents[0].response.sources.length,
    },
    streaming: {
      endpoint: "/api/ai/respond/stream",
      protocol: events[0].protocol,
      eventTypes: events.map((event) => event.type),
      deltaCount: deltas.length,
      ...metrics,
    },
    rendering: {
      markdownHeadingElements: terminal.headings,
      katexElements: terminal.katex,
      displayMathElements: terminal.displayMath,
      rawDisplayDelimitersVisible: terminal.rawDisplayDelimiters,
    },
    apiResponses,
    answerPreview: terminal.answer.slice(0, 300),
    runtimeErrors,
  }, null, 2));
} finally {
  await closeBrowser(browser);
  await rm(profileDirectory, { recursive: true, force: true });
}
