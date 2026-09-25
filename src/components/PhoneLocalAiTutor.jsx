import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import {
  AlertTriangle,
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  Cpu,
  ExternalLink,
  LoaderCircle,
  NotebookPen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Volume2,
  WifiOff,
} from "lucide-react";
import PhoneLocalAiSettings from "./PhoneLocalAiSettings";
import TutorConfirmDialog from "./TutorConfirmDialog.jsx";
import { useScrollableRegions } from "../lib/useScrollableRegions.js";
import { revealFocusedField } from "../lib/revealField.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { scrollBehavior } from "../lib/motion.js";
import { FINE_POINTER_QUERY, composerEnterAction, composerKeyHint, currentPlatform, shouldRecallLastQuestion } from "../lib/tutorKeyboard.js";
import {
  getPhoneLocalAiEngine,
  inspectPhoneLocalAiRequestFit,
  PHONE_LOCAL_AI_DISCLOSURE,
  PHONE_LOCAL_MODEL,
  selectCitablePhoneSources,
  selectCompletedPhoneHistory,
} from "../lib/phoneLocalAi.js";
import { renderPhoneTutorInlineMarkdown, renderPhoneTutorMarkdown } from "../lib/phoneTutorMarkdown.js";
import { tutorSpeechText } from "../lib/tutorMarkdown.js";
import { tutorMessageMarkdown } from "../lib/tutorExport.js";
import { retrievalTraceCounts, shouldUseWebFallback } from "../lib/tutorGrounding.js";
import { ANSWER_FOLLOW_UPS, withoutCitationLabels } from "../lib/tutorFollowUps.js";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import "../phone-local-ai-tutor.css";

export const PHONE_TUTOR_MODES = Object.freeze([
  { id: "explain", label: "Explain", task: "explain", prompt: "Explain the selected material with intuition, one concrete example, common mistakes, and interview trade-offs.", description: "Concepts, mechanics, pitfalls, and senior-level judgment." },
  { id: "socratic", label: "Socratic", task: "socratic", prompt: "Teach this with one focused Socratic question at a time. Begin by checking what I already understand.", description: "Guided questioning without revealing the answer too early." },
  { id: "quiz", label: "Quiz", task: "quiz", prompt: "Create a concise 3-question quiz grounded in the selected material. Test recall, application, and one misconception.", description: "A locally validated interactive quiz.", structured: true },
  { id: "flashcards", label: "Flashcards", task: "flashcards", prompt: "Create up to 6 atomic active-recall flashcards from the selected material. Prefer reasoning over copied definitions.", description: "Review-ready card drafts you choose before saving.", structured: true },
  { id: "interview", label: "Interview", task: "interview", prompt: "Interview me at senior engineer depth. Ask one question, then probe assumptions, trade-offs, failure handling, and measurement.", description: "Practice concise SDE-II/SDE-III technical reasoning." },
  { id: "summarize", label: "Summarize", task: "summarize", prompt: "Summarize the selected material faithfully: core ideas, formulas, assumptions, pitfalls, and a short recall checklist.", description: "A compact revision guide generated on this device." },
  { id: "study-plan", label: "Study plan", task: "study_plan", prompt: "Create a concise plan with up to 4 sequenced milestones, realistic activities, time estimates, and evidence of mastery.", description: "A locally validated, dependency-aware plan.", structured: true },
]);

const DEPTHS = Object.freeze([
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
  { id: "interview", label: "Interview" },
]);

export const PHONE_SOURCE_MODES = Object.freeze([
  { id: "library-first", label: "Library first", short: "Search every local note, then attach only the best passages." },
  { id: "current", label: "Current lesson", short: "Use the lesson that was open when the studio launched." },
  { id: "choose", label: "Choose", short: "Attach up to two loaded lessons yourself." },
  { id: "none", label: "No library", short: "Use the small model's general knowledge only." },
]);

const RESPONSE_LENGTHS = Object.freeze([
  { id: "compact", label: "Compact", tokens: 384 },
  { id: "standard", label: "Standard", tokens: 640 },
  { id: "detailed", label: "Detailed", tokens: 768 },
]);

const MAX_SOURCES = 2;
const MAX_CONTEXT_CHARS = 4_800;
const MAX_PROMPT_CHARS = 1_800;
const MAX_SESSION_MESSAGES = 30;
const MAX_HISTORY_MESSAGES = 2;
// The small model gets three of the Mac tutor's follow-ups (TFEAT-02).
// Shared with the Mac tutor: the app's one speech session reading an answer.
const TUTOR_SPEECH_LABEL = "Tutor answer";
const PHONE_FOLLOW_UPS = ANSWER_FOLLOW_UPS.filter((item) => ["simpler", "quiz", "flashcards"].includes(item.id));

const cleanText = (value, maximum = 20_000) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maximum);

