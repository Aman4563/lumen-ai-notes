import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { renderMarkdown } from "../src/lib/markdown.js";
import { renderTutorMarkdown } from "../src/lib/tutorMarkdown.js";
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

window.__MERMAID_XSS__ = false;
const deferred = new URLSearchParams(window.location.search).get("mode") === "deferred";
createRoot(document.getElementById("root")).render(deferred ? <DeferredFixture /> : <CompleteFixture />);
