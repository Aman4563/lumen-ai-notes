import assert from "node:assert/strict";
import test from "node:test";

import { AI_REQUEST_CONTRACT_ID } from "./aiContract.js";
import {
  fitTutorRequest,
  minimumContextBudget,
  promptForSources,
  tutorActionIssueReason,
  tutorConversationWindow,
  tutorFollowUpWindow,
  tutorRequestIssue,
  tutorRequestLimits,
} from "./tutorRequest.js";

const utf8Bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const config = Object.freeze({
  limits: { maxInputChars: 24_000, maxRequestUtf8Bytes: 8_740, maxOutputTokens: 4_096 },
  responseProfiles: {
    outputTokens: { fast: 1_200, balanced: 3_000, deep: 4_096 },
    maxRequestUtf8Bytes: { fast: 10_000, balanced: 8_740, deep: 7_000 },
  },
});

const explain = Object.freeze({ task: "explain", structured: false, contextLimit: 12_000 });
const quiz = Object.freeze({ task: "quiz", structured: true });

const sources = [1, 2, 3].map((citationNumber) => ({
  citationNumber,
  title: `Lesson ${citationNumber}`,
  section: "Core",
  // Multi-byte text makes characters a poor proxy for wire bytes.
  text: `Evidence ${citationNumber}: ${"λ regularisation — ✓ ".repeat(220)}`,
}));

