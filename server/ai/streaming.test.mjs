import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { afterEach, test } from "node:test";

import { createApplicationServer, silentLogger } from "../server.mjs";
import { readAiServerConfig } from "./config.mjs";
import { createOllamaStreamingResponse } from "./ollama.mjs";

const runningServers = new Set();

afterEach(async () => {
  await Promise.all([...runningServers].map((server) => new Promise((resolve) => server.close(resolve))));
  runningServers.clear();
});

const baseRequest = Object.freeze({
  task: "explain",
  prompt: "Explain calibration.",
  context: "[S1] Calibration compares confidence with observed frequency.",
  contextCitations: [1],
  documentTitle: "Calibration notes",
  difficulty: "advanced",
  history: [],
  conversationSummary: "Earlier, the learner distinguished calibration from accuracy.",
  responseFormat: "markdown",
  responseProfile: "deep",
  maxOutputTokens: 500,
  webSearch: false,
});

const ndjsonResponse = (events) => new Response(
  `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
);

const streamedAnswer = (secret = "PRIVATE_PROVIDER_THINKING") => [
  { model: "test-model", done: false, message: { role: "assistant", thinking: secret, content: "A calibrated " } },
  { model: "test-model", done: false, message: { role: "assistant", thinking: "MORE_PRIVATE_REASONING", content: "model aligns confidence with frequency [S1]." } },
  {
    model: "test-model",
    done: true,
    done_reason: "stop",
    message: { role: "assistant", thinking: "PRIVATE_END", content: "" },
    prompt_eval_count: 42,
    eval_count: 9,
  },
];

test("streaming Ollama adapter forwards answer chunks but never provider thinking", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
  });
  let upstreamBody;
  const deltas = [];
  const phases = [];
  const result = await createOllamaStreamingResponse({
    request: baseRequest,
    config,
    requestId: "stream-unit-1",
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return ndjsonResponse(streamedAnswer());
    },
    onDelta: async (text) => deltas.push(text),
    onPhase: async (phase) => phases.push(phase.phase),
  });

  assert.equal(upstreamBody.stream, true);
  assert.equal(upstreamBody.think, true);
  assert.match(upstreamBody.messages.at(-1).content, /conversation_summary/);
  assert.match(upstreamBody.messages[0].content, /inline math with \$\.\.\.\$/);
  assert.deepEqual(deltas, ["A calibrated ", "model aligns confidence with frequency [S1]."]);
  assert.equal(result.outputText, deltas.join(""));
  assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 9, totalTokens: 51 });
  assert.deepEqual(phases, ["generating", "validating"]);
  assert.doesNotMatch(JSON.stringify({ result, deltas, phases }), /PRIVATE|REASONING/);
});

test("streaming completion requires an explicit stop reason", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
  });
  const deltas = [];
  await assert.rejects(createOllamaStreamingResponse({
    request: baseRequest,
    config,
    requestId: "stream-missing-stop-reason",
    fetchImpl: async () => ndjsonResponse([
      { model: "test-model", done: false, message: { role: "assistant", content: "Looks complete " } },
      { model: "test-model", done: true, message: { role: "assistant", content: "but lacks an explicit stop [S1]." } },
    ]),
    onDelta: async (text) => deltas.push(text),
  }), (error) => error?.code === "AI_INCOMPLETE_RESPONSE");
  assert.deepEqual(deltas, []);
});

test("source-grounded streaming buffers prose and emits nothing when the final S citation is invalid", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
  });
  const deltas = [];
  await assert.rejects(createOllamaStreamingResponse({
    request: baseRequest,
    config,
    requestId: "stream-uncited-library",
    fetchImpl: async () => ndjsonResponse([
      { model: "test-model", done: false, message: { role: "assistant", content: "A plausible but " } },
      { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "uncited answer with `[S1]` only in code." } },
    ]),
    onDelta: async (text) => deltas.push(text),
  }), (error) => error?.code === "AI_CURRICULUM_UNGROUNDED");
  assert.deepEqual(deltas, []);
});

test("source-grounded streaming replaces one length-stopped draft without leaking its partial text", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
  });
  let calls = 0;
  const deltas = [];
  const phases = [];
  const result = await createOllamaStreamingResponse({
    request: baseRequest,
    config,
    requestId: "stream-length-recovery",
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      if (calls === 2) assert.match(body.messages[0].content, /previous draft reached the provider ceiling/i);
      return ndjsonResponse(calls === 1
        ? [
          { model: "test-model", done: false, message: { role: "assistant", content: "LEAKED_UNFINISHED_DRAFT" } },
          { model: "test-model", done: true, done_reason: "length", message: { role: "assistant", content: "" } },
        ]
        : [
          { model: "test-model", done: false, message: { role: "assistant", content: "A concise grounded " } },
          { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "answer [S1]." } },
        ]);
    },
    onDelta: async (text) => deltas.push(text),
    onPhase: async ({ message }) => phases.push(message),
  });
  assert.equal(calls, 2);
  assert.deepEqual(deltas, ["A concise grounded ", "answer [S1]."]);
  assert.doesNotMatch(deltas.join(""), /LEAKED_UNFINISHED_DRAFT/);
  assert.match(phases.join("\n"), /Regenerating a shorter complete answer/i);
  assert.equal(result.outputText, deltas.join(""));
});

test("searched prose is released only after terminal grounding validation", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
    WEB_SEARCH_ENABLED: "true",
    WEB_SEARCH_MAX_ROUNDS: "2",
  });
  let ollamaCalls = 0;
  let synthesisBody = null;
  let releaseTerminal;
  let markSynthesisStarted;
  let markFirstDelta;
  const terminalGate = new Promise((resolve) => { releaseTerminal = resolve; });
  const synthesisStarted = new Promise((resolve) => { markSynthesisStarted = resolve; });
  const firstDelta = new Promise((resolve) => { markFirstDelta = resolve; });
  const deltas = [];
  const phases = [];

  const resultPromise = createOllamaStreamingResponse({
    request: { ...baseRequest, responseProfile: "balanced", webSearch: true },
    config,
    requestId: "stream-searched-prose",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        return new Response(JSON.stringify({
          results: [{
            title: "Official calibration guidance",
            url: "https://example.org/calibration",
            content: "Version 3 is the current calibration guidance.",
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      ollamaCalls += 1;
      const body = JSON.parse(init.body);
      if (ollamaCalls === 1) {
        assert.equal(Array.isArray(body.tools), true);
        return ndjsonResponse([{
          model: "test-model",
          done: true,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "search_web", arguments: { query: "official current calibration guidance" } } }],
          },
        }]);
      }

      synthesisBody = body;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
            model: "test-model",
            done: false,
            message: { role: "assistant", content: "Version 3 " },
          })}\n`));
          markSynthesisStarted();
          terminalGate.then(() => {
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
              model: "test-model",
              done: true,
              done_reason: "stop",
              message: { role: "assistant", content: "is current [S1] [W1]." },
            })}\n`));
            controller.close();
          });
        },
      }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    },
    onDelta: async (text) => {
      deltas.push(text);
      if (deltas.length === 1) markFirstDelta();
    },
    onPhase: async ({ phase }) => phases.push(phase),
  });

  await synthesisStarted;
  const streamedBeforeTerminal = await Promise.race([
    firstDelta.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  releaseTerminal();
  const result = await resultPromise;

  assert.equal(Array.isArray(synthesisBody.tools), true, "the optional bounded refinement turn was not exposed");
  assert.equal(streamedBeforeTerminal, false, "searched prose escaped before terminal grounding validation");
  assert.deepEqual(phases, ["generating", "searching", "generating", "validating"]);
  assert.deepEqual(deltas, ["Version 3 ", "is current [S1] [W1]."]);
  assert.equal(result.outputText, deltas.join(""));
  assert.equal(result.webSearch.used, true);
  assert.equal(result.webSearch.rounds, 1);
  assert.equal(result.sources[0].url, "https://example.org/calibration");
});

test("streaming current-web mode still searches when the local model skips its tool call", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
    WEB_SEARCH_ENABLED: "true",
    WEB_SEARCH_MAX_ROUNDS: "1",
  });
  let ollamaCalls = 0;
  let searchedQuery = "";
  const phases = [];
  const deltas = [];
  const result = await createOllamaStreamingResponse({
    request: { ...baseRequest, prompt: "What is the latest calibration release?", responseProfile: "balanced", webSearch: true },
    config,
    requestId: "stream-search-fallback",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/search") {
        searchedQuery = new URL(url).searchParams.get("q");
        return new Response(JSON.stringify({
          results: [{ title: "Current calibration release", url: "https://example.org/calibration", content: "Version 3 is current." }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      ollamaCalls += 1;
      return ndjsonResponse([ollamaCalls === 1
        ? { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Version 2 might be current." } }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Version 3 is current [S1] [W1]." } }]);
    },
    onPhase: async ({ phase, message }) => phases.push(`${phase}:${message}`),
    onDelta: async (text) => deltas.push(text),
  });

  assert.equal(searchedQuery, "What is the latest calibration release?");
  assert.match(phases.join("\n"), /skipped its required tool call/i);
  assert.deepEqual(deltas, ["Version 3 is current [S1] [W1]."]);
  assert.equal(result.webSearch.used, true);
  assert.equal(result.sources[0].url, "https://example.org/calibration");
});

test("searched streaming emits no answer deltas when final web grounding validation fails", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
    WEB_SEARCH_ENABLED: "true",
    WEB_SEARCH_MAX_ROUNDS: "1",
  });
  let ollamaCalls = 0;
  const deltas = [];
  await assert.rejects(createOllamaStreamingResponse({
    request: { ...baseRequest, webSearch: true },
    config,
    requestId: "stream-uncited-web",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/search") {
        return new Response(JSON.stringify({
          results: [{ title: "Official calibration guidance", url: "https://example.org/calibration", content: "Version 3 is current." }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      ollamaCalls += 1;
      return ndjsonResponse([ollamaCalls === 1
        ? { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "official calibration guidance" } } }] } }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Version 3 is current [S1], but no web citation is present." } }]);
    },
    onDelta: async (text) => deltas.push(text),
  }), (error) => error?.code === "WEB_SEARCH_UNGROUNDED");
  assert.deepEqual(deltas, []);
});

test("streaming exposes only retained fitted evidence and rejects a dropped W8 claim", async () => {
  const config = readAiServerConfig({
    AI_ENABLED: "true",
    OLLAMA_MODEL: "test-model",
    AI_MAX_OUTPUT_TOKENS: "500",
    OLLAMA_CONTEXT_WINDOW_TOKENS: "8192",
    WEB_SEARCH_ENABLED: "true",
    WEB_SEARCH_MAX_RESULTS: "8",
    WEB_SEARCH_MAX_ROUNDS: "1",
  });
  const denseResults = Array.from({ length: 8 }, (_, index) => ({
    title: `Current dense release official evidence ${index + 1} ${"title ".repeat(50)}`,
    url: `https://example.org/stream-dense-${index + 1}`,
    content: `Current dense release evidence ${index + 1}. ${"detail ".repeat(240)}`,
  }));
  const tightRequest = {
    ...baseRequest,
    prompt: "What is the current dense release?",
    context: "x".repeat(900),
    contextCitations: [],
    conversationSummary: "",
    webSearch: true,
  };
  const run = async (marker) => {
    let ollamaCalls = 0;
    let retainedCount = 0;
    const emittedSources = [];
    try {
      const result = await createOllamaStreamingResponse({
        request: tightRequest,
        config,
        requestId: `stream-retained-${marker}`,
        fetchImpl: async (url, init) => {
          if (new URL(url).pathname === "/search") {
            return new Response(JSON.stringify({ results: denseResults }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          ollamaCalls += 1;
          const body = JSON.parse(init.body);
          if (ollamaCalls === 1) {
            return ndjsonResponse([{ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "current dense release" } } }] } }]);
          }
          retainedCount = JSON.parse(body.messages.find((message) => message.role === "tool").content).results.length;
          return ndjsonResponse([{ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: `Current evidence ${marker}.` } }]);
        },
        onSource: async ({ index, source }) => emittedSources.push({ index, source }),
      });
      return { result, retainedCount, emittedSources, error: null };
    } catch (error) {
      return { result: null, retainedCount, emittedSources, error };
    }
  };

  const accepted = await run("[W1]");
  assert.equal(accepted.error, null);
  assert.ok(accepted.retainedCount >= 1 && accepted.retainedCount < 8);
  assert.equal(accepted.result.sources.length, accepted.retainedCount);
  assert.equal(accepted.emittedSources.length, accepted.retainedCount);
  assert.deepEqual(accepted.emittedSources.map(({ index }) => index), Array.from({ length: accepted.retainedCount }, (_, index) => index + 1));
  assert.deepEqual(accepted.emittedSources.map(({ source }) => source), accepted.result.sources);

  const rejected = await run("[W8]");
  assert.equal(rejected.error?.code, "WEB_SEARCH_UNGROUNDED");
  assert.ok(rejected.retainedCount < 8);
  assert.deepEqual(rejected.emittedSources, [], "dropped or unvalidated evidence leaked into source events");
});

