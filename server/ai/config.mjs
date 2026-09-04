import { AI_REQUEST_CONTRACT_ID } from "../../src/lib/aiContract.js";

const DEFAULTS = Object.freeze({
  host: "0.0.0.0",
  port: 4173,
  provider: "ollama",
  model: "qwen3.5:4b",
  ollamaUrl: "http://127.0.0.1:11434",
  searxngUrl: "http://127.0.0.1:8080",
  requestTimeoutMs: 240_000,
  serviceProbeTimeoutMs: 1_500,
  bodyReadTimeoutMs: 12_000,
  maxBodyBytes: 128 * 1024,
  maxInputChars: 24_000,
  maxOutputTokens: 4_096,
  contextWindowTokens: 16_384,
  fastOutputTokens: 900,
  balancedOutputTokens: 1_800,
  deepOutputTokens: 3_200,
  streamIdleTimeoutMs: 60_000,
  streamBackpressureTimeoutMs: 15_000,
  streamHeartbeatMs: 10_000,
  streamMaxResponseBytes: 4 * 1024 * 1024,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 12,
  maxConcurrent: 2,
  maxConcurrentPerClient: 1,
  webSearchTimeoutMs: 8_000,
  webSearchMaxResults: 5,
  webSearchMaxRounds: 2,
  webSearchMaxResponseBytes: 1024 * 1024,
});

// Browser-visible request data must leave room for server-owned system
// instructions, structured schemas, tool definitions, JSON framing, and a
// tokenizer-independent safety margin. The Ollama adapter enforces both this
// request budget and the final serialized-message budget.
export const AI_CONTEXT_FRAMING_RESERVE_BYTES = 6_144;

const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const MODEL_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const readInteger = (env, name, fallback, minimum, maximum) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};

const readBoolean = (env, name, fallback = false) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false`);
};

const readAllowedOrigins = (raw = "") => {
  if (!raw.trim()) return new Set();
  return new Set(raw.split(",").map((candidate) => {
    const value = candidate.trim();
    if (value === "*") throw new Error("AI_ALLOWED_ORIGINS cannot use a wildcard");
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`AI_ALLOWED_ORIGINS contains an invalid origin: ${value}`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value.replace(/\/$/, "")) {
      throw new Error(`AI_ALLOWED_ORIGINS must contain origins only: ${value}`);
    }
    return url.origin;
  }));
};

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const isPrivateServiceHost = (hostname) => {
  const normalized = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(normalized)
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || isPrivateIpv4(normalized)
    || normalized.startsWith("[fc")
    || normalized.startsWith("[fd")
    || normalized.startsWith("[fe8")
    || normalized.startsWith("[fe9")
    || normalized.startsWith("[fea")
    || normalized.startsWith("[feb");
};

/**
 * Service URLs are server-owned and never accepted in a browser request. By
 * default they must be loopback. An explicit opt-in permits a trusted private
 * LAN host, but public Internet AI/search services remain disallowed.
 */
const readLocalServiceUrl = (raw, name, fallback, allowPrivateNetwork) => {
  const value = String(raw || fallback).trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || !["", "/"].includes(url.pathname)) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials, path, query, or fragment`);
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
  if (!loopback && (!allowPrivateNetwork || !isPrivateServiceHost(hostname))) {
    throw new Error(`${name} must use loopback unless AI_ALLOW_PRIVATE_NETWORK_SERVICES=true and the host is private`);
  }
  return url.origin;
};

