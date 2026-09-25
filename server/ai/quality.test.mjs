import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, test } from "node:test";

import { requestAi, requestAiStream } from "../../src/lib/aiClient.js";
import { AI_REQUEST_CONTRACT_ID } from "../../src/lib/aiContract.js";
import { createApplicationServer, silentLogger } from "../server.mjs";
import { readAiServerConfig } from "./config.mjs";
import { buildOllamaRequest, createOllamaResponse, createOllamaStreamingResponse, socraticTurnFraming, WEB_EVIDENCE_UNAVAILABLE_NOTICE } from "./ollama.mjs";
import { mistakeTutorRequest } from "../../src/lib/tutorBridge.js";
import { ANSWER_FOLLOW_UPS, withoutCitationLabels } from "../../src/lib/tutorFollowUps.js";
import { fitTutorRequest, tutorConversationWindow } from "../../src/lib/tutorRequest.js";
import { HINT_PROMPT, NEXT_QUESTION_PROMPT, REVEAL_PROMPT, SOCRATIC_START_PROMPT, sessionWrapUp } from "../../src/lib/tutorSession.js";
import { buildStarterPrompts } from "../../src/lib/tutorStarters.js";

// Answer-quality instructions and recovery paths for issue #58. Every model
// reply here is scripted; live qwen3.5:4b evidence is recorded separately in
// docs/FUNCTIONAL_TESTING.md.

const config = readAiServerConfig({ AI_ENABLED: "true", OLLAMA_MODEL: "test-model", AI_MAX_OUTPUT_TOKENS: "4096" });
const webConfig = readAiServerConfig({
  AI_ENABLED: "true",
  OLLAMA_MODEL: "test-model",
  AI_MAX_OUTPUT_TOKENS: "4096",
  WEB_SEARCH_ENABLED: "true",
  WEB_SEARCH_MAX_ROUNDS: "1",
});

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

const jsonReply = (content, extra = {}) => new Response(JSON.stringify({
  model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content, ...extra },
}), { headers: { "Content-Type": "application/json" } });

const streamReply = (parts, extra = {}) => new Response(`${[
  ...parts.map((content) => JSON.stringify({ model: "test-model", done: false, message: { role: "assistant", content } })),
  JSON.stringify({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "", ...extra } }),
].join("\n")}\n`, { headers: { "Content-Type": "application/x-ndjson" } });

// Runs one scripted conversation through either transport. `replies` holds
// the model's answer for each successive /api/chat call (a string, an array
// of streamed parts, or { toolQuery } for a search_web call).
const run = async ({ stream, request, replies, searchResults = [], runConfig = config }) => {
  const bodies = [];
  const deltas = [];
  const phases = [];
  // Phases and deltas in the order they were reported.
  const timeline = [];
  let searches = 0;
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname === "/search") {
      searches += 1;
      return new Response(JSON.stringify({ results: searchResults }), { headers: { "Content-Type": "application/json" } });
    }
    const body = JSON.parse(init.body);
    bodies.push(body);
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    if (reply?.toolQuery) {
      const toolCall = { tool_calls: [{ function: { name: "search_web", arguments: { query: reply.toolQuery } } }] };
      return stream ? streamReply([], toolCall) : jsonReply("", toolCall);
    }
    const parts = Array.isArray(reply) ? reply : [reply];
    return stream ? streamReply(parts) : jsonReply(parts.join(""));
  };
  const call = stream ? createOllamaStreamingResponse : createOllamaResponse;
  let result = null;
  let error = null;
  try {
    result = await call({
      request, config: runConfig, fetchImpl, requestId: "quality-test",
      onDelta: (text) => {
        deltas.push(text);
        if (timeline.at(-1) !== "delta") timeline.push("delta");
      },
      onPhase: ({ phase, message }) => {
        phases.push(message);
        timeline.push(phase);
      },
    });
  } catch (caught) {
    error = caught;
  }
  return { result, error, bodies, deltas, phases, timeline, searches };
};

const TRANSPORTS = [false, true];
const label = (stream) => (stream ? "stream" : "JSON");

// ---------------------------------------------------------------------------
// Task instructions (TF-8, TF-18, TF-19, TF-20)

test("Socratic describes its format instead of a literal 'Your question?' template", () => {
  const body = buildOllamaRequest({ ...baseRequest, task: "socratic" }, config);
  const prompt = lastUserOf(body);
  assert.doesNotMatch(JSON.stringify(body.messages), /Your question\?|Output pattern/i);
  assert.match(prompt, /ask exactly one new focused question grounded in the context above, and end it with the exact label of the supplied source that motivates it \(one of \[S1\]\)/i);
  assert.match(prompt, /Do not answer your new question/);
  assert.doesNotMatch(prompt, /assessment/, "a first Socratic turn has no learner answer to assess");

  const sourceFree = lastUserOf(buildOllamaRequest({ ...baseRequest, task: "socratic", context: "", contextCitations: [] }, config));
  assert.match(sourceFree, /ask exactly one new focused question\./i);
  assert.doesNotMatch(sourceFree, /\[S\d+\]/);
});

