import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_REQUEST_CONTRACT_ID } from "../../src/lib/aiContract.js";
import { readAiServerConfig, publicAiConfig } from "./config.mjs";
import { validateAiRequest } from "./contracts.mjs";
import { buildOllamaRequest, createOllamaResponse, fallbackWebSearchQuery, OllamaProxyError, probeLocalAiServices, warmUpOllamaModel } from "./ollama.mjs";
import { rankPublicSearchResults, sanitizePublicResultUrl, searchSearxng, validateSearchQuery, WebSearchError } from "./searxng.mjs";

const request = Object.freeze({
  contract: AI_REQUEST_CONTRACT_ID,
  task: "explain",
  prompt: "What changed recently?",
  context: "",
  documentTitle: "",
  difficulty: "intermediate",
  history: [],
  responseFormat: "markdown",
  maxOutputTokens: 300,
  webSearch: false,
});

const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("local inference is free/no-key but safely opt-in and service endpoints stay private", () => {
  const config = readAiServerConfig({});
  const publicConfig = publicAiConfig(config, { ollamaReachable: true, modelInstalled: true, completionCapable: true, toolCallingCapable: true });
  assert.equal(config.provider, "ollama");
  assert.equal(config.model, "qwen3.5:4b");
  assert.equal(config.enabled, false);
  assert.equal(readAiServerConfig({ AI_ENABLED: "true" }).enabled, true);
  assert.equal(config.ollamaUrl, "http://127.0.0.1:11434");
  assert.equal(publicConfig.provider, "ollama-local");
  assert.equal(publicConfig.privacy.paidRemoteApisUsed, false);
  assert.ok(publicConfig.limits.maxRequestUtf8Bytes >= 1_024);
  assert.ok(publicConfig.limits.maxRequestUtf8Bytes < publicConfig.limits.conservativeInputBytes);
  assert.equal(JSON.stringify(publicConfig).includes("11434"), false);
  assert.equal(JSON.stringify(publicConfig).includes("8080"), false);
});

test("remote AI/search endpoints and unsupported providers are rejected at startup", () => {
  assert.throws(() => readAiServerConfig({ OLLAMA_URL: "https://api.example.com" }), /must use loopback/);
  assert.throws(() => readAiServerConfig({ SEARXNG_URL: "http://169.254.169.254" }), /must use loopback/);
  assert.throws(() => readAiServerConfig({ AI_PROVIDER: "openai" }), /only ollama/);
  assert.throws(() => readAiServerConfig({ OLLAMA_URL: "http://user:pass@127.0.0.1:11434" }), /without credentials/);
  const lan = readAiServerConfig({
    AI_ALLOW_PRIVATE_NETWORK_SERVICES: "true",
    OLLAMA_URL: "http://192.168.1.20:11434",
    SEARXNG_URL: "http://lumen-search.local:8080",
  });
  assert.equal(lan.ollamaUrl, "http://192.168.1.20:11434");
});

test("the published request-contract identity is exact and version-skewed payloads fail typed", () => {
  const config = readAiServerConfig({ AI_ENABLED: "true" });
  // Pin the exact published identity: an accidental edit to the shared
  // constant must fail this test, not silently re-version the contract.
  assert.equal(AI_REQUEST_CONTRACT_ID, "lumen.ai.request.v2");
  assert.equal(publicAiConfig(config).requestContract, AI_REQUEST_CONTRACT_ID);
  assert.equal(publicAiConfig(readAiServerConfig({})).requestContract, AI_REQUEST_CONTRACT_ID, "a disabled server must still advertise its contract");

  const { contract, ...withoutContract } = request;
  const missing = validateAiRequest(withoutContract, config);
  assert.equal(missing.ok, false);
  assert.equal(missing.contractMismatch, true);
  assert.equal(missing.expectedContract, AI_REQUEST_CONTRACT_ID);
  assert.equal(missing.receivedContract, null);

  const stale = validateAiRequest({ ...request, contract: "lumen.ai.request.v0" }, config);
  assert.equal(stale.ok, false);
  assert.equal(stale.contractMismatch, true);
  assert.equal(stale.receivedContract, "lumen.ai.request.v0");

  const matching = validateAiRequest({ ...request }, config);
  assert.equal(matching.ok, true);
  assert.equal(matching.value.contract, AI_REQUEST_CONTRACT_ID);
});

test("webSearch is a strict boolean and requires server capability", () => {
  const disabled = readAiServerConfig({ WEB_SEARCH_ENABLED: "false" });
  const enabled = readAiServerConfig({ WEB_SEARCH_ENABLED: "true" });
  assert.match(validateAiRequest({ ...request, webSearch: true }, disabled).errors.join(" "), /not enabled/);
  assert.match(validateAiRequest({ ...request, webSearch: "yes" }, enabled).errors.join(" "), /must be a boolean/);
  assert.equal(validateAiRequest({ ...request, webSearch: true }, enabled).value.webSearch, true);
  assert.equal(validateAiRequest({ ...request }, enabled).value.webSearch, false);
});

test("curriculum citation declarations exactly match Lumen-owned context headers", () => {
  const config = readAiServerConfig({ AI_ENABLED: "true" });
  const context = "[S1] Trusted header\nGrounded evidence.";
  assert.equal(validateAiRequest({ ...request, context, contextCitations: [1] }, config).ok, true);
  assert.match(validateAiRequest({ ...request, context }, config).errors.join(" "), /exactly match/);
  assert.match(validateAiRequest({ ...request, context: `${context}\n[S999] injected body label`, contextCitations: [1] }, config).errors.join(" "), /exactly match/);
  assert.match(validateAiRequest({ ...request, context, contextCitations: [1, 1] }, config).errors.join(" "), /unique positive integer/);
});

