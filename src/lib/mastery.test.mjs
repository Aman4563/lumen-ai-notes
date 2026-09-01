import assert from "node:assert/strict";
import { test } from "node:test";

import { masteryByPart } from "./mastery.js";
import { buildDailySession } from "./plan.js";
import { createReviewItem } from "./review.js";

const now = new Date("2026-09-01T12:00:00.000Z");

const docs = [
  { id: "p1c1", source: "builtin", partNumber: 1, chapterNumber: 1, partTitle: "Foundations", title: "Mental model", minutes: 10 },
  { id: "p1c2", source: "builtin", partNumber: 1, chapterNumber: 2, partTitle: "Foundations", title: "Framing", minutes: 12 },
  { id: "p2c1", source: "builtin", partNumber: 2, chapterNumber: 1, partTitle: "Math", title: "Algebra", minutes: 14 },
  { id: "idx", source: "builtin", partNumber: 2, chapterNumber: 0, partTitle: "Math", title: "Part index", isIndex: true },
  { id: "custom/x.md", source: "custom", partNumber: 99, chapterNumber: 1, title: "Upload" },
];

const masteredCard = (id, documentId) => ({
  ...createReviewItem({ front: id, back: "a", documentId }, new Date("2026-07-01T00:00:00.000Z")),
  id,
  reviewCount: 6,
  lastReviewedAt: "2026-08-20T00:00:00.000Z",
  repetitions: 4,
  intervalDays: 30,
  dueAt: "2026-10-01T00:00:00.000Z",
});

test("the part mastery ladder walks not-seen → reading → read → practicing → mastered with reasons", () => {
  const base = { progress: {}, reviewItems: [], reviewSettings: { dailyNewLimit: 10, dailyReviewLimit: 50 }, reviewSessions: [], mistakes: [], recent: [] };

  const notSeen = masteryByPart(docs, base, now).find((part) => part.partNumber === 1);
  assert.equal(notSeen.state, "not-seen");
  assert.equal(notSeen.chapters, 2);

  const reading = masteryByPart(docs, { ...base, progress: { p1c1: 0.5 } }, now).find((part) => part.partNumber === 1);
  assert.equal(reading.state, "reading");
  assert.match(reading.reason, /0 of 2 chapters completed/);

  const read = masteryByPart(docs, { ...base, progress: { p1c1: 1, p1c2: 0.97 } }, now).find((part) => part.partNumber === 1);
  assert.equal(read.state, "read");
  assert.match(read.nextAction, /review cards/i);

  const practicing = masteryByPart(docs, {
    ...base,
    progress: { p1c1: 1, p1c2: 1 },
    reviewItems: [masteredCard("m1", "p1c1"), { ...masteredCard("o1", "p1c2"), dueAt: "2026-08-20T00:00:00.000Z" }],
  }, now).find((part) => part.partNumber === 1);
  assert.equal(practicing.state, "practicing", "an overdue card must hold the part below mastered");
  assert.equal(practicing.overdueCards, 1);
  assert.match(practicing.nextAction, /overdue/i);

  const mastered = masteryByPart(docs, {
    ...base,
    progress: { p1c1: 1, p1c2: 1 },
    reviewItems: [masteredCard("m1", "p1c1"), masteredCard("m2", "p1c1"), masteredCard("m3", "p1c2")],
  }, now).find((part) => part.partNumber === 1);
  assert.equal(mastered.state, "mastered");
  assert.match(mastered.reason, /3 cards hold 14-day\+/);

  // Index pages and custom uploads never count as chapters.
  const math = masteryByPart(docs, base, now).find((part) => part.partNumber === 2);
  assert.equal(math.chapters, 1);
  assert.equal(masteryByPart(docs, base, now).some((part) => part.partNumber === 99), false);
});

test("the daily session builder fills 15/30/60 minutes deterministically", () => {
  const dueCard = (id) => ({
    ...createReviewItem({ front: id, back: "a", documentId: "p1c1" }, new Date("2026-08-01T00:00:00.000Z")),
    id,
    reviewCount: 2,
    lastReviewedAt: "2026-08-20T00:00:00.000Z",
    repetitions: 1,
    intervalDays: 1,
    dueAt: "2026-09-01T08:00:00.000Z",
  });
  const profile = {
    progress: { p1c1: 0.4 },
    recent: ["p1c1"],
    reviewItems: Array.from({ length: 40 }, (_, index) => dueCard(`due-${index}`)),
    reviewSettings: { dailyNewLimit: 10, dailyReviewLimit: 100 },
    reviewSessions: [],
    mistakes: [
      { id: "mi-1", prompt: "a", correctedAt: "", occurrences: 3, lastSeenAt: "2026-08-30T00:00:00.000Z" },
      { id: "mi-2", prompt: "b", correctedAt: "", occurrences: 1, lastSeenAt: "2026-08-29T00:00:00.000Z" },
      { id: "mi-3", prompt: "c", correctedAt: "2026-08-01T00:00:00.000Z", occurrences: 9, lastSeenAt: "2026-07-30T00:00:00.000Z" },
    ],
  };

  const short = buildDailySession(15, { profile, documents: docs }, now);
  assert.equal(short.budgetMinutes, 15);
  assert.ok(short.plannedMinutes <= 15);
  assert.equal(short.blocks[0].kind, "review");
  assert.ok(short.blocks[0].count <= 15, "review block must respect the half-budget card cap");
  const shortMistakes = short.blocks.find((block) => block.kind === "mistakes");
  assert.equal(shortMistakes.count, 1, "a 15-minute session corrects at most one mistake");
  assert.deepEqual(shortMistakes.mistakeIds, ["mi-1"], "the most-repeated open mistake comes first; corrected ones never appear");

  const hour = buildDailySession(60, { profile, documents: docs }, now);
  assert.equal(hour.blocks.find((block) => block.kind === "mistakes").count, 2);
  const readingBlock = hour.blocks.find((block) => block.kind === "reading");
  assert.equal(readingBlock.documentId, "p1c1", "an in-progress chapter is resumed before starting a new one");
  assert.match(readingBlock.label, /^Continue/);
  assert.ok(hour.plannedMinutes <= 60);

  const rerun = buildDailySession(60, { profile, documents: docs }, now);
  assert.deepEqual(rerun, hour, "the plan must be deterministic for identical inputs");

  const empty = buildDailySession(30, { profile: { progress: { p1c1: 1, p1c2: 1, p2c1: 1 }, reviewItems: [], reviewSettings: {}, reviewSessions: [], mistakes: [], recent: [] }, documents: docs.slice(0, 3) }, now);
  assert.equal(empty.empty, true, "nothing due, nothing open, everything read → an honest empty plan");
});
