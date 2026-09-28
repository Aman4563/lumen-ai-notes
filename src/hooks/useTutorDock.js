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
 * - `--ai-column-min`: on wide screens, the height the tutor's column needs
 *   for a conversation of `minConversation` (at most 40% of the screen);
 *   below it the page scrolls instead of the conversation shrinking.
 *
 * A dock that would take more than about 60% of the room between the top
 * bar and the navigation (large text on a small phone), or overlap the
 * navigation because the tutor starts too far down the page, stays in the
 * page flow (`data-dock="off"`) until it would fit again with a margin, so it
 * does not flicker. The returned `coverRef` (and `cover`, for effects) is
 * how much of the viewport's bottom the dock or the navigation covers, for
 * following and revealing. The composer's element is the dock; the
 * conversation is optional and only needed for the wide-screen column.
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
    const measure = () => {
      frame = 0;
      const nav = document.querySelector(".bottom-nav");
      const navShown = Boolean(nav) && getComputedStyle(nav).display !== "none";
      const top = Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0);
      const bottom = navShown ? nav.getBoundingClientRect().top : window.innerHeight;
      publish("--ai-top", `${Math.round(top)}px`);
      publish("--ai-nav-space", navShown ? `${Math.ceil(window.innerHeight - bottom + 8)}px` : "");
      publish("--ai-dock-bottom", keyboard ? `${keyboard + 8}px` : "");
      // The question box's own growth is left out, so typing never moves it.
      const fieldStyle = field ? getComputedStyle(field) : null;
      const oneLine = fieldStyle ? Math.max(px(fieldStyle.minHeight), px(fieldStyle.lineHeight) + px(fieldStyle.paddingTop) + px(fieldStyle.paddingBottom) + px(fieldStyle.borderTopWidth) + px(fieldStyle.borderBottomWidth)) : 0;
      const height = composer.offsetHeight - (field ? Math.max(0, field.offsetHeight - oneLine) : 0);
      const share = height / Math.max(1, bottom - top);
      // A sticky dock cannot rise above its card, so a card that starts
      // too far down would hold it over the navigation.
      const overlap = navShown && !keyboard ? composer.parentElement.getBoundingClientRect().top + height + 8 - bottom : Number.NEGATIVE_INFINITY;
      if (composer.dataset.dock !== "off") {
        if (share > 0.6 || overlap > 1) composer.dataset.dock = "off";
      } else if (share < 0.5 && overlap < -24) delete composer.dataset.dock;
      const style = getComputedStyle(composer);
      const space = style.position === "sticky" ? Math.ceil(composer.offsetHeight + px(style.bottom)) : 0;
      publish("--ai-composer-space", `${space}px`);
      const covered = Math.max(space, Math.ceil(window.innerHeight - bottom));
      root.style.scrollPaddingBottom = covered ? `${covered + 12}px` : "";
      coverRef.current = covered;
      setCover((current) => (Math.abs(current - covered) > 2 ? covered : current));
      const page = composer.closest(".ai-page");
      const conversation = conversationRef?.current;
      if (page && conversation && getComputedStyle(page).display === "flex") {
        const card = composer.parentElement;
        const need = conversation.getBoundingClientRect().top - page.getBoundingClientRect().top
          + Math.min(minConversation, window.innerHeight * 0.4)
          + px(getComputedStyle(conversation.parentElement).borderBottomWidth)
          + composer.offsetHeight + px(style.marginTop) + px(style.marginBottom)
          + px(getComputedStyle(card).borderBottomWidth) + px(getComputedStyle(page).paddingBottom);
        publish("--ai-column-min", `${Math.round(need)}px`);
      } else publish("--ai-column-min", "");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    // While the question box has focus, an on-screen keyboard shrinks the
    // visual viewport: the dock rises above it and the navigation hides.
    const onViewport = () => {
      const typing = viewport && document.activeElement === field && Math.abs(viewport.scale - 1) < 0.01;
      const covered = typing ? Math.round(window.innerHeight - viewport.offsetTop - viewport.height) : 0;
      const next = covered > 120 ? covered : 0;
      if (next === keyboard) return;
      keyboard = next;
      if (keyboard) root.dataset.aiTyping = "";
      else delete root.dataset.aiTyping;
      measure();
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    for (const node of [composer, conversationRef?.current, document.querySelector(".bottom-nav")]) if (node) observer?.observe(node);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    field?.addEventListener("focus", onViewport);
    field?.addEventListener("blur", onViewport);
    viewport?.addEventListener("resize", onViewport);
    viewport?.addEventListener("scroll", onViewport);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      field?.removeEventListener("focus", onViewport);
      field?.removeEventListener("blur", onViewport);
      viewport?.removeEventListener("resize", onViewport);
      viewport?.removeEventListener("scroll", onViewport);
      if (frame) cancelAnimationFrame(frame);
      for (const name of Object.keys(published)) root.style.removeProperty(name);
      root.style.scrollPaddingBottom = "";
      delete root.dataset.aiTyping;
    };
  }, [composerRef, conversationRef, fieldRef, minConversation]);
  return { cover, coverRef };
}