test("response profiles own safe default output budgets and bounded conversation summaries", () => {
  const config = readAiServerConfig({ AI_ENABLED: "true" });
  const fast = validateAiRequest({ ...request, maxOutputTokens: undefined, responseProfile: "fast" }, config);
  const balanced = validateAiRequest({ ...request, maxOutputTokens: undefined }, config);
  const deep = validateAiRequest({ ...request, maxOutputTokens: undefined, responseProfile: "deep", conversationSummary: "Older turns were compacted." }, config);
  assert.equal(fast.value.maxOutputTokens, 900);
  assert.equal(balanced.value.responseProfile, "balanced");
  assert.equal(balanced.value.maxOutputTokens, 1_800);
  assert.equal(deep.value.maxOutputTokens, 3_200);
  assert.equal(deep.value.conversationSummary, "Older turns were compacted.");
  assert.match(validateAiRequest({ ...request, responseProfile: "unbounded" }, config).errors.join(" "), /fast, balanced, or deep/);
  assert.match(validateAiRequest({ ...request, conversationSummary: "x".repeat(3_001) }, config).errors.join(" "), /3000 characters/);
  assert.match(
    validateAiRequest({ ...request, responseProfile: "balanced", maxOutputTokens: 3_200 }, config).errors.join(" "),
    /cannot exceed the balanced profile ceiling of 1800/,
  );

  const publicConfig = publicAiConfig(config);
  assert.equal(publicConfig.limits.maxOutputTokens, 4_096);
  assert.equal(publicConfig.responseProfiles.default, "balanced");
  assert.deepEqual(publicConfig.responseProfiles.outputTokens, { fast: 900, balanced: 1_800, deep: 3_200 });
  assert.ok(publicConfig.responseProfiles.maxRequestUtf8Bytes.fast > publicConfig.responseProfiles.maxRequestUtf8Bytes.balanced);
  assert.ok(publicConfig.responseProfiles.maxRequestUtf8Bytes.balanced > publicConfig.responseProfiles.maxRequestUtf8Bytes.deep);
  assert.equal(publicConfig.responseProfiles.providerThinkingReturned, false);
  assert.equal(buildOllamaRequest({ ...deep.value }, config).think, true);
  assert.equal(buildOllamaRequest({ ...fast.value }, config).think, false);
  assert.match(buildOllamaRequest({ ...balanced.value }, config).messages[0].content, /finish the complete answer within about 1476 tokens/);
});

test("authorized fallback search selects the actual current question instead of prompt boilerplate", () => {
  const selected = fallbackWebSearchQuery({
    prompt: "Please help me study this topic.\n\nUse the supplied [S#] labels and Markdown.\n\nWhat is the latest stable Ollama tool-calling release?",
  });
  assert.equal(selected, "What is the latest stable Ollama tool-calling release?");
  assert.equal(fallbackWebSearchQuery({ prompt: "Preamble.\n\nHow does calibration work?\n\nDo not cite unsupported labels." }), "How does calibration work?");
  assert.equal(fallbackWebSearchQuery({ prompt: "What is current? !ddg :images" }), "What is current?");
  assert.equal(fallbackWebSearchQuery({ prompt: "Research request. What changed in PyTorch 2.7.1 today?" }), "What changed in PyTorch 2.7.1 today?");
  assert.ok(selected.length <= 240);
});

test("a canonical browser request at the advertised profile byte boundary is accepted", async () => {
  const config = { ...readAiServerConfig({ AI_ENABLED: "true" }), model: "test-model" };
  const maximum = publicAiConfig(config).responseProfiles.maxRequestUtf8Bytes.balanced;
  const base = {
    contract: AI_REQUEST_CONTRACT_ID,
    task: "explain",
    prompt: "Explain calibration.",
    context: "",
    contextCitations: [],
    documentTitle: "Calibration",
    difficulty: "intermediate",
    history: [],
    conversationSummary: "",
    responseFormat: "markdown",
    responseProfile: "balanced",
    maxOutputTokens: 1_800,
    webSearch: false,
  };
  let low = 0;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const bytes = Buffer.byteLength(JSON.stringify({ ...base, context: "x".repeat(middle) }), "utf8");
    if (bytes <= maximum) low = middle;
    else high = middle - 1;
  }
  const boundaryRequest = { ...base, context: "x".repeat(low) };
  assert.equal(Buffer.byteLength(JSON.stringify(boundaryRequest), "utf8"), maximum);
  assert.deepEqual(validateAiRequest(boundaryRequest, config).value, boundaryRequest);

  let fetchCalls = 0;
  const result = await createOllamaResponse({
    request: boundaryRequest,
    config,
    requestId: "canonical-profile-boundary",
    fetchImpl: async () => {
      fetchCalls += 1;
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "A bounded answer." } });
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(result.outputText, "A bounded answer.");
});