// Issue #82. Each Socratic turn gets its own framing, decided by the server
// from the learner's visible wording and the history's shape, never a
// conditional left to the model. The requests below are built by the
// client's own action builders, conversation window and fit path, so a
// change of wording or of history shaping on either side fails here.
const TUTOR_QUESTION = "Ridge adds a penalty on the size of the weights. As λ grows, what happens to the coefficients? [S1]";
const EXPLANATION = "## Ridge regression\n\nRidge shrinks every coefficient toward zero as λ grows, trading a little bias for lower variance. [S1]";
const HINT_TURN = "Think about the gradient of the penalty near zero. [S1]\n\nTry answering your previous question again.";
const ridgeSources = [{ citationNumber: 1, title: "Linear regression", section: "Ridge", text: "Ridge adds an L2 penalty that shrinks coefficients toward zero; it rarely sets one exactly to zero." }];
// An ordinary send keeps the turns' citation labels; a session action (hint,
// reveal, next question) sends them without (`unlabelled`). Either way the
// window collapses whitespace, as the client's memory does.
const tutorRequest = ({ task = "socratic", prompt, history = [], sources = ridgeSources, unlabelled = false }) => fitTutorRequest({
  mode: { task },
  prompt,
  sources,
  history: tutorConversationWindow(
    history.map((message) => ({ role: message.role, content: unlabelled ? withoutCitationLabels(message.content) : message.content })),
    { prompt, sources: sources.length > 0 },
  ).messages,
}).payload;
const bridged = mistakeTutorRequest({
  prompt: "What does ridge's L2 penalty do to the coefficients as λ grows?",
  expected: "It shrinks them toward zero but rarely makes any exactly zero.",
  response: "It sets the least important coefficients to exactly zero.",
});
const starterLesson = { id: "notes/part-05/01-linear.md", title: "Linear Regression and Regularization", isIndex: false, partNumber: 5, source: "builtin" };
const socraticStarter = buildStarterPrompts(
  { recent: starterLesson, last: starterLesson, mistakes: [], reviewItems: [] },
  { limit: 8, lessonText: () => "## Least squares\n\n## Ridge regression" },
).find((starter) => starter.modeId === "socratic");
const checkChip = ANSWER_FOLLOW_UPS.find((item) => item.id === "check").prompt;
const REVEAL_ANSWER = "Ridge's penalty gradient 2λw vanishes near zero, so coefficients shrink without reaching exactly zero. Does that make sense?";

const SOCRATIC_TURNS = [
  ["a session start", "open", { prompt: SOCRATIC_START_PROMPT }],
  ["a session start after an explanation", "open", { prompt: SOCRATIC_START_PROMPT, history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: EXPLANATION }] }],
  ["a lesson's Socratic starter", "open", { prompt: socraticStarter?.prompt }],
  ["Check my understanding after an answer that ends asking something", "open", { prompt: checkChip, history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: `${EXPLANATION}\n\nWant to see an example?` }] }],
  ["a hint request", "hint", { prompt: HINT_PROMPT, unlabelled: true, history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }] }],
  ["an older client's hint request", "hint", { prompt: "Give me one hint for your last question without revealing the answer.", unlabelled: true, history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }] }],
  ["a second hint request", "hint", { prompt: HINT_PROMPT, unlabelled: true, history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }, { role: "user", content: HINT_PROMPT }, { role: "assistant", content: HINT_TURN }] }],
  ["the next question after a reveal", "open", { prompt: NEXT_QUESTION_PROMPT, unlabelled: true, history: [{ role: "user", content: REVEAL_PROMPT }, { role: "assistant", content: REVEAL_ANSWER }] }],
  ["an older client's next question after a reveal", "open", { prompt: "Ask me the next question in this session.", unlabelled: true, history: [{ role: "user", content: REVEAL_PROMPT }, { role: "assistant", content: REVEAL_ANSWER }] }],
  ["a mistake from the notebook", "diagnose", { prompt: bridged.prompt }],
  ["an older client's mistake from the notebook", "diagnose", { prompt: "Work through this mistake with me, one question at a time. Start by asking what I think went wrong, and do not give me the answer straight away.\n\nQuestion: Why?\nExpected answer: Because." }],
  ["the learner's reply to the diagnostic question", "answer", { prompt: "I mixed ridge up with lasso.", history: [{ role: "user", content: bridged.prompt }, { role: "assistant", content: "What made you expect exact zeros? [S1]" }] }],
  ["an answer to the tutor's question", "answer", { prompt: "They get smaller but never exactly zero.", history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }] }],
  ["an answer after a hint that asks to try again", "answer", { prompt: "The pull weakens near zero, so they never reach it.", history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }, { role: "user", content: HINT_PROMPT }, { role: "assistant", content: HINT_TURN }] }],
  ["an answer to a question whose label sits on its own line", "answer", { prompt: "They shrink toward zero.", history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: "Ridge adds a penalty on the weights. As λ grows, what happens to the coefficients?\n\n[S1]" }] }],
  ["an answer to a question in bold", "answer", { prompt: "They shrink toward zero.", history: [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: "Ridge adds a penalty on the weights.\n\n**As λ grows, what happens to the coefficients?** [S1]" }] }],
  ["an answer to an answer check's own question", "answer", { prompt: "What does λ control in ridge?\n\nMy answer: The strength of the penalty on the weights.", history: [{ role: "user", content: "Check my answer." }, { role: "assistant", content: "Not quite: ridge keeps every feature. [S1]" }] }],
  ["free text after an explanation that asked nothing", "open", { prompt: "Now question me on ridge.", history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: EXPLANATION }] }],
  ["free text after an offer of an example", "open", { prompt: "Yes, then quiz me on it.", history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: `${EXPLANATION}\n\nWould you like to see a worked example?` }] }],
  ["free text after a rhetorical question mid-answer", "open", { prompt: "Question me on this.", history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: "Why does ridge help? Correlated features stop fighting over one weight. [S1]" }] }],
  ["free text after a question that is only a heading", "open", { prompt: "Question me on this.", history: [{ role: "user", content: "Explain ridge." }, { role: "assistant", content: "## Why does ridge shrink?\n\nThe penalty grows with the weights. [S1]" }] }],
  ["free text after a question inside code only", "open", { prompt: "Question me on this.", history: [{ role: "user", content: "Show code." }, { role: "assistant", content: "Use this:\n\n```python\nok = input('ready?')\n```" }] }],
];