/** Reads and validates server-only local AI configuration. */
export const readAiServerConfig = (env = process.env) => {
  const provider = String(env.AI_PROVIDER || DEFAULTS.provider).trim().toLowerCase();
  if (provider !== "ollama") throw new Error("AI_PROVIDER currently supports only ollama");
  const model = String(env.OLLAMA_MODEL || DEFAULTS.model).trim();
  if (!MODEL_PATTERN.test(model)) throw new Error("OLLAMA_MODEL contains unsupported characters");
  const expectedModelDigest = String(env.OLLAMA_MODEL_DIGEST || "").trim().toLowerCase();
  if (expectedModelDigest && !MODEL_DIGEST_PATTERN.test(expectedModelDigest)) throw new Error("OLLAMA_MODEL_DIGEST must be an exact 64-character lowercase SHA-256 digest");
  const allowPrivateNetworkServices = readBoolean(env, "AI_ALLOW_PRIVATE_NETWORK_SERVICES", false);
  const webSearchEnabled = readBoolean(env, "WEB_SEARCH_ENABLED", false);
  const authMode = String(env.AI_AUTH || "open").trim().toLowerCase();
  if (!["open", "pairing"].includes(authMode)) throw new Error("AI_AUTH must be open or pairing");
  // Loopback posture under pairing: "exempt" (default) trusts whoever is at
  // the serving machine itself — they can read .env anyway — while "require"
  // keeps the fully global gate for shared-machine setups.
  const authLoopback = String(env.AI_AUTH_LOOPBACK || "exempt").trim().toLowerCase();
  if (!["exempt", "require"].includes(authLoopback)) throw new Error("AI_AUTH_LOOPBACK must be exempt or require");
  const pairingCode = String(env.AI_PAIRING_CODE || "");
  if (authMode === "pairing" && pairingCode.trim().length < 8) {
    throw new Error("AI_AUTH=pairing requires AI_PAIRING_CODE with at least 8 characters");
  }
  const sessionSecret = String(env.AI_SESSION_SECRET || "").trim().toLowerCase();
  if (sessionSecret && !/^[a-f0-9]{64}$/.test(sessionSecret)) {
    throw new Error("AI_SESSION_SECRET must be a 64-character hex string (or unset for an ephemeral per-boot secret)");
  }
  const maxOutputTokens = readInteger(env, "AI_MAX_OUTPUT_TOKENS", DEFAULTS.maxOutputTokens, 128, 8_192);
  const responseProfileOutputTokens = Object.freeze({
    fast: readInteger(env, "AI_FAST_OUTPUT_TOKENS", Math.min(DEFAULTS.fastOutputTokens, maxOutputTokens), 128, maxOutputTokens),
    balanced: readInteger(env, "AI_BALANCED_OUTPUT_TOKENS", Math.min(DEFAULTS.balancedOutputTokens, maxOutputTokens), 128, maxOutputTokens),
    deep: readInteger(env, "AI_DEEP_OUTPUT_TOKENS", Math.min(DEFAULTS.deepOutputTokens, maxOutputTokens), 128, maxOutputTokens),
  });

  const config = {
    host: String(env.HOST || DEFAULTS.host).trim() || DEFAULTS.host,
    port: readInteger(env, "PORT", DEFAULTS.port, 0, 65_535),
    provider,
    model,
    expectedModelDigest,
    // Local inference is opt-in so a plain static/LAN launch cannot
    // accidentally expose compute or learner prompts.
    enabled: readBoolean(env, "AI_ENABLED", false),
    ollamaUrl: readLocalServiceUrl(env.OLLAMA_URL, "OLLAMA_URL", DEFAULTS.ollamaUrl, allowPrivateNetworkServices),
    webSearchEnabled,
    searxngUrl: readLocalServiceUrl(env.SEARXNG_URL, "SEARXNG_URL", DEFAULTS.searxngUrl, allowPrivateNetworkServices),
    allowPrivateNetworkServices,
    requestTimeoutMs: readInteger(env, "AI_REQUEST_TIMEOUT_MS", DEFAULTS.requestTimeoutMs, 1_000, 300_000),
    serviceProbeTimeoutMs: readInteger(env, "AI_SERVICE_PROBE_TIMEOUT_MS", DEFAULTS.serviceProbeTimeoutMs, 250, 10_000),
    bodyReadTimeoutMs: readInteger(env, "AI_BODY_TIMEOUT_MS", DEFAULTS.bodyReadTimeoutMs, 1_000, 30_000),
    maxBodyBytes: readInteger(env, "AI_MAX_BODY_BYTES", DEFAULTS.maxBodyBytes, 8_192, 1_048_576),
    maxInputChars: readInteger(env, "AI_MAX_INPUT_CHARS", DEFAULTS.maxInputChars, 2_000, 100_000),
    maxOutputTokens,
    responseProfileOutputTokens,
    contextWindowTokens: readInteger(env, "OLLAMA_CONTEXT_WINDOW_TOKENS", DEFAULTS.contextWindowTokens, 8_192, 262_144),
    streamIdleTimeoutMs: readInteger(env, "AI_STREAM_IDLE_TIMEOUT_MS", DEFAULTS.streamIdleTimeoutMs, 5_000, 120_000),
    streamBackpressureTimeoutMs: readInteger(env, "AI_STREAM_BACKPRESSURE_TIMEOUT_MS", DEFAULTS.streamBackpressureTimeoutMs, 1_000, 60_000),
    streamHeartbeatMs: readInteger(env, "AI_STREAM_HEARTBEAT_MS", DEFAULTS.streamHeartbeatMs, 1_000, 30_000),
    streamMaxResponseBytes: readInteger(env, "AI_STREAM_MAX_RESPONSE_BYTES", DEFAULTS.streamMaxResponseBytes, 262_144, 8 * 1024 * 1024),
    rateLimitWindowMs: readInteger(env, "AI_RATE_LIMIT_WINDOW_MS", DEFAULTS.rateLimitWindowMs, 1_000, 3_600_000),
    rateLimitMax: readInteger(env, "AI_RATE_LIMIT_MAX", DEFAULTS.rateLimitMax, 1, 1_000),
    maxConcurrent: readInteger(env, "AI_MAX_CONCURRENT", DEFAULTS.maxConcurrent, 1, 100),
    maxConcurrentPerClient: readInteger(env, "AI_MAX_CONCURRENT_PER_CLIENT", DEFAULTS.maxConcurrentPerClient, 1, 20),
    webSearchTimeoutMs: readInteger(env, "WEB_SEARCH_TIMEOUT_MS", DEFAULTS.webSearchTimeoutMs, 1_000, 30_000),
    webSearchMaxResults: readInteger(env, "WEB_SEARCH_MAX_RESULTS", DEFAULTS.webSearchMaxResults, 1, 8),
    webSearchMaxRounds: readInteger(env, "WEB_SEARCH_MAX_ROUNDS", DEFAULTS.webSearchMaxRounds, 1, 3),
    webSearchMaxResponseBytes: readInteger(env, "WEB_SEARCH_MAX_RESPONSE_BYTES", DEFAULTS.webSearchMaxResponseBytes, 16_384, 2 * 1024 * 1024),
    allowedOrigins: readAllowedOrigins(env.AI_ALLOWED_ORIGINS),
    trustProxy: readBoolean(env, "AI_TRUST_PROXY"),
    // Learner pairing (P0-5). "pairing" guards the AI/search POST endpoints
    // behind a session minted from AI_PAIRING_CODE; "open" preserves the
    // documented single-learner trusted-LAN profile.
    authMode,
    authLoopback,
    pairingCode,
    sessionSecret,
    sessionTtlHours: readInteger(env, "AI_SESSION_TTL_HOURS", 720, 1, 8_760),
    allowUnauthenticatedLan: readBoolean(env, "AI_ALLOW_UNAUTHENTICATED_LAN", false),
  };

  if (config.maxConcurrentPerClient > config.maxConcurrent) {
    throw new Error("AI_MAX_CONCURRENT_PER_CLIENT cannot exceed AI_MAX_CONCURRENT");
  }
  if (!(config.responseProfileOutputTokens.fast <= config.responseProfileOutputTokens.balanced
    && config.responseProfileOutputTokens.balanced <= config.responseProfileOutputTokens.deep)) {
    throw new Error("AI_FAST_OUTPUT_TOKENS, AI_BALANCED_OUTPUT_TOKENS, and AI_DEEP_OUTPUT_TOKENS must be ordered from smallest to largest");
  }
  if (config.maxOutputTokens + AI_CONTEXT_FRAMING_RESERVE_BYTES + 1_024 > config.contextWindowTokens) {
    throw new Error("AI_MAX_OUTPUT_TOKENS must leave room for server framing and at least 1024 bytes of learner input within OLLAMA_CONTEXT_WINDOW_TOKENS");
  }
  return Object.freeze(config);
};

