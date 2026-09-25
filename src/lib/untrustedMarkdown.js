import { Marked } from "marked";
import { markdownRenderer, sanitizeMarkdownHtml } from "./markdown.js";

/**
 * Markdown rules for text the model wrote (issues #69 and #81). The tutor
 * renderer (tutorMarkdown.js) adds citation controls, KaTeX and its own
 * layout on top of these rules. renderUntrustedMarkdown applies them alone to
 * AI output saved elsewhere in the app, such as AI flashcards in Review.
 * This module does not import KaTeX, so screens that use it stay small.
 *
 * - Raw HTML is never a token: tags show as escaped text. A bare <br> is the
 *   only model HTML kept.
 * - A link opens only an absolute http(s) or mailto address. In-app routes,
 *   relative paths and addresses on the app's own host render as the label.
 * - A link whose label shows a citation marker renders without the link.
 * - Images never load. A remote image becomes a link that opens it in a new
 *   tab; any other image is shown as its alt text.
 */

// `[S1]: …` is a citation followed by text, not a link reference definition
// that would hide the line.
const CITATION_DEFINITION = /^ {0,3}\[[SW]\d+\]:/;
// A citation marker anywhere in a label, as a control or as text.
const CITATION_TEXT = /\[[SW]\d+\]/;
const LINE_BREAK_TAG = /^<br\s*\/?>/i;
const LINE_BREAK_START = /<br\s*\/?>/i;

export const escapeAttribute = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

// Element text. Like marked's own escaping, an entity already in the source
// stays an entity rather than showing as "&amp;".
const escapeText = (value) => String(value ?? "")
  .replace(/&(?!#?\w+;)/gu, "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

// The first word of a fence's info string names its language. Quotes in it
// must not reach the code block's class and aria-label attributes.
const fenceLanguage = (lang) => String(lang || "").trim().split(/\s/u, 1)[0].replace(/["'`]/gu, "");

/** A label's text with citations as their markers, for link and alt checks. */
export const plainLabel = (tokens = []) => tokens.map((token) => {
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
export const showsCitationMarker = (text) => CITATION_TEXT.test(String(text ?? "")
  .replace(LABEL_ENTITY, (entity, decimal, hex, name) => {
    if (name) return BRACKET_ENTITIES[name.toLowerCase()];
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  })
  .normalize("NFKC")
  .replace(/[\p{Cf}\s]/gu, ""));

const hostOf = (value) => {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return "";
  }
};

const currentOrigin = () => globalThis.location?.origin || "";

/**
 * Where a model link may go, or null when it renders as text. The address is
 * returned normalized: a browser resolves `http:#/read/…` or `http:/path`
 * against the page itself, so the raw value would open an in-app route that
 * the http(s) check had passed. A link to the app's own host (any scheme or
 * port) also stays text, like an in-app route.
 */
export const untrustedLinkTarget = (href, appOrigin = currentOrigin()) => {
  const value = String(href || "").trim();
  if (/^mailto:/iu.test(value)) return { href: value, external: false };
  if (!/^https?:/iu.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const appHost = hostOf(appOrigin);
  if (appHost && url.hostname.toLowerCase().replace(/\.$/u, "") === appHost) return null;
  return { href: url.href, external: true };
};

const imageText = (token) => {
  const text = (plainLabel(token.tokens) || token.text || "").trim();
  return text ? `Image: ${text}` : "Image";
};

// An image inside a link label becomes its text, so a label never holds a
// second link.
const withoutImages = (tokens = []) => tokens.map((token) => {
  if (token.type === "image") return { type: "text", raw: token.raw, text: imageText(token), escaped: false };
  return Array.isArray(token.tokens) ? { ...token, tokens: withoutImages(token.tokens) } : token;
});

const appOriginFor = (parser) => parser.options.untrustedAppOrigin ?? currentOrigin();

/**
 * Renderer methods shared by every untrusted profile. They run with marked's
 * renderer as `this`.
 */
export const untrustedRenderer = {
  code(token) {
    return markdownRenderer.code.call(this, { ...token, lang: fenceLanguage(token.lang) });
  },
  // The Reader's renderer writes a link's raw label and leaves quotes in its
  // title unescaped. Here the label is parsed Markdown and every attribute
  // value is escaped. A label that shows a citation marker renders without
  // its link: a verified [S#] button inside a model's <a> would follow the
  // model's URL on click, and an encoded &#91;S1&#93; label would pass for one.
  link(token) {
    const label = this.parser.parseInline(withoutImages(token.tokens));
    const target = showsCitationMarker(plainLabel(token.tokens)) ? null : untrustedLinkTarget(token.href, appOriginFor(this.parser));
    if (!target) return label;
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
    const external = target.external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeAttribute(target.href)}"${title}${external}>${label}</a>`;
  },
  // An <img> would fetch its source as soon as it renders: a tracking and
  // exfiltration path for whatever the model encodes in the URL. A remote
  // image becomes a link the learner can choose to open; anything else shows
  // its alt text. Citations in the alt text show as markers.
  image(token) {
    const text = imageText(token);
    const target = showsCitationMarker(text) ? null : untrustedLinkTarget(token.href, appOriginFor(this.parser));
    if (!target?.external) return escapeText(text);
    return `<a href="${escapeAttribute(target.href)}" target="_blank" rel="noopener noreferrer">${escapeText(text)} (${escapeText(new URL(target.href).host)})</a>`;
  },
  // Unreachable while the html tokenizers are off. Kept so that an html token
  // from a future extension is still shown as text.
  html(token) {
    const text = escapeAttribute(token.text);
    return token.block ? `<p>${text}</p>\n` : text;
  },
};

// Raw HTML in model text never becomes a token: block and inline tags fall
// through to paragraph and text tokens, which marked escapes.
export const untrustedTokenizer = {
  html() { return undefined; },
  tag() { return undefined; },
  def(src) { return CITATION_DEFINITION.test(src) ? undefined : false; },
};

// Models put <br> in table cells, which have no other line break. The bare
// tag is the only HTML kept: it renders as a fixed <br> and cannot carry
// attributes.
export const lineBreakExtension = {
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
};

const untrustedMarked = new Marked();
untrustedMarked.use({ gfm: true, breaks: false, renderer: markdownRenderer });
untrustedMarked.use({ tokenizer: untrustedTokenizer, renderer: untrustedRenderer, extensions: [lineBreakExtension] });

/**
 * Saved AI output before DOMPurify. No evidence travels with saved text, so
 * [S#]/[W#] markers stay plain text: saved content declares no citation
 * controls. Exported for unit tests, because DOMPurify needs a DOM.
 */
export const renderUntrustedMarkdownUnsanitized = (markdown, { appOrigin } = {}) => untrustedMarked.parse(
  String(markdown || "").replace(/\r\n?/gu, "\n"),
  { untrustedAppOrigin: appOrigin ?? currentOrigin() },
);

/** Saved AI output (AI flashcards, cards made from AI clippings) as sanitized HTML. */
export const renderUntrustedMarkdown = (markdown, options) => sanitizeMarkdownHtml(renderUntrustedMarkdownUnsanitized(markdown, options));