test("Ollama and SearXNG capability probes run concurrently", async () => {
  const expectedDigest = "a".repeat(64);
  const config = readAiServerConfig({ AI_ENABLED: "true", WEB_SEARCH_ENABLED: "true", AI_SERVICE_PROBE_TIMEOUT_MS: "1000", OLLAMA_MODEL_DIGEST: expectedDigest });
  const pending = [];
  const probePromise = probeLocalAiServices(config, (url) => new Promise((resolve) => pending.push({ path: new URL(url).pathname, resolve })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending.map((entry) => entry.path).sort(), ["/api/show", "/api/tags", "/config"]);
  pending.find((entry) => entry.path === "/api/tags").resolve(response({ models: [{ name: "qwen3.5:4b", digest: expectedDigest }] }));
  pending.find((entry) => entry.path === "/api/show").resolve(response({ capabilities: ["completion", "tools", "thinking"] }));
  pending.find((entry) => entry.path === "/config").resolve(response({ engines: [] }));
  const status = await probePromise;
  assert.equal(status.ollamaReachable, true);
  assert.equal(status.modelInstalled, true);
  assert.equal(status.modelIdentityVerified, true);
  assert.equal(status.completionCapable, true);
  assert.equal(status.toolCallingCapable, true);
  assert.equal(status.searxngReachable, true);
});

test("configured model digest fails readiness closed on a mutable-tag mismatch", async () => {
  const config = readAiServerConfig({ AI_ENABLED: "true", OLLAMA_MODEL_DIGEST: "a".repeat(64) });
  const status = await probeLocalAiServices(config, async (url) => {
    if (new URL(url).pathname === "/api/tags") return response({ models: [{ name: "qwen3.5:4b", digest: "b".repeat(64) }] });
    return response({ capabilities: ["completion", "tools"] });
  });
  assert.equal(status.modelInstalled, true);
  assert.equal(status.modelIdentityVerified, false);
  assert.equal(status.completionCapable, false);
  assert.equal(status.toolCallingCapable, false);
  assert.throws(() => readAiServerConfig({ OLLAMA_MODEL_DIGEST: "not-a-digest" }), /64-character/);
});

test("search queries and public result URLs are conservatively validated", () => {
  assert.equal(validateSearchQuery("  latest   PyTorch  "), "latest PyTorch");
  assert.equal(validateSearchQuery(""), null);
  assert.equal(validateSearchQuery(`bad\u0000query`), null);
  assert.equal(validateSearchQuery(`bad\u009bquery`), null);
  assert.equal(validateSearchQuery(`looks-safe\u202Etxt`), null);
  assert.equal(validateSearchQuery(`looks\u00adsafe`), null);
  assert.equal(validateSearchQuery(`blank\u3164filler`), null);
  assert.equal(validateSearchQuery(`hidden${String.fromCodePoint(0xe0061)}tag`), null);
  assert.equal(validateSearchQuery("!ddg override engine"), null);
  assert.equal(validateSearchQuery("release :images"), null);
  assert.equal(validateSearchQuery("x".repeat(241)), null);
  assert.equal(sanitizePublicResultUrl("https://example.com/page#section"), "https://example.com/page");
  assert.equal(sanitizePublicResultUrl("http://127.0.0.1/private"), null);
  assert.equal(sanitizePublicResultUrl("http://[::1]/private"), null);
  assert.equal(sanitizePublicResultUrl("http://[ff02::1]/multicast"), null);
  assert.equal(sanitizePublicResultUrl("http://[2001:db8::1]/documentation"), null);
  assert.equal(sanitizePublicResultUrl("http://localhost./private"), null);
  assert.equal(sanitizePublicResultUrl("http://metadata.google.internal./private"), null);
  assert.equal(sanitizePublicResultUrl("https://metadata.local/private"), null);
  assert.equal(sanitizePublicResultUrl("file:///etc/passwd"), null);
  assert.equal(sanitizePublicResultUrl("https://user:pass@example.com"), null);
  assert.equal(
    sanitizePublicResultUrl("https://example.com/docs?utm_source=feed&b=2&a=1&fbclid=tracking#section"),
    "https://example.com/docs?a=1&b=2",
  );
});

test("web evidence is canonically deduplicated and ranked by transparent relevance signals", async () => {
  const query = "latest PyTorch release site:pytorch.org";
  const ranked = rankPublicSearchResults([
    { title: "Latest PyTorch release discussion", url: "https://news.example.com/pytorch", snippet: "A third-party discussion.", publishedAt: "2026-08-30" },
    { title: "Official PyTorch release notes", url: "https://pytorch.org/docs/stable/release", snippet: "Supported release documentation.", publishedAt: "2026-08-20" },
  ], query, 2, Date.parse("2026-08-31T00:00:00Z"));
  assert.equal(ranked[0].url, "https://pytorch.org/docs/stable/release");

  const config = {
    webSearchEnabled: true,
    searxngUrl: "http://127.0.0.1:8080",
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 3,
  };
  const result = await searchSearxng({
    query,
    config,
    fetchImpl: async () => response({ results: [
      { title: "Third-party release summary", url: "https://news.example.com/pytorch", content: "Community summary.", publishedDate: "2026-08-30" },
      { title: "Official PyTorch release docs", url: "https://pytorch.org/docs/stable/release?utm_source=feed&b=2&a=1#top", content: "Official supported release details.", publishedDate: "2026-08-20" },
      { title: "Duplicate tracking URL", url: "https://pytorch.org/docs/stable/release?a=1&fbclid=x&b=2", content: "Duplicate must not consume a slot." },
      { title: "Unrelated", url: "https://example.net/other", content: "Not about the requested framework." },
    ] }),
  });
  assert.equal(result.results[0].url, "https://pytorch.org/docs/stable/release?a=1&b=2");
  assert.equal(result.results.filter((item) => item.url.includes("pytorch.org/docs/stable/release")).length, 1);
  assert.equal(result.results.length, 1, "site-qualified search retained off-domain or unrelated evidence");

  const degraded = rankPublicSearchResults([
    { title: "Breaking News, Latest News and Videos", url: "https://news.example.com/", snippet: "World headlines and weather." },
    { title: "Official PyTorch releases", url: "https://pytorch.org/blog/releases/", snippet: "Stable PyTorch release notes." },
  ], "latest stable PyTorch release official", 5);
  assert.deepEqual(degraded.map((item) => item.url), ["https://pytorch.org/blog/releases/"], "generic recency words admitted irrelevant current-news results");

  const featureSpecific = rankPublicSearchResults([
    { title: "Ollama documentation", url: "https://docs.ollama.com/", snippet: "Start building with open models." },
    { title: "Structured outputs in Ollama", url: "https://docs.ollama.com/capabilities/structured-outputs", snippet: "Constrain model responses with a JSON schema." },
  ], "Ollama structured outputs documentation", 5);
  assert.deepEqual(
    featureSpecific.map((item) => item.url),
    ["https://docs.ollama.com/capabilities/structured-outputs"],
    "a generic product landing page passed as evidence for a feature-specific query",
  );
});

test("SearXNG response content, URLs, count, and fields are sanitized", async () => {
  const config = {
    webSearchEnabled: true,
    searxngUrl: "http://127.0.0.1:8080",
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
  };
  const result = await searchSearxng({
    query: "current release",
    config,
    fetchImpl: async (url, init) => {
      const searchUrl = new URL(url);
      assert.equal(searchUrl.origin, "http://127.0.0.1:8080");
      assert.equal(searchUrl.searchParams.get("language"), "en");
      assert.equal(searchUrl.searchParams.get("safesearch"), "1");
      assert.equal(init.redirect, "error");
      return response({ results: [
        { title: "No evidence body", url: "https://example.org/empty", content: "" },
        { title: "<script>bad()</script><b>Release</b>", url: "https://example.org/release#x", content: "Hello &amp; goodbye", engine: "bing", publishedDate: "2026-08-22T10:00:00Z", extra: "omit" },
        { title: "Second", url: "https://example.org/second", content: "bounded by result limit" },
      ] });
    },
  });
  assert.deepEqual(result, {
    query: "current release",
    results: [{ title: "bad() Release", url: "https://example.org/release", snippet: "Hello & goodbye", source: "bing", publishedAt: "2026-08-22" }],
  });
});

test("SearXNG timeout becomes a typed sanitized error", async () => {
  const config = {
    webSearchEnabled: true,
    searxngUrl: "http://127.0.0.1:8080",
    webSearchTimeoutMs: 10,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
  };
  await assert.rejects(
    searchSearxng({
      query: "current release",
      config,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    }),
    (error) => error instanceof WebSearchError && error.code === "WEB_SEARCH_TIMEOUT" && error.status === 504,
  );
});

test("SearXNG response-body stalls cannot bypass the search deadline", async () => {
  const config = {
    webSearchEnabled: true,
    searxngUrl: "http://127.0.0.1:8080",
    webSearchTimeoutMs: 10,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
  };
  await assert.rejects(
    searchSearxng({
      query: "current release",
      config,
      fetchImpl: async () => new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error) => error instanceof WebSearchError && error.code === "WEB_SEARCH_TIMEOUT",
  );
});

test("tool rounds are bounded even when a local model keeps searching", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  let searchCalls = 0;
  const ollamaBodies = [];
  await assert.rejects(createOllamaResponse({
    request: { ...request, webSearch: true },
    config,
    requestId: "local-test",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        searchCalls += 1;
        return response({ results: [] });
      }
      ollamaBodies.push(JSON.parse(init.body));
      return response({
        model: "test-model",
        done: true,
        done_reason: "stop",
        message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "latest" } } }] },
      });
    },
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_TOOL_NOT_ALLOWED");
  assert.equal(searchCalls, 1);
  assert.equal(Array.isArray(ollamaBodies[0].tools), true);
  assert.equal(Object.hasOwn(ollamaBodies[1], "tools"), false);
});

