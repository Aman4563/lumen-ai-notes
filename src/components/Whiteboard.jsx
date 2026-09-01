import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Copy,
  Download,
  Eraser,
  Files,
  Grid2X2,
  Grip,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { getData, normalizeBoardDocument, updateDataGuarded } from "../lib/db";
import { createId } from "../lib/id.js";
import { boardPageToSvg } from "../lib/boardSvg.js";
import {
  BOARD_SYNC_CHANNEL,
  BOARD_SYNC_SIGNAL_KEY,
  boardPayloadEqual,
  mergeBoardVersions,
} from "../lib/boardSync.js";
import { PROFILE_REPLACEMENT_EVENT } from "../lib/profileSync.js";
import { StorageBudgetError } from "../lib/storageBudget.js";

const colors = ["#17283e", "#e36f4a", "#d8a326", "#2c8b76", "#5574c7", "#7a5aa6"];
const shapeTools = new Set(["line", "rectangle", "ellipse", "arrow"]);

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

const drawBackground = (context, width, height, background) => {
  context.save();
  context.fillStyle = "#fbf8f1";
  context.fillRect(0, 0, width, height);
  if (background === "plain") {
    context.restore();
    return;
  }
  context.fillStyle = "rgba(20,34,52,.13)";
  context.strokeStyle = "rgba(20,34,52,.075)";
  context.lineWidth = 1;
  for (let x = 24; x < width; x += 24) {
    if (background === "dots") {
      for (let y = 24; y < height; y += 24) {
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
    for (let y = 24; y < height; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }
  context.restore();
};

const wrapText = (context, text, x, y, maximumWidth, lineHeight, maximumLines = 20) => {
  const lines = [];
  String(text || "").split("\n").forEach((paragraph) => {
    let line = "";
    paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
      const candidate = `${line} ${word}`.trim();
      if (line && context.measureText(candidate).width > maximumWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    else if (!paragraph) lines.push("");
  });
  lines.slice(0, maximumLines).forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return Math.min(lines.length, maximumLines);
};

const objectBounds = (object) => {
  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (object.tool === "text") {
    maxX = Math.min(1, minX + 0.42);
    maxY = Math.min(1, minY + Math.max(0.07, (object.text.split("\n").length * object.fontSize) / 500));
  }
  if (object.tool === "sticky" && object.points.length === 1) {
    maxX = Math.min(1, minX + 0.36);
    maxY = Math.min(1, minY + 0.22);
  }
  return { minX, minY, maxX, maxY };
};

function drawObject(context, object, width, height) {
  if (!object.points?.length) return;
  const start = object.points[0];
  const end = object.points.at(-1);
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  context.save();
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
    context.font = `700 ${object.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textBaseline = "top";
    wrapText(context, object.text, startX, startY, Math.max(120, width * 0.42), object.fontSize * 1.25);
    context.restore();
    return;
  }

  if (object.tool === "sticky") {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    const boxWidth = Math.max(130, endX - startX || width * 0.36);
    const boxHeight = Math.max(105, endY - startY || height * 0.22);
    context.fillStyle = object.fill || "#fff1a8";
    context.strokeStyle = "rgba(70,55,18,.2)";
    context.lineWidth = 1.5;
    context.beginPath();
    roundedRect(context, startX, startY, boxWidth, boxHeight, 12);
    context.fill();
    context.stroke();
    context.fillStyle = object.color || "#17283e";
    context.font = `650 ${object.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textBaseline = "top";
    wrapText(context, object.text, startX + 14, startY + 15, boxWidth - 28, object.fontSize * 1.3, Math.max(2, Math.floor((boxHeight - 28) / (object.fontSize * 1.3))));
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

const drawSelection = (context, object, width, height) => {
  if (!object) return;
  const bounds = objectBounds(object);
  const x = bounds.minX * width - 7;
  const y = bounds.minY * height - 7;
  const boxWidth = Math.max(18, (bounds.maxX - bounds.minX) * width + 14);
  const boxHeight = Math.max(18, (bounds.maxY - bounds.minY) * height + 14);
  context.save();
  context.strokeStyle = "#e36f4a";
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  context.strokeRect(x, y, boxWidth, boxHeight);
  context.fillStyle = "#ffffff";
  context.setLineDash([]);
  [[x, y], [x + boxWidth, y], [x, y + boxHeight], [x + boxWidth, y + boxHeight]].forEach(([cx, cy]) => {
    context.beginPath();
    context.arc(cx, cy, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
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
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(pending?.tool === "sticky" ? 18 : 24);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  useDialogKeyboard(Boolean(pending), dialogRef, onClose);
  useEffect(() => {
    setText("");
    setFontSize(pending?.tool === "sticky" ? 18 : 24);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pending]);
  if (!pending) return null;
  return <div className="modal-layer board-text-layer"><button className="modal-scrim" onClick={onClose} aria-label="Cancel text entry" type="button" /><form ref={dialogRef} className="board-text-dialog" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onSubmit(text.trim(), fontSize); }} role="dialog" aria-modal="true" aria-labelledby="board-text-title"><div className="popover-heading"><div><span className="eyebrow">Whiteboard object</span><strong id="board-text-title">Add {pending.tool === "sticky" ? "a sticky note" : "text"}</strong></div><button className="icon-button small" onClick={onClose} aria-label="Cancel text entry" type="button"><X size={17} /></button></div><textarea ref={inputRef} value={text} maxLength={10_000} onChange={(event) => setText(event.target.value)} placeholder={pending.tool === "sticky" ? "Question, reminder, assumption, or interview insight…" : "Type a label or explanation…"} aria-label="Whiteboard text" /><label><span>Text size</span><input type="range" min="14" max="48" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /><strong>{fontSize}px</strong></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={!text.trim()} type="submit">Add to board</button></div></form></div>;
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
  const canvasRef = useRef(null);
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
  const [color, setColor] = useState(colors[0]);
  const [lineWidth, setLineWidth] = useState(3);
  const [selectedIds, setSelectedIds] = useState([]);
  // Single-selection compatibility: most tools (recolor, resize slider) act on
  // exactly one object; group operations read selectedIds directly.
  const setSelectedId = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  const marqueeRef = useRef(null);
  const clipboardRef = useRef([]);
  const [pendingText, setPendingText] = useState(null);
  const [renamingPage, setRenamingPage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");

  boardRef.current = board;
  const activePage = useMemo(() => board.pages.find((page) => page.id === board.activePageId) || board.pages[0], [board]);
  const objects = activePage?.objects || [];
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : "";
  const selectedObject = objects.find((object) => object.id === selectedId);
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const activePageIndex = board.pages.findIndex((page) => page.id === activePage?.id);

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
  const updateActiveObjects = useCallback((updater, record = true) => {
    const apply = (current) => ({ ...current, pages: current.pages.map((page) => page.id === current.activePageId ? { ...page, objects: (typeof updater === "function" ? updater(page.objects) : updater).slice(-5_000) } : page) });
    if (record) setWithHistory(apply);
    else setBoard(apply);
  }, [setWithHistory]);

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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) { canvas.width = targetWidth; canvas.height = targetHeight; }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    drawBackground(context, rect.width, rect.height, board.background);
    objects.forEach((object) => drawObject(context, object, rect.width, rect.height));
    objects.filter((object) => selectedIds.includes(object.id)).forEach((object) => drawSelection(context, object, rect.width, rect.height));
  }, [board.background, objects, selectedIds]);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  const pointFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const hitTest = (point) => [...objects].reverse().find((object) => {
    if (object.tool === "eraser") return false;
    const bounds = objectBounds(object);
    const margin = Math.max(0.018, object.width / 800);
    return point.x >= bounds.minX - margin && point.x <= bounds.maxX + margin && point.y >= bounds.minY - margin && point.y <= bounds.maxY + margin;
  });

  const startDrawing = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    try { canvasRef.current.setPointerCapture?.(event.pointerId); } catch { /* Some iOS pointer streams do not expose capture. */ }
    if (tool === "select") {
      const hit = hitTest(point);
      if (hit && event.shiftKey) {
        setSelectedIds((current) => current.includes(hit.id) ? current.filter((id) => id !== hit.id) : [...current, hit.id]);
        return;
      }
      if (hit) {
        const group = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
        setSelectedIds(group);
        movingRef.current = {
          ids: group,
          start: point,
          originals: new Map(objects.filter((object) => group.includes(object.id)).map((object) => [object.id, object.points])),
          before: boardRef.current,
          moved: false,
        };
        return;
      }
      // Empty space starts a marquee: release selects every contained object.
      setSelectedIds([]);
      marqueeRef.current = { start: point, end: point };
      return;
    }
    if (tool === "text" || tool === "sticky") {
      setPendingText({ tool, point });
      return;
    }
    setSelectedId("");
    drawingRef.current = { id: createId(), tool, color, fill: "#fff1a8", fontSize: 24, text: "", width: (tool === "eraser" ? lineWidth * 5 : tool === "marker" ? lineWidth * 4 : lineWidth) * (event.pointerType === "pen" ? 0.72 + Math.max(event.pressure, 0.1) * 0.7 : 1), points: [point] };
  };

  const continueDrawing = (event) => {
    if (movingRef.current) {
      event.preventDefault();
      const point = pointFromEvent(event);
      const move = movingRef.current;
      const deltaX = point.x - move.start.x;
      const deltaY = point.y - move.start.y;
      move.moved = move.moved || Math.abs(deltaX) + Math.abs(deltaY) > 0.002;
      updateActiveObjects((current) => current.map((object) => move.originals.has(object.id)
        ? { ...object, points: move.originals.get(object.id).map((item) => ({ x: Math.max(0, Math.min(1, item.x + deltaX)), y: Math.max(0, Math.min(1, item.y + deltaY)) })) }
        : object), false);
      return;
    }
    if (marqueeRef.current) {
      event.preventDefault();
      marqueeRef.current.end = pointFromEvent(event);
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const context = canvas.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
      const { start, end } = marqueeRef.current;
      context.save();
      context.strokeStyle = "#e36f4a";
      context.setLineDash([5, 4]);
      context.lineWidth = 1.2;
      context.strokeRect(Math.min(start.x, end.x) * rect.width, Math.min(start.y, end.y) * rect.height, Math.abs(end.x - start.x) * rect.width, Math.abs(end.y - start.y) * rect.height);
      context.restore();
      return;
    }
    if (!drawingRef.current) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [event];
    const nextPoints = events.map(pointFromEvent);
    const isShape = shapeTools.has(drawingRef.current.tool);
    const previous = drawingRef.current.points.at(-1);
    if (isShape) drawingRef.current.points = [drawingRef.current.points[0], nextPoints.at(-1)];
    else drawingRef.current.points.push(...nextPoints);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (isShape) { redraw(); drawObject(context, drawingRef.current, rect.width, rect.height); }
    else drawObject(context, { ...drawingRef.current, points: [previous, ...nextPoints] }, rect.width, rect.height);
  };

  const finishDrawing = (event) => {
    if (marqueeRef.current) {
      const { start, end } = marqueeRef.current;
      marqueeRef.current = null;
      const box = { minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x), minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y) };
      if ((box.maxX - box.minX) + (box.maxY - box.minY) > 0.01) {
        const contained = objects.filter((object) => {
          if (object.tool === "eraser") return false;
          const bounds = objectBounds(object);
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
    const endpoint = pointFromEvent(event);
    if (shapeTools.has(draft.tool)) draft.points = [draft.points[0], endpoint];
    else {
      const previous = draft.points.at(-1);
      if (!previous || Math.abs(previous.x - endpoint.x) + Math.abs(previous.y - endpoint.y) > 0.0005) draft.points.push(endpoint);
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const start = draft.points[0];
    const end = draft.points.at(-1);
    const distance = Math.hypot((end.x - start.x) * rect.width, (end.y - start.y) * rect.height);
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

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const removing = new Set(selectedIds);
    updateActiveObjects((current) => current.filter((object) => !removing.has(object.id)));
    setSelectedIds([]);
    notify?.(`${removing.size === 1 ? "Selected object" : `${removing.size} objects`} deleted. Undo is available.`);
  }, [notify, selectedIds, updateActiveObjects]);
  const cloneWithOffset = (object, offset) => ({
    ...object,
    id: createId(),
    points: object.points.map((point) => ({ ...point, x: Math.min(1, point.x + offset), y: Math.min(1, point.y + offset) })),
  });
  const duplicateSelected = () => {
    if (!selectedObjects.length) return;
    const duplicates = selectedObjects.map((object) => cloneWithOffset(object, 0.025));
    updateActiveObjects((current) => [...current, ...duplicates]);
    setSelectedIds(duplicates.map((object) => object.id));
  };
  const copySelected = useCallback(() => {
    if (!selectedObjects.length) return;
    clipboardRef.current = selectedObjects.map((object) => ({ ...object, points: object.points.map((point) => ({ ...point })) }));
    notify?.(`${selectedObjects.length} object${selectedObjects.length === 1 ? "" : "s"} copied. Paste with ⌘/Ctrl + V.`);
  }, [notify, selectedObjects]);
  const pasteClipboard = useCallback(() => {
    if (!clipboardRef.current.length) return;
    const pasted = clipboardRef.current.map((object) => cloneWithOffset(object, 0.03));
    updateActiveObjects((current) => [...current, ...pasted]);
    setSelectedIds(pasted.map((object) => object.id));
    notify?.(`${pasted.length} object${pasted.length === 1 ? "" : "s"} pasted.`);
  }, [notify, updateActiveObjects]);

  // Keyboard nudging (A11Y-001): arrow keys move the selected object by 1% of
  // the canvas (Shift: 5%) — a non-drag alternative to pointer moves that goes
  // through the same history path as any other edit.
  const nudgeSelected = useCallback((deltaX, deltaY) => {
    if (!selectedIds.length) return;
    const moving = new Set(selectedIds);
    updateActiveObjects((current) => current.map((object) => moving.has(object.id)
      ? { ...object, points: object.points.map((point) => ({ ...point, x: Math.max(0, Math.min(1, point.x + deltaX)), y: Math.max(0, Math.min(1, point.y + deltaY)) })) }
      : object));
  }, [selectedIds, updateActiveObjects]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
      if (typing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "c" && selectedIds.length) { event.preventDefault(); copySelected(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "v" && clipboardRef.current.length) { event.preventDefault(); pasteClipboard(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) { event.preventDefault(); deleteSelected(); }
      else if (event.key === "Escape") { setSelectedId(""); setPendingText(null); }
      else if (event.key.startsWith("Arrow") && selectedIds.length) {
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        nudgeSelected(
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelected, deleteSelected, nudgeSelected, pasteClipboard, redo, selectedIds, setSelectedId, undo]);

  const clear = () => {
    if (!objects.length || !window.confirm("Clear every object on this page? You can undo this action.")) return;
    updateActiveObjects([]);
    setSelectedId("");
    notify?.("Page cleared. Undo is available.");
  };
  const addPage = () => {
    if (board.pages.length >= 20) { notify?.("A board can contain up to 20 pages.", "error"); return; }
    const id = createId();
    setWithHistory((current) => ({ ...current, activePageId: id, pages: [...current.pages, { id, name: `Page ${current.pages.length + 1}`, objects: [] }] }));
    setSelectedId("");
  };
  const duplicatePage = () => {
    if (board.pages.length >= 20) { notify?.("A board can contain up to 20 pages.", "error"); return; }
    const id = createId();
    setWithHistory((current) => {
      const page = current.pages.find((item) => item.id === current.activePageId);
      return { ...current, activePageId: id, pages: [...current.pages, { id, name: `${page.name} copy`.slice(0, 60), objects: page.objects.map((object) => ({ ...object, id: createId(), points: object.points.map((point) => ({ ...point })) })) }] };
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

  const addTextObject = (text, fontSize) => {
    const pending = pendingText;
    const end = pending.tool === "sticky" ? { x: Math.min(0.98, pending.point.x + 0.36), y: Math.min(0.98, pending.point.y + 0.22) } : pending.point;
    const object = { id: createId(), tool: pending.tool, color, fill: "#fff1a8", width: lineWidth, fontSize, text, points: pending.tool === "sticky" ? [pending.point, end] : [pending.point] };
    updateActiveObjects((current) => [...current, object]);
    setPendingText(null);
    setTool("select");
    setSelectedId(object.id);
  };

  const changeColor = (ink) => {
    setColor(ink);
    if (selectedObject) updateActiveObjects((current) => current.map((object) => object.id === selectedId ? { ...object, color: ink } : object));
    if (tool === "eraser") setTool("pen");
  };
  const changeWidth = (value) => {
    setLineWidth(value);
    if (selectedObject && !["text", "sticky"].includes(selectedObject.tool)) updateActiveObjects((current) => current.map((object) => object.id === selectedId ? { ...object, width: value } : object));
  };

  const exportBoard = () => {
    const source = canvasRef.current;
    const rect = source.getBoundingClientRect();
    const scale = 2;
    const output = document.createElement("canvas");
    output.width = Math.round(rect.width * scale);
    output.height = Math.round(rect.height * scale);
    const context = output.getContext("2d");
    context.scale(scale, scale);
    drawBackground(context, rect.width, rect.height, board.background);
    const ink = document.createElement("canvas");
    ink.width = output.width;
    ink.height = output.height;
    const inkContext = ink.getContext("2d");
    inkContext.scale(scale, scale);
    objects.forEach((object) => drawObject(inkContext, object, rect.width, rect.height));
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(ink, 0, 0);
    const link = document.createElement("a");
    link.download = `${documentTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${activePage.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    link.href = output.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify?.(`${activePage.name} exported as a high-resolution PNG.`);
  };

  const exportSvg = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const aspect = rect && rect.width ? rect.height / rect.width : 0.625;
    const svg = boardPageToSvg(activePage, {
      width: 1600,
      height: Math.round(1600 * aspect),
      background: board.background === "dark" ? "#10192a" : "#ffffff",
    });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${documentTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${activePage.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.svg`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 2_000);
    notify?.(`${activePage.name} exported as a scalable SVG.`);
  };

  return <section className="board-view advanced-board" aria-label={`Whiteboard for ${documentTitle}`}>
    <header className="board-header"><div><span className="eyebrow">Linked whiteboard · {activePage.name}</span><h1>{documentTitle}</h1></div><div className="board-header-actions"><button className="button ghost" onClick={exportSvg} aria-label="Export current whiteboard page as SVG" type="button"><Download size={16} /> SVG</button><button className="button secondary" onClick={exportBoard} aria-label="Export current whiteboard page as PNG" type="button"><Download size={18} /> Export PNG</button></div></header>

    <div className="board-pagebar">
      <div className="board-page-controls"><Files size={17} /><select value={activePage.id} onChange={(event) => switchPage(event.target.value)} aria-label="Current whiteboard page">{board.pages.map((page, index) => <option value={page.id} key={page.id}>{index + 1}. {page.name}</option>)}</select><span>{activePageIndex + 1}/{board.pages.length}</span><button onClick={() => setRenamingPage(true)} aria-label="Rename whiteboard page" title="Rename page" type="button"><Pencil size={17} /></button><button onClick={addPage} aria-label="Add whiteboard page" title="New page" type="button"><Plus size={18} /></button><button onClick={duplicatePage} aria-label="Duplicate whiteboard page" title="Duplicate page" type="button"><Copy size={17} /></button><button onClick={deletePage} aria-label="Delete whiteboard page" title="Delete page" type="button"><Trash2 size={17} /></button></div>
      <div className="board-backgrounds" role="group" aria-label="Board background"><button className={board.background === "grid" ? "active" : ""} onClick={() => changeBackground("grid")} aria-label="Grid background" type="button"><Grid2X2 size={17} /></button><button className={board.background === "dots" ? "active" : ""} onClick={() => changeBackground("dots")} aria-label="Dot background" type="button"><Grip size={17} /></button><button className={board.background === "plain" ? "active" : ""} onClick={() => changeBackground("plain")} aria-label="Plain background" type="button"><Square size={16} /></button></div>
    </div>

    <div className="board-toolbar" role="toolbar" aria-label="Whiteboard tools"><div className="board-toolbar-scroll">
      <div className="tool-segment"><button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} aria-label="Select and move objects" title="Select" type="button"><MousePointer2 size={19} /></button><button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")} aria-label="Pen" type="button"><PenLine size={19} /></button><button className={tool === "marker" ? "active" : ""} onClick={() => setTool("marker")} aria-label="Highlighter" type="button"><Highlighter size={19} /></button><button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} aria-label="Eraser" type="button"><Eraser size={19} /></button></div>
      <div className="tool-segment shape-tools"><button className={tool === "line" ? "active" : ""} onClick={() => setTool("line")} aria-label="Straight line" type="button"><Minus size={19} /></button><button className={tool === "rectangle" ? "active" : ""} onClick={() => setTool("rectangle")} aria-label="Rectangle" type="button"><Square size={18} /></button><button className={tool === "ellipse" ? "active" : ""} onClick={() => setTool("ellipse")} aria-label="Ellipse" type="button"><Circle size={18} /></button><button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} aria-label="Arrow" type="button"><MoveUpRight size={19} /></button><button className={tool === "text" ? "active" : ""} onClick={() => setTool("text")} aria-label="Text" type="button"><Type size={19} /></button><button className={tool === "sticky" ? "active" : ""} onClick={() => setTool("sticky")} aria-label="Sticky note" type="button"><StickyNote size={19} /></button></div>
      <div className="color-row" aria-label="Ink color">{colors.map((ink) => <button key={ink} className={(selectedObject?.color || color) === ink ? "color-dot active" : "color-dot"} style={{ "--ink": ink }} onClick={() => changeColor(ink)} aria-label={`Use color ${ink}`} type="button" />)}</div>
      <label className="stroke-size"><span>Size</span><input type="range" min="1" max="12" value={selectedObject && !["text", "sticky"].includes(selectedObject.tool) ? Math.min(12, selectedObject.width) : lineWidth} onChange={(event) => changeWidth(Number(event.target.value))} aria-label="Stroke size" /></label>
      {selectedObjects.length > 0 && <div className="tool-segment board-selection-actions"><button onClick={duplicateSelected} aria-label="Duplicate selected object" title="Duplicate selection" type="button"><Copy size={18} /></button><button onClick={deleteSelected} aria-label="Delete selected object" title="Delete selection" type="button"><Trash2 size={18} /></button></div>}
      <div className="tool-segment board-history"><button onClick={undo} disabled={!historyCounts.past} aria-label="Undo" type="button"><Undo2 size={19} /></button><button onClick={redo} disabled={!historyCounts.future} aria-label="Redo" type="button"><Redo2 size={19} /></button><button onClick={clear} disabled={!objects.length} aria-label="Clear current page" type="button"><Trash2 size={19} /></button></div>
    </div></div>

    <div className={`board-canvas-wrap background-${board.background}`} ref={containerRef}>{!loaded && <div className="board-loading"><RotateCcw className="spin" size={22} /> Restoring every page…</div>}<canvas ref={canvasRef} className="board-canvas" tabIndex="0" aria-label={`${activePage.name} drawing surface. Active tool: ${tool}`} onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} /></div>
    <p className="board-hint"><strong>{tool === "select" ? selectedObjects.length > 1 ? `${selectedObjects.length} objects selected — drag, nudge, duplicate, copy, or delete them together.` : selectedObject ? "Drag the selected object; Shift-tap adds more; use the toolbar to recolor, duplicate, or delete." : "Tap an object to select it, Shift-tap to add, or drag empty space to box-select." : tool === "text" || tool === "sticky" ? "Tap the board to place it." : "Draw directly with touch, mouse, or Apple Pencil."}</strong><span>{objects.length} object{objects.length === 1 ? "" : "s"} · {board.pages.length} page{board.pages.length === 1 ? "" : "s"} · {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved"}</span></p>
    <TextEntryDialog pending={pendingText} onClose={() => setPendingText(null)} onSubmit={addTextObject} />
    <RenamePageDialog page={renamingPage ? activePage : null} onClose={() => setRenamingPage(false)} onRename={renamePage} />
  </section>;
}
