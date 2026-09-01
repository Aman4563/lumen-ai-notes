/**
 * Standalone HTML export of a document (CONTENT-002 slice). The caller
 * renders the Markdown (the renderer needs the DOM sanitizer), and this
 * module wraps it in a self-contained readable page — no external assets,
 * so the file opens anywhere and prints cleanly. Interactive affordances
 * from the in-app renderer (copy buttons, pending diagram shells) are
 * neutralized by print-safe CSS rather than re-parsing the HTML.
 */
const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const documentToStandaloneHtml = ({ title, renderedHtml, sourceLabel = "", exportedAt = new Date() }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #1c2536; background: #fffdf8; font: 17px/1.7 Georgia, "Times New Roman", serif; }
  h1, h2, h3, h4 { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.25; letter-spacing: -0.01em; }
  pre { overflow-x: auto; padding: 14px; border: 1px solid #e2ddd2; border-radius: 8px; background: #f7f4ec; font-size: 0.85em; }
  code { font-family: ui-monospace, Menlo, monospace; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { padding: 6px 10px; border: 1px solid #d8d2c4; text-align: left; }
  blockquote { margin: 1em 0; padding: 2px 16px; border-left: 3px solid #d8d2c4; color: #4c5568; }
  .code-label, .code-copy, [data-diagram-status] > .mermaid { display: none; }
  .diagram-shell::before { content: "— diagram omitted in the exported copy —"; color: #8a8272; font-style: italic; }
  footer.export-provenance { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e2ddd2; color: #8a8272; font-size: 0.72em; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<article>
${renderedHtml}
</article>
<footer class="export-provenance">Exported from Lumen AI Notes${sourceLabel ? ` — ${escapeHtml(sourceLabel)}` : ""} on ${escapeHtml(exportedAt.toISOString().slice(0, 10))}. Content is the learner's local copy.</footer>
</body>
</html>
`;
