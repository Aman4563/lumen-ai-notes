import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { scrollBehavior } from "../lib/motion.js";
import "katex/dist/katex.min.css";
import {
  AlertTriangle,
  ArrowDown,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  Cpu,
  ExternalLink,
  FileQuestion,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
  NotebookPen,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ServerOff,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Download,
  MessageSquarePlus,
  Pause,
  Play,
  Square,
  Volume2,
  X,
} from "lucide-react";
import {
  AI_DATA_DISCLOSURE,
  AiClientError,
  aiRequestUtf8Bytes,
  aiClient,
} from "../lib/aiClient";
import { renderTutorInlineMarkdown, renderTutorMarkdown, tutorSpeechText } from "../lib/tutorMarkdown";
import { useScrollableRegions } from "../lib/useScrollableRegions.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { FINE_POINTER_QUERY, composerEnterAction, composerKeyHint, currentPlatform, shouldRecallLastQuestion } from "../lib/tutorKeyboard.js";
import { progressAnnouncement, tutorProgressSteps } from "../lib/tutorProgress.js";
import { isPageReadBack } from "../lib/scrollIntent.js";
import TutorConfirmDialog from "./TutorConfirmDialog.jsx";
import TutorSheet from "./TutorSheet.jsx";
import { tutorConversationMarkdown, tutorMessageMarkdown } from "../lib/tutorExport";
import { downloadBlob } from "../lib/download.js";
import { outputTokensForProfile, refersToOpenLesson, retrievalTraceCounts, shouldUseWebFallback } from "../lib/tutorGrounding";
import {
  TUTOR_MAX_PROMPT_CHARS as MAX_PROMPT_CHARS,
  TUTOR_MAX_SERVER_HISTORY as MAX_SERVER_HISTORY,
  fitTutorRequest,
  tutorContextStart,
  tutorActionIssueReason,
  tutorConversationWindow,
  tutorFollowUpWindow,
  tutorRequestIssue,
  tutorRequestLimits,
} from "../lib/tutorRequest";
import {
  CONFIDENCE_LEVELS,
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
} from "../lib/tutorQuiz.js";
import {
  citedDocumentId,
  followUpPair,
  followUpRetrievalQuery,
  followUpScope,
  followUpsForMessage,
  questionForAnswer,
  withoutCitationLabels,
} from "../lib/tutorFollowUps.js";
import { buildStarterPrompts } from "../lib/tutorStarters.js";
import {
  HINT_PROMPT,
  NEXT_QUESTION_PROMPT,
  REVEAL_PROMPT,
  SESSION_MODES,
  sessionRetrievalQuery,
  sessionWrapUp,
  tutorSession,
  wrapUpLabel,
} from "../lib/tutorSession.js";
import {
  normalizePracticeState,
  practiceAnswerFrom,
  practiceQuestionIdFrom,
  readPracticeState,
  writePracticeState,
} from "../lib/tutorPractice.js";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import "../ai-tutor.css";

const MODE_OPTIONS = Object.freeze([
  {
    id: "explain",
    label: "Explain",
    task: "explain",
    prompt: "Explain the key ideas in this lesson with a short example and one common mistake.",
    description: "A grounded explanation with intuition, mechanics, examples, and production judgment.",
    contextLimit: 12_000,
  },
  {
    id: "socratic",
    label: "Socratic",
    task: "socratic",
    prompt: "Teach the selected material using one focused Socratic question at a time. Start by checking my current understanding.",
    description: "Learn through guided questions without receiving the solution too early.",
  },
  {
    id: "quiz",
    label: "Quiz",
    task: "quiz",
    prompt: "Create 3 questions to test my understanding of this lesson. Explain each answer.",
    description: "Generate a validated interactive quiz with teaching explanations.",
    structured: true,
  },
  {
    id: "flashcards",
    label: "Flashcards",
    task: "flashcards",
    prompt: "Create 4 short flashcards for the key ideas in this lesson.",
    description: "Generate validated drafts and choose which cards enter your review deck.",
    structured: true,
  },
  {
    id: "code-review",
    label: "Code review",
    task: "code_review",
    prompt: "Review this code for bugs and suggest fixes.\n\n```\n(paste your code here)\n```",
    description: "Prioritized senior-engineer review of pasted code with concrete fixes.",
    contextLimit: 8_000,
  },
  {
    id: "interview",
    label: "Interview",
    task: "interview",
    prompt: "Interview me on the selected material at senior engineer depth. Probe assumptions, trade-offs, failure handling, and measurement one question at a time.",
    description: "Practice senior-level technical reasoning with follow-up questions.",
  },
  {
    id: "summarize",
    label: "Summarize",
    task: "summarize",
    prompt: "Summarize the selected material faithfully, including core ideas, formulas, assumptions, pitfalls, and a recall checklist.",
    description: "Turn source material into a compact, faithful revision guide.",
  },
  {
    id: "study-plan",
    label: "Study plan",
    task: "study_plan",
    prompt: "Create a study plan with 3 milestones for this lesson, including practice and checks for understanding.",
    description: "Generate milestones, time estimates, activities, and mastery evidence.",
    structured: true,
  },
]);

// Modes that only a tutor action starts (never listed, never required by
// the server check, never restored into the composer as themselves):
// "Explain my mistake" sends answer_feedback; a Socratic or Interview
// session's hint and reveal keep the session going without counting as new
// questions. `composerMode` is the listed mode Edit & reuse reopens.
const HIDDEN_MODES = Object.freeze([
  {
    id: "feedback",
    label: "Answer check",
    task: "answer_feedback",
    prompt: "",
    description: "Feedback on a quiz answer you missed.",
    structured: true,
    hidden: true,
  },
  {
    id: "hint",
    label: "Hint",
    task: "socratic",
    prompt: "",
    description: "One hint for the tutor's last question.",
    hidden: true,
    composerMode: "socratic",
  },
  {
    id: "reveal",
    label: "Answer revealed",
    task: "explain",
    prompt: "",
    description: "The answer to the tutor's last question, explained.",
    hidden: true,
  },
  {
    id: "interview-practice",
    label: "Interview practice",
    task: "answer_feedback",
    prompt: "",
    description: "Your answer to an authored interview question, checked against its rubric.",
    structured: true,
    hidden: true,
  },
]);

const DIFFICULTIES = Object.freeze([
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
  { id: "interview", label: "Interview" },
]);

const SOURCE_MODES = Object.freeze([
  { id: "library-first", label: "Library first", short: "Search all of your local lessons before answering." },
  { id: "current", label: "Current lesson", short: "Use only the lesson that opened the tutor." },
  { id: "choose", label: "Choose sources", short: "Manually choose up to eight local sources." },
  { id: "none", label: "No library", short: "Ask a general question without sending lesson text." },
]);

const RESPONSE_PROFILES = Object.freeze([
  { id: "fast", label: "Fast", detail: "Short, direct answer" },
  { id: "balanced", label: "Balanced", detail: "Useful depth and speed" },
  { id: "deep", label: "Deep", detail: "Longer answer with local private thinking" },
]);

const MAX_SELECTED_SOURCES = 8;
// The app's one speech session is labelled so the tutor can tell its own
// reading from a lecture's (TFEAT-09).
const TUTOR_SPEECH_LABEL = "Tutor answer";
// Of the eight Library-first passages, a request about the open lesson
// reserves most for that lesson; the rest still come from the whole library.
const OPEN_LESSON_RESERVED_PASSAGES = 6;
const MAX_WEB_SOURCES = 8;
const MAX_VISIBLE_HISTORY = 50;
const MAX_RESPONSE_CHARS = 160_000;
const LOCAL_DISCLOSURE_ACKNOWLEDGEMENT_KEY = "lumen.ai.local-disclosure-ack.v1";
const DISCLOSURE_REASON = "Review and acknowledge the local-model disclosure once on this browser to enable generation.";
const WEB_FALLBACK_STATES = new Set(["off", "armed", "not-needed", "searching", "used", "failed"]);

const readLocalDisclosureAcknowledgement = () => {
  try {
    return globalThis.localStorage?.getItem(LOCAL_DISCLOSURE_ACKNOWLEDGEMENT_KEY) === "acknowledged";
  } catch {
    return false;
  }
};

const rememberLocalDisclosureAcknowledgement = (acknowledged) => {
  try {
    if (acknowledged) globalThis.localStorage?.setItem(LOCAL_DISCLOSURE_ACKNOWLEDGEMENT_KEY, "acknowledged");
    else globalThis.localStorage?.removeItem(LOCAL_DISCLOSURE_ACKNOWLEDGEMENT_KEY);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts. The
    // in-memory acknowledgement still remains valid for the current visit.
  }
};

// An unsent question and its settings survive route changes and engine
// switches for this tab only. It is never written to the profile, backups or
// localStorage, and web-fallback permission is deliberately not part of it.
const TUTOR_DRAFT_KEY = "lumen.ai.tutor-draft.v1";

const readTutorDraft = () => {
  try {
    const draft = JSON.parse(globalThis.sessionStorage?.getItem(TUTOR_DRAFT_KEY) || "null");
    return draft && typeof draft === "object" && !Array.isArray(draft) ? draft : null;
  } catch {
    return null;
  }
};

const rememberTutorDraft = (draft) => {
  try {
    globalThis.sessionStorage?.setItem(TUTOR_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Without session storage a remount simply starts from the mode default.
  }
};

const createId = () => globalThis.crypto?.randomUUID?.()
  || `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const asTrimmedString = (value, maximum = 100_000) => (
  typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, maximum) : ""
);

const sourceText = (source) => asTrimmedString(
  source?.text ?? source?.content ?? source?.excerpt ?? source?.markdown ?? "",
);

const stableTextHash = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const sourceKey = (source, index) => asTrimmedString(source?.id ?? source?.documentId ?? source?.slug, 240)
  || `${asTrimmedString(source?.title, 120) || "source"}-${index}`;

const initiallySelectedSourceIds = (sources) => {
  const valid = Array.isArray(sources) ? sources
    .map((source, index) => ({ source, id: sourceKey(source, index) }))
    .filter(({ source }) => source && typeof source === "object" && sourceText(source)) : [];
  const requested = valid.filter(({ source }) => source.selected === true).slice(0, MAX_SELECTED_SOURCES);
  return new Set((requested.length ? requested : valid.slice(0, 1)).map(({ id }) => id));
};

const navigationTarget = (source) => ({
  id: asTrimmedString(source?.id, 240),
  documentId: asTrimmedString(source?.documentId, 240),
  slug: asTrimmedString(source?.slug, 240),
  title: asTrimmedString(source?.title, 200),
  section: asTrimmedString(source?.section ?? source?.heading, 200),
  anchor: asTrimmedString(source?.anchor, 240),
});

const normalizeCitationSources = (citationSources) => Array.isArray(citationSources)
  ? citationSources.slice(0, MAX_SELECTED_SOURCES).flatMap((source) => {
    if (!source || typeof source !== "object" || !Number.isSafeInteger(source.citationNumber)) return [];
    const id = asTrimmedString(source.id, 240);
    const title = asTrimmedString(source.title, 200);
    if (!id || !title || source.citationNumber < 1) return [];
    return [{
      id,
      title,
      section: asTrimmedString(source.section, 200),
      citationNumber: source.citationNumber,
      original: navigationTarget(source.original || source),
    }];
  })
  : [];

const normalizeWebSources = (webSources) => {
  if (!Array.isArray(webSources)) return [];
  const conflicts = new Set();
  const indexed = new Map();
  webSources.slice(0, MAX_WEB_SOURCES).forEach((source, position) => {
    if (!source || typeof source !== "object") return;
    let url;
    try {
      const candidate = new URL(String(source.url || ""));
      if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) return;
      candidate.hash = "";
      url = candidate.href.slice(0, 2_000);
    } catch {
      return;
    }
    const title = asTrimmedString(source.title, 300);
    const index = Object.hasOwn(source, "index") ? Number(source.index) : position + 1;
    if (!title || !Number.isSafeInteger(index) || index < 1 || index > 99) return;
    const normalized = {
      index,
      title,
      url,
      snippet: asTrimmedString(source.snippet, 1_200),
      source: asTrimmedString(source.source, 100),
      publishedAt: asTrimmedString(source.publishedAt, 80),
    };
    const existing = indexed.get(index);
    if (existing && existing.url !== normalized.url) conflicts.add(index);
    else if (!existing) indexed.set(index, normalized);
  });
  return [...indexed].filter(([index]) => !conflicts.has(index)).map(([, source]) => source);
};

const normalizeConversationMemory = (memory) => {
  if (!memory || typeof memory !== "object") return null;
  const compactedMessages = Number.isSafeInteger(memory.compactedMessages) && memory.compactedMessages > 0
    ? Math.min(memory.compactedMessages, MAX_VISIBLE_HISTORY)
    : 0;
  const summary = asTrimmedString(memory.summary ?? memory.conversationSummary, 2_800);
  return compactedMessages && summary ? { compactedMessages, summary } : null;
};

const normalizeAnswerApproach = (approach) => {
  if (!approach || typeof approach !== "object") return null;
  const summary = asTrimmedString(approach.summary, 500);
  const steps = Array.isArray(approach.steps)
    ? approach.steps.map((step) => asTrimmedString(step, 400)).filter(Boolean).slice(0, 6)
    : [];
  return summary && steps.length ? { summary, steps } : null;
};

const normalizeUsage = (usage) => {
  if (!usage || typeof usage !== "object") return null;
  const keys = ["inputTokens", "outputTokens", "totalTokens"];
  if (!keys.every((key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) return null;
  return Object.fromEntries(keys.map((key) => [key, Math.min(usage[key], 10_000_000)]));
};

const normalizeWebFallbackStatus = (value) => WEB_FALLBACK_STATES.has(value) ? value : "off";

const normalizeRetrievalTrace = (trace) => {
  if (!trace || typeof trace !== "object") return null;
  const strategy = asTrimmedString(trace.strategy ?? trace.mode, 80);
  const summary = asTrimmedString(trace.summary, 500);
  const counts = retrievalTraceCounts(trace);
  const candidates = counts.candidates === null ? null : Math.max(0, Math.min(counts.candidates, 100_000));
  const matchedDocuments = counts.matchedDocuments === null ? null : Math.max(0, Math.min(counts.matchedDocuments, 100_000));
  const passages = counts.passages === null ? null : Math.max(0, Math.min(counts.passages, MAX_SELECTED_SOURCES));
  const confidenceLevel = asTrimmedString(trace.confidence?.level, 40);
  const confidenceScore = Number.isFinite(trace.confidence?.score) ? Math.max(0, Math.min(1, trace.confidence.score)) : null;
  const confidenceCoverage = Number.isFinite(trace.confidence?.coverage) ? Math.max(0, Math.min(1, trace.confidence.coverage)) : null;
  const lexicalStrength = Number.isFinite(trace.confidence?.lexicalStrength) ? Math.max(0, Math.min(1, trace.confidence.lexicalStrength)) : null;
  const diversity = Number.isFinite(trace.confidence?.diversity) ? Math.max(0, Math.min(1, trace.confidence.diversity)) : null;
  const webFallbackRecommended = trace.webFallback?.recommended === true || trace.webFallbackRecommended === true;
  const webFallbackCode = asTrimmedString(trace.webFallback?.code, 80);
  const webFallbackReason = asTrimmedString(trace.webFallback?.reason ?? trace.webFallbackReason, 240);
  const budgetTruncated = trace.budget?.truncated === true;
  const returnedBytes = Number.isSafeInteger(trace.budget?.returnedBytes) ? Math.max(0, Math.min(trace.budget.returnedBytes, 10_000_000)) : null;
  const maximumBytes = Number.isSafeInteger(trace.budget?.maximumBytes) ? Math.max(0, Math.min(trace.budget.maximumBytes, 10_000_000)) : null;
  if (!strategy && !summary && candidates === null && passages === null && !webFallbackCode) return null;
  return { strategy, summary, candidates, matchedDocuments, passages, confidenceLevel, confidenceScore, confidenceCoverage, lexicalStrength, diversity, webFallbackRecommended, webFallbackCode, webFallbackReason, budgetTruncated, returnedBytes, maximumBytes };
};

const citationSnapshot = (source) => ({
  id: source.id,
  title: source.title,
  section: source.section,
  citationNumber: source.citationNumber,
  original: navigationTarget(source.original),
});

const normalizeHistory = (history) => {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_VISIBLE_HISTORY).flatMap((message) => {
    if (!message || (message.role !== "user" && message.role !== "assistant")) return [];
    const content = asTrimmedString(message.content, MAX_RESPONSE_CHARS);
    if (!content) return [];
    return [{
      id: asTrimmedString(message.id, 200) || createId(),
      role: message.role,
      content,
      mode: asTrimmedString(message.mode, 40),
      createdAt: asTrimmedString(message.createdAt, 80) || new Date().toISOString(),
      requestId: asTrimmedString(message.requestId, 240) || null,
      data: message.data && typeof message.data === "object" ? message.data : null,
      citationSources: normalizeCitationSources(message.citationSources),
      webSources: normalizeWebSources(message.webSources),
      conversationMemory: normalizeConversationMemory(message.conversationMemory),
      retrievalTrace: normalizeRetrievalTrace(message.retrievalTrace),
      approach: normalizeAnswerApproach(message.approach),
      usage: normalizeUsage(message.usage),
      webFallbackStatus: normalizeWebFallbackStatus(message.webFallbackStatus),
      responseProfile: ["fast", "balanced", "deep"].includes(message.responseProfile) ? message.responseProfile : "balanced",
      durationMs: Number.isFinite(message.durationMs) ? Math.max(0, Math.min(Math.round(message.durationMs), 315_000)) : null,
      incomplete: message.incomplete === true,
      truncated: message.truncated === true,
    }];
  });
};

const historySignature = (history) => JSON.stringify((history || []).map((message) => [
  message.id,
  message.role,
  message.content,
  message.mode,
  message.createdAt,
  message.requestId,
  message.data,
  message.citationSources,
  message.webSources,
  message.conversationMemory,
  message.retrievalTrace,
  message.approach,
  message.usage,
  message.webFallbackStatus,
  message.responseProfile,
  message.durationMs,
  message.incomplete,
  message.truncated,
]));

const mergeHistoryById = (localHistory, externalHistory) => {
  const records = new Map();
  [...localHistory, ...externalHistory].forEach((message) => {
    if (message?.id) records.set(message.id, message);
  });
  return normalizeHistory([...records.values()].sort((left, right) => {
    const time = Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
    return time || String(left.id).localeCompare(String(right.id));
  }));
};

const boundResponseText = (value) => {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (text.length <= MAX_RESPONSE_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_RESPONSE_CHARS - 94).trimEnd()}\n\n> Response display limit reached. Ask Lumen to continue from this point.`,
    truncated: true,
  };
};

const assertFittedAiRequest = (fitted, message = "The prepared request exceeds the local model request limit. Shorten the prompt or clear older conversation turns.") => {
  if (!fitted || typeof fitted !== "object" || !fitted.payload) {
    throw new AiClientError("AI_INPUT_TOO_LARGE", "Lumen could not prepare a bounded local-model request.");
  }
  const bytes = aiRequestUtf8Bytes(fitted.payload);
  if (bytes !== fitted.bytes) {
    throw new AiClientError("AI_INPUT_TOO_LARGE", "The prepared local-model request changed after its byte preflight. Please retry.");
  }
  if (Number.isSafeInteger(fitted.maximumBytes) && bytes > fitted.maximumBytes) {
    throw new AiClientError("AI_INPUT_TOO_LARGE", message);
  }
  return fitted.payload;
};

const exactObjectKeys = (value, keys) => Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));

const requiredText = (value, maximum = 20_000) => typeof value === "string"
  && Boolean(value.trim())
  && value.length <= maximum;

const validStringArray = (value, maximumItems, maximumLength = 4_000) => Array.isArray(value)
  && value.length <= maximumItems
  && value.every((item) => typeof item === "string" && item.length <= maximumLength);

/** Defense-in-depth validation; provider output remains untrusted after schema validation. */
export const validateTutorQuiz = (value) => {
  if (!exactObjectKeys(value, ["title", "instructions", "questions"])
    || !requiredText(value.title) || !requiredText(value.instructions)
    || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 10) return false;
  const ids = value.questions.map((question) => question?.id);
  if (new Set(ids).size !== ids.length) return false;
  return value.questions.every((question) => exactObjectKeys(
    question,
    ["id", "prompt", "options", "correctIndex", "explanation", "difficulty"],
  )
    && requiredText(question.id, 200)
    && requiredText(question.prompt)
    && Array.isArray(question.options)
    && question.options.length >= 2
    && question.options.length <= 6
    && question.options.every((option) => requiredText(option, 4_000))
    && Number.isSafeInteger(question.correctIndex)
    && question.correctIndex >= 0
    && question.correctIndex < question.options.length
    && requiredText(question.explanation)
    && DIFFICULTIES.some((difficulty) => difficulty.id === question.difficulty));
};

export const validateTutorFlashcards = (value) => exactObjectKeys(value, ["cards"])
  && Array.isArray(value.cards)
  && value.cards.length >= 1
  && value.cards.length <= 20
  && value.cards.every((card) => exactObjectKeys(card, ["front", "back", "hint", "tags"])
    && requiredText(card.front)
    && requiredText(card.back)
    && (card.hint === null || (typeof card.hint === "string" && card.hint.length <= 20_000))
    && validStringArray(card.tags, 4));

export const validateTutorStudyPlan = (value) => exactObjectKeys(value, ["title", "goal", "milestones", "cautions"])
  && requiredText(value.title)
  && requiredText(value.goal)
  && Array.isArray(value.milestones)
  && value.milestones.length >= 1
  && value.milestones.length <= 12
  && validStringArray(value.cautions, 8)
  && value.milestones.every((milestone) => exactObjectKeys(
    milestone,
    ["title", "outcome", "activities", "estimatedMinutes", "evidenceOfMastery"],
  )
    && requiredText(milestone.title)
    && requiredText(milestone.outcome)
    && validStringArray(milestone.activities, 8)
    && Number.isSafeInteger(milestone.estimatedMinutes)
    && milestone.estimatedMinutes >= 5
    && milestone.estimatedMinutes <= 2_400
    && requiredText(milestone.evidenceOfMastery));

const validateStructuredResult = (task, value) => {
  if (task === "quiz") return validateTutorQuiz(value);
  if (task === "flashcards") return validateTutorFlashcards(value);
  if (task === "study_plan") return validateTutorStudyPlan(value);
  if (task === "answer_feedback") return validateTutorAnswerFeedback(value);
  return false;
};

const isLocalHost = () => {
  if (typeof window === "undefined") return true;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1";
};

const hasSecureTransport = () => typeof window === "undefined" || window.isSecureContext || isLocalHost();

