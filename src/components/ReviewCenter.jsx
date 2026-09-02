import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportReviewCards } from "../lib/cardInterchange.js";
import { INTERVIEW_ANSWER_SECONDS, INTERVIEW_PREP_SECONDS, selectInterviewRound } from "../lib/interview.js";
import { ROUND_TYPES, buildTrackRound, normalizeTrackBank } from "../lib/interviewTracks.js";
import { checkLabAnswer, labMistakeDraft, normalizeLabBank } from "../lib/labs.js";
import { MISTAKE_CATEGORIES, mistakeAnalytics } from "../lib/mistakes.js";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Edit3,
  Eye,
  FilePlus2,
  Flame,
  Gauge,
  History,
  Pause,
  Play,
  RotateCcw,
  Search,
  TimerReset,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { renderMarkdown } from "../lib/markdown";
import { retentionWorkloadCurve } from "../lib/retentionPlanner.js";
import {
  buildReviewQueue,
  currentTimeZone,
  classifyReviewItem,
  formatInterval,
  hasClozeMarkup,
  renderClozePrompt,
  formatLatency,
  getTodayReviewUsage,
  isNewReviewItem,
  previewReviewIntervals,
  REVIEW_CARD_TYPES,
  REVIEW_RATINGS,
  reviewAnalytics,
  reviewStats,
} from "../lib/review";

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
const REVIEW_DECK_PAGE_SIZE = 24;

export function ReviewCardDialog({ draft, onClose, onSave }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tags, setTags] = useState("");
  const [type, setType] = useState("basic");
  const [preview, setPreview] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!draft) return undefined;
    setFront(draft.front || "");
    setBack(draft.back || "");
    setTags((draft.tags || []).join(", "));
    setType(REVIEW_CARD_TYPES.some((entry) => entry.id === draft.type) ? draft.type : "basic");
    setPreview(false);
    const previous = document.activeElement;
    dialogRef.current?.querySelector("textarea")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // This cleanup runs during child unmount, before the host un-inerts the
      // background; focusing an inert opener is a silent no-op, so defer a
      // frame (BUG-003 focus-restoration defect).
      const target = previous;
      requestAnimationFrame(() => {
        if (target?.isConnected && !target.closest?.("[inert]")) target.focus?.();
        else if (target?.isConnected) requestAnimationFrame(() => { if (target.isConnected) target.focus?.(); });
      });
    };
  }, [draft, onClose]);

  if (!draft) return null;
  const submit = (event) => {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    onSave({
      ...draft,
      type,
      front: front.trim(),
      back: back.trim(),
      tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
    });
  };
  const editing = Boolean(draft.id);

  return (
    <div className="modal-layer review-dialog-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Close review card dialog" type="button" />
      <form ref={dialogRef} className="review-card-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="review-card-dialog-title">
        <button className="icon-button review-dialog-close" onClick={onClose} aria-label="Close review card dialog" type="button"><X size={19} /></button>
        <div className="dialog-icon"><Brain size={22} /></div>
        <span className="eyebrow">Active recall</span>
        <h2 id="review-card-dialog-title">{editing ? "Edit review card" : "Create a review card"}</h2>
        <p>Use one precise retrieval task. Markdown, fenced code, and formulas are preserved and rendered safely.</p>
        <div className="review-dialog-toolbar">
          <label><span>Card type</span><select value={type} onChange={(event) => setType(event.target.value)}>{REVIEW_CARD_TYPES.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>{type === "cloze" && <small className="cloze-hint">Wrap the hidden text in {"{{double braces}}"} — it shows as a blank until you reveal the answer.</small>}
          <button className={preview ? "button secondary active" : "button ghost"} onClick={() => setPreview((value) => !value)} aria-pressed={preview} type="button"><Eye size={16} /> {preview ? "Edit fields" : "Preview"}</button>
        </div>
        {preview ? (
          <div className="review-markdown-preview" aria-label="Review card Markdown preview">
            <span>Prompt</span><div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(front || "*No prompt yet*") }} />
            <span>Answer</span><div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(back || "*No answer yet*") }} />
          </div>
        ) : (
          <>
            <label><span>Prompt</span><textarea value={front} maxLength={10_000} onChange={(event) => setFront(event.target.value)} placeholder="What should you be able to explain without looking?" required /></label>
            <label><span>Answer</span><textarea value={back} maxLength={20_000} onChange={(event) => setBack(event.target.value)} placeholder="Write the minimum complete answer…" required /></label>
          </>
        )}
        <label><span>Tags <small>optional, comma separated</small></span><input className="text-input" value={tags} maxLength={500} onChange={(event) => setTags(event.target.value)} placeholder="transformers, interview, fundamentals" /></label>
        {draft.sourceTitle && <p className="review-source-note"><BookOpen size={15} /> Linked to {draft.sourceTitle}</p>}
        <div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!front.trim() || !back.trim()} type="submit">{editing ? "Save changes" : "Add to review"}</button></div>
      </form>
    </div>
  );
}

