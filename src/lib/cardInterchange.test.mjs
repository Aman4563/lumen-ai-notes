import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CARD_INTERCHANGE_FORMAT,
  exportReviewCards,
  importReviewCards,
  parseCardInterchange,
} from "./cardInterchange.js";
import { documentToStandaloneHtml } from "./exportHtml.js";
import { createReviewItem } from "./review.js";

const now = new Date("2026-09-01T12:00:00.000Z");

test("card export carries authoring fields only and skips archived cards", () => {
  const items = [
    createReviewItem({ front: "Q1", back: "A1", type: "cloze", tags: ["a"], documentId: "notes/part-01" }, now),
    { ...createReviewItem({ front: "Q2", back: "A2" }, now), archived: true },
  ];
  const envelope = exportReviewCards(items, now);
  assert.equal(envelope.format, CARD_INTERCHANGE_FORMAT);
  assert.equal(envelope.exportedAt, now.toISOString());
  assert.deepEqual(envelope.cards, [{ type: "cloze", front: "Q1", back: "A1", tags: ["a"] }]);
  assert.equal("dueAt" in envelope.cards[0], false, "scheduling state must not travel");
});

test("interchange parsing validates the envelope and drops malformed cards", () => {
  assert.equal(parseCardInterchange("not json").ok, false);
  assert.equal(parseCardInterchange('{"format":"other.v9","cards":[]}').ok, false);
  assert.equal(parseCardInterchange('{"format":"lumen.cards.v1"}').ok, false);
  const result = parseCardInterchange(JSON.stringify({
    format: CARD_INTERCHANGE_FORMAT,
    cards: [
      { type: "formula", front: " F ", back: " B ", tags: ["x", "x", 3] },
      { front: "", back: "missing front" },
      { type: "made-up", front: "F2", back: "B2" },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.invalid, 1);
  assert.deepEqual(result.cards, [
    { type: "formula", front: "F", back: "B", tags: ["x"] },
    { type: "basic", front: "F2", back: "B2", tags: [] },
  ]);
});

test("import schedules fresh new-queue items and skips duplicates", () => {
  const existing = [createReviewItem({ front: "Known", back: "Answer" }, now)];
  const { added, duplicates } = importReviewCards(existing, [
    { type: "basic", front: "known", back: "ANSWER", tags: [] },
    { type: "cloze", front: "New {{term}}", back: "term", tags: ["imported"] },
    { type: "cloze", front: "New {{term}}", back: "term", tags: ["imported"] },
  ], now);
  assert.equal(duplicates, 2, "deck duplicates and in-file duplicates both skip");
  assert.equal(added.length, 1);
  assert.equal(added[0].repetitions, 0);
  assert.equal(added[0].dueAt, now.toISOString(), "imported cards start in the new queue");
  assert.deepEqual(added[0].tags, ["imported"]);

  const nearCapacity = importReviewCards(existing, [{ front: "X", back: "Y" }, { front: "X", back: "Y" }, { front: "known", back: "answer" }], now, 1);
  assert.equal(nearCapacity.added.length, 0, "capacity is honored");
  assert.equal(nearCapacity.overCapacity, 1, "unique cards left out by a full deck are counted, not dropped silently");
  assert.equal(nearCapacity.duplicates, 2, "duplicates stay duplicates even when the deck is full");
});

test("standalone HTML export is self-contained and escapes the title", () => {
  const html = documentToStandaloneHtml({
    title: 'Notes <script>"x"</script>',
    renderedHtml: "<h1>Body</h1>",
    sourceLabel: "Part 5 — Classical Supervised Learning",
    exportedAt: now,
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Notes &lt;script&gt;&quot;x&quot;&lt;\/script&gt;<\/title>/);
  assert.match(html, /<h1>Body<\/h1>/);
  assert.match(html, /Part 5 — Classical Supervised Learning/);
  assert.doesNotMatch(html, /https?:\/\//, "no external asset references");
  // KaTeX emits an HTML copy and a MathML copy of each formula; without
  // KaTeX's stylesheet the export must show only the MathML one.
  assert.match(html, /\.katex-html\s*\{\s*display:\s*none;?\s*\}/, "TeX would render twice in the export");
});
