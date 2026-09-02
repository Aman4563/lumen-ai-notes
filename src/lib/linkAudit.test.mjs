import assert from "node:assert/strict";
import { test } from "node:test";

import { applyBatchDelete, applyBatchOrganize } from "./contentOps.js";
import { htmlToMarkdown, isHtmlFileName } from "./htmlImport.js";
import { auditDocumentLinks, auditLearnerLinks, documentAnchorIds } from "./linkAudit.js";

const now = new Date("2026-09-02T12:00:00.000Z");

test("anchor ids mirror the reader's heading slugs, duplicates suffixed in order", () => {
  const ids = documentAnchorIds([
    "# Title (h1 gets no id)",
    "## Gradient Descent",
    "### Learning **Rate** [link](x.md)",
    "## Gradient Descent",
    "```\n## inside a fence never counts\n```",
  ].join("\n"));
  assert.deepEqual(ids, ["gradient-descent", "learning-rate-link", "gradient-descent-2"]);
});

test("the link audit flags exactly what the reader cannot open", () => {
  const known = new Set(["notes/part-01/a.md", "notes/part-01/b.md", "custom/x.md"]);
  const markdown = [
    "[good](./b.md) [external](https://x.com) [mail](mailto:a@b.c)",
    "[missing](./ghost.md)",
    "[good anchor](./b.md#real-section)",
    "[bad anchor](./b.md#nope)",
    "[self anchor](#local-heading)",
    "[not a doc](./image.png)",
  ].join("\n\n## Local Heading\n");
  const anchorsFor = (id) => (id === "notes/part-01/b.md" ? ["real-section"] : id === "notes/part-01/a.md" ? ["local-heading"] : null);
  const findings = auditDocumentLinks("notes/part-01/a.md", markdown, known, anchorsFor);
  assert.deepEqual(findings.map((finding) => finding.kind).sort(), ["missing-anchor", "missing-document", "not-a-document"]);
  assert.equal(findings.find((finding) => finding.kind === "missing-document").targetId, "notes/part-01/ghost.md");

  const sweep = auditLearnerLinks({
    customDocuments: [{ id: "custom/x.md", raw: "[relative into notes](notes/part-01/a.md) [escaped correctly](../notes/part-01/a.md)" }],
    edits: { "notes/part-01/b.md": "[fine](./a.md)" },
    knownIds: known,
  });
  assert.equal(sweep.scanned, 2);
  assert.equal(sweep.findings.length, 1, "custom-doc relative links into notes/ resolve to custom/notes/... and are honestly broken");
  assert.equal(sweep.findings[0].kind, "missing-document");
});

test("HTML import converts the allowlist, drops danger, and keeps titles", () => {
  assert.equal(isHtmlFileName("lecture.HTML"), true);
  assert.equal(isHtmlFileName("notes.md"), false);
  const { markdown, title } = htmlToMarkdown(`
    <html><head><title>Course Notes</title><style>body{}</style><script>evil()</script></head>
    <body>
      <h2>Losses &amp; Metrics</h2>
      <p>Use <strong>MSE</strong> for <em>regression</em>; see <a href="https://example.com/x">docs</a>.
         <a href="javascript:alert(1)">never this</a></p>
      <ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>
      <pre><code class="language-python">loss = ((y - p) ** 2).mean()</code></pre>
      <table><tr><th>Split</th><th>Use</th></tr><tr><td>val</td><td>tuning</td></tr></table>
      <img src="https://example.com/pic.png" alt="curve"> <img src="data:image/png;base64,xxx" alt="inline dropped">
    </body></html>`);
  assert.equal(title, "Course Notes");
  assert.match(markdown, /^# Course Notes/);
  assert.match(markdown, /## Losses & Metrics/);
  assert.match(markdown, /\*\*MSE\*\*/);
  assert.match(markdown, /\[docs\]\(https:\/\/example\.com\/x\)/);
  assert.doesNotMatch(markdown, /javascript:/, "javascript: links unwrap to text");
  assert.match(markdown, /never this/);
  const relative = htmlToMarkdown('<p><a href="./chapter-2.md">next chapter</a></p>').markdown;
  assert.match(relative, /\[next chapter\]\(\.\/chapter-2\.md\)/, "relative internal links must survive conversion");
  assert.doesNotMatch(markdown, /evil\(\)/, "script content is dropped whole");
  assert.match(markdown, /- two\n {2}- nested/);
  assert.match(markdown, /```python\nloss = \(\(y - p\) \*\* 2\)\.mean\(\)\n```/);
  assert.match(markdown, /\| Split \| Use \|\n\| --- \| --- \|\n\| val \| tuning \|/);
  assert.match(markdown, /!\[curve\]\(https:\/\/example\.com\/pic\.png\)/);
  assert.match(markdown, /inline dropped/, "data: images keep their alt text");
  assert.doesNotMatch(markdown, /base64/);
});

test("colspan tables bail to plain text instead of emitting broken GFM", () => {
  const { markdown } = htmlToMarkdown('<table><tr><td colspan="2">Wide</td></tr><tr><td>a</td><td>b</td></tr></table>');
  assert.doesNotMatch(markdown, /\|/);
  assert.match(markdown, /Wide · a · b/);
});

test("batch reducers organize and trash a selection in one pass", () => {
  const documents = [
    { id: "custom/a.md", title: "A", raw: "#", tags: [], collectionId: "", archived: false, updatedAt: "old" },
    { id: "custom/b.md", title: "B", raw: "#", tags: [], collectionId: "", archived: false, updatedAt: "old" },
    { id: "custom/c.md", title: "C", raw: "#", tags: [], collectionId: "", archived: false, updatedAt: "old" },
  ];
  const organized = applyBatchOrganize(documents, ["custom/a.md", "custom/c.md"], { collectionId: "col-1", archived: true }, now);
  assert.equal(organized.touched, 2);
  assert.equal(organized.documents[0].collectionId, "col-1");
  assert.equal(organized.documents[0].archived, true);
  assert.equal(organized.documents[1].collectionId, "", "unselected documents stay untouched");
  assert.equal(organized.documents[1].updatedAt, "old");

  const deleted = applyBatchDelete(documents, [], ["custom/b.md", "custom/c.md"], now);
  assert.deepEqual(deleted.removedIds, ["custom/b.md", "custom/c.md"]);
  assert.equal(deleted.documents.length, 1);
  assert.equal(deleted.trash.length, 2);
  assert.equal(deleted.trash[0].raw, "#", "trash entries keep content for restore");
});
