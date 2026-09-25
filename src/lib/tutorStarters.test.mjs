import assert from "node:assert/strict";
import test from "node:test";

import {
  STARTER_FIELD_CHARS,
  buildStarterPrompts,
  isStarterLesson,
  lessonHeadings,
  rankLapsedCards,
  rankOpenMistakes,
} from "./tutorStarters.js";
import { TUTOR_MAX_PROMPT_CHARS } from "./tutorRequest.js";

const chapter = { id: "notes/part-01/01-linear.md", title: "Linear Regression and Regularization", isIndex: false, partNumber: 1, source: "builtin" };
const roadmap = { id: "notes/00-roadmap.md", title: "Complete AI/ML Roadmap", isIndex: false, partNumber: 0, source: "builtin" };
const readme = { id: "notes/README.md", title: "AI/ML Curriculum Navigator", isIndex: true, partNumber: 0, source: "builtin" };
const partIndex = { id: "notes/part-01/README.md", title: "Part 1", isIndex: true, partNumber: 1, source: "builtin" };
const upload = { id: "custom/my-notes", title: "My transformer notes", source: "custom" };
const next = { id: "notes/part-01/02-logistic.md", title: "Logistic Regression", isIndex: false, partNumber: 1, source: "builtin" };

const mistake = (id, overrides = {}) => ({ id, prompt: `Prompt ${id}`, expected: `Expected ${id}`, documentId: "", occurrences: 1, lastSeenAt: "2026-09-01T00:00:00.000Z", correctedAt: "", ...overrides });
const card = (id, overrides = {}) => ({ id, front: `Front ${id}`, back: `Back ${id}`, lapses: 2, documentId: "", archived: false, suspended: false, ...overrides });

test("only chapters and uploads are lessons, never the roadmap or an index", () => {
  assert.equal(isStarterLesson(chapter), true);
  assert.equal(isStarterLesson(upload), true);
  assert.equal(isStarterLesson(roadmap), false);
  assert.equal(isStarterLesson(readme), false);
  assert.equal(isStarterLesson(partIndex), false);
  assert.equal(isStarterLesson({ ...upload, archived: true }), false);
  assert.equal(isStarterLesson(null), false);
});

test("headings come from level-two Markdown headings outside code", () => {
  const markdown = "# Title\n\n## 1. **Ordinary** least squares\n\n```md\n## not a heading\n```\n\n### Detail\n\n## [Ridge](#ridge) regression ##\n\n## Lasso\n\n## Elastic net\n\n## Fifth";
  assert.deepEqual(lessonHeadings(markdown), ["Ordinary least squares", "Ridge regression", "Lasso", "Elastic net"]);
  assert.deepEqual(lessonHeadings("## 2.1) Bias\n## 3.2 Variance\n## 2021 results"), ["Bias", "Variance", "2021 results"]);
  assert.deepEqual(lessonHeadings(""), []);
});

test("open mistakes rank this lesson first, then repeats, then recency", () => {
  const ranked = rankOpenMistakes([
    mistake("a", { occurrences: 5 }),
    mistake("b", { documentId: chapter.id }),
    mistake("c", { occurrences: 5, lastSeenAt: "2026-09-10T00:00:00.000Z" }),
    mistake("d", { correctedAt: "2026-09-02T00:00:00.000Z", occurrences: 9 }),
    mistake("e", { prompt: "  " }),
  ], chapter.id);
  assert.deepEqual(ranked.map((item) => item.id), ["b", "c", "a"]);
});

test("lapsed cards need two lapses and an active card", () => {
  const ranked = rankLapsedCards([
    card("a", { lapses: 1 }),
    card("b", { lapses: 4 }),
    card("c", { documentId: chapter.id }),
    card("d", { lapses: 6, suspended: true }),
    card("e", { lapses: 6, archived: true }),
  ], chapter.id);
  assert.deepEqual(ranked.map((item) => item.id), ["c", "b"]);
});

