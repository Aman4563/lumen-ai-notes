import assert from "node:assert/strict";
import test from "node:test";

import { validateStructuredAiResult } from "../../server/ai/contracts.mjs";
import {
  QUIZ_STATE_KEY,
  answerFeedbackPrompt,
  feedbackRetrievalQuery,
  normalizeQuizState,
  pruneQuizStates,
  quizMissDrafts,
  quizSummary,
  readQuizStates,
  validateTutorAnswerFeedback,
  weakSpotQuiz,
  writeQuizStates,
} from "./tutorQuiz.js";

const quiz = {
  title: "Regularisation",
  instructions: "Pick one.",
  questions: [
    { id: "q1", prompt: "What does ridge add? [S1]", options: ["An L1 penalty", "An L2 penalty [S2]", "Dropout"], correctIndex: 1, explanation: "Ridge adds λ‖w‖². [S1]", difficulty: "beginner" },
    { id: "q2", prompt: "What does lasso encourage?", options: ["Sparsity", "Smoothness"], correctIndex: 0, explanation: "Corners at zero.", difficulty: "intermediate" },
    { id: "q3", prompt: "Is the learning rate a parameter?", options: ["Yes", "No"], correctIndex: 1, explanation: "It is a hyperparameter.", difficulty: "beginner" },
  ],
};

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
};

test("quiz state survives storage and rejects anything malformed", () => {
  const state = normalizeQuizState({
    answers: { q1: 0, q2: 9, q3: "1" },
    checked: { q1: true, q2: "yes" },
    confidence: { q1: "certain", q2: "very" },
    saved: { q1: true },
    explained: { q1: "user-1", q2: 4 },
    summaryAnnounced: true,
    updatedAt: 5,
  });
  assert.deepEqual(state, { answers: { q1: 0 }, checked: { q1: true }, confidence: { q1: "certain" }, saved: { q1: true }, explained: { q1: "user-1" }, summaryAnnounced: true, updatedAt: 5 });
  const storage = memoryStorage();
  writeQuizStates({ quiz: state }, storage);
  assert.deepEqual(readQuizStates(storage), { quiz: state });
  writeQuizStates({}, storage);
  assert.equal(storage.values.has(QUIZ_STATE_KEY), false);
  storage.setItem(QUIZ_STATE_KEY, "{broken");
  assert.deepEqual(readQuizStates(storage), {});
  assert.deepEqual(readQuizStates({ getItem: () => { throw new Error("blocked"); } }), {});
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`m${index}`, { updatedAt: index }]));
  writeQuizStates(many, storage);
  assert.equal(Object.keys(readQuizStates(storage)).length, 30, "only the most recent quizzes are kept");
  assert.equal(readQuizStates(storage).m39.updatedAt, 39);
});

test("pruning keeps only quizzes still in the conversation", () => {
  const states = { a: normalizeQuizState({}), b: normalizeQuizState({}) };
  assert.equal(pruneQuizStates(states, new Set(["a", "b", "c"])), states);
  assert.deepEqual(Object.keys(pruneQuizStates(states, new Set(["b"]))), ["b"]);
});

test("the score counts checked answers and orders misses by confidence", () => {
  const partial = quizSummary(quiz, { answers: { q1: 0 }, checked: { q1: true } });
  assert.deepEqual([partial.total, partial.checked, partial.correct, partial.complete], [3, 1, 0, false]);
  const done = quizSummary(quiz, {
    answers: { q1: 0, q2: 0, q3: 0 },
    checked: { q1: true, q2: true, q3: true },
    confidence: { q1: "guess", q3: "certain" },
  });
  assert.deepEqual([done.correct, done.total, done.complete, done.confidentMisses], [1, 3, true, 1]);
  assert.deepEqual(done.misses.map((miss) => miss.question.id), ["q3", "q1"], "a confident miss comes first");
  assert.equal(quizSummary({ questions: [] }, {}).complete, false);
});

