import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  ExternalLink,
  FileQuestion,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AI_DATA_DISCLOSURE,
  AiClientError,
  aiRequestUtf8Bytes,
  aiClient,
} from "../lib/aiClient";
import { AI_REQUEST_CONTRACT_ID } from "../lib/aiContract";
import { buildConversationWindow } from "../lib/conversationMemory";
import { fitAiRequestContext } from "../lib/aiRequestBudget";
import { renderTutorMarkdown, tutorMarkdownPlainText } from "../lib/tutorMarkdown";
import { buildTutorContext, outputTokensForProfile, retrievalTraceCounts, shouldUseWebFallback } from "../lib/tutorGrounding";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import "../ai-tutor.css";

const MODE_OPTIONS = Object.freeze([
  {
    id: "explain",
    label: "Explain",
    task: "explain",
    prompt: "Explain the three most important ideas clearly, from intuition to mechanics. Use well-structured Markdown, include only the most useful formula or pseudocode and one concrete example, then finish with concise failure modes and interview takeaways. Prioritize a complete answer over exhaustive coverage and stay within the selected response profile.",
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
    prompt: "Create a source-grounded quiz that tests recall, application, misconceptions, and production reasoning.",
    description: "Generate a validated interactive quiz with teaching explanations.",
    structured: true,
  },
  {
    id: "flashcards",
    label: "Flashcards",
    task: "flashcards",
    prompt: "Create atomic active-recall flashcards from the selected material. Prefer reasoning and application over copied definitions.",
    description: "Generate validated drafts and choose which cards enter your review deck.",
    structured: true,
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
    prompt: "Create a dependency-aware study plan for mastering the selected material, with realistic activities and observable evidence of mastery.",
    description: "Generate milestones, time estimates, activities, and mastery evidence.",
    structured: true,
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
const MAX_WEB_SOURCES = 8;
const MAX_VISIBLE_HISTORY = 50;
const MAX_SERVER_HISTORY = 12;
const MAX_HISTORY_MESSAGE_CHARS = 3_000;
const MAX_PROMPT_CHARS = 5_700;
const MAX_RESPONSE_CHARS = 160_000;
const LOCAL_DISCLOSURE_ACKNOWLEDGEMENT_KEY = "lumen.ai.local-disclosure-ack.v1";
const CITATION_PATTERN = /(\[(?:S|W)\d+\])/g;
const CITATION_EXACT_PATTERN = /^\[([SW])(\d+)\]$/;
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

const minimumContextBudget = (sources) => sources.reduce(
  (total, source) => total + source.title.length + source.section.length + 24 + 180,
  0,
);

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

const modeById = (id) => MODE_OPTIONS.find((mode) => mode.id === id) || MODE_OPTIONS[0];

const InlineCitations = ({ text, citationSources = [], webSources = [], onNavigateSource }) => {
  const sourceMap = useMemo(() => new Map(
    citationSources.map((source) => [`[S${source.citationNumber}]`, source]),
  ), [citationSources]);
  const webSourceMap = useMemo(() => new Map(
    webSources.map((source, index) => [`[W${Number.isSafeInteger(source?.index) ? source.index : index + 1}]`, source]),
  ), [webSources]);
  const parts = String(text || "").split(CITATION_PATTERN);
  return parts.map((part, index) => {
    const citation = part.match(CITATION_EXACT_PATTERN);
    if (!citation) return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
    if (citation[1] === "W") {
      const webSource = webSourceMap.get(part);
      if (!webSource) return <span className="ai-tutor__citation ai-tutor__citation--missing" title="The response cited web evidence that was not supplied" key={`${part}-${index}`}>{part}</span>;
      return <a className="ai-tutor__citation" href={webSource.url} target="_blank" rel="noopener noreferrer" title={`Open ${webSource.title}`} aria-label={`Open web citation ${part}: ${webSource.title}`} key={`${part}-${index}`}>{part}</a>;
    }
    const source = sourceMap.get(part);
    if (!source) return <span className="ai-tutor__citation ai-tutor__citation--missing" title="The response cited a source that was not supplied" key={`${part}-${index}`}>{part}</span>;
    return (
      <button
        className="ai-tutor__citation"
        type="button"
        title={`Open ${source.title}`}
        aria-label={`Open citation ${part}: ${source.title}`}
        onClick={() => onNavigateSource?.(source.original, { citation: part, sourceId: source.id })}
        key={`${part}-${index}`}
      >
        {part}
      </button>
    );
  });
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
  // Partial fenced blocks are ordinary during token streaming. Rendering is
  // intentionally deferred until the validated terminal answer is mounted.
  useMermaidDiagrams(responseRef, { contentKey: html, enabled: !streaming });
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
      // renderTutorMarkdown sanitizes provider output through DOMPurify.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const QuizResult = ({ quiz, messageId, citationSources, webSources, onNavigateSource }) => {
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});
  return (
    <div className="ai-tutor__quiz">
      <div className="ai-tutor__result-title"><FileQuestion size={20} aria-hidden="true" /><div><h4>{quiz.title}</h4><p>{quiz.instructions}</p></div></div>
      {quiz.questions.map((question, questionIndex) => {
        const chosen = answers[question.id];
        const revealed = checked[question.id];
        const correct = chosen === question.correctIndex;
        return (
          <fieldset className="ai-tutor__quiz-question" key={question.id}>
            <legend><span>{questionIndex + 1}</span><InlineCitations text={question.prompt} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></legend>
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
                      onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
            {!revealed ? (
              <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={!Number.isSafeInteger(chosen)} onClick={() => setChecked((current) => ({ ...current, [question.id]: true }))}>Check answer</button>
            ) : (
              <div className={correct ? "ai-tutor__quiz-feedback is-correct" : "ai-tutor__quiz-feedback is-incorrect"} role="status">
                <strong>{correct ? "Correct" : `Not quite — answer ${question.correctIndex + 1} is correct.`}</strong>
                <p><InlineCitations text={question.explanation} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p>
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
};

const FlashcardResult = ({ cards, message, onCreateFlashcardDrafts, onNavigateSource }) => {
  const [selected, setSelected] = useState(() => cards.map((_, index) => index));
  const [expanded, setExpanded] = useState({});
  const [draftState, setDraftState] = useState({ status: "idle", message: "" });
  const selectionSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (index) => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((a, b) => a - b));
  const createDrafts = async () => {
    if (!onCreateFlashcardDrafts || !selected.length || draftState.status === "saving") return;
    setDraftState({ status: "saving", message: "Adding selected drafts…" });
    try {
      const chosenCards = selected.map((index) => cards[index]).map((card) => ({
        type: "basic",
        front: card.front.trim(),
        back: card.back.trim(),
        hint: card.hint?.trim() || null,
        tags: [...new Set(card.tags.map((tag) => tag.trim()).filter(Boolean))],
      }));
      await onCreateFlashcardDrafts(chosenCards, {
        requestId: message.requestId,
        mode: message.mode,
        sourceIds: message.citationSources.map((source) => source.id),
        webSources: message.webSources.map(({ title, url }) => ({ title, url })),
      });
      setDraftState({ status: "saved", message: `${chosenCards.length} flashcard draft${chosenCards.length === 1 ? "" : "s"} added for review.` });
    } catch {
      setDraftState({ status: "error", message: "The drafts could not be added. Your selection is still here; try again." });
    }
  };
  return (
    <div className="ai-tutor__flashcards">
      <div className="ai-tutor__flashcard-actions">
        <p><strong>{selected.length}</strong> of {cards.length} selected</p>
        <button className="ai-tutor__text-button" type="button" onClick={() => setSelected(selected.length === cards.length ? [] : cards.map((_, index) => index))}>{selected.length === cards.length ? "Clear all" : "Select all"}</button>
      </div>
      {cards.map((card, index) => (
        <article className={`ai-tutor__flashcard ${selectionSet.has(index) ? "is-selected" : ""}`} key={`${message.id}-card-${index}`}>
          <label className="ai-tutor__flashcard-select">
            <input type="checkbox" checked={selectionSet.has(index)} onChange={() => toggle(index)} />
            <span>Select card {index + 1}</span>
          </label>
          <span className="ai-tutor__flashcard-side">Prompt</span>
          <p><InlineCitations text={card.front} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} /></p>
          <button className="ai-tutor__text-button" type="button" aria-expanded={Boolean(expanded[index])} onClick={() => setExpanded((current) => ({ ...current, [index]: !current[index] }))}>{expanded[index] ? "Hide answer" : "Reveal answer"}<ChevronDown size={16} aria-hidden="true" /></button>
          {expanded[index] && <div className="ai-tutor__flashcard-answer"><span className="ai-tutor__flashcard-side">Answer</span><p><InlineCitations text={card.back} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} /></p>{card.hint && <p className="ai-tutor__hint"><strong>Hint:</strong> {card.hint}</p>}</div>}
          {card.tags.length > 0 && <div className="ai-tutor__tags" aria-label="Suggested tags">{card.tags.map((tag, tagIndex) => <span key={`${tagIndex}-${tag}`}>{tag}</span>)}</div>}
        </article>
      ))}
      {onCreateFlashcardDrafts ? <button className="ai-tutor__button ai-tutor__button--primary" type="button" disabled={!selected.length || draftState.status === "saving"} onClick={createDrafts}>{draftState.status === "saving" ? <LoaderCircle className="ai-tutor__spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />} Add selected to review</button> : <p className="ai-tutor__muted">Flashcard drafts are ready. Connect the review-deck callback to save them.</p>}
      {draftState.message && <p className={`ai-tutor__draft-status is-${draftState.status}`} role="status">{draftState.message}</p>}
    </div>
  );
};

const StudyPlanResult = ({ plan, citationSources, webSources, onNavigateSource }) => (
  <div className="ai-tutor__study-plan">
    <div className="ai-tutor__result-title"><Sparkles size={20} aria-hidden="true" /><div><h4>{plan.title}</h4><p><InlineCitations text={plan.goal} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p></div></div>
    <ol>
      {plan.milestones.map((milestone, index) => (
        <li key={`${milestone.title}-${index}`}>
          <div className="ai-tutor__milestone-head"><span>{index + 1}</span><div><h5>{milestone.title}</h5><small>{milestone.estimatedMinutes} minutes</small></div></div>
          <p><InlineCitations text={milestone.outcome} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p>
          <ul>{milestone.activities.map((activity, activityIndex) => <li key={`${activityIndex}-${activity}`}><InlineCitations text={activity} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></li>)}</ul>
          <p className="ai-tutor__mastery"><strong>Evidence of mastery:</strong> <InlineCitations text={milestone.evidenceOfMastery} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></p>
        </li>
      ))}
    </ol>
    {plan.cautions.length > 0 && <div className="ai-tutor__cautions"><strong>Watch for</strong><ul>{plan.cautions.map((caution, cautionIndex) => <li key={`${cautionIndex}-${caution}`}><InlineCitations text={caution} citationSources={citationSources} webSources={webSources} onNavigateSource={onNavigateSource} /></li>)}</ul></div>}
  </div>
);

const AssistantMessage = ({ message, onCreateFlashcardDrafts, onNavigateSource, streaming = false }) => {
  if (message.mode === "quiz" && validateTutorQuiz(message.data)) return <QuizResult quiz={message.data} messageId={message.id} citationSources={message.citationSources} webSources={message.webSources} onNavigateSource={onNavigateSource} />;
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
  "AI_CONTEXT_LIMIT",
  "AI_INPUT_TOO_LARGE",
  "AI_NETWORK_ERROR",
  "AI_UNAVAILABLE",
  "AI_LOCAL_MODEL_UNAVAILABLE",
  "AI_MODEL_NOT_FOUND",
  "AI_MODEL_IDENTITY_UNVERIFIED",
]);

const ResponseEvidence = ({ message, onNavigateSource }) => (
  <div className="ai-tutor__evidence" aria-label="Evidence attached to this response">
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

const MessageActions = ({ message, onNavigateSource, onPrepareRegenerate, onReusePrompt, requestBusy = false }) => {
  const [panel, setPanel] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");
  const hasEvidence = message.citationSources.length > 0 || message.webSources.length > 0;
  const copyMessage = async () => {
    const copied = await copyPlainText(message.role === "assistant" ? tutorMarkdownPlainText(message.content) : message.content);
    setCopyStatus(copied ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 1_800);
  };
  const togglePanel = (next) => setPanel((current) => current === next ? "" : next);
  return (
    <>
      <div className="ai-tutor__message-actions" aria-label={`${message.role === "assistant" ? "Response" : "Request"} actions`}>
        <button type="button" onClick={copyMessage} aria-label={`Copy ${message.role === "assistant" ? "response" : "request"}`}>
          {copyStatus === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy"}
        </button>
        {message.role === "user" && <button type="button" disabled={requestBusy} onClick={() => onReusePrompt?.(message)}><RotateCcw size={15} aria-hidden="true" /> Edit & reuse</button>}
        {message.role === "assistant" && <button type="button" disabled={requestBusy} onClick={() => onPrepareRegenerate?.(message)}><RotateCcw size={15} aria-hidden="true" /> Regenerate</button>}
        {message.role === "assistant" && hasEvidence && <button type="button" aria-expanded={panel === "sources"} onClick={() => togglePanel("sources")}><BookOpen size={15} aria-hidden="true" /> Sources <span>{message.citationSources.length + message.webSources.length}</span></button>}
        {message.role === "assistant" && <button type="button" aria-expanded={panel === "approach"} onClick={() => togglePanel("approach")}><Sparkles size={15} aria-hidden="true" /> Approach</button>}
      </div>
      <span className="ai-tutor__copy-status" role="status" aria-live="polite">{copyStatus === "copied" ? `${message.role === "assistant" ? "Response" : "Request"} copied.` : copyStatus === "error" ? "Copy failed. Select the text and copy it manually." : ""}</span>
      {panel === "sources" && <ResponseEvidence message={message} onNavigateSource={onNavigateSource} />}
      {panel === "approach" && <ResponseApproach message={message} />}
    </>
  );
};

/**
 * Secure learner-facing AI workspace.
 *
 * Props:
 * - sources: [{ id, title, section?, text|content|excerpt, selected? }]
 * - initialMode / initialPrompt / initialDifficulty: optional starting state
 * - initialHistory / historyTombstones / onHistoryChange: optional parent-owned local persistence
 * - onNavigateSource(source, { citation, sourceId }): opens an exact cited source
 * - onCreateFlashcardDrafts(cards, metadata): persists learner-selected drafts
 * - retrieveLibrary(query, options): optional local retrieval adapter
 * - onClose: optional close action for hosts that show the tutor as a panel
 *
 * The component intentionally has no API-key or model-selection prop. Requests
 * always use the fixed same-origin client boundary in src/lib/aiClient.js.
 */
export default function AiTutor({
  sources = [],
  initialMode = "explain",
  initialPrompt = "",
  initialDifficulty = "intermediate",
  initialHistory = [],
  historyTombstones = [],
  onHistoryChange,
  onNavigateSource,
  onCreateFlashcardDrafts,
  retrieveLibrary,
  onClose,
  className = "",
}) {
  const headingId = useId();
  const promptId = useId();
  const privacyId = useId();
  const sendReasonId = useId();
  const sourceNumbersRef = useRef(new Map());
  const nextSourceNumberRef = useRef(1);
  const requestControllerRef = useRef(null);
  const lastRequestRef = useRef(null);
  const responseEndRef = useRef(null);
  const conversationRef = useRef(null);
  const followStreamRef = useRef(true);
  const promptRef = useRef(null);
  const activeResponseRef = useRef(null);
  const streamFrameRef = useRef(0);
  const initialModeOption = modeById(initialMode);
  const [modeId, setModeId] = useState(initialModeOption.id);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.some((item) => item.id === initialDifficulty) ? initialDifficulty : "intermediate");
  const [responseProfile, setResponseProfile] = useState("balanced");
  const [prompt, setPrompt] = useState(() => asTrimmedString(initialPrompt, MAX_PROMPT_CHARS) || initialModeOption.prompt);
  const initialTombstones = new Set((Array.isArray(historyTombstones) ? historyTombstones : []).filter((id) => typeof id === "string"));
  const [history, setHistory] = useState(() => normalizeHistory(initialHistory).filter((message) => !initialTombstones.has(message.id)));
  const [selectedSourceIds, setSelectedSourceIds] = useState(() => initiallySelectedSourceIds(sources));
  const [sourceMode, setSourceMode] = useState("library-first");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [localDisclosureAcknowledged, setLocalDisclosureAcknowledged] = useState(readLocalDisclosureAcknowledgement);
  const [privacyOpen, setPrivacyOpen] = useState(true);
  const [configState, setConfigState] = useState({ status: "checking", config: null, message: "Checking secure AI configuration…" });
  const [configAttempt, setConfigAttempt] = useState(0);
  const [requestState, setRequestState] = useState({ status: "idle", error: null });
  const [activeResponse, setActiveResponse] = useState(null);
  const [requestElapsed, setRequestElapsed] = useState(0);
  const [composerNotice, setComposerNotice] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const currentMode = modeById(modeId);
  const tombstoneSignature = useMemo(() => JSON.stringify((Array.isArray(historyTombstones) ? historyTombstones : []).filter((id) => typeof id === "string").slice(-1_000).sort()), [historyTombstones]);
  const tombstoneIds = useMemo(() => new Set(JSON.parse(tombstoneSignature)), [tombstoneSignature]);
  const normalizedExternalHistory = useMemo(() => normalizeHistory(initialHistory).filter((message) => !tombstoneIds.has(message.id)), [initialHistory, tombstoneIds]);
  const externalHistorySignature = useMemo(() => historySignature(normalizedExternalHistory), [normalizedExternalHistory]);

  const normalizedSources = useMemo(() => {
    const seen = new Set();
    return sources.flatMap((source, index) => {
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
  }, [sources]);

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

  useEffect(() => {
    if (configState.config?.webSearch?.macToolAvailable !== true) setWebSearch(false);
  }, [configState.config?.webSearch?.macToolAvailable]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    if (streamFrameRef.current) cancelAnimationFrame(streamFrameRef.current);
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

  const historyRef = useRef(history);
  historyRef.current = history;
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
  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    if (!query) return normalizedSources;
    return normalizedSources.filter((source) => `${source.title} ${source.section}`.toLocaleLowerCase().includes(query));
  }, [normalizedSources, sourceQuery]);
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

  const configuredInputLimit = configState.config?.limits?.maxInputChars;
  const configuredRequestByteLimit = configState.config?.responseProfiles?.maxRequestUtf8Bytes?.[responseProfile]
    ?? configState.config?.limits?.profileMaxRequestUtf8Bytes?.[responseProfile]
    ?? configState.config?.limits?.maxRequestUtf8Bytes;
  const inputLimit = Number.isSafeInteger(configuredInputLimit) && configuredInputLimit >= 2_000 && configuredInputLimit <= 100_000
    ? Math.min(configuredInputLimit, configuredRequestByteLimit || configuredInputLimit)
    : 16_000;
  const promptLimit = Math.min(MAX_PROMPT_CHARS, Math.max(800, Math.floor(inputLimit * 0.48)));
  const promptForSources = useCallback((promptText, sourceSnapshot) => {
    const citationInstruction = sourceSnapshot.length
      ? "Use the supplied [S#] labels to cite every source-grounded claim. Do not cite a label that was not supplied."
      : "No relevant library evidence was supplied. Clearly label claims that rely on general knowledge or attached web evidence.";
    return `${promptText.trim()}\n\n${citationInstruction}`;
  }, []);
  const outboundPrompt = promptForSources(prompt, selectedSources);
  const reservedContext = selectedSources.length ? Math.min(4_000, Math.max(600, Math.floor(inputLimit * 0.35))) : 0;
  const historyBudget = Math.max(0, Math.min(
    Math.floor(inputLimit * 0.25),
    inputLimit - outboundPrompt.length - reservedContext - 300,
  ));
  const conversationWindow = useMemo(() => buildConversationWindow(history, {
    maxMessages: MAX_SERVER_HISTORY,
    characterBudget: historyBudget,
    maxMessageCharacters: MAX_HISTORY_MESSAGE_CHARS,
    summaryBudget: Math.min(2_400, Math.max(800, Math.floor(inputLimit * 0.12))),
  }), [history, historyBudget, inputLimit]);
  const outboundHistory = conversationWindow.messages;
  // Small local models become unreliable when an open-ended answer competes
  // with a large source excerpt. Each mode may therefore publish a stricter
  // working-set limit than the server's absolute safety ceiling. The default
  // Explain path is intentionally proven against the shipped Qwen 4B model.
  const buildContext = useCallback((sourceSnapshot, budget) => {
    if (!sourceSnapshot.length) return "";
    return buildTutorContext(sourceSnapshot, budget).context;
  }, []);

  const selectedMaxOutputTokens = outputTokensForProfile({
    profile: responseProfile,
    responseProfiles: configState.config?.responseProfiles,
    maximum: configState.config?.limits?.maxOutputTokens,
    structured: currentMode.structured,
  });
  const buildFittedRequest = useCallback((
    sourceSnapshot,
    displayPrompt = prompt.trim(),
    historySnapshot = outboundHistory,
    conversationSummarySnapshot = conversationWindow.conversationSummary,
    webSearchSnapshot = effectiveWebSearch,
  ) => {
    const preparedPrompt = promptForSources(displayPrompt, sourceSnapshot);
    const historyCharacters = historySnapshot.reduce((total, message) => total + message.content.length, 0);
    const availableContextBudget = Math.max(0, Math.min(
      currentMode.contextLimit || 16_000,
      inputLimit - preparedPrompt.length - historyCharacters - conversationSummarySnapshot.length - 300,
    ));
    let fittedCitationNumbers = [];
    const buildFittedContext = (budget) => {
      const built = buildTutorContext(sourceSnapshot, budget);
      fittedCitationNumbers = built.includedCitationNumbers;
      return built.context;
    };
    const makePayload = (context) => ({
      contract: AI_REQUEST_CONTRACT_ID,
      task: currentMode.task,
      prompt: preparedPrompt,
      context,
      contextCitations: [...fittedCitationNumbers],
      documentTitle: sourceSnapshot.length === 1 ? sourceSnapshot[0].title : sourceSnapshot.length ? `${sourceSnapshot.length} selected Lumen sources` : "General AI/ML learning question",
      difficulty,
      responseProfile,
      history: historySnapshot,
      conversationSummary: conversationSummarySnapshot.slice(0, 3_000),
      responseFormat: currentMode.structured ? "structured" : "markdown",
      webSearch: webSearchSnapshot === true,
      maxOutputTokens: selectedMaxOutputTokens,
    });
    const fitted = fitAiRequestContext({
      maximumBytes: configuredRequestByteLimit,
      maximumContextCharacters: availableContextBudget,
      buildContext: buildFittedContext,
      buildPayload: makePayload,
    });
    return {
      ...fitted,
      includedCitationNumbers: [...fittedCitationNumbers],
    };
  }, [buildContext, configuredRequestByteLimit, conversationWindow.conversationSummary, currentMode.contextLimit, currentMode.structured, currentMode.task, difficulty, effectiveWebSearch, inputLimit, outboundHistory, prompt, promptForSources, responseProfile, selectedMaxOutputTokens]);
  const requestPreviewSources = useMemo(
    () => sourceMode === "library-first" && typeof retrieveLibrary === "function" ? [] : selectedSources,
    [retrieveLibrary, selectedSources, sourceMode],
  );
  const requestPreview = useMemo(() => buildFittedRequest(requestPreviewSources), [buildFittedRequest, requestPreviewSources]);
  const contextPreview = requestPreview.context;
  const requestPayloadPreview = requestPreview.payload;
  const requestPayloadBytes = requestPreview.bytes;
  const providerControlsUrl = useMemo(() => {
    try {
      const url = new URL(configState.config?.privacy?.providerDataControlsUrl || "");
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }, [configState.config?.privacy?.providerDataControlsUrl]);
  const promptTooLong = prompt.trim().length > promptLimit;
  const contextTooSmall = sourceMode !== "library-first" && selectedSources.length > 0 && requestPreview.contextBudget < minimumContextBudget(selectedSources);
  const requestTooLarge = Number.isSafeInteger(configuredRequestByteLimit) && requestPayloadBytes > configuredRequestByteLimit;
  const webSearchAvailable = configState.config?.webSearch?.macToolAvailable === true;
  const requestReady = configState.status === "ready"
    && localDisclosureAcknowledged
    && Boolean(prompt.trim())
    && !promptTooLong
    && !contextTooSmall
    && !requestTooLarge
    && (!effectiveWebSearch || webSearchAvailable)
    && requestState.status !== "loading";

  const runRequest = useCallback(async (requestSpec, { appendUser = true } = {}) => {
    if (requestState.status === "loading") return;
    const controller = new AbortController();
    const requestStartedAt = globalThis.performance?.now?.() ?? Date.now();
    requestControllerRef.current = controller;
    let citationSources = requestSpec.sources;
    let payload = requestSpec.payload;
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
    setRequestState({ status: "loading", error: null });
    followStreamRef.current = true;
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
      stage: requestSpec.sourceMode === "library-first" && typeof retrieveLibrary === "function" ? "Searching your library…" : "Preparing grounded context…",
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
      updateActiveResponse((current) => ({ ...current, content: streamedText }));
      if (followStreamRef.current) requestAnimationFrame(() => responseEndRef.current?.scrollIntoView?.({ behavior: "auto", block: "nearest" }));
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
        if (stage) updateActiveResponse((current) => ({ ...current, stage }));
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
          result = await retrieveLibrary(requestSpec.displayPrompt, {
            signal: controller.signal,
            maxPassages: MAX_SELECTED_SOURCES,
            maxBytes: requestSpec.retrievalMaxBytes,
            currentSources: requestSpec.contextSources.map(({ id, title, section }) => ({ id, title, section })),
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
            fitted = buildFittedRequest(retrieved, requestSpec.displayPrompt, requestSpec.conversationHistory, requestSpec.conversationMemory?.summary || "", useWebFallback);
            let included = new Set(fitted.includedCitationNumbers);
            // A high-confidence retrieval result is not evidence if none of its
            // complete [S#] blocks fit the final wire request. Rebuild the
            // prompt without a false source instruction and, when the learner
            // authorized it, treat this as a genuine web-fallback condition.
            if (!included.size) {
              useWebFallback = requestSpec.webSearch;
              fitted = buildFittedRequest([], requestSpec.displayPrompt, requestSpec.conversationHistory, requestSpec.conversationMemory?.summary || "", useWebFallback);
              included = new Set();
            }
            citationSources = retrieved.filter((source) => included.has(source.citationNumber)).map(citationSnapshot);
          } else {
            citationSources = [];
            fitted = buildFittedRequest([], requestSpec.displayPrompt, requestSpec.conversationHistory, requestSpec.conversationMemory?.summary || "", useWebFallback);
          }
          payload = assertFittedAiRequest(fitted, "The retrieved library context exceeds the local model request limit. Narrow the question or clear older conversation turns.");
          const fittedNothing = retrieved.length > 0 && citationSources.length === 0;
          retrievalTrace = normalizeRetrievalTrace({
            ...(result?.trace && typeof result.trace === "object" ? result.trace : {}),
            strategy: result?.trace?.strategy || "library-first",
            candidates: result?.trace?.candidates ?? result?.sources?.length ?? normalizedSources.length,
            passages: citationSources.length,
            summary: fittedNothing
              ? `Library retrieval found relevant passages, but none fit this request's remaining context budget.${useWebFallback ? " Using the learner-authorized web fallback." : ""}`
              : result?.trace?.summary || (citationSources.length ? `Library retrieval attached ${citationSources.length} relevant passage${citationSources.length === 1 ? "" : "s"}.` : "Library retrieval found no passage that fit this request's remaining context budget."),
            ...(fittedNothing ? { webFallback: { recommended: true, code: "fitted_library_context_empty", reason: "No complete retrieved passage fit the final model request." } } : {}),
          });
          updateActiveResponse((current) => ({
            ...current,
            citationSources,
            webFallbackStatus: useWebFallback ? "searching" : requestSpec.webSearch ? "not-needed" : "off",
            stage: useWebFallback ? "Library evidence is insufficient. Running consented web fallback…" : citationSources.length ? "Library evidence ready. Generating without web egress…" : "No library passage fit. Answering without web egress and labeling evidence limits…",
          }));
          if (appendUser) publishHistory((current) => current.map((message) => message.id === userMessage.id ? { ...message, citationSources } : message));
        } else {
          // An unavailable local index is one of the documented independent
          // fallback recommendations. The learner's consumed one-request web
          // authorization remains the separate egress gate.
          const fallbackUsesWeb = requestSpec.webSearch;
          let fallback = buildFittedRequest(requestSpec.contextSources, requestSpec.displayPrompt, requestSpec.conversationHistory, requestSpec.conversationMemory?.summary || "", fallbackUsesWeb);
          let included = new Set(fallback.includedCitationNumbers);
          if (requestSpec.contextSources.length && !included.size) {
            fallback = buildFittedRequest([], requestSpec.displayPrompt, requestSpec.conversationHistory, requestSpec.conversationMemory?.summary || "", fallbackUsesWeb);
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
            stage: fallbackUsesWeb ? "Library search unavailable. Running consented web fallback…" : "Library search unavailable. Using attached lesson context without web egress…",
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
        webFallbackStatus: response.webSearch?.used === true
          ? "used"
          : activeResponseRef.current?.webFallbackStatus === "failed"
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
      publishHistory((current) => [...current, assistantMessage]);
      activeResponseRef.current = null;
      setActiveResponse(null);
      setRequestState({ status: "success", error: null });
      lastRequestRef.current = null;
      setPrompt((current) => current.trim() === requestSpec.displayPrompt ? "" : current);
      requestAnimationFrame(() => responseEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
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
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [buildFittedRequest, normalizeRetrievedSources, normalizedSources.length, publishHistory, requestState.status, retrieveLibrary]);

  const submit = (event) => {
    event?.preventDefault?.();
    if (!requestReady) return;
    const sourceSnapshot = selectedSources.map((source) => ({ ...source }));
    const included = new Set(requestPreview.includedCitationNumbers);
    const citationSources = sourceSnapshot.filter((source) => included.has(source.citationNumber)).map(citationSnapshot);
    const createdAt = new Date().toISOString();
    const requestSpec = {
      userMessageId: createId(),
      createdAt,
      displayPrompt: prompt.trim(),
      mode: currentMode,
      sources: citationSources,
      contextSources: sourceSnapshot,
      sourceMode,
      webSearch: effectiveWebSearch,
      responseProfile,
      retrievalMaxBytes: Math.max(512, requestPreview.contextBudget),
      conversationHistory: outboundHistory.map((message) => ({ ...message })),
      conversationMemory: conversationWindow.compactedMessages ? {
        compactedMessages: conversationWindow.compactedMessages,
        summary: conversationWindow.conversationSummary,
      } : null,
      config: configState.config,
      // requestPayloadPreview is the exact UTF-8/JSON-fitted payload that
      // enabled the Send button. Rebuilding context here would reintroduce the
      // unfitted character budget and can exceed the server byte limit for
      // CJK, emoji, quotes, or backslash-heavy lesson text.
      payload: { ...requestPayloadPreview },
    };
    lastRequestRef.current = requestSpec;
    if (effectiveWebSearch) setWebSearch(false);
    runRequest(requestSpec);
  };

  const retry = () => {
    const retrySpec = lastRequestRef.current;
    if (!retrySpec || requestState.status === "loading" || !localDisclosureAcknowledged) return;
    if (retrySpec.webSearch && !effectiveWebSearch) return;
    if (retrySpec.webSearch) setWebSearch(false);
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
    setPrompt((current) => (!current.trim() || current === previousDefault ? nextMode.prompt : current));
  };

  const preparePrompt = useCallback((message, notice) => {
    if (!message || requestState.status === "loading") return;
    const nextMode = modeById(message.mode);
    setModeId(nextMode.id);
    setPrompt(asTrimmedString(message.content, MAX_PROMPT_CHARS));
    setComposerNotice(notice);
    lastRequestRef.current = null;
    setRequestState({ status: "idle", error: null });
    window.setTimeout(() => {
      promptRef.current?.focus();
      promptRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 0);
  }, [requestState.status]);

  const prepareRegenerate = useCallback((assistantMessage) => {
    const index = history.findIndex((message) => message.id === assistantMessage.id);
    const userMessage = index > 0 ? [...history.slice(0, index)].reverse().find((message) => message.role === "user") : null;
    if (userMessage) preparePrompt(userMessage, "Request restored. Review its sources and settings, renew consent, then generate a fresh response.");
  }, [history, preparePrompt]);

  const chooseSourceMode = (nextMode) => {
    if (requestState.status === "loading" || nextMode === sourceMode) return;
    setSourceMode(nextMode);
    if (nextMode !== "library-first") setWebSearch(false);
    if (nextMode === "choose") setSourcePanelOpen(true);
    outboundChanged();
  };

  const toggleVisibleSources = () => {
    if (requestState.status === "loading") return;
    outboundChanged();
    setSelectedSourceIds((current) => {
      const visibleIds = filteredSources.slice(0, MAX_SELECTED_SOURCES).map((source) => source.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      if (allSelected) return new Set([...current].filter((id) => !visibleIds.includes(id)));
      const next = new Set(current);
      for (const id of visibleIds) {
        if (next.size >= MAX_SELECTED_SOURCES) break;
        next.add(id);
      }
      return next;
    });
  };

  const toggleSource = (sourceId) => {
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
    if (typeof window !== "undefined" && !window.confirm("Clear this local AI tutor conversation? Your library notes and review cards will not be deleted.")) return;
    publishHistory([]);
    lastRequestRef.current = null;
    setRequestState({ status: "idle", error: null });
  };

  const configIcon = configState.status === "ready" ? <ShieldCheck size={16} aria-hidden="true" />
    : configState.status === "checking" ? <LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" />
      : <AlertTriangle size={16} aria-hidden="true" />;

  return (
    <section className={`ai-tutor ${className}`.trim()} aria-labelledby={headingId}>
      <header className="ai-tutor__header">
        <div className="ai-tutor__identity">
          <span className="ai-tutor__mark" aria-hidden="true"><BrainCircuit size={24} /></span>
          <div><span className="ai-tutor__eyebrow">Grounded learning assistant</span><h2 id={headingId}>Lumen AI Tutor</h2></div>
        </div>
        <div className="ai-tutor__header-actions">
          {history.length > 0 && <button className="ai-tutor__icon-button" type="button" onClick={clearHistory} disabled={requestState.status === "loading"} aria-label="Clear AI tutor conversation" title="Clear conversation"><Trash2 size={18} /></button>}
          {onClose && <button className="ai-tutor__button ai-tutor__button--ghost" type="button" onClick={onClose}>Close</button>}
        </div>
      </header>

      <div className={`ai-tutor__connection ai-tutor__connection--${configState.status}`} role="status">
        {configIcon}<span>{configState.message}</span>
        {(configState.status === "error" || configState.status === "disabled") && <button className="ai-tutor__text-button" type="button" onClick={() => setConfigAttempt((attempt) => attempt + 1)}><RefreshCw size={14} aria-hidden="true" /> Check again</button>}
      </div>

      <div className="ai-tutor__mode-tabs" aria-label="Tutor mode">
        {MODE_OPTIONS.map((mode) => <button aria-pressed={mode.id === modeId} className={mode.id === modeId ? "is-active" : ""} type="button" disabled={requestState.status === "loading"} onClick={() => selectMode(mode.id)} key={mode.id}>{mode.label}</button>)}
      </div>
      <p className="ai-tutor__mode-description">{currentMode.description}</p>

      <div className="ai-tutor__workspace">
        <aside className={`ai-tutor__context ${sourcePanelOpen ? "is-open" : ""}`} aria-labelledby={`${headingId}-sources`}>
          <button className="ai-tutor__source-panel-toggle" type="button" aria-expanded={sourcePanelOpen} aria-controls={`${headingId}-source-panel`} onClick={() => setSourcePanelOpen((open) => !open)}>
            <span><BookOpen size={18} aria-hidden="true" /><span><strong id={`${headingId}-sources`}>Grounding</strong><small>{SOURCE_MODES.find((item) => item.id === sourceMode)?.label} · {selectedSources.length} attached</small></span></span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          <div className="ai-tutor__source-panel" id={`${headingId}-source-panel`}>
            <div className="ai-tutor__section-head"><div><span className="ai-tutor__eyebrow">Evidence scope</span><h3>Where should Lumen look?</h3></div><span className="ai-tutor__count">{selectedSources.length}/{MAX_SELECTED_SOURCES}</span></div>
            <div className="ai-tutor__source-modes" role="radiogroup" aria-label="Library grounding scope">
              {SOURCE_MODES.map((item) => <button type="button" role="radio" aria-checked={sourceMode === item.id} className={sourceMode === item.id ? "is-active" : ""} disabled={requestState.status === "loading"} onClick={() => chooseSourceMode(item.id)} key={item.id}><strong>{item.label}</strong><small>{item.short}</small></button>)}
            </div>
            {sourceMode === "library-first" && <p className="ai-tutor__library-first-note"><Search size={16} aria-hidden="true" /><span><strong>Local library before web</strong>{typeof retrieveLibrary === "function" ? "Relevant passages are selected on this device before the request reaches the local model." : "Library retrieval will use the attached lesson until the local index is available."}</span></p>}
            {sourceMode !== "none" && normalizedSources.length ? (
              <>
                {sourceMode === "choose" && <div className="ai-tutor__source-tools"><label><Search size={15} aria-hidden="true" /><span className="sr-only">Filter learning sources</span><input type="search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Filter library…" /></label><button className="ai-tutor__text-button" type="button" onClick={toggleVisibleSources}>{filteredSources.slice(0, MAX_SELECTED_SOURCES).every((source) => selectedSourceIds.has(source.id)) ? "Clear shown" : "Select shown"}</button></div>}
                <div className="ai-tutor__source-list">
                  {(sourceMode === "current" ? currentLessonSources : filteredSources).map((source) => {
                    const selected = sourceMode === "current" || selectedSourceIds.has(source.id);
                    return (
                      <article className={`ai-tutor__source ${selected ? "is-selected" : ""}`} key={source.id}>
                        <label>
                          <input type="checkbox" checked={selected} disabled={sourceMode !== "choose" || requestState.status === "loading"} onChange={() => toggleSource(source.id)} />
                          <span className="ai-tutor__source-citation">S{source.citationNumber}</span>
                          <span className="ai-tutor__source-copy"><strong>{source.title}</strong>{source.section && <small>{source.section}</small>}<small>{source.text.length.toLocaleString()} characters</small></span>
                        </label>
                        {onNavigateSource && <button className="ai-tutor__icon-button" type="button" onClick={() => onNavigateSource(source.original, { citation: `[S${source.citationNumber}]`, sourceId: source.id })} aria-label={`Open ${source.title}`} title="Open source"><ExternalLink size={16} /></button>}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : sourceMode !== "none" ? (
              <div className="ai-tutor__empty-source"><BookOpen size={20} aria-hidden="true" /><p>No lesson is attached. You can still ask a free question; claims will be labeled as general knowledge unless web fallback is enabled.</p></div>
            ) : <div className="ai-tutor__empty-source"><ShieldCheck size={20} aria-hidden="true" /><p>No library text will be included. The question and bounded recent conversation are still sent to your local model.</p></div>}
            {sourceWarning && <p className="ai-tutor__field-error" role="alert">{sourceWarning}</p>}
            <p className="ai-tutor__grounding-note">{sourceMode === "library-first" ? "Lumen searches local notes first and attaches only relevant passages. Web fallback runs only when separately enabled and needed." : selectedSources.length ? `Responses can cite ${selectedSources.map((source) => `[S${source.citationNumber}]`).join(", ")}.` : "No source text will be sent."}</p>
          </div>
        </aside>

        <main className="ai-tutor__conversation" ref={conversationRef} onScroll={(event) => {
          const surface = event.currentTarget;
          followStreamRef.current = surface.scrollHeight - surface.scrollTop - surface.clientHeight < 140;
        }}>
          {history.length === 0 && !activeResponse ? (
            <div className="ai-tutor__welcome"><MessageCircleQuestion size={28} aria-hidden="true" /><h3>Ask across your whole learning library</h3><p>Ask a free question or choose a teaching mode. Lumen checks your local notes first, shows its evidence, and uses the current web only with your per-request consent.</p></div>
          ) : (
            <div className="ai-tutor__messages" aria-label="AI tutor conversation">
              {history.map((message) => (
                <article className={`ai-tutor__message ai-tutor__message--${message.role}`} key={message.id}>
                  <div className="ai-tutor__message-meta"><strong>{message.role === "assistant" ? "Lumen Tutor" : "You"}</strong><span>{modeById(message.mode).label}</span>{message.role === "assistant" && <span>{RESPONSE_PROFILES.find((item) => item.id === message.responseProfile)?.label || "Balanced"}</span>}{message.usage && <span>{message.usage.outputTokens.toLocaleString()} tokens</span>}{message.durationMs !== null && message.role === "assistant" && <span>{(message.durationMs / 1_000).toFixed(message.durationMs < 10_000 ? 1 : 0)}s</span>}{message.incomplete && <span className="is-warning">Stopped early</span>}{message.truncated && <span className="is-warning">Display capped</span>}{message.role === "assistant" && <WebFallbackBadge status={message.webFallbackStatus} />}</div>
                  {message.role === "assistant"
                    ? <AssistantMessage message={message} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} />
                    : <p className="ai-tutor__user-prompt">{message.content}</p>}
                  <MessageActions message={message} requestBusy={requestState.status === "loading"} onNavigateSource={onNavigateSource} onPrepareRegenerate={prepareRegenerate} onReusePrompt={(request) => preparePrompt(request, "Request restored. Edit it, review grounding and consent, then send.")} />
                </article>
              ))}
              {activeResponse && (
                <article className="ai-tutor__message ai-tutor__message--assistant ai-tutor__message--streaming" aria-busy="true">
                  <div className="ai-tutor__message-meta"><strong>Lumen Tutor</strong><span>{modeById(activeResponse.mode).label}</span><span>{RESPONSE_PROFILES.find((item) => item.id === activeResponse.responseProfile)?.label || "Balanced"}</span><span className="ai-tutor__live-badge"><i aria-hidden="true" /> Live</span><WebFallbackBadge status={activeResponse.webFallbackStatus} /></div>
                  <div className="ai-tutor__stream-status" role="status" aria-live="polite"><span>{activeResponse.stage || "Generating response…"}</span><small>{requestElapsed}s</small></div>
                  {activeResponse.content
                    ? <AssistantMessage message={activeResponse} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} streaming />
                    : <div className="ai-tutor__response-skeleton" aria-hidden="true"><i /><i /><i /></div>}
                  <div className="ai-tutor__stream-actions"><span>{activeResponse.content
                    ? `${activeResponse.content.length.toLocaleString()} characters received`
                    : activeResponse.sourceMode === "no-library" && !["searching", "used"].includes(activeResponse.webFallbackStatus)
                      ? "Waiting for the first token…"
                      : "Grounded text appears after completion and citation validation…"}</span><button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => requestControllerRef.current?.abort()}><CircleStop size={16} aria-hidden="true" /> Stop generating</button></div>
                </article>
              )}
            </div>
          )}
          {(requestState.status === "error" || requestState.status === "cancelled") && <div className="ai-tutor__request-error" role="alert"><AlertTriangle size={20} aria-hidden="true" /><div><strong>{requestErrorTitle(requestState.status, requestState.error?.code)}</strong><p>{requestState.error?.message}</p><WebFallbackBadge status={requestState.error?.webFallbackStatus} />{requestState.error?.retryAfter && <small>Server retry guidance: wait {requestState.error.retryAfter} seconds.</small>}{requestState.error?.requestId && <small>Request ID: {requestState.error.requestId}</small>}{requestState.error?.canRetry && lastRequestRef.current?.webSearch === true && !effectiveWebSearch && <small>Re-enable “Allow current-web fallback” below to authorize one retry. The retry may generate and send a new search query.</small>}</div>{requestState.error?.canRetry && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={retry} disabled={!localDisclosureAcknowledged || (lastRequestRef.current?.webSearch === true && !effectiveWebSearch)}><RefreshCw size={15} aria-hidden="true" /> Retry</button>}</div>}
          <div ref={responseEndRef} />
        </main>
      </div>

      <form className="ai-tutor__composer" onSubmit={submit}>
        <div className="ai-tutor__composer-row">
        <label className="ai-tutor__difficulty"><span>Depth</span><select value={difficulty} disabled={requestState.status === "loading"} onChange={(event) => { setDifficulty(event.target.value); outboundChanged(); }}>{DIFFICULTIES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <span className="ai-tutor__model">{configState.config?.model ? `Local model: ${configState.config.model}` : "Local model is host-managed"}</span>
        </div>
        <fieldset className="ai-tutor__response-profiles" disabled={requestState.status === "loading"}>
          <legend>Response</legend>
          <div>{RESPONSE_PROFILES.map((item) => <label className={responseProfile === item.id ? "is-active" : ""} key={item.id}><input type="radio" name={`${headingId}-response-profile`} value={item.id} checked={responseProfile === item.id} onChange={() => { setResponseProfile(item.id); outboundChanged(); }} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div>
        </fieldset>
        <label className={`ai-tutor__web-search ${effectiveWebSearch ? "is-enabled" : ""}`}><input type="checkbox" checked={effectiveWebSearch} disabled={!webSearchAvailable || !libraryWebEligible || requestState.status === "loading"} onChange={(event) => changeWebSearch(event.target.checked)} /><span><strong>Allow current-web fallback for this request</strong><small>{!libraryWebEligible ? "Choose Library first so Lumen can check all local notes before any web fallback is allowed." : webSearchAvailable ? "One-request authorization: Lumen checks your full local library first, searches through self-hosted SearXNG only when local evidence is insufficient or the question is time-sensitive, and asks again for every future request or retry." : configState.config?.service?.toolCallingCapable === false ? "The installed Ollama model does not attest tool-calling support. Choose the supported Qwen model or use On-device Lite exact-query search." : configState.config?.webSearch?.configured ? "SearXNG is configured but unreachable. Start it on the host Mac, then check again." : "Unavailable until self-hosted SearXNG is enabled on the host Mac."}</small></span></label>
        {effectiveWebSearch && <WebFallbackBadge status="armed" />}
        <label className="ai-tutor__prompt-label" htmlFor={promptId}>What should the tutor help you learn?</label>
        <textarea ref={promptRef} id={promptId} value={prompt} onChange={(event) => { setPrompt(event.target.value); outboundChanged(); }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(event); } }} maxLength={promptLimit} rows={4} placeholder="Ask anything about AI/ML, your library, or the current lesson…" />
        {composerNotice && <p className="ai-tutor__composer-notice" role="status">{composerNotice}</p>}
        <div className="ai-tutor__character-count"><span>{prompt.trim().length.toLocaleString()} / {promptLimit.toLocaleString()}</span>{contextPreview.length > 0 && <span>{contextPreview.length.toLocaleString()} source characters prepared</span>}{conversationWindow.compactedMessages > 0 && <span>{conversationWindow.compactedMessages} older messages will be visibly compacted</span>}</div>

        <div className="ai-tutor__privacy" id={privacyId}>
          <button className="ai-tutor__privacy-toggle" type="button" aria-expanded={privacyOpen} onClick={() => setPrivacyOpen((open) => !open)}><span><LockKeyhole size={18} aria-hidden="true" /><strong>Review data categories and limits before sending</strong></span><ChevronDown size={18} aria-hidden="true" /></button>
          {privacyOpen && <div className="ai-tutor__privacy-body">
            <p><strong>Model destination:</strong> {AI_DATA_DISCLOSURE.destination}. The browser calls only Lumen’s same-origin server; no paid-provider key is accepted or exposed here.</p>
            {effectiveWebSearch && <p><strong>Consented web fallback:</strong> {AI_DATA_DISCLOSURE.webSearch.destination} Local-library retrieval runs first. Only when it recommends fallback may Lumen send up to {configState.config?.webSearch?.maxRounds || 1} focused queries derived from this prompt, selected context, and bounded history. If the local model skips its required tool call, the server uses a bounded form of your question so the authorized fallback still runs. Query text is sent without a separate preview in Mac-local mode. Use On-device Lite when you need to approve the exact query first.</p>}
            {responseProfile === "deep" && <p><strong>Deep response:</strong> The local model may use private internal thinking to plan a stronger answer. That private thinking is never returned to this UI, saved in history, or shown by the Approach toggle; Approach contains only disclosure-safe orchestration and evidence metadata.</p>}
            <div className="ai-tutor__disclosure-grid">
              <div><h4>This request sends to the local model</h4><ul><li>Your {prompt.trim().length.toLocaleString()}-character prompt</li><li>Difficulty: {DIFFICULTIES.find((item) => item.id === difficulty)?.label}</li><li>Response profile: {RESPONSE_PROFILES.find((item) => item.id === responseProfile)?.label} (up to {selectedMaxOutputTokens.toLocaleString()} output tokens)</li><li>Grounding: {SOURCE_MODES.find((item) => item.id === sourceMode)?.label}</li><li>{selectedSources.length ? `${selectedSources.length} prepared source${selectedSources.length === 1 ? "" : "s"}: ${selectedSources.map((source) => `[S${source.citationNumber}] ${source.title}`).join(", ")}` : "No curriculum source text is currently prepared"}</li><li>{outboundHistory.length} recent conversation message{outboundHistory.length === 1 ? "" : "s"} (maximum {MAX_SERVER_HISTORY}){conversationWindow.compactedMessages ? `; ${conversationWindow.compactedMessages} older messages form a visible bounded memory` : ""}</li><li>A fixed grounding instruction requiring valid [S#] citations</li><li>Web fallback: {effectiveWebSearch ? "consented; used only when local retrieval recommends it" : "off"}</li></ul></div>
              <div><h4>This client does not send</h4><ul>{AI_DATA_DISCLOSURE.neverSentByThisClient.map((item) => <li key={item}>{item}</li>)}</ul></div>
            </div>
            <p className="ai-tutor__retention"><ShieldCheck size={16} aria-hidden="true" />The Lumen server reports no prompt or response storage and no paid remote-model API. {effectiveWebSearch ? "Search engines can observe the search query and ordinary request metadata according to their own policies. " : "No web-search service is contacted for this request. "}{onHistoryChange ? `This app saves up to ${MAX_VISIBLE_HISTORY} normalized tutor messages and web-source links locally and includes them in exported backups. Full source text and search-result bodies are not duplicated in that history. Use “Clear conversation” in the tutor header to remove it.` : "Conversation history stays only in this component for the current visit."}</p>
            {providerControlsUrl && <a href={providerControlsUrl} target="_blank" rel="noreferrer">Review provider data controls <ExternalLink size={13} aria-hidden="true" /></a>}
          </div>}
        </div>

        <div className="ai-tutor__submit-row">
          {!localDisclosureAcknowledged ? <label className="ai-tutor__consent"><input type="checkbox" checked={false} onChange={(event) => { const acknowledged = event.target.checked; setLocalDisclosureAcknowledged(acknowledged); rememberLocalDisclosureAcknowledgement(acknowledged); }} /><span>I understand the local-model disclosure. Remember this acknowledgement on this browser; web fallback still requires separate authorization for every request.</span></label> : <div className="ai-tutor__consent ai-tutor__consent--acknowledged"><ShieldCheck size={18} aria-hidden="true" /><span>Local-model disclosure acknowledged on this browser. Current-web access remains off unless you authorize it above for one request.</span><button type="button" className="ai-tutor__text-button" onClick={() => { rememberLocalDisclosureAcknowledgement(false); setLocalDisclosureAcknowledged(false); setPrivacyOpen(true); }}>Review again</button></div>}
          <button className="ai-tutor__button ai-tutor__button--primary ai-tutor__send" type="submit" disabled={!requestReady} aria-describedby={`${privacyId} ${sendReasonId}`}>{requestState.status === "loading" ? <LoaderCircle className="ai-tutor__spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />} {requestState.status === "loading" ? "Working…" : `Generate ${currentMode.label}`}</button>
        </div>
        <p className="ai-tutor__disabled-reason" id={sendReasonId}>{configState.status !== "ready"
          ? "Generation stays disabled until the secure server configuration is ready."
          : !prompt.trim()
            ? "Enter a learning request to enable generation."
            : promptTooLong
              ? `Shorten the prompt to ${promptLimit.toLocaleString()} characters for this server’s input limit.`
            : contextTooSmall
              ? "Select fewer sources, shorten the prompt, or clear conversation history so every selected source can be included."
              : requestTooLarge
                ? `This request is ${requestPayloadBytes.toLocaleString()} UTF-8 bytes; reduce it below the server's ${configuredRequestByteLimit.toLocaleString()}-byte local-model budget.`
              : !localDisclosureAcknowledged
                  ? "Review and acknowledge the local-model disclosure once on this browser to enable generation."
                  : "Ready to send this request securely."}</p>
      </form>
    </section>
  );
}

export { AI_DATA_DISCLOSURE, DIFFICULTIES as AI_TUTOR_DIFFICULTIES, MODE_OPTIONS as AI_TUTOR_MODES };