const verifyPublicConfig = (config) => {
  if (!config || typeof config !== "object") return "The AI server returned an invalid configuration.";
  if (typeof config.enabled !== "boolean") return "The AI server did not return a valid availability state.";
  if (config.provider !== "ollama-local") return "The server is not using Lumen’s approved local-model provider.";
  if (config.enabled && !requiredText(config.model, 200)) return "The server did not identify its configured AI model.";
  if (config.endpoint && config.endpoint !== "/api/ai/respond") return "The AI endpoint is not the expected same-origin endpoint.";
  if ((config.streamEndpoint !== undefined || config.streamProtocol !== undefined)
    && (config.streamEndpoint !== "/api/ai/respond/stream" || config.streamProtocol !== "lumen.ai.ndjson.v1")) return "The AI server advertises an incompatible streaming protocol.";
  if (!config.privacy
    || config.privacy.localInference !== true
    || config.privacy.paidRemoteApisUsed !== false
    || config.privacy.apiKeyRequired !== false
    || config.privacy.apiKeyExposedToBrowser !== false) {
    return "The server did not prove the local, no-paid-API privacy contract.";
  }
  if (config.privacy.applicationServerStorage !== false || config.privacy.responseStorage !== false) {
    return "The server did not confirm the no-storage privacy contract.";
  }
  if (config.privacy.browserCanSelectProviderOrModel !== false
    || config.privacy.serviceEndpointsExposedToBrowser !== false
    || config.privacy.webSearchDisabledByDefaultPerRequest !== true) {
    return "The server did not confirm Lumen’s fixed-provider and per-request tool controls.";
  }
  if (!config.webSearch || config.webSearch.requiresPerRequestOptIn !== true || config.webSearch.tool !== "search_web") {
    return "The server did not return a safe web-search consent contract.";
  }
  if (!Number.isSafeInteger(config.limits?.maxInputChars)
    || config.limits.maxInputChars < 2_000
    || !Number.isSafeInteger(config.limits?.maxRequestUtf8Bytes)
    || config.limits.maxRequestUtf8Bytes < 1_024
    || !Number.isSafeInteger(config.limits?.maxOutputTokens)
    || config.limits.maxOutputTokens < 128
    || !Number.isSafeInteger(config.limits?.requestTimeoutMs)
    || config.limits.requestTimeoutMs < 1_000
    || !Number.isSafeInteger(config.limits?.clientTimeoutMs)
    || config.limits.clientTimeoutMs <= config.limits.requestTimeoutMs
    || config.limits.clientTimeoutMs > 315_000) return "The AI server returned invalid safety limits.";
  const profiles = config.responseProfiles;
  if (!profiles || profiles.default !== "balanced"
    || !Array.isArray(profiles.allowed)
    || !RESPONSE_PROFILES.every((profile) => profiles.allowed.includes(profile.id))
    || profiles.providerThinkingReturned !== false
    || profiles.deepUsesPrivateModelThinkingWhenSupported !== true
    || !RESPONSE_PROFILES.every((profile) => Number.isSafeInteger(profiles.outputTokens?.[profile.id])
      && profiles.outputTokens[profile.id] >= 128
      && profiles.outputTokens[profile.id] <= config.limits.maxOutputTokens)
    || !RESPONSE_PROFILES.every((profile) => Number.isSafeInteger(profiles.maxRequestUtf8Bytes?.[profile.id])
      && profiles.maxRequestUtf8Bytes[profile.id] >= 1_024)
    || profiles.outputTokens.fast > profiles.outputTokens.balanced
    || profiles.outputTokens.balanced > profiles.outputTokens.deep
    || profiles.maxRequestUtf8Bytes.fast < profiles.maxRequestUtf8Bytes.balanced
    || profiles.maxRequestUtf8Bytes.balanced < profiles.maxRequestUtf8Bytes.deep) {
    return "The AI server returned an invalid response-profile or private-thinking disclosure contract.";
  }
  const availableTasks = new Set(Array.isArray(config.supportedTasks) ? config.supportedTasks : []);
  if (MODE_OPTIONS.some((mode) => !availableTasks.has(mode.task))) return "The AI server does not support every displayed learning mode.";
  return "";
};

const modeById = (id) => MODE_OPTIONS.find((mode) => mode.id === id) || HIDDEN_MODES.find((mode) => mode.id === id) || MODE_OPTIONS[0];
// The composer only ever holds a listed mode; a hidden one reopens as its
// `composerMode`, or Explain.
const composerModeFor = (id) => {
  const mode = modeById(id);
  if (!mode.hidden) return mode;
  return MODE_OPTIONS.find((item) => item.id === mode.composerMode) || MODE_OPTIONS[0];
};
const profileLabel = (id) => RESPONSE_PROFILES.find((item) => item.id === id)?.label || "Balanced";

/**
 * One structured-result field (quiz option, card side, plan step) rendered as
 * sanitized inline Markdown: KaTeX math, emphasis, code spans and the same
 * citation controls as prose answers, handled by delegation.
 */
const InlineRichText = ({ text, citationSources = [], webSources = [], onNavigateSource, className = "" }) => {
  const markup = useMemo(
    () => ({ __html: renderTutorInlineMarkdown(text, citationSources, webSources) }),
    [citationSources, text, webSources],
  );
  const handleClick = useCallback((event) => {
    const citation = event.target.closest?.("[data-ai-citation]");
    if (!citation) return;
    // A citation inside a quiz option label must not also pick that option.
    event.preventDefault();
    const match = citation.dataset.aiCitation?.match(/^S(\d+)$/);
    const source = match && citationSources.find((item) => item.citationNumber === Number(match[1]));
    if (source) onNavigateSource?.(source.original, { citation: `[S${source.citationNumber}]`, sourceId: source.id });
  }, [citationSources, onNavigateSource]);
  // renderTutorInlineMarkdown shows provider HTML as text, then sanitizes through DOMPurify.
  return <span className={`ai-tutor__inline-md ${className}`.trim()} onClick={handleClick} dangerouslySetInnerHTML={markup} />;
};

const copyPlainText = async (text) => {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
};

/** Sanitized, GFM-capable output that remains valid while a stream is partial. */
const SafeResponseText = ({ text, citationSources, webSources, onNavigateSource, streaming = false }) => {
  const responseRef = useRef(null);
  const html = useMemo(
    () => renderTutorMarkdown(text, citationSources, webSources),
    [citationSources, text, webSources],
  );
  // Keep React from replacing renderer-owned diagrams on unrelated updates.
  const htmlMarkup = useMemo(() => ({ __html: html }), [html]);
  // Partial fenced blocks are ordinary during token streaming. Rendering is
  // intentionally deferred until the validated terminal answer is mounted.
  useMermaidDiagrams(responseRef, { contentKey: html, enabled: !streaming });
  useScrollableRegions(responseRef, html);
  const handleClick = useCallback((event) => {
    const citation = event.target.closest?.("[data-ai-citation]");
    if (citation) {
      event.preventDefault();
      const match = citation.dataset.aiCitation?.match(/^S(\d+)$/);
      const source = match && citationSources.find((item) => item.citationNumber === Number(match[1]));
      if (source) onNavigateSource?.(source.original, { citation: `[S${source.citationNumber}]`, sourceId: source.id });
      return;
    }
    const copyButton = event.target.closest?.(".code-copy");
    if (copyButton) {
      event.preventDefault();
      const code = copyButton.closest(".code-shell")?.querySelector("code")?.textContent || "";
      void copyPlainText(code).then((copied) => {
        if (!copied || !copyButton.isConnected) return;
        const previous = copyButton.textContent;
        copyButton.textContent = "Copied";
        window.setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = previous; }, 1_500);
      });
    }
  }, [citationSources, onNavigateSource]);
  return (
    <div
      ref={responseRef}
      className={`ai-tutor__response-text markdown-body ${streaming ? "is-streaming" : ""}`}
      onClick={handleClick}
      // renderTutorMarkdown shows provider HTML as text, then sanitizes through DOMPurify.
      dangerouslySetInnerHTML={htmlMarkup}
    />
  );
};

const optionLetter = (index) => String.fromCharCode(65 + index);

/**
 * An interactive quiz (TFEAT-01). What the learner chose, how sure they were
 * and what they checked live in the tutor's per-tab quiz state, so leaving
 * #/ai keeps them. Once every question is checked the score is shown and
 * announced once; misses can be explained, saved to the mistake notebook or
 * turned into a new quiz.
 */
