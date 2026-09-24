import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import { markdownRenderer, sanitizeMarkdownHtml } from "./markdown.js";

// Lazy reader path for edited copies and uploads that contain TeX. Built-in
// lectures never load this module (see hasTexMath in markdown.js).
const mathMarked = new Marked();
mathMarked.use({ gfm: true, breaks: false, renderer: markdownRenderer });
mathMarked.use(markedKatex({
  throwOnError: false,
  trust: false,
  strict: "warn",
  maxExpand: 1_000,
  maxSize: 10,
  output: "htmlAndMathml",
}));

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/u;

// Marked-KaTeX renders display math only as its own block; learners often
// write `$$…$$` or `\[…\]` on a single line.
const normalizeDisplayMath = (source) => {
  let fence = "";
  return String(source || "").replace(/\r\n?/gu, "\n").split("\n").map((line) => {
    const marker = line.match(FENCE_LINE)?.[1] || "";
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return line;
    }
    if (fence) return line;
    const display = line.match(/^\s*\$\$([^\n]+?)\$\$\s*$/u) || line.match(/^\s*\\\[([^\n]+?)\\\]\s*$/u);
    return display?.[1]?.trim() ? `\n$$\n${display[1].trim()}\n$$\n` : line;
  }).join("\n");
};

/** Reader Markdown with KaTeX math; the output is sanitized like every render. */
export const renderMarkdownWithMath = (source) => sanitizeMarkdownHtml(mathMarked.parse(normalizeDisplayMath(source)));