test("misses become notebook drafts without citation labels, once", () => {
  const state = { answers: { q1: 0, q2: 0, q3: 0 }, checked: { q1: true, q2: true, q3: true }, confidence: { q3: "certain" } };
  const drafts = quizMissDrafts(quiz, state, { documentIds: ["notes/ridge.md", ""] });
  assert.deepEqual(drafts.map((draft) => draft.questionId), ["q3", "q1"]);
  assert.deepEqual(drafts[1], {
    questionId: "q1",
    prompt: "What does ridge add?",
    expected: "B. An L2 penalty\n\nRidge adds λ‖w‖².",
    response: "A. An L1 penalty",
    category: "misconception",
    documentIds: ["notes/ridge.md"],
    tags: ["ai-quiz", "ai-draft"],
  });
  assert.deepEqual(drafts[0].tags, ["ai-quiz", "ai-draft", "confident-miss"]);
  assert.deepEqual(quizMissDrafts(quiz, { ...state, saved: { q1: true, q3: true } }).map((draft) => draft.questionId), [], "saved misses are never drafted again");
  assert.deepEqual(quizMissDrafts(quiz, state, { disputed: new Set(["q3"]) }).map((draft) => draft.questionId), ["q1"], "a disputed key is not a mistake");
});

test("the answer-check question carries the key and fits any prompt limit", () => {
  const prompt = answerFeedbackPrompt(quiz.questions[0], 0, { maxChars: 4_000 });
  assert.match(prompt, /^Quiz question: What does ridge add\?\nOptions:\nA\. An L1 penalty\nB\. An L2 penalty\nC\. Dropout\nMy answer: A\. An L1 penalty\nAnswer key: B\. An L2 penalty\nKey explanation: Ridge adds λ‖w‖²\./);
  assert.equal(prompt.includes("[S"), false, "the quiz's citation labels were copied into the answer check");
  const huge = { ...quiz.questions[0], prompt: "why ".repeat(2_000), options: ["x ".repeat(2_000), "y ".repeat(2_000), "z ".repeat(2_000)], explanation: "because ".repeat(3_000) };
  for (const maxChars of [4_195, 2_000, 1_200, 800]) {
    const fitted = answerFeedbackPrompt(huge, 2, { maxChars });
    assert.ok(fitted.length <= maxChars, `${fitted.length} > ${maxChars}`);
    assert.match(fitted, /My answer: C\./);
    assert.match(fitted, /Answer key: B\./);
  }
  assert.equal(feedbackRetrievalQuery(quiz.questions[0]), "What does ridge add?");
});

test("a weak-spot quiz names the missed concepts", () => {
  const summary = quizSummary(quiz, { answers: { q1: 0, q2: 1, q3: 1 }, checked: { q1: true, q2: true, q3: true } });
  const next = weakSpotQuiz(summary.misses);
  assert.match(next.prompt, /^Create 3 new multiple-choice questions on the ideas I got wrong in my last quiz:\n- What does ridge add\?\n- What does lasso encourage\?\n/);
  assert.equal(next.retrievalQuery, "What does ridge add? What does lasso encourage?");
});

test("answer checks are validated exactly as the server validates them", () => {
  const valid = { score: 20, correct: false, feedback: "The learning rate is set before training.", strengths: [], gaps: ["Parameters are learned"], improvedAnswer: "It is a hyperparameter.", nextQuestion: "Is batch size learned?" };
  const fixtures = [
    valid,
    { ...valid, nextQuestion: null },
    { ...valid, strengths: ["Named the update rule"] },
    { ...valid, extra: true },
    { ...valid, score: 101 },
    { ...valid, score: 2.5 },
    { ...valid, correct: "false" },
    { ...valid, feedback: "  " },
    { ...valid, gaps: Array(7).fill("gap") },
    { ...valid, gaps: ["x".repeat(4_001)] },
    { ...valid, improvedAnswer: "" },
    { ...valid, nextQuestion: "" },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "strengths")),
    null,
    [],
  ];
  for (const fixture of fixtures) {
    assert.equal(validateTutorAnswerFeedback(fixture), validateStructuredAiResult("answer_feedback", fixture), JSON.stringify(fixture)?.slice(0, 120));
  }
  assert.equal(validateTutorAnswerFeedback(valid), true);
  assert.equal(validateTutorAnswerFeedback({ ...valid, extra: true }), false);
});
