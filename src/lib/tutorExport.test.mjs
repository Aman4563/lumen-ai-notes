import assert from "node:assert/strict";
import test from "node:test";
import { structuredResultMarkdown, tutorConversationMarkdown, tutorMessageMarkdown, tutorPlainText, tutorSourceList } from "./tutorExport.js";
import { tutorMarkdownPlainText } from "./tutorMarkdown.js";

const quiz = {
  title: "Linear regression check",
  instructions: "Pick the best answer.",
  questions: [{ id: "q1", prompt: "What does OLS minimize? [S1]", options: ["Absolute error", "Squared residuals"], correctIndex: 1, explanation: "It minimizes $\\sum_i r_i^2$. [S1]", difficulty: "beginner" }],
};

test("plain text keeps code, math and identifiers intact", () => {
  const markdown = "## Update\n\nUse **ridge** with `learning_rate` and ~/.ssh keys.\n\n```python\nfor _ in range(epochs):\n    w += lr * (2 / len(y) * X.T @ residual - 2 * l2 * w)\ndef __init__(self, **kw):\n    return x ** 2 * y\n```\n\n$$\\sum_{i=1}^{n}(y_i - \\hat{y}_i)^2$$\n\nInline $y_i$ and _emphasis_ and *also* this.";
  const plain = tutorPlainText(markdown);
  assert.match(plain, /for _ in range\(epochs\):/);
  assert.match(plain, /w \+= lr \* \(2 \/ len\(y\) \* X\.T @ residual - 2 \* l2 \* w\)/);
  assert.match(plain, /def __init__\(self, \*\*kw\):/);
  assert.match(plain, /x \*\* 2 \* y/);
  assert.match(plain, /\\sum_\{i=1\}\^\{n\}\(y_i - \\hat\{y\}_i\)\^2/);
  assert.match(plain, /learning_rate/);
  assert.match(plain, /~\/\.ssh/);
  assert.match(plain, /Inline \$y_i\$ and emphasis and also this\./);
  assert.match(plain, /^Update\n\nUse ridge with learning_rate/);
  assert.equal(tutorMarkdownPlainText("## Result\n\n- **One** with `code`"), "Result\n\n• One with code");
});

test("structured results become readable Markdown instead of JSON", () => {
  const markdown = structuredResultMarkdown(quiz);
  assert.doesNotMatch(markdown, /correctIndex|\{"/);
  assert.match(markdown, /### Quiz: Linear regression check/);
  assert.match(markdown, /#### Question 1 \(beginner\)\n\nWhat does OLS minimize\? \[S1\]/);
  assert.match(markdown, /- A\. Absolute error\n- B\. Squared residuals/);
  assert.match(markdown, /\*\*Answer:\*\* B\. Squared residuals/);

  const cards = structuredResultMarkdown({ cards: [{ front: "Lasso adds?", back: "An L1 penalty.", hint: "Sparsity", tags: ["regularization"] }] });
  assert.match(cards, /\*\*Q:\*\* Lasso adds\?\n\n\*\*A:\*\* An L1 penalty\.\n\n\*Hint:\* Sparsity\n\nTags: regularization/);

  const plan = structuredResultMarkdown({ title: "Master OLS", goal: "Derive it", milestones: [{ title: "Geometry", outcome: "Explain projection.", activities: ["Plot residuals"], estimatedMinutes: 45, evidenceOfMastery: "Explain X^T r = 0." }], cautions: ["Collinearity"] });
  assert.match(plan, /### Study plan: Master OLS\n\n\*\*Goal:\*\* Derive it\n\n#### 1\. Geometry \(45 min\)/);
  assert.match(plan, /- Plot residuals/);
  assert.match(plan, /#### Watch for\n\n- Collinearity/);
  assert.equal(structuredResultMarkdown({ unknown: true }), "");
});

test("answers carry a source list and an incomplete marker", () => {
  const sources = tutorSourceList({
    citationSources: [{ citationNumber: 3, title: "Linear Regression", section: "8. Ridge" }],
    webSources: [{ index: 2, title: "PyTorch notes", url: "https://pytorch.org/blog/" }],
  });
  assert.equal(sources, "Sources:\n- [S3] Linear Regression — 8. Ridge\n- [W2] PyTorch notes — https://pytorch.org/blog/");
  const body = tutorMessageMarkdown({ role: "assistant", content: "Partial [S3]", incomplete: true, citationSources: [{ citationNumber: 3, title: "Linear Regression" }], webSources: [] });
  assert.match(body, /^> \*\*Incomplete answer:\*\*/);
  assert.match(body, /Partial \[S3\]\n\nSources:\n- \[S3\] Linear Regression$/);
  assert.equal(tutorMessageMarkdown({ role: "user", content: "Why?", citationSources: [{ citationNumber: 1, title: "Unused" }] }), "Why?");
});

test("conversation export names mode, profile and state in each heading", () => {
  const markdown = tutorConversationMarkdown([
    { role: "user", content: "Quiz me", mode: "quiz" },
    { role: "assistant", content: JSON.stringify(quiz), data: quiz, mode: "quiz", responseProfile: "balanced", durationMs: 1_250, citationSources: [{ citationNumber: 1, title: "Linear Regression" }], webSources: [] },
    { role: "assistant", content: "Half an answer", mode: "explain", responseProfile: "fast", incomplete: true, citationSources: [], webSources: [] },
  ], { exportedAt: new Date("2026-09-24T10:00:00Z"), modeLabel: (id) => ({ quiz: "Quiz", explain: "Explain" })[id], profileLabel: (id) => ({ balanced: "Balanced", fast: "Fast" })[id] });
  assert.match(markdown, /^# Lumen AI Tutor conversation\n\nExported 2026-09-24\./);
  assert.match(markdown, /## You · Quiz\n\nQuiz me/);
  assert.match(markdown, /## Lumen Tutor · Quiz · Balanced · 1\.3s\n\n### Quiz: Linear regression check/);
  assert.doesNotMatch(markdown, /"correctIndex"/);
  assert.match(markdown, /Sources:\n- \[S1\] Linear Regression/);
  assert.match(markdown, /## Lumen Tutor · Explain · Fast · stopped early\n\n> \*\*Incomplete answer:\*\*/);
});

test("an answer check reads without its score or strengths", () => {
  const markdown = structuredResultMarkdown({ score: 20, correct: false, feedback: "It is set before training.", strengths: ["Named the update"], gaps: ["Parameters are learned"], improvedAnswer: "A hyperparameter.", nextQuestion: "Is batch size learned?" });
  assert.equal(markdown, "### Answer check\n\n**Why:** It is set before training.\n\n**What was missing:**\n\n- Parameters are learned\n\n**Correct reasoning:** A hyperparameter.\n\n**Check yourself:** Is batch size learned?");
  assert.doesNotMatch(markdown, /20|Named the update/);
  assert.match(structuredResultMarkdown({ score: 90, correct: true, feedback: "F", strengths: [], gaps: [], improvedAnswer: "I", nextQuestion: null }), /disagreed with the quiz key/);
});
