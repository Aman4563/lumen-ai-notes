import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { AI_REQUEST_CONTRACT_ID } from "../../src/lib/aiContract.js";
import { createApplicationServer, silentLogger } from "../server.mjs";

const runningServers = new Set();

afterEach(async () => {
  await Promise.all([...runningServers].map((server) => new Promise((resolve) => server.close(resolve))));
  runningServers.clear();
});

// A hermetic app-shell fixture: the repository's real dist/ is a build
// product that does not exist on a fresh clone or CI runner.
const fixtureDistDirectory = await mkdtemp(join(tmpdir(), "lumen-server-test-dist-"));
await writeFile(join(fixtureDistDirectory, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>\n", "utf8");

const start = async ({ enabled = true, env = {}, fetchImpl = async () => {
  throw new Error("Unexpected local-service request");
} } = {}) => {
  const serverEnv = {
    HOST: "127.0.0.1",
    PORT: "0",
    AI_ENABLED: String(enabled),
    OLLAMA_MODEL: "test-model",
    ...env,
  };
  const { server } = createApplicationServer({ env: serverEnv, fetchImpl, logger: silentLogger, distDirectory: fixtureDistDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  runningServers.add(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const post = (baseUrl, payload, headers = {}) => fetch(`${baseUrl}/api/ai/respond`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(payload),
});

const plainRequest = {
  contract: AI_REQUEST_CONTRACT_ID,
  task: "explain",
  prompt: "Explain why validation data must not tune the final test score.",
  context: "The test split estimates performance only after all choices are fixed.",
  documentTitle: "Data splits",
  difficulty: "intermediate",
  maxOutputTokens: 500,
};

test("TLS configuration fails closed when only one credential path is set", () => {
  assert.throws(
    () => createApplicationServer({
      env: {
        HOST: "127.0.0.1",
        PORT: "0",
        AI_ENABLED: "false",
        TLS_CERT_FILE: "/tmp/lumen-cert.pem",
      },
      logger: silentLogger,
    }),
    /TLS_CERT_FILE and TLS_KEY_FILE must be configured together/,
  );
});

test("private AI cannot bind beyond loopback without TLS and an exact HTTPS origin", () => {
  // Pairing (or its explicit waiver) is checked first; these cases opt into
  // pairing so the TLS/origin invariants stay independently proven.
  const pairedLan = { HOST: "0.0.0.0", PORT: "0", AI_ENABLED: "true", AI_AUTH: "pairing", AI_AUTH_LOOPBACK: "require", AI_PAIRING_CODE: "correct-horse-battery" };
  assert.throws(() => createApplicationServer({
    env: pairedLan,
    logger: silentLogger,
  }), /TLS is required/);
  assert.throws(() => createApplicationServer({
    env: {
      ...pairedLan,
      AI_ALLOWED_ORIGINS: "http://192.168.1.13:4194",
    },
    logger: silentLogger,
  }), /TLS is required/);
});

const ollamaReply = (content, extra = {}) => new Response(JSON.stringify({
  model: "test-model",
  done: true,
  done_reason: "stop",
  message: { role: "assistant", content },
  prompt_eval_count: 80,
  eval_count: 12,
  ...extra,
}), { status: 200, headers: { "Content-Type": "application/json" } });

test("disabled local AI remains healthy and never calls a service", async () => {
  let serviceCalls = 0;
  const baseUrl = await start({
    enabled: false,
    fetchImpl: async () => {
      serviceCalls += 1;
      throw new Error("must not run");
    },
  });
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  const appShellResponse = await fetch(`${baseUrl}/`, { headers: { Accept: "text/html" } });
  const appShell = await appShellResponse.text();
  const config = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  const response = await post(baseUrl, plainRequest);
  const body = await response.json();

  assert.equal(health.status, "ok");
  assert.equal(health.ai, "disabled");
  assert.equal(health.webSearch, "disabled");
  assert.equal(health.requestContract, AI_REQUEST_CONTRACT_ID);
  assert.equal(config.requestContract, AI_REQUEST_CONTRACT_ID);
  assert.equal(appShellResponse.status, 200);
  assert.equal(appShellResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(appShellResponse.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.match(appShell, /id="root"/);
  assert.equal(config.enabled, false);
  assert.equal(config.provider, "ollama-local");
  assert.equal(config.model, null);
  assert.equal(config.privacy.paidRemoteApisUsed, false);
  assert.equal(config.privacy.apiKeyRequired, false);
  assert.equal(JSON.stringify(config).includes("127.0.0.1:11434"), false);
  assert.equal(JSON.stringify(config).includes("127.0.0.1:8080"), false);
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AI_UNAVAILABLE");
  assert.equal(serviceCalls, 0);
});

test("disabled LAN profile exposes only read-only diagnostics without an origin allowlist", async () => {
  const baseUrl = await start({ enabled: false, env: { HOST: "0.0.0.0" } });
  const port = new URL(baseUrl).port;
  const diagnostic = await fetch(`${baseUrl}/api/ai/config`, { headers: { Host: `192.168.1.13:${port}` } });
  assert.equal(diagnostic.status, 200);
  assert.equal((await diagnostic.json()).enabled, false);
  const mutation = await post(baseUrl, plainRequest, { Host: `192.168.1.13:${port}`, Origin: `http://192.168.1.13:${port}` });
  assert.equal(mutation.status, 403);
  assert.equal((await mutation.json()).error.code, "ORIGIN_NOT_ALLOWED");
});

test("public config probes local capability without exposing private endpoints", async () => {
  const calls = [];
  const baseUrl = await start({
    env: { WEB_SEARCH_ENABLED: "true" },
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      if (new URL(url).pathname === "/api/tags") {
        return new Response(JSON.stringify({ models: [{ name: "test-model:latest", model: "test-model:latest" }] }), { status: 200 });
      }
      if (new URL(url).pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: ["completion", "tools"] }), { status: 200 });
      }
      if (new URL(url).pathname === "/config") return new Response(JSON.stringify({ engines: [] }), { status: 200 });
      throw new Error("unexpected probe");
    },
  });
  const config = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.equal(config.service.reachable, true);
  assert.equal(config.service.modelInstalled, true);
  assert.equal(config.service.completionCapable, true);
  assert.equal(config.service.toolCallingCapable, true);
  assert.equal(config.webSearch.available, true);
  assert.equal(config.webSearch.macToolAvailable, true);
  assert.equal(config.webSearch.requiresPerRequestOptIn, true);
  assert.deepEqual(calls.sort(), ["/api/show", "/api/tags", "/config"]);
  assert.equal(JSON.stringify(config).includes("127.0.0.1"), false);
});

test("an operator-pinned Ollama digest blocks direct inference on mismatch", async () => {
  const paths = [];
  const baseUrl = await start({
    env: { OLLAMA_MODEL_DIGEST: "a".repeat(64) },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === "/api/tags") return new Response(JSON.stringify({ models: [{ name: "test-model:latest", digest: "b".repeat(64) }] }), { status: 200 });
      if (path === "/api/show") return new Response(JSON.stringify({ capabilities: ["completion", "tools"] }), { status: 200 });
      throw new Error(`unexpected ${path}`);
    },
  });
  const response = await post(baseUrl, plainRequest);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AI_MODEL_IDENTITY_UNVERIFIED");
  assert.equal(paths.includes("/api/chat"), false);
});

test("a cached readiness result cannot authorize inference after the installed tag changes", async () => {
  let installedDigest = "a".repeat(64);
  let chatCalls = 0;
  let tagCalls = 0;
  const baseUrl = await start({
    env: { OLLAMA_MODEL_DIGEST: "a".repeat(64) },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/tags") {
        tagCalls += 1;
        return new Response(JSON.stringify({ models: [{ name: "test-model:latest", digest: installedDigest }] }), { status: 200 });
      }
      if (path === "/api/show") {
        return new Response(JSON.stringify({ capabilities: ["completion", "tools"] }), { status: 200 });
      }
      if (path === "/api/chat") {
        chatCalls += 1;
        return ollamaReply("This request must never reach generation.");
      }
      throw new Error(`unexpected ${path}`);
    },
  });

  const readiness = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.equal(readiness.service.modelIdentityVerified, true);
  installedDigest = "b".repeat(64);

  const response = await post(baseUrl, plainRequest);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AI_MODEL_IDENTITY_UNVERIFIED");
  assert.equal(chatCalls, 0);
  assert.ok(tagCalls >= 2, "inference reused the diagnostic identity cache");
});