test("the framing reads history as the client's window sends it", () => {
  // The window collapses whitespace and keeps citation labels on ordinary
  // sends, so paragraph breaks cannot be what marks the closing question.
  const sent = tutorRequest(SOCRATIC_TURNS.find(([name]) => name === "an answer to a question whose label sits on its own line")[2]);
  assert.equal(sent.history.at(-1).content, "Ridge adds a penalty on the weights. As λ grows, what happens to the coefficients? [S1]");
  assert.equal(socraticTurnFraming(sent), "answer");
  const heading = tutorRequest(SOCRATIC_TURNS.find(([name]) => name === "free text after a question that is only a heading")[2]);
  assert.equal(heading.history.at(-1).content, "## Why does ridge shrink? The penalty grows with the weights. [S1]");
  assert.equal(socraticTurnFraming(heading), "open");
});

test("each tutor action's Socratic request lands in its own framing", () => {
  assert.ok(socraticStarter, "the starters offered no Socratic start");
  for (const [name, framing, turn] of SOCRATIC_TURNS) {
    assert.equal(socraticTurnFraming(tutorRequest(turn)), framing, name);
  }
});

test("only an answer to the tutor's question is assessed; other turns are told there is none", () => {
  for (const [name, framing, turn] of SOCRATIC_TURNS) {
    const body = buildOllamaRequest(tutorRequest(turn), config);
    const system = systemOf(body);
    const prompt = lastUserOf(body);
    const format = prompt.slice(prompt.lastIndexOf("Required response format:"));
    if (framing === "answer") {
      assert.match(system, /The learner has just answered your previous question: first assess that answer in one or two sentences/, name);
      assert.match(format, /^Required response format: open with a one- or two-sentence assessment of the learner's answer to your previous question that says whether it is correct, partly correct, or a misconception, and why; then ask exactly one new focused question grounded in the context above, and end it with the exact label of the supplied source that motivates it \(one of \[S1\]\)/, name);
      continue;
    }
    assert.doesNotMatch(`${system}\n${format}`, /assessment|first assess|has just answered/, `${name}: an assessment instruction reached a turn with no answer`);
    assert.match(format, /Do not praise, assess, or correct anything|do not praise, assess, or correct anything|do not say whether their earlier answer was right or wrong/, name);
    if (framing === "hint") {
      assert.match(system, /asks for a hint, so there is no learner answer to assess, praise, or correct/, name);
      assert.match(format, /this is a hint request, not an answer\. Do not praise, assess, or correct anything\. Give exactly one short hint grounded in the context above, and end the hint with the exact label of the supplied source that motivates it \(one of \[S1\]\)\. Then ask the learner to try your previous question again\. Do not reveal the answer, do not ask a new question/, name);
    } else if (framing === "diagnose") {
      assert.match(system, /first ask one diagnostic question about what they think went wrong, and explain only after they reply/, name);
      assert.match(format, /reply with exactly one short diagnostic question and nothing else, at most two sentences/, name);
      assert.match(format, /End it with the exact label of the supplied source that covers the original question \(one of \[S1\]\), without saying what that source states/, name);
      assert.match(format, /do not state, paraphrase, or hint at the expected answer or any fact from the sources/, name);
    } else {
      assert.match(system, /has not answered a question of yours in this line of questioning, so there is no learner answer to assess, praise, or correct, and your own earlier turns are not their answers/, name);
      assert.match(format, /the learner has not answered a question of yours yet, so do not praise, assess, or correct anything, and do not refer to a previous answer of theirs\. Ask exactly one new focused question grounded in the context above/, name);
    }
  }
});

test("reveals and wrap-ups carry no Socratic framing at all", () => {
  const history = [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }];
  const reveal = buildOllamaRequest(tutorRequest({ task: "explain", prompt: REVEAL_PROMPT, history }), config);
  const wrap = sessionWrapUp([
    { role: "user", mode: "socratic", content: SOCRATIC_START_PROMPT },
    { role: "assistant", mode: "socratic", content: TUTOR_QUESTION },
    { role: "user", mode: "hint", content: HINT_PROMPT },
    { role: "assistant", mode: "hint", content: "Think about the gradient near zero. [S1]" },
  ]);
  const wrapUp = buildOllamaRequest(tutorRequest({ task: "summarize", prompt: wrap.prompt, history: wrap.historyWindow.messages, sources: [] }), config);
  for (const [name, body] of [["reveal", reveal], ["wrap-up", wrapUp]]) {
    const text = `${systemOf(body)}\n${lastUserOf(body)}`;
    assert.doesNotMatch(text, /Required response format|assess/, `${name} was framed as a Socratic turn`);
  }
  assert.match(lastUserOf(wrapUp), /I have not answered any of your questions yet, so do not credit me with anything/);
});

