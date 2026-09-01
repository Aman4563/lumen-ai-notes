import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { markdownRenderer, sanitizeMarkdownHtml } from "./markdown.js";

const tutorMarked = new Marked();
tutorMarked.use({
  gfm: true,
  breaks: false,
  renderer: markdownRenderer,
});

// Keep the comparatively large KaTeX runtime and fonts in the lazy tutor
// route, not the mobile startup bundle. AI output is still rendered locally,
// untrusted, and sanitized before it reaches the DOM.
tutorMarked.use(markedKatex({
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
}));

const renderTutorBaseMarkdown = (source) => sanitizeMarkdownHtml(tutorMarked.parse(source || ""));

const CITATION_PATTERN = /^\[([SW])(\d+)\]/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

const escapeAttribute = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const safeWebUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
};

const citationMarkup = (kind, number, source) => {
  const label = `[${kind}${number}]`;
  if (!source) return `<span class="ai-tutor__citation ai-tutor__citation--missing" title="Citation evidence was not supplied">${label}</span>`;
  if (kind === "W") {
    const url = safeWebUrl(source.url);
    if (!url) return `<span class="ai-tutor__citation ai-tutor__citation--missing" title="Citation evidence was not supplied">${label}</span>`;
    return `<a class="ai-tutor__citation" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open web citation ${label}: ${escapeAttribute(source.title || "web source")}">${label}</a>`;
  }
  return `<button class="ai-tutor__citation" type="button" data-ai-citation="S${number}" aria-label="Open citation ${label}: ${escapeAttribute(source.title || "library source")}">${label}</button>`;
};

const decorateInlineCitations = (line, sourceMap, webSourceMap) => {
  let output = "";
  let index = 0;
  let inlineFence = "";
  while (index < line.length) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const run = line.slice(index, end);
      if (!inlineFence) inlineFence = run;
      else if (run === inlineFence) inlineFence = "";
      output += run;
      index = end;
      continue;
    }
    if (!inlineFence && line[index] === "[") {
      const match = line.slice(index).match(CITATION_PATTERN);
      if (match) {
        const [, kind, number] = match;
        const source = kind === "S" ? sourceMap.get(Number(number)) : webSourceMap.get(Number(number));
        output += citationMarkup(kind, number, source);
        index += match[0].length;
        continue;
      }
    }
    output += line[index];
    index += 1;
  }
  return output;
};

/**
 * Adds trusted citation controls without touching citations inside fenced or
 * inline code. The resulting Markdown is still passed through DOMPurify.
 */
export const decorateTutorCitations = (markdown, citationSources = [], webSources = []) => {
  const sourceMap = new Map(citationSources.map((source) => [Number(source.citationNumber), source]));
  const webCandidates = new Map();
  webSources.forEach((source, position) => {
    const hasExplicitIndex = Boolean(source) && Object.hasOwn(source, "index");
    const citationNumber = hasExplicitIndex ? Number(source.index) : position + 1;
    // Explicit phone evidence can be sparse after grounding validation. Never
    // renumber it by array position, and fail closed when two records claim the
    // same label or an explicit label is outside the renderer's safe range.
    if (!Number.isSafeInteger(citationNumber) || citationNumber < 1 || citationNumber > 99) return;
    if (webCandidates.has(citationNumber)) webCandidates.set(citationNumber, null);
    else webCandidates.set(citationNumber, source);
  });
  const webSourceMap = new Map([...webCandidates].filter(([, source]) => source));
  let fence = "";
  return String(markdown || "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const marker = line.match(FENCE_PATTERN)?.[1] || "";
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence && marker.length >= 3) fence = "";
      return line;
    }
    return fence ? line : decorateInlineCitations(line, sourceMap, webSourceMap);
  }).join("\n");
};

/**
 * Small local models commonly emit a valid TeX expression as `$$x$$` on one
 * physical line even when asked for a display block. marked-katex deliberately
 * recognizes display math only when the delimiters frame their own block. Make
 * that harmless formatting variation render consistently, and accept the
 * equally common `\[x\]` form, without rewriting fenced code or unfinished
 * streaming delimiters.
 */
export const normalizeTutorMathDelimiters = (markdown) => {
  let fence = "";
  return String(markdown || "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const marker = line.match(FENCE_PATTERN)?.[1] || "";
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence && marker.length >= 3) fence = "";
      return line;
    }
    if (fence) return line;
    const dollarDisplay = line.match(/^\s*\$\$([^\n]+?)\$\$\s*$/u);
    if (dollarDisplay?.[1]?.trim()) return `\n$$\n${dollarDisplay[1].trim()}\n$$\n`;
    const bracketDisplay = line.match(/^\s*\\\[([^\n]+?)\\\]\s*$/u);
    if (bracketDisplay?.[1]?.trim()) return `\n$$\n${bracketDisplay[1].trim()}\n$$\n`;
    return line;
  }).join("\n");
};

/**
 * Marked accepts an unfinished paragraph/list/fence, which lets the same
 * renderer safely handle both completed answers and in-flight stream chunks.
 */
export const renderTutorMarkdown = (markdown, citationSources = [], webSources = []) => (
  renderTutorBaseMarkdown(decorateTutorCitations(normalizeTutorMathDelimiters(markdown), citationSources, webSources))
);

export const tutorMarkdownPlainText = (markdown) => String(markdown || "")
  .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""))
  .replace(/`([^`]+)`/g, "$1")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^[ \t]*>[ \t]?/gm, "")
  .replace(/^[ \t]*[-+*][ \t]+/gm, "• ")
  .replace(/[*_~]{1,3}/g, "")
  .trim();