test("model identity probes run only after method, media, rate, validation, and capacity admission", async () => {
  let tagCalls = 0;
  let chatCalls = 0;
  const baseUrl = await start({
    env: { OLLAMA_MODEL_DIGEST: "a".repeat(64), AI_RATE_LIMIT_MAX: "1" },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/tags") {
        tagCalls += 1;
        return new Response(JSON.stringify({ models: [{ name: "test-model:latest", digest: "a".repeat(64) }] }), { status: 200 });
      }
      if (path === "/api/chat") {
        chatCalls += 1;
        return ollamaReply("Admitted local answer.");
      }
      throw new Error(`unexpected ${path}`);
    },
  });

  const wrongMethod = await fetch(`${baseUrl}/api/ai/respond`);
  assert.equal(wrongMethod.status, 405);
  const wrongMedia = await fetch(`${baseUrl}/api/ai/respond`, { method: "POST", body: "{}" });
  assert.equal(wrongMedia.status, 415);
  assert.equal(tagCalls, 0);

  const admitted = await post(baseUrl, plainRequest);
  assert.equal(admitted.status, 200);
  assert.equal(tagCalls, 1);
  assert.equal(chatCalls, 1);

  const rateLimited = await post(baseUrl, plainRequest);
  assert.equal(rateLimited.status, 429);
  assert.equal(tagCalls, 1, "rate-limited request reached the identity probe");
  assert.equal(chatCalls, 1);
});