test("a hint's grounding repair asks for a cited hint, not a new question", async () => {
  const history = [{ role: "user", content: SOCRATIC_START_PROMPT }, { role: "assistant", content: TUTOR_QUESTION }];
  const { result, error, bodies } = await run({
    stream: true,
    request: tutorRequest({ prompt: HINT_PROMPT, history }),
    replies: ["Think about the gradient near zero.", "Think about the gradient near zero. [S1] Try the question again."],
  });
  assert.equal(error, null, error?.message);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].messages.at(-1).content, /Your hint itself must cite the supplied source that supports it, without revealing the answer/);
  assert.doesNotMatch(bodies[1].messages.at(-1).content, /Your question itself must cite/);
  assert.match(result.outputText, /\[S1\]/);
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

// ---------------------------------------------------------------------------
// TF-13: an empty authorized web search degrades to the library evidence

const webRequest = Object.freeze({
  ...baseRequest,
  ...twoSources,
  prompt: "What are the newest features in the latest release this month?",
  webSearch: true,
});

test("the empty-web notice is plain Markdown that cannot be mistaken for a citation", () => {
  assert.match(WEB_EVIDENCE_UNAVAILABLE_NOTICE, /^> \*\*Current-web evidence unavailable\.\*\*/);
  assert.doesNotMatch(WEB_EVIDENCE_UNAVAILABLE_NOTICE, /\[[SW]\d+\]/);
  assert.match(WEB_EVIDENCE_UNAVAILABLE_NOTICE, /\n\n$/);
});