test("the final model turn answers from evidence after the search budget is consumed", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  let ollamaCalls = 0;
  const result = await createOllamaResponse({
    request: { ...request, webSearch: true },
    config,
    requestId: "local-answer-after-search",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        return response({ results: [{ title: "Release", url: "https://example.org/release", content: "Current evidence" }] });
      }
      ollamaCalls += 1;
      const body = JSON.parse(init.body);
      if (ollamaCalls === 1) {
        assert.equal(Array.isArray(body.tools), true);
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "latest release" } } }] } });
      }
      assert.equal(Object.hasOwn(body, "tools"), false);
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Grounded answer [W1]. A literal example ``[W99]`` is code, not a citation." } });
    },
  });
  assert.equal(result.webSearch.used, true);
  assert.equal(result.webSearch.rounds, 1);
  assert.equal(result.sources[0].url, "https://example.org/release");
});

test("Markdown web grounding permits one bounded refinement before tool-free synthesis", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 2,
  };
  let ollamaCalls = 0;
  const queries = [];
  const result = await createOllamaResponse({
    request: { ...request, webSearch: true },
    config,
    requestId: "markdown-search-refinement",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        const query = new URL(url).searchParams.get("q");
        queries.push(query);
        return response({ results: [{
          title: query.includes("official") ? "Official current release documentation" : "Current release overview",
          url: query.includes("official") ? "https://docs.example.org/release" : "https://example.org/release",
          content: query.includes("official") ? "Official documentation confirms version 3." : "The overview says version 3 is current.",
        }] });
      }
      ollamaCalls += 1;
      const body = JSON.parse(init.body);
      if (ollamaCalls === 1) {
        assert.equal(Array.isArray(body.tools), true);
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "current release overview" } } }] } });
      }
      if (ollamaCalls === 2) {
        assert.equal(Array.isArray(body.tools), true, "the configured second refinement tool was removed");
        assert.match(body.messages.find((message) => message.role === "tool").content, /W1/);
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "official current release documentation" } } }] } });
      }
      assert.equal(Object.hasOwn(body, "tools"), false);
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Version 3 is current [W1] [W2]." } });
    },
  });
  assert.equal(ollamaCalls, 3);
  assert.deepEqual(queries, ["current release overview", "official current release documentation"]);
  assert.equal(result.webSearch.rounds, 2);
  assert.deepEqual(result.sources.map((source) => source.url), ["https://example.org/release", "https://docs.example.org/release"]);
});

