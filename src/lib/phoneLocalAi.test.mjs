import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createSameOriginLocalSearchClient,
  inspectPhoneLibraryGrounding,
  inspectPhoneLocalAiRequestFit,
  inspectPhoneWebGrounding,
  inspectPhoneLocalAiCapability,
  makeDeterministicPhoneSearchPlan,
  makePhoneLocalAiAppConfig,
  PhoneLocalAiEngine,
  PhoneLocalAiError,
  PHONE_LOCAL_MODEL,
  sanitizeLocalSearchResults,
  selectCitablePhoneSources,
  selectCompletedPhoneHistory,
  validateLocalActionPlan,
  validatePhoneLocalAiRequest,
  verifyPinnedPhoneArtifacts,
} from "./phoneLocalAi.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const supportedEnvironment = (overrides = {}) => ({
  isSecureContext: true,
  Worker: class {},
  caches: {
    match: async () => new Response("cached"),
    open: async () => ({
      match: async () => new Response("cached"),
      keys: async () => [],
      delete: async () => true,
    }),
  },
  navigator: {
    gpu: { requestAdapter: async () => ({ limits: { maxStorageBufferBindingSize: 256 * 1024 * 1024 } }) },
    locks: { request: async (_name, _options, operation) => operation() },
    storage: {
      estimate: async () => ({ usage: 100, quota: 3 * 1024 ** 3 }),
      persisted: async () => true,
      persist: async () => true,
    },
    deviceMemory: 8,
  },
  ...overrides,
});

const completion = (content) => ({ choices: [{ finish_reason: "stop", message: { content } }] });
const mockEngine = (responses = []) => ({
  chat: { completions: { create: async () => completion(responses.shift() ?? "Local answer") } },
  interruptGenerate() {},
  async unload() {},
});

const mockWebLlm = ({ cached = false, engine = mockEngine(), onDelete = () => {}, onCreate = () => {} } = {}) => ({
  prebuiltAppConfig: { model_list: [] },
  hasModelInCache: async () => cached,
  deleteModelAllInfoInCache: async (modelId, config) => onDelete(modelId, config),
  CreateWebWorkerMLCEngine: async (worker, modelId, config, options) => {
    onCreate(worker, modelId, config, options);
    return engine;
  },
});

const newTestEngine = (options = {}) => new PhoneLocalAiEngine({
  artifactVerifier: async () => true,
  ...options,
});

test("capability check fails closed without a secure WebGPU environment", async () => {
  const status = await inspectPhoneLocalAiCapability({ environment: { isSecureContext: false, navigator: {}, Worker: undefined, caches: undefined } });
  assert.equal(status.supported, false);
  assert.match(status.reasons.join(" "), /HTTPS/);
  assert.match(status.reasons.join(" "), /WebGPU/);
  assert.match(status.reasons.join(" "), /Web Workers/);
  assert.match(status.reasons.join(" "), /Web Locks/);
});

test("known storage and memory shortages block a new model download", async () => {
  const environment = supportedEnvironment();
  environment.navigator.deviceMemory = 2;
  environment.navigator.storage.estimate = async () => ({ usage: 900 * 1024 ** 2, quota: 1_000 * 1024 ** 2 });
  const status = await inspectPhoneLocalAiCapability({ environment, cached: false });
  assert.equal(status.supported, false);
  assert.match(status.reasons.join(" "), /device memory/);
  assert.match(status.reasons.join(" "), /storage headroom/);
});