for (const stream of TRANSPORTS) {
  test(`${label(stream)}: an empty web search with library evidence returns a labeled library-only answer`, async () => {
    const answer = "Your library covers how validation data selects hyperparameters [S1]. The newest release is newer than these sources.";
    const { result, error, bodies, deltas, phases, searches } = await run({
      stream,
      runConfig: webConfig,
      request: webRequest,
      replies: [{ toolQuery: "latest release features this month" }, answer],
    });
    assert.equal(error, null, error?.message);
    assert.equal(searches, 1);
    assert.equal(bodies.length, 2, "the library-only answer needs no extra generation when it already cites the library");
    assert.equal(result.outputText, `${WEB_EVIDENCE_UNAVAILABLE_NOTICE}${answer}`);
    assert.deepEqual(result.webSearch, { requested: true, used: false, rounds: 1 }, "a search that returned nothing must not be reported as used web evidence");
    assert.deepEqual(result.sources, []);
    const tool = bodies[1].messages.find((message) => message.role === "tool");
    assert.match(tool.content, /answer only from the supplied curriculum sources/);
    assert.match(tool.content, /do not claim that the missing information does not exist/);
    assert.match(tool.content, /do not mention searches, citation labels, or these instructions/);
    if (stream) {
      assert.equal(deltas.join(""), result.outputText, "streamed deltas must equal the envelope outputText");
      assert.match(phases.join("\n"), /No usable current-web evidence was found/);
    }
  });

  test(`${label(stream)}: an indented library-only draft cannot become a code block under the notice`, async () => {
    const { result, error, deltas } = await run({
      stream,
      runConfig: webConfig,
      request: webRequest,
      replies: [{ toolQuery: "latest release features this month" }, "\n    Validation data selects hyperparameters [S1]."],
    });
    assert.equal(error, null, error?.message);
    assert.equal(result.outputText, `${WEB_EVIDENCE_UNAVAILABLE_NOTICE}Validation data selects hyperparameters [S1].`);
    if (stream) assert.equal(deltas.join(""), result.outputText);
  });

  test(`${label(stream)}: relevance-filtered web results degrade the same way as an empty search`, async () => {
    const { result, error } = await run({
      stream,
      runConfig: webConfig,
      request: webRequest,
      searchResults: [{ title: "Slow cooker chili", url: "https://example.org/chili", content: "Brown the onions, then simmer beans for six hours." }],
      replies: [{ toolQuery: "latest release features this month" }, "From the library: validation data selects hyperparameters [S1]."],
    });
    assert.equal(error, null, error?.message);
    assert.equal(result.webSearch.used, false);
    assert.deepEqual(result.sources, []);
    assert.ok(result.outputText.startsWith(WEB_EVIDENCE_UNAVAILABLE_NOTICE));
  });

  test(`${label(stream)}: a library-only rescue that cites absent web evidence regenerates once without [W#]`, async () => {
    const { result, error, bodies, deltas } = await run({
      stream,
      runConfig: webConfig,
      request: webRequest,
      replies: [{ toolQuery: "latest release" }, "Version 9 shipped [W1] and validation selects hyperparameters [S1].", "Validation data selects hyperparameters [S1]."],
    });
    assert.equal(error, null, error?.message);
    assert.equal(bodies.length, 3);
    assert.match(systemOf(bodies[2]), /returned no usable public evidence, so use no \[W#\] label and answer only from the supplied library sources/);
    assert.equal(result.outputText, `${WEB_EVIDENCE_UNAVAILABLE_NOTICE}Validation data selects hyperparameters [S1].`);
    assert.doesNotMatch(result.outputText, /\[W\d+\]/);
    if (stream) assert.equal(deltas.join(""), result.outputText);
  });

  test(`${label(stream)}: a library-only rescue that still fails validation reports the empty search`, async () => {
    const { error, bodies, deltas } = await run({
      stream,
      runConfig: webConfig,
      request: webRequest,
      replies: [{ toolQuery: "latest release" }, "Version 9 shipped [W1]."],
    });
    assert.equal(error?.code, "WEB_SEARCH_NO_RESULTS");
    assert.equal(bodies.length, 3, "only one bounded recovery turn is allowed");
    assert.deepEqual(deltas, []);
  });

  test(`${label(stream)}: an empty web search still fails closed without library evidence or for structured output`, async () => {
    const sourceFree = await run({
      stream,
      runConfig: webConfig,
      request: { ...webRequest, context: "", contextCitations: [], documentTitle: "" },
      replies: [{ toolQuery: "latest release" }, "An unsupported current claim."],
    });
    assert.equal(sourceFree.error?.code, "WEB_SEARCH_NO_RESULTS");
    assert.deepEqual(sourceFree.deltas, []);

    const structured = await run({
      stream,
      runConfig: webConfig,
      request: { ...webRequest, task: "flashcards", responseFormat: "structured" },
      replies: [{ toolQuery: "latest release" }, JSON.stringify({ cards: [{ front: "Q", back: "A [S1]", hint: null, tags: [] }] })],
    });
    assert.equal(structured.error?.code, "WEB_SEARCH_NO_RESULTS", "a structured result has no visible place for the library-only notice");
  });
}

// ---------------------------------------------------------------------------
// Raw JSON returned for a prose task

const jsonDraft = JSON.stringify({ lesson_summary: { core_concept: "OLS minimizes squared residuals [S1].", short_example: "$\\hat y = Xw$" } });

for (const stream of TRANSPORTS) {
  test(`${label(stream)}: a grounded prose answer returned as a JSON object is regenerated once as Markdown`, async () => {
    const prose = "Ordinary least squares minimizes the sum of squared residuals [S1].";
    const { result, error, bodies, deltas, phases } = await run({
      stream,
      request: baseRequest,
      replies: [jsonDraft, prose],
    });
    assert.equal(error, null, error?.message);
    assert.equal(bodies.length, 2);
    assert.match(systemOf(bodies[1]), /Format recovery: the previous draft was discarded because it was a JSON object/);
    assert.match(lastUserOf(bodies[1]), /Write the explain answer again now as Markdown prose, not JSON\. Keep citing the supplied library labels where supported: \[S1\]\./);
    assert.equal(result.outputText, prose);
    if (stream) {
      assert.deepEqual(deltas, [prose], "the JSON draft never reaches the browser");
      assert.match(phases.join("\n"), /raw JSON instead of prose/);
    }
  });

  test(`${label(stream)}: a second JSON draft fails typed and nothing is shown`, async () => {
    const { error, bodies, deltas } = await run({ stream, request: baseRequest, replies: [jsonDraft] });
    assert.equal(error?.code, "AI_CONTRACT_ERROR");
    assert.equal(bodies.length, 2);
    assert.deepEqual(deltas, []);
  });

  test(`${label(stream)}: JSON-shaped output with invalid escapes is still treated as a format failure`, async () => {
    const invalidJson = "{\n  \"summary\": \"The prediction $\\hat y$ is linear in the weights [S1].\"\n}";
    assert.throws(() => JSON.parse(invalidJson));
    const { result, error, bodies } = await run({ stream, request: baseRequest, replies: [invalidJson, "Predictions are linear in the weights [S1]."] });
    assert.equal(error, null, error?.message);
    assert.equal(bodies.length, 2);
    assert.equal(result.outputText, "Predictions are linear in the weights [S1].");
  });

  test(`${label(stream)}: prose that contains or quotes JSON is not mistaken for a JSON answer`, async () => {
    for (const answer of [
      "A config can be written as JSON [S1]:\n\n```json\n{\"alpha\": 0.1}\n```",
      "[Least squares](https://example.org/ols) minimizes squared residuals [S1].",
    ]) {
      const { result, error, bodies } = await run({ stream, request: baseRequest, replies: [answer] });
      assert.equal(error, null, error?.message);
      assert.equal(bodies.length, 1);
      assert.equal(result.outputText, answer);
    }
  });
}

test("source-free live prose that opens as JSON is held back, then replaced by a Markdown answer", async () => {
  const request = { ...baseRequest, context: "", contextCitations: [], documentTitle: "" };
  const prose = "Least squares minimizes squared residuals.";
  const { result, error, bodies, deltas } = await run({
    stream: true,
    request,
    replies: [["{\"answer\": ", "\"Least squares\"}"], [prose]],
  });
  assert.equal(error, null, error?.message);
  assert.equal(bodies.length, 2);
  assert.deepEqual(deltas, [prose]);
  assert.equal(result.outputText, prose);
});

test("source-free live prose still streams before the terminal event", async () => {
  const request = { ...baseRequest, context: "", contextCitations: [], documentTitle: "" };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deltas = [];
  let firstDeltaBeforeTerminal = false;
  const resultPromise = createOllamaStreamingResponse({
    request,
    config,
    requestId: "live-prose",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        const line = (value) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
        line({ model: "test-model", done: false, message: { role: "assistant", content: "  Least " } });
        line({ model: "test-model", done: false, message: { role: "assistant", content: "squares " } });
        gate.then(() => {
          line({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "fits lines." } });
          controller.close();
        });
      },
    }), { headers: { "Content-Type": "application/x-ndjson" } }),
    onDelta: (text) => {
      deltas.push(text);
      if (deltas.length === 2) firstDeltaBeforeTerminal = true;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const streamedEarly = firstDeltaBeforeTerminal;
  release();
  const result = await resultPromise;
  assert.equal(streamedEarly, true, "the JSON guard must not buffer ordinary source-free prose");
  assert.deepEqual(deltas, ["  Least ", "squares ", "fits lines."]);
  assert.equal(result.outputText, deltas.join(""));
});