test("a model cannot present a searched answer when search returned no usable evidence", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  let ollamaCalls = 0;
  await assert.rejects(createOllamaResponse({
    request: { ...request, webSearch: true },
    config,
    requestId: "local-no-evidence",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/search") return response({ results: [] });
      ollamaCalls += 1;
      return response(ollamaCalls === 1
        ? { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "too narrow" } } }] } }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Unsupported current claim" } });
    },
  }), (error) => error instanceof OllamaProxyError && error.code === "WEB_SEARCH_NO_RESULTS");
});

test("a searched prose answer must cite the evidence it was given", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  for (const finalOutput of ["Version 3 is current.", "Version 3 is current [w1].", "Version 3 is current [W1] [W99]."]) {
    let ollamaCalls = 0;
    await assert.rejects(createOllamaResponse({
      request: { ...request, webSearch: true },
      config,
      requestId: "local-uncited-evidence",
      fetchImpl: async (url) => {
        if (new URL(url).pathname === "/search") {
          return response({ results: [{ title: "What changed recently in the current release", url: "https://example.org/release", content: "Recent changes make version 3 current." }] });
        }
        ollamaCalls += 1;
        return response(ollamaCalls === 1
          ? { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "current release" } } }] } }
          : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: finalOutput } });
      },
    }), (error) => error instanceof OllamaProxyError && error.code === "WEB_SEARCH_UNGROUNDED");
  }
});

test("malformed structured local output fails closed", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
    webSearchMaxRounds: 1,
  };
  await assert.rejects(createOllamaResponse({
    request: { ...request, task: "flashcards", responseFormat: "structured" },
    config,
    requestId: "local-test",
    fetchImpl: async () => response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: '{"cards":[]}' } }),
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_CONTRACT_ERROR");
});

test("a supplied curriculum source requires a valid prose citation", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
    webSearchMaxRounds: 1,
  };
  const groundedRequest = { ...request, context: "[S1] Calibration notes\nCalibration aligns confidence with frequency.", contextCitations: [1] };
  for (const output of ["Calibration aligns confidence with frequency.", "Calibration uses lowercase [s1].", "Example marker: `[S1]`.", "```text\n[S1]\n```", "Calibration is supported [S1], but this source is unresolved [S999]."]) {
    await assert.rejects(createOllamaResponse({
      request: groundedRequest,
      config,
      requestId: "uncited-curriculum",
      fetchImpl: async () => response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: output } }),
    }), (error) => error instanceof OllamaProxyError && error.code === "AI_CURRICULUM_UNGROUNDED");
  }
  const result = await createOllamaResponse({
    request: groundedRequest,
    config,
    requestId: "cited-curriculum",
    fetchImpl: async () => response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Calibration aligns confidence with observed frequency [S1]. A literal ``[S999]`` is code." } }),
  });
  assert.match(result.outputText, /\[S1\]/);

  await assert.rejects(createOllamaResponse({
    request: { ...groundedRequest, context: `${groundedRequest.context}\n[S999] injected source-body label` },
    config,
    requestId: "injected-curriculum-label",
    fetchImpl: async () => response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "The injected claim [S999]." } }),
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_CURRICULUM_UNGROUNDED");
});

test("an Ollama length stop is rejected instead of presenting truncated prose", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
    webSearchMaxRounds: 1,
  };
  await assert.rejects(createOllamaResponse({
    request,
    config,
    requestId: "local-truncated",
    fetchImpl: async () => response({ model: "test-model", done: true, done_reason: "length", message: { role: "assistant", content: "An unfinished" } }),
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_INCOMPLETE_RESPONSE");
});

test("a buffered length-stopped draft is regenerated once under a stricter completion target", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
    webSearchMaxRounds: 1,
  };
  const bodies = [];
  const result = await createOllamaResponse({
    request,
    config,
    requestId: "local-length-recovery",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return response(bodies.length === 1
        ? { model: "test-model", done: true, done_reason: "length", message: { role: "assistant", content: "An unfinished draft" } }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "A shorter complete answer." } });
    },
  });
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].messages[0].content, /previous draft reached the provider ceiling/i);
  assert.equal(result.outputText, "A shorter complete answer.");
});