test("action planner accepts only the bounded answer or search schema", () => {
  assert.deepEqual(validateLocalActionPlan({ action: "answer", query: "", reason: "Stable lesson concept" }), { action: "answer", query: "", reason: "Stable lesson concept" });
  assert.deepEqual(validateLocalActionPlan('{"action":"search_web","query":"Safari 26 WebGPU support","reason":"Current browser support can change"}'), {
    action: "search_web",
    query: "Safari 26 WebGPU support",
    reason: "Current browser support can change",
  });
  assert.throws(() => validateLocalActionPlan({ action: "open_url", query: "https://evil.test", reason: "Do it" }), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_UNSUPPORTED_ACTION");
  assert.throws(() => validateLocalActionPlan({ action: "answer", query: "hidden network call", reason: "Smuggle" }), /cannot smuggle/);
  assert.throws(() => validateLocalActionPlan({ action: "search_web", query: "", reason: "Missing" }), /must include a query/);
  assert.equal(validateLocalActionPlan({ action: "search_web", query: "safe\u202Etxt", reason: "Current" }).query, "safetxt");
  assert.equal(validateLocalActionPlan({ action: "search_web", query: "left\u00adright\u3164", reason: "Current" }).query, "leftright");
  assert.equal(validateLocalActionPlan({ action: "search_web", query: `left${String.fromCodePoint(0xe0061)}right`, reason: "Current" }).query, "leftright");
  assert.equal(validateLocalActionPlan({ action: "search_web", query: "latest\tSafari\nWebGPU", reason: "Current" }).query, "latest Safari WebGPU");
  assert.equal(validateLocalActionPlan({ action: "search_web", query: "left\u009bright", reason: "Current" }).query, "leftright");
});

test("deterministic phone search proposals use only bounded sanitized gate inputs", () => {
  const longPrompt = `!engine \u202Elatest\tSafari WebGPU support ${"release ".repeat(40)}😀`;
  const proposal = makeDeterministicPhoneSearchPlan({
    prompt: longPrompt,
    retrievalReason: "The complete local library has only stale, low-confidence browser notes.",
  });
  assert.equal(proposal.action, "search_web");
  assert.equal(proposal.querySource, "deterministic_fallback");
  assert.ok(proposal.query.length <= 180);
  assert.doesNotMatch(proposal.query, /[\u202A-\u202E]/u);
  assert.doesNotMatch(proposal.query, /(^|\s)[!:]\S+/u);
  assert.doesNotMatch(proposal.query, /[\uD800-\uDBFF]$/u);
  assert.match(proposal.query, /^engine latest Safari WebGPU support/);
  assert.match(proposal.reason, /complete local library has only stale/i);

  const reasonDerived = makeDeterministicPhoneSearchPlan({
    prompt: "\u202E\u200B",
    retrievalReason: "current WebGPU browser compatibility",
  });
  assert.equal(reasonDerived.query, "current WebGPU browser compatibility");
});

test("phone model weights and WebGPU library use immutable revisions", () => {
  const appConfig = makePhoneLocalAiAppConfig({
    prebuiltAppConfig: {
      model_list: [{
        model_id: PHONE_LOCAL_MODEL.id,
        model: "https://huggingface.co/example/main",
        model_lib: "https://raw.githubusercontent.com/example/main/model.wasm",
      }],
    },
  });
  const record = appConfig.model_list[0];
  assert.match(record.model, new RegExp(PHONE_LOCAL_MODEL.modelRevision));
  assert.match(record.model_lib, new RegExp(PHONE_LOCAL_MODEL.modelLibraryRevision));
  assert.equal(appConfig.model_list.length, 1);
  assert.equal(appConfig.useIndexedDBCache, false);
  assert.match(PHONE_LOCAL_MODEL.verifiedArtifactHashes.config, /^sha256-/);
  assert.match(PHONE_LOCAL_MODEL.verifiedArtifactHashes.modelLibrary, /^sha256-/);
  assert.match(PHONE_LOCAL_MODEL.verifiedArtifactHashes.tokenizer, /^sha256-/);
  assert.doesNotMatch(record.model, /\/main\/?$/);
  assert.doesNotMatch(record.model_lib, /\/main\//);
});

test("declared, locked, and installed WebLLM versions match the reviewed runtime", async () => {
  const [manifest, lockfile, installed] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../node_modules/@mlc-ai/web-llm/package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.dependencies["@mlc-ai/web-llm"], PHONE_LOCAL_MODEL.webLlmVersion);
  assert.equal(lockfile.packages["node_modules/@mlc-ai/web-llm"].version, PHONE_LOCAL_MODEL.webLlmVersion);
  assert.equal(installed.version, PHONE_LOCAL_MODEL.webLlmVersion);
});

test("pinned phone artifacts are SHA-256 verified before entering named caches", async () => {
  const body = new TextEncoder().encode("verified phone artifact");
  const integrity = `sha256-${createHash("sha256").update(body).digest("base64")}`;
  let stored = null;
  let fetchCalls = 0;
  let deletes = 0;
  const cache = {
    match: async () => stored?.clone(),
    put: async (_url, response) => { stored = response.clone(); },
    delete: async () => { deletes += 1; stored = null; return true; },
  };
  const environment = {
    crypto: globalThis.crypto,
    caches: { open: async () => cache },
  };
  const artifacts = [{ cacheName: "webllm/wasm", url: "https://models.example/pinned.wasm", integrity, maximumBytes: 1_024 }];
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response(body, { status: 200 });
  };

  assert.equal(await verifyPinnedPhoneArtifacts({ environment, fetchImpl, artifacts }), true);
  assert.equal(fetchCalls, 1);
  assert.ok(stored);
  assert.equal(await verifyPinnedPhoneArtifacts({ environment, fetchImpl, artifacts }), true);
  assert.equal(fetchCalls, 1, "a verified cached artifact was fetched again");

  stored = new Response("tampered", { status: 200 });
  await assert.rejects(
    verifyPinnedPhoneArtifacts({ environment, fetchImpl, artifacts }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_ARTIFACT_INTEGRITY_FAILED",
  );
  assert.equal(deletes, 1);
  assert.equal(stored, null);
});

test("pinned Hugging Face artifacts allow only the expected immutable cache redirect", async () => {
  const body = new TextEncoder().encode("redirected verified artifact");
  const integrity = `sha256-${createHash("sha256").update(body).digest("base64")}`;
  const revision = "2a37b0a5ecb622d51ddc2fac74de0b95872affd7";
  const requestedUrl = `https://huggingface.co/mlc-ai/test-model/resolve/${revision}/tokenizer.json`;
  const finalUrl = `https://huggingface.co/api/resolve-cache/models/mlc-ai/test-model/${revision}/tokenizer.json?etag=pinned`;
  const cache = { match: async () => undefined, put: async () => {}, delete: async () => true };
  const environment = { crypto: globalThis.crypto, caches: { open: async () => cache } };
  const artifacts = [{ cacheName: "webllm/model", url: requestedUrl, integrity, maximumBytes: 1_024 }];
  let fetchOptions;
  const redirectedResponse = new Response(body, { status: 200 });
  Object.defineProperties(redirectedResponse, {
    redirected: { value: true },
    url: { value: finalUrl },
  });
  assert.equal(await verifyPinnedPhoneArtifacts({
    environment,
    artifacts,
    fetchImpl: async (_url, options) => { fetchOptions = options; return redirectedResponse; },
  }), true);
  assert.equal(fetchOptions.redirect, "follow");

  const hostileResponse = new Response(body, { status: 200 });
  Object.defineProperties(hostileResponse, {
    redirected: { value: true },
    url: { value: `https://models.example/api/resolve-cache/models/mlc-ai/test-model/${revision}/tokenizer.json` },
  });
  await assert.rejects(
    verifyPinnedPhoneArtifacts({ environment, artifacts, fetchImpl: async () => hostileResponse }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_ARTIFACT_REDIRECT_BLOCKED",
  );
});

test("artifact verification cancels a chunked body immediately at its byte boundary", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= 100) controller.enqueue(new Uint8Array(16));
      else controller.close();
    },
    cancel() { cancelled = true; },
  });
  const environment = {
    crypto: globalThis.crypto,
    caches: { open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => true }) },
  };
  const artifacts = [{
    cacheName: "webllm/model",
    url: "https://models.example/pinned.bin",
    integrity: "sha256-invalid",
    maximumBytes: 16,
  }];
  await assert.rejects(
    verifyPinnedPhoneArtifacts({ environment, artifacts, fetchImpl: async () => new Response(stream, { status: 200 }) }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_ARTIFACT_TOO_LARGE",
  );
  assert.equal(cancelled, true);
  assert.ok(pulls < 10, `the verifier consumed ${pulls} chunks before cancelling`);
});

