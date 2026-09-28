import { useLayoutEffect, useRef, useState } from "react";

const px = (value) => Number.parseFloat(value) || 0;

/**
 * The docked question box of a tutor (#93), measured against the top bar,
 * the fixed bottom navigation and the on-screen keyboard. The offsets are
 * published on <html> for the tutors' CSS:
 *
 * - `--ai-top`: the bottom of the sticky top bar.
 * - `--ai-nav-space`: the room the bottom navigation takes, plus an 8px gap
 *   (unset while the navigation is hidden, as on wide screens). The dock and
 *   the page's end padding sit on it, so larger text never slides the dock
 *   under a taller navigation.
 * - `--ai-dock-bottom`: the dock's offset while the on-screen keyboard is
 *   open; `html[data-ai-typing]` hides the navigation meanwhile.
 * - `--ai-composer-space`: the docked composer's height plus its offset.
 * - `html[data-ai-page-scroll]`: on wide screens, the tutor's column would
 *   leave its conversation less than `minConversation` (at most 40% of the
 *   screen), so the page scrolls instead, as on phones, and is then the only
 *   scroller. A conversation whose end was in view keeps it in view when
 *   this switches, and after a window resize the page shows its end.
 *
 * - `--ai-field-max`: in that column, the tallest the question box may grow
 *   in whole lines while the conversation keeps `minConversation`; past it
 *   the box scrolls.
 *
 * A dock that would take more than about 60% of the room between the top
 * bar and the navigation (large text on a small phone), or overlap the
 * navigation because the tutor starts too far down the page, stays in the
 * page flow (`data-dock="off"`) until it would fit again with a margin, so it
 * does not flicker. The question box's own growth is left out of both
 * decisions and of the wide column's, so typing never moves the dock or
 * switches the column; while the learner types a long question, the page
 * scrolls by as much as the dock grows, so what was just above it stays in
 * view and a dock held down by its card's top stays off the navigation. Once
 * the box loses focus, a long question kept in it does count towards the
 * overlap, so near the top of the page that dock stays in the page flow
 * instead of over the navigation. The returned `coverRef` (and `cover`, for
 * effects) is how much of the viewport's bottom the dock or the navigation
 * covers, for following and revealing. The composer's element is the dock;
 * the conversation is optional and only needed for the wide-screen column.
 */
