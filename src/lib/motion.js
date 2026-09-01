/**
 * Reduced-motion-aware scroll behavior (A11Y-001): explicit JS smooth
 * scrolling ignores the CSS `scroll-behavior` override, so every programmatic
 * scroll asks here instead of hard-coding "smooth".
 */
export const scrollBehavior = () => (
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth"
);