test("cancelling cached artifact verification preserves the valid cache entry", async () => {
  const controller = new AbortController();
  let streamController;
  let cancelled = 0;
  let deleted = 0;
  const stream = new ReadableStream({
    start(value) {
      streamController = value;
      value.enqueue(new TextEncoder().encode("first chunk"));
    },
    pull() { return new Promise(() => {}); },
    cancel() { cancelled += 1; },
  });
  const cache = {
    match: async () => new Response(stream, { status: 200 }),
    delete: async () => { deleted += 1; return true; },
  };
  const environment = { crypto: globalThis.crypto, caches: { open: async () => cache } };
  const artifacts = [{
    cacheName: "webllm/model",
    url: "https://models.example/pinned.bin",
    integrity: "sha256-not-reached",
    maximumBytes: 1_024,
  }];
  const verification = verifyPinnedPhoneArtifacts({ environment, artifacts, signal: controller.signal, fetchImpl: async () => { throw new Error("not expected"); } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(verification, (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED");
  assert.equal(cancelled, 1);
  assert.equal(deleted, 0);
  assert.ok(streamController);
});

test("phone request preserves supported learning tasks while enforcing its small context", () => {
  const request = validatePhoneLocalAiRequest({ task: "flashcards", prompt: "Create cards", responseFormat: "structured", context: "Gradient descent" });
  assert.equal(request.task, "flashcards");
  assert.equal(request.maxOutputTokens, 512);
  assert.throws(() => validatePhoneLocalAiRequest({ task: "flashcards", prompt: "x".repeat(4_001), responseFormat: "structured" }), /exceeds/);
  assert.throws(() => validatePhoneLocalAiRequest({ task: "interview", prompt: "Ask me", responseFormat: "structured" }), /Structured output is unavailable/);
});

test("phone readiness measures canonical UTF-8 bytes instead of character count", () => {
  const oversizedUnicode = {
    task: "explain",
    prompt: "😀".repeat(800),
    documentTitle: "General AI/ML question",
    maxOutputTokens: 640,
  };
  assert.ok(oversizedUnicode.prompt.length < 1_800, "fixture no longer demonstrates the UTF-16/UTF-8 mismatch");
  const completionFit = inspectPhoneLocalAiRequestFit(oversizedUnicode);
  assert.equal(completionFit.fits, false);
  assert.equal(completionFit.stage, "completion");
  assert.ok(completionFit.inputBytes > completionFit.inputByteBudget);
  assert.match(completionFit.message, /UTF-8 input bytes/);

  const compactAscii = inspectPhoneLocalAiRequestFit({
    ...oversizedUnicode,
    prompt: "Explain stochastic gradient descent in one short example.",
    maxOutputTokens: 384,
  }, { allowSearchPlanning: true });
  assert.equal(compactAscii.fits, true);
});

test("UTF-8 preflight rejects an impossible completion before loading the model", async () => {
  let runtimeImports = 0;
  const engine = newTestEngine({
    importWebLlm: async () => { runtimeImports += 1; return mockWebLlm({ cached: true }); },
    environment: supportedEnvironment(),
    storage: memoryStorage(),
  });
  const request = validatePhoneLocalAiRequest({
    task: "explain",
    prompt: "😀".repeat(800),
    documentTitle: "General AI/ML question",
    maxOutputTokens: 640,
  });
  await assert.rejects(
    engine.complete(request),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CONTEXT_LIMIT" && /UTF-8 input bytes/.test(error.message),
  );
  assert.equal(runtimeImports, 0, "an impossible byte-budgeted request loaded the WebLLM runtime");
});

test("web fallback reserves one fitted result before any exact query can leave", async () => {
  const blockedPayload = { task: "explain", prompt: "a".repeat(1_600), maxOutputTokens: 768 };
  const blockedFit = inspectPhoneLocalAiRequestFit(blockedPayload, { allowSearchPlanning: true });
  assert.equal(blockedFit.fits, false);
  assert.equal(blockedFit.stage, "search_completion");

  let generationCalls = 0;
  let searchCalls = 0;
  const local = mockEngine();
  local.chat.completions.create = async (options) => {
    generationCalls += 1;
    if (options.response_format) return completion(JSON.stringify({ action: "search_web", query: "current release", reason: "Current information" }));
    return completion("Current answer [W1].");
  };
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    searchClient: async () => {
      searchCalls += 1;
      return [{
        title: "T".repeat(200),
        url: "https://example.com/release",
        snippet: "Evidence ".repeat(125),
        source: "Publisher".repeat(12),
        publishedAt: "2026-09-01".repeat(7),
      }];
    },
  });
  engine.engine = local;
  await assert.rejects(
    engine.prepareResponse(blockedPayload, { allowSearchPlanning: true }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CONTEXT_LIMIT",
  );
  assert.equal(generationCalls, 0, "an impossible post-search request reached the planner");
  assert.equal(searchCalls, 0, "an impossible post-search request sent a query");

  const allowedPayload = { ...blockedPayload, prompt: "a".repeat(1_500) };
  assert.equal(inspectPhoneLocalAiRequestFit(allowedPayload, { allowSearchPlanning: true }).fits, true);
  const proposal = await engine.prepareResponse(allowedPayload, { allowSearchPlanning: true });
  assert.equal(searchCalls, 0, "planning sent the query before exact approval");
  const completed = await engine.continueAfterSearch(proposal.search.id, { consent: true });
  assert.equal(searchCalls, 1);
  assert.equal(completed.outputText, "Current answer [W1].");
  assert.deepEqual(completed.contextFit.citedEvidenceIndexes, [1]);
});

test("selected library grounding reserves real excerpt evidence, not only an S label", async () => {
  const header = `[S1] ${"T".repeat(200)}\n`;
  const context = `${header}${"e".repeat(1_000)}`;
  const payload = {
    task: "explain",
    prompt: "a".repeat(1_650),
    context,
    contextRanges: [{ id: "long-source", start: 0, evidenceStart: header.length, end: context.length }],
    documentTitle: "T".repeat(200),
    maxOutputTokens: 768,
  };
  const fit = inspectPhoneLocalAiRequestFit(payload);
  assert.equal(fit.fits, false);
  assert.equal(fit.stage, "library_completion");

  let runtimeImports = 0;
  const engine = newTestEngine({
    importWebLlm: async () => { runtimeImports += 1; return mockWebLlm({ cached: true }); },
    environment: supportedEnvironment(),
    storage: memoryStorage(),
  });
  await assert.rejects(
    engine.complete(validatePhoneLocalAiRequest(payload)),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CONTEXT_LIMIT" && /verifiable excerpt/.test(error.message),
  );
  assert.equal(runtimeImports, 0);

  const libraryFirstPreview = inspectPhoneLocalAiRequestFit({
    task: "explain",
    prompt: "a".repeat(1_618),
    documentTitle: "General AI/ML question",
    maxOutputTokens: 768,
  }, { reserveLibraryEvidence: true });
  assert.equal(libraryFirstPreview.fits, false, "Library-first enabled a prompt that cannot retain even one future source excerpt");
  assert.equal(libraryFirstPreview.stage, "library_completion");

  const combinedFit = inspectPhoneLocalAiRequestFit({
    ...payload,
    prompt: "P".repeat(1_127),
  }, { allowSearchPlanning: true });
  assert.equal(combinedFit.fits, false, "web preflight measured source and web reserves separately instead of together");
  assert.equal(combinedFit.stage, "search_completion");
});

test("library grounding accepts only fitted source labels outside code", () => {
  const sourceUsage = [
    { citationNumber: 1, labelSupplied: true, charactersUsed: 120 },
    { citationNumber: 2, labelSupplied: false, charactersUsed: 1 },
  ];
  const valid = inspectPhoneLibraryGrounding({
    outputText: "The update follows the negative gradient [S1].\n\n`example [S2]`\n\n```text\n[S9]\n```",
    sourceUsage,
  });
  assert.equal(valid.grounded, true);
  assert.deepEqual(valid.citedSourceIndexes, [1]);
  assert.deepEqual(valid.invalidSourceLabels, []);
  assert.deepEqual(valid.suppliedSourceIndexes, [1], "a range truncated inside the S2 label became citable");

  const invented = inspectPhoneLibraryGrounding({ outputText: "Unsupported claim [S2].", sourceUsage });
  assert.equal(invented.grounded, false);
  assert.deepEqual(invented.invalidSourceLabels, ["[S2]"]);

  const structured = inspectPhoneLibraryGrounding({
    data: { cards: [{ front: "Update rule", back: "Move opposite the gradient [S1].", hint: null, tags: [] }] },
    sourceUsage,
  });
  assert.equal(structured.grounded, true);
  assert.deepEqual(structured.citedSourceIndexes, [1]);

  const sources = [{ id: "first" }, { id: "second" }];
  assert.deepEqual(selectCitablePhoneSources(sources, [
    { id: "first", labelSupplied: true, charactersUsed: 120 },
    { id: "second", labelSupplied: false, charactersUsed: 1 },
  ]), [{ id: "first", citationNumber: 1 }], "the UI source map included a range whose label was cut off");
  assert.deepEqual(selectCitablePhoneSources(sources, [
    { id: "first", citationNumber: 1, labelSupplied: false, charactersUsed: 0 },
    { id: "second", citationNumber: 2, labelSupplied: true, charactersUsed: 80 },
  ]), [{ id: "second", citationNumber: 2 }], "filtering renumbered a surviving later source");
});

test("web grounding requires explicit fitted W labels and ignores numeric indexing/code", () => {
  const ordinaryIndexing = inspectPhoneWebGrounding({
    outputText: "Tensor indexing x[1] selects the second element. `example [W1]`\n\n```text\n[W1]\n```",
    evidenceCount: 1,
  });
  assert.equal(ordinaryIndexing.grounded, false);
  assert.deepEqual(ordinaryIndexing.citedEvidenceIndexes, []);
  assert.deepEqual(ordinaryIndexing.invalidWebLabels, []);

  const grounded = inspectPhoneWebGrounding({ outputText: "The current release supports it [W1].", evidenceCount: 1 });
  assert.equal(grounded.grounded, true);
  assert.deepEqual(grounded.citedEvidenceIndexes, [1]);

  const unresolved = inspectPhoneWebGrounding({ outputText: "Unsupported current claim [W99].", evidenceCount: 1 });
  assert.equal(unresolved.grounded, false);
  assert.deepEqual(unresolved.invalidWebLabels, ["[W99]"]);
});

test("planner remeasures JSON-escaped context inside its byte-safe window", async () => {
  let captured;
  const local = mockEngine();
  local.chat.completions.create = async (options) => {
    captured = options;
    return completion(JSON.stringify({ action: "answer", query: "", reason: "Stable lesson question" }));
  };
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
  });
  engine.engine = local;
  const request = validatePhoneLocalAiRequest({
    task: "explain",
    prompt: "a".repeat(1_000),
    context: "\"".repeat(3_000),
  });
  const plan = await engine.plan(request);
  const bytes = captured.messages.reduce((total, message) => total + new TextEncoder().encode(message.content).byteLength + 16, 0);
  assert.ok(bytes <= PHONE_LOCAL_MODEL.contextWindowTokens - 128 - 512);
  assert.equal(plan.action, "answer");
});

test("a gated phone web fallback cannot be vetoed by an answer or malformed local plan", async () => {
  const plannerOutputs = [
    JSON.stringify({ action: "answer", query: "", reason: "The small model thinks it can answer" }),
    "not valid planner JSON",
  ];
  let modelCalls = 0;
  let searchCalls = 0;
  let idNumber = 0;
  const local = mockEngine();
  local.chat.completions.create = async () => {
    modelCalls += 1;
    return completion(plannerOutputs.shift());
  };
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    createId: () => `deterministic-${++idNumber}`,
    searchClient: async () => { searchCalls += 1; return []; },
  });
  engine.engine = local;
  engine.state = "ready";
  const payload = { task: "tutor", prompt: "What is the latest Safari WebGPU support?" };
  const options = {
    allowSearchPlanning: true,
    webFallbackReason: "The full-library evidence is time-sensitive and low confidence.",
  };

  const answerVeto = await engine.prepareResponse(payload, options);
  assert.equal(answerVeto.status, "search_consent_required");
  assert.equal(answerVeto.search.query, payload.prompt);
  assert.equal(answerVeto.search.querySource, "deterministic_fallback");
  assert.match(answerVeto.search.reason, /time-sensitive and low confidence/i);
  assert.equal(searchCalls, 0, "a fallback query was sent before exact-query approval");
  await engine.continueAfterSearch(answerVeto.search.id, { consent: false });

  const malformedPlan = await engine.prepareResponse(payload, options);
  assert.equal(malformedPlan.status, "search_consent_required");
  assert.notEqual(malformedPlan.search.id, answerVeto.search.id, "retry reused the consumed proposal identity");
  assert.equal(malformedPlan.search.query, payload.prompt);
  assert.equal(malformedPlan.search.querySource, "deterministic_fallback");
  assert.equal(modelCalls, 2, "the invalid planner path spent an extra generation round");
  assert.equal(searchCalls, 0, "decline or planner failure contacted the search service");
});