export const publicAiConfig = (config, serviceStatus = {}) => ({
  enabled: config.enabled,
  // Contract identity is published unconditionally so a version-skewed
  // deployment is detectable even while AI is disabled or degraded.
  requestContract: AI_REQUEST_CONTRACT_ID,
  // The route handler appends per-request `sessionActive` when pairing is on.
  auth: { mode: config.authMode, pairEndpoint: "/api/auth/pair" },
  provider: "ollama-local",
  model: config.enabled ? config.model : null,
  unavailableReason: config.enabled ? null : "disabled_by_server",
  endpoint: "/api/ai/respond",
  streamEndpoint: "/api/ai/respond/stream",
  streamProtocol: "lumen.ai.ndjson.v1",
  service: {
    configured: config.enabled,
    reachable: config.enabled ? serviceStatus.ollamaReachable ?? null : false,
    modelInstalled: config.enabled ? serviceStatus.modelInstalled ?? null : false,
    modelIdentityRequired: Boolean(config.enabled && config.expectedModelDigest),
    modelIdentityVerified: config.enabled ? serviceStatus.modelIdentityVerified ?? null : false,
    completionCapable: config.enabled ? serviceStatus.completionCapable ?? null : false,
    toolCallingCapable: config.enabled ? serviceStatus.toolCallingCapable ?? null : false,
    thinkingCapable: config.enabled ? serviceStatus.thinkingCapable ?? null : false,
    checkedAt: serviceStatus.checkedAt || null,
  },
  webSearch: {
    configured: config.webSearchEnabled,
    reachable: config.webSearchEnabled ? serviceStatus.searxngReachable ?? null : false,
    available: Boolean(config.webSearchEnabled && serviceStatus.searxngReachable),
    macToolAvailable: Boolean(config.enabled && config.webSearchEnabled && serviceStatus.searxngReachable && serviceStatus.toolCallingCapable),
    requiresPerRequestOptIn: true,
    endpoint: "/api/local-search",
    tool: "search_web",
    maxResults: config.webSearchMaxResults,
    maxRounds: config.webSearchMaxRounds,
    maxTotalSources: 8,
  },
  supportedTasks: [
    "tutor", "explain", "socratic", "quiz", "flashcards", "interview",
    "summarize", "study_plan", "answer_feedback", "code_review",
  ],
  structuredTasks: ["quiz", "flashcards", "study_plan", "answer_feedback"],
  responseProfiles: {
    default: "balanced",
    allowed: ["fast", "balanced", "deep"],
    outputTokens: { ...config.responseProfileOutputTokens },
    maxRequestUtf8Bytes: Object.fromEntries(Object.entries(config.responseProfileOutputTokens).map(([profile, tokens]) => [
      profile,
      Math.min(
        config.maxBodyBytes - 2_048,
        config.contextWindowTokens - tokens - AI_CONTEXT_FRAMING_RESERVE_BYTES,
      ),
    ])),
    deepUsesPrivateModelThinkingWhenSupported: true,
    providerThinkingReturned: false,
  },
  limits: {
    maxInputChars: config.maxInputChars,
    maxOutputTokens: config.maxOutputTokens,
    contextWindowTokens: config.contextWindowTokens,
    maxRequestUtf8Bytes: Math.min(
      config.maxBodyBytes - 2_048,
      config.contextWindowTokens - config.responseProfileOutputTokens.balanced - AI_CONTEXT_FRAMING_RESERVE_BYTES,
    ),
    conservativeInputBytes: config.contextWindowTokens - config.responseProfileOutputTokens.balanced - 512,
    minimumRequestUtf8BytesAtMaxOutput: Math.min(
      config.maxBodyBytes - 2_048,
      config.contextWindowTokens - config.maxOutputTokens - AI_CONTEXT_FRAMING_RESERVE_BYTES,
    ),
    requestTimeoutMs: config.requestTimeoutMs,
    clientTimeoutMs: Math.min(config.requestTimeoutMs + 15_000, 315_000),
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    streamMaxResponseBytes: config.streamMaxResponseBytes,
  },
  privacy: {
    localInference: true,
    paidRemoteApisUsed: false,
    apiKeyRequired: false,
    apiKeyExposedToBrowser: false,
    responseStorage: false,
    applicationServerStorage: false,
    browserCanSelectProviderOrModel: false,
    builtInRemoteToolsEnabled: false,
    webSearchDisabledByDefaultPerRequest: true,
    serviceEndpointsExposedToBrowser: false,
    dataSentWhenRequested: [
      "learner prompt",
      "selected curriculum context",
      "document title",
      "difficulty level",
      "optional bounded conversation summary",
      "bounded conversation history",
    ],
    webSearchDisclosure: "When you explicitly enable web search for a request, model-generated search queries are sent to this server's self-hosted SearXNG service and then to the search engines configured by its operator.",
  },
  usage: {
    tokenCountsReturnedAfterRequest: true,
    costEstimateReturned: false,
    paidModelApiCost: 0,
    ordinaryInfrastructureCostsPossible: true,
  },
});

export const localServiceUrlPolicy = Object.freeze({ isPrivateServiceHost });
