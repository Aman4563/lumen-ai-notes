import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BrushCleaning,
  ChevronDown,
  Circle,
  Copy,
  Download,
  Ellipsis,
  Eraser,
  FileJson,
  Files,
  Grid2X2,
  Grid3x3,
  Grip,
  Highlighter,
  Image as ImageIcon,
  Import,
  Lock,
  LockOpen,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  PencilLine,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Shapes,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { getData, normalizeBoardDocument, updateDataGuarded } from "../lib/db";
import { createId } from "../lib/id.js";
import { boardPageToSvg } from "../lib/boardSvg.js";
import { exportBoardDocument, mergeImportedPages, parseBoardInterchange } from "../lib/boardInterchange.js";
import {
  approximateMeasure,
  boundsCenter,
  clampTranslation,
  fitPage,
  GRID_STEP,
  normalizePageSize,
  objectBounds,
  PAGE_FILL,
  pageSizeOf,
  placeBlock,
  placementOffset,
  rotatedBounds,
  rotatePoint,
  STICKY_PADDING_TOP,
  STICKY_PADDING_X,
  stickyHeightForText,
  stickyLayout,
  textLayout,
  translatePoints,
  translationBounds,
  unionBounds,
} from "../lib/boardGeometry.js";
import { BOARD_SHORTCUTS } from "../lib/boardShortcuts.js";
import {
  BOARD_SYNC_CHANNEL,
  BOARD_SYNC_SIGNAL_KEY,
  boardPayloadEqual,
  mergeBoardVersions,
} from "../lib/boardSync.js";
import { PROFILE_REPLACEMENT_EVENT } from "../lib/profileSync.js";
import { StorageBudgetError } from "../lib/storageBudget.js";

const inks = [
  { value: "#17283e", name: "Navy" },
  { value: "#e36f4a", name: "Coral" },
  { value: "#d8a326", name: "Amber" },
  { value: "#2c8b76", name: "Teal" },
  { value: "#5574c7", name: "Blue" },
  { value: "#7a5aa6", name: "Purple" },
];
const shapeTools = new Set(["line", "rectangle", "ellipse", "arrow"]);
const TOOL_DEFS = {
  select: { label: "Select and move objects", name: "Select and move", key: "v", icon: MousePointer2 },
  pen: { label: "Pen", name: "Pen", key: "p", icon: PenLine },
  marker: { label: "Highlighter", name: "Highlighter", key: "h", icon: Highlighter },
  eraser: { label: "Eraser", name: "Eraser", key: "e", icon: Eraser },
  line: { label: "Straight line", name: "Straight line", key: "l", icon: Minus },
  rectangle: { label: "Rectangle", name: "Rectangle", key: "r", icon: Square },
  ellipse: { label: "Ellipse", name: "Ellipse", key: "o", icon: Circle },
  arrow: { label: "Arrow", name: "Arrow", key: "a", icon: MoveUpRight },
  text: { label: "Text", name: "Text", key: "t", icon: Type },
  sticky: { label: "Sticky note", name: "Sticky note", key: "n", icon: StickyNote },
};
const TOOL_BY_KEY = Object.fromEntries(Object.entries(TOOL_DEFS).map(([id, definition]) => [definition.key, id]));
const toolTitle = (id) => `${TOOL_DEFS[id].name} (${TOOL_DEFS[id].key.toUpperCase()})`;
const OBJECT_NAMES = { pen: "Pen stroke", marker: "Highlighter stroke", line: "Straight line", rectangle: "Rectangle", ellipse: "Ellipse", arrow: "Arrow", text: "Text", sticky: "Sticky note" };
const describeObject = (object) => {
  const name = OBJECT_NAMES[object.tool] || "Object";
  const text = String(object.text || "").replace(/\s+/g, " ").trim();
  return text ? `${name} “${text.length > 48 ? `${text.slice(0, 47)}…` : text}”` : name;
};
// Phone portrait and landscape share the compact toolbar (BOARD-4/LAND).
const COMPACT_QUERY = "(max-width: 740px), (max-height: 540px)";
// A phone in landscape: its short canvas must never become the authoring
// size of a page that already has content (issue #55).
const isShortViewport = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-height: 540px)").matches);

const useMediaQuery = (query) => {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
};

const createBoard = () => {
  const id = createId();
  return {
    version: 2,
    activePageId: id,
    background: "grid",
    pages: [{ id, name: "Page 1", objects: [] }],
    syncMeta: { revision: 0, updatedAt: "", writerId: "", conflicts: [] },
  };
};

// One shared measuring context keeps canvas drawing, hit-testing, and the
// SVG export on identical line breaks.
let measureContext = null;
const measureText = (text, font) => {
  if (!measureContext && typeof document !== "undefined") measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) return approximateMeasure(text, font);
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

const roundedRect = (context, x, y, width, height, radius) => {
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
};

// Page background, drawn on its own layer so the eraser (which removes ink
// with destination-out) can never punch through it (BOARD-7).
const drawBackground = (context, size, background) => {
  const { width, height } = size;
  context.save();
  context.fillStyle = PAGE_FILL;
  context.fillRect(0, 0, width, height);
  if (background === "plain") {
    context.restore();
    return;
  }
  context.fillStyle = "rgba(20,34,52,.13)";
  context.strokeStyle = "rgba(20,34,52,.075)";
  context.lineWidth = 1;
  for (let x = GRID_STEP; x < width; x += GRID_STEP) {
    if (background === "dots") {
      for (let y = GRID_STEP; y < height; y += GRID_STEP) {
        context.beginPath();
        context.arc(x, y, 1.15, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }
  if (background === "grid") {
    for (let y = GRID_STEP; y < height; y += GRID_STEP) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }
  context.restore();
};

/**
 * Rotation (BOARD-001, issue #11) is a per-object angle in radians about the
 * bounds center, applied in authoring-pixel space. Points stay stored
 * unrotated; every pointer interaction maps through the object's local
 * (unrotated) frame.
 */
const applyObjectRotation = (context, object, size) => {
  if (!object.rotation) return;
  const center = boundsCenter(objectBounds(object, size, measureText));
  context.translate(center.x * size.width, center.y * size.height);
  context.rotate(object.rotation);
  context.translate(-center.x * size.width, -center.y * size.height);
};

/** Draws one object in authoring pixels (issue #55). */
function drawObject(context, object, size) {
  if (!object.points?.length) return;
  const { width, height } = size;
  const start = object.points[0];
  const end = object.points.at(-1);
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  context.save();
  applyObjectRotation(context, object, size);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = object.width;
  context.globalAlpha = object.tool === "marker" ? 0.26 : 1;
  context.globalCompositeOperation = object.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = object.color;
  context.fillStyle = object.color;

  if (object.tool === "text") {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    const layout = textLayout(object, size, measureText);
    context.font = layout.font;
    context.textBaseline = "top";
    layout.lines.forEach((line, index) => context.fillText(line, layout.x, layout.y + index * layout.lineHeight));
    context.restore();
    return;
  }

  if (object.tool === "sticky") {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    const card = stickyLayout(object, size, measureText);
    context.fillStyle = object.fill || "#fff1a8";
    context.strokeStyle = "rgba(70,55,18,.2)";
    context.lineWidth = 1.5;
    context.beginPath();
    roundedRect(context, card.x, card.y, card.width, card.height, 12);
    context.fill();
    context.stroke();
    context.fillStyle = object.color || "#17283e";
    context.font = card.font;
    context.textBaseline = "top";
    card.lines.forEach((line, index) => context.fillText(line, card.x + STICKY_PADDING_X, card.y + STICKY_PADDING_TOP + index * card.lineHeight));
    context.restore();
    return;
  }

  context.beginPath();
  if (shapeTools.has(object.tool) && object.points.length >= 2) {
    if (object.tool === "rectangle") context.rect(startX, startY, endX - startX, endY - startY);
    else if (object.tool === "ellipse") context.ellipse((startX + endX) / 2, (startY + endY) / 2, Math.abs(endX - startX) / 2, Math.abs(endY - startY) / 2, 0, 0, Math.PI * 2);
    else {
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      if (object.tool === "arrow") {
        const angle = Math.atan2(endY - startY, endX - startX);
        const head = Math.max(12, object.width * 4);
        context.moveTo(endX, endY);
        context.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
        context.moveTo(endX, endY);
        context.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
      }
    }
  } else {
    object.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x * width, point.y * height);
      else context.lineTo(point.x * width, point.y * height);
    });
    if (object.points.length === 1) context.lineTo(startX + 0.01, startY + 0.01);
  }
  context.stroke();
  context.restore();
}

// screen = view · fit · page: the zoom/pan view in canvas units, then the
// uniform fit of the page's authoring pixels into the canvas (issue #55).
const applyViewTransform = (context, { rect, fit }, view) => {
  context.translate(view.x * rect.width, view.y * rect.height);
  context.scale(view.scale, view.scale);
  context.translate(fit.left, fit.top);
  context.scale(fit.scale, fit.scale);
};
const clipToPage = (context, size) => {
  context.beginPath();
  context.rect(0, 0, size.width, size.height);
  context.clip();
};

// Selection chrome is sized in screen pixels: `chrome` is authoring pixels
// per screen pixel, so handles stay usable on a letterboxed or zoomed page.
const SELECTION_PADDING = 7;
const ROTATE_HANDLE_OFFSET = 26;
const resizeCorners = (bounds, size, chrome) => {
  const pad = SELECTION_PADDING * chrome;
  const left = bounds.minX * size.width - pad;
  const right = bounds.maxX * size.width + pad;
  const top = bounds.minY * size.height - pad;
  const bottom = bounds.maxY * size.height + pad;
  return [["tl", left, top], ["tr", right, top], ["bl", left, bottom], ["br", right, bottom]];
};

