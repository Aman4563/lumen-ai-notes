import { useEffect, useId, useRef, useState } from "react";
import { Undo2 } from "lucide-react";

/**
 * Short-lived undo for a deletion the learner may regret (REV-11). The strip
 * takes the removed row's place (see withUndoSlot) and its focus, scrolling
 * into view if needed, describes what was removed, and expires after
 * `timeout` unless it holds focus or the pointer.
 */
export function UndoStrip({ message, onUndo, onExpire, timeout = 10_000 }) {
  const stripRef = useRef(null);
  const undoRef = useRef(null);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  // Focus and hover pause the timer independently: leaving with the pointer
  // must not expire a strip whose Undo still has focus.
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const paused = focused || hovered;
  const messageId = useId();
  // A plain focus() scroll stops at the viewport edge, under the sticky top
  // bar; scrolling the strip itself honours its scroll margins (styles.css).
  useEffect(() => {
    undoRef.current?.focus({ preventScroll: true });
    stripRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    if (paused) return undefined;
    const timer = setTimeout(() => expireRef.current?.(), timeout);
    return () => clearTimeout(timer);
  }, [paused, timeout]);
  return (
    <div ref={stripRef} className="undo-strip" role="status" onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <span id={messageId}>{message}</span>
      <button ref={undoRef} className="button secondary" onClick={onUndo} aria-describedby={messageId} type="button"><Undo2 size={15} /> Undo</button>
    </div>
  );
}

/**
 * Puts an Undo strip where the removed record was listed, so it appears under
 * the learner's finger rather than at the top of a long list. `nodes` are the
 * rendered entries in order, `listIndexes` their records' positions in the
 * full collection, and `removedIndex` the removed record's old position: the
 * strip goes before the first entry that followed it.
 */
export const withUndoSlot = (nodes, listIndexes, removedIndex, strip) => {
  if (!strip) return nodes;
  const at = listIndexes.findIndex((index) => index >= removedIndex);
  const slot = at === -1 ? nodes.length : at;
  return [...nodes.slice(0, slot), strip, ...nodes.slice(slot)];
};
