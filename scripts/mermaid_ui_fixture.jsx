import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { renderMarkdown } from "../src/lib/markdown.js";
import { renderTutorMarkdown } from "../src/lib/tutorMarkdown.js";
import { renderUntrustedMarkdown } from "../src/lib/untrustedMarkdown.js";
import { renderMermaidDiagrams } from "../src/lib/mermaidDiagrams.js";
import { useMermaidDiagrams } from "../src/lib/useMermaidDiagrams.js";
import "../src/styles.css";

const Surface = ({ className = "", markdown, renderer = renderMarkdown, enabled = true, label }) => {
  const rootRef = useRef(null);
  const html = useMemo(() => renderer(markdown), [markdown, renderer]);
  useMermaidDiagrams(rootRef, { contentKey: html, enabled });
  return (
    <section aria-label={label} className={`markdown-body mermaid-audit-surface ${className}`}>
      <h2>{label}</h2>
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
};

const flowchart = `\`\`\`mermaid
flowchart LR
  SOURCE[Library source] --> ANSWER[Grounded answer]
\`\`\``;

const typedFlowchart = `\`\`\`flowchart
TD
  QUESTION[Question] --> RETRIEVE[Retrieve notes]
  RETRIEVE --> RESPOND[Respond]
\`\`\``;

const sequence = `\`\`\`diagram
sequenceDiagram
  Learner->>Tutor: Ask why gradients vanish
  Tutor-->>Learner: Explain the chain rule
\`\`\``;

const classDiagram = `\`\`\`mmd
classDiagram
  class Model {
    +train(data)
    +predict(input)
  }
\`\`\``;

const invalid = `\`\`\`mermaid
flowchart LR
  START[Valid node] --> BROKEN[
\`\`\``;

const hostile = `\`\`\`mermaid
flowchart LR
  A["<img src=x onerror='window.__MERMAID_XSS__=true'>"] --> B[Safe output]
  click B "javascript:window.__MERMAID_XSS__=true" "unsafe"
\`\`\``;

const DeferredFixture = () => {
  const [complete, setComplete] = useState(false);
  return (
    <main>
      <h1>Deferred tutor diagram</h1>
      <p data-stream-state>{complete ? "Response completed" : "Response streaming"}</p>
      <button type="button" onClick={() => setComplete(true)}>Complete response</button>
      <Surface
        label="Streaming tutor response"
        className="deferred-surface"
        markdown={flowchart}
        renderer={renderTutorMarkdown}
        enabled={complete}
      />
    </main>
  );
};

const CompleteFixture = () => (
  <main>
    <h1>Mermaid rendering audit</h1>
    <Surface label="Reader flowchart" markdown={flowchart} />
    <Surface label="Flowchart fence alias" markdown={typedFlowchart} />
    <Surface label="Tutor sequence diagram" markdown={sequence} renderer={renderTutorMarkdown} />
    <Surface label="Class diagram alias" markdown={classDiagram} renderer={renderTutorMarkdown} />
    <Surface label="Unsafe author input" markdown={hostile} renderer={renderTutorMarkdown} />
    <Surface label="Invalid definition" markdown={invalid} renderer={renderTutorMarkdown} />
  </main>
);

// Mermaid 11.17 leaves the xlink prefix undeclared, so a diagram with a
// `click` link fails to parse and never reaches the page. This stand-in
// renderer returns the well-formed version, to check that the SVG filter
// drops link targets (including in-app #/ routes) but keeps <use> refs.
const linkedSvg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 240 40"><defs><path id="dot" d="M0 0h4v4H0z"/></defs><a xlink:href="#/read/notes/part-02-mathematics/06-experiments-and-information.md"><text x="4" y="24" font-size="16">Open lecture</text></a><a href="#/read/notes/other"><text x="130" y="24" font-size="16">Other</text></a><use href="#dot" x="230" y="30"/></svg>';
const linkedDiagram = "```mermaid\nflowchart LR\n  A[Open lecture] --> B[Other]\n  click A \"#/read/notes/part-02-mathematics/06-experiments-and-information.md\"\n```";

const LinkFixture = () => {
  const rootRef = useRef(null);
  const html = useMemo(() => renderTutorMarkdown(linkedDiagram), []);
  useEffect(() => {
    void renderMermaidDiagrams(rootRef.current, {
      importer: async () => ({ initialize() {}, render: async () => ({ svg: linkedSvg }) }),
    });
  }, []);
  return (
    <main>
      <h1>Linked diagram</h1>
      <section aria-label="Linked diagram" className="markdown-body mermaid-audit-surface">
        <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
      </section>
    </main>
  );
};

// Issue #81: Mermaid fetches some resources while it draws, before the SVG
// filter runs. Each of these fetched https://tracker.example from a tutor
// answer before the fix. A model diagram that names an address shows as code.
const TRACKER = "https://tracker.example";
const fence = (body) => `\`\`\`mermaid\n${body}\n\`\`\`\n\n`;
const resourceDiagrams = [
  `%%{init: {"fontFamily": "x;background-image:url(${TRACKER}/font-family)"}}%%\nflowchart LR\n  A[a] --> B[b]`,
  `%%{init: {"themeCSS": "rect{background-image:url(${TRACKER}/theme-css)}"}}%%\nflowchart LR\n  A[a] --> B[b]`,
  `---\nconfig:\n  fontFamily: "x;background-image:url(${TRACKER}/frontmatter)"\n---\nflowchart LR\n  A[a] --> B[b]`,
  `%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  A["<img src='${TRACKER}/html-label'>"] --> B[b]`,
  `flowchart LR\n  A@{ img: "${TRACKER}/shape-image", label: "x" } --> B[b]`,
  `sequenceDiagram\n  participant A\n  properties A: {"icon": "${TRACKER}/actor-icon"}\n  A->>B: hi`,
  `stateDiagram-v2\n  [*] --> S\n  classDef c mask-image:url(${TRACKER}/class-def)\n  class S c`,
  'flowchart LR\n  A@{ "i\\x6dg": "\\x68ttps\\x3a\\x2f\\x2ftracker.example/yaml-escape" } --> B[b]',
  'stateDiagram-v2\n  [*] --> S\n  classDef c mask-image:u\\72l(\\68ttps\\3a\\2f\\2ftracker.example/css-escape)\n  class S c',
].map(fence).join("");
// No address, so these draw; a model's directives must not apply to them.
const modelDirectives = [
  '%%{init: {"fontFamily": "x;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647"}}%%\nflowchart LR\n  A[Overlay] --> B[Directive]',
  '%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  A["<img src=\'mermaid-audit-label.png\'>"] --> B[Label]',
  '---\nconfig:\n  themeCSS: "rect{fill:rgb(255,0,0) !important}"\n---\nflowchart LR\n  A[Red] --> B[Fill]',
].map(fence).join("");
const learnerDirective = fence('---\nconfig:\n  themeCSS: "rect{fill:rgb(255,0,0) !important}"\n---\nflowchart LR\n  A[Learner] --> B[Theme]');

const ResourceFixture = () => (
  <main>
    <h1>Diagram resources</h1>
    <Surface label="Tutor diagrams naming addresses" className="resource-surface" markdown={resourceDiagrams} renderer={renderTutorMarkdown} />
    <Surface label="Saved AI diagram" className="saved-surface" markdown={fence(`flowchart LR\n  A@{ img: "${TRACKER}/saved-shape" } --> B[b]`)} renderer={renderUntrustedMarkdown} />
    <Surface label="Tutor directives" className="directive-surface" markdown={modelDirectives} renderer={renderTutorMarkdown} />
    <Surface label="Learner directive" className="learner-surface" markdown={learnerDirective} />
    <Surface label="Marked model markup" className="marked-surface" markdown={`<div class="diagram-shell"><div class="mermaid" data-diagram-author="model">flowchart LR\n  A@{ img: "${TRACKER}/marked-markup" } --> B[b]</div></div>`} />
  </main>
);

window.__MERMAID_XSS__ = false;
const mode = new URLSearchParams(window.location.search).get("mode");
const fixtures = { deferred: DeferredFixture, links: LinkFixture, resources: ResourceFixture };
const Fixture = fixtures[mode] || CompleteFixture;
createRoot(document.getElementById("root")).render(<Fixture />);
