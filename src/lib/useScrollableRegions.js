import { useLayoutEffect } from "react";

const SELECTOR = ".ai-tutor__scroll";

const updateRegion = (region) => {
  const overflowing = region.scrollWidth > region.clientWidth + 1;
  region.classList.toggle("is-overflowing", overflowing);
  if (overflowing) {
    // Keyboard users can only scroll what they can focus; name what it is.
    region.tabIndex = 0;
    region.setAttribute("role", "group");
    region.setAttribute("aria-label", `${region.dataset.scrollLabel || "Content"}, scrolls sideways`);
  } else {
    region.removeAttribute("tabindex");
    region.removeAttribute("role");
    region.removeAttribute("aria-label");
  }
};

/**
 * Tutor answers wrap wide tables and display equations in `.ai-tutor__scroll`
 * (see tutorMarkdown.js). A wrapper that actually overflows becomes a named,
 * keyboard-focusable group; one that fits stays out of the Tab order.
 */
export function useScrollableRegions(containerRef, contentKey) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let active = true;
    const updateAll = () => {
      if (active) container.querySelectorAll(SELECTOR).forEach(updateRegion);
    };
    updateAll();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateAll) : null;
    observer?.observe(container);
    // KaTeX fonts can arrive after the first layout and widen an equation.
    void globalThis.document?.fonts?.ready?.then(updateAll).catch(() => {});
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [containerRef, contentKey]);
}
