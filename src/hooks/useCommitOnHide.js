import { useEffect } from "react";
import { flushSync } from "react-dom";

/**
 * Buffered text fields commit before the page is hidden or unloaded. The
 * app's pagehide/visibilitychange flush saves the last rendered profile, so
 * this capture-phase listener commits and renders synchronously first.
 */
export function useCommitOnHide(commitRef) {
  useEffect(() => {
    const commit = () => flushSync(() => commitRef.current?.());
    const onVisibility = () => { if (document.visibilityState === "hidden") commit(); };
    window.addEventListener("pagehide", commit, true);
    document.addEventListener("visibilitychange", onVisibility, true);
    return () => {
      window.removeEventListener("pagehide", commit, true);
      document.removeEventListener("visibilitychange", onVisibility, true);
    };
  }, [commitRef]);
}
