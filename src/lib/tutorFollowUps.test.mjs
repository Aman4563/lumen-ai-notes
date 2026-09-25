import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_FOLLOW_UPS,
  FLASHCARD_FOLLOW_UPS,
  QUIZ_FOLLOW_UPS,
  citedDocumentId,
  firstAnswerHeading,
  followUpPair,
  followUpRetrievalQuery,
  followUpScope,
  followUpsForMessage,
  questionForAnswer,
  withoutCitationLabels,
} from "./tutorFollowUps.js";

const answer = (overrides = {}) => ({ id: "a1", role: "assistant", mode: "explain", content: "## Ridge\n\nShrinks weights. [S2]", citationSources: [], ...overrides });

test("follow-ups appear only under a complete newest answer", () => {
  assert.equal(followUpsForMessage(answer(), { isLast: true }), ANSWER_FOLLOW_UPS);
  assert.deepEqual(followUpsForMessage(answer(), { isLast: false }), []);
  assert.deepEqual(followUpsForMessage(answer({ incomplete: true }), { isLast: true }), []);
  assert.deepEqual(followUpsForMessage(answer({ truncated: true }), { isLast: true }), []);
  assert.deepEqual(followUpsForMessage({ id: "u", role: "user", content: "Hi" }, { isLast: true }), []);
  assert.equal(followUpsForMessage(answer({ mode: "quiz", data: { title: "Q" } }), { isLast: true }), QUIZ_FOLLOW_UPS);
  assert.equal(followUpsForMessage(answer({ mode: "flashcards", data: { cards: [] } }), { isLast: true }), FLASHCARD_FOLLOW_UPS);
  assert.deepEqual(followUpsForMessage(answer({ mode: "study-plan", data: {} }), { isLast: true }), []);
  assert.deepEqual(followUpsForMessage(answer({ mode: "feedback", data: {} }), { isLast: true }), []);
  // Every chip uses a listed mode, never a hidden one.
  const modes = new Set([...ANSWER_FOLLOW_UPS, ...QUIZ_FOLLOW_UPS, ...FLASHCARD_FOLLOW_UPS].map((item) => item.modeId));
  assert.deepEqual([...modes].sort(), ["explain", "flashcards", "quiz", "socratic"]);
});

test("the remembered pair drops the earlier request's citation labels", () => {
  assert.equal(withoutCitationLabels("Ridge shrinks weights [S2] and [W1]."), "Ridge shrinks weights and.");
  assert.equal(withoutCitationLabels("Keep `a[S1]` text"), "Keep `a` text");
  const pair = followUpPair({ content: "Why ridge? [S1]" }, "## Ridge\n\nShrinks weights. [S2]");
  assert.deepEqual(pair, [
    { role: "user", content: "Why ridge?" },
    { role: "assistant", content: "## Ridge\n\nShrinks weights." },
  ]);
  assert.deepEqual(followUpPair(null, "text"), []);
});

test("the question an answer replied to is the nearest earlier user turn", () => {
  const history = [
    { id: "u1", role: "user", content: "First" },
    { id: "a1", role: "assistant", content: "One" },
    { id: "u2", role: "user", content: "Second" },
    { id: "a2", role: "assistant", content: "Two" },
  ];
  assert.equal(questionForAnswer(history, "a2").id, "u2");
  assert.equal(questionForAnswer(history, "a1").id, "u1");
  assert.equal(questionForAnswer(history, "u1"), null);
  assert.equal(questionForAnswer(history, "missing"), null);
});

test("retrieval uses the earlier question and the answer's topic", () => {
  assert.equal(firstAnswerHeading("```\n# not a heading\n```\n\n### **Ridge** penalty [S1]\n\n## Later"), "Ridge penalty");
  assert.equal(firstAnswerHeading("No headings here."), "");
  assert.equal(followUpRetrievalQuery({ content: "Why does ridge shrink weights?" }, answer()), "Why does ridge shrink weights? — Ridge");
  assert.equal(followUpRetrievalQuery({ content: "Quiz me" }, answer({ mode: "quiz", data: { title: "Bias and variance" } })), "Quiz me — Bias and variance");
  const long = followUpRetrievalQuery({ content: "word ".repeat(200) }, answer());
  assert.ok(long.length <= 300);
  assert.ok(long.endsWith("…"));
});

test("the cited document is the follow-up's retrieval hint", () => {
  assert.equal(citedDocumentId(answer({ citationSources: [{ id: "p1", original: { documentId: "notes/ridge.md" } }] })), "notes/ridge.md");
  assert.equal(citedDocumentId(answer({ citationSources: [{ id: "p1", original: { id: "notes/lasso.md" } }] })), "notes/lasso.md");
  assert.equal(citedDocumentId(answer()), "");
});

test("a follow-up keeps the grounding its answer had", () => {
  assert.deepEqual(followUpScope(answer({ retrievalTrace: { strategy: "library-first" } })), { sourceMode: "library-first" });
  assert.deepEqual(followUpScope(answer()), { sourceMode: "none" });
  const loaded = [{ id: "notes/a.md", text: "A" }, { id: "notes/b.md", text: "B" }];
  const attached = answer({ citationSources: [{ id: "notes/b.md" }] });
  assert.deepEqual(followUpScope(attached, loaded), { sourceMode: "choose", sources: [loaded[1]] });
  // A lesson whose text is no longer loaded is searched for instead.
  assert.deepEqual(followUpScope(answer({ citationSources: [{ id: "notes/c.md" }] }), loaded), { sourceMode: "library-first" });
});
