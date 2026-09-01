import assert from "node:assert/strict";
import test from "node:test";
import { adaptPhoneWebCitations, phoneTutorMarkdownPlainText, preparePhoneLibraryCitationSources } from "./phoneTutorMarkdown.js";

const citations = [
  { index: 2, title: "Second result", url: "https://example.com/two" },
  { index: 5, title: "Fifth result", url: "https://example.com/five" },
];

test("keeps the explicit shared web citation namespace without rewriting numeric text", () => {
  assert.equal(adaptPhoneWebCitations("Facts [W1] and [W2]; x[1] and standalone [2].", citations), "Facts [W1] and [W2]; x[1] and standalone [2].");
});

test("does not reinterpret numeric indexing or explicit labels inside code", () => {
  const value = adaptPhoneWebCitations("`vector[2] [W1]` [W1]\n\n```python\na[5] = 1 # [W2]\n```", citations);
  assert.match(value, /`vector\[2\] \[W1\]` \[W1\]/);
  assert.match(value, /a\[5\] = 1/);
  assert.equal((value.match(/\[W/g) || []).length, 3);
});

test("preserves an unfinished fence during token streaming", () => {
  assert.equal(adaptPhoneWebCitations("## Partial\n\n```text\n[W2]", citations), "## Partial\n\n```text\n[W2]");
});

test("preserves a surviving source's original S label after fitting", () => {
  const prepared = preparePhoneLibraryCitationSources([
    { citationNumber: 2, title: "Second excerpt" },
  ]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].citationNumber, 2);
  assert.equal(prepared[0].title, "Second excerpt");
});

test("plain-text copying removes presentation markup", () => {
  assert.equal(phoneTutorMarkdownPlainText("## Result\n\n- **Stable** with `code`"), "Result\n\n• Stable with code");
});