test("without the external fallback gate the phone engine answers locally and never proposes search", async () => {
  let searchCalls = 0;
  const local = mockEngine(["Local stable-knowledge answer"]);
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    searchClient: async () => { searchCalls += 1; return []; },
  });
  engine.engine = local;
  engine.state = "ready";
  const result = await engine.prepareResponse(
    { task: "tutor", prompt: "Explain gradient descent" },
    { allowSearchPlanning: false, webFallbackReason: "This value must be ignored while the gate is off." },
  );
  assert.equal(result.status, "completed");
  assert.equal(result.outputText, "Local stable-knowledge answer");
  assert.equal(searchCalls, 0);
});

test("outbound phone history keeps only complete learner-assistant turns", () => {
  const history = [
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "U2 failed" },
  ];
  assert.deepEqual(selectCompletedPhoneHistory(history, 2), [
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
  ]);
  history.push({ role: "user", content: "U3" }, { role: "assistant", content: "A3" });
  assert.deepEqual(selectCompletedPhoneHistory(history, 2), [
    { role: "user", content: "U3" },
    { role: "assistant", content: "A3" },
  ]);
});

test("uncached model cannot load before explicit persisted download consent", async () => {
  let created = 0;
  const storage = memoryStorage();
  const webllm = mockWebLlm({ cached: false, onCreate: () => { created += 1; } });
  const engine = newTestEngine({
    importWebLlm: async () => webllm,
    workerFactory: () => ({ terminate() {} }),
    environment: supportedEnvironment(),
    storage,
  });
  await assert.rejects(engine.load(), (error) => error.code === "LOCAL_AI_DOWNLOAD_CONSENT_REQUIRED");
  assert.equal(created, 0);
  engine.grantDownloadConsent();
  assert.equal(engine.hasDownloadConsent(), true);
  const savedConsent = JSON.parse([...storage.values.values()][0]);
  assert.equal(savedConsent.version, 2);
  assert.equal(savedConsent.modelRevision, PHONE_LOCAL_MODEL.modelRevision);
  assert.equal(savedConsent.modelLibraryRevision, PHONE_LOCAL_MODEL.modelLibraryRevision);
  assert.equal(savedConsent.approximateDownloadBytes, PHONE_LOCAL_MODEL.approximateDownloadBytes);
  await engine.load();
  assert.equal(created, 1);
  assert.equal(engine.state, "ready");
});

