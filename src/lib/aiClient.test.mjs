import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AiClientError,
  aiRequestUtf8Bytes,
  clearAiConfigCache,
  clipAiContext,
  getAiConfig,
  requestAi,
  requestAiStream,
  searchLocalWeb,
  requestStructuredAi,
} from "./aiClient.js";
import { AI_REQUEST_CONTRACT_ID } from "./aiContract.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAiConfigCache();
});

const jsonResponse = (payload, init = {}) => new Response(JSON.stringify(payload), {
  status: init.status || 200,
  headers: { "Content-Type": "application/json", ...(init.headers || {}) },
});

const streamApproach = Object.freeze({
  summary: "Ground the answer, then explain it clearly.",
  steps: Object.freeze(["Find the relevant evidence.", "Present the answer at the requested depth."]),
});

const streamSource = Object.freeze({
  title: "Official documentation",
  url: "https://example.org/docs",
  snippet: "Current supported behavior.",
  source: "example",
});

const streamEnvelope = ({ outputText = "Hello world", sources = [streamSource], requestId = "stream-request-1" } = {}) => ({
  ok: true,
  requestId,
  status: "completed",
  model: "local-test-model",
  outputText,
  data: null,
  usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
  webSearch: { requested: sources.length > 0, used: sources.length > 0, rounds: sources.length > 0 ? 1 : 0 },
  sources,
  approach: streamApproach,
});

const streamEvents = ({ outputText = "Hello world", sources = [streamSource], requestId = "stream-request-1" } = {}) => {
  const deltas = outputText === "Hello world" ? ["Hello ", "world"] : [outputText];
  const response = streamEnvelope({ outputText, sources, requestId });
  return [
    { type: "start", protocol: "lumen.ai.ndjson.v1", requestId, model: "local-test-model", responseFormat: "markdown", responseProfile: "balanced", startedAt: "2026-08-31T12:00:00.000Z" },
    { type: "approach", requestId, approach: streamApproach },
    { type: "phase", requestId, phase: "generating", message: "Generating locally." },
    ...sources.map((source, index) => ({ type: "source", requestId, index: index + 1, source })),
    ...deltas.map((text, sequence) => ({ type: "delta", requestId, sequence, text })),
    { type: "complete", requestId, response },
  ];
};

const ndjsonResponse = (events, { status = 200, headers = {}, splitAt = 0 } = {}) => {
  const encoded = new TextEncoder().encode(`${events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n")}\n`);
  const body = new ReadableStream({
    start(controller) {
      if (splitAt > 0 && splitAt < encoded.byteLength) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
      } else {
        controller.enqueue(encoded);
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1",
      "X-Request-Id": "stream-request-1",
      ...headers,
    },
  });
};

test("configuration is briefly cached without exposing client credentials", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, "/api/ai/config");
    assert.equal(init.credentials, "same-origin");
    return jsonResponse({ ok: true, enabled: true, model: "configured-server-model", requestContract: AI_REQUEST_CONTRACT_ID });
  };
  const first = await getAiConfig();
  const second = await getAiConfig();
  assert.equal(first.enabled, true);
  assert.equal(second.model, "configured-server-model");
  assert.equal(calls, 1);
});

test("network failures direct learners to the integrated same-origin server", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(getAiConfig(), (error) => {
    assert.ok(error instanceof AiClientError);
    assert.equal(error.code, "AI_NETWORK_ERROR");
    assert.match(error.message, /integrated Lumen server URL/i);
    assert.match(error.message, /not a static preview/i);
    return true;
  });
});

test("concurrent configuration callers share one fetch while preserving caller-local abort", async () => {
  let calls = 0;
  let finishFetch;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(init.signal.aborted, false);
    return new Promise((resolve) => { finishFetch = () => resolve(jsonResponse({ ok: true, enabled: true, model: "shared-local-model", requestContract: AI_REQUEST_CONTRACT_ID })); });
  };
  const firstController = new AbortController();
  const first = getAiConfig({ signal: firstController.signal });
  const second = getAiConfig();
  firstController.abort(new Error("component unmounted"));
  await assert.rejects(first, (error) => error instanceof AiClientError && error.code === "AI_CANCELLED");
  assert.equal(calls, 1, "aborting one caller started or cancelled the shared fetch");
  finishFetch();
  const result = await second;
  assert.equal(result.model, "shared-local-model");
  assert.equal(calls, 1);
  assert.equal((await getAiConfig()).model, "shared-local-model");
  assert.equal(calls, 1, "the successful shared result was not cached");
});