const start = async ({ fetchImpl, logger = silentLogger, env = {} }) => {
  const { server } = createApplicationServer({
    env: {
      HOST: "127.0.0.1",
      PORT: "0",
      AI_ENABLED: "true",
      OLLAMA_MODEL: "test-model",
      AI_MAX_OUTPUT_TOKENS: "500",
      AI_STREAM_HEARTBEAT_MS: "30000",
      ...env,
    },
    fetchImpl,
    logger,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  runningServers.add(server);
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
};

test("same-origin endpoint emits ordered typed NDJSON and a matching validated final envelope", async () => {
  const logs = [];
  let upstreamBody;
  const { baseUrl } = await start({
    logger: {
      info(value) { logs.push(value); },
      warn(value) { logs.push(value); },
      error(value) { logs.push(value); },
    },
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return ndjsonResponse(streamedAnswer("NEVER_LOG_THIS"));
    },
  });
  const response = await fetch(`${baseUrl}/api/ai/respond/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ ...baseRequest, responseProfile: "balanced" }),
  });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const startEvent = events[0];
  const deltas = events.filter((event) => event.type === "delta");
  const complete = events.at(-1);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/x-ndjson/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(startEvent.type, "start");
  assert.equal(startEvent.protocol, "lumen.ai.ndjson.v1");
  assert.equal(startEvent.responseProfile, "balanced");
  assert.equal(events[1].type, "approach");
  assert.deepEqual(deltas.map((event) => event.sequence), [0, 1]);
  assert.equal(deltas.map((event) => event.text).join(""), complete.response.outputText);
  assert.equal(complete.type, "complete");
  assert.deepEqual(complete.response.approach, events[1].approach);
  assert.equal(complete.response.status, "completed");
  assert.equal(upstreamBody.stream, true);
  assert.equal(upstreamBody.think, false);
  assert.doesNotMatch(`${await Promise.resolve(JSON.stringify(events))}\n${logs.join("\n")}`, /NEVER_LOG_THIS|PRIVATE_PROVIDER|PRIVATE_END/);
});

test("an upstream mid-stream failure becomes one sanitized typed terminal error", async () => {
  const { baseUrl } = await start({
    fetchImpl: async () => ndjsonResponse([
      { model: "test-model", done: false, message: { role: "assistant", content: "partial" } },
      { error: "PRIVATE_OLLAMA_DIAGNOSTIC" },
    ]),
  });
  const response = await fetch(`${baseUrl}/api/ai/respond/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseRequest, responseProfile: "fast" }),
  });
  const text = await response.text();
  const events = text.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(response.status, 200, "a started HTTP stream attempted to change status");
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).status, 502);
  assert.equal(events.at(-1).error.code, "AI_LOCAL_MODEL_ERROR");
  assert.doesNotMatch(text, /PRIVATE_OLLAMA_DIAGNOSTIC/);
  assert.equal(events.filter((event) => ["complete", "error"].includes(event.type)).length, 1);
});

