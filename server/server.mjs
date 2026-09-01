import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publicAiConfig, readAiServerConfig } from "./ai/config.mjs";
import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";
import { validateAiRequest } from "./ai/contracts.mjs";
import { createOllamaResponse, createOllamaStreamingResponse, OllamaProxyError, probeInstalledModelIdentity, probeLocalAiServices } from "./ai/ollama.mjs";
import { searchSearxng, validateSearchQuery, WebSearchError } from "./ai/searxng.mjs";
import { AI_STREAM_PROTOCOL, createAnswerApproach, createNdjsonWriter } from "./ai/streaming.mjs";

const ROOT_DIRECTORY = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_DIST_DIRECTORY = resolve(ROOT_DIRECTORY, "dist");
const API_PREFIX = "/api/";

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".cer": "application/pkix-cert",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

const silentLogger = Object.freeze({ info() {}, warn() {}, error() {} });

const readTlsOptions = (env) => {
  const certFile = typeof env.TLS_CERT_FILE === "string" ? env.TLS_CERT_FILE.trim() : "";
  const keyFile = typeof env.TLS_KEY_FILE === "string" ? env.TLS_KEY_FILE.trim() : "";
  if (Boolean(certFile) !== Boolean(keyFile)) {
    throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
  }
  if (!certFile) return null;
  return {
    cert: readFileSync(resolve(certFile)),
    key: readFileSync(resolve(keyFile)),
  };
};

const log = (logger, level, event, details = {}) => {
  const method = typeof logger?.[level] === "function" ? logger[level].bind(logger) : null;
  method?.(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
};

const setCommonHeaders = (response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  // frame-ancestors is ignored in a meta CSP, so enforce it as an HTTP
  // response policy for both the app shell and consent-bearing API routes.
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
};

const sendJson = (response, status, payload, headers = {}, headOnly = false) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(headOnly ? undefined : body);
};

const errorPayload = (requestId, code, message, details) => ({
  ok: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
  requestId,
});

/**
 * Stateless learner sessions for AI_AUTH=pairing. A session token is
 * `base64url(payload).hmacSha256(payload)` carried in an HttpOnly
 * SameSite=Strict cookie; the server stores nothing, so revocation is a
 * pairing-code/secret rotation or a restart without AI_SESSION_SECRET.
 */
const SESSION_COOKIE_NAME = "lumen.ai.session";

const mintSessionToken = (secret, ttlMs) => {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() + ttlMs })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

const verifySessionToken = (secret, token) => {
  if (typeof token !== "string" || token.length > 512) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed?.v === 1 && Number.isSafeInteger(parsed.exp) && parsed.exp > Date.now();
  } catch {
    return false;
  }
};

const readSessionCookie = (request) => {
  const header = String(request.headers.cookie || "");
  if (!header || header.length > 4_096) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) return part.slice(separator + 1).trim();
  }
  return "";
};

const pairingCodesMatch = (expected, received) => {
  // Digesting both sides first makes the comparison constant-time and
  // length-independent.
  const expectedDigest = createHash("sha256").update(String(expected)).digest();
  const receivedDigest = createHash("sha256").update(String(received)).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
};

const getClientKey = (request, config) => {
  const forwarded = config.trustProxy ? request.headers["x-forwarded-for"] : "";
  const address = typeof forwarded === "string" && forwarded
    ? forwarded.split(",", 1)[0].trim()
    : request.socket.remoteAddress || "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 24);
};

const createRateLimiter = (config) => {
  const clients = new Map();
  let checks = 0;
  return (key, now = Date.now()) => {
    checks += 1;
    if (checks % 250 === 0 || clients.size > 10_000) {
      for (const [clientKey, entry] of clients) {
        if (now - entry.windowStartedAt >= config.rateLimitWindowMs) clients.delete(clientKey);
      }
    }
    const existing = clients.get(key);
    if (!existing && clients.size >= 10_000) {
      return {
        allowed: false,
        limit: config.rateLimitMax,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(config.rateLimitWindowMs / 1_000)),
        resetAt: now + config.rateLimitWindowMs,
      };
    }
    const entry = !existing || now - existing.windowStartedAt >= config.rateLimitWindowMs
      ? { windowStartedAt: now, count: 0 }
      : existing;
    entry.count += 1;
    clients.set(key, entry);
    const resetAt = entry.windowStartedAt + config.rateLimitWindowMs;
    return {
      allowed: entry.count <= config.rateLimitMax,
      limit: config.rateLimitMax,
      remaining: Math.max(0, config.rateLimitMax - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
      resetAt,
    };
  };
};

