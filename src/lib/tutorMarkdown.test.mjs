import assert from "node:assert/strict";
import test from "node:test";
import { decorateTutorCitations, normalizeTutorMathDelimiters, tutorMarkdownPlainText } from "./tutorMarkdown.js";

const sources = [{ citationNumber: 1, title: 'Library "source"' }];
const web = [{ title: "Official docs", url: "https://example.com/docs" }];

test("decorates known library and web citations", () => {
  const result = decorateTutorCitations("Evidence [S1] and current facts [W1].", sources, web);
  assert.match(result, /data-ai-citation="S1"/);
  assert.match(result, /href="https:\/\/example\.com\/docs"/);
  assert.match(result, /Library &quot;source&quot;/);
});

test("decorates a sparse retained library label without renumbering it", () => {
  const result = decorateTutorCitations("Evidence [S2]; unavailable [S1].", [
    { citationNumber: 2, title: "Second retained excerpt" },
  ], []);
  assert.match(result, /data-ai-citation="S2"/);
  assert.match(result, /citation--missing[^>]*>\[S1\]<\/span>/);
});

test("preserves sparse explicit web indexes and fails closed on duplicate labels", () => {
  const sparse = decorateTutorCitations("Latest [W2]; unavailable [W1].", [], [
    { index: 2, title: "Second result", url: "https://example.com/two" },
  ]);
  assert.match(sparse, /href="https:\/\/example\.com\/two"[^>]*>\[W2\]<\/a>/);
  assert.match(sparse, /citation--missing[^>]*>\[W1\]<\/span>/);

  const duplicate = decorateTutorCitations("Conflict [W2].", [], [
    { index: 2, title: "First claimant", url: "https://example.com/first" },
    { index: 2, title: "Second claimant", url: "https://example.com/second" },
  ]);
  assert.match(duplicate, /citation--missing/);
  assert.doesNotMatch(duplicate, /href=/);

  const invalid = decorateTutorCitations("Invalid [W1].", [], [
    { index: 0, title: "Invalid index", url: "https://example.com/invalid" },
  ]);
  assert.match(invalid, /citation--missing/);
});

test("does not decorate citations inside code", () => {
  const result = decorateTutorCitations("`[S1]`\n\n```js\nconst ref = '[W1]';\n```\n\n[S1]", sources, web);
  assert.equal((result.match(/data-ai-citation/g) || []).length, 1);
  assert.match(result, /`\[S1\]`/);
  assert.match(result, /const ref = '\[W1\]'/);
});

test("keeps incomplete Markdown available during streaming", () => {
  const result = decorateTutorCitations("## Partial\n\n```python\nprint('[S1]')", sources, web);
  assert.match(result, /```python/);
  assert.doesNotMatch(result, /data-ai-citation/);
});

test("normalizes one-line model display math without rewriting code or partial streams", () => {
  assert.equal(normalizeTutorMathDelimiters("Before\n\n$$y = r + \\gamma Q(s', a')$$\n\nAfter"), "Before\n\n\n$$\ny = r + \\gamma Q(s', a')\n$$\n\n\nAfter");
  assert.equal(normalizeTutorMathDelimiters("\\[x^2 + y^2\\]"), "\n$$\nx^2 + y^2\n$$\n");
  assert.equal(normalizeTutorMathDelimiters("```text\n$$not math$$\n```\n\n$$partial"), "```text\n$$not math$$\n```\n\n$$partial");
});

test("rejects unsafe web citation URLs", () => {
  const result = decorateTutorCitations("[W1]", sources, [{ title: "Unsafe", url: "javascript:alert(1)" }]);
  assert.match(result, /citation--missing/);
  assert.doesNotMatch(result, /href=/);
});

test("creates useful plain text for copy controls", () => {
  assert.equal(tutorMarkdownPlainText("## Result\n\n- **One** with `code`"), "Result\n\n• One with code");
});