test("cancelling model load aborts pinned-artifact verification", async () => {
  let verificationStarted;
  const started = new Promise((resolve) => { verificationStarted = resolve; });
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true }),
    workerFactory: () => ({ terminate() {} }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    artifactVerifier: ({ signal }) => new Promise((resolve, reject) => {
      verificationStarted();
      signal.addEventListener("abort", () => reject(new PhoneLocalAiError("LOCAL_AI_CANCELLED", "verification cancelled")), { once: true });
    }),
  });
  const loading = engine.load();
  await started;
  engine.cancel();
  await assert.rejects(loading, (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED");
  assert.equal(engine.state, "idle");
});

test("old download approval is not reused and failed revocation fails closed", async () => {
  const storage = memoryStorage();
  storage.values.set(`lumen:phone-local-ai:download-consent:v1:${PHONE_LOCAL_MODEL.id}`, JSON.stringify({ version: 1, modelId: PHONE_LOCAL_MODEL.id }));
  const environment = supportedEnvironment();
  environment.caches.open = async () => ({ match: async () => undefined, keys: async () => [], delete: async () => true });
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: false }),
    environment,
    storage,
  });
  assert.equal(engine.hasDownloadConsent(), false, "a prior artifact revision remained authorized");
  engine.grantDownloadConsent();
  const originalRemove = storage.removeItem;
  storage.removeItem = () => { throw new Error("storage is blocked"); };
  await assert.rejects(engine.deleteModel(), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CONSENT_NOT_REMOVED" && error.details?.modelFilesRemoved === true);
  assert.equal(engine.hasDownloadConsent(), true, "failed revocation was reported as cleared");
  storage.removeItem = originalRemove;
});

test("cache readiness checks WebLLM's named caches rather than unrelated global matches", async () => {
  const environment = supportedEnvironment();
  environment.caches.match = async () => new Response("misleading unrelated cache hit");
  environment.caches.open = async (cacheName) => ({
    match: async (url) => cacheName === "webllm/model" && String(url).endsWith("tokenizer.json")
      ? undefined
      : new Response("cached"),
    keys: async () => [],
    delete: async () => true,
  });
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true }),
    environment,
    storage: memoryStorage(),
  });
  assert.equal(await engine.isModelCached(), false);
});

test("worker loading reports bounded progress and model deletion clears named caches and consent", async () => {
  const storage = memoryStorage();
  const deleted = [];
  const deletedUrls = new Set();
  let configSeen;
  const environment = supportedEnvironment();
  environment.caches.open = async (cacheName) => ({
    match: async (key) => deletedUrls.has(typeof key === "string" ? key : key.url) ? undefined : new Response("cached"),
    keys: async () => (cacheName === "webllm/model" ? [
      new Request(`https://huggingface.co/mlc-ai/${PHONE_LOCAL_MODEL.id}/resolve/${PHONE_LOCAL_MODEL.modelRevision}/tensor-cache.json`),
      new Request(`https://huggingface.co/mlc-ai/${PHONE_LOCAL_MODEL.id}/resolve/main/orphan-shard.bin`),
      new Request("https://huggingface.co/unrelated/model.bin"),
    ] : []).filter((key) => !deletedUrls.has(typeof key === "string" ? key : key.url)),
    delete: async (key) => {
      const url = typeof key === "string" ? key : key.url;
      deleted.push({ cacheName, url });
      deletedUrls.add(url);
      return true;
    },
  });
  const webllm = mockWebLlm({
    cached: true,
    onCreate: (_worker, modelId, config) => {
      configSeen = config;
      assert.equal(modelId, PHONE_LOCAL_MODEL.id);
      config.initProgressCallback({ progress: 5, text: "Loading\u0000 model", timeElapsed: -4 });
    },
  });
  webllm.prebuiltAppConfig.model_list = [{
    model_id: PHONE_LOCAL_MODEL.id,
    model: `https://huggingface.co/mlc-ai/${PHONE_LOCAL_MODEL.id}`,
    model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/legacy.wasm",
  }];
  let upstreamDeleteCalls = 0;
  webllm.deleteModelAllInfoInCache = async () => { upstreamDeleteCalls += 1; throw new Error("must not fetch during deletion"); };
  const worker = { terminated: 0, terminate() { this.terminated += 1; } };
  const engine = newTestEngine({ importWebLlm: async () => webllm, workerFactory: () => worker, environment, storage });
  engine.grantDownloadConsent();
  const progress = [];
  await engine.load({ onProgress: (value) => progress.push(value) });
  assert.equal(progress[0].progress, 1);
  assert.equal(progress[0].text.includes("\u0000"), false);
  assert.equal(configSeen.appConfig.useIndexedDBCache, false);
  await engine.deleteModel();
  assert.equal(upstreamDeleteCalls, 0, "deletion invoked WebLLM's network-capable cache helper");
  assert.ok(deleted.some((entry) => entry.cacheName === "webllm/model" && entry.url.includes(PHONE_LOCAL_MODEL.modelRevision)));
  assert.ok(deleted.some((entry) => entry.cacheName === "webllm/model" && entry.url.includes("/resolve/main/")));
  assert.equal(deleted.some((entry) => entry.url.includes("unrelated/model.bin")), false);
  assert.ok(deleted.some((entry) => entry.cacheName === "webllm/config" && entry.url.includes("mlc-chat-config.json")));
  assert.ok(deleted.some((entry) => entry.cacheName === "webllm/wasm" && entry.url.endsWith(".wasm")));
  assert.equal(engine.hasDownloadConsent(), false);
  assert.equal(worker.terminated, 1);
});