/** Manual mistake capture (LEARN-005): log an error you caught yourself. */
export function MistakeDialog({ open, onClose, onLog }) {
  const [prompt, setPrompt] = useState("");
  const [expected, setExpected] = useState("");
  const [response, setResponse] = useState("");
  const [category, setCategory] = useState("misconception");
  const [hints, setHints] = useState("");
  const [tags, setTags] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setPrompt("");
    setExpected("");
    setResponse("");
    setCategory("misconception");
    setHints("");
    setTags("");
    const previous = document.activeElement;
    dialogRef.current?.querySelector("textarea")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const target = previous;
      requestAnimationFrame(() => {
        if (target?.isConnected && !target.closest?.("[inert]")) target.focus?.();
        else if (target?.isConnected) requestAnimationFrame(() => { if (target.isConnected) target.focus?.(); });
      });
    };
  }, [open, onClose]);

  if (!open) return null;
  const submit = (event) => {
    event.preventDefault();
    if (!prompt.trim() || !expected.trim()) return;
    onLog({
      prompt: prompt.trim(),
      expected: expected.trim(),
      response: response.trim(),
      category,
      hints: hints.split(",").map((hint) => hint.trim()).filter(Boolean),
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    });
  };

  return (
    <div className="modal-layer review-dialog-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Close mistake dialog" type="button" />
      <form ref={dialogRef} className="review-card-dialog mistake-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="mistake-dialog-title">
        <button className="icon-button review-dialog-close" onClick={onClose} aria-label="Close mistake dialog" type="button"><X size={19} /></button>
        <div className="dialog-icon"><Flame size={22} /></div>
        <span className="eyebrow">Learn from failure</span>
        <h2 id="mistake-dialog-title">Log a mistake</h2>
        <p>Capture an error you caught outside review — a wrong answer, a shaky derivation, a bug. Repeats of the same prompt merge into one entry.</p>
        <label><span>What went wrong <small>the prompt or task you missed</small></span><textarea value={prompt} maxLength={2_000} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. Derive the gradient of the softmax cross-entropy loss" required /></label>
        <label><span>Expected reasoning or answer</span><textarea value={expected} maxLength={4_000} onChange={(event) => setExpected(event.target.value)} placeholder="What the correct answer or reasoning looks like…" required /></label>
        <label><span>Your answer <small>optional</small></span><textarea value={response} maxLength={4_000} onChange={(event) => setResponse(event.target.value)} placeholder="What you actually said or did…" /></label>
        <div className="review-dialog-toolbar">
          <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{MISTAKE_CATEGORIES.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
        </div>
        <label><span>Hints <small>optional, comma separated</small></span><input className="text-input" value={hints} maxLength={600} onChange={(event) => setHints(event.target.value)} placeholder="chain rule first, watch the indices" /></label>
        <label><span>Tags <small>optional, comma separated</small></span><input className="text-input" value={tags} maxLength={500} onChange={(event) => setTags(event.target.value)} placeholder="softmax, derivations" /></label>
        <div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!prompt.trim() || !expected.trim()} type="submit">Log mistake</button></div>
      </form>
    </div>
  );
}

/**
 * The correction field keeps keystrokes local and commits on blur: writing
 * through the profile on every keypress re-renders the whole center and can
 * drop characters typed between commits.
 */
function MistakeCorrectionField({ mistake, onEditMistake }) {
  const [value, setValue] = useState(mistake.correction);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setValue(mistake.correction);
  }, [mistake.correction]);
  return (
    <textarea
      value={value}
      maxLength={4_000}
      placeholder="Write the correction in your own words — why was the expected answer right?"
      aria-label={`Correction for mistake: ${mistake.prompt.slice(0, 60)}`}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        focusedRef.current = false;
        if (event.target.value !== mistake.correction) onEditMistake?.(mistake.id, { correction: event.target.value });
      }}
    />
  );
}

/**
 * Worksheet lab bench (LAB-001/002 slice): inline dataset, deterministic
 * self-checks, reveal, and honest self-assessment — misses feed the mistake
 * notebook. No code execution happens in the app; the learner works in their
 * own editor/terminal and checks results here.
 */
