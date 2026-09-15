import assert from "node:assert/strict";
import { getAiConfig, requestAi, requestAiStream } from "../src/lib/aiClient.js";
import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";
import { validateStructuredAiResult } from "../server/ai/contracts.mjs";

const baseUrl = (process.env.LUMEN_URL || "http://127.0.0.1:4187").replace(/\/$/, "");
const config = await getAiConfig({ baseUrl, force: true });
assert.equal(config.webSearch.macToolAvailable, true, "Start the configured SearXNG service and a tool-capable Ollama model.");
// Keep the gateway probe configurable so failed production queries can be
// reproduced exactly, without silently broadening the user's approved query.
const query = process.env.LUMEN_SEARCH_QUERY || "Ollama";
const search = await fetch(`${baseUrl}/api/local-search`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000),
});
const found = await search.json();
assert.equal(search.ok && found.ok, true, JSON.stringify(found.error));
assert.ok(found.results?.length, "Search returned no usable evidence");
console.log(JSON.stringify({ task: "exact-query-search", query, ok: true, sources: found.results.length }));
for (const [task, responseFormat, prompt] of [
  ["explain", "markdown", 'Call search_web with the query "Ollama". Using only the returned evidence, describe Ollama in under 80 words using [W#] citations.'],
  ["flashcards", "structured", 'Call search_web with the query "Ollama". Using only the returned evidence, create exactly 2 short flashcards about Ollama. Put [W#] citations in the card backs.'],
]) {
  const started = Date.now();
  const response = await (responseFormat === "markdown" ? requestAiStream : requestAi)({
    contract: AI_REQUEST_CONTRACT_ID, task, prompt, context: "", contextCitations: [], history: [], difficulty: "intermediate",
    responseFormat, responseProfile: "balanced", webSearch: true,
  }, { baseUrl, timeoutMs: config.limits.clientTimeoutMs });
  assert.equal(response.status, "completed");
  assert.equal(response.webSearch.used, true);
  assert.ok(response.sources.length);
  assert.match(response.outputText, /\[W\d+\]/);
  if (responseFormat === "structured") assert.equal(validateStructuredAiResult(task, response.data), true);
  console.log(JSON.stringify({ task, ok: true, ms: Date.now() - started, rounds: response.webSearch.rounds, sources: response.sources.length }));
}
