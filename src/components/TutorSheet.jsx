import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "../tutor-dialog.css";

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

/**
 * A modal settings sheet for the tutors: a bottom sheet on phones and a
 * centred panel on wider screens. It opens with focus on the sheet itself so
 * its title is announced, keeps Tab inside, closes with Escape, the scrim,
 * the close button or Done, and returns focus to the control that opened it.
 * The panel carries `className` so the host's design tokens apply inside the
 * portal.
 */
export default function TutorSheet({ open, title, description, onClose, children, className = "", closeLabel = "Close" }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      const panel = panelRef.current;
      if (!panel) return;
      // The app's "?" shortcut sheet would open underneath this one and take
      // focus there, out of sight.
      if (event.key === "?") {
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        // Nothing behind the sheet (the tutor's Stop shortcut, the app's
        // sidebar) may also act on this Escape.
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll(FOCUSABLE)].filter((node) => node.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (!panel.contains(active) || active === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="tutor-sheet__scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div
        className={`tutor-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="tutor-sheet__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="tutor-sheet__close" type="button" aria-label={closeLabel} onClick={() => onClose?.()}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="tutor-sheet__body">{children}</div>
        <footer className="tutor-sheet__foot">
          <button className="tutor-sheet__done" type="button" onClick={() => onClose?.()}>Done</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
