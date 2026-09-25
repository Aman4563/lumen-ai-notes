import katex from "katex";
import { Marked, Renderer } from "marked";
import markedKatex from "marked-katex-extension";
import { markdownRenderer, sanitizeMarkdownHtml } from "./markdown.js";
import { tutorPlainText } from "./tutorExport.js";

const CITATION_PATTERN = /^\[([SW])(\d+)\]/;
const CITATION_START = /\[[SW]\d/;
// `[S1]: …` is a citation followed by text, not a link reference definition
// that would hide the line.
const CITATION_DEFINITION = /^ {0,3}\[[SW]\d+\]:/;
// A citation marker anywhere in a link's label, as a control or as text.
const CITATION_TEXT = /\[[SW]\d+\]/;
// Model links stay links only to absolute web and mail addresses.
const LINK_HREF = /^(?:https?:|mailto:)/i;
const LINE_BREAK_TAG = /^<br\s*\/?>/i;
const LINE_BREAK_START = /<br\s*\/?>/i;
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

// The first word of a fence's info string names its language. Quotes in it
// must not reach the code block's class and aria-label attributes.
const fenceLanguage = (lang) => String(lang || "").trim().split(/\s/u, 1)[0].replace(/["'`]/gu, "");

/** A label's text with citations as their markers, for link and alt checks. */
const plainLabel = (tokens = []) => tokens.map((token) => {
  if (token.type === "tutorCitation") return `[${token.kind}${token.number}]`;
  if (Array.isArray(token.tokens)) return plainLabel(token.tokens);
  return String(token.text ?? "");
}).join("");

const BRACKET_ENTITIES = { lsqb: "[", lbrack: "[", rsqb: "]", rbrack: "]" };
const LABEL_ENTITY = /&(?:#(\d{1,7})|#x([\da-f]{1,6})|(lsqb|lbrack|rsqb|rbrack));/giu;

/**
 * True when a label reads as a citation marker once entities, full-width
 * forms and invisible or space characters are resolved, so `&#91;S1&#93;`
 * cannot pass for one either.
 */
const showsCitationMarker = (text) => CITATION_TEXT.test(text
  .replace(LABEL_ENTITY, (entity, decimal, hex, name) => {
    if (name) return BRACKET_ENTITIES[name.toLowerCase()];
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  })
  .normalize("NFKC")
  .replace(/[\p{Cf}\s]/gu, ""));

const tutorMarked = new Marked();
tutorMarked.use({
  gfm: true,
  breaks: false,
  renderer: markdownRenderer,
});

// Model output is untrusted, and DOMPurify's default profile keeps <button>
// and data-* attributes. So raw HTML in a tutor answer never becomes a token:
// block and inline tags fall through to paragraph and text tokens, which
// marked escapes, and the learner sees the markup as text. A model cannot
// author a citation control, a data-ai-* attribute or a form. Citation
// controls come only from the tutorCitation extension below, for [S#]/[W#]
// markers outside code. The Reader's renderer (markdown.js) is unchanged.
//
// Tutor answers sit under the page's h1, the tutor's h2 and a per-message h3,
// so model headings start at h4. The class keeps their visual size.
// Wide tables get a wrapper that the tutor makes keyboard-scrollable when it
// actually overflows. Only this tutor-only instance changes; lessons do not.
tutorMarked.use({
  tokenizer: {
    html() { return undefined; },
    tag() { return undefined; },
    def(src) { return CITATION_DEFINITION.test(src) ? undefined : false; },
  },
  renderer: {
    heading(token) {
      const level = Math.min(6, Math.max(4, token.depth + 2));
      return `<h${level} class="ai-tutor__md-h${Math.min(token.depth, 4)}">${this.parser.parseInline(token.tokens)}</h${level}>\n`;
    },
    table(token) {
      return `<div class="ai-tutor__scroll" data-scroll-label="Table">${Renderer.prototype.table.call(this, token)}</div>\n`;
    },
    code(token) {
      return markdownRenderer.code.call(this, { ...token, lang: fenceLanguage(token.lang) });
    },
    // The shared renderer writes a link's raw label and leaves quotes in its
    // title unescaped. Here the label is parsed Markdown and every attribute
    // value is escaped.
    //
    // A label that shows a citation marker renders without its link: a
    // verified [S#] button inside a model's <a> would follow the model's URL
    // on click, and an encoded &#91;S1&#93; label would pass for one. An
    // in-app route (#/read/…) or relative path would open a library note that
    // no citation validated, so those labels render as text too.
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      const href = String(token.href || "").trim();
      if (!LINK_HREF.test(href) || showsCitationMarker(plainLabel(token.tokens))) return label;
      const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
      const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeAttribute(href)}"${title}${external}>${label}</a>`;
    },
    // marked builds alt text with each token's renderer, so a citation in
    // the alt would become button markup there. Use its marker instead.
    image(token) {
      return Renderer.prototype.image.call(this, { ...token, tokens: undefined, text: plainLabel(token.tokens) || token.text });
    },
    // Unreachable while the html tokenizers are off. Kept so that an html
    // token from a future extension is still shown as text.
    html(token) {
      const text = escapeAttribute(token.text);
      return token.block ? `<p>${text}</p>\n` : text;
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
    {
      // Models put <br> in table cells, which have no other line break. The
      // bare tag is the only HTML kept: it renders as a fixed <br> and cannot
      // carry attributes.
      name: "tutorLineBreak",
      level: "inline",
      start(src) {
        const index = src.search(LINE_BREAK_START);
        return index < 0 ? undefined : index;
      },
      tokenizer(src) {
        const match = LINE_BREAK_TAG.exec(src);
        return match ? { type: "tutorLineBreak", raw: match[0] } : undefined;
      },
      renderer() {
        return "<br>";
      },
    },
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
 * because DOMPurify needs a DOM; the UI uses renderTutorMarkdown.
 */
export const renderTutorMarkdownUnsanitized = (markdown, citationSources = [], webSources = []) => tutorMarked.parse(
  normalizeTutorMathDelimiters(markdown),
  { tutorCitations: citationContext(citationSources, webSources) },
);

/**
 * Marked accepts an unfinished paragraph/list/fence, which lets the same
 * renderer safely handle both completed answers and in-flight stream chunks.
 */
export const renderTutorMarkdown = (markdown, citationSources = [], webSources = []) => (
  sanitizeMarkdownHtml(renderTutorMarkdownUnsanitized(markdown, citationSources, webSources))
);

/** One structured field before DOMPurify; see renderTutorMarkdownUnsanitized. */
export const renderTutorInlineMarkdownUnsanitized = (text, citationSources = [], webSources = []) => tutorMarked.parseInline(
  String(text || "").replace(/\r\n?/g, "\n").replace(/\n+/g, " "),
  { tutorCitations: citationContext(citationSources, webSources) },
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
