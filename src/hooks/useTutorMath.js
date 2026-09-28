import { useEffect, useState, useSyncExternalStore } from "react";
import { ensureTutorMath, getTutorMathState, subscribeTutorMath } from "../lib/tutorMarkdown.js";

/**
 * Starts loading KaTeX for tutor answers when a tutor or an answer mounts,
 * retries when the connection returns, and re-renders once math can be drawn.
 * Returns the load state.
 */
export const useTutorMath = () => {
  const state = useSyncExternalStore(subscribeTutorMath, getTutorMathState, getTutorMathState);
  useEffect(() => {
    const load = () => {
      if (getTutorMathState() !== "ready") ensureTutorMath().catch(() => {});
    };
    load();
    window.addEventListener("online", load);
    return () => window.removeEventListener("online", load);
  }, []);
  return state;
};

/**
 * The math state one rendered answer (the element `ref` points at) draws
 * with; the answer lists it among its memo inputs, so TeX source shown before
 * KaTeX loaded becomes KaTeX without a new message. Drawing it replaces the
 * answer's markup, which would destroy a focused link or citation inside it
 * and drop keyboard and screen-reader focus to the page. So while focus is
 * inside the answer it keeps the state it was drawn with, and takes the new
 * one once focus has left it (a window blur leaves focus inside).
 */
export const useTutorMathFor = (ref) => {
  const math = useTutorMath();
  const [drawn, setDrawn] = useState(math);
  useEffect(() => {
    if (drawn === math) return undefined;
    const node = ref.current;
    const focusInside = () => Boolean(node?.contains(document.activeElement));
    if (!focusInside()) {
      setDrawn(math);
      return undefined;
    }
    let timer = 0;
    // Focus has settled on its new element by the next task.
    const focusMoved = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!focusInside()) setDrawn(math); }, 0);
    };
    node.addEventListener("focusout", focusMoved);
    return () => {
      clearTimeout(timer);
      node.removeEventListener("focusout", focusMoved);
    };
  }, [drawn, math, ref]);
  return drawn;
};
