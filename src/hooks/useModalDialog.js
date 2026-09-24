import { useEffect, useRef } from "react";

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Focusable descendants that are actually rendered; display:none controls are skipped. */
export const visibleFocusables = (root) => [...(root?.querySelectorAll(FOCUSABLE) || [])]
  .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden" && !node.closest("[inert]"));

// Nested reader dialogs (a highlight editor over the notes drawer) share one
// stack so Escape and Tab belong only to the topmost surface.
const dialogStack = [];

/**
 * Modal contract for reader surfaces: the listed background regions become
 * inert (each region's previous inert/aria-hidden state is restored on close,
 * so a closed compact sidebar stays inert), focus moves inside, Tab and
 * Shift+Tab wrap over the visible controls, Escape closes, and focus returns
 * to the opener, or to `returnFocusRef.current` when a caller set one.
 */
export function useModalDialog(active, dialogRef, {
  onClose,
  background = [],
  initialFocus,
  returnFocusRef,
} = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const backgroundSelector = background.join(", ");

  useEffect(() => {
    if (!active) return undefined;
    const dialog = dialogRef.current;
    const token = {};
    dialogStack.push(token);
    const previouslyFocused = document.activeElement;
    const regions = backgroundSelector
      ? [...document.querySelectorAll(backgroundSelector)].filter((region) => dialog && !region.contains(dialog))
      : [];
    const saved = regions.map((region) => [region, region.inert, region.getAttribute("aria-hidden")]);
    regions.forEach((region) => {
      region.inert = true;
      region.setAttribute("aria-hidden", "true");
    });
    // Focus synchronously: a deferred frame can land after the learner has
    // started typing elsewhere under mobile frame throttling.
    if (dialog && !dialog.contains(document.activeElement)) {
      const preferred = initialFocusRef.current?.(dialog);
      (preferred || visibleFocusables(dialog)[0] || dialog)?.focus?.({ preventScroll: true });
    }
    const handleKey = (event) => {
      if (dialogStack.at(-1) !== token || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = visibleFocusables(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      dialogStack.splice(dialogStack.indexOf(token), 1);
      saved.forEach(([region, inert, hidden]) => {
        region.inert = inert;
        if (hidden === null) region.removeAttribute("aria-hidden");
        else region.setAttribute("aria-hidden", hidden);
      });
      // A caller-chosen target (the heading a TOC tap jumped to) is already in
      // view; the opener may need scrolling back into view.
      const custom = returnFocusRef?.current || null;
      if (returnFocusRef) returnFocusRef.current = null;
      const target = custom || previouslyFocused;
      // Restore after React's cleanup pass so the target is no longer inert,
      // unless the closing action already moved focus somewhere on purpose
      // (Find in lecture focuses its input).
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const focusLost = !active || active === document.body || !active.isConnected || dialog?.contains(active) || Boolean(active.closest?.("[inert]"));
        if (!custom && !focusLost) return;
        if (target?.isConnected && !target.closest?.("[inert]")) target.focus?.(custom ? { preventScroll: true } : undefined);
      });
    };
  }, [active, backgroundSelector, dialogRef, returnFocusRef]);
}