const QuizResult = ({
  quiz,
  message,
  onNavigateSource,
  quizState,
  onQuizStateChange,
  onAnnounce,
  explanations = {},
  explainUnavailable = "",
  requestBusy = false,
  onExplainMistake,
  onShowExplanation,
  onSaveMisses,
  onWeakSpotQuiz,
}) => {
  const messageId = message.id;
  const { citationSources, webSources } = message;
  const state = useMemo(() => normalizeQuizState(quizState), [quizState]);
  const { answers, checked, confidence } = state;
  const explainReasonId = useId();
  const summaryTitleId = useId();
  const [saveStatus, setSaveStatus] = useState({ status: "idle", message: "" });
  // "Check answer" is replaced by its feedback; focus follows it there.
  const focusFeedbackRef = useRef("");
  const cite = (text, className) => <InlineRichText className={className} text={text} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} />;
  const summary = quizSummary(quiz, state);
  const disputed = new Set(Object.entries(explanations).filter(([, explanation]) => explanation.disputed).map(([questionId]) => questionId));
  const documentIds = citationSources.map((source) => source.original?.documentId || source.original?.id || "");
  const unsaved = quizMissDrafts(quiz, state, { documentIds, disputed });
  const savable = summary.misses.filter(({ question }) => !disputed.has(question.id));
  const allSaved = savable.length > 0 && unsaved.length === 0;
  const change = (updater) => onQuizStateChange?.(messageId, updater);
  const check = (question) => {
    focusFeedbackRef.current = question.id;
    const next = { ...state, checked: { ...state.checked, [question.id]: true } };
    const after = quizSummary(quiz, next);
    const announceNow = after.complete && !state.summaryAnnounced;
    change((current) => ({ ...current, checked: { ...current.checked, [question.id]: true }, summaryAnnounced: current.summaryAnnounced || announceNow }));
    // The score is announced once, through the tutor's one status region.
    if (announceNow) onAnnounce?.(`Quiz complete: ${after.correct} of ${after.total} correct.${after.confidentMisses ? ` You were certain about ${after.confidentMisses} of the answers you missed.` : ""}`);
  };
  const saveMisses = async () => {
    if (!onSaveMisses || saveStatus.status === "saving") return;
    if (!unsaved.length) {
      setSaveStatus({ status: "saved", message: "These misses are already in your mistake notebook." });
      return;
    }
    setSaveStatus({ status: "saving", message: "Saving your misses…" });
    try {
      const result = await onSaveMisses(unsaved.map(({ questionId: _questionId, ...draft }) => draft));
      const added = Number.isSafeInteger(result?.added) ? result.added : unsaved.length;
      const merged = Number.isSafeInteger(result?.merged) ? result.merged : 0;
      change((current) => ({ ...current, saved: { ...current.saved, ...Object.fromEntries(unsaved.map((draft) => [draft.questionId, true])) } }));
      const noun = (count) => `${count} miss${count === 1 ? "" : "es"}`;
      setSaveStatus({
        status: "saved",
        message: added && merged
          ? `Saved ${noun(added)} to your mistake notebook. ${merged === 1 ? "One was" : `${merged} were`} already there, so ${merged === 1 ? "its count" : "their counts"} went up.`
          : added
            ? `Saved ${noun(added)} to your mistake notebook. Correct ${added === 1 ? "it" : "them"} in Review.`
            : `${merged === 1 ? "This miss was" : "These misses were"} already in your mistake notebook, so ${merged === 1 ? "its count" : "their counts"} went up.`,
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : "";
      setSaveStatus({ status: "error", message: `Your misses were not saved.${reason} Try again.` });
    }
  };
  return (
    <div className="ai-tutor__quiz">
      <div className="ai-tutor__result-title"><FileQuestion size={20} aria-hidden="true" /><div><h4>{quiz.title}</h4><p>{cite(quiz.instructions)}</p></div></div>
      {quiz.questions.map((question, questionIndex) => {
        const chosen = answers[question.id];
        const revealed = checked[question.id];
        const correct = chosen === question.correctIndex;
        const answerLetter = optionLetter(question.correctIndex);
        const sure = confidence[question.id] || "";
        const explanation = explanations[question.id];
        return (
          <fieldset className="ai-tutor__quiz-question" key={question.id}>
            <legend><span className="ai-tutor__quiz-number">{questionIndex + 1}</span>{cite(question.prompt, "ai-tutor__quiz-prompt")}</legend>
            <span className="ai-tutor__difficulty-tag">{question.difficulty}</span>
            <div className="ai-tutor__quiz-options">
              {question.options.map((option, optionIndex) => {
                const isCorrect = revealed && optionIndex === question.correctIndex;
                const isIncorrect = revealed && optionIndex === chosen && !correct;
                return (
                  <label className={`${isCorrect ? "is-correct" : ""} ${isIncorrect ? "is-incorrect" : ""}`} key={`${question.id}-${optionIndex}`}>
                    <input
                      type="radio"
                      name={`quiz-${messageId}-${question.id}`}
                      checked={chosen === optionIndex}
                      disabled={revealed}
                      onChange={() => change((current) => ({ ...current, answers: { ...current.answers, [question.id]: optionIndex } }))}
                    />
                    <span className="ai-tutor__quiz-option-text">
                      <span className="ai-tutor__option-letter">{optionLetter(optionIndex)}.</span> {cite(option)}
                      {(isCorrect || isIncorrect) && <span className={`ai-tutor__option-mark ${isCorrect ? "is-correct" : "is-incorrect"}`}>{isCorrect ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}<span>{isCorrect ? (optionIndex === chosen ? "Your answer · correct" : "Correct answer") : "Your answer · incorrect"}</span></span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {!revealed && Number.isSafeInteger(chosen) && (
              <fieldset className="ai-tutor__confidence">
                <legend>How sure are you?</legend>
                <div>
                  {CONFIDENCE_LEVELS.map((level) => (
                    <label className={sure === level.id ? "is-active" : ""} key={level.id}>
                      <input type="radio" name={`quiz-${messageId}-${question.id}-confidence`} value={level.id} checked={sure === level.id} onChange={() => change((current) => ({ ...current, confidence: { ...current.confidence, [question.id]: level.id } }))} />
                      <span>{level.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!revealed ? (
              <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={!Number.isSafeInteger(chosen)} onClick={() => check(question)}>Check answer</button>
            ) : (
              <div
                className={correct ? "ai-tutor__quiz-feedback is-correct" : "ai-tutor__quiz-feedback is-incorrect"}
                tabIndex={-1}
                ref={(node) => {
                  if (!node || focusFeedbackRef.current !== question.id) return;
                  focusFeedbackRef.current = "";
                  node.focus({ preventScroll: true });
                }}
              >
                <strong>{correct ? `Correct — ${answerLetter} is right.` : `Not quite — the correct answer is ${answerLetter}.`}</strong>
                {!correct && sure === "certain" && <p className="ai-tutor__confident-miss">You were certain. A confident miss is the most useful one to fix.</p>}
                <p>{cite(question.explanation)}</p>
                {!correct && explanation?.disputed && <p className="ai-tutor__quiz-dispute">The answer check disagreed with this key, so it is not saved as a mistake. Check the sources before trusting either.</p>}
                {!correct && onExplainMistake && (explanation?.answerId ? (
                  <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => onShowExplanation?.(explanation.answerId)}>See the explanation</button>
                ) : (
                  <div className="ai-tutor__explain-mistake">
                    <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={requestBusy || Boolean(explainUnavailable)} aria-describedby={explainUnavailable ? explainReasonId : undefined} onClick={() => onExplainMistake(message, question, chosen)}>{explanation?.pending ? <><LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> Checking your answer…</> : "Explain my mistake"}</button>
                    {explainUnavailable && <small id={explainReasonId}>{explainUnavailable}</small>}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
      {summary.complete && (
        <section className="ai-tutor__quiz-summary" aria-labelledby={summaryTitleId}>
          <h5 id={summaryTitleId}>{summary.correct} of {summary.total} correct</h5>
          <p>{!summary.misses.length
            ? "Every answer was right."
            : summary.confidentMisses
              ? `You were certain about ${summary.confidentMisses === 1 ? "one answer" : `${summary.confidentMisses} answers`} you missed. Review ${summary.confidentMisses === 1 ? "it" : "those"} first.`
              : `Review the ${summary.misses.length === 1 ? "one" : summary.misses.length} you missed while ${summary.misses.length === 1 ? "it is" : "they are"} fresh.`}</p>
          {summary.misses.length > 0 && (
            <ul className="ai-tutor__quiz-misses">
              {summary.misses.map((miss) => <li key={miss.question.id}><span>Question {miss.index + 1}</span>{miss.confidence === "certain" && <span className="ai-tutor__confident-badge">You were certain</span>}</li>)}
            </ul>
          )}
          {summary.misses.length > 0 && (
            <div className="ai-tutor__quiz-summary-actions">
              {onSaveMisses && savable.length > 0 && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" aria-disabled={allSaved || saveStatus.status === "saving" || undefined} onClick={saveMisses}>{saveStatus.status === "saving" ? <LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> : allSaved ? <Check size={16} aria-hidden="true" /> : <NotebookPen size={16} aria-hidden="true" />} {allSaved ? "Saved for review" : "Save misses for review"}</button>}
              {onWeakSpotQuiz && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={requestBusy} onClick={() => onWeakSpotQuiz(message, summary.misses)}><FileQuestion size={16} aria-hidden="true" /> New quiz on my weak spots</button>}
            </div>
          )}
          {saveStatus.message && <p className={`ai-tutor__draft-status is-${saveStatus.status}`} role="status">{saveStatus.message}</p>}
        </section>
      )}
    </div>
  );
};

/**
 * "Explain my mistake" (TFEAT-01): the answer check for one keyed quiz miss.
 * Its score and strengths are not shown (correctness is already known), and
 * the quiz key stays visible above it. A check that sides with the learner
 * says so instead of overruling the key.
 */
const FeedbackResult = ({ feedback, message, question, onNavigateSource, onAnswerCheck }) => {
  const cite = (text) => <InlineRichText text={text} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} />;
  const evidence = message.citationSources[0];
  return (
    <div className="ai-tutor__feedback">
      <div className="ai-tutor__result-title"><Lightbulb size={20} aria-hidden="true" /><div><h4>Why that answer missed</h4>{question && <p>{withoutCitationLabels(question.prompt)}</p>}</div></div>
      {feedback.correct === true && <p className="ai-tutor__feedback-dispute">The tutor&rsquo;s second look disagrees with the quiz key. {evidence ? <>Check {cite(`[S${evidence.citationNumber}]`)} before trusting either answer.</> : "Check the lesson before trusting either answer."}</p>}
      <section><h5>Why</h5><p>{cite(feedback.feedback)}</p></section>
      {feedback.gaps.length > 0 && <section><h5>What was missing</h5><ul>{feedback.gaps.map((gap, index) => <li key={`${index}-${gap}`}>{cite(gap)}</li>)}</ul></section>}
      <section><h5>Correct reasoning</h5><p>{cite(feedback.improvedAnswer)}</p></section>
      {feedback.nextQuestion && (
        <section className="ai-tutor__feedback-check">
          <h5>Check yourself</h5>
          <p>{cite(feedback.nextQuestion)}</p>
          {onAnswerCheck && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => onAnswerCheck(message, feedback.nextQuestion)}><MessageCircleQuestion size={16} aria-hidden="true" /> Answer this</button>}
        </section>
      )}
    </div>
  );
};

const FlashcardResult = ({ cards, message, onCreateFlashcardDrafts, onNavigateSource }) => {
  const [selected, setSelected] = useState(() => cards.map((_, index) => index));
  const [expanded, setExpanded] = useState({});
  const [draftState, setDraftState] = useState({ status: "idle", message: "" });
  const selectionSet = useMemo(() => new Set(selected), [selected]);
  // A finished add stays reflected on the button until the selection changes.
  const changeSelection = (update) => {
    setSelected(update);
    setDraftState((current) => current.status === "saving" ? current : { status: "idle", message: "" });
  };
  const toggle = (index) => changeSelection((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((a, b) => a - b));
  const createDrafts = async () => {
    if (!onCreateFlashcardDrafts || !selected.length || ["saving", "saved", "exists"].includes(draftState.status)) return;
    setDraftState({ status: "saving", message: "Adding selected drafts…" });
    try {
      const chosenCards = selected.map((index) => cards[index]).map((card) => ({
        type: "basic",
        front: card.front.trim(),
        back: card.back.trim(),
        hint: card.hint?.trim() || null,
        tags: [...new Set(card.tags.map((tag) => tag.trim()).filter(Boolean))],
      }));
      const result = await onCreateFlashcardDrafts(chosenCards, {
        requestId: message.requestId,
        mode: message.mode,
        sourceIds: message.citationSources.map((source) => source.id),
        webSources: message.webSources.map(({ title, url }) => ({ title, url })),
      });
      const added = Number.isSafeInteger(result?.added) ? result.added : chosenCards.length;
      const skipped = Number.isSafeInteger(result?.skipped) ? result.skipped : 0;
      if (!added && skipped) {
        setDraftState({ status: "exists", message: `Already in Review: ${skipped === 1 ? "this card is" : `all ${skipped} cards are`} in your deck.` });
        return;
      }
      setDraftState({ status: "saved", message: `${added} flashcard draft${added === 1 ? "" : "s"} added for review${skipped ? `; ${skipped} already in Review` : ""}.` });
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : "";
      setDraftState({ status: "error", message: `The drafts could not be added.${reason} Your selection is still here; try again.` });
    }
  };
  return (
    <div className="ai-tutor__flashcards">
      <div className="ai-tutor__flashcard-actions">
        <p><strong>{selected.length}</strong> of {cards.length} selected</p>
        <button className="ai-tutor__text-button" type="button" onClick={() => changeSelection(selected.length === cards.length ? [] : cards.map((_, index) => index))}>{selected.length === cards.length ? "Clear all" : "Select all"}</button>
      </div>
      {cards.map((card, index) => (
        <article className={`ai-tutor__flashcard ${selectionSet.has(index) ? "is-selected" : ""}`} key={`${message.id}-card-${index}`}>
          <label className="ai-tutor__flashcard-select">
            <input type="checkbox" checked={selectionSet.has(index)} onChange={() => toggle(index)} />
            <span>Select card {index + 1}</span>
          </label>
          <span className="ai-tutor__flashcard-side">Prompt</span>
          <p><InlineRichText text={card.front} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} /></p>
          <button className="ai-tutor__text-button" type="button" aria-expanded={Boolean(expanded[index])} onClick={() => setExpanded((current) => ({ ...current, [index]: !current[index] }))}>{expanded[index] ? "Hide answer" : "Reveal answer"}<ChevronDown size={16} aria-hidden="true" /></button>
          {expanded[index] && <div className="ai-tutor__flashcard-answer"><span className="ai-tutor__flashcard-side">Answer</span><p><InlineRichText text={card.back} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} /></p>{card.hint && <p className="ai-tutor__hint"><strong>Hint:</strong> <InlineRichText text={card.hint} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} /></p>}</div>}
          {card.tags.length > 0 && <div className="ai-tutor__tags" role="group" aria-label="Suggested tags">{card.tags.map((tag, tagIndex) => <span key={`${tagIndex}-${tag}`}>{tag}</span>)}</div>}
        </article>
      ))}
      {onCreateFlashcardDrafts ? <button className="ai-tutor__button ai-tutor__button--primary" type="button" disabled={!selected.length} aria-disabled={["saving", "saved", "exists"].includes(draftState.status) || undefined} onClick={createDrafts}>{draftState.status === "saving" ? <LoaderCircle className="ai-tutor__spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />} {draftState.status === "saved" ? "Added to Review" : draftState.status === "exists" ? "Already in Review" : "Add selected to review"}</button> : <p className="ai-tutor__muted">Flashcard drafts are ready. Connect the review-deck callback to save them.</p>}
      {draftState.message && <p className={`ai-tutor__draft-status is-${draftState.status}`} role="status">{draftState.message}</p>}
    </div>
  );
};

const StudyPlanResult = ({ plan, citationSources, webSources, onNavigateSource }) => (
  <div className="ai-tutor__study-plan">
    <div className="ai-tutor__result-title"><Sparkles size={20} aria-hidden="true" /><div><h4>{plan.title}</h4><p><InlineRichText text={plan.goal} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p></div></div>
    <ol>
      {plan.milestones.map((milestone, index) => (
        <li key={`${milestone.title}-${index}`}>
          <div className="ai-tutor__milestone-head"><span>{index + 1}</span><div><h5><InlineRichText text={milestone.title} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></h5><small>{milestone.estimatedMinutes} minutes</small></div></div>
          <p><InlineRichText text={milestone.outcome} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p>
          <ul>{milestone.activities.map((activity, activityIndex) => <li key={`${activityIndex}-${activity}`}><InlineRichText text={activity} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></li>)}</ul>
          <p className="ai-tutor__mastery"><strong>Evidence of mastery:</strong> <InlineRichText text={milestone.evidenceOfMastery} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p>
        </li>
      ))}
    </ol>
    {plan.cautions.length > 0 && <div className="ai-tutor__cautions"><strong>Watch for</strong><ul>{plan.cautions.map((caution, cautionIndex) => <li key={`${cautionIndex}-${caution}`}><InlineRichText text={caution} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></li>)}</ul></div>}
  </div>
);

const AssistantMessage = ({ message, onCreateFlashcardDrafts, onNavigateSource, streaming = false, study = {} }) => {
  if (message.mode === "quiz" && validateTutorQuiz(message.data)) return <QuizResult quiz={message.data} message={message} onNavigateSource={onNavigateSource} {...study} />;
  if (message.mode === "feedback" && validateTutorAnswerFeedback(message.data)) return <FeedbackResult feedback={message.data} message={message} question={study.feedbackQuestion} onNavigateSource={onNavigateSource} onAnswerCheck={study.onAnswerCheck} />;
  if (message.mode === "interview-practice" && validateTutorAnswerFeedback(message.data) && practiceQuestionIdFrom(message)) {
    // The rubric view loads with the authored bank (TFEAT-06).
    const { Rubric, ...rubricProps } = study;
    const cite = (text) => <InlineRichText text={text} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} />;
    return Rubric ? <Rubric feedback={message.data} message={message} cite={cite} {...rubricProps} /> : <p className="ai-tutor__muted">{study.bankStatus === "error" ? "The rubric for this answer could not be loaded." : "Loading the rubric…"}</p>;
  }
  if (message.mode === "flashcards" && validateTutorFlashcards(message.data)) return <FlashcardResult cards={message.data.cards} message={message} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} />;
  if (message.mode === "study-plan" && validateTutorStudyPlan(message.data)) return <StudyPlanResult plan={message.data} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} />;
  return <SafeResponseText text={message.content} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} streaming={streaming} />;
};

const webFallbackCopy = (status) => ({
  armed: "Web fallback armed for this request",
  "not-needed": "Web fallback not needed — local evidence was sufficient",
  searching: "Searching the current web with your one-request authorization",
  used: "Current-web evidence used",
  failed: "Current-web fallback failed",
}[status] || "Web fallback off");

const WebFallbackBadge = ({ status }) => {
  const normalized = normalizeWebFallbackStatus(status);
  if (normalized === "off") return null;
  return <span className={`ai-tutor__web-status is-${normalized}`}>{webFallbackCopy(normalized)}</span>;
};

const requestErrorTitle = (status, code) => {
  if (status === "cancelled") return "Request cancelled";
  if (code === "AI_INCOMPLETE_RESPONSE") return "The answer reached its length limit";
  if (code === "AI_CONTEXT_LIMIT" || code === "AI_INPUT_TOO_LARGE") return "The request needs a smaller fitted context";
  if (code === "WEB_SEARCH_UNGROUNDED" || code === "AI_CURRICULUM_UNGROUNDED") return "The answer did not meet its grounding check";
  return "The tutor could not respond";
};

// These failures can mean the server/model contract changed after this tab
// last fetched /api/ai/config. Do not leave a stale green Ready badge or a
// retry button that simply resends the now-invalid snapshot.
const CONFIG_INVALIDATING_REQUEST_ERRORS = new Set([
  "VALIDATION_ERROR",
  "AI_CONTRACT_MISMATCH",
  "AI_PROFILE_UNSUPPORTED",
  "AI_AUTH_REQUIRED",
  "AI_CONTEXT_LIMIT",
  "AI_INPUT_TOO_LARGE",
  "AI_NETWORK_ERROR",
  "AI_UNAVAILABLE",
  "AI_LOCAL_MODEL_UNAVAILABLE",
  "AI_MODEL_NOT_FOUND",
  "AI_MODEL_IDENTITY_UNVERIFIED",
]);

const ResponseEvidence = ({ message, onNavigateSource }) => (
  <div className="ai-tutor__evidence" role="group" aria-label="Evidence attached to this response">
    {message.citationSources.length > 0 && (
      <section>
        <strong>Library evidence</strong>
        <div className="ai-tutor__message-sources">
          {message.citationSources.map((source) => (
            <button type="button" onClick={() => onNavigateSource?.(source.original, { citation: `[S${source.citationNumber}]`, sourceId: source.id })} disabled={!onNavigateSource} key={source.id}>
              <span>[S{source.citationNumber}]</span> {source.title}
            </button>
          ))}
        </div>
      </section>
    )}
    {message.webSources.length > 0 && (
      <section className="ai-tutor__web-sources" aria-label="Public web evidence used for this response">
        <strong>Web evidence</strong>
        <ul>{message.webSources.map((source, sourceIndex) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer"><span>[W{Number.isSafeInteger(source.index) ? source.index : sourceIndex + 1}] {source.title}</span><ExternalLink size={13} aria-hidden="true" /></a>{(source.source || source.publishedAt) && <small>{[source.source, source.publishedAt].filter(Boolean).join(" · ")}</small>}{source.snippet && <small>{source.snippet}</small>}</li>)}</ul>
      </section>
    )}
  </div>
);

const ResponseApproach = ({ message }) => {
  const mode = modeById(message.mode).label;
  return (
    <div className="ai-tutor__approach">
      <strong>How this answer was assembled</strong>
      {message.approach && <div className="ai-tutor__approach-plan"><p>{message.approach.summary}</p><ol>{message.approach.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></div>}
      <ul>
        {message.retrievalTrace && <li>{message.retrievalTrace.summary || `${message.retrievalTrace.strategy || "Library"} retrieval selected ${message.retrievalTrace.passages ?? message.citationSources.length} passages${message.retrievalTrace.matchedDocuments === null ? "" : ` across ${message.retrievalTrace.matchedDocuments} matching documents`}${message.retrievalTrace.candidates === null ? "" : ` after scanning ${message.retrievalTrace.candidates}`}.`}{message.retrievalTrace.confidenceLevel && ` Confidence: ${message.retrievalTrace.confidenceLevel}${message.retrievalTrace.confidenceScore === null ? "" : ` (${Math.round(message.retrievalTrace.confidenceScore * 100)}%)`}.`}{message.retrievalTrace.budgetTruncated && " Passage selection reached its byte budget."}</li>}
        {message.retrievalTrace?.webFallbackCode && <li>Web fallback decision: {message.retrievalTrace.webFallbackRecommended ? "recommended" : "not needed"} ({message.retrievalTrace.webFallbackCode}){message.retrievalTrace.webFallbackReason ? ` — ${message.retrievalTrace.webFallbackReason}` : ""}.</li>}
        <li>{message.citationSources.length ? `Grounded against ${message.citationSources.length} supplied library source${message.citationSources.length === 1 ? "" : "s"}.` : "No library source was attached to this answer."}</li>
        <li>{message.webSources.length ? `Checked ${message.webSources.length} public web result${message.webSources.length === 1 ? "" : "s"} and attached the returned links.` : "No public web evidence is attached."}</li>
        <li>Formatted the result as a {mode.toLocaleLowerCase()} response with evidence labels where available.</li>
      </ul>
      {message.retrievalTrace && (
        <details className="ai-tutor__trace-details">
          <summary>Library retrieval details</summary>
          <dl>
            <div><dt>Strategy</dt><dd>{message.retrievalTrace.strategy || "library-first"}</dd></div>
            <div><dt>Documents scanned</dt><dd>{message.retrievalTrace.candidates ?? "Unavailable"}</dd></div>
            <div><dt>Documents matched</dt><dd>{message.retrievalTrace.matchedDocuments ?? "Unavailable"}</dd></div>
            <div><dt>Passages attached</dt><dd>{message.retrievalTrace.passages ?? message.citationSources.length}</dd></div>
            <div><dt>Confidence</dt><dd>{message.retrievalTrace.confidenceLevel || "Unrated"}{message.retrievalTrace.confidenceScore === null ? "" : ` · ${Math.round(message.retrievalTrace.confidenceScore * 100)}%`}</dd></div>
            {message.retrievalTrace.confidenceCoverage !== null && <div><dt>Query coverage</dt><dd>{Math.round(message.retrievalTrace.confidenceCoverage * 100)}%</dd></div>}
            {message.retrievalTrace.lexicalStrength !== null && <div><dt>Lexical strength</dt><dd>{Math.round(message.retrievalTrace.lexicalStrength * 100)}%</dd></div>}
            {message.retrievalTrace.diversity !== null && <div><dt>Source diversity</dt><dd>{Math.round(message.retrievalTrace.diversity * 100)}%</dd></div>}
            {message.retrievalTrace.maximumBytes !== null && <div><dt>Passage budget</dt><dd>{(message.retrievalTrace.returnedBytes ?? 0).toLocaleString()} / {message.retrievalTrace.maximumBytes.toLocaleString()} bytes{message.retrievalTrace.budgetTruncated ? " · truncated" : ""}</dd></div>}
          </dl>
        </details>
      )}
      {message.conversationMemory && (
        <details className="ai-tutor__memory">
          <summary>Older turns compacted ({message.conversationMemory.compactedMessages} messages)</summary>
          <pre>{message.conversationMemory.summary}</pre>
        </details>
      )}
      <p>This is disclosure-safe orchestration and evidence metadata—not the model’s private reasoning or chain-of-thought.</p>
    </div>
  );
};

const MessageActions = ({ message, onNavigateSource, onPrepareRegenerate, onReusePrompt, onSaveAnswerNote, requestBusy = false, listen = null }) => {
  const saveHintId = useId();
  const [panel, setPanel] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");
  const [noteStatus, setNoteStatus] = useState("idle");
  const hasEvidence = message.citationSources.length > 0 || message.webSources.length > 0;
  const canSaveNote = message.role === "assistant" && !message.incomplete && typeof onSaveAnswerNote === "function";
  const noun = message.role === "assistant" ? "response" : "request";
  const saveNote = () => {
    // Saved stays focusable (aria-disabled) so keyboard focus is not lost.
    if (noteStatus === "saved") return;
    const saved = onSaveAnswerNote({
      // Structured results are saved as the readable Markdown the learner saw;
      // the host appends the source list itself.
      content: tutorMessageMarkdown(message, { includeSources: false }),
      title: `AI ${modeById(message.mode).label.toLocaleLowerCase()} answer`,
      citationSources: message.citationSources,
      webSources: message.webSources,
    });
    if (saved) setNoteStatus("saved");
  };
  const copyMessage = async () => {
    // Raw Markdown keeps code, math and emphasis exact; structured results and
    // the source list make the copy readable where it is pasted.
    const copied = await copyPlainText(message.role === "assistant" ? tutorMessageMarkdown(message) : message.content);
    setCopyStatus(copied ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 1_800);
  };
  const togglePanel = (next) => setPanel((current) => current === next ? "" : next);
  return (
    <>
      <div className="ai-tutor__message-actions" role="group" aria-label={`${message.role === "assistant" ? "Response" : "Request"} actions`}>
        <button type="button" onClick={copyMessage}>
          {copyStatus === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy"}<span className="visually-hidden"> {noun}</span>
        </button>
        {message.role === "user" && <button type="button" disabled={requestBusy} onClick={() => onReusePrompt?.(message)}><RotateCcw size={15} aria-hidden="true" /> Edit & reuse</button>}
        {message.role === "assistant" && <button type="button" disabled={requestBusy} onClick={() => onPrepareRegenerate?.(message)}><RotateCcw size={15} aria-hidden="true" /> Edit & regenerate</button>}
        {canSaveNote && <button type="button" aria-disabled={noteStatus === "saved" || undefined} aria-describedby={saveHintId} onClick={saveNote}>{noteStatus === "saved" ? <Check size={15} aria-hidden="true" /> : <NotebookPen size={15} aria-hidden="true" />} {noteStatus === "saved" ? "Saved to notes" : "Save to notes"}</button>}
        {message.role === "assistant" && hasEvidence && <button type="button" aria-expanded={panel === "sources"} onClick={() => togglePanel("sources")}><BookOpen size={15} aria-hidden="true" /> Sources <span className="ai-tutor__action-count">{message.citationSources.length + message.webSources.length}</span></button>}
        {message.role === "assistant" && <button type="button" aria-expanded={panel === "approach"} onClick={() => togglePanel("approach")}><Sparkles size={15} aria-hidden="true" /> Approach</button>}
        {/* Listen, then Pause/Resume and Stop while this answer is read. */}
        {listen && (listen.state === "idle"
          ? <button type="button" className="ai-tutor__listen" onClick={listen.onListen}><Volume2 size={15} aria-hidden="true" /> Listen<span className="visually-hidden"> to this answer</span></button>
          : <>
            <button type="button" className="ai-tutor__listen is-active" onClick={listen.onTogglePause}>{listen.state === "paused" ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />} {listen.state === "paused" ? "Resume" : "Pause"}<span className="visually-hidden"> reading this answer</span></button>
            <button type="button" className="ai-tutor__listen-stop" onClick={listen.onStop}><Square size={13} aria-hidden="true" /> Stop<span className="visually-hidden"> reading</span></button>
          </>)}
      </div>
      {canSaveNote && <span className="visually-hidden" id={saveHintId}>{noteStatus === "saved" ? "This answer is in your Notebook as a labeled AI note." : "Saves this answer to your Notebook as a labeled AI note."}</span>}
      <span className="ai-tutor__copy-status" role="status" aria-live="polite">{copyStatus === "copied" ? message.role === "assistant" ? "Response copied as Markdown." : "Request copied." : copyStatus === "error" ? "Copy failed. Select the text and copy it manually." : listen?.error || ""}</span>
      {panel === "sources" && <ResponseEvidence message={message} onNavigateSource={onNavigateSource} />}
      {panel === "approach" && <ResponseApproach message={message} />}
    </>
  );
};

/**
 * One-tap next steps under the newest answer (TFEAT-02): a wrapping group of
 * native buttons, separate from the message actions, each a visible question
 * the learner can read in the conversation once it is sent.
 */
const FollowUps = ({ items, disabled = false, onChoose }) => (
  <div className="ai-tutor__follow-ups" role="group" aria-label="Follow up on this answer">
    <p className="ai-tutor__follow-ups-label" aria-hidden="true">Follow up</p>
    <div className="ai-tutor__follow-ups-list">
      {items.map((item) => <button type="button" disabled={disabled} onClick={() => onChoose(item)} key={item.id}>{item.label}</button>)}
    </div>
  </div>
);

/**
 * Secure learner-facing AI workspace.
 *
 * Props:
 * - sources: [{ id, title, section?, text|content|excerpt, selected? }]
 * - initialMode / initialPrompt / initialDifficulty: optional starting state
 * - initialHistory / historyTombstones / onHistoryChange: optional parent-owned local persistence
 * - onNavigateSource(source, { citation, sourceId }): opens an exact cited source
 * - onCreateFlashcardDrafts(cards, metadata): persists learner-selected drafts
 * - onSaveMistakes(drafts): records quiz or interview-practice misses in the
 *   mistake notebook and returns { added, merged }
 * - retrieveLibrary(query, options): optional local retrieval adapter
 * - speech: the app's speech engine (useSpeech), to read answers aloud
 * - studyContext: { recent, last, next, mistakes, reviewItems } for the
 *   suggested starts shown while the conversation is empty
 * - onClose: optional close action for hosts that show the tutor as a panel
 *
 * The component intentionally has no API-key or model-selection prop. Requests
 * always use the fixed same-origin client boundary in src/lib/aiClient.js.
 */
export default function AiTutor({
  sources = [],
  sourceCatalog = [],
  loadSource,
  initialMode = "explain",
  initialPrompt = "",
  insertPrompt = null,
  onInsertConsumed,
  onUseOnDevice,
  initialDifficulty = "intermediate",
  initialHistory = [],
  historyTombstones = [],
  onHistoryChange,
  onNavigateSource,
  onCreateFlashcardDrafts,
  onSaveMistakes,
  onSaveAnswerNote,
  onInteractionChange,
  retrieveLibrary,
  studyContext = null,
  speech = null,
  onClose,
  className = "",
}) {
  const headingId = useId();
  const promptId = useId();
  const sendReasonId = useId();
  const sendSummaryId = useId();
  const counterId = useId();
  const pairingErrorId = useId();
  const modeDescriptionId = useId();
  const optionsSummaryId = useId();
  const keyHintId = useId();
  const startersHeadingId = useId();
  const newTopicHintId = useId();
  const sessionTitleId = useId();
  const sourceNumbersRef = useRef(new Map());
  const nextSourceNumberRef = useRef(1);
  const requestControllerRef = useRef(null);
  const lastRequestRef = useRef(null);
  const conversationRef = useRef(null);
  // The end of the conversation, observed to know whether the newest text
  // is on screen (TFEAT-08).
  const conversationEndRef = useRef(null);
  const followStreamRef = useRef(true);
  const promptRef = useRef(null);
  const activeResponseRef = useRef(null);
  const streamFrameRef = useRef(0);
  // Focus and scroll are moved deliberately so they never fall to <body>
  // when the control that had focus is disabled or unmounted.
  const headingRef = useRef(null);
  const sendButtonRef = useRef(null);
  const composerRef = useRef(null);
  // When the current request started, so a double tap on Send does not land
  // on the Stop it turns into.
  const requestStartedAtRef = useRef(0);
  const streamingArticleRef = useRef(null);
  const requestNoticeRef = useRef(null);
  const focusStopOnMountRef = useRef(false);
  // A one-tap action's button goes away when its request starts; focus
  // moves to the answer in progress instead, and on to the answer after.
  const focusStreamOnMountRef = useRef(false);
  // The document a starter or a follow-up is about, used to favour it in
  // Library-first retrieval for the next question sent from the composer.
  const retrievalHintRef = useRef("");
  // Library search words for a prepared question from another screen, used
  // while the question is sent as it was placed: its instructions ("work
  // through this mistake…") name no topic.
  const retrievalQueryHintRef = useRef({ prompt: "", query: "" });
  const pendingFocusRef = useRef(null);
  // The conversation's last observed scroll position and height, to tell a
  // learner scrolling up from the tutor following new text downwards.
  const conversationScrollRef = useRef({ top: 0, height: 0 });
  const userScrolledRef = useRef(false);
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  const announce = useCallback((text) => setAnnouncement((current) => ({ text, id: current.id + 1 })), []);
  // Following an answer keeps its newest text in view, just above the
  // docked composer. Wide screens scroll the conversation's own scroller to
  // its end; the page itself only ever moves down, and only as far as that
  // end (or, on phones, the end of the conversation) needs.
  const composerSpaceRef = useRef(0);
  const [following, setFollowingState] = useState(true);
  const setFollowing = useCallback((value) => {
    followStreamRef.current = value;
    setFollowingState(value);
  }, []);
  const scrollConversationToEnd = useCallback(() => {
    const surface = conversationRef.current;
    const end = conversationEndRef.current;
    if (!surface) return;
    const ownScroller = getComputedStyle(surface).overflowY !== "visible" && surface.scrollHeight > surface.clientHeight + 1;
    if (ownScroller) surface.scrollTop = surface.scrollHeight;
    const edge = ownScroller ? surface : end;
    if (!edge) return;
    const visibleBottom = window.innerHeight - composerSpaceRef.current - 12;
    const overshoot = edge.getBoundingClientRect().bottom - visibleBottom;
    if (overshoot > 1) window.scrollBy({ top: overshoot, behavior: "instant" });
  }, []);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Phones pick the mode from a native select; wider screens show chips.
  const compactModes = useMediaQuery("(max-width: 719px)");
  // Enter sends only with a mouse or trackpad (TFEAT-10).
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const sourceModeRefs = useRef({});
  const pairingInputRef = useRef(null);
  const [storedDraft] = useState(readTutorDraft);
  const initialModeOption = modeById(MODE_OPTIONS.some((mode) => mode.id === storedDraft?.modeId) ? storedDraft.modeId : initialMode);
  const [modeId, setModeId] = useState(initialModeOption.id);
  const [difficulty, setDifficulty] = useState(() => [storedDraft?.difficulty, initialDifficulty].find((id) => DIFFICULTIES.some((item) => item.id === id)) || "intermediate");
  const [responseProfile, setResponseProfile] = useState(() => RESPONSE_PROFILES.some((item) => item.id === storedDraft?.responseProfile) ? storedDraft.responseProfile : "balanced");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [prompt, setPrompt] = useState(() => asTrimmedString(initialPrompt, MAX_PROMPT_CHARS)
    || asTrimmedString(storedDraft?.prompt, MAX_PROMPT_CHARS)
    || initialModeOption.prompt);
  const latestPromptRef = useRef(prompt);
  latestPromptRef.current = prompt;
  const onInsertConsumedRef = useRef(onInsertConsumed);
  onInsertConsumedRef.current = onInsertConsumed;
  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;
  const inFlightRef = useRef(null);
  const [composerNotice, setComposerNotice] = useState("");

  // The composer is sticky, so it is normally already in view: focus it in
  // place, and scroll only when the tutor itself is out of view.
  const focusComposer = useCallback(() => {
    const field = promptRef.current;
    if (!field?.isConnected) return;
    field.focus({ preventScroll: true });
    const box = field.getBoundingClientRect();
    const top = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
    const nav = document.querySelector(".bottom-nav");
    const bottom = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
    if (box.top < top || box.bottom > bottom) field.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, []);

  // Quick-insert (Reader selection → prompt). Each insert is applied once and
  // then consumed by the host, so a remount never brings back an excerpt that
  // was already sent. An unsent question the learner wrote is kept, the
  // lecture is named, and the composer is revealed and focused. A prepared
  // question from another screen (kind "prompt") is handled further down.
  const consumedInsertRef = useRef(null);
  useEffect(() => {
    if (!insertPrompt?.text || insertPrompt.kind === "prompt" || consumedInsertRef.current === insertPrompt.nonce) return;
    consumedInsertRef.current = insertPrompt.nonce;
    const lecture = asTrimmedString(insertPrompt.title, 200);
    const inserted = `Explain this excerpt from my lecture${lecture ? ` “${lecture}”` : ""} in context:\n\n"${insertPrompt.text}"`;
    const draft = latestPromptRef.current.trim();
    const keepDraft = Boolean(draft)
      && !MODE_OPTIONS.some((mode) => mode.prompt === draft)
      && !draft.startsWith("Explain this excerpt from my lecture");
    setPrompt(asTrimmedString(keepDraft ? `${draft}\n\n${inserted}` : inserted, MAX_PROMPT_CHARS));
    retrievalHintRef.current = "";
    setComposerNotice(`${keepDraft ? "Your unsent question was kept, and the" : "The"} selected excerpt from ${lecture ? `“${lecture}”` : "your lecture"} was added below. Review it, then send.`);
    onInsertConsumedRef.current?.(insertPrompt.nonce);
    window.setTimeout(focusComposer, 0);
  }, [focusComposer, insertPrompt]);
  const initialTombstones = new Set((Array.isArray(historyTombstones) ? historyTombstones : []).filter((id) => typeof id === "string"));
  const [history, setHistory] = useState(() => normalizeHistory(initialHistory).filter((message) => !initialTombstones.has(message.id)));
  const [selectedSourceIds, setSelectedSourceIds] = useState(() => initiallySelectedSourceIds(sources));
  const [sourceMode, setSourceMode] = useState(() => SOURCE_MODES.some((item) => item.id === storedDraft?.sourceMode) ? storedDraft.sourceMode : "library-first");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [catalogSources, setCatalogSources] = useState([]);
  const [sourceLoads, setSourceLoads] = useState({});
  const [webSearch, setWebSearch] = useState(false);
  const [localDisclosureAcknowledged, setLocalDisclosureAcknowledged] = useState(readLocalDisclosureAcknowledgement);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [configState, setConfigState] = useState({ status: "checking", config: null, message: "Checking secure AI configuration…" });
  const [configAttempt, setConfigAttempt] = useState(0);
  const [requestState, setRequestState] = useState({ status: "idle", error: null });
  const [activeResponse, setActiveResponse] = useState(null);
  const [requestElapsed, setRequestElapsed] = useState(0);
  const [sourceWarning, setSourceWarning] = useState("");
  // Quiz answers, confidence, checks and saves per quiz message (TFEAT-01),
  // kept for this tab so leaving #/ai does not lose them.
  const [quizStates, setQuizStates] = useState(readQuizStates);
  // Interview practice (TFEAT-06): the track, the question being answered
  // and its typed answer, and per graded answer the rubric points ticked and
  // the learner's verdict, kept for this tab.
  const [practice, setPractice] = useState(readPracticeState);
  useEffect(() => { writePracticeState(practice); }, [practice]);
  const updatePractice = useCallback((updater) => setPractice((current) => normalizePracticeState(typeof updater === "function" ? updater(current) : { ...current, ...updater })), []);
  useEffect(() => { writeQuizStates(quizStates); }, [quizStates]);
  const updateQuizState = useCallback((messageId, updater) => setQuizStates((current) => ({
    ...current,
    [messageId]: { ...normalizeQuizState(updater(normalizeQuizState(current[messageId]))), updatedAt: Date.now() },
  })), []);
  // Moving focus to a message on request needs a render to apply it.
  const [, setFocusRequest] = useState(0);
  // "Now", for the three-hour context break (TFEAT-13, interim): refreshed
  // each minute, when the tab returns and after every change to the
  // conversation. Send re-reads the time itself.
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== "hidden") setClock(Date.now()); };
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  // Listen (TFEAT-09): which answer the app's speech engine is reading.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const [listenError, setListenError] = useState({ id: "", text: "" });
  const tutorSpeechState = speech?.activeLabel === TUTOR_SPEECH_LABEL && ["speaking", "paused"].includes(speech?.status) ? speech.status : "idle";
  useEffect(() => {
    if (tutorSpeechState === "idle" && speakingMessageId) setSpeakingMessageId("");
  }, [speakingMessageId, tutorSpeechState]);
  // Stops the tutor's own reading, never a lecture's.
  const stopTutorSpeech = useCallback(() => {
    const engine = speechRef.current;
    if (engine?.activeLabel === TUTOR_SPEECH_LABEL) engine.stop();
  }, []);
  useEffect(() => stopTutorSpeech, [stopTutorSpeech]);
  const currentMode = modeById(modeId);
  useEffect(() => {
    rememberTutorDraft({ prompt, modeId, sourceMode, difficulty, responseProfile });
  }, [difficulty, modeId, prompt, responseProfile, sourceMode]);
  useLayoutEffect(() => {
    onInteractionChange?.(requestState.status === "loading");
    return () => onInteractionChange?.(false);
  }, [requestState.status, onInteractionChange]);
  const tombstoneSignature = useMemo(() => JSON.stringify((Array.isArray(historyTombstones) ? historyTombstones : []).filter((id) => typeof id === "string").slice(-1_000).sort()), [historyTombstones]);
  const tombstoneIds = useMemo(() => new Set(JSON.parse(tombstoneSignature)), [tombstoneSignature]);
  const normalizedExternalHistory = useMemo(() => normalizeHistory(initialHistory).filter((message) => !tombstoneIds.has(message.id)), [initialHistory, tombstoneIds]);
  const externalHistorySignature = useMemo(() => historySignature(normalizedExternalHistory), [normalizedExternalHistory]);

  const normalizedSources = useMemo(() => {
    const seen = new Set();
    return [...sources, ...catalogSources].flatMap((source, index) => {
      if (!source || typeof source !== "object") return [];
      const text = sourceText(source);
      if (!text) return [];
      const id = sourceKey(source, index);
      if (seen.has(id)) return [];
      seen.add(id);
      if (!sourceNumbersRef.current.has(id)) {
        sourceNumbersRef.current.set(id, nextSourceNumberRef.current);
        nextSourceNumberRef.current += 1;
      }
      return [{
        id,
        title: asTrimmedString(source.title, 200) || "Untitled learning source",
        section: asTrimmedString(source.section ?? source.heading, 200),
        text,
        revision: asTrimmedString(source.revision ?? source.updatedAt ?? source.sourceHash, 200) || stableTextHash(text),
        citationNumber: sourceNumbersRef.current.get(id),
        original: source,
        initiallySelected: source.selected === true,
      }];
    });
  }, [catalogSources, sources]);

  const sourceSignature = useMemo(() => normalizedSources
    .map((source) => `${source.id}:${source.revision}:${source.title}:${source.section}:${source.initiallySelected}`)
    .join("|"), [normalizedSources]);

  useEffect(() => {
    setSelectedSourceIds((current) => {
      const available = new Set(normalizedSources.map((source) => source.id));
      const retained = [...current].filter((id) => available.has(id));
      if (retained.length) return new Set(retained);
      const requested = normalizedSources.filter((source) => source.initiallySelected).slice(0, MAX_SELECTED_SOURCES).map((source) => source.id);
      if (requested.length) return new Set(requested);
      return new Set(normalizedSources[0] ? [normalizedSources[0].id] : []);
    });
    lastRequestRef.current = null;
    setRequestState((current) => current.status === "error" || current.status === "cancelled" ? { status: "idle", error: null } : current);
  }, [sourceSignature]);

  useEffect(() => {
    if (!hasSecureTransport()) {
      setConfigState({ status: "insecure", config: null, message: "AI is disabled on this connection. Use HTTPS so prompts and learning context cannot be intercepted." });
      return undefined;
    }
    const controller = new AbortController();
    setConfigState({ status: "checking", config: null, message: "Checking secure AI configuration…" });
    aiClient.getConfig({ signal: controller.signal, force: configAttempt > 0 })
      .then((config) => {
        const unsafeReason = verifyPublicConfig(config);
        if (unsafeReason) {
          setConfigState({ status: "insecure", config, message: unsafeReason });
        } else if (!config.enabled) {
          setConfigState({ status: "disabled", config, message: "AI is not configured on this server. The rest of your notes and review tools remain available." });
        } else if (config.service?.reachable !== true) {
          setConfigState({ status: "error", config, message: "The local Ollama service is not running. Start Ollama on the Mac that hosts Lumen, then check again." });
        } else if (config.service?.modelInstalled !== true) {
          setConfigState({ status: "error", config, message: `The local model ${config.model} is not installed. Pull it with Ollama on the host Mac, then check again.` });
        } else if (config.service?.modelIdentityRequired === true && config.service?.modelIdentityVerified !== true) {
          setConfigState({ status: "error", config, message: `The installed ${config.model} digest does not match this server's approved model build. Verify the Ollama tag/digest before using it.` });
        } else if (config.service?.completionCapable !== true) {
          setConfigState({ status: "error", config, message: `The installed model ${config.model} did not attest Ollama completion support. Use the documented Qwen model or update Ollama.` });
        } else if (config.auth?.required === true && config.auth?.sessionActive !== true) {
          setConfigState({ status: "pairing", config, message: "This server requires one-time pairing. Enter the operator's pairing code below to use AI in this browser." });
        } else {
          setConfigState({ status: "ready", config, message: "Local Ollama model ready — no paid model API" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setConfigState({ status: "error", config: null, message: error instanceof AiClientError ? error.message : "The AI configuration could not be checked." });
      });
    return () => controller.abort();
  }, [configAttempt]);

  useEffect(() => {
    const refreshWhenStale = () => {
      if (document.visibilityState === "hidden") return;
      const checkedAt = Date.parse(configState.config?.service?.checkedAt || "");
      if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 60_000) {
        setConfigAttempt((attempt) => attempt + 1);
      }
    };
    window.addEventListener("online", refreshWhenStale);
    document.addEventListener("visibilitychange", refreshWhenStale);
    return () => {
      window.removeEventListener("online", refreshWhenStale);
      document.removeEventListener("visibilitychange", refreshWhenStale);
    };
  }, [configState.config?.service?.checkedAt]);

  // Recover while the page stays open when the host starts Ollama later.
  // A failed startup probe previously left Generate disabled indefinitely.
  useEffect(() => {
    if (configState.status !== "error" || requestState.status === "loading") return undefined;
    const timer = setTimeout(() => {
      if (document.visibilityState !== "hidden") setConfigAttempt((attempt) => attempt + 1);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [configState.status, configState.config, configAttempt, requestState.status]);

  // Web fallback stays a one-request permission. A refresh or tab return
  // re-checks the server without dropping it; it is withdrawn, visibly, only
  // when a completed check says web search is unavailable.
  const webSearchRef = useRef(webSearch);
  webSearchRef.current = webSearch;
  useEffect(() => {
    if (configState.status === "checking" || configState.config?.webSearch?.macToolAvailable === true) return;
    if (!webSearchRef.current) return;
    setWebSearch(false);
    setComposerNotice("Current-web fallback was switched off because web search is not available on the server right now.");
  }, [configState.status, configState.config?.webSearch?.macToolAvailable]);

  useEffect(() => {
    // A configured model without attested thinking support must not keep an
    // already-selected Deep profile armed; the request would fail upstream.
    if (configState.status === "ready" && configState.config?.service?.thinkingCapable !== true) {
      setResponseProfile((profile) => profile === "deep" ? "balanced" : profile);
    }
  }, [configState.status, configState.config?.service?.thinkingCapable]);

  // Leaving the tutor aborts an in-flight answer. Record that visibly as an
  // incomplete answer (keeping any streamed text) instead of leaving an
  // unanswered question behind. Incomplete answers are shown but never sent
  // back to the model as conversation memory.
  useEffect(() => () => {
    const inFlight = inFlightRef.current;
    inFlightRef.current = null;
    requestControllerRef.current?.abort();
    if (streamFrameRef.current) cancelAnimationFrame(streamFrameRef.current);
    if (!inFlight || typeof onHistoryChangeRef.current !== "function") return;
    const snapshot = inFlight.snapshot();
    const interrupted = {
      id: inFlight.responseId,
      role: "assistant",
      content: snapshot.partial || "This answer was interrupted because you left the tutor before it finished. Ask again, or use Edit & reuse on your question.",
      mode: inFlight.mode,
      createdAt: new Date().toISOString(),
      requestId: null,
      data: null,
      citationSources: snapshot.partial ? snapshot.citationSources : [],
      webSources: snapshot.partial ? snapshot.webSources : [],
      webFallbackStatus: "off",
      responseProfile: inFlight.responseProfile,
      durationMs: null,
      incomplete: true,
      truncated: snapshot.truncated,
    };
    const current = historyRef.current.filter((message) => message.id !== interrupted.id);
    const withQuestion = inFlight.userMessage && !current.some((message) => message.id === inFlight.userMessage.id)
      ? [...current, inFlight.userMessage]
      : current;
    onHistoryChangeRef.current(normalizeHistory([...withQuestion, interrupted]));
  }, []);

  useEffect(() => {
    activeResponseRef.current = activeResponse;
  }, [activeResponse]);

  useEffect(() => {
    if (requestState.status !== "loading") {
      setRequestElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const update = () => setRequestElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [requestState.status]);

  // Announce progress through one persistent polite status region: each new
  // phase, a reminder every 30 seconds, then the outcome. The visible
  // seconds counter and streamed text are never live.
  const activeStage = activeResponse?.stage || "";
  const activeResponseId = activeResponse?.id || "";
  // Grounded answers show staged progress (TVU-18); its steps, not every
  // stage message, are announced.
  const progressSteps = activeResponse ? tutorProgressSteps({
    sourceMode: activeResponse.sourceMode,
    phase: activeResponse.phase,
    passages: activeResponse.phase === "retrieving" ? null : activeResponse.citationSources.length,
    web: ["searching", "used"].includes(activeResponse.webFallbackStatus),
    searched: activeResponse.searched === true,
    structured: modeById(activeResponse.mode).structured === true,
  }) : [];
  const progressMessage = progressAnnouncement(progressSteps);
  const announcementKey = progressSteps.length ? progressMessage : activeStage;
  useEffect(() => {
    // Effects, and the state updaters behind them, can run after the request
    // ended. Only the request still in flight (a ref written in program
    // order) may announce, so a stale phase never follows its outcome.
    if (announcementKey && activeResponseId && inFlightRef.current?.responseId === activeResponseId) announce(announcementKey);
  }, [activeResponseId, announcementKey, announce]);
  useEffect(() => {
    if (requestState.status === "loading" && inFlightRef.current && requestElapsed > 0 && requestElapsed % 30 === 0) announce(`Still working, ${requestElapsed} seconds so far.`);
  }, [announce, requestElapsed, requestState.status]);

  // A new answer starts at the end of the conversation. When Generate or
  // Retry started it, focus moves to Send, which has become Stop; a
  // keyboard send keeps focus in the question box.
  useLayoutEffect(() => {
    if (!activeResponseId) return;
    scrollConversationToEnd();
    if (focusStreamOnMountRef.current) {
      focusStreamOnMountRef.current = false;
      focusStopOnMountRef.current = false;
      streamingArticleRef.current?.focus({ preventScroll: true });
    } else if (focusStopOnMountRef.current) {
      focusStopOnMountRef.current = false;
      sendButtonRef.current?.focus({ preventScroll: true });
    }
  }, [activeResponseId, scrollConversationToEnd]);

  // While following, every update of the answer in progress (new text, a
  // step, its sources) keeps its end in view, before the frame is painted.
  useLayoutEffect(() => {
    if (activeResponse && followStreamRef.current) scrollConversationToEnd();
  }, [activeResponse, scrollConversationToEnd]);

  // The sticky composer's height (plus its offset from the bottom) is
  // published so scrolled-to content and focus stop above it instead of
  // behind it.
  const [composerSpace, setComposerSpace] = useState(0);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return undefined;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Large text on a small screen can make the dock taller than the room
      // between the top bar and the bottom navigation, hiding the whole
      // conversation behind it. Past about 60% of that room it stays in the
      // page flow instead (back above 50%, so it does not flicker). The
      // question box's own growth is left out, so typing never moves it.
      const field = promptRef.current;
      const fieldStyle = field ? getComputedStyle(field) : null;
      const px = (value) => Number.parseFloat(value) || 0;
      const oneLine = fieldStyle ? Math.max(px(fieldStyle.minHeight), px(fieldStyle.lineHeight) + px(fieldStyle.paddingTop) + px(fieldStyle.paddingBottom) + px(fieldStyle.borderTopWidth) + px(fieldStyle.borderBottomWidth)) : 0;
      const growth = field ? Math.max(0, field.offsetHeight - oneLine) : 0;
      const top = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
      const nav = document.querySelector(".bottom-nav");
      const bottom = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
      const share = (composer.offsetHeight - growth) / Math.max(1, bottom - top);
      const undocked = composer.dataset.dock === "off";
      if (!undocked && share > 0.6) composer.dataset.dock = "off";
      else if (undocked && share < 0.5) delete composer.dataset.dock;
      const style = getComputedStyle(composer);
      const offset = style.position === "sticky" ? Number.parseFloat(style.bottom) || 0 : 0;
      const space = style.position === "sticky" ? Math.ceil(composer.offsetHeight + offset) : 0;
      root.style.setProperty("--ai-composer-space", `${space}px`);
      root.style.scrollPaddingBottom = space ? `${space + 12}px` : "";
      composerSpaceRef.current = space;
      setComposerSpace((current) => Math.abs(current - space) > 2 ? space : current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(composer);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--ai-composer-space");
      root.style.scrollPaddingBottom = "";
    };
  }, []);

  // The question box grows with its text (up to about six lines, then it
  // scrolls), including text placed there by a mode, Ask AI or a restore.
  useLayoutEffect(() => {
    const field = promptRef.current;
    if (!field) return undefined;
    const fit = () => {
      field.style.height = "auto";
      const borders = field.offsetHeight - field.clientHeight;
      field.style.height = `${field.scrollHeight + borders}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [prompt]);

  // While an answer is generating, any scroll gesture means the learner is
  // reading something else, so completion does not move the page; a gesture
  // upwards (wheel, a finger dragging down, PageUp/ArrowUp/Home, or the page
  // itself moving up) stops following. The tutor's own scrolls only go down,
  // so they never stop it.
  useEffect(() => {
    if (requestState.status !== "loading") return undefined;
    let touchY = null;
    let pageY = window.scrollY;
    let pageHeight = document.documentElement.scrollHeight;
    const readingElsewhere = () => { userScrolledRef.current = true; };
    const readBack = () => {
      userScrolledRef.current = true;
      setFollowing(false);
    };
    const onWheel = (event) => { if (event.deltaY < 0) readBack(); else readingElsewhere(); };
    const onTouchStart = (event) => { touchY = event.touches?.[0]?.clientY ?? null; };
    const onTouchMove = (event) => {
      const y = event.touches?.[0]?.clientY;
      if (Number.isFinite(y) && touchY !== null && y - touchY > 8) readBack();
      else readingElsewhere();
      if (Number.isFinite(y)) touchY = y;
    };
    const onKeyDown = (event) => {
      if (event.target?.closest?.("textarea, input, select, [contenteditable='true']")) return;
      if (["PageUp", "ArrowUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) readBack();
      else if (["PageDown", "End", "ArrowDown", " "].includes(event.key)) readingElsewhere();
    };
    const onPageScroll = () => {
      const y = window.scrollY;
      const height = document.documentElement.scrollHeight;
      if (isPageReadBack({ y, previousY: pageY, height, previousHeight: pageHeight, viewportHeight: window.innerHeight })) readBack();
      pageY = y;
      pageHeight = height;
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onPageScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onPageScroll);
    };
  }, [requestState.status, setFollowing]);

  // Whether the end of the conversation is on screen, above the docked
  // composer. Returning there while an answer streams resumes following.
  const [atLatest, setAtLatest] = useState(true);
  useEffect(() => {
    const target = conversationEndRef.current;
    if (!target || typeof IntersectionObserver !== "function") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setAtLatest(entry.isIntersecting);
      if (entry.isIntersecting && inFlightRef.current) setFollowing(true);
    }, { rootMargin: `0px 0px -${Math.max(0, composerSpace)}px 0px` });
    observer.observe(target);
    return () => observer.disconnect();
  }, [composerSpace, setFollowing]);

  // After an answer lands while the learner is reading elsewhere, the pill
  // offers it for eight seconds.
  const [readyAnswerId, setReadyAnswerId] = useState("");
  useEffect(() => {
    if (!readyAnswerId) return undefined;
    const timer = window.setTimeout(() => setReadyAnswerId(""), 8_000);
    return () => window.clearTimeout(timer);
  }, [readyAnswerId]);
  useEffect(() => {
    if (atLatest) setReadyAnswerId("");
  }, [atLatest]);

  const historyRef = useRef(history);
  historyRef.current = history;
  // A quiz removed from the conversation takes its state with it. An empty
  // history may simply not be loaded yet, so it prunes nothing.
  useEffect(() => {
    if (!history.length) return;
    const live = new Set(history.map((message) => message.id));
    setQuizStates((current) => pruneQuizStates(current, live));
  }, [history]);
  useEffect(() => { setClock(Date.now()); }, [history]);
  // Turns before the latest break of more than three hours are not sent.
  const contextStart = tutorContextStart(history, clock);
  // The Socratic or Interview session the conversation ends with (TFEAT-05),
  // derived from the turns the model can still see.
  const session = useMemo(() => tutorSession(history.slice(contextStart)), [contextStart, history]);
  // The authored interview bank loads with Interview mode, or when the
  // conversation holds graded practice that needs its rubric.
  const needsInterviewBank = currentMode.id === "interview" || history.some((message) => message.mode === "interview-practice");
  // The practice views and the bank helpers load with it, off the offline
  // shell: `ui` holds the components, `kit` the bank's tracks and questions.
  const [interviewBank, setInterviewBank] = useState({ status: "idle", ui: null, kit: null });
  useEffect(() => {
    if (!needsInterviewBank || interviewBank.status !== "idle") return;
    setInterviewBank({ status: "loading", ui: null, kit: null });
    Promise.all([import("./TutorPractice.jsx"), import("../data/interviewTracks.v1.json")])
      .then(([ui, bank]) => setInterviewBank({ status: "ready", ui, kit: ui.createPracticeKit(bank.default) }))
      .catch(() => setInterviewBank({ status: "error", ui: null, kit: null }));
  }, [interviewBank.status, needsInterviewBank]);
  const practiceKit = interviewBank.kit;
  const practiceQuestion = practiceKit?.questions.get(practice.questionId) || null;
  // A graded answer ends the question: the card is ready for the next one.
  useEffect(() => {
    if (!practice.pendingId) return;
    const index = history.findIndex((message) => message.id === practice.pendingId);
    if (index < 0 || !history.slice(index + 1).some((message) => message.role === "assistant" && message.mode === "interview-practice" && message.data && !message.incomplete)) return;
    updatePractice((current) => ({
      ...current,
      pendingId: "",
      questionId: "",
      answer: "",
      practiced: [...current.practiced.filter((id) => id !== current.questionId), current.questionId].filter(Boolean),
    }));
  }, [history, practice.pendingId, updatePractice]);
  const lastExternalHistoryRef = useRef({
    signature: historySignature(normalizedExternalHistory),
    history: normalizedExternalHistory,
  });
  const suppressedPublishRef = useRef("");
  const lastPublishedHistoryRef = useRef(historySignature(history));

  useEffect(() => {
    const previousExternal = lastExternalHistoryRef.current;
    if (externalHistorySignature === previousExternal.signature) return;
    lastExternalHistoryRef.current = { signature: externalHistorySignature, history: normalizedExternalHistory };

    // The host exposes only a whole-history clear. An externally emptied
    // history is therefore authoritative; additions/updates are unioned by ID
    // so concurrent tutor turns from separate tabs cannot delete one another.
    const next = normalizedExternalHistory.length === 0 && previousExternal.history.length > 0
      ? []
      : mergeHistoryById(historyRef.current, normalizedExternalHistory).filter((message) => !tombstoneIds.has(message.id));
    const nextSignature = historySignature(next);
    if (nextSignature === historySignature(historyRef.current)) return;
    suppressedPublishRef.current = nextSignature;
    setHistory(next);
  }, [externalHistorySignature, normalizedExternalHistory, tombstoneIds, tombstoneSignature]);

  useEffect(() => {
    const signature = historySignature(history);
    if (signature === lastPublishedHistoryRef.current) return;
    lastPublishedHistoryRef.current = signature;
    if (signature === suppressedPublishRef.current) {
      suppressedPublishRef.current = "";
      return;
    }
    onHistoryChange?.(history);
  }, [history, onHistoryChange]);

  const publishHistory = useCallback((updater) => {
    setHistory((current) => normalizeHistory(typeof updater === "function" ? updater(current) : updater).filter((message) => !tombstoneIds.has(message.id)));
  }, [tombstoneIds]);

  // True when focus sits on a control that a finished, failed or stopped
  // request removes or disables (Generate, Stop, Retry), or already on <body>.
  const focusIsOnRequestControls = useCallback(() => {
    const active = document.activeElement;
    return !active
      || active === document.body
      || active === sendButtonRef.current
      || Boolean(streamingArticleRef.current?.contains(active))
      || Boolean(requestNoticeRef.current?.contains(active));
  }, []);

  // Brings the start of a new answer into view inside the conversation and,
  // when needed, the page, allowing for the fixed top bar.
  const revealMessageStart = useCallback((target) => {
    const surface = conversationRef.current;
    if (surface?.contains(target)) surface.scrollTop = Math.max(0, target.offsetTop - 8);
    const topbar = document.querySelector(".app-topbar")?.getBoundingClientRect();
    const visibleTop = Math.max(0, topbar?.bottom ?? 0) + 12;
    // The start belongs near the top of the band above the docked composer,
    // so most of the answer shows.
    const visibleBottom = window.innerHeight - composerSpaceRef.current;
    const top = target.getBoundingClientRect().top;
    if (top < visibleTop || top > visibleTop + (visibleBottom - visibleTop) * 0.35) window.scrollBy({ top: top - visibleTop, behavior: scrollBehavior() });
  }, []);

  // Applies focus/scroll requested by the last state change once the target
  // (a new answer, the outcome note or the tutor heading) is rendered.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = pending.kind === "message"
      ? [...(conversationRef.current?.querySelectorAll("[data-message-id]") || [])].find((node) => node.dataset.messageId === pending.id)
      : pending.kind === "notice" ? requestNoticeRef.current : headingRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    if (pending.scroll && pending.kind === "notice") target.scrollIntoView({ block: "nearest", behavior: "instant" });
    else if (pending.scroll) revealMessageStart(target);
    if (pending.focus) target.focus({ preventScroll: true });
  });

  const manuallySelectedSources = useMemo(() => normalizedSources
    .filter((source) => selectedSourceIds.has(source.id))
    .sort((left, right) => left.citationNumber - right.citationNumber), [normalizedSources, selectedSourceIds]);
  const currentLessonSources = useMemo(() => {
    const requested = normalizedSources.filter((source) => source.initiallySelected);
    return (requested.length ? requested : normalizedSources.slice(0, 1)).slice(0, MAX_SELECTED_SOURCES);
  }, [normalizedSources]);
  const selectedSources = sourceMode === "none"
    ? []
    : sourceMode === "current"
      ? currentLessonSources
      : manuallySelectedSources;
  // Mac web egress is intentionally available only after the complete local
  // library has been checked for this same request. Current/hand-picked/no
  // source modes do not produce that sufficiency decision, so they must stay
  // local even if a stale checkbox state survives a rapid mode change.
  const libraryWebEligible = sourceMode === "library-first" && typeof retrieveLibrary === "function";
  const effectiveWebSearch = libraryWebEligible && webSearch;
  // The lesson the learner has open (App marks it selected). Library-first
  // requests about "this lesson" reserve its passages at send time.
  const openLesson = useMemo(() => normalizedSources.find((source) => source.initiallySelected) || null, [normalizedSources]);
  // Choose sources offers the whole library: loaded sources first, then every
  // catalog lesson, whose text loads only when the learner ticks it.
  const chooseEntries = useMemo(() => {
    const seen = new Set();
    const entries = normalizedSources.map((source) => {
      seen.add(source.id);
      return { id: source.id, title: source.title, section: source.section, source };
    });
    (Array.isArray(sourceCatalog) ? sourceCatalog : []).forEach((item) => {
      const id = asTrimmedString(item?.id, 240);
      if (!id || seen.has(id)) return;
      seen.add(id);
      entries.push({ id, title: asTrimmedString(item.title, 200) || "Untitled lesson", section: asTrimmedString(item.section, 200), source: null });
    });
    return entries;
  }, [normalizedSources, sourceCatalog]);
  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    if (!query) return chooseEntries;
    return chooseEntries.filter((entry) => `${entry.title} ${entry.section}`.toLocaleLowerCase().includes(query));
  }, [chooseEntries, sourceQuery]);
  const normalizeRetrievedSources = useCallback((result) => {
    const rawPassages = Array.isArray(result?.passages) ? result.passages : [];
    const seen = new Set();
    return rawPassages.slice(0, MAX_SELECTED_SOURCES * 2).flatMap((passage, index) => {
      if (!passage || typeof passage !== "object") return [];
      const text = sourceText(passage);
      if (!text) return [];
      const id = sourceKey(passage, index);
      if (seen.has(id)) return [];
      seen.add(id);
      const original = normalizedSources.find((source) => source.id === id)?.original || passage.original || passage;
      if (!sourceNumbersRef.current.has(id)) {
        sourceNumbersRef.current.set(id, nextSourceNumberRef.current);
        nextSourceNumberRef.current += 1;
      }
      return [{
        id,
        title: asTrimmedString(passage.title, 200) || "Retrieved library passage",
        section: asTrimmedString(passage.section ?? passage.heading, 200),
        text,
        citationNumber: sourceNumbersRef.current.get(id),
        original,
      }];
    }).slice(0, MAX_SELECTED_SOURCES);
  }, [normalizedSources]);

  const requestLimits = useMemo(() => tutorRequestLimits(configState.config, responseProfile), [configState.config, responseProfile]);
  const { inputLimit, maximumBytes: configuredRequestByteLimit, promptLimit } = requestLimits;
  const conversationWindow = useMemo(
    () => tutorConversationWindow(history.slice(contextStart), { prompt, sources: selectedSources.length > 0, inputLimit }),
    [contextStart, history, inputLimit, prompt, selectedSources.length],
  );
  const outboundHistory = conversationWindow.messages;
  const selectedMaxOutputTokens = outputTokensForProfile({
    profile: responseProfile,
    responseProfiles: configState.config?.responseProfiles,
    maximum: configState.config?.limits?.maxOutputTokens,
    structured: currentMode.structured,
  });
  const requestPreviewSources = useMemo(
    () => sourceMode === "library-first" && typeof retrieveLibrary === "function" ? [] : selectedSources,
    [retrieveLibrary, selectedSources, sourceMode],
  );
  // The composer's own request, fitted exactly as Send will fit it: the byte
  // count and the Send state below describe the body that would be sent.
  const requestPreview = useMemo(() => fitTutorRequest({
    mode: currentMode,
    prompt: prompt.trim(),
    sources: requestPreviewSources,
    history: outboundHistory,
    conversationSummary: conversationWindow.conversationSummary,
    webSearch: effectiveWebSearch,
    difficulty,
    responseProfile,
    config: configState.config,
  }), [configState.config, conversationWindow.conversationSummary, currentMode, difficulty, effectiveWebSearch, outboundHistory, prompt, requestPreviewSources, responseProfile]);
  const contextPreview = requestPreview.context;
  const requestPayloadBytes = requestPreview.bytes;
  const providerControlsUrl = useMemo(() => {
    try {
      const url = new URL(configState.config?.privacy?.providerDataControlsUrl || "");
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }, [configState.config?.privacy?.providerDataControlsUrl]);
  const composerIssue = tutorRequestIssue({ prompt, promptLimit, fitted: requestPreview, sources: selectedSources, requireAllSources: sourceMode !== "library-first" });
  const promptTooLong = composerIssue === "prompt-too-long";
  const contextTooSmall = composerIssue === "context-too-small";
  const requestTooLarge = composerIssue === "request-too-large";
  const webSearchAvailable = configState.config?.webSearch?.macToolAvailable === true;
  // Deep sends `think: true` upstream, so it is offered only when the
  // installed model actually attests Ollama thinking support (AI-002).
  const deepProfileAvailable = configState.config?.service?.thinkingCapable === true;
  const requestReady = configState.status === "ready"
    && localDisclosureAcknowledged
    && Boolean(prompt.trim())
    && !promptTooLong
    && !contextTooSmall
    && !requestTooLarge
    && (!effectiveWebSearch || webSearchAvailable)
    && requestState.status !== "loading";

  const runRequest = useCallback(async (requestSpec, { appendUser = true } = {}) => {
    if (requestControllerRef.current || requestState.status === "loading") return;
    const controller = new AbortController();
    const requestStartedAt = globalThis.performance?.now?.() ?? Date.now();
    requestControllerRef.current = controller;
    // A new question stops an answer being read aloud.
    stopTutorSpeech();
    let citationSources = requestSpec.sources;
    let payload = requestSpec.payload;
    // Every re-fit uses the request's own mode, depth, profile and config
    // snapshot, never whatever the composer shows by then.
    const refit = (sourceSnapshot, webSearch) => fitTutorRequest({
      mode: requestSpec.mode,
      prompt: requestSpec.displayPrompt,
      sources: sourceSnapshot,
      history: requestSpec.conversationHistory,
      conversationSummary: requestSpec.conversationMemory?.summary || "",
      webSearch,
      difficulty: requestSpec.difficulty,
      responseProfile: requestSpec.responseProfile,
      config: requestSpec.config,
    });
    let retrievalTrace = null;
    let streamedText = "";
    let streamedWebSources = [];
    let streamedApproach = null;
    let streamTruncated = false;
    const responseId = createId();
    const userMessage = {
      id: requestSpec.userMessageId,
      role: "user",
      content: requestSpec.displayPrompt,
      mode: requestSpec.mode.id,
      createdAt: requestSpec.createdAt,
      data: null,
      requestId: null,
      citationSources: requestSpec.sources,
      webSources: [],
      responseProfile: requestSpec.responseProfile,
    };
    if (appendUser) publishHistory((current) => [...current, userMessage]);
    inFlightRef.current = {
      responseId,
      mode: requestSpec.mode.id,
      responseProfile: requestSpec.responseProfile,
      userMessage: appendUser ? userMessage : null,
      snapshot: () => ({
        partial: boundResponseText(streamedText).text,
        citationSources,
        webSources: streamedWebSources,
        truncated: streamTruncated,
      }),
    };
    setRequestState({ status: "loading", error: null });
    requestStartedAtRef.current = globalThis.performance?.now?.() ?? Date.now();
    setFollowing(true);
    setReadyAnswerId("");
    userScrolledRef.current = false;
    pendingFocusRef.current = null;
    setComposerNotice("");
    const initialActiveResponse = {
      id: responseId,
      role: "assistant",
      content: "",
      mode: requestSpec.mode.id,
      createdAt: new Date().toISOString(),
      requestId: null,
      data: null,
      citationSources,
      webSources: [],
      webFallbackStatus: requestSpec.webSearch ? "armed" : "off",
      responseProfile: requestSpec.responseProfile,
      sourceMode: requestSpec.sourceMode,
      stage: requestSpec.sourceMode === "library-first" && typeof retrieveLibrary === "function" ? "Searching your library…" : requestSpec.stageHint || "Preparing grounded context…",
      phase: requestSpec.sourceMode === "library-first" && typeof retrieveLibrary === "function" ? "retrieving" : "drafting",
      searched: false,
    };
    activeResponseRef.current = initialActiveResponse;
    setActiveResponse(initialActiveResponse);
    const updateActiveResponse = (updater) => {
      setActiveResponse((current) => {
        if (!current || current.id !== responseId) return current;
        const next = typeof updater === "function" ? updater(current) : updater;
        activeResponseRef.current = next;
        return next;
      });
    };
    const flushStream = () => {
      streamFrameRef.current = 0;
      // Following happens as each update commits (see below).
      updateActiveResponse((current) => ({ ...current, content: streamedText }));
    };
    const queueDelta = (delta) => {
      if (typeof delta !== "string" || !delta || streamTruncated) return;
      const next = `${streamedText}${delta}`;
      if (next.length > MAX_RESPONSE_CHARS) {
        streamedText = `${next.slice(0, MAX_RESPONSE_CHARS - 94).trimEnd()}\n\n> Response display limit reached. Ask Lumen to continue from this point.`;
        streamTruncated = true;
      } else {
        streamedText = next;
      }
      if (!streamFrameRef.current) streamFrameRef.current = requestAnimationFrame(flushStream);
    };
    const handleStreamEvent = (event) => {
      if (!event || typeof event !== "object") return;
      if (["delta", "token", "content_delta"].includes(event.type)) {
        queueDelta(event.delta ?? event.text ?? event.token ?? "");
      } else if (["status", "stage", "phase"].includes(event.type)) {
        const stage = asTrimmedString(event.message ?? event.stage ?? event.phase, 160);
        const phase = event.type === "phase" ? asTrimmedString(event.phase, 40) : "";
        if (stage || phase) {
          updateActiveResponse((current) => ({
            ...current,
            stage: stage || current.stage,
            phase: phase || current.phase,
            searched: current.searched || phase === "searching",
          }));
        }
      } else if (["source", "sources", "web_sources"].includes(event.type)) {
        const incoming = event.type === "source" ? [event.source || event] : event.sources;
        streamedWebSources = [...new Map(normalizeWebSources([...streamedWebSources, ...(Array.isArray(incoming) ? incoming : [])]).map((source) => [source.url, source])).values()];
        updateActiveResponse((current) => ({ ...current, webSources: streamedWebSources }));
      } else if (event.type === "approach") {
        streamedApproach = normalizeAnswerApproach(event.approach);
        if (streamedApproach) updateActiveResponse((current) => ({ ...current, approach: streamedApproach }));
      }
    };
    try {
      if (requestSpec.sourceMode === "library-first" && typeof retrieveLibrary === "function") {
        let result = null;
        let retrievalError = null;
        try {
          // An action may retrieve with its own query and favour the document
          // it is about (a cited lesson, a mistake's source) over the one open.
          const selectedDocumentId = requestSpec.selectedDocumentId || requestSpec.openLessonId;
          result = await retrieveLibrary(requestSpec.retrievalQuery || requestSpec.displayPrompt, {
            signal: controller.signal,
            maxPassages: MAX_SELECTED_SOURCES,
            maxBytes: requestSpec.retrievalMaxBytes,
            currentSources: requestSpec.contextSources.map(({ id, title, section }) => ({ id, title, section })),
            ...(selectedDocumentId ? { selectedDocumentId } : {}),
            ...(requestSpec.openLessonId ? {
              reservedDocumentId: requestSpec.openLessonId,
              reservedPassages: OPEN_LESSON_RESERVED_PASSAGES,
            } : {}),
          });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          retrievalError = error;
        }

        if (!retrievalError) {
          const retrieved = normalizeRetrievedSources(result);
          let useWebFallback = shouldUseWebFallback({ learnerAllowedWeb: requestSpec.webSearch, trace: result?.trace });
          let fitted;
          if (retrieved.length) {
            fitted = refit(retrieved, useWebFallback);
            let included = new Set(fitted.includedCitationNumbers);
            // A high-confidence retrieval result is not evidence if none of its
            // complete [S#] blocks fit the final wire request. Rebuild the
            // prompt without a false source instruction and, when the learner
            // authorized it, treat this as a genuine web-fallback condition.
            if (!included.size) {
              useWebFallback = requestSpec.webSearch;
              fitted = refit([], useWebFallback);
              included = new Set();
            }
            citationSources = retrieved.filter((source) => included.has(source.citationNumber)).map(citationSnapshot);
          } else {
            citationSources = [];
            fitted = refit([], useWebFallback);
          }
          payload = assertFittedAiRequest(fitted, "The retrieved library context exceeds the local model request limit. Narrow the question or clear older conversation turns.");
          const fittedNothing = retrieved.length > 0 && citationSources.length === 0;
          const reservedIds = new Set((Array.isArray(result?.passages) ? result.passages : []).filter((passage) => passage?.reserved === true).map((passage) => passage.id));
          const reservedAttached = citationSources.filter((source) => reservedIds.has(source.id)).length;
          const attachedSummary = citationSources.length
            ? `Library retrieval attached ${citationSources.length} relevant passage${citationSources.length === 1 ? "" : "s"}${reservedAttached ? `, including ${reservedAttached} from the open lesson “${requestSpec.openLessonTitle || "this lesson"}”` : ""}.`
            : "Library retrieval found no passage that fit this request's remaining context budget.";
          retrievalTrace = normalizeRetrievalTrace({
            ...(result?.trace && typeof result.trace === "object" ? result.trace : {}),
            strategy: result?.trace?.strategy || "library-first",
            candidates: result?.trace?.candidates ?? result?.sources?.length ?? normalizedSources.length,
            passages: citationSources.length,
            summary: fittedNothing
              ? `Library retrieval found relevant passages, but none fit this request's remaining context budget.${useWebFallback ? " Using the learner-authorized web fallback." : ""}`
              : result?.trace?.summary || attachedSummary,
            ...(fittedNothing ? { webFallback: { recommended: true, code: "fitted_library_context_empty", reason: "No complete retrieved passage fit the final model request." } } : {}),
          });
          updateActiveResponse((current) => ({
            ...current,
            citationSources,
            webFallbackStatus: useWebFallback ? "searching" : requestSpec.webSearch ? "not-needed" : "off",
            stage: useWebFallback ? "Your library does not cover this well enough. Searching the web, as you allowed…" : requestSpec.stageHint || (citationSources.length ? "Library passages found. Writing the answer on your Mac, without the web…" : "No library passage fits. Answering without the web and saying where evidence is missing…"),
            phase: "drafting",
          }));
          if (appendUser) publishHistory((current) => current.map((message) => message.id === userMessage.id ? { ...message, citationSources } : message));
        } else {
          // An unavailable local index is one of the documented independent
          // fallback recommendations. The learner's consumed one-request web
          // authorization remains the separate egress gate.
          const fallbackUsesWeb = requestSpec.webSearch;
          let fallback = refit(requestSpec.contextSources, fallbackUsesWeb);
          let included = new Set(fallback.includedCitationNumbers);
          if (requestSpec.contextSources.length && !included.size) {
            fallback = refit([], fallbackUsesWeb);
            included = new Set();
          }
          citationSources = requestSpec.contextSources.filter((source) => included.has(source.citationNumber)).map(citationSnapshot);
          retrievalTrace = normalizeRetrievalTrace({
            strategy: "library-first",
            passages: citationSources.length,
            summary: fallbackUsesWeb ? "Library retrieval was unavailable; using the learner-authorized web fallback." : "Library retrieval was unavailable; Lumen used only attached lesson context that fit safely and did not contact web search.",
            webFallback: { recommended: true, code: "library_index_unavailable", reason: "The local library index could not be queried for this request." },
          });
          payload = assertFittedAiRequest(fallback, "The attached fallback lesson context exceeds the local model request limit. Shorten the prompt or clear older conversation turns.");
          updateActiveResponse((current) => ({
            ...current,
            citationSources,
            webFallbackStatus: fallbackUsesWeb ? "searching" : "off",
            stage: fallbackUsesWeb ? "Library search is unavailable. Searching the web, as you allowed…" : "Library search is unavailable. Using the attached lesson, without the web…",
            phase: "drafting",
          }));
        }
      }
      const activeProfileLimit = requestSpec.config?.responseProfiles?.maxRequestUtf8Bytes?.[requestSpec.responseProfile]
        ?? requestSpec.config?.limits?.profileMaxRequestUtf8Bytes?.[requestSpec.responseProfile]
        ?? requestSpec.config?.limits?.maxRequestUtf8Bytes;
      const transportBytes = aiRequestUtf8Bytes(payload);
      if (Number.isSafeInteger(activeProfileLimit) && transportBytes > activeProfileLimit) {
        throw new AiClientError("AI_INPUT_TOO_LARGE", `The prepared request is ${transportBytes.toLocaleString()} UTF-8 bytes and exceeds the ${activeProfileLimit.toLocaleString()}-byte ${requestSpec.responseProfile} profile limit.`);
      }
      // The server advertises a browser deadline with transport/serialization
      // margin beyond its upstream model deadline, avoiding a client abort just
      // before a valid late response or typed server timeout arrives.
      const options = {
        signal: controller.signal,
        timeoutMs: requestSpec.config.limits?.clientTimeoutMs || 70_000,
        onEvent: handleStreamEvent,
      };
      let response;
      const streamMethod = !requestSpec.mode.structured
        && requestSpec.config.streamEndpoint === "/api/ai/respond/stream"
        && requestSpec.config.streamProtocol === "lumen.ai.ndjson.v1"
        ? aiClient.requestStream
        : null;
      if (typeof streamMethod === "function") {
        const candidate = streamMethod.call(aiClient, payload, options);
        const resolved = candidate && typeof candidate[Symbol.asyncIterator] === "function" ? candidate : await candidate;
        if (resolved && typeof resolved[Symbol.asyncIterator] === "function") {
          let completed = null;
          for await (const event of resolved) {
            handleStreamEvent(event);
            if (event?.type === "done" || event?.type === "complete") completed = event.response || event;
          }
          response = completed || { outputText: streamedText, sources: streamedWebSources };
        } else {
          response = resolved;
        }
      } else {
        response = requestSpec.mode.structured
          ? await aiClient.requestStructured(payload, options)
          : await aiClient.request(payload, options);
      }
      response = response && typeof response === "object" ? response : { outputText: streamedText, sources: streamedWebSources };
      if (requestSpec.mode.structured && !validateStructuredResult(requestSpec.mode.task, response.data)) {
        throw new AiClientError("AI_CONTRACT_ERROR", "The generated learning content failed local safety validation.", { requestId: response.requestId || null });
      }
      const boundedOutput = boundResponseText(response.outputText || streamedText);
      const assistantMessage = {
        id: responseId,
        role: "assistant",
        content: boundedOutput.text || "The tutor returned no readable content.",
        mode: requestSpec.mode.id,
        createdAt: new Date().toISOString(),
        requestId: asTrimmedString(response.requestId, 240) || null,
        data: response.data || null,
        citationSources,
        webSources: normalizeWebSources(response.sources).length ? normalizeWebSources(response.sources) : streamedWebSources,
        // An authorized search that ran (rounds > 0) but kept no usable web
        // evidence leaves a library-only answer that says so in its text;
        // the badge must agree rather than claim the web was not needed.
        webFallbackStatus: response.webSearch?.used === true
          ? "used"
          : activeResponseRef.current?.webFallbackStatus === "failed"
            || (response.webSearch?.requested === true && Number(response.webSearch?.rounds) > 0)
            ? "failed"
            : requestSpec.webSearch ? "not-needed" : "off",
        conversationMemory: requestSpec.conversationMemory,
        retrievalTrace,
        approach: normalizeAnswerApproach(response.approach) || streamedApproach,
        usage: normalizeUsage(response.usage),
        responseProfile: requestSpec.responseProfile,
        durationMs: (globalThis.performance?.now?.() ?? Date.now()) - requestStartedAt,
        truncated: boundedOutput.truncated || streamTruncated,
      };
      if (streamFrameRef.current) {
        cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = 0;
      }
      const restoreFocus = focusIsOnRequestControls();
      publishHistory((current) => [...current, assistantMessage]);
      activeResponseRef.current = null;
      setActiveResponse(null);
      setRequestState({ status: "success", error: null });
      lastRequestRef.current = null;
      setPrompt((current) => current.trim() === requestSpec.displayPrompt ? "" : current);
      if (requestSpec.webSearch) setComposerNotice("Current-web fallback covered that one request only. Tick it again to allow it for your next question.");
      // Show the new answer from its start (not its end) unless the learner
      // scrolled away meanwhile, and move focus there if it was on Generate,
      // Stop or nowhere.
      const revealAnswer = followStreamRef.current && !userScrolledRef.current;
      pendingFocusRef.current = { kind: "message", id: responseId, focus: restoreFocus, scroll: revealAnswer };
      if (!revealAnswer) setReadyAnswerId(responseId);
      const seconds = Math.round(assistantMessage.durationMs / 1_000);
      announce(`${requestSpec.mode.label} ${requestSpec.mode.structured ? "result" : "answer"} ready${seconds > 0 ? ` after ${seconds} second${seconds === 1 ? "" : "s"}` : ""}.`);
    } catch (error) {
      const clientError = error instanceof AiClientError
        ? error
        : controller.signal.aborted || error?.name === "AbortError"
          ? new AiClientError("AI_CANCELLED", "The AI request was cancelled.", { cause: error })
          : new AiClientError("AI_REQUEST_FAILED", "The learning request could not be completed.", { cause: error });
      const cancelled = clientError.code === "AI_CANCELLED";
      if (streamFrameRef.current) {
        cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = 0;
      }
      const partial = boundResponseText(streamedText).text;
      const webFallbackStatus = activeResponseRef.current?.webFallbackStatus === "failed" || payload.webSearch
        ? "failed"
        : requestSpec.webSearch ? "not-needed" : "off";
      const partialFailedValidation = new Set([
        "WEB_SEARCH_UNGROUNDED",
        "AI_CURRICULUM_UNGROUNDED",
        "AI_CONTRACT_ERROR",
        "AI_INVALID_RESPONSE",
      ]).has(clientError.code);
      const invalidatesConfig = CONFIG_INVALIDATING_REQUEST_ERRORS.has(clientError.code);
      const restoreFocus = focusIsOnRequestControls();
      if (partial && !partialFailedValidation) {
        publishHistory((current) => [...current, {
          id: responseId,
          role: "assistant",
          content: partial,
          mode: requestSpec.mode.id,
          createdAt: new Date().toISOString(),
          requestId: clientError.requestId || null,
          data: null,
          citationSources,
          webSources: streamedWebSources,
          webFallbackStatus,
          conversationMemory: requestSpec.conversationMemory,
          retrievalTrace,
          approach: streamedApproach,
          usage: null,
          responseProfile: requestSpec.responseProfile,
          durationMs: (globalThis.performance?.now?.() ?? Date.now()) - requestStartedAt,
          incomplete: true,
          truncated: streamTruncated,
        }]);
      }
      activeResponseRef.current = null;
      setActiveResponse(null);
      if (invalidatesConfig) {
        lastRequestRef.current = null;
        aiClient.clearConfigCache();
        setComposerNotice(
          clientError.code === "AI_CONTRACT_MISMATCH"
            ? "This app and the AI server are running different builds. Reload the app; if that does not help, rebuild and restart the integrated Lumen server from the same source."
            : ["AI_CONTEXT_LIMIT", "AI_INPUT_TOO_LARGE", "VALIDATION_ERROR"].includes(clientError.code)
              ? "The server limits or request contract changed. Lumen refreshed them; review the fitted sources and send again."
              : "The local model's availability changed. Lumen is checking the integrated server again before another request.",
        );
        setConfigAttempt((attempt) => attempt + 1);
      }
      setRequestState({
        status: cancelled ? "cancelled" : "error",
        error: {
          code: clientError.code,
          message: clientError.message,
          requestId: clientError.requestId,
          retryAfter: clientError.retryAfter,
          canRetry: !invalidatesConfig && (cancelled || clientError.retryable || clientError.code === "AI_CONTRACT_ERROR"),
          webFallbackStatus,
        },
      });
      // Stop and the streaming card are gone; the outcome note takes focus.
      // A failure is announced by its alert; a learner's own Stop is not an
      // error and is confirmed politely.
      // It is brought into view above the docked composer unless the
      // learner scrolled away while the request ran.
      pendingFocusRef.current = { kind: "notice", focus: restoreFocus, scroll: followStreamRef.current && !userScrolledRef.current };
      if (cancelled) announce(partial && !partialFailedValidation ? "Generation stopped. The partial answer is kept." : "Generation stopped.");
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      if (inFlightRef.current?.responseId === responseId) inFlightRef.current = null;
    }
  }, [announce, focusIsOnRequestControls, normalizeRetrievedSources, normalizedSources.length, publishHistory, requestState.status, retrieveLibrary, scrollConversationToEnd, setFollowing, stopTutorSpeech]);

  /**
   * The one way a request is prepared, for Send and for tutor actions
   * (follow-ups, hints, wrap-up, grading). Every field the learner has not
   * overridden comes from the composer; the body is fitted with the shared
   * builder and checked like a Send. Web fallback is never implied: an action
   * searches only when it passes the learner's one-request permission.
   *
   * action: { mode, prompt, sourceMode, sources, history, historyWindow,
   *   webSearch, responseProfile, difficulty, retrievalQuery,
   *   selectedDocumentId, userMessageId, stageHint, requireWholeSources }
   * `historyWindow` ({ messages, conversationSummary, compactedMessages })
   * replaces the composer's conversation memory, for an action about one
   * earlier answer. `requireWholeSources` refuses a request whose attached
   * source (an answer key) would be dropped or clipped. Returns { spec } or
   * { issue }.
   */
  const prepareTutorRequest = (action = {}) => {
    const mode = action.mode || currentMode;
    const displayPrompt = String(action.prompt ?? prompt).trim();
    const requestSourceMode = SOURCE_MODES.some((item) => item.id === action.sourceMode) ? action.sourceMode : sourceMode;
    const requestProfile = RESPONSE_PROFILES.some((item) => item.id === action.responseProfile) ? action.responseProfile : responseProfile;
    const requestDifficulty = DIFFICULTIES.some((item) => item.id === action.difficulty) ? action.difficulty : difficulty;
    const retrieves = requestSourceMode === "library-first" && typeof retrieveLibrary === "function";
    const contextSources = (Array.isArray(action.sources)
      ? action.sources
      : requestSourceMode === "none" ? [] : requestSourceMode === "current" ? currentLessonSources : manuallySelectedSources
    ).map((source) => ({ ...source }));
    const requestWeb = retrieves && action.webSearch === true;
    const config = configState.config;
    if (configState.status !== "ready" || !config) return { issue: "not-ready" };
    if (!localDisclosureAcknowledged) return { issue: "disclosure" };
    if (requestState.status === "loading" || requestControllerRef.current) return { issue: "busy" };
    if (requestWeb && config.webSearch?.macToolAvailable !== true) return { issue: "web-unavailable" };
    const limits = tutorRequestLimits(config, requestProfile);
    const memory = action.historyWindow && Array.isArray(action.historyWindow.messages)
      ? {
        messages: action.historyWindow.messages,
        conversationSummary: String(action.historyWindow.conversationSummary || ""),
        compactedMessages: Number.isSafeInteger(action.historyWindow.compactedMessages) ? action.historyWindow.compactedMessages : 0,
      }
      : tutorConversationWindow(Array.isArray(action.history) ? action.history : history.slice(tutorContextStart(history, Date.now())), {
        prompt: displayPrompt,
        sources: contextSources.length > 0,
        inputLimit: limits.inputLimit,
      });
    const fitted = fitTutorRequest({
      mode,
      prompt: displayPrompt,
      sources: retrieves ? [] : contextSources,
      history: memory.messages,
      conversationSummary: memory.conversationSummary,
      webSearch: requestWeb,
      difficulty: requestDifficulty,
      responseProfile: requestProfile,
      config,
    });
    const issue = tutorRequestIssue({ prompt: displayPrompt, promptLimit: limits.promptLimit, fitted, sources: contextSources, requireAllSources: !retrieves, requireWholeSources: !retrieves && action.requireWholeSources === true });
    if (issue) return { issue };
    const included = new Set(fitted.includedCitationNumbers);
    // "Explain this lesson", an unedited mode default or an Ask AI excerpt
    // is about the open lesson; generic wording alone never retrieves it.
    const aboutOpenLesson = retrieves && openLesson
      && (displayPrompt === mode.prompt || refersToOpenLesson(displayPrompt));
    return {
      spec: {
        userMessageId: asTrimmedString(action.userMessageId, 200) || createId(),
        createdAt: new Date().toISOString(),
        displayPrompt,
        mode,
        difficulty: requestDifficulty,
        sources: contextSources.filter((source) => included.has(source.citationNumber)).map(citationSnapshot),
        contextSources,
        openLessonId: aboutOpenLesson ? asTrimmedString(openLesson.original?.documentId || openLesson.id, 240) : "",
        openLessonTitle: aboutOpenLesson ? openLesson.title : "",
        retrievalQuery: asTrimmedString(action.retrievalQuery, MAX_PROMPT_CHARS),
        selectedDocumentId: asTrimmedString(action.selectedDocumentId, 240),
        stageHint: asTrimmedString(action.stageHint, 160),
        sourceMode: requestSourceMode,
        webSearch: requestWeb,
        responseProfile: requestProfile,
        retrievalMaxBytes: Math.max(512, fitted.contextBudget),
        conversationHistory: memory.messages.map((message) => ({ ...message })),
        conversationMemory: memory.compactedMessages ? {
          compactedMessages: memory.compactedMessages,
          summary: memory.conversationSummary,
        } : null,
        config,
        // The exact UTF-8/JSON-fitted body; Library-first requests refit it
        // with the retrieved passages through the same builder.
        payload: { ...fitted.payload },
      },
    };
  };

  /**
   * Prepares and starts one request; returns "" or the reason it cannot run.
   * `action.focus: "stream"` moves focus to the answer in progress, for an
   * action whose button the new request removes or disables.
   */
  const runTutorAction = (action = {}) => {
    const prepared = prepareTutorRequest(action);
    if (!prepared.spec) return prepared.issue;
    lastRequestRef.current = prepared.spec;
    // The learner's web permission covers exactly one request.
    if (prepared.spec.webSearch) setWebSearch(false);
    if (action.focus === "stream") focusStreamOnMountRef.current = true;
    runRequest(prepared.spec);
    return "";
  };

  /**
   * Starts a one-tap action, or, when it cannot start (setup, the local-model
   * disclosure, a request that does not fit), puts its prompt in the question
   * box in a listed mode with the reason, so the learner can finish and send
   * it. It never fails silently.
   */
  const startTutorAction = (action) => {
    const issue = runTutorAction({ ...action, focus: "stream" });
    if (!issue) return true;
    const mode = composerModeFor(action.mode?.id);
    setModeId(mode.id);
    setPrompt(asTrimmedString(action.prompt, MAX_PROMPT_CHARS));
    retrievalHintRef.current = asTrimmedString(action.selectedDocumentId, 240);
    lastRequestRef.current = null;
    setRequestState((current) => current.status === "loading" ? current : { status: "idle", error: null });
    const reason = tutorActionIssueReason(issue, { configMessage: configState.status === "ready" ? "" : configState.message });
    setComposerNotice(`Your request is in the question box. ${reason}`.trim());
    window.setTimeout(focusComposer, 0);
    return false;
  };

  /**
   * A follow-up about one answer: that question and answer are its only
   * memory, it keeps the answer's grounding, retrieves with the answer's
   * topic and favours the lesson it cited. It never uses the web.
   */
  const runFollowUp = (message, item) => {
    if (requestState.status === "loading") return;
    const mode = modeById(item.modeId);
    const question = questionForAnswer(history, message.id);
    // Quiz and card results are remembered as the learner read them.
    const answerText = message.data ? tutorMessageMarkdown(message, { includeSources: false }) : message.content;
    const scope = followUpScope(message, normalizedSources);
    const { inputLimit: followUpInputLimit } = tutorRequestLimits(configState.config, responseProfile);
    const started = startTutorAction({
      mode,
      prompt: item.prompt,
      sourceMode: scope.sourceMode,
      sources: scope.sources,
      historyWindow: tutorFollowUpWindow(followUpPair(question, answerText), { inputLimit: followUpInputLimit }),
      retrievalQuery: followUpRetrievalQuery(question, message),
      selectedDocumentId: citedDocumentId(message),
      webSearch: false,
    });
    // "Check my understanding" asks a question: the learner answers it in
    // the same mode, so the session continues from the composer.
    if (started && SESSION_MODES.includes(mode.id) && modeId !== mode.id) {
      setModeId(mode.id);
      if (isDefaultPrompt(prompt.trim())) setPrompt("");
    }
  };

  /**
   * A Socratic or Interview session's own actions (TFEAT-05). A hint, a
   * reveal and the next question retrieve with the tutor's last question and
   * favour the lesson it cited, with the session as memory. Wrap up recaps
   * the session's turns alone: no library text, no older summary. None of
   * them grades a free-form answer, and none uses the web.
   */
  const runSessionAction = (kind) => {
    if (!session || requestState.status === "loading") return;
    if (kind === "wrap-up") {
      const { inputLimit: wrapUpInputLimit } = tutorRequestLimits(configState.config, responseProfile);
      const wrapUp = sessionWrapUp(session.messages, { inputLimit: wrapUpInputLimit });
      startTutorAction({ mode: modeById("summarize"), prompt: wrapUp.prompt, sourceMode: "none", historyWindow: wrapUp.historyWindow, webSearch: false });
      return;
    }
    const question = session.lastQuestion;
    const scope = followUpScope(question, normalizedSources);
    const action = {
      hint: { mode: modeById("hint"), prompt: HINT_PROMPT },
      reveal: { mode: modeById("reveal"), prompt: REVEAL_PROMPT },
      next: { mode: modeById(session.mode), prompt: NEXT_QUESTION_PROMPT },
    }[kind];
    if (!action) return;
    // The conversation is the memory, without the [S#]/[W#] labels of earlier
    // requests: this one is grounded in freshly retrieved passages.
    const { inputLimit: sessionInputLimit } = tutorRequestLimits(configState.config, responseProfile);
    const unlabelled = history.slice(tutorContextStart(history, Date.now())).map((message) => ({ ...message, content: withoutCitationLabels(message.content) }));
    startTutorAction({
      ...action,
      sourceMode: scope.sourceMode,
      sources: scope.sources,
      historyWindow: tutorConversationWindow(unlabelled, { prompt: action.prompt, sources: scope.sourceMode !== "none", inputLimit: sessionInputLimit }),
      retrievalQuery: sessionRetrievalQuery(question),
      selectedDocumentId: citedDocumentId(question),
      webSearch: false,
    });
  };

  // "Explain my mistake" for one keyed quiz miss: a Fast answer check that
  // retrieves with the question itself and favours the quiz's lesson. Its
  // question id is recorded on the quiz so the answer can be found again.
  const noHistory = { messages: [], conversationSummary: "", compactedMessages: 0 };
  const explainMistake = (quizMessage, question, chosenIndex) => {
    if (requestState.status === "loading") return;
    const { promptLimit: fastPromptLimit } = tutorRequestLimits(configState.config, "fast");
    const scope = followUpScope(quizMessage, normalizedSources);
    const userMessageId = createId();
    const started = startTutorAction({
      mode: modeById("feedback"),
      prompt: answerFeedbackPrompt(question, chosenIndex, { maxChars: fastPromptLimit }),
      sourceMode: scope.sourceMode,
      sources: scope.sources,
      historyWindow: noHistory,
      responseProfile: "fast",
      webSearch: false,
      retrievalQuery: feedbackRetrievalQuery(question),
      selectedDocumentId: citedDocumentId(quizMessage),
      userMessageId,
      stageHint: "Checking your answer against your library (about 20 s)",
    });
    if (started) updateQuizState(quizMessage.id, (current) => ({ ...current, explained: { ...current.explained, [question.id]: userMessageId } }));
  };

  const quizWeakSpots = (quizMessage, misses) => {
    if (requestState.status === "loading") return;
    const next = weakSpotQuiz(misses);
    const scope = followUpScope(quizMessage, normalizedSources);
    startTutorAction({
      mode: modeById("quiz"),
      prompt: next.prompt,
      sourceMode: scope.sourceMode,
      sources: scope.sources,
      historyWindow: noHistory,
      retrievalQuery: next.retrievalQuery,
      selectedDocumentId: citedDocumentId(quizMessage),
      webSearch: false,
    });
  };

  const showExplanation = (answerId) => {
    pendingFocusRef.current = { kind: "message", id: answerId, focus: true, scroll: true };
    setFocusRequest((count) => count + 1);
  };

  // "Answer this" puts a question in the box in its mode, with the cursor
  // after "My answer:". A draft the learner wrote is kept above.
  const prefillAnswer = ({ modeId: nextModeId, text, documentId = "", notice }) => {
    const draft = prompt.trim();
    const keepDraft = Boolean(draft) && !MODE_OPTIONS.some((mode) => mode.prompt === draft);
    setModeId(nextModeId);
    setPrompt((keepDraft ? `${draft}\n\n${text}` : text).slice(0, MAX_PROMPT_CHARS));
    retrievalHintRef.current = asTrimmedString(documentId, 240);
    outboundChanged();
    setComposerNotice(notice);
    window.setTimeout(() => {
      focusComposer();
      const field = promptRef.current;
      field?.setSelectionRange?.(field.value.length, field.value.length);
    }, 0);
  };

  // An answer check's own question, answered in Socratic mode.
  const answerCheck = (feedbackMessage, nextQuestion) => {
    if (requestState.status === "loading") return;
    prefillAnswer({ modeId: "socratic", text: `${withoutCitationLabels(nextQuestion)}\n\nMy answer: `, documentId: citedDocumentId(feedbackMessage), notice: "Write your answer after “My answer:”, then send." });
  };

  // Interview practice (TFEAT-06): the views in TutorPractice.jsx pick and
  // show the question; grading sends the answer with the question's model
  // answer and rubric as its one supplied source, never the library or the
  // web, and never without the whole rubric. The reference keeps one [S#]
  // number for the tab, like any other source.
  const citationNumberFor = useCallback((id) => sourceNumbersRef.current.get(id) ?? nextSourceNumberRef.current, []);
  const gradePractice = ({ prompt: gradingPrompt, reference }) => {
    if (!sourceNumbersRef.current.has(reference.id)) {
      sourceNumbersRef.current.set(reference.id, nextSourceNumberRef.current);
      nextSourceNumberRef.current += 1;
    }
    const userMessageId = createId();
    const issue = runTutorAction({
      mode: modeById("interview-practice"),
      prompt: gradingPrompt,
      sourceMode: "choose",
      sources: [{ ...reference, citationNumber: sourceNumbersRef.current.get(reference.id) }],
      historyWindow: noHistory,
      webSearch: false,
      requireWholeSources: true,
      userMessageId,
      stageHint: "Checking your answer against the rubric…",
      focus: "stream",
    });
    if (issue) setComposerNotice(`Your answer was not graded. ${tutorActionIssueReason(issue, { configMessage: configState.status === "ready" ? "" : configState.message })}`.trim());
    else updatePractice({ pendingId: userMessageId });
  };
  // A mode's default text is not the learner's draft; clearing it keeps the
  // docked composer to one line while they answer in the practice card.
  const clearDefaultPrompt = () => { if (isDefaultPrompt(prompt.trim())) setPrompt(""); };

  // An authored follow-up is answered in Interview mode, to the tutor.
  const answerPracticeFollowUp = (followUp, question) => {
    if (requestState.status === "loading") return;
    prefillAnswer({ modeId: "interview", text: `Interview follow-up: ${followUp}\n\nMy answer: `, documentId: question?.documentId, notice: "Write your answer after “My answer:”, then send it to the interviewer." });
  };

  const submit = (event) => {
    event?.preventDefault?.();
    if (!requestReady) return;
    focusStopOnMountRef.current = document.activeElement !== promptRef.current;
    const selectedDocumentId = retrievalHintRef.current;
    const placed = retrievalQueryHintRef.current;
    const retrievalQuery = placed.query && placed.prompt === prompt.trim() ? placed.query : "";
    if (!runTutorAction({ webSearch: effectiveWebSearch, selectedDocumentId, retrievalQuery })) {
      retrievalHintRef.current = "";
      retrievalQueryHintRef.current = { prompt: "", query: "" };
    }
  };

  const retry = () => {
    const retrySpec = lastRequestRef.current;
    if (!retrySpec || requestState.status === "loading" || !localDisclosureAcknowledged) return;
    if (retrySpec.webSearch && !effectiveWebSearch) return;
    if (retrySpec.webSearch) setWebSearch(false);
    focusStopOnMountRef.current = document.activeElement !== promptRef.current;
    runRequest(lastRequestRef.current, { appendUser: false });
  };

  const outboundChanged = () => {
    setComposerNotice("");
    if (requestState.status === "error" || requestState.status === "cancelled") {
      lastRequestRef.current = null;
      setRequestState({ status: "idle", error: null });
    }
  };

  const changeWebSearch = (checked) => {
    setWebSearch(checked);
    const renewsFailedRequest = checked
      && (requestState.status === "error" || requestState.status === "cancelled")
      && lastRequestRef.current?.webSearch === true;
    if (renewsFailedRequest) {
      setComposerNotice("Current-web fallback is re-authorized for one retry of the unchanged request.");
      return;
    }
    outboundChanged();
  };

  const selectMode = (nextModeId) => {
    const nextMode = modeById(nextModeId);
    const previousDefault = currentMode.prompt;
    setModeId(nextMode.id);
    outboundChanged();
    if (!prompt.trim() || prompt === previousDefault) {
      setPrompt(nextMode.prompt);
      retrievalHintRef.current = "";
    }
  };

  // A graded practice answer is edited where it was written: in the practice
  // card, under its question, in Interview mode. Its grading question names
  // a reference that only the card supplies, so it never returns to the box.
  const reopenPractice = (message) => {
    const questionId = practiceQuestionIdFrom(message);
    setModeId("interview");
    lastRequestRef.current = null;
    setRequestState({ status: "idle", error: null });
    if (isDefaultPrompt(prompt.trim())) setPrompt("");
    if (!questionId || (practiceKit && !practiceKit.questions.has(questionId))) {
      setComposerNotice("That practice question is not in this version of Lumen’s interview bank. Pick a question in the practice card.");
      window.setTimeout(focusComposer, 0);
      return;
    }
    updatePractice((current) => ({ ...current, questionId, answer: practiceAnswerFrom(message.content), pendingId: "" }));
    setComposerNotice("Your answer is back in the practice card. Edit it, then grade it again.");
    window.setTimeout(() => {
      const field = conversationRef.current?.querySelector(".ai-tutor__practice textarea");
      if (!field) return focusComposer();
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: "nearest", behavior: "instant" });
      return undefined;
    }, 0);
  };
  const reopenPracticeRef = useRef(reopenPractice);
  reopenPracticeRef.current = reopenPractice;

  const preparePrompt = useCallback((message, notice) => {
    if (!message || requestState.status === "loading") return;
    if (message.mode === "interview-practice") {
      reopenPracticeRef.current(message);
      return;
    }
    const nextMode = composerModeFor(message.mode);
    setModeId(nextMode.id);
    setPrompt(asTrimmedString(message.content, MAX_PROMPT_CHARS));
    setComposerNotice(notice);
    lastRequestRef.current = null;
    setRequestState({ status: "idle", error: null });
    window.setTimeout(focusComposer, 0);
  }, [focusComposer, requestState.status]);

  const prepareRegenerate = useCallback((assistantMessage) => {
    const index = history.findIndex((message) => message.id === assistantMessage.id);
    const userMessage = index > 0 ? [...history.slice(0, index)].reverse().find((message) => message.role === "user") : null;
    // Mention only what the learner actually has to renew: the remembered
    // local-model disclosure and the one-request web permission.
    const usedWeb = ["searching", "used", "failed", "not-needed"].includes(assistantMessage.webFallbackStatus);
    if (userMessage) preparePrompt(userMessage, `Request restored. Review its sources and settings${localDisclosureAcknowledged ? "" : ", acknowledge the local-model disclosure"}${usedWeb ? ", tick “Allow current-web fallback” again if it should search the web" : ""}, then generate a fresh response.`);
  }, [history, localDisclosureAcknowledged, preparePrompt]);

  const chooseSourceMode = (nextMode) => {
    if (requestState.status === "loading" || nextMode === sourceMode) return;
    setSourceMode(nextMode);
    if (nextMode !== "library-first") setWebSearch(false);
    if (nextMode === "choose") setSourcePanelOpen(true);
    outboundChanged();
  };

  // Loads a catalog lesson's text on demand, then selects it (still capped).
  const loadAndSelectSource = async (entry) => {
    if (typeof loadSource !== "function" || sourceLoads[entry.id] === "loading") return;
    if (selectedSourceIds.size >= MAX_SELECTED_SOURCES) {
      setSourceWarning(`Choose up to ${MAX_SELECTED_SOURCES} sources per request so citations remain precise.`);
      return;
    }
    setSourceLoads((current) => ({ ...current, [entry.id]: "loading" }));
    try {
      const text = asTrimmedString(await loadSource(entry.id));
      if (!text) throw new Error("empty source");
      setCatalogSources((current) => current.some((source) => source.id === entry.id)
        ? current
        : [...current, { id: entry.id, documentId: entry.id, title: entry.title, section: entry.section, text, selected: false }]);
      setSelectedSourceIds((current) => current.size >= MAX_SELECTED_SOURCES ? current : new Set([...current, entry.id]));
      setSourceLoads((current) => { const next = { ...current }; delete next[entry.id]; return next; });
      outboundChanged();
    } catch {
      setSourceLoads((current) => ({ ...current, [entry.id]: "error" }));
    }
  };

  const toggleVisibleSources = () => {
    if (requestState.status === "loading") return;
    outboundChanged();
    const visible = filteredSources.slice(0, MAX_SELECTED_SOURCES);
    const allSelected = visible.length > 0 && visible.every((entry) => selectedSourceIds.has(entry.id));
    if (allSelected) {
      setSelectedSourceIds((current) => new Set([...current].filter((id) => !visible.some((entry) => entry.id === id))));
      return;
    }
    let room = MAX_SELECTED_SOURCES - selectedSourceIds.size;
    const loaded = [];
    for (const entry of visible) {
      if (room <= 0) break;
      if (selectedSourceIds.has(entry.id)) continue;
      room -= 1;
      if (entry.source) loaded.push(entry.id);
      else void loadAndSelectSource(entry);
    }
    if (loaded.length) setSelectedSourceIds((current) => new Set([...current, ...loaded].slice(0, MAX_SELECTED_SOURCES)));
  };

  const toggleSource = (sourceId) => {
    const entry = chooseEntries.find((item) => item.id === sourceId);
    if (entry && !entry.source) {
      void loadAndSelectSource(entry);
      return;
    }
    outboundChanged();
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
        setSourceWarning("");
      } else if (next.size >= MAX_SELECTED_SOURCES) {
        setSourceWarning(`Choose up to ${MAX_SELECTED_SOURCES} sources per request so citations remain precise.`);
      } else {
        next.add(sourceId);
        setSourceWarning("");
      }
      return next;
    });
  };

  const clearHistory = () => {
    if (requestState.status === "loading") return;
    setConfirmClearOpen(true);
  };

  const confirmClear = () => {
    setConfirmClearOpen(false);
    publishHistory([]);
    setQuizStates({});
    updatePractice((current) => ({ ...current, pendingId: "", ticks: {}, outcomes: {} }));
    stopTutorSpeech();
    lastRequestRef.current = null;
    retrievalHintRef.current = "";
    setRequestState({ status: "idle", error: null });
    // The Clear button disappears with the conversation; the tutor heading
    // takes focus instead of <body>.
    pendingFocusRef.current = { kind: "heading", focus: true };
    announce("Conversation cleared.");
  };

  const submitPairing = async (event) => {
    event.preventDefault();
    if (pairingBusy || !pairingCode.trim()) return;
    setPairingBusy(true);
    setPairingError("");
    try {
      await aiClient.pair(pairingCode);
      setPairingCode("");
      setConfigAttempt((attempt) => attempt + 1);
      // The pairing form disappears once the server confirms the session.
      pendingFocusRef.current = { kind: "heading", focus: true };
      announce("This browser is paired. Checking the tutor again.");
    } catch (error) {
      setPairingError(error instanceof AiClientError ? error.message : "Pairing failed. Try again.");
      window.setTimeout(() => pairingInputRef.current?.focus(), 0);
    } finally {
      setPairingBusy(false);
    }
  };

  // Roving focus for the grounding radiogroup: one Tab stop, arrow keys move
  // and select, Home/End jump to the ends.
  const onSourceModeKeyDown = (event, index) => {
    const steps = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const next = event.key in steps
      ? (index + steps[event.key] + SOURCE_MODES.length) % SOURCE_MODES.length
      : event.key === "Home" ? 0 : event.key === "End" ? SOURCE_MODES.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    chooseSourceMode(SOURCE_MODES[next].id);
    sourceModeRefs.current[SOURCE_MODES[next].id]?.focus();
  };

  const configIcon = configState.status === "ready" ? <ShieldCheck size={16} aria-hidden="true" />
    : configState.status === "checking" ? <LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" />
      : configState.status === "pairing" ? <LockKeyhole size={16} aria-hidden="true" />
        : <AlertTriangle size={16} aria-hidden="true" />;

  // Nothing can be generated until the server is set up or this browser is
  // paired, so those states show a focused card instead of the full composer.
  const setupRequired = configState.status === "disabled" || configState.status === "pairing";
  // Losing the server or its pairing closes the options sheet for good; it
  // must not reopen by itself once the tutor is available again.
  useEffect(() => {
    if (setupRequired) setOptionsOpen(false);
  }, [setupRequired]);

  // Conversation export (Markdown) and session statistics (AI-002/PERF-002).
  const sessionStats = (() => {
    const answers = history.filter((message) => message.role === "assistant");
    if (answers.length < 2) return null;
    const durations = answers.map((message) => message.durationMs).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
    const tokens = answers.reduce((sum, message) => sum + (message.usage?.outputTokens || 0), 0);
    return { count: answers.length, median, tokens };
  })();

  const exportConversation = () => {
    const exportedAt = new Date();
    downloadBlob(`lumen-tutor-conversation-${exportedAt.toISOString().slice(0, 10)}.md`, [tutorConversationMarkdown(history, {
      exportedAt,
      modeLabel: (id) => modeById(id).label,
      profileLabel: profileLabel,
    })], "text/markdown;charset=utf-8");
  };

  const disabledReason = configState.status === "disabled"
    ? "Generation is unavailable because AI is not set up on this server."
    : configState.status === "pairing"
      ? "Pair this browser with the code from the server operator to enable generation."
      : configState.status === "insecure"
        ? "Generation is off on this connection. Open Lumen over HTTPS."
        : configState.status === "error"
          ? "Generation is unavailable until the local model responds. Lumen checks again automatically."
          : configState.status !== "ready"
            ? ""
            : !prompt.trim()
              ? "Enter a learning request to enable generation."
              : promptTooLong
                ? `Shorten the prompt to ${promptLimit.toLocaleString()} characters for this server’s input limit.`
                : contextTooSmall
                  ? "Select fewer sources, shorten the prompt, or clear conversation history so every selected source can be included."
                  : requestTooLarge
                    ? `This request is ${requestPayloadBytes.toLocaleString()} UTF-8 bytes; reduce it below the server's ${configuredRequestByteLimit.toLocaleString()}-byte local-model budget.`
                    : !localDisclosureAcknowledged
                      ? DISCLOSURE_REASON
                      : "";
  // An empty box (its placeholder and the dimmed Send say so) and the
  // disclosure (its checkbox sits right above the question) need no visible
  // line in the docked composer; screen readers still get the reason.
  const quietReason = configState.status === "ready" && (!prompt.trim() || disabledReason === DISCLOSURE_REASON);

  // "Jump to latest" while an answer streams out of view after the learner
  // scrolled away; "Answer ready" for a while after it lands out of view.
  const jumpLabel = requestState.status === "loading" && activeResponse && !atLatest && !following
    ? "Jump to latest"
    : readyAnswerId && !atLatest && history.some((message) => message.id === readyAnswerId) ? "Answer ready" : "";
  const jumpToLatest = () => {
    if (requestState.status === "loading") {
      setFollowing(true);
      conversationEndRef.current?.scrollIntoView({ block: "end", behavior: scrollBehavior() });
      // The pill disappears; focus goes to the answer it jumped to.
      streamingArticleRef.current?.focus({ preventScroll: true });
      return;
    }
    const id = readyAnswerId;
    setReadyAnswerId("");
    pendingFocusRef.current = { kind: "message", id, focus: true, scroll: true };
  };

  const reuseNotice = `Request restored. Edit it and review its grounding${localDisclosureAcknowledged ? "" : " and the local-model disclosure"}, then send.`;

  // Each "Explain my mistake" a quiz sent, found again in the conversation:
  // the answer right after its question (and whether it disputed the key),
  // or still pending while that request runs.
  const loading = requestState.status === "loading";
  const quizExplanations = useMemo(() => {
    const byQuiz = {};
    Object.entries(quizStates).forEach(([quizId, state]) => {
      byQuiz[quizId] = Object.fromEntries(Object.entries(state.explained).map(([questionId, questionMessageId]) => {
        const index = history.findIndex((message) => message.id === questionMessageId);
        const answer = index >= 0 ? history[index + 1] : null;
        if (answer?.role === "assistant" && answer.mode === "feedback" && validateTutorAnswerFeedback(answer.data)) {
          return [questionId, { answerId: answer.id, disputed: answer.data.correct === true }];
        }
        return [questionId, { pending: loading && index >= 0 && index === history.length - 1 }];
      }));
    });
    return byQuiz;
  }, [history, loading, quizStates]);
  // The quiz question an answer check is about.
  const feedbackQuestionFor = (message) => {
    const asked = questionForAnswer(history, message.id);
    if (!asked) return null;
    for (const [quizId, state] of Object.entries(quizStates)) {
      const questionId = Object.keys(state.explained).find((id) => state.explained[id] === asked.id);
      if (!questionId) continue;
      return history.find((item) => item.id === quizId)?.data?.questions?.find((question) => question.id === questionId) || null;
    }
    return null;
  };
  // Answer checks are a separate server task; a server without it keeps the
  // button, disabled with the reason.
  const serverTasks = configState.config?.supportedTasks;
  const serverStructuredTasks = configState.config?.structuredTasks;
  const feedbackUnavailable = configState.status === "ready"
    && (!Array.isArray(serverTasks) || !serverTasks.includes("answer_feedback")
      || (Array.isArray(serverStructuredTasks) && !serverStructuredTasks.includes("answer_feedback")))
    ? "This AI server cannot check quiz answers."
    : "";
  // Why the tutor cannot grade a practice answer at all right now.
  const practiceVisible = !setupRequired && currentMode.id === "interview";
  const practiceBlocked = configState.status !== "ready" ? configState.message || "The tutor is not ready yet."
    : feedbackUnavailable ? "This AI server cannot grade answers."
      : !localDisclosureAcknowledged ? "Tick the local-model permission under the question box, then grade your answer." : "";
  const InterviewPractice = interviewBank.ui?.InterviewPractice;
  const practiceCard = practiceVisible && (InterviewPractice && practiceKit.tracks.length ? (
    <InterviewPractice
      kit={practiceKit}
      practice={practice}
      updatePractice={updatePractice}
      mistakes={Array.isArray(studyContext?.mistakes) ? studyContext.mistakes : []}
      request={{ config: configState.config, responseProfile, difficulty }}
      citationNumberFor={citationNumberFor}
      blocked={practiceBlocked}
      busy={loading}
      onGrade={gradePractice}
      onQuestion={clearDefaultPrompt}
    />
  ) : interviewBank.status === "error" ? (
    <div className="ai-tutor__practice"><p className="ai-tutor__practice-intro">The authored interview questions could not be loaded.</p><button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => setInterviewBank({ status: "idle", ui: null, kit: null })}><RefreshCw size={15} aria-hidden="true" /> Try again</button></div>
  ) : <p className="ai-tutor__practice-intro ai-tutor__practice-loading">Loading the authored interview questions…</p>);
  // The divider where the model's memory now starts.
  const contextBreak = (
    <div className="ai-tutor__context-break" role="note">
      <strong>Earlier turns are not sent to the model</strong>
      <span>More than 3 hours passed, so the tutor starts fresh from here.</span>
    </div>
  );

  // Completed prose answers can be heard; speak() runs inside the click so
  // iOS treats it as the learner's gesture. Unsupported speech hides it.
  const listenFor = (message) => {
    if (!speech || speech.status === "unsupported" || message.role !== "assistant" || message.incomplete || message.data) return null;
    const state = speakingMessageId === message.id ? tutorSpeechState : "idle";
    return {
      state,
      error: listenError.id === message.id ? listenError.text : "",
      onListen: () => {
        const spoken = tutorSpeechText(message.content);
        const started = spoken.text && speech.speak(spoken.text, { label: TUTOR_SPEECH_LABEL, sections: spoken.sections });
        setSpeakingMessageId(started ? message.id : "");
        setListenError(started ? { id: "", text: "" } : { id: message.id, text: "This answer could not be read aloud on this device." });
      },
      onTogglePause: () => speech.togglePause(),
      onStop: () => {
        speech.stop();
        setSpeakingMessageId("");
      },
    };
  };
  const studyFor = (message) => (message.mode === "quiz" ? {
    quizState: quizStates[message.id],
    onQuizStateChange: updateQuizState,
    onAnnounce: announce,
    explanations: quizExplanations[message.id] || {},
    explainUnavailable: feedbackUnavailable,
    requestBusy: loading,
    onExplainMistake: explainMistake,
    onShowExplanation: showExplanation,
    onSaveMisses: onSaveMistakes,
    onWeakSpotQuiz: quizWeakSpots,
  } : message.mode === "feedback" ? { feedbackQuestion: feedbackQuestionFor(message), onAnswerCheck: answerCheck } : message.mode === "interview-practice" ? {
    Rubric: interviewBank.ui?.RubricFeedback,
    bankStatus: interviewBank.status,
    question: practiceKit?.questions.get(practiceQuestionIdFrom(message)) || null,
    messageId: message.id,
    answer: practiceAnswerFrom(questionForAnswer(history, message.id)?.content),
    trackId: practice.trackId,
    kit: practiceKit,
    practice,
    updatePractice,
    onSaveMistakes,
    onFollowUp: (followUp) => answerPracticeFollowUp(followUp, practiceKit?.questions.get(practiceQuestionIdFrom(message))),
  } : undefined);

  // Suggested starts (TFEAT-04): four on a phone, six on wider screens,
  // using lesson headings only when that lesson's text is already loaded.
  const starters = useMemo(() => buildStarterPrompts(studyContext, {
    limit: compactModes ? 4 : 6,
    lessonText: (id) => {
      const loaded = (Array.isArray(sources) ? sources : []).find((source) => (source?.documentId || source?.id) === id);
      return loaded ? sourceText(loaded) : "";
    },
  }), [compactModes, sources, studyContext]);
  const [pendingStarter, setPendingStarter] = useState(null);
  const keepDraftRef = useRef(null);
  // A mode's default text or an earlier starter is not the learner's draft.
  const isDefaultPrompt = (text) => MODE_OPTIONS.some((mode) => mode.prompt === text) || starters.some((starter) => starter.prompt === text);
  const applyStarter = (starter) => {
    setPendingStarter(null);
    setModeId(composerModeFor(starter.modeId).id);
    setPrompt(asTrimmedString(starter.prompt, MAX_PROMPT_CHARS));
    retrievalHintRef.current = asTrimmedString(starter.documentId, 240);
    outboundChanged();
    window.setTimeout(focusComposer, 0);
  };
  // A starter fills the question box and never sends. A draft the learner
  // wrote is replaced only when they say so.
  const chooseStarter = (starter) => {
    if (requestState.status === "loading") return;
    const draft = prompt.trim();
    if (draft && draft !== starter.prompt && !isDefaultPrompt(draft)) {
      setPendingStarter(starter);
      window.setTimeout(() => keepDraftRef.current?.focus(), 0);
      return;
    }
    applyStarter(starter);
  };
  // The session strip (TFEAT-05) shows while the composer is in a practice
  // mode; choosing another mode leaves the session. While a tutor question
  // waits, the question box is where the learner answers it.
  const sessionStrip = !setupRequired && session && SESSION_MODES.includes(currentMode.id) ? session : null;
  const answering = Boolean(sessionStrip && !sessionStrip.revealed);
  // A prepared question from another screen, such as a mistake-notebook
  // entry (TFEAT-07): consumed once and never sent. It sets its mode and
  // keeps its lesson as the retrieval hint for the next Send; a draft the
  // learner wrote is replaced only when they say so.
  const [pendingPrefill, setPendingPrefill] = useState(null);
  const keepPrefillDraftRef = useRef(null);
  // "From mistake notebook: “Why …?”", ended as a sentence.
  const prefillOrigin = (prefill) => {
    const origin = `From ${prefill.origin || "another screen"}${prefill.label ? `: “${prefill.label}”` : ""}`;
    return /[.?!…]$/.test(prefill.label) ? origin : `${origin}.`;
  };
  const applyPrefill = (prefill) => {
    setPendingPrefill(null);
    setPendingStarter(null);
    setModeId(composerModeFor(prefill.modeId).id);
    setPrompt(prefill.prompt);
    outboundChanged();
    retrievalHintRef.current = prefill.documentId;
    retrievalQueryHintRef.current = { prompt: prefill.prompt, query: prefill.retrievalQuery };
    setComposerNotice(`${prefillOrigin(prefill)} Review the question, then send.`);
    window.setTimeout(focusComposer, 0);
  };
  const applyPrefillRef = useRef(applyPrefill);
  applyPrefillRef.current = applyPrefill;
  const isDefaultPromptRef = useRef(isDefaultPrompt);
  isDefaultPromptRef.current = isDefaultPrompt;
  useEffect(() => {
    if (insertPrompt?.kind !== "prompt" || !insertPrompt.nonce || consumedInsertRef.current === insertPrompt.nonce) return;
    consumedInsertRef.current = insertPrompt.nonce;
    onInsertConsumedRef.current?.(insertPrompt.nonce);
    const prefill = {
      modeId: asTrimmedString(insertPrompt.modeId, 40),
      prompt: asTrimmedString(insertPrompt.prompt, MAX_PROMPT_CHARS),
      origin: asTrimmedString(insertPrompt.origin, 60),
      label: asTrimmedString(insertPrompt.label, 100),
      documentId: asTrimmedString(insertPrompt.documentId, 240),
      retrievalQuery: asTrimmedString(insertPrompt.retrievalQuery, 300),
    };
    if (!prefill.prompt) return;
    const draft = latestPromptRef.current.trim();
    if (draft && draft !== prefill.prompt && !isDefaultPromptRef.current(draft)) {
      setPendingPrefill(prefill);
      window.setTimeout(() => keepPrefillDraftRef.current?.focus(), 0);
      return;
    }
    applyPrefillRef.current(prefill);
  }, [insertPrompt]);

  const codeMode = currentMode.id === "code-review";
  const keyHint = setupRequired ? "" : composerKeyHint({ finePointer, codeMode, platform: currentPlatform() });

  const onPromptKeyDown = (event) => {
    if (composerEnterAction(event, { finePointer, codeMode }) === "send") {
      // Not ready: nothing is sent, the new line is not typed either, and
      // the reason stays visible under the box.
      event.preventDefault();
      submit(event);
      return;
    }
    if (shouldRecallLastQuestion(event, event.currentTarget) && requestState.status !== "loading") {
      const lastQuestion = [...history].reverse().find((message) => message.role === "user");
      if (!lastQuestion) return;
      event.preventDefault();
      preparePrompt(lastQuestion, reuseNotice);
    }
  };

  // Esc stops a running answer from anywhere in the tutor, but never from
  // the options sheet, the Clear dialog or an open disclosure.
  const stopOnEscape = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || requestState.status !== "loading" || optionsOpen || confirmClearOpen) return;
    if (event.target?.closest?.("details[open], [role='dialog'], [role='alertdialog']")) return;
    event.preventDefault();
    event.stopPropagation();
    requestControllerRef.current?.abort();
  };

  // Non-default request options, shown on the Options button.
  const optionsSummary = [
    difficulty !== "intermediate" ? DIFFICULTIES.find((item) => item.id === difficulty)?.label : "",
    responseProfile !== "balanced" ? profileLabel(responseProfile) : "",
  ].filter(Boolean).join(" · ");

  const cancelled = requestState.status === "cancelled";
  const requestNotice = (requestState.status === "error" || cancelled) && (
    <div className={cancelled ? "ai-tutor__request-note" : "ai-tutor__request-error"} role={cancelled ? undefined : "alert"} tabIndex={-1} ref={requestNoticeRef}>
      {cancelled ? <CircleStop size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
      <div>
        <strong>{cancelled ? "Stopped" : requestErrorTitle(requestState.status, requestState.error?.code)}</strong>
        <p>{cancelled ? "You stopped this answer. Anything it had written is kept above, and your question is still in the box." : requestState.error?.message}</p>
        {!cancelled && <WebFallbackBadge status={requestState.error?.webFallbackStatus} />}
        {requestState.error?.retryAfter && <small>Server retry guidance: wait {requestState.error.retryAfter} seconds.</small>}
        {!cancelled && requestState.error?.requestId && <small>Request ID: {requestState.error.requestId}</small>}
        {requestState.error?.canRetry && lastRequestRef.current?.webSearch === true && !effectiveWebSearch && <small>Re-enable “Allow current-web fallback” below to authorize one retry. The retry may generate and send a new search query.</small>}
      </div>
      {requestState.error?.canRetry && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={retry} disabled={!localDisclosureAcknowledged || (lastRequestRef.current?.webSearch === true && !effectiveWebSearch)}><RefreshCw size={15} aria-hidden="true" /> {cancelled ? "Generate again" : "Retry"}</button>}
    </div>
  );

  return (
    <section className={`ai-tutor ${className}`.trim()} aria-labelledby={headingId} onKeyDown={stopOnEscape}>
      <header className="ai-tutor__header">
        <div className="ai-tutor__identity">
          <span className="ai-tutor__mark" aria-hidden="true"><BrainCircuit size={24} /></span>
          <div><span className="ai-tutor__eyebrow">Grounded learning assistant</span><h2 id={headingId} ref={headingRef} tabIndex={-1}>Lumen AI Tutor</h2></div>
        </div>
        <div className="ai-tutor__header-actions">
          {history.length > 0 && <button className="ai-tutor__icon-button" type="button" onClick={exportConversation} aria-label="Export conversation as Markdown" title="Export conversation"><Download size={18} /></button>}
          {history.length > 0 && <button className="ai-tutor__new-topic" type="button" onClick={clearHistory} disabled={requestState.status === "loading"} aria-describedby={newTopicHintId}><MessageSquarePlus size={17} aria-hidden="true" /><span className="ai-tutor__new-topic-label">New topic</span></button>}
          {history.length > 0 && <span className="visually-hidden" id={newTopicHintId}>Clears this conversation, with an option to export it first.</span>}
          {onClose && <button className="ai-tutor__button ai-tutor__button--ghost" type="button" onClick={onClose}>Close</button>}
        </div>
      </header>

      {sessionStats && <p className="ai-tutor__session-stats">{sessionStats.count} answers in this conversation{sessionStats.median !== null ? ` · median ${(sessionStats.median / 1_000).toFixed(1)}s` : ""}{sessionStats.tokens ? ` · ${sessionStats.tokens.toLocaleString()} output tokens` : ""}</p>}

      <div className={`ai-tutor__connection ai-tutor__connection--${configState.status}`} role="status">
        {configIcon}<span>{configState.message}</span>
        {["ready", "error", "disabled"].includes(configState.status) && <button className="ai-tutor__text-button" type="button" disabled={requestState.status === "loading"} onClick={() => setConfigAttempt((attempt) => attempt + 1)}><RefreshCw size={14} aria-hidden="true" /> {configState.status === "ready" ? "Refresh" : "Check again"}<span className="visually-hidden"> AI connection</span></button>}
      </div>

      {configState.status === "pairing" && (
        <form className="ai-tutor__pairing" onSubmit={submitPairing}>
          <label htmlFor={`${headingId}-pairing-code`}>Pairing code</label>
          <div className="ai-tutor__pairing-row">
            <input
              id={`${headingId}-pairing-code`}
              ref={pairingInputRef}
              type="password"
              autoComplete="one-time-code"
              value={pairingCode}
              maxLength={200}
              placeholder="Code from the server operator"
              aria-invalid={pairingError ? true : undefined}
              aria-describedby={pairingError ? pairingErrorId : undefined}
              onChange={(event) => setPairingCode(event.target.value)}
            />
            <button className="ai-tutor__button ai-tutor__button--primary" type="submit" disabled={pairingBusy || !pairingCode.trim()}>
              {pairingBusy ? <LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />} Pair this browser
            </button>
          </div>
          {pairingError && <p className="ai-tutor__pairing-error" id={pairingErrorId} role="alert">{pairingError}</p>}
          <p className="ai-tutor__pairing-note">This browser remembers your pairing.</p>
        </form>
      )}

      {!setupRequired && <>
        {compactModes ? (
          <label className="ai-tutor__mode-select">
            <span>Mode</span>
            <select value={modeId} disabled={requestState.status === "loading"} aria-describedby={modeDescriptionId} onChange={(event) => selectMode(event.target.value)}>
              {MODE_OPTIONS.map((mode) => <option value={mode.id} key={mode.id}>{mode.label}</option>)}
            </select>
          </label>
        ) : (
          <div className="ai-tutor__mode-tabs" role="group" aria-label="Tutor mode" aria-describedby={modeDescriptionId}>
            {MODE_OPTIONS.map((mode) => <button aria-pressed={mode.id === modeId} className={mode.id === modeId ? "is-active" : ""} type="button" disabled={requestState.status === "loading"} onClick={() => selectMode(mode.id)} key={mode.id}>{mode.label}</button>)}
          </div>
        )}
        <p className="ai-tutor__mode-description" id={modeDescriptionId}>{currentMode.description}</p>
      </>}

      <div className={`ai-tutor__workspace${setupRequired ? " is-setup" : ""}`}>
        {!setupRequired && <aside className={`ai-tutor__context ${sourcePanelOpen ? "is-open" : ""}`} aria-labelledby={`${headingId}-sources`}>
          <button className="ai-tutor__source-panel-toggle" type="button" aria-expanded={sourcePanelOpen} aria-controls={`${headingId}-source-panel`} onClick={() => setSourcePanelOpen((open) => !open)}>
            <span><BookOpen size={18} aria-hidden="true" /><span><strong id={`${headingId}-sources`}>Grounding</strong><small>{sourceMode === "library-first" ? "Library first · all lessons" : sourceMode === "none" ? "No library · lesson text not sent" : `${SOURCE_MODES.find((item) => item.id === sourceMode)?.label} · ${selectedSources.length} attached`}</small></span></span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          <div className="ai-tutor__source-panel" id={`${headingId}-source-panel`}>
            <div className="ai-tutor__section-head"><div><span className="ai-tutor__eyebrow">Evidence scope</span><h3>Where should Lumen look?</h3></div>{sourceMode === "library-first" ? <span className="ai-tutor__count">Auto</span> : sourceMode !== "none" && <><span className="ai-tutor__count" aria-hidden="true">{selectedSources.length}/{MAX_SELECTED_SOURCES}</span><span className="visually-hidden">{selectedSources.length} of {MAX_SELECTED_SOURCES} sources attached</span></>}</div>
            <div className="ai-tutor__source-modes" role="radiogroup" aria-label="Library grounding scope">
              {SOURCE_MODES.map((item, index) => <button type="button" role="radio" aria-checked={sourceMode === item.id} tabIndex={sourceMode === item.id ? 0 : -1} ref={(node) => { sourceModeRefs.current[item.id] = node; }} className={sourceMode === item.id ? "is-active" : ""} disabled={requestState.status === "loading"} onClick={() => chooseSourceMode(item.id)} onKeyDown={(event) => onSourceModeKeyDown(event, index)} key={item.id}><strong>{item.label}</strong><small>{item.short}</small></button>)}
            </div>
            {sourceMode === "library-first" ? (
              <>
                <p className="ai-tutor__grounding-note">Relevant passages are chosen from every lesson, note and upload when you send.{openLesson ? " Questions about “this lesson” also include the open lesson:" : ""}</p>
                {openLesson && <div className="ai-tutor__source-list"><article className="ai-tutor__source ai-tutor__source--open is-selected">
                  <div className="ai-tutor__source-open"><span className="ai-tutor__source-citation">Open</span><span className="ai-tutor__source-copy"><strong>{openLesson.title}</strong>{openLesson.section && <small>{openLesson.section}</small>}</span></div>
                  {onNavigateSource && <button className="ai-tutor__icon-button" type="button" onClick={() => onNavigateSource(openLesson.original, { sourceId: openLesson.id })} aria-label={`Open ${openLesson.title}`} title="Open lesson"><ExternalLink size={16} /></button>}
                </article></div>}
              </>
            ) : sourceMode === "current" ? (currentLessonSources.length ? (
              <div className="ai-tutor__source-list">
                {currentLessonSources.map((source) => (
                  <article className="ai-tutor__source is-selected" key={source.id}>
                    <label>
                      <input type="checkbox" checked disabled onChange={() => {}} />
                      <span className="ai-tutor__source-citation">S{source.citationNumber}</span>
                      <span className="ai-tutor__source-copy"><strong>{source.title}</strong>{source.section && <small>{source.section}</small>}<small>{source.text.length.toLocaleString()} characters</small></span>
                    </label>
                    {onNavigateSource && <button className="ai-tutor__icon-button" type="button" onClick={() => onNavigateSource(source.original, { citation: `[S${source.citationNumber}]`, sourceId: source.id })} aria-label={`Open ${source.title}`} title="Open source"><ExternalLink size={16} /></button>}
                  </article>
                ))}
              </div>
            ) : <div className="ai-tutor__empty-source"><BookOpen size={20} aria-hidden="true" /><p>No lesson is attached. You can still ask a free question; claims will be labeled as general knowledge unless web fallback is enabled.</p></div>
            ) : sourceMode === "choose" ? (
              <>
                <div className="ai-tutor__source-tools"><label><Search size={15} aria-hidden="true" /><span className="visually-hidden">Filter learning sources</span><input type="search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Filter library…" /></label><button className="ai-tutor__text-button" type="button" disabled={!filteredSources.length || requestState.status === "loading"} onClick={toggleVisibleSources}>{filteredSources.length && filteredSources.slice(0, MAX_SELECTED_SOURCES).every((entry) => selectedSourceIds.has(entry.id)) ? "Clear shown" : "Select shown"}</button></div>
                {filteredSources.length ? (
                  <div className="ai-tutor__source-list">
                    {filteredSources.map((entry) => {
                      const selected = selectedSourceIds.has(entry.id);
                      const loadState = sourceLoads[entry.id];
                      return (
                        <article className={`ai-tutor__source ${selected ? "is-selected" : ""}`} key={entry.id} aria-busy={loadState === "loading" || undefined}>
                          <label>
                            <input type="checkbox" checked={selected} disabled={requestState.status === "loading" || loadState === "loading"} onChange={() => toggleSource(entry.id)} />
                            {entry.source ? <span className="ai-tutor__source-citation">S{entry.source.citationNumber}</span> : <span className="ai-tutor__source-citation is-pending" aria-hidden="true">{loadState === "loading" ? <LoaderCircle className="ai-tutor__spin" size={13} /> : "+"}</span>}
                            <span className="ai-tutor__source-copy"><strong>{entry.title}</strong>{entry.section && <small>{entry.section}</small>}<small className={loadState === "error" ? "is-error" : undefined}>{entry.source ? `${entry.source.text.length.toLocaleString()} characters` : loadState === "loading" ? "Loading lesson text…" : loadState === "error" ? "Could not load this lesson. Tick it to try again." : "Loads when selected"}</small></span>
                          </label>
                          {onNavigateSource && <button className="ai-tutor__icon-button" type="button" onClick={() => onNavigateSource(entry.source?.original || { id: entry.id, documentId: entry.id, title: entry.title }, { sourceId: entry.id })} aria-label={`Open ${entry.title}`} title="Open source"><ExternalLink size={16} /></button>}
                        </article>
                      );
                    })}
                  </div>
                ) : <p className="ai-tutor__empty-filter" role="status">No lessons match “{sourceQuery.trim()}”.</p>}
              </>
            ) : <div className="ai-tutor__empty-source"><ShieldCheck size={20} aria-hidden="true" /><p>No library text will be included. The question and bounded recent conversation are still sent to your local model.</p></div>}
            {sourceWarning && <p className="ai-tutor__field-error" role="alert">{sourceWarning}</p>}
            {sourceMode !== "library-first" && <p className="ai-tutor__grounding-note">{selectedSources.length ? `Sources: ${selectedSources.map((source) => `[S${source.citationNumber}]`).join(", ")}.` : "No source text will be sent."}</p>}
          </div>
        </aside>}

        <section className="ai-tutor__conversation" aria-label="Conversation" ref={conversationRef} onScroll={(event) => {
          // Following only ever scrolls down, so any upward move (that is not
          // a shrinking answer clamping the position) is the learner reading
          // back: stop following. Returning near the end resumes it; content
          // that grew between a follow scroll and its event changes nothing.
          const surface = event.currentTarget;
          const top = surface.scrollTop;
          const end = surface.scrollHeight - surface.clientHeight;
          const previous = conversationScrollRef.current;
          conversationScrollRef.current = { top, height: surface.scrollHeight };
          // iOS rubber-banding reports positions well past either end;
          // settling back from past the end is not a move up.
          if (top < -1 || top > end + 1) return;
          if (top < Math.min(previous.top, end) - 1 && surface.scrollHeight >= previous.height) {
            if (followStreamRef.current) setFollowing(false);
            return;
          }
          if (end - top < 140 && !followStreamRef.current) setFollowing(true);
        }}>
          {setupRequired && <div className="ai-tutor__setup-card">
              {configState.status === "pairing" ? <LockKeyhole size={26} aria-hidden="true" /> : <ServerOff size={26} aria-hidden="true" />}
              <h3>{configState.status === "pairing" ? "Pair this browser to start" : "AI is not set up on this server"}</h3>
              <p>{configState.status === "pairing"
                ? "This server asks for a one-time code from its operator. Enter it above; this browser remembers the pairing."
                : "The host has not enabled the local model, so the Mac tutor cannot answer here. Your lessons, notes and reviews work as usual."}</p>
              {configState.status === "disabled" && onUseOnDevice && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={onUseOnDevice}><Cpu size={16} aria-hidden="true" /> Use On-device Lite instead</button>}
            </div>}
          {history.length === 0 && !activeResponse ? (setupRequired || (practiceVisible && practiceQuestion) ? null : (
            <div className={`ai-tutor__welcome${starters.length ? " has-starters" : ""}`}>
              <MessageCircleQuestion size={28} aria-hidden="true" />
              <h3>What would you like to learn?</h3>
              <p>{starters.length ? "Pick a suggested start or ask your own question." : "Ask a question or choose a study mode."}</p>
              {starters.length > 0 && (
                <div className="ai-tutor__starters" role="group" aria-labelledby={startersHeadingId}>
                  <h4 className="ai-tutor__starters-title" id={startersHeadingId}>Suggested starts</h4>
                  <ul>
                    {starters.map((starter) => (
                      <li key={starter.id}>
                        <button className="ai-tutor__starter" type="button" disabled={requestState.status === "loading"} onClick={() => chooseStarter(starter)}>
                          <span className="ai-tutor__starter-mode">{modeById(starter.modeId).label}</span>
                          <span className="ai-tutor__starter-title">{starter.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {pendingStarter && (
                    <div className="ai-tutor__starter-confirm" role="group" aria-label="Replace your unsent question?">
                      <p>Your unsent question is in the box. Replace it with “{pendingStarter.label}”?</p>
                      <div>
                        <button className="ai-tutor__button ai-tutor__button--secondary" type="button" ref={keepDraftRef} onClick={() => { setPendingStarter(null); window.setTimeout(focusComposer, 0); }}>Keep my draft</button>
                        <button className="ai-tutor__button ai-tutor__button--primary" type="button" onClick={() => applyStarter(pendingStarter)}>Replace draft</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )) : (
            <div className="ai-tutor__messages" role="group" aria-label="AI tutor conversation">
              {history.map((message, index) => {
                const titleId = `${headingId}-message-${index}`;
                const modeLabel = modeById(message.mode).label;
                // A session recap says which turns it covers.
                const recapLabel = message.role === "assistant" && message.mode === "summarize" ? wrapUpLabel(questionForAnswer(history, message.id)?.content) : "";
                return (
                  <Fragment key={message.id}>
                  {index === contextStart && index > 0 && contextBreak}
                  <article className={`ai-tutor__message ai-tutor__message--${message.role}`} data-message-id={message.id} tabIndex={message.role === "assistant" ? -1 : undefined} aria-labelledby={titleId}>
                    <h3 className="visually-hidden" id={titleId}>{message.role === "assistant" ? `Tutor answer, ${modeLabel}${message.incomplete ? ", stopped early" : ""}` : `Your question, ${modeLabel}`}</h3>
                    <div className="ai-tutor__message-meta"><strong>{message.role === "assistant" ? "Lumen Tutor" : "You"}</strong><span>{modeLabel}</span>{recapLabel && <span className="ai-tutor__recap-label">{recapLabel}</span>}{message.role === "assistant" && <span>{RESPONSE_PROFILES.find((item) => item.id === message.responseProfile)?.label || "Balanced"}</span>}{message.usage && <span>{message.usage.outputTokens.toLocaleString()} tokens</span>}{message.durationMs !== null && message.role === "assistant" && <span>{(message.durationMs / 1_000).toFixed(message.durationMs < 10_000 ? 1 : 0)}s</span>}{message.incomplete && <span className="is-warning">Stopped early</span>}{message.truncated && <span className="is-warning">Display capped</span>}{message.role === "assistant" && <WebFallbackBadge status={message.webFallbackStatus} />}</div>
                    {message.role === "assistant"
                      ? <AssistantMessage message={message} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} study={studyFor(message)} />
                      : <p className="ai-tutor__user-prompt">{message.content}</p>}
                    <MessageActions message={message} requestBusy={requestState.status === "loading"} onNavigateSource={onNavigateSource} onPrepareRegenerate={prepareRegenerate} onReusePrompt={(request) => preparePrompt(request, reuseNotice)} onSaveAnswerNote={onSaveAnswerNote} listen={listenFor(message)} />
                    {(() => {
                      // A follow-up sends its answer as memory, so an answer
                      // from before a long break (below the divider's "not
                      // sent") offers none.
                      const followUps = followUpsForMessage(message, { isLast: index === history.length - 1 && index >= contextStart });
                      return followUps.length > 0 && <FollowUps items={followUps} disabled={requestState.status === "loading"} onChoose={(item) => runFollowUp(message, item)} />;
                    })()}
                  </article>
                  </Fragment>
                );
              })}
              {contextStart > 0 && contextStart === history.length && contextBreak}
              {activeResponse && (
                <article className="ai-tutor__message ai-tutor__message--assistant ai-tutor__message--streaming" aria-busy="true" tabIndex={-1} aria-label="Tutor answer, in progress" ref={streamingArticleRef}>
                  <div className="ai-tutor__message-meta"><strong>Lumen Tutor</strong><span>{modeById(activeResponse.mode).label}</span><span>{RESPONSE_PROFILES.find((item) => item.id === activeResponse.responseProfile)?.label || "Balanced"}</span><span className="ai-tutor__live-badge"><i aria-hidden="true" /> Live</span><WebFallbackBadge status={activeResponse.webFallbackStatus} /></div>
                  <div className={`ai-tutor__stream-status${progressSteps.length ? " has-progress" : ""}`}><span>{activeResponse.stage || "Generating response…"}</span><small aria-hidden="true">{requestElapsed}s</small></div>
                  {progressSteps.length > 0 && (
                    <ol className="ai-tutor__progress" aria-label="Answer progress">
                      {progressSteps.map((step) => (
                        <li className={`is-${step.state}`} key={step.id}>
                          <span className="ai-tutor__progress-mark" aria-hidden="true">{step.state === "done" ? <Check size={13} /> : step.state === "active" ? <LoaderCircle className="ai-tutor__spin" size={13} /> : null}</span>
                          {step.label}<span className="visually-hidden">{{ done: ", done", active: ", in progress", skipped: ", skipped" }[step.state] || ""}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {progressSteps.length > 0 && activeResponse.citationSources.length > 0 && (
                    <ul className="ai-tutor__progress-sources" aria-label="Sources for this answer">
                      {activeResponse.citationSources.slice(0, 4).map((source) => <li key={source.id}><span>[S{source.citationNumber}]</span> {source.title}</li>)}
                      {activeResponse.citationSources.length > 4 && <li>+{activeResponse.citationSources.length - 4} more</li>}
                    </ul>
                  )}
                  {activeResponse.content
                    ? <AssistantMessage message={activeResponse} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} streaming />
                    : progressSteps.length === 0 && <div className="ai-tutor__response-skeleton" aria-hidden="true"><i /><i /><i /></div>}
                  {/* While the steps describe the wait, a status line would repeat them. */}
                  {(activeResponse.content || progressSteps.length === 0) && <div className="ai-tutor__stream-actions"><span>{activeResponse.content
                    ? `${activeResponse.content.length.toLocaleString()} characters received`
                    : activeResponse.sourceMode === "none" && !["searching", "used"].includes(activeResponse.webFallbackStatus)
                      ? "Waiting for the first token…"
                      : "Preparing your answer and checking sources…"}</span></div>}
                </article>
              )}
            </div>
          )}
          {practiceCard}
          {requestNotice}
          <div className="ai-tutor__conversation-end" ref={conversationEndRef} aria-hidden="true" />
        </section>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement.text}{announcement.id % 2 ? " " : ""}</p>

      <form className={`ai-tutor__composer${setupRequired ? " is-collapsed" : ""}`} onSubmit={submit} ref={composerRef} aria-label="Ask the tutor">
        {jumpLabel && <button className="ai-tutor__jump" type="button" onClick={jumpToLatest}><ArrowDown size={16} aria-hidden="true" /> {jumpLabel}</button>}
        {composerNotice && <p className="ai-tutor__composer-notice" role="status">{composerNotice}</p>}
        {pendingPrefill && (
          <div className="ai-tutor__prefill-confirm" role="group" aria-label="Replace your unsent question?">
            <p>{prefillOrigin(pendingPrefill)} Your unsent question is in the box. Replace it?</p>
            <div>
              <button className="ai-tutor__button ai-tutor__button--secondary" type="button" ref={keepPrefillDraftRef} onClick={() => { setPendingPrefill(null); setComposerNotice(`Your draft was kept; the question from the ${pendingPrefill.origin || "other screen"} was not added.`); window.setTimeout(focusComposer, 0); }}>Keep my draft</button>
              <button className="ai-tutor__button ai-tutor__button--primary" type="button" onClick={() => applyPrefill(pendingPrefill)}>Replace draft</button>
            </div>
          </div>
        )}
        {/* The one-time local-model disclosure stays in the composer, never
            only in the options sheet, until it is acknowledged. */}
        {!setupRequired && !localDisclosureAcknowledged && (
          <div className="ai-tutor__consent-card">
            <label className="ai-tutor__consent"><input type="checkbox" checked={false} onChange={(event) => { const acknowledged = event.target.checked; setLocalDisclosureAcknowledged(acknowledged); rememberLocalDisclosureAcknowledgement(acknowledged); }} /><span>Allow prompts and attached notes to use the local model on your Mac. Remember on this browser.</span></label>
          </div>
        )}
        {sessionStrip && (
          <div className="ai-tutor__session" role="group" aria-labelledby={sessionTitleId}>
            <p className="ai-tutor__session-status" id={sessionTitleId}>
              <strong>{modeById(sessionStrip.mode).label} session</strong> · question {sessionStrip.questions}
              {sessionStrip.revealed && <> <span className="ai-tutor__session-revealed"><span className="visually-hidden">· </span>Answer revealed</span></>}
              {sessionStrip.suggestWrapUp && <span className="ai-tutor__session-tip"> · time to wrap up</span>}
            </p>
            <div className="ai-tutor__session-actions">
              {sessionStrip.revealed
                ? <button type="button" disabled={requestState.status === "loading"} onClick={() => runSessionAction("next")}>Next question</button>
                : <>
                  {/* Phones keep the three actions on one row. */}
                  <button type="button" disabled={requestState.status === "loading"} onClick={() => runSessionAction("hint")}>{compactModes ? "Hint" : "Give me a hint"}</button>
                  <button type="button" disabled={requestState.status === "loading"} onClick={() => runSessionAction("reveal")}>{compactModes ? "I’m stuck" : "I’m stuck, explain it"}</button>
                </>}
              <button type="button" className={sessionStrip.suggestWrapUp ? "is-suggested" : undefined} disabled={requestState.status === "loading"} onClick={() => runSessionAction("wrap-up")}>Wrap up</button>
            </div>
          </div>
        )}
        {/* The question box stays in setup states so a draft or an Ask AI
            excerpt is kept for when the tutor becomes available. */}
        <label className="ai-tutor__prompt-label" htmlFor={promptId}>{answering ? "Your answer" : "Your question"}</label>
        <div className="ai-tutor__submit-row">
          <textarea ref={promptRef} id={promptId} value={prompt} aria-describedby={`${counterId} ${sendReasonId}${keyHint ? ` ${keyHintId}` : ""}`} aria-invalid={promptTooLong || requestTooLarge || undefined} onChange={(event) => { setPrompt(event.target.value); outboundChanged(); }} onKeyDown={onPromptKeyDown} maxLength={promptLimit} rows={1} placeholder={answering ? "Type your answer…" : "Ask a question…"} />
          {requestState.status === "loading" ? (
            <button
              className="ai-tutor__button ai-tutor__button--secondary ai-tutor__send is-stop"
              type="button"
              ref={sendButtonRef}
              onClick={(event) => {
                // Stopping re-renders this button as Send before the click's
                // default action runs; cancel it so Stop never re-sends.
                event.preventDefault();
                // A second tap of a double tap on Send is not a Stop.
                if (event.detail > 0 && (globalThis.performance?.now?.() ?? Date.now()) - requestStartedAtRef.current < 500) return;
                requestControllerRef.current?.abort();
              }}
            ><CircleStop size={18} aria-hidden="true" /><span className="ai-tutor__send-label">Stop generating</span></button>
          ) : (
            <button className="ai-tutor__button ai-tutor__button--primary ai-tutor__send" type="submit" ref={sendButtonRef} disabled={!requestReady} aria-describedby={`${sendSummaryId} ${sendReasonId}`}><Send size={18} aria-hidden="true" /><span className="ai-tutor__send-label">{answering ? "Send answer" : `Generate ${currentMode.label}`}</span></button>
          )}
        </div>
        <div className="ai-tutor__composer-meta">
          {!setupRequired && <button className="ai-tutor__options-toggle" type="button" aria-haspopup="dialog" aria-expanded={optionsOpen} aria-describedby={optionsSummary ? optionsSummaryId : undefined} onClick={() => setOptionsOpen(true)}><SlidersHorizontal size={16} aria-hidden="true" /> Options{optionsSummary && <span className="ai-tutor__options-summary" id={optionsSummaryId}>{optionsSummary}</span>}</button>}
          {!setupRequired && !localDisclosureAcknowledged && <button type="button" className="ai-tutor__text-button" onClick={() => { setPrivacyOpen(true); setOptionsOpen(true); }}>What is sent?</button>}
          {!setupRequired && effectiveWebSearch && <WebFallbackBadge status="armed" />}
          {keyHint && <span className="ai-tutor__key-hint" id={keyHintId}>{keyHint}</span>}
          <span className="ai-tutor__character-count" id={counterId}>{prompt.trim().length.toLocaleString()} / {promptLimit.toLocaleString()}<span className="visually-hidden"> characters</span></span>
        </div>
        <span className="visually-hidden" id={sendSummaryId}>{effectiveWebSearch ? "Sends to the local model on the Lumen server, with current-web fallback allowed for this request." : "Sends to the local model on the Lumen server. Web fallback is off."}</span>
        <p className={`ai-tutor__disabled-reason${quietReason ? " is-quiet" : ""}`} id={sendReasonId} role="status">{disabledReason}</p>
      </form>

      <TutorSheet
        open={optionsOpen && !setupRequired}
        title="Request options"
        description="Depth, answer length, web fallback and privacy for your next question."
        closeLabel="Close request options"
        className="ai-tutor-sheet"
        onClose={() => setOptionsOpen(false)}
      >
        <div className="ai-tutor__composer-row">
          <label className="ai-tutor__difficulty"><span>Depth</span><select value={difficulty} disabled={requestState.status === "loading"} onChange={(event) => { setDifficulty(event.target.value); outboundChanged(); }}>{DIFFICULTIES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <span className="ai-tutor__model">{configState.config?.model ? `Local model: ${configState.config.model}` : "Local model is host-managed"}</span>
        </div>
        <fieldset className="ai-tutor__response-profiles" disabled={requestState.status === "loading"}>
          <legend>Response</legend>
          <div>{RESPONSE_PROFILES.map((item) => {
            const unavailable = item.id === "deep" && !deepProfileAvailable;
            return <label className={`${responseProfile === item.id ? "is-active" : ""}${unavailable ? " is-unavailable" : ""}`} key={item.id}><input type="radio" name={`${headingId}-response-profile`} value={item.id} checked={responseProfile === item.id} disabled={unavailable} onChange={() => { setResponseProfile(item.id); outboundChanged(); }} /><span><strong>{item.label}</strong><small>{unavailable ? "Requires a local model that attests thinking support" : item.detail}</small></span></label>;
          })}</div>
        </fieldset>
        <label className={`ai-tutor__web-search ${effectiveWebSearch ? "is-enabled" : ""}`}><input type="checkbox" checked={effectiveWebSearch} disabled={!webSearchAvailable || !libraryWebEligible || requestState.status === "loading"} onChange={(event) => changeWebSearch(event.target.checked)} /><span><strong>Allow current-web fallback for this request</strong><small>{!libraryWebEligible ? "Select Library first to use web fallback." : webSearchAvailable ? "Searches only when needed. Queries go to public search engines." : configState.config?.service?.toolCallingCapable === false ? "This model does not support web search." : configState.config?.webSearch?.configured ? "Search is offline. Start SearXNG on your Mac, then refresh." : "Web search is not configured."}</small></span></label>
        {localDisclosureAcknowledged
          ? <div className="ai-tutor__consent ai-tutor__consent--acknowledged"><ShieldCheck size={18} aria-hidden="true" /><span>Local model enabled</span><button type="button" className="ai-tutor__text-button" onClick={() => { rememberLocalDisclosureAcknowledgement(false); setLocalDisclosureAcknowledged(false); setPrivacyOpen(true); }}>Review again</button></div>
          : <p className="ai-tutor__consent-note">Tick the local-model permission under your question to enable sending.</p>}
        <div className="ai-tutor__privacy">
          <button className="ai-tutor__privacy-toggle" type="button" aria-expanded={privacyOpen} onClick={() => setPrivacyOpen((open) => !open)}><span><LockKeyhole size={18} aria-hidden="true" /><strong>Privacy and request details</strong></span><ChevronDown size={18} aria-hidden="true" /></button>
          {privacyOpen && <div className="ai-tutor__privacy-body">
            <p><strong>Model destination:</strong> {AI_DATA_DISCLOSURE.destination}. The browser calls only Lumen’s same-origin server; no paid-provider key is accepted or exposed here.</p>
            {effectiveWebSearch && <p><strong>Consented web fallback:</strong> {AI_DATA_DISCLOSURE.webSearch.destination} Local-library retrieval runs first. Only when it recommends fallback may Lumen send up to {configState.config?.webSearch?.maxRounds || 1} focused queries derived from this prompt, selected context, and bounded history. If the local model skips its required tool call, the server uses a bounded form of your question so the authorized fallback still runs. Query text is sent without a separate preview in Mac-local mode. Use On-device Lite when you need to approve the exact query first.</p>}
            {responseProfile === "deep" && <p><strong>Deep response:</strong> The local model may use private internal thinking to plan a stronger answer. That private thinking is never returned to this UI, saved in history, or shown by the Approach toggle; Approach contains only disclosure-safe orchestration and evidence metadata.</p>}
            <div className="ai-tutor__disclosure-grid">
              <div><h4>This request sends to the local model</h4><ul><li>Your {prompt.trim().length.toLocaleString()}-character prompt</li><li>Difficulty: {DIFFICULTIES.find((item) => item.id === difficulty)?.label}</li><li>Response profile: {RESPONSE_PROFILES.find((item) => item.id === responseProfile)?.label} (up to {selectedMaxOutputTokens.toLocaleString()} output tokens)</li><li>Grounding: {SOURCE_MODES.find((item) => item.id === sourceMode)?.label}</li><li>{selectedSources.length ? `${selectedSources.length} prepared source${selectedSources.length === 1 ? "" : "s"}: ${selectedSources.map((source) => `[S${source.citationNumber}] ${source.title}`).join(", ")}` : "No curriculum source text is currently prepared"}{contextPreview.length > 0 ? ` (${contextPreview.length.toLocaleString()} source characters prepared)` : ""}</li><li>{outboundHistory.length} recent conversation message{outboundHistory.length === 1 ? "" : "s"} (maximum {MAX_SERVER_HISTORY}){conversationWindow.compactedMessages ? `; ${conversationWindow.compactedMessages} older messages form a visible bounded memory` : ""}{contextStart > 0 ? `; ${contextStart} earlier message${contextStart === 1 ? "" : "s"} from before a break of more than 3 hours ${contextStart === 1 ? "is" : "are"} not sent` : ""}</li><li>A fixed grounding instruction requiring valid [S#] citations</li><li>Web fallback: {effectiveWebSearch ? "consented; used only when local retrieval recommends it" : "off"}</li></ul></div>
              <div><h4>This client does not send</h4><ul>{AI_DATA_DISCLOSURE.neverSentByThisClient.map((item) => <li key={item}>{item}</li>)}</ul></div>
            </div>
            <p className="ai-tutor__retention"><ShieldCheck size={16} aria-hidden="true" />The Lumen server reports no prompt or response storage and no paid remote-model API. {effectiveWebSearch ? "Search engines can observe the search query and ordinary request metadata according to their own policies. " : "No web-search service is contacted for this request. "}{onHistoryChange ? `This app saves up to ${MAX_VISIBLE_HISTORY} normalized tutor messages and web-source links locally and includes them in exported backups. Full source text and search-result bodies are not duplicated in that history. Use “New topic” in the tutor header to clear it, with an option to export it first.` : "Conversation history stays only in this component for the current visit."}</p>
            {providerControlsUrl && <a href={providerControlsUrl} target="_blank" rel="noreferrer">Review provider data controls <ExternalLink size={13} aria-hidden="true" /></a>}
          </div>}
        </div>
      </TutorSheet>

      {/* New topic (TFEAT-13, interim): one conversation, so starting fresh
          clears it; exporting first keeps a full copy. */}
      <TutorConfirmDialog
        open={confirmClearOpen}
        title="Start a new topic?"
        body="This clears the saved tutor conversation on this device so the tutor starts fresh. Export it first to keep a copy. Your lessons, notes and review cards are not deleted."
        secondaryLabel="Export, then clear"
        onSecondary={() => { exportConversation(); confirmClear(); }}
        confirmLabel="Clear conversation"
        onConfirm={confirmClear}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </section>
  );
}

export { AI_DATA_DISCLOSURE, DIFFICULTIES as AI_TUTOR_DIFFICULTIES, MODE_OPTIONS as AI_TUTOR_MODES };