test("source-free live prose that opens with a Markdown link still streams live", async () => {
  const request = { ...baseRequest, context: "", contextCitations: [], documentTitle: "" };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deltas = [];
  const resultPromise = createOllamaStreamingResponse({
    request,
    config,
    requestId: "live-link-prose",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        const line = (value) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
        line({ model: "test-model", done: false, message: { role: "assistant", content: "[Least squares](https://example.org/ols) " } });
        gate.then(() => {
          line({ model: "test-model", done: true, done_reason: "stop", message: { role: "assistant", content: "fits lines." } });
          controller.close();
        });
      },
    }), { headers: { "Content-Type": "application/x-ndjson" } }),
    onDelta: (text) => deltas.push(text),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const streamedEarly = deltas.length === 1;
  release();
  const result = await resultPromise;
  assert.equal(streamedEarly, true, "only an opening '{' is held; '[' opens ordinary Markdown");
  assert.equal(result.outputText, "[Least squares](https://example.org/ols) fits lines.");
  assert.equal(deltas.join(""), result.outputText);
});

test("a length-stopped source-free answer that opens with a link keeps its visible partial", async () => {
  const request = { ...baseRequest, context: "", contextCitations: [], documentTitle: "" };
  const bodies = [];
  const deltas = [];
  const error = await createOllamaStreamingResponse({
    request,
    config,
    requestId: "live-link-length",
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(`${[
        JSON.stringify({ model: "test-model", done: false, message: { role: "assistant", content: "[Least squares](https://example.org/ols) " } }),
        JSON.stringify({ model: "test-model", done: false, message: { role: "assistant", content: "minimizes" } }),
        JSON.stringify({ model: "test-model", done: true, done_reason: "length", message: { role: "assistant", content: "" } }),
      ].join("\n")}\n`, { headers: { "Content-Type": "application/x-ndjson" } });
    },
    onDelta: (text) => deltas.push(text),
  }).then(() => null, (caught) => caught);
  assert.equal(error?.code, "AI_INCOMPLETE_RESPONSE");
  assert.equal(bodies.length, 1, "live text cannot be replaced by a regeneration");
  assert.deepEqual(deltas, ["[Least squares](https://example.org/ols) ", "minimizes"], "the learner keeps the partial that was already streamed");
});

test("a bare JSON array that streamed live still fails typed instead of completing", async () => {
  const request = { ...baseRequest, context: "", contextCitations: [], documentTitle: "" };
  const { result, error, bodies, deltas } = await run({ stream: true, request, replies: [["[\"bias\", ", "\"variance\"]"]] });
  assert.equal(result, null);
  assert.equal(error?.code, "AI_CONTRACT_ERROR", "the browser discards a partial that failed this validation");
  assert.equal(bodies.length, 1, "streamed text cannot be replaced by a regeneration");
  assert.equal(deltas.join(""), "[\"bias\", \"variance\"]");
});