test("a fresh profile starts from the next lesson and never names the roadmap", () => {
  const starters = buildStarterPrompts({ recent: roadmap, last: roadmap, next, mistakes: [], reviewItems: [] }, { limit: 4 });
  assert.deepEqual(starters.map((starter) => [starter.label, starter.modeId, starter.documentId]), [
    ["Explain the key ideas of Logistic Regression", "explain", next.id],
    ["Quiz me on Logistic Regression", "quiz", next.id],
  ]);
  assert.equal(starters.some((starter) => /roadmap|navigator/i.test(`${starter.label} ${starter.prompt}`)), false);
  // No lesson, no plan, no data: nothing to suggest.
  assert.deepEqual(buildStarterPrompts({ recent: readme, last: null, next: null, mistakes: [], reviewItems: [] }), []);
  assert.deepEqual(buildStarterPrompts(null), []);
});

test("with a lesson, weak spots come first, then quiz, explain and interview", () => {
  const context = {
    recent: chapter,
    last: chapter,
    next,
    mistakes: [mistake("other", { occurrences: 3 }), mistake("here", { documentId: chapter.id })],
    reviewItems: [card("lapsed", { documentId: chapter.id, lapses: 3 })],
  };
  const phone = buildStarterPrompts(context, { limit: 4 });
  assert.deepEqual(phone.map((starter) => starter.kind), ["mistake", "card", "quiz", "explain"]);
  assert.equal(phone[0].label, "I keep missing: Prompt here");
  assert.match(phone[0].prompt, /“Prompt here”\. The correct answer is: “Expected here”\./);
  assert.equal(phone[0].documentId, chapter.id);
  assert.equal(phone[1].label, "Help me remember: Front lapsed");
  assert.equal(phone[2].label, `Quiz me on ${chapter.title}`);
  assert.match(phone[2].prompt, /the lesson “Linear Regression and Regularization”/, "a starter must name its lesson for Library-first retrieval");
  const desktop = buildStarterPrompts(context, { limit: 6, lessonText: () => "## Least squares\n\n## Ridge regression" });
  assert.deepEqual(desktop.map((starter) => starter.kind), ["mistake", "card", "quiz", "explain", "interview", "socratic"]);
  assert.equal(desktop[2].label, "Quiz me on Least squares");
  assert.equal(desktop[5].label, "Teach me Ridge regression step by step");
  assert.match(desktop[5].prompt, /one focused question at a time\. I have not answered anything yet, so start by asking what I already understand\.$/, "a Socratic starter did not say there is no answer yet (issue #82)");
  assert.deepEqual(desktop.map((starter) => starter.modeId), ["explain", "explain", "quiz", "explain", "interview", "socratic"]);
});

test("an upload is a lesson, and the last lesson read stands in for a non-lesson recent", () => {
  assert.equal(buildStarterPrompts({ recent: upload, mistakes: [], reviewItems: [] })[0].label, `Quiz me on ${upload.title}`);
  assert.equal(buildStarterPrompts({ recent: roadmap, last: chapter, mistakes: [], reviewItems: [] })[0].documentId, chapter.id);
});

test("starter text is clipped so a prompt stays well below the limit", () => {
  const long = "gradient ".repeat(400);
  const [starter] = buildStarterPrompts({ recent: chapter, mistakes: [mistake("long", { prompt: long, expected: long, documentId: chapter.id })], reviewItems: [] });
  assert.ok(starter.label.length <= "I keep missing: ".length + 80);
  assert.ok(starter.prompt.length < STARTER_FIELD_CHARS * 2 + 200);
  assert.ok(starter.prompt.length < TUTOR_MAX_PROMPT_CHARS);
  const [cloze] = buildStarterPrompts({ recent: chapter, mistakes: [], reviewItems: [card("cloze", { front: "Ridge adds an {{c1::L2::norm}} penalty", documentId: chapter.id })] });
  assert.equal(cloze.label, "Help me remember: Ridge adds an L2 penalty");
});