test("model deletion fails visibly when owned cache entries remain", async () => {
  const pinnedKey = new Request(`https://huggingface.co/mlc-ai/${PHONE_LOCAL_MODEL.id}/resolve/${PHONE_LOCAL_MODEL.modelRevision}/tensor-cache.json`);
  const environment = supportedEnvironment();
  environment.caches.open = async (cacheName) => ({
    match: async () => undefined,
    keys: async () => cacheName === "webllm/model" ? [pinnedKey] : [],
    delete: async () => false,
  });
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: false }), environment, storage: memoryStorage() });
  await assert.rejects(engine.deleteModel(), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CACHE_DELETE_FAILED");
});

test("model deletion remains available when the WebLLM runtime import is broken", async () => {
  const storage = memoryStorage();
  const pinnedUrl = `https://huggingface.co/mlc-ai/${PHONE_LOCAL_MODEL.id}/resolve/${PHONE_LOCAL_MODEL.modelRevision}/tensor-cache.json`;
  const entries = new Map([["webllm/model", new Set([pinnedUrl])]]);
  const environment = supportedEnvironment();
  environment.caches.open = async (cacheName) => ({
    keys: async () => [...(entries.get(cacheName) || [])].map((url) => new Request(url)),
    match: async (key) => (entries.get(cacheName)?.has(typeof key === "string" ? key : key.url) ? new Response("cached") : undefined),
    delete: async (key) => entries.get(cacheName)?.delete(typeof key === "string" ? key : key.url) || false,
  });
  const engine = newTestEngine({
    importWebLlm: async () => { throw new Error("runtime chunk unavailable"); },
    environment,
    storage,
  });
  engine.grantDownloadConsent();
  assert.equal(await engine.deleteModel(), true);
  assert.equal(entries.get("webllm/model").size, 0);
  assert.equal(engine.hasDownloadConsent(), false);
});

test("cross-tab deletion aborts an in-flight model download before cache repopulation", async () => {
  const storage = memoryStorage();
  const cacheEntries = new Map();
  const channels = new Set();
  class SharedBroadcastChannel {
    constructor() { this.listeners = new Set(); channels.add(this); }
    addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
    postMessage(data) {
      for (const channel of channels) {
        queueMicrotask(() => channel.listeners.forEach((listener) => listener({ data })));
      }
    }
  }
  let lockTail = Promise.resolve();
  const locks = {
    request(_name, _options, operation) {
      const run = lockTail.catch(() => {}).then(operation);
      lockTail = run.catch(() => {});
      return run;
    },
  };
  const environment = supportedEnvironment({ BroadcastChannel: SharedBroadcastChannel });
  environment.navigator.locks = locks;
  environment.caches.open = async (cacheName) => ({
    keys: async () => [...(cacheEntries.get(cacheName) || [])].map((url) => new Request(url)),
    match: async (key) => (cacheEntries.get(cacheName)?.has(typeof key === "string" ? key : key.url) ? new Response("cached") : undefined),
    put: async (key) => {
      const values = cacheEntries.get(cacheName) || new Set();
      values.add(typeof key === "string" ? key : key.url);
      cacheEntries.set(cacheName, values);
    },
    delete: async (key) => cacheEntries.get(cacheName)?.delete(typeof key === "string" ? key : key.url) || false,
  });
  let verificationStarted;
  const started = new Promise((resolve) => { verificationStarted = resolve; });
  const first = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: false }),
    environment,
    storage,
    artifactVerifier: ({ signal }) => new Promise((resolve, reject) => {
      verificationStarted();
      signal.addEventListener("abort", () => reject(new PhoneLocalAiError("LOCAL_AI_CANCELLED", "cross-tab deletion")), { once: true });
    }),
  });
  const second = newTestEngine({
    importWebLlm: async () => { throw new Error("deletion must not import WebLLM"); },
    environment,
    storage,
  });
  first.grantDownloadConsent();
  const loading = first.load();
  await started;
  const deleting = second.deleteModel();
  await assert.rejects(loading, (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED");
  assert.equal(await deleting, true);
  assert.equal(first.state, "idle");
  assert.equal(first.hasDownloadConsent(), false);
  assert.equal([...cacheEntries.values()].reduce((total, entries) => total + entries.size, 0), 0);
});

test("concurrent release is single-flight and inspection waits for a stable state", async () => {
  let release;
  let unloadCalls = 0;
  const local = mockEngine();
  local.unload = async () => { unloadCalls += 1; await new Promise((resolve) => { release = resolve; }); };
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    workerFactory: () => ({ terminate() {} }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
  });
  engine.engine = local;
  engine.state = "ready";
  const first = engine.unload();
  const second = engine.unload();
  assert.equal(engine.state, "releasing");
  assert.equal(unloadCalls, 1);
  let inspected = false;
  const inspection = engine.inspect().then((value) => { inspected = true; return value; });
  await Promise.resolve();
  assert.equal(inspected, false);
  release();
  await Promise.all([first, second]);
  const status = await inspection;
  assert.equal(status.state, "idle");
  assert.equal(status.loaded, false);
  assert.equal(unloadCalls, 1);
});

test("release terminates a worker when graceful WebLLM unload never settles", async () => {
  const local = mockEngine();
  local.unload = () => new Promise(() => {});
  const worker = { terminated: 0, terminate() { this.terminated += 1; } };
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    workerFactory: () => worker,
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    unloadGraceMs: 5,
  });
  engine.engine = local;
  engine.worker = worker;
  engine.state = "ready";
  await engine.unload();
  assert.equal(worker.terminated, 1);
  assert.equal(engine.state, "idle");
  assert.equal(engine.engine, null);
});

