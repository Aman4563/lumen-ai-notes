// The read-aloud fixture lecture (issue #100): a heading, a "6." heading, a
// table, Python code, ASCII art, <br> lines, Unicode math, one MathML block,
// one Mermaid block and a 250-character sentence. The unit test builds its DOM
// by hand and the browser audit seeds it as a custom document; both assert the
// same utterances, so the markdown and what it must sound like live here once.
export const FIXTURE_MARKDOWN = `# Speakable fixture

## 6. Task taxonomy

Classification predicts a label.

| Situation | First inspect | Safe action |
|---|---|---|
| Disk full | df -h | Free space |
| High latency | p99 graphs | Roll back |

\`\`\`python
import numpy as np
X = np.ones((3, 2))
y = np.zeros(3)
w = np.linalg.lstsq(X, y, rcond=None)[0]
print(w)
print(w.shape)
\`\`\`

\`\`\`
name a ─┐
        ├──> list object
name b ─┘
\`\`\`

First line<br>Second line

The model predicts ŷ = wᵀx + b for each input.

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mtext mathvariant="normal">Accuracy</mtext><mo>=</mo><mfrac><mrow><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi></mrow><mrow><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi><mo>+</mo><mi>F</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>N</mi></mrow></mfrac><mo>,</mo></mrow></semantics></math>

\`\`\`mermaid
flowchart LR
  A[Data] --> B[Model]
  B --> C[Prediction]
\`\`\`

Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight, and moving each weight a smaller step against its gradient until the loss stops improving.
`;

// Spoken with the defaults (code "announce", tables "rows"):
export const FIXTURE_SPOKEN = [
  "Speakable fixture.",
  "6. Task taxonomy.",
  "Classification predicts a label.",
  "Table, 3 columns: Situation, First inspect, Safe action.",
  "Row 1. Situation: Disk full; First inspect: df -h; Safe action: Free space.",
  "Row 2. Situation: High latency; First inspect: P ninety-nine graphs; Safe action: Roll back.",
  "Python example, 6 lines.",
  "Text diagram, 3 lines.",
  "First line.",
  "Second line.",
  "The model predicts y hat equals w transpose x plus b for each input.",
  "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N.",
  "Diagram: Flowchart: Data leads to Model leads to Prediction.",
  "Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight,",
  "and moving each weight a smaller step against its gradient until the loss stops improving.",
];

// The other settings derive from it:
export const CODE_LINES = ["import num pie as np", "X = np.ones((3, 2))", "y = np.zeros(3)", "w = np.linalg.least squares(X, y, rcond=None)[0]", "print(w)", "print(w.shape)"];

export const fixtureSpoken = ({ code = "announce", tables = "rows" } = {}) => FIXTURE_SPOKEN
  .flatMap((line) => (line === "Python example, 6 lines." ? (code === "skip" ? [] : code === "read" ? [line, ...CODE_LINES] : [line]) : [line]))
  .flatMap((line) => (tables === "announce" ? (line.startsWith("Row ") ? [] : line.startsWith("Table,") ? ["Table, 3 columns, 2 rows: Situation, First inspect, Safe action."] : [line]) : [line]));
