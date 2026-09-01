import DOMPurify from "dompurify";
import { marked } from "marked";
import { mermaidDefinitionForFence } from "./mermaidDiagrams.js";

const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const markdownRenderer = {
  code(token) {
    const language = (token.lang || "").trim().toLowerCase();
    const diagram = mermaidDefinitionForFence(language, token.text);
    if (diagram) {
      return `<div class="diagram-shell" data-diagram-status="pending"><div class="mermaid" data-diagram-status="pending" role="img" aria-label="Mermaid diagram awaiting rendering">${escapeHtml(diagram)}</div></div>`;
    }
    const label = language || "text";
    return `<div class="code-shell"><div class="code-label"><span>${escapeHtml(label)}</span><button class="code-copy" type="button" aria-label="Copy ${escapeHtml(label)} code">Copy</button></div><pre><code class="language-${escapeHtml(language)}">${escapeHtml(token.text)}</code></pre></div>`;
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
