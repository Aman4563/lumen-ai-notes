import test from "node:test";
import assert from "node:assert/strict";
import {
  MERMAID_RENDER_LIMITS,
  mermaidDefinitionForFence,
  mermaidErrorLocation,
} from "./mermaidDiagrams.js";

test("explicit Mermaid fences and common aliases produce normalized definitions", () => {
  assert.equal(
    mermaidDefinitionForFence("Mermaid", "\nflowchart LR\n  A --> B\n"),
    "flowchart LR\n  A --> B",
  );
  assert.equal(
    mermaidDefinitionForFence("mmd title=path", "sequenceDiagram\n  Alice->>Bob: Hello"),
    "sequenceDiagram\n  Alice->>Bob: Hello",
  );
  assert.equal(
    mermaidDefinitionForFence("flowchart", "LR\n  A --> B"),
    "flowchart LR\n  A --> B",
  );
  assert.equal(
    mermaidDefinitionForFence("diagram", "classDiagram\n  class Model"),
    "classDiagram\n  class Model",
  );
});

test("ambiguous diagram fences never reinterpret ordinary or malicious code", () => {
  assert.equal(mermaidDefinitionForFence("diagram", "console.log('not a diagram')"), "");
  assert.equal(mermaidDefinitionForFence("flowchart", "SELECT * FROM examples"), "");
  assert.equal(mermaidDefinitionForFence("javascript", "flowchart LR\n A-->B"), "");
  assert.equal(mermaidDefinitionForFence("diagram onclick=alert(1)", "<script>alert(1)</script>"), "");
});

test("Mermaid frontmatter/comments are skipped when identifying typed fences", () => {
  const source = "---\ntitle: Request path\n---\n%% a comment\nflowchart TD\n  A --> B";
  assert.equal(mermaidDefinitionForFence("diagram", source), source);
});

test("parser locations are reduced to bounded learner-safe coordinates", () => {
  assert.deepEqual(mermaidErrorLocation({ hash: { loc: { first_line: 7, first_column: 3 } } }), { line: 7, column: 4 });
  assert.deepEqual(mermaidErrorLocation(new Error("Parse error on line 12: unexpected token")), { line: 12, column: null });
  assert.deepEqual(mermaidErrorLocation({ message: "unknown" }), { line: null, column: null });
});

test("diagram rendering has explicit mobile safety bounds", () => {
  assert.equal(MERMAID_RENDER_LIMITS.diagramsPerSurface, 16);
  assert.equal(MERMAID_RENDER_LIMITS.definitionCharacters, 30_000);
});