test("Ollama completion requires an explicit successful terminal signal", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
    webSearchMaxRounds: 1,
  };
  for (const terminal of [{}, { done: true }, { done: true, done_reason: "unload" }]) {
    await assert.rejects(createOllamaResponse({
      request,
      config,
      requestId: "terminal-contract",
      fetchImpl: async () => response({ model: "test-model", ...terminal, message: { role: "assistant", content: "Looks complete" } }),
    }), (error) => error instanceof OllamaProxyError && error.code === "AI_INCOMPLETE_RESPONSE");
  }
});

test("explicit current-web mode executes a bounded learner-question fallback when the model skips its approved tool", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  let ollamaCalls = 0;
  let searchedQuery = "";
  const result = await createOllamaResponse({
    request: { ...request, webSearch: true },
    config,
    requestId: "search-not-used",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/search") {
        searchedQuery = new URL(url).searchParams.get("q");
        return response({ results: [{ title: "What changed recently in the current release", url: "https://example.org/release", content: "Recent changes make version 3 current." }] });
      }
      ollamaCalls += 1;
      return response(ollamaCalls === 1
        ? { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "A remembered latest claim" } }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "The current release is version 3 [W1]." } });
    },
  });
  assert.equal(searchedQuery, request.prompt);
  assert.equal(result.webSearch.used, true);
  assert.equal(result.sources[0].url, "https://example.org/release");
});

test("post-search evidence is compacted to the remaining synthesis context budget", async () => {
  const config = {
    ...readAiServerConfig({ AI_ENABLED: "true", WEB_SEARCH_ENABLED: "true" }),
    model: "test-model",
  };
  const maximum = publicAiConfig(config).responseProfiles.maxRequestUtf8Bytes.balanced;
  const base = {
    task: "explain",
    prompt: "What changed recently?",
    context: "",
    documentTitle: "Current changes",
    difficulty: "intermediate",
    history: [],
    conversationSummary: "",
    responseFormat: "markdown",
    responseProfile: "balanced",
    maxOutputTokens: 1_800,
    webSearch: true,
  };
  let low = 0;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const bytes = Buffer.byteLength(JSON.stringify({ ...base, context: "x".repeat(middle) }), "utf8");
    if (bytes <= maximum) low = middle;
    else high = middle - 1;
  }
  const boundaryRequest = { ...base, context: "x".repeat(low) };
  const ollamaBodies = [];
  const result = await createOllamaResponse({
    request: boundaryRequest,
    config,
    requestId: "post-search-context-fit",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        return response({
          results: Array.from({ length: 5 }, (_, index) => ({
            title: `What changed recently official result ${index + 1}`,
            url: `https://example.org/change-${index + 1}`,
            content: `Recent change evidence ${index + 1}. ${"detail ".repeat(240)}`,
          })),
        });
      }
      const body = JSON.parse(init.body);
      ollamaBodies.push(body);
      return response(ollamaBodies.length === 1
        ? {
          model: "test-model",
          done: true,
          done_reason: "stop",
          message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "What changed recently?" } } }] },
        }
        : { model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "The evidence describes a recent change [W1]." } });
    },
  });
  assert.equal(ollamaBodies.length, 2);
  const synthesisInputBytes = Buffer.byteLength(JSON.stringify({
    messages: ollamaBodies[1].messages,
    tools: ollamaBodies[1].tools || [],
    format: ollamaBodies[1].format || null,
  }), "utf8");
  assert.ok(synthesisInputBytes <= config.contextWindowTokens - boundaryRequest.maxOutputTokens - 512);
  const evidence = JSON.parse(ollamaBodies[1].messages.find((message) => message.role === "tool").content);
  assert.ok(evidence.results.length >= 1);
  assert.ok(evidence.results.some((entry) => entry.snippet.length < 1_200));
  assert.equal(result.webSearch.used, true);
  assert.equal(result.sources.length, 5);
});

test("compacted synthesis validates and returns only the exact retained web evidence", async () => {
  const config = {
    ...readAiServerConfig({
      AI_ENABLED: "true",
      WEB_SEARCH_ENABLED: "true",
      OLLAMA_CONTEXT_WINDOW_TOKENS: "8192",
      AI_MAX_OUTPUT_TOKENS: "500",
      WEB_SEARCH_MAX_RESULTS: "8",
      WEB_SEARCH_MAX_ROUNDS: "1",
    }),
    model: "test-model",
  };
  const denseResults = Array.from({ length: 8 }, (_, index) => ({
    title: `Current dense release official evidence ${index + 1} ${"title ".repeat(50)}`,
    url: `https://example.org/dense-${index + 1}`,
    content: `Current dense release evidence ${index + 1}. ${"detail ".repeat(240)}`,
  }));
  const tightRequest = {
    ...request,
    task: "flashcards",
    prompt: "What is the current dense release?",
    context: "x".repeat(1_200),
    responseFormat: "structured",
    responseProfile: "balanced",
    maxOutputTokens: 500,
    webSearch: true,
  };
  const run = async (marker) => {
    let ollamaCalls = 0;
    let retainedCount = 0;
    const output = JSON.stringify({ cards: [{ front: "What is current?", back: `The retained evidence supports this ${marker}.`, hint: null, tags: ["current"] }] });
    const result = await createOllamaResponse({
      request: tightRequest,
      config,
      requestId: `retained-evidence-${marker}`,
      fetchImpl: async (url, init) => {
        if (new URL(url).pathname === "/search") return response({ results: denseResults });
        ollamaCalls += 1;
        const body = JSON.parse(init.body);
        if (ollamaCalls === 1) {
          return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "current dense release" } } }] } });
        }
        retainedCount = JSON.parse(body.messages.find((message) => message.role === "tool").content).results.length;
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: output } });
      },
    });
    return { result, retainedCount };
  };

  const accepted = await run("[W1]");
  assert.ok(accepted.retainedCount >= 1 && accepted.retainedCount < 8, "tight synthesis did not drop trailing evidence");
  assert.equal(accepted.result.sources.length, accepted.retainedCount);
  assert.deepEqual(accepted.result.sources.map((source) => source.url), denseResults.slice(0, accepted.retainedCount).map((source) => source.url));
  await assert.rejects(run("[W8]"), (error) => error instanceof OllamaProxyError && error.code === "WEB_SEARCH_UNGROUNDED");
});

