import katex from "katex";
import { Marked, Renderer } from "marked";
import markedKatex from "marked-katex-extension";
import { markdownRenderer, sanitizeMarkdownHtml } from "./markdown.js";
import { escapeAttribute, lineBreakExtension, untrustedRenderer, untrustedTokenizer } from "./untrustedMarkdown.js";
import { tutorPlainText } from "./tutorExport.js";

const CITATION_PATTERN = /^\[([SW])(\d+)\]/;
const CITATION_START = /\[[SW]\d/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

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

/** The evidence one render may cite, keyed by the label number the model sees. */
const citationContext = (citationSources = [], webSources = []) => {
  const library = new Map(citationSources.map((source) => [Number(source.citationNumber), source]));
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
  return { library, web: new Map([...webCandidates].filter(([, source]) => source)) };
};

const EMPTY_CITATIONS = Object.freeze(citationContext());

const tutorMarked = new Marked();
tutorMarked.use({
  gfm: true,
  breaks: false,
  renderer: markdownRenderer,
});

// Model output is untrusted, and DOMPurify's default profile keeps <button>
// and data-* attributes. The shared untrusted rules (untrustedMarkdown.js)
// show raw HTML as text, keep only a bare <br>, open links only to absolute
// web and mail addresses off the app's own host, drop a link whose label shows
// a citation marker, and turn images into links that load nothing. A model
// cannot author a citation control, a data-ai-* attribute or a form. Citation
// controls come only from the tutorCitation extension below, for [S#]/[W#]
// markers outside code. The Reader's renderer (markdown.js) is unchanged.
//
// Tutor answers sit under the page's h1, the tutor's h2 and a per-message h3,
// so model headings start at h4. The class keeps their visual size.
// Wide tables get a wrapper that the tutor makes keyboard-scrollable when it
// actually overflows. Only this tutor-only instance changes; lessons do not.
tutorMarked.use({
  tokenizer: untrustedTokenizer,
  renderer: {
    ...untrustedRenderer,
    heading(token) {
      const level = Math.min(6, Math.max(4, token.depth + 2));
      return `<h${level} class="ai-tutor__md-h${Math.min(token.depth, 4)}">${this.parser.parseInline(token.tokens)}</h${level}>\n`;
    },
    table(token) {
      return `<div class="ai-tutor__scroll" data-scroll-label="Table">${Renderer.prototype.table.call(this, token)}</div>\n`;
    },
  },
  extensions: [
    {
      name: "tutorCitation",
      level: "inline",
      start(src) {
        const index = src.search(CITATION_START);
        return index < 0 ? undefined : index;
      },
      tokenizer(src) {
        const match = CITATION_PATTERN.exec(src);
        if (match) return { type: "tutorCitation", raw: match[0], kind: match[1], number: match[2] };
        return undefined;
      },
      // The evidence arrives as a per-parse option, so renders of different
      // answers never share a source map.
      renderer(token) {
        const { library, web } = this.parser.options.tutorCitations || EMPTY_CITATIONS;
        const number = Number(token.number);
        return citationMarkup(token.kind, token.number, token.kind === "S" ? library.get(number) : web.get(number));
      },
    },
    lineBreakExtension,
  ],
});

// Keep the comparatively large KaTeX runtime and fonts in the lazy tutor
// route, not the mobile startup bundle. AI output is still rendered locally,
// untrusted, and sanitized before it reaches the DOM.
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
tutorMarked.use(markedKatex({ ...KATEX_OPTIONS }));
// Display equations get the same scroll wrapper as tables.
tutorMarked.use({
  extensions: [{
    name: "blockKatex",
    renderer(token) {
      if (!token.displayMode) return false;
      return `<div class="ai-tutor__scroll ai-tutor__scroll--math" data-scroll-label="Equation">${katex.renderToString(token.text, { ...KATEX_OPTIONS, displayMode: true })}</div>\n`;
    },
  }],
});

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
 * Tutor Markdown before DOMPurify: model-authored HTML is already text and
 * the only citation controls are the renderer's own. Exported for unit tests,
 * because DOMPurify needs a DOM; the UI uses renderTutorMarkdown. `appOrigin`
 * (default: the page's origin) names the host whose links render as text.
 */
export const renderTutorMarkdownUnsanitized = (markdown, citationSources = [], webSources = [], { appOrigin } = {}) => tutorMarked.parse(
  normalizeTutorMathDelimiters(markdown),
  { tutorCitations: citationContext(citationSources, webSources), untrustedAppOrigin: appOrigin },
);

/**
 * Marked accepts an unfinished paragraph/list/fence, which lets the same
 * renderer safely handle both completed answers and in-flight stream chunks.
 */
export const renderTutorMarkdown = (markdown, citationSources = [], webSources = []) => (
  sanitizeMarkdownHtml(renderTutorMarkdownUnsanitized(markdown, citationSources, webSources))
);

/** One structured field before DOMPurify; see renderTutorMarkdownUnsanitized. */
export const renderTutorInlineMarkdownUnsanitized = (text, citationSources = [], webSources = [], { appOrigin } = {}) => tutorMarked.parseInline(
  String(text || "").replace(/\r\n?/g, "\n").replace(/\n+/g, " "),
  { tutorCitations: citationContext(citationSources, webSources), untrustedAppOrigin: appOrigin },
);

/**
 * One structured-result field (a quiz option, a card side, a plan step) as
 * sanitized inline HTML: emphasis, code spans, KaTeX math and the same
 * citation controls as prose. Inline parsing cannot produce blocks, fences or
 * Mermaid diagrams.
 */
export const renderTutorInlineMarkdown = (text, citationSources = [], webSources = []) => (
  sanitizeMarkdownHtml(renderTutorInlineMarkdownUnsanitized(text, citationSources, webSources))
);

// Plain text that keeps code, math and identifiers such as `for _ in` intact.
export const tutorMarkdownPlainText = tutorPlainText;
