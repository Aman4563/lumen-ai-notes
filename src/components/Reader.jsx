import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { scrollBehavior } from "../lib/motion.js";
import {
  AlertCircle,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  BookmarkPlus,
  BrainCircuit,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Scissors,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Printer,
  SkipBack,
  SkipForward,
  Volume2,
  Trash2,
  X,
} from "lucide-react";
import { plainTextFromMarkdown, resolveDocumentLink } from "../lib/content";
import { slugifyHeading } from "../lib/markdown";
import { renderReaderMarkdown, useRenderedMarkdown } from "../lib/useRenderedMarkdown.js";
import { diffLines, diffSummary } from "../lib/diff.js";
import { documentToStandaloneHtml } from "../lib/exportHtml.js";
import { addAudioBookmark, listAudioBookmarks, removeAudioBookmark } from "../lib/audioBookmarks.js";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import { applyAnnotationHighlights, captureTextAnchor, resolveTextAnchor } from "../lib/annotations";
import { copyText } from "../lib/clipboard.js";
import { buildSpeechTarget } from "../lib/speechContent.js";
import { useModalDialog, visibleFocusables } from "../hooks/useModalDialog.js";
import AnnotationDialog from "./AnnotationDialog";
import NarrationPanel from "./NarrationPanel";
import TeachingMode from "./TeachingMode";

// One breakpoint for the drawer layout, shared with the CSS (styles.css
// switches the side panel to a bottom sheet at 980px).
const NARROW_QUERY = "(max-width: 980px)";
const PANEL_PREFERENCE_KEY = "lumen-reader-panel";
// Below this window width an always-open outline squeezes the lecture to
// about 40 characters per line, so the inline panel starts hidden.
const PANEL_DEFAULT_OPEN_MIN_WIDTH = 1240;
// Line-length measures in multiples of the lecture text size; styles.css
// uses the same factors for .reader-layout.width-*.
const LINE_LENGTHS = { focused: 30, comfortable: 36, wide: 46 };
const DIALOG_BACKGROUND = [".app-sidebar", ".app-topbar", ".bottom-nav", ".reader-view > :not(.reader-action-menu):not(.reader-action-scrim)"];
// The article stays selectable behind the phone drawer so a highlight can be
// relinked to a fresh selection; everything else outside the sheet is inert.
const DRAWER_BACKGROUND = [".app-sidebar", ".app-topbar", ".bottom-nav", ".reader-toolbar", ".document-tools", ".document-pagination", ".reader-view > .audio-bar", ".reader-view > .selection-toolbar"];

const isNarrowViewport = () => window.matchMedia?.(NARROW_QUERY).matches ?? window.innerWidth <= 980;
const readPanelPreference = () => {
  try {
    const stored = localStorage.getItem(PANEL_PREFERENCE_KEY);
    if (stored === "open" || stored === "closed") return stored === "open";
  } catch {
    // Storage can be unavailable in private browsing; fall back to the width rule.
  }
  return window.innerWidth >= PANEL_DEFAULT_OPEN_MIN_WIDTH;
};
const initialDrawer = () => (!isNarrowViewport() && readPanelPreference() ? "outline" : null);

