import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";
import { mermaidDefinitionForFence } from "./mermaidDiagrams.js";

const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const markdownRenderer = {
  // The untrusted profile (untrustedMarkdown.js) passes `diagram: false` to
  // show a fence as code, and `diagramAuthor: "model"` to mark a diagram whose
  // Mermaid configuration must be locked. Reader tokens carry neither.
  code(token) {
    const language = (token.lang || "").trim().toLowerCase();
    const diagram = token.diagram === false ? "" : mermaidDefinitionForFence(language, token.text);
    if (diagram) {
      const author = token.diagramAuthor === "model" ? ' data-diagram-author="model"' : "";
      return `<div class="diagram-shell" data-diagram-status="pending" tabindex="0" role="group" aria-label="Diagram"><div class="mermaid" data-diagram-status="pending" role="img" aria-label="Mermaid diagram awaiting rendering"${author}>${escapeHtml(diagram)}</div></div>`;
    }
    const label = language || "text";
    // Wide code scrolls inside <pre>. Safari does not make scrollers
    // focusable on its own, so keyboard users need an explicit named stop.
    // A named group (not a region) keeps a lecture from gaining dozens of
    // same-named landmarks.
    return `<div class="code-shell"><div class="code-label"><span>${escapeHtml(label)}</span><button class="code-copy" type="button" aria-label="Copy ${escapeHtml(label)} code">Copy</button></div><pre tabindex="0" role="group" aria-label="${escapeHtml(label)} code"><code class="language-${escapeHtml(language)}">${escapeHtml(token.text)}</code></pre></div>`;
  },
  table(token) {
    // The wrapper owns horizontal scrolling so the table keeps its native
    // semantics while staying keyboard-scrollable.
    return `<div class="table-scroll" tabindex="0" role="group" aria-label="Table">${Renderer.prototype.table.call(this, token)}</div>`;
  },
  link(token) {
    const href = escapeHtml(token.href || "");
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    const external = /^https?:/i.test(token.href || "") ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${href}"${title}${external}>${token.text}</a>`;
  },
};

marked.use({
  gfm: true,
  breaks: false,
  renderer: markdownRenderer,
});

export const sanitizeMarkdownHtml = (unsafe) => DOMPurify.sanitize(unsafe, {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: ["details", "summary"],
  ADD_ATTR: ["target", "rel", "aria-label", "type"],
});

export const renderMarkdown = (source) => {
  const unsafe = marked.parse(source || "");
  return sanitizeMarkdownHtml(unsafe);
};

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/u;

/** Source text with fenced code blocks and inline code spans removed. */
const proseOnly = (source) => {
  let fence = "";
  return String(source || "").replace(/\r\n?/gu, "\n").split("\n").filter((line) => {
    const marker = line.match(FENCE_LINE)?.[1] || "";
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return false;
    }
    return !fence;
  }).join("\n").replace(/(`+)[^`]*?\1/gu, "");
};

const TEX_DISPLAY = /\$\$[^$]+?\$\$/u;
// Inline $…$ needs non-space inner edges and no digit after the closing
// dollar, so prices such as "$5 and $10" stay plain text.
const TEX_INLINE = /(^|[^\\$\w])\$(?=\S)[^$\n]*?[^\s\\$]\$(?![\d$])/u;

/**
 * True when Markdown prose (outside code) contains TeX math delimiters. The
 * reader lazily loads KaTeX only for such sources, so built-in lectures,
 * which store formulas as MathML or Unicode, never pay for it.
 */
export const hasTexMath = (source) => {
  const prose = proseOnly(source);
  return TEX_DISPLAY.test(prose) || TEX_INLINE.test(prose);
};

export const slugifyHeading = (text, index = 0) => {
  const slug = text
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || `section-${index + 1}`;
};

export const splitTeachingSections = (source) => {
  const lines = (source || "").split("\n");
  const sections = [];
  let current = [];
  let title = "Introduction";

  lines.forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading && current.length) {
      sections.push({ title, markdown: current.join("\n") });
      current = [line];
      title = heading[1];
    } else {
      if (heading) title = heading[1];
      current.push(line);
    }
  });
  if (current.length) sections.push({ title, markdown: current.join("\n") });
  return sections.filter((section) => section.markdown.trim());
};