test("disconnecting a streaming browser request aborts the upstream Ollama request", async () => {
  let upstreamAbort;
  const upstreamAborted = new Promise((resolve) => { upstreamAbort = resolve; });
  const { baseUrl } = await start({
    fetchImpl: async (_url, init) => {
      init.signal.addEventListener("abort", upstreamAbort, { once: true });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ model: "test-model", done: false, message: { role: "assistant", content: "first" } })}\n`));
        },
      }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    },
  });
  // No source context is attached here so a first answer delta is allowed
  // before terminal citation validation; the test is specifically about a
  // browser disconnect after streaming has begun.
  const body = JSON.stringify({ ...baseRequest, context: "", contextCitations: [], responseProfile: "fast" });
  await new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/api/ai/respond/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    });
    request.on("error", (error) => {
      if (error.code === "ECONNRESET") resolve();
      else reject(error);
    });
    request.on("response", (response) => {
      let received = "";
      response.on("data", (chunk) => {
        received += chunk.toString("utf8");
        if (received.includes('"type":"delta"')) {
          response.destroy();
          request.destroy();
          resolve();
        }
      });
      response.on("error", (error) => {
        if (error.code === "ECONNRESET") resolve();
        else reject(error);
      });
    });
    request.end(body);
  });
  let timeout;
  try {
    await Promise.race([
      upstreamAborted,
      new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("upstream was not aborted")), 1_000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
});
