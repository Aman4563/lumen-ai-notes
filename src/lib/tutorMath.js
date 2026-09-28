import katex from "katex";
import markedKatex from "marked-katex-extension";

// KaTeX for tutor answers, a warm tool (issue #95): tutorMarkdown.js imports
// this module on demand (ensureTutorMath) and registers these extensions on a
// fresh tutor renderer, in the order the renderer always used. AI output is
// still rendered locally, untrusted, and sanitized before it reaches the DOM.
// KaTeX's CSS stays with the tutor screens, so it is installed with them.
const KATEX_OPTIONS = Object.freeze({
  throwOnError: false,
  trust: false,
  strict: "warn",
  maxExpand: 1_000,
  maxSize: 10,
  output: "htmlAndMathml",
  // Local models commonly put inline math immediately before punctuation
  // (`$\\theta$)`). Paired non-standard delimiters parse that normal prose
  // correctly without consuming the next expression.
  nonStandard: true,
});

export const tutorMathExtensions = Object.freeze([
  markedKatex({ ...KATEX_OPTIONS }),
  // Display equations get the same scroll wrapper as tables.
  {
    extensions: [{
      name: "blockKatex",
      renderer(token) {
        if (!token.displayMode) return false;
        return `<div class="ai-tutor__scroll ai-tutor__scroll--math" data-scroll-label="Equation">${katex.renderToString(token.text, { ...KATEX_OPTIONS, displayMode: true })}</div>\n`;
      },
    }],
  },
]);
