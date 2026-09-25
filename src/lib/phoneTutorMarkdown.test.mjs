import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptPhoneWebCitations,
  phoneTutorMarkdownPlainText,
  preparePhoneLibraryCitationSources,
  renderPhoneTutorInlineMarkdownUnsanitized,
  renderPhoneTutorMarkdownUnsanitized,
} from "./phoneTutorMarkdown.js";

const liveTags = (html) => html.match(/<[a-z][^>]*>/giu) || [];
const liveCitationAttributes = (html) => (html.match(/data-ai-citation="/gu) || []).length;
const librarySources = [{ title: "Gradient descent", documentId: "notes/gradient.md" }];

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

test("phone prose shows a model-authored citation control as text", () => {
  const result = renderPhoneTutorMarkdownUnsanitized([
    "**Gradient descent** follows the negative gradient [S1]; browsers change [W2].",
    "",
    '<button class="ai-tutor__citation" type="button" data-ai-citation="S1">Open lesson</button>',
    "",
    '<span data-ai-citation="S1">forged</span> <a href="#/read/notes" data-ai-citation="S1">anchor</a>',
    "",
    "<script>window.__PHONE_MARKDOWN_XSS__ = true</script>",
  ].join("\n"), librarySources, citations);
  assert.equal(liveCitationAttributes(result), 1, "only the renderer's [S1] control may carry data-ai-citation");
  assert.match(result, /<button class="ai-tutor__citation" type="button" data-ai-citation="S1" aria-label="Open citation \[S1\]: Gradient descent">\[S1\]<\/button>/);
  assert.match(result, /<a class="ai-tutor__citation" href="https:\/\/example\.com\/two"[^>]*>\[W2\]<\/a>/);
  assert.match(result, /&lt;button class=&quot;ai-tutor__citation&quot; type=&quot;button&quot; data-ai-citation=&quot;S1&quot;&gt;Open lesson/);
  assert.deepEqual(liveTags(result).filter((tag) => /^<(?:script|span|button)\b/iu.test(tag) && !tag.includes('aria-label="Open citation [S1]')), []);
});

test("phone structured fields keep model HTML as text and render real citations", () => {
  const result = renderPhoneTutorInlineMarkdownUnsanitized(
    'θ ← θ − η∇L(θ) [S1] <button data-ai-citation="S1">forged</button> <img src=x onerror="alert(1)"> [W5]',
    librarySources,
    citations,
  );
  assert.equal(liveCitationAttributes(result), 1);
  assert.match(result, /href="https:\/\/example\.com\/five"[^>]*>\[W5\]<\/a>/);
  assert.doesNotMatch(result, /<img|<button data-ai/);
  assert.match(result, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("phone citations never sit inside a model link, and app routes stay text", () => {
  const result = renderPhoneTutorMarkdownUnsanitized(
    "Linked [[S1]](#/read/notes/forged) and [[W2]](https://evil.example), then [the lecture](#/read/notes/forged).",
    librarySources,
    citations,
  );
  assert.equal(liveCitationAttributes(result), 1);
  assert.doesNotMatch(result, /#\/read|evil\.example/);
  assert.deepEqual(liveTags(result).map((tag) => tag.split(" ")[0]), ["<p>", "<button", "<a"]);
  assert.match(result, /\[W2\]<\/a>, then the lecture\.<\/p>/);
});

test("phone answers load no image and keep links to the app's own host as text", () => {
  // The phone tutor renders through the shared tutor renderer, which reads
  // the page origin; the stub stands in for the served app.
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "https://mac.local:4193" }, configurable: true });
  try {
    const result = renderPhoneTutorMarkdownUnsanitized(
      "![pixel](https://tracker.example/p.png?q=prompt) [the app](https://mac.local:4193/#/read/notes/forged) https://mac.local/#/review [docs](https://example.com/docs)",
      librarySources,
      citations,
    );
    assert.doesNotMatch(result, /<img|href="https:\/\/mac\.local/);
    assert.deepEqual(liveTags(result).map((tag) => tag.match(/href="([^"]+)"/)?.[1] || tag), [
      "<p>",
      "https://tracker.example/p.png?q=prompt",
      "https://example.com/docs",
    ]);
    assert.match(result, /Image: pixel \(tracker\.example\)<\/a> the app https:\/\/mac\.local\/#\/review <a/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else delete globalThis.location;
  }
});