test("phone-only mode probes self-hosted search when Mac inference is disabled", async () => {
  const calls = [];
  const baseUrl = await start({
    enabled: false,
    env: { WEB_SEARCH_ENABLED: "true" },
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      if (new URL(url).pathname === "/config") return new Response(JSON.stringify({ engines: [] }), { status: 200 });
      throw new Error("Ollama must not be probed in phone-only mode");
    },
  });
  const config = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.equal(config.enabled, false);
  assert.equal(config.service.reachable, false);
  assert.equal(config.webSearch.configured, true);
  assert.equal(config.webSearch.available, true);
  assert.deepEqual(calls, ["/config"]);
});

test("valid requests become bounded local Ollama chat calls", async () => {
  let captured;
  const baseUrl = await start({
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return ollamaReply("A held-out test set is not a tuning signal.");
    },
  });
  const response = await post(baseUrl, plainRequest);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.outputText, "A held-out test set is not a tuning signal.");
  assert.deepEqual(body.usage, { inputTokens: 80, outputTokens: 12, totalTokens: 92 });
  assert.equal(new URL(captured.url).pathname, "/api/chat");
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.equal(captured.body.model, "test-model");
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.think, false);
  assert.equal(captured.body.options.num_predict, 500);
  assert.equal("tools" in captured.body, false);
  assert.equal("format" in captured.body, false);
  assert.match(captured.body.messages[0].content, /untrusted source material/);
  assert.match(captured.body.messages.at(-1).content, /<curriculum_context/);
  assert.equal(body.webSearch.used, false);
});

test("structured tasks use server-owned JSON Schema and validate the result", async () => {
  let upstreamBody;
  const structured = { cards: [{ front: "What is leakage?", back: "Information unavailable at prediction time entering training.", hint: null, tags: ["data"] }] };
  const baseUrl = await start({
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return ollamaReply(JSON.stringify(structured));
    },
  });
  const response = await post(baseUrl, {
    contract: AI_REQUEST_CONTRACT_ID,
    task: "flashcards",
    prompt: "Create one card.",
    context: "Leakage makes evaluation optimistic.",
    responseFormat: "structured",
    maxOutputTokens: 500,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, structured);
  assert.match(body.approach.summary, /available learning material/);
  assert.ok(body.approach.steps.some((step) => /atomic source-supported facts/i.test(step)));
  assert.doesNotMatch(JSON.stringify(body.approach), /thinking|chain-of-thought|private reasoning/i);
  assert.equal(upstreamBody.format.type, "object");
  assert.equal(upstreamBody.format.additionalProperties, false);
  assert.equal(upstreamBody.options.temperature, 0);
  assert.match(upstreamBody.messages[0].content, /Return only JSON conforming/);
});

