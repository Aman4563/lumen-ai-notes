import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Brain,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleUserRound,
  CircleX,
  Clock3,
  Keyboard,
  FileEdit,
  Flame,
  FilePlus2,
  GraduationCap,
  Home,
  Import,
  LibraryBig,
  LayoutGrid,
  List,
  Menu,
  MoreVertical,
  NotebookPen,
  Palette,
  RefreshCw,
  History,
  Info,
  Search,
  Star,
  Settings,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import { documentMap, documents, guides, loadDocumentSearchIndex, loadDocumentSource, makeCustomDocument, parts } from "./lib/content";
import { deleteData, getAllData, getData, initialProfile, normalizeProfile, replaceAllData, updateData } from "./lib/db";
import { isProfileReplacementNewer, mergeProfileVersions, prepareProfileReplacement, profilePayloadEqual, PROFILE_REPLACEMENT_EVENT, PROFILE_SYNC_CHANNEL, PROFILE_SYNC_SIGNAL_KEY } from "./lib/profileSync.js";
import { useSpeech } from "./hooks/useSpeech";
import { useWakeLock } from "./hooks/useWakeLock";
import { pruneRecentSearches, pushRecentSearch, searchDocuments, SEARCH_RESULT_LIMIT } from "./lib/search";
import { createId } from "./lib/id.js";
import { customDocumentBytes, isEpubFileName, isHtmlFileName, MAX_CUSTOM_DOCUMENT_BYTES, selectUploadFiles, utf8Bytes } from "./lib/uploads.js";
import { addTrashEntry, appendRevision, applyBatchDelete, applyBatchOrganize, documentFromTrashEntry, findDuplicateDocument, purgeExpiredTrash, recordActivityEntry, revisionForDocument, trashEntryForDocument, TRASH_RETENTION_DAYS } from "./lib/contentOps.js";
import { importReviewCards, parseCardInterchange } from "./lib/cardInterchange.js";
import { mergeBoardVersions } from "./lib/boardSync.js";
import { adoptVaultConfig, clearSyncBaseline, clearVaultConfig, createVaultConfig, getDeviceId, readVaultConfig, recordVaultSync, syncFileNameFor } from "./lib/syncIdentity.js";
// Actions load these tools on use; the service worker warms them (issue #95).
import { isWarmToolUnavailable, loadBackupTools, loadImportConverters, loadLibraryRetrieval, loadLinkAudit, warmToolFailureMessage } from "./lib/warmTools.js";
// The lecture renderer (marked and DOMPurify, about 85 KB) stays in the
// startup bundle, where the link check used to hold it: every lecture needs
// it first, and as a shared route chunk it would spend the install budget.
import "./lib/markdown.js";
import { buildConceptMap } from "./lib/conceptMap.js";
import { migrateItemsToFsrs } from "./lib/fsrs.js";
import { MAX_ASSESSMENTS, MIN_ASSESSMENT_POOL, assessmentMistakeDrafts, buildAssessment, createAssessmentRecord, recommendationForAssessment, scoreAssessment } from "./lib/assessment.js";
import { copyText } from "./lib/clipboard.js";
import { createLibrarySearchClient } from "./lib/librarySearchClient.js";
import { categoryForReviewItem, recordMistake, reinsertRecord, updateMistake } from "./lib/mistakes.js";
import { masteryByPart, PART_MASTERY_STATES } from "./lib/mastery.js";
import { actionableDueCount, buildDailySession, planPace, resumeTarget, SESSION_LENGTHS } from "./lib/plan.js";
import { StorageBudgetError } from "./lib/storageBudget.js";
import { aiClippingIds, isAiAuthoredClipping, isAiAuthoredReviewItem, materializeAiCardProvenance, materializeAiFlashcard, withAiDraftTag } from "./lib/aiProvenance.js";
import { lectureLoadMessage, recoverableImport } from "./lib/chunkRecovery.js";
import ErrorBoundary from "./components/ErrorBoundary";
import { downloadBlob } from "./lib/download.js";
// Shared by Home, the Library and the lazily loaded Notebook.
import { DocumentCard } from "./components/DocumentCard.jsx";
import {
  actionableReviewCount,
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
const Reader = lazy(() => recoverableImport(() => import("./components/Reader"), "Reader"));
const Whiteboard = lazy(() => recoverableImport(() => import("./components/Whiteboard"), "Whiteboard"));
const AiLearningStudio = lazy(() => recoverableImport(() => import("./components/AiLearningStudio"), "AiLearningStudio"));
const DeviceEvidence = lazy(() => recoverableImport(() => import("./components/DeviceEvidence"), "DeviceEvidence"));
// The review center, its card editor, and the readiness check load on first
// use; keeping them out of the startup bundle holds it under its 750 KB budget.
const ReviewCenter = lazy(() => recoverableImport(() => import("./components/ReviewCenter"), "ReviewCenter"));
const ReviewCardDialog = lazy(() => recoverableImport(() => import("./components/ReviewCenter").then((module) => ({ default: module.ReviewCardDialog })), "ReviewCenter"));
const AssessmentDialog = lazy(() => recoverableImport(() => import("./components/AssessmentDialog.jsx"), "AssessmentDialog"));
/**
 * A lazy screen that the app also preloads once the first render is idle. A
 * screen whose module is already loaded renders at once, without its Suspense
 * fallback; one opened before that loads through the boundary. The component
 * type is fixed for each mount, so a preload that lands while the fallback
 * shows never remounts the screen.
 */
const preloadedLazy = (loader, name) => {
  let loaded = null;
  let pending = null;
  const load = () => {
    pending ||= recoverableImport(loader, name).then((module) => {
      loaded = module.default;
      return module;
    }, (error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  const LazyScreen = lazy(load);
  function PreloadedScreen(props) {
    const [Screen] = useState(() => loaded || LazyScreen);
    return <Screen {...props} />;
  }
  return [PreloadedScreen, () => { load().catch(() => {}); }];
};
// Settings and the Notebook left the startup bundle for its budget too; both
// are install-tier route screens, so they still open offline (issue #95).
const [SettingsView, preloadSettings] = preloadedLazy(() => import("./components/Settings.jsx"), "Settings");
const [NotebookView, preloadNotebook] = preloadedLazy(() => import("./components/Notebook.jsx"), "Notebook");

const parseRoute = () => {
  const hash = window.location.hash || "#/home";
  const documentMatch = hash.match(/^#\/(read|board)\/(.+)$/);
  if (documentMatch) return { view: documentMatch[1] === "read" ? "reader" : "board", documentId: decodeURIComponent(documentMatch[2]) };
  const viewMatch = hash.match(/^#\/(home|library|notebook|review|ai|device-evidence)$/);
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

const TOAST_ICONS = { success: CheckCircle2, warning: AlertTriangle, error: CircleX, info: Info };
const TOAST_PREFIXES = { warning: "Warning: ", error: "Error: " };
// Errors and warnings stay long enough to be found and read; callers may ask
// for longer, never shorter.
const toastDuration = (toast) => Math.max(toast.duration || 0, toast.kind === "error" ? 10_000 : toast.kind === "warning" ? 6_000 : 3_200);

/**
 * Visual toast. Announcements go through the shell's persistent live regions
 * (ToastAnnouncer), so this element is not a live region itself. The timer is
 * keyed to the toast id: unrelated app renders must not restart it. Hovering
 * or focusing the dismiss button pauses it; the rest of the toast lets taps
 * through to the controls underneath.
 */
function Toast({ toast, onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const remainingRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const toastId = toast?.id;
  useEffect(() => {
    remainingRef.current = toast ? toastDuration(toast) : 0;
    setPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastId]);
  useEffect(() => {
    if (!toastId || paused) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(() => closeRef.current(), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(1_500, remainingRef.current - (Date.now() - startedAt));
    };
  }, [paused, toastId]);
  if (!toast) return null;
  const kind = TOAST_ICONS[toast.kind] ? toast.kind : "success";
  const Icon = TOAST_ICONS[kind];
  return <div className={`toast ${kind}`} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}><Icon size={17} aria-hidden="true" /><span>{TOAST_PREFIXES[kind] && <span className="visually-hidden">{TOAST_PREFIXES[kind]}</span>}{toast.message}</span><button onClick={() => closeRef.current()} aria-label="Dismiss notification" type="button"><X size={15} /></button></div>;
}

/**
 * Persistent, initially empty live regions: messages are inserted into regions
 * that already exist, which screen readers announce reliably. Errors use the
 * assertive alert region; everything else is polite.
 */
function ToastAnnouncer({ toast }) {
  const kind = TOAST_ICONS[toast?.kind] ? toast.kind : "success";
  const text = toast ? `${TOAST_PREFIXES[kind] || ""}${toast.message}` : "";
  return <>
    <div className="visually-hidden toast-live toast-live--polite" role="status" aria-live="polite" aria-atomic="true">{toast && kind !== "error" && <span key={toast.id}>{text}</span>}</div>
    <div className="visually-hidden toast-live toast-live--assertive" role="alert" aria-live="assertive" aria-atomic="true">{toast && kind === "error" && <span key={toast.id}>{text}</span>}</div>
  </>;
}

/**
 * Focuses the main landmark for the skip link and the lazy-route fallback.
 * It is focusable only while it holds that focus (main drops the tabindex on
 * blur or pointerdown): a permanent tabindex would park focus on <main> after
 * any click on page text, which stops keyboard scrolling in nested scrollers
 * such as the reader and breaks body-targeted shortcuts like teaching Space.
 */
const focusMainContent = (options) => {
  const main = document.getElementById("main-content");
  if (!main) return;
  main.setAttribute("tabindex", "-1");
  main.focus(options);
};
const releaseMainContent = (event) => {
  if (event.type === "pointerdown" || event.target === event.currentTarget) event.currentTarget.removeAttribute("tabindex");
};

/**
 * Rendered after a lazy screen inside its Suspense boundary. Route focus runs
 * when the view changes; while the screen's chunk loads there is no heading
 * yet, so focus falls back to the main landmark. When the screen commits, move
 * that focus on to its heading, as it would have landed with the screen in the
 * startup bundle. Focus the learner moved elsewhere in the meantime stays.
 */
function LazyRouteHeading() {
  useLayoutEffect(() => {
    const main = document.getElementById("main-content");
    const heading = main?.querySelector("h1");
    if (!heading || document.activeElement !== main) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, []);
  return null;
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
      // The separate inert-cleanup effect may run after this cleanup, and
      // focus() on an element inside an inert region is a silent no-op.
      // Deferring one frame restores the opener after the background is
      // interactive again (BUG-003 focus-restoration defect).
      // Only restore when focus was actually lost: if the learner already moved
      // into another control (a dialog underneath, a field they clicked), a late
      // restore would steal focus mid-typing and drop keystrokes.
      const target = previouslyFocused;
      const dialog = dialogRef.current;
      const focusLost = () => {
        const current = document.activeElement;
        return !current || current === document.body || !current.isConnected || Boolean(dialog?.contains(current)) || Boolean(current.closest?.("[inert]"));
      };
      requestAnimationFrame(() => {
        if (!focusLost()) return;
        if (target?.isConnected && !target.closest?.("[inert]")) target.focus?.();
        else if (target?.isConnected) requestAnimationFrame(() => { if (target.isConnected && focusLost()) target.focus?.(); });
      });
    };
  }, [active, dialogRef]);
}

/** Password prompt for an encrypted backup import (lumen.backup.enc.v1). */
function EncryptedImportDialog({ pending, onSubmit, onCancel }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  useModalKeyboard(Boolean(pending), dialogRef, onCancel);

  useEffect(() => {
    if (!pending) return;
    setBusy(false);
    dialogRef.current?.querySelector("input")?.focus();
  }, [pending?.fileName, pending?.error]);

  if (!pending) return null;
  const submit = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    await onSubmit(password);
    setBusy(false);
  };
  return <div className="modal-layer"><button className="modal-scrim" onClick={onCancel} aria-label="Cancel encrypted import" type="button" /><form ref={dialogRef} className="create-note-dialog encrypted-import-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="encrypted-import-title"><div className="dialog-icon"><ShieldCheck size={22} /></div><span className="eyebrow">Encrypted backup</span><h2 id="encrypted-import-title">Enter the backup password</h2><p>“{pending.fileName}” is protected with AES-256-GCM. Decryption happens entirely on this device.</p><label><span>Password</span><input className="text-input" type="password" value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{pending.error && <p className="inline-warning">{pending.error}</p>}<div className="modal-actions"><button className="button ghost" onClick={onCancel} type="button">Cancel</button><button className="button primary" disabled={!password || busy} type="submit">{busy ? "Decrypting…" : "Unlock and preflight"}</button></div></form></div>;
}

/** Keyboard shortcuts sheet, opened with "?" anywhere, the desktop top bar, or Settings. */
function ShortcutsDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  useModalKeyboard(open, dialogRef, onClose);
  if (!open) return null;
  const groups = [
    { title: "Review session", entries: [["Space", "Reveal the answer"], ["1 – 4", "Grade Again / Hard / Good / Easy"], ["B", "Bury the card until tomorrow"], ["⌘/Ctrl + Z", "Undo the last grade"]] },
    { title: "Whiteboard", entries: [["Arrow keys", "Nudge the selected object (Shift: larger steps)"], ["Delete", "Delete the selected object"], ["⌘/Ctrl + Z", "Undo (Shift: redo)"], ["Esc", "Deselect / cancel text entry"]] },
    { title: "Reader & dialogs", entries: [["Esc", "Close menus, popovers, and dialogs"], ["Tab / Shift + Tab", "Cycle a dialog's controls (focus is trapped)"]] },
    { title: "AI tutor", entries: [["Enter", "Send your question (with a mouse or trackpad)"], ["Shift + Enter", "Start a new line"], ["⌘/Ctrl + Enter", "Send, also in Code review"], ["Esc", "Stop the answer being written"], ["↑", "Bring back your last question into an empty box"]] },
    { title: "Anywhere", entries: [["⌘/Ctrl + K", "Search the library"], ["?", "Open this shortcut sheet"]] },
  ];
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close keyboard shortcuts" type="button" /><section ref={dialogRef} className="create-note-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"><div className="dialog-icon"><Keyboard size={22} /></div><span className="eyebrow">Work faster</span><h2 id="shortcuts-title">Keyboard shortcuts</h2>{groups.map((group) => <div className="shortcut-group" key={group.title}><h3>{group.title}</h3><dl>{group.entries.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl></div>)}<div className="modal-actions"><button className="button primary" onClick={onClose} type="button">Done</button></div></section></div>;
}

/**
 * Organize dialog (CONTENT-001): rename, tags, collection assignment (with
 * inline creation), pin, and archive for one custom document.
 */
function ManageDocumentDialog({ doc, collections, onClose, onSave }) {
  const [title, setTitle] = useState(doc?.title || "");
  const [tags, setTags] = useState((doc?.tags || []).join(", "));
  const [collectionId, setCollectionId] = useState(doc?.collectionId || "");
  const [newCollection, setNewCollection] = useState("");
  const [pinned, setPinned] = useState(Boolean(doc?.pinned));
  const [archived, setArchived] = useState(Boolean(doc?.archived));
  const dialogRef = useRef(null);
  useModalKeyboard(Boolean(doc), dialogRef, onClose);

  useEffect(() => {
    if (!doc) return;
    setTitle(doc.title || "");
    setTags((doc.tags || []).join(", "));
    setCollectionId(doc.collectionId || "");
    setNewCollection("");
    setPinned(Boolean(doc.pinned));
    setArchived(Boolean(doc.archived));
    // Synchronous focus: a deferred (rAF) focus can fire hundreds of
    // milliseconds late under frame throttling and steal focus from a field
    // the learner is already typing in.
    dialogRef.current?.querySelector("input")?.focus();
    // Keyed to the id, not the object: the debounced profile commit mints
    // fresh record identities, and an identity-keyed reset mid-edit wipes
    // typed state and steals focus back to the first input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  if (!doc) return null;
  const submit = (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave(doc.id, {
      title: title.trim().slice(0, 180),
      tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
      collectionId: collectionId === "__new__" ? "" : collectionId,
      newCollectionName: collectionId === "__new__" ? newCollection.trim().slice(0, 60) : "",
      pinned,
      archived,
    });
  };

  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close organize dialog" type="button" /><form ref={dialogRef} className="create-note-dialog manage-doc-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="manage-doc-title"><div className="dialog-icon"><FileEdit size={22} /></div><span className="eyebrow">Organize</span><h2 id="manage-doc-title">Organize this document</h2><label><span>Title</span><input className="text-input" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} required /></label><label><span>Tags <small>comma separated</small></span><input className="text-input" value={tags} maxLength={400} onChange={(event) => setTags(event.target.value)} placeholder="transformers, interview" /></label><label><span>Collection</span><select className="ui-select ui-select--block" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">None</option>{collections.map((collection) => <option value={collection.id} key={collection.id}>{collection.name}</option>)}<option value="__new__">New collection…</option></select></label>{collectionId === "__new__" && <label><span>New collection name</span><input className="text-input" value={newCollection} maxLength={60} onChange={(event) => setNewCollection(event.target.value)} placeholder="e.g. Interview prep" required /></label>}<label className="setting-toggle"><span><strong>Pin to the top</strong><small>Pinned documents lead the notebook list</small></span><input type="checkbox" role="switch" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /></label><label className="setting-toggle"><span><strong>Archive</strong><small>Hidden from lists; content, links, and study data stay intact</small></span><input type="checkbox" role="switch" checked={archived} onChange={(event) => setArchived(event.target.checked)} /></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!title.trim() || (collectionId === "__new__" && !newCollection.trim())} type="submit">Save</button></div></form></div>;
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
    titleRef.current?.focus();
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

/**
 * Goal target Parts: after editing, the field shows exactly the list that was
 * saved and names every value it ignored, instead of silently dropping them.
 */
function GoalPartsField({ saved, onSave }) {
  const savedText = saved.join(", ");
  const [draft, setDraft] = useState(savedText);
  const [note, setNote] = useState("");
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(savedText);
  }, [savedText]);
  const commit = () => {
    editingRef.current = false;
    const valid = new Set();
    const ignored = [];
    for (const token of draft.split(/[\s,;]+/).filter(Boolean)) {
      const part = /^\d+$/.test(token) ? Number(token) : NaN;
      if (part >= 1 && part <= 23) valid.add(part);
      else ignored.push(token);
    }
    const targetParts = [...valid].sort((left, right) => left - right);
    setDraft(targetParts.join(", "));
    setNote(ignored.length ? `${ignored.map((value) => `“${value.slice(0, 12)}”`).join(", ")} ${ignored.length === 1 ? "isn’t a Part" : "aren’t Parts"} (1–23), so ${ignored.length === 1 ? "it was" : "they were"} left out.` : "");
    onSave(targetParts);
  };
  return <label><span>Target Parts <small>numbers 1–23, separated by commas</small></span><input className="text-input" value={draft} onFocus={() => { editingRef.current = true; }} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="e.g. 5, 6, 9" aria-label="Goal target Parts" aria-describedby="goal-parts-note" /><small className="goal-parts-note" id="goal-parts-note" role="status">{note}</small></label>;
}

// Shape cues that pair with each mastery color on the curriculum map and legend.
const CONCEPT_STATE_ICONS = { reading: BookOpen, read: Check, practicing: RefreshCw, mastered: Star };

function Dashboard({ profile, allDocuments, onOpen, onLibrary, onNotebook, onReview, onStartAssessment, onGoalsChange }) {
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [mapFocus, setMapFocus] = useState(null);
  const dailySession = useMemo(() => buildDailySession(sessionMinutes, { profile, documents: allDocuments }), [allDocuments, profile, sessionMinutes]);
  const mastery = useMemo(() => masteryByPart(allDocuments, profile), [allDocuments, profile]);
  const masteryLabel = (state) => PART_MASTERY_STATES.find((entry) => entry.id === state)?.label || state;
  const recent = profile.recent.map((id) => allDocuments.find((doc) => doc.id === id)).filter(Boolean);
  // One Continue target for the hero, the Continue card, the Today tile, and the plan.
  const resume = resumeTarget({ profile, documents: allDocuments });
  const resuming = resume?.action === "continue";
  const continueDoc = resume?.document || documentMap.get(initialDocumentId) || allDocuments[0];
  const history = recent.filter((doc) => doc.id !== continueDoc.id).slice(0, 4);
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
          <button className="button primary large" onClick={() => (resume ? onOpen(resume.document.id) : onLibrary())} type="button">
            <BookOpen size={19} /> {resuming ? "Continue learning" : resume ? "Start learning" : "Browse the library"} <ArrowRight size={18} />
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
          <div className="section-heading"><div><span className="eyebrow">{resuming ? "Continue" : "Up next"}</span><h2>{continueDoc.title}</h2></div><ProgressRing value={documentProgress(profile, continueDoc.id)} /></div>
          <p>{continueDoc.description}</p>
          <div className="continue-meta"><span><Clock3 size={16} /> {continueDoc.minutes} min</span><span>{continueDoc.partTitle}</span></div>
          <button className="button secondary" onClick={() => onOpen(continueDoc.id)} type="button">{resuming ? "Resume lecture" : "Start lecture"} <ArrowRight size={17} /></button>
        </article>

        <article className="stats-card">
          <span className="eyebrow">Study pulse</span>
          <div className="big-stat"><strong>{completed}</strong><span>{completed === 1 ? "lecture" : "lectures"}<br />completed</span></div>
          <div className="stat-row"><span>Overall progress</span><strong>{Math.round(overall * 100)}%</strong></div>
          <div className="stat-row"><span>Personal notes</span><strong>{annotated}</strong></div>
          <div className="stat-row"><span>Bookmarks</span><strong>{profile.bookmarks.length}</strong></div>
        </article>
      </section>

      <section className="today-widgets" aria-label="Today at a glance">
        {(() => {
          const dueCount = actionableReviewCount(profile);
          const openMistakes = (profile.mistakes || []).filter((mistake) => !mistake.correctedAt).length;
          return (
            <>
              <button className="today-widget" onClick={onReview} type="button"><Brain size={19} /><strong>{dueCount}</strong><span>due card{dueCount === 1 ? "" : "s"}</span></button>
              <button className="today-widget" onClick={onReview} type="button"><Flame size={19} /><strong>{openMistakes}</strong><span>open mistake{openMistakes === 1 ? "" : "s"}</span></button>
              <button className="today-widget today-widget--wide" onClick={() => (resuming ? onOpen(resume.document.id) : onLibrary())} type="button"><BookOpen size={19} /><strong>{resuming ? "Continue" : "Start reading"}</strong><span>{resuming ? resume.document.title : "Browse the library"}</span></button>
            </>
          );
        })()}
      </section>

      <section className="page-section daily-plan" aria-label="Today’s study plan">
        <div className="section-heading"><div><span className="eyebrow">Daily session</span><h2>Today’s plan</h2></div><div className="daily-plan-lengths" role="radiogroup" aria-label="Session length" onKeyDown={(event) => {
          // Radio-group keys: arrows move and select; one Tab stop for the group.
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
          if (!step) return;
          event.preventDefault();
          const next = SESSION_LENGTHS[(SESSION_LENGTHS.indexOf(sessionMinutes) + step + SESSION_LENGTHS.length) % SESSION_LENGTHS.length];
          setSessionMinutes(next);
          event.currentTarget.querySelector(`[data-minutes="${next}"]`)?.focus();
        }}>{SESSION_LENGTHS.map((length) => <button key={length} role="radio" aria-checked={sessionMinutes === length} tabIndex={sessionMinutes === length ? 0 : -1} data-minutes={length} className={sessionMinutes === length ? "active" : ""} onClick={() => setSessionMinutes(length)} type="button">{length} min</button>)}</div></div>
        {dailySession.empty
          ? <p className="microcopy">Nothing is due and nothing is open — read ahead in the library or add review cards from your highlights.</p>
          : <div className="daily-plan-blocks">
            {dailySession.blocks.map((block, index) => <button className="daily-plan-block" key={`${block.kind}-${index}`} onClick={() => {
              if (block.kind === "review" || block.kind === "mistakes") onReview();
              else if (block.documentId) onOpen(block.documentId);
            }} type="button">
              <span className="daily-plan-minutes">{block.minutes} min</span>
              <span className="daily-plan-label">{block.label}{block.partial ? " (as far as you get)" : ""}{block.reason && <small className="daily-plan-reason">{block.reason}</small>}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>)}
            <p className="microcopy">{dailySession.plannedMinutes} of {dailySession.budgetMinutes} minutes planned · reviews first, then your most-repeated open mistakes, then reading.</p>
          </div>}
      </section>

      <section className="page-section goal-section" aria-label="Study goal">
        <div className="section-heading"><div><span className="eyebrow">Direction</span><h2>Study goal</h2></div></div>
        <div className="goal-editor">
          <GoalPartsField saved={profile.goals?.targetParts || []} onSave={(targetParts) => onGoalsChange({ targetParts })} />
          <label><span>Target date</span><input className="text-input" type="date" defaultValue={profile.goals?.targetDate || ""} onBlur={(event) => onGoalsChange({ targetDate: /^\d{4}-\d{2}-\d{2}$/.test(event.target.value) ? event.target.value : "" })} aria-label="Goal target date" /></label>
        </div>
        {(() => {
          const pace = planPace({ profile, documents: allDocuments });
          if (!pace) return <p className="microcopy">Set target Parts and a date to see the honest daily pace they imply. Goals guide the plan; nothing is ever locked.</p>;
          return <p className={`goal-pace pace-${pace.status}`} role="status">{pace.message}</p>;
        })()}
      </section>

      <section className="page-section concept-map-section" aria-label="Curriculum map">
        <div className="section-heading"><div><span className="eyebrow">Prerequisite path</span><h2>Curriculum map</h2></div></div>
        {(() => {
          const map = buildConceptMap(mastery, { columns: 4 });
          // Row pitch leaves room between 44px nodes even at 320px wide.
          const height = map.rows * 18;
          const order = map.nodes.map((node) => node.partNumber).sort((left, right) => left - right);
          // One Tab stop for the map; arrow keys walk the path in curriculum order.
          const tabbable = order.includes(mapFocus) ? mapFocus : (map.nodes.find((node) => node.state === "reading")?.partNumber ?? order[0]);
          const moveFocus = (event) => {
            const current = Number(event.target.closest("[data-part]")?.dataset.part);
            const index = order.indexOf(current);
            const next = { ArrowRight: order[index + 1], ArrowDown: order[index + 1], ArrowLeft: order[index - 1], ArrowUp: order[index - 1], Home: order[0], End: order.at(-1) }[event.key];
            if (index < 0 || next === undefined) return;
            event.preventDefault();
            setMapFocus(next);
            event.currentTarget.querySelector(`[data-part="${next}"]`)?.focus();
          };
          return (
            <>
              <div className="concept-map" style={{ aspectRatio: `100 / ${height}` }}>
                <svg className="concept-map-edges" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  {map.edges.map((edge) => <line key={`${edge.from}-${edge.to}`} x1={edge.x1 * 100} y1={edge.y1 * height} x2={edge.x2 * 100} y2={edge.y2 * height} className="concept-edge" />)}
                </svg>
                <div className="concept-map-nodes" role="toolbar" aria-label="Curriculum map" aria-describedby="concept-map-help" onKeyDown={moveFocus}>
                  {map.nodes.map((node) => {
                    const startId = parts.find((part) => part.number === node.partNumber)?.startId;
                    const StateIcon = CONCEPT_STATE_ICONS[node.state];
                    const name = String(node.partTitle || "").replace(/^Part \d+\s+[—-]\s+/, "");
                    return (
                      <button key={node.partNumber} className={`concept-node state-${node.state}`} style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }} data-part={node.partNumber} tabIndex={node.partNumber === tabbable ? 0 : -1} onFocus={() => setMapFocus(node.partNumber)} onClick={() => startId && onOpen(startId)} aria-label={`Part ${node.partNumber}: ${name} — ${masteryLabel(node.state)}, ${node.readPercent}% read`} title={`Part ${node.partNumber} · ${name} — ${masteryLabel(node.state)}, ${node.readPercent}% read`} type="button">
                        <span aria-hidden="true">{node.partNumber}</span>
                        {StateIcon && <StateIcon className="concept-node-badge" size={12} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="concept-map-help" id="concept-map-help">Tap a Part to open it; with a keyboard, arrow keys move along the path.</p>
              <ul className="concept-map-legend" aria-label="Map legend">
                {PART_MASTERY_STATES.map((state) => {
                  const StateIcon = CONCEPT_STATE_ICONS[state.id];
                  return <li key={state.id}><span className={`concept-legend-swatch state-${state.id}`} aria-hidden="true">{StateIcon && <StateIcon size={10} />}</span>{state.label}</li>;
                })}
              </ul>
            </>
          );
        })()}
      </section>

      <section className="page-section mastery-section" aria-label="Mastery by Part">
        <div className="section-heading"><div><span className="eyebrow">Evidence-based</span><h2>Mastery by Part</h2></div><button className="text-button" onClick={onReview} type="button">Review center <ArrowRight size={16} /></button></div>
        <div className="mastery-grid">
          {mastery.map((part) => {
            const lastCheck = (profile.assessments || []).find((record) => record.partNumber === part.partNumber);
            // A readiness check builds from the learner's own cards; below the
            // minimum, say so instead of offering a button that always fails.
            const checkable = part.activeCards >= MIN_ASSESSMENT_POOL;
            return <article className={`mastery-row state-${part.state}`} key={part.partNumber} title={`${part.reason} Next: ${part.nextAction}`}>
              <span className="mastery-part">{String(part.partNumber).padStart(2, "0")}</span>
              <div className="mastery-copy"><strong>{part.partTitle}</strong><span>{part.completedChapters}/{part.chapters} chapters{part.activeCards ? ` · ${part.masteredCards}/${part.activeCards} cards mastered` : ""}{part.overdueCards ? ` · ${part.overdueCards} overdue` : ""}{lastCheck ? ` · last check ${lastCheck.percent}%` : ""}</span><small className="mastery-next">{part.nextAction}</small></div>
              <div className="mastery-row-actions">{checkable
                ? <button className="text-button mastery-check" onClick={() => onStartAssessment(part.partNumber)} aria-label={`Check Part ${part.partNumber} readiness`} type="button">Check readiness</button>
                : <small className="mastery-check-hint">Check unlocks at {MIN_ASSESSMENT_POOL} cards · {part.activeCards}/{MIN_ASSESSMENT_POOL}</small>}<span className={`mastery-state state-${part.state}`}>{masteryLabel(part.state)}</span></div>
            </article>;
          })}
        </div>
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
                <span>{part.documents.length - 1} {part.documents.length - 1 === 1 ? "lecture" : "lectures"} · {part.minutes} min</span>
                {partValue > 0 && <div className="mini-progress" aria-hidden="true"><span style={{ width: `${partValue * 100}%` }} /></div>}
              </button>
            );
          })}
        </div>
      </section>

      {history.length > 0 && (
        <section className="page-section">
          <div className="section-heading"><div><span className="eyebrow">History</span><h2>Recently opened</h2></div></div>
          <div className="document-list">{history.map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={onOpen} compact />)}</div>
        </section>
      )}

      {(profile.activity || []).length > 0 && (
        <section className="page-section activity-section" aria-label="Recent activity">
          <div className="section-heading"><div><span className="eyebrow">Local ledger</span><h2>Recent activity</h2></div></div>
          <ul className="activity-list">
            {profile.activity.slice(0, 6).map((entry) => {
              const at = Date.parse(entry.at);
              const minutesAgo = Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : null;
              const when = minutesAgo === null ? "" : minutesAgo < 1 ? "just now" : minutesAgo < 60 ? `${minutesAgo} min ago` : minutesAgo < 1_440 ? `${Math.round(minutesAgo / 60)} h ago` : new Date(entry.at).toLocaleDateString();
              return <li key={entry.id}><span className={`activity-kind kind-${entry.kind}`}>{entry.kind}</span><span className="activity-label">{entry.label}</span><small>{when}</small></li>;
            })}
          </ul>
        </section>
      )}

      <section className="study-method-card">
        <div className="method-icon"><GraduationCap size={26} /></div>
        <div><span className="eyebrow">Better than passive reading</span><h2>Read → recall → explain → implement</h2><p>Use narration during review, personal notes for retrieval practice, teaching mode to explain aloud, and the whiteboard for derivations.</p></div>
        <div className="dashboard-method-actions"><button className="button ghost" onClick={onNotebook} type="button">Open notebook</button><button className="button primary" onClick={onReview} type="button"><Brain size={17} /> {(() => {
          const due = actionableReviewCount(profile);
          return due ? `Review ${due} due` : "Open reviews";
        })()}</button></div>
      </section>
    </div>
  );
}

