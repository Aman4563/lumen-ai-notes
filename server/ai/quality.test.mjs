import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_REQUEST_CONTRACT_ID } from "../../src/lib/aiContract.js";
import { readAiServerConfig } from "./config.mjs";
import { buildOllamaRequest } from "./ollama.mjs";

// Answer-quality instructions for issue #58. Live qwen3.5:4b evidence is
// recorded separately in docs/FUNCTIONAL_TESTING.md.

const config = readAiServerConfig({ AI_ENABLED: "true", OLLAMA_MODEL: "test-model", AI_MAX_OUTPUT_TOKENS: "4096" });
const baseRequest = Object.freeze({
  contract: AI_REQUEST_CONTRACT_ID,
  task: "explain",
  prompt: "Explain ordinary least squares.",
  context: "[S1] Linear regression\nOrdinary least squares chooses weights that minimize the sum of squared residuals.",
  contextCitations: [1],
  documentTitle: "Linear regression",
  difficulty: "intermediate",
  history: [],
  conversationSummary: "",
  responseFormat: "markdown",
  responseProfile: "balanced",
  maxOutputTokens: 1_800,
  webSearch: false,
});

const twoSources = Object.freeze({
  context: "[S1] Evaluation\nValidation data selects hyperparameters.\n\n[S2] Cross-validation\nPreprocessing is fitted on the training fold only.",
  contextCitations: [1, 2],
  documentTitle: "2 selected Lumen sources",
});

const systemOf = (body) => body.messages.find((message) => message.role === "system").content;
const lastUserOf = (body) => body.messages.filter((message) => message.role === "user").at(-1).content;

// ---------------------------------------------------------------------------
// Task instructions (TF-8, TF-18, TF-19, TF-20)

test("Socratic describes its format instead of a literal 'Your question?' template", () => {
  const body = buildOllamaRequest({ ...baseRequest, task: "socratic" }, config);
  const prompt = lastUserOf(body);
  assert.doesNotMatch(JSON.stringify(body.messages), /Your question\?|Output pattern/i);
  assert.match(prompt, /ask exactly one new focused question grounded in the context above, and end it with the exact label of the supplied source that motivates it \(one of \[S1\]\)/);
  assert.match(prompt, /Do not answer your new question/);
  assert.doesNotMatch(prompt, /assessment/, "a first Socratic turn has no learner answer to assess");

  const sourceFree = lastUserOf(buildOllamaRequest({ ...baseRequest, task: "socratic", context: "", contextCitations: [] }, config));
  assert.match(sourceFree, /ask exactly one new focused question\./);
  assert.doesNotMatch(sourceFree, /\[S\d+\]/);
});

test("a Socratic turn after the tutor's question assesses the learner's answer before one cited question", () => {
  const request = {
    ...baseRequest,
    task: "socratic",
    prompt: "OLS picks the weights that minimize squared error and has a closed-form solution.",
    history: [
      { role: "user", content: "Teach me OLS one question at a time." },
      { role: "assistant", content: "What quantity does ordinary least squares minimize? [S1]" },
    ],
  };
  const body = buildOllamaRequest(request, config);
  const prompt = lastUserOf(body);
  assert.match(prompt, /if the learner's latest message answers your previous question, open with a one- or two-sentence assessment of that answer that says whether it is correct, partly correct, or a misconception, and why; then ask exactly one new focused question/);
  assert.match(prompt, /\[S1\]/);
  assert.match(systemOf(body), /first assess that answer in one or two sentences/);
  // The existing grounded-question recovery wording is kept.
  assert.match(systemOf(body), /cite the source that motivates your question using its exact \[S#\] label/);
});

test("Fast prose carries an explicit brevity target that Balanced, Deep, and structured requests do not", () => {
  const fast = systemOf(buildOllamaRequest({ ...baseRequest, responseProfile: "fast", maxOutputTokens: 900 }, config));
  assert.match(fast, /Fast profile: keep the answer brief, about 150 words or fewer unless the learner explicitly asks for more detail/);
  assert.match(fast, /prefer a short list to long paragraphs/);
  for (const responseProfile of ["balanced", "deep"]) {
    assert.doesNotMatch(systemOf(buildOllamaRequest({ ...baseRequest, responseProfile }, config)), /Fast profile|150 words/);
  }
  const structuredFast = systemOf(buildOllamaRequest({ ...baseRequest, task: "flashcards", responseFormat: "structured", responseProfile: "fast", maxOutputTokens: 900 }, config));
  assert.doesNotMatch(structuredFast, /Fast profile/, "structured item counts keep their own completion contract");
});

test("code review separates defects from conventions and does not assert uncertain library defaults", () => {
  const system = systemOf(buildOllamaRequest({ ...baseRequest, task: "code_review", context: "", contextCitations: [], prompt: "Review: def mean(xs): return sum(xs[1:]) / len(xs)" }, config));
  assert.match(system, /Label every finding as either a Defect or a Convention\/alternative/);
  assert.match(system, /traced through the code, including edge cases such as empty or single-element input/);
  assert.match(system, /population versus sample variance\); never present one as a defect/);
  assert.match(system, /Do not state a library's default behavior, version, or API contract unless you are certain/);
  assert.match(system, /itself correct and numerically stable \(for example, never replace a two-pass variance with the cancellation-prone E\[x\^2\] - E\[x\]\^2 shortcut\)/);
  const taskLine = system.split("\n").find((line) => line.startsWith("Task-specific instruction:"));
  assert.doesNotMatch(taskLine, /\[[SW]\d+\]/, "the example must not look like a citation label");
});

test("grounded prose asks for a citation after each supported paragraph; structured keeps JSON placement", () => {
  const prose = lastUserOf(buildOllamaRequest({ ...baseRequest, ...twoSources }, config));
  assert.match(prose, /cite the supplied sources with these exact labels: \[S1\], \[S2\]/);
  assert.match(prose, /End every paragraph or list item that uses the sources with the label of the source that supports it, and include at least one label in your first paragraph/);
  assert.match(prose, /never inside code/);
  const structured = lastUserOf(buildOllamaRequest({ ...baseRequest, ...twoSources, task: "flashcards", responseFormat: "structured" }, config));
  assert.match(structured, /In JSON, place citations inside supported string values, never outside the JSON/);
  assert.doesNotMatch(structured, /End every paragraph/);
});
