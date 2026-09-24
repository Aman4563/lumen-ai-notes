import test from "node:test";
import assert from "node:assert/strict";
import {
  MERMAID_RENDER_LIMITS,
  mermaidDefinitionForFence,
  mermaidErrorLocation,
  subscribeToMermaidTheme,
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

test("dialog scroll locks preserve diagrams while actual theme changes notify all surfaces", () => {
  const names = ["document", "getComputedStyle", "MutationObserver", "matchMedia"];
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  let scheme = "light";
  let mutation;
  let mediaChange;
  let disconnected = false;
  const notifications = [0, 0];
  let unsubscribeFirst;
  let unsubscribeSecond;
  try {
    globalThis.document = { documentElement: { style: { overflow: "" } } };
    globalThis.getComputedStyle = () => ({ colorScheme: scheme });
    globalThis.MutationObserver = class {
      constructor(callback) { mutation = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    };
    globalThis.matchMedia = () => ({ addEventListener: (_, callback) => { mediaChange = callback; }, removeEventListener() {} });
    unsubscribeFirst = subscribeToMermaidTheme(() => notifications[0]++);
    unsubscribeSecond = subscribeToMermaidTheme(() => notifications[1]++);
    document.documentElement.style.overflow = "hidden";
    mutation();
    document.documentElement.style.overflow = "";
    mutation();
    assert.deepEqual(notifications, [0, 0]);
    scheme = "dark";
    mutation();
    mediaChange();
    assert.deepEqual(notifications, [1, 1], "one actual theme change renders each surface once");
    unsubscribeFirst();
    unsubscribeFirst = null;
    scheme = "light";
    mediaChange();
    assert.deepEqual(notifications, [1, 2]);
  } finally {
    unsubscribeFirst?.();
    unsubscribeSecond?.();
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  }
  assert.ok(disconnected);
});