/** Moves focus into a non-modal popover on open and back to its opener when focus would otherwise be lost. */
const usePopoverFocus = (open, popoverRef, openerRef, pickInitial) => {
  const pickRef = useRef(pickInitial);
  pickRef.current = pickInitial;
  useEffect(() => {
    if (!open) return undefined;
    const popover = popoverRef.current;
    const initial = pickRef.current?.(popover) || visibleFocusables(popover)[0];
    initial?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        const active = window.document.activeElement;
        if (!active || active === window.document.body || !active.isConnected) openerRef.current?.focus({ preventScroll: true });
      });
    };
  }, [open, openerRef, popoverRef]);
};

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
  autoNarrate = false,
  onAutoNarrateHandled,
  onOpenBoard,
  onAskAi,
  onNotify,
}) {
  const scrollRef = useRef(null);
  const articleRef = useRef(null);
  const panelRef = useRef(null);
  const personalNoteRef = useRef(null);
  const pendingNoteFocusRef = useRef(false);
  const pendingAnchorReconcileRef = useRef(null);
  const actionsDialogRef = useRef(null);
  const historyDialogRef = useRef(null);
  const speechPopoverRef = useRef(null);
  const displayPopoverRef = useRef(null);
  const listenButtonRef = useRef(null);
  const appearanceButtonRef = useRef(null);
  const resetCancelRef = useRef(null);
  const drawerReturnFocusRef = useRef(null);
  const headingNodesRef = useRef([]);
  const lastAnchorRef = useRef(null);
  const anchorHoldRef = useRef(null);
  const trackFrameRef = useRef(0);
  const documentOpenedAtRef = useRef(0);
  const progressTimer = useRef(null);
  const selectionClearTimer = useRef(null);
  const maximumRef = useRef(progress || 0);
  const [outline, setOutline] = useState([]);
  const [narrow, setNarrow] = useState(isNarrowViewport);
  const [drawer, setDrawer] = useState(initialDrawer);
  const [showSpeech, setShowSpeech] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
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
  const [currentHeadingId, setCurrentHeadingId] = useState("");
  const [widthRoom, setWidthRoom] = useState(null);

  const html = useRenderedMarkdown(editing && previewEdit ? draft : source);
  const htmlMarkup = useMemo(() => ({ __html: html }), [html]);
  useMermaidDiagrams(articleRef, {
    contentKey: `${html}\u0000${isDark ? "dark" : "light"}`,
    enabled: !(editing && !previewEdit),
  });

  useEffect(() => {
    setDraft(source);
    setEditing(Boolean(startEditing));
    setPreviewEdit(false);
    setDrawer(initialDrawer());
    setShowSpeech(false);
    setShowDisplay(false);
    setShowActions(false);
    setShowFind(false);
    setHistoryOpen(false);
    setConfirmReset(false);
    setFindQuery("");
    setSelectedText("");
    setSpeechSelection("");
    setSelectedAnchor(null);
    setAnnotationDraft(null);
    setScrollPosition(position || 0);
    setCurrentHeadingId("");
    lastAnchorRef.current = null;
    maximumRef.current = progress || 0;
    if (startEditing) onEditingStarted?.();
    speech.stop();
  }, [document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const media = window.matchMedia?.(NARROW_QUERY);
    if (!media) return undefined;
    const update = () => {
      setNarrow(media.matches);
      setDrawer(media.matches || !readPanelPreference() ? null : "outline");
    };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => () => {
    anchorHoldRef.current?.();
    cancelAnimationFrame(trackFrameRef.current);
  }, []);

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

  // Keeps `element` at `offset` px below the top of the reading viewport
  // while late layout (Mermaid, fonts, KaTeX) settles, until the learner
  // scrolls on their own.
  const holdAnchor = (element, offset, duration) => {
    anchorHoldRef.current?.();
    const container = scrollRef.current;
    if (!container || !element?.isConnected) return;
    const align = () => {
      if (!element.isConnected) return;
      const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
      if (Math.abs(delta) > 1) container.scrollTop += delta;
    };
    align();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(align) : null;
    if (articleRef.current) observer?.observe(articleRef.current);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    let timer = 0;
    const release = () => {
      observer?.disconnect();
      clearTimeout(timer);
      events.forEach((type) => container.removeEventListener(type, release));
      if (anchorHoldRef.current === release) anchorHoldRef.current = null;
    };
    timer = setTimeout(release, duration);
    events.forEach((type) => container.addEventListener(type, release, { passive: true }));
    anchorHoldRef.current = release;
  };

  // Records the block at the top of the viewport (to re-anchor after a text
  // size change) and the section being read (for the outline marker).
  const trackReadingLocation = () => {
    if (trackFrameRef.current) return;
    trackFrameRef.current = requestAnimationFrame(() => {
      trackFrameRef.current = 0;
      const container = scrollRef.current;
      const article = articleRef.current;
      if (!container || !article) return;
      const top = container.getBoundingClientRect().top;
      const blocks = article.children;
      let low = 0;
      let high = blocks.length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (blocks[middle].getBoundingClientRect().bottom > top) { found = middle; high = middle - 1; } else low = middle + 1;
      }
      lastAnchorRef.current = found >= 0 ? { element: blocks[found], offset: blocks[found].getBoundingClientRect().top - top } : null;
      const headings = headingNodesRef.current.filter((heading) => heading.isConnected);
      const readingLine = top + Math.min(120, container.clientHeight * 0.25);
      low = 0;
      high = headings.length - 1;
      let current = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (headings[middle].getBoundingClientRect().top <= readingLine) { current = middle; low = middle + 1; } else high = middle - 1;
      }
      const id = current >= 0 ? headings[current].id : "";
      setCurrentHeadingId((previous) => (previous === id ? previous : id));
    });
  };

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
    headingNodesRef.current = headings;
    setOutline(items);
    trackReadingLocation();

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
      if (destination) {
        // A lecture opened for this target jumps instantly and stays pinned
        // while diagrams above it finish rendering; a same-lecture jump glides.
        const justOpened = performance.now() - documentOpenedAtRef.current < 2_000;
        destination.scrollIntoView({ behavior: justOpened ? "auto" : scrollBehavior(), block: "start" });
        if (justOpened && scrollRef.current) holdAnchor(destination, destination.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top, 2_500);
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
      field.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
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
      matches[0].scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    }
    setFindState({ index: matches.length ? 0 : -1, total: matches.length });
    return clear;
  }, [findQuery, html, showFind]);

  // Dialog contracts: inert background, focus inside, Tab wrap, Escape, and
  // focus restore. On phones the side panel is a modal bottom sheet.
  useModalDialog(showActions, actionsDialogRef, { onClose: () => setShowActions(false), background: DIALOG_BACKGROUND });
  useModalDialog(historyOpen, historyDialogRef, { onClose: () => setHistoryOpen(false), background: DIALOG_BACKGROUND });
  useModalDialog(narrow && Boolean(drawer), panelRef, {
    onClose: () => setDrawer(null),
    background: DRAWER_BACKGROUND,
    initialFocus: (panel) => panel.querySelector(".side-panel-tabs button.active"),
    returnFocusRef: drawerReturnFocusRef,
  });
  usePopoverFocus(showSpeech, speechPopoverRef, listenButtonRef, (popover) => popover?.querySelector(".speech-controls .button.primary:not(:disabled)"));
  usePopoverFocus(showDisplay, displayPopoverRef, appearanceButtonRef);

  useEffect(() => {
    if (!showFind && !showSpeech && !showDisplay) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setShowFind(false);
      setFindQuery("");
      setShowSpeech(false);
      setShowDisplay(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showDisplay, showFind, showSpeech]);

  // Show the section being read when the outline opens.
  useEffect(() => {
    const panel = panelRef.current;
    if (drawer !== "outline" || !panel) return undefined;
    const frame = requestAnimationFrame(() => {
      const item = panel.querySelector(".outline-list button.current");
      for (let box = item?.parentElement; item && box && box !== panel.parentElement; box = box.parentElement) {
        if (box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY)) {
          box.scrollTop += item.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
          break;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [drawer]);

  useEffect(() => {
    documentOpenedAtRef.current = performance.now();
    const container = scrollRef.current;
    if (!container) return undefined;
    // A citation or cross-lecture link for this lecture owns the first
    // scroll; restoring the saved position would cancel it (TF-2).
    if (navigationTarget?.documentId === document.id) return undefined;
    const frame = requestAnimationFrame(() => {
      const max = container.scrollHeight - container.clientHeight;
      container.scrollTop = max > 0 ? max * Math.min(position || 0, 0.99) : 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Text size, spacing, and line length reflow the article. Keep the block
  // the learner was reading in place instead of letting the scroll fraction
  // land somewhere else (and persisting that as progress).
  const layoutKey = `${settings.fontScale}|${settings.lineHeight}|${settings.contentWidth}`;
  const previousLayoutKeyRef = useRef(layoutKey);
  useLayoutEffect(() => {
    if (previousLayoutKeyRef.current === layoutKey) return;
    previousLayoutKeyRef.current = layoutKey;
    const anchor = lastAnchorRef.current;
    if (anchor?.element?.isConnected) holdAnchor(anchor.element, anchor.offset, 900);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Line length can only change what the window has room for; explain when
  // the control is capped or has nothing to change.
  useLayoutEffect(() => {
    if (!showDisplay) return;
    const layout = scrollRef.current?.querySelector(".reader-layout");
    const main = layout?.querySelector(".reader-main");
    if (!layout || !main) return;
    const style = getComputedStyle(layout);
    const panelOpen = !narrow && Boolean(drawer);
    const panelWidth = panelOpen ? (panelRef.current?.offsetWidth || 0) + (Number.parseFloat(style.columnGap) || 0) : 0;
    const available = layout.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0) - panelWidth;
    const textSize = Number.parseFloat(getComputedStyle(articleRef.current || main).fontSize) || 18;
    setWidthRoom({ available, focused: LINE_LENGTHS.focused * textSize, wide: LINE_LENGTHS.wide * textSize, panelOpen });
  }, [drawer, narrow, settings.contentWidth, settings.fontScale, showDisplay]);

  // Back from the Markdown editor, return to the saved reading place rather
  // than wherever the editor's shorter page left the scroll offset.
  const editorOpen = editing && !previewEdit;
  const editorWasOpenRef = useRef(editorOpen);
  useEffect(() => {
    const wasOpen = editorWasOpenRef.current;
    editorWasOpenRef.current = editorOpen;
    if (!wasOpen || editorOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const max = container.scrollHeight - container.clientHeight;
      container.scrollTop = max > 0 ? max * Math.min(scrollPosition || 0, 0.99) : 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [editorOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
    const container = scrollRef.current;
    // Scrolling the Markdown editor says nothing about reading progress;
    // recording it would overwrite the saved place in the lecture.
    if (!container || editorOpen) return;
    const max = container.scrollHeight - container.clientHeight;
    const value = max <= 0 ? 1 : Math.max(0, Math.min(1, container.scrollTop / max));
    setScrollPosition(value);
    maximumRef.current = Math.max(maximumRef.current, value);
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => onProgress({ position: value, maximum: maximumRef.current }), 160);
    trackReadingLocation();
  };

  const toggleDrawer = (tab) => {
    const next = drawer === tab ? null : tab;
    setDrawer(next);
    if (narrow) {
      setShowSpeech(false);
      setShowDisplay(false);
      return;
    }
    try {
      localStorage.setItem(PANEL_PREFERENCE_KEY, next ? "open" : "closed");
    } catch {
      // The panel still toggles for this visit without storage.
    }
  };

  const scrollToHeading = (id) => {
    const heading = articleRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (!heading) return;
    heading.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    heading.setAttribute("tabindex", "-1");
    if (narrow) {
      // Closing the sheet hands focus to the section the learner chose.
      drawerReturnFocusRef.current = heading;
      setDrawer(null);
    } else heading.focus({ preventScroll: true });
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
    matches[next].scrollIntoView({ behavior: scrollBehavior(), block: "center" });
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
    // Document narration resumes from the last persisted sentence (device
    // local); any other scope always starts at its beginning.
    let startIndex = 0;
    if (target.scope === "document") {
      const saved = Number(localStorage.getItem(`lumen-narration-${document.id}`));
      if (Number.isInteger(saved) && saved > 2) startIndex = saved;
    }
    if (speech.speak(target.text, { label: target.label, sections: target.sections, startIndex })) {
      if (startIndex > 0) onNotify?.("Narration resumed from your last position. Use Previous to go back.");
      // Move immediately to the compact player so the mobile settings sheet
      // does not cover the lecture or intercept its playback controls.
      setShowSpeech(false);
    }
  };

  // Narration playlist arrival (issue #17, AUDIO-002): this chapter was
  // opened by auto-advance, so begin its full-lecture narration from the top
  // once the article DOM is in place. Same user-initiated session; the
  // foreground-safety rules (pagehide cancel, explicit resume) still apply.
  useEffect(() => {
    if (!autoNarrate) return;
    const target = buildSpeechTarget({
      scope: "document",
      selectedText: "",
      article: articleRef.current,
      scrollContainer: scrollRef.current,
      sourceText: plainTextFromMarkdown(source),
      language: settings.speechLanguage,
    });
    if (target.available) speech.speak(target.text, { label: target.label, sections: target.sections });
    onAutoNarrateHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNarrate, document.id]);

  // Spoken-block follow (AUDIO-001): while a lecture-wide narration is
  // speaking, tint the block containing the current sentence and keep it in
  // view. Sentences rewritten by pronunciation overrides simply skip the
  // highlight when no block matches; narration is never affected.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const clear = () => article.querySelectorAll(".narration-active").forEach((node) => node.classList.remove("narration-active"));
    if (speech.status !== "speaking" || !speech.currentText || !["Full lecture", "Current section"].includes(speech.activeLabel)) {
      clear();
      return;
    }
    const needle = speech.currentText.slice(0, 60).replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (needle.length < 8) return;
    let target = null;
    for (const block of article.querySelectorAll("h1, h2, h3, h4, p, li, blockquote")) {
      if (block.textContent.replace(/\s+/g, " ").toLocaleLowerCase().includes(needle)) {
        target = block;
        break;
      }
    }
    clear();
    if (!target) return;
    target.classList.add("narration-active");
    target.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }, [speech.activeLabel, speech.currentText, speech.status]);

  // Persist the document-narration position per device so a stopped or
  // interrupted session can pick up where it left off (AUDIO-001).
  useEffect(() => {
    if (speech.activeLabel !== "Full lecture" || !speech.progress.total) return;
    if (speech.progress.current >= speech.progress.total - 1) {
      localStorage.removeItem(`lumen-narration-${document.id}`);
      return;
    }
    localStorage.setItem(`lumen-narration-${document.id}`, String(speech.progress.current));
  }, [document.id, speech.activeLabel, speech.progress]);

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
    setConfirmReset(false);
    setEditing(false);
    setPreviewEdit(false);
  };

  const closeEditor = () => {
    if (editorDirty && !window.confirm("Discard the unsaved editor changes?")) return;
    setDraft(source);
    setConfirmReset(false);
    setPreviewEdit(false);
    setEditing(false);
  };

  // Reset asks first (READER-9) and never drops unsaved typing: App banks
  // the dirty draft as its own revision next to the saved copy.
  const resetToOriginal = () => {
    onResetEdit(editorDirty ? draft : undefined);
    setConfirmReset(false);
    setDraft(originalSource);
    setEditing(false);
    setPreviewEdit(false);
  };

  useEffect(() => {
    if (confirmReset) resetCancelRef.current?.focus();
  }, [confirmReset]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setSelectedAnchor(null);
  };

  const clipSelection = () => {
    if (onAddClipping({ text: selectedText, anchor: selectedAnchor })) clearSelection();
  };

  const openNewAnnotation = () => {
    if (!selectedAnchor) {
      onNotify?.("Select text in the lecture before highlighting it.", "error");
      return;
    }
    setAnnotationDraft({ ...selectedAnchor, documentId: document.id, color: "gold", purpose: "important", comment: "", tags: [] });
  };

  const askAiAboutSelection = () => {
    if (selectedText) onAskAi(selectedText);
    else onNotify?.("Select lecture text first, then ask the AI about it.", "warning");
  };

  const listenToSelection = () => {
    if (!selectedText) return;
    speech.speak(selectedText, { label: "Selection" });
  };

  const saveAnnotation = (draft) => {
    onSaveAnnotation?.(draft);
    setAnnotationDraft(null);
    clearSelection();
  };

  const openStoredAnnotation = (annotation) => {
    const result = resolveTextAnchor(articleRef.current, annotation);
    const element = result.range?.startContainer?.parentElement;
    element?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    if (result.range) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(result.range);
      setTimeout(() => selection.removeAllRanges(), 1_200);
    }
    if (narrow) setDrawer(null);
  };

  const relinkAnnotation = (annotation) => {
    if (!selectedAnchor) {
      onNotify?.("Select the matching passage first, then choose Relink.", "error");
      return;
    }
    onSaveAnnotation?.({ ...annotation, ...selectedAnchor });
    clearSelection();
  };

  const [audioBookmarks, setAudioBookmarks] = useState(() => listAudioBookmarks(document.id));
  useEffect(() => setAudioBookmarks(listAudioBookmarks(document.id)), [document.id]);
  const bookmarkCurrentSentence = () => {
    if (speech.activeLabel !== "Full lecture") return;
    addAudioBookmark({ documentId: document.id, index: speech.progress.current, snippet: speech.currentText.slice(0, 160) });
    setAudioBookmarks(listAudioBookmarks(document.id));
    onNotify?.("Sentence bookmarked — jump back to it from the narration panel.");
  };
  const playFromBookmark = (bookmark) => {
    const target = speechTarget();
    if (!target.available || target.scope !== "document") {
      onNotify?.("Switch the narration target to Full to jump to an audio bookmark.", "warning");
      return;
    }
    speech.speak(target.text, { label: target.label, sections: target.sections, startIndex: bookmark.index });
    setShowSpeech(false);
  };
  const deleteAudioBookmark = (id) => {
    removeAudioBookmark(id);
    setAudioBookmarks(listAudioBookmarks(document.id));
  };
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const exportHtml = () => {
    const fileHtml = documentToStandaloneHtml({
      title: document.title,
      renderedHtml: renderReaderMarkdown(source),
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
  const playerVisible = speech.status === "speaking" || speech.status === "paused";
  const minutesLeft = document.minutes > 2 && scrollPosition > 0.02 && scrollPosition < 0.96 ? Math.max(1, Math.ceil(document.minutes * (1 - scrollPosition))) : 0;
  const selectionToolsVisible = Boolean(selectedText) && !(editing && !previewEdit) && !annotationDraft && !showActions && !historyOpen && !teaching && !showSpeech && !showDisplay && !(narrow && drawer);
  const panelOpenInline = !narrow && Boolean(drawer);
  const panelIsModal = narrow && Boolean(drawer);
  const widthNote = !widthRoom ? "" : widthRoom.available <= widthRoom.focused + 8
    ? `Lines already fill this ${widthRoom.panelOpen ? "column" : "screen"}, so every line length looks the same here.${widthRoom.panelOpen ? " Hide the outline with Table of contents for more room." : " Text size changes how much fits on a line."}`
    : widthRoom.available < widthRoom.wide - 8
      ? widthRoom.panelOpen ? "Wider settings are capped while the outline is open. Hide it with Table of contents for longer lines." : "Wider settings are capped by this window size."
      : "";
  const widthControlUseful = !widthRoom || widthRoom.available > widthRoom.focused + 8;

  return (
    <section className="reader-view">
      <div className="reading-progress" aria-hidden="true"><span style={{ width: `${Math.round((scrollPosition || 0) * 100)}%` }} /></div>
      <header className="reader-toolbar">
        <div className="reader-crumb">
          <span title={document.partTitle}>{document.partTitle}</span>
          <div className="reader-crumb-progress">
            <strong>{Math.round((scrollPosition || 0) * 100)}%</strong>
            {minutesLeft > 0 && <small className="reading-time-left">~{minutesLeft} min<span className="time-left-suffix"> left</span></small>}
          </div>
        </div>
        <div className="reader-actions">
          <button className={drawer === "outline" ? "icon-button active" : "icon-button"} onClick={() => toggleDrawer("outline")} aria-label="Table of contents" aria-expanded={drawer === "outline"} aria-controls="reader-side-panel" type="button"><ListTree size={20} /></button>
          <button className={drawer === "notes" ? "icon-button active" : "icon-button"} onClick={() => toggleDrawer("notes")} aria-label="Personal notes" aria-expanded={drawer === "notes"} aria-controls="reader-side-panel" type="button"><NotebookPen size={20} /></button>
          <button ref={listenButtonRef} className={showSpeech ? "icon-button active" : "icon-button"} onClick={() => { setShowSpeech((value) => { const next = !value; if (next) setSpeechSelection(selectedText); return next; }); setShowDisplay(false); setShowActions(false); }} aria-label="Listen" aria-expanded={showSpeech} aria-controls="reader-narration-panel" type="button"><Volume2 size={20} /></button>
          <button className={bookmarked ? "icon-button active" : "icon-button"} onClick={onToggleBookmark} aria-label={bookmarked ? "Remove bookmark" : "Bookmark"} type="button">
            {bookmarked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
          </button>
          <button className="icon-button desktop-action" onClick={share} aria-label="Share" type="button"><Share2 size={19} /></button>
          <button ref={appearanceButtonRef} className={showDisplay ? "icon-button active" : "icon-button"} onClick={() => { setShowDisplay((value) => !value); setShowSpeech(false); setShowActions(false); }} aria-label="Reading appearance" aria-expanded={showDisplay} aria-controls="reader-appearance-panel" type="button"><SlidersHorizontal size={20} /></button>
        </div>
      </header>

      {showSpeech && <NarrationPanel panelRef={speechPopoverRef} settings={settings} speech={speech} hasSelection={Boolean(selectedText || speechSelection)} target={speechTarget()} onSettingsChange={onSettingsChange} onRead={readSpeechTarget} onClose={() => setShowSpeech(false)} audioBookmarks={audioBookmarks} onPlayBookmark={playFromBookmark} onDeleteBookmark={deleteAudioBookmark} />}

      {showDisplay && (
        <div ref={displayPopoverRef} id="reader-appearance-panel" className="reader-popover display-popover" role="dialog" aria-labelledby="reader-appearance-title">
          <div className="popover-heading"><strong id="reader-appearance-title">Reading appearance</strong><button className="icon-button small" onClick={() => setShowDisplay(false)} aria-label="Close appearance" type="button"><X size={17} /></button></div>
          <label><span>Text size {Math.round(settings.fontScale * 100)}%</span><input type="range" min="0.85" max="1.35" step="0.05" value={settings.fontScale} aria-valuetext={`${Math.round(settings.fontScale * 100)}%`} onChange={(event) => onSettingsChange({ fontScale: Number(event.target.value) })} /></label>
          <label><span>Line spacing {Number(settings.lineHeight).toFixed(2)}</span><input type="range" min="1.45" max="2" step="0.05" value={settings.lineHeight} aria-valuetext={Number(settings.lineHeight).toFixed(2)} onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })} /></label>
          <div className="width-setting" role="group" aria-labelledby="reader-width-label">
            <span id="reader-width-label">Line length</span>
            {widthControlUseful && <div className="segmented">
              {["focused", "comfortable", "wide"].map((width) => <button className={settings.contentWidth === width ? "active" : ""} onClick={() => onSettingsChange({ contentWidth: width })} aria-pressed={settings.contentWidth === width} key={width} type="button">{width}</button>)}
            </div>}
            {widthNote && <p className="width-note">{widthNote}</p>}
          </div>
        </div>
      )}

      {showFind && <div className="reader-find" role="search"><Search size={18} /><input value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); moveFind(event.shiftKey ? -1 : 1); } }} placeholder="Find in this lecture…" aria-label="Find in this lecture" /><span aria-live="polite">{findState.total ? `${findState.index + 1}/${findState.total}` : findQuery ? "0" : ""}</span><button className="icon-button small" onClick={() => moveFind(-1)} disabled={!findState.total} aria-label="Previous match" type="button"><ChevronLeft size={17} /></button><button className="icon-button small" onClick={() => moveFind(1)} disabled={!findState.total} aria-label="Next match" type="button"><ChevronRight size={17} /></button><button className="icon-button small" onClick={() => { setShowFind(false); setFindQuery(""); }} aria-label="Close find" type="button"><X size={17} /></button></div>}

      {showActions && <><button className="reader-action-scrim" onClick={() => setShowActions(false)} aria-label="Close lecture actions" tabIndex={-1} type="button" /><div ref={actionsDialogRef} className="reader-action-menu" role="dialog" aria-modal="true" aria-labelledby="reader-actions-title"><div className="popover-heading"><div><span className="eyebrow">Lecture actions</span><strong id="reader-actions-title">Study and file tools</strong></div><button className="icon-button small" onClick={() => setShowActions(false)} aria-label="Close lecture actions" type="button"><X size={17} /></button></div><div className="reader-action-grid"><button onClick={openFind} type="button"><Search size={18} /><span><strong>Find in lecture</strong><small>Jump between matches</small></span></button><button onClick={() => { share(); setShowActions(false); }} type="button"><Share2 size={18} /><span><strong>Share</strong><small>Use the iPhone share sheet</small></span></button><button onClick={() => { copyLink(); setShowActions(false); }} type="button"><Copy size={18} /><span><strong>Copy link</strong><small>Copy this exact lecture</small></span></button><button onClick={() => { exportMarkdown(); setShowActions(false); }} type="button"><Download size={18} /><span><strong>Export Markdown</strong><small>Download the current copy</small></span></button><button onClick={() => { exportHtml(); setShowActions(false); }} type="button"><FileDown size={18} /><span><strong>Export HTML</strong><small>Self-contained printable page</small></span></button><button onClick={() => { setShowActions(false); requestAnimationFrame(() => window.print()); }} type="button"><Printer size={18} /><span><strong>Print / Save PDF</strong><small>Clean copy via the print dialog</small></span></button><button onClick={() => { onSetProgress(complete ? 0 : 1); setShowActions(false); }} type="button">{complete ? <RotateCcw size={18} /> : <CheckCircle2 size={18} />}<span><strong>{complete ? "Reset progress" : "Mark complete"}</strong><small>{complete ? "Start this lecture again" : "Set progress to 100%"}</small></span></button><button onClick={() => { scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() }); setShowActions(false); }} type="button"><ArrowUp size={18} /><span><strong>Back to top</strong><small>Return to the title</small></span></button></div></div></>}
      {historyOpen && (() => {
        const selected = revisions.find((entry) => entry.id === selectedRevisionId) || revisions[0];
        // Rows compare the revision (old) with the current text (new):
        // "removed" lines exist only in the revision and come back when it is
        // loaded; "added" lines exist only now and would be removed.
        const rows = selected ? diffLines(selected.text, draft ?? source) : [];
        const summary = diffSummary(rows);
        const plural = (count) => (count === 1 ? "" : "s");
        return <><button className="reader-action-scrim" onClick={() => setHistoryOpen(false)} aria-label="Close revision history" tabIndex={-1} type="button" /><div ref={historyDialogRef} className="reader-action-menu revision-dialog" role="dialog" aria-modal="true" aria-labelledby="revision-dialog-title">
          <div className="popover-heading"><div><span className="eyebrow">Last {revisions.length} saved {revisions.length === 1 ? "state" : "states"}</span><strong id="revision-dialog-title">Revision history</strong></div><button className="icon-button small" onClick={() => setHistoryOpen(false)} aria-label="Close revision history" type="button"><X size={17} /></button></div>
          <div className="revision-list" role="radiogroup" aria-label="Choose a revision">
            {revisions.map((entry) => <button key={entry.id} role="radio" aria-checked={selected?.id === entry.id} className={selected?.id === entry.id ? "active" : ""} onClick={() => setSelectedRevisionId(entry.id)} type="button"><strong>{new Date(entry.savedAt).toLocaleString()}</strong><span>{entry.label || "saved state"} · {entry.text.length.toLocaleString()} chars</span></button>)}
          </div>
          {selected && <>
            <p className="revision-summary">Loading this revision brings back <strong>{summary.removed}</strong> line{plural(summary.removed)} and removes <strong>{summary.added}</strong> line{plural(summary.added)} from the current text.</p>
            <p className="revision-legend" aria-hidden="true"><span className="diff-restore">+ comes back</span><span className="diff-discard">− is removed</span></p>
            <div className="revision-diff" role="group" aria-label="Changes if you load this revision. Plus lines come back; minus lines are removed.">
              {rows.filter((row, index) => row.kind !== "same" || (rows[index - 1] && rows[index - 1].kind !== "same") || (rows[index + 1] && rows[index + 1].kind !== "same")).slice(0, 400).map((row, index) => <div className={`diff-line diff-${row.kind}${row.kind === "removed" ? " diff-restore" : row.kind === "added" ? " diff-discard" : ""}`} key={index}><span>{row.kind === "removed" ? "+" : row.kind === "added" ? "−" : " "}</span><code>{row.text || " "}</code></div>)}
            </div>
            <div className="modal-actions"><button className="button ghost" onClick={() => setHistoryOpen(false)} type="button">Close</button><button className="button primary" onClick={() => { setDraft(selected.text); setEditing(true); setPreviewEdit(false); setHistoryOpen(false); onNotify?.("Revision loaded into the editor — review it, then Save to make it current."); }} type="button"><RotateCcw size={16} /> Load into editor</button></div>
          </>}
        </div></>;
      })()}

      <div className="reader-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className={`reader-layout width-${settings.contentWidth}${!narrow && !drawer ? " panel-collapsed" : ""}`} style={{ "--font-scale": settings.fontScale, "--line-height": settings.lineHeight }}>
          <main className="reader-main">
            <div className="document-meta">
              <div className="part-pill">{document.partNumber > 0 ? `Part ${document.partNumber}` : "Guide"}</div>
              <span>{document.minutes} min read</span>
              {complete && <span className="complete-label"><Check size={15} /> Completed</span>}
              {hasEdit && <span className="edited-label"><Edit3 size={14} /> Edited copy</span>}
            </div>

            <div className="document-tools">
              <button className="text-button" onClick={() => { if (editing) closeEditor(); else { setEditing(true); setDraft(source); } }} type="button"><Edit3 size={17} /> {editing ? "Close editor" : "Edit copy"}</button>
              <button className={selectedText ? "text-button selection-ready" : "text-button"} onClick={clipSelection} type="button"><Scissors size={17} /> {selectedText ? "Clip selection" : "Clip"}</button>
              <button className={selectedText ? "text-button selection-ready" : "text-button"} onClick={openNewAnnotation} type="button"><Highlighter size={17} /> {selectedText ? "Highlight selection" : "Highlight"}</button>
              {onAskAi && <button className={selectedText ? "text-button selection-ready" : "text-button"} onClick={askAiAboutSelection} type="button"><BrainCircuit size={17} /> Ask AI</button>}<button className="text-button" onClick={() => setTeaching(true)} type="button"><Maximize2 size={17} /> Teach</button>
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
                    {hasEdit && <button className="button ghost" onClick={() => setConfirmReset(true)} aria-expanded={confirmReset} aria-controls="reader-reset-confirm" type="button"><RotateCcw size={16} /> Reset</button>}
                    <button className="button secondary" onClick={() => setPreviewEdit(true)} type="button">Preview</button>
                    <button className="button primary" onClick={saveEdit} type="button"><Save size={17} /> Save</button>
                  </div>
                </div>
                {confirmReset && (
                  <div id="reader-reset-confirm" className="reset-confirm" role="group" aria-labelledby="reader-reset-title" aria-describedby="reader-reset-detail" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setConfirmReset(false); } }}>
                    <strong id="reader-reset-title">Restore the original lecture?</strong>
                    <p id="reader-reset-detail">{editorDirty ? "Your saved copy and these unsaved changes are both kept in History, so you can load either back." : "Your saved copy stays in History, so you can load it back later."} History keeps the five most recent versions.</p>
                    <div><button ref={resetCancelRef} className="button ghost" onClick={() => setConfirmReset(false)} type="button">Keep editing</button><button className="button primary" onClick={resetToOriginal} type="button"><RotateCcw size={16} /> Restore original</button></div>
                  </div>
                )}
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
                  dangerouslySetInnerHTML={htmlMarkup}
                />
              </>
            )}

            <nav className="document-pagination" aria-label="Previous and next lectures">
              {previousDocument ? <button onClick={() => onOpenDocument(previousDocument.id)} type="button"><ChevronLeft size={20} /><span><small>Previous</small>{previousDocument.title}</span></button> : <span />}
              {nextDocument ? <button className="next" onClick={() => onOpenDocument(nextDocument.id)} type="button"><span><small>Next</small>{nextDocument.title}</span><ChevronRight size={20} /></button> : <span />}
            </nav>
          </main>

          <aside
            ref={panelRef}
            id="reader-side-panel"
            className={`reader-side-panel ${drawer ? "open" : ""}`}
            inert={narrow && !drawer}
            aria-hidden={narrow && !drawer ? "true" : undefined}
            role={panelIsModal ? "dialog" : undefined}
            aria-modal={panelIsModal ? "true" : undefined}
            aria-labelledby={panelIsModal ? "reader-side-panel-title" : undefined}
            aria-label={panelOpenInline ? "Lecture outline, notes, and highlights" : undefined}
          >
            <div className="side-panel-mobile-head">
              <strong id="reader-side-panel-title">{drawer === "notes" ? "Personal notes" : drawer === "annotations" ? "Highlights" : "On this page"}</strong>
              <button className="icon-button small" onClick={() => setDrawer(null)} aria-label="Close panel" type="button"><X size={18} /></button>
            </div>
            <div className="side-panel-tabs">
              <button className={drawer === "outline" || !drawer ? "active" : ""} onClick={() => setDrawer("outline")} aria-pressed={drawer === "outline" || !drawer} type="button"><ListTree size={16} /> Outline</button>
              <button className={drawer === "notes" ? "active" : ""} onClick={() => setDrawer("notes")} aria-pressed={drawer === "notes"} type="button"><MessageSquareText size={16} /> Notes</button>
              <button className={drawer === "annotations" ? "active" : ""} onClick={() => setDrawer("annotations")} aria-pressed={drawer === "annotations"} type="button"><Highlighter size={16} /> Highlights <small>{annotations.length}</small></button>
            </div>
            {drawer === "notes" ? (
              <div className="personal-note-panel">
                <textarea ref={personalNoteRef} id="reader-personal-note" value={personalNote} onChange={(event) => onPersonalNote(event.target.value)} placeholder="Capture questions, explanations, interview insights, or links…" aria-label="Personal notes for this lecture" />
                <span role={saveStatus === "error" ? "alert" : "status"}>{saveStatus === "saving" ? "Saving on this device…" : saveStatus === "error" ? "Could not save—export a backup and check storage." : "Saved on this device."}</span>
              </div>
            ) : drawer === "annotations" ? (
              <div className="reader-annotation-list">
                {!highlightSupported && <p className="inline-warning"><AlertCircle size={15} /> This browser can save annotations but cannot paint inline highlights. Use the list to navigate.</p>}
                {annotations.map((annotation) => <article className={`reader-annotation-card ${annotation.color}`} key={annotation.id}><button className="annotation-quote" onClick={() => openStoredAnnotation(annotation)} disabled={annotationResolution[annotation.id] === "orphaned"} type="button"><span><i>{annotation.purpose}</i>{annotationResolution[annotation.id] === "relocated" && <small>Relocated</small>}{annotationResolution[annotation.id] === "orphaned" && <small className="orphaned">Needs relink</small>}</span><blockquote>{annotation.quote}</blockquote>{annotation.comment && <p>{annotation.comment}</p>}</button>{annotation.tags?.length > 0 && <div className="annotation-tags">{annotation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}<div className="annotation-card-actions">{annotationResolution[annotation.id] === "orphaned" && <button className="text-button" onClick={() => relinkAnnotation(annotation)} disabled={!selectedAnchor} title={selectedAnchor ? "Use the current selection" : "Select the matching text first"} type="button">Relink</button>}<button className="icon-button small" onClick={() => onCreateReviewFromAnnotation?.(annotation)} aria-label="Create review card from highlight" title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small" onClick={() => setAnnotationDraft(annotation)} aria-label="Edit highlight" title="Edit" type="button"><Pencil size={15} /></button><button className="icon-button small danger" onClick={() => onDeleteAnnotation?.(annotation.id)} aria-label="Delete highlight" title="Delete" type="button"><Trash2 size={15} /></button></div></article>)}
                {!annotations.length && <div className="annotation-empty"><Highlighter size={25} /><strong>No highlights yet</strong><p>Select a passage, then choose Highlight.</p></div>}
              </div>
            ) : (
              <nav className="outline-list" aria-label="Table of contents">
                {outline.map((item) => <button className={`level-${item.level}${item.id === currentHeadingId ? " current" : ""}`} onClick={() => scrollToHeading(item.id)} aria-current={item.id === currentHeadingId ? "location" : undefined} key={item.id} type="button">{item.title}</button>)}
              </nav>
            )}
          </aside>
        </div>
      </div>

      {panelIsModal && <button className="drawer-scrim" onClick={() => setDrawer(null)} aria-label="Close panel" tabIndex={-1} type="button" />}
      {selectionToolsVisible && (
        // Contextual actions for the current selection, pinned where a thumb
        // can reach them at any scroll depth (READER-1). mousedown is
        // cancelled so a desktop click keeps the selection alive.
        <div className={`selection-toolbar${playerVisible ? " with-player" : ""}`} role="toolbar" aria-label="Selected text actions" onMouseDown={(event) => event.preventDefault()}>
          <button onClick={openNewAnnotation} type="button"><Highlighter size={18} /><span>Highlight</span></button>
          <button onClick={clipSelection} type="button"><Scissors size={18} /><span>Clip</span></button>
          {onAskAi && <button onClick={askAiAboutSelection} type="button"><BrainCircuit size={18} /><span>Ask AI</span></button>}
          {speech.supported && <button onClick={listenToSelection} type="button"><Volume2 size={18} /><span>Listen</span></button>}
        </div>
      )}
      {playerVisible && <div className="audio-bar" role="region" aria-label="Narration controls">{speech.hasSections && <button className="icon-button" onClick={speech.previousSection} aria-label="Previous section" title="Previous section" type="button"><ChevronsLeft size={18} /></button>}<button className="icon-button" onClick={speech.previous} disabled={!speech.canPrevious} aria-label="Previous narration sentence" type="button"><SkipBack size={18} /></button><button className="icon-button" onClick={speech.togglePause} disabled={!speech.canPause && speech.status !== "paused"} aria-label={speech.status === "paused" ? "Resume narration" : "Pause narration"} type="button">{speech.status === "paused" ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}</button><button className="icon-button" onClick={speech.next} disabled={!speech.canNext} aria-label="Next narration sentence" type="button"><SkipForward size={18} /></button>{speech.hasSections && <button className="icon-button" onClick={speech.nextSection} aria-label="Next section" title="Next section" type="button"><ChevronsRight size={18} /></button>}<div className="audio-label"><strong>{speech.activeLabel || "Narration"} · {speech.progress.current + 1}/{speech.progress.total}</strong><span>{speech.currentText}</span></div>{speech.activeLabel === "Full lecture" && <button className="icon-button" onClick={bookmarkCurrentSentence} aria-label="Bookmark this sentence" title="Bookmark this sentence" type="button"><BookmarkPlus size={17} /></button>}<button className="icon-button" onClick={speech.stop} aria-label="Stop narration" type="button"><Square size={16} fill="currentColor" /></button></div>}
      {teaching && <TeachingMode title={document.title} source={source} onClose={() => setTeaching(false)} speech={speech} />}
      <AnnotationDialog draft={annotationDraft} onClose={() => setAnnotationDraft(null)} onSave={saveAnnotation} />
    </section>
  );
}
