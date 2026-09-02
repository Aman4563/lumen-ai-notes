/**
 * Operator-run local-AI latency benchmark (PERF-002).
 *
 * Measures the real Lumen streaming path — request validation, library
 * framing, Ollama inference, NDJSON delivery — against a live server and
 * reports per-run and p50/p95 figures for:
 *   - timeToFirstEvent: first NDJSON byte (server accepted + stream open)
 *   - timeToFirstDelta: first model text delta (cold prompt evaluation ends)
 *   - totalMs: terminal `complete` event received
 *   - outputTokens and tokens/second (from the server's usage accounting)
 *
 * This is deliberately NOT part of `npm run check`: it needs a running
 * server (`HOST=127.0.0.1 PORT=4202 AI_ENABLED=true node server/server.mjs`)
 * with Ollama serving the configured model. Usage:
 *
 *   LUMEN_AI_URL=https://127.0.0.1:4202 RUNS=5 node scripts/ai_slo_bench.mjs
 *
 * With the HTTPS loopback serve, trust the local CA via:
 *
 *   NODE_EXTRA_CA_CERTS=./public/lumen-local-ca.cer LUMEN_AI_URL=https://127.0.0.1:4202 node scripts/ai_slo_bench.mjs
 *
 * The first run is reported separately as the cold run; percentiles cover
 * the warm runs. Results print as JSON for pasting into the tracker.
 */
import { performance } from "node:perf_hooks";

import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";

const baseUrl = new URL(process.env.LUMEN_AI_URL || "https://127.0.0.1:4202");
const runs = Math.max(1, Math.min(20, Number(process.env.RUNS) || 5));
const responseProfile = ["fast", "balanced", "deep"].includes(process.env.PROFILE) ? process.env.PROFILE : "balanced";

// Two variants: the grounded path buffers deltas until terminal citation
// validation (first delta ≈ total BY DESIGN), while source-free prose is
// token-live — both are SLO surfaces and are measured separately.
const CONTEXT = [
  "[S1] Gradient descent — optimization basics",
  "Gradient descent updates parameters in the direction of the negative gradient of the loss.",
  "The learning rate controls the step size; too large diverges, too small converges slowly.",
  "Momentum accumulates an exponential moving average of past gradients to damp oscillation.",
].join("\n");

const bodyFor = (variant) => JSON.stringify({
  contract: AI_REQUEST_CONTRACT_ID,
  task: "explain",
  prompt: variant === "grounded"
    ? "In under 120 words, explain why the learning rate trades off convergence speed against divergence, citing the source."
    // Deliberately citation-neutral: curriculum-flavored source-free prompts
    // can tempt the model into inventing [S#] labels, which the server
    // correctly rejects (AI_CURRICULUM_UNGROUNDED) — a guardrail, not an SLO.
    : "In under 120 words and without citing any sources, explain why compound interest grows faster than simple interest.",
  ...(variant === "grounded" ? { context: CONTEXT, contextCitations: [1] } : {}),
  documentTitle: "SLO benchmark fixture",
  difficulty: "intermediate",
  responseFormat: "markdown",
  responseProfile,
});

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction))];
};

const benchOnce = async (variant) => {
  const startedAt = performance.now();
  const metrics = { timeToFirstEvent: null, timeToFirstDelta: null, totalMs: null, deltas: 0, outputTokens: null, error: null };
  const response = await fetch(new URL("/api/ai/respond/stream", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
      Origin: baseUrl.origin,
    },
    body: bodyFor(variant),
  });
  if (!response.ok || !response.body) {
    metrics.error = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
    return metrics;
  }
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of response.body) {
    if (metrics.timeToFirstEvent === null) metrics.timeToFirstEvent = performance.now() - startedAt;
    buffered += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "delta") {
        if (metrics.timeToFirstDelta === null) metrics.timeToFirstDelta = performance.now() - startedAt;
        metrics.deltas += 1;
      } else if (event.type === "complete") {
        metrics.totalMs = performance.now() - startedAt;
        metrics.outputTokens = event.response?.usage?.outputTokens ?? null;
      } else if (event.type === "error") {
        metrics.error = `${event.error?.code || event.code || "STREAM_ERROR"}: ${event.error?.message || event.message || ""}`.slice(0, 200);
      }
    }
  }
  if (metrics.totalMs === null && !metrics.error) metrics.error = "stream ended without a terminal complete event";
  return metrics;
};

const health = await fetch(new URL("/api/health", baseUrl), { headers: { Origin: baseUrl.origin } }).then((res) => res.json());
if (!health.ok) {
  console.error("Server health check failed:", JSON.stringify(health));
  process.exit(1);
}

const summarize = (results) => {
  const failures = results.filter((metric) => metric.error);
  const [cold, ...warm] = results;
  const warmValid = warm.filter((metric) => !metric.error && metric.totalMs !== null);
  const rates = warmValid
    .filter((metric) => metric.outputTokens && metric.totalMs)
    .map((metric) => metric.outputTokens / (metric.totalMs / 1_000));
  const medianRate = percentile(rates, 0.5);
  return {
    failureRate: failures.length / results.length,
    cold: cold.error ? { error: cold.error } : {
      timeToFirstDeltaMs: Math.round(cold.timeToFirstDelta),
      totalMs: Math.round(cold.totalMs),
    },
    warm: {
      count: warmValid.length,
      firstDeltaP50Ms: Math.round(percentile(warmValid.map((metric) => metric.timeToFirstDelta), 0.5) ?? -1),
      firstDeltaP95Ms: Math.round(percentile(warmValid.map((metric) => metric.timeToFirstDelta), 0.95) ?? -1),
      totalP50Ms: Math.round(percentile(warmValid.map((metric) => metric.totalMs), 0.5) ?? -1),
      totalP95Ms: Math.round(percentile(warmValid.map((metric) => metric.totalMs), 0.95) ?? -1),
      tokensPerSecondP50: medianRate === null ? null : Number(medianRate.toFixed(1)),
    },
  };
};

const variantResults = {};
let totalFailures = 0;
let totalRuns = 0;
for (const variant of ["grounded", "source-free"]) {
  const results = [];
  for (let run = 0; run < runs; run += 1) {
    const metrics = await benchOnce(variant);
    results.push(metrics);
    totalRuns += 1;
    if (metrics.error) totalFailures += 1;
    console.error(`${variant} run ${run + 1}/${runs}${run === 0 ? " (cold)" : ""}: first delta ${Math.round(metrics.timeToFirstDelta ?? -1)}ms · total ${Math.round(metrics.totalMs ?? -1)}ms · ${metrics.deltas} deltas${metrics.error ? ` · ERROR ${metrics.error}` : ""}`);
  }
  variantResults[variant] = summarize(results);
}

const summary = {
  measuredAt: new Date().toISOString(),
  origin: baseUrl.origin,
  responseProfile,
  runsPerVariant: runs,
  note: "grounded first-delta ≈ total by design (citation-validation buffering); source-free measures token-live streaming",
  ...variantResults,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(totalFailures === totalRuns ? 1 : 0);
