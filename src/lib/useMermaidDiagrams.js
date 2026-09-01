import { useLayoutEffect } from "react";
import { renderMermaidDiagrams, subscribeToMermaidTheme } from "./mermaidDiagrams.js";

/** React lifecycle adapter for reader and tutor Markdown surfaces. */
export const useMermaidDiagrams = (rootRef, {
  contentKey,
  enabled = true,
  theme,
} = {}) => {
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = rootRef.current;
    let controller = null;
    const render = () => {
      controller?.abort();
      controller = new AbortController();
      // Effects run after React has committed refs and inner HTML, so an
      // animation-frame hop is unnecessary. More importantly, backgrounded
      // mobile tabs and some headless/WebKit lifecycles may indefinitely
      // throttle requestAnimationFrame, leaving a completed diagram stuck in
      // its readable `pending` state. Start the bounded render immediately;
      // the renderer's serialized queue and AbortSignal still suppress stale
      // writes during rapid content or theme changes.
      void renderMermaidDiagrams(rootRef.current, { signal: controller.signal, theme });
    };
    render();
    // React may reuse the streaming response subtree for the terminal answer.
    // In that transition the layout effect can run just before the sanitized
    // `dangerouslySetInnerHTML` replacement becomes observable through the
    // ref. Watch only child insertion (not renderer-owned attributes) and run
    // once a pending Mermaid node actually exists. This also covers delayed
    // HTML commits without polling or repeatedly parsing partial streams.
    const observer = root && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
        if (root.querySelector('.diagram-shell > .mermaid[data-diagram-status="pending"]')) render();
      })
      : null;
    observer?.observe(root, { childList: true, subtree: true });
    queueMicrotask(() => {
      if (root?.isConnected && root.querySelector('.diagram-shell > .mermaid[data-diagram-status="pending"]')) render();
    });
    const unsubscribe = theme ? () => {} : subscribeToMermaidTheme(render);
    return () => {
      unsubscribe();
      observer?.disconnect();
      controller?.abort();
    };
  }, [contentKey, enabled, rootRef, theme]);
};