export function useTutorDock({ composerRef, fieldRef, conversationRef, minConversation = 260 }) {
  const coverRef = useRef(0);
  const [cover, setCover] = useState(0);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    const field = fieldRef.current;
    if (!composer) return undefined;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const published = {};
    const publish = (name, value) => {
      if (published[name] === value) return;
      published[name] = value;
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    };
    let frame = 0;
    let keyboard = 0;
    let dockHeight = 0;
    let resized = false;
    const measure = () => {
      frame = 0;
      const afterResize = resized;
      resized = false;
      const nav = document.querySelector(".bottom-nav");
      const navShown = Boolean(nav) && getComputedStyle(nav).display !== "none";
      const top = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
      const bottom = navShown ? nav.getBoundingClientRect().top : window.innerHeight;
      publish("--ai-top", `${Math.round(top)}px`);
      publish("--ai-nav-space", navShown ? `${Math.ceil(window.innerHeight - bottom + 8)}px` : "");
      publish("--ai-dock-bottom", keyboard ? `${keyboard + 8}px` : "");
      const fieldStyle = field ? getComputedStyle(field) : null;
      const oneLine = fieldStyle ? Math.max(px(fieldStyle.minHeight), px(fieldStyle.lineHeight) + px(fieldStyle.paddingTop) + px(fieldStyle.paddingBottom) + px(fieldStyle.borderTopWidth) + px(fieldStyle.borderBottomWidth)) : 0;
      const grown = field ? Math.max(0, field.offsetHeight - oneLine) : 0;
      const height = composer.offsetHeight - grown;
      const share = height / Math.max(1, bottom - top);
      // A sticky dock cannot rise above its card, so a card that starts
      // too far down would hold it over the navigation. A long question
      // counts once the box is left: while typing, the page scrolls instead.
      const overlap = navShown && !keyboard ? composer.parentElement.getBoundingClientRect().top + height + (document.activeElement === field ? 0 : grown) + 8 - bottom : Number.NEGATIVE_INFINITY;
      if (composer.dataset.dock !== "off") {
        if (share > 0.6 || overlap > 1) composer.dataset.dock = "off";
      } else if (share < 0.5 && overlap < -24) delete composer.dataset.dock;
      const style = getComputedStyle(composer);
      const sticky = style.position === "sticky";
      const space = sticky ? Math.ceil(composer.offsetHeight + px(style.bottom)) : 0;
      publish("--ai-composer-space", `${space}px`);
      const covered = Math.max(space, Math.ceil(window.innerHeight - bottom));
      root.style.scrollPaddingBottom = covered ? `${covered + 12}px` : "";
      coverRef.current = covered;
      setCover((current) => (Math.abs(current - covered) > 2 ? covered : current));
      // While the learner types, a longer question grows the dock upwards
      // over the text just above it (or, where its card's top holds it,
      // downwards over the navigation): the page scrolls by the growth. A
      // dock still over the navigation or the keyboard is lifted off it.
      const grew = dockHeight ? composer.offsetHeight - dockHeight : 0;
      dockHeight = composer.offsetHeight;
      const excess = composer.getBoundingClientRect().bottom + 8 - (keyboard ? window.innerHeight - keyboard : bottom);
      if (sticky && document.activeElement === field && (grew > 0 || excess > 1)) window.scrollBy(0, Math.max(grew, excess));
      const page = composer.closest(".ai-page");
      const conversation = conversationRef?.current;
      let fieldMax = "";
      if (page && conversation && getComputedStyle(page).display === "flex") {
        const card = composer.parentElement;
        const need = conversation.getBoundingClientRect().top - page.getBoundingClientRect().top
          + Math.min(minConversation, window.innerHeight * 0.4)
          + px(getComputedStyle(conversation.parentElement).borderBottomWidth)
          + height + px(style.marginTop) + px(style.marginBottom)
          + px(getComputedStyle(card).borderBottomWidth) + px(getComputedStyle(page).paddingBottom);
        const room = window.innerHeight - top;
        const paged = "aiPageScroll" in root.dataset;
        if (paged ? need < room - 16 : need > room + 1) {
          const atEnd = paged ? conversation.getBoundingClientRect().bottom <= window.innerHeight + 2 : conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= 2;
          if (paged) delete root.dataset.aiPageScroll;
          else root.dataset.aiPageScroll = "";
          if (atEnd) conversation.scrollTop = conversation.scrollHeight;
          // A resized window shows the latest turn above the box, as the
          // column did; chrome that grew (Grounding, the engine notes) is
          // left in view.
          if (afterResize) window.scrollTo({ top: root.scrollHeight, behavior: "instant" });
        }
        // The column's question box grows only into whole lines the
        // conversation can spare above its minimum.
        if (field && !("aiPageScroll" in root.dataset)) {
          const line = Math.max(1, px(fieldStyle.lineHeight));
          const spare = conversation.clientHeight + Math.max(0, field.offsetHeight - oneLine) - Math.min(minConversation, window.innerHeight * 0.4);
          fieldMax = `${Math.floor(oneLine + Math.max(0, Math.floor(spare / line)) * line)}px`;
        }
      } else delete root.dataset.aiPageScroll;
      publish("--ai-field-max", fieldMax);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onResize = () => {
      resized = true;
      schedule();
    };
    // While the question box has focus, an on-screen keyboard shrinks the
    // visual viewport: the dock rises above it and the navigation hides.
    const onViewport = () => {
      const typing = viewport && document.activeElement === field && Math.abs(viewport.scale - 1) < 0.01;
      const covered = typing ? Math.round(window.innerHeight - viewport.offsetTop - viewport.height) : 0;
      const next = covered > 120 ? covered : 0;
      // Focus also decides whether a long question counts (above).
      if (next === keyboard) {
        schedule();
        return;
      }
      keyboard = next;
      if (keyboard) root.dataset.aiTyping = "";
      else delete root.dataset.aiTyping;
      measure();
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    for (const node of [composer, conversationRef?.current, document.querySelector(".bottom-nav")]) if (node) observer?.observe(node);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", schedule, { passive: true });
    field?.addEventListener("focus", onViewport);
    field?.addEventListener("blur", onViewport);
    viewport?.addEventListener("resize", onViewport);
    viewport?.addEventListener("scroll", onViewport);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", schedule);
      field?.removeEventListener("focus", onViewport);
      field?.removeEventListener("blur", onViewport);
      viewport?.removeEventListener("resize", onViewport);
      viewport?.removeEventListener("scroll", onViewport);
      if (frame) cancelAnimationFrame(frame);
      for (const name of Object.keys(published)) root.style.removeProperty(name);
      root.style.scrollPaddingBottom = "";
      delete root.dataset.aiTyping;
      delete root.dataset.aiPageScroll;
    };
  }, [composerRef, conversationRef, fieldRef, minConversation]);
  return { cover, coverRef };
}

/**
 * Keeps a conversation at its latest turn while it opens (#93, #94): `keep`
 * runs once the host has opened the page, then whenever one of `nodes()`
 * resizes (math and diagrams rendering, panels settling), until the learner
 * scrolls, taps or types, or 1.5s pass. Returns `stop`, which also calls
 * `onStop` once.
 */
export function holdLatest(keep, nodes, onStop) {
  let active = true;
  const events = ["wheel", "touchstart", "keydown", "pointerdown"];
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (active) keep(); }) : null;
  const stop = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    observer?.disconnect();
    for (const name of events) window.removeEventListener(name, stop);
    onStop?.();
  };
  const timer = setTimeout(stop, 1_500);
  for (const name of events) window.addEventListener(name, stop, { passive: true });
  queueMicrotask(() => {
    if (!active) return;
    keep();
    for (const node of nodes()) if (node) observer?.observe(node);
  });
  return stop;
}

/**
 * Fits a tutor's question box to its text: one line when empty, however its
 * placeholder wraps, and up to its CSS max-height. Measuring it at one line
 * shortens the page, or lengthens a `scroller` beside the box (the wide
 * column's conversation), for a moment; that pulls a page or a conversation
 * at its end up and leaves it there, so both are put back, and a
 * conversation that was at its end stays there as the box grows. Returns
 * where it put the scroller, or -1 when it did not move it.
 */
export function fitQuestionBox(field, scroller) {
  const y = window.scrollY;
  const own = scroller && getComputedStyle(scroller).overflowY !== "visible" ? scroller : null;
  const top = own ? own.scrollTop : 0;
  const atEnd = Boolean(own) && own.scrollHeight - top - own.clientHeight <= 2;
  field.style.height = "auto";
  if (field.value) field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  if (window.scrollY !== y) window.scrollTo({ top: y, behavior: "instant" });
  if (!own) return -1;
  const next = atEnd ? own.scrollHeight - own.clientHeight : top;
  if (Math.abs(own.scrollTop - next) < 1) return -1;
  own.scrollTop = next;
  return own.scrollTop;
}
