import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTutorMathDelimiters,
  renderTutorInlineMarkdownUnsanitized,
  renderTutorMarkdownUnsanitized,
  tutorMarkdownPlainText,
  tutorSpeechText,
} from "./tutorMarkdown.js";

const sources = [{ citationNumber: 1, title: 'Library "source"' }];
const web = [{ title: "Official docs", url: "https://example.com/docs" }];
const render = (markdown, library = sources, webSources = web) => renderTutorMarkdownUnsanitized(markdown, library, webSources);

// Escaped model markup starts with "&lt;", so a literal "<" begins a real tag.
const liveTags = (html) => html.match(/<[a-z][^>]*>/giu) || [];
const liveCitationAttributes = (html) => (html.match(/data-ai-citation="/gu) || []).length;
const APP_LIBRARY_CITATION = /<button class="ai-tutor__citation" type="button" data-ai-citation="S\d+" aria-label="Open citation \[S\d+\]: [^"]*">\[S\d+\]<\/button>/gu;
// Every live tag other than the renderer's own citation buttons.
const tagsBesideAppCitations = (html) => liveTags(html.replace(APP_LIBRARY_CITATION, ""));

test("renders known library and web citations as the renderer's own controls", () => {
  const result = render("Evidence [S1] and current facts [W1].");
  assert.match(result, /<button class="ai-tutor__citation" type="button" data-ai-citation="S1"/);
  assert.match(result, /<a class="ai-tutor__citation" href="https:\/\/example\.com\/docs"/);
  assert.match(result, /Library &quot;source&quot;/);
});

test("renders a sparse retained library label without renumbering it", () => {
  const result = render("Evidence [S2]; unavailable [S1].", [
    { citationNumber: 2, title: "Second retained excerpt" },
  ], []);
  assert.match(result, /data-ai-citation="S2"/);
  assert.match(result, /citation--missing[^>]*>\[S1\]<\/span>/);
});

test("preserves sparse explicit web indexes and fails closed on duplicate labels", () => {
  const sparse = render("Latest [W2]; unavailable [W1].", [], [
    { index: 2, title: "Second result", url: "https://example.com/two" },
  ]);
  assert.match(sparse, /href="https:\/\/example\.com\/two"[^>]*>\[W2\]<\/a>/);
  assert.match(sparse, /citation--missing[^>]*>\[W1\]<\/span>/);

  const duplicate = render("Conflict [W2].", [], [
    { index: 2, title: "First claimant", url: "https://example.com/first" },
    { index: 2, title: "Second claimant", url: "https://example.com/second" },
  ]);
  assert.match(duplicate, /citation--missing/);
  assert.doesNotMatch(duplicate, /href=/);

  const invalid = render("Invalid [W1].", [], [
    { index: 0, title: "Invalid index", url: "https://example.com/invalid" },
  ]);
  assert.match(invalid, /citation--missing/);
});

test("does not render citations inside code", () => {
  const result = render("`[S1]`\n\n```js\nconst ref = '[W1]';\n```\n\n    indented [S1]\n\n[S1]");
  assert.equal(liveCitationAttributes(result), 1);
  assert.match(result, /<code>\[S1\]<\/code>/);
  assert.match(result, /const ref = '\[W1\]'/);
  assert.match(result, /indented \[S1\]/);
  assert.doesNotMatch(result, /ai-tutor__citation" href/);
});

test("keeps incomplete Markdown readable during streaming", () => {
  const result = render("## Partial\n\n```python\nprint('[S1]')");
  assert.match(result, /<h4 class="ai-tutor__md-h2">Partial<\/h4>/);
  assert.match(result, /class="code-shell"/);
  assert.match(result, /print\('\[S1\]'\)/);
  assert.equal(liveCitationAttributes(result), 0);
});

test("normalizes one-line model display math without rewriting code or partial streams", () => {
  assert.equal(normalizeTutorMathDelimiters("Before\n\n$$y = r + \\gamma Q(s', a')$$\n\nAfter"), "Before\n\n\n$$\ny = r + \\gamma Q(s', a')\n$$\n\n\nAfter");
  assert.equal(normalizeTutorMathDelimiters("\\[x^2 + y^2\\]"), "\n$$\nx^2 + y^2\n$$\n");
  assert.equal(normalizeTutorMathDelimiters("```text\n$$not math$$\n```\n\n$$partial"), "```text\n$$not math$$\n```\n\n$$partial");
});

test("rejects unsafe web citation URLs", () => {
  const result = render("[W1]", sources, [{ title: "Unsafe", url: "javascript:alert(1)" }]);
  assert.match(result, /citation--missing/);
  assert.doesNotMatch(result, /href=/);
});

test("shows a model-authored citation button as text, never as a control", () => {
  const forged = render('Read this. <button class="ai-tutor__citation" type="button" data-ai-citation="S1" aria-label="Open citation S1">Open the lecture</button>');
  assert.equal(liveCitationAttributes(forged), 0, "a forged citation control survived rendering");
  assert.deepEqual(liveTags(forged), ["<p>"]);
  assert.match(forged, /&lt;button class=&quot;ai-tutor__citation&quot; type=&quot;button&quot; data-ai-citation=&quot;S1&quot;/);
  assert.match(forged, /Open the lecture&lt;\/button&gt;/);

  // A valid marker inside forged markup is still the renderer's citation;
  // the markup around it stays text.
  const wrapped = render('Claim. <button data-ai-citation="S1">[S1]</button>');
  assert.equal(liveCitationAttributes(wrapped), 1);
  assert.deepEqual(tagsBesideAppCitations(wrapped), ["<p>"]);
  assert.match(wrapped, /&lt;button data-ai-citation=&quot;S1&quot;&gt;<button class="ai-tutor__citation"/);

  const block = render('<button class="ai-tutor__citation" data-ai-citation="S1">\nOpen\n</button>\n\nAfter [S1]');
  assert.equal(liveCitationAttributes(block), 1);
  assert.deepEqual(tagsBesideAppCitations(block), ["<p>", "<p>"]);
});

test("keeps model-authored data-ai-* attributes on other elements as text", () => {
  const result = render([
    '<span data-ai-citation="S1">span</span> and <a href="#/read/notes" data-ai-citation="S1">anchor</a>',
    "",
    '<div data-ai-citation="S1" data-ai-source="notes">',
    "",
    "**Inside** a forged block [S1]",
    "",
    "</div>",
    "",
    '<p data-ai-citation="S1">paragraph</p>',
  ].join("\n"));
  assert.equal(liveCitationAttributes(result), 1, "only the renderer's [S1] control may carry data-ai-citation");
  assert.doesNotMatch(tagsBesideAppCitations(result).join(""), /data-ai-/);
  assert.match(result, /<strong>Inside<\/strong>/, "Markdown inside a forged block should still render");
  assert.match(result, /&lt;div data-ai-citation=&quot;S1&quot; data-ai-source=&quot;notes&quot;&gt;/);
});

test("renders scripts, frames, event handlers and forms as text", () => {
  const result = render([
    "<script>window.__TUTOR_XSS__ = true</script>",
    "",
    '<iframe src="https://example.com"></iframe> <img src="x" onerror="alert(1)"> <a href="#" onclick="alert(1)">click</a>',
    "",
    '<form action="https://example.com"><input name="password"><button>Sign in</button></form>',
    "",
    '<style>.ai-tutor { display: none }</style> <div style="position:fixed;inset:0">overlay</div>',
    "",
    "<!-- hidden instructions -->",
  ].join("\n"));
  const tags = liveTags(result);
  assert.deepEqual(tags.filter((tag) => /^<(?:script|iframe|img|form|input|button|style|div)\b/iu.test(tag)), []);
  assert.deepEqual(tags.filter((tag) => /\s(?:on\w+|style|data-[\w-]+)=/iu.test(tag)), []);
  // The text is still Markdown: `__x__` is bold, a bare URL is a link.
  assert.match(result, /&lt;script&gt;window\.<strong>TUTOR_XSS<\/strong> = true&lt;\/script&gt;/);
  assert.match(result, /&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(result, /&lt;!-- hidden instructions --&gt;/);
});

test("raw HTML cannot re-enter through links, titles, fence info strings or raw-text tags", () => {
  const label = render('[<button data-ai-citation="S1">open</button>](https://example.com/page)');
  assert.deepEqual(liveTags(label), ["<p>", '<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">']);

  const title = render('[docs](https://example.com "x\\" data-ai-citation=\\"S1")');
  assert.equal(liveCitationAttributes(title), 0);
  assert.match(title, /title="x&quot; data-ai-citation=&quot;S1"/);

  const fence = render('~~~js" data-ai-citation="S1" style="position:fixed\nconst a = 1;\n~~~');
  assert.equal(liveCitationAttributes(fence), 0);
  assert.doesNotMatch(fence, /style=/);
  assert.match(fence, /<code class="language-js">const a = 1;<\/code>/);

  // After a raw <kbd>/<pre> tag, marked would pass later text through
  // unescaped; a browser reads <button/data-ai-citation=…> as a button.
  const rawText = render('<kbd>Ctrl</kbd> <button/data-ai-citation="S1">open</button> <pre>x</pre> <button/data-ai-citation="S1">b</button>');
  assert.equal(liveCitationAttributes(rawText), 0);
  assert.deepEqual(liveTags(rawText), ["<p>"]);
});

test("never puts a citation, or a label that reads as one, inside a model link", () => {
  // Chrome follows an <a> when a <button> inside it is clicked, so a verified
  // [S1] wrapped in a model link would also open the model's URL.
  const wrapped = render("See [[S1]](https://evil.example/a) and [[W1]](https://evil.example/b).");
  assert.equal(liveCitationAttributes(wrapped), 1);
  assert.match(wrapped, /<a class="ai-tutor__citation" href="https:\/\/example\.com\/docs"/);
  assert.doesNotMatch(wrapped, /evil\.example/);

  const missing = render("[see *[S9]*](https://evil.example)");
  assert.match(missing, /<em><span class="ai-tutor__citation ai-tutor__citation--missing"/);
  assert.doesNotMatch(missing, /<a /);

  for (const label of ["&#91;S1&#93;", "&lsqb;W1&rsqb;", "［Ｓ１］", "[S​1]"]) {
    assert.doesNotMatch(render(`[${label}](https://evil.example)`), /<a /, `${label} kept its link`);
  }
  assert.match(render("[Section 3 [of 5]](https://example.com)"), /<a href="https:\/\/example\.com\/"/);

  // An image's alt text shows a citation as its marker, never as a control,
  // and an image labelled with a marker gets no link.
  const figure = render("![Holdout curve [S1]](https://example.com/curve.png)");
  assert.equal(figure, "<p>Image: Holdout curve [S1]</p>\n");
});

test("keeps model links only to absolute web and mail addresses", () => {
  // An app route would open a library note that no citation validated.
  for (const markdown of [
    "[Open the lecture](#/read/notes/part-02-mathematics/06-experiments-and-information.md)",
    "[relative](./02-probability.md)",
    "[root](/api/ai/config)",
    "[protocol-relative](//evil.example/x)",
    "[script](javascript:alert(1))",
    "[reference][r]\n\n[r]: #/read/notes/x",
  ]) {
    const result = render(markdown);
    assert.doesNotMatch(result, /<a /, markdown);
    assert.match(result, /<p>[^<]+<\/p>/, markdown);
  }
  assert.match(render("[docs](https://example.com/a?b=1&c=2)"), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  assert.match(render("[mail](mailto:tutor@example.com)"), /<a href="mailto:tutor@example\.com">mail<\/a>/);
  assert.match(render("See https://example.com/plain."), /<a href="https:\/\/example\.com\/plain" target="_blank"/);
  assert.equal(
    renderTutorInlineMarkdownUnsanitized("[[S1]](https://evil.example) or [route](#/read/x)", sources, web),
    '<button class="ai-tutor__citation" type="button" data-ai-citation="S1" aria-label="Open citation [S1]: Library &quot;source&quot;">[S1]</button> or route',
  );
});

test("tutor answers never load an image: a remote image becomes a link", () => {
  // An <img> fetches its source on render, which would send whatever the
  // model encoded in the URL to that host (issue #81).
  const remote = render('![Holdout curve](https://tracker.example/p.png?q=secret "t")');
  assert.equal(remote, '<p><a href="https://tracker.example/p.png?q=secret" target="_blank" rel="noopener noreferrer">Image: Holdout curve (tracker.example)</a></p>\n');
  for (const markdown of [
    "![reference][img]\n\n[img]: https://tracker.example/ref.png",
    "[![badge](https://tracker.example/badge.svg)](https://example.com/ci)",
    "![local](./figure.png)",
    "![inline](data:image/png;base64,iVBORw0KGgo=)",
    "$\\includegraphics[height=1em]{https://tracker.example/k.png}$",
    "| Plot |\n| --- |\n| ![cell](https://tracker.example/cell.png) |",
  ]) {
    assert.doesNotMatch(render(markdown), /<img/u, markdown);
  }
  assert.doesNotMatch(renderTutorInlineMarkdownUnsanitized("Option ![x](https://tracker.example/q.png)", sources, web), /<img/u);
  // A linked image is one link whose text is the image, never nested links.
  assert.equal((render("[![badge](https://tracker.example/badge.svg)](https://example.com/ci)").match(/<a /gu) || []).length, 1);
});

test("links to the app's own host render as text, like in-app routes", () => {
  const APP = { appOrigin: "http://127.0.0.1:4173" };
  for (const markdown of [
    "[Open](http://127.0.0.1:4173/#/read/notes/part-02-mathematics/06-experiments-and-information.md)",
    "See http://127.0.0.1:4173/#/read/notes/x now.",
    "[other port](https://127.0.0.1:8787/api/ai/config)",
    "[numeric host](http://2130706433:4173/#/read/x)",
    // A browser resolves these against the page, so they were app routes
    // that passed the http(s) check.
    "[relative](http:#/read/notes/x)",
    "[relative](https:#/read/notes/x)",
  ]) {
    const result = renderTutorMarkdownUnsanitized(markdown, sources, web, APP);
    assert.doesNotMatch(result, /<a /u, markdown);
  }
  assert.doesNotMatch(renderTutorInlineMarkdownUnsanitized("[app](http://127.0.0.1:4173/#/review)", sources, web, APP), /<a /u);
  // Other hosts keep working links, written as the normalized address.
  assert.match(renderTutorMarkdownUnsanitized("[docs](https:example.com/a)", sources, web, APP), /<a href="https:\/\/example\.com\/a" target="_blank"/u);
  // Without an app origin (no page), only the host check is skipped.
  assert.match(render("[Open](http://127.0.0.1:4173/#/read/x)"), /<a href="http:\/\/127\.0\.0\.1:4173\/#\/read\/x"/u);
});

test("keeps a [S#]: line visible instead of treating it as a link definition", () => {
  // A one-word or URL remainder would otherwise make a valid definition.
  const result = render("Sources:\n\n[S1]: Evaluation\n\n[W1]: https://example.com/docs");
  assert.equal(liveCitationAttributes(result), 1);
  assert.match(result, /<\/button>: Evaluation<\/p>/);
  assert.match(result, /\[W1\]<\/a>: <a href="https:\/\/example\.com\/docs"/);
});

test("keeps a bare line break and nothing else from model HTML", () => {
  const result = render("| Step | Detail |\n| --- | --- |\n| One | first<br>second<br/>third<br />fourth |\n\nBad <br data-ai-citation=\"S1\"> break");
  assert.equal((result.match(/<br>/gu) || []).length, 3);
  assert.equal(liveCitationAttributes(result), 0);
  assert.match(result, /&lt;br data-ai-citation=&quot;S1&quot;&gt;/);
});

test("still renders headings, math, tables, code, diagrams and links", () => {
  const result = render([
    "## Holdout [S1]",
    "",
    "Loss $L = \\frac{1}{n}\\sum_i \\ell_i$ and [PyTorch](https://pytorch.org \"Release notes\").",
    "",
    "$$\\hat{w} = \\arg\\min_w \\lVert y - Xw \\rVert^2$$",
    "",
    "| Signal | Risk |",
    "| --- | --- |",
    "| Inspection [S1] | *Optimistic* |",
    "",
    "```python",
    "score = evaluate(model, holdout)  # [S1]",
    "```",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Train] --> B[Holdout]",
    "```",
  ].join("\n"));
  assert.match(result, /<h4 class="ai-tutor__md-h2">Holdout <button class="ai-tutor__citation"/);
  assert.match(result, /<span class="katex">/);
  assert.match(result, /class="ai-tutor__scroll ai-tutor__scroll--math"/);
  assert.match(result, /<div class="ai-tutor__scroll" data-scroll-label="Table"><table>/);
  assert.match(result, /<td><em>Optimistic<\/em><\/td>/);
  assert.match(result, /<button class="code-copy" type="button" aria-label="Copy python code">Copy<\/button>/);
  assert.match(result, /score = evaluate\(model, holdout\)  # \[S1\]<\/code>/);
  assert.match(result, /<div class="mermaid" data-diagram-status="pending"[^>]*>flowchart LR\n {2}A\[Train\] --&gt; B\[Holdout\]<\/div>/);
  assert.match(result, /<a href="https:\/\/pytorch\.org\/" title="Release notes" target="_blank" rel="noopener noreferrer">PyTorch<\/a>/);
  assert.equal(liveCitationAttributes(result), 2, "the heading and table citations render; the code comment does not");
});

test("structured fields render math and citations but keep model HTML as text", () => {
  const result = renderTutorInlineMarkdownUnsanitized(
    'Option with $\\hat{R}(f)$ [S1] <button data-ai-citation="S1">forged</button> <img src=x onerror="alert(1)">\n\n**bold**',
    sources,
    web,
  );
  assert.equal(liveCitationAttributes(result), 1);
  assert.match(result, /<span class="katex">/);
  assert.match(result, /<strong>bold<\/strong>/);
  assert.doesNotMatch(result, /<p>|<img|<button data-ai/);
  assert.match(result, /&lt;button data-ai-citation=&quot;S1&quot;&gt;forged&lt;\/button&gt;/);
});

test("creates useful plain text for copy controls", () => {
  assert.equal(tutorMarkdownPlainText("## Result\n\n- **One** with `code`"), "Result\n\n• One with code");
});

test("a model diagram in a tutor answer never names an address Mermaid would fetch", () => {
  const fence = (body) => `\`\`\`mermaid\n${body}\n\`\`\``;
  const hostile = render(fence('flowchart LR\n  A@{ img: "https://tracker.example/x.png" } --> B'));
  assert.doesNotMatch(hostile, /diagram-shell/u);
  assert.match(hostile, /<code class="language-mermaid">/u);
  const directive = render(fence('%%{init: {"fontFamily": "Comic Sans MS"}}%%\nflowchart LR\n  A --> B'));
  assert.match(directive, /<div class="mermaid" data-diagram-status="pending"[^>]*data-diagram-author="model">/u);
});

test("an answer is read aloud without code, math or citation labels", () => {
  const spoken = tutorSpeechText([
    "## Ridge regression",
    "",
    "Ridge adds a **penalty** $\\lambda \\|w\\|^2$ to the loss [S1] and keeps `for _ in` loops working [W2].",
    "",
    "```python",
    "for _ in range(3):",
    "    w -= lr * grad",
    "```",
    "",
    "$$",
    "\\hat{w} = (X^T X + \\lambda I)^{-1} X^T y",
    "$$",
    "",
    "## When to use it",
    "",
    "- Many correlated features",
    "- A [small](https://example.com) data set",
    "",
    "| Penalty | Effect |",
    "| --- | --- |",
    "| L2 | Shrinks |",
    "",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "<script>alert(1)</script>Done.",
  ].join("\n"));
  assert.equal(spoken.text, [
    "Ridge regression.",
    "",
    "Ridge adds a penalty equation to the loss and keeps for _ in loops working.",
    "",
    "Code example shown on screen.",
    "",
    "equation.",
    "",
    "When to use it.",
    "",
    "Many correlated features.",
    "A small data set.",
    "",
    "Penalty, Effect.",
    "L2, Shrinks.",
    "",
    "Diagram shown on screen.",
    "alert(1)Done.",
  ].join("\n"));
  assert.deepEqual(spoken.sections.map((section) => section.label), ["Ridge regression", "When to use it"]);
  assert.match(spoken.sections[1].text, /^When to use it\.\n\nMany correlated features\./);
  assert.equal(/\[[SW]\d|\$|```|\\lambda/.test(spoken.text), false);
});

test("a short answer is one section", () => {
  const spoken = tutorSpeechText("Weights are learned; the learning rate is chosen. [S3]");
  assert.deepEqual(spoken, { text: "Weights are learned; the learning rate is chosen.", sections: [] });
  assert.deepEqual(tutorSpeechText(""), { text: "", sections: [] });
  // An unclosed fence at the end of a stream is silent after its label.
  assert.equal(tutorSpeechText("Intro\n\n```js\nconst a = 1;").text, "Intro\n\nCode example shown on screen.");
});