const createConcurrencyGate = (config) => {
  let active = 0;
  const activeByClient = new Map();
  return (clientKey) => {
    const clientActive = activeByClient.get(clientKey) || 0;
    if (active >= config.maxConcurrent || clientActive >= config.maxConcurrentPerClient) return null;
    active += 1;
    activeByClient.set(clientKey, clientActive + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      const next = (activeByClient.get(clientKey) || 1) - 1;
      if (next <= 0) activeByClient.delete(clientKey);
      else activeByClient.set(clientKey, next);
    };
  };
};

const getExpectedOrigin = (request, config) => {
  const forwardedProtocol = config.trustProxy && typeof request.headers["x-forwarded-proto"] === "string"
    ? request.headers["x-forwarded-proto"].split(",", 1)[0].trim()
    : "";
  const protocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
  return `${protocol}://${request.headers.host}`;
};

const isLoopbackAddress = (value) => {
  const normalized = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
};

const isLoopbackHostHeader = (value) => {
  try {
    return isLoopbackAddress(new URL(`http://${String(value || "")}`).hostname);
  } catch {
    return false;
  }
};

const applyAndValidateOrigin = (request, response, config) => {
  const origin = request.headers.origin;
  const requestHost = String(request.headers.host || "").toLowerCase();
  if (config.allowedOrigins.size) {
    const allowedHosts = new Set([...config.allowedOrigins].map((value) => new URL(value).host.toLowerCase()));
    if (!allowedHosts.has(requestHost)) return false;
    if (!origin) {
      // Browsers send Origin for same-origin JSON POSTs. Permit origin-less
      // non-idempotent diagnostics only from this host's loopback interface.
      const safeMethod = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
      return safeMethod || isLoopbackAddress(request.socket.remoteAddress);
    }
  } else {
    // A matching attacker-controlled Host+Origin pair is not evidence of a
    // loopback origin: DNS rebinding can point a public name at 127.0.0.1.
    // Development without an explicit allowlist therefore accepts only literal
    // loopback Host headers, independent of what DNS resolved for the client.
    if (!isLoopbackHostHeader(requestHost)) return false;
    if (!origin) {
      const safeMethod = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
      return safeMethod || isLoopbackAddress(request.socket.remoteAddress);
    }
  }
  const allowed = config.allowedOrigins.size
    ? config.allowedOrigins.has(origin)
    : origin === getExpectedOrigin(request, config);
  if (!allowed) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  return true;
};

const readJsonBody = (request, config) => new Promise((resolveBody, reject) => {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > config.maxBodyBytes) {
    request.resume();
    reject(Object.assign(new Error("Request body is too large"), { code: "BODY_TOO_LARGE" }));
    return;
  }

  const chunks = [];
  let size = 0;
  let settled = false;
  let tooLarge = false;
  const settle = (action, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    action(value);
  };
  const timer = setTimeout(() => {
    settle(reject, Object.assign(new Error("Request body timed out"), { code: "BODY_TIMEOUT" }));
    request.destroy();
  }, config.bodyReadTimeoutMs);
  timer.unref?.();

  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > config.maxBodyBytes) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (tooLarge) {
      settle(reject, Object.assign(new Error("Request body is too large"), { code: "BODY_TOO_LARGE" }));
      return;
    }
    try {
      settle(resolveBody, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      settle(reject, Object.assign(new Error("Request body is not valid JSON", { cause: error }), { code: "INVALID_JSON" }));
    }
  });
  request.on("error", (error) => settle(reject, error));
  request.on("aborted", () => settle(reject, Object.assign(new Error("Request was aborted"), { code: "REQUEST_ABORTED" })));
});