test("cancelling worker creation rejects a pending load and terminates the worker", async () => {
  let started;
  const creationStarted = new Promise((resolve) => { started = resolve; });
  const webllm = mockWebLlm({ cached: true });
  webllm.CreateWebWorkerMLCEngine = () => { started(); return new Promise(() => {}); };
  const worker = { terminated: 0, terminate() { this.terminated += 1; } };
  const engine = newTestEngine({ importWebLlm: async () => webllm, workerFactory: () => worker, environment: supportedEnvironment(), storage: memoryStorage() });
  const loading = engine.load();
  await creationStarted;
  engine.cancel();
  await assert.rejects(loading, (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED");
  assert.ok(worker.terminated >= 1);
  assert.equal(engine.state, "idle");
});

test("an aborted generation interrupts WebLLM and does not produce a partial answer", async () => {
  let rejectCompletion;
  let interrupts = 0;
  const local = mockEngine();
  local.chat.completions.create = () => new Promise((_resolve, reject) => { rejectCompletion = reject; });
  local.interruptGenerate = () => { interrupts += 1; rejectCompletion?.(new Error("interrupted")); };
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  const controller = new AbortController();
  const generating = engine.complete(validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain" }), { signal: controller.signal });
  await Promise.resolve();
  controller.abort(new Error("learner cancelled"));
  await assert.rejects(generating);
  assert.equal(interrupts, 1);
});

test("cancellation terminates an unresponsive generation worker", async () => {
  let interrupts = 0;
  const local = mockEngine();
  local.chat.completions.create = () => new Promise(() => {});
  local.interruptGenerate = () => { interrupts += 1; };
  const worker = { terminated: 0, terminate() { this.terminated += 1; } };
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  engine.worker = worker;
  engine.state = "ready";
  const lifecycle = [];
  const unsubscribe = engine.subscribeLifecycle((status) => lifecycle.push(status));
  const controller = new AbortController();
  const generating = engine.complete(validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain" }), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(generating, (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED");
  assert.equal(interrupts, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(engine.state, "idle");
  assert.deepEqual(lifecycle.at(-1), { state: "idle", loaded: false });
  unsubscribe();
});

test("same-origin search sends exactly the approved query and caps sanitized evidence", async () => {
  let captured;
  const client = createSameOriginLocalSearchClient({
    locationImpl: { href: "https://lumen.test/app", origin: "https://lumen.test" },
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        ok: true,
        results: Array.from({ length: 7 }, (_, index) => ({ title: `<b>Result ${index}</b>`, url: `https://source.test/${index}`, snippet: `<script>bad()</script> Evidence ${index}` })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const results = await client("latest WebGPU support");
  assert.equal(captured.url, "/api/local-search");
  assert.equal(captured.init.credentials, "same-origin");
  assert.deepEqual(captured.body, { query: "latest WebGPU support" });
  assert.equal(Object.keys(captured.body).length, 1);
  assert.equal(results.length, 5);
  assert.equal(results[0].title, "Result 0");
  assert.equal(results[0].snippet.includes("<script>"), false);
});

test("search timeout remains active while a response body is stalled", async () => {
  const client = createSameOriginLocalSearchClient({
    locationImpl: { href: "https://lumen.test/app", origin: "https://lumen.test" },
    timeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
  await assert.rejects(client("current release"), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_SEARCH_TIMEOUT");
});

test("search evidence validation rejects active URLs and malformed server data", () => {
  assert.throws(() => sanitizeLocalSearchResults({ ok: true, results: [{ title: "Bad", url: "javascript:alert(1)", snippet: "No" }] }), /incomplete/);
  assert.throws(() => sanitizeLocalSearchResults({ ok: true, results: "not-an-array" }), /invalid response/);
});

test("model-planned search is one-shot and always requires per-search consent", async () => {
  const local = mockEngine([
    JSON.stringify({ action: "search_web", query: "current Safari WebGPU availability", reason: "Browser support changes" }),
    "Safari now supports WebGPU [W1].",
  ]);
  let idNumber = 0;
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    workerFactory: () => ({ terminate() {} }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    createId: () => `search-once-${++idNumber}`,
    now: () => 1_000,
    searchClient: async (query) => {
      assert.equal(query, "current Safari WebGPU availability");
      return [{ title: "Safari 26", url: "https://webkit.org/blog/example", snippet: "WebGPU shipped." }];
    },
  });
  engine.engine = local;
  engine.state = "ready";
  const pending = await engine.prepareResponse({ task: "tutor", prompt: "What is the latest Safari WebGPU status?" });
  assert.equal(pending.status, "search_consent_required");
  assert.equal(pending.search.query, "current Safari WebGPU availability");
  assert.equal(pending.search.querySource, "local_planner");
  const declined = await engine.continueAfterSearch(pending.search.id, { consent: false });
  assert.equal(declined.status, "search_declined");
  await assert.rejects(engine.continueAfterSearch(pending.search.id, { consent: true }), (error) => error.code === "LOCAL_SEARCH_PLAN_NOT_FOUND");

  local.chat.completions.create = async () => completion(JSON.stringify({ action: "search_web", query: "current Safari WebGPU availability", reason: "Browser support changes" }));
  const retry = await engine.prepareResponse({ task: "tutor", prompt: "Try again" });
  assert.notEqual(retry.search.id, pending.search.id, "retry did not require a fresh proposal identity");
  local.chat.completions.create = async () => completion("Safari now supports WebGPU [W1].");
  const answered = await engine.continueAfterSearch(retry.search.id, { consent: true });
  assert.equal(answered.status, "completed");
  assert.equal(answered.citations[0].url, "https://webkit.org/blog/example");
  await assert.rejects(engine.continueAfterSearch(retry.search.id, { consent: true }), /already used/);
});

test("expired or cancelled exact-query approvals send nothing and are consumed", async () => {
  let currentTime = 10_000;
  let idNumber = 0;
  let searchCalls = 0;
  const local = mockEngine();
  local.chat.completions.create = async () => completion(JSON.stringify({
    action: "answer",
    query: "",
    reason: "Planner veto",
  }));
  const engine = newTestEngine({
    importWebLlm: async () => mockWebLlm({ cached: true, engine: local }),
    environment: supportedEnvironment(),
    storage: memoryStorage(),
    now: () => currentTime,
    createId: () => `expiry-${++idNumber}`,
    searchClient: async () => { searchCalls += 1; return []; },
  });
  engine.engine = local;
  engine.state = "ready";
  const request = { task: "tutor", prompt: "What changed in the current release?" };

  const expiring = await engine.prepareResponse(request, {
    allowSearchPlanning: true,
    webFallbackReason: "The library result is time-sensitive.",
  });
  currentTime += (expiring.search.expiresInSeconds * 1_000) + 1;
  await assert.rejects(
    engine.continueAfterSearch(expiring.search.id, { consent: true }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_SEARCH_PLAN_EXPIRED",
  );
  assert.equal(searchCalls, 0, "an expired proposal contacted search");
  await assert.rejects(engine.continueAfterSearch(expiring.search.id, { consent: true }), /already used/);

  const cancellable = await engine.prepareResponse(request, {
    allowSearchPlanning: true,
    webFallbackReason: "The library result is time-sensitive.",
  });
  const controller = new AbortController();
  controller.abort(new Error("learner cancelled"));
  await assert.rejects(
    engine.continueAfterSearch(cancellable.search.id, { consent: true, signal: controller.signal }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_CANCELLED",
  );
  assert.equal(searchCalls, 0, "a cancelled approval contacted search");
  await assert.rejects(engine.continueAfterSearch(cancellable.search.id, { consent: true }), /already used/);
});

test("structured local output reuses and enforces the existing learning contract", async () => {
  const local = mockEngine([JSON.stringify({ cards: [{ front: "What is SGD?", back: "Stochastic gradient descent.", hint: null, tags: ["optimization"] }] })]);
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  const result = await engine.complete(validatePhoneLocalAiRequest({ task: "flashcards", prompt: "Create one card", responseFormat: "structured" }));
  assert.equal(result.data.cards[0].front, "What is SGD?");

  local.chat.completions.create = async () => completion(JSON.stringify({ cards: [{ front: "Missing fields" }] }));
  await assert.rejects(engine.complete(validatePhoneLocalAiRequest({ task: "flashcards", prompt: "Create one card", responseFormat: "structured" })), (error) => error.code === "LOCAL_AI_CONTRACT_ERROR");
});

test("completed library answers fail closed on missing or invented fitted citations", async () => {
  const context = "[S1] Optimization lesson\nGradient descent moves opposite the objective gradient.";
  const request = validatePhoneLocalAiRequest({
    task: "explain",
    prompt: "Explain the update rule.",
    context,
    contextRanges: [{ id: "optimization", start: 0, end: context.length }],
  });
  const local = mockEngine(["Move opposite the gradient.", "Invented attribution [S2].", "Move opposite the gradient [S1]."]);
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;

  await assert.rejects(engine.complete(request), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_LIBRARY_UNGROUNDED");
  await assert.rejects(engine.complete(request), (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_LIBRARY_INVALID_CITATION");
  const accepted = await engine.complete(request);
  assert.deepEqual(accepted.contextFit.citedSourceIndexes, [1]);
  assert.equal(accepted.outputText, "Move opposite the gradient [S1].");
});

test("valid library attribution remains token-streamed but is committed only after validation", async () => {
  const context = "[S1] Optimization lesson\nGradient descent follows the negative gradient during each optimization update.";
  const request = validatePhoneLocalAiRequest({
    task: "explain",
    prompt: "Explain briefly.",
    context,
    contextRanges: [{ id: "optimization", start: 0, end: context.length }],
  });
  const local = mockEngine();
  local.chat.completions.create = async (options) => {
    assert.equal(options.stream, true);
    return {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ finish_reason: null, delta: { content: "Grounded update " } }] };
        yield { choices: [{ finish_reason: null, delta: { content: "[S1]." } }] };
        yield { choices: [{ finish_reason: "stop", delta: {} }] };
      },
    };
  };
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  const frames = [];
  const result = await engine.complete(request, { onToken: (_token, completeText) => frames.push(completeText) });
  assert.deepEqual(frames, ["Grounded update ", "Grounded update [S1]."]);
  assert.equal(result.outputText, "Grounded update [S1].");
  assert.deepEqual(result.contextFit.citedSourceIndexes, [1]);
});

test("phone streaming rejects content or another event after its terminal signal", async () => {
  const request = validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain briefly." });
  const local = mockEngine();
  local.chat.completions.create = async () => ({
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ finish_reason: null, delta: { content: "Before terminal. " } }] };
      yield { choices: [{ finish_reason: "stop", delta: {} }] };
      yield { choices: [{ finish_reason: null, delta: { content: "Trailing content must fail." } }] };
    },
  });
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  await assert.rejects(
    engine.complete(request, { onToken() {} }),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_INCOMPLETE_RESPONSE",
  );
});

test("explicit WebLLM length stops and oversized phone context fail safely", async () => {
  const truncated = mockEngine();
  truncated.chat.completions.create = async () => ({ choices: [{ finish_reason: "length", message: { content: "unfinished" } }] });
  const truncatedEngine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: truncated }), environment: supportedEnvironment(), storage: memoryStorage() });
  truncatedEngine.engine = truncated;
  await assert.rejects(
    truncatedEngine.complete(validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain briefly" })),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_INCOMPLETE_RESPONSE",
  );
  truncated.chat.completions.create = async () => ({ choices: [{ finish_reason: "abort", message: { content: "cancelled partial" } }] });
  await assert.rejects(
    truncatedEngine.complete(validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain briefly" })),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_INCOMPLETE_RESPONSE",
  );

  let captured;
  const bounded = mockEngine();
  bounded.chat.completions.create = async (options) => {
    captured = options;
    return completion("Grounded answer [W1].");
  };
  const boundedEngine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: bounded }), environment: supportedEnvironment(), storage: memoryStorage() });
  boundedEngine.engine = bounded;
  const request = validatePhoneLocalAiRequest({ task: "explain", prompt: "Explain safely", context: "界".repeat(6_000), maxOutputTokens: 768 });
  const evidence = Array.from({ length: 5 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.org/${index}`, snippet: "據".repeat(1_000) }));
  const boundedResult = await boundedEngine.complete(request, { evidence });
  const measured = captured.messages.reduce((total, message) => total + new TextEncoder().encode(message.content).byteLength + 16, 0);
  assert.ok(measured <= PHONE_LOCAL_MODEL.contextWindowTokens - request.maxOutputTokens - 256);
  assert.equal(boundedResult.citations.length, 1);
  assert.deepEqual(boundedResult.contextFit.citedEvidenceIndexes, [1]);
  assert.equal(boundedResult.contextFit.truncated, true);
  assert.match(captured.messages.at(-1).content, /engine context truncated/);
});

test("a completed response over the mobile character ceiling is rejected rather than silently clipped", async () => {
  const local = mockEngine();
  local.chat.completions.create = async () => completion("x".repeat(40_001));
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  await assert.rejects(
    engine.complete(validatePhoneLocalAiRequest({ task: "explain", prompt: "Answer in detail" })),
    (error) => error instanceof PhoneLocalAiError && error.code === "LOCAL_AI_OUTPUT_LIMIT",
  );
});

test("context ranges preserve legitimate joiners and report actual source inclusion", async () => {
  let captured;
  const local = mockEngine();
  local.chat.completions.create = async (options) => { captured = options; return completion("Local grounded answer [S1]."); };
  const engine = newTestEngine({ importWebLlm: async () => mockWebLlm({ cached: true, engine: local }), environment: supportedEnvironment(), storage: memoryStorage() });
  engine.engine = local;
  const first = `[S1] First\na\u200Db${"界".repeat(1_500)}`;
  const separator = "\n\n";
  const second = `[S2] Second\n${"據".repeat(1_500)}`;
  const context = `${first}${separator}${second}`;
  const request = validatePhoneLocalAiRequest({
    task: "explain",
    prompt: "Explain safely",
    context,
    contextRanges: [
      { id: "first", start: 0, end: first.length },
      { id: "second", start: first.length + separator.length, end: context.length },
    ],
    maxOutputTokens: 768,
  });
  const result = await engine.complete(request);
  assert.match(captured.messages.at(-1).content, /a\u200Db/);
  assert.equal(result.contextFit.sourceUsage[0].id, "first");
  assert.ok(result.contextFit.sourceUsage[0].charactersUsed > 0);
  assert.ok(result.contextFit.sourceUsage[1].charactersUsed < result.contextFit.sourceUsage[1].charactersProvided);
});