const drawSelection = (context, object, size, chrome, withRotateHandle = false) => {
  if (!object) return;
  const bounds = objectBounds(object, size, measureText);
  const pad = SELECTION_PADDING * chrome;
  const x = bounds.minX * size.width - pad;
  const y = bounds.minY * size.height - pad;
  const boxWidth = Math.max(18 * chrome, (bounds.maxX - bounds.minX) * size.width + pad * 2);
  const boxHeight = Math.max(18 * chrome, (bounds.maxY - bounds.minY) * size.height + pad * 2);
  context.save();
  applyObjectRotation(context, object, size);
  context.strokeStyle = "#c2452a";
  context.lineWidth = 1.5 * chrome;
  context.setLineDash([6 * chrome, 4 * chrome]);
  context.strokeRect(x, y, boxWidth, boxHeight);
  context.fillStyle = "#ffffff";
  context.setLineDash([]);
  // Text reflows instead of resizing, so it gets no corner handles (BOARD-19).
  if (object.tool !== "text" && !object.locked) {
    resizeCorners(bounds, size, chrome).forEach(([, cx, cy]) => {
      context.beginPath();
      context.arc(cx, cy, 5.5 * chrome, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  }
  if (withRotateHandle && !object.locked) {
    const handleX = x + boxWidth / 2;
    const handleY = y - ROTATE_HANDLE_OFFSET * chrome;
    context.beginPath();
    context.moveTo(handleX, y);
    context.lineTo(handleX, handleY + 6 * chrome);
    context.stroke();
    context.beginPath();
    context.arc(handleX, handleY, 6.5 * chrome, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
};

const useDialogKeyboard = (open, dialogRef, onClose) => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const background = [...document.querySelectorAll(".app-sidebar, .app-topbar, .bottom-nav, .advanced-board > :not(.modal-layer)")];
    background.forEach((region) => {
      region.inert = true;
      region.setAttribute("aria-hidden", "true");
    });
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  }, [dialogRef, open]);
};

function TextEntryDialog({ pending, onClose, onSubmit }) {
  const [text, setText] = useState(pending?.text || "");
  const [fontSize, setFontSize] = useState(pending?.fontSize || (pending?.tool === "sticky" ? 18 : 24));
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  useDialogKeyboard(Boolean(pending), dialogRef, onClose);
  useEffect(() => {
    setText(pending?.text || "");
    setFontSize(pending?.fontSize || (pending?.tool === "sticky" ? 18 : 24));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      // Editing continues where the text ends.
      input?.setSelectionRange?.(input.value.length, input.value.length);
    });
  }, [pending]);
  if (!pending) return null;
  const editing = pending.mode === "edit";
  const heading = editing ? `Edit ${pending.tool === "sticky" ? "sticky note" : "text"}` : `Add ${pending.tool === "sticky" ? "a sticky note" : "text"}`;
  return <div className="modal-layer board-text-layer"><button className="modal-scrim" onClick={onClose} aria-label="Cancel text entry" type="button" /><form ref={dialogRef} className="board-text-dialog" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onSubmit(text.trim(), fontSize); }} role="dialog" aria-modal="true" aria-labelledby="board-text-title"><div className="popover-heading"><div><span className="eyebrow">Whiteboard object</span><strong id="board-text-title">{heading}</strong></div><button className="icon-button small" onClick={onClose} aria-label="Cancel text entry" type="button"><X size={17} /></button></div><textarea ref={inputRef} value={text} maxLength={10_000} onChange={(event) => setText(event.target.value)} placeholder={pending.tool === "sticky" ? "Question, reminder, assumption, or interview insight…" : "Type a label or explanation…"} aria-label="Whiteboard text" /><label><span>Text size</span><input type="range" min="14" max="48" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /><strong>{fontSize}px</strong></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!text.trim()} type="submit">{editing ? "Save changes" : "Add to board"}</button></div></form></div>;
}

function RenamePageDialog({ page, onClose, onRename }) {
  const [name, setName] = useState(page?.name || "");
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  useDialogKeyboard(Boolean(page), dialogRef, onClose);
  useEffect(() => {
    if (!page) return undefined;
    setName(page.name);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return undefined;
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page) return null;
  return <div className="modal-layer board-text-layer"><button className="modal-scrim" onClick={onClose} aria-label="Cancel page rename" type="button" /><form ref={dialogRef} className="board-rename-dialog" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onRename(name.trim()); }} role="dialog" aria-modal="true" aria-labelledby="board-rename-title"><div className="popover-heading"><div><span className="eyebrow">Whiteboard page</span><strong id="board-rename-title">Rename page</strong></div><button className="icon-button small" onClick={onClose} aria-label="Cancel page rename" type="button"><X size={17} /></button></div><label><span>Page name</span><input ref={inputRef} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} aria-label="Whiteboard page name" /></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!name.trim()} type="submit">Save name</button></div></form></div>;
}

