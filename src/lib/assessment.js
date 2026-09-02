import { createId } from "./id.js";
import { masteryByPart } from "./mastery.js";
import { categoryForReviewItem } from "./mistakes.js";
import { hasClozeMarkup } from "./review.js";

/**
 * Per-Part readiness assessments (ASSESS-001/002 slice, issue #9).
 *
 * A bounded diagnostic synthesized from the learner's OWN review cards:
 * weakest-first selection, deterministic distractors, cloze partial credit,
 * and an explicit 0 / 0.5 / 1 self-grade rubric for open answers. Every
 * question is embedded frozen in the attempt record, so later card edits
 * never invalidate history (the versioning criterion). Recommendations are
 * advisory only — nothing is ever gated, and prerequisites stay visible.
 */
export const ASSESSMENT_SCHEMA_VERSION = 1;
export const ASSESSMENT_KINDS = Object.freeze(["diagnostic", "mastery"]);
export const MIN_ASSESSMENT_POOL = 3;
export const ASSESSMENT_QUESTION_LIMIT = 8;
export const MAX_ASSESSMENTS = 100;
const MIN_DISTRACTORS = 3;

const fnvHash = (value) => {
  let hash = 0x811c9dc5;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const compareText = (value) => normalizeText(value).toLocaleLowerCase();
const bounded = (value, maximum) => normalizeText(value).slice(0, maximum);

/** Weakest first: matches review.js's crunch ordering shape. */
const weakestFirst = (left, right) => (
  (Number(right.lapses) || 0) - (Number(left.lapses) || 0)
  || (Number(left.ease) || 2.5) - (Number(right.ease) || 2.5)
  || Date.parse(left.dueAt || 0) - Date.parse(right.dueAt || 0)
  || String(left.id).localeCompare(String(right.id))
);

export const assessmentEvidence = (partNumber, { documents, profile }, now = new Date()) => {
  const part = masteryByPart(documents, profile, now).find((entry) => entry.partNumber === partNumber);
  const partDocumentIds = new Set(documents
    .filter((document) => document.partNumber === partNumber && document.source === "builtin" && !document.isIndex)
    .map((document) => document.id));
  const pool = (profile.reviewItems || []).filter((item) => !item.archived && !item.suspended && partDocumentIds.has(item.documentId));
  const openMistakes = (profile.mistakes || []).filter((mistake) => !mistake.correctedAt && partDocumentIds.has(mistake.documentId)).length;
  return {
    partNumber,
    partTitle: part?.partTitle || `Part ${partNumber}`,
    chapters: part?.chapters || 0,
    completedChapters: part?.completedChapters || 0,
    readPercent: part?.readPercent || 0,
    activeCards: part?.activeCards || 0,
    masteredCards: part?.masteredCards || 0,
    overdueCards: part?.overdueCards || 0,
    openMistakes,
    poolSize: pool.length,
  };
};

/**
 * Builds a deterministic assessment. Card types map to question types:
 * cloze markup → per-blank cloze; enough distinct answers in the Part →
 * multiple choice with deterministic distractors; everything else → an open
 * "self" question graded by the explicit rubric.
 */
export const buildAssessment = ({ partNumber, kind = "diagnostic" }, { documents, profile }, now = new Date()) => {
  const evidence = assessmentEvidence(partNumber, { documents, profile }, now);
  const partDocumentIds = new Set(documents
    .filter((document) => document.partNumber === partNumber && document.source === "builtin" && !document.isIndex)
    .map((document) => document.id));
  const pool = (profile.reviewItems || [])
    .filter((item) => !item.archived && !item.suspended && partDocumentIds.has(item.documentId))
    .sort(weakestFirst);
  if (pool.length < MIN_ASSESSMENT_POOL) {
    return {
      ok: false,
      reason: `Create at least ${MIN_ASSESSMENT_POOL} review cards from this Part's highlights or clippings first — the check builds its questions from your own cards.`,
      evidence,
      questions: [],
    };
  }

  const distractorPool = pool.map((item) => normalizeText(item.back)).filter(Boolean);
  const questions = pool.slice(0, ASSESSMENT_QUESTION_LIMIT).map((item) => {
    const base = {
      id: createId(),
      schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      prompt: bounded(item.front, 2_000),
      sourceReviewItemId: item.id,
      sourceUpdatedAt: item.updatedAt || "",
      documentId: item.documentId,
      category: categoryForReviewItem(item),
    };
    if (item.type === "cloze" && hasClozeMarkup(item.front)) {
      const blanks = [...String(item.front).matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => bounded(match[1], 400));
      return { ...base, type: "cloze", answerKey: blanks };
    }
    const correct = normalizeText(item.back);
    const distractors = [...new Set(distractorPool.filter((candidate) => compareText(candidate) !== compareText(correct)))].slice(0, 12);
    if (correct.length <= 400 && distractors.length >= MIN_DISTRACTORS) {
      const options = [correct, ...distractors.slice(0, 3)]
        .map((option) => bounded(option, 400))
        // Hash on the stable source-card id, not the generated question id,
        // so option order is reproducible run to run.
        .sort((left, right) => fnvHash(`${item.id} ${left}`) - fnvHash(`${item.id} ${right}`));
      return { ...base, type: "choice", options, answerKey: bounded(correct, 400) };
    }
    return { ...base, type: "self", answerKey: bounded(item.back, 2_000) };
  });

  return {
    ok: true,
    reason: "",
    kind: ASSESSMENT_KINDS.includes(kind) ? kind : "diagnostic",
    evidence,
    questions,
  };
};

/** Pure grading: choice exact, cloze per-blank partial credit, self rubric. */
export const gradeAssessmentAnswer = (question, response) => {
  if (question.type === "choice") {
    const correct = compareText(response) === compareText(question.answerKey);
    return { credit: correct ? 1 : 0, correct, expected: question.answerKey };
  }
  if (question.type === "cloze") {
    const supplied = Array.isArray(response) ? response : [response];
    const matched = question.answerKey.filter((blank, index) => compareText(supplied[index]) === compareText(blank)).length;
    const credit = question.answerKey.length ? matched / question.answerKey.length : 0;
    return { credit, correct: credit === 1, expected: question.answerKey.join(" · "), matchedBlanks: matched };
  }
  const credit = [0, 0.5, 1].includes(response) ? response : 0;
  return { credit, correct: credit === 1, expected: question.answerKey };
};

export const scoreAssessment = (questions, answers) => {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  let totalCredit = 0;
  const byCategory = {};
  const missed = [];
  for (const question of questions) {
    const answer = byId.get(question.id);
    const credit = Math.max(0, Math.min(1, Number(answer?.credit) || 0));
    totalCredit += credit;
    if (!byCategory[question.category]) byCategory[question.category] = { credit: 0, total: 0 };
    byCategory[question.category].credit += credit;
    byCategory[question.category].total += 1;
    if (credit < 1) missed.push(question.id);
  }
  const maxCredit = questions.length;
  return {
    percent: maxCredit ? Math.round((totalCredit / maxCredit) * 100) : 0,
    totalCredit,
    maxCredit,
    byCategory,
    missed,
  };
};

/** Advisory only — copy never hides prerequisites or blocks navigation. */
export const recommendationForAssessment = (percent, evidence) => {
  if (percent >= 80 && evidence.readPercent >= 96) {
    return { action: "skip", reason: `${percent}% with the Part fully read.`, nextAction: "You can move ahead; every prerequisite stays visible on the curriculum map." };
  }
  if (percent >= 60) {
    return { action: "review", reason: `${percent}% — the foundations hold but gaps remain.`, nextAction: "Review the missed cards below, then reread the sections they came from." };
  }
  return { action: "study", reason: `${percent}% — this Part needs focused study first.`, nextAction: "Work through the Part's chapters before relying on this material." };
};

export const createAssessmentRecord = ({ partNumber, kind, questions, answers, percent, recommendation, evidence }, now = new Date()) => ({
  id: createId(),
  schemaVersion: ASSESSMENT_SCHEMA_VERSION,
  partNumber,
  kind: ASSESSMENT_KINDS.includes(kind) ? kind : "diagnostic",
  questions,
  answers,
  percent,
  recommendation,
  evidence,
  completedAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

/** Every sub-full-credit answer becomes (or merges into) a mistake entry. */
export const assessmentMistakeDrafts = (questions, answers) => {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  return questions
    .filter((question) => {
      const answer = byId.get(question.id);
      return answer && (Number(answer.credit) || 0) < 1;
    })
    .map((question) => ({
      prompt: question.prompt,
      expected: Array.isArray(question.answerKey) ? question.answerKey.join(" · ") : question.answerKey,
      response: (() => {
        const raw = byId.get(question.id)?.response;
        if (Array.isArray(raw)) return raw.join(" · ");
        return typeof raw === "string" ? raw : "";
      })(),
      category: question.category,
      documentId: question.documentId,
      reviewItemId: question.sourceReviewItemId,
      tags: ["assessment"],
    }));
};

/** Normalization delegate for db.js — bounded, newest kept, frozen shape. */
export const normalizeAssessments = (input) => (Array.isArray(input) ? input : [])
  .filter((record) => record && typeof record === "object" && typeof record.id === "string" && Number.isInteger(record.partNumber))
  .sort((left, right) => String(right.completedAt || "").localeCompare(String(left.completedAt || "")))
  .slice(0, MAX_ASSESSMENTS)
  .map((record) => ({
    id: record.id.slice(0, 200),
    schemaVersion: Number.isInteger(record.schemaVersion) ? record.schemaVersion : 1,
    partNumber: record.partNumber,
    kind: ASSESSMENT_KINDS.includes(record.kind) ? record.kind : "diagnostic",
    questions: (Array.isArray(record.questions) ? record.questions : []).slice(0, 12).map((question) => ({
      id: typeof question.id === "string" ? question.id.slice(0, 200) : createId(),
      schemaVersion: Number.isInteger(question.schemaVersion) ? question.schemaVersion : 1,
      type: ["choice", "cloze", "self"].includes(question.type) ? question.type : "self",
      prompt: bounded(question.prompt, 2_000),
      ...(Array.isArray(question.options) ? { options: question.options.slice(0, 4).map((option) => bounded(option, 400)) } : {}),
      answerKey: Array.isArray(question.answerKey)
        ? question.answerKey.slice(0, 12).map((blank) => bounded(blank, 400))
        : bounded(question.answerKey, 2_000),
      sourceReviewItemId: typeof question.sourceReviewItemId === "string" ? question.sourceReviewItemId.slice(0, 200) : "",
      sourceUpdatedAt: typeof question.sourceUpdatedAt === "string" ? question.sourceUpdatedAt : "",
      documentId: typeof question.documentId === "string" ? question.documentId.slice(0, 500) : "",
      category: typeof question.category === "string" ? question.category.slice(0, 40) : "misconception",
    })),
    answers: (Array.isArray(record.answers) ? record.answers : []).slice(0, 12).map((answer) => ({
      questionId: typeof answer.questionId === "string" ? answer.questionId.slice(0, 200) : "",
      response: Array.isArray(answer.response)
        ? answer.response.slice(0, 12).map((value) => bounded(value, 400))
        : typeof answer.response === "number" ? answer.response : bounded(answer.response, 2_000),
      credit: Math.max(0, Math.min(1, Number(answer.credit) || 0)),
    })),
    percent: Math.max(0, Math.min(100, Math.round(Number(record.percent) || 0))),
    recommendation: record.recommendation && typeof record.recommendation === "object" ? {
      action: ["skip", "review", "study"].includes(record.recommendation.action) ? record.recommendation.action : "review",
      reason: bounded(record.recommendation.reason, 300),
      nextAction: bounded(record.recommendation.nextAction, 300),
    } : { action: "review", reason: "", nextAction: "" },
    evidence: record.evidence && typeof record.evidence === "object" ? {
      partNumber: Number.isInteger(record.evidence.partNumber) ? record.evidence.partNumber : record.partNumber,
      partTitle: bounded(record.evidence.partTitle, 180),
      readPercent: Math.max(0, Math.min(100, Math.round(Number(record.evidence.readPercent) || 0))),
      activeCards: Math.max(0, Math.round(Number(record.evidence.activeCards) || 0)),
      poolSize: Math.max(0, Math.round(Number(record.evidence.poolSize) || 0)),
      openMistakes: Math.max(0, Math.round(Number(record.evidence.openMistakes) || 0)),
    } : { partNumber: record.partNumber, partTitle: "", readPercent: 0, activeCards: 0, poolSize: 0, openMistakes: 0 },
    completedAt: typeof record.completedAt === "string" ? record.completedAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : (record.completedAt || new Date().toISOString()),
  }));
