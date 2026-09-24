import assert from "node:assert/strict";
import { test } from "node:test";

import { categoryForReviewItem, createMistake, MAX_MISTAKES, mistakeAnalytics, mistakeFingerprint, normalizeMistakes, recordMistake, reinsertRecord, updateMistake } from "./mistakes.js";

test("repeated failures merge into one reopening mistake instead of duplicating", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");
  const first = recordMistake([], {
    prompt: "What does the validation split protect?",
    expected: "Model-selection decisions from leaking test information.",
    category: "misconception",
    reviewItemId: "card-1",
  }, now);
  assert.equal(first.merged, false);
  assert.equal(first.mistakes.length, 1);
  assert.equal(first.mistake.occurrences, 1);

  const corrected = updateMistake(first.mistakes, first.mistake.id, { correctedAt: "2026-09-01T11:00:00.000Z", correction: "Selection must use validation only." });
  assert.equal(corrected[0].correctedAt, "2026-09-01T11:00:00.000Z");
  assert.equal(corrected[0].correction, "Selection must use validation only.");

  const later = new Date("2026-09-02T09:00:00.000Z");
  const second = recordMistake(corrected, { prompt: "Different wording entirely", expected: "irrelevant", reviewItemId: "card-1" }, later);
  assert.equal(second.merged, true, "the same review card must merge regardless of prompt wording");
  assert.equal(second.mistakes.length, 1);
  assert.equal(second.mistake.occurrences, 2);
  assert.equal(second.mistake.correctedAt, "", "a recurrence reopens a corrected mistake");
  assert.equal(second.mistake.correction, "Selection must use validation only.", "the learner's correction survives a merge");
  assert.equal(second.mistake.lastSeenAt, later.toISOString());

  const textual = recordMistake(second.mistakes, { prompt: "  what does the VALIDATION split protect? ", expected: "x", category: "misconception" }, later);
  assert.equal(textual.merged, false, "a card-linked mistake and a free-text mistake have distinct fingerprints");
  assert.equal(mistakeFingerprint(textual.mistake).startsWith("text\u0000"), true);
  const textualRepeat = recordMistake(textual.mistakes, { prompt: "What does the validation split protect?", expected: "x", category: "misconception" }, later);
  assert.equal(textualRepeat.merged, true, "free-text mistakes merge case-insensitively by category and prompt");
});

test("review card types map onto the closest error category", () => {
  assert.equal(categoryForReviewItem({ type: "debugging", tags: [] }), "code");
  assert.equal(categoryForReviewItem({ type: "code-output", tags: [] }), "code");
  assert.equal(categoryForReviewItem({ type: "formula", tags: [] }), "formula");
  assert.equal(categoryForReviewItem({ type: "derivation", tags: [] }), "formula");
  assert.equal(categoryForReviewItem({ type: "production-scenario", tags: [] }), "system-design");
  assert.equal(categoryForReviewItem({ type: "basic", tags: ["Interview"] }), "interview");
  assert.equal(categoryForReviewItem({ type: "basic", tags: [] }), "misconception");
});

test("normalization bounds untrusted stored mistakes and empty prompts never record", () => {
  const normalized = normalizeMistakes([
    { prompt: "ok", category: "not-a-category", occurrences: -4, hints: ["h", 7, ""], tags: ["a", "a"], correctedAt: 12 },
    { prompt: "   " },
    "junk",
    { prompt: "x".repeat(5_000), expected: "y".repeat(9_000) },
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].category, "misconception");
  assert.equal(normalized[0].occurrences, 1);
  assert.deepEqual(normalized[0].hints, ["h"]);
  assert.deepEqual(normalized[0].tags, ["a"]);
  assert.equal(normalized[0].correctedAt, "");
  assert.equal(normalized[1].prompt.length, 2_000);
  assert.equal(normalized[1].expected.length, 4_000);

  assert.equal(recordMistake([], { prompt: "   ", expected: "x" }).mistake, null);
  const capped = normalizeMistakes(Array.from({ length: MAX_MISTAKES + 50 }, (_, index) => ({ prompt: `p${index}` })));
  assert.equal(capped.length, MAX_MISTAKES);
  assert.equal(createMistake({ prompt: "p", expected: "e" }).correctedAt, "");
});

test("mistake analytics count open/corrected per category and rank repeats", () => {
  const base = new Date("2026-09-01T10:00:00.000Z");
  let mistakes = recordMistake([], { prompt: "a", expected: "x", category: "code" }, base).mistakes;
  mistakes = recordMistake(mistakes, { prompt: "a", expected: "x", category: "code" }, base).mistakes;
  mistakes = recordMistake(mistakes, { prompt: "b", expected: "x", category: "formula" }, base).mistakes;
  mistakes = recordMistake(mistakes, { prompt: "c", expected: "x", category: "code" }, base).mistakes;
  mistakes = updateMistake(mistakes, mistakes.find((entry) => entry.prompt === "c").id, { correctedAt: base.toISOString() });
  const summary = mistakeAnalytics(mistakes);
  assert.equal(summary.open, 2);
  assert.equal(summary.corrected, 1);
  assert.equal(summary.byCategory.code, 1, "corrected mistakes leave the open per-category counts");
  assert.equal(summary.byCategory.formula, 1);
  assert.equal(summary.mostRepeated.length, 1);
  assert.equal(summary.mostRepeated[0].prompt, "a");
  assert.equal(summary.mostRepeated[0].occurrences, 2);
});

test("undo reinserts a deleted record at its old position exactly once", () => {
  const records = [{ id: "a" }, { id: "c" }];
  const restored = reinsertRecord(records, { id: "b", note: "mine" }, 1);
  assert.deepEqual(restored.map((entry) => entry.id), ["a", "b", "c"]);
  assert.equal(reinsertRecord(restored, { id: "b" }, 0), restored, "a record that already came back is never duplicated");
  assert.deepEqual(reinsertRecord(records, { id: "z" }, 99).map((entry) => entry.id), ["a", "c", "z"], "an out-of-range index appends");
  assert.equal(reinsertRecord(records, null, 0), records);
  assert.equal(reinsertRecord([{ id: "a" }, { id: "b" }], { id: "c" }, 0, 2).length, 2, "the collection bound still holds");
});
