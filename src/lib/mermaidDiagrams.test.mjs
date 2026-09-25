import test from "node:test";
import assert from "node:assert/strict";
import {
  MERMAID_RENDER_LIMITS,
  describeMermaidDefinition,
  mermaidDefinitionForFence,
  mermaidDefinitionNamesResource,
  mermaidErrorLocation,
  mermaidSiteConfig,
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

test("rendered diagrams get a text alternative built from the preserved definition", () => {
  assert.equal(
    describeMermaidDefinition("flowchart LR\n  A[Parameters] --> B[Forward prediction]\n  B --> C[Loss]\n  C --> D[Gradient via chain rule]\n  D --> A"),
    "Flowchart: Parameters → Forward prediction → Loss → Gradient via chain rule → Parameters",
  );
  assert.equal(
    describeMermaidDefinition('flowchart TD\n  E{Env ok?} -->|no| F[Fix wrappers]\n  E -- yes --> T["Targets (hand) match"]'),
    "Flowchart: Env ok? → Fix wrappers (no); Env ok? → Targets (hand) match (yes)",
  );
  assert.equal(
    describeMermaidDefinition("sequenceDiagram\n  participant L as Learner\n  L->>Tutor: Ask why gradients vanish\n  Tutor-->>L: Explain the chain rule"),
    "Sequence diagram: Learner to Tutor: Ask why gradients vanish; Tutor to Learner: Explain the chain rule",
  );
  assert.equal(
    describeMermaidDefinition("stateDiagram-v2\n  [*] --> Running\n  Running --> Failed: deadline\n  Failed --> [*]"),
    "State diagram: Start → Running; Running → Failed (deadline); Failed → End",
  );
  assert.equal(describeMermaidDefinition("---\ntitle: Path\n---\n%% note\nflowchart TD\n  A --> B"), "Flowchart: A → B");
  // Author markup never reaches the accessible name as markup.
  assert.equal(describeMermaidDefinition('flowchart LR\n  A["<img src=x onerror=alert(1)> Safe"] --> B[Done]'), "Flowchart: Safe → Done");
  const long = `flowchart LR\n${Array.from({ length: 80 }, (_, index) => `  N${index}[Step number ${index}] --> N${index + 1}[Step number ${index + 1}]`).join("\n")}`;
  assert.ok(describeMermaidDefinition(long).length <= 700, "the accessible name stays bounded");
});

// Issue #81: each of these fetched https://tracker.example from a tutor
// answer while Mermaid drew it (see audit:mermaid).
test("a model diagram that could name a web address is recognized in every spelling", () => {
  const resourceDiagrams = [
    'flowchart LR\n  A@{ img: "https://tracker.example/x.png" } --> B',
    'sequenceDiagram\n  properties A: {"icon": "HTTPS://tracker.example/icon"}\n  A->>B: hi',
    "stateDiagram-v2\n  classDef c mask-image:url(tracker.png)\n  class S c",
    'flowchart LR\n  A@{ img: "//tracker.example/x" } --> B',
    'flowchart LR\n  A@{ img: "https:tracker.example/x" } --> B',
    'flowchart LR\n  A@{ "i\\x6dg": "\\x68ttps\\x3a\\x2f\\x2ftracker.example/x" } --> B',
    "stateDiagram-v2\n  classDef c mask-image:u\\72l(\\68ttps\\3a\\2f\\2ftracker.example)",
    "flowchart LR\n  A[a] -->|http#58;tracker.example| B",
    "flowchart LR\n  A[a] -->|http&#58;tracker.example| B",
    "flowchart LR\n  A[a] -->|http&#x3a;tracker.example| B",
    'flowchart LR\n  A@{ img: "ht\ttps:tracker.example/x" } --> B',
    '%%{init: {"themeCSS": "rect{background:-webkit-image-set(\'x.png\' 1x)}"}}%%\nflowchart LR\n  A --> B',
    '%%{init: {"themeCSS": "@import \'x.css\';"}}%%\nflowchart LR\n  A --> B',
  ];
  resourceDiagrams.forEach((definition) => assert.equal(mermaidDefinitionNamesResource(definition), true, definition));
  const ordinary = [
    "flowchart LR\n  A[Train] --> B[Holdout]\n  style A fill:#f9f,stroke:#333,stroke-width:2px\n  classDef hot fill:#f96;",
    "sequenceDiagram\n  Learner->>Tutor: Ask why gradients vanish\n  Tutor-->>Learner: Explain: the chain rule",
    '%%{init: {"theme": "forest"}}%%\nflowchart TD\n  A{Leak?} -->|yes| B[Refit]',
    "classDiagram\n  class Model {\n    +predict(input)\n  }",
  ];
  ordinary.forEach((definition) => assert.equal(mermaidDefinitionNamesResource(definition), false, definition));
});

test("a model diagram gets a site config that no directive can override", () => {
  const learner = mermaidSiteConfig({ theme: "neutral" });
  assert.equal(Object.hasOwn(learner, "secure"), false, "learner diagrams keep Mermaid's default secure keys");
  assert.equal(learner.htmlLabels, false);
  assert.equal(learner.securityLevel, "strict");
  const model = mermaidSiteConfig({ theme: "dark", modelAuthored: true, defaultConfig: { venn: {}, cynefin: {} } });
  ["secure", "securityLevel", "htmlLabels", "themeCSS", "fontFamily", "altFontFamily", "themeVariables", "flowchart", "sequence", "theme", "venn", "cynefin"]
    .forEach((key) => assert.ok(model.secure.includes(key), `${key} is not secure for a model diagram`));
  assert.equal(model.theme, "dark");
  assert.equal(model.fontFamily, learner.fontFamily);
  assert.deepEqual(new Set(model.secure).size, model.secure.length);
});
