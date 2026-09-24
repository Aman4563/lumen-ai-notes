import assert from "node:assert/strict";
import { test } from "node:test";
import { readAiServerConfig } from "./config.mjs";
import { createOllamaResponse, createOllamaStreamingResponse } from "./ollama.mjs";

const config = readAiServerConfig({ AI_ENABLED: "true" });
const request = {
  task: "explain", prompt: "Explain evaluation splits.", context: "", contextCitations: [],
  documentTitle: "", difficulty: "intermediate", history: [], responseFormat: "markdown",
  responseProfile: "deep", maxOutputTokens: 3_200, webSearch: false,
};
const cards = { cards: [{ front: "What selects hyperparameters?", back: "Validation data.", hint: "Model selection", tags: ["evaluation"] }] };
for (const stream of [false, true]) {
  for (const structured of [false, true]) {
    for (const doneReason of ["length", "stop"]) {
      test(`Deep ${stream ? "stream" : "JSON"} ${structured ? "cards" : "prose"} recovers from thinking-only ${doneReason}`, async () => {
        const bodies = [];
        const deltas = [];
        const phases = [];
        const output = structured ? JSON.stringify(cards) : "Validation data selects hyperparameters; the test data estimates generalization.";
        const result = await (stream ? createOllamaStreamingResponse : createOllamaResponse)({
          request: { ...request, ...(structured ? { task: "flashcards", responseFormat: "structured" } : {}) },
          config, requestId: "thinking-recovery",
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            const first = bodies.length === 1;
            const payload = { model: config.model, done: true, done_reason: first ? doneReason : "stop", message: { role: "assistant", content: first ? "" : output, ...(first ? { thinking: "PRIVATE_INTERNAL_REASONING" } : {}) }, prompt_eval_count: 100, eval_count: first ? 768 : 100 };
            return new Response(JSON.stringify(payload) + (stream ? "\n" : ""), { headers: { "Content-Type": stream ? "application/x-ndjson" : "application/json" } });
          },
          onDelta: (text) => deltas.push(text),
          onPhase: (phase) => phases.push(phase),
        });
        assert.equal(bodies.length, 2, "recovery must be bounded to one additional completion");
        assert.equal(bodies[0].think, true);
        assert.equal(bodies[0].options.num_predict, 768);
        assert.equal(bodies[1].think, false, "a thinking-only retry must not spend its answer budget on thinking again");
        assert.equal(bodies[1].options.num_predict, 3_200);
        assert.equal(result.outputText, output);
        assert.equal(result.status, "completed");
        if (structured) assert.deepEqual(result.data, cards);
        else if (stream) assert.equal(deltas.join(""), output);
        assert.doesNotMatch(JSON.stringify({ result, deltas, phases, bodies }), /PRIVATE_INTERNAL_REASONING/);
      });
    }
  }
}

test("Deep recovery discards an unfinished draft and still rejects an unfinished final answer", async () => {
  let calls = 0;
  const deltas = [];
  await assert.rejects(createOllamaStreamingResponse({
    request: { ...request, context: "[S1] Evaluation notes", contextCitations: [1] }, config, requestId: "bounded-recovery",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ done: true, done_reason: "length", message: { content: "UNFINISHED_DRAFT" } }) + "\n");
    },
    onDelta: (text) => deltas.push(text),
  }), (error) => error.code === "AI_INCOMPLETE_RESPONSE");
  assert.equal(calls, 2);
  assert.deepEqual(deltas, []);
});

for (const stream of [false, true]) {
  test(`${stream ? "stream" : "JSON"} flashcards repair missing citations using the supplied source ID`, async () => {
    const bodies = [];
    const deltas = [];
    const cited = { cards: [{ ...cards.cards[0], back: `${cards.cards[0].back} [S7]` }] };
    const result = await (stream ? createOllamaStreamingResponse : createOllamaResponse)({
      request: { ...request, task: "flashcards", responseProfile: "balanced", responseFormat: "structured", context: "[S7] Validation data selects hyperparameters.", contextCitations: [7] },
      config, requestId: "citation-repair",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const payload = { done: true, done_reason: "stop", message: { content: JSON.stringify(bodies.length === 1 ? cards : cited) } };
        return new Response(JSON.stringify(payload) + (stream ? "\n" : ""));
      },
      onDelta: (text) => deltas.push(text),
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].messages.at(-1).role, "user");
    assert.match(bodies[1].messages.at(-1).content, /\[S7\]/);
    assert.doesNotMatch(bodies[1].messages.at(-1).content, /\[S1\]/);
    assert.deepEqual(result.data, cited);
    assert.deepEqual(deltas, [], "unvalidated structured drafts must not appear as prose");
  });
}