// ---------------------------------------------------------------------------
// TF-19: syntax-only citation repair, never label fabrication

for (const stream of TRANSPORTS) {
  test(`${label(stream)}: grouped and spaced labels the model wrote are normalized without another generation`, async () => {
    const { result, error, bodies, deltas } = await run({
      stream,
      request: { ...baseRequest, ...twoSources },
      replies: ["Tune on validation data and fit preprocessing per fold [S1, S2]. Never tune on test data [S 1]."],
    });
    assert.equal(error, null, error?.message);
    assert.equal(bodies.length, 1);
    assert.equal(result.outputText, "Tune on validation data and fit preprocessing per fold [S1] [S2]. Never tune on test data [S1].");
    if (stream) assert.equal(deltas.join(""), result.outputText);
  });

  test(`${label(stream)}: normalization leaves code untouched, guesses no case, and still rejects unresolved labels`, async () => {
    const inCode = await run({ stream, request: { ...baseRequest, ...twoSources }, replies: ["Write it as `[S1, S2]` in notes."] });
    assert.equal(inCode.error?.code, "AI_CURRICULUM_UNGROUNDED");
    assert.equal(inCode.bodies.length, 2, "an uncited draft uses the model regeneration, not a server-added label");

    const lowercase = await run({ stream, request: baseRequest, replies: ["Least squares minimizes residuals [s1]."] });
    assert.equal(lowercase.error?.code, "AI_CURRICULUM_UNGROUNDED");

    const unresolved = await run({ stream, request: baseRequest, replies: ["Least squares minimizes residuals [S1, S9]."] });
    assert.equal(unresolved.error?.code, "AI_CURRICULUM_UNGROUNDED");
    assert.deepEqual(unresolved.deltas, []);
  });

  test(`${label(stream)}: source-free prose is released exactly as written, without label repair`, async () => {
    const answer = "A grouped marker such as [S1, S2] or [S 1] stays plain text without supplied sources.";
    const { result, error, deltas } = await run({ stream, request: { ...baseRequest, context: "", contextCitations: [], documentTitle: "" }, replies: [answer] });
    assert.equal(error, null, error?.message);
    assert.equal(result.outputText, answer);
    if (stream) assert.equal(deltas.join(""), answer);
  });

  test(`${label(stream)}: an uncited single-source draft is regenerated, never labelled by the server`, async () => {
    const uncited = "Ordinary least squares chooses weights that minimize the sum of squared residuals.";
    const failed = await run({ stream, request: baseRequest, replies: [uncited] });
    assert.equal(failed.error?.code, "AI_CURRICULUM_UNGROUNDED");
    assert.equal(failed.bodies.length, 2);
    assert.deepEqual(failed.deltas, []);

    const recovered = await run({ stream, request: baseRequest, replies: [uncited, `${uncited} [S1]`] });
    assert.equal(recovered.error, null);
    assert.equal(recovered.result.outputText, `${uncited} [S1]`);
  });

  test(`${label(stream)}: a copied 'Your question?' prefix is removed from a grounded Socratic reply`, async () => {
    const { result, error, deltas } = await run({
      stream,
      request: { ...baseRequest, task: "socratic" },
      replies: [["**Your question?** Why does squaring ", "the residuals penalize large errors more? [S1]"]],
    });
    assert.equal(error, null, error?.message);
    assert.equal(result.outputText, "Why does squaring the residuals penalize large errors more? [S1]");
    if (stream) assert.equal(deltas.join(""), result.outputText);
  });
}

// ---------------------------------------------------------------------------
// The browser client accepts the degraded web envelope on both transports.

const runningServers = new Set();
afterEach(async () => {
  await Promise.all([...runningServers].map((server) => new Promise((resolve) => server.close(resolve))));
  runningServers.clear();
});

