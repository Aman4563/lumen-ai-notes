import { useEffect, useMemo, useState } from "react";
import { hasTexMath, renderMarkdown } from "./markdown.js";

let mathRenderer = null;
let mathImport = null;

const loadMathRenderer = () => {
  if (!mathImport) {
    mathImport = import("./markdownMath.js")
      .then((module) => {
        mathRenderer = module.renderMarkdownWithMath;
        return mathRenderer;
      })
      .catch((error) => {
        // An offline or stale chunk must stay retryable.
        mathImport = null;
        throw error;
      });
  }
  return mathImport;
};

/** The math-aware renderer once loaded; plain Markdown until then. */
export const renderReaderMarkdown = (source) => (mathRenderer && hasTexMath(source) ? mathRenderer(source) : renderMarkdown(source));

/**
 * Sanitized reader HTML. Sources with TeX first render as plain Markdown
 * (the raw delimiters stay readable), then rerender once KaTeX has loaded.
 */
export const useRenderedMarkdown = (source) => {
  const needsMath = useMemo(() => hasTexMath(source), [source]);
  const [mathReady, setMathReady] = useState(() => Boolean(mathRenderer));
  useEffect(() => {
    if (!needsMath || mathRenderer) return undefined;
    let active = true;
    loadMathRenderer().then(() => { if (active) setMathReady(true); }).catch(() => {});
    return () => { active = false; };
  }, [needsMath]);
  return useMemo(() => (needsMath && mathReady && mathRenderer ? mathRenderer(source) : renderMarkdown(source)), [mathReady, needsMath, source]);
};