export default function Whiteboard({ documentId, documentTitle, notify }) {
  const rootRef = useRef(null);
  const toolbarRef = useRef(null);
  const canvasRef = useRef(null);
  const backdropRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(null);
  const movingRef = useRef(null);
  const saveTimerRef = useRef(null);
  const saveQueueRef = useRef(Promise.resolve());
  const saveSequenceRef = useRef(0);
  const signalBoardSyncRef = useRef(() => {});
  const boardWriterIdRef = useRef(createId());
  const replacementBlockedRef = useRef(false);
  const profileGenerationRef = useRef("");
  const knownConflictIdsRef = useRef(new Set());
  const boardRef = useRef(null);
  if (!boardRef.current) boardRef.current = createBoard();
  const boardBaseRef = useRef(boardRef.current);
  const loadedDocumentRef = useRef("");
  const historyRef = useRef({ past: [], future: [] });
  const [board, setBoard] = useState(boardRef.current);
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(inks[0].value);
  const [lineWidth, setLineWidth] = useState(3);
  const [selectedIds, setSelectedIds] = useState([]);
  const setSelectedId = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  const marqueeRef = useRef(null);
  const resizingRef = useRef(null);
  const rotatingRef = useRef(null);
  const panRef = useRef(null);
  // A tap/click gesture on the canvas: text and sticky placement and
  // double-tap editing run on the click that ends it (BOARD-1), never on
  // pointerdown, so a touch's follow-up click cannot land on a new scrim.
  const tapRef = useRef(null);
  const lastTapRef = useRef(null);
  const spaceHeldRef = useRef(false);
  const canvasSizeRef = useRef(null);
  // Zoom/pan (BOARD-003): screen = world · scale + offset, in normalized
  // canvas units. The page itself is fitted inside the canvas (issue #55).
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const compact = useMediaQuery(COMPACT_QUERY);
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  // A landscape phone keeps undo/redo in its sticky tool row (BOARD-LAND).
  const shortViewport = useMediaQuery("(max-height: 540px)");
  const helpId = useId();
  const pinchRef = useRef(new Map());
  const pinchStateRef = useRef(null);
  const clampView = (candidate) => {
    const scale = Math.max(1, Math.min(4, candidate.scale));
    return {
      scale,
      x: Math.max(1 - scale, Math.min(0, candidate.x)),
      y: Math.max(1 - scale, Math.min(0, candidate.y)),
    };
  };
  const zoomAround = (factor, centerX = 0.5, centerY = 0.5) => setView((current) => {
    const scale = Math.max(1, Math.min(4, current.scale * factor));
    const worldX = (centerX - current.x) / current.scale;
    const worldY = (centerY - current.y) / current.scale;
    return clampView({ scale, x: centerX - worldX * scale, y: centerY - worldY * scale });
  });
  const clipboardRef = useRef([]);
  const [pendingText, setPendingText] = useState(null);
  const [renamingPage, setRenamingPage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");

  boardRef.current = board;
  const activePage = useMemo(() => board.pages.find((page) => page.id === board.activePageId) || board.pages[0], [board]);
  const objects = activePage?.objects || [];
  const activePageSize = activePage?.size;
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : "";
  const selectedObject = objects.find((object) => object.id === selectedId);
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const activePageIndex = board.pages.findIndex((page) => page.id === activePage?.id);

  // The current canvas box, rounded, is the size a legacy or new page adopts.
  const measuredCanvasSize = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect && rect.width >= 100 && rect.height >= 100 ? normalizePageSize(rect) : null;
  };
  // `previous` is the page before the edit. A legacy page that already has
  // content keeps rendering in the live canvas while a phone is in landscape,
  // exactly like the adoption effect below, so the first edit there never
  // freezes a stretched aspect onto the existing drawing.
  const withAdoptedSize = (page, previous = page) => {
    if (page.size || (previous.objects?.length && isShortViewport())) return page;
    const size = measuredCanvasSize();
    return size ? { ...page, size } : page;
  };

  const syncHistoryCounts = () => setHistoryCounts({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  const setWithHistory = useCallback((updater) => {
    setBoard((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (!next || next === current) return current;
      historyRef.current.past = [...historyRef.current.past, current].slice(-60);
      historyRef.current.future = [];
      syncHistoryCounts();
      return next;
    });
  }, []);
  // Every object edit funnels through here, so a page adopts its authoring
  // size the moment it first receives content (issue #55).
  const updateActiveObjects = useCallback((updater, record = true) => {
    const apply = (current) => ({ ...current, pages: current.pages.map((page) => page.id === current.activePageId ? withAdoptedSize({ ...page, objects: (typeof updater === "function" ? updater(page.objects) : updater).slice(-5_000) }, page) : page) });
    if (record) setWithHistory(apply);
    else setBoard(apply);
  }, [setWithHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportBoardConflicts = useCallback((conflicts) => {
    const unseen = (conflicts || []).filter((conflict) => conflict?.id && !knownConflictIdsRef.current.has(conflict.id));
    unseen.forEach((conflict) => knownConflictIdsRef.current.add(conflict.id));
    if (unseen.length) notify?.("Concurrent whiteboard work was merged; conflicting edits were preserved on the board.", "warning", 6500);
  }, [notify]);

  const persistBoard = useCallback((targetDocumentId, localSnapshot, baseSnapshot, sequence = 0) => {
    if (replacementBlockedRef.current) return Promise.resolve(null);
    let mergeConflicts = [];
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => {
        if (replacementBlockedRef.current) return null;
        return updateDataGuarded(
          `board:${targetDocumentId}`,
          "profile",
          (storedProfile) => (
            (storedProfile?.syncMeta?.generation || "") === profileGenerationRef.current
            && !(storedProfile?.deletedCustomDocumentIds || []).includes(targetDocumentId)
            && (!targetDocumentId.startsWith("custom/") || (storedProfile?.customDocuments || []).some((document) => document.id === targetDocumentId))
          ),
          (stored) => {
          // The check inside the transaction fences a save that was queued
          // before a reset/restore but began after the replacement event.
          if (replacementBlockedRef.current) {
            const error = new Error("Whiteboard save cancelled by data replacement");
            error.name = "BoardReplacementAbort";
            throw error;
          }
          const result = mergeBoardVersions(baseSnapshot, localSnapshot, stored, {
            writerId: boardWriterIdRef.current,
          });
          mergeConflicts = result.conflicts;
          return result.board;
          },
        ).then((result) => {
          if (!result.applied) {
            replacementBlockedRef.current = true;
            clearTimeout(saveTimerRef.current);
            saveSequenceRef.current += 1;
            return null;
          }
          return result.value;
        });
      })
      .then((committedValue) => {
        if (!committedValue || replacementBlockedRef.current) return committedValue;
        const committed = normalizeBoardDocument(committedValue);
        signalBoardSyncRef.current(targetDocumentId, committed);
        if (loadedDocumentRef.current !== targetDocumentId) return committed;

        const current = boardRef.current;
        boardBaseRef.current = committed;
        reportBoardConflicts(mergeConflicts);
        if (boardPayloadEqual(current, localSnapshot)) {
          boardRef.current = committed;
          setBoard(committed);
          if (!sequence || sequence === saveSequenceRef.current) setSaveStatus("saved");
          return committed;
        }

        const rebased = mergeBoardVersions(localSnapshot, current, committed, {
          advanceRevision: false,
          writerId: boardWriterIdRef.current,
        });
        boardRef.current = rebased.board;
        setBoard(rebased.board);
        reportBoardConflicts(rebased.conflicts);
        return committed;
      })
      .catch((error) => {
        if (replacementBlockedRef.current) return;
        if (loadedDocumentRef.current === targetDocumentId && (!sequence || sequence === saveSequenceRef.current)) {
          setSaveStatus("error");
          notify?.(error instanceof StorageBudgetError
            ? `${error.message} This board change remains visible only in the current tab until you reduce local data.`
            : "Whiteboard changes could not be saved. Keep this tab open and retry after checking browser storage.", "error", 9000);
        }
      });
    return saveQueueRef.current;
  }, [notify, reportBoardConflicts]);

  useEffect(() => {
    const onProfileReplacement = (event) => {
      if (event.detail?.phase === "cancel") {
        replacementBlockedRef.current = false;
        // Re-trigger the normal debounce if a failed replacement left local
        // whiteboard work dirty.
        setBoard((current) => ({ ...current }));
        return;
      }
      replacementBlockedRef.current = true;
      clearTimeout(saveTimerRef.current);
      saveSequenceRef.current += 1;
    };
    window.addEventListener(PROFILE_REPLACEMENT_EVENT, onProfileReplacement);
    return () => window.removeEventListener(PROFILE_REPLACEMENT_EVENT, onProfileReplacement);
  }, []);

  useEffect(() => {
    let active = true;
    loadedDocumentRef.current = "";
    setLoaded(false);
    setSelectedId("");
    Promise.all([getData(`board:${documentId}`), getData("profile")])
      .then(([saved, storedProfile]) => {
        if (!active) return;
        profileGenerationRef.current = storedProfile?.syncMeta?.generation || "";
        const normalized = normalizeBoardDocument(saved);
        setBoard(normalized);
        boardRef.current = normalized;
        boardBaseRef.current = normalized;
        knownConflictIdsRef.current = new Set(normalized.syncMeta.conflicts.map((conflict) => conflict.id));
        historyRef.current = { past: [], future: [] };
        syncHistoryCounts();
      })
      .catch(() => {
        if (!active) return;
        const empty = createBoard();
        setBoard(empty);
        boardRef.current = empty;
        boardBaseRef.current = empty;
        notify?.("The saved whiteboard could not be restored.", "error");
      })
      .finally(() => {
        if (active) {
          loadedDocumentRef.current = documentId;
          setLoaded(true);
        }
      });
    return () => { active = false; };
  }, [documentId, notify]);

  useEffect(() => {
    if (!loaded || loadedDocumentRef.current !== documentId || replacementBlockedRef.current) return undefined;
    let active = true;
    let reading = false;
    let pending = false;
    let channel;

    const readLatestBoard = async () => {
      if (replacementBlockedRef.current) return;
      if (reading) {
        pending = true;
        return;
      }
      reading = true;
      try {
        do {
          pending = false;
          const storedValue = await getData(`board:${documentId}`);
          if (!active || replacementBlockedRef.current || !storedValue || loadedDocumentRef.current !== documentId) continue;
          const remote = normalizeBoardDocument(storedValue);
          const base = boardBaseRef.current;
          if (boardPayloadEqual(base, remote) && remote.syncMeta.revision <= (base.syncMeta?.revision || 0)) continue;
          const current = boardRef.current;
          const localDirty = !boardPayloadEqual(current, base);
          boardBaseRef.current = remote;
          if (!localDirty) {
            boardRef.current = remote;
            setBoard(remote);
            setSaveStatus("saved");
          } else {
            const rebased = mergeBoardVersions(base, current, remote, {
              advanceRevision: false,
              writerId: boardWriterIdRef.current,
            });
            boardRef.current = rebased.board;
            setBoard(rebased.board);
            reportBoardConflicts(rebased.conflicts);
          }
        } while (active && pending);
      } catch {
        // A later board signal or the normal save path will retry.
      } finally {
        reading = false;
      }
    };

    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(BOARD_SYNC_CHANNEL);
        channel.onmessage = (event) => {
          if (event.data?.origin !== boardWriterIdRef.current && event.data?.documentId === documentId) readLatestBoard();
        };
      }
    } catch {
      channel = null;
    }
    const onStorage = (event) => {
      if (event.key !== BOARD_SYNC_SIGNAL_KEY || !event.newValue) return;
      try {
        const signal = JSON.parse(event.newValue);
        if (signal.origin === boardWriterIdRef.current || signal.documentId !== documentId) return;
      } catch {
        // A malformed signal still warrants reading the authoritative board.
      }
      readLatestBoard();
    };
    window.addEventListener("storage", onStorage);
    signalBoardSyncRef.current = (changedDocumentId, committed) => {
      const signal = {
        origin: boardWriterIdRef.current,
        documentId: changedDocumentId,
        revision: committed?.syncMeta?.revision || 0,
        at: Date.now(),
      };
      try { channel?.postMessage(signal); } catch { /* storage event remains available */ }
      try { localStorage.setItem(BOARD_SYNC_SIGNAL_KEY, JSON.stringify(signal)); } catch { /* IndexedDB remains authoritative */ }
    };
    return () => {
      active = false;
      signalBoardSyncRef.current = () => {};
      window.removeEventListener("storage", onStorage);
      try { channel?.close(); } catch { /* already closed */ }
    };
  }, [documentId, loaded, reportBoardConflicts]);

  useEffect(() => {
    if (!loaded || loadedDocumentRef.current !== documentId || replacementBlockedRef.current) return undefined;
    clearTimeout(saveTimerRef.current);
    if (boardPayloadEqual(board, boardBaseRef.current)) {
      setSaveStatus("saved");
      return undefined;
    }
    const sequence = ++saveSequenceRef.current;
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(() => {
      persistBoard(documentId, board, boardBaseRef.current, sequence);
    }, 350);
    return () => clearTimeout(saveTimerRef.current);
  }, [board, documentId, loaded, persistBoard]);

  useEffect(() => {
    const flush = () => {
      if (replacementBlockedRef.current || !loaded || loadedDocumentRef.current !== documentId) return;
      clearTimeout(saveTimerRef.current);
      const current = boardRef.current;
      const base = boardBaseRef.current;
      if (!boardPayloadEqual(current, base)) persistBoard(documentId, current, base);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onVisibility); flush(); };
  }, [documentId, loaded, persistBoard]);

  // Legacy and imported pages without a size adopt the canvas they are first
  // shown on (issue #55), which is exactly how they already look there. A
  // phone rotated to landscape is skipped: its short canvas would freeze a
  // portrait drawing's aspect. Empty pages adopt on their first edit instead,
  // so merely opening a lecture's board never creates a stored record.
  useEffect(() => {
    if (!loaded || loadedDocumentRef.current !== documentId || replacementBlockedRef.current) return;
    if (!board.pages.some((page) => !page.size && page.objects.length)) return;
    if (isShortViewport()) return;
    const size = measuredCanvasSize();
    if (!size) return;
    setBoard((current) => ({ ...current, pages: current.pages.map((page) => page.size || !page.objects.length ? page : { ...page, size }) }));
  }, [board.pages, documentId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const readGeometry = () => {
    const rect = canvasRef.current.getBoundingClientRect();
    const size = pageSizeOf(activePage, rect);
    const fit = fitPage(rect, size);
    return { rect, size, fit, chrome: 1 / (fit.scale * view.scale) };
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvasSizeRef.current = { width: rect.width, height: rect.height };
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    const backdrop = backdropRef.current;
    [canvas, backdrop].forEach((layer) => {
      if (layer && (layer.width !== targetWidth || layer.height !== targetHeight)) { layer.width = targetWidth; layer.height = targetHeight; }
    });
    const size = pageSizeOf({ size: activePageSize }, rect);
    const fit = fitPage(rect, size);
    const geometry = { rect, size, fit };
    // The fitted page in canvas CSS pixels, for audits and tooling.
    Object.assign(canvas.dataset, {
      pageLeft: (view.x * rect.width + fit.left * view.scale).toFixed(2),
      pageTop: (view.y * rect.height + fit.top * view.scale).toFixed(2),
      pageWidth: (fit.width * view.scale).toFixed(2),
      pageHeight: (fit.height * view.scale).toFixed(2),
    });
    if (backdrop) {
      const context = backdrop.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.save();
      applyViewTransform(context, geometry, view);
      if (fit.left > 0.5 || fit.top > 0.5) {
        // A letterboxed page reads as a sheet on the desk.
        context.shadowColor = "rgba(20, 30, 50, 0.2)";
        context.shadowBlur = 14 * dpr;
        context.fillStyle = PAGE_FILL;
        context.fillRect(0, 0, size.width, size.height);
        context.shadowColor = "transparent";
      }
      drawBackground(context, size, board.background);
      context.restore();
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.save();
    applyViewTransform(context, geometry, view);
    clipToPage(context, size);
    objects.forEach((object) => drawObject(context, object, size));
    context.restore();
    context.save();
    applyViewTransform(context, geometry, view);
    const chrome = 1 / (fit.scale * view.scale);
    objects.filter((object) => selectedIds.includes(object.id)).forEach((object) => drawSelection(context, object, size, chrome, selectedIds.length === 1));
    context.restore();
  }, [activePageSize, board.background, objects, selectedIds, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey) {
        event.preventDefault();
        zoomAround(Math.exp(-event.deltaY * 0.01), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        return;
      }
      // Plain and Shift+wheel pan a zoomed board (BOARD-11). At 100% the
      // wheel is left alone so the page itself can scroll (landscape phones).
      if (viewRef.current.scale <= 1) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      let deltaX = event.deltaX * unit;
      let deltaY = event.deltaY * unit;
      if (event.shiftKey && !deltaX) { deltaX = deltaY; deltaY = 0; }
      setView((current) => clampView({ ...current, x: current.x - deltaX / rect.width, y: current.y - deltaY / rect.height }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  // Landscape phones scroll the board under a sticky toolbar; the canvas
  // height there is derived from these measured offsets (BOARD-LAND).
  useEffect(() => {
    const root = rootRef.current;
    const toolbar = toolbarRef.current;
    if (!root || !toolbar) return undefined;
    const update = () => {
      const topbar = document.querySelector(".app-topbar");
      root.style.setProperty("--board-offset-top", `${Math.round(topbar?.getBoundingClientRect().height || 0)}px`);
      root.style.setProperty("--board-toolbar-height", `${Math.round(toolbar.getBoundingClientRect().height)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
    // The compact and desktop layouts mount different toolbar elements.
  }, [compact]);

  useEffect(() => { setOpenPanel(null); }, [compact]);

  // Snap-to-grid (BOARD-001): quantize to the 24px grid in authoring pixels,
  // after the inverse view transform, so zoom and device never change it.
  // Freehand strokes and keyboard nudges are deliberately never snapped.
  const snapWorld = (point, size) => {
    if (!snapEnabled) return point;
    return {
      x: Math.max(0, Math.min(1, Math.round((point.x * size.width) / GRID_STEP) * GRID_STEP / size.width)),
      y: Math.max(0, Math.min(1, Math.round((point.y * size.height) / GRID_STEP) * GRID_STEP / size.height)),
    };
  };

  const pointFromEvent = (event, geometry = readGeometry()) => {
    const { rect, size, fit } = geometry;
    const canvasX = (((event.clientX - rect.left) / rect.width - view.x) / view.scale) * rect.width;
    const canvasY = (((event.clientY - rect.top) / rect.height - view.y) / view.scale) * rect.height;
    return {
      x: Math.max(0, Math.min(1, (canvasX - fit.left) / fit.scale / size.width)),
      y: Math.max(0, Math.min(1, (canvasY - fit.top) / fit.scale / size.height)),
    };
  };
  const pageCenterPoint = (geometry = readGeometry()) => pointFromEvent({ clientX: geometry.rect.left + geometry.rect.width / 2, clientY: geometry.rect.top + geometry.rect.height / 2 }, geometry);

  const hitTest = (point, geometry, pointerType = "mouse") => {
    const { size, chrome } = geometry;
    const slop = (pointerType === "mouse" ? 6 : 12) * chrome;
    return [...objects].reverse().find((object) => {
      if (object.tool === "eraser") return false;
      // Rotated objects hit-test in their local frame: inverse-rotate the
      // pointer around the bounds center, then the box compare is exact.
      const bounds = objectBounds(object, size, measureText);
      const local = object.rotation ? rotatePoint(point, boundsCenter(bounds), -object.rotation, size) : point;
      const reach = slop + (object.tool === "text" || object.tool === "sticky" ? 0 : object.width / 2);
      const marginX = reach / size.width;
      const marginY = reach / size.height;
      return local.x >= bounds.minX - marginX && local.x <= bounds.maxX + marginX && local.y >= bounds.minY - marginY && local.y <= bounds.maxY + marginY;
    });
  };

  const announce = (message) => setAnnouncement((current) => current === message ? `${message} ` : message);
  const chooseTool = (next) => {
    setTool(next);
    setOpenPanel(null);
    // A selection must never linger invisibly behind a drawing tool (BOARD-6).
    if (next !== "select") setSelectedIds([]);
  };
  const togglePanel = (name) => setOpenPanel((current) => current === name ? null : name);
  const openEditor = (object) => {
    if (!object || object.locked || !["text", "sticky"].includes(object.tool)) return;
    setPendingText({ mode: "edit", tool: object.tool, id: object.id, text: object.text, fontSize: object.fontSize });
  };

  const selectPointerDown = (event, point, geometry) => {
    const { size, chrome } = geometry;
    // Rotate (BOARD-001, issue #11) and resize (all four corners, BOARD-19)
    // handles of a single selection; hit zones grow for touch and pen.
    if (selectedObjects.length === 1 && !selectedObjects[0].locked) {
      const target = selectedObjects[0];
      const bounds = objectBounds(target, size, measureText);
      const center = boundsCenter(bounds);
      const local = target.rotation ? rotatePoint(point, center, -target.rotation, size) : point;
      const localX = local.x * size.width;
      const localY = local.y * size.height;
      const reach = (event.pointerType === "mouse" ? 14 : 22) * chrome;
      const rotateHandleY = bounds.minY * size.height - (SELECTION_PADDING + ROTATE_HANDLE_OFFSET) * chrome;
      if (Math.abs(localX - center.x * size.width) < reach && Math.abs(localY - rotateHandleY) < reach) {
        rotatingRef.current = {
          id: target.id,
          center,
          startPointerAngle: Math.atan2((point.y - center.y) * size.height, (point.x - center.x) * size.width),
          startRotation: target.rotation || 0,
          before: boardRef.current,
          rotated: false,
        };
        return;
      }
      if (target.tool !== "text") {
        const inside = local.x >= bounds.minX && local.x <= bounds.maxX && local.y >= bounds.minY && local.y <= bounds.maxY;
        const [nearest] = resizeCorners(bounds, size, chrome)
          .map(([name, cornerX, cornerY]) => ({ name, distance: Math.max(Math.abs(localX - cornerX), Math.abs(localY - cornerY)) }))
          .sort((left, right) => left.distance - right.distance);
        // Inside a small object the body wins, so it can still be dragged.
        if (nearest.distance < reach && (!inside || nearest.distance < 10 * chrome)) {
          resizingRef.current = {
            id: target.id,
            corner: nearest.name,
            bounds,
            rotation: target.rotation || 0,
            center,
            originalPoints: target.points.map((item) => ({ ...item })),
            before: boardRef.current,
            resized: false,
          };
          return;
        }
      }
    }
    const hit = hitTest(point, geometry, event.pointerType);
    if (hit && event.shiftKey) {
      setSelectedIds((current) => current.includes(hit.id) ? current.filter((id) => id !== hit.id) : [...current, hit.id]);
      return;
    }
    if (hit) {
      const group = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
      setSelectedIds(group);
      const movable = objects.filter((object) => group.includes(object.id) && !object.locked);
      if (movable.length) {
        const anchorBounds = objectBounds(objects.find((object) => object.id === hit.id) || movable[0], size, measureText);
        movingRef.current = {
          ids: movable.map((object) => object.id),
          start: point,
          anchorMin: { x: anchorBounds.minX, y: anchorBounds.minY },
          // The whole group's extent limits the move (BOARD-5).
          limits: translationLimits(movable, size),
          originals: new Map(movable.map((object) => [object.id, object.points])),
          before: boardRef.current,
          moved: false,
        };
      }
      return;
    }
    // Empty space starts a marquee: release selects every contained object.
    setSelectedIds([]);
    marqueeRef.current = { start: point, end: point };
  };

  const startDrawing = (event) => {
    const canvas = canvasRef.current;
    const geometry = readGeometry();
    // Middle-button or Space+drag pans a zoomed board (BOARD-11).
    if ((event.pointerType === "mouse" && event.button === 1) || (spaceHeldRef.current && event.button === 0)) {
      event.preventDefault();
      try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Capture is optional for panning. */ }
      panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startView: view };
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    // Pointer work on the board moves keyboard focus to it, so board keys
    // act on the board and never on a control that was focused before.
    canvas.focus({ preventScroll: true });
    const point = pointFromEvent(event, geometry);
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Some iOS pointer streams do not expose capture. */ }
    pinchRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pinchRef.current.size === 2) {
      // Two fingers switch to pinch zoom/pan; abandon any started stroke.
      if (tapRef.current) tapRef.current.cancelled = true;
      drawingRef.current = null;
      movingRef.current = null;
      marqueeRef.current = null;
      resizingRef.current = null;
      rotatingRef.current = null;
      const [first, second] = [...pinchRef.current.values()];
      const { rect } = geometry;
      pinchStateRef.current = {
        startDistance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
        startView: view,
        midpoint: { x: ((first.clientX + second.clientX) / 2 - rect.left) / rect.width, y: ((first.clientY + second.clientY) / 2 - rect.top) / rect.height },
      };
      redraw();
      return;
    }
    tapRef.current = { pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY, moved: false, cancelled: false };
    if (tool === "select") {
      selectPointerDown(event, point, geometry);
      return;
    }
    // Text and sticky notes are placed when this tap lifts (finishDrawing).
    if (tool === "text" || tool === "sticky") return;
    if (selectedIds.length) setSelectedIds([]);
    drawingRef.current = { id: createId(), tool, color, fill: "#fff1a8", fontSize: 24, text: "", width: (tool === "eraser" ? lineWidth * 5 : tool === "marker" ? lineWidth * 4 : lineWidth) * (event.pointerType === "pen" ? 0.72 + Math.max(event.pressure, 0.1) * 0.7 : 1), points: [shapeTools.has(tool) ? snapWorld(point, geometry.size) : point] };
  };

  const continueDrawing = (event) => {
    const tap = tapRef.current;
    if (tap && tap.pointerId === event.pointerId && Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) > 8) tap.moved = true;
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      event.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      setView(clampView({ ...pan.startView, x: pan.startView.x + (event.clientX - pan.clientX) / rect.width, y: pan.startView.y + (event.clientY - pan.clientY) / rect.height }));
      return;
    }
    if (pinchRef.current.has(event.pointerId)) pinchRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pinchStateRef.current && pinchRef.current.size === 2) {
      event.preventDefault();
      const [first, second] = [...pinchRef.current.values()];
      const rect = canvasRef.current.getBoundingClientRect();
      const pinch = pinchStateRef.current;
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      const factor = distance / Math.max(1, pinch.startDistance);
      const midpoint = { x: ((first.clientX + second.clientX) / 2 - rect.left) / rect.width, y: ((first.clientY + second.clientY) / 2 - rect.top) / rect.height };
      const scale = Math.max(1, Math.min(4, pinch.startView.scale * factor));
      const worldX = (pinch.midpoint.x - pinch.startView.x) / pinch.startView.scale;
      const worldY = (pinch.midpoint.y - pinch.startView.y) / pinch.startView.scale;
      setView(clampView({ scale, x: midpoint.x - worldX * scale, y: midpoint.y - worldY * scale }));
      return;
    }
    if (rotatingRef.current) {
      event.preventDefault();
      const geometry = readGeometry();
      const { size } = geometry;
      const point = pointFromEvent(event, geometry);
      const rotating = rotatingRef.current;
      const pointerAngle = Math.atan2((point.y - rotating.center.y) * size.height, (point.x - rotating.center.x) * size.width);
      let rotation = rotating.startRotation + pointerAngle - rotating.startPointerAngle;
      rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
      // Snap mode quantizes to 15° so square alignments are reachable.
      if (snapEnabled) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
      if (Math.abs(rotation) < 0.01) rotation = 0;
      rotating.rotated = true;
      updateActiveObjects((current) => current.map((object) => object.id === rotating.id ? { ...object, rotation } : object), false);
      return;
    }
    if (resizingRef.current) {
      event.preventDefault();
      const geometry = readGeometry();
      const { size } = geometry;
      const resize = resizingRef.current;
      // A rotated object resizes in its local frame: inverse-rotate the
      // pointer around the ORIGINAL center so the corner math stays exact.
      const rawPoint = pointFromEvent(event, geometry);
      const cornerPoint = snapWorld(resize.rotation ? rotatePoint(rawPoint, resize.center, -resize.rotation, size) : rawPoint, size);
      const { minX, minY, maxX, maxY } = resize.bounds;
      // The dragged corner scales the object about the opposite corner.
      const fromLeft = resize.corner[1] === "l";
      const fromTop = resize.corner[0] === "t";
      const anchorX = fromLeft ? maxX : minX;
      const anchorY = fromTop ? maxY : minY;
      const spanX = (fromLeft ? minX : maxX) - anchorX;
      const spanY = (fromTop ? minY : maxY) - anchorY;
      const scaleX = Math.abs(spanX) < 1e-6 ? 1 : Math.max(0.05, (cornerPoint.x - anchorX) / spanX);
      const scaleY = Math.abs(spanY) < 1e-6 ? 1 : Math.max(0.05, (cornerPoint.y - anchorY) / spanY);
      const scalePoint = (item) => ({ ...item, x: Math.max(0, Math.min(1, anchorX + (item.x - anchorX) * scaleX)), y: Math.max(0, Math.min(1, anchorY + (item.y - anchorY) * scaleY)) });
      resize.resized = true;
      updateActiveObjects((current) => current.map((object) => {
        if (object.id !== resize.id) return object;
        if (object.tool !== "sticky") return { ...object, points: resize.originalPoints.map(scalePoint) };
        const first = scalePoint({ x: minX, y: minY });
        const second = scalePoint({ x: maxX, y: maxY });
        return { ...object, points: [{ x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) }, { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) }] };
      }), false);
      return;
    }
    if (movingRef.current) {
      event.preventDefault();
      const geometry = readGeometry();
      const point = pointFromEvent(event, geometry);
      const move = movingRef.current;
      let deltaX = point.x - move.start.x;
      let deltaY = point.y - move.start.y;
      if (snapEnabled && move.anchorMin) {
        const snapped = snapWorld({ x: move.anchorMin.x + deltaX, y: move.anchorMin.y + deltaY }, geometry.size);
        deltaX = snapped.x - move.anchorMin.x;
        deltaY = snapped.y - move.anchorMin.y;
      }
      const delta = clampTranslation(move.limits, deltaX, deltaY);
      move.moved = move.moved || Math.abs(delta.x) + Math.abs(delta.y) > 0.002;
      updateActiveObjects((current) => current.map((object) => move.originals.has(object.id)
        ? { ...object, points: translatePoints(move.originals.get(object.id), delta) }
        : object), false);
      return;
    }
    if (marqueeRef.current) {
      event.preventDefault();
      const geometry = readGeometry();
      marqueeRef.current.end = pointFromEvent(event, geometry);
      redraw();
      const { start, end } = marqueeRef.current;
      const { size, chrome } = geometry;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const context = canvasRef.current.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.save();
      applyViewTransform(context, geometry, view);
      context.strokeStyle = "#c2452a";
      context.setLineDash([5 * chrome, 4 * chrome]);
      context.lineWidth = 1.2 * chrome;
      context.strokeRect(Math.min(start.x, end.x) * size.width, Math.min(start.y, end.y) * size.height, Math.abs(end.x - start.x) * size.width, Math.abs(end.y - start.y) * size.height);
      context.restore();
      return;
    }
    if (!drawingRef.current) return;
    event.preventDefault();
    const geometry = readGeometry();
    const coalesced = event.getCoalescedEvents?.();
    const nextPoints = (coalesced?.length ? coalesced : [event]).map((item) => pointFromEvent(item, geometry));
    const isShape = shapeTools.has(drawingRef.current.tool);
    const previous = drawingRef.current.points.at(-1);
    if (isShape) drawingRef.current.points = [drawingRef.current.points[0], snapWorld(nextPoints.at(-1), geometry.size)];
    else drawingRef.current.points.push(...nextPoints);
    if (isShape) redraw();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const context = canvasRef.current.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.save();
    applyViewTransform(context, geometry, view);
    clipToPage(context, geometry.size);
    // Freehand ink (eraser included) is drawn incrementally on the ink layer;
    // the background lives on its own canvas underneath (BOARD-7).
    drawObject(context, isShape ? drawingRef.current : { ...drawingRef.current, points: [previous, ...nextPoints] }, geometry.size);
    context.restore();
  };

  const finishDrawing = (event) => {
    if (event.type === "pointercancel" && tapRef.current?.pointerId === event.pointerId) tapRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    pinchRef.current.delete(event.pointerId);
    // Text and sticky notes are placed when the tap lifts. Browsers do not
    // reliably synthesize a click after a touch sequence whose pointerdown
    // was handled (Chrome on Linux and Android can skip it), so pointerup is
    // the only event a tap is sure to deliver.
    const placementTap = tapRef.current;
    if (event.type === "pointerup" && (tool === "text" || tool === "sticky") && placementTap?.pointerId === event.pointerId && !pinchStateRef.current) {
      tapRef.current = null;
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      if (placementTap.moved || placementTap.cancelled) return;
      swallowCompatibilityClick(event.clientX, event.clientY);
      const geometry = readGeometry();
      setSelectedIds([]);
      setPendingText({ mode: "create", tool, point: snapWorld(pointFromEvent(event, geometry), geometry.size) });
      return;
    }
    if (pinchStateRef.current) {
      if (pinchRef.current.size < 2) pinchStateRef.current = null;
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    if (rotatingRef.current) {
      const rotating = rotatingRef.current;
      rotatingRef.current = null;
      if (rotating.rotated) {
        historyRef.current.past = [...historyRef.current.past, rotating.before].slice(-60);
        historyRef.current.future = [];
        syncHistoryCounts();
      }
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    if (resizingRef.current) {
      const resize = resizingRef.current;
      resizingRef.current = null;
      if (resize.resized) {
        historyRef.current.past = [...historyRef.current.past, resize.before].slice(-60);
        historyRef.current.future = [];
        syncHistoryCounts();
      }
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    if (marqueeRef.current) {
      const { start, end } = marqueeRef.current;
      marqueeRef.current = null;
      const box = { minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x), minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y) };
      if ((box.maxX - box.minX) + (box.maxY - box.minY) > 0.01) {
        const { size } = readGeometry();
        const contained = objects.filter((object) => {
          if (object.tool === "eraser" || object.locked) return false;
          const bounds = rotatedBounds(object, size, measureText);
          return bounds.minX >= box.minX && bounds.maxX <= box.maxX && bounds.minY >= box.minY && bounds.maxY <= box.maxY;
        }).map((object) => object.id);
        setSelectedIds(contained);
        if (contained.length) notify?.(`${contained.length} object${contained.length === 1 ? "" : "s"} selected. Drag to move them together.`);
      }
      redraw();
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    if (movingRef.current) {
      const move = movingRef.current;
      movingRef.current = null;
      if (move.moved) {
        historyRef.current.past = [...historyRef.current.past, move.before].slice(-60);
        historyRef.current.future = [];
        syncHistoryCounts();
      }
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    if (!drawingRef.current) return;
    event.preventDefault();
    if (event.type === "pointercancel") {
      drawingRef.current = null;
      redraw();
      return;
    }
    const draft = drawingRef.current;
    const geometry = readGeometry();
    const endpoint = pointFromEvent(event, geometry);
    if (shapeTools.has(draft.tool)) draft.points = [draft.points[0], snapWorld(endpoint, geometry.size)];
    else {
      const previous = draft.points.at(-1);
      if (!previous || Math.abs(previous.x - endpoint.x) + Math.abs(previous.y - endpoint.y) > 0.0005) draft.points.push(endpoint);
    }
    const start = draft.points[0];
    const end = draft.points.at(-1);
    const distance = Math.hypot((end.x - start.x) * geometry.size.width, (end.y - start.y) * geometry.size.height) * geometry.fit.scale;
    if (shapeTools.has(draft.tool) && distance < 3) {
      drawingRef.current = null;
      redraw();
      notify?.("Drag across the board to draw a visible shape.", "warning");
      try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
      return;
    }
    const finalObject = { ...draft, points: draft.points.slice(0, 20_000) };
    drawingRef.current = null;
    updateActiveObjects((current) => [...current, finalObject]);
    try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
  };

  // A placing tap may still be followed by a compatibility click. Swallow it so
  // it cannot land on the new dialog's scrim and close it (BOARD-1). Only a
  // click at the tap's own position counts: when the browser sends none, the
  // learner's next real click elsewhere must go through.
  const swallowCompatibilityClick = (tapX, tapY) => {
    const stop = () => window.removeEventListener("click", swallow, true);
    const swallow = (clickEvent) => {
      if (Math.hypot(clickEvent.clientX - tapX, clickEvent.clientY - tapY) > 16) return;
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      stop();
    };
    window.addEventListener("click", swallow, true);
    setTimeout(stop, 600);
  };

  // The click that ends a select-tool tap counts double-taps for editing
  // (BOARD-EDIT); text and sticky placement happens on pointerup above.
  const handleCanvasClick = (event) => {
    const gesture = tapRef.current;
    tapRef.current = null;
    if (!gesture || gesture.moved || gesture.cancelled) return;
    if (tool !== "select") return;
    const geometry = readGeometry();
    const point = pointFromEvent(event, geometry);
    const hit = hitTest(point, geometry, gesture.pointerType);
    if (!hit || hit.locked || !["text", "sticky"].includes(hit.tool)) {
      lastTapRef.current = null;
      return;
    }
    const previous = lastTapRef.current;
    if (event.detail >= 2 || (previous && previous.id === hit.id && event.timeStamp - previous.time < 450)) {
      lastTapRef.current = null;
      openEditor(hit);
      return;
    }
    lastTapRef.current = { id: hit.id, time: event.timeStamp };
  };

  const undo = useCallback(() => {
    setBoard((current) => {
      const previous = historyRef.current.past.at(-1);
      if (!previous) return current;
      historyRef.current.past = historyRef.current.past.slice(0, -1);
      historyRef.current.future = [current, ...historyRef.current.future].slice(0, 60);
      syncHistoryCounts();
      setSelectedId("");
      return previous;
    });
  }, []);
  const redo = useCallback(() => {
    setBoard((current) => {
      const next = historyRef.current.future[0];
      if (!next) return current;
      historyRef.current.future = historyRef.current.future.slice(1);
      historyRef.current.past = [...historyRef.current.past, current].slice(-60);
      syncHistoryCounts();
      setSelectedId("");
      return next;
    });
  }, []);

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const removing = new Set(selectedObjects.filter((object) => !object.locked).map((object) => object.id));
    if (!removing.size) {
      notify?.("The selection is locked. Unlock it first.", "warning");
      return;
    }
    updateActiveObjects((current) => current.filter((object) => !removing.has(object.id)));
    setSelectedIds([]);
    notify?.(`${removing.size === 1 ? "Selected object" : `${removing.size} objects`} deleted. Undo is available.`);
  };
  const groupBounds = (list, size) => unionBounds(list.map((object) => rotatedBounds(object, size, measureText)));
  // Translations keep rotated objects' stored points on the page too, so
  // they can never be clamped into a squashed shape (BOARD-5).
  const translationLimits = (list, size) => unionBounds(list.map((object) => translationBounds(object, size, measureText)));
  // Duplicates and pastes shift as one group and flip direction at an edge
  // instead of clamping point by point (BOARD-5).
  const cloneWithDelta = (object, delta) => ({
    ...object,
    locked: false,
    id: createId(),
    points: translatePoints(object.points, delta),
  });
  const duplicateSelected = () => {
    if (!selectedObjects.length) return;
    const delta = placementOffset(translationLimits(selectedObjects, readGeometry().size), 0.025);
    const duplicates = selectedObjects.map((object) => cloneWithDelta(object, delta));
    updateActiveObjects((current) => [...current, ...duplicates]);
    setSelectedIds(duplicates.map((object) => object.id));
  };
  const toggleLockSelected = () => {
    if (!selectedObjects.length) return;
    const lockAll = !selectedObjects.every((object) => object.locked);
    const targets = new Set(selectedIds);
    updateActiveObjects((current) => current.map((object) => targets.has(object.id) ? { ...object, locked: lockAll } : object));
    notify?.(lockAll ? "Selection locked — it stays visible and selectable but refuses edits." : "Selection unlocked.");
  };

  // Z-order (BOARD-001): the renderer draws in array order, so reordering the
  // array is the whole feature; the order-aware board merge keeps it durable.
  const reorderSelected = (direction) => {
    const movable = new Set(selectedObjects.filter((object) => !object.locked).map((object) => object.id));
    if (!movable.size) return;
    updateActiveObjects((current) => {
      const result = [...current];
      const indices = result.map((object, index) => ({ object, index })).filter((entry) => movable.has(entry.object.id));
      const ordered = direction > 0 ? [...indices].reverse() : indices;
      for (const entry of ordered) {
        const from = result.indexOf(entry.object);
        let to = from + direction;
        // Skip past other selected objects so relative order is preserved.
        while (to >= 0 && to < result.length && movable.has(result[to].id)) to += direction;
        if (to < 0 || to >= result.length) continue;
        const [moved] = result.splice(from, 1);
        result.splice(to, 0, moved);
      }
      return result;
    });
  };
  const bringForward = () => reorderSelected(1);
  const sendBackward = () => reorderSelected(-1);

  const copySelected = () => {
    if (!selectedObjects.length) return;
    clipboardRef.current = selectedObjects.map((object) => ({ ...object, points: object.points.map((point) => ({ ...point })) }));
    notify?.(`${selectedObjects.length} object${selectedObjects.length === 1 ? "" : "s"} copied. Paste with ⌘/Ctrl + V.`);
  };
  const pasteClipboard = () => {
    if (!clipboardRef.current.length) return;
    const delta = placementOffset(translationLimits(clipboardRef.current, readGeometry().size), 0.03);
    const pasted = clipboardRef.current.map((object) => cloneWithDelta(object, delta));
    updateActiveObjects((current) => [...current, ...pasted]);
    setSelectedIds(pasted.map((object) => object.id));
    notify?.(`${pasted.length} object${pasted.length === 1 ? "" : "s"} pasted.`);
  };
  const selectAll = () => {
    const ids = objects.filter((object) => object.tool !== "eraser").map((object) => object.id);
    setSelectedIds(ids);
    if (tool !== "select") setTool("select");
    announce(`${ids.length} object${ids.length === 1 ? "" : "s"} selected.`);
  };

  // Keyboard nudging (A11Y-001): arrow keys move the selection by 1% of the
  // page (Shift: 5%) through the normal history path. The whole group moves
  // by one delta, limited at the page edge (BOARD-5).
  const nudgeSelected = (deltaX, deltaY) => {
    const moving = selectedObjects.filter((object) => !object.locked);
    if (!moving.length) return;
    const delta = clampTranslation(translationLimits(moving, readGeometry().size), deltaX, deltaY);
    if (!delta.x && !delta.y) return;
    const ids = new Set(moving.map((object) => object.id));
    updateActiveObjects((current) => current.map((object) => ids.has(object.id) ? { ...object, points: translatePoints(object.points, delta) } : object));
  };

  // Keyboard selection (BOARD-13): with the drawing surface focused, Tab and
  // Shift+Tab step through objects in z-order and announce each one; past
  // either end, focus leaves the board as usual.
  const cycleSelection = (event) => {
    const selectable = objects.filter((object) => object.tool !== "eraser");
    if (!selectable.length) return;
    const index = selectedIds.length ? selectable.findIndex((object) => object.id === selectedIds.at(-1)) : -1;
    const next = index === -1 ? (event.shiftKey ? selectable.length - 1 : 0) : index + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= selectable.length) {
      setSelectedIds([]);
      return;
    }
    event.preventDefault();
    const object = selectable[next];
    setSelectedIds([object.id]);
    if (tool !== "select") setTool("select");
    announce(`${describeObject(object)}, ${next + 1} of ${selectable.length}${object.locked ? ", locked" : ""}.`);
  };

  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    // Native controls and every open dialog or menu keep their own keys, and
    // nothing may edit the board behind a modal (BOARD-6).
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    if (pendingText || renamingPage || target?.closest?.('[role="dialog"], [aria-modal="true"], [role="menu"]') || document.querySelector('[aria-modal="true"]')) return;
    const canvas = canvasRef.current;
    const onCanvas = target === canvas;
    if (!onCanvas && target !== document.body && target !== document.documentElement && !rootRef.current?.contains(target)) return;
    const { key } = event;
    const lower = key.length === 1 ? key.toLocaleLowerCase() : key;
    const command = event.metaKey || event.ctrlKey;
    if (command && lower === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (key === "Escape") {
      if (openPanel) {
        const toggle = rootRef.current?.querySelector(`[data-board-toggle="${openPanel}"]`);
        setOpenPanel(null);
        toggle?.focus();
      } else if (selectedIds.length) {
        setSelectedIds([]);
        announce("Selection cleared.");
      }
      return;
    }
    // Single-letter tool keys act only while focus is inside the board
    // (WCAG 2.1.4), never from the bare page.
    if (!command && !event.altKey && !event.shiftKey && TOOL_BY_KEY[lower] && (onCanvas || rootRef.current?.contains(target))) {
      chooseTool(TOOL_BY_KEY[lower]);
      announce(`${TOOL_DEFS[TOOL_BY_KEY[lower]].name} tool.`);
      return;
    }
    // Space, Tab, and Enter keep their native meaning everywhere but the
    // drawing surface itself.
    if (key === " " && onCanvas) {
      event.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpacePanning(true);
      }
    } else if (command && lower === "c" && selectedIds.length) { event.preventDefault(); copySelected(); }
    else if (command && lower === "v" && clipboardRef.current.length) { event.preventDefault(); pasteClipboard(); }
    else if (command && lower === "a") { event.preventDefault(); selectAll(); }
    else if ((key === "Delete" || key === "Backspace") && selectedIds.length) { event.preventDefault(); deleteSelected(); }
    else if (key.startsWith("Arrow")) {
      const step = event.shiftKey ? 0.05 : 0.01;
      const deltaX = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const deltaY = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      if (selectedIds.length) {
        event.preventDefault();
        nudgeSelected(deltaX, deltaY);
      } else if (onCanvas && view.scale > 1) {
        event.preventDefault();
        setView((current) => clampView({ ...current, x: current.x - deltaX * 2, y: current.y - deltaY * 2 }));
      }
    } else if (onCanvas && key === "Tab" && !command && !event.altKey) cycleSelection(event);
    else if (onCanvas && key === "Enter") {
      if (selectedObject && ["text", "sticky"].includes(selectedObject.tool) && !selectedObject.locked) {
        event.preventDefault();
        openEditor(selectedObject);
      } else if (tool === "text" || tool === "sticky") {
        event.preventDefault();
        const geometry = readGeometry();
        setPendingText({ mode: "create", tool, point: snapWorld(pageCenterPoint(geometry), geometry.size) });
      }
    }
  };
  useEffect(() => {
    const onKeyDown = (event) => keyHandlerRef.current?.(event);
    const releaseSpace = () => {
      spaceHeldRef.current = false;
      setSpacePanning(false);
    };
    const onKeyUp = (event) => { if (event.key === " ") releaseSpace(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, []);

  // Tapping anywhere outside an open toolbar panel or menu closes it; a tap
  // on the drawing surface only dismisses and never draws.
  useEffect(() => {
    if (!openPanel) return undefined;
    const onPointerDown = (event) => {
      const root = rootRef.current;
      const panel = root?.querySelector(`[data-board-panel="${openPanel}"]`);
      const toggle = root?.querySelector(`[data-board-toggle="${openPanel}"]`);
      if (panel?.contains(event.target) || toggle?.contains(event.target)) return;
      setOpenPanel(null);
      if (event.target === canvasRef.current) {
        event.stopPropagation();
        event.preventDefault();
        tapRef.current = null;
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openPanel]);
  useEffect(() => {
    if (openPanel !== "export") return;
    requestAnimationFrame(() => rootRef.current?.querySelector('#board-export-menu [role="menuitem"]')?.focus());
  }, [openPanel]);
  // An open panel or menu ends above the fixed bottom navigation and scrolls
  // inside itself on short screens, so every option stays reachable.
  useLayoutEffect(() => {
    const panel = openPanel && rootRef.current?.querySelector(`[data-board-panel="${openPanel}"]`);
    if (!panel) return undefined;
    const fit = () => {
      const nav = document.querySelector(".bottom-nav");
      const limit = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
      panel.style.maxHeight = `${Math.max(140, Math.floor(limit - panel.getBoundingClientRect().top - 8))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      panel.style.maxHeight = "";
    };
  }, [openPanel]);

  const clear = () => {
    if (!objects.length || !window.confirm("Clear every object on this page? You can undo this action.")) return;
    updateActiveObjects([]);
    setSelectedId("");
    setOpenPanel(null);
    notify?.("Page cleared. Undo is available.");
  };
  const addPage = () => {
    if (board.pages.length >= 20) { notify?.("A board can contain up to 20 pages.", "error"); return; }
    const id = createId();
    const size = measuredCanvasSize();
    setWithHistory((current) => ({ ...current, activePageId: id, pages: [...current.pages, { id, name: `Page ${current.pages.length + 1}`, ...(size ? { size } : {}), objects: [] }] }));
    setSelectedId("");
  };
  const duplicatePage = () => {
    if (board.pages.length >= 20) { notify?.("A board can contain up to 20 pages.", "error"); return; }
    const id = createId();
    setWithHistory((current) => {
      const page = current.pages.find((item) => item.id === current.activePageId);
      return { ...current, activePageId: id, pages: [...current.pages, { id, name: `${page.name} copy`.slice(0, 60), ...(page.size ? { size: { ...page.size } } : {}), objects: page.objects.map((object) => ({ ...object, id: createId(), points: object.points.map((point) => ({ ...point })) })) }] };
    });
    setSelectedId("");
  };
  const deletePage = () => {
    if (board.pages.length === 1) { clear(); return; }
    if (!window.confirm(`Delete ${activePage.name} and all of its objects?`)) return;
    setWithHistory((current) => {
      const index = current.pages.findIndex((page) => page.id === current.activePageId);
      const pages = current.pages.filter((page) => page.id !== current.activePageId);
      return { ...current, pages, activePageId: pages[Math.min(index, pages.length - 1)].id };
    });
    setSelectedId("");
  };
  const switchPage = (id) => { setBoard((current) => ({ ...current, activePageId: id })); setSelectedId(""); };
  const renamePage = (name) => {
    setWithHistory((current) => ({ ...current, pages: current.pages.map((page) => page.id === current.activePageId ? { ...page, name: name.slice(0, 60) } : page) }));
    setRenamingPage(false);
    notify?.("Whiteboard page renamed.");
  };
  const changeBackground = (background) => setWithHistory((current) => current.background === background ? current : { ...current, background });

  const submitText = (text, fontSize) => {
    const pending = pendingText;
    if (!pending) return;
    const { size } = readGeometry();
    if (pending.mode === "edit") {
      // BOARD-EDIT: edits go through history; a sticky grows to fit.
      updateActiveObjects((current) => current.map((object) => {
        if (object.id !== pending.id || object.locked) return object;
        if (object.tool !== "sticky") return { ...object, text, fontSize };
        const card = stickyLayout(object, size, measureText);
        const height = stickyHeightForText(text, fontSize, card.width, size, measureText);
        if (height <= card.height + 0.5) return { ...object, text, fontSize };
        const origin = placeBlock(object.points[0], card.width, height, size);
        return { ...object, text, fontSize, points: [origin, { x: Math.min(1, origin.x + card.width / size.width), y: Math.min(1, origin.y + height / size.height) }] };
      }));
      setPendingText(null);
      announce(`${pending.tool === "sticky" ? "Sticky note" : "Text"} updated.`);
      return;
    }
    let points;
    if (pending.tool === "sticky") {
      // BOARD-STICKY: the card is created tall enough for its text.
      const width = Math.max(130, size.width * 0.36);
      const height = stickyHeightForText(text, fontSize, width, size, measureText);
      const origin = placeBlock(pending.point, width, height, size);
      points = [origin, { x: Math.min(1, origin.x + width / size.width), y: Math.min(1, origin.y + height / size.height) }];
    } else {
      // BOARD-8: the wrapped block is kept on the page when it is placed.
      const layout = textLayout({ tool: "text", text, fontSize, points: [pending.point] }, size, measureText);
      points = [placeBlock(pending.point, layout.width, layout.height, size)];
    }
    const object = { id: createId(), tool: pending.tool, color, fill: "#fff1a8", width: lineWidth, fontSize, text, points };
    updateActiveObjects((current) => [...current, object]);
    setPendingText(null);
    setTool("select");
    setSelectedId(object.id);
  };

  // Recolor and restroke apply to every unlocked object in the selection as
  // one history step (BOARD-18).
  const changeColor = (ink) => {
    setColor(ink);
    const targets = new Set(selectedObjects.filter((object) => !object.locked).map((object) => object.id));
    if (targets.size) updateActiveObjects((current) => current.map((object) => targets.has(object.id) ? { ...object, color: ink } : object));
    if (tool === "eraser") setTool("pen");
  };
  const changeWidth = (value) => {
    setLineWidth(value);
    const targets = new Set(selectedObjects.filter((object) => !object.locked && !["text", "sticky"].includes(object.tool)).map((object) => object.id));
    if (targets.size) updateActiveObjects((current) => current.map((object) => targets.has(object.id) ? { ...object, width: value } : object));
  };

  const fileStem = (suffix) => `${documentTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${suffix.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const exportBoard = () => {
    // The PNG is the page at twice its authoring size, background and ink
    // composited separately exactly like the screen.
    const { size } = readGeometry();
    const scale = 2;
    const output = document.createElement("canvas");
    output.width = Math.round(size.width * scale);
    output.height = Math.round(size.height * scale);
    const context = output.getContext("2d");
    context.scale(scale, scale);
    drawBackground(context, size, board.background);
    const ink = document.createElement("canvas");
    ink.width = output.width;
    ink.height = output.height;
    const inkContext = ink.getContext("2d");
    inkContext.scale(scale, scale);
    objects.forEach((object) => drawObject(inkContext, object, size));
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(ink, 0, 0);
    const link = document.createElement("a");
    link.download = `${fileStem(activePage.name)}.png`;
    link.href = output.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify?.(`${activePage.name} exported as a high-resolution PNG.`);
  };

  const boardFileRef = useRef(null);
  const exportToggleRef = useRef(null);
  const exportBoardJson = () => {
    const envelope = exportBoardDocument(boardRef.current, { title: documentTitle });
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${documentTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-board.json`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
    notify?.("Board exported as shareable JSON (content only — no local ids).");
  };
  const importBoardJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const parsed = parseBoardInterchange(await file.text());
    if (!parsed.ok) {
      notify?.(parsed.error, "error", 6000);
      return;
    }
    setWithHistory((current) => {
      const merged = mergeImportedPages(current, parsed.pages);
      notify?.(merged.added
        ? `${merged.added} page${merged.added === 1 ? "" : "s"} imported${merged.skipped ? `; ${merged.skipped} skipped (20-page cap)` : ""}. Undo is available.`
        : "The 20-page cap leaves no room to import. Delete a page first.", merged.added ? "success" : "warning", 6000);
      return merged.board;
    });
    setSelectedIds([]);
  };

  const exportSvg = () => {
    // BOARD-SVG: the viewBox is the page's authoring size, so text, strokes,
    // and sticky cards keep the proportions the canvas and PNG show.
    const { size } = readGeometry();
    const svg = boardPageToSvg(activePage, {
      width: Math.round(size.width * 100) / 100,
      height: Math.round(size.height * 100) / 100,
      outputWidth: 1600,
      outputHeight: Math.round((1600 * size.height) / size.width),
      background: PAGE_FILL,
      pattern: board.background,
      measure: measureText,
    });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${fileStem(activePage.name)}.svg`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
    notify?.(`${activePage.name} exported as a scalable SVG.`);
  };

  const runMenuAction = (action) => {
    setOpenPanel(null);
    exportToggleRef.current?.focus();
    action();
  };
  const onMenuKeyDown = (event) => {
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpenPanel(null);
      exportToggleRef.current?.focus();
    } else if (event.key === "Tab") setOpenPanel(null);
  };

  const visibleObjectCount = objects.filter((object) => object.tool !== "eraser").length;
  const allLocked = selectedObjects.length > 0 && selectedObjects.every((object) => object.locked);
  const editableSelection = selectedObject && ["text", "sticky"].includes(selectedObject.tool) && !selectedObject.locked;
  const selectionColors = [...new Set(selectedObjects.map((object) => object.color))];
  const activeInk = selectedObjects.length ? (selectionColors.length === 1 ? selectionColors[0] : "") : color;
  const strokeWidths = [...new Set(selectedObjects.filter((object) => !["text", "sticky"].includes(object.tool)).map((object) => Math.min(12, object.width)))];
  const sizeValue = strokeWidths.length === 1 ? strokeWidths[0] : lineWidth;
  const shapeActive = shapeTools.has(tool);
  const ShapeToggleIcon = shapeActive ? TOOL_DEFS[tool].icon : Shapes;
  // The floating selection bar sits at the top of the canvas unless that
  // would cover the selection (or its rotate handle); then at the bottom,
  // or on whichever side leaves more of a tall selection visible.
  const selectionPlacement = (() => {
    const canvasSize = canvasSizeRef.current;
    if (!selectedObjects.length || !canvasSize) return "top";
    const size = pageSizeOf(activePage, canvasSize);
    const fit = fitPage(canvasSize, size);
    const bounds = groupBounds(selectedObjects, size);
    const toScreenY = (y) => view.y * canvasSize.height + view.scale * (fit.top + y * size.height * fit.scale);
    const top = toScreenY(bounds.minY) - 40;
    const bottom = toScreenY(bounds.maxY) + 10;
    if (top >= 64) return "top";
    if (bottom <= canvasSize.height - 64) return "bottom";
    return top >= canvasSize.height - bottom ? "top" : "bottom";
  })();
  const hintText = tool === "select"
    ? selectedObjects.length > 1
      ? `${selectedObjects.length} objects selected — drag, nudge, duplicate, copy, or delete them together.`
      : selectedObject
        ? coarsePointer ? "Drag to move. Double-tap text to edit; the selection bar copies, locks, or deletes." : "Drag to move; Shift-click adds more; double-click text to edit."
        : coarsePointer ? "Tap an object to select it, or drag across empty space to box-select." : "Click an object to select it, Shift-click to add, or drag empty space to box-select."
    : tool === "text" || tool === "sticky"
      ? `${coarsePointer ? "Tap" : "Click"} the board to place ${tool === "sticky" ? "a sticky note" : "text"}.`
      : "Draw directly with touch, mouse, or Apple Pencil.";

  const toolButton = (id, withLabel = false) => {
    const definition = TOOL_DEFS[id];
    const Icon = definition.icon;
    return <button key={id} className={tool === id ? "active" : ""} onClick={() => chooseTool(id)} aria-pressed={tool === id} aria-label={definition.label} title={toolTitle(id)} type="button"><Icon size={19} />{withLabel && <span>{definition.name}</span>}</button>;
  };
  const panelToggle = (name, label, content, { active = false, title = label } = {}) => <button className={`board-panel-toggle${active ? " active" : ""}`} data-board-toggle={name} onClick={() => togglePanel(name)} aria-expanded={openPanel === name} aria-controls={`board-${name}-panel`} aria-label={label} title={title} type="button">{content}</button>;
  const inkControls = <>
    <div className="color-row" role="group" aria-label="Ink color">{inks.map((ink) => <button key={ink.value} className={activeInk === ink.value ? "color-dot active" : "color-dot"} style={{ "--swatch": ink.value }} onClick={() => changeColor(ink.value)} aria-pressed={activeInk === ink.value} aria-label={`${ink.name} ink`} title={`${ink.name} ink`} type="button" />)}</div>
    <label className="stroke-size"><span>Size</span><input type="range" min="1" max="12" value={sizeValue} onChange={(event) => changeWidth(Number(event.target.value))} aria-label="Stroke size" /></label>
  </>;
  const historyButtons = <><button onClick={undo} disabled={!historyCounts.past} aria-label="Undo" title="Undo (⌘/Ctrl+Z)" type="button"><Undo2 size={19} /></button><button onClick={redo} disabled={!historyCounts.future} aria-label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" type="button"><Redo2 size={19} /></button></>;
  const snapButton = (withLabel) => <button className={snapEnabled ? "active" : ""} onClick={() => setSnapEnabled((value) => !value)} aria-pressed={snapEnabled} aria-label="Snap to grid" title="Snap shape endpoints, placement, moves, and resizes to the 24px grid" type="button"><Grid3x3 size={18} />{withLabel && <span>Snap to grid</span>}</button>;
  const zoomGroup = <div className="tool-segment board-zoom" role="group" aria-label="Zoom"><button onClick={() => zoomAround(1 / 1.25)} disabled={view.scale <= 1} aria-label="Zoom out" title="Zoom out (⌘/Ctrl+scroll)" type="button"><ZoomOut size={18} /></button><button className="board-zoom-level" onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1} aria-label="Reset zoom" title="Reset zoom and position" type="button">{Math.round(view.scale * 100)}%</button><button onClick={() => zoomAround(1.25)} disabled={view.scale >= 4} aria-label="Zoom in" title="Zoom in (⌘/Ctrl+scroll or pinch)" type="button"><ZoomIn size={18} /></button></div>;
  const backgroundsGroup = (withLabel) => <div className="board-backgrounds" role="group" aria-label="Board background">{[["grid", "Grid background", "Grid", Grid2X2], ["dots", "Dot background", "Dot", Grip], ["plain", "Plain background", "Plain", Square]].map(([value, label, short, Icon]) => <button key={value} className={board.background === value ? "active" : ""} onClick={() => changeBackground(value)} aria-pressed={board.background === value} aria-label={label} title={label} type="button"><Icon size={17} />{withLabel && <span>{short}</span>}</button>)}</div>;
  // Actions launched from a panel return focus to its toggle first, so a
  // dialog they open restores focus somewhere visible when it closes.
  const fromPanel = (action) => () => {
    if (openPanel) {
      rootRef.current?.querySelector(`[data-board-toggle="${openPanel}"]`)?.focus();
      setOpenPanel(null);
    }
    action();
  };
  const clearButton = (withLabel) => <button className="board-clear" onClick={fromPanel(clear)} disabled={!objects.length} aria-label="Clear current page" title="Clear every object on this page" type="button"><BrushCleaning size={17} />{withLabel && <span>Clear current page</span>}</button>;
  const pageActionButtons = (withLabel) => [
    ["rename", "Rename whiteboard page", "Rename page", Pencil, () => setRenamingPage(true)],
    ["add", "Add whiteboard page", "New page", Plus, addPage],
    ["duplicate", "Duplicate whiteboard page", "Duplicate page", Copy, duplicatePage],
    ["delete", "Delete whiteboard page", "Delete page", Trash2, deletePage],
  ].map(([key, label, title, Icon, action]) => <button key={key} onClick={fromPanel(action)} aria-label={label} title={title} type="button"><Icon size={17} />{withLabel && <span>{label}</span>}</button>);

  return <section ref={rootRef} className={`board-view advanced-board${compact ? " board-compact" : ""}`} aria-label={`Whiteboard for ${documentTitle}`}>
    <header className="board-header"><div><span className="eyebrow">Linked whiteboard · {activePage.name}</span><h1>{documentTitle}</h1></div><div className="board-header-actions"><input ref={boardFileRef} type="file" accept="application/json,.json" hidden onChange={importBoardJson} /><button className="button ghost board-import" onClick={() => boardFileRef.current?.click()} aria-label="Import a board JSON file" title="Import a board JSON file" type="button"><Import size={16} /><span>Import</span></button><div className="board-menu"><button ref={exportToggleRef} className="button secondary board-export-toggle" data-board-toggle="export" onClick={() => togglePanel("export")} aria-haspopup="menu" aria-expanded={openPanel === "export"} aria-controls="board-export-menu" title="Export this page or the whole board" type="button"><Download size={17} /><span>Export</span><ChevronDown size={15} /></button><div id="board-export-menu" className="board-menu-list" data-board-panel="export" role="menu" aria-label="Export" hidden={openPanel !== "export"} onKeyDown={onMenuKeyDown}><button role="menuitem" tabIndex={-1} onClick={() => runMenuAction(exportBoard)} type="button"><ImageIcon size={18} /><span><strong>PNG image</strong><small>This page, high resolution</small></span></button><button role="menuitem" tabIndex={-1} onClick={() => runMenuAction(exportSvg)} type="button"><Shapes size={18} /><span><strong>SVG image</strong><small>This page, scalable vector</small></span></button><button role="menuitem" tabIndex={-1} onClick={() => runMenuAction(exportBoardJson)} type="button"><FileJson size={18} /><span><strong>Board JSON</strong><small>Every page, re-importable</small></span></button></div></div></div></header>

    <div className="board-pagebar">
      <div className="board-page-controls"><Files size={17} aria-hidden="true" /><select value={activePage.id} onChange={(event) => switchPage(event.target.value)} aria-label="Current whiteboard page">{board.pages.map((page, index) => <option value={page.id} key={page.id}>{index + 1}. {page.name}</option>)}</select><span>{activePageIndex + 1}/{board.pages.length}</span>{compact ? panelToggle("page", "Page and view options", <Ellipsis size={19} />, { title: "Rename, add, duplicate, delete, or clear pages; snap, zoom, and background" }) : <>{pageActionButtons(false)}{clearButton(false)}</>}</div>
      {compact ? !shortViewport && <div className="tool-segment board-history">{historyButtons}</div> : <div className="board-pagebar-end">{zoomGroup}{backgroundsGroup(false)}</div>}
      {compact && <div id="board-page-panel" className="board-popover board-page-panel" data-board-panel="page" role="group" aria-label="Page and view options" hidden={openPanel !== "page"}><div className="board-popover-tools board-popover-list">{pageActionButtons(true)}{clearButton(true)}</div><div className="board-popover-tools">{snapButton(true)}</div>{zoomGroup}{backgroundsGroup(true)}</div>}
    </div>

    {compact
      ? <div ref={toolbarRef} className="board-toolbar" role="toolbar" aria-label="Whiteboard tools"><div className="board-toolbar-scroll">
        <div className="tool-segment board-primary-tools">{["select", "pen", "marker", "eraser"].map((id) => toolButton(id))}{panelToggle("shapes", shapeActive ? `Shapes, ${TOOL_DEFS[tool].name} selected` : "Shapes", <><ShapeToggleIcon size={19} /><ChevronDown className="board-toggle-caret" size={11} /></>, { active: shapeActive, title: "Line, rectangle, ellipse, arrow" })}{toolButton("text")}{toolButton("sticky")}{panelToggle("style", "Ink color and size", <span className={`board-ink-preview${activeInk ? "" : " mixed"}`} style={{ "--swatch": activeInk || color }} />)}</div>{shortViewport && <div className="tool-segment board-history">{historyButtons}</div>}
      </div>
        <div id="board-shapes-panel" className="board-popover" data-board-panel="shapes" role="group" aria-label="Shapes" hidden={openPanel !== "shapes"}><div className="board-popover-tools">{["line", "rectangle", "ellipse", "arrow"].map((id) => toolButton(id, true))}</div></div>
        <div id="board-style-panel" className="board-popover" data-board-panel="style" role="group" aria-label="Ink color and size" hidden={openPanel !== "style"}>{inkControls}</div>
      </div>
      : <div ref={toolbarRef} className="board-toolbar" role="toolbar" aria-label="Whiteboard tools"><div className="board-toolbar-scroll">
        <div className="tool-segment">{["select", "pen", "marker", "eraser"].map((id) => toolButton(id))}</div>
        <div className="tool-segment shape-tools">{["line", "rectangle", "ellipse", "arrow", "text", "sticky"].map((id) => toolButton(id))}</div>
        {inkControls}
        <div className="tool-segment board-history">{historyButtons}</div>
        <div className="tool-segment">{snapButton(false)}</div>
      </div></div>}

    <div className={`board-canvas-wrap background-${board.background}`} ref={containerRef}>
      {!loaded && <div className="board-loading"><RotateCcw className="spin" size={22} /> Restoring every page…</div>}
      <canvas ref={backdropRef} className="board-canvas-backdrop" aria-hidden="true" />
      <canvas ref={canvasRef} className={`board-canvas tool-${tool}${spacePanning ? " panning" : ""}`} tabIndex="0" aria-label={`${activePage.name} drawing surface. Active tool: ${TOOL_DEFS[tool].name}`} aria-describedby={helpId} onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} onClick={handleCanvasClick} />
      {selectedObjects.length > 0 && <div className={`board-selection-actions placement-${selectionPlacement}`} role="toolbar" aria-label="Selection actions">{editableSelection && <button onClick={() => openEditor(selectedObject)} aria-label={selectedObject.tool === "sticky" ? "Edit sticky note" : "Edit text"} title="Edit (Enter or double-click)" type="button"><PencilLine size={18} /></button>}<button onClick={bringForward} disabled={allLocked} aria-label="Bring selection forward" title="Bring forward" type="button"><ArrowUpToLine size={18} /></button><button onClick={sendBackward} disabled={allLocked} aria-label="Send selection backward" title="Send backward" type="button"><ArrowDownToLine size={18} /></button><button className={allLocked ? "active" : ""} onClick={toggleLockSelected} aria-label={allLocked ? "Unlock selection" : "Lock selection"} title={allLocked ? "Unlock (allow edits again)" : "Lock (prevent accidental edits)"} type="button">{allLocked ? <Lock size={18} /> : <LockOpen size={18} />}</button><button onClick={duplicateSelected} aria-label="Duplicate selected object" title="Duplicate selection" type="button"><Copy size={18} /></button><button onClick={deleteSelected} aria-label="Delete selected object" title="Delete selection (Delete)" type="button"><Trash2 size={18} /></button></div>}
      <p id={helpId} className="visually-hidden">Tab and Shift+Tab select objects; arrow keys move the selection, Enter edits text, Delete removes it, and Escape deselects.</p>
    </div>
    <p className="board-hint"><strong>{hintText}</strong><span>{visibleObjectCount} object{visibleObjectCount === 1 ? "" : "s"} · {board.pages.length} page{board.pages.length === 1 ? "" : "s"} · <span role="status">{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved"}</span></span></p>
    <p className="visually-hidden" role="status">{announcement}</p>
    <section className="visually-hidden" aria-label="Whiteboard keyboard shortcuts"><dl>{BOARD_SHORTCUTS.map(([keys, action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}</dl></section>
    <TextEntryDialog key={pendingText ? `${pendingText.mode}-${pendingText.id || "new"}` : "closed"} pending={pendingText} onClose={() => setPendingText(null)} onSubmit={submitText} />
    <RenamePageDialog page={renamingPage ? activePage : null} onClose={() => setRenamingPage(false)} onRename={renamePage} />
  </section>;
}