test("web search tool loops only with per-request consent and sanitizes evidence", async () => {
  const calls = [];
  let secondChatBody;
  const baseUrl = await start({
    env: { WEB_SEARCH_ENABLED: "true", WEB_SEARCH_MAX_RESULTS: "2" },
    fetchImpl: async (url, init) => {
      const parsedUrl = new URL(url);
      calls.push(parsedUrl.pathname);
      if (parsedUrl.pathname === "/search") {
        assert.equal(parsedUrl.searchParams.get("q"), "latest stable PyTorch release");
        assert.equal(parsedUrl.searchParams.get("format"), "json");
        return new Response(JSON.stringify({ results: [
          { title: "<b>PyTorch releases</b>", url: "https://pytorch.org/blog/releases/#latest", content: "Latest &amp; supported." },
          { title: "Private panel", url: "http://127.0.0.1/admin", content: "must be filtered" },
          { title: "Docs", url: "https://docs.pytorch.org/docs/stable/index.html", content: "Stable docs" },
          { title: "Overflow", url: "https://example.com/third", content: "must be bounded" },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsedUrl.pathname === "/api/chat" && calls.filter((path) => path === "/api/chat").length === 1) {
        const firstBody = JSON.parse(init.body);
        assert.equal(firstBody.tools[0].function.name, "search_web");
        return ollamaReply("", { message: { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "search_web", arguments: { query: "latest stable PyTorch release" } } }] } });
      }
      if (parsedUrl.pathname === "/api/chat") {
        secondChatBody = JSON.parse(init.body);
        return ollamaReply("The current release is documented by PyTorch [W1].");
      }
      throw new Error(`unexpected ${parsedUrl.pathname}`);
    },
  });

  const response = await post(baseUrl, { ...plainRequest, prompt: "What is the latest stable PyTorch release?", webSearch: true });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.webSearch.requested, true);
  assert.equal(body.webSearch.used, true);
  assert.equal(body.webSearch.rounds, 1);
  assert.equal(body.sources.length, 2);
  assert.deepEqual(body.sources.map((source) => source.title), ["PyTorch releases", "Docs"]);
  assert.equal(JSON.stringify(body.sources).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(secondChatBody.messages).includes("Untrusted search evidence"), true);
  assert.deepEqual(calls, ["/api/chat", "/search", "/api/chat"]);
});

test("web search opt-in is rejected when unavailable before any local call", async () => {
  let serviceCalls = 0;
  const baseUrl = await start({ fetchImpl: async () => {
    serviceCalls += 1;
    throw new Error("must not run");
  } });
  const response = await post(baseUrl, { ...plainRequest, webSearch: true });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.match(body.error.details.join(" "), /webSearch is not enabled/);
  assert.equal(serviceCalls, 0);
});