function LibraryView({ profile, query, setQuery, selectedPart, setSelectedPart, allDocuments, customDocuments, onOpen, onSettingsChange }) {
  const [sortBy, setSortBy] = useState("smart");
  const [layout, setLayout] = useState("grid");
  const [searchIndex, setSearchIndex] = useState(null);
  const [searchIndexError, setSearchIndexError] = useState("");
  const [workerResults, setWorkerResults] = useState(null);
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      // Pruning on load clears the per-keystroke prefixes older builds stored.
      return pruneRecentSearches(JSON.parse(globalThis.localStorage?.getItem("lumen.library.recent-searches") || "[]"));
    } catch {
      return [];
    }
  });
  const [announcement, setAnnouncement] = useState("");
  const filterRowRef = useRef(null);
  const searchClientRef = useRef(null);
  const corpusSentRef = useRef(false);
  const sentCustomRef = useRef(new Map());
  const savedSearches = Array.isArray(profile.settings.savedSearches) ? profile.settings.savedSearches : [];
  const normalized = query.trim();
  useEffect(() => {
    if (!normalized || searchIndex) return undefined;
    let active = true;
    loadDocumentSearchIndex()
      .then((index) => { if (active) setSearchIndex(index); })
      .catch(() => { if (active) setSearchIndexError("Full lecture text could not be loaded; title and summary search remains available."); });
    return () => { active = false; };
  }, [normalized, searchIndex]);
  useEffect(() => () => {
    searchClientRef.current?.terminate();
    searchClientRef.current = null;
  }, []);
  useEffect(() => {
    // Full-text parsing and ranking run in a Web Worker (PERF-001); the
    // immutable built-in corpus is transferred once after its lazy load.
    if (!searchIndex || corpusSentRef.current) return;
    if (!searchClientRef.current) searchClientRef.current = createLibrarySearchClient();
    searchClientRef.current.setCorpus(
      allDocuments.filter((doc) => doc.source === "builtin"),
      [...searchIndex.entries()],
    );
    corpusSentRef.current = true;
  }, [allDocuments, searchIndex]);
  useEffect(() => {
    const client = searchClientRef.current;
    if (!client || !corpusSentRef.current) return;
    const seen = sentCustomRef.current;
    const present = new Set();
    const upsert = [];
    for (const doc of customDocuments) {
      present.add(doc.id);
      if (seen.get(doc.id) !== doc) upsert.push(doc);
      seen.set(doc.id, doc);
    }
    const removeIds = [...seen.keys()].filter((id) => !present.has(id));
    for (const id of removeIds) seen.delete(id);
    if (upsert.length || removeIds.length) client.updateCustom(upsert, removeIds);
  }, [customDocuments, searchIndex]);
  const candidates = useMemo(() => selectedPart === "uploads"
    ? customDocuments.filter((doc) => !doc.archived)
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
            : allDocuments, [allDocuments, customDocuments, profile.bookmarks, profile.progress, profile.recent, selectedPart]);
  useEffect(() => {
    if (!normalized || !searchIndex || !searchClientRef.current) {
      setWorkerResults(null);
      return undefined;
    }
    let active = true;
    searchClientRef.current.search(normalized, candidates.map((doc) => doc.id))
      .then(({ stale, results }) => {
        if (!active || stale) return;
        setWorkerResults(results);
      })
      .catch(() => { if (active) setWorkerResults(null); });
    return () => { active = false; };
  }, [candidates, normalized, searchIndex]);
  const saveRecentSearches = useCallback((update) => setRecentSearches((current) => {
    const next = update(current);
    if (next.length === current.length && next.every((entry, index) => entry === current[index])) return current;
    try { globalThis.localStorage?.setItem("lumen.library.recent-searches", JSON.stringify(next)); } catch { /* device-local convenience only */ }
    return next;
  }), []);
  // Recents record committed searches only — Enter, leaving the field,
  // opening a result, or a pause — never each keystroke's prefix. Clear
  // keeps focus in the field, so a query abandoned with it is not recorded.
  const commitSearch = useCallback((value) => saveRecentSearches((current) => pushRecentSearch(current, value)), [saveRecentSearches]);
  useEffect(() => {
    if (!normalized || !workerResults?.length) return undefined;
    const timer = setTimeout(() => commitSearch(normalized), 1_500);
    return () => clearTimeout(timer);
  }, [commitSearch, normalized, workerResults]);
  const visible = useMemo(() => {
    let results;
    if (normalized && workerResults) {
      const byId = new Map(workerResults.map((entry) => [entry.id, entry]));
      results = candidates
        .filter((doc) => byId.has(doc.id))
        .map((doc) => ({ ...doc, description: byId.get(doc.id).snippet || doc.description, searchScore: byId.get(doc.id).searchScore, matchedTerms: byId.get(doc.id).matchedTerms || [], corrections: byId.get(doc.id).corrections || [] }))
        .sort((a, b) => b.searchScore - a.searchScore || a.partNumber - b.partNumber || a.chapterNumber - b.chapterNumber);
    } else if (normalized) {
      // Metadata-only search covers the moments before the corpus/worker is
      // ready and the degraded no-index path; it never parses full text on
      // the main thread.
      results = searchDocuments(candidates, normalized);
    } else {
      results = [...candidates];
    }
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
  }, [candidates, normalized, profile.progress, profile.recent, sortBy, workerResults]);

  const capped = Boolean(normalized) && visible.length >= SEARCH_RESULT_LIMIT;
  const countLabel = capped ? `Top ${SEARCH_RESULT_LIMIT} results` : `${visible.length} ${visible.length === 1 ? "result" : "results"}`;
  // "Showing matches for …" appears only when every result needed a typo correction.
  const corrections = normalized && visible.length && visible.every((doc) => doc.corrections?.length) ? visible[0].corrections : null;
  const resultSummary = `${countLabel}${normalized ? ` for ${normalized}` : ""}`;
  const announcedRef = useRef(false);
  useEffect(() => {
    // Screen readers hear the settled count, not every keystroke's.
    if (!announcedRef.current) {
      announcedRef.current = true;
      return undefined;
    }
    const timer = setTimeout(() => setAnnouncement(resultSummary), 700);
    return () => clearTimeout(timer);
  }, [resultSummary]);
  const updateFilterCue = useCallback(() => {
    const row = filterRowRef.current;
    if (!row) return;
    row.dataset.fadeStart = String(row.scrollLeft > 2);
    row.dataset.fadeEnd = String(row.scrollWidth - row.clientWidth - row.scrollLeft > 2);
  }, []);
  const hasUploads = customDocuments.length > 0;
  useEffect(() => {
    // Keep the selected chip in view (a sidebar Part jump selects Part 17).
    const row = filterRowRef.current;
    const active = row?.querySelector('[aria-pressed="true"]');
    if (row && active && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2);
    updateFilterCue();
    window.addEventListener("resize", updateFilterCue);
    return () => window.removeEventListener("resize", updateFilterCue);
  }, [hasUploads, selectedPart, updateFilterCue]);
  const openResult = (id) => {
    if (normalized && visible.length) commitSearch(normalized);
    onOpen(id);
  };
  const chip = (value, label, { key, ...extra } = {}) => {
    const active = value === null ? !selectedPart : selectedPart === value;
    return <button key={key} className={active ? "active" : ""} aria-pressed={active} onClick={() => setSelectedPart(value)} type="button" {...extra}>{label}</button>;
  };
  const showAll = ["Show all lectures", () => setSelectedPart(null)];
  const empty = normalized
    ? {
      title: `No matches for “${normalized}”`,
      body: /(^|\s)tag:/i.test(normalized) ? "Tags belong to your own notes; the built-in lectures have none." : selectedPart ? "Nothing in this filter matches. Search every Part, or check the spelling." : "Check the spelling, drop an excluded word or filter, or try a broader concept.",
      actions: [["Clear search", () => setQuery("")], ...(selectedPart ? [["Search all Parts", () => setSelectedPart(null)]] : [])],
    }
    : selectedPart === "bookmarks" ? { title: "No bookmarks yet", body: "Tap the bookmark button while reading to keep a lecture here.", actions: [showAll] }
      : selectedPart === "progress" ? { title: "Nothing in progress", body: "Lectures you have started but not finished appear here.", actions: [showAll] }
        : selectedPart === "recent" ? { title: "No lectures opened yet", body: "Lectures you open appear here, most recent first.", actions: [showAll] }
          : { title: "Nothing to show here", body: "Archived notes stay in the Notebook.", actions: [showAll] };

  return (
    <div className="page library-page">
      <header className="page-title">
        <div><span className="eyebrow">Complete curriculum</span><h1>Your library</h1><p>Search every lecture, formula, method, technology, exercise, and interview prompt.</p></div>
        <div className="library-count"><strong>{allDocuments.length}</strong><span>documents</span></div>
      </header>
      <div className="library-search"><Search size={20} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && normalized && visible.length) commitSearch(normalized); }} onBlur={(event) => { if (normalized && visible.length && !event.relatedTarget?.closest?.(".search-clear")) commitSearch(normalized); }} placeholder="Search lectures, formulas, code…" aria-label="Search library" aria-describedby="library-search-tips" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} />{normalized && !searchIndex && !searchIndexError && <span className="search-index-loading" role="status"><span className="search-index-spinner" aria-hidden="true" /><span className="visually-hidden">Loading full lecture text…</span></span>}{normalized && <button className={savedSearches.includes(normalized) ? "search-save is-active" : "search-save"} onClick={() => onSettingsChange?.({ savedSearches: savedSearches.includes(normalized) ? savedSearches.filter((entry) => entry !== normalized) : [normalized, ...savedSearches].slice(0, 20) })} aria-label={savedSearches.includes(normalized) ? "Remove this saved search" : "Save this search"} aria-pressed={savedSearches.includes(normalized)} type="button"><Star size={16} /></button>}{query && <button className="search-clear" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery("")} aria-label="Clear search" type="button"><X size={17} /></button>}</div>
      <p className={normalized ? "library-search-tips is-searching" : "library-search-tips"} id="library-search-tips">Try <code>"exact phrase"</code> <code>-word</code> to exclude, <code>title:</code> <code>part:5</code> <code>has:code</code> <code>has:formula</code>, or <code>tag:</code> for your own notes.</p>
      {!normalized && (savedSearches.length > 0 || recentSearches.length > 0) && <div className="library-search-shortcuts" aria-label="Saved and recent searches">{savedSearches.map((entry) => <span className="search-chip is-saved" key={`saved-${entry}`}><button onClick={() => setQuery(entry)} aria-label={`Run saved search ${entry}`} type="button"><Star size={12} aria-hidden="true" /> <span className="search-chip-label">{entry}</span></button><button onClick={() => onSettingsChange?.({ savedSearches: savedSearches.filter((item) => item !== entry) })} aria-label={`Remove saved search ${entry}`} type="button"><X size={12} /></button></span>)}{recentSearches.filter((entry) => !savedSearches.includes(entry)).map((entry) => <span className="search-chip" key={`recent-${entry}`}><button onClick={() => setQuery(entry)} aria-label={`Repeat recent search ${entry}`} type="button"><History size={12} aria-hidden="true" /> <span className="search-chip-label">{entry}</span></button><button onClick={() => saveRecentSearches((current) => current.filter((item) => item !== entry))} aria-label={`Remove recent search ${entry}`} type="button"><X size={12} /></button></span>)}</div>}
      {searchIndexError && <p className="inline-warning">{searchIndexError}</p>}
      <div className="filter-row" ref={filterRowRef} onScroll={updateFilterCue} role="group" aria-label="Filter lectures">
        {chip(null, "All")}
        {chip("guides", "Guides")}
        {chip("bookmarks", "Bookmarks")}
        {chip("progress", "In progress")}
        {chip("recent", "Recent")}
        {hasUploads && chip("uploads", "My uploads")}
        {parts.map((part) => chip(String(part.number), `Part ${part.number}`, { key: part.number, "aria-label": `Part ${part.number}: ${part.title.replace(/^Part \d+\s+[—-]\s+/, "")}`, title: part.title }))}
      </div>
      <div className="library-results-toolbar"><div className="library-results-meta"><span>{countLabel}</span>{normalized && <span>for “{query}”</span>}{capped && <span className="library-results-cap">· add a word or a Part filter to narrow</span>}</div><div className="library-view-controls"><label><span>Sort</span><select className="ui-select ui-select--sm" value={normalized || sortBy !== "curriculum" ? sortBy : "smart"} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort library results"><option value="smart">{normalized ? "Relevance" : "Curriculum order"}</option>{normalized && <option value="curriculum">Curriculum order</option>}<option value="recent">Recently opened</option><option value="progress">Most progress</option><option value="shortest">Shortest first</option><option value="title">Title A–Z</option></select></label><div role="group" aria-label="Library layout"><button className={layout === "grid" ? "active" : ""} aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} aria-label="Grid layout" type="button"><LayoutGrid size={17} /></button><button className={layout === "list" ? "active" : ""} aria-pressed={layout === "list"} onClick={() => setLayout("list")} aria-label="List layout" type="button"><List size={18} /></button></div></div></div>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
      {corrections && <p className="library-correction">Showing matches for {corrections.map(({ word }, index) => <span key={word}>{index ? ", " : ""}“<mark>{word}</mark>”</span>)} — nothing matched “{corrections.map(({ term }) => term).join(" ")}” exactly.</p>}
      {normalized && visible.length > 0 && !selectedPart && (() => {
        const counts = new Map();
        for (const doc of visible) {
          const key = doc.source === "custom" ? "uploads" : doc.partNumber >= 1 ? String(doc.partNumber) : null;
          if (key) counts.set(key, (counts.get(key) || 0) + 1);
        }
        if (counts.size < 2) return null;
        return <div className="library-facets" aria-label="Results by Part">{[...counts.entries()].sort((left, right) => (left[0] === "uploads") - (right[0] === "uploads") || Number(left[0]) - Number(right[0])).map(([key, count]) => <button key={key} onClick={() => setSelectedPart(key)} aria-label={`${key === "uploads" ? "My uploads" : `Part ${key}`}: ${count} ${count === 1 ? "result" : "results"}`} type="button">{key === "uploads" ? "My uploads" : `Part ${key}`} <strong>{count}</strong></button>)}</div>;
      })()}
      <div className={layout === "list" ? "document-grid list-layout" : "document-grid"}>
        {visible.map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={openResult} compact={layout === "list"} />)}
      </div>
      {!visible.length && <div className="empty-state"><Search size={30} aria-hidden="true" /><h2>{empty.title}</h2><p>{empty.body}</p><div className="empty-state-actions">{empty.actions.map(([label, action], index) => <button className={index ? "button ghost" : "button secondary"} key={label} onClick={action} type="button">{label}</button>)}</div></div>}
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
        {candidate.encrypted && <p className="inline-warning">This backup was imported from an encrypted file. The recovery snapshot below downloads as plain unencrypted JSON so a restore can always be undone even if the password is lost.</p>}
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
  const [manageDocumentId, setManageDocumentId] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Dialogs owned by a route component but portaled outside #main-content
  // (the review center's mistake dialog) count here; see appModalOpen.
  const [componentModals, setComponentModals] = useState(0);
  const trackComponentModal = useCallback((open) => setComponentModals((count) => Math.max(0, count + (open ? 1 : -1))), []);
  const [aiInsert, setAiInsert] = useState(null);
  const [encryptedImport, setEncryptedImport] = useState(null);
  const [assessmentDraft, setAssessmentDraft] = useState(null);
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
  const [sourceLoadError, setSourceLoadErrorText] = useState("");
  const setSourceLoadError = useCallback((message) => setSourceLoadErrorText(message ? lectureLoadMessage(message) : ""), []);
  const [phoneAiSessionHistory, setPhoneAiSessionHistory] = useState([]);
  const [readerNavigationTarget, setReaderNavigationTarget] = useState(null);
  const [routeFocusRequest, setRouteFocusRequest] = useState(null);
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
  const sidebarPartsRef = useRef(null);
  const sidebarHiddenRef = useRef(false);
  const [sidebarPartsOverflow, setSidebarPartsOverflow] = useState(false);

  if (!profileWriterIdRef.current) profileWriterIdRef.current = createId();

  useModalKeyboard(settingsOpen && !installOpen && !shortcutsOpen, settingsDialogRef, () => setSettingsOpen(false));

  profileRef.current = profile;

  // Every App-level modal hides the shell behind it. inert/aria-hidden are
  // rendered as props from this one flag, so closing any dialog restores each
  // region to its own state (the closed mobile drawer stays inert). Portaled
  // component dialogs join the same flag instead of setting inert themselves.
  const manageDocument = manageDocumentId ? profile.customDocuments.find((doc) => doc.id === manageDocumentId) || null : null;
  const appModalOpen = settingsOpen || installOpen || createOpen || shortcutsOpen || Boolean(reviewDraft) || Boolean(backupCandidate) || Boolean(manageDocument) || Boolean(encryptedImport) || Boolean(assessmentDraft) || componentModals > 0;
  const sidebarHidden = appModalOpen || (compactNavigation && !sidebarOpen);
  sidebarHiddenRef.current = sidebarHidden;

  useEffect(() => {
    // Component dialogs (reader menus, teaching mode, board dialogs) inert the
    // sidebar imperatively and clear it on close. Re-assert the hidden state
    // whenever that happens while the drawer should stay closed.
    const sidebar = sidebarRef.current;
    if (!sidebar) return undefined;
    const enforce = () => {
      if (!sidebarHiddenRef.current) return;
      if (!sidebar.inert) sidebar.inert = true;
      if (sidebar.getAttribute("aria-hidden") !== "true") sidebar.setAttribute("aria-hidden", "true");
    };
    enforce();
    const observer = new MutationObserver(enforce);
    observer.observe(sidebar, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });
    return () => observer.disconnect();
  }, [hydrated, sidebarHidden]);

  useEffect(() => {
    const parts = sidebarPartsRef.current;
    if (!parts) return undefined;
    // Fade the curriculum list's lower edge only while more Parts are below.
    const update = () => setSidebarPartsOverflow(parts.scrollTop + parts.clientHeight < parts.scrollHeight - 4);
    update();
    parts.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(parts);
    return () => {
      parts.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [hydrated]);

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
      // Navigating from the drawer already moved focus to the new page heading.
      if (!document.activeElement || document.activeElement === document.body || sidebar?.contains(document.activeElement)) menuButtonRef.current?.focus?.();
    };
  }, [compactNavigation, sidebarOpen]);

  const notify = useCallback((message, kind = "success", duration) => {
    setToast({ id: createId(), message, kind, duration });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  // One-time pairing-link redemption: scanning the QR from
  // scripts/pair_device.sh opens #/pair?ticket=… — redeem it for the 30-day
  // session cookie, report honestly either way, then clean the URL.
  useEffect(() => {
    const match = window.location.hash.match(/^#\/pair\?ticket=([A-Za-z0-9_-]{8,})$/);
    if (!match) return;
    (async () => {
      try {
        const response = await fetch("/api/auth/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: match[1] }),
        });
        if (response.ok) {
          notify("This device is now paired with the Lumen server — AI features are unlocked for 30 days.", "success", 8000);
        } else {
          const body = await response.json().catch(() => null);
          notify(`The pairing link did not work: ${body?.error?.message || `HTTP ${response.status}`}`, "error", 9000);
        }
      } catch (error) {
        notify(`The pairing link did not work: ${error.message}`, "error", 9000);
      }
      window.location.hash = "#/";
    })();
  }, [notify]);

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
      let localSnapshot = null;
      let mergeConflicts = [];
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => {
          if (profileReplacementRef.current) return null;
          // Capture the merge base only once the previous queued save has
          // committed. A base read when the timer fired predates that commit,
          // so this tab's own rapid follow-up edit (for example a tutor turn
          // updated after retrieval) looked like a concurrent create and was
          // cloned as a sync conflict. Every commit and remote merge advances
          // both refs together, so the pair is always consistent here.
          localSnapshot = profileRef.current;
          const baseSnapshot = profileBaseRef.current;
          if (localSnapshot === baseSnapshot) {
            // An earlier queued save already committed this state.
            if (sequence === saveSequence.current) setSaveStatus("saved");
            return null;
          }
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
    // Finished AI turns are infrequent, valuable results. Commit them without
    // the typing debounce so a quick reload has a much smaller loss window.
    }, profile.aiTutorHistory !== profileBaseRef.current.aiTutorHistory ? 0 : 400);
    return () => clearTimeout(saveTimer.current);
  }, [hydrated, profile, reportPersistenceError, reportSyncConflicts]);

  useEffect(() => {
    const flush = () => {
      if (!hydrated || profileReplacementRef.current || profileRef.current === profileBaseRef.current) return;
      let localSnapshot = null;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => {
          if (profileReplacementRef.current) return null;
          // Same rule as the debounced save: read the base after any queued
          // save has committed, never before.
          localSnapshot = profileRef.current;
          const baseSnapshot = profileBaseRef.current;
          if (localSnapshot === baseSnapshot) return null;
          return updateData("profile", (stored) => mergeProfileVersions(baseSnapshot, localSnapshot, stored, {
            writerId: profileWriterIdRef.current,
          }).profile);
        })
        .then((committedValue) => {
          if (!committedValue) return;
          const committed = normalizeProfile(committedValue);
          const current = profileRef.current;
          profileBaseRef.current = committed;
          signalProfileSyncRef.current(committed);
          if (current === localSnapshot) {
            profileRef.current = committed;
            setProfile(committed);
            return;
          }
          const rebased = mergeProfileVersions(localSnapshot, current, committed, {
            advanceRevision: false,
            writerId: profileWriterIdRef.current,
          });
          profileRef.current = rebased.profile;
          setProfile(rebased.profile);
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

  // Narration playlists (issue #17, AUDIO-002): when a full lecture ends and
  // the opt-in setting is on, continue into the next chapter of the same Part.
  const autoAdvanceNarrationRef = useRef(null);
  const [autoNarrateDocId, setAutoNarrateDocId] = useState("");
  const speech = useSpeech({
    pronunciations: profile.settings.pronunciations,
    voiceURI: profile.settings.voiceURI,
    language: profile.settings.speechLanguage,
    rate: profile.settings.speechRate,
    pitch: profile.settings.speechPitch,
    volume: profile.settings.speechVolume,
    onQueueComplete: ({ label }) => {
      if (label !== "Full lecture") return;
      if (profileRef.current.settings.narrationAutoAdvance !== true) return;
      autoAdvanceNarrationRef.current?.();
    },
    // The sleep timer ends the session and the player with it, so its notice
    // is a toast (announced by ToastAnnouncer) on whichever screen is open;
    // the Reader's own live region skips it (issue #97).
    onNotice: (notice) => {
      if (notice.code === "sleep-ended") notify(notice.message, "info", 8000);
    },
  });
  const wakeLock = useWakeLock(profile.settings.keepScreenAwake && (view === "reader" || view === "board"));

  const customDocuments = useMemo(() => profile.customDocuments.map(makeCustomDocument), [profile.customDocuments]);
  const allDocuments = useMemo(() => [...documents, ...customDocuments], [customDocuments]);
  const allDocumentMap = useMemo(() => new Map(allDocuments.map((doc) => [doc.id, doc])), [allDocuments]);
  const currentDocument = allDocumentMap.get(currentDocumentId) || documentMap.get(initialDocumentId) || allDocuments[0];
  const currentIndex = allDocuments.findIndex((doc) => doc.id === currentDocument.id);
  autoAdvanceNarrationRef.current = () => {
    const current = allDocuments[currentIndex];
    const next = allDocuments[currentIndex + 1];
    if (!current || !next || next.partTitle !== current.partTitle) {
      notify("Narration finished — that was the last chapter of this Part.", "success", 5000);
      return;
    }
    // The Reader announces "Continuing narration" once the chapter plays.
    setAutoNarrateDocId(next.id);
    openDocument(next.id, { focus: false });
  };
  const currentOriginalSource = currentDocument.source === "custom" ? currentDocument.raw : (builtInSources[currentDocument.id] || "");
  const reviewDueCount = actionableReviewCount(profile);
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
    if (target?.focus !== false) setRouteFocusRequest({ id: createId(), target: "h1" });
    const route = routeFor("reader", id);
    if (window.location.hash !== route) window.location.hash = route;
    setProfile((current) => ({ ...current, lastDocumentId: id, recent: [id, ...current.recent.filter((item) => item !== id)].slice(0, 20) }));
  }, [allDocumentMap, editorDirty, notify, speech.stop]);

  const changeView = useCallback((next, { focus = "h1" } = {}) => {
    if (editorDirty && next !== "reader" && !window.confirm("Discard the unsaved editor changes and leave the reader?")) return;
    navigationApprovedRef.current = editorDirty && next !== "reader";
    if (next !== "reader") setEditorDirty(false);
    speech.stop();
    setView(next);
    setSidebarOpen(false);
    if (focus) setRouteFocusRequest({ id: createId(), target: focus });
    if (next === view) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const route = routeFor(next, currentDocumentId);
    if (window.location.hash !== route) window.location.hash = route;
  }, [currentDocumentId, editorDirty, speech.stop, view]);

  useLayoutEffect(() => {
    // Sections share the document scroll position. Open each at its heading;
    // the reader keeps its saved position in its separate scroll container.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [view]);

  useLayoutEffect(() => {
    // After in-app navigation (never the initial load or a restored hash),
    // move focus to the new page's heading so screen readers announce it.
    // Lazy views without a heading yet fall back to the main landmark.
    if (!routeFocusRequest) return;
    const main = document.getElementById("main-content");
    if (!main) return;
    const heading = routeFocusRequest.target === "h1" ? main.querySelector("h1") : null;
    const target = routeFocusRequest.target === "h1" ? heading : main.querySelector(routeFocusRequest.target);
    if (heading && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    const focusTarget = () => (target ? target.focus({ preventScroll: true }) : focusMainContent({ preventScroll: true }));
    // Navigating from the mobile drawer: the page is still inert until the
    // drawer's cleanup runs, and focus() inside an inert region is a no-op.
    if (main.closest("[inert]")) requestAnimationFrame(focusTarget);
    else focusTarget();
  }, [routeFocusRequest]);

  useEffect(() => {
    const titles = { library: "Library", ai: "AI Tutor", review: "Review", notebook: "Notebook", "device-evidence": "Device evidence" };
    if (view === "reader") document.title = `${currentDocument.title} · Lumen`;
    else if (view === "board") document.title = `${currentDocument.title} · Whiteboard · Lumen`;
    else document.title = titles[view] ? `${titles[view]} · Lumen` : "Lumen AI Notes";
  }, [currentDocument.title, view]);

  useEffect(() => {
    const handleRoute = (event) => {
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
      // Background profile saves rebuild the document map and revalidate this
      // effect. Only navigation should dismiss a menu the user just opened.
      if (event?.type === "hashchange") setSidebarOpen(false);
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
        // Never change the route underneath an open dialog.
        if (document.querySelector('[aria-modal="true"]')) return;
        changeView("library", { focus: ".library-search input" });
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

  // Every way into a lecture counts as opening it: cards, deep and shared
  // links, a restored PWA route, and Back/Forward (issue #52). Waiting for
  // hydration keeps the stored profile from being overwritten. It records
  // once per entry: a remote profile adoption rebuilds allDocumentMap, and
  // re-recording then made two tabs on different lectures rewrite Recent
  // back and forth forever.
  const recordedOpenRef = useRef("");
  useEffect(() => {
    if (view !== "reader") {
      recordedOpenRef.current = "";
      return;
    }
    if (!hydrated || !allDocumentMap.has(currentDocumentId) || recordedOpenRef.current === currentDocumentId) return;
    recordedOpenRef.current = currentDocumentId;
    setProfile((current) => (current.recent[0] === currentDocumentId && current.lastDocumentId === currentDocumentId
      ? current
      : { ...current, lastDocumentId: currentDocumentId, recent: [currentDocumentId, ...current.recent.filter((item) => item !== currentDocumentId)].slice(0, 20) }));
  }, [allDocumentMap, currentDocumentId, hydrated, view]);

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
  // What the tutor's suggested starts are built from (TFEAT-04): brief
  // documents plus existing study records, read only while on #/ai.
  const aiStudyContext = useMemo(() => {
    if (view !== "ai") return null;
    const brief = (doc) => doc ? { id: doc.id, title: doc.title, isIndex: doc.isIndex === true, partNumber: doc.partNumber, source: doc.source, archived: doc.archived === true } : null;
    return {
      recent: brief(allDocumentMap.get(profile.recent[0])),
      last: brief(allDocumentMap.get(profile.lastDocumentId)),
      next: brief(resumeTarget({ profile, documents: allDocuments })?.document),
      mistakes: profile.mistakes || [],
      reviewItems: profile.reviewItems,
    };
  }, [allDocumentMap, allDocuments, profile, view]);
  // "Choose sources" lists the whole library; a lecture's text loads only when
  // the learner ticks it, through the same cache the Reader uses.
  const aiSourceCatalog = useMemo(() => allDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    section: document.partTitle || (document.partNumber ? `Part ${document.partNumber}` : ""),
  })), [allDocuments]);
  const loadAiSource = useCallback(async (id) => {
    const document = allDocumentMap.get(id);
    if (!document) throw new Error("This lesson is no longer in your library.");
    const edited = profileRef.current.edits[id];
    if (typeof edited === "string") return edited;
    if (document.source === "custom") return document.raw || "";
    const text = await loadDocumentSource(id);
    setBuiltInSources((current) => current[id] ? current : { ...current, [id]: text });
    return text;
  }, [allDocumentMap]);
  const retrieveLibrarySources = useCallback(async (query, options = {}) => {
    // Retrieval is a warm tool. The tutors only await this call and fall back
    // without library evidence, so a module that is not on this device yet
    // rejects here, carrying the typed offline message.
    const { retrieveLibrary } = await loadLibraryRetrieval();
    return retrieveLibrary(query, {
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
    });
  }, [allDocumentMap, allDocuments, currentDocument.id]);
  const setPersonalNote = (note) => setProfile((current) => ({ ...current, personalNotes: { ...current.personalNotes, [currentDocument.id]: note } }));
  const saveEdit = (raw) => {
    if (currentDocument.source === "custom") {
      const projectedBytes = customDocumentBytes(profileRef.current.customDocuments, currentDocument.id) + utf8Bytes(raw);
      if (projectedBytes > MAX_CUSTOM_DOCUMENT_BYTES) {
        notify("This edit would exceed the 16 MB backup-safe document budget. Shorten it or delete an unneeded upload first.", "error", 7000);
        return false;
      }
      const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
      setProfile((current) => {
        const previous = current.customDocuments.find((doc) => doc.id === currentDocument.id)?.raw;
        return {
          ...current,
          customDocuments: current.customDocuments.map((doc) => doc.id === currentDocument.id ? { ...doc, raw, title: heading?.slice(0, 180) || doc.title, updatedAt: new Date().toISOString() } : doc),
          revisions: typeof previous === "string" && previous !== raw && previous.length <= 400_000
            ? appendRevision(current.revisions, revisionForDocument(currentDocument.id, previous, "before this save"))
            : current.revisions,
        };
      });
    } else {
      if (utf8Bytes(raw) > MAX_LECTURE_EDIT_BYTES) {
        notify("This edited lecture exceeds the 5 MB per-lecture limit. Shorten it before saving; your editor remains open and nothing was truncated.", "error", 7000);
        return false;
      }
      setProfile((current) => {
        const previous = current.edits[currentDocument.id];
        return {
          ...current,
          edits: { ...current.edits, [currentDocument.id]: raw },
          revisions: typeof previous === "string" && previous !== raw && previous.length <= 400_000
            ? appendRevision(current.revisions, revisionForDocument(currentDocument.id, previous, "before this save"))
            : current.revisions,
        };
      });
    }
    notify("Your edited copy was saved.");
    return true;
  };
  const resetEdit = (unsavedDraft) => {
    const keepDraft = typeof unsavedDraft === "string";
    setProfile((current) => {
      const edits = { ...current.edits };
      const previous = edits[currentDocument.id];
      delete edits[currentDocument.id];
      const now = Date.now();
      let revisions = current.revisions;
      if (typeof previous === "string" && previous.length <= 400_000) revisions = appendRevision(revisions, revisionForDocument(currentDocument.id, previous, "before restoring the original", new Date(now)));
      // Unsaved typing is banked too, one millisecond newer so it lists first.
      if (keepDraft && unsavedDraft !== previous && unsavedDraft.length <= 400_000) revisions = appendRevision(revisions, revisionForDocument(currentDocument.id, unsavedDraft, "unsaved draft before restoring the original", new Date(now + 1)));
      return { ...current, edits, revisions };
    });
    notify(keepDraft ? "The built-in lecture was restored. Your saved copy and unsaved draft are kept in History." : "The built-in lecture was restored. Your edited copy is kept as a revision.");
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

  const reconcileAnnotationOffsets = useCallback((updates) => {
    if (!Array.isArray(updates) || !updates.length) return;
    const byId = new Map(updates.map((update) => [update.id, update]));
    const nowIso = new Date().toISOString();
    setProfile((current) => ({
      ...current,
      annotations: current.annotations.map((annotation) => {
        const update = byId.get(annotation.id);
        if (!update || !Number.isSafeInteger(update.start) || !Number.isSafeInteger(update.end)) return annotation;
        return {
          ...annotation,
          start: update.start,
          end: update.end,
          prefix: typeof update.prefix === "string" ? update.prefix.slice(-160) : annotation.prefix,
          suffix: typeof update.suffix === "string" ? update.suffix.slice(0, 160) : annotation.suffix,
          updatedAt: nowIso,
        };
      }),
    }));
  }, []);

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
    const { accepted, rejectedCount: rejected, atCapacity, byteCapacityReached } = selection;
    event.target.value = "";
    if (atCapacity) {
      notify("The 500-document local limit has been reached. No existing note was replaced.", "error", 6000);
      return;
    }
    if (!accepted.length) {
      notify(byteCapacityReached ? "These files exceed the 16 MB backup-safe document budget. Delete an unneeded note or choose a smaller file." : "Choose Markdown, text, HTML, or EPUB files smaller than 2 MB.", "error", 6000);
      return;
    }
    try {
      const uploaded = [];
      const bookSummaries = [];
      const skipped = [];
      // HTML and EPUB converters are a warm tool; Markdown and text never
      // load them, so those uploads work offline from the first launch. When
      // the converters are not on this device yet, the Markdown and text files
      // in the same selection still import, and each HTML or EPUB file is
      // reported with the reason.
      const needsConverters = (file) => isEpubFileName(file.name) || isHtmlFileName(file.name);
      let converters = null;
      let converterFailure = null;
      if (accepted.some(needsConverters)) {
        try {
          converters = await loadImportConverters();
        } catch (error) {
          if (!isWarmToolUnavailable(error)) throw error;
          converterFailure = error;
        }
      }
      const { describeEpubReport, htmlToMarkdown, importEpub } = converters || {};
      for (const file of accepted) {
        const now = new Date().toISOString();
        if (converterFailure && needsConverters(file)) {
          skipped.push(`${file.name} was not imported — ${converterFailure.message}`);
          continue;
        }
        if (isEpubFileName(file.name)) {
          // An EPUB fans out to one document per chapter, in spine order,
          // with the lossy-import report surfaced in the notification.
          try {
            const book = await importEpub(await file.arrayBuffer());
            const single = book.chapters.length === 1;
            for (const chapter of book.chapters) {
              uploaded.push({ id: `custom/${createId()}.md`, title: (single ? book.bookTitle || chapter.title : `${book.bookTitle}: ${chapter.title}`).slice(0, 180), raw: chapter.markdown, createdAt: now, updatedAt: now, tags: ["epub"] });
            }
            bookSummaries.push(describeEpubReport(file.name, book));
          } catch (error) {
            bookSummaries.push(`${file.name} was not imported — ${error.message}`);
          }
          continue;
        }
        let raw = await file.text();
        let htmlTitle = "";
        if (isHtmlFileName(file.name)) {
          // HTML converts to study-friendly Markdown before dedupe, so the
          // duplicate check and every downstream feature see clean text.
          const converted = htmlToMarkdown(raw);
          raw = converted.markdown;
          htmlTitle = converted.title;
        }
        const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, "").trim();
        const filename = file.name.replace(/\.(md|markdown|txt|html?)$/i, "").replace(/[-_]/g, " ").trim();
        uploaded.push({ id: `custom/${createId()}.md`, title: (htmlTitle || heading || filename || "Untitled upload").slice(0, 180), raw, createdAt: now, updatedAt: now, tags: [] });
      }
      // Duplicate detection (CONTENT-001): identical content — whitespace and
      // case aside — is skipped instead of silently doubling the library.
      const fresh = [];
      let duplicateCount = 0;
      for (const doc of uploaded) {
        const existing = findDuplicateDocument([...profileRef.current.customDocuments, ...fresh], doc.raw);
        if (existing) {
          duplicateCount += 1;
          continue;
        }
        fresh.push(doc);
      }
      const duplicates = `${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`;
      const fileNotes = [...bookSummaries, ...skipped].join(" · ").replace(/\.$/u, "");
      if (!fresh.length) {
        notify(duplicateCount && skipped.length
          ? `Nothing was imported: ${duplicates}. ${skipped.join(" · ").replace(/\.$/u, "")}.`
          : fileNotes && !duplicateCount
            ? `Nothing was imported. ${fileNotes}.`
            : `Every selected file matches a document already in your notebook (${duplicates}). Nothing was imported.`, "warning", 6000);
        return;
      }
      // Post-conversion byte budget: EPUB and HTML text can outgrow the
      // compressed file the picker admitted, and the 16 MB envelope is an
      // aggregate promise to the backup format — enforce it on real bytes.
      let usedBytes = customDocumentBytes(profileRef.current.customDocuments);
      const budgeted = [];
      let droppedForBudget = 0;
      for (const doc of fresh) {
        const size = utf8Bytes(doc.raw);
        if (usedBytes + size > MAX_CUSTOM_DOCUMENT_BYTES) {
          droppedForBudget += 1;
          continue;
        }
        usedBytes += size;
        budgeted.push(doc);
      }
      if (!budgeted.length) {
        notify("These files exceed the 16 MB backup-safe document budget. Delete an unneeded note or choose a smaller file.", "error", 6000);
        return;
      }
      setProfile((current) => {
        const remaining = Math.max(0, 500 - current.customDocuments.length);
        const admitted = budgeted.slice(0, remaining);
        return {
          ...current,
          customDocuments: [...admitted, ...current.customDocuments],
          activity: recordActivityEntry(current.activity, { kind: "upload", label: admitted.length === 1 ? `Uploaded “${admitted[0].title}”` : `Uploaded ${admitted.length} documents`, refId: admitted[0]?.id || "" }),
        };
      });
      const cautions = rejected || duplicateCount || droppedForBudget || skipped.length;
      notify(`${budgeted.length} document${budgeted.length === 1 ? "" : "s"} imported${duplicateCount ? `; ${duplicates}` : ""}${droppedForBudget ? `; ${droppedForBudget} over the 16 MB budget` : ""}${rejected ? `; ${rejected} rejected (invalid, over a limit, or beyond the backup-safe byte budget)` : ""}. ${fileNotes ? `${fileNotes}. ` : ""}No existing notes were replaced.`, cautions ? "warning" : "success", cautions ? 6000 : undefined);
    } catch (error) {
      notify(warmToolFailureMessage(error, "Import failed: "), "error", 5000);
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
      activity: recordActivityEntry(current.activity, { kind: "create", label: `Created “${title}”`, refId: id }),
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
    if (!window.confirm(`Move “${doc?.title || "this note"}” to the trash? Its linked notes, highlights, and cards are deleted now; the document itself stays restorable for 30 days.`)) return;
    const applyDeletion = (current) => {
      const progress = { ...current.progress }; delete progress[id];
      const readingPositions = { ...current.readingPositions }; delete readingPositions[id];
      const personalNotes = { ...current.personalNotes }; delete personalNotes[id];
      const edits = { ...current.edits }; delete edits[id];
      const removedReviewIds = new Set(current.reviewItems.filter((item) => item.documentId === id).map((item) => item.id));
      const trashedRecord = current.customDocuments.find((item) => item.id === id);
      const trash = trashedRecord ? addTrashEntry(current.trash, trashEntryForDocument(trashedRecord)) : current.trash;
      const activity = recordActivityEntry(current.activity, { kind: "delete", label: `Moved “${trashedRecord?.title || doc?.title || "a document"}” to trash`, refId: id });
      return { ...current, trash, activity, progress, readingPositions, personalNotes, edits, customDocuments: current.customDocuments.filter((item) => item.id !== id), deletedCustomDocumentIds: [...new Set([...(current.deletedCustomDocumentIds || []), id])].slice(-1_000), bookmarks: current.bookmarks.filter((item) => item !== id), clippings: current.clippings.filter((clip) => clip.documentId !== id), annotations: current.annotations.filter((annotation) => annotation.documentId !== id), reviewItems: current.reviewItems.filter((item) => item.documentId !== id), reviewAttempts: current.reviewAttempts.filter((attempt) => !removedReviewIds.has(attempt.reviewItemId)), recent: current.recent.filter((item) => item !== id), lastDocumentId: current.lastDocumentId === id ? "" : current.lastDocumentId };
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
    notify(`The document moved to the trash (kept ${TRASH_RETENTION_DAYS} days; restorable from the Notebook). Its linked study data was deleted.`);
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
    setProfile((current) => ({ ...current, customDocuments: [duplicate, ...current.customDocuments], activity: recordActivityEntry(current.activity, { kind: "duplicate", label: `Duplicated “${sourceDocument.title}”`, refId: duplicate.id }) }));
    notify("Document duplicated.");
  };

  useEffect(() => {
    const onKey = (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.closest?.("select") || event.target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opt-in app-icon badge (PLAN-002): today's actionable due count, cleared
  // predictably when the queue drains or the toggle turns off. No
  // notifications, no permission prompts — setAppBadge is silent by design.
  useEffect(() => {
    if (!hydrated || typeof navigator.setAppBadge !== "function") return;
    try {
      const count = profile.settings.dueBadgeEnabled ? actionableDueCount(profile) : 0;
      if (count > 0) navigator.setAppBadge(count);
      else navigator.clearAppBadge?.();
    } catch { /* Badging is best-effort; never surface an error for it. */ }
  }, [hydrated, profile]);

  useEffect(() => {
    if (!hydrated) return;
    const purged = purgeExpiredTrash(profileRef.current.trash || []);
    if (purged.length !== (profileRef.current.trash || []).length) {
      setProfile((current) => ({ ...current, trash: purgeExpiredTrash(current.trash || []) }));
    }
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return undefined;
    // Settings and the Notebook left the startup bundle. Load them once the
    // first render is idle so that opening either shows it at once.
    const preload = () => { preloadSettings(); preloadNotebook(); };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 5_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 3_000);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  const restoreTrashEntry = (trashId) => {
    const entry = profileRef.current.trash.find((item) => item.id === trashId);
    if (!entry) { notify("That trash entry is no longer available.", "error"); return; }
    if (profileRef.current.customDocuments.length >= 500) { notify("The 500-document local limit has been reached. Delete an upload before restoring.", "error", 6000); return; }
    if (customDocumentBytes(profileRef.current.customDocuments) + utf8Bytes(entry.raw) > MAX_CUSTOM_DOCUMENT_BYTES) {
      notify("Restoring this document would exceed the 16 MB backup-safe document budget. Delete an unneeded upload first.", "error", 7000);
      return;
    }
    // The original id is tombstoned for cross-tab sync, so the restore mints
    // a fresh id; linked notes/cards were deleted with the original document.
    const restored = documentFromTrashEntry(entry);
    setProfile((current) => ({
      ...current,
      customDocuments: [restored, ...current.customDocuments],
      trash: current.trash.filter((item) => item.id !== trashId),
      activity: recordActivityEntry(current.activity, { kind: "restore", label: `Restored “${entry.title}” from trash`, refId: restored.id }),
    }));
    notify(`“${entry.title}” is back in your notebook.`);
  };

  const batchOrganizeDocuments = (selectedIds, changes) => {
    if (!selectedIds.length) return;
    setProfile((current) => {
      const { documents, touched } = applyBatchOrganize(current.customDocuments, selectedIds, changes);
      return {
        ...current,
        customDocuments: documents,
        activity: recordActivityEntry(current.activity, {
          kind: "organize",
          label: changes.archived !== undefined
            ? `${changes.archived ? "Archived" : "Unarchived"} ${touched} document${touched === 1 ? "" : "s"}`
            : `Moved ${touched} document${touched === 1 ? "" : "s"} to a collection`,
          refId: "",
        }),
      };
    });
    notify(`${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"} updated.`);
  };

  const batchDeleteDocuments = (selectedIds) => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Move ${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"} to the trash? Linked notes, highlights, and cards are deleted now; the documents stay restorable for 30 days.`)) return;
    setProfile((current) => {
      const { documents, trash, removedIds } = applyBatchDelete(current.customDocuments, current.trash, selectedIds);
      const removed = new Set(removedIds);
      const removedReviewIds = new Set(current.reviewItems.filter((item) => removed.has(item.documentId)).map((item) => item.id));
      const progress = { ...current.progress };
      const readingPositions = { ...current.readingPositions };
      const personalNotes = { ...current.personalNotes };
      const edits = { ...current.edits };
      for (const id of removedIds) { delete progress[id]; delete readingPositions[id]; delete personalNotes[id]; delete edits[id]; }
      return {
        ...current,
        customDocuments: documents,
        trash,
        progress,
        readingPositions,
        personalNotes,
        edits,
        deletedCustomDocumentIds: [...new Set([...(current.deletedCustomDocumentIds || []), ...removedIds])].slice(-1_000),
        bookmarks: current.bookmarks.filter((id) => !removed.has(id)),
        clippings: current.clippings.filter((clip) => !removed.has(clip.documentId)),
        annotations: current.annotations.filter((annotation) => !removed.has(annotation.documentId)),
        reviewItems: current.reviewItems.filter((item) => !removed.has(item.documentId)),
        reviewAttempts: current.reviewAttempts.filter((attempt) => !removedReviewIds.has(attempt.reviewItemId)),
        recent: current.recent.filter((id) => !removed.has(id)),
        activity: recordActivityEntry(current.activity, { kind: "delete", label: `Moved ${removedIds.length} documents to trash`, refId: "" }),
      };
    });
    notify(`${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"} moved to the trash.`);
  };

  // Resolves the report, or null when the link check could not load.
  const runLinkAudit = useCallback(async () => {
    let auditLearnerLinks;
    try {
      ({ auditLearnerLinks } = await loadLinkAudit());
    } catch (error) {
      notify(warmToolFailureMessage(error, "The link check could not start: "), "error", 6000);
      return null;
    }
    const current = profileRef.current;
    const knownIds = new Set([...documents.map((document) => document.id), ...current.customDocuments.map((document) => document.id)]);
    const { findings, scanned } = auditLearnerLinks({
      customDocuments: current.customDocuments,
      edits: current.edits,
      knownIds,
    });
    return { findings, scanned };
  }, [notify]);

  const manageCustomDocument = (id, changes) => {
    const existing = profileRef.current.customDocuments.find((doc) => doc.id === id);
    if (!existing) { notify("That document is no longer available.", "error"); return; }
    const now = new Date().toISOString();
    let collectionId = changes.collectionId;
    let newCollection = null;
    if (changes.newCollectionName) {
      const match = profileRef.current.collections.find((collection) => collection.name.toLocaleLowerCase() === changes.newCollectionName.toLocaleLowerCase());
      if (match) collectionId = match.id;
      else {
        newCollection = { id: `col-${createId()}`, name: changes.newCollectionName, createdAt: now, updatedAt: now };
        collectionId = newCollection.id;
      }
    }
    const renamed = changes.title !== existing.title;
    setProfile((current) => ({
      ...current,
      collections: newCollection ? [...current.collections, newCollection].slice(0, 100) : current.collections,
      customDocuments: current.customDocuments.map((doc) => doc.id === id
        ? { ...doc, title: changes.title, tags: changes.tags, collectionId, pinned: changes.pinned, archived: changes.archived, updatedAt: now }
        : doc),
      activity: renamed
        ? recordActivityEntry(current.activity, { kind: "rename", label: `Renamed “${existing.title}” to “${changes.title}”`, refId: id })
        : current.activity,
    }));
    setManageDocumentId("");
    notify(changes.archived && !existing.archived ? "Document archived. Find it under the Archived filter." : "Document organized.");
  };

  const deleteTrashEntry = (trashId) => {
    const entry = profileRef.current.trash.find((item) => item.id === trashId);
    if (!entry) return;
    if (!window.confirm(`Permanently delete “${entry.title}”? This cannot be undone.`)) return;
    setProfile((current) => ({ ...current, trash: current.trash.filter((item) => item.id !== trashId) }));
    notify("Deleted forever.");
  };


  // Deletion is immediate (and syncs as a normal removal); the notebook's
  // inline Undo strip calls restoreClipping with the same record (REV-11).
  const deleteClipping = (id) => {
    setProfile((current) => ({ ...current, clippings: current.clippings.filter((clip) => clip.id !== id) }));
  };

  const restoreClipping = (clip, index) => {
    setProfile((current) => ({ ...current, clippings: reinsertRecord(current.clippings, clip, index, 2_000) }));
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

  const annotationExportText = useCallback((annotation) => {
    const doc = allDocumentMap.get(annotation.documentId);
    return `> ${annotation.quote}${annotation.comment ? `\n\nMy note: ${annotation.comment}` : ""}${annotation.tags?.length ? `\nTags: ${annotation.tags.join(", ")}` : ""}\nPurpose: ${annotation.purpose}${doc ? `\nSource: ${doc.title}` : ""}`;
  }, [allDocumentMap]);

  const copyAnnotation = useCallback(async (annotation) => {
    try {
      await copyText(annotationExportText(annotation));
      notify("Highlight copied to the clipboard.");
    } catch {
      notify("The highlight could not be copied.", "error");
    }
  }, [annotationExportText, notify]);

  const exportAnnotations = useCallback((annotations) => {
    const items = Array.isArray(annotations) && annotations.length ? annotations : profileRef.current.annotations;
    if (!items.length) {
      notify("There are no highlights to export yet.", "error");
      return;
    }
    const body = items.map((annotation) => annotationExportText(annotation)).join("\n\n---\n\n");
    downloadText(
      `lumen-highlights-${new Date().toISOString().slice(0, 10)}.md`,
      `# Lumen highlights (${items.length})\n\nExported ${new Date().toISOString()}.\n\n${body}\n`,
      "text/markdown",
    );
    notify(`${items.length} highlight${items.length === 1 ? "" : "s"} exported as Markdown.`);
  }, [annotationExportText, notify]);

  // The card editor and readiness check load on demand, so they mount a render
  // after the background has gone inert and focus has left their opener. App
  // remembers the opener and returns focus to it when the dialog closes.
  const dialogOpenerRef = useRef(null);
  const rememberDialogOpener = () => {
    const active = document.activeElement;
    dialogOpenerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };
  useEffect(() => {
    if (reviewDraft || assessmentDraft || !dialogOpenerRef.current) return undefined;
    const target = dialogOpenerRef.current;
    dialogOpenerRef.current = null;
    let frame = requestAnimationFrame(() => {
      if (!target.isConnected) return;
      if (!target.closest("[inert]")) target.focus();
      else frame = requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    });
    return () => cancelAnimationFrame(frame);
  }, [assessmentDraft, reviewDraft]);

  const openReviewDraft = useCallback((sourceItem) => {
    rememberDialogOpener();
    if (!sourceItem) {
      setReviewDraft({ front: "", back: "", tags: [], documentId: "", sourceClippingId: "", sourceTitle: "" });
      return;
    }
    const source = allDocumentMap.get(sourceItem.documentId);
    const isAnnotation = typeof sourceItem.quote === "string";
    // A card made from a saved AI answer keeps its provenance (issue #81):
    // the ai-draft tag makes Review render it as untrusted text.
    const aiAuthored = !isAnnotation && isAiAuthoredClipping(sourceItem);
    const tags = source?.partNumber ? [`part-${source.partNumber}`] : [];
    setReviewDraft({
      front: (isAnnotation ? sourceItem.comment : sourceItem.note)?.trim() || `Explain this excerpt from “${source?.title || "your notes"}” in your own words.`,
      back: isAnnotation ? sourceItem.quote : sourceItem.text,
      tags: aiAuthored ? withAiDraftTag(tags) : tags,
      aiAuthored,
      documentId: sourceItem.documentId,
      sourceClippingId: isAnnotation ? "" : sourceItem.id,
      sourceAnnotationId: isAnnotation ? sourceItem.id : "",
      sourceTitle: source?.title || "",
    });
  }, [allDocumentMap]);

  const closeReviewDraft = useCallback(() => setReviewDraft(null), []);

  const editReviewCard = useCallback((item) => {
    rememberDialogOpener();
    const source = allDocumentMap.get(item.documentId);
    setReviewDraft({ ...item, aiAuthored: isAiAuthoredReviewItem(item, aiClippingIds(profileRef.current.clippings)), sourceTitle: source?.title || "" });
  }, [allDocumentMap]);

  const saveReviewCard = useCallback((draft) => {
    const fingerprint = `${draft.front.trim().toLocaleLowerCase()}\u0000${draft.back.trim().toLocaleLowerCase()}`;
    if (profile.reviewItems.some((item) => item.id !== draft.id && `${item.front.trim().toLocaleLowerCase()}\u0000${item.back.trim().toLocaleLowerCase()}` === fingerprint)) {
      notify("An identical prompt and answer already exist in your review deck.", "warning", 5000);
      return;
    }
    // AI provenance survives an edit: removing the tag in the dialog does not
    // make model text trusted (issue #81).
    const tagsFor = (item) => (draft.aiAuthored || isAiAuthoredReviewItem(item) ? withAiDraftTag(draft.tags) : draft.tags);
    if (draft.id) {
      setProfile((current) => ({
        ...current,
        reviewItems: current.reviewItems.map((item) => item.id === draft.id ? {
          ...item,
          type: draft.type,
          front: draft.front,
          back: draft.back,
          tags: tagsFor(item),
          updatedAt: new Date().toISOString(),
        } : item),
      }));
      setReviewDraft(null);
      notify("Review card updated without resetting its schedule.");
      return;
    }
    const item = createReviewItem({ ...draft, tags: tagsFor(null) });
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
    // Decide what is new from the latest committed profile, outside the state
    // updater: React may defer an updater, so counts assigned inside it could
    // still read 0 here and report a failure for cards that were saved.
    const fingerprintOf = (front, back) => `${front.trim().toLocaleLowerCase()}\u0000${back.trim().toLocaleLowerCase()}`;
    const seen = new Set(profileRef.current.reviewItems.map((item) => fingerprintOf(item.front, item.back)));
    const documentId = metadata.sourceIds?.find((id) => allDocumentMap.has(id)) || "";
    const fresh = [];
    candidates.forEach((card) => {
      const front = card.front.trim();
      const back = `${card.back.trim()}${card.hint?.trim() ? `\n\nHint: ${card.hint.trim()}` : ""}`;
      const fingerprint = fingerprintOf(front, back);
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      fresh.push({ front, back, tags: withAiDraftTag(card.tags) });
    });
    const skipped = candidates.length - fresh.length;
    const room = Math.max(0, 10_000 - profileRef.current.reviewItems.length);
    const created = fresh.slice(0, room).map((card) => createReviewItem({ type: "basic", ...card, documentId }));
    if (!created.length) {
      if (fresh.length) throw new Error("The review deck is full. Archive or delete cards before adding more.");
      return { added: 0, skipped };
    }
    setProfile((current) => {
      const existing = new Set(current.reviewItems.map((item) => fingerprintOf(item.front, item.back)));
      const unique = created.filter((item) => !existing.has(fingerprintOf(item.front, item.back)));
      if (!unique.length) return current;
      return { ...current, reviewItems: [...unique, ...current.reviewItems].slice(0, 10_000) };
    });
    notify(`${created.length} AI flashcard${created.length === 1 ? "" : "s"} added to review${skipped ? `; ${skipped} already in Review` : ""}.`);
    return { added: created.length, skipped };
  }, [allDocumentMap, notify]);

  // Tutor quiz and interview-practice misses (TFEAT-01/06) go to the
  // mistake notebook as ordinary records. What is new or merged is decided
  // from the committed profile before one atomic update. Drafts are recorded
  // a millisecond apart, last first, so the first (a confident miss) is
  // newest and stays first in the notebook after profile merges order
  // records by time.
  const saveTutorMistakes = useCallback(async (drafts = []) => {
    const prepared = (Array.isArray(drafts) ? drafts : []).map((draft) => ({
      prompt: draft?.prompt,
      expected: draft?.expected,
      response: draft?.response,
      category: draft?.category || "misconception",
      reviewItemId: draft?.reviewItemId || "",
      documentId: (Array.isArray(draft?.documentIds) ? draft.documentIds : []).find((id) => allDocumentMap.has(id)) || "",
      tags: draft?.tags,
    })).filter((draft) => typeof draft.prompt === "string" && draft.prompt.trim()).reverse();
    if (!prepared.length) throw new Error("There were no misses to save");
    const start = Date.now();
    const at = (index) => new Date(start + index);
    let preview = profileRef.current.mistakes || [];
    let added = 0;
    let merged = 0;
    prepared.forEach((draft, index) => {
      const result = recordMistake(preview, draft, at(index));
      preview = result.mistakes;
      if (result.merged) merged += 1;
      else if (result.mistake) added += 1;
    });
    setProfile((current) => ({ ...current, mistakes: prepared.reduce((mistakes, draft, index) => recordMistake(mistakes, draft, at(index)).mistakes, current.mistakes || []) }));
    return { added, merged };
  }, [allDocumentMap]);

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
      const result = gradeReviewItem(target, rating, now, elapsedMs, { ...metadata, sessionKind: usage.kind, sessionKey: usage.sessionKey, scheduler: current.reviewSettings.scheduler, requestRetention: current.reviewSettings.requestRetention, weights: current.reviewSettings.fsrsWeights });
      const next = {
        ...current,
        reviewItems: current.reviewItems.map((item) => item.id === id ? result.item : item),
        reviewAttempts: [...current.reviewAttempts, result.attempt].slice(-50_000),
        reviewSessions: usage.sessions,
      };
      if (rating === "again") {
        // A failed recall becomes (or reopens) a mistake-notebook entry;
        // repeats of the same card merge into one record (LEARN-005).
        next.mistakes = recordMistake(current.mistakes, {
          prompt: target.front,
          expected: target.back,
          category: categoryForReviewItem(target),
          documentId: target.documentId,
          reviewItemId: target.id,
          tags: target.tags,
        }, now).mistakes;
      }
      return next;
    });
  }, []);

  const editMistake = useCallback((id, patch) => {
    setProfile((current) => ({ ...current, mistakes: updateMistake(current.mistakes, id, patch) }));
  }, []);

  // The review center shows its own Undo strip for this deletion (REV-11).
  const deleteMistake = useCallback((id) => {
    setProfile((current) => ({ ...current, mistakes: (current.mistakes || []).filter((mistake) => mistake.id !== id) }));
  }, []);

  const restoreMistake = useCallback((mistake, index) => {
    setProfile((current) => ({ ...current, mistakes: reinsertRecord(current.mistakes || [], mistake, index) }));
  }, []);

  const askAiAboutSelection = useCallback((text) => {
    const excerpt = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2_000);
    if (!excerpt) return;
    // The tutor consumes the insert once (onInsertConsumed) and names the
    // lecture it came from; the composer itself announces the insertion.
    setAiInsert({ kind: "selection", text: excerpt, title: currentDocument.title, nonce: Date.now() });
    changeView("ai");
  }, [changeView, currentDocument.title]);
  // Other screens open the tutor with a prepared question (TFEAT-07). It is
  // applied once like an excerpt and never sent: the learner reviews it.
  const openTutorWith = useCallback(({ modeId, prompt, origin, label, documentId, retrievalQuery } = {}) => {
    const text = String(prompt || "").trim().slice(0, 5_700);
    if (!text) return;
    setAiInsert({ kind: "prompt", prompt: text, modeId: String(modeId || "explain"), origin: String(origin || ""), label: String(label || ""), documentId: String(documentId || ""), retrievalQuery: String(retrievalQuery || ""), nonce: Date.now() });
    changeView("ai");
  }, [changeView]);
  const consumeAiInsert = useCallback((nonce) => {
    setAiInsert((current) => current?.nonce === nonce ? null : current);
  }, []);

  const startAssessment = useCallback((partNumber) => {
    rememberDialogOpener();
    const built = buildAssessment({ partNumber }, { documents: allDocuments, profile: profileRef.current });
    if (!built.ok) {
      notify(built.reason, "warning", 7000);
      return;
    }
    setAssessmentDraft(built);
  }, [allDocuments, notify]);

  const finishAssessment = useCallback((answers) => {
    setAssessmentDraft((draft) => {
      if (!draft) return null;
      const score = scoreAssessment(draft.questions, answers);
      const recommendation = recommendationForAssessment(score.percent, draft.evidence);
      const record = createAssessmentRecord({
        partNumber: draft.evidence.partNumber,
        kind: draft.kind,
        questions: draft.questions,
        answers,
        percent: score.percent,
        recommendation,
        evidence: draft.evidence,
      });
      const drafts = assessmentMistakeDrafts(draft.questions, answers);
      setProfile((current) => {
        let mistakes = current.mistakes;
        for (const mistakeDraft of drafts) mistakes = recordMistake(mistakes, mistakeDraft).mistakes;
        return {
          ...current,
          assessments: [record, ...current.assessments].slice(0, MAX_ASSESSMENTS),
          mistakes,
          activity: recordActivityEntry(current.activity, { kind: "assessment", label: `Readiness check: ${draft.evidence.partTitle} — ${score.percent}%`, refId: record.id }),
        };
      });
      return draft;
    });
  }, []);

  const importCardsFile = useCallback(async (file) => {
    // Failures stay visible: every exit path reports what happened.
    try {
      if (file.size > 20 * 1024 * 1024) { notify("That card file is larger than 20 MB; split the deck and import it in parts.", "error", 6000); return; }
      const text = await file.text().catch(() => "");
      const parsed = parseCardInterchange(text);
      if (!parsed.ok) { notify(`Import failed: ${parsed.error}`, "error", 6000); return; }
      const { added, duplicates, overCapacity } = importReviewCards(profileRef.current.reviewItems, parsed.cards);
      if (!added.length) {
        notify(overCapacity ? "Your deck already holds 10,000 cards; archive or delete cards before importing more." : duplicates ? "Every card in that file is already in your deck; nothing was imported." : "No valid cards were found in that file.", overCapacity ? "error" : "warning", 6000);
        return;
      }
      setProfile((current) => ({
        ...current,
        reviewItems: [...added, ...current.reviewItems].slice(0, 10_000),
        activity: recordActivityEntry(current.activity, { kind: "import", label: `Imported ${added.length} review card${added.length === 1 ? "" : "s"}`, refId: "" }),
      }));
      notify(`${added.length} card${added.length === 1 ? "" : "s"} imported into the new queue${duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${overCapacity ? `; ${overCapacity} left out because the deck is full` : ""}${parsed.invalid ? `; ${parsed.invalid} invalid entr${parsed.invalid === 1 ? "y" : "ies"} ignored` : ""}.`, duplicates || overCapacity || parsed.invalid ? "warning" : "success", 6000);
    } catch (error) {
      notify(`Import failed: ${error?.message || "the file could not be read"}.`, "error", 6000);
    }
  }, [notify]);

  const logManualMistake = useCallback((draft) => {
    let merged = false;
    setProfile((current) => {
      const result = recordMistake(current.mistakes, draft);
      if (!result.mistake) return current;
      merged = result.merged;
      return { ...current, mistakes: result.mistakes };
    });
    notify(merged ? "That mistake already exists — its occurrence count went up instead." : "Mistake logged. Write the correction when you understand why.");
  }, [notify]);

  const scheduleCorrectiveReview = useCallback((mistake) => {
    let scheduled = false;
    setProfile((current) => {
      const nowIso = new Date().toISOString();
      const existing = current.reviewItems.find((item) => item.id === mistake.reviewItemId);
      if (existing) {
        scheduled = true;
        return {
          ...current,
          reviewItems: current.reviewItems.map((item) => item.id === existing.id
            ? { ...item, suspended: false, archived: false, buriedOnDay: "", dueAt: nowIso, updatedAt: nowIso }
            : item),
        };
      }
      if (current.reviewItems.length >= 10_000) return current;
      scheduled = true;
      const card = createReviewItem({
        front: mistake.prompt,
        back: `${mistake.expected}${mistake.correction ? `\n\nCorrection: ${mistake.correction}` : ""}`,
        documentId: mistake.documentId,
        tags: [...(mistake.tags || []), "mistake"],
        type: "basic",
      });
      return {
        ...current,
        reviewItems: [card, ...current.reviewItems],
        mistakes: (current.mistakes || []).map((entry) => entry.id === mistake.id ? { ...entry, reviewItemId: card.id, updatedAt: nowIso } : entry),
      };
    });
    notify(scheduled ? "Corrective review is due now." : "The review deck is full; archive cards before scheduling more.", scheduled ? "success" : "error");
  }, [notify]);

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
    const target = profileRef.current.reviewItems.find((item) => item.id === id);
    setProfile((current) => ({ ...current, reviewItems: current.reviewItems.map((item) => item.id === id ? { ...item, suspended: !item.suspended, updatedAt: new Date().toISOString() } : item) }));
    if (target) notify(target.suspended ? "Card resumed; it returns to the queue when due." : "Card paused; it stays out of the queue until resumed.");
  }, [notify]);

  const toggleReviewArchive = useCallback((id) => {
    const target = profileRef.current.reviewItems.find((item) => item.id === id);
    setProfile((current) => ({
      ...current,
      reviewItems: current.reviewItems.map((item) => item.id === id ? { ...item, archived: !item.archived, suspended: item.archived ? item.suspended : false, updatedAt: new Date().toISOString() } : item),
    }));
    if (target) notify(target.archived ? "Card restored to the active deck." : "Card archived. Find it under Archived.");
  }, [notify]);

  const deleteReviewItem = useCallback((id) => {
    if (!window.confirm("Delete this review card and its review history?")) return;
    setProfile((current) => ({ ...current, reviewItems: current.reviewItems.filter((item) => item.id !== id), reviewAttempts: current.reviewAttempts.filter((attempt) => attempt.reviewItemId !== id) }));
    notify("Review card deleted.");
  }, [notify]);

  // Per-learner FSRS calibration (issue #16): fit the 17 weights to this
  // learner's review history; accept only a measurable improvement.
  const calibrateScheduler = useCallback(async () => {
    try {
      const { optimizeFsrsWeights } = await import("./lib/fsrsOptimizer.js");
      const result = optimizeFsrsWeights(profileRef.current.reviewAttempts);
      if (!result.ok) {
        notify(result.reason, "warning", 9000);
        return;
      }
      const improvement = Math.round((1 - result.afterLogLoss / result.beforeLogLoss) * 100);
      setProfile((current) => ({ ...current, reviewSettings: { ...current.reviewSettings, fsrsWeights: result.weights } }));
      notify(`Scheduler calibrated from ${result.predictions} spaced reviews (${result.lapses} lapses): prediction error improved ${improvement}%. New cards and future grades use your personal weights; you can reset to the published defaults any time.`, "success", 10_000);
    } catch (error) {
      notify(`Calibration failed: ${error.message}`, "error", 6000);
    }
  }, [notify]);

  const updateReviewSettings = useCallback((patch) => {
    setProfile((current) => {
      const next = { ...current, reviewSettings: { ...current.reviewSettings, ...patch } };
      // Enabling FSRS runs the one-time seeding migration: faithful replay of
      // each card's complete attempt trail where available, the labeled SM-2
      // heuristic otherwise. Already-seeded cards and new cards are untouched,
      // so re-enabling later never rewrites state.
      if (patch.scheduler === "fsrs" && current.reviewSettings.scheduler !== "fsrs") {
        const migrated = migrateItemsToFsrs(current.reviewItems, current.reviewAttempts, { requestRetention: next.reviewSettings.requestRetention });
        next.reviewItems = migrated.items;
        if (migrated.fromHistory || migrated.fromSm2) {
          notify(`Adaptive scheduling enabled. ${migrated.fromHistory} card${migrated.fromHistory === 1 ? "" : "s"} calibrated from full review history, ${migrated.fromSm2} seeded from current intervals.`, "success", 7000);
        } else {
          notify("Adaptive scheduling enabled for new reviews.");
        }
      }
      return next;
    });
  }, [notify]);

  const exportBackup = async (password) => {
    try {
      const { createBackup, encryptBackupJson } = await loadBackupTools();
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
      if (password) {
        // Transport wrapper only: the plaintext is the exact canonical JSON
        // above, so preflight and integrity behave identically after decrypt.
        const { blobParts } = await encryptBackupJson(result.json, password, { exportedAt });
        downloadBlob(`lumen-notes-backup-${exportedAt.slice(0, 10)}.lumenc`, blobParts);
      } else {
        downloadText(`lumen-notes-backup-${exportedAt.slice(0, 10)}.json`, result.json);
      }

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
      notify(`Backup verified with ${result.envelope.integrity.algorithm}${password ? ", encrypted with AES-256-GCM," : ""} and downloaded.${result.warnings.length ? " Review the HTTPS warning before transfer." : ""}`, result.warnings.length ? "warning" : "success", result.warnings.length ? 7000 : 4500);
    } catch (error) {
      notify(warmToolFailureMessage(error, "Backup failed: "), "error", 5000);
    }
  };

  // --- Cross-device sync (SYNC-001, issue #14) -------------------------------
  const [syncVaultConfig, setSyncVaultConfig] = useState(() => readVaultConfig());
  const syncDeviceIdRef = useRef("");
  if (!syncDeviceIdRef.current) syncDeviceIdRef.current = getDeviceId();

  const createSyncVaultAction = useCallback(() => {
    const config = createVaultConfig();
    setSyncVaultConfig(config);
    notify("Sync vault created. Choose a strong passphrase, export your sync file, and share the vault folder between your devices.", "success", 7000);
  }, [notify]);

  const leaveSyncVaultAction = useCallback(async () => {
    if (!window.confirm("Leave this sync vault? Your local data stays; only the vault membership and sync baseline are removed.")) return;
    // Both live in the startup bundle (syncIdentity.js), so leaving needs no
    // warm tool and works offline from the first launch.
    clearVaultConfig();
    await clearSyncBaseline();
    setSyncVaultConfig(null);
    notify("Left the sync vault. Nothing in your notes or reviews changed.");
  }, [notify]);

  const exportSyncFile = async (passphrase) => {
    const config = readVaultConfig();
    if (!config) return;
    try {
      const { createBackup, encryptBackupJson } = await loadBackupTools();
      const exportedAt = new Date().toISOString();
      const deviceId = syncDeviceIdRef.current;
      const data = await getAllData();
      // Same read-only three-way snapshot discipline as backup export; the
      // durable writerId marks this device per the sync design.
      const snapshotMerge = mergeProfileVersions(profileBaseRef.current, profileRef.current, data.profile, { advanceRevision: false, writerId: deviceId, now: exportedAt });
      data.profile = snapshotMerge.profile;
      reportSyncConflicts(snapshotMerge.conflicts);
      const result = await createBackup(data, { exportedAt, secureContext: window.isSecureContext });
      const { blobParts } = await encryptBackupJson(result.json, passphrase, { exportedAt, vaultId: config.vaultId, deviceId });
      downloadBlob(syncFileNameFor(deviceId), blobParts);
      notify(`Sync file exported as ${syncFileNameFor(deviceId)}. Keep every device's file together in one shared vault folder.`, "success", 7000);
    } catch (error) {
      notify(warmToolFailureMessage(error, "Sync export failed: "), "error", 6000);
    }
  };

  const importSyncFiles = async (files, passphrase) => {
    if (!files?.length) return;
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      notify("Enter the vault passphrase (at least 8 characters) above, then import the sync files again.", "warning", 6000);
      return;
    }
    try {
      const { checkSyncHeader, decryptBackupFile, foldPeerSnapshots, loadSyncBaseline, preflightBackup, readEncryptedHeader, saveSyncBaseline } = await loadBackupTools();
      const now = new Date().toISOString();
      const deviceId = syncDeviceIdRef.current;
      let config = readVaultConfig();
      const skipped = [];
      const peers = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let header;
        try {
          ({ header } = readEncryptedHeader(bytes));
        } catch (error) {
          skipped.push(`${file.name}: ${error.message}`);
          continue;
        }
        if (!config && typeof header.vaultId === "string" && header.vaultId) {
          if (!window.confirm(`Join sync vault ${header.vaultId.slice(0, 8)}…? This device's data will merge with that vault.`)) {
            skipped.push(`${file.name}: join declined`);
            continue;
          }
          config = adoptVaultConfig(header.vaultId);
          setSyncVaultConfig(config);
        }
        const admission = checkSyncHeader(header, { vaultId: config?.vaultId || "", deviceId });
        if (!admission.ok) {
          skipped.push(`${file.name}: ${admission.message}`);
          continue;
        }
        let json;
        try {
          json = await decryptBackupFile(bytes.buffer, passphrase);
        } catch (error) {
          skipped.push(`${file.name}: ${error.message}`);
          continue;
        }
        const checked = await preflightBackup(json);
        peers.push({ deviceId: admission.deviceId, records: checked.data });
      }
      if (!peers.length) {
        notify(`No sync files were folded. ${skipped.join(" · ")}`, "warning", 9000);
        return;
      }
      const storedBaseline = await loadSyncBaseline();
      const baselineRecords = storedBaseline && storedBaseline.vaultId === config.vaultId ? storedBaseline.records : null;
      const data = await getAllData();
      const preMerge = mergeProfileVersions(profileBaseRef.current, profileRef.current, data.profile, { advanceRevision: false, writerId: deviceId, now });
      const localRecords = { ...data, profile: preMerge.profile };
      const folded = foldPeerSnapshots({ baselineRecords, localRecords, peers, writerId: deviceId, now });

      const localAtCommit = profileRef.current;
      let commitConflicts = [];
      const committedValue = await updateData("profile", (stored) => {
        const merged = mergeProfileVersions(localRecords.profile, folded.profile, stored, { writerId: deviceId, now });
        commitConflicts = merged.conflicts;
        return merged.profile;
      });
      const committed = normalizeProfile(committedValue);
      profileBaseRef.current = committed;
      signalProfileSyncRef.current(committed);
      if (profileRef.current === localAtCommit) {
        profileRef.current = committed;
        setProfile(committed);
      } else {
        const rebased = mergeProfileVersions(localAtCommit, profileRef.current, committed, { advanceRevision: false, writerId: deviceId });
        profileRef.current = rebased.profile;
        setProfile(rebased.profile);
        reportSyncConflicts(rebased.conflicts);
      }
      reportSyncConflicts([...folded.conflicts, ...commitConflicts]);

      for (const [key, board] of Object.entries(folded.boards)) {
        await updateData(key, (stored) => mergeBoardVersions(localRecords[key] ?? null, board, stored, { writerId: deviceId, now }).board);
      }
      // The fold result becomes the new vault baseline (design §5) so the
      // next import three-ways against what this vault last agreed on.
      await saveSyncBaseline({ vaultId: config.vaultId, records: { profile: folded.profile, ...folded.boards }, updatedAt: now });
      setSyncVaultConfig(recordVaultSync());
      const conflictCount = folded.conflicts.length + commitConflicts.length;
      notify(`Merged ${peers.length} peer file${peers.length === 1 ? "" : "s"}${conflictCount ? `; ${conflictCount} conflict${conflictCount === 1 ? "" : "s"} recorded` : ""}${folded.replacementApplied ? "; a reset/restore from another device was applied" : ""}${skipped.length ? `; skipped — ${skipped.join(" · ")}` : ""}. Export your sync file now so peers see this state.`, skipped.length || conflictCount ? "warning" : "success", 9000);
    } catch (error) {
      notify(warmToolFailureMessage(error, "Sync import failed: "), "error", 8000);
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const { isEncryptedBackupFile, preflightBackup } = await loadBackupTools();
      if (await isEncryptedBackupFile(file)) {
        setEncryptedImport({ file, fileName: file.name, error: "" });
        setSettingsOpen(false);
        return;
      }
      const checked = await preflightBackup(file);
      setBackupCandidate({ ...checked, fileName: file.name });
      setSettingsOpen(false);
    } catch (error) {
      notify(warmToolFailureMessage(error, "Could not import backup: "), "error", 6000);
    }
  };

  const unlockEncryptedImport = async (password) => {
    const pending = encryptedImport;
    if (!pending) return;
    try {
      // Loaded to reach this dialog; cached in memory for the decrypt.
      const { decryptBackupFile, preflightBackup } = await loadBackupTools();
      const json = await decryptBackupFile(pending.file, password);
      const checked = await preflightBackup(json);
      setEncryptedImport(null);
      setBackupCandidate({ ...checked, fileName: pending.fileName, encrypted: true });
    } catch (error) {
      if (error?.code === "WRONG_PASSWORD") {
        // Keep the stashed file and dialog so the learner can retry.
        setEncryptedImport({ ...pending, error: error.message });
        return;
      }
      setEncryptedImport(null);
      notify(warmToolFailureMessage(error, "Could not import the encrypted backup: "), "error", 7000);
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

      const { createRecoverySnapshot } = await loadBackupTools();
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
      notify(warmToolFailureMessage(error, "Restore failed before replacement completed: "), "error", 7000);
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

  const drawerDialog = compactNavigation && sidebarOpen;
  const personalNoteCount = Object.values(profile.personalNotes || {}).filter((note) => note.trim()).length;
  const hiddenBehindModal = appModalOpen ? "true" : undefined;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" inert={appModalOpen} onClick={(event) => { event.preventDefault(); focusMainContent(); }}>Skip to content</a>
      <div ref={sidebarRef} id="application-sidebar" className={sidebarOpen ? "app-sidebar open" : "app-sidebar"} role={drawerDialog ? "dialog" : undefined} aria-modal={drawerDialog ? "true" : undefined} aria-label={drawerDialog ? "Menu" : undefined} aria-hidden={sidebarHidden ? "true" : undefined} inert={sidebarHidden}>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">L</div><div><strong>Lumen</strong><span>AI Notes</span></div><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu" type="button"><X size={19} /></button></div>
          <div className="sidebar-primary">
            {VIEW_ITEMS.filter(({ id }) => id !== "ai" || aiFeaturesEnabled).map(({ id, label, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => changeView(id)} aria-current={view === id ? "page" : undefined} key={id} type="button"><Icon size={19} aria-hidden="true" /><span>{label}</span>{id === "notebook" && personalNoteCount > 0 && <small>{personalNoteCount}<span className="visually-hidden"> personal notes</span></small>}{id === "review" && reviewDueCount > 0 && <small>{Math.min(reviewDueCount, 999)}<span className="visually-hidden"> due</span></small>}</button>)}
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section-title"><span id="sidebar-curriculum-title">Curriculum</span><button onClick={() => changeView("library")} aria-label="Open library" type="button"><MoreVertical size={16} /></button></div>
          <div ref={sidebarPartsRef} className={sidebarPartsOverflow ? "sidebar-parts has-more" : "sidebar-parts"} role="group" aria-labelledby="sidebar-curriculum-title">
            {parts.map((part) => <button onClick={() => { setSelectedPart(String(part.number)); changeView("library"); }} key={part.number} type="button"><span>{String(part.number).padStart(2, "0")}</span><strong>{part.title.replace(/^Part \d+\s+[—-]\s+/, "")}</strong></button>)}
          </div>
          <button className="sidebar-settings" onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }} type="button"><Settings size={19} aria-hidden="true" /><span>Settings</span>{!online && <WifiOff className="connection-icon" size={15} aria-hidden="true" />}<span className={online ? "online-dot" : "offline-dot"} aria-hidden="true" /><span className="visually-hidden">{online ? " (online)" : " (offline)"}</span></button>
        </nav>
      </div>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" type="button" />}

      <div className="app-main">
        <header className="app-topbar" inert={appModalOpen} aria-hidden={hiddenBehindModal}>
          <button ref={menuButtonRef} className="icon-button menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-controls="application-sidebar" aria-expanded={sidebarOpen} type="button"><Menu size={21} /></button>
          <button className="mobile-brand" onClick={() => changeView("home")} aria-label="Lumen home" type="button"><span aria-hidden="true">L</span><strong>Lumen</strong></button>
          <button className="top-search" onClick={() => changeView("library", { focus: ".library-search input" })} type="button"><Search size={18} /><span>Search lectures, formulas, tools…</span><kbd>⌘ K</kbd></button>
          <div className="topbar-actions">
            <button className="icon-button topbar-shortcuts" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" type="button"><Keyboard size={20} /></button>
            <button className="icon-button" onClick={() => changeView("notebook")} aria-label="Open notebook" type="button"><BookMarked size={20} /></button>
            <button className="profile-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings" type="button"><CircleUserRound size={22} /></button>
          </div>
          <div className="offline-status" role="status">{!online && <><WifiOff size={15} aria-hidden="true" />Offline — reading and notes work; AI and web search are unavailable</>}</div>
        </header>

        {(!window.isSecureContext || pwaIssue) && <div className="secure-context-banner" role="status"><AlertTriangle size={17} /><div><strong>{window.isSecureContext ? "Offline mode needs attention" : "Limited LAN mode"}</strong><span>{pwaIssue || "Reading, editing, reviews, and local notes work here. Use an HTTPS address for iPhone installation, offline caching, secure clipboard, wake lock, persistent storage, and AI."}</span></div><button className="text-button" onClick={() => setSettingsOpen(true)} type="button">Details</button>{pwaIssue && window.isSecureContext && <button className="icon-button small" onClick={() => setPwaIssue("")} aria-label="Dismiss offline-mode notice" type="button"><X size={15} /></button>}</div>}

        <main id="main-content" className="view-container" inert={appModalOpen} aria-hidden={hiddenBehindModal} onBlur={releaseMainContent} onPointerDownCapture={releaseMainContent}>
          <ErrorBoundary inline resetKey={`${view}:${currentDocument.id}`} onHome={view === "home" ? undefined : () => changeView("home")}>
          {view === "home" && <Dashboard profile={profile} allDocuments={allDocuments} onOpen={openDocument} onLibrary={() => changeView("library")} onNotebook={() => changeView("notebook")} onReview={() => changeView("review")} onStartAssessment={startAssessment} onGoalsChange={(goals) => setProfile((current) => ({ ...current, goals: { ...current.goals, ...goals } }))} />}
          {view === "library" && <LibraryView profile={profile} query={query} setQuery={setQuery} selectedPart={selectedPart} setSelectedPart={setSelectedPart} allDocuments={allDocuments} customDocuments={customDocuments} onOpen={openDocument} onSettingsChange={updateSettings} />}
          {view === "reader" && (sourceLoadError ? <div className="empty-state"><AlertTriangle size={30} /><h2>Lecture could not be opened</h2><p>{sourceLoadError}</p><button className="button secondary" onClick={() => { setSourceLoadError(""); loadDocumentSource(currentDocument.id).then((source) => setBuiltInSources((current) => ({ ...current, [currentDocument.id]: source }))).catch((error) => setSourceLoadError(error.message)); }} type="button">Retry</button></div> : currentDocument.source === "builtin" && !currentOriginalSource ? <div className="view-loading" role="status">Loading lecture on demand…</div> : <Suspense fallback={<div className="view-loading" role="status">Opening lecture…</div>}><Reader document={currentDocument} source={currentSource} originalSource={currentOriginalSource} progress={documentProgress(profile, currentDocument.id)} position={profile.readingPositions[currentDocument.id] || 0} bookmarked={profile.bookmarks.includes(currentDocument.id)} personalNote={profile.personalNotes[currentDocument.id] || ""} annotations={profile.annotations.filter((annotation) => annotation.documentId === currentDocument.id)} isDark={isDark} settings={profile.settings} speech={speech} saveStatus={saveStatus} startEditing={editRequestId === currentDocument.id} navigationTarget={readerNavigationTarget} onNavigationHandled={() => setReaderNavigationTarget(null)} onEditingStarted={() => setEditRequestId("")} onDirtyChange={setEditorDirty} onOpenDocument={openDocument} onProgress={updateProgress} onSetProgress={setDocumentProgress} onToggleBookmark={toggleBookmark} onAddClipping={addClipping} onSaveAnnotation={saveAnnotation} onAnnotationsReconciled={reconcileAnnotationOffsets} onDeleteAnnotation={deleteAnnotation} onCreateReviewFromAnnotation={openReviewDraft} onPersonalNote={setPersonalNote} onSaveEdit={saveEdit} revisions={profile.revisions.filter((revision) => revision.documentId === currentDocument.id)} onResetEdit={resetEdit} onSettingsChange={updateSettings} previousDocument={allDocuments[currentIndex - 1]} nextDocument={allDocuments[currentIndex + 1]} autoNarrate={autoNarrateDocId === currentDocument.id} onAutoNarrateHandled={() => setAutoNarrateDocId("")} onOpenBoard={() => changeView("board")} onAskAi={profile.settings.aiFeaturesEnabled !== false ? askAiAboutSelection : undefined} onNotify={notify} /></Suspense>)}
          {view === "device-evidence" && <Suspense fallback={<div className="view-loading" role="status">Preparing device checks…</div>}><DeviceEvidence onNotify={notify} /></Suspense>}
          {view === "notebook" && <Suspense fallback={<div className="view-loading" role="status">Opening your notebook…</div>}><NotebookView profile={profile} allDocuments={allDocuments} customDocuments={customDocuments} onOpen={openDocument} onUpload={uploadNotes} onCreate={() => setCreateOpen(true)} onDeleteCustom={deleteCustom} onDuplicateCustom={duplicateCustom} onDeleteClipping={deleteClipping} onRestoreClipping={restoreClipping} onUpdateClipping={updateClipping} onCopyClipping={copyClipping} onCreateReview={openReviewDraft} onCopyAnnotation={copyAnnotation} onExportAnnotations={exportAnnotations} onDeleteAnnotation={deleteAnnotation} onRestoreTrash={restoreTrashEntry} onDeleteTrash={deleteTrashEntry} onManageCustom={setManageDocumentId} onOpenReview={() => changeView("review")} onBatchOrganize={batchOrganizeDocuments} onBatchDelete={batchDeleteDocuments} onRunLinkAudit={runLinkAudit} collections={profile.collections} /><LazyRouteHeading /></Suspense>}
          {view === "ai" && (!aiFeaturesEnabled
            ? <div className="page ai-page"><div className="empty-state ai-disabled-state"><BrainCircuit size={32} /><h2>AI features are turned off</h2><p>You chose to study without AI assistance. Reading, notes, reviews, narration, and whiteboards are unaffected. You can re-enable the AI learning studio at any time in Settings.</p><button className="button primary" onClick={() => setSettingsOpen(true)} type="button">Open settings</button></div></div>
            : <div className="page ai-page"><header className="page-title"><h1>AI learning studio</h1></header><Suspense fallback={<div className="view-loading" role="status">Opening the AI learning studio…</div>}><AiLearningStudio sources={aiSources} sourceCatalog={aiSourceCatalog} studyContext={aiStudyContext} speech={speech} loadSource={loadAiSource} retrieveLibrary={retrieveLibrarySources} initialHistory={aiHistoryRetention > 0 ? profile.aiTutorHistory || [] : []} historyTombstones={profile.aiTutorHistoryTombstones || []} onHistoryChange={aiHistoryRetention > 0 ? saveAiTutorHistory : undefined} phoneSessionHistory={phoneAiSessionHistory} onPhoneSessionHistoryChange={setPhoneAiSessionHistory} onNavigateSource={(target, metadata) => openDocument(target.documentId || target.id, { anchor: metadata?.anchor || target.anchor, section: target.section })} onCreateFlashcardDrafts={addAiFlashcards} onSaveMistakes={saveTutorMistakes} onSaveAnswerNote={saveAiAnswerNote} insertPrompt={aiInsert} onInsertConsumed={consumeAiInsert} onNotify={notify} /></Suspense></div>)}
          {view === "review" && <Suspense fallback={<div className="view-loading" role="status">Opening the review center…</div>}><ReviewCenter profile={profile} documents={allDocuments} onCreate={openReviewDraft} onEdit={editReviewCard} onGrade={gradeReview} onUndo={undoReviewGrade} onBury={buryReviewItem} onOpenSource={openDocument} onToggleSuspend={toggleReviewSuspend} onToggleArchive={toggleReviewArchive} onDelete={deleteReviewItem} onSettingsChange={updateReviewSettings} onCalibrate={calibrateScheduler} mistakes={profile.mistakes || []} onEditMistake={editMistake} onDeleteMistake={deleteMistake} onRestoreMistake={restoreMistake} onScheduleCorrective={scheduleCorrectiveReview} onLogMistake={logManualMistake} onImportCards={importCardsFile} onModalChange={trackComponentModal} onAskTutor={aiFeaturesEnabled ? openTutorWith : undefined} /></Suspense>}
          {view === "board" && <Suspense fallback={<div className="view-loading" role="status">Restoring whiteboard…</div>}><Whiteboard documentId={currentDocument.id} documentTitle={currentDocument.title} notify={notify} /></Suspense>}
          </ErrorBoundary>
        </main>

        <nav className="bottom-nav" aria-label="Mobile navigation" inert={appModalOpen} aria-hidden={hiddenBehindModal}>
          {BOTTOM_VIEW_ITEMS.filter(({ id }) => id !== "ai" || aiFeaturesEnabled).map(({ id, label, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => changeView(id)} aria-current={view === id ? "page" : undefined} key={id} type="button"><Icon size={20} aria-hidden="true" /><span>{label}</span></button>)}
        </nav>
      </div>

      {settingsOpen && <div className="settings-overlay" inert={installOpen || shortcutsOpen} aria-hidden={installOpen || shortcutsOpen ? "true" : undefined}><button className="modal-scrim" onClick={() => setSettingsOpen(false)} aria-label="Close settings" type="button" /><div ref={settingsDialogRef} className="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-drawer-header"><h1 id="settings-title">Settings</h1><button className="icon-button settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings" type="button"><X size={20} /></button></div><ErrorBoundary inline headingLevel={2} onHome={() => { setSettingsOpen(false); changeView("home"); }}><Suspense fallback={<div className="view-loading" role="status">Opening settings…</div>}><SettingsView settings={profile.settings} backupMeta={profile.backupMeta} aiHistoryCount={profile.aiTutorHistory?.length || 0} onClearAiHistory={clearAiTutorHistory} onSettingsChange={updateSettings} onResetSettings={resetSettings} onResetApp={resetApplication} onExport={exportBackup} onImport={importBackup} onInstall={() => setInstallOpen(true)} onShowShortcuts={() => setShortcutsOpen(true)} onNotify={notify} online={online} secureContext={window.isSecureContext} saveStatus={saveStatus} wakeLock={wakeLock} storagePersisted={storagePersisted} onRequestStorage={requestPersistentStorage} syncVault={syncVaultConfig} syncDeviceId={syncDeviceIdRef.current} onCreateSyncVault={createSyncVaultAction} onLeaveSyncVault={leaveSyncVaultAction} onSyncExport={exportSyncFile} onSyncImport={importSyncFiles} /></Suspense></ErrorBoundary></div></div>}
      {installOpen && <InstallSheet secureContext={window.isSecureContext} onClose={() => setInstallOpen(false)} />}
      <BackupImportDialog candidate={backupCandidate} busy={backupBusy} onClose={() => { if (!backupBusy) setBackupCandidate(null); }} onConfirm={confirmBackupImport} />
      <CreateNoteDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createNote} />
      <ManageDocumentDialog doc={manageDocument} collections={profile.collections} onClose={() => setManageDocumentId("")} onSave={manageCustomDocument} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <EncryptedImportDialog pending={encryptedImport} onSubmit={unlockEncryptedImport} onCancel={() => setEncryptedImport(null)} />
      {assessmentDraft && <Suspense fallback={null}><AssessmentDialog assessment={assessmentDraft} onFinish={finishAssessment} onClose={() => setAssessmentDraft(null)} onOpenSource={(documentId) => { setAssessmentDraft(null); openDocument(documentId); }} onAskTutor={aiFeaturesEnabled ? (request) => { setAssessmentDraft(null); openTutorWith(request); } : undefined} /></Suspense>}
      {reviewDraft && <Suspense fallback={null}><ReviewCardDialog draft={reviewDraft} onClose={closeReviewDraft} onSave={saveReviewCard} /></Suspense>}
      {updateRegistration && <div className="update-banner" role="status" inert={appModalOpen} aria-hidden={hiddenBehindModal}><Sparkles size={18} /><span>A new Lumen version is ready.</span><button className="button primary" onClick={applyUpdate} type="button">Update now</button><button className="icon-button small" onClick={() => setUpdateRegistration(null)} aria-label="Dismiss update" type="button"><X size={16} /></button></div>}
      <Toast toast={toast} onClose={dismissToast} />
      <ToastAnnouncer toast={toast} />
    </div>
  );
}
