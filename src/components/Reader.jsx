import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Copy,
  Highlighter,
  ListTree,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  FileDown,
  History,
  RotateCcw,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  SkipBack,
  SkipForward,
  Volume2,
  Trash2,
  X,
} from "lucide-react";
import { plainTextFromMarkdown, resolveDocumentLink } from "../lib/content";
import { renderMarkdown, slugifyHeading } from "../lib/markdown";
import { diffLines, diffSummary } from "../lib/diff.js";
import { documentToStandaloneHtml } from "../lib/exportHtml.js";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import { applyAnnotationHighlights, captureTextAnchor, resolveTextAnchor } from "../lib/annotations";
import { copyText } from "../lib/clipboard.js";
import { buildSpeechTarget } from "../lib/speechContent.js";
import AnnotationDialog from "./AnnotationDialog";
import NarrationPanel from "./NarrationPanel";
import TeachingMode from "./TeachingMode";

export default function Reader({
  document,
  source,
  originalSource,
  progress,
  position,
  bookmarked,
  personalNote,
  annotations = [],
  isDark,
  settings,
  speech,
  saveStatus,
  startEditing,
  navigationTarget,
  onNavigationHandled,
  onEditingStarted,
  onDirtyChange,
  onOpenDocument,
  onProgress,
  onSetProgress,
  onToggleBookmark,
  onAddClipping,
  onSaveAnnotation,
  onDeleteAnnotation,
  onCreateReviewFromAnnotation,
  onPersonalNote,
  onSaveEdit,
  revisions = [],
  onAnnotationsReconciled,
  onResetEdit,
  onSettingsChange,
  previousDocument,
  nextDocument,
  onOpenBoard,
  onNotify,
}) {
  const scrollRef = useRef(null);
  const articleRef = useRef(null);
  const personalNoteRef = useRef(null);
  const pendingNoteFocusRef = useRef(false);
  const pendingAnchorReconcileRef = useRef(null);
  const actionsDialogRef = useRef(null);
  const progressTimer = useRef(null);
  const selectionClearTimer = useRef(null);
  const maximumRef = useRef(progress || 0);
  const [outline, setOutline] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [showSpeech, setShowSpeech] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findState, setFindState] = useState({ index: -1, total: 0 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const [previewEdit, setPreviewEdit] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [speechSelection, setSpeechSelection] = useState("");
  const [selectedAnchor, setSelectedAnchor] = useState(null);
  const [annotationDraft, setAnnotationDraft] = useState(null);
  const [annotationResolution, setAnnotationResolution] = useState({});
  const [highlightSupported, setHighlightSupported] = useState(true);
  const [scrollPosition, setScrollPosition] = useState(position || 0);

  const html = useMemo(() => renderMarkdown(editing && previewEdit ? draft : source), [draft, editing, previewEdit, source]);
  const htmlMarkup = useMemo(() => ({ __html: html }), [html]);
  useMermaidDiagrams(articleRef, {
    contentKey: `${html}\u0000${isDark ? "dark" : "light"}`,
    enabled: !(editing && !previewEdit),
  });

  useEffect(() => {
    setDraft(source);
    setEditing(Boolean(startEditing));
    setPreviewEdit(false);
    setDrawer(null);
    setShowSpeech(false);
    setShowDisplay(false);
    setShowActions(false);
    setShowFind(false);
    setFindQuery("");
    setSelectedText("");
    setSpeechSelection("");
    setSelectedAnchor(null);
    setAnnotationDraft(null);
    setScrollPosition(position || 0);
    maximumRef.current = progress || 0;
    if (startEditing) onEditingStarted?.();
    speech.stop();
  }, [document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const editorDirty = editing && draft !== source;

  useEffect(() => {
    onDirtyChange?.(editorDirty);
    return () => onDirtyChange?.(false);
  }, [editorDirty, onDirtyChange]);

  useEffect(() => {
    const warn = (event) => {
      if (!editorDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDirty]);

  useEffect(() => {
    const captureSelection = () => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const text = selection?.toString().replace(/\s+/g, " ").trim() || "";
      if (!range || !text || !articleRef.current?.contains(range.commonAncestorContainer)) {
        clearTimeout(selectionClearTimer.current);
        // A toolbar tap may collapse Safari's native selection immediately
        // before the click handler consumes it. The short grace window keeps
        // that action reliable while still removing genuinely stale state.
        selectionClearTimer.current = setTimeout(() => {
          const latest = window.getSelection();
          if (!latest?.toString().trim()) {
            setSelectedText("");
            setSelectedAnchor(null);
          }
        }, 350);
        return;
      }
      const anchor = captureTextAnchor(articleRef.current, range, source);
      if (!anchor) return;
      clearTimeout(selectionClearTimer.current);
      setSelectedText(text.slice(0, 4_000));
      setSelectedAnchor(anchor);
    };
    window.document.addEventListener("selectionchange", captureSelection);
    return () => {
      clearTimeout(selectionClearTimer.current);
      window.document.removeEventListener("selectionchange", captureSelection);
    };
  }, [document.id, source]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || (editing && !previewEdit)) return undefined;

    const headings = Array.from(article.querySelectorAll("h2, h3"));
    const seen = new Map();
    const items = headings.map((heading, index) => {
      const base = slugifyHeading(heading.textContent, index);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const id = count ? `${base}-${count + 1}` : base;
      heading.id = id;
      return { id, title: heading.textContent, level: Number(heading.tagName.slice(1)) };
    });
    setOutline(items);

    const handleLink = (event) => {
      const copyButton = event.target.closest(".code-copy");
      if (copyButton) {
        const code = copyButton.closest(".code-shell")?.querySelector("code")?.innerText || "";
        const copyCode = async () => {
          await copyText(code);
        };
        copyCode()
          .then(() => {
            copyButton.textContent = "Copied";
            onNotify?.("Code copied to the clipboard.");
            setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = "Copy"; }, 1_500);
          })
          .catch(() => onNotify?.("The code could not be copied.", "error"));
        return;
      }
      const anchor = event.target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const targetId = resolveDocumentLink(document.path, href);
      if (targetId) {
        event.preventDefault();
        onOpenDocument(targetId);
      }
    };
    article.addEventListener("click", handleLink);

    return () => {
      article.removeEventListener("click", handleLink);
    };
  }, [document.path, editing, html, onNotify, onOpenDocument, previewEdit]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.documentId !== document.id || (editing && !previewEdit)) return undefined;
    const frame = requestAnimationFrame(() => {
      const article = articleRef.current;
      if (!article) return;
      const anchor = String(navigationTarget.anchor || "").replace(/^#/, "");
      const section = String(navigationTarget.section || "").trim();
      // AI retrieval cites per-lecture personal notes with this dedicated
      // anchor. It must open and focus the exact note editor, not fall
      // through to a same-slug heading search.
      if (anchor === "personal-note" || (!anchor && section.toLocaleLowerCase() === "personal note")) {
        pendingNoteFocusRef.current = true;
        setDrawer("notes");
        onNavigationHandled?.();
        return;
      }
      const headings = [...article.querySelectorAll("h1, h2, h3, h4")];
      const destination = headings.find((heading) => heading.id === anchor)
        || (section ? headings.find((heading) => heading.id === slugifyHeading(section) || heading.textContent.trim().toLocaleLowerCase() === section.toLocaleLowerCase()) : null);
      destination?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (destination) {
        destination.setAttribute("tabindex", "-1");
        destination.focus({ preventScroll: true });
      }
      onNavigationHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [document.id, editing, html, navigationTarget, onNavigationHandled, previewEdit]);

  useEffect(() => {
    // The note editor mounts only while the Notes drawer is open, so a
    // citation-driven focus request must wait for that render to commit.
    if (drawer !== "notes" || !pendingNoteFocusRef.current) return undefined;
    pendingNoteFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      const field = personalNoteRef.current;
      if (!field) return;
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [drawer]);

  useEffect(() => {
    if (editing && !previewEdit) return undefined;
    let applied;
    const frame = requestAnimationFrame(() => {
      if (!articleRef.current) return;
      applied = applyAnnotationHighlights(articleRef.current, annotations);
      setHighlightSupported(applied.supported);
      setAnnotationResolution(Object.fromEntries([...applied.resolved].map(([id, result]) => [id, result.status])));
      if (pendingAnchorReconcileRef.current && pendingAnchorReconcileRef.current === source) {
        pendingAnchorReconcileRef.current = null;
        const updates = [...applied.resolved]
          .filter(([, result]) => result.status === "relocated")
          .map(([id, result]) => ({ id, start: result.start, end: result.end, prefix: result.prefix, suffix: result.suffix }));
        if (updates.length) onAnnotationsReconciled?.(updates);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      applied?.clear();
    };
  }, [annotations, editing, html, previewEdit]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return undefined;
    const clear = () => article.querySelectorAll(".reader-find-hit").forEach((node) => node.classList.remove("reader-find-hit"));
    clear();
    const query = findQuery.trim().toLocaleLowerCase();
    if (!showFind || !query) {
      setFindState({ index: -1, total: 0 });
      return clear;
    }
    const matches = [...article.querySelectorAll("h1, h2, h3, h4, p, li, td, th, pre, blockquote")]
      .filter((node) => node.innerText.toLocaleLowerCase().includes(query))
      .filter((node) => !node.parentElement?.closest("p, li, td, th, pre, blockquote"));
    if (matches.length) {
      matches[0].classList.add("reader-find-hit");
      matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setFindState({ index: matches.length ? 0 : -1, total: matches.length });
    return clear;
  }, [findQuery, html, showFind]);

  useEffect(() => {
    if (!showActions) return undefined;
    const dialog = actionsDialogRef.current;
    const previouslyFocused = window.document.activeElement;
    const background = [...window.document.querySelectorAll(".app-sidebar, .app-topbar, .bottom-nav, .reader-view > :not(.reader-action-menu):not(.reader-action-scrim)")];
    background.forEach((region) => {
      region.inert = true;
      region.setAttribute("aria-hidden", "true");
    });
    requestAnimationFrame(() => dialog?.querySelector("button")?.focus());
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowActions(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog?.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      background.forEach((region) => {
        region.inert = false;
        region.removeAttribute("aria-hidden");
      });
      previouslyFocused?.focus?.();
    };
  }, [showActions]);

  useEffect(() => {
    if (!showFind && !showSpeech && !showDisplay) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setShowFind(false);
      setFindQuery("");
      setShowSpeech(false);
      setShowDisplay(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showDisplay, showFind, showSpeech]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      const max = container.scrollHeight - container.clientHeight;
      container.scrollTop = max > 0 ? max * Math.min(position || 0, 0.99) : 0;
    });
  }, [document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const max = container.scrollHeight - container.clientHeight;
    const value = max <= 0 ? 1 : Math.max(0, Math.min(1, container.scrollTop / max));
    setScrollPosition(value);
    maximumRef.current = Math.max(maximumRef.current, value);
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => onProgress({ position: value, maximum: maximumRef.current }), 160);
  };

  const scrollToHeading = (id) => {
    const heading = articleRef.current?.querySelector(`#${CSS.escape(id)}`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (window.innerWidth < 1000) setDrawer(null);
  };

  const moveFind = (direction) => {
    const query = findQuery.trim().toLocaleLowerCase();
    const matches = [...(articleRef.current?.querySelectorAll("h1, h2, h3, h4, p, li, td, th, pre, blockquote") || [])]
      .filter((node) => node.innerText.toLocaleLowerCase().includes(query))
      .filter((node) => !node.parentElement?.closest("p, li, td, th, pre, blockquote"));
    if (!matches.length) return;
    matches.forEach((node) => node.classList.remove("reader-find-hit"));
    const next = (findState.index + direction + matches.length) % matches.length;
    matches[next].classList.add("reader-find-hit");
    matches[next].scrollIntoView({ behavior: "smooth", block: "center" });
    setFindState({ index: next, total: matches.length });
  };

  const speechTarget = () => buildSpeechTarget({
    scope: settings.speechScope,
    selectedText: selectedText || speechSelection,
    article: articleRef.current,
    scrollContainer: scrollRef.current,
    sourceText: plainTextFromMarkdown(source),
    language: settings.speechLanguage,
  });

  const readSpeechTarget = () => {
    const target = speechTarget();
    if (!target.available) {
      onNotify?.(target.reason, "error");
      return;
    }
    if (speech.speak(target.text, { label: target.label })) {
      // Move immediately to the compact player so the mobile settings sheet
      // does not cover the lecture or intercept its playback controls.
      setShowSpeech(false);
    }
  };

  const share = async () => {
    const payload = { title: document.title, text: `${document.title} — Lumen AI Notes`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(payload);
      else {
        await copyText(`${document.title}\n${window.location.href}`);
        onNotify?.("Lecture link copied to the clipboard.");
      }
    } catch (shareError) {
      if (shareError?.name !== "AbortError") onNotify?.("The lecture could not be shared.", "error");
    }
  };

  const saveEdit = () => {
    if (onSaveEdit(draft) === false) return;
    // A saved edit is the explicit reconcile point where confidently
    // relocated anchors persist their new offsets (LEARN-001). Keyed to the
    // saved text so the reconcile waits for that source to propagate down
    // instead of firing against the pre-save render.
    pendingAnchorReconcileRef.current = draft;
    setEditing(false);
    setPreviewEdit(false);
  };

  const closeEditor = () => {
    if (editorDirty && !window.confirm("Discard the unsaved editor changes?")) return;
    setDraft(source);
    setPreviewEdit(false);
    setEditing(false);
  };

  const clipSelection = () => {
    if (onAddClipping({ text: selectedText, anchor: selectedAnchor })) {
      window.getSelection()?.removeAllRanges();
      setSelectedText("");
      setSelectedAnchor(null);
    }
  };

  const openNewAnnotation = () => {
    if (!selectedAnchor) {
      onNotify?.("Select text in the lecture before highlighting it.", "error");
      return;
    }
    setAnnotationDraft({ ...selectedAnchor, documentId: document.id, color: "gold", purpose: "important", comment: "", tags: [] });
  };

  const saveAnnotation = (draft) => {
    onSaveAnnotation?.(draft);
    setAnnotationDraft(null);
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setSelectedAnchor(null);
  };

  const openStoredAnnotation = (annotation) => {
    const result = resolveTextAnchor(articleRef.current, annotation);
    const element = result.range?.startContainer?.parentElement;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (result.range) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(result.range);
      setTimeout(() => selection.removeAllRanges(), 1_200);
    }
    if (window.innerWidth < 1000) setDrawer(null);
  };

  const relinkAnnotation = (annotation) => {
    if (!selectedAnchor) {
      onNotify?.("Select the matching passage first, then choose Relink.", "error");
      return;
    }
    onSaveAnnotation?.({ ...annotation, ...selectedAnchor });
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setSelectedAnchor(null);
  };

  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const exportHtml = () => {
    const fileHtml = documentToStandaloneHtml({
      title: document.title,
      renderedHtml: renderMarkdown(source),
      sourceLabel: document.source === "custom" ? "personal upload" : document.partTitle || "",
    });
    const blob = new Blob([fileHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "lumen-note"}.html`;
    window.document.body.appendChild(link);
    link.click();
    onNotify?.("Printable HTML export prepared.");
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
  };
  const exportMarkdown = () => {
    const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "lumen-note"}.md`;
    window.document.body.appendChild(link);
    link.click();
    onNotify?.("Markdown export prepared.");
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1_000);
  };

  const copyLink = async () => {
    try {
      await copyText(window.location.href);
      onNotify?.("Lecture link copied to the clipboard.");
    } catch {
      onNotify?.("The lecture link could not be copied.", "error");
    }
  };

  const openFind = () => {
    setShowFind(true);
    setShowActions(false);
    requestAnimationFrame(() => window.document.querySelector(".reader-find input")?.focus());
  };

  const hasEdit = source !== originalSource;
  const complete = progress >= 0.96;

  return (
    <section className="reader-view">
      <div className="reading-progress" aria-hidden="true"><span style={{ width: `${Math.round((scrollPosition || 0) * 100)}%` }} /></div>
      <header className="reader-toolbar">
        <div className="reader-crumb">
          <span>{document.partTitle}</span>
          <strong>{Math.round((scrollPosition || 0) * 100)}%</strong>
        </div>
        <div className="reader-actions">
          <button className="icon-button" onClick={() => setDrawer(drawer === "outline" ? null : "outline")} aria-label="Table of contents" type="button"><ListTree size={20} /></button>
          <button className="icon-button" onClick={() => setDrawer(drawer === "notes" ? null : "notes")} aria-label="Personal notes" type="button"><NotebookPen size={20} /></button>
          <button className={showSpeech ? "icon-button active" : "icon-button"} onClick={() => { setShowSpeech((value) => { const next = !value; if (next) setSpeechSelection(selectedText); return next; }); setShowDisplay(false); setShowActions(false); }} aria-label="Listen" type="button"><Volume2 size={20} /></button>
          <button className={bookmarked ? "icon-button active" : "icon-button"} onClick={onToggleBookmark} aria-label={bookmarked ? "Remove bookmark" : "Bookmark"} type="button">
            {bookmarked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
          </button>
          <button className="icon-button desktop-action" onClick={share} aria-label="Share" type="button"><Share2 size={19} /></button>
          <button className={showDisplay ? "icon-button active" : "icon-button"} onClick={() => { setShowDisplay((value) => !value); setShowSpeech(false); setShowActions(false); }} aria-label="Reading appearance" type="button"><SlidersHorizontal size={20} /></button>
        </div>
      </header>

      {showSpeech && <NarrationPanel settings={settings} speech={speech} hasSelection={Boolean(selectedText || speechSelection)} target={speechTarget()} onSettingsChange={onSettingsChange} onRead={readSpeechTarget} onClose={() => setShowSpeech(false)} />}

      {showDisplay && (
        <div className="reader-popover display-popover">
          <div className="popover-heading"><strong>Reading appearance</strong><button className="icon-button small" onClick={() => setShowDisplay(false)} aria-label="Close appearance" type="button"><X size={17} /></button></div>
          <label><span>Text size {Math.round(settings.fontScale * 100)}%</span><input type="range" min="0.85" max="1.35" step="0.05" value={settings.fontScale} onChange={(event) => onSettingsChange({ fontScale: Number(event.target.value) })} /></label>
          <label><span>Line spacing</span><input type="range" min="1.45" max="2" step="0.05" value={settings.lineHeight} onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })} /></label>
          <div className="segmented">
            {["focused", "comfortable", "wide"].map((width) => <button className={settings.contentWidth === width ? "active" : ""} onClick={() => onSettingsChange({ contentWidth: width })} key={width} type="button">{width}</button>)}
          </div>
        </div>
      )}

      {showFind && <div className="reader-find" role="search"><Search size={18} /><input value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); moveFind(event.shiftKey ? -1 : 1); } }} placeholder="Find in this lecture…" aria-label="Find in this lecture" /><span>{findState.total ? `${findState.index + 1}/${findState.total}` : findQuery ? "0" : ""}</span><button className="icon-button small" onClick={() => moveFind(-1)} disabled={!findState.total} aria-label="Previous match" type="button"><ChevronLeft size={17} /></button><button className="icon-button small" onClick={() => moveFind(1)} disabled={!findState.total} aria-label="Next match" type="button"><ChevronRight size={17} /></button><button className="icon-button small" onClick={() => { setShowFind(false); setFindQuery(""); }} aria-label="Close find" type="button"><X size={17} /></button></div>}

      {showActions && <><button className="reader-action-scrim" onClick={() => setShowActions(false)} aria-label="Close lecture actions" type="button" /><div ref={actionsDialogRef} className="reader-action-menu" role="dialog" aria-modal="true" aria-label="Lecture actions"><div className="popover-heading"><div><span className="eyebrow">Lecture actions</span><strong>Study and file tools</strong></div><button className="icon-button small" onClick={() => setShowActions(false)} aria-label="Close lecture actions" type="button"><X size={17} /></button></div><div className="reader-action-grid"><button onClick={openFind} type="button"><Search size={18} /><span><strong>Find in lecture</strong><small>Jump between matches</small></span></button><button onClick={() => { share(); setShowActions(false); }} type="button"><Share2 size={18} /><span><strong>Share</strong><small>Use the iPhone share sheet</small></span></button><button onClick={() => { copyLink(); setShowActions(false); }} type="button"><Copy size={18} /><span><strong>Copy link</strong><small>Copy this exact lecture</small></span></button><button onClick={() => { exportMarkdown(); setShowActions(false); }} type="button"><Download size={18} /><span><strong>Export Markdown</strong><small>Download the current copy</small></span></button><button onClick={() => { exportHtml(); setShowActions(false); }} type="button"><FileDown size={18} /><span><strong>Export HTML</strong><small>Self-contained printable page</small></span></button><button onClick={() => { onSetProgress(complete ? 0 : 1); setShowActions(false); }} type="button">{complete ? <RotateCcw size={18} /> : <CheckCircle2 size={18} />}<span><strong>{complete ? "Reset progress" : "Mark complete"}</strong><small>{complete ? "Start this lecture again" : "Set progress to 100%"}</small></span></button><button onClick={() => { scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); setShowActions(false); }} type="button"><ArrowUp size={18} /><span><strong>Back to top</strong><small>Return to the title</small></span></button></div></div></>}
      {historyOpen && (() => {
        const selected = revisions.find((entry) => entry.id === selectedRevisionId) || revisions[0];
        const rows = selected ? diffLines(selected.text, draft ?? source) : [];
        const summary = diffSummary(rows);
        return <><button className="reader-action-scrim" onClick={() => setHistoryOpen(false)} aria-label="Close revision history" type="button" /><div className="reader-action-menu revision-dialog" role="dialog" aria-modal="true" aria-label="Revision history">
          <div className="popover-heading"><div><span className="eyebrow">Last {revisions.length} saved {revisions.length === 1 ? "state" : "states"}</span><strong>Revision history</strong></div><button className="icon-button small" onClick={() => setHistoryOpen(false)} aria-label="Close revision history" type="button"><X size={17} /></button></div>
          <div className="revision-list" role="radiogroup" aria-label="Choose a revision">
            {revisions.map((entry) => <button key={entry.id} role="radio" aria-checked={selected?.id === entry.id} className={selected?.id === entry.id ? "active" : ""} onClick={() => setSelectedRevisionId(entry.id)} type="button"><strong>{new Date(entry.savedAt).toLocaleString()}</strong><span>{entry.label || "saved state"} · {entry.text.length.toLocaleString()} chars</span></button>)}
          </div>
          {selected && <>
            <p className="revision-summary">Against the current text: <strong>{summary.added}</strong> line{summary.added === 1 ? "" : "s"} would be removed again, <strong>{summary.removed}</strong> restored.</p>
            <div className="revision-diff" aria-label="Line differences, revision versus current">
              {rows.filter((row, index) => row.kind !== "same" || (rows[index - 1] && rows[index - 1].kind !== "same") || (rows[index + 1] && rows[index + 1].kind !== "same")).slice(0, 400).map((row, index) => <div className={`diff-line diff-${row.kind}`} key={index}><span>{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}</span><code>{row.text || " "}</code></div>)}
            </div>
            <div className="modal-actions"><button className="button ghost" onClick={() => setHistoryOpen(false)} type="button">Close</button><button className="button primary" onClick={() => { setDraft(selected.text); setEditing(true); setPreviewEdit(false); setHistoryOpen(false); onNotify?.("Revision loaded into the editor — review it, then Save to make it current."); }} type="button"><RotateCcw size={16} /> Load into editor</button></div>
          </>}
        </div></>;
      })()}

      <div className="reader-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className={`reader-layout width-${settings.contentWidth}`}>
          <main className="reader-main">
            <div className="document-meta">
              <div className="part-pill">{document.partNumber > 0 ? `Part ${document.partNumber}` : "Guide"}</div>
              <span>{document.minutes} min read</span>
              {complete && <span className="complete-label"><Check size={15} /> Completed</span>}
              {hasEdit && <span className="edited-label"><Edit3 size={14} /> Edited copy</span>}
            </div>

            <div className="document-tools">
              <button className="text-button" onClick={() => { if (editing) closeEditor(); else { setEditing(true); setDraft(source); } }} type="button"><Edit3 size={17} /> {editing ? "Close editor" : "Edit copy"}</button>
              <button className={selectedText ? "text-button selection-ready" : "text-button"} onClick={clipSelection} type="button"><Highlighter size={17} /> {selectedText ? "Clip selection" : "Clip"}</button>
              <button className={selectedText ? "text-button selection-ready" : "text-button"} onClick={openNewAnnotation} type="button"><Highlighter size={17} /> {selectedText ? "Highlight selection" : "Highlight"}</button>
              <button className="text-button" onClick={() => setTeaching(true)} type="button"><Maximize2 size={17} /> Teach</button>
              <button className="text-button" onClick={onOpenBoard} type="button"><Sparkles size={17} /> Whiteboard</button>
              <button className="text-button compact-more" onClick={exportMarkdown} type="button"><Download size={17} /> Export</button>
              <button className="text-button" onClick={() => { setShowActions(true); setShowSpeech(false); setShowDisplay(false); }} aria-label="Open lecture actions" type="button"><MoreHorizontal size={18} /> Actions</button>
            </div>

            {editing && !previewEdit ? (
              <div className="editor-shell">
                <div className="editor-toolbar">
                  <div><span className="eyebrow">Editable local copy</span><strong>Markdown editor</strong><small>{draft.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words · {editorDirty ? "unsaved changes" : "saved source"}</small></div>
                  <div>
                    {revisions.length > 0 && <button className="button ghost" onClick={() => { setSelectedRevisionId(revisions[0]?.id || ""); setHistoryOpen(true); }} type="button"><History size={16} /> History ({revisions.length})</button>}
                    {hasEdit && <button className="button ghost" onClick={() => { onResetEdit(); setDraft(originalSource); setEditing(false); }} type="button"><RotateCcw size={16} /> Reset</button>}
                    <button className="button secondary" onClick={() => setPreviewEdit(true)} type="button">Preview</button>
                    <button className="button primary" onClick={saveEdit} type="button"><Save size={17} /> Save</button>
                  </div>
                </div>
                <textarea className="markdown-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck="true" aria-label="Edit Markdown lecture" />
              </div>
            ) : (
              <>
                {editing && previewEdit && (
                  <div className="preview-banner"><span>Previewing your unsaved changes</span><div><button className="button ghost" onClick={() => setPreviewEdit(false)} type="button">Back to edit</button><button className="button primary" onClick={saveEdit} type="button"><Save size={16} /> Save</button></div></div>
                )}
                <article
                  ref={articleRef}
                  className="markdown-body"
                  style={{ "--font-scale": settings.fontScale, "--line-height": settings.lineHeight }}
                  dangerouslySetInnerHTML={htmlMarkup}
                />
              </>
            )}

            <nav className="document-pagination" aria-label="Previous and next lectures">
              {previousDocument ? <button onClick={() => onOpenDocument(previousDocument.id)} type="button"><ChevronLeft size={20} /><span><small>Previous</small>{previousDocument.title}</span></button> : <span />}
              {nextDocument ? <button className="next" onClick={() => onOpenDocument(nextDocument.id)} type="button"><span><small>Next</small>{nextDocument.title}</span><ChevronRight size={20} /></button> : <span />}
            </nav>
          </main>

          <aside className={`reader-side-panel ${drawer ? "open" : ""}`}>
            <div className="side-panel-mobile-head">
              <strong>{drawer === "notes" ? "Personal notes" : drawer === "annotations" ? "Highlights" : "On this page"}</strong>
              <button className="icon-button small" onClick={() => setDrawer(null)} aria-label="Close panel" type="button"><X size={18} /></button>
            </div>
            <div className="side-panel-tabs">
              <button className={drawer === "outline" || !drawer ? "active" : ""} onClick={() => setDrawer("outline")} type="button"><ListTree size={16} /> Outline</button>
              <button className={drawer === "notes" ? "active" : ""} onClick={() => setDrawer("notes")} type="button"><MessageSquareText size={16} /> Notes</button>
              <button className={drawer === "annotations" ? "active" : ""} onClick={() => setDrawer("annotations")} type="button"><Highlighter size={16} /> Highlights <small>{annotations.length}</small></button>
            </div>
            {drawer === "notes" ? (
              <div className="personal-note-panel">
                <textarea ref={personalNoteRef} id="reader-personal-note" value={personalNote} onChange={(event) => onPersonalNote(event.target.value)} placeholder="Capture questions, explanations, interview insights, or links…" aria-label="Personal notes for this lecture" />
                <span>{saveStatus === "saving" ? "Saving on this device…" : saveStatus === "error" ? "Could not save—export a backup and check storage." : "Saved on this device."}</span>
              </div>
            ) : drawer === "annotations" ? (
              <div className="reader-annotation-list">
                {!highlightSupported && <p className="inline-warning"><AlertCircle size={15} /> This browser can save annotations but cannot paint inline highlights. Use the list to navigate.</p>}
                {annotations.map((annotation) => <article className={`reader-annotation-card ${annotation.color}`} key={annotation.id}><button className="annotation-quote" onClick={() => openStoredAnnotation(annotation)} disabled={annotationResolution[annotation.id] === "orphaned"} type="button"><span><i>{annotation.purpose}</i>{annotationResolution[annotation.id] === "relocated" && <small>Relocated</small>}{annotationResolution[annotation.id] === "orphaned" && <small className="orphaned">Needs relink</small>}</span><blockquote>{annotation.quote}</blockquote>{annotation.comment && <p>{annotation.comment}</p>}</button>{annotation.tags?.length > 0 && <div className="annotation-tags">{annotation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}<div className="annotation-card-actions">{annotationResolution[annotation.id] === "orphaned" && <button className="text-button" onClick={() => relinkAnnotation(annotation)} disabled={!selectedAnchor} title={selectedAnchor ? "Use the current selection" : "Select the matching text first"} type="button">Relink</button>}<button className="icon-button small" onClick={() => onCreateReviewFromAnnotation?.(annotation)} aria-label="Create review card from highlight" title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small" onClick={() => setAnnotationDraft(annotation)} aria-label="Edit highlight" title="Edit" type="button"><Pencil size={15} /></button><button className="icon-button small danger" onClick={() => onDeleteAnnotation?.(annotation.id)} aria-label="Delete highlight" title="Delete" type="button"><Trash2 size={15} /></button></div></article>)}
                {!annotations.length && <div className="annotation-empty"><Highlighter size={25} /><strong>No highlights yet</strong><p>Select a passage, then choose Highlight.</p></div>}
              </div>
            ) : (
              <nav className="outline-list" aria-label="Table of contents">
                {outline.map((item) => <button className={`level-${item.level}`} onClick={() => scrollToHeading(item.id)} key={item.id} type="button">{item.title}</button>)}
              </nav>
            )}
          </aside>
        </div>
      </div>

      {drawer && <button className="drawer-scrim" onClick={() => setDrawer(null)} aria-label="Close panel" type="button" />}
      {(speech.status === "speaking" || speech.status === "paused") && <div className="audio-bar" role="region" aria-label="Narration controls"><button className="icon-button" onClick={speech.previous} disabled={!speech.canPrevious} aria-label="Previous narration sentence" type="button"><SkipBack size={18} /></button><button className="icon-button" onClick={speech.togglePause} disabled={!speech.canPause && speech.status !== "paused"} aria-label={speech.status === "paused" ? "Resume narration" : "Pause narration"} type="button">{speech.status === "paused" ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}</button><button className="icon-button" onClick={speech.next} disabled={!speech.canNext} aria-label="Next narration sentence" type="button"><SkipForward size={18} /></button><div className="audio-label"><strong>{speech.activeLabel || "Narration"} · {speech.progress.current + 1}/{speech.progress.total}</strong><span>{speech.currentText}</span></div><button className="icon-button" onClick={speech.stop} aria-label="Stop narration" type="button"><Square size={16} fill="currentColor" /></button></div>}
      {teaching && <TeachingMode title={document.title} source={source} onClose={() => setTeaching(false)} speech={speech} />}
      <AnnotationDialog draft={annotationDraft} onClose={() => setAnnotationDraft(null)} onSave={saveAnnotation} />
    </section>
  );
}