test("same-origin local-search endpoint accepts only one bounded query and returns sanitized results", async () => {
  let searxCalls = 0;
  const baseUrl = await start({
    env: { WEB_SEARCH_ENABLED: "true", WEB_SEARCH_MAX_RESULTS: "2" },
    fetchImpl: async (url) => {
      searxCalls += 1;
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.pathname, "/search");
      assert.equal(parsedUrl.searchParams.get("q"), "latest ML release");
      return new Response(JSON.stringify({ results: [
        { title: "Official ML release", url: "https://example.org/release#details", content: "Current ML release." },
        { title: "Internal", url: "http://192.168.1.2/admin", content: "filtered" },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const resultResponse = await fetch(`${baseUrl}/api/local-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "latest ML release" }),
  });
  const result = await resultResponse.json();
  assert.equal(resultResponse.status, 200);
  assert.equal(result.query, "latest ML release");
  assert.deepEqual(result.results, [{ title: "Official ML release", url: "https://example.org/release", snippet: "Current ML release." }]);
  assert.equal(JSON.stringify(result).includes("127.0.0.1:8080"), false);

  const injected = await fetch(`${baseUrl}/api/local-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "valid", url: "http://169.254.169.254" }),
  });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error.code, "VALIDATION_ERROR");
  assert.equal(searxCalls, 1);
});

test("local-search endpoint is fail-closed when the operator has not enabled it", async () => {
  let serviceCalls = 0;
  const baseUrl = await start({ fetchImpl: async () => {
    serviceCalls += 1;
    throw new Error("must not run");
  } });
  const response = await fetch(`${baseUrl}/api/local-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "latest release" }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "WEB_SEARCH_UNAVAILABLE");
  assert.equal(serviceCalls, 0);
});

test("no tool is exposed without consent and an unsolicited tool call is denied", async () => {
  let searxCalls = 0;
  const baseUrl = await start({
    env: { WEB_SEARCH_ENABLED: "true" },
    fetchImpl: async (url, init) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === "/search") searxCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal("tools" in body, false);
      return ollamaReply("", { message: { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "search_web", arguments: { query: "secret" } } }] } });
    },
  });
  const response = await post(baseUrl, plainRequest);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "WEB_SEARCH_NOT_ALLOWED");
  assert.equal(searxCalls, 0);
});

test("unsupported fields and oversized inputs are rejected before Ollama", async () => {
  let serviceCalls = 0;
  const baseUrl = await start({ fetchImpl: async () => {
    serviceCalls += 1;
    throw new Error("must not run");
  } });
  const injected = await post(baseUrl, { ...plainRequest, model: "attacker-model", provider: "remote", baseUrl: "https://attacker.example" });
  const oversized = await post(baseUrl, { ...plainRequest, context: "x".repeat(25_000) });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error.code, "VALIDATION_ERROR");
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error.code, "VALIDATION_ERROR");
  assert.equal(serviceCalls, 0);
});

test("body limits, origins, and per-client rate limits are enforced", async () => {
  const baseUrl = await start({
    env: { AI_MAX_BODY_BYTES: "8192", AI_RATE_LIMIT_MAX: "2" },
    fetchImpl: async () => ollamaReply("ok"),
  });
  const forbidden = await post(baseUrl, plainRequest, { Origin: "https://attacker.example" });
  const huge = await post(baseUrl, { task: "explain", prompt: "x".repeat(9_000) });
  const first = await post(baseUrl, plainRequest);
  const limited = await post(baseUrl, plainRequest);
  assert.equal(forbidden.status, 403);
  assert.equal(huge.status, 413);
  assert.equal(first.status, 200);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");
});

test("code_review is a supported Markdown task with a senior-review instruction", async () => {
  let upstreamBody;
  const baseUrl = await start({
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return ollamaReply("1. Correctness: the loop condition skips the final element.");
    },
  });
  const config = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.ok(config.supportedTasks.includes("code_review"), "config must advertise code_review");
  assert.equal(config.structuredTasks.includes("code_review"), false, "code_review is a prose task");

  const response = await post(baseUrl, {
    ...plainRequest,
    task: "code_review",
    prompt: "Review this:\n```python\nfor i in range(len(items) - 1):\n    process(items[i])\n```",
  });
  assert.equal(response.status, 200);
  assert.match(upstreamBody.messages[0].content, /correctness defects first/i);
  assert.match(upstreamBody.messages[0].content, /say so and ask for it instead of inventing code/i);

  const structuredRejected = await post(baseUrl, { ...plainRequest, task: "code_review", responseFormat: "structured" });
  assert.equal(structuredRejected.status, 400, "structured output must not be accepted for code_review");
});

test("the Deep profile is capability-gated on attested model thinking support", async () => {
  const makeFetch = (capabilities) => async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/tags") return new Response(JSON.stringify({ models: [{ name: "test-model:latest" }] }), { status: 200 });
    if (path === "/api/show") return new Response(JSON.stringify({ capabilities }), { status: 200 });
    return ollamaReply("A short deep answer.");
  };

  const nonThinking = await start({ fetchImpl: makeFetch(["completion", "tools"]) });
  const rejected = await post(nonThinking, { ...plainRequest, responseProfile: "deep", maxOutputTokens: undefined });
  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 400);
  assert.equal(rejectedBody.error.code, "AI_PROFILE_UNSUPPORTED");
  assert.match(rejectedBody.error.message, /thinking support/i);
  assert.match(rejectedBody.error.message, /fast or balanced/i);
  const nonThinkingConfig = await fetch(`${nonThinking}/api/ai/config`).then((response) => response.json());
  assert.equal(nonThinkingConfig.service.thinkingCapable, false, "config must advertise the missing capability the UI gates on");
  const balancedStillWorks = await post(nonThinking, plainRequest);
  assert.equal(balancedStillWorks.status, 200, "capability gating must not affect non-deep profiles");

  const thinking = await start({ fetchImpl: makeFetch(["completion", "tools", "thinking"]) });
  const accepted = await post(thinking, { ...plainRequest, responseProfile: "deep", maxOutputTokens: undefined });
  assert.equal(accepted.status, 200);
});

test("learner pairing guards AI and search endpoints behind an HttpOnly session", async () => {
  const baseUrl = await start({
    env: { AI_AUTH: "pairing", AI_AUTH_LOOPBACK: "require", AI_PAIRING_CODE: "correct-horse-battery" },
    fetchImpl: async () => ollamaReply("ok"),
  });

  const denied = await post(baseUrl, plainRequest);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, "AI_AUTH_REQUIRED");
  const searchDenied = await fetch(`${baseUrl}/api/local-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "anything" }),
  });
  assert.equal(searchDenied.status, 401, "the search gateway was reachable without a session");

  const unpairedConfig = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.equal(unpairedConfig.auth.required, true);
  assert.equal(unpairedConfig.auth.sessionActive, false);
  assert.equal(unpairedConfig.auth.pairEndpoint, "/api/auth/pair");

  const wrongCode = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "wrong-code-guess" }),
  });
  assert.equal(wrongCode.status, 401);
  assert.equal((await wrongCode.json()).error.code, "PAIRING_CODE_INVALID");

  const paired = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "correct-horse-battery" }),
  });
  assert.equal(paired.status, 200);
  const setCookies = paired.headers.getSetCookie();
  assert.equal(setCookies.length, 1);
  assert.match(setCookies[0], /^lumen\.ai\.session=/);
  assert.match(setCookies[0], /HttpOnly/);
  assert.match(setCookies[0], /SameSite=Strict/);
  const cookie = setCookies[0].split(";")[0];

  const allowed = await post(baseUrl, plainRequest, { Cookie: cookie });
  assert.equal(allowed.status, 200, "a freshly paired session could not use AI");
  const pairedConfig = await fetch(`${baseUrl}/api/ai/config`, { headers: { Cookie: cookie } }).then((response) => response.json());
  assert.equal(pairedConfig.auth.sessionActive, true);

  const tamperedValue = cookie.endsWith("aa") ? `${cookie.slice(0, -2)}bb` : `${cookie.slice(0, -2)}aa`;
  const tampered = await post(baseUrl, plainRequest, { Cookie: tamperedValue });
  assert.equal(tampered.status, 401, "a tampered session token was accepted");

  const openServer = await start({ fetchImpl: async () => ollamaReply("ok") });
  const notEnabled = await fetch(`${openServer}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "anything-at-all" }),
  });
  assert.equal(notEnabled.status, 409);
  assert.equal((await notEnabled.json()).error.code, "AI_AUTH_NOT_ENABLED");
});

test("pairing attempts are strictly rate limited per client", async () => {
  const baseUrl = await start({
    env: { AI_AUTH: "pairing", AI_AUTH_LOOPBACK: "require", AI_PAIRING_CODE: "correct-horse-battery" },
    fetchImpl: async () => ollamaReply("ok"),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: `wrong-${attempt}` }),
    });
    assert.equal(rejected.status, 401);
  }
  const limited = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "correct-horse-battery" }),
  });
  assert.equal(limited.status, 429, "the sixth attempt in the window was not rate limited");
  assert.equal((await limited.json()).error.code, "PAIRING_RATE_LIMITED");
});

test("loopback is exempt by default under pairing; LAN posture still requires a session", async () => {
  const baseUrl = await start({
    env: { AI_AUTH: "pairing", AI_PAIRING_CODE: "correct-horse-battery" },
    fetchImpl: async () => ollamaReply("ok"),
  });
  // The test client IS loopback: with the default exempt posture, AI works
  // without any session and the config reports the browser as active.
  const allowed = await post(baseUrl, plainRequest);
  assert.equal(allowed.status, 200, "loopback must not be asked for its own machine's code");
  const reported = await fetch(`${baseUrl}/api/ai/config`).then((response) => response.json());
  assert.equal(reported.auth.required, true);
  assert.equal(reported.auth.sessionActive, true, "an exempt loopback client must present as paired so the UI never prompts");
});

test("one-time pairing tickets mint at the machine, redeem once, then die", async () => {
  const baseUrl = await start({
    env: { AI_AUTH: "pairing", AI_AUTH_LOOPBACK: "require", AI_PAIRING_CODE: "correct-horse-battery" },
    fetchImpl: async () => ollamaReply("ok"),
  });
  const minted = await fetch(`${baseUrl}/api/auth/pair/ticket`, { method: "POST" });
  assert.equal(minted.status, 200);
  const { ticket, expiresAt } = await minted.json();
  assert.match(ticket, /^[A-Za-z0-9_-]{16,}$/);
  assert.ok(Date.parse(expiresAt) > Date.now());

  const redeemed = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(redeemed.status, 200);
  const cookie = redeemed.headers.getSetCookie()[0].split(";")[0];
  const allowed = await post(baseUrl, plainRequest, { Cookie: cookie });
  assert.equal(allowed.status, 200, "a ticket-paired session must reach the AI");

  const replayed = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(replayed.status, 401, "tickets are single-use");
  assert.equal((await replayed.json()).error.code, "PAIRING_TICKET_INVALID");

  const bogus = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: "never-minted-ticket" }),
  });
  assert.equal(bogus.status, 401);
  assert.equal((await bogus.json()).error.code, "PAIRING_TICKET_INVALID");

  const openServer = await start({ fetchImpl: async () => ollamaReply("ok") });
  const notEnabled = await fetch(`${openServer}/api/auth/pair/ticket`, { method: "POST" });
  assert.equal(notEnabled.status, 409, "ticket minting requires pairing mode");
});

test("non-loopback AI serving fails closed without pairing or an explicit acknowledgment", () => {
  const lanEnv = { HOST: "192.168.1.10", PORT: "0", AI_ENABLED: "true", OLLAMA_MODEL: "test-model" };
  assert.throws(
    () => createApplicationServer({ env: lanEnv, logger: silentLogger }),
    /requires learner pairing/,
  );
  // The acknowledgment (or pairing) advances startup to the next invariant,
  // which is the TLS requirement.
  assert.throws(
    () => createApplicationServer({ env: { ...lanEnv, AI_ALLOW_UNAUTHENTICATED_LAN: "true" }, logger: silentLogger }),
    /TLS is required/,
  );
  assert.throws(
    () => createApplicationServer({ env: { ...lanEnv, AI_AUTH: "pairing", AI_PAIRING_CODE: "correct-horse-battery" }, logger: silentLogger }),
    /TLS is required/,
  );
  assert.throws(
    () => createApplicationServer({ env: { ...lanEnv, AI_AUTH: "pairing" }, logger: silentLogger }),
    /AI_PAIRING_CODE with at least 8 characters/,
  );
});

test("version-skewed request contracts fail with one typed, actionable error", async () => {
  const baseUrl = await start({ fetchImpl: async () => ollamaReply("ok") });
  const { contract, ...stalePayload } = plainRequest;

  const missing = await post(baseUrl, stalePayload);
  const missingBody = await missing.json();
  assert.equal(missing.status, 409);
  assert.equal(missingBody.error.code, "AI_CONTRACT_MISMATCH");
  assert.match(missingBody.error.message, /reload the app/i);
  assert.match(missingBody.error.message, /restart the integrated lumen server/i);

  const stale = await fetch(`${baseUrl}/api/ai/respond/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...plainRequest, contract: "lumen.ai.request.v0" }),
  });
  const staleBody = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(staleBody.error.code, "AI_CONTRACT_MISMATCH");

  const matching = await post(baseUrl, plainRequest);
  assert.equal(matching.status, 200);
});

test("loopback API rejects DNS-rebinding Host and Origin pairs", async () => {
  let serviceCalls = 0;
  const baseUrl = await start({ fetchImpl: async () => {
    serviceCalls += 1;
    return ollamaReply("must not run");
  } });
  const port = new URL(baseUrl).port;
  const response = await post(baseUrl, plainRequest, {
    Host: `evil.example:${port}`,
    Origin: `http://evil.example:${port}`,
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(serviceCalls, 0);
});

test("local service errors are typed and upstream diagnostics are sanitized", async () => {
  const baseUrl = await start({
    fetchImpl: async () => new Response(JSON.stringify({ error: "private local filesystem diagnostic" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }),
  });
  const response = await post(baseUrl, plainRequest);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AI_MODEL_NOT_FOUND");
  assert.equal(JSON.stringify(body).includes("private local filesystem diagnostic"), false);
});