const sourceText = (source) => cleanText(source?.text ?? source?.content ?? source?.excerpt ?? source?.markdown ?? "", 100_000);
const sourceId = (source, index) => cleanText(source?.id ?? source?.documentId ?? source?.slug, 240) || `phone-source-${index}`;
const createId = () => globalThis.crypto?.randomUUID?.() || `phone-ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Leaving On-device Lite releases its ~880 MB of GPU memory, but not at once:
// coming back within the grace period (a quick look at a lesson, or toggling
// engines) keeps the loaded model instead of reloading it. Hiding or leaving
// the page releases it immediately. An injected engine may shorten the delay.
const MODEL_RELEASE_DELAY_MS = 45_000;
let pendingModelRelease = null;

const cancelModelRelease = (engine) => {
  if (!pendingModelRelease || pendingModelRelease.engine !== engine) return;
  clearTimeout(pendingModelRelease.timer);
  globalThis.removeEventListener?.("pagehide", pendingModelRelease.releaseNow);
  globalThis.document?.removeEventListener("visibilitychange", pendingModelRelease.releaseWhenHidden);
  pendingModelRelease = null;
};

const scheduleModelRelease = (engine) => {
  if (pendingModelRelease) pendingModelRelease.releaseNow();
  const releaseNow = () => {
    cancelModelRelease(engine);
    void engine.unload?.().catch(() => {});
  };
  const releaseWhenHidden = () => { if (globalThis.document?.visibilityState === "hidden") releaseNow(); };
  const delay = Number.isFinite(engine.releaseDelayMs) ? Math.max(0, engine.releaseDelayMs) : MODEL_RELEASE_DELAY_MS;
  pendingModelRelease = { engine, releaseNow, releaseWhenHidden, timer: setTimeout(releaseNow, delay) };
  globalThis.addEventListener?.("pagehide", releaseNow);
  globalThis.document?.addEventListener("visibilitychange", releaseWhenHidden);
};

const writeClipboard = async (value) => {
  const text = String(value || "");
  if (!text) return false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* use the local fallback below */ }
  if (!globalThis.document?.body) return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  field.remove();
  return copied;
};

export const normalizePhoneSources = (sources) => {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : []).flatMap((source, index) => {
    if (!source || typeof source !== "object") return [];
    const text = sourceText(source);
    const id = sourceId(source, index);
    if (!text || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      documentId: cleanText(source.documentId ?? source.id, 240),
      title: cleanText(source.title, 200) || "Untitled learning source",
      section: cleanText(source.section ?? source.heading, 160),
      text,
      selected: source.selected === true,
      original: source,
    }];
  });
};

export const normalizeRetrievedPhoneSources = (result, availableSources = []) => {
  const knownByDocument = new Map((Array.isArray(availableSources) ? availableSources : []).map((source) => [source.documentId || source.id, source]));
  const seen = new Set();
  return (Array.isArray(result?.passages) ? result.passages : []).slice(0, MAX_SOURCES * 2).flatMap((passage, index) => {
    if (!passage || typeof passage !== "object") return [];
    const text = sourceText(passage);
    const id = sourceId(passage, index);
    if (!text || seen.has(id)) return [];
    seen.add(id);
    const documentId = cleanText(passage.documentId ?? passage.id, 240);
    const known = knownByDocument.get(documentId);
    const anchor = cleanText(passage.anchor, 240);
    return [{
      id,
      documentId,
      title: cleanText(passage.title, 200) || "Retrieved library passage",
      section: cleanText(passage.section ?? passage.heading, 160),
      anchor,
      text,
      selected: true,
      original: known?.original || {
        id: documentId,
        documentId,
        title: cleanText(passage.title, 200),
        section: cleanText(passage.section, 160),
        anchor,
      },
    }];
  }).slice(0, MAX_SOURCES);
};

const normalizeRetrievalTrace = (trace) => {
  if (!trace || typeof trace !== "object") return null;
  const counts = retrievalTraceCounts(trace);
  const confidenceScore = Number.isFinite(trace.confidence?.score) ? Math.max(0, Math.min(1, trace.confidence.score)) : null;
  const value = {
    strategy: cleanText(trace.strategy || "library-first", 80),
    candidates: counts.candidates,
    matchedDocuments: counts.matchedDocuments,
    passages: counts.passages,
    confidenceLevel: cleanText(trace.confidence?.level, 30),
    confidenceScore,
    budgetTruncated: trace.budget?.truncated === true,
    webFallbackRecommended: trace.webFallback?.recommended === true,
    webFallbackCode: cleanText(trace.webFallback?.code, 80),
    webFallbackReason: cleanText(trace.webFallback?.reason, 300),
  };
  return value.strategy || value.passages !== null || value.webFallbackCode ? value : null;
};

const clip = (text, maximum) => {
  if (text.length <= maximum) return text;
  const marker = "\n[… excerpt clipped for the phone model …]\n";
  const available = maximum - marker.length;
  const start = Math.ceil(available * 0.76);
  return `${text.slice(0, start)}${marker}${text.slice(text.length - (available - start))}`;
};

export const buildPhoneContextBundle = (sources) => {
  if (!sources.length) return { text: "", ranges: [] };
  const framing = sources.reduce((sum, source, index) => sum + source.title.length + source.section.length + String(index + 1).length + 20, 0);
  const textBudget = Math.max(400, MAX_CONTEXT_CHARS - framing);
  const perSource = Math.floor(textBudget / sources.length);
  const blocks = sources.map((source, index) => {
    const inferenceTitle = cleanText(source.title, 80) || "Learning source";
    const inferenceSection = cleanText(source.section, 40);
    return [
    `[S${index + 1}] ${inferenceTitle}${inferenceSection ? ` — ${inferenceSection}` : ""}`,
    clip(source.text, perSource),
    ].join("\n");
  });
  let offset = 0;
  const ranges = [];
  const text = blocks.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  blocks.forEach((block, index) => {
    const start = offset;
    const end = Math.min(text.length, start + block.length);
    const headerEnd = block.indexOf("\n");
    const evidenceStart = headerEnd < 0 ? end : Math.min(end, start + headerEnd + 1);
    if (start < text.length && end > evidenceStart) ranges.push({ id: sources[index].id, start, evidenceStart, end });
    offset += block.length + 2;
  });
  return { text, ranges };
};

export const buildPhoneContext = (sources) => buildPhoneContextBundle(sources).text;

const phoneDocumentTitle = (sources) => sources.length === 1
  ? cleanText(sources[0].title, 80) || "Learning source"
  : sources.length ? `${sources.length} selected learning sources` : "General AI/ML question";

const safeWebCitation = (candidate, fallbackIndex) => {
  if (!candidate || typeof candidate !== "object") return null;
  try {
    const url = new URL(String(candidate.url || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    const title = cleanText(candidate.title, 240);
    if (!title) return null;
    return {
      index: Number.isSafeInteger(candidate.index) && candidate.index > 0 ? candidate.index : fallbackIndex,
      title,
      url: url.href.slice(0, 2_000),
      source: cleanText(candidate.source, 100),
      publishedAt: cleanText(candidate.publishedAt, 80),
    };
  } catch {
    return null;
  }
};

export const sanitizePhoneCitations = (citations) => (Array.isArray(citations) ? citations : [])
  .slice(0, 5)
  .map((citation, index) => safeWebCitation(citation, index + 1))
  .filter(Boolean);

const SafeResponse = ({ text, citations = [], sources = [], onNavigateSource, onCopy, streaming = false }) => {
  const responseRef = useRef(null);
  const html = useMemo(
    () => renderPhoneTutorMarkdown(text, sources, citations),
    [citations, sources, text],
  );
  const htmlMarkup = useMemo(() => ({ __html: html }), [html]);
  useMermaidDiagrams(responseRef, { contentKey: html, enabled: !streaming });
  useScrollableRegions(responseRef, html);
  const handleClick = async (event) => {
    const codeButton = event.target.closest?.(".code-copy");
    if (codeButton) {
      const code = codeButton.closest?.(".code-shell")?.querySelector?.("pre code")?.textContent || "";
      const copied = await writeClipboard(code);
      codeButton.textContent = copied ? "Copied" : "Copy failed";
      globalThis.setTimeout?.(() => { if (codeButton.isConnected) codeButton.textContent = "Copy"; }, 1_500);
      onCopy?.(copied);
      return;
    }
    const citationButton = event.target.closest?.("[data-ai-citation]");
    if (!citationButton) return;
    // As on the Mac: a citation opens its own source and nothing else.
    event.preventDefault();
    const match = citationButton.dataset?.aiCitation?.match(/^S(\d+)$/);
    const requestedCitation = match ? Number(match[1]) : null;
    const source = Number.isSafeInteger(requestedCitation)
      ? sources.find((candidate, index) => (
        (Number.isSafeInteger(candidate?.citationNumber) ? candidate.citationNumber : index + 1) === requestedCitation
      ))
      : null;
    if (source) onNavigateSource?.(source.original || source, { sourceId: source.id, anchor: source.anchor });
  };
  return (
    <div
      ref={responseRef}
      className="phone-tutor__safe-response"
      // renderPhoneTutorMarkdown shows model-authored HTML as text, then sanitizes with DOMPurify.
      dangerouslySetInnerHTML={htmlMarkup}
      onClick={handleClick}
    />
  );
};

const ContextFitNote = ({ fit }) => {
  if (!fit) return null;
  const details = [
    `${fit.inputBytesUsed.toLocaleString()} of ${fit.inputByteBudget.toLocaleString()} safe input bytes`,
    `${fit.contextCharactersUsed.toLocaleString()} of ${fit.contextCharactersProvided.toLocaleString()} prepared lesson characters`,
    `${fit.historyMessagesUsed} of ${fit.historyMessagesProvided} prior messages`,
  ];
  if (fit.evidenceResultsProvided > 0) {
    details.push(`${fit.evidenceResultsUsed} of ${fit.evidenceResultsProvided} web results (${fit.evidenceCharactersUsed.toLocaleString()} of ${fit.evidenceCharactersProvided.toLocaleString()} evidence characters)`);
  }
  if (fit.citedSourceIndexes?.length > 0) {
    details.push(`verified library labels ${fit.citedSourceIndexes.map((index) => `[S${index}]`).join(", ")}`);
  }
  const omissions = [];
  if (fit.contextCharactersUsed < fit.contextCharactersProvided) omissions.push("lesson text");
  if (fit.historyMessagesUsed < fit.historyMessagesProvided) omissions.push("earlier conversation turns");
  if (fit.evidenceResultsUsed < fit.evidenceResultsProvided || fit.evidenceCharactersUsed < fit.evidenceCharactersProvided) omissions.push("web evidence text");
  return <div className="phone-tutor__context-fit"><p>Context fit included {details.join(", ")}.{omissions.length ? ` The 4K window visibly truncated ${omissions.join(", ")}.` : " Nothing required additional engine trimming."}</p>{fit.sourceUsage?.length > 0 && <ul>{fit.sourceUsage.map((source) => <li key={source.id}>{source.title}: {source.charactersUsed.toLocaleString()} of {source.charactersProvided.toLocaleString()} characters used{source.labelSupplied ? "" : "; source label was not retained, so it was not citable"}</li>)}</ul>}</div>;
};

const EvidenceDetails = ({ message, onNavigateSource }) => {
  const trace = message.retrievalTrace;
  const evidenceCount = message.sources.length + message.citations.length;
  return (
    <details className="phone-tutor__evidence">
      <summary>
        <span><BookOpen size={15} aria-hidden="true" /> Approach & evidence</span>
        <small>{evidenceCount ? `${evidenceCount} source${evidenceCount === 1 ? "" : "s"}` : "General knowledge"}</small>
      </summary>
      <div className="phone-tutor__approach">
        <strong>What Lumen did</strong>
        <ol>
          {trace?.webFallbackCode === "library_retrieval_unavailable"
            ? <li>The local retrieval step was unavailable, so Lumen supplied no library text. Separately enabled web fallback remained eligible and still required exact-query approval.</li>
            : trace
              ? <li>Searched {trace.candidates ?? "the available"} local documents and selected {trace.passages ?? message.sources.length} bounded passage{(trace.passages ?? message.sources.length) === 1 ? "" : "s"}{trace.matchedDocuments === null ? "" : ` from ${trace.matchedDocuments} matching documents`}.</li>
              : <li>Used the source scope you selected. This panel reports observable processing steps and evidence, never hidden chain-of-thought.</li>}
          {trace?.confidenceLevel && <li>Library match: {trace.confidenceLevel}{trace.confidenceScore === null ? "" : ` (${Math.round(trace.confidenceScore * 100)}%)`}{trace.budgetTruncated ? "; the retrieval byte budget was reached" : ""}.</li>}
          {trace?.webFallbackCode && <li>Web fallback was {trace.webFallbackRecommended ? "eligible after your separate permission" : "not needed"}: {trace.webFallbackReason || trace.webFallbackCode}</li>}
          <li>Fitted the chosen excerpts, recent conversation pair, and any approved search evidence into the model's 4,096-token window before on-device generation.</li>
        </ol>
      </div>
      <ContextFitNote fit={message.contextFit} />
      {message.sources.length > 0 && <div className="phone-tutor__used-sources"><strong>Library excerpts actually included</strong>{message.sources.map((source, index) => <button type="button" disabled={!onNavigateSource} onClick={() => onNavigateSource?.(source.original || source, { sourceId: source.id, anchor: source.anchor })} key={source.id}>[S{Number.isSafeInteger(source.citationNumber) ? source.citationNumber : index + 1}] {source.title}{source.section ? ` · ${source.section}` : ""}</button>)}</div>}
      {message.citations.length > 0 && <div className="phone-tutor__web-sources"><strong>Cited public web evidence</strong><ol>{message.citations.map((citation) => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer">[W{citation.index}] {citation.title}<ExternalLink size={13} aria-hidden="true" /></a>{(citation.source || citation.publishedAt) && <small>{[citation.source, citation.publishedAt].filter(Boolean).join(" · ")}</small>}</li>)}</ol></div>}
    </details>
  );
};

/**
 * Renders a structured string field (quiz option, card side, plan step) as
 * sanitized inline Markdown: KaTeX math, emphasis, code spans, and the same
 * navigable [S#]/[W#] citation controls the prose surface produces.
 */
const InlineFieldCitations = ({ text, sources = [], citations = [], onNavigateSource }) => {
  const markup = useMemo(() => ({ __html: renderPhoneTutorInlineMarkdown(text, sources, citations) }), [citations, sources, text]);
  const handleClick = (event) => {
    const citationButton = event.target.closest?.("[data-ai-citation]");
    if (!citationButton) return;
    // A citation inside a quiz option label must not also pick that option.
    event.preventDefault();
    const requested = Number(citationButton.dataset.aiCitation?.match(/^S(\d+)$/)?.[1]);
    const source = Number.isSafeInteger(requested)
      ? sources.find((candidate, index) => (Number.isSafeInteger(candidate?.citationNumber) ? candidate.citationNumber : index + 1) === requested)
      : null;
    if (source) onNavigateSource?.(source.original || source, { sourceId: source.id, anchor: source.anchor });
  };
  // renderPhoneTutorInlineMarkdown shows model-authored HTML as text, then sanitizes with DOMPurify.
  return <span className="phone-tutor__inline-md" onClick={handleClick} dangerouslySetInnerHTML={markup} />;
};

const QuizResult = ({ quiz, messageId, sources = [], citations = [], onNavigateSource }) => {
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState({});
  // "Check answer" is replaced by its feedback; focus follows it there.
  const focusFeedbackRef = useRef("");
  const cite = (text) => <InlineFieldCitations text={text} sources={sources} citations={citations} onNavigateSource={onNavigateSource} />;
  return (
    <div className="phone-tutor__quiz">
      <h4>{quiz.title}</h4><p>{cite(quiz.instructions)}</p>
      {quiz.questions.map((question, questionIndex) => (
        <fieldset key={question.id}>
          <legend><span className="phone-tutor__quiz-number">{questionIndex + 1}.</span> {cite(question.prompt)}</legend>
          {question.options.map((option, optionIndex) => {
            const checked = answers[question.id] === optionIndex;
            const open = revealed[question.id];
            const correct = optionIndex === question.correctIndex;
            const mark = open && correct ? (checked ? "Your answer · correct" : "Correct answer") : open && checked ? "Your answer · incorrect" : "";
            return <label className={open && correct ? "is-correct" : open && checked ? "is-incorrect" : ""} key={`${question.id}-${optionIndex}`}><input type="radio" name={`${messageId}-${question.id}`} checked={checked} disabled={open} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} /><span><strong>{String.fromCharCode(65 + optionIndex)}.</strong> {cite(option)}{mark && <small className="phone-tutor__option-mark">{mark}</small>}</span></label>;
          })}
          {!revealed[question.id] ? <button type="button" disabled={!Number.isSafeInteger(answers[question.id])} onClick={() => { focusFeedbackRef.current = question.id; setRevealed((current) => ({ ...current, [question.id]: true })); }}>Check answer</button> : <div className="phone-tutor__quiz-feedback" tabIndex={-1} ref={(node) => { if (node && focusFeedbackRef.current === question.id) { focusFeedbackRef.current = ""; node.focus({ preventScroll: true }); } }}><strong>{answers[question.id] === question.correctIndex ? `Correct — ${String.fromCharCode(65 + question.correctIndex)} is right.` : `Not quite — the correct answer is ${String.fromCharCode(65 + question.correctIndex)}.`}</strong><p>{cite(question.explanation)}</p></div>}
        </fieldset>
      ))}
    </div>
  );
};

const FlashcardResult = ({ cards, message, onCreateFlashcardDrafts, onNavigateSource }) => {
  const [selected, setSelected] = useState(() => cards.map((_, index) => index));
  const [revealed, setRevealed] = useState({});
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });
  const save = async () => {
    if (!onCreateFlashcardDrafts || !selected.length || ["saving", "saved", "exists"].includes(saveState.status)) return;
    const chosen = selected.map((index) => cards[index]);
    setSaveState({ status: "saving", message: "Adding selected cards…" });
    try {
      const result = await onCreateFlashcardDrafts(chosen, {
        mode: "on-device-flashcards",
        sourceIds: message.sources.map((source) => source.documentId || source.id).filter(Boolean),
        webCitationStyle: "explicit-w",
        webSources: message.citations.map(({ index, title, url }) => ({ index, title, url })),
      });
      const added = Number.isSafeInteger(result?.added) ? result.added : chosen.length;
      const skipped = Number.isSafeInteger(result?.skipped) ? result.skipped : 0;
      if (!added && skipped) setSaveState({ status: "exists", message: "Already in Review: these cards are in your deck." });
      else setSaveState({ status: "saved", message: `${added} card${added === 1 ? "" : "s"} added to review${skipped ? `; ${skipped} already in Review` : ""}.` });
    } catch (error) {
      setSaveState({ status: "error", message: `Cards were not saved.${error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : ""} Your selection is still available to retry.` });
    }
  };
  const changeSelection = (update) => {
    setSelected(update);
    setSaveState((current) => current.status === "saving" ? current : { status: "idle", message: "" });
  };
  return (
    <div className="phone-tutor__flashcards">
      <div className="phone-tutor__flashcard-head"><strong>{selected.length}/{cards.length} selected</strong><button type="button" onClick={() => changeSelection(selected.length === cards.length ? [] : cards.map((_, index) => index))}>{selected.length === cards.length ? "Clear" : "Select all"}</button></div>
      {cards.map((card, index) => <article key={`${message.id}-card-${index}`}>
        <label><input type="checkbox" checked={selected.includes(index)} onChange={() => changeSelection((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} /><span>Select card {index + 1}</span></label>
        <small>Prompt</small><p><InlineFieldCitations text={card.front} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>
        <button type="button" aria-expanded={Boolean(revealed[index])} onClick={() => setRevealed((current) => ({ ...current, [index]: !current[index] }))}>{revealed[index] ? "Hide answer" : "Reveal answer"}<ChevronDown size={15} aria-hidden="true" /></button>
        {revealed[index] && <div className="phone-tutor__card-answer"><small>Answer</small><p><InlineFieldCitations text={card.back} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>{card.hint && <p><strong>Hint:</strong> <InlineFieldCitations text={card.hint} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>}</div>}
        {card.tags.length > 0 && <div className="phone-tutor__tags">{card.tags.map((tag, tagIndex) => <span key={`${tagIndex}-${tag}`}>{tag}</span>)}</div>}
      </article>)}
      {onCreateFlashcardDrafts && <button className="phone-tutor__primary" type="button" disabled={!selected.length} aria-disabled={["saving", "saved", "exists"].includes(saveState.status) || undefined} onClick={save}><Check size={16} aria-hidden="true" /> {saveState.status === "saved" ? "Added to Review" : saveState.status === "exists" ? "Already in Review" : "Add selected to review"}</button>}
      {saveState.message && <p className={`phone-tutor__save-status is-${saveState.status}`} role="status">{saveState.message}</p>}
    </div>
  );
};

const StudyPlanResult = ({ plan, sources = [], citations = [], onNavigateSource }) => {
  const cite = (text) => <InlineFieldCitations text={text} sources={sources} citations={citations} onNavigateSource={onNavigateSource} />;
  return <div className="phone-tutor__plan"><h4>{plan.title}</h4><p>{cite(plan.goal)}</p><ol>{plan.milestones.map((milestone, index) => <li key={`${index}-${milestone.title}`}><h5>{cite(milestone.title)}</h5><small>{milestone.estimatedMinutes} minutes</small><p>{cite(milestone.outcome)}</p><ul>{milestone.activities.map((activity, activityIndex) => <li key={`${activityIndex}-${activity}`}>{cite(activity)}</li>)}</ul><p><strong>Evidence:</strong> {cite(milestone.evidenceOfMastery)}</p></li>)}</ol>{plan.cautions.length > 0 && <div className="phone-tutor__cautions"><strong>Watch for</strong><ul>{plan.cautions.map((caution, index) => <li key={`${index}-${caution}`}>{cite(caution)}</li>)}</ul></div>}</div>;
};

const AssistantResult = ({ message, onCreateFlashcardDrafts, onNavigateSource, onCopy }) => {
  if (message.task === "quiz" && message.data?.questions) return <QuizResult quiz={message.data} messageId={message.id} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} />;
  if (message.task === "flashcards" && message.data?.cards) return <FlashcardResult cards={message.data.cards} message={message} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} />;
  if (message.task === "study_plan" && message.data?.milestones) return <StudyPlanResult plan={message.data} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} />;
  return <SafeResponse text={message.content} citations={message.citations} sources={message.sources} onNavigateSource={onNavigateSource} onCopy={onCopy} />;
};

const outboundHistory = (history) => selectCompletedPhoneHistory(history, MAX_HISTORY_MESSAGES)
  .map((message) => ({ ...message, content: cleanText(message.content, 600) }));

export default function PhoneLocalAiTutor({ sources = [], insertPrompt = null, onInsertConsumed, retrieveLibrary, engine: providedEngine, initialHistory = [], onHistoryChange, onNavigateSource, onCreateFlashcardDrafts, onSaveAnswerNote, onNotify, onInteractionChange, speech = null }) {
  const engine = useMemo(() => providedEngine || getPhoneLocalAiEngine(), [providedEngine]);
  const promptId = useId();
  const modeDescriptionId = useId();
  const keyHintId = useId();
  // Phones pick the mode from a native select; wider screens show chips.
  const compactModes = useMediaQuery("(max-width: 719px)");
  // Enter sends only with a mouse or trackpad (TFEAT-10).
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const promptFieldRef = useRef(null);
  const headingRef = useRef(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const controllerRef = useRef(null);
  const pendingSearchRef = useRef(null);
  const lastRequestRef = useRef(null);
  const activeUserMessageIdRef = useRef(null);
  const normalizedSources = useMemo(() => normalizePhoneSources(sources), [sources]);
  const initiallySelected = useMemo(() => {
    const requested = normalizedSources.filter((source) => source.selected).slice(0, MAX_SOURCES);
    return (requested.length ? requested : normalizedSources.slice(0, 1)).map((source) => source.id);
  }, [normalizedSources]);
  const [selectedIds, setSelectedIds] = useState(initiallySelected);
  const [modeId, setModeId] = useState("explain");
  const [depth, setDepth] = useState("intermediate");
  const [sourceMode, setSourceMode] = useState("library-first");
  const [responseLength, setResponseLength] = useState("standard");
  const currentMode = PHONE_TUTOR_MODES.find((mode) => mode.id === modeId) || PHONE_TUTOR_MODES[0];
  const [prompt, setPrompt] = useState(currentMode.prompt);
  const [allowSearch, setAllowSearch] = useState(false);
  const [history, setHistory] = useState(() => Array.isArray(initialHistory) ? initialHistory.slice(-MAX_SESSION_MESSAGES) : []);
  const [engineStatus, setEngineStatus] = useState({ state: "checking", loaded: false, supported: false });
  const [requestState, setRequestState] = useState({ status: "idle", message: "" });
  const [streamingText, setStreamingText] = useState("");
  const [pendingSearch, setPendingSearch] = useState(null);
  const [sourceWarning, setSourceWarning] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [savedNoteMessageIds, setSavedNoteMessageIds] = useState(() => new Set());
  const [streamingSources, setStreamingSources] = useState([]);
  const historyRef = useRef(history);
  // Listen (TFEAT-09): which answer the app's speech engine is reading.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const tutorSpeechState = speech?.activeLabel === TUTOR_SPEECH_LABEL && ["speaking", "paused"].includes(speech?.status) ? speech.status : "idle";
  useEffect(() => {
    if (tutorSpeechState === "idle" && speakingMessageId) setSpeakingMessageId("");
  }, [speakingMessageId, tutorSpeechState]);
  const stopTutorSpeech = useCallback(() => {
    if (speechRef.current?.activeLabel === TUTOR_SPEECH_LABEL) speechRef.current.stop();
  }, []);
  useEffect(() => stopTutorSpeech, [stopTutorSpeech]);
  // The end of the conversation, observed so a learner reading elsewhere
  // can jump to a streaming answer or one that just landed (TFEAT-08).
  const conversationEndRef = useRef(null);
  const streamingArticleRef = useRef(null);
  const endInViewRef = useRef(true);
  const [endInView, setEndInView] = useState(true);
  const [readyMessageId, setReadyMessageId] = useState("");
  // Below 981px the fixed bottom navigation covers the bottom of the page.
  const bottomNavLayout = useMediaQuery("(max-width: 980px)");
  const streamBufferRef = useRef("");
  const streamFrameRef = useRef(0);
  historyRef.current = history;

  const currentSources = useMemo(() => {
    const requested = normalizedSources.filter((source) => source.selected);
    return (requested.length ? requested : normalizedSources.slice(0, 1)).slice(0, 1);
  }, [normalizedSources]);
  const manuallySelectedSources = useMemo(() => normalizedSources.filter((source) => selectedIds.includes(source.id)).slice(0, MAX_SOURCES), [normalizedSources, selectedIds]);
  const selectedSources = useMemo(() => (
    sourceMode === "none" || sourceMode === "library-first"
      ? []
      : sourceMode === "current" ? currentSources : manuallySelectedSources
  ), [currentSources, manuallySelectedSources, sourceMode]);
  const preparedContext = useMemo(() => buildPhoneContextBundle(selectedSources), [selectedSources]);
  const selectedLength = RESPONSE_LENGTHS.find((item) => item.id === responseLength) || RESPONSE_LENGTHS[1];
  const previewPayload = useMemo(() => ({
    task: currentMode.task,
    prompt: prompt.trim(),
    context: preparedContext.text,
    contextRanges: preparedContext.ranges,
    documentTitle: phoneDocumentTitle(selectedSources),
    difficulty: depth,
    responseFormat: currentMode.structured ? "structured" : "markdown",
    history: outboundHistory(history),
    maxOutputTokens: currentMode.structured ? 768 : selectedLength.tokens,
  }), [currentMode, depth, history, preparedContext, prompt, selectedLength.tokens, selectedSources]);
  const requestFit = useMemo(() => inspectPhoneLocalAiRequestFit(previewPayload, {
    allowSearchPlanning: allowSearch && sourceMode === "library-first" && typeof retrieveLibrary === "function",
    reserveLibraryEvidence: sourceMode === "library-first" && typeof retrieveLibrary === "function",
  }), [allowSearch, previewPayload, retrieveLibrary, sourceMode]);
  const busy = requestState.status === "running";
  const interactionLocked = busy || Boolean(pendingSearch);
  const lifecycleLocked = interactionLocked || engineStatus.state === "loading" || engineStatus.state === "releasing" || engineStatus.state === "deleting";
  const ready = engineStatus.loaded && !busy && requestState.status !== "awaiting-search" && Boolean(prompt.trim()) && prompt.trim().length <= MAX_PROMPT_CHARS && requestFit.fits;

  const clearStreaming = useCallback(() => {
    if (streamFrameRef.current) cancelAnimationFrame(streamFrameRef.current);
    streamFrameRef.current = 0;
    streamBufferRef.current = "";
    setStreamingText("");
    setStreamingSources([]);
  }, []);

  const queueStreamingText = useCallback((completeText) => {
    streamBufferRef.current = cleanText(completeText, 40_000);
    if (streamFrameRef.current) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      streamFrameRef.current = 0;
      setStreamingText(streamBufferRef.current);
    });
  }, []);

  useEffect(() => {
    const validIds = new Set(normalizedSources.map((source) => source.id));
    setSelectedIds((current) => {
      const retained = current.filter((id) => validIds.has(id)).slice(0, MAX_SOURCES);
      return retained.length ? retained : initiallySelected;
    });
  }, [initiallySelected, normalizedSources]);

  useEffect(() => {
    onInteractionChange?.(lifecycleLocked);
  }, [lifecycleLocked, onInteractionChange]);

  useEffect(() => engine.subscribeLifecycle?.((lifecycle) => {
    setEngineStatus((current) => ({ ...current, ...lifecycle }));
  }), [engine]);

  useEffect(() => {
    onHistoryChange?.(history.slice(-MAX_SESSION_MESSAGES));
  }, [history, onHistoryChange]);

  useEffect(() => {
    if (!pendingSearch?.id) return undefined;
    const expiresInSeconds = Math.max(1, Math.min(300, Number(pendingSearch.expiresInSeconds) || 300));
    const timer = setTimeout(() => {
      if (pendingSearchRef.current?.id !== pendingSearch.id) return;
      pendingSearchRef.current = null;
      setPendingSearch(null);
      void engine.continueAfterSearch(pendingSearch.id, { consent: false }).catch(() => {});
      const activeUserMessageId = activeUserMessageIdRef.current;
      activeUserMessageIdRef.current = null;
      if (activeUserMessageId) setHistory((current) => current.filter((message) => message.id !== activeUserMessageId));
      setRequestState({ status: "declined", message: "The proposed query expired without being sent. Ask again to create a new exact-query approval." });
    }, expiresInSeconds * 1_000);
    return () => clearTimeout(timer);
  }, [engine, pendingSearch]);

  useEffect(() => () => {
    if (streamFrameRef.current) cancelAnimationFrame(streamFrameRef.current);
    controllerRef.current?.abort();
    engine.cancel?.();
    const pending = pendingSearchRef.current;
    pendingSearchRef.current = null;
    if (pending?.id) void engine.continueAfterSearch(pending.id, { consent: false }).catch(() => {});
    const activeUserMessageId = activeUserMessageIdRef.current;
    if (activeUserMessageId) {
      onHistoryChange?.(historyRef.current.filter((message) => message.id !== activeUserMessageId));
      activeUserMessageIdRef.current = null;
    }
    scheduleModelRelease(engine);
    onInteractionChange?.(false);
  }, [engine, onInteractionChange]);

  useEffect(() => {
    const target = conversationEndRef.current;
    if (!target || typeof IntersectionObserver !== "function") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      endInViewRef.current = entry.isIntersecting;
      setEndInView(entry.isIntersecting);
      if (entry.isIntersecting) setReadyMessageId("");
    }, { rootMargin: `0px 0px -${bottomNavLayout ? 80 : 0}px 0px` });
    observer.observe(target);
    return () => observer.disconnect();
  }, [bottomNavLayout]);

  useEffect(() => {
    if (!readyMessageId) return undefined;
    const timer = setTimeout(() => setReadyMessageId(""), 8_000);
    return () => clearTimeout(timer);
  }, [readyMessageId]);

  // Focus for a follow-up: Cancel while it runs, then the answer.
  useEffect(() => {
    if (!busy || !focusCancelRef.current) return;
    focusCancelRef.current = false;
    cancelButtonRef.current?.focus({ preventScroll: true });
  }, [busy]);
  useEffect(() => {
    const id = answerFocusIdRef.current;
    if (!id) return;
    const article = [...document.querySelectorAll(".phone-tutor__message[data-message-id]")].find((node) => node.dataset.messageId === id);
    if (!article) return;
    answerFocusIdRef.current = "";
    article.focus({ preventScroll: true });
  }, [history]);

  // Returning within the release grace period keeps the loaded model.
  useEffect(() => { cancelModelRelease(engine); }, [engine]);

  // Reader "Ask AI" excerpts reach this engine too; each is applied once and
  // is added below an unsent question the learner wrote rather than over it.
  const consumedInsertRef = useRef(null);
  useEffect(() => {
    if (!insertPrompt?.text || consumedInsertRef.current === insertPrompt.nonce) return;
    consumedInsertRef.current = insertPrompt.nonce;
    const lecture = cleanText(insertPrompt.title, 200);
    const inserted = `Explain this excerpt from my lecture${lecture ? ` “${lecture}”` : ""} in context:\n\n"${insertPrompt.text}"`;
    setPrompt((current) => {
      const draft = current.trim();
      const keepDraft = Boolean(draft) && !PHONE_TUTOR_MODES.some((mode) => mode.prompt === draft) && !draft.startsWith("Explain this excerpt from my lecture");
      return cleanText(keepDraft ? `${draft}\n\n${inserted}` : inserted, MAX_PROMPT_CHARS);
    });
    onInsertConsumed?.(insertPrompt.nonce);
    // The device panel above the composer finishes loading after mount, so
    // keep the composer in view until the page settles.
    globalThis.setTimeout?.(() => revealFocusedField(promptFieldRef.current), 0);
  }, [insertPrompt]);

  const answerFocusIdRef = useRef("");
  const focusAnswerRef = useRef(false);
  const finalize = useCallback((result, spec) => {
    const citations = sanitizePhoneCitations(result.citations);
    const content = cleanText(result.outputText, 40_000) || (result.data ? JSON.stringify(result.data, null, 2) : "The on-device model returned no readable content.");
    const sourceUsage = Array.isArray(result.contextFit?.sourceUsage) ? result.contextFit.sourceUsage : null;
    const fittedSources = selectCitablePhoneSources(spec.sources, sourceUsage);
    const sourceTitleMap = new Map(spec.sources.map((source) => [source.id, source.title]));
    const contextFit = result.contextFit && typeof result.contextFit === "object" ? {
      inputBytesUsed: Math.max(0, Number(result.contextFit.inputBytesUsed) || 0),
      inputByteBudget: Math.max(0, Number(result.contextFit.inputByteBudget) || 0),
      contextCharactersProvided: Math.max(0, Number(result.contextFit.contextCharactersProvided) || 0),
      contextCharactersUsed: Math.max(0, Number(result.contextFit.contextCharactersUsed) || 0),
      historyMessagesProvided: Math.max(0, Number(result.contextFit.historyMessagesProvided) || 0),
      historyMessagesUsed: Math.max(0, Number(result.contextFit.historyMessagesUsed) || 0),
      evidenceResultsProvided: Math.max(0, Number(result.contextFit.evidenceResultsProvided) || 0),
      evidenceResultsUsed: Math.max(0, Number(result.contextFit.evidenceResultsUsed) || 0),
      evidenceCharactersProvided: Math.max(0, Number(result.contextFit.evidenceCharactersProvided) || 0),
      evidenceCharactersUsed: Math.max(0, Number(result.contextFit.evidenceCharactersUsed) || 0),
      sourceUsage: (Array.isArray(result.contextFit.sourceUsage) ? result.contextFit.sourceUsage : []).slice(0, 8).map((item) => ({
        id: cleanText(item?.id, 240),
        title: sourceTitleMap.get(item?.id) || cleanText(item?.id, 120) || "Selected source",
        citationNumber: Number.isSafeInteger(item?.citationNumber) && item.citationNumber > 0 ? item.citationNumber : null,
        labelSupplied: item?.labelSupplied === true,
        charactersProvided: Math.max(0, Number(item?.charactersProvided) || 0),
        charactersUsed: Math.max(0, Number(item?.charactersUsed) || 0),
      })).filter((item) => item.id),
      citedSourceIndexes: Array.isArray(result.contextFit.citedSourceIndexes) ? result.contextFit.citedSourceIndexes.filter(Number.isSafeInteger).slice(0, 8) : [],
      citedEvidenceIndexes: Array.isArray(result.contextFit.citedEvidenceIndexes) ? result.contextFit.citedEvidenceIndexes.filter(Number.isSafeInteger).slice(0, 5) : [],
      truncated: result.contextFit.truncated === true,
    } : null;
    const message = {
      id: createId(), role: "assistant", task: spec.payload.task, mode: spec.mode.id,
      content, data: result.data || null, citations, sources: fittedSources, contextFit,
      sourceMode: spec.sourceMode,
      retrievalTrace: spec.retrievalTrace || null,
      requestUserMessageId: spec.userMessageId,
    };
    activeUserMessageIdRef.current = null;
    // A follow-up's button is gone; its answer takes focus when it lands.
    if (focusAnswerRef.current) {
      focusAnswerRef.current = false;
      answerFocusIdRef.current = message.id;
    }
    // Offered by the "Answer ready" pill when it lands out of view.
    if (!endInViewRef.current) setReadyMessageId(message.id);
    setHistory((current) => [...current.filter((item) => item.id !== spec.replaceAssistantId), message].slice(-MAX_SESSION_MESSAGES));
    clearStreaming();
    pendingSearchRef.current = null;
    setPendingSearch(null);
    setRequestState({ status: "success", message: citations.length ? `Answered locally with ${citations.length} cited web source${citations.length === 1 ? "" : "s"}. Check the links before relying on a current claim.` : contextFit?.truncated ? "Answered locally after fitting the selected material to the phone's 4K context window; see the context note below." : "Answered locally on this device." });
  }, [clearStreaming]);

  const run = useCallback(async (spec, { appendUser = true } = {}) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    // A new question stops an answer being read aloud.
    stopTutorSpeech();
    let effectiveSpec = spec;
    const previousActiveUserMessageId = activeUserMessageIdRef.current;
    // Ordinary submissions/retries own an unanswered user turn and may remove
    // it on decline or unmount. Regeneration reuses an already completed turn;
    // never mark that durable question as an orphan if regeneration fails.
    activeUserMessageIdRef.current = spec.preserveUserOnFailure === true ? null : spec.userMessageId;
    if (appendUser) setHistory((current) => [
      ...current.filter((message) => message.id !== previousActiveUserMessageId && message.id !== spec.userMessageId),
      { id: spec.userMessageId, role: "user", task: spec.payload.task, mode: spec.mode.id, content: spec.displayPrompt, data: null, citations: [], sources: spec.sources },
    ].slice(-MAX_SESSION_MESSAGES));
    pendingSearchRef.current = null;
    setPendingSearch(null);
    clearStreaming();
    setRequestState({ status: "running", message: spec.sourceMode === "library-first" ? "Searching your local library…" : "Preparing grounded context…" });
    try {
      if (spec.sourceMode === "library-first" && typeof retrieveLibrary === "function") {
        try {
          // A follow-up names no topic; it searches with the question it follows.
          const retrieval = await retrieveLibrary(spec.retrievalQuery || spec.displayPrompt, {
            signal: controller.signal,
            maxCandidateDocuments: 8,
            maxDocuments: MAX_SOURCES,
            maxPassages: MAX_SOURCES,
            maxPassagesPerDocument: 1,
            maxBytes: 4_400,
            maxPassageBytes: 2_400,
          });
          const retrievedSources = normalizeRetrievedPhoneSources(retrieval, normalizedSources);
          const contextBundle = buildPhoneContextBundle(retrievedSources);
          const sourceSnapshot = retrievedSources.map(({ id, documentId, title, section, anchor, original }) => ({ id, documentId, title, section, anchor, original }));
          const retrievalTrace = normalizeRetrievalTrace(retrieval?.trace);
          const useWebFallback = shouldUseWebFallback({ learnerAllowedWeb: spec.allowSearch, trace: retrieval?.trace });
          effectiveSpec = {
            ...spec,
            sources: sourceSnapshot,
            retrievalTrace,
            allowSearch: useWebFallback,
            payload: {
              ...spec.payload,
              context: contextBundle.text,
              contextRanges: contextBundle.ranges,
              documentTitle: sourceSnapshot.length === 1 ? cleanText(sourceSnapshot[0].title, 80) || "Retrieved library passage" : sourceSnapshot.length ? `${sourceSnapshot.length} retrieved library passages` : "General AI/ML question",
            },
          };
          setStreamingSources(sourceSnapshot);
          setRequestState({
            status: "running",
            message: useWebFallback
              ? "Local evidence is weak or time-sensitive; preparing an exact web query for your approval…"
              : sourceSnapshot.length
                ? "Library evidence ready. Generating locally without web egress…"
                : "No library match. Generating from local model knowledge without web egress…",
          });
        } catch (retrievalError) {
          if (controller.signal.aborted) throw retrievalError;
          effectiveSpec = {
            ...spec,
            sources: [],
            allowSearch: spec.allowSearch,
            retrievalTrace: {
              strategy: "library-first",
              candidates: null,
              matchedDocuments: null,
              passages: 0,
              confidenceLevel: "unavailable",
              confidenceScore: null,
              budgetTruncated: false,
              webFallbackRecommended: true,
              webFallbackCode: "library_retrieval_unavailable",
              webFallbackReason: "The local library index was unavailable for this request.",
            },
            payload: { ...spec.payload, context: "", contextRanges: [], documentTitle: "General AI/ML question" },
          };
          setStreamingSources([]);
          setRequestState({ status: "running", message: spec.allowSearch ? "Library search was unavailable; preparing an exact web query for your approval…" : "Library search was unavailable. Generating locally with no web egress…" });
        }
      } else {
        setStreamingSources(spec.sources);
        // Current/choose/no-library are explicit scope overrides. Web fallback
        // remains off because no full-library sufficiency decision was made.
        effectiveSpec = { ...spec, allowSearch: false, retrievalTrace: null };
      }
      const result = await engine.prepareResponse(effectiveSpec.payload, {
        signal: controller.signal,
        allowSearchPlanning: effectiveSpec.allowSearch,
        webFallbackReason: effectiveSpec.retrievalTrace?.webFallbackReason || "",
        onToken: (_token, completeText) => queueStreamingText(completeText),
      });
      if (result.status === "search_consent_required") {
        const proposed = { ...result.search, spec: effectiveSpec };
        pendingSearchRef.current = proposed;
        setPendingSearch(proposed);
        clearStreaming();
        setRequestState({ status: "awaiting-search", message: "A web search was proposed. Nothing has been sent to search yet." });
      } else {
        finalize(result, effectiveSpec);
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.code === "LOCAL_AI_CANCELLED";
      clearStreaming();
      focusAnswerRef.current = false;
      setRequestState({ status: cancelled ? "cancelled" : "error", message: cancelled ? "Generation was cancelled. No partial answer was saved." : cleanText(error?.message, 500) || "The on-device request failed." });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [clearStreaming, engine, finalize, normalizedSources, queueStreamingText, retrieveLibrary, stopTutorSpeech]);

  // A follow-up overrides the prompt, mode and retrieval words; it never
  // arms the web.
  const createSpec = (userMessageId = createId(), overrides = {}) => {
    const sourceSnapshot = selectedSources.map(({ id, documentId, title, section, anchor, original }) => ({ id, documentId, title, section, anchor, original }));
    const trimmedPrompt = String(overrides.prompt ?? prompt).trim();
    const mode = overrides.mode || currentMode;
    return {
      userMessageId,
      displayPrompt: trimmedPrompt,
      mode,
      sources: sourceSnapshot,
      sourceMode,
      retrievalTrace: null,
      retrievalQuery: cleanText(overrides.retrievalQuery, 300),
      allowSearch: overrides.allowSearch ?? allowSearch,
      // Retry sends a follow-up again, not whatever the box holds by then.
      overrides: overrides.prompt === undefined ? null : overrides,
      payload: {
        task: mode.task,
        prompt: trimmedPrompt,
        context: preparedContext.text,
        contextRanges: preparedContext.ranges,
        documentTitle: phoneDocumentTitle(selectedSources),
        difficulty: depth,
        responseFormat: mode.structured ? "structured" : "markdown",
        history: outboundHistory(history),
        maxOutputTokens: mode.structured ? 768 : selectedLength.tokens,
      },
    };
  };

  const submit = (event) => {
    event?.preventDefault?.();
    if (!ready) return;
    const spec = createSpec();
    lastRequestRef.current = spec;
    run(spec);
  };

  // A follow-up runs at once when the model is loaded and it fits;
  // otherwise its question is put in the box, where the reason shows.
  const focusCancelRef = useRef(false);
  const cancelButtonRef = useRef(null);
  const runFollowUp = (message, item) => {
    if (interactionLocked) return;
    const mode = PHONE_TUTOR_MODES.find((candidate) => candidate.id === item.modeId) || PHONE_TUTOR_MODES[0];
    const index = history.findIndex((candidate) => candidate.id === message.id);
    const question = [...history.slice(0, Math.max(0, index))].reverse().find((candidate) => candidate.role === "user");
    const spec = createSpec(createId(), { prompt: item.prompt, mode, retrievalQuery: withoutCitationLabels(question?.content), allowSearch: false });
    const fits = inspectPhoneLocalAiRequestFit(spec.payload, {
      allowSearchPlanning: false,
      reserveLibraryEvidence: sourceMode === "library-first" && typeof retrieveLibrary === "function",
    }).fits;
    if (!engineStatus.loaded || requestState.status === "awaiting-search" || !fits) {
      setModeId(mode.id);
      setPrompt(cleanText(item.prompt, MAX_PROMPT_CHARS));
      setRequestState({ status: "idle", message: "" });
      globalThis.setTimeout?.(() => revealFocusedField(promptFieldRef.current), 0);
      return;
    }
    lastRequestRef.current = spec;
    focusCancelRef.current = true;
    focusAnswerRef.current = true;
    run(spec);
  };

  const approveSearch = async () => {
    if (!pendingSearch || controllerRef.current) return;
    const approved = pendingSearch;
    // Consent has now been consumed and the exact query may leave the device.
    // Remove the card immediately so a second tap cannot falsely "decline" a
    // request that is already in flight.
    pendingSearchRef.current = null;
    setPendingSearch(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    clearStreaming();
    setStreamingSources(approved.spec.sources);
    setRequestState({ status: "running", message: `Searching only for: “${approved.query}”` });
    try {
      const result = await engine.continueAfterSearch(approved.id, {
        consent: true,
        signal: controller.signal,
        onToken: (_token, completeText) => queueStreamingText(completeText),
      });
      finalize(result, approved.spec);
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.code === "LOCAL_AI_CANCELLED";
      clearStreaming();
      setRequestState({ status: cancelled ? "cancelled" : "error", message: cancelled ? "Search and generation were cancelled." : cleanText(error?.message, 500) || "The approved search failed." });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const declineSearch = async () => {
    if (!pendingSearch || controllerRef.current) return;
    const declined = pendingSearch;
    pendingSearchRef.current = null;
    setPendingSearch(null);
    try { await engine.continueAfterSearch(declined.id, { consent: false }); } catch { /* the one-use plan is already safely discarded */ }
    const activeUserMessageId = activeUserMessageIdRef.current;
    activeUserMessageIdRef.current = null;
    if (activeUserMessageId) setHistory((current) => current.filter((message) => message.id !== activeUserMessageId));
    setRequestState({ status: "declined", message: `Search declined. “${declined.query}” was not sent to the search service.` });
  };

  const cancel = () => {
    controllerRef.current?.abort();
    engine.cancel?.();
  };

  const keyHint = composerKeyHint({ finePointer, platform: currentPlatform() });
  const onPromptKeyDown = (event) => {
    if (composerEnterAction(event, { finePointer }) === "send") {
      event.preventDefault();
      submit(event);
      return;
    }
    if (!shouldRecallLastQuestion(event, event.currentTarget)) return;
    const lastQuestion = [...history].reverse().find((message) => message.role === "user");
    if (!lastQuestion) return;
    event.preventDefault();
    if (PHONE_TUTOR_MODES.some((mode) => mode.id === lastQuestion.mode)) setModeId(lastQuestion.mode);
    setPrompt(cleanText(lastQuestion.content, MAX_PROMPT_CHARS));
    setRequestState({ status: "idle", message: "" });
  };
  // Esc stops a running answer from anywhere in this tutor, except from the
  // Clear dialog or an open disclosure.
  const stopOnEscape = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !busy || confirmClearOpen) return;
    if (event.target?.closest?.("details[open], [role='dialog'], [role='alertdialog']")) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  const jumpLabel = busy && streamingText && !endInView
    ? "Jump to latest"
    : readyMessageId && !endInView && history.some((message) => message.id === readyMessageId) ? "Answer ready" : "";
  const jumpToLatest = () => {
    const topbar = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
    if (busy && streamingArticleRef.current) {
      const limit = window.innerHeight - (bottomNavLayout ? 92 : 16);
      const bottom = conversationEndRef.current?.getBoundingClientRect().bottom ?? limit;
      window.scrollBy({ top: bottom - limit, behavior: scrollBehavior() });
      streamingArticleRef.current.focus({ preventScroll: true });
      return;
    }
    const article = [...document.querySelectorAll(".phone-tutor__message[data-message-id]")].find((node) => node.dataset.messageId === readyMessageId);
    setReadyMessageId("");
    if (!article) return;
    window.scrollBy({ top: article.getBoundingClientRect().top - topbar - 12, behavior: scrollBehavior() });
    article.focus({ preventScroll: true });
  };

  const retry = () => {
    if (!lastRequestRef.current || controllerRef.current || !engineStatus.loaded) return;
    const rebuilt = createSpec(lastRequestRef.current.userMessageId, lastRequestRef.current.overrides || {});
    lastRequestRef.current = rebuilt;
    run(rebuilt);
  };

  const regenerate = (message) => {
    const spec = lastRequestRef.current;
    if (!spec || controllerRef.current || !engineStatus.loaded || message.requestUserMessageId !== spec.userMessageId) return;
    const regeneratedSpec = { ...spec, replaceAssistantId: message.id, preserveUserOnFailure: true };
    lastRequestRef.current = regeneratedSpec;
    run(regeneratedSpec, { appendUser: false });
  };

  // Copy and Save use readable Markdown: exact code and math, structured
  // results as the learner saw them, and a list resolving [S#]/[W#] labels.
  const messageMarkdown = (message, includeSources = true) => tutorMessageMarkdown({
    role: "assistant",
    content: message.content,
    data: message.data,
    citationSources: message.sources || [],
    webSources: message.citations || [],
  }, { includeSources });

  const copyMessage = async (message) => {
    const copied = await writeClipboard(messageMarkdown(message));
    setCopiedMessageId(copied ? message.id : "");
    onNotify?.(copied ? "Answer copied as Markdown." : "This browser did not allow clipboard access.", copied ? "success" : "error");
    if (copied) globalThis.setTimeout?.(() => setCopiedMessageId((current) => current === message.id ? "" : current), 1_800);
  };

  const saveMessageNote = (message) => {
    if (typeof onSaveAnswerNote !== "function") return;
    const saved = onSaveAnswerNote({
      content: messageMarkdown(message, false),
      title: `AI ${(PHONE_TUTOR_MODES.find((mode) => mode.task === message.task)?.label || "tutor").toLocaleLowerCase()} answer (on-device)`,
      citationSources: message.sources || [],
      webSources: (message.citations || []).map(({ index, title, url }) => ({ index, title, url })),
    });
    if (saved) setSavedNoteMessageIds((current) => new Set([...current, message.id]));
  };

  const selectMode = (nextId) => {
    const next = PHONE_TUTOR_MODES.find((mode) => mode.id === nextId) || PHONE_TUTOR_MODES[0];
    const previousDefault = currentMode.prompt;
    setModeId(next.id);
    setPrompt((value) => !value.trim() || value === previousDefault ? next.prompt : value);
    setRequestState({ status: "idle", message: "" });
  };

  const selectSourceMode = (nextMode) => {
    if (!PHONE_SOURCE_MODES.some((mode) => mode.id === nextMode) || interactionLocked) return;
    setSourceMode(nextMode);
    if (nextMode !== "library-first") setAllowSearch(false);
    setSourceWarning("");
    setRequestState({ status: "idle", message: "" });
  };

  const toggleSource = (id) => {
    setSelectedIds((current) => {
      if (current.includes(id)) { setSourceWarning(""); return current.filter((item) => item !== id); }
      if (current.length >= MAX_SOURCES) { setSourceWarning(`On-device Lite can ground one request in at most ${MAX_SOURCES} sources.`); return current; }
      setSourceWarning("");
      return [...current, id];
    });
  };

  // Completed prose answers can be heard; speak() runs inside the click so
  // iOS treats it as the learner's gesture.
  const listenControls = (message) => {
    if (!speech || speech.status === "unsupported" || message.data) return null;
    const state = speakingMessageId === message.id ? tutorSpeechState : "idle";
    if (state === "idle") {
      return <button type="button" onClick={() => {
        const spoken = tutorSpeechText(message.content);
        const started = spoken.text && speech.speak(spoken.text, { label: TUTOR_SPEECH_LABEL, sections: spoken.sections });
        setSpeakingMessageId(started ? message.id : "");
        if (!started) onNotify?.("This answer could not be read aloud on this device.", "error");
      }}><Volume2 size={14} aria-hidden="true" />Listen<span className="visually-hidden"> to this answer</span></button>;
    }
    return <>
      <button type="button" onClick={() => speech.togglePause()}>{state === "paused" ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{state === "paused" ? "Resume" : "Pause"}<span className="visually-hidden"> reading this answer</span></button>
      <button type="button" onClick={() => { speech.stop(); setSpeakingMessageId(""); }}><Square size={12} aria-hidden="true" />Stop<span className="visually-hidden"> reading</span></button>
    </>;
  };

  return (
    <section className="phone-tutor" aria-labelledby="phone-tutor-title" onKeyDown={stopOnEscape}>
      <header className="phone-tutor__header">
        <div className="phone-tutor__identity"><span><Cpu size={23} aria-hidden="true" /></span><div><small>Built with Llama · Safari WebGPU · experimental</small><h2 id="phone-tutor-title" ref={headingRef} tabIndex={-1}>Lumen On-device Lite</h2></div></div>
        {history.length > 0 && <button className="phone-tutor__icon-button" type="button" aria-label="Clear on-device session conversation" title="Clear session" disabled={interactionLocked} onClick={() => setConfirmClearOpen(true)}><Trash2 size={18} /></button>}
      </header>

      <details className="phone-tutor__disclosure"><summary>Privacy and session details</summary><p>Answers run on this device. This conversation clears on reload and is excluded from backups. {PHONE_LOCAL_AI_DISCLOSURE.inference} Web searches require approval of the exact query. <a href="./licenses/LLAMA_3_2_COMMUNITY_LICENSE.txt" target="_blank" rel="noopener noreferrer">Llama 3.2 license</a>.</p></details>

      <PhoneLocalAiSettings engine={engine} onNotify={onNotify} onStatusChange={setEngineStatus} interactionBusy={interactionLocked} />

      {compactModes ? (
        <label className="phone-tutor__mode-select">
          <span>Mode</span>
          <select value={modeId} disabled={interactionLocked} aria-describedby={modeDescriptionId} onChange={(event) => selectMode(event.target.value)}>
            {PHONE_TUTOR_MODES.map((mode) => <option value={mode.id} key={mode.id}>{mode.label}</option>)}
          </select>
        </label>
      ) : (
        <div className="phone-tutor__mode-tabs" role="group" aria-label="On-device tutor mode" aria-describedby={modeDescriptionId}>
          {PHONE_TUTOR_MODES.map((mode) => <button type="button" aria-pressed={mode.id === modeId} className={mode.id === modeId ? "is-selected" : ""} disabled={interactionLocked} onClick={() => selectMode(mode.id)} key={mode.id}>{mode.label}</button>)}
        </div>
      )}
      <p className="phone-tutor__mode-description" id={modeDescriptionId}>{currentMode.description}</p>

      <div className="phone-tutor__layout">
        <aside className="phone-tutor__sources">
          <details>
            <summary><span><BookOpen size={17} aria-hidden="true" /><strong>Grounding</strong></span><small>{PHONE_SOURCE_MODES.find((mode) => mode.id === sourceMode)?.label}</small></summary>
            <div className="phone-tutor__source-modes" role="radiogroup" aria-label="Grounding scope">
              {PHONE_SOURCE_MODES.map((mode) => <button type="button" role="radio" aria-checked={sourceMode === mode.id} className={sourceMode === mode.id ? "is-selected" : ""} disabled={interactionLocked || (mode.id === "library-first" && typeof retrieveLibrary !== "function")} onClick={() => selectSourceMode(mode.id)} key={mode.id}><strong>{mode.label}</strong><small>{mode.short}</small></button>)}
            </div>
            {sourceMode === "library-first" && <p className="phone-tutor__library-first"><Search size={16} aria-hidden="true" /><span>Relevant passages are selected from your library on this device.</span></p>}
            {sourceMode === "current" && currentSources.length > 0 && <div className="phone-tutor__source-list">{currentSources.map((source) => <article className="is-selected" key={source.id}><span><strong>{source.title}</strong>{source.section && <small>{source.section}</small>}<small>{source.text.length.toLocaleString()} characters available</small></span>{onNavigateSource && <button type="button" aria-label={`Open ${source.title}`} onClick={() => onNavigateSource(source.original, { sourceId: source.id })}><ExternalLink size={16} /></button>}</article>)}</div>}
            {sourceMode === "choose" && (normalizedSources.length ? <div className="phone-tutor__source-list">{normalizedSources.map((source) => <article className={selectedIds.includes(source.id) ? "is-selected" : ""} key={source.id}><label><input type="checkbox" checked={selectedIds.includes(source.id)} disabled={interactionLocked} onChange={() => toggleSource(source.id)} /><span><strong>{source.title}</strong>{source.section && <small>{source.section}</small>}<small>{source.text.length.toLocaleString()} characters available</small></span></label>{onNavigateSource && <button type="button" aria-label={`Open ${source.title}`} onClick={() => onNavigateSource(source.original, { sourceId: source.id })}><ExternalLink size={16} /></button>}</article>)}</div> : <p className="phone-tutor__empty"><WifiOff size={18} /> No loaded lesson source is available. Choose Library first to search the complete local index.</p>)}
            {sourceMode === "none" && <p className="phone-tutor__empty"><WifiOff size={18} /> No lesson text will be supplied. The 1B model may be incomplete or wrong; use this only for general questions.</p>}
            {sourceWarning && <p className="phone-tutor__error" role="alert">{sourceWarning}</p>}
            <p className="phone-tutor__source-budget">Long excerpts may be shortened to fit the model.</p>
          </details>
        </aside>

        <section className="phone-tutor__conversation" aria-label="Conversation">
          {history.length === 0 && !streamingText ? <div className="phone-tutor__welcome"><Cpu size={27} aria-hidden="true" /><h3>What would you like to learn?</h3><p>Ask a short question or choose a study mode.</p></div> : (
            <div className="phone-tutor__messages" aria-live="polite" aria-relevant="additions">
              {history.map((message, index) => (
                <article className={`phone-tutor__message is-${message.role}`} key={message.id} data-message-id={message.id} tabIndex={message.role === "assistant" ? -1 : undefined}>
                  <h3 className="visually-hidden">{message.role === "assistant" ? "On-device answer" : "Your question"}, {PHONE_TUTOR_MODES.find((mode) => mode.task === message.task)?.label || "Tutor"}</h3>
                  <div className="phone-tutor__message-meta"><span><strong>{message.role === "assistant" ? "On-device Lite" : "You"}</strong><small>{PHONE_TUTOR_MODES.find((mode) => mode.task === message.task)?.label || "Tutor"}</small></span>{message.role === "assistant" && <div className="phone-tutor__message-actions"><button type="button" aria-label="Copy this on-device answer" onClick={() => copyMessage(message)}><Copy size={14} aria-hidden="true" />{copiedMessageId === message.id ? "Copied" : "Copy"}</button>{typeof onSaveAnswerNote === "function" && <button type="button" aria-label={savedNoteMessageIds.has(message.id) ? "Saved to notes" : "Save to notes: this answer becomes a labeled AI note in your notebook"} disabled={savedNoteMessageIds.has(message.id)} onClick={() => saveMessageNote(message)}><NotebookPen size={14} aria-hidden="true" />{savedNoteMessageIds.has(message.id) ? "Saved" : "Save"}</button>}{message.requestUserMessageId === lastRequestRef.current?.userMessageId && <button type="button" aria-label="Regenerate this on-device answer" disabled={interactionLocked || !engineStatus.loaded} onClick={() => regenerate(message)}><RotateCcw size={14} aria-hidden="true" />Regenerate</button>}{listenControls(message)}</div>}</div>
                  {message.role === "assistant" ? <AssistantResult message={{ ...message, sources: message.sources || [], citations: message.citations || [] }} onCreateFlashcardDrafts={onCreateFlashcardDrafts} onNavigateSource={onNavigateSource} onCopy={(copied) => onNotify?.(copied ? "Code copied." : "This browser did not allow clipboard access.", copied ? "success" : "error")} /> : <p className="phone-tutor__user-text">{message.content}</p>}
                  {message.role === "assistant" && <EvidenceDetails message={{ ...message, sources: message.sources || [], citations: message.citations || [] }} onNavigateSource={onNavigateSource} />}
                  {message.role === "assistant" && index === history.length - 1 && !message.data && !busy && !streamingText && (
                    <div className="phone-tutor__follow-ups" role="group" aria-label="Follow up on this answer">
                      {PHONE_FOLLOW_UPS.map((item) => <button type="button" disabled={interactionLocked} onClick={() => runFollowUp(message, item)} key={item.id}>{item.label}</button>)}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {streamingText && <article className="phone-tutor__message is-assistant is-streaming" aria-label="Streaming on-device answer" tabIndex={-1} ref={streamingArticleRef}><div className="phone-tutor__message-meta"><span><strong>On-device Lite</strong><small>Generating token by token…</small></span></div><SafeResponse text={streamingText} sources={streamingSources} onNavigateSource={onNavigateSource} onCopy={(copied) => onNotify?.(copied ? "Code copied." : "This browser did not allow clipboard access.", copied ? "success" : "error")} streaming /></article>}
          {busy && <div className="phone-tutor__working" role="status"><span><LoaderCircle className="spin" size={18} aria-hidden="true" />{requestState.message}</span><button type="button" ref={cancelButtonRef} onClick={cancel}><CircleStop size={16} aria-hidden="true" /> Cancel</button></div>}

          {pendingSearch && <section className="phone-tutor__search-consent" aria-labelledby="phone-search-title">
            <div><Search size={20} aria-hidden="true" /><div><h3 id="phone-search-title">Approve this exact web search?</h3><p>{pendingSearch.reason}</p></div></div>
            <dl><dt>Query that will leave this device</dt><dd><code dir="auto">{pendingSearch.query}</code></dd></dl>
            <p>{pendingSearch.disclosure} This one-use approval expires in at most {Math.max(1, Math.min(300, Number(pendingSearch.expiresInSeconds) || 300))} seconds.</p>
            <div><button className="phone-tutor__primary" type="button" onClick={approveSearch}><Search size={16} aria-hidden="true" /> Send this query & search</button><button type="button" onClick={declineSearch}>Decline — send nothing</button></div>
          </section>}

          {["error", "cancelled", "declined", "success"].includes(requestState.status) && requestState.message && <div className={`phone-tutor__request-state is-${requestState.status}`} role={requestState.status === "error" ? "alert" : "status"}>{requestState.status === "error" && <AlertTriangle size={18} aria-hidden="true" />}<span>{requestState.message}</span>{["error", "cancelled"].includes(requestState.status) && lastRequestRef.current && <button type="button" disabled={!engineStatus.loaded || !requestFit.fits} title={!engineStatus.loaded ? "Load the on-device model again before retrying" : !requestFit.fits ? requestFit.message : undefined} onClick={retry}><RefreshCw size={15} aria-hidden="true" /> Retry</button>}</div>}
          <div className="phone-tutor__conversation-end" ref={conversationEndRef} aria-hidden="true" />
          {jumpLabel && <button className="phone-tutor__jump" type="button" onClick={jumpToLatest}><ArrowDown size={16} aria-hidden="true" /> {jumpLabel}</button>}
        </section>
      </div>

      <form className="phone-tutor__composer" onSubmit={submit}>
        <div className="phone-tutor__composer-head"><div><label><span>Depth</span><select value={depth} disabled={interactionLocked} onChange={(event) => setDepth(event.target.value)}>{DEPTHS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label><span>Answer length</span><select value={responseLength} disabled={interactionLocked || currentMode.structured} onChange={(event) => setResponseLength(event.target.value)}>{RESPONSE_LENGTHS.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.tokens} tokens</option>)}</select></label></div><span>{PHONE_LOCAL_MODEL.label}</span></div>
        <label className={`phone-tutor__search-toggle ${allowSearch ? "is-enabled" : ""}`}><input type="checkbox" checked={allowSearch} disabled={interactionLocked || sourceMode !== "library-first" || typeof retrieveLibrary !== "function"} onChange={(event) => setAllowSearch(event.target.checked)} /><span><strong>Allow current-web fallback</strong><small>{sourceMode === "library-first" && typeof retrieveLibrary === "function" ? "You approve the exact query before it is sent." : "Select Library first to use web fallback."}</small></span></label>
        <label className="phone-tutor__prompt-label" htmlFor={promptId}>What should the on-device tutor help you learn?</label>
        <textarea ref={promptFieldRef} id={promptId} rows={4} maxLength={MAX_PROMPT_CHARS} value={prompt} disabled={interactionLocked} placeholder={`Ask for ${currentMode.label.toLowerCase()} help…`} onChange={(event) => { setPrompt(event.target.value); if (["error", "cancelled", "declined"].includes(requestState.status)) setRequestState({ status: "idle", message: "" }); }} aria-describedby={keyHint ? keyHintId : undefined} onKeyDown={onPromptKeyDown} />
        <div className="phone-tutor__composer-foot"><span>{prompt.trim().length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}</span>{keyHint && <span className="phone-tutor__key-hint" id={keyHintId}>{keyHint}</span>}<span>{sourceMode === "library-first" ? "Up to 2 passages retrieved at send time" : `${buildPhoneContext(selectedSources).length.toLocaleString()} pre-fit source characters`}</span></div>
        <div className="phone-tutor__send-row"><div><strong>Runs locally after the model is loaded.</strong><small>{currentMode.structured ? "Structured output is validated before it is shown; it does not stream partial JSON." : "The answer streams from the phone model as tokens arrive."}</small></div><button className="phone-tutor__primary" type="submit" disabled={!ready}><Send size={17} aria-hidden="true" /> Generate {currentMode.label}</button></div>
        {!engineStatus.loaded && <p className="phone-tutor__disabled-reason">Load the model above to start.</p>}
        {engineStatus.loaded && Boolean(prompt.trim()) && !requestFit.fits && <p className="phone-tutor__disabled-reason" role="alert">{requestFit.message}</p>}
      </form>

      <TutorConfirmDialog
        open={confirmClearOpen}
        title="Clear this on-device session?"
        body="This removes the on-device conversation from this tab. Your lessons, notes and review cards are not deleted."
        confirmLabel="Clear session"
        onConfirm={() => {
          setConfirmClearOpen(false);
          activeUserMessageIdRef.current = null;
          stopTutorSpeech();
          setHistory([]);
          lastRequestRef.current = null;
          setRequestState({ status: "idle", message: "" });
          // The Clear button disappears with the conversation.
          globalThis.setTimeout?.(() => headingRef.current?.focus(), 0);
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </section>
  );
}
