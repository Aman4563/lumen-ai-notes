import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "../tutor-dialog.css";

/**
 * In-app confirmation for destructive tutor actions (both engines). Focus
 * starts on the safe choice, Tab stays inside, Escape and the scrim cancel,
 * and cancelling returns focus to the control that opened it. After a
 * confirmation the caller decides where focus goes, because that control
 * usually disappears. An optional second choice (for example "Export, then
 * clear") sits between the two.
 */
export default function TutorConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "Cancel", secondaryLabel = "", onSecondary, onConfirm, onCancel }) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const restoreFocusRef = useRef(true);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    restoreFocusRef.current = true;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (restoreFocusRef.current && opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="tutor-dialog__scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}>
      <div className="tutor-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={dialogRef}>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        <div className="tutor-dialog__actions">
          <button ref={cancelRef} className="tutor-dialog__button" type="button" onClick={() => onCancel?.()}>{cancelLabel}</button>
          {secondaryLabel && onSecondary && <button className="tutor-dialog__button" type="button" onClick={() => { restoreFocusRef.current = false; onSecondary(); }}>{secondaryLabel}</button>}
          <button className="tutor-dialog__button tutor-dialog__button--danger" type="button" onClick={() => { restoreFocusRef.current = false; onConfirm?.(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