function LabBench({ lab, onClose, onLogMistake, onOpenSource }) {
  const [taskIndex, setTaskIndex] = useState(0);
  const [response, setResponse] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [results, setResults] = useState([]);
  const task = lab.tasks[taskIndex];
  const finished = taskIndex >= lab.tasks.length;

  const check = () => {
    const correct = checkLabAnswer(task.selfCheck.expected, response);
    setOutcome(correct ? "correct" : "incorrect");
    if (!correct) onLogMistake?.(labMistakeDraft(lab, task, response));
    setResults((current) => [...current, correct]);
  };
  const advance = () => {
    setResponse("");
    setOutcome(null);
    setTaskIndex((current) => current + 1);
  };

  return (
    <div className="page review-session-page lab-bench" aria-label={`Lab: ${lab.title}`}>
      <header className="review-session-header">
        <button className="button ghost" onClick={onClose} type="button"><ArrowLeft size={17} /> {finished ? "Done" : "Exit lab"}</button>
        <div><strong>{Math.min(taskIndex + 1, lab.tasks.length)}/{lab.tasks.length}</strong><span>task</span></div>
        <span className="lab-minutes"><Clock3 size={15} /> ~{lab.estimatedMinutes} min</span>
      </header>
      <main className="review-stage lab-stage">
        {!finished && (
          <article className="review-flashcard revealed lab-card">
            <span className="eyebrow">{lab.kind} lab · work in your own editor, check here</span>
            <div className="review-markdown lab-prompt" dangerouslySetInnerHTML={{ __html: renderMarkdown(taskIndex === 0 ? `${lab.prompt}\n\n\`\`\`\n${lab.dataset}\n\`\`\`` : lab.prompt) }} />
            <div className="lab-task">
              <strong>{task.instruction}</strong>
              <label><span>{task.selfCheck.question}</span><input className="text-input" value={response} onChange={(event) => setResponse(event.target.value)} disabled={outcome !== null} autoComplete="off" aria-label="Your computed answer" /></label>
              {outcome === null && <button className="button primary" onClick={check} disabled={!response.trim()} type="button">Check answer</button>}
              {outcome === "correct" && <p className="lab-outcome is-correct"><CheckCircle2 size={16} /> Correct. {task.selfCheck.explanation}</p>}
              {outcome === "incorrect" && <p className="lab-outcome is-incorrect"><Flame size={16} /> Expected <strong>{task.selfCheck.expected}</strong>. {task.selfCheck.explanation} Logged to your mistake notebook.</p>}
              {outcome !== null && <button className="button secondary" onClick={advance} type="button">{taskIndex + 1 < lab.tasks.length ? "Next task" : "Finish lab"}</button>}
            </div>
          </article>
        )}
        {finished && (
          <article className="review-flashcard revealed lab-card">
            <span className="eyebrow">Lab complete · {results.filter(Boolean).length}/{results.length} checks passed</span>
            <div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(`**Worked solution**\n\n${lab.solution}${lab.complexityNote ? `\n\n*${lab.complexityNote}*` : ""}`) }} />
            <div className="review-session-actions">
              {lab.documentId && onOpenSource && <button className="button ghost" onClick={() => onOpenSource(lab.documentId)} type="button"><BookOpen size={16} /> Open the source lecture</button>}
              <button className="button primary" onClick={onClose} type="button">Back to review center</button>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}

/**
 * Timed interview round (INTERVIEW-002 slice): prep/answer countdowns over a
 * bounded weak-first selection. Practice-only — the scheduler is untouched —
 * and a miss logs an interview-category mistake.
 */
function InterviewRound({ cards, onClose, onLogMistake, onImportCards }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("prep");
  const [secondsLeft, setSecondsLeft] = useState(INTERVIEW_PREP_SECONDS);
  const [results, setResults] = useState([]);
  const card = cards[index];

  useEffect(() => {
    if (phase !== "prep" && phase !== "answer") return undefined;
    // The updater stays pure (StrictMode double-invokes it); expiry
    // transitions happen in the effect below, atomically with the reset.
    const timer = window.setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [phase, index]);

  useEffect(() => {
    if (secondsLeft > 0) return;
    if (phase === "prep") {
      setPhase("answer");
      setSecondsLeft(card?.answerSeconds || INTERVIEW_ANSWER_SECONDS);
    } else if (phase === "answer") {
      setPhase("revealed");
    }
  }, [secondsLeft, phase]);

  if (!card && phase !== "summary") return null;

  const grade = (hit) => {
    if (!hit) {
      onLogMistake?.({
        prompt: card.front,
        expected: card.back,
        category: card.mistakeCategory || "interview",
        reviewItemId: card.id,
        documentId: card.documentId || "",
        tags: [...new Set([...(card.tags || []), "interview"])],
      });
    }
    setResults((previous) => [...previous, { id: card.id, hit }]);
    if (index + 1 < cards.length) {
      setIndex(index + 1);
      setPhase("prep");
      setSecondsLeft(INTERVIEW_PREP_SECONDS);
    } else {
      setPhase("summary");
    }
  };

  if (phase === "summary") {
    const hits = results.filter((result) => result.hit).length;
    const misses = results.length - hits;
    return (
      <div className="page review-session-page interview-round" aria-label="Interview round summary">
        <header className="review-session-header"><button className="button ghost" onClick={onClose} type="button"><ArrowLeft size={17} /> Done</button><div><strong>{hits}/{results.length}</strong><span>answered well</span></div><span /></header>
        <main className="review-stage">
          <article className="review-flashcard revealed interview-summary">
            <span className="eyebrow">Round complete</span>
            <h3>{misses === 0 ? "Clean round — raise the difficulty next time." : `${misses} miss${misses === 1 ? "" : "es"} logged to your mistake notebook.`}</h3>
            <p className="microcopy">Interview rounds are timed practice and never change your review schedule; corrective work lives in the mistake notebook.</p>
            <button className="button primary" onClick={onClose} type="button">Back to review center</button>
          </article>
        </main>
      </div>
    );
  }

  return (
    <div className="page review-session-page interview-round" aria-label="Timed interview round">
      <header className="review-session-header">
        <button className="button ghost" onClick={onClose} type="button"><ArrowLeft size={17} /> End round</button>
        <div><strong>{index + 1}/{cards.length}</strong><span>question</span></div>
        <div className={`interview-timer${phase === "answer" && secondsLeft <= 15 ? " is-low" : ""}`} role="timer" aria-label={`${phase === "prep" ? "Preparation" : "Answer"} time remaining`}><Clock3 size={16} /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</div>
      </header>
      <main className="review-stage" aria-live="polite">
        <article className={phase === "revealed" ? "review-flashcard revealed" : "review-flashcard"}>
          <span className="eyebrow">{phase === "prep" ? "Structure your answer out loud" : phase === "answer" ? "Answer as if the interviewer is listening" : "Compare against the expected answer"}</span>
          <div className="review-markdown review-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.front) }} />
          {phase === "revealed" && <div className="review-answer review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.back) }} />}
        </article>
        <div className="review-session-actions">
          {phase === "prep" && <button className="button primary large" onClick={() => { setPhase("answer"); setSecondsLeft(card?.answerSeconds || INTERVIEW_ANSWER_SECONDS); }} type="button">Start answering</button>}
          {phase === "answer" && <button className="button primary large" onClick={() => setPhase("revealed")} type="button"><Eye size={18} /> Show expected answer</button>}
          {phase === "revealed" && <div className="interview-grades"><button className="button secondary" onClick={() => grade(false)} type="button"><Flame size={16} /> Missed it — log the mistake</button><button className="button primary" onClick={() => grade(true)} type="button"><CheckCircle2 size={16} /> Answered well</button></div>}
        </div>
      </main>
    </div>
  );
}

export default function ReviewCenter({
  profile,
  documents,
  onCreate,
  onEdit,
  onGrade,
  onUndo,
  onBury,
  onOpenSource,
  onToggleSuspend,
  onToggleArchive,
  onDelete,
  onSettingsChange,
  onCalibrate,
  mistakes = [],
  onEditMistake,
  onDeleteMistake,
  onScheduleCorrective,
  onLogMistake,
}) {
  const [session, setSession] = useState(false);
  const [mistakeFilter, setMistakeFilter] = useState("all");
  const [mistakeDialogOpen, setMistakeDialogOpen] = useState(false);
  const [interviewCards, setInterviewCards] = useState(null);
  const [trackChoice, setTrackChoice] = useState("mle");
  const [roundTypeChoice, setRoundTypeChoice] = useState("");
  const [activeLab, setActiveLab] = useState(null);
  const [showCorrectedMistakes, setShowCorrectedMistakes] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [currentId, setCurrentId] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [crunch, setCrunch] = useState(false);
  const [sessionSeen, setSessionSeen] = useState([]);
  const [deckQuery, setDeckQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [deckPage, setDeckPage] = useState(1);
  const [clock, setClock] = useState(() => new Date());
  const startedAt = useRef(Date.now());
  const deckSectionRef = useRef(null);
  const timeZone = useMemo(() => currentTimeZone(), []);

  useEffect(() => {
    const refresh = () => setClock(new Date());
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    setClock(new Date());
  }, [profile.reviewAttempts.length, profile.reviewItems.length]);

  // A newly created card can be milliseconds newer than the last interval
  // tick. Use a render-time monotonic floor so it is immediately eligible
  // instead of briefly showing an empty queue before the effect runs.
  const queueNow = new Date(Math.max(clock.getTime(), Date.now()));
  const baseQueue = useMemo(() => buildReviewQueue(
    profile.reviewItems,
    profile.reviewSettings,
    queueNow,
    profile.reviewSessions,
    { timeZone, crunch, crunchLimit: 20 },
  ), [crunch, profile.reviewItems, profile.reviewSessions, profile.reviewSettings, queueNow.getTime(), timeZone]);
  const exportMistakes = () => {
    const lines = ["# Mistake notebook", "", `Exported ${new Date().toISOString().slice(0, 10)}.`, ""];
    for (const mistake of mistakes) {
      const category = MISTAKE_CATEGORIES.find((entry) => entry.id === mistake.category)?.label || "Misconception";
      lines.push(`## ${mistake.prompt}`, "", `- Category: ${category}${mistake.occurrences > 1 ? ` · seen ×${mistake.occurrences}` : ""}${mistake.correctedAt ? " · corrected" : " · open"}`);
      if (mistake.expected) lines.push(`- Expected: ${mistake.expected}`);
      if (mistake.response) lines.push(`- Your answer: ${mistake.response}`);
      if (mistake.correction) lines.push(`- Correction: ${mistake.correction}`);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-mistakes-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
  };

  const exportDeck = () => {
    const envelope = exportReviewCards(profile.reviewItems);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-review-cards-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
  };
  const interviewPool = useMemo(() => selectInterviewRound(profile.reviewItems), [profile.reviewItems]);
  // The authored banks are sizeable JSON: load them lazily so they never
  // weigh on the startup bundle (the app audit gates entry size).
  const [trackBankRaw, setTrackBankRaw] = useState(null);
  const [labBankRaw, setLabBankRaw] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      import("../data/interviewTracks.v1.json"),
      import("../data/labs.v1.json"),
    ]).then(([tracks, labs]) => {
      if (!active) return;
      setTrackBankRaw(tracks.default);
      setLabBankRaw(labs.default);
    }).catch(() => { /* strips simply stay hidden if the banks fail to load */ });
    return () => { active = false; };
  }, []);
  const trackBank = useMemo(() => normalizeTrackBank(trackBankRaw), [trackBankRaw]);
  const labBank = useMemo(() => normalizeLabBank(labBankRaw), [labBankRaw]);
  const queue = session && crunch ? baseQueue.filter((item) => !sessionSeen.includes(item.id)) : baseQueue;
  const queueSignature = queue.map((item) => `${String(item.id).length}:${item.id}`).join("");
  const stats = useMemo(() => reviewStats(profile.reviewItems, queueNow, timeZone), [profile.reviewItems, queueNow.getTime(), timeZone]);
  const analytics = useMemo(() => reviewAnalytics(profile.reviewAttempts, profile.reviewItems, queueNow, timeZone), [profile.reviewAttempts, profile.reviewItems, queueNow.getTime(), timeZone]);
  const usage = useMemo(() => getTodayReviewUsage(profile.reviewSessions, queueNow, timeZone), [profile.reviewSessions, queueNow.getTime(), timeZone]);
  const documentMap = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const current = queue.find((item) => item.id === currentId) || queue[0];
  const lastAttempt = profile.reviewAttempts.at(-1);
  const normalizedDeckQuery = deckQuery.trim().toLocaleLowerCase();
  const deckItems = useMemo(() => profile.reviewItems.filter((item) => (
    item.archived === showArchived
    && (!normalizedDeckQuery || [item.front, item.back, item.type, ...(item.tags || [])].some((value) => String(value).toLocaleLowerCase().includes(normalizedDeckQuery)))
  )), [normalizedDeckQuery, profile.reviewItems, showArchived]);
  const deckPageCount = Math.max(1, Math.ceil(deckItems.length / REVIEW_DECK_PAGE_SIZE));
  const visibleDeckPage = Math.min(deckPage, deckPageCount);
  const deckPageStart = (visibleDeckPage - 1) * REVIEW_DECK_PAGE_SIZE;
  const visibleDeckItems = deckItems.slice(deckPageStart, deckPageStart + REVIEW_DECK_PAGE_SIZE);

  useEffect(() => {
    setDeckPage(1);
  }, [deckQuery, showArchived]);

  useEffect(() => {
    setDeckPage((page) => Math.min(page, deckPageCount));
  }, [deckPageCount]);

  const changeDeckPage = (page) => {
    setDeckPage(Math.max(1, Math.min(deckPageCount, page)));
    requestAnimationFrame(() => deckSectionRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  };

  useEffect(() => {
    if (!session) return;
    setCurrentId((existing) => queue.some((item) => item.id === existing) ? existing : (queue[0]?.id || ""));
    setRevealed(false);
    setConfidence(3);
    startedAt.current = Date.now();
    if (!queue.length) setSession(false);
  // Queue arrays can be recomputed when the wall clock advances even when
  // membership is unchanged. Keying this transition to IDs prevents an
  // unrelated render (or the 30-second clock tick) from hiding an answer the
  // learner has already revealed.
  }, [queueSignature, session]);

  const grade = useCallback((rating) => {
    if (!current) return;
    onGrade(current.id, rating, Date.now() - startedAt.current, { confidence, crunch, timeZone });
    if (crunch) setSessionSeen((seen) => [...seen, current.id]);
    setRevealed(false);
    setCurrentId("");
    setConfidence(3);
    startedAt.current = Date.now();
  }, [confidence, crunch, current, onGrade, timeZone]);

  const bury = useCallback(() => {
    if (!current) return;
    onBury(current.id, timeZone);
    setSessionSeen((seen) => [...seen, current.id]);
    setCurrentId("");
  }, [current, onBury, timeZone]);

  const undo = useCallback(() => {
    if (!lastAttempt) return;
    onUndo();
    setSessionSeen((seen) => seen.filter((id) => id !== lastAttempt.reviewItemId));
    setCurrentId(lastAttempt.reviewItemId);
  }, [lastAttempt, onUndo]);

  useEffect(() => {
    if (!session) return undefined;
    const onKeyDown = (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (typing) return;
      if (event.code === "Space" && !revealed) { event.preventDefault(); setRevealed(true); return; }
      if (revealed) {
        const rating = REVIEW_RATINGS.find((entry) => entry.key === event.key);
        if (rating) { event.preventDefault(); grade(rating.id); return; }
      }
      if (event.key.toLocaleLowerCase() === "b") { event.preventDefault(); bury(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "z") { event.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bury, grade, revealed, session, undo]);

  const startSession = (useCrunch = false) => {
    setCrunch(useCrunch);
    setSessionSeen([]);
    setSession(true);
    setCurrentId("");
  };

  if (activeLab) {
    return <LabBench lab={activeLab} onClose={() => setActiveLab(null)} onLogMistake={onLogMistake} onOpenSource={onOpenSource} />;
  }

  if (interviewCards) {
    return <InterviewRound cards={interviewCards} onClose={() => setInterviewCards(null)} onLogMistake={onLogMistake} />;
  }

  if (session && current) {
    const source = documentMap.get(current.documentId);
    const intervals = previewReviewIntervals(current, { scheduler: profile.reviewSettings.scheduler, requestRetention: profile.reviewSettings.requestRetention, weights: profile.reviewSettings.fsrsWeights });
    return (
      <div className="page review-session-page">
        <header className="review-session-header">
          <button className="button ghost" onClick={() => setSession(false)} type="button"><ArrowLeft size={17} /> End session</button>
          <div><strong>{queue.length}</strong><span>{crunch ? "practice cards left" : "remaining today"}</span></div>
          <button className="button ghost" onClick={undo} disabled={!lastAttempt} title={!lastAttempt ? "Grade a card before using undo" : "Undo the most recent grade"} type="button"><Undo2 size={16} /> Undo</button>
        </header>
        <main className="review-stage" aria-live="polite">
          <div className="review-progress" aria-label={`${queue.length} cards remaining`}><span style={{ width: `${Math.max(8, 100 / Math.max(queue.length, 1))}%` }} /></div>
          {crunch && <p className="review-crunch-notice"><Flame size={15} /> Extra practice mode prioritizes weak cards and records attempts separately from daily limits.</p>}
          <article className={revealed ? "review-flashcard revealed" : "review-flashcard"}>
            <span className="eyebrow">{(() => {
              const queueClass = classifyReviewItem(current);
              const overdueDays = queueClass === "overdue" ? Math.floor((Date.now() - Date.parse(current.dueAt)) / 86_400_000) : 0;
              const label = queueClass === "new" ? "New card"
                : queueClass === "overdue" ? `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`
                  : queueClass === "learning" ? `Learning · ${formatInterval(current.intervalDays)} interval`
                    : `Review · ${formatInterval(current.intervalDays)} interval`;
              return label;
            })()} · {REVIEW_CARD_TYPES.find((type) => type.id === current.type)?.label || "Basic Q&A"}</span>
            <div className="review-markdown review-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(current.type === "cloze" && hasClozeMarkup(current.front) ? renderClozePrompt(current.front, revealed) : current.front) }} />
            {source && <button className="review-source-link" onClick={() => onOpenSource(source.id)} type="button"><BookOpen size={15} /> {source.title}</button>}
            {revealed && <div className="review-answer"><span>Answer</span><div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(current.back) }} /></div>}
          </article>
          {!revealed ? (
            <div className="review-session-actions"><button className="button ghost" onClick={bury} type="button"><TimerReset size={17} /> Bury today</button><button className="button primary large review-reveal" onClick={() => setRevealed(true)} type="button"><Eye size={19} /> Show answer <kbd>Space</kbd></button></div>
          ) : (
            <div className="review-rating-panel">
              <div className="review-confidence"><span>Retrieval confidence</span><div role="group" aria-label="Retrieval confidence">{[1, 2, 3, 4, 5].map((value) => <button className={confidence === value ? "active" : ""} onClick={() => setConfidence(value)} aria-label={`Confidence ${value} of 5`} aria-pressed={confidence === value} key={value} type="button">{value}</button>)}</div></div>
              <p>How well did you retrieve the answer?</p>
              <div className="review-ratings">{REVIEW_RATINGS.map((rating) => <button className={`review-rating ${rating.id}`} onClick={() => grade(rating.id)} aria-label={`Rate ${rating.label}`} key={rating.id} type="button"><strong>{rating.label}</strong><span>{formatInterval(intervals[rating.id])} · {rating.key}</span></button>)}</div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="page review-center-page">
      <header className="page-title review-title"><div><span className="eyebrow">Remember what you learn</span><h1>Review center</h1><p>Source-linked active recall with durable daily limits, scheduling history, and explicit confidence.</p></div><button className="button primary" onClick={() => onCreate(null)} type="button"><FilePlus2 size={17} /> New card</button></header>
      <section className="review-overview">
        <article className="review-hero"><div><span className="eyebrow">Today’s queue</span><strong>{baseQueue.length}</strong><p>{baseQueue.length ? `${stats.due} total due; workload is capped by today’s remaining limits.` : "You are caught up or today’s limits are complete."}</p><small>{usage.newIntroduced}/{profile.reviewSettings.dailyNewLimit} new · {usage.reviewCompleted}/{profile.reviewSettings.dailyReviewLimit} reviews · {usage.crunchCompleted} extra{stats.overdue > 0 ? ` · ${stats.overdue} overdue` : ""}{stats.suspended > 0 ? ` · ${stats.suspended} suspended` : ""}</small></div><div className="review-hero-actions"><button className="button primary large" onClick={() => startSession(false)} disabled={!baseQueue.length} title={!baseQueue.length ? "No cards remain within today’s limits" : "Start today’s scheduled queue"} type="button"><Play size={19} /> Start review</button><button className="button ghost" onClick={() => startSession(true)} disabled={!profile.reviewItems.some((item) => !item.suspended && !item.archived)} title="Practice up to 20 weak cards beyond the daily queue" type="button"><Flame size={17} /> Crunch weak cards</button><button className="button ghost" onClick={undo} disabled={!lastAttempt?.previousState} title={!lastAttempt?.previousState ? "No reversible grade is available" : "Restore the card and today’s allowance"} type="button"><Undo2 size={16} /> Undo last grade</button><button className="button ghost" onClick={() => setInterviewCards(selectInterviewRound(profile.reviewItems))} disabled={!interviewPool.length} title={interviewPool.length ? "Timed prep/answer practice; misses feed the mistake notebook" : "Tag cards with “interview” or use scenario/compare/debugging types to unlock timed rounds"} type="button"><Clock3 size={16} /> Interview round</button></div></article>
        <div className="review-stat-grid"><article><CalendarClock size={20} /><strong>{stats.due}</strong><span>Due now</span></article><article><RotateCcw size={20} /><strong>{stats.learning}</strong><span>Learning</span></article><article><CheckCircle2 size={20} /><strong>{stats.mastered}</strong><span>Mastered</span></article><article><Brain size={20} /><strong>{analytics.retention30 === null ? "—" : `${analytics.retention30}%`}</strong><span>30-day recall</span></article></div>
      </section>
      <section className="review-analytics" aria-label="Review analytics">
        <article><Flame size={18} /><div><strong>{analytics.streak} day{analytics.streak === 1 ? "" : "s"}</strong><span>Current streak</span></div></article>
        <article><Gauge size={18} /><div><strong>{analytics.retention7 === null ? "—" : `${analytics.retention7}%`}</strong><span>7-day recall</span></div></article>
        <article><History size={18} /><div><strong>{formatLatency(analytics.medianLatencyMs)}</strong><span>Median answer time</span></div></article>
        <article className="review-forecast"><div><strong>Next 7 days</strong><span>Scheduled forecast</span></div><div className="forecast-bars" aria-label={`Seven-day review forecast: ${analytics.forecast.join(", ")}`}>{analytics.forecast.map((value, index) => <span key={index} style={{ height: `${Math.max(8, (value / Math.max(...analytics.forecast, 1)) * 100)}%` }} title={`Day ${index}: ${value} reviews`} />)}</div></article>
        <article className="review-forecast review-retention-trend"><div><strong>12-week recall</strong><span>Weekly retention trend</span></div><div className="forecast-bars" aria-label={`Twelve-week retention trend: ${analytics.retentionTrend.map((week) => week.percent === null ? "no reviews" : `${week.percent}%`).join(", ")}`}>{analytics.retentionTrend.map((week, index) => <span key={index} className={week.percent === null ? "is-empty" : ""} style={{ height: `${week.percent === null ? 8 : Math.max(8, week.percent)}%` }} title={week.percent === null ? `Week ${index - 11}: no reviews` : `Week ${index - 11}: ${week.percent}% retained over ${week.count} attempts`} />)}</div></article>
      </section>
      {trackBank.tracks.length > 0 && <section className="interview-track-strip" aria-label="Structured interview practice">
        <div><strong>Interview tracks</strong><span>Authored role tracks with rubrics; misses feed the mistake notebook.</span></div>
        <label>Track<select value={trackChoice} onChange={(event) => setTrackChoice(event.target.value)} aria-label="Interview track">{trackBank.tracks.map((track) => <option value={track.id} key={track.id} disabled={!track.seeded}>{track.label}{track.seeded ? "" : " (coming soon)"}</option>)}</select></label>
        <label>Round<select value={roundTypeChoice} onChange={(event) => setRoundTypeChoice(event.target.value)} aria-label="Interview round type"><option value="">Mixed</option>{ROUND_TYPES.map((round) => <option value={round.id} key={round.id}>{round.label}</option>)}</select></label>
        <button className="button secondary" onClick={() => {
          const round = buildTrackRound(trackBankRaw, { trackId: trackChoice, roundType: roundTypeChoice }, mistakes);
          if (!round.ok) return;
          setInterviewCards(round.cards);
        }} disabled={!buildTrackRound(trackBankRaw, { trackId: trackChoice, roundType: roundTypeChoice }, mistakes).ok} type="button"><Clock3 size={16} /> Start track round</button>
      </section>}

      {labBank.labs.length > 0 && <section className="lab-strip" aria-label="Worksheet labs">
        <div><strong>Worksheet labs</strong><span>Work in your own editor; check exact results here. No code runs in the app.</span></div>
        <div className="lab-list">{labBank.labs.map((lab) => <button className="lab-tile" onClick={() => setActiveLab(lab)} key={lab.id} type="button"><span className="lab-kind">{lab.kind}</span><strong>{lab.title}</strong><small>~{lab.estimatedMinutes} min · {lab.tasks.length} checks</small></button>)}</div>
      </section>}

      <section className="review-settings-strip" aria-label="Daily review limits"><div><strong>Daily limits</strong><span>Counts persist by local date ({timeZone}) and cannot refill when a card leaves the queue.</span></div><label>New<select value={profile.reviewSettings.dailyNewLimit} onChange={(event) => onSettingsChange({ dailyNewLimit: Number(event.target.value) })}>{[5, 10, 15, 20, 30, 50].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Reviews<select value={profile.reviewSettings.dailyReviewLimit} onChange={(event) => onSettingsChange({ dailyReviewLimit: Number(event.target.value) })}>{[20, 50, 100, 200, 500].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Scheduler<select value={profile.reviewSettings.scheduler || "sm2"} onChange={(event) => onSettingsChange({ scheduler: event.target.value })} aria-label="Scheduling algorithm" title="Adaptive (FSRS-4.5) models each card's memory stability and difficulty; Classic is the fixed-ease SM-2 family. Switching is safe — enabling Adaptive calibrates from your review history once."><option value="sm2">Classic</option><option value="fsrs">Adaptive (FSRS)</option></select></label>{(profile.reviewSettings.scheduler || "sm2") === "fsrs" && <label>Retention<select value={String(profile.reviewSettings.requestRetention ?? 0.9)} onChange={(event) => onSettingsChange({ requestRetention: Number(event.target.value) })} aria-label="Target retention" title="Target recall probability at review time: higher retention means shorter intervals and more daily reviews"><option value="0.8">80%</option><option value="0.85">85%</option><option value="0.9">90%</option><option value="0.95">95%</option></select></label>}{(profile.reviewSettings.scheduler || "sm2") === "fsrs" && <div className="review-calibrate">{(profile.reviewSettings.fsrsWeights || []).length === 17 ? <><span className="review-calibrated-badge" title="Grading uses weights fitted to your own review history">Calibrated</span><button className="text-button" onClick={() => onSettingsChange({ fsrsWeights: [] })} title="Return to the published FSRS-4.5 weights" type="button">Reset</button></> : <button className="text-button" onClick={onCalibrate} title="Fit the scheduler to your own review history (needs 50+ spaced reviews including some lapses)" type="button">Calibrate from my history</button>}</div>}</section>
      {(profile.reviewSettings.scheduler || "sm2") === "fsrs" && (() => {
        const curve = retentionWorkloadCurve(profile.reviewItems);
        if (!curve.seededCount) return null;
        return <section className="review-workload-strip" aria-label="Retention versus workload"><div><strong>Workload planner</strong><span>Steady-state daily reviews for your {curve.seededCount} scheduled card{curve.seededCount === 1 ? "" : "s"}{curve.unseededCount ? ` (${curve.unseededCount} not FSRS-scheduled yet)` : ""}.</span></div><div className="review-workload-options">{curve.rows.map((row) => <button className={Math.abs((profile.reviewSettings.requestRetention ?? 0.9) - row.retention) < 0.001 ? "active" : ""} key={row.retention} onClick={() => onSettingsChange({ requestRetention: row.retention })} title={`Average interval ${row.averageIntervalDays} days`} type="button"><strong>{Math.round(row.retention * 100)}%</strong><span>~{row.dailyReviews}/day</span></button>)}</div></section>;
      })()}
      {(mistakes.length > 0 || onLogMistake) && <section className="review-mistakes" aria-label="Mistake notebook">
        <div className="section-heading"><div><span className="eyebrow">Learn from failures</span><h2>Mistake notebook</h2></div><div className="mistake-controls"><label>Category<select value={mistakeFilter} onChange={(event) => setMistakeFilter(event.target.value)}><option value="all">All</option>{MISTAKE_CATEGORIES.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select></label><label className="mistake-corrected-toggle"><input type="checkbox" checked={showCorrectedMistakes} onChange={(event) => setShowCorrectedMistakes(event.target.checked)} /> Show corrected</label>{mistakes.length > 0 && <button className="button ghost" onClick={exportMistakes} type="button"><Download size={15} /> Export</button>}{onLogMistake && <button className="button ghost" onClick={() => setMistakeDialogOpen(true)} type="button"><Flame size={15} /> Log mistake</button>}</div></div>
        <p className="microcopy">Grading a card “Again” logs or reopens its mistake automatically; repeats merge into one entry. Write the correction in your own words, then schedule a corrective review.</p>
        {(() => {
          const summary = mistakeAnalytics(mistakes);
          if (!mistakes.length) return null;
          return <div className="mistake-summary" aria-label="Mistake notebook summary">
            <span><strong>{summary.open}</strong> open</span>
            <span><strong>{summary.corrected}</strong> corrected</span>
            {MISTAKE_CATEGORIES.filter((category) => summary.byCategory[category.id] > 0).map((category) => <span key={category.id}>{category.label}: <strong>{summary.byCategory[category.id]}</strong></span>)}
            {summary.mostRepeated.length > 0 && <span className="mistake-summary-repeats">Most repeated: {summary.mostRepeated.map((entry) => `“${entry.prompt.slice(0, 40)}${entry.prompt.length > 40 ? "…" : ""}” ×${entry.occurrences}`).join(" · ")}</span>}
          </div>;
        })()}
        {mistakes.length === 0 && <div className="empty-state compact"><Flame size={24} /><h2>No mistakes logged yet</h2><p>Grade a card “Again” or log one manually — captured errors become your highest-value review material.</p></div>}
        <div className="mistake-list">
          {mistakes
            .filter((mistake) => (mistakeFilter === "all" || mistake.category === mistakeFilter) && (showCorrectedMistakes || !mistake.correctedAt))
            .slice(0, 100)
            .map((mistake) => {
              const doc = documents.find((item) => item.id === mistake.documentId);
              const categoryLabel = MISTAKE_CATEGORIES.find((category) => category.id === mistake.category)?.label || mistake.category;
              return <article className={`mistake-card${mistake.correctedAt ? " is-corrected" : ""}`} key={mistake.id}>
                <div className="mistake-meta"><span className="mistake-category">{categoryLabel}</span>{mistake.occurrences > 1 && <span className="mistake-count">×{mistake.occurrences}</span>}{mistake.correctedAt && <span className="mistake-corrected">Corrected</span>}<span className="mistake-when">{new Date(mistake.lastSeenAt).toLocaleDateString()}</span></div>
                <p className="mistake-prompt">{mistake.prompt}</p>
                {mistake.expected && <p className="mistake-expected"><strong>Expected:</strong> {mistake.expected}</p>}
                <MistakeCorrectionField mistake={mistake} onEditMistake={onEditMistake} />
                <div className="mistake-actions">
                  {doc && <button className="text-button" onClick={() => onOpenSource(doc.id)} type="button">{doc.title}</button>}
                  <span>
                    <button className="button ghost" onClick={() => onScheduleCorrective?.(mistake)} type="button">Schedule corrective review</button>
                    <button className="button ghost" onClick={() => onEditMistake?.(mistake.id, { correctedAt: mistake.correctedAt ? "" : new Date().toISOString() })} type="button">{mistake.correctedAt ? "Reopen" : "Mark corrected"}</button>
                    <button className="icon-button small danger" onClick={() => onDeleteMistake?.(mistake.id)} aria-label="Delete this mistake entry" title="Delete" type="button"><Trash2 size={15} /></button>
                  </span>
                </div>
              </article>;
            })}
        </div>
      </section>}
      <MistakeDialog open={mistakeDialogOpen} onClose={() => setMistakeDialogOpen(false)} onLog={(draft) => { onLogMistake?.(draft); setMistakeDialogOpen(false); }} />
      <section className="review-deck-section" ref={deckSectionRef}>
        <div className="section-heading review-deck-heading"><div><span className="eyebrow">Your knowledge deck</span><h2>{deckItems.length} {showArchived ? "archived" : "active"} card{deckItems.length === 1 ? "" : "s"}</h2></div><div className="review-deck-tools"><label><Search size={16} /><input value={deckQuery} onChange={(event) => setDeckQuery(event.target.value)} aria-label="Search review cards" placeholder="Search cards or tags" /></label><button className="button ghost" onClick={() => setShowArchived((value) => !value)} aria-pressed={showArchived} type="button">{showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {showArchived ? "Show active" : `Archived (${stats.archived})`}</button><button className="button ghost" onClick={exportDeck} disabled={!profile.reviewItems.some((item) => !item.archived)} title="Download the deck as a shareable JSON file (authoring fields only — no schedule)" type="button"><Download size={16} /> Export deck</button><label className="button ghost import-cards-label" title="Import a lumen.cards.v1 JSON file; duplicates are skipped and imported cards start as new"><Upload size={16} /> Import<input type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImportCards?.(file); }} /></label></div></div>
        {deckItems.length ? <><p className="review-deck-range">Showing {deckPageStart + 1}–{deckPageStart + visibleDeckItems.length} of {deckItems.length}</p><div className="review-deck-list">{visibleDeckItems.map((item) => { const source = documentMap.get(item.documentId); return <article className={item.suspended ? "review-deck-card suspended" : "review-deck-card"} key={item.id}><div className="review-card-state"><Brain size={18} /><span>{item.suspended ? "Paused" : isNewReviewItem(item) ? "New" : `${formatInterval(item.intervalDays)} interval`}</span><small>{REVIEW_CARD_TYPES.find((type) => type.id === item.type)?.label}</small></div><div className="review-card-copy"><div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.front) }} /><div className="review-deck-answer review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.back) }} />{item.tags?.length > 0 && <div className="review-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}{source && <button className="text-button" onClick={() => onOpenSource(source.id)} type="button"><BookOpen size={14} /> {source.title}</button>}</div><div className="review-card-actions"><button className="icon-button" onClick={() => onEdit(item)} aria-label="Edit review card" title="Edit" type="button"><Edit3 size={17} /></button><button className="icon-button" onClick={() => onToggleSuspend(item.id)} aria-label={item.suspended ? "Resume review card" : "Pause review card"} title={item.suspended ? "Resume" : "Pause"} type="button">{item.suspended ? <Play size={17} /> : <Pause size={17} />}</button><button className="icon-button" onClick={() => onToggleArchive(item.id)} aria-label={item.archived ? "Restore review card" : "Archive review card"} title={item.archived ? "Restore" : "Archive"} type="button">{item.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button><button className="icon-button danger" onClick={() => onDelete(item.id)} aria-label="Delete review card" title="Delete permanently" type="button"><Trash2 size={17} /></button></div></article>; })}</div>{deckPageCount > 1 && <nav className="review-deck-pagination" aria-label="Review card pages"><span aria-live="polite" aria-atomic="true">Page {visibleDeckPage} of {deckPageCount}</span><div><button className="button ghost" onClick={() => changeDeckPage(1)} disabled={visibleDeckPage === 1} aria-label="First review card page" type="button">First</button><button className="button ghost" onClick={() => changeDeckPage(visibleDeckPage - 1)} disabled={visibleDeckPage === 1} aria-label="Previous review card page" type="button">Previous</button><button className="button ghost" onClick={() => changeDeckPage(visibleDeckPage + 1)} disabled={visibleDeckPage === deckPageCount} aria-label="Next review card page" type="button">Next</button><button className="button ghost" onClick={() => changeDeckPage(deckPageCount)} disabled={visibleDeckPage === deckPageCount} aria-label="Last review card page" type="button">Last</button></div></nav>}</> : <div className="empty-state review-empty"><Brain size={34} /><h2>{normalizedDeckQuery ? "No matching review card" : showArchived ? "No archived cards" : "Build your first recall prompt"}</h2><p>{normalizedDeckQuery ? "Try a broader prompt, answer, type, or tag." : "Create one manually, or turn any clipping or highlight into a source-linked card."}</p>{!normalizedDeckQuery && !showArchived && <button className="button primary" onClick={() => onCreate(null)} type="button">Create first card</button>}</div>}
      </section>
    </div>
  );
}