test("clearing configuration prevents an older in-flight response from repopulating the cache", async () => {
  const finishes = [];
  let calls = 0;
  globalThis.fetch = async () => {
    const call = ++calls;
    return new Promise((resolve) => finishes.push(() => resolve(jsonResponse({ ok: true, model: `model-${call}`, requestContract: AI_REQUEST_CONTRACT_ID }))));
  };
  const oldRequest = getAiConfig();
  clearAiConfigCache();
  const freshRequest = getAiConfig();
  assert.equal(calls, 2);
  finishes[0]();
  assert.equal((await oldRequest).model, "model-1");
  finishes[1]();
  assert.equal((await freshRequest).model, "model-2");
  assert.equal((await getAiConfig()).model, "model-2");
  assert.equal(calls, 2);
});

test("a server without the expected request contract fails closed and is never cached", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ ok: true, enabled: true, model: "older-server-model" });
  };
  await assert.rejects(getAiConfig(), (error) => {
    assert.ok(error instanceof AiClientError);
    assert.equal(error.code, "AI_CONTRACT_MISMATCH");
    assert.match(error.message, /different versions/i);
    assert.match(error.message, /restart the integrated Lumen server/i);
    return true;
  });
  await assert.rejects(getAiConfig(), (error) => error.code === "AI_CONTRACT_MISMATCH");
  assert.equal(calls, 2, "a mismatched configuration must not be cached as usable");

  globalThis.fetch = async () => jsonResponse({ ok: true, enabled: true, model: "skewed", requestContract: "lumen.ai.request.v999" });
  await assert.rejects(getAiConfig(), (error) => error.code === "AI_CONTRACT_MISMATCH");
});

test("request payloads must declare the compiled contract before any network call", async () => {
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    return jsonResponse({ ok: true });
  };
  await assert.rejects(
    requestAi({ task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "INVALID_CLIENT_PAYLOAD" && /contract/.test(error.message),
  );
  await assert.rejects(
    requestAiStream({ task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "INVALID_CLIENT_PAYLOAD",
  );
  await assert.rejects(
    requestAi({ contract: "lumen.ai.request.v0", task: "explain", prompt: "Explain." }),
    (error) => error.code === "INVALID_CLIENT_PAYLOAD",
  );
  assert.equal(networkCalls, 0, "a contract-less payload must be rejected before transport");
});

test("requestAi sends only the learning payload to the same-origin proxy", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({
      ok: true,
      requestId: "request-1",
      status: "completed",
      model: "local-test-model",
      outputText: "Explanation",
      data: null,
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      webSearch: { requested: false, used: false, rounds: 0 },
      sources: [],
    });
  };
  const result = await requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain calibration." });
  assert.equal(result.outputText, "Explanation");
  assert.equal(captured.url, "/api/ai/respond");
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(captured.body, { contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain calibration." });
  assert.equal("Authorization" in captured.init.headers, false);
});

test("AI request byte preflight exactly matches fetch JSON serialization", () => {
  const payload = {
    task: "explain",
    prompt: "Explain \"校准\" 🧭 and C:\\\\models",
    context: "line one\nline two",
    history: [{ role: "user", content: "Why? 🤔" }],
    conversationSummary: "",
    responseFormat: "markdown",
    responseProfile: "balanced",
    maxOutputTokens: 1_800,
    webSearch: false,
  };
  assert.equal(aiRequestUtf8Bytes(payload), Buffer.byteLength(JSON.stringify(payload), "utf8"));
});

test("requestAiStream parses split NDJSON, delivers each delta once, and aggregates sources", async () => {
  let captured;
  const metadataEvents = [];
  const deltas = [];
  const statuses = [];
  const sourceSnapshots = [];
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    // Split in the middle of the first JSON object to prove chunk boundaries
    // are independent from NDJSON event boundaries.
    return ndjsonResponse(streamEvents(), { splitAt: 37 });
  };
  const result = await requestAiStream(
    { contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain calibration.", responseProfile: "balanced" },
    {
      onEvent: (event) => metadataEvents.push(event),
      onDelta: (text) => deltas.push(text),
      onStatus: (message) => statuses.push(message),
      onSources: (sources) => sourceSnapshots.push(sources),
    },
  );

  assert.equal(captured.url, "/api/ai/respond/stream");
  assert.equal(captured.init.credentials, "same-origin");
  assert.equal(captured.init.headers.Accept, "application/x-ndjson");
  assert.deepEqual(captured.body, { contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain calibration.", responseProfile: "balanced" });
  assert.deepEqual(deltas, ["Hello ", "world"], "onEvent and onDelta caused duplicate text delivery");
  assert.deepEqual(statuses, ["Generating locally."]);
  assert.deepEqual(sourceSnapshots, [[streamSource]]);
  assert.deepEqual(metadataEvents.map((event) => event.type), ["start", "approach", "phase", "source", "sources", "complete"]);
  assert.deepEqual(metadataEvents.find((event) => event.type === "sources").sources, [streamSource]);
  assert.equal(result.outputText, "Hello world");
  assert.deepEqual(result.approach, streamApproach);
});

test("requestAiStream rejects out-of-order, mismatched, and post-terminal events", async () => {
  const valid = streamEvents({ sources: [] });
  const cases = [
    valid.map((event) => event.type === "delta" ? { ...event, sequence: event.sequence + 1 } : event),
    valid.map((event) => event.type === "complete"
      ? { ...event, response: { ...event.response, outputText: "different final text" } }
      : event),
    valid.filter((event) => event.type !== "approach"),
    [...valid, { type: "heartbeat", requestId: "stream-request-1", at: "2026-08-31T12:00:01.000Z" }],
  ];
  for (const events of cases) {
    globalThis.fetch = async () => ndjsonResponse(events);
    await assert.rejects(
      requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
      (error) => error instanceof AiClientError && error.code === "AI_STREAM_PROTOCOL_ERROR",
    );
  }
});

test("requestAiStream enforces declared, cumulative, line, and idle bounds", async () => {
  globalThis.fetch = async () => ndjsonResponse([], { headers: { "Content-Length": String(4 * 1024 * 1024 + 1) } });
  await assert.rejects(
    requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE",
  );

  const startLine = JSON.stringify(streamEvents({ sources: [] })[0]);
  const heartbeatLine = JSON.stringify({ type: "heartbeat", requestId: "stream-request-1", at: "2026-08-31T12:00:01.000Z" });
  const cumulativeBody = `${startLine}\n${`${heartbeatLine}\n`.repeat(55_000)}`;
  globalThis.fetch = async () => new Response(cumulativeBody, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1", "X-Request-Id": "stream-request-1" },
  });
  await assert.rejects(
    requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE",
  );

  const largeLine = JSON.stringify({ type: "phase", requestId: "stream-request-1", phase: "generating", message: "x".repeat(2 * 1024 * 1024) });
  globalThis.fetch = async () => ndjsonResponse([streamEvents({ sources: [] })[0], largeLine]);
  await assert.rejects(
    requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE",
  );

  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "X-Lumen-Stream-Protocol": "lumen.ai.ndjson.v1" },
  });
  await assert.rejects(
    requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }, { idleTimeoutMs: 100, timeoutMs: 2_000 }),
    (error) => error instanceof AiClientError && error.code === "AI_STREAM_IDLE_TIMEOUT",
  );
});

