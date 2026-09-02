import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_QUESTION_LIMIT,
  assessmentMistakeDrafts,
  buildAssessment,
  createAssessmentRecord,
  gradeAssessmentAnswer,
  normalizeAssessments,
  recommendationForAssessment,
  scoreAssessment,
} from "./assessment.js";
import { actionableDueCount, planPace } from "./plan.js";
import { createReviewItem } from "./review.js";

const now = new Date("2026-09-02T12:00:00.000Z");

const docs = [
  { id: "p1c1", source: "builtin", partNumber: 1, chapterNumber: 1, partTitle: "Foundations", title: "Mental model", minutes: 10 },
  { id: "p1c2", source: "builtin", partNumber: 1, chapterNumber: 2, partTitle: "Foundations", title: "Framing", minutes: 12 },
  { id: "p2c1", source: "builtin", partNumber: 2, chapterNumber: 1, partTitle: "Math", title: "Algebra", minutes: 14 },
];

const card = (id, front, back, extra = {}) => ({
  ...createReviewItem({ front, back, documentId: "p1c1" }, now),
  id,
  ...extra,
});

const profileWith = (reviewItems, extra = {}) => ({
  progress: { p1c1: 1, p1c2: 1 },
  reviewItems,
  reviewSettings: { dailyNewLimit: 10, dailyReviewLimit: 50 },
  reviewSessions: [],
  mistakes: [],
  recent: [],
  goals: { targetParts: [], targetDate: "", dailyMinutes: 0 },
  ...extra,
});

test("assessments build deterministically from the learner's own cards, weakest first", () => {
  const items = [
    card("a", "What is overfitting?", "Memorizing noise instead of signal", { lapses: 3 }),
    card("b", "Define {{regularization}} in one word", "constraint", { type: "cloze" }),
    card("c", "What tunes hyperparameters?", "The validation split", { lapses: 1 }),
    card("d", "What is a gradient?", "The vector of partial derivatives"),
    card("e", "Long-answer card", "x".repeat(600)),
  ];
  const built = buildAssessment({ partNumber: 1 }, { documents: docs, profile: profileWith(items) }, now);
  assert.equal(built.ok, true);
  assert.equal(built.questions.length, 5);
  assert.equal(built.questions[0].sourceReviewItemId, "a", "highest-lapse card leads");
  assert.equal(built.questions.length <= ASSESSMENT_QUESTION_LIMIT, true);

  const cloze = built.questions.find((question) => question.type === "cloze");
  assert.deepEqual(cloze.answerKey, ["regularization"]);
  const choice = built.questions.find((question) => question.sourceReviewItemId === "a");
  assert.equal(choice.type, "choice");
  assert.equal(choice.options.length, 4);
  assert.ok(choice.options.includes("Memorizing noise instead of signal"));
  const longAnswer = built.questions.find((question) => question.sourceReviewItemId === "e");
  assert.equal(longAnswer.type, "self", "over-length answers degrade to rubric self-grading");

  const rebuilt = buildAssessment({ partNumber: 1 }, { documents: docs, profile: profileWith(items) }, now);
  assert.deepEqual(
    rebuilt.questions.map((question) => ({ ...question, id: "" })),
    built.questions.map((question) => ({ ...question, id: "" })),
    "everything except the generated ids is deterministic",
  );

  const sparse = buildAssessment({ partNumber: 2 }, { documents: docs, profile: profileWith(items) }, now);
  assert.equal(sparse.ok, false, "under three cards refuses with a reason");
  assert.match(sparse.reason, /at least 3 review cards/);
});

test("grading gives choice exactness, cloze partial credit, and a bounded self rubric", () => {
  const choice = { type: "choice", answerKey: "The validation split" };
  assert.equal(gradeAssessmentAnswer(choice, "  the VALIDATION split ").credit, 1, "choice compare normalizes case and spacing");
  assert.equal(gradeAssessmentAnswer(choice, "the test split").credit, 0);

  const cloze = { type: "cloze", answerKey: ["bias", "variance"] };
  assert.equal(gradeAssessmentAnswer(cloze, ["bias", "variance"]).credit, 1);
  assert.equal(gradeAssessmentAnswer(cloze, ["bias", "wrong"]).credit, 0.5, "per-blank partial credit");

  const open = { type: "self", answerKey: "expected" };
  assert.equal(gradeAssessmentAnswer(open, 0.5).credit, 0.5);
  assert.equal(gradeAssessmentAnswer(open, 0.7).credit, 0, "off-rubric credit collapses to zero");

  const questions = [
    { id: "q1", category: "misconception" },
    { id: "q2", category: "formula" },
    { id: "q3", category: "misconception" },
  ];
  const score = scoreAssessment(questions, [
    { questionId: "q1", credit: 1 },
    { questionId: "q2", credit: 0.5 },
    { questionId: "q3", credit: 0 },
  ]);
  assert.equal(score.percent, 50);
  assert.deepEqual(score.missed, ["q2", "q3"]);
  assert.equal(score.byCategory.misconception.credit, 1);
});

