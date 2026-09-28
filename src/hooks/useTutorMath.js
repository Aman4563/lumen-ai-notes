import { useEffect, useSyncExternalStore } from "react";
import { ensureTutorMath, getTutorMathState, subscribeTutorMath } from "../lib/tutorMarkdown.js";

/**
 * Starts loading KaTeX for tutor answers when a tutor or an answer mounts,
 * retries when the connection returns, and re-renders once math can be drawn.
 * Returns the load state; a rendered answer lists it among its memo inputs so
 * TeX source shown before the load becomes KaTeX without a new message.
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