test("structured web tasks retrieve without format, then generate under schema with citations", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 2,
  };
  const ollamaBodies = [];
  const output = JSON.stringify({ cards: [{ front: "What is current?", back: "The cited release is current [W1].", hint: null, tags: ["current"] }] });
  const result = await createOllamaResponse({
    request: { ...request, task: "flashcards", responseFormat: "structured", webSearch: true },
    config,
    requestId: "structured-search",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        return response({ results: [{ title: "Official release", url: "https://example.org/release", content: "The release is current." }] });
      }
      const body = JSON.parse(init.body);
      ollamaBodies.push(body);
      if (ollamaBodies.length === 1) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "official current release" } } }] } });
      }
      if (ollamaBodies.length === 2) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Evidence is sufficient." } });
      }
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: output } });
    },
  });
  assert.equal(Array.isArray(ollamaBodies[0].tools), true);
  assert.equal(Object.hasOwn(ollamaBodies[0], "format"), false);
  assert.equal(Array.isArray(ollamaBodies[1].tools), true);
  assert.equal(Object.hasOwn(ollamaBodies[1], "format"), false);
  assert.equal(Object.hasOwn(ollamaBodies[2], "tools"), false);
  assert.equal(typeof ollamaBodies[2].format, "object");
  assert.equal(result.data.cards[0].back.includes("[W1]"), true);
  assert.equal(result.sources.length, 1);
});

test("an empty model-planned query uses one remaining round for the authorized learner question", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 2,
  };
  const webRequest = {
    ...request,
    task: "flashcards",
    prompt: "What is the official current release?",
    responseFormat: "structured",
    webSearch: true,
  };
  const queries = [];
  let ollamaCalls = 0;
  const output = JSON.stringify({ cards: [{ front: "What is current?", back: "The official release is version 3 [W1].", hint: null, tags: ["current"] }] });
  const result = await createOllamaResponse({
    request: webRequest,
    config,
    requestId: "empty-planner-query-fallback",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        const query = new URL(url).searchParams.get("q");
        queries.push(query);
        return response({ results: query === webRequest.prompt
          ? [{ title: "Official release", url: "https://example.org/release", content: "Version 3 is the official current release." }]
          : [] });
      }
      ollamaCalls += 1;
      const body = JSON.parse(init.body);
      if (ollamaCalls === 1) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "over-specific empty query" } } }] } });
      }
      assert.equal(Object.hasOwn(body, "tools"), false, "the two-round fallback did not force tool-free structured synthesis");
      assert.equal(typeof body.format, "object");
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: output } });
    },
  });
  assert.deepEqual(queries, ["over-specific empty query", webRequest.prompt]);
  assert.equal(result.webSearch.rounds, 2);
  assert.equal(result.sources.length, 1);
  assert.equal(result.data.cards[0].back.includes("[W1]"), true);
});

test("a buffered structured draft gets one citation-repair attempt before failing", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 1,
  };
  let ollamaCalls = 0;
  const result = await createOllamaResponse({
    request: { ...request, task: "flashcards", responseFormat: "structured", webSearch: true },
    config,
    requestId: "structured-grounding-recovery",
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/search") {
        return response({ results: [{ title: "Official release", url: "https://example.org/release", content: "Version 3 is current." }] });
      }
      ollamaCalls += 1;
      const body = JSON.parse(init.body);
      if (ollamaCalls === 1) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "official current release" } } }] } });
      }
      const back = ollamaCalls === 2 ? "Version 3 is current." : "Version 3 is current [W1].";
      if (ollamaCalls === 3) assert.match(body.messages[0].content, /previous draft was discarded.*\[W#\]/isu);
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: JSON.stringify({ cards: [{ front: "What is current?", back, hint: null, tags: ["current"] }] }) } });
    },
  });
  assert.equal(ollamaCalls, 3);
  assert.match(result.data.cards[0].back, /\[W1\]/u);
});