test("requestAiStream keeps caller cancellation active while the body is stalled", async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
  const controller = new AbortController();
  const pending = requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }, {
    signal: controller.signal,
    timeoutMs: 10_000,
  });
  controller.abort(new Error("learner cancelled"));
  await assert.rejects(pending, (error) => error instanceof AiClientError && error.code === "AI_CANCELLED");
});

test("a Stop while a callback holds the stream is not overtaken by the buffered answer", async () => {
  // Issue #82: the tutor holds a validating phase on screen, and the answer
  // and its completion usually arrive in the same read.
  const events = streamEvents({ sources: [] });
  events.splice(3, 0, { type: "phase", requestId: "stream-request-1", phase: "validating", message: "Checking the answer's citations against the supplied sources." });
  globalThis.fetch = async () => ndjsonResponse(events);
  const controller = new AbortController();
  const seen = [];
  const pending = requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }, {
    signal: controller.signal,
    onDelta: (text) => seen.push(`delta:${text}`),
    onEvent: async (event) => {
      seen.push(event.type === "phase" ? event.phase : event.type);
      if (event.phase === "validating") {
        controller.abort(new Error("learner stopped"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  });
  await assert.rejects(pending, (error) => error instanceof AiClientError && error.code === "AI_CANCELLED");
  assert.deepEqual(seen, ["start", "approach", "generating", "validating"], "buffered events ran after the Stop");

  // Without a Stop the same held stream completes normally.
  globalThis.fetch = async () => ndjsonResponse(events);
  const phases = [];
  const response = await requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }, {
    onEvent: async (event) => {
      if (event.type === "phase") phases.push(event.phase);
      if (event.phase === "validating") await new Promise((resolve) => setTimeout(resolve, 10));
    },
  });
  assert.equal(response.outputText, "Hello world");
  assert.deepEqual(phases, ["generating", "validating"]);
});

