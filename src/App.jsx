import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Bookmark,
  Brain,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Download,
  FileEdit,
  FilePlus2,
  GraduationCap,
  Headphones,
  Highlighter,
  Home,
  Import,
  LibraryBig,
  LayoutGrid,
  List,
  Menu,
  Moon,
  MoreVertical,
  NotebookPen,
  Palette,
  RotateCcw,
  Search,
  Settings,
  Share,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { documentMap, documents, guides, loadDocumentSearchIndex, loadDocumentSource, makeCustomDocument, parts } from "./lib/content";
import { deleteData, getAllData, getData, initialProfile, normalizeProfile, replaceAllData, updateData } from "./lib/db";
import { isProfileReplacementNewer, mergeProfileVersions, prepareProfileReplacement, profilePayloadEqual, PROFILE_REPLACEMENT_EVENT, PROFILE_SYNC_CHANNEL, PROFILE_SYNC_SIGNAL_KEY } from "./lib/profileSync.js";
import { useSpeech } from "./hooks/useSpeech";
import { useWakeLock } from "./hooks/useWakeLock";
import { searchDocuments } from "./lib/search";
import { createId } from "./lib/id.js";
import { customDocumentBytes, MAX_CUSTOM_DOCUMENT_BYTES, selectUploadFiles, utf8Bytes } from "./lib/uploads.js";
import { copyText } from "./lib/clipboard.js";
import { createBackup, createRecoverySnapshot, preflightBackup } from "./lib/backup.js";
import { StorageBudgetError } from "./lib/storageBudget.js";
import { materializeAiCardProvenance, materializeAiFlashcard } from "./lib/aiProvenance.js";
import { recoverableImport } from "./lib/chunkRecovery.js";
import { retrieveLibrary } from "./lib/libraryRetrieval.js";
import ReviewCenter, { ReviewCardDialog } from "./components/ReviewCenter";
import {
  buildReviewQueue,
  createReviewItem,
  currentTimeZone,
  gradeReviewItem,
  localDayKey,
  recordReviewUsage,
  restoreReviewItemFromAttempt,
  reverseReviewUsage,
} from "./lib/review";

const VIEW_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "reader", label: "Read", icon: BookOpen },
  { id: "ai", label: "AI Tutor", icon: Sparkles },
  { id: "review", label: "Review", icon: Brain },
  { id: "notebook", label: "Notebook", icon: NotebookPen },
  { id: "board", label: "Board", icon: Palette },
];
const BOTTOM_VIEW_ITEMS = VIEW_ITEMS.filter(({ id }) => ["home", "library", "reader", "ai", "notebook"].includes(id));
const MAX_LECTURE_EDIT_BYTES = 5 * 1024 * 1024;

const initialDocumentId = "notes/00-roadmap.md";
const Reader = lazy(() => recoverableImport(() => import("./components/Reader")));
const Whiteboard = lazy(() => recoverableImport(() => import("./components/Whiteboard")));
const AiLearningStudio = lazy(() => recoverableImport(() => import("./components/AiLearningStudio")));
const StorageHealth = lazy(() => recoverableImport(() => import("./components/StorageHealth")));

