import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
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
  X,
} from "lucide-react";
import { renderMarkdown } from "../lib/markdown";
import {
  buildReviewQueue,
  currentTimeZone,
  formatInterval,
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
    requestAnimationFrame(() => dialogRef.current?.querySelector("textarea")?.focus());
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
          <label><span>Card type</span><select value={type} onChange={(event) => setType(event.target.value)}>{REVIEW_CARD_TYPES.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
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
}) {
  const [session, setSession] = useState(false);
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

  if (session && current) {
    const source = documentMap.get(current.documentId);
    const intervals = previewReviewIntervals(current);
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
            <span className="eyebrow">{isNewReviewItem(current) ? "New card" : `Review · ${formatInterval(current.intervalDays)} interval`} · {REVIEW_CARD_TYPES.find((type) => type.id === current.type)?.label || "Basic Q&A"}</span>
            <div className="review-markdown review-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(current.front) }} />
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
        <article className="review-hero"><div><span className="eyebrow">Today’s queue</span><strong>{baseQueue.length}</strong><p>{baseQueue.length ? `${stats.due} total due; workload is capped by today’s remaining limits.` : "You are caught up or today’s limits are complete."}</p><small>{usage.newIntroduced}/{profile.reviewSettings.dailyNewLimit} new · {usage.reviewCompleted}/{profile.reviewSettings.dailyReviewLimit} reviews · {usage.crunchCompleted} extra</small></div><div className="review-hero-actions"><button className="button primary large" onClick={() => startSession(false)} disabled={!baseQueue.length} title={!baseQueue.length ? "No cards remain within today’s limits" : "Start today’s scheduled queue"} type="button"><Play size={19} /> Start review</button><button className="button ghost" onClick={() => startSession(true)} disabled={!profile.reviewItems.some((item) => !item.suspended && !item.archived)} title="Practice up to 20 weak cards beyond the daily queue" type="button"><Flame size={17} /> Crunch weak cards</button><button className="button ghost" onClick={undo} disabled={!lastAttempt?.previousState} title={!lastAttempt?.previousState ? "No reversible grade is available" : "Restore the card and today’s allowance"} type="button"><Undo2 size={16} /> Undo last grade</button></div></article>
        <div className="review-stat-grid"><article><CalendarClock size={20} /><strong>{stats.due}</strong><span>Due now</span></article><article><RotateCcw size={20} /><strong>{stats.learning}</strong><span>Learning</span></article><article><CheckCircle2 size={20} /><strong>{stats.mastered}</strong><span>Mastered</span></article><article><Brain size={20} /><strong>{analytics.retention30 === null ? "—" : `${analytics.retention30}%`}</strong><span>30-day recall</span></article></div>
      </section>
      <section className="review-analytics" aria-label="Review analytics">
        <article><Flame size={18} /><div><strong>{analytics.streak} day{analytics.streak === 1 ? "" : "s"}</strong><span>Current streak</span></div></article>
        <article><Gauge size={18} /><div><strong>{analytics.retention7 === null ? "—" : `${analytics.retention7}%`}</strong><span>7-day recall</span></div></article>
        <article><History size={18} /><div><strong>{formatLatency(analytics.medianLatencyMs)}</strong><span>Median answer time</span></div></article>
        <article className="review-forecast"><div><strong>Next 7 days</strong><span>Scheduled forecast</span></div><div className="forecast-bars" aria-label={`Seven-day review forecast: ${analytics.forecast.join(", ")}`}>{analytics.forecast.map((value, index) => <span key={index} style={{ height: `${Math.max(8, (value / Math.max(...analytics.forecast, 1)) * 100)}%` }} title={`Day ${index}: ${value} reviews`} />)}</div></article>
      </section>
      <section className="review-settings-strip" aria-label="Daily review limits"><div><strong>Daily limits</strong><span>Counts persist by local date ({timeZone}) and cannot refill when a card leaves the queue.</span></div><label>New<select value={profile.reviewSettings.dailyNewLimit} onChange={(event) => onSettingsChange({ dailyNewLimit: Number(event.target.value) })}>{[5, 10, 15, 20, 30, 50].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Reviews<select value={profile.reviewSettings.dailyReviewLimit} onChange={(event) => onSettingsChange({ dailyReviewLimit: Number(event.target.value) })}>{[20, 50, 100, 200, 500].map((value) => <option value={value} key={value}>{value}</option>)}</select></label></section>
      <section className="review-deck-section" ref={deckSectionRef}>
        <div className="section-heading review-deck-heading"><div><span className="eyebrow">Your knowledge deck</span><h2>{deckItems.length} {showArchived ? "archived" : "active"} card{deckItems.length === 1 ? "" : "s"}</h2></div><div className="review-deck-tools"><label><Search size={16} /><input value={deckQuery} onChange={(event) => setDeckQuery(event.target.value)} aria-label="Search review cards" placeholder="Search cards or tags" /></label><button className="button ghost" onClick={() => setShowArchived((value) => !value)} aria-pressed={showArchived} type="button">{showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {showArchived ? "Show active" : `Archived (${stats.archived})`}</button></div></div>
        {deckItems.length ? <><p className="review-deck-range">Showing {deckPageStart + 1}–{deckPageStart + visibleDeckItems.length} of {deckItems.length}</p><div className="review-deck-list">{visibleDeckItems.map((item) => { const source = documentMap.get(item.documentId); return <article className={item.suspended ? "review-deck-card suspended" : "review-deck-card"} key={item.id}><div className="review-card-state"><Brain size={18} /><span>{item.suspended ? "Paused" : isNewReviewItem(item) ? "New" : `${formatInterval(item.intervalDays)} interval`}</span><small>{REVIEW_CARD_TYPES.find((type) => type.id === item.type)?.label}</small></div><div className="review-card-copy"><div className="review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.front) }} /><div className="review-deck-answer review-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.back) }} />{item.tags?.length > 0 && <div className="review-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}{source && <button className="text-button" onClick={() => onOpenSource(source.id)} type="button"><BookOpen size={14} /> {source.title}</button>}</div><div className="review-card-actions"><button className="icon-button" onClick={() => onEdit(item)} aria-label="Edit review card" title="Edit" type="button"><Edit3 size={17} /></button><button className="icon-button" onClick={() => onToggleSuspend(item.id)} aria-label={item.suspended ? "Resume review card" : "Pause review card"} title={item.suspended ? "Resume" : "Pause"} type="button">{item.suspended ? <Play size={17} /> : <Pause size={17} />}</button><button className="icon-button" onClick={() => onToggleArchive(item.id)} aria-label={item.archived ? "Restore review card" : "Archive review card"} title={item.archived ? "Restore" : "Archive"} type="button">{item.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button><button className="icon-button danger" onClick={() => onDelete(item.id)} aria-label="Delete review card" title="Delete permanently" type="button"><Trash2 size={17} /></button></div></article>; })}</div>{deckPageCount > 1 && <nav className="review-deck-pagination" aria-label="Review card pages"><span aria-live="polite" aria-atomic="true">Page {visibleDeckPage} of {deckPageCount}</span><div><button className="button ghost" onClick={() => changeDeckPage(1)} disabled={visibleDeckPage === 1} aria-label="First review card page" type="button">First</button><button className="button ghost" onClick={() => changeDeckPage(visibleDeckPage - 1)} disabled={visibleDeckPage === 1} aria-label="Previous review card page" type="button">Previous</button><button className="button ghost" onClick={() => changeDeckPage(visibleDeckPage + 1)} disabled={visibleDeckPage === deckPageCount} aria-label="Next review card page" type="button">Next</button><button className="button ghost" onClick={() => changeDeckPage(deckPageCount)} disabled={visibleDeckPage === deckPageCount} aria-label="Last review card page" type="button">Last</button></div></nav>}</> : <div className="empty-state review-empty"><Brain size={34} /><h2>{normalizedDeckQuery ? "No matching review card" : showArchived ? "No archived cards" : "Build your first recall prompt"}</h2><p>{normalizedDeckQuery ? "Try a broader prompt, answer, type, or tag." : "Create one manually, or turn any clipping or highlight into a source-linked card."}</p>{!normalizedDeckQuery && !showArchived && <button className="button primary" onClick={() => onCreate(null)} type="button">Create first card</button>}</div>}
      </section>
    </div>
  );
}