test("requestAiStream surfaces a typed terminal stream error", async () => {
  const requestId = "stream-request-1";
  globalThis.fetch = async () => ndjsonResponse([
    { type: "start", protocol: "lumen.ai.ndjson.v1", requestId, model: "local-test-model", responseFormat: "markdown", responseProfile: "balanced", startedAt: "2026-08-31T12:00:00.000Z" },
    { type: "approach", requestId, approach: streamApproach },
    { type: "error", requestId, status: 504, error: { code: "AI_TIMEOUT", message: "Local generation timed out." }, retryAfter: "2" },
  ]);
  await assert.rejects(
    requestAiStream({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError
      && error.code === "AI_TIMEOUT"
      && error.status === 504
      && error.retryAfter === "2"
      && error.requestId === requestId,
  );
});

test("requestAi never presents an explicitly incomplete generation as finished", async () => {
  globalThis.fetch = async () => jsonResponse({ ok: true, requestId: "partial-1", status: "incomplete", outputText: "Partial" });
  await assert.rejects(
    requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain fully." }),
    (error) => error instanceof AiClientError && error.code === "AI_INCOMPLETE_RESPONSE" && error.requestId === "partial-1",
  );
});

test("requestAi rejects a malformed HTTP-200 success envelope", async () => {
  globalThis.fetch = async () => jsonResponse({});
  await assert.rejects(requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }), (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE");

  for (const malformed of [null, [], "completed", 7]) {
    globalThis.fetch = async () => jsonResponse(malformed);
    await assert.rejects(
      requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
      (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE",
    );
  }
});

test("caller cancellation remains active while the AI response body is stalled", async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const controller = new AbortController();
  const pending = requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }, { signal: controller.signal, timeoutMs: 10_000 });
  controller.abort(new Error("learner cancelled"));
  await assert.rejects(
    pending,
    (error) => error instanceof AiClientError && error.code === "AI_CANCELLED",
  );
});

test("response byte limits apply before and during body reads", async () => {
  globalThis.fetch = async () => new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Length": "1200001" },
  });
  await assert.rejects(
    requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "explain", prompt: "Explain." }),
    (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE",
  );
});

test("searchLocalWeb sends only one normalized query to the same-origin gateway", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({ ok: true, requestId: "search-request-1", query: "latest release", results: [{ title: "t".repeat(300), url: "https://example.org/release", snippet: "s".repeat(1_200) }] });
  };
  const result = await searchLocalWeb("  latest   release  ");
  assert.equal(result.query, "latest release");
  assert.equal(captured.url, "/api/local-search");
  assert.deepEqual(captured.body, { query: "latest release" });
  assert.equal(Object.keys(captured.body).length, 1);
  await assert.rejects(searchLocalWeb("x".repeat(241)), (error) => error instanceof AiClientError && error.code === "INVALID_SEARCH_QUERY");
  globalThis.fetch = async () => jsonResponse({ ok: true, requestId: "search-request-2", query: 7, results: "bad", extra: true });
  await assert.rejects(searchLocalWeb("latest release"), (error) => error instanceof AiClientError && error.code === "AI_INVALID_RESPONSE");
  await assert.rejects(searchLocalWeb("!ddg hidden route"), (error) => error instanceof AiClientError && error.code === "INVALID_SEARCH_QUERY");
});

test("typed server errors preserve retry guidance without losing safety", async () => {
  globalThis.fetch = async () => jsonResponse({
    ok: false,
    requestId: "request-2",
    error: { code: "RATE_LIMITED", message: "Wait before retrying.", details: ["bounded detail"] },
  }, { status: 429, headers: { "Retry-After": "12", "X-Request-Id": "request-2" } });

  await assert.rejects(
    requestAi({ contract: AI_REQUEST_CONTRACT_ID, task: "tutor", prompt: "Help." }),
    (error) => {
      assert.ok(error instanceof AiClientError);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, "12");
      assert.equal(error.retryable, true);
      assert.deepEqual(error.details, ["bounded detail"]);
      return true;
    },
  );
});

test("structured helper enforces the client contract", async () => {
  const envelope = (requestId, outputText, data) => ({ ok: true, requestId, status: "completed", model: "local-test-model", outputText, data, usage: null, webSearch: { requested: false, used: false, rounds: 0 }, sources: [] });
  globalThis.fetch = async () => jsonResponse(envelope("request-3", "{}", { cards: [] }));
  const result = await requestStructuredAi({ contract: AI_REQUEST_CONTRACT_ID, task: "flashcards", prompt: "Make cards." });
  assert.deepEqual(result.data, { cards: [] });

  globalThis.fetch = async () => jsonResponse(envelope("request-4", "not structured", null));
  await assert.rejects(
    requestStructuredAi({ contract: AI_REQUEST_CONTRACT_ID, task: "flashcards", prompt: "Make cards." }),
    (error) => error instanceof AiClientError && error.code === "AI_CONTRACT_ERROR",
  );
});

test("context clipping is deterministic and explicitly marks omissions", () => {
  const source = Array.from({ length: 2_000 }, (_, index) => `line-${index}`).join("\n");
  const clipped = clipAiContext(source, 2_000);
  assert.equal(clipped.length, 2_000);
  assert.match(clipped, /middle of source omitted/);
  assert.ok(clipped.startsWith("line-0"));
  assert.ok(clipped.endsWith("line-1999"));
});