test("the fitted body is the canonical envelope, measured exactly", () => {
  const history = [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier answer" }];
  const fitted = fitTutorRequest({
    mode: explain,
    prompt: "  Why does ridge shrink weights?  ",
    sources,
    history,
    conversationSummary: "Older conversation memory",
    difficulty: "advanced",
    responseProfile: "balanced",
    config,
  });
  assert.deepEqual(Object.keys(fitted.payload).sort(), [
    "context", "contextCitations", "contract", "conversationSummary", "difficulty", "documentTitle",
    "history", "maxOutputTokens", "prompt", "responseFormat", "responseProfile", "task", "webSearch",
  ]);
  assert.equal(fitted.payload.contract, AI_REQUEST_CONTRACT_ID);
  assert.equal(fitted.payload.task, "explain");
  assert.equal(fitted.payload.responseFormat, "markdown");
  assert.equal(fitted.payload.difficulty, "advanced");
  assert.equal(fitted.payload.maxOutputTokens, 3_000);
  assert.equal(fitted.payload.webSearch, false);
  assert.equal(fitted.payload.documentTitle, "3 selected Lumen sources");
  assert.deepEqual(fitted.payload.history, history, "history passes through untouched");
  assert.match(fitted.payload.prompt, /^Why does ridge shrink weights\?\n\nUse the supplied \[S#\] labels/);
  assert.equal(fitted.bytes, utf8Bytes(fitted.payload), "bytes are the UTF-8 length of the serialized body");
  assert.ok(fitted.bytes <= 8_740, "the balanced profile's byte budget was exceeded");
});

test("the request's own profile owns the byte budget", () => {
  const base = { mode: explain, prompt: "Explain regularisation.", sources, config };
  const balanced = fitTutorRequest({ ...base, responseProfile: "balanced" });
  const deep = fitTutorRequest({ ...base, responseProfile: "deep" });
  assert.equal(balanced.maximumBytes, 8_740);
  assert.equal(deep.maximumBytes, 7_000);
  assert.ok(deep.bytes <= 7_000, `deep exceeded its budget: ${deep.bytes}`);
  assert.ok(deep.context.length < balanced.context.length, "deep did not shrink its context to fit a smaller budget");
  assert.equal(deep.payload.maxOutputTokens, 4_096);
  assert.equal(deep.payload.responseProfile, "deep");
});

test("only complete source blocks are included and reported", () => {
  const fitted = fitTutorRequest({ mode: explain, prompt: "Explain.", sources, responseProfile: "deep", config });
  const labels = [...fitted.payload.context.matchAll(/^\[S(\d+)\]/gm)].map((match) => Number(match[1]));
  assert.deepEqual(labels, fitted.includedCitationNumbers);
  assert.deepEqual(fitted.payload.contextCitations, fitted.includedCitationNumbers);
  assert.ok(fitted.includedCitationNumbers.length >= 1);
});

test("the task and format come from the request's mode, not a default", () => {
  const fitted = fitTutorRequest({ mode: quiz, prompt: "Quiz me.", sources: sources.slice(0, 1), responseProfile: "fast", config });
  assert.equal(fitted.payload.task, "quiz");
  assert.equal(fitted.payload.responseFormat, "structured");
  assert.equal(fitted.payload.documentTitle, "Lesson 1");
  assert.equal(fitted.payload.maxOutputTokens, 1_200);
  const sourceFree = fitTutorRequest({ mode: explain, prompt: "General question.", webSearch: true, config });
  assert.equal(sourceFree.payload.context, "");
  assert.deepEqual(sourceFree.payload.contextCitations, []);
  assert.equal(sourceFree.payload.documentTitle, "General AI/ML learning question");
  assert.equal(sourceFree.payload.webSearch, true);
  assert.match(sourceFree.payload.prompt, /No relevant library evidence was supplied/);
});

test("limits follow the configuration and fall back safely", () => {
  assert.deepEqual(tutorRequestLimits(config, "deep"), { inputLimit: 7_000, maximumBytes: 7_000, promptLimit: 3_360 });
  assert.deepEqual(tutorRequestLimits(null, "balanced"), { inputLimit: 16_000, maximumBytes: undefined, promptLimit: 5_700 });
  assert.equal(promptForSources("Hi", true), promptForSources("Hi", [{}]));
});

test("the conversation window keeps whole recent turns within its budget", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index % 2 ? "Answer" : "Question"} ${index}: ${"detail ".repeat(60)}`,
  }));
  const window = tutorConversationWindow(history, { prompt: "Follow up.", sources: true, inputLimit: 8_740 });
  assert.ok(window.messages.length > 0 && window.messages.length <= 12);
  assert.equal(window.messages.length % 2, 0, "a turn was split");
  assert.equal(window.messages.at(-1).content.startsWith("Answer 19"), true, "the newest turn was not kept");
  assert.ok(window.compactedMessages > 0);
  assert.match(window.conversationSummary, /^Older conversation memory/);
});

test("request issues are reported in the order a learner can fix them", () => {
  const limits = tutorRequestLimits(config, "balanced");
  const fitted = fitTutorRequest({ mode: explain, prompt: "Explain.", sources, config });
  assert.equal(tutorRequestIssue({ prompt: "   ", promptLimit: limits.promptLimit, fitted }), "empty-prompt");
  assert.equal(tutorRequestIssue({ prompt: "x".repeat(limits.promptLimit + 1), promptLimit: limits.promptLimit, fitted }), "prompt-too-long");
  assert.equal(tutorRequestIssue({ prompt: "Explain.", promptLimit: limits.promptLimit, fitted, sources, requireAllSources: true }), "");
  const cramped = { ...fitted, contextBudget: minimumContextBudget(sources) - 1 };
  assert.equal(tutorRequestIssue({ prompt: "Explain.", promptLimit: limits.promptLimit, fitted: cramped, sources, requireAllSources: true }), "context-too-small");
  assert.equal(tutorRequestIssue({ prompt: "Explain.", promptLimit: limits.promptLimit, fitted: cramped, sources }), "", "retrieved passages are refitted, not required up front");
  assert.equal(tutorRequestIssue({ prompt: "Explain.", promptLimit: limits.promptLimit, fitted: { ...fitted, bytes: fitted.maximumBytes + 1 } }), "request-too-large");
});

test("a follow-up keeps only its question and up to 3,000 characters of the answer", () => {
  const answer = `${"Ridge shrinks every weight toward zero. ".repeat(115)}END`;
  const pair = [
    { role: "user", content: "Why does ridge shrink weights?" },
    { role: "assistant", content: answer },
  ];
  const { inputLimit } = tutorRequestLimits(config, "balanced");
  const window = tutorFollowUpWindow(pair, { inputLimit });
  assert.equal(window.messages.length, 2);
  assert.equal(window.conversationSummary, "");
  assert.equal(window.compactedMessages, 0);
  assert.equal(window.messages[1].content.length, 3_000, "the answer keeps the per-message clip, not a quarter of the input budget");
  // The composer's window gives the same answer far less room.
  const composerWindow = tutorConversationWindow(pair, { prompt: "Simpler", sources: true, inputLimit });
  assert.ok(composerWindow.messages[1].content.length < window.messages[1].content.length);
  // Like any remembered turn, a pair shrinks to a smaller budget.
  const small = tutorFollowUpWindow(pair, { inputLimit: 2_000 });
  assert.equal(small.messages.length, 2);
  assert.ok(small.messages.reduce((total, message) => total + message.content.length, 0) <= 1_000);
  // An unanswered question is not a pair.
  assert.deepEqual(tutorFollowUpWindow(pair.slice(0, 1), { inputLimit }).messages, []);
});

test("an action that cannot start names what the learner must do", () => {
  assert.match(tutorActionIssueReason("disclosure"), /local-model permission/);
  assert.match(tutorActionIssueReason("request-too-large"), /request limit/);
  assert.equal(tutorActionIssueReason("not-ready", { configMessage: "The local Ollama service is not running." }), "The local Ollama service is not running.");
  assert.equal(tutorActionIssueReason(""), "");
  for (const issue of ["not-ready", "disclosure", "busy", "web-unavailable", "empty-prompt", "prompt-too-long", "context-too-small", "request-too-large"]) {
    assert.ok(tutorActionIssueReason(issue).length > 10, issue);
  }
});