test("recommendations stay advisory and misses become mergeable mistake drafts", () => {
  assert.equal(recommendationForAssessment(85, { readPercent: 100 }).action, "skip");
  assert.equal(recommendationForAssessment(85, { readPercent: 40 }).action, "review", "high score without reading never advises skipping");
  assert.equal(recommendationForAssessment(45, { readPercent: 100 }).action, "study");
  assert.match(recommendationForAssessment(85, { readPercent: 100 }).nextAction, /prerequisite/i, "skip copy keeps prerequisites visible");

  const questions = [
    { id: "q1", prompt: "P1", answerKey: "A1", category: "formula", documentId: "p1c1", sourceReviewItemId: "card-1" },
    { id: "q2", prompt: "P2", answerKey: ["a", "b"], category: "misconception", documentId: "p1c1", sourceReviewItemId: "card-2" },
  ];
  const drafts = assessmentMistakeDrafts(questions, [
    { questionId: "q1", credit: 1, response: "A1" },
    { questionId: "q2", credit: 0.5, response: ["a", "wrong"] },
  ]);
  assert.equal(drafts.length, 1, "full-credit answers never create mistakes");
  assert.equal(drafts[0].reviewItemId, "card-2", "the card link enables merge-on-repeat");
  assert.equal(drafts[0].expected, "a · b");
  assert.deepEqual(drafts[0].tags, ["assessment"]);
});

test("records freeze their questions and survive normalization bounded", () => {
  const record = createAssessmentRecord({
    partNumber: 1,
    kind: "diagnostic",
    questions: [{ id: "q1", schemaVersion: 1, type: "choice", prompt: "P", options: ["A", "B", "C", "D"], answerKey: "A", sourceReviewItemId: "card-1", sourceUpdatedAt: now.toISOString(), documentId: "p1c1", category: "formula" }],
    answers: [{ questionId: "q1", response: "A", credit: 1 }],
    percent: 100,
    recommendation: { action: "skip", reason: "r", nextAction: "n" },
    evidence: { partNumber: 1, partTitle: "Foundations", readPercent: 100, activeCards: 5, poolSize: 5, openMistakes: 0 },
  }, now);
  const [normalized] = normalizeAssessments([record]);
  assert.equal(normalized.questions[0].prompt, "P", "embedded questions survive normalization frozen");
  assert.equal(normalized.percent, 100);
  assert.equal(normalized.recommendation.action, "skip");

  const overflow = normalizeAssessments(Array.from({ length: 120 }, (_, index) => ({
    ...record,
    id: `assessment-${index}`,
    completedAt: new Date(now.getTime() + index * 1_000).toISOString(),
  })));
  assert.equal(overflow.length, 100, "the collection is bounded");
  assert.equal(overflow[0].id, "assessment-119", "newest records are kept");
});

test("goal pacing reports honest statuses and the badge count is actionable-only", () => {
  const profile = profileWith([], { progress: { p1c1: 1 }, goals: { targetParts: [1], targetDate: "2026-09-12", dailyMinutes: 30 } });
  const pace = planPace({ profile, documents: docs }, now);
  assert.equal(pace.status, "on-track");
  assert.equal(pace.remainingChapters, 1, "completed chapters never count against the goal");

  const behind = planPace({ profile: { ...profile, progress: {}, goals: { targetParts: [1, 2], targetDate: "2026-09-02", dailyMinutes: 0 } }, documents: docs }, now);
  assert.equal(behind.status, "behind");
  assert.match(behind.message, /keeps the plan honest/, "behind copy stays neutral");

  const pastDue = planPace({ profile: { ...profile, progress: {}, goals: { targetParts: [1], targetDate: "2026-09-01", dailyMinutes: 0 } }, documents: docs }, now);
  assert.equal(pastDue.status, "past-due");

  assert.equal(planPace({ profile: profileWith([]), documents: docs }, now), null, "no goal, no pace line");

  const due = [
    card("d1", "q", "a", { dueAt: "2026-09-01T00:00:00.000Z" }),
    card("d2", "q", "a", { dueAt: "2026-09-01T00:00:00.000Z", suspended: true }),
    card("d3", "q", "a", { dueAt: "2026-12-01T00:00:00.000Z" }),
  ];
  assert.equal(actionableDueCount(profileWith(due), now), 1, "suspended and future cards never inflate the badge");
});

test("numeric answers auto-grade with tolerant matching and survive normalization", () => {
  const stamp = "2026-09-02T10:00:00.000Z";
  const card = (id, back) => ({ id, type: "basic", front: `${id}?`, back, documentId: "notes/part-02-mathematics/01-notation-algebra-functions.md", suspended: false, archived: false, dueAt: stamp, intervalDays: 1, ease: 2.5, repetitions: 1, reviewCount: 1, lapses: 0, createdAt: stamp, updatedAt: stamp, lastReviewedAt: stamp });
  const documents = [{ id: "notes/part-02-mathematics/01-notation-algebra-functions.md", partNumber: 2, source: "builtin", isIndex: false }];
  const profile = { reviewItems: [card("n-1", "1.5"), card("n-2", "long prose answer one"), card("n-3", "long prose answer two"), card("n-4", "-42%")], mistakes: [], progress: {}, readingPositions: {} };
  const built = buildAssessment({ partNumber: 2 }, { documents, profile });
  assert.equal(built.ok, true);
  const numeric = built.questions.filter((question) => question.type === "numeric");
  assert.equal(numeric.length, 2, "plain numbers and signed percents must become numeric questions");
  const question = numeric.find((entry) => entry.answerKey === "1.5");
  assert.equal(gradeAssessmentAnswer(question, " 1.50 ").credit, 1, "trailing zeros and whitespace are forgiven");
  assert.equal(gradeAssessmentAnswer(question, "1.6").credit, 0, "wrong numbers still fail");
  const normalized = normalizeAssessments([createAssessmentRecord({ partNumber: 2, kind: "diagnostic", questions: built.questions, answers: [], percent: 0, recommendation: { action: "study", reason: "", nextAction: "" }, evidence: built.evidence })]);
  assert.equal(normalized[0].questions.filter((entry) => entry.type === "numeric").length, 2, "the numeric type must survive storage normalization");
});
