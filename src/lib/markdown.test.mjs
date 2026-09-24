import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { hasTexMath } from "./markdown.js";

test("reader TeX detection ignores code and currency", () => {
  assert.equal(hasTexMath("Inline $w^T x$ here."), true);
  assert.equal(hasTexMath("$$\\nabla J = 2X^T(Xw-y)$$"), true);
  assert.equal(hasTexMath("Costs $5 and $10 today."), false);
  assert.equal(hasTexMath("```sh\necho $HOME $PATH\n```"), false);
  assert.equal(hasTexMath("Use `$x$` literally."), false);
  assert.equal(hasTexMath("~~~\n$$ not math $$\n~~~\nPlain prose."), false);
});

test("wide code, tables, and diagrams render as focusable named scrollers", () => {
  // markdown.js configures the shared marked renderer on import; DOMPurify
  // needs a browser, so this checks the renderer output before sanitizing.
  const html = marked.parse("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```python\nx = 1\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```");
  assert.match(html, /<div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>/u);
  assert.match(html, /<\/table>\n?<\/div>/u);
  assert.match(html, /<pre tabindex="0" role="group" aria-label="python code"><code class="language-python">/u);
  assert.match(html, /<div class="diagram-shell" data-diagram-status="pending" tabindex="0" role="group" aria-label="Diagram">/u);
});