const parseRoute = () => {
  const hash = window.location.hash || "#/home";
  const documentMatch = hash.match(/^#\/(read|board)\/(.+)$/);
  if (documentMatch) return { view: documentMatch[1] === "read" ? "reader" : "board", documentId: decodeURIComponent(documentMatch[2]) };
  const viewMatch = hash.match(/^#\/(home|library|notebook|review|ai)$/);
  return { view: viewMatch?.[1] || "home", documentId: null };
};

const routeFor = (view, documentId) => {
  if (view === "reader") return `#/read/${encodeURIComponent(documentId)}`;
  if (view === "board") return `#/board/${encodeURIComponent(documentId)}`;
  return `#/${view === "settings" ? "home" : view}`;
};

const downloadText = (name, value, type = "application/json") => {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
};

const recoveryRevisionSignature = (records) => JSON.stringify(Object.entries(records || {})
  .filter(([key]) => key === "profile" || key.startsWith("board:"))
  .map(([key, value]) => [
    key,
    value?.syncMeta?.generation || "",
    Number(value?.syncMeta?.revision) || 0,
    value?.syncMeta?.updatedAt || "",
  ])
  .sort(([left], [right]) => left.localeCompare(right)));

const documentProgress = (profile, id) => profile.progress[id] || 0;

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, toast.duration || 3200);
    return () => clearTimeout(timer);
  }, [onClose, toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind || "success"}`} role="status" aria-live="polite"><CheckCircle2 size={17} /><span>{toast.message}</span><button onClick={onClose} aria-label="Dismiss notification" type="button"><X size={15} /></button></div>;
}

function useModalKeyboard(active, dialogRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    const previouslyFocused = document.activeElement;
    requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")?.focus();
    });
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus?.();
    };
  }, [active, dialogRef]);
}

function CreateNoteDialog({ open, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const titleRef = useRef(null);
  const dialogRef = useRef(null);
  useModalKeyboard(open, dialogRef, onClose);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTags("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [open]);

  if (!open) return null;
  const submit = (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
  };

  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close new note dialog" type="button" /><form ref={dialogRef} className="create-note-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="create-note-title"><div className="dialog-icon"><FilePlus2 size={22} /></div><span className="eyebrow">New document</span><h2 id="create-note-title">Create a study note</h2><p>It gets the complete reader, narration, teaching, editing, search, and whiteboard toolset.</p><label><span>Title</span><input ref={titleRef} className="text-input" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Transformer interview review" required /></label><label><span>Tags <small>optional, comma separated</small></span><input className="text-input" value={tags} maxLength={240} onChange={(event) => setTags(event.target.value)} placeholder="transformers, interview, revision" /></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!title.trim()} type="submit">Create and edit</button></div></form></div>;
}

function ProgressRing({ value, size = 92 }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="progress-ring" style={{ width: size, height: size }} aria-label={`${Math.round(value * 100)} percent complete`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={radius} />
        <circle className="ring-value" cx="50" cy="50" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} />
      </svg>
      <strong>{Math.round(value * 100)}%</strong>
    </div>
  );
}

function DocumentCard({ doc, profile, onOpen, compact = false }) {
  const progress = documentProgress(profile, doc.id);
  return (
    <button className={compact ? "document-card compact" : "document-card"} onClick={() => onOpen(doc.id)} type="button">
      <div className="document-card-icon">{progress >= 0.96 ? <Check size={19} /> : doc.isIndex ? <LibraryBig size={19} /> : <BookOpen size={19} />}</div>
      <div className="document-card-copy">
        <span>{doc.partNumber > 0 ? `Part ${doc.partNumber}` : "Guide"} · {doc.minutes} min</span>
        <strong>{doc.title}</strong>
        {!compact && <p>{doc.description}</p>}
        <div className="mini-progress"><span style={{ width: `${progress * 100}%` }} /></div>
      </div>
      <ChevronRight size={19} />
    </button>
  );
}

function Dashboard({ profile, allDocuments, onOpen, onLibrary, onNotebook, onReview }) {
  const recent = profile.recent.map((id) => allDocuments.find((doc) => doc.id === id)).filter(Boolean);
  const continueDoc = recent[0] || documentMap.get(initialDocumentId) || allDocuments[0];
  const learningDocs = allDocuments.filter((doc) => doc.partNumber > 0 && !doc.isIndex);
  const completed = learningDocs.filter((doc) => documentProgress(profile, doc.id) >= 0.96).length;
  const overall = learningDocs.length ? completed / learningDocs.length : 0;
  const annotated = Object.values(profile.personalNotes).filter((note) => note.trim()).length;

  return (
    <div className="page dashboard-page">
      <section className="welcome-block">
        <div>
          <span className="eyebrow">Your private learning studio</span>
          <h1>Learn deeply.<br /><em>At your pace.</em></h1>
          <p>Read, listen, annotate, explain, and sketch through the complete AI/ML curriculum.</p>
          <button className="button primary large" onClick={() => onOpen(continueDoc.id)} type="button">
            <BookOpen size={19} /> Continue learning <ArrowRight size={18} />
          </button>
        </div>
        <div className="welcome-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="glow-core"><Sparkles size={32} /></div>
          <span className="orbit-label one">Read</span>
          <span className="orbit-label two">Listen</span>
          <span className="orbit-label three">Teach</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="continue-card">
          <div className="section-heading"><div><span className="eyebrow">Continue</span><h2>{continueDoc.title}</h2></div><ProgressRing value={documentProgress(profile, continueDoc.id)} /></div>
          <p>{continueDoc.description}</p>
          <div className="continue-meta"><span><Clock3 size={16} /> {continueDoc.minutes} min</span><span>{continueDoc.partTitle}</span></div>
          <button className="button secondary" onClick={() => onOpen(continueDoc.id)} type="button">Open lecture <ArrowRight size={17} /></button>
        </article>

        <article className="stats-card">
          <span className="eyebrow">Study pulse</span>
          <div className="big-stat"><strong>{completed}</strong><span>lectures<br />completed</span></div>
          <div className="stat-row"><span>Overall progress</span><strong>{Math.round(overall * 100)}%</strong></div>
          <div className="stat-row"><span>Personal notes</span><strong>{annotated}</strong></div>
          <div className="stat-row"><span>Bookmarks</span><strong>{profile.bookmarks.length}</strong></div>
        </article>
      </section>

      <section className="page-section">
        <div className="section-heading"><div><span className="eyebrow">Curriculum</span><h2>Explore 23 structured parts</h2></div><button className="text-button" onClick={onLibrary} type="button">View all <ArrowRight size={16} /></button></div>
        <div className="part-carousel">
          {parts.slice(0, 8).map((part) => {
            const partDocs = part.documents.filter((doc) => !doc.isIndex);
            const partValue = partDocs.length ? partDocs.reduce((sum, doc) => sum + documentProgress(profile, doc.id), 0) / partDocs.length : 0;
            return (
              <button className="part-tile" key={part.number} onClick={() => onOpen(part.startId)} type="button">
                <div className="part-number">{String(part.number).padStart(2, "0")}</div>
                <strong>{part.title.replace(/^Part \d+\s+[—-]\s+/, "")}</strong>
                <span>{part.documents.length - 1} lectures · {part.minutes} min</span>
                <div className="mini-progress"><span style={{ width: `${partValue * 100}%` }} /></div>
              </button>
            );
          })}
        </div>
      </section>

      {recent.length > 1 && (
        <section className="page-section">
          <div className="section-heading"><div><span className="eyebrow">History</span><h2>Recently opened</h2></div></div>
          <div className="document-list">{recent.slice(1, 5).map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={onOpen} compact />)}</div>
        </section>
      )}

      <section className="study-method-card">
        <div className="method-icon"><GraduationCap size={26} /></div>
        <div><span className="eyebrow">Better than passive reading</span><h2>Read → recall → explain → implement</h2><p>Use narration during review, personal notes for retrieval practice, teaching mode to explain aloud, and the whiteboard for derivations.</p></div>
        <div className="dashboard-method-actions"><button className="button ghost" onClick={onNotebook} type="button">Open notebook</button><button className="button primary" onClick={onReview} type="button"><Brain size={17} /> Review {profile.reviewItems.filter((item) => !item.suspended && Date.parse(item.dueAt) <= Date.now()).length} due</button></div>
      </section>
    </div>
  );
}

function LibraryView({ profile, query, setQuery, selectedPart, setSelectedPart, allDocuments, customDocuments, onOpen }) {
  const [sortBy, setSortBy] = useState("smart");
  const [layout, setLayout] = useState("grid");
  const [searchIndex, setSearchIndex] = useState(null);
  const [searchIndexError, setSearchIndexError] = useState("");
  const normalized = query.trim();
  useEffect(() => {
    if (!normalized || searchIndex) return undefined;
    let active = true;
    loadDocumentSearchIndex()
      .then((index) => { if (active) setSearchIndex(index); })
      .catch(() => { if (active) setSearchIndexError("Full lecture text could not be loaded; title and summary search remains available."); });
    return () => { active = false; };
  }, [normalized, searchIndex]);
  const visible = useMemo(() => {
    let candidates = selectedPart === "uploads"
      ? customDocuments
      : selectedPart === "guides"
        ? guides
        : selectedPart === "bookmarks"
          ? allDocuments.filter((doc) => profile.bookmarks.includes(doc.id))
          : selectedPart === "progress"
            ? allDocuments.filter((doc) => (profile.progress[doc.id] || 0) > 0 && (profile.progress[doc.id] || 0) < 0.96)
            : selectedPart === "recent"
              ? profile.recent.map((id) => allDocuments.find((doc) => doc.id === id)).filter(Boolean)
            : selectedPart
              ? allDocuments.filter((doc) => doc.partNumber === Number(selectedPart))
              : allDocuments;
    if (normalized && searchIndex) candidates = candidates.map((doc) => doc.source === "builtin" ? { ...doc, searchText: searchIndex.get(doc.id) || doc.searchText } : doc);
    const results = normalized ? searchDocuments(candidates, normalized) : [...candidates];
    if (sortBy === "smart") return results;
    if (sortBy === "title") return results.sort((a, b) => a.title.localeCompare(b.title));
    if (sortBy === "shortest") return results.sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title));
    if (sortBy === "progress") return results.sort((a, b) => (profile.progress[b.id] || 0) - (profile.progress[a.id] || 0));
    if (sortBy === "recent") return results.sort((a, b) => {
      const aIndex = profile.recent.indexOf(a.id);
      const bIndex = profile.recent.indexOf(b.id);
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
    return results.sort((a, b) => a.partNumber - b.partNumber || a.chapterNumber - b.chapterNumber || a.title.localeCompare(b.title));
  }, [allDocuments, customDocuments, normalized, profile.bookmarks, profile.progress, profile.recent, searchIndex, selectedPart, sortBy]);

  return (
    <div className="page library-page">
      <header className="page-title">
        <div><span className="eyebrow">Complete curriculum</span><h1>Your library</h1><p>Search every lecture, formula, method, technology, exercise, and interview prompt.</p></div>
        <div className="library-count"><strong>{allDocuments.length}</strong><span>documents</span></div>
      </header>
      <div className="library-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search concepts, tools, formulas…" aria-label="Search library" />{normalized && !searchIndex && !searchIndexError && <span className="search-index-loading" role="status">Loading full text…</span>}{query && <button onClick={() => setQuery("")} aria-label="Clear search" type="button"><X size={17} /></button>}</div>
      {searchIndexError && <p className="inline-warning">{searchIndexError}</p>}
      <div className="filter-row">
        <button className={!selectedPart ? "active" : ""} onClick={() => setSelectedPart(null)} type="button">All</button>
        <button className={selectedPart === "guides" ? "active" : ""} onClick={() => setSelectedPart("guides")} type="button">Guides</button>
        <button className={selectedPart === "bookmarks" ? "active" : ""} onClick={() => setSelectedPart("bookmarks")} type="button">Bookmarks</button>
        <button className={selectedPart === "progress" ? "active" : ""} onClick={() => setSelectedPart("progress")} type="button">In progress</button>
        <button className={selectedPart === "recent" ? "active" : ""} onClick={() => setSelectedPart("recent")} type="button">Recent</button>
        {customDocuments.length > 0 && <button className={selectedPart === "uploads" ? "active" : ""} onClick={() => setSelectedPart("uploads")} type="button">My uploads</button>}
        {parts.map((part) => <button className={selectedPart === String(part.number) ? "active" : ""} onClick={() => setSelectedPart(String(part.number))} aria-label={`Part ${part.number}: ${part.title}`} title={part.title} key={part.number} type="button">{part.number}</button>)}
      </div>
      <div className="library-results-toolbar"><div className="library-results-meta"><span>{visible.length} results</span>{normalized && <span>for “{query}”</span>}</div><div className="library-view-controls"><label><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort library results"><option value="smart">{normalized ? "Relevance" : "Curriculum order"}</option><option value="curriculum">Curriculum order</option><option value="recent">Recently opened</option><option value="progress">Most progress</option><option value="shortest">Shortest first</option><option value="title">Title A–Z</option></select></label><div role="group" aria-label="Library layout"><button className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")} aria-label="Grid layout" type="button"><LayoutGrid size={17} /></button><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} aria-label="List layout" type="button"><List size={18} /></button></div></div></div>
      <div className={layout === "list" ? "document-grid list-layout" : "document-grid"}>
        {visible.map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={onOpen} compact={layout === "list"} />)}
      </div>
      {!visible.length && <div className="empty-state"><Search size={30} /><h2>No matching lecture</h2><p>Try a broader concept or choose another Part.</p></div>}
    </div>
  );
}

function NotebookView({ profile, allDocuments, customDocuments, onOpen, onUpload, onCreate, onDeleteCustom, onDuplicateCustom, onDeleteClipping, onUpdateClipping, onCopyClipping, onCreateReview, onDeleteAnnotation }) {
  const [notebookQuery, setNotebookQuery] = useState("");
  const [annotationPurpose, setAnnotationPurpose] = useState("all");
  const annotated = Object.entries(profile.personalNotes).filter(([, note]) => note.trim()).map(([id, note]) => ({ doc: allDocuments.find((item) => item.id === id), note })).filter((item) => item.doc);
  const edited = Object.keys(profile.edits).map((id) => allDocuments.find((item) => item.id === id)).filter(Boolean);
  const bookmarked = profile.bookmarks.map((id) => allDocuments.find((item) => item.id === id)).filter(Boolean);
  const normalizedQuery = notebookQuery.trim().toLocaleLowerCase();
  const matches = (...values) => !normalizedQuery || values.some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
  const visibleCustom = customDocuments.filter((doc) => matches(doc.title, doc.tags?.join(" "), doc.raw));
  const visibleAnnotated = annotated.filter(({ doc, note }) => matches(doc.title, doc.partTitle, note));
  const visibleClippings = profile.clippings.filter((clip) => { const doc = allDocuments.find((item) => item.id === clip.documentId); return matches(doc?.title, clip.text, clip.note); });
  const visibleAnnotations = profile.annotations.filter((annotation) => { const doc = allDocuments.find((item) => item.id === annotation.documentId); return (annotationPurpose === "all" || annotation.purpose === annotationPurpose) && matches(doc?.title, annotation.quote, annotation.comment, annotation.tags?.join(" "), annotation.purpose); });
  const visibleBookmarked = bookmarked.filter((doc) => matches(doc.title, doc.partTitle, doc.description));
  const visibleCount = visibleCustom.length + visibleAnnotated.length + visibleClippings.length + visibleAnnotations.length + visibleBookmarked.length;
  const uploadRef = useRef(null);
  return (
    <div className="page notebook-page">
      <header className="page-title">
        <div><span className="eyebrow">Your work</span><h1>Study notebook</h1><p>Private notes, edits, uploads, and saved lectures live on this device.</p></div>
        <div className="notebook-actions">
          <input ref={uploadRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onChange={onUpload} />
          <button className="button secondary" onClick={() => uploadRef.current?.click()} type="button"><Upload size={17} /> Upload</button>
          <button className="button primary" onClick={onCreate} type="button"><FilePlus2 size={17} /> New note</button>
        </div>
      </header>

      <div className="notebook-summary">
        <div><Bookmark size={20} /><strong>{bookmarked.length}</strong><span>Bookmarks</span></div>
        <div><NotebookPen size={20} /><strong>{annotated.length}</strong><span>Annotations</span></div>
        <div><FileEdit size={20} /><strong>{edited.length}</strong><span>Edited copies</span></div>
        <div><Upload size={20} /><strong>{customDocuments.length}</strong><span>Uploads</span></div>
        <div><Highlighter size={20} /><strong>{profile.clippings.length}</strong><span>Clippings</span></div>
        <div><Highlighter size={20} /><strong>{profile.annotations.length}</strong><span>Highlights</span></div>
      </div>

      <div className="notebook-search"><Search size={18} /><input value={notebookQuery} onChange={(event) => setNotebookQuery(event.target.value)} placeholder="Search your notes, clippings, bookmarks, and uploads…" aria-label="Search notebook" />{notebookQuery && <button onClick={() => setNotebookQuery("")} aria-label="Clear notebook search" type="button"><X size={16} /></button>}</div>

      {visibleCustom.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Created and uploaded</span><h2>My lectures</h2></div></div><div className="document-list">{visibleCustom.map((doc) => <div className="notebook-document-row" key={doc.id}><DocumentCard doc={doc} profile={profile} onOpen={onOpen} compact /><div className="notebook-row-actions"><button className="icon-button" onClick={() => onDuplicateCustom(doc.id)} aria-label={`Duplicate ${doc.title}`} title="Duplicate" type="button"><Copy size={17} /></button><button className="icon-button danger" onClick={() => onDeleteCustom(doc.id)} aria-label={`Delete ${doc.title}`} title="Delete" type="button"><Trash2 size={17} /></button></div></div>)}</div></section>}
      {visibleAnnotated.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Captured ideas</span><h2>Personal notes</h2></div></div><div className="note-grid">{visibleAnnotated.map(({ doc, note }) => <button className="note-card" onClick={() => onOpen(doc.id)} key={doc.id} type="button"><span>{doc.partTitle}</span><strong>{doc.title}</strong><p>{note}</p><ChevronRight size={18} /></button>)}</div></section>}
      {visibleClippings.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Saved excerpts</span><h2>Clippings</h2></div></div><div className="clipping-grid">{visibleClippings.map((clip) => { const doc = allDocuments.find((item) => item.id === clip.documentId); const linked = profile.reviewItems.some((item) => item.sourceClippingId === clip.id); const aiOrigin = clip.origin === "ai-tutor"; return <article className={`clipping-card${aiOrigin ? " clipping-card--ai" : ""}`} key={clip.id}>{aiOrigin ? <BrainCircuit size={18} /> : <Highlighter size={18} />}{aiOrigin && <span className="clipping-origin" title="Generated by the AI tutor and saved by you; verify before relying on it">{clip.title || "AI tutor answer"} · AI draft</span>}<blockquote>{clip.text}</blockquote><textarea value={clip.note || ""} maxLength={4_000} onChange={(event) => onUpdateClipping(clip.id, event.target.value)} placeholder="Add why this matters, a question, or an interview connection…" aria-label="Comment on this clipping" /><div>{doc || !aiOrigin ? <button className="text-button" onClick={() => doc && onOpen(doc.id)} disabled={!doc} type="button">{doc?.title || "Missing document"}</button> : <span className="clipping-no-source">No linked lecture</span>}<span className="clipping-actions"><button className="icon-button small" onClick={() => onCreateReview(clip)} aria-label={linked ? "Create another review card from clipping" : "Create review card from clipping"} title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small" onClick={() => onCopyClipping(clip)} aria-label="Copy clipping" title="Copy" type="button"><Copy size={15} /></button><button className="icon-button small danger" onClick={() => onDeleteClipping(clip.id)} aria-label="Delete clipping" title="Delete" type="button"><Trash2 size={15} /></button></span></div></article>; })}</div></section>}
      {profile.annotations.length > 0 && <section className="notebook-section"><div className="section-heading annotation-section-heading"><div><span className="eyebrow">Source anchored</span><h2>Highlights</h2></div><label>Purpose<select value={annotationPurpose} onChange={(event) => setAnnotationPurpose(event.target.value)}><option value="all">All</option><option value="important">Important</option><option value="definition">Definitions</option><option value="question">Questions</option><option value="interview">Interview</option></select></label></div>{visibleAnnotations.length ? <div className="notebook-annotation-grid">{visibleAnnotations.map((annotation) => { const doc = allDocuments.find((item) => item.id === annotation.documentId); return <article className={`notebook-annotation-card ${annotation.color}`} key={annotation.id}><span className="annotation-purpose">{annotation.purpose}</span><blockquote>{annotation.quote}</blockquote>{annotation.comment && <p>{annotation.comment}</p>}{annotation.tags?.length > 0 && <div className="annotation-tags">{annotation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}<div><button className="text-button" onClick={() => doc && onOpen(doc.id)} disabled={!doc} type="button">{doc?.title || "Missing document"}</button><span className="clipping-actions"><button className="icon-button small" onClick={() => onCreateReview(annotation)} aria-label="Create review card from highlight" title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small danger" onClick={() => onDeleteAnnotation(annotation.id)} aria-label="Delete highlight" title="Delete" type="button"><Trash2 size={15} /></button></span></div></article>; })}</div> : <div className="empty-state compact"><Search size={24} /><h2>No matching highlights</h2><p>Choose another purpose or clear the notebook search.</p></div>}</section>}
      {visibleBookmarked.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Saved</span><h2>Bookmarks</h2></div></div><div className="document-list">{visibleBookmarked.map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={onOpen} compact />)}</div></section>}
      {normalizedQuery && !visibleCount && <div className="empty-state"><Search size={30} /><h2>No notebook match</h2><p>Try a document title, a phrase from a clipping, a tag, or words from your own annotation.</p><button className="button secondary" onClick={() => setNotebookQuery("")} type="button">Clear search</button></div>}
      {!customDocuments.length && !annotated.length && !bookmarked.length && !profile.clippings.length && !profile.annotations.length && <div className="empty-state notebook-empty"><NotebookPen size={34} /><h2>Your notebook is ready</h2><p>Bookmark a lecture, highlight or clip an excerpt, write a personal note, edit a local copy, or upload your own Markdown.</p><button className="button primary" onClick={onCreate} type="button">Create first note</button></div>}
    </div>
  );
}

function SettingsView({ settings, backupMeta, aiHistoryCount, onClearAiHistory, onSettingsChange, onResetSettings, onResetApp, onExport, onImport, onInstall, onNotify, online, secureContext, saveStatus, wakeLock, storagePersisted, onRequestStorage }) {
  const importRef = useRef(null);
  return (
    <div className="page settings-page">
      <header className="page-title"><div><span className="eyebrow">Make it yours</span><h1>Settings</h1><p>Appearance, reading comfort, backups, and iPhone installation.</p></div></header>
      <section className="settings-card">
        <div className="settings-card-heading"><Palette size={21} /><div><strong>Appearance</strong><span>Choose a reading atmosphere.</span></div></div>
        <div className="theme-choices">
          {[{ id: "system", label: "System", icon: CircleUserRound }, { id: "paper", label: "Paper", icon: Sun }, { id: "dark", label: "Night", icon: Moon }].map(({ id, label, icon: Icon }) => <button className={settings.theme === id ? "active" : ""} onClick={() => onSettingsChange({ theme: id })} key={id} type="button"><Icon size={21} /><span>{label}</span>{settings.theme === id && <Check size={16} />}</button>)}
        </div>
        <label className="setting-range"><span><strong>Default text size</strong><small>{Math.round(settings.fontScale * 100)}%</small></span><input type="range" min="0.85" max="1.35" step="0.05" value={settings.fontScale} onChange={(event) => onSettingsChange({ fontScale: Number(event.target.value) })} aria-label="Default reading text size" /></label>
        <label className="setting-range"><span><strong>Default line spacing</strong><small>{settings.lineHeight}</small></span><input type="range" min="1.45" max="2" step="0.05" value={settings.lineHeight} onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })} aria-label="Default reading line spacing" /></label>
        <label className="setting-toggle"><span><strong>Keep screen awake while studying</strong><small>{wakeLock.supported ? (wakeLock.active ? "Active now" : "Activates in reader and whiteboard") : "Not supported by this browser"}</small></span><input type="checkbox" role="switch" checked={settings.keepScreenAwake} disabled={!wakeLock.supported} onChange={(event) => onSettingsChange({ keepScreenAwake: event.target.checked })} aria-label="Keep screen awake while studying" /></label>
        {wakeLock.error && <p className="inline-warning">{wakeLock.error}</p>}
        <button className="button ghost settings-reset-button" onClick={onResetSettings} type="button"><RotateCcw size={16} /> Restore reading defaults</button>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><Share size={21} /><div><strong>Backup and transfer</strong><span>Move your private study data between devices.</span></div></div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
        <div className="settings-action-row"><button className="button secondary" onClick={onExport} type="button"><Download size={17} /> Export backup</button><button className="button secondary" onClick={() => importRef.current?.click()} type="button"><Import size={17} /> Import backup</button>{!storagePersisted && <button className="button ghost" onClick={onRequestStorage} type="button">Protect local storage</button>}</div>
        <p className="microcopy">Backups include progress, positions, bookmarks, highlights, clippings, review history, locally saved AI conversations, personal notes, edited copies, uploads, preferences, and whiteboards. Every new backup is checksummed and every restore is preflighted. Storage: {storagePersisted ? "persistent" : "best effort"} · Save status: {saveStatus} · Last export: {backupMeta?.lastExportAt ? new Date(backupMeta.lastExportAt).toLocaleString() : "never"}.</p>
        <div className="settings-local-data"><div><strong>AI features</strong><span>{settings.aiFeaturesEnabled !== false ? "The AI learning studio is available. Turning it off hides AI surfaces without touching your notes or reviews." : "The AI learning studio is hidden. Reading, notes, reviews, narration, and whiteboards are unaffected."}</span></div><button className="button ghost" onClick={() => { const next = settings.aiFeaturesEnabled === false; onSettingsChange({ aiFeaturesEnabled: next }); onNotify(next ? "AI features are enabled again." : "AI features are now off. You can re-enable them here at any time."); }} type="button"><BrainCircuit size={16} /> {settings.aiFeaturesEnabled !== false ? "Turn AI off" : "Turn AI on"}</button></div>
        <div className="settings-local-data"><div><strong>Mac tutor history retention</strong><span>Choose how many tutor messages stay saved in this browser and in backups. “Session only” stops saving and removes the stored conversation.</span></div><label className="settings-retention"><span className="visually-hidden">Mac tutor history retention</span><select value={[0, 10, 25, 50].includes(settings.aiHistoryRetention) ? settings.aiHistoryRetention : 50} onChange={(event) => { const retention = Number(event.target.value); onSettingsChange({ aiHistoryRetention: retention }); onNotify(retention === 0 ? "Tutor history is now session-only; the saved conversation was removed." : `Up to ${retention} tutor messages will be kept locally.`); }}><option value={50}>Up to 50 messages</option><option value={25}>Up to 25 messages</option><option value={10}>Up to 10 messages</option><option value={0}>Session only (do not save)</option></select></label></div>
        <div className="settings-local-data"><div><strong>AI tutor history</strong><span>{aiHistoryCount ? `${aiHistoryCount} locally saved message${aiHistoryCount === 1 ? "" : "s"}; included in backups.` : "No locally saved AI conversation messages."}</span></div><button className="button ghost" onClick={onClearAiHistory} disabled={!aiHistoryCount} type="button"><Trash2 size={16} /> Clear AI history</button></div>
      </section>
      <Suspense fallback={<div className="settings-card"><p className="microcopy">Measuring storage health…</p></div>}><StorageHealth online={online} onNotify={onNotify} /></Suspense>
      <section className="settings-card install-card">
        <div className="settings-card-heading"><Sparkles size={21} /><div><strong>Install on iPhone</strong><span>Use Lumen like a native full-screen app.</span></div></div>
        {!secureContext && <p className="inline-warning">This HTTP connection supports reading and local notes, but iPhone installation and offline caching require an HTTPS address.</p>}
        <button className="button primary" onClick={onInstall} type="button">{secureContext ? "Show installation steps" : "See HTTPS requirement"}</button>
        <div className={online ? "connection-state online" : "connection-state offline"}>{online ? <Wifi size={16} /> : <WifiOff size={16} />}{online ? "Online · content updates available" : "Offline · cached content remains available"}</div>
      </section>
      <section className="privacy-card"><div className="privacy-icon">L</div><div><strong>Local-first by design</strong><p>No account is required. Notes, whiteboards, and AI conversation history remain in this browser’s storage unless you export or clear them. AI sends only the prompt and sources you explicitly approve for that request.</p></div></section>
      <section className="settings-card danger-zone"><div className="settings-card-heading"><AlertTriangle size={21} /><div><strong>Reset local app data</strong><span>Permanently removes progress, notes, uploads, clippings, edits, and every whiteboard from this browser.</span></div></div><p className="microcopy">Export a backup first if you may need this work again.</p><button className="button danger-button" onClick={onResetApp} type="button"><Trash2 size={17} /> Reset everything</button></section>
    </div>
  );
}

function InstallSheet({ onClose, secureContext }) {
  const dialogRef = useRef(null);
  useModalKeyboard(true, dialogRef, onClose);
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close" type="button" /><section ref={dialogRef} className="install-sheet" role="dialog" aria-modal="true" aria-label="Install on iPhone"><div className="sheet-handle" /><div className="install-mark">L</div><span className="eyebrow">iPhone installation</span><h2>{secureContext ? "Add Lumen to your Home Screen" : "HTTPS is required first"}</h2>{secureContext ? <><ol><li><strong>Open this site in Safari.</strong><span>Installation from in-app browsers may not show every option.</span></li><li><strong>Tap the Share button.</strong><span>It is the square with an upward arrow.</span></li><li><strong>Choose “Add to Home Screen.”</strong><span>Scroll the action list if necessary.</span></li><li><strong>Tap Add.</strong><span>Open Lumen from the new Home Screen icon once while online.</span></li></ol><p>After the first successful load, the app shell and visited curriculum assets are available offline. iOS voices can be managed in Settings → Accessibility → Spoken Content → Voices.</p></> : <><p>The current address uses plain HTTP. iOS browsers do not expose service workers, secure clipboard access, screen wake lock, or persistent-storage controls to this origin.</p><ol><li><strong>Deploy behind HTTPS.</strong><span>Use a trusted certificate, reverse proxy, or secure tunnel.</span></li><li><strong>Open the HTTPS address in Safari.</strong><span>Confirm the lock icon before studying private material or enabling AI.</span></li><li><strong>Then add it to the Home Screen.</strong><span>The installation option and offline cache can initialize only in a secure context.</span></li></ol></>}<button className="button primary full" onClick={onClose} type="button">Got it</button></section></div>;
}

function BackupImportDialog({ candidate, busy, onClose, onConfirm }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const dialogRef = useRef(null);
  useModalKeyboard(Boolean(candidate), dialogRef, onClose);
  useEffect(() => setAcknowledged(false), [candidate]);
  if (!candidate) return null;
  const recoveryPrepared = Boolean(candidate.recoveryPreparedAt);
  const counts = candidate.summary.counts;
  const size = candidate.summary.inputBytes || candidate.summary.fileBytes || candidate.summary.payloadBytes;
  const sizeLabel = size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="modal-layer backup-preflight-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Cancel backup restore" type="button" />
      <section ref={dialogRef} className="backup-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-preflight-title">
        <button className="icon-button backup-dialog-close" onClick={onClose} disabled={busy} aria-label="Cancel backup restore" type="button"><X size={19} /></button>
        <div className="dialog-icon"><Import size={22} /></div><span className="eyebrow">{recoveryPrepared ? "Recovery checkpoint" : "Verified before restore"}</span>
        <h2 id="backup-preflight-title">{recoveryPrepared ? "Verify the recovery file" : "Review this backup"}</h2>
        <p>{recoveryPrepared ? "Lumen requested a recovery download and has not replaced any local data. Check Files or Downloads for the recovery JSON before continuing." : "No local data has changed. Confirm the inventory and warnings before replacing this device’s current study workspace."}</p>
        <div className="backup-integrity-state"><CheckCircle2 size={18} /><div><strong>{candidate.integrity.verified ? "Integrity check passed" : "Legacy file has no checksum"}</strong><span>{candidate.integrity.algorithm} · version {candidate.sourceVersion} → {candidate.targetVersion} · {sizeLabel}</span></div></div>
        <dl className="backup-inventory"><div><dt>Documents</dt><dd>{counts.customDocuments}</dd></div><div><dt>Notes</dt><dd>{counts.personalNotes}</dd></div><div><dt>Highlights</dt><dd>{counts.annotations}</dd></div><div><dt>Review cards</dt><dd>{counts.reviewItems}</dd></div><div><dt>Attempts</dt><dd>{counts.reviewAttempts}</dd></div><div><dt>AI messages</dt><dd>{counts.aiTutorMessages || 0}</dd></div><div><dt>Whiteboards</dt><dd>{counts.boards}</dd></div></dl>
        <p className="backup-exported-at">Exported {candidate.exportedAt ? new Date(candidate.exportedAt).toLocaleString() : "at an unknown time"}.</p>
        {candidate.warnings.length > 0 && <div className="backup-warnings" role="status"><AlertTriangle size={17} /><div><strong>{candidate.warnings.length} preflight warning{candidate.warnings.length === 1 ? "" : "s"}</strong><ul>{candidate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>}
        <label className="backup-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span><strong>{recoveryPrepared ? "I verified the recovery JSON is available outside Lumen." : "I understand this replaces current local app data."}</strong><small>{recoveryPrepared ? "If the file is missing, cancel and start the restore again—your local workspace is still unchanged." : "The next step creates a separate recovery snapshot; replacement requires a second confirmation."}</small></span></label>
        <div className="modal-actions"><button className="button ghost" onClick={onClose} disabled={busy} type="button">Cancel</button><button className="button danger-button" onClick={onConfirm} disabled={!acknowledged || busy} title={!acknowledged ? "Complete the confirmation first" : recoveryPrepared ? "Replace local data with the verified backup" : "Create a recovery snapshot"} type="button">{busy ? (recoveryPrepared ? "Restoring…" : "Preparing recovery…") : (recoveryPrepared ? "Restore now" : "Create recovery file")}</button></div>
      </section>
    </div>
  );
}

export default function App() {
  const [profile, setProfile] = useState(initialProfile);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState(() => parseRoute().view);
  const [currentDocumentId, setCurrentDocumentId] = useState(() => parseRoute().documentId || initialDocumentId);
  const [query, setQuery] = useState("");
  const [selectedPart, setSelectedPart] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(null);
  const [backupCandidate, setBackupCandidate] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [editRequestId, setEditRequestId] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [storagePersisted, setStoragePersisted] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [pwaIssue, setPwaIssue] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches || false);
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia?.("(max-width: 980px)").matches || false);
  const [builtInSources, setBuiltInSources] = useState({});
  const [sourceLoadError, setSourceLoadError] = useState("");
  const [phoneAiSessionHistory, setPhoneAiSessionHistory] = useState([]);
  const [readerNavigationTarget, setReaderNavigationTarget] = useState(null);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const saveSequence = useRef(0);
  const profileRef = useRef(profile);
  const profileBaseRef = useRef(initialProfile);
  const profileWriterIdRef = useRef("");
  const profileReplacementRef = useRef(false);
  const signalProfileSyncRef = useRef(() => {});
  const reportedSyncConflictsRef = useRef(new Set());
  const lastPersistenceErrorRef = useRef("");
  const navigationApprovedRef = useRef(false);
  const settingsDialogRef = useRef(null);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);

  if (!profileWriterIdRef.current) profileWriterIdRef.current = createId();

  useModalKeyboard(settingsOpen && !installOpen, settingsDialogRef, () => setSettingsOpen(false));

  profileRef.current = profile;

  useEffect(() => {
    if (!settingsOpen && !installOpen && !createOpen && !reviewDraft && !backupCandidate) return undefined;
    const regions = [...document.querySelectorAll(".app-sidebar, .app-topbar, .view-container, .bottom-nav, .update-banner")];
    if (installOpen) regions.push(...document.querySelectorAll(".settings-overlay"));
    regions.forEach((region) => {
      region.inert = true;
      region.setAttribute("aria-hidden", "true");
    });
    return () => regions.forEach((region) => {
      region.inert = false;
      region.removeAttribute("aria-hidden");
    });
  }, [backupCandidate, createOpen, installOpen, reviewDraft, settingsOpen]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 980px)");
    if (!media) return undefined;
    const update = (event) => {
      setCompactNavigation(event.matches);
      if (!event.matches) setSidebarOpen(false);
    };
    setCompactNavigation(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!compactNavigation || !sidebarOpen) return undefined;
    const sidebar = sidebarRef.current;
    const main = document.querySelector(".app-main");
    const previousOverflow = document.body.style.overflow;
    if (main) {
      main.inert = true;
      main.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => sidebar?.querySelector(".sidebar-close")?.focus());
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sidebar?.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (main) {
        main.inert = false;
        main.removeAttribute("aria-hidden");
      }
      menuButtonRef.current?.focus?.();
    };
  }, [compactNavigation, sidebarOpen]);

  const notify = useCallback((message, kind = "success", duration) => {
    setToast({ id: createId(), message, kind, duration });
  }, []);

  const reportPersistenceError = useCallback((error) => {
    const message = error instanceof StorageBudgetError
      ? `${error.message} The current unsaved change remains visible in this tab; reduce local data before closing or reloading.`
      : "Changes could not be saved to this browser. Keep this tab open and retry after checking available storage.";
    if (lastPersistenceErrorRef.current === message) return;
    lastPersistenceErrorRef.current = message;
    notify(message, "error", 9000);
  }, [notify]);

  const reportSyncConflicts = useCallback((conflicts) => {
    const fresh = (conflicts || []).filter((conflict) => conflict?.id && !reportedSyncConflictsRef.current.has(conflict.id));
    if (!fresh.length) return;
    fresh.forEach((conflict) => reportedSyncConflictsRef.current.add(conflict.id));
    notify(`Reconciled ${fresh.length} concurrent tab change${fresh.length === 1 ? "" : "s"}. Newer edits were kept; any competing text was preserved as a recovered note.`, "warning", 8000);
  }, [notify]);

  useEffect(() => {
    let active = true;
    getData("profile")
      .then((saved) => {
        if (!active) return;
        const normalized = normalizeProfile(saved);
        profileBaseRef.current = normalized;
        profileRef.current = normalized;
        normalized.syncMeta.conflicts.forEach((conflict) => reportedSyncConflictsRef.current.add(conflict.id));
        setProfile(normalized);
        if (!parseRoute().documentId && normalized.lastDocumentId) setCurrentDocumentId(normalized.lastDocumentId);
      })
      .catch(() => {
        if (active) {
          const normalized = normalizeProfile(initialProfile);
          profileBaseRef.current = normalized;
          profileRef.current = normalized;
          setProfile(normalized);
        }
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    navigator.storage?.persisted?.().then(setStoragePersisted).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    let channel = null;
    let active = true;
    let reading = false;
    let pending = false;

    const applyRemoteProfile = (value) => {
      if (!active) return;
      const remote = normalizeProfile(value);
      const base = profileBaseRef.current;
      const current = profileRef.current;
      if (remote.syncMeta.generation !== base.syncMeta.generation) {
        if (!isProfileReplacementNewer(remote, base)) return;
        clearTimeout(saveTimer.current);
        saveSequence.current += 1;
        window.dispatchEvent(new CustomEvent(PROFILE_REPLACEMENT_EVENT, { detail: { phase: "begin", reason: remote.syncMeta.replacementReason, generation: remote.syncMeta.generation, remote: true } }));
        profileBaseRef.current = remote;
        profileRef.current = remote;
        setProfile(remote);
        setSaveStatus("saved");
        notify(`Local data was ${remote.syncMeta.replacementReason === "restore" ? "restored" : "reset"} in another tab. This tab adopted the replacement.`, "warning", 7000);
        setTimeout(() => window.location.reload(), 0);
        return;
      }
      if (remote.syncMeta.revision < base.syncMeta.revision) return;
      if (remote.syncMeta.revision === base.syncMeta.revision && profilePayloadEqual(remote, base)) return;

      if (current === base || profilePayloadEqual(current, base)) {
        profileBaseRef.current = remote;
        profileRef.current = remote;
        setProfile(remote);
        setSaveStatus("saved");
        return;
      }

      const result = mergeProfileVersions(base, current, remote, {
        advanceRevision: false,
        writerId: profileWriterIdRef.current,
      });
      profileBaseRef.current = remote;
      profileRef.current = result.profile;
      setProfile(result.profile);
      reportSyncConflicts(result.conflicts);
    };

    const readLatestProfile = async () => {
      if (reading) {
        pending = true;
        return;
      }
      reading = true;
      try {
        do {
          pending = false;
          const stored = await getData("profile");
          if (stored) applyRemoteProfile(stored);
        } while (active && pending);
      } catch {
        // A later profile signal or the normal save path will retry.
      } finally {
        reading = false;
      }
    };

    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(PROFILE_SYNC_CHANNEL);
        channel.onmessage = (event) => {
          if (event.data?.origin !== profileWriterIdRef.current) readLatestProfile();
        };
      }
    } catch {
      channel = null;
    }

    const onStorage = (event) => {
      if (event.key !== PROFILE_SYNC_SIGNAL_KEY || !event.newValue) return;
      try {
        if (JSON.parse(event.newValue)?.origin === profileWriterIdRef.current) return;
      } catch {
        // A malformed signal still warrants reading the authoritative profile.
      }
      readLatestProfile();
    };
    window.addEventListener("storage", onStorage);

    signalProfileSyncRef.current = (committed) => {
      const signal = {
        origin: profileWriterIdRef.current,
        revision: committed?.syncMeta?.revision || 0,
        at: Date.now(),
      };
      try { channel?.postMessage(signal); } catch { /* storage event remains available */ }
      try { localStorage.setItem(PROFILE_SYNC_SIGNAL_KEY, JSON.stringify(signal)); } catch { /* IndexedDB remains authoritative */ }
    };

    return () => {
      active = false;
      signalProfileSyncRef.current = () => {};
      window.removeEventListener("storage", onStorage);
      try { channel?.close(); } catch { /* already closed */ }
    };
  }, [hydrated, notify, reportSyncConflicts]);

  useEffect(() => {
    if (!hydrated) return undefined;
    clearTimeout(saveTimer.current);
    if (profileReplacementRef.current) return undefined;
    if (profile === profileBaseRef.current) {
      setSaveStatus("saved");
      return undefined;
    }
    const sequence = ++saveSequence.current;
    setSaveStatus("saving");
    saveTimer.current = setTimeout(() => {
      if (profileReplacementRef.current) return;
      const localSnapshot = profile;
      const baseSnapshot = profileBaseRef.current;
      let mergeConflicts = [];
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => {
          if (profileReplacementRef.current) return null;
          return updateData("profile", (stored) => {
          const result = mergeProfileVersions(baseSnapshot, localSnapshot, stored, {
            writerId: profileWriterIdRef.current,
          });
          mergeConflicts = result.conflicts;
          return result.profile;
          });
        })
        .then((committedValue) => {
          if (!committedValue) return;
          const committed = normalizeProfile(committedValue);
          lastPersistenceErrorRef.current = "";
          const current = profileRef.current;
          profileBaseRef.current = committed;
          signalProfileSyncRef.current(committed);
          reportSyncConflicts(mergeConflicts);

          if (current === localSnapshot) {
            profileRef.current = committed;
            setProfile(committed);
            if (sequence === saveSequence.current) setSaveStatus("saved");
            return;
          }

          const rebased = mergeProfileVersions(localSnapshot, current, committed, {
            advanceRevision: false,
            writerId: profileWriterIdRef.current,
          });
          profileRef.current = rebased.profile;
          setProfile(rebased.profile);
          reportSyncConflicts(rebased.conflicts);
        })
        .catch((error) => {
          if (sequence === saveSequence.current) setSaveStatus("error");
          reportPersistenceError(error);
        });
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [hydrated, profile, reportPersistenceError, reportSyncConflicts]);

  useEffect(() => {
    const flush = () => {
      const localSnapshot = profileRef.current;
      const baseSnapshot = profileBaseRef.current;
      if (!hydrated || profileReplacementRef.current || localSnapshot === baseSnapshot) return;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => profileReplacementRef.current ? null : updateData("profile", (stored) => mergeProfileVersions(baseSnapshot, localSnapshot, stored, {
          writerId: profileWriterIdRef.current,
        }).profile))
        .then((committedValue) => {
          if (!committedValue) return;
          const committed = normalizeProfile(committedValue);
          profileBaseRef.current = committed;
          signalProfileSyncRef.current(committed);
          if (profileRef.current === localSnapshot) {
            profileRef.current = committed;
            setProfile(committed);
          }
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated]);

  const replaceProfileData = useCallback(async (records, reason) => {
    profileReplacementRef.current = true;
    clearTimeout(saveTimer.current);
    saveSequence.current += 1;
    setSaveStatus("saving");
    try {
      // Drain any transaction that crossed the debounce boundary. The new
      // generation then fences stale operations in this and every other tab.
      await saveQueue.current.catch(() => {});
      const replacement = prepareProfileReplacement(records.profile, {
        reason,
        writerId: profileWriterIdRef.current,
      });
      window.dispatchEvent(new CustomEvent(PROFILE_REPLACEMENT_EVENT, { detail: { phase: "begin", reason, generation: replacement.syncMeta.generation, remote: false } }));
      await replaceAllData({ ...records, profile: replacement });
      profileBaseRef.current = replacement;
      profileRef.current = replacement;
      setProfile(replacement);
      setSaveStatus("saved");
      signalProfileSyncRef.current(replacement);
      profileReplacementRef.current = false;
      return replacement;
    } catch (error) {
      window.dispatchEvent(new CustomEvent(PROFILE_REPLACEMENT_EVENT, { detail: { phase: "cancel" } }));
      profileReplacementRef.current = false;
      setSaveStatus("error");
      // Re-arm persistence for any dirty state that was not replaced.
      setProfile((current) => ({ ...current }));
      throw error;
    }
  }, []);

  const updateSettings = useCallback((patch) => {
    setProfile((current) => {
      const next = { ...current, settings: { ...current.settings, ...patch } };
      // Shrinking the Mac-tutor retention applies immediately: kept messages
      // are the newest ones and removals become tombstones so another tab
      // cannot resurrect them.
      if (Object.hasOwn(patch, "aiHistoryRetention")) {
        const retention = [0, 10, 25, 50].includes(patch.aiHistoryRetention) ? patch.aiHistoryRetention : 50;
        const retained = retention > 0 ? current.aiTutorHistory.slice(-retention) : [];
        if (retained.length !== current.aiTutorHistory.length) {
          const retainedIds = new Set(retained.map((message) => message.id));
          const removedIds = current.aiTutorHistory.filter((message) => !retainedIds.has(message.id)).map((message) => message.id);
          next.aiTutorHistory = retained;
          next.aiTutorHistoryTombstones = [...new Set([...(current.aiTutorHistoryTombstones || []), ...removedIds])].slice(-1_000);
        }
      }
      return next;
    });
  }, []);

  const speech = useSpeech({
    voiceURI: profile.settings.voiceURI,
    language: profile.settings.speechLanguage,
    rate: profile.settings.speechRate,
    pitch: profile.settings.speechPitch,
    volume: profile.settings.speechVolume,
    onSettingsChange: updateSettings,
  });
  const wakeLock = useWakeLock(profile.settings.keepScreenAwake && (view === "reader" || view === "board"));

  const customDocuments = useMemo(() => profile.customDocuments.map(makeCustomDocument), [profile.customDocuments]);
  const allDocuments = useMemo(() => [...documents, ...customDocuments], [customDocuments]);
  const allDocumentMap = useMemo(() => new Map(allDocuments.map((doc) => [doc.id, doc])), [allDocuments]);
  const currentDocument = allDocumentMap.get(currentDocumentId) || documentMap.get(initialDocumentId) || allDocuments[0];
  const currentIndex = allDocuments.findIndex((doc) => doc.id === currentDocument.id);
  const currentOriginalSource = currentDocument.source === "custom" ? currentDocument.raw : (builtInSources[currentDocument.id] || "");
  const reviewDueCount = buildReviewQueue(profile.reviewItems, profile.reviewSettings, new Date(), profile.reviewSessions).length;
  const aiFeaturesEnabled = profile.settings.aiFeaturesEnabled !== false;
  const aiHistoryRetention = [0, 10, 25, 50].includes(profile.settings.aiHistoryRetention) ? profile.settings.aiHistoryRetention : 50;

  useEffect(() => {
    if (currentDocument.source !== "builtin" || builtInSources[currentDocument.id]) return undefined;
    let active = true;
    setSourceLoadError("");
    loadDocumentSource(currentDocument.id)
      .then((source) => {
        if (active) setBuiltInSources((current) => ({ ...current, [currentDocument.id]: source }));
      })
      .catch((error) => {
        if (active) setSourceLoadError(error?.message || "The lecture source could not be loaded.");
      });
    return () => { active = false; };
  }, [builtInSources, currentDocument.id, currentDocument.source]);

  const isDark = profile.settings.theme === "dark" || (profile.settings.theme === "system" && systemDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const update = (event) => setSystemDark(event.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = profile.settings.theme;
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#0c1522" : "#f5f0e7");
  }, [isDark, profile.settings.theme]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const openDocument = useCallback((id, target = null) => {
    if (!allDocumentMap.has(id)) {
      notify("That document is no longer available.", "error");
      return;
    }
    if (editorDirty && !window.confirm("Discard the unsaved editor changes and open another document?")) return;
    navigationApprovedRef.current = editorDirty;
    setEditorDirty(false);
    speech.stop();
    const anchor = typeof target?.anchor === "string" ? target.anchor.trim().replace(/^#/, "") : "";
    const section = typeof target?.section === "string" ? target.section.trim() : "";
    setReaderNavigationTarget(anchor || section ? { documentId: id, anchor, section, nonce: Date.now() } : null);
    setCurrentDocumentId(id);
    setView("reader");
    setSidebarOpen(false);
    const route = routeFor("reader", id);
    if (window.location.hash !== route) window.location.hash = route;
    setProfile((current) => ({ ...current, lastDocumentId: id, recent: [id, ...current.recent.filter((item) => item !== id)].slice(0, 20) }));
  }, [allDocumentMap, editorDirty, notify, speech.stop]);

  const changeView = useCallback((next) => {
    if (editorDirty && next !== "reader" && !window.confirm("Discard the unsaved editor changes and leave the reader?")) return;
    navigationApprovedRef.current = editorDirty && next !== "reader";
    if (next !== "reader") setEditorDirty(false);
    speech.stop();
    setView(next);
    setSidebarOpen(false);
    const route = routeFor(next, currentDocumentId);
    if (window.location.hash !== route) window.location.hash = route;
  }, [currentDocumentId, editorDirty, speech.stop]);

  useEffect(() => {
    const handleRoute = () => {
      const route = parseRoute();
      const routeChangesDocument = route.documentId && route.documentId !== currentDocumentId;
      const routeLeavesEditor = route.view !== "reader" || routeChangesDocument;
      if (navigationApprovedRef.current) navigationApprovedRef.current = false;
      else if (editorDirty && routeLeavesEditor) {
        if (!window.confirm("Discard the unsaved editor changes and leave this document?")) {
          const sourceRoute = routeFor("reader", currentDocumentId);
          history.forward();
          setTimeout(() => {
            if (location.hash !== sourceRoute) history.pushState(null, "", `${location.pathname}${location.search}${sourceRoute}`);
          }, 80);
          return;
        }
        setEditorDirty(false);
      }
      if (route.documentId) {
        if (allDocumentMap.has(route.documentId)) {
          setCurrentDocumentId(route.documentId);
          setView(route.view);
        } else if (hydrated) {
          setView("home");
          history.replaceState(null, "", `${location.pathname}${location.search}#/home`);
          notify("The linked document could not be found.", "error");
        }
      } else setView(route.view);
      setSidebarOpen(false);
    };
    handleRoute();
    window.addEventListener("hashchange", handleRoute);
    return () => window.removeEventListener("hashchange", handleRoute);
  }, [allDocumentMap, currentDocumentId, editorDirty, hydrated, notify]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        changeView("library");
        requestAnimationFrame(() => document.querySelector(".library-search input")?.focus());
      } else if (!typing && event.key === "Escape") {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [changeView]);

  useEffect(() => {
    const handleUpdate = (event) => setUpdateRegistration(event.detail);
    const handlePwaIssue = (event) => setPwaIssue(String(event.detail || "Offline installation is unavailable."));
    window.addEventListener("lumen:pwa-update", handleUpdate);
    window.addEventListener("lumen:pwa-error", handlePwaIssue);
    return () => {
      window.removeEventListener("lumen:pwa-update", handleUpdate);
      window.removeEventListener("lumen:pwa-error", handlePwaIssue);
    };
  }, []);

  const updateProgress = useCallback((payload) => {
    const position = typeof payload === "number" ? payload : payload.position;
    const observed = typeof payload === "number" ? payload : payload.maximum;
    setProfile((current) => {
      const existing = current.progress[currentDocumentId] || 0;
      const existingPosition = current.readingPositions[currentDocumentId] || 0;
      const maximum = Math.max(existing, Number(observed) || 0);
      if (Math.abs(existing - maximum) < 0.005 && Math.abs(existingPosition - position) < 0.005) return current;
      return {
        ...current,
        progress: { ...current.progress, [currentDocumentId]: maximum },
        readingPositions: { ...current.readingPositions, [currentDocumentId]: Math.max(0, Math.min(1, Number(position) || 0)) },
      };
    });
  }, [currentDocumentId]);

  const setDocumentProgress = useCallback((value) => {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    setProfile((current) => ({
      ...current,
      progress: { ...current.progress, [currentDocumentId]: next },
      readingPositions: { ...current.readingPositions, [currentDocumentId]: next >= 1 ? 1 : 0 },
    }));
    notify(next >= 1 ? "Lecture marked complete." : "Lecture progress reset.");
  }, [currentDocumentId, notify]);

  const currentSource = profile.edits[currentDocument.id] ?? currentOriginalSource;
  const aiSources = useMemo(() => {
    const orderedIds = [
      currentDocument.id,
      ...profile.recent,
      ...profile.customDocuments.map((document) => document.id),
      ...Object.keys(builtInSources),
    ];
    const uniqueIds = [...new Set(orderedIds)].slice(0, 24);
    return uniqueIds.flatMap((id) => {
      const document = allDocumentMap.get(id);
      if (!document) return [];
      const sourceText = document.source === "custom"
        ? document.raw
        : (profile.edits[id] ?? builtInSources[id] ?? "");
      if (!sourceText?.trim()) return [];
      return [{
        id,
        documentId: id,
        title: document.title,
        section: document.partTitle || (document.partNumber ? `Part ${document.partNumber}` : ""),
        text: sourceText,
        revision: document.updatedAt || String(sourceText.length),
        selected: id === currentDocument.id,
      }];
    });
  }, [allDocumentMap, builtInSources, currentDocument.id, profile.customDocuments, profile.edits, profile.recent]);
  const retrieveLibrarySources = useCallback((query, options = {}) => retrieveLibrary(query, {
    ...options,
    documents: allDocuments,
    edits: profileRef.current.edits,
    personalNotes: profileRef.current.personalNotes,
    selectedDocumentId: options.selectedDocumentId || currentDocument.id,
    loadSearchIndex: loadDocumentSearchIndex,
    loadSource: async (id) => {
      const document = allDocumentMap.get(id);
      if (!document) throw new Error("The requested library source is no longer available");
      if (document.source === "custom") return document.raw || "";
      return loadDocumentSource(id);
    },
  }), [allDocumentMap, allDocuments, currentDocument.id]);
  const setPersonalNote = (note) => setProfile((current) => ({ ...current, personalNotes: { ...current.personalNotes, [currentDocument.id]: note } }));
  const saveEdit = (raw) => {
    if (currentDocument.source === "custom") {
      const projectedBytes = customDocumentBytes(profileRef.current.customDocuments, currentDocument.id) + utf8Bytes(raw);
      if (projectedBytes > MAX_CUSTOM_DOCUMENT_BYTES) {
        notify("This edit would exceed the 16 MB backup-safe document budget. Shorten it or delete an unneeded upload first.", "error", 7000);
        return false;
      }
      const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
      setProfile((current) => ({ ...current, customDocuments: current.customDocuments.map((doc) => doc.id === currentDocument.id ? { ...doc, raw, title: heading?.slice(0, 180) || doc.title, updatedAt: new Date().toISOString() } : doc) }));
    } else {
      if (utf8Bytes(raw) > MAX_LECTURE_EDIT_BYTES) {
        notify("This edited lecture exceeds the 5 MB per-lecture limit. Shorten it before saving; your editor remains open and nothing was truncated.", "error", 7000);
        return false;
      }
      setProfile((current) => ({ ...current, edits: { ...current.edits, [currentDocument.id]: raw } }));
    }
    notify("Your edited copy was saved.");
    return true;
  };
  const resetEdit = () => {
    setProfile((current) => { const edits = { ...current.edits }; delete edits[currentDocument.id]; return { ...current, edits }; });
    notify("The built-in lecture was restored.");
  };
  const toggleBookmark = () => {
    const adding = !profile.bookmarks.includes(currentDocument.id);
    setProfile((current) => ({ ...current, bookmarks: current.bookmarks.includes(currentDocument.id) ? current.bookmarks.filter((id) => id !== currentDocument.id) : [currentDocument.id, ...current.bookmarks] }));
    notify(adding ? "Lecture bookmarked." : "Bookmark removed.");
  };

  const addClipping = useCallback((payload) => {
    const text = typeof payload === "string" ? payload : payload?.text;
    const anchor = typeof payload === "object" ? payload?.anchor : null;
    const excerpt = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4_000);
    if (!excerpt) {
      notify("Select text in the lecture before clipping it.", "error");
      return false;
    }
    const duplicate = profile.clippings.some((clip) => clip.documentId === currentDocument.id && clip.text === excerpt);
    if (duplicate) {
      notify("That excerpt is already in your notebook.", "error");
      return false;
    }
    const createdAt = new Date().toISOString();
    const clipping = { id: createId(), documentId: currentDocument.id, text: excerpt, note: "", anchor, createdAt, updatedAt: createdAt };
    setProfile((current) => ({ ...current, clippings: [clipping, ...current.clippings].slice(0, 2_000) }));
    notify("Excerpt saved to Clippings.");
    return true;
  }, [currentDocument.id, notify, profile.clippings]);

  const saveAnnotation = useCallback((draft) => {
    const now = new Date().toISOString();
    if (draft.id) {
      setProfile((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === draft.id ? { ...annotation, ...draft, documentId: currentDocument.id, updatedAt: now } : annotation) }));
      notify("Highlight updated.");
      return;
    }
    if (profile.annotations.some((annotation) => annotation.documentId === currentDocument.id && annotation.quote === draft.quote && annotation.start === draft.start)) {
      notify("That passage is already highlighted.", "warning");
      return;
    }
    const annotation = { ...draft, id: createId(), documentId: currentDocument.id, createdAt: now, updatedAt: now };
    setProfile((current) => ({ ...current, annotations: [annotation, ...current.annotations].slice(0, 5_000) }));
    notify("Highlight saved and anchored to the source.");
  }, [currentDocument.id, notify, profile.annotations]);

  const deleteAnnotation = useCallback((id) => {
    if (!window.confirm("Delete this highlight? Linked review cards will remain, but their highlight link will be removed.")) return;
    setProfile((current) => ({
      ...current,
      annotations: current.annotations.filter((annotation) => annotation.id !== id),
      reviewItems: current.reviewItems.map((item) => item.sourceAnnotationId === id ? { ...item, sourceAnnotationId: "", updatedAt: new Date().toISOString() } : item),
    }));
    notify("Highlight deleted.");
  }, [notify]);

  const uploadNotes = async (event) => {
    const selection = selectUploadFiles(event.target.files, profileRef.current.customDocuments.length, customDocumentBytes(profileRef.current.customDocuments));
    const { accepted, offered: files, rejectedCount: rejected, atCapacity, byteCapacityReached } = selection;
    event.target.value = "";
    if (atCapacity) {
      notify("The 500-document local limit has been reached. No existing note was replaced.", "error", 6000);
      return;
    }
    if (!accepted.length) {
      notify(byteCapacityReached ? "These files exceed the 16 MB backup-safe document budget. Delete an unneeded note or choose a smaller file." : "Choose Markdown or text files smaller than 2 MB.", "error", 6000);
      return;
    }
    try {
      const uploaded = await Promise.all(accepted.map(async (file) => {
        const now = new Date().toISOString();
        const raw = await file.text();
        const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, "").trim();
        const filename = file.name.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]/g, " ").trim();
        return { id: `custom/${createId()}.md`, title: (heading || filename || "Untitled upload").slice(0, 180), raw, createdAt: now, updatedAt: now, tags: [] };
      }));
      setProfile((current) => {
        const remaining = Math.max(0, 500 - current.customDocuments.length);
        return { ...current, customDocuments: [...uploaded.slice(0, remaining), ...current.customDocuments] };
      });
      notify(`${uploaded.length} document${uploaded.length === 1 ? "" : "s"} imported${rejected ? `; ${rejected} rejected (invalid, over a limit, or beyond the backup-safe byte budget)` : ""}. No existing notes were replaced.`, rejected ? "warning" : "success", rejected ? 6000 : undefined);
    } catch (error) {
      notify(`Import failed: ${error.message}`, "error", 5000);
    }
  };

  const createNote = ({ title, tags }) => {
    if (profile.customDocuments.length >= 500) {
      setCreateOpen(false);
      notify("The 500-document local limit has been reached. Export a backup and remove an older upload first.", "error", 6000);
      return;
    }
    const id = `custom/${createId()}.md`;
    const now = new Date().toISOString();
    const custom = { id, title, raw: `# ${title}\n\nStart writing here.\n`, createdAt: now, updatedAt: now, tags: [...new Set(tags)].slice(0, 20) };
    setProfile((current) => ({
      ...current,
      customDocuments: [custom, ...current.customDocuments],
      lastDocumentId: id,
      recent: [id, ...current.recent.filter((item) => item !== id)].slice(0, 20),
    }));
    setCreateOpen(false);
    setEditRequestId(id);
    setCurrentDocumentId(id);
    setView("reader");
    window.location.hash = routeFor("reader", id);
    notify("Study note created. Start writing in Markdown.");
  };

  const deleteCustom = (id) => {
    const doc = allDocumentMap.get(id);
    if (!window.confirm(`Delete “${doc?.title || "this note"}” from this device?`)) return;
    const applyDeletion = (current) => {
      const progress = { ...current.progress }; delete progress[id];
      const readingPositions = { ...current.readingPositions }; delete readingPositions[id];
      const personalNotes = { ...current.personalNotes }; delete personalNotes[id];
      const edits = { ...current.edits }; delete edits[id];
      const removedReviewIds = new Set(current.reviewItems.filter((item) => item.documentId === id).map((item) => item.id));
      return { ...current, progress, readingPositions, personalNotes, edits, customDocuments: current.customDocuments.filter((item) => item.id !== id), deletedCustomDocumentIds: [...new Set([...(current.deletedCustomDocumentIds || []), id])].slice(-1_000), bookmarks: current.bookmarks.filter((item) => item !== id), clippings: current.clippings.filter((clip) => clip.documentId !== id), annotations: current.annotations.filter((annotation) => annotation.documentId !== id), reviewItems: current.reviewItems.filter((item) => item.documentId !== id), reviewAttempts: current.reviewAttempts.filter((attempt) => !removedReviewIds.has(attempt.reviewItemId)), recent: current.recent.filter((item) => item !== id), lastDocumentId: current.lastDocumentId === id ? "" : current.lastDocumentId };
    };
    const baseSnapshot = profileBaseRef.current;
    const localSnapshot = applyDeletion(profileRef.current);
    profileRef.current = localSnapshot;
    setProfile(localSnapshot);
    clearTimeout(saveTimer.current);
    const sequence = ++saveSequence.current;
    setSaveStatus("saving");
    // Commit the deletion tombstone before the final board delete. A stale tab
    // then fails its generation/document guard instead of recreating private
    // whiteboard content after deletion.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => updateData("profile", (stored) => mergeProfileVersions(baseSnapshot, localSnapshot, stored, {
      writerId: profileWriterIdRef.current,
    }).profile)).then(async (committedValue) => {
      const committed = normalizeProfile(committedValue);
      profileBaseRef.current = committed;
      if (profileRef.current === localSnapshot) {
        profileRef.current = committed;
        setProfile(committed);
      }
      signalProfileSyncRef.current(committed);
      await deleteData(`board:${id}`);
      if (sequence === saveSequence.current) setSaveStatus("saved");
    }).catch((error) => {
      setSaveStatus("error");
      reportPersistenceError(error);
      notify("The document is hidden in this tab, but its durable deletion could not be completed. Keep this tab open and retry before clearing browser data.", "error", 9000);
    });
    if (currentDocumentId === id) {
      setCurrentDocumentId(initialDocumentId);
      changeView("notebook");
    }
    notify("The local document and its linked study data were deleted.");
  };

  const duplicateCustom = (id) => {
    const sourceDocument = profileRef.current.customDocuments.find((doc) => doc.id === id);
    if (!sourceDocument) { notify("That document is no longer available.", "error"); return; }
    if (profileRef.current.customDocuments.length >= 500) { notify("The 500-document local limit has been reached.", "error"); return; }
    if (customDocumentBytes(profileRef.current.customDocuments) + utf8Bytes(sourceDocument.raw) > MAX_CUSTOM_DOCUMENT_BYTES) {
      notify("Duplicating this document would exceed the 16 MB backup-safe document budget. Delete an unneeded upload or make this note smaller first.", "error", 7000);
      return;
    }
    const now = new Date().toISOString();
    const duplicate = { ...sourceDocument, id: `custom/${createId()}.md`, title: `${sourceDocument.title} copy`.slice(0, 180), createdAt: now, updatedAt: now, tags: [...(sourceDocument.tags || [])] };
    setProfile((current) => ({ ...current, customDocuments: [duplicate, ...current.customDocuments] }));
    notify("Document duplicated.");
  };

  const deleteClipping = (id) => {
    setProfile((current) => ({ ...current, clippings: current.clippings.filter((clip) => clip.id !== id) }));
    notify("Clipping deleted.");
  };

  const updateClipping = (id, note) => {
    setProfile((current) => ({ ...current, clippings: current.clippings.map((clip) => clip.id === id ? { ...clip, note: note.slice(0, 4_000), updatedAt: new Date().toISOString() } : clip) }));
  };

  const copyClipping = async (clip) => {
    const doc = allDocumentMap.get(clip.documentId);
    const value = `${clip.text}${clip.note ? `\n\nMy note: ${clip.note}` : ""}${doc ? `\n\nSource: ${doc.title}` : ""}`;
    try {
      await copyText(value);
      notify("Clipping copied to the clipboard.");
    } catch {
      notify("The clipping could not be copied.", "error");
    }
  };

  const openReviewDraft = useCallback((sourceItem) => {
    if (!sourceItem) {
      setReviewDraft({ front: "", back: "", tags: [], documentId: "", sourceClippingId: "", sourceTitle: "" });
      return;
    }
    const source = allDocumentMap.get(sourceItem.documentId);
    const isAnnotation = typeof sourceItem.quote === "string";
    setReviewDraft({
      front: (isAnnotation ? sourceItem.comment : sourceItem.note)?.trim() || `Explain this excerpt from “${source?.title || "your notes"}” in your own words.`,
      back: isAnnotation ? sourceItem.quote : sourceItem.text,
      tags: source?.partNumber ? [`part-${source.partNumber}`] : [],
      documentId: sourceItem.documentId,
      sourceClippingId: isAnnotation ? "" : sourceItem.id,
      sourceAnnotationId: isAnnotation ? sourceItem.id : "",
      sourceTitle: source?.title || "",
    });
  }, [allDocumentMap]);

  const closeReviewDraft = useCallback(() => setReviewDraft(null), []);

  const editReviewCard = useCallback((item) => {
    const source = allDocumentMap.get(item.documentId);
    setReviewDraft({ ...item, sourceTitle: source?.title || "" });
  }, [allDocumentMap]);

  const saveReviewCard = useCallback((draft) => {
    const fingerprint = `${draft.front.trim().toLocaleLowerCase()}\u0000${draft.back.trim().toLocaleLowerCase()}`;
    if (profile.reviewItems.some((item) => item.id !== draft.id && `${item.front.trim().toLocaleLowerCase()}\u0000${item.back.trim().toLocaleLowerCase()}` === fingerprint)) {
      notify("An identical prompt and answer already exist in your review deck.", "warning", 5000);
      return;
    }
    if (draft.id) {
      setProfile((current) => ({
        ...current,
        reviewItems: current.reviewItems.map((item) => item.id === draft.id ? {
          ...item,
          type: draft.type,
          front: draft.front,
          back: draft.back,
          tags: draft.tags,
          updatedAt: new Date().toISOString(),
        } : item),
      }));
      setReviewDraft(null);
      notify("Review card updated without resetting its schedule.");
      return;
    }
    const item = createReviewItem(draft);
    setProfile((current) => ({ ...current, reviewItems: [item, ...current.reviewItems].slice(0, 10_000) }));
    setReviewDraft(null);
    notify("Review card added to today’s queue.");
  }, [notify, profile.reviewItems]);

  const saveAiTutorHistory = useCallback((history) => {
    setProfile((current) => {
      const retention = [0, 10, 25, 50].includes(current.settings.aiHistoryRetention) ? current.settings.aiHistoryRetention : 50;
      const retained = retention > 0 ? (history || []).slice(-retention) : [];
      const retainedIds = new Set(retained.map((message) => message.id));
      const removedIds = current.aiTutorHistory.filter((message) => !retainedIds.has(message.id)).map((message) => message.id);
      return {
        ...current,
        aiTutorHistory: retained,
        aiTutorHistoryTombstones: [...new Set([...(current.aiTutorHistoryTombstones || []), ...removedIds])].slice(-1_000),
      };
    });
  }, []);

  const clearAiTutorHistory = useCallback(() => {
    if (!profileRef.current.aiTutorHistory?.length) return;
    if (!window.confirm("Delete all locally saved AI tutor conversation messages? Review cards created from them will remain.")) return;
    setProfile((current) => ({
      ...current,
      aiTutorHistory: [],
      aiTutorHistoryTombstones: [...new Set([...(current.aiTutorHistoryTombstones || []), ...current.aiTutorHistory.map((message) => message.id)])].slice(-1_000),
    }));
    notify("Local AI tutor history cleared.");
  }, [notify]);

  const addAiFlashcards = useCallback(async (cards, metadata = {}) => {
    const candidates = (Array.isArray(cards) ? cards : [])
      .filter((card) => card?.front?.trim() && card?.back?.trim())
      .map((card) => materializeAiFlashcard(card, metadata))
      .slice(0, 20);
    if (!candidates.length) throw new Error("No valid flashcards were supplied");
    let added = 0;
    let skipped = 0;
    setProfile((current) => {
      const fingerprints = new Set(current.reviewItems.map((item) => `${item.front.trim().toLocaleLowerCase()}\u0000${item.back.trim().toLocaleLowerCase()}`));
      const documentId = metadata.sourceIds?.find((id) => allDocumentMap.has(id)) || "";
      const created = [];
      candidates.forEach((card) => {
        const front = card.front.trim();
        const back = `${card.back.trim()}${card.hint?.trim() ? `\n\nHint: ${card.hint.trim()}` : ""}`;
        const fingerprint = `${front.toLocaleLowerCase()}\u0000${back.toLocaleLowerCase()}`;
        if (fingerprints.has(fingerprint)) { skipped += 1; return; }
        fingerprints.add(fingerprint);
        created.push(createReviewItem({ type: "basic", front, back, tags: [...(card.tags || []), "ai-draft"], documentId }));
      });
      added = Math.min(created.length, Math.max(0, 10_000 - current.reviewItems.length));
      if (!added) return current;
      return { ...current, reviewItems: [...created.slice(0, added), ...current.reviewItems] };
    });
    if (!added) throw new Error("Every generated card already exists or the review deck is full");
    notify(`${added} AI flashcard${added === 1 ? "" : "s"} added to review${skipped ? `; ${skipped} duplicate${skipped === 1 ? " was" : "s were"} skipped` : ""}.`);
  }, [allDocumentMap, notify]);

  const saveAiAnswerNote = useCallback((payload = {}) => {
    const text = String(payload.content || "").trim();
    if (!text) {
      notify("This response has no text to save.", "error");
      return false;
    }
    // Mac tutor sources carry {citationNumber, original:{documentId}}; phone
    // sources carry {documentId, anchor} with an index+1 numbering fallback.
    const citationSources = (Array.isArray(payload.citationSources) ? payload.citationSources : []).map((source, index) => ({
      citationNumber: Number.isSafeInteger(source?.citationNumber) ? source.citationNumber : index + 1,
      title: typeof source?.title === "string" && source.title.trim() ? source.title : `Source ${index + 1}`,
      section: typeof source?.section === "string" ? source.section : "",
      documentId: source?.original?.documentId || source?.documentId || source?.original?.id || "",
    }));
    const webSources = Array.isArray(payload.webSources) ? payload.webSources : [];
    // Transient [W#] tokens become durable links; library citations keep their
    // labels and gain a plain-text footer so the note stays self-describing
    // after tutor history is cleared or the note travels through a backup.
    const materialized = materializeAiCardProvenance(text, { webSources });
    const sourceFooter = citationSources.length
      ? `\n\nSources:\n${citationSources.map((source) => `[S${source.citationNumber}] ${source.title}${source.section ? ` — ${source.section}` : ""}`).join("\n")}`
      : "";
    const marker = "\n\n[… truncated for notebook storage; copy the full response from the tutor if needed …]";
    const full = `${materialized}${sourceFooter}`;
    const bounded = full.length > 4_000 ? `${full.slice(0, 4_000 - marker.length)}${marker}` : full;
    const documentId = citationSources
      .map((source) => source.documentId)
      .find((id) => allDocumentMap.has(id)) || "";
    const createdAt = new Date().toISOString();
    const clipping = {
      id: createId(),
      documentId,
      origin: "ai-tutor",
      title: payload.title || "AI tutor answer",
      text: bounded,
      note: "AI-generated draft saved from the tutor. Verify important claims against the cited sources.",
      anchor: null,
      createdAt,
      updatedAt: createdAt,
    };
    setProfile((current) => ({ ...current, clippings: [clipping, ...current.clippings].slice(0, 2_000) }));
    notify("Answer saved to your Notebook clippings.");
    return true;
  }, [allDocumentMap, notify]);

  const gradeReview = useCallback((id, rating, elapsedMs, metadata = {}) => {
    setProfile((current) => {
      const target = current.reviewItems.find((item) => item.id === id);
      if (!target) return current;
      const now = new Date();
      const usage = recordReviewUsage(current.reviewSessions, target, now, metadata);
      const result = gradeReviewItem(target, rating, now, elapsedMs, { ...metadata, sessionKind: usage.kind, sessionKey: usage.sessionKey });
      return {
        ...current,
        reviewItems: current.reviewItems.map((item) => item.id === id ? result.item : item),
        reviewAttempts: [...current.reviewAttempts, result.attempt].slice(-50_000),
        reviewSessions: usage.sessions,
      };
    });
  }, []);

  const undoReviewGrade = useCallback(() => {
    setProfile((current) => {
      const attempt = current.reviewAttempts.at(-1);
      if (!attempt?.previousState) {
        notify("There is no reversible review grade yet.", "warning");
        return current;
      }
      return {
        ...current,
        reviewItems: current.reviewItems.map((item) => item.id === attempt.reviewItemId ? restoreReviewItemFromAttempt(item, attempt) : item),
        reviewAttempts: current.reviewAttempts.slice(0, -1),
        reviewSessions: reverseReviewUsage(current.reviewSessions, attempt),
      };
    });
    notify("The most recent review grade was undone.");
  }, [notify]);

  const buryReviewItem = useCallback((id, timeZone = currentTimeZone()) => {
    const today = localDayKey(new Date(), timeZone);
    setProfile((current) => ({
      ...current,
      reviewItems: current.reviewItems.map((item) => item.id === id ? { ...item, buriedOnDay: today, updatedAt: new Date().toISOString() } : item),
    }));
    notify("Card buried until the next local day.");
  }, [notify]);

  const toggleReviewSuspend = useCallback((id) => {
    setProfile((current) => ({ ...current, reviewItems: current.reviewItems.map((item) => item.id === id ? { ...item, suspended: !item.suspended, updatedAt: new Date().toISOString() } : item) }));
  }, []);

  const toggleReviewArchive = useCallback((id) => {
    setProfile((current) => ({
      ...current,
      reviewItems: current.reviewItems.map((item) => item.id === id ? { ...item, archived: !item.archived, suspended: item.archived ? item.suspended : false, updatedAt: new Date().toISOString() } : item),
    }));
  }, []);

  const deleteReviewItem = useCallback((id) => {
    if (!window.confirm("Delete this review card and its review history?")) return;
    setProfile((current) => ({ ...current, reviewItems: current.reviewItems.filter((item) => item.id !== id), reviewAttempts: current.reviewAttempts.filter((attempt) => attempt.reviewItemId !== id) }));
    notify("Review card deleted.");
  }, [notify]);

  const updateReviewSettings = useCallback((patch) => {
    setProfile((current) => ({ ...current, reviewSettings: { ...current.reviewSettings, ...patch } }));
  }, []);

  const exportBackup = async () => {
    try {
      const exportedAt = new Date().toISOString();
      const data = await getAllData();
      // Export a read-only three-way snapshot so concurrent work already
      // committed by another tab is included without claiming success early.
      const snapshotMerge = mergeProfileVersions(
        profileBaseRef.current,
        profileRef.current,
        data.profile,
        { advanceRevision: false, writerId: profileWriterIdRef.current, now: exportedAt },
      );
      data.profile = snapshotMerge.profile;
      reportSyncConflicts(snapshotMerge.conflicts);
      const result = await createBackup(data, { exportedAt, secureContext: window.isSecureContext });
      downloadText(`lumen-notes-backup-${exportedAt.slice(0, 10)}.json`, result.json);

      // Only a successfully created and triggered download earns export
      // metadata. Commit it atomically against the latest cross-tab profile.
      const localAtCommit = profileRef.current;
      const baseAtCommit = profileBaseRef.current;
      const successfulLocal = {
        ...localAtCommit,
        backupMeta: {
          ...localAtCommit.backupMeta,
          lastExportAt: exportedAt,
          lastIntegrity: result.envelope.integrity.algorithm,
        },
      };
      let commitConflicts = [];
      const committedValue = await updateData("profile", (stored) => {
        const merged = mergeProfileVersions(baseAtCommit, successfulLocal, stored, {
          writerId: profileWriterIdRef.current,
          now: exportedAt,
        });
        commitConflicts = merged.conflicts;
        return merged.profile;
      });
      const committed = normalizeProfile(committedValue);
      profileBaseRef.current = committed;
      signalProfileSyncRef.current(committed);
      reportSyncConflicts(commitConflicts);
      if (profileRef.current === localAtCommit) {
        profileRef.current = committed;
        setProfile(committed);
      } else {
        const rebased = mergeProfileVersions(localAtCommit, profileRef.current, committed, {
          advanceRevision: false,
          writerId: profileWriterIdRef.current,
        });
        profileRef.current = rebased.profile;
        setProfile(rebased.profile);
        reportSyncConflicts(rebased.conflicts);
      }
      notify(`Backup verified with ${result.envelope.integrity.algorithm} and downloaded.${result.warnings.length ? " Review the HTTPS warning before transfer." : ""}`, result.warnings.length ? "warning" : "success", result.warnings.length ? 7000 : 4500);
    } catch (error) {
      notify(`Backup failed: ${error.message}`, "error", 5000);
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const checked = await preflightBackup(file);
      setBackupCandidate({ ...checked, fileName: file.name });
      setSettingsOpen(false);
    } catch (error) {
      notify(`Could not import backup: ${error.message}`, "error", 6000);
    }
  };

  const confirmBackupImport = async () => {
    if (!backupCandidate || backupBusy) return;
    setBackupBusy(true);
    try {
      if (backupCandidate.recoveryPreparedAt) {
        const latestData = await getAllData();
        const durableUnchanged = recoveryRevisionSignature(latestData) === backupCandidate.recoveryRevisionSignature;
        const localUnchanged = profilePayloadEqual(profileRef.current, profileBaseRef.current);
        if (!durableUnchanged || !localUnchanged) {
          const { recoveryPreparedAt: _prepared, recoveryRevisionSignature: _signature, ...preflight } = backupCandidate;
          setBackupCandidate(preflight);
          setBackupBusy(false);
          notify("Study data changed after the recovery file was created. Nothing was replaced; create a fresh recovery file before restoring.", "warning", 8000);
          return;
        }
        const importedAt = new Date().toISOString();
        const safeData = {
          ...backupCandidate.data,
          profile: {
            ...backupCandidate.data.profile,
            backupMeta: {
              ...backupCandidate.data.profile.backupMeta,
              lastImportAt: importedAt,
              lastRecoveryAt: backupCandidate.recoveryPreparedAt,
              lastIntegrity: backupCandidate.integrity.algorithm,
            },
          },
        };
        await replaceProfileData(safeData, "restore");
        window.location.reload();
        return;
      }

      const recoveryAt = new Date().toISOString();
      // Finish any save that already crossed the debounce boundary, then fold
      // this tab's dirty profile into the latest durable revision before the
      // recovery snapshot is taken.
      clearTimeout(saveTimer.current);
      await saveQueue.current.catch(() => {});
      const baseSnapshot = profileBaseRef.current;
      const localSnapshot = profileRef.current;
      let preparationConflicts = [];
      const committedValue = await updateData("profile", (stored) => {
        const merged = mergeProfileVersions(baseSnapshot, localSnapshot, stored, {
          writerId: profileWriterIdRef.current,
          now: recoveryAt,
        });
        preparationConflicts = merged.conflicts;
        return merged.profile;
      });
      const committed = normalizeProfile(committedValue);
      profileBaseRef.current = committed;
      profileRef.current = committed;
      setProfile(committed);
      signalProfileSyncRef.current(committed);
      reportSyncConflicts(preparationConflicts);

      const currentData = await getAllData();
      // Build the recovery file from the authoritative durable snapshot plus
      // this tab's still-dirty edits. Never overwrite a newer cross-tab read
      // with a stale React closure immediately before destructive restore.
      const recoveryMerge = mergeProfileVersions(
        profileBaseRef.current,
        profileRef.current,
        currentData.profile,
        { advanceRevision: false, writerId: profileWriterIdRef.current, now: recoveryAt },
      );
      reportSyncConflicts(recoveryMerge.conflicts);
      currentData.profile = {
        ...recoveryMerge.profile,
        backupMeta: { ...recoveryMerge.profile.backupMeta, lastRecoveryAt: recoveryAt },
      };
      const recovery = await createRecoverySnapshot(currentData, {
        exportedAt: recoveryAt,
        secureContext: window.isSecureContext,
        incomingPreflight: backupCandidate,
      });
      downloadText(`lumen-recovery-before-restore-${recoveryAt.slice(0, 10)}.json`, recovery.json);
      setBackupCandidate({
        ...backupCandidate,
        recoveryPreparedAt: recoveryAt,
        recoveryRevisionSignature: recoveryRevisionSignature(currentData),
      });
      setBackupBusy(false);
      notify("Recovery file requested. Verify it is saved, then return to this dialog and confirm the restore. No local data has been replaced.", "warning", 9000);
    } catch (error) {
      setBackupBusy(false);
      notify(`Restore failed before replacement completed: ${error.message}`, "error", 7000);
    }
  };

  const requestPersistentStorage = async () => {
    if (!navigator.storage?.persist) {
      notify("Persistent browser storage is unavailable on this device.", "error");
      return;
    }
    const granted = await navigator.storage.persist().catch(() => false);
    setStoragePersisted(granted);
    notify(granted ? "The browser granted persistent local storage." : "The browser kept storage in best-effort mode.", granted ? "success" : "warning");
  };

  const resetSettings = () => {
    setProfile((current) => ({
      ...current,
      settings: {
        ...initialProfile.settings,
        voiceURI: current.settings.voiceURI,
        speechLanguage: current.settings.speechLanguage,
      },
    }));
    notify("Reading defaults restored; your preferred narration voice and language were retained.");
  };

  const resetApplication = async () => {
    if (!window.confirm("Reset every local note, clipping, edit, upload, progress record, preference, and whiteboard?")) return;
    if (!window.confirm("This cannot be undone without an exported backup. Continue with the complete reset?")) return;
    try {
      await replaceProfileData({ profile: initialProfile }, "reset");
      window.location.hash = "#/home";
      window.location.reload();
    } catch (error) {
      notify(`Reset failed: ${error.message}`, "error", 6000);
    }
  };

  const applyUpdate = () => {
    const registration = updateRegistration;
    if (!registration?.waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  };

  if (!hydrated) return <div className="app-loading"><div className="brand-mark">L</div><div className="loading-line"><span /></div><p>Preparing your learning studio…</p></div>;

  return (
    <div className="app-shell">
      <aside ref={sidebarRef} id="application-sidebar" className={sidebarOpen ? "app-sidebar open" : "app-sidebar"} aria-hidden={compactNavigation && !sidebarOpen ? "true" : undefined} inert={compactNavigation && !sidebarOpen}>
        <div className="brand-lockup"><div className="brand-mark">L</div><div><strong>Lumen</strong><span>AI Notes</span></div><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu" type="button"><X size={19} /></button></div>
        <nav className="sidebar-primary" aria-label="Main navigation">
          {VIEW_ITEMS.filter(({ id }) => id !== "ai" || aiFeaturesEnabled).map(({ id, label, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => changeView(id)} key={id} type="button"><Icon size={19} /><span>{label}</span>{id === "notebook" && profile.personalNotes && <small>{Object.values(profile.personalNotes).filter((note) => note.trim()).length}</small>}{id === "review" && reviewDueCount > 0 && <small>{Math.min(reviewDueCount, 999)}</small>}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-section-title"><span>Curriculum</span><button onClick={() => changeView("library")} aria-label="Open library" type="button"><MoreVertical size={16} /></button></div>
        <nav className="sidebar-parts" aria-label="Curriculum parts">
          {parts.map((part) => <button onClick={() => { setSelectedPart(String(part.number)); changeView("library"); }} key={part.number} type="button"><span>{String(part.number).padStart(2, "0")}</span><strong>{part.title.replace(/^Part \d+\s+[—-]\s+/, "")}</strong></button>)}
        </nav>
        <button className="sidebar-settings" onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }} type="button"><Settings size={19} /><span>Settings</span><div className={online ? "online-dot" : "offline-dot"} /></button>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" type="button" />}

      <div className="app-main">
        <header className="app-topbar">
          <button ref={menuButtonRef} className="icon-button menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-controls="application-sidebar" aria-expanded={sidebarOpen} type="button"><Menu size={21} /></button>
          <button className="mobile-brand" onClick={() => changeView("home")} type="button"><span>L</span><strong>Lumen</strong></button>
          <button className="top-search" onClick={() => { changeView("library"); requestAnimationFrame(() => document.querySelector(".library-search input")?.focus()); }} type="button"><Search size={18} /><span>Search lectures, formulas, tools…</span><kbd>⌘ K</kbd></button>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => changeView("notebook")} aria-label="Open notebook" type="button"><BookMarked size={20} /></button>
            <button className="profile-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings" type="button"><CircleUserRound size={22} /></button>
          </div>
        </header>

        {(!window.isSecureContext || pwaIssue) && <div className="secure-context-banner" role="status"><AlertTriangle size={17} /><div><strong>{window.isSecureContext ? "Offline mode needs attention" : "Limited LAN mode"}</strong><span>{pwaIssue || "Reading, editing, reviews, and local notes work here. Use an HTTPS address for iPhone installation, offline caching, secure clipboard, wake lock, persistent storage, and AI."}</span></div><button className="text-button" onClick={() => setSettingsOpen(true)} type="button">Details</button>{pwaIssue && window.isSecureContext && <button className="icon-button small" onClick={() => setPwaIssue("")} aria-label="Dismiss offline-mode notice" type="button"><X size={15} /></button>}</div>}

        <div className="view-container">
          {view === "home" && <Dashboard profile={profile} allDocuments={allDocuments} onOpen={openDocument} onLibrary={() => changeView("library")} onNotebook={() => changeView("notebook")} onReview={() => changeView("review")} />}
          {view === "library" && <LibraryView profile={profile} query={query} setQuery={setQuery} selectedPart={selectedPart} setSelectedPart={setSelectedPart} allDocuments={allDocuments} customDocuments={customDocuments} onOpen={openDocument} />}
          {view === "reader" && (sourceLoadError ? <div className="empty-state"><AlertTriangle size={30} /><h2>Lecture could not be opened</h2><p>{sourceLoadError}</p><button className="button secondary" onClick={() => { setSourceLoadError(""); loadDocumentSource(currentDocument.id).then((source) => setBuiltInSources((current) => ({ ...current, [currentDocument.id]: source }))).catch((error) => setSourceLoadError(error.message)); }} type="button">Retry</button></div> : currentDocument.source === "builtin" && !currentOriginalSource ? <div className="view-loading" role="status">Loading lecture on demand…</div> : <Suspense fallback={<div className="view-loading" role="status">Opening lecture…</div>}><Reader document={currentDocument} source={currentSource} originalSource={currentOriginalSource} progress={documentProgress(profile, currentDocument.id)} position={profile.readingPositions[currentDocument.id] || 0} bookmarked={profile.bookmarks.includes(currentDocument.id)} personalNote={profile.personalNotes[currentDocument.id] || ""} annotations={profile.annotations.filter((annotation) => annotation.documentId === currentDocument.id)} isDark={isDark} settings={profile.settings} speech={speech} saveStatus={saveStatus} startEditing={editRequestId === currentDocument.id} navigationTarget={readerNavigationTarget} onNavigationHandled={() => setReaderNavigationTarget(null)} onEditingStarted={() => setEditRequestId("")} onDirtyChange={setEditorDirty} onOpenDocument={openDocument} onProgress={updateProgress} onSetProgress={setDocumentProgress} onToggleBookmark={toggleBookmark} onAddClipping={addClipping} onSaveAnnotation={saveAnnotation} onDeleteAnnotation={deleteAnnotation} onCreateReviewFromAnnotation={openReviewDraft} onPersonalNote={setPersonalNote} onSaveEdit={saveEdit} onResetEdit={resetEdit} onSettingsChange={updateSettings} previousDocument={allDocuments[currentIndex - 1]} nextDocument={allDocuments[currentIndex + 1]} onOpenBoard={() => changeView("board")} onNotify={notify} /></Suspense>)}
          {view === "notebook" && <NotebookView profile={profile} allDocuments={allDocuments} customDocuments={customDocuments} onOpen={openDocument} onUpload={uploadNotes} onCreate={() => setCreateOpen(true)} onDeleteCustom={deleteCustom} onDuplicateCustom={duplicateCustom} onDeleteClipping={deleteClipping} onUpdateClipping={updateClipping} onCopyClipping={copyClipping} onCreateReview={openReviewDraft} onDeleteAnnotation={deleteAnnotation} />}
          {view === "ai" && (!aiFeaturesEnabled
            ? <div className="page ai-page"><div className="empty-state ai-disabled-state"><BrainCircuit size={32} /><h2>AI features are turned off</h2><p>You chose to study without AI assistance. Reading, notes, reviews, narration, and whiteboards are unaffected. You can re-enable the AI learning studio at any time in Settings.</p><button className="button primary" onClick={() => setSettingsOpen(true)} type="button">Open settings</button></div></div>
            : <div className="page ai-page"><header className="page-title"><div><span className="eyebrow">Private, source-grounded assistance</span><h1>AI learning studio</h1><p>Choose a larger local model on your Mac or a lightweight model on this phone—without a paid AI API.</p></div></header><Suspense fallback={<div className="view-loading" role="status">Opening the AI learning studio…</div>}><AiLearningStudio sources={aiSources} retrieveLibrary={retrieveLibrarySources} initialHistory={aiHistoryRetention > 0 ? profile.aiTutorHistory || [] : []} historyTombstones={profile.aiTutorHistoryTombstones || []} onHistoryChange={aiHistoryRetention > 0 ? saveAiTutorHistory : undefined} phoneSessionHistory={phoneAiSessionHistory} onPhoneSessionHistoryChange={setPhoneAiSessionHistory} onNavigateSource={(target, metadata) => openDocument(target.documentId || target.id, { anchor: metadata?.anchor || target.anchor, section: target.section })} onCreateFlashcardDrafts={addAiFlashcards} onSaveAnswerNote={saveAiAnswerNote} onNotify={notify} /></Suspense></div>)}
          {view === "review" && <ReviewCenter profile={profile} documents={allDocuments} onCreate={openReviewDraft} onEdit={editReviewCard} onGrade={gradeReview} onUndo={undoReviewGrade} onBury={buryReviewItem} onOpenSource={openDocument} onToggleSuspend={toggleReviewSuspend} onToggleArchive={toggleReviewArchive} onDelete={deleteReviewItem} onSettingsChange={updateReviewSettings} />}
          {view === "board" && <Suspense fallback={<div className="view-loading" role="status">Restoring whiteboard…</div>}><Whiteboard documentId={currentDocument.id} documentTitle={currentDocument.title} notify={notify} /></Suspense>}
        </div>

        <nav className="bottom-nav" aria-label="Mobile navigation">
          {BOTTOM_VIEW_ITEMS.filter(({ id }) => id !== "ai" || aiFeaturesEnabled).map(({ id, label, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => changeView(id)} key={id} type="button"><Icon size={20} /><span>{label}</span></button>)}
        </nav>
      </div>

      {settingsOpen && <div className="settings-overlay"><button className="modal-scrim" onClick={() => setSettingsOpen(false)} aria-label="Close settings" type="button" /><div ref={settingsDialogRef} className="settings-drawer" role="dialog" aria-modal="true" aria-label="Application settings"><button className="icon-button settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings" type="button"><X size={20} /></button><SettingsView settings={profile.settings} backupMeta={profile.backupMeta} aiHistoryCount={profile.aiTutorHistory?.length || 0} onClearAiHistory={clearAiTutorHistory} onSettingsChange={updateSettings} onResetSettings={resetSettings} onResetApp={resetApplication} onExport={exportBackup} onImport={importBackup} onInstall={() => setInstallOpen(true)} onNotify={notify} online={online} secureContext={window.isSecureContext} saveStatus={saveStatus} wakeLock={wakeLock} storagePersisted={storagePersisted} onRequestStorage={requestPersistentStorage} /></div></div>}
      {installOpen && <InstallSheet secureContext={window.isSecureContext} onClose={() => setInstallOpen(false)} />}
      <BackupImportDialog candidate={backupCandidate} busy={backupBusy} onClose={() => { if (!backupBusy) setBackupCandidate(null); }} onConfirm={confirmBackupImport} />
      <CreateNoteDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createNote} />
      <ReviewCardDialog draft={reviewDraft} onClose={closeReviewDraft} onSave={saveReviewCard} />
      {updateRegistration && <div className="update-banner" role="status"><Sparkles size={18} /><span>A new Lumen version is ready.</span><button className="button primary" onClick={applyUpdate} type="button">Update now</button><button className="icon-button small" onClick={() => setUpdateRegistration(null)} aria-label="Dismiss update" type="button"><X size={16} /></button></div>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