test("the real browser client validates a library-only answer after an empty web search", async () => {
  let chatCalls = 0;
  const { server } = createApplicationServer({
    env: {
      HOST: "127.0.0.1",
      PORT: "0",
      AI_ENABLED: "true",
      OLLAMA_MODEL: "test-model",
      AI_MAX_OUTPUT_TOKENS: "4096",
      AI_STREAM_HEARTBEAT_MS: "30000",
      WEB_SEARCH_ENABLED: "true",
      WEB_SEARCH_MAX_ROUNDS: "1",
    },
    logger: silentLogger,
    fetchImpl: async (url, init) => {
      const { pathname } = new URL(url);
      if (pathname === "/search") return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json" } });
      const body = JSON.parse(init.body);
      chatCalls += 1;
      const toolTurn = Array.isArray(body.tools);
      const payload = toolTurn
        ? { tool_calls: [{ function: { name: "search_web", arguments: { query: "latest release" } } }], content: "" }
        : { content: "Validation data selects hyperparameters [S1]." };
      return body.stream
        ? streamReply([], payload.tool_calls ? { tool_calls: payload.tool_calls } : { content: payload.content })
        : jsonReply(payload.content, payload.tool_calls ? { tool_calls: payload.tool_calls } : {});
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  runningServers.add(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let streamed = "";
  const streamedResponse = await requestAiStream({ ...webRequest }, { baseUrl, onDelta: (text) => { streamed += text; } });
  const jsonResponse = await requestAi({ ...webRequest }, { baseUrl });
  for (const response of [streamedResponse, jsonResponse]) {
    assert.equal(response.status, "completed");
    assert.equal(response.outputText, `${WEB_EVIDENCE_UNAVAILABLE_NOTICE}Validation data selects hyperparameters [S1].`);
    assert.deepEqual(response.webSearch, { requested: true, used: false, rounds: 1 });
    assert.deepEqual(response.sources, []);
  }
  assert.equal(streamed, streamedResponse.outputText);
  assert.equal(chatCalls, 4);
});

// ---------------------------------------------------------------------------
// Issue #82: validating is reported before a draft is checked, once per
// draft, on both transports. Live, it came after the check had passed, in the
// same millisecond as the answer and its completion.

const CITATIONS_CHECK = "Checking the answer's citations against the supplied sources.";

for (const stream of TRANSPORTS) {
  test(`${label(stream)}: grounded prose reports validating before it is checked and released`, async () => {
    const { result, error, timeline, phases } = await run({ stream, request: baseRequest, replies: [["Least squares minimizes ", "squared residuals. [S1]"]] });
    assert.equal(error, null, error?.message);
    assert.deepEqual(timeline, stream ? ["generating", "validating", "delta"] : ["generating", "validating"]);
    assert.equal(phases[1], CITATIONS_CHECK);
    assert.equal(result.outputText, "Least squares minimizes squared residuals. [S1]");
  });

  test(`${label(stream)}: a draft that fails its citation check is validated again after one regeneration`, async () => {
    const { result, error, timeline, phases } = await run({ stream, request: baseRequest, replies: ["Least squares minimizes squared residuals.", "Least squares minimizes squared residuals. [S1]"] });
    assert.equal(error, null, error?.message);
    assert.deepEqual(timeline, [...["generating", "validating", "generating", "validating"], ...(stream ? ["delta"] : [])]);
    assert.match(phases[2], /failed its citation check/);
    assert.equal(result.outputText, "Least squares minimizes squared residuals. [S1]");
  });

  test(`${label(stream)}: a draft that fails its check twice is never released, and validating stays bounded`, async () => {
    const { error, timeline, deltas } = await run({ stream, request: baseRequest, replies: ["Uncited.", "Still uncited."] });
    assert.equal(error?.code, "AI_CURRICULUM_UNGROUNDED");
    assert.deepEqual(timeline, ["generating", "validating", "generating", "validating"]);
    assert.deepEqual(deltas, []);
  });

  test(`${label(stream)}: structured and source-free drafts get their own validating message`, async () => {
    const cards = { cards: [{ front: "What does OLS minimize?", back: "The sum of squared residuals. [S1]", hint: "", tags: ["ols"] }] };
    const structured = await run({ stream, request: { ...baseRequest, task: "flashcards", responseFormat: "structured" }, replies: [JSON.stringify(cards)] });
    assert.equal(structured.error, null, structured.error?.message);
    assert.deepEqual(structured.timeline, ["generating", "validating"]);
    assert.equal(structured.phases[1], "Checking the structured result against its schema and citations.");

    const sourceFree = await run({ stream, request: { ...baseRequest, context: "", contextCitations: [] }, replies: [["Least squares ", "minimizes squared residuals."]] });
    assert.equal(sourceFree.error, null, sourceFree.error?.message);
    // Source-free prose streams live, so its check follows the text.
    assert.deepEqual(sourceFree.timeline, stream ? ["generating", "delta", "validating"] : ["generating", "validating"]);
    assert.equal(sourceFree.phases.at(-1), "Checking that the answer is complete before finalizing it.");
  });
}

test("the stream endpoint sends validating before the grounded answer and its completion; JSON keeps its shape", async () => {
  const { server } = createApplicationServer({
    env: { HOST: "127.0.0.1", PORT: "0", AI_ENABLED: "true", OLLAMA_MODEL: "test-model", AI_MAX_OUTPUT_TOKENS: "4096", AI_STREAM_HEARTBEAT_MS: "30000" },
    logger: silentLogger,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return body.stream ? streamReply(["Least squares minimizes ", "squared residuals. [S1]"]) : jsonReply("Least squares minimizes squared residuals. [S1]");
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  runningServers.add(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/ai/respond/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(baseRequest) });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const order = events.map((event) => (event.type === "phase" ? event.phase : event.type)).filter((type, index, all) => type !== "delta" || all[index - 1] !== "delta");
  assert.deepEqual(order, ["start", "approach", "preparing", "generating", "validating", "delta", "complete"]);
  assert.equal(events.find((event) => event.phase === "validating").message, CITATIONS_CHECK);

  const json = await requestAi({ ...baseRequest }, { baseUrl });
  assert.equal(json.outputText, "Least squares minimizes squared residuals. [S1]");
  assert.deepEqual(Object.keys(json).sort(), ["approach", "data", "model", "ok", "outputText", "requestId", "sources", "status", "usage", "webSearch"]);
});