test("structured web final phase rejects a fabricated tool call when no tool is offered", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    searxngUrl: "http://127.0.0.1:8080",
    requestTimeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchTimeoutMs: 100,
    webSearchMaxResponseBytes: 100_000,
    webSearchMaxResults: 1,
    webSearchMaxRounds: 2,
  };
  let ollamaTurns = 0;
  await assert.rejects(createOllamaResponse({
    request: { ...request, task: "flashcards", responseFormat: "structured", webSearch: true },
    config,
    requestId: "structured-final-tool-rejected",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/search") {
        return response({ results: [{ title: "Official release", url: "https://example.org/release", content: "Current release evidence." }] });
      }
      ollamaTurns += 1;
      if (ollamaTurns === 1) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "official current release" } } }] } });
      }
      if (ollamaTurns === 2) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Evidence is sufficient." } });
      }
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "unauthorized extra search" } } }] } });
    },
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_TOOL_NOT_ALLOWED");
  // Four turns: search, planning, the fabricated tool call (which now earns
  // one no-tools recovery turn), and the repeat offense that fails typed.
  assert.equal(ollamaTurns, 4);
});

test("a spurious tool call on a tool-free request recovers once and answers", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
  };
  const ollamaBodies = [];
  const result = await createOllamaResponse({
    request,
    config,
    requestId: "tool-recovery",
    fetchImpl: async (url, init) => {
      ollamaBodies.push(JSON.parse(init.body));
      if (ollamaBodies.length === 1) {
        return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "spurious" } } }] } });
      }
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "Gradient descent follows the negative gradient." } });
    },
  });
  assert.equal(result.status, "completed");
  assert.match(result.outputText, /negative gradient/);
  assert.equal(ollamaBodies.length, 2, "exactly one recovery turn");
  assert.equal(Object.hasOwn(ollamaBodies[0], "tools"), false, "tool-free requests never declare tools");
  const recoverySystem = ollamaBodies[1].messages.find((message) => message.role === "system");
  assert.match(recoverySystem.content, /no tools are available/i, "the recovery turn must carry the no-tools instruction");
});

test("repeated spurious tool calls on a tool-free request fail typed", async () => {
  const config = {
    model: "test-model",
    ollamaUrl: "http://127.0.0.1:11434",
    requestTimeoutMs: 1_000,
    webSearchEnabled: false,
  };
  let turns = 0;
  await assert.rejects(createOllamaResponse({
    request,
    config,
    requestId: "tool-recovery-exhausted",
    fetchImpl: async () => {
      turns += 1;
      return response({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search_web", arguments: { query: "again" } } }] } });
    },
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_TOOL_NOT_ALLOWED");
  assert.equal(turns, 2, "one recovery turn, then the typed refusal");
});

test("server and public request budgets use the configured Ollama context window", async () => {
  const config = {
    ...readAiServerConfig({
      AI_ENABLED: "true",
      OLLAMA_CONTEXT_WINDOW_TOKENS: "10000",
      AI_MAX_OUTPUT_TOKENS: "300",
    }),
    model: "test-model",
  };
  const body = buildOllamaRequest(request, config);
  assert.equal(body.options.num_ctx, 10_000);
  let fetchCalls = 0;
  await assert.rejects(createOllamaResponse({
    request: { ...request, prompt: "x".repeat(4_000), maxOutputTokens: 300 },
    config,
    requestId: "context-limit",
    fetchImpl: async () => { fetchCalls += 1; return response({}); },
  }), (error) => error instanceof OllamaProxyError && error.code === "AI_CONTEXT_LIMIT");
  assert.equal(fetchCalls, 0);
});


test("empty strict search ranking relaxes once instead of returning nothing", () => {
  const query = "explain how transformer positional encoding rotary embeddings extrapolate context length";
  const results = [
    { title: "Rotary Embeddings explained", url: "https://example.org/rope", snippet: "How RoPE encodes positions in transformers." },
    { title: "Cooking pasta at home", url: "https://example.org/pasta", snippet: "Boil water and add salt." },
  ];
  // The verbose query fails 60% distinctive-token coverage on every result…
  assert.equal(rankPublicSearchResults(results, query, 5).length, 0);
  // …but the relaxed pass keeps the genuinely related page and still drops
  // the unrelated one.
  const relaxed = rankPublicSearchResults(results, query, 5, Date.now(), { relaxed: true });
  assert.equal(relaxed.length, 1);
  assert.match(relaxed[0].title, /Rotary/);
});

test("the model keep-alive rides every request from configuration", () => {
  const config = { model: "test-model", ollamaUrl: "http://127.0.0.1:11434", keepAlive: "2h" };
  const body = buildOllamaRequest({ task: "explain", prompt: "p", responseFormat: "markdown", responseProfile: "balanced", maxOutputTokens: 400 }, config, [{ role: "system", content: "s" }, { role: "user", content: "p" }]);
  assert.equal(body.keep_alive, "2h");
});

test("model warm-up posts one single-token request and never throws", async () => {
  const bodies = [];
  const ok = await warmUpOllamaModel({
    config: { model: "test-model", ollamaUrl: "http://127.0.0.1:11434", keepAlive: "2h" },
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url, init) => {
      bodies.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true };
    },
  });
  assert.equal(ok, true);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].url, /\/api\/chat$/);
  assert.equal(bodies[0].body.options.num_predict, 1);
  assert.equal(bodies[0].body.keep_alive, "2h");
  const failed = await warmUpOllamaModel({
    config: { model: "test-model", ollamaUrl: "http://127.0.0.1:11434" },
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async () => { throw new Error("connection refused"); },
  });
  assert.equal(failed, false, "warm-up failures degrade to false, never throw");
});