const respondToAiRequest = async ({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger, readServiceStatus }) => {
  if (request.method !== "POST") {
    sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use POST for AI requests."), { Allow: "POST, OPTIONS" });
    return;
  }
  if (!config.enabled) {
    sendJson(response, 503, errorPayload(requestId, "AI_UNAVAILABLE", "AI is not configured on this server."), { "Retry-After": "60" });
    return;
  }
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    sendJson(response, 415, errorPayload(requestId, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."));
    return;
  }

  const clientKey = getClientKey(request, config);
  const limit = rateLimit(clientKey);
  const rateHeaders = {
    "RateLimit-Limit": String(limit.limit),
    "RateLimit-Remaining": String(limit.remaining),
    "RateLimit-Reset": String(Math.ceil(limit.resetAt / 1_000)),
  };
  if (!limit.allowed) {
    sendJson(response, 429, errorPayload(requestId, "RATE_LIMITED", "Too many AI requests. Please wait and try again."), {
      ...rateHeaders,
      "Retry-After": String(limit.retryAfterSeconds),
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request, config);
  } catch (error) {
    if (error.code === "REQUEST_ABORTED") return;
    const tooLarge = error.code === "BODY_TOO_LARGE";
    const timedOut = error.code === "BODY_TIMEOUT";
    sendJson(
      response,
      tooLarge ? 413 : timedOut ? 408 : 400,
      errorPayload(requestId, tooLarge ? "PAYLOAD_TOO_LARGE" : timedOut ? "REQUEST_TIMEOUT" : "INVALID_JSON", error.message),
      rateHeaders,
    );
    return;
  }

  const validation = validateAiRequest(payload, config);
  if (!validation.ok) {
    if (validation.contractMismatch) {
      // A stale UI (old PWA shell) talking to a newer server, or the reverse,
      // must fail with one clear action instead of opaque field errors.
      sendJson(response, 409, errorPayload(
        requestId,
        "AI_CONTRACT_MISMATCH",
        "This app build and the AI server use different request contracts. Reload the app to update it; if that does not help, rebuild and restart the integrated Lumen server so the server and app come from the same build.",
        validation.errors,
      ), rateHeaders);
      return;
    }
    sendJson(response, 400, errorPayload(requestId, "VALIDATION_ERROR", "The AI request is invalid.", validation.errors), rateHeaders);
    return;
  }

  if (validation.value.responseProfile === "deep") {
    // Deep asks the provider to think privately. A configured model without
    // attested thinking support must fail with actionable guidance instead of
    // an opaque upstream provider error (AI-002 capability gating).
    const serviceStatus = await readServiceStatus();
    if (serviceStatus?.thinkingCapable !== true) {
      sendJson(response, 400, errorPayload(
        requestId,
        "AI_PROFILE_UNSUPPORTED",
        "The configured local model does not attest thinking support, so the Deep profile is unavailable. Choose Fast or Balanced, or install the documented thinking-capable Qwen model.",
      ), rateHeaders);
      return;
    }
  }

  const release = acquire(clientKey);
  if (!release) {
    sendJson(response, 429, errorPayload(requestId, "AI_CAPACITY_LIMITED", "AI is handling other requests. Please retry shortly."), {
      ...rateHeaders,
      "Retry-After": "2",
    });
    return;
  }

  const startedAt = performance.now();
  const clientDisconnect = new AbortController();
  const abortUpstream = () => clientDisconnect.abort(new Error("Client disconnected"));
  request.once("aborted", abortUpstream);
  request.socket.once("close", abortUpstream);
  response.once("close", () => {
    if (!response.writableEnded) abortUpstream();
  });
  try {
    if (config.expectedModelDigest) {
      // Diagnostic readiness uses a short shared cache, but a mutable Ollama
      // tag is checked afresh inside the admitted request immediately before
      // generation. Invalid/rate-limited requests never consume this probe.
      const identity = await probeInstalledModelIdentity(config, fetchImpl);
      if (identity.modelIdentityVerified !== true) {
        throw new OllamaProxyError(
          "AI_MODEL_IDENTITY_UNVERIFIED",
          "The installed local model does not match the operator-approved digest. Verify or reinstall the configured Ollama model before retrying.",
          503,
        );
      }
    }
    const result = await createOllamaResponse({
      request: validation.value,
      config,
      fetchImpl,
      requestId,
      signal: clientDisconnect.signal,
    });
    // Buffered structured responses use the same deterministic,
    // disclosure-safe orchestration summary as streamed prose. This is product
    // metadata derived from the validated request, never provider thinking or
    // hidden chain-of-thought.
    const approach = createAnswerApproach(validation.value);
    sendJson(response, 200, { ok: true, requestId, ...result, approach }, rateHeaders);
    log(logger, "info", "ai_request_completed", {
      requestId,
      task: validation.value.task,
      structured: validation.value.responseFormat === "structured",
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    });
  } catch (error) {
    if (clientDisconnect.signal.aborted && !response.writableEnded) return;
    const proxyError = error instanceof OllamaProxyError
      ? error
      : new OllamaProxyError("AI_INTERNAL_ERROR", "The AI request could not be completed.", 500, { cause: error });
    const headers = { ...rateHeaders };
    if (proxyError.retryAfter) headers["Retry-After"] = proxyError.retryAfter;
    sendJson(response, proxyError.status, errorPayload(requestId, proxyError.code, proxyError.message), headers);
    log(logger, "warn", "ai_request_failed", {
      requestId,
      code: proxyError.code,
      status: proxyError.status,
      durationMs: Math.round(performance.now() - startedAt),
      upstreamRequestId: proxyError.upstreamRequestId || null,
    });
  } finally {
    request.socket.off("close", abortUpstream);
    release();
  }
};

const respondToAiStreamRequest = async ({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger, readServiceStatus }) => {
  if (request.method !== "POST") {
    sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use POST for streaming AI requests."), { Allow: "POST, OPTIONS" });
    return;
  }
  if (!config.enabled) {
    sendJson(response, 503, errorPayload(requestId, "AI_UNAVAILABLE", "AI is not configured on this server."), { "Retry-After": "60" });
    return;
  }
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    sendJson(response, 415, errorPayload(requestId, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."));
    return;
  }

  const clientKey = getClientKey(request, config);
  const limit = rateLimit(clientKey);
  const rateHeaders = {
    "RateLimit-Limit": String(limit.limit),
    "RateLimit-Remaining": String(limit.remaining),
    "RateLimit-Reset": String(Math.ceil(limit.resetAt / 1_000)),
  };
  if (!limit.allowed) {
    sendJson(response, 429, errorPayload(requestId, "RATE_LIMITED", "Too many AI requests. Please wait and try again."), {
      ...rateHeaders,
      "Retry-After": String(limit.retryAfterSeconds),
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request, config);
  } catch (error) {
    if (error.code === "REQUEST_ABORTED") return;
    const tooLarge = error.code === "BODY_TOO_LARGE";
    const timedOut = error.code === "BODY_TIMEOUT";
    sendJson(
      response,
      tooLarge ? 413 : timedOut ? 408 : 400,
      errorPayload(requestId, tooLarge ? "PAYLOAD_TOO_LARGE" : timedOut ? "REQUEST_TIMEOUT" : "INVALID_JSON", error.message),
      rateHeaders,
    );
    return;
  }

  const validation = validateAiRequest(payload, config);
  if (!validation.ok) {
    if (validation.contractMismatch) {
      // A stale UI (old PWA shell) talking to a newer server, or the reverse,
      // must fail with one clear action instead of opaque field errors.
      sendJson(response, 409, errorPayload(
        requestId,
        "AI_CONTRACT_MISMATCH",
        "This app build and the AI server use different request contracts. Reload the app to update it; if that does not help, rebuild and restart the integrated Lumen server so the server and app come from the same build.",
        validation.errors,
      ), rateHeaders);
      return;
    }
    sendJson(response, 400, errorPayload(requestId, "VALIDATION_ERROR", "The AI request is invalid.", validation.errors), rateHeaders);
    return;
  }

  if (validation.value.responseProfile === "deep") {
    // Deep asks the provider to think privately. A configured model without
    // attested thinking support must fail with actionable guidance instead of
    // an opaque upstream provider error (AI-002 capability gating).
    const serviceStatus = await readServiceStatus();
    if (serviceStatus?.thinkingCapable !== true) {
      sendJson(response, 400, errorPayload(
        requestId,
        "AI_PROFILE_UNSUPPORTED",
        "The configured local model does not attest thinking support, so the Deep profile is unavailable. Choose Fast or Balanced, or install the documented thinking-capable Qwen model.",
      ), rateHeaders);
      return;
    }
  }

  const release = acquire(clientKey);
  if (!release) {
    sendJson(response, 429, errorPayload(requestId, "AI_CAPACITY_LIMITED", "AI is handling other requests. Please retry shortly."), {
      ...rateHeaders,
      "Retry-After": "2",
    });
    return;
  }

  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const clientDisconnect = new AbortController();
  const abortUpstream = () => clientDisconnect.abort(new Error("Client disconnected"));
  request.once("aborted", abortUpstream);
  request.socket.once("close", abortUpstream);
  response.once("close", () => {
    if (!response.writableEnded) abortUpstream();
  });
  let writer = null;
  let heartbeat = null;
  let streamStarted = false;
  try {
    if (config.expectedModelDigest) {
      const identity = await probeInstalledModelIdentity(config, fetchImpl);
      if (identity.modelIdentityVerified !== true) {
        throw new OllamaProxyError(
          "AI_MODEL_IDENTITY_UNVERIFIED",
          "The installed local model does not match the operator-approved digest. Verify or reinstall the configured Ollama model before retrying.",
          503,
        );
      }
    }

    response.socket?.setNoDelay?.(true);
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Lumen-Stream-Protocol": AI_STREAM_PROTOCOL,
      ...rateHeaders,
    });
    response.flushHeaders?.();
    streamStarted = true;
    writer = createNdjsonWriter(response, {
      signal: clientDisconnect.signal,
      maximumBytes: config.streamMaxResponseBytes,
      backpressureTimeoutMs: config.streamBackpressureTimeoutMs,
    });

    const approach = createAnswerApproach(validation.value);
    await writer.write({
      type: "start",
      protocol: AI_STREAM_PROTOCOL,
      requestId,
      model: config.model,
      responseFormat: validation.value.responseFormat,
      responseProfile: validation.value.responseProfile,
      startedAt: startedAtIso,
    });
    await writer.write({ type: "approach", requestId, approach });
    await writer.write({
      type: "phase",
      requestId,
      phase: "preparing",
      message: "Preparing the bounded local-model request.",
    });

    heartbeat = setInterval(() => {
      writer.write({ type: "heartbeat", requestId, at: new Date().toISOString() }).catch(() => abortUpstream());
    }, config.streamHeartbeatMs);
    heartbeat.unref?.();

    let sequence = 0;
    const result = await createOllamaStreamingResponse({
      request: validation.value,
      config,
      fetchImpl,
      requestId,
      signal: clientDisconnect.signal,
      onPhase: ({ phase, message }) => writer.write({ type: "phase", requestId, phase, message }),
      onSource: ({ index, source }) => writer.write({ type: "source", requestId, index, source }),
      onDelta: (text) => writer.write({ type: "delta", requestId, sequence: sequence++, text }),
    });
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    const envelope = { ok: true, requestId, ...result, approach };
    await writer.write({ type: "complete", requestId, response: envelope });
    writer.close();
    response.end();
    log(logger, "info", "ai_stream_completed", {
      requestId,
      task: validation.value.task,
      responseProfile: validation.value.responseProfile,
      structured: validation.value.responseFormat === "structured",
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      streamBytes: writer.bytesWritten,
    });
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    if (clientDisconnect.signal.aborted) return;
    const proxyError = error instanceof OllamaProxyError
      ? error
      : new OllamaProxyError("AI_INTERNAL_ERROR", "The AI request could not be completed.", 500, { cause: error });
    if (!streamStarted) {
      const headers = { ...rateHeaders };
      if (proxyError.retryAfter) headers["Retry-After"] = proxyError.retryAfter;
      sendJson(response, proxyError.status, errorPayload(requestId, proxyError.code, proxyError.message), headers);
    } else {
      try {
        await writer.write({
          type: "error",
          requestId,
          status: proxyError.status,
          error: { code: proxyError.code, message: proxyError.message },
          ...(proxyError.retryAfter ? { retryAfter: String(proxyError.retryAfter) } : {}),
        });
        writer.close();
        response.end();
      } catch {
        response.destroy();
      }
    }
    log(logger, "warn", "ai_stream_failed", {
      requestId,
      code: proxyError.code,
      status: proxyError.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } finally {
    request.socket.off("close", abortUpstream);
    release();
  }
};

const respondToLocalSearchRequest = async ({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger }) => {
  if (request.method !== "POST") {
    sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use POST for local web searches."), { Allow: "POST, OPTIONS" });
    return;
  }
  if (!config.webSearchEnabled) {
    sendJson(response, 503, errorPayload(requestId, "WEB_SEARCH_UNAVAILABLE", "Self-hosted web search is disabled on this server."));
    return;
  }
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    sendJson(response, 415, errorPayload(requestId, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."));
    return;
  }

  const clientKey = getClientKey(request, config);
  const limit = rateLimit(clientKey);
  const rateHeaders = {
    "RateLimit-Limit": String(limit.limit),
    "RateLimit-Remaining": String(limit.remaining),
    "RateLimit-Reset": String(Math.ceil(limit.resetAt / 1_000)),
  };
  if (!limit.allowed) {
    sendJson(response, 429, errorPayload(requestId, "RATE_LIMITED", "Too many search requests. Please wait and try again."), {
      ...rateHeaders,
      "Retry-After": String(limit.retryAfterSeconds),
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request, config);
  } catch (error) {
    if (error.code === "REQUEST_ABORTED") return;
    const tooLarge = error.code === "BODY_TOO_LARGE";
    const timedOut = error.code === "BODY_TIMEOUT";
    sendJson(
      response,
      tooLarge ? 413 : timedOut ? 408 : 400,
      errorPayload(requestId, tooLarge ? "PAYLOAD_TOO_LARGE" : timedOut ? "REQUEST_TIMEOUT" : "INVALID_JSON", error.message),
      rateHeaders,
    );
    return;
  }
  const exactPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === 1 && Object.hasOwn(payload, "query");
  const query = exactPayload ? validateSearchQuery(payload.query) : null;
  if (!query) {
    sendJson(response, 400, errorPayload(requestId, "VALIDATION_ERROR", "The search request must contain only a valid query of at most 240 characters."), rateHeaders);
    return;
  }

  const release = acquire(clientKey);
  if (!release) {
    sendJson(response, 429, errorPayload(requestId, "SEARCH_CAPACITY_LIMITED", "Search is handling another request. Please retry shortly."), {
      ...rateHeaders,
      "Retry-After": "2",
    });
    return;
  }
  const startedAt = performance.now();
  const clientDisconnect = new AbortController();
  const abortSearch = () => clientDisconnect.abort(new Error("Client disconnected"));
  request.once("aborted", abortSearch);
  response.once("close", () => {
    if (!response.writableEnded) abortSearch();
  });
  try {
    const result = await searchSearxng({ query, config, fetchImpl, signal: clientDisconnect.signal });
    sendJson(response, 200, { ok: true, requestId, ...result }, rateHeaders);
    log(logger, "info", "local_search_completed", {
      requestId,
      resultCount: result.results.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    if (clientDisconnect.signal.aborted && !response.writableEnded) return;
    const searchError = error instanceof WebSearchError
      ? error
      : new WebSearchError("WEB_SEARCH_INTERNAL_ERROR", "The self-hosted web search could not be completed.", 500, { cause: error });
    sendJson(response, searchError.status, errorPayload(requestId, searchError.code, searchError.message), rateHeaders);
    log(logger, "warn", "local_search_failed", {
      requestId,
      code: searchError.code,
      status: searchError.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } finally {
    release();
  }
};

const safeStaticPath = (pathname, distDirectory) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(distDirectory, decoded.replace(/^\/+/, "") || "index.html");
  return candidate === distDirectory || candidate.startsWith(`${distDirectory}${sep}`) ? candidate : null;
};

const serveStatic = async (request, response, pathname, distDirectory) => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  let filePath = safeStaticPath(pathname, distDirectory);
  if (!filePath) return false;
  let metadata;
  try {
    metadata = await stat(filePath);
    if (metadata.isDirectory()) {
      filePath = resolve(filePath, "index.html");
      metadata = await stat(filePath);
    }
  } catch {
    const acceptsHtml = String(request.headers.accept || "").includes("text/html");
    if (!acceptsHtml || extname(pathname)) return false;
    filePath = resolve(distDirectory, "index.html");
    try {
      metadata = await stat(filePath);
    } catch {
      return false;
    }
  }
  if (!metadata.isFile()) return false;

  const extension = extname(filePath).toLowerCase();
  const etag = `W/\"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}\"`;
  const cacheControl = extension === ".cer"
    ? "no-store"
    : filePath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : extension === ".html" || filePath.endsWith(`${sep}service-worker.js`)
      ? "no-cache"
      : "public, max-age=3600";
  const headers = {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": metadata.size,
    "Cache-Control": cacheControl,
    ETag: etag,
    ...(extension === ".cer" ? { "Content-Disposition": `attachment; filename="${filePath.split(sep).pop()}"` } : {}),
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": cacheControl });
    response.end();
    return true;
  }
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: { code: "STATIC_READ_ERROR", message: "The app file could not be read." } });
    else response.destroy();
  });
  stream.pipe(response);
  return true;
};

export const createApplicationServer = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
  distDirectory = DEFAULT_DIST_DIRECTORY,
  logger = console,
} = {}) => {
  const config = readAiServerConfig(env);
  const tlsOptions = readTlsOptions(env);
  const exposesPrivateApis = config.enabled || config.webSearchEnabled;
  if (exposesPrivateApis && !isLoopbackAddress(config.host)) {
    if (config.authMode !== "pairing" && !config.allowUnauthenticatedLan) {
      throw new Error(
        "Serving AI or web search beyond loopback now requires learner pairing. Set AI_AUTH=pairing with an AI_PAIRING_CODE (recommended), or acknowledge the single-learner trusted-LAN profile explicitly with AI_ALLOW_UNAUTHENTICATED_LAN=true. See AI_SERVER.md.",
      );
    }
    if (!tlsOptions) throw new Error("TLS is required when local AI or web search binds beyond loopback");
    if (!config.allowedOrigins.size) throw new Error("AI_ALLOWED_ORIGINS is required when local AI or web search binds beyond loopback");
    if ([...config.allowedOrigins].some((origin) => new URL(origin).protocol !== "https:")) {
      throw new Error("AI_ALLOWED_ORIGINS must use HTTPS when local AI or web search binds beyond loopback");
    }
  }
  if (typeof fetchImpl !== "function") throw new Error("A Fetch API implementation is required (Node.js 18 or later)");
  const rateLimit = createRateLimiter(config);
  const acquire = createConcurrencyGate(config);
  // Ephemeral per-boot secret unless the operator pins one: restarting the
  // server without AI_SESSION_SECRET revokes every issued session.
  const sessionSecret = config.sessionSecret || randomBytes(32).toString("hex");
  const sessionTtlMs = config.sessionTtlHours * 3_600_000;
  const pairingAttempts = new Map();
  const allowPairingAttempt = (clientKey) => {
    const now = Date.now();
    const window = pairingAttempts.get(clientKey)?.filter((at) => now - at < 300_000) || [];
    if (window.length >= 5) return false;
    window.push(now);
    pairingAttempts.set(clientKey, window);
    if (pairingAttempts.size > 1_000) {
      for (const [key, attempts] of pairingAttempts) {
        if (!attempts.some((at) => now - at < 300_000)) pairingAttempts.delete(key);
      }
    }
    return true;
  };
  const hasActiveSession = (request) => verifySessionToken(sessionSecret, readSessionCookie(request));
  let serviceStatusCache = null;
  let serviceStatusProbe = null;
  const readServiceStatus = async () => {
    if (serviceStatusCache && Date.now() - serviceStatusCache.cachedAt < 3_000) return serviceStatusCache.value;
    if (serviceStatusProbe) return serviceStatusProbe;
    serviceStatusProbe = probeLocalAiServices(config, fetchImpl).then((value) => {
      serviceStatusCache = { cachedAt: Date.now(), value };
      return value;
    }).finally(() => {
      serviceStatusProbe = null;
    });
    return serviceStatusProbe;
  };

  const requestHandler = async (request, response) => {
    const requestId = randomUUID();
    setCommonHeaders(response);
    response.setHeader("X-Request-Id", requestId);

    let url;
    try {
      url = new URL(request.url || "/", "http://lumen.local");
    } catch {
      sendJson(response, 400, errorPayload(requestId, "INVALID_URL", "The request URL is invalid."));
      return;
    }

    const publicDisabledDiagnostic = !exposesPrivateApis
      && (request.method === "GET" || request.method === "HEAD")
      && ["/api/health", "/api/ai/config", "/api/ai/health"].includes(url.pathname);
    if (url.pathname.startsWith(API_PREFIX) && !publicDisabledDiagnostic && !applyAndValidateOrigin(request, response, config)) {
      sendJson(response, 403, errorPayload(requestId, "ORIGIN_NOT_ALLOWED", "This origin is not allowed to use the AI service."));
      return;
    }
    if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/ai/") || url.pathname === "/api/local-search" || url.pathname === "/api/auth/pair")) {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use GET for health checks."), { Allow: "GET, HEAD" });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        service: "lumen-ai-notes",
        status: "ok",
        requestContract: AI_REQUEST_CONTRACT_ID,
        ai: config.enabled ? "configured" : "disabled",
        webSearch: config.webSearchEnabled ? "configured" : "disabled",
        requestId,
      }, {}, request.method === "HEAD");
      return;
    }
    if (url.pathname === "/api/ai/config" || url.pathname === "/api/ai/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use GET for AI configuration."), { Allow: "GET, HEAD" });
        return;
      }
      const serviceStatus = await readServiceStatus();
      const publicConfig = publicAiConfig(config, serviceStatus);
      publicConfig.auth = {
        ...publicConfig.auth,
        required: config.authMode === "pairing",
        sessionActive: config.authMode === "pairing" ? hasActiveSession(request) : null,
      };
      sendJson(response, 200, { ok: true, requestId, ...publicConfig }, {}, request.method === "HEAD");
      return;
    }
    if (url.pathname === "/api/auth/pair") {
      if (request.method !== "POST") {
        sendJson(response, 405, errorPayload(requestId, "METHOD_NOT_ALLOWED", "Use POST to pair this browser."), { Allow: "POST, OPTIONS" });
        return;
      }
      if (config.authMode !== "pairing") {
        sendJson(response, 409, errorPayload(requestId, "AI_AUTH_NOT_ENABLED", "This server does not use learner pairing."));
        return;
      }
      const clientKey = getClientKey(request, config);
      if (!allowPairingAttempt(clientKey)) {
        sendJson(response, 429, errorPayload(requestId, "PAIRING_RATE_LIMITED", "Too many pairing attempts. Wait five minutes and try again."), { "Retry-After": "300" });
        return;
      }
      let payload;
      try {
        payload = await readJsonBody(request, config);
      } catch (error) {
        if (error.code === "REQUEST_ABORTED") return;
        sendJson(response, 400, errorPayload(requestId, "INVALID_JSON", error.message));
        return;
      }
      const code = typeof payload?.code === "string" ? payload.code.trim() : "";
      if (!code || code.length > 200 || !pairingCodesMatch(config.pairingCode.trim(), code)) {
        logger.warn?.(JSON.stringify({ event: "pairing_rejected", requestId, client: clientKey }));
        sendJson(response, 401, errorPayload(requestId, "PAIRING_CODE_INVALID", "That pairing code does not match this server. Check it with the server operator."));
        return;
      }
      const token = mintSessionToken(sessionSecret, sessionTtlMs);
      const cookie = [
        `${SESSION_COOKIE_NAME}=${token}`,
        "Path=/",
        `Max-Age=${Math.floor(sessionTtlMs / 1_000)}`,
        "HttpOnly",
        "SameSite=Strict",
        ...(tlsOptions ? ["Secure"] : []),
      ].join("; ");
      logger.info?.(JSON.stringify({ event: "pairing_accepted", requestId, client: clientKey }));
      sendJson(response, 200, { ok: true, requestId, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() }, { "Set-Cookie": cookie });
      return;
    }
    if (config.authMode === "pairing"
      && ["/api/ai/respond/stream", "/api/ai/respond", "/api/local-search"].includes(url.pathname)
      && !hasActiveSession(request)) {
      sendJson(response, 401, errorPayload(
        requestId,
        "AI_AUTH_REQUIRED",
        "This browser is not paired with the Lumen server yet, or its session expired. Enter the operator's pairing code in the AI studio to continue.",
      ));
      return;
    }
    if (url.pathname === "/api/ai/respond/stream") {
      await respondToAiStreamRequest({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger, readServiceStatus });
      return;
    }
    if (url.pathname === "/api/ai/respond") {
      await respondToAiRequest({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger, readServiceStatus });
      return;
    }
    if (url.pathname === "/api/local-search") {
      await respondToLocalSearchRequest({ request, response, config, fetchImpl, requestId, rateLimit, acquire, logger });
      return;
    }
    if (url.pathname.startsWith(API_PREFIX)) {
      sendJson(response, 404, errorPayload(requestId, "API_NOT_FOUND", "The requested API endpoint does not exist."));
      return;
    }
    if (await serveStatic(request, response, url.pathname, resolve(distDirectory))) return;
    sendJson(response, 404, errorPayload(requestId, "NOT_FOUND", "The requested resource does not exist."));
  };
  const server = tlsOptions
    ? createHttpsServer(tlsOptions, requestHandler)
    : createHttpServer(requestHandler);

  server.headersTimeout = 15_000;
  server.requestTimeout = Math.max(config.bodyReadTimeoutMs + 1_000, 15_000);
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return { server, config, transport: tlsOptions ? "https" : "http" };
};

export const startApplicationServer = async (options = {}) => {
  const { server, config, transport } = createApplicationServer(options);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  return { server, config, transport };
};

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  startApplicationServer().then(({ server, config, transport }) => {
    log(console, "info", "server_started", {
      host: config.host,
      port: server.address()?.port ?? config.port,
      transport,
      aiEnabled: config.enabled,
      provider: config.provider,
      model: config.enabled ? config.model : null,
    });
    let closing = false;
    const shutdown = (signal) => {
      if (closing) return;
      closing = true;
      log(console, "info", "server_stopping", { signal });
      const forceTimer = setTimeout(() => server.closeAllConnections?.(), 8_000);
      forceTimer.unref?.();
      server.close((error) => {
        clearTimeout(forceTimer);
        if (error) log(console, "error", "server_stop_failed", { message: error.message });
        process.exitCode = error ? 1 : 0;
      });
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }).catch((error) => {
    log(console, "error", "server_start_failed", { message: error.message });
    process.exitCode = 1;
  });
}

export { silentLogger };
