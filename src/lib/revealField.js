const STOP_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

/**
 * Focuses a field that a navigation just filled (the Reader's "Ask AI") and
 * keeps it in the middle of the viewport while the page settles: panels above
 * it can finish loading after mount and push it below the fold or behind the
 * phone's bottom bar. Stops at the learner's first scroll, tap or key press,
 * when focus leaves the field, or after `settleMs`. Returns a stop function.
 */
export function revealFocusedField(field, { settleMs = 1_500 } = {}) {
  const view = field?.ownerDocument?.defaultView;
  if (!field?.isConnected || !view) return () => {};
  field.focus({ preventScroll: true });
  const deadline = view.performance.now() + settleMs;
  let frame = 0;
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    view.cancelAnimationFrame(frame);
    STOP_EVENTS.forEach((type) => view.removeEventListener(type, stop, true));
  };
  const keepCentred = () => {
    if (!active) return;
    if (!field.isConnected || field.ownerDocument.activeElement !== field || view.performance.now() > deadline) {
      stop();
      return;
    }
    const box = field.getBoundingClientRect();
    const middle = (box.top + box.bottom) / 2;
    // Instant corrections (the page scrolls smoothly by default): a smooth
    // scroll aimed before a late layout shift lands in the wrong place.
    if (middle < view.innerHeight * 0.25 || middle > view.innerHeight * 0.65) field.scrollIntoView({ block: "center", behavior: "instant" });
    frame = view.requestAnimationFrame(keepCentred);
  };
  STOP_EVENTS.forEach((type) => view.addEventListener(type, stop, { capture: true, passive: true }));
  frame = view.requestAnimationFrame(keepCentred);
  return stop;
}
