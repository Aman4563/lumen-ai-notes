import assert from "node:assert/strict";
import { getAiConfig, requestAi, requestAiStream } from "../src/lib/aiClient.js";
import { AI_REQUEST_CONTRACT_ID } from "../src/lib/aiContract.js";
import { validateStructuredAiResult } from "../server/ai/contracts.mjs";

// Deliberately no model mocks: use the same client and validators as the app.
// Run serially so the audit respects the single-client inference limit.
const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4187";
const config = await getAiConfig({ baseUrl, force: true });
assert.equal(config.enabled && config.service?.reachable && config.service?.modelInstalled && config.service?.completionCapable, true, "Start the integrated Lumen server and its configured Ollama model before running the live audit.");
assert.ok(!config.auth?.required || config.auth?.sessionActive, "Run from the loopback server or pair this audit client first.");
const context = "[S1] Evaluation basics\nTraining data fits model parameters. Validation data selects hyperparameters. The held-out test data is used once after model selection to estimate generalization. Using test data for tuning leaks information and biases the estimate. Cross-validation repeats training and validation across folds; preprocessing must be fitted on the training fold only.";
const cases = [
  ["tutor", "Teach me why test data is held out, in under 100 words."],
  ["explain", "Explain test leakage in under 100 words with one example."],
  ["socratic", "Ask one short question about why we need validation data."],
  ["quiz", "Create exactly 2 short multiple-choice questions about evaluation splits.", "structured"],
  ["flashcards", "Create exactly 2 short atomic flashcards about evaluation splits.", "structured"],
  ["interview", "Ask one senior-engineer interview question about leakage."],
  ["summarize", "Summarize the evaluation rules in 3 short bullets."],
  ["study_plan", "Create a short study plan with 2 milestones for learning evaluation splits.", "structured"],
  ["answer_feedback", "Question: Should I tune using the test set? Learner answer: Yes, choose the best test score. Give brief corrective feedback.", "structured"],
  ["code_review", "Review this Python code for leakage in under 100 words: best = max(models, key=lambda m: m.score(X_test, y_test))"],
];
const results = [];
const profiles = (process.env.LUMEN_AI_PROFILES || "balanced,fast,deep").split(",").filter(Boolean);
const taskFilter = process.env.LUMEN_AI_TASKS?.split(",");
for (const responseProfile of profiles) {
  for (const [task, question, responseFormat = "markdown"] of cases) {
    if (taskFilter && !taskFilter.includes(task)) continue;
    // Balanced exercises every mode; other profiles exercise both transports.
    if (responseProfile !== "balanced" && !["explain", "flashcards"].includes(task)) continue;
    for (const transport of responseProfile === "balanced" ? ["json", "stream"] : [responseFormat === "structured" ? "json" : "stream"]) {
      const started = Date.now();
      let deltas = "";
      // Streamed phases reveal how often the first grounded draft needed a
      // regeneration (issue #58); JSON transport cannot observe them.
      const phases = [];
      try {
        const payload = { contract: AI_REQUEST_CONTRACT_ID, task, prompt: question, context, contextCitations: [1], documentTitle: "Evaluation basics", difficulty: "intermediate", history: [], webSearch: false, responseProfile, responseFormat };
        const response = await (transport === "stream" ? requestAiStream : requestAi)(payload, { baseUrl, timeoutMs: config.limits.clientTimeoutMs, onDelta: (text) => { deltas += text; }, onStatus: (message) => phases.push(message) });
        assert.equal(response.status, "completed");
        assert.ok(response.outputText.trim().length > 20, "No usable answer reached the client");
        assert.match(response.outputText, /\[S1\]/);
        assert.equal(response.webSearch.used, false);
        if (responseFormat === "structured") assert.equal(validateStructuredAiResult(task, response.data), true, "Invalid interactive learning result");
        else {
          assert.doesNotMatch(response.outputText.trim(), /^\{\s*"/, "A prose answer arrived as a JSON object");
          if (transport === "stream") assert.equal(deltas, response.outputText, "The visible stream differs from the saved answer");
        }
        if (task === "socratic") {
          assert.doesNotMatch(response.outputText, /^\s*(\*\*)?your question/i, "The Socratic reply copied a literal template prefix");
          assert.match(response.outputText, /\?/, "The Socratic reply did not ask a question");
        }
        results.push({
          task, responseProfile, transport, ok: true, ms: Date.now() - started, outputTokens: response.usage?.outputTokens, characters: response.outputText.length,
          ...(transport === "stream" ? { regenerations: phases.filter((message) => /citation check|raw JSON|reached its limit/i.test(message)).length } : {}),
        });
      } catch (error) {
        results.push({ task, responseProfile, transport, ok: false, ms: Date.now() - started, code: error.code, error: error.message });
      }
      console.log(JSON.stringify(results.at(-1)));
    }
  }
}
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, model: config.model, passed: results.length - failed.length, failed: failed.length }));
if (failed.length) process.exitCode = 1;
