import assert from "node:assert/strict";
import { test } from "node:test";

import { POSITION_SNIPPET_LENGTH, clearPosition, locatePosition, normalizePosition, readPosition, writePosition } from "./narrationPositions.js";

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    raw: map,
  };
};

const quotaError = () => Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });

// Runs `callback` while reading globalThis.localStorage throws, as it does
// where storage is blocked, then restores the original accessor.
const withThrowingAccessor = (callback) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" }); },
  });
  try {
    return callback();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
};

const queue = [
  "Chapter 1 — The AI/ML Mental Model 1. Intelligence as a system property.",
  "An intelligent product observes some context and is judged by its consequences.",
  "The implementation might use rules, search, optimization, statistics, or learning.",
  "2. Programmed rules versus learned behavior. Rules are written by people.",
  "Learned behavior is fitted from examples.",
  "3. The basic objects of supervised ML. A dataset pairs inputs with targets.",
  "A model maps inputs to predictions.",
  "Check your understanding: why can a model be accurate and useless?",
];
const sectionStarts = [
  { index: 0, label: "Chapter 1 — The AI/ML Mental Model" },
  { index: 3, label: "2. Programmed rules versus learned behavior" },
  { index: 5, label: "3. The basic objects of supervised ML" },
];

test("positions round-trip as version 2 records with a 60-character snippet", () => {
  const storage = memoryStorage();
  const written = writePosition("doc-a", { index: 4, total: 8, snippet: queue[4].repeat(3), section: sectionStarts[1].label }, storage);
  assert.equal(written.v, 2);
  assert.equal(written.snippet.length, POSITION_SNIPPET_LENGTH);
  assert.deepEqual(readPosition("doc-a", storage), written);
  assert.deepEqual(JSON.parse(storage.raw.get("lumen-narration-doc-a")), written, "the stored value is the versioned record");
  assert.equal(clearPosition("doc-a", storage), true);
  assert.equal(readPosition("doc-a", storage), null);
  assert.equal(readPosition("doc-b", storage), null, "a lecture without a saved position has none");
});

test("throwing storage returns null and never throws", () => {
  const throwing = {
    getItem: () => { throw quotaError(); },
    setItem: () => { throw quotaError(); },
    removeItem: () => { throw quotaError(); },
  };
  assert.equal(readPosition("doc-a", throwing), null);
  assert.equal(writePosition("doc-a", { index: 3, total: 8, snippet: queue[3], section: "" }, throwing), null);
  assert.equal(clearPosition("doc-a", throwing), null);
  assert.equal(readPosition("doc-a", null), null, "a missing store is not an error");

  // Where storage is blocked, reading the localStorage accessor itself throws.
  withThrowingAccessor(() => {
    assert.equal(readPosition("doc-a"), null);
    assert.equal(writePosition("doc-a", { index: 3, total: 8, snippet: queue[3], section: "" }), null);
    assert.equal(clearPosition("doc-a"), null);
  });

  const corrupt = memoryStorage();
  corrupt.setItem("lumen-narration-doc-a", "{not json");
  assert.equal(readPosition("doc-a", corrupt), null);
  corrupt.setItem("lumen-narration-doc-a", JSON.stringify({ v: 2, index: -4, snippet: "x" }));
  assert.equal(readPosition("doc-a", corrupt), null, "a negative index is not a position");
});

test("a version 1 integer is read as an index and only bounds-checked", () => {
  const storage = memoryStorage();
  storage.setItem("lumen-narration-doc-a", "5");
  const legacy = readPosition("doc-a", storage);
  assert.deepEqual(legacy, { v: 1, index: 5, total: 0, snippet: "", section: "" });
  assert.deepEqual(locatePosition(legacy, queue, sectionStarts), { index: 5, how: "index" });

  storage.setItem("lumen-narration-doc-a", "9999");
  const stale = readPosition("doc-a", storage);
  assert.deepEqual(locatePosition(stale, queue, sectionStarts), { index: 0, how: "changed" }, "9999 must not clamp onto the last chunk");
  assert.deepEqual(locatePosition({ index: queue.length - 1 }, queue, sectionStarts), { index: 0, how: "changed" }, "resume never lands on the last chunk");
  assert.deepEqual(locatePosition(null, queue, sectionStarts), { index: 0, how: "start" });
});

test("a saved position relocates by snippet, then section, then the beginning", () => {
  const at = (index) => ({ v: 2, index, total: queue.length, snippet: queue[index].slice(0, 60), section: sectionStarts.filter((start) => start.index <= index).at(-1).label });

  assert.deepEqual(locatePosition(at(4), queue, sectionStarts), { index: 4, how: "exact" });

  // An edit inserted two chunks before the saved one: the snippet finds it.
  const grown = [queue[0], "A new opening sentence.", "Another new sentence.", ...queue.slice(1)];
  const grownStarts = sectionStarts.map((start) => ({ ...start, index: start.index ? start.index + 2 : 0 }));
  assert.deepEqual(locatePosition(at(4), grown, grownStarts), { index: 6, how: "snippet" });

  // The same sentence twice: the copy nearest the saved index wins.
  const repeated = [...queue.slice(0, 7), queue[1], "The end."];
  assert.deepEqual(locatePosition({ ...at(1), index: 6 }, repeated, sectionStarts), { index: 7, how: "snippet" });

  // The sentence itself was rewritten and the lecture's length changed, but
  // its section survives.
  const rewritten = queue.map((chunk, index) => (index === 4 ? "Learned behaviour is estimated from labelled examples." : chunk));
  const rewrittenAndGrown = [...rewritten.slice(0, 7), "A new closing thought.", rewritten[7]];
  assert.deepEqual(locatePosition(at(4), rewrittenAndGrown, sectionStarts), { index: 3, how: "section" });

  // Neither the sentence nor its section is left: start over and say so.
  const unrelated = ["Different lecture.", "Different body.", "Different end."];
  assert.deepEqual(locatePosition(at(4), unrelated, [{ index: 0, label: "Other" }]), { index: 0, how: "changed" });

  // A lecture that shrank so the snippet now sits on the last chunk.
  const shrunk = [queue[0], queue[3], queue[4]];
  assert.deepEqual(locatePosition(at(4), shrunk, [{ index: 1, label: sectionStarts[1].label }]), { index: 1, how: "section" });
  assert.deepEqual(locatePosition(at(4), shrunk, [], { allowLast: true }), { index: 2, how: "snippet" }, "a bookmark may play the closing sentence");
});

// A pronunciation override (or an edit in place) rewords the saved sentence
// but keeps the queue's length and sections: the saved index still names it.
test("a reworded sentence in a queue of the same length keeps its index", () => {
  const at = (index) => ({ v: 2, index, total: queue.length, snippet: queue[index].slice(0, 60), section: sectionStarts.filter((start) => start.index <= index).at(-1).label });
  const overridden = queue.map((chunk) => chunk.replace(/\bexamples\b/gu, "exam pulls"));
  assert.notEqual(overridden[4], queue[4], "the override must touch the saved sentence");
  assert.deepEqual(locatePosition(at(4), overridden, sectionStarts), { index: 4, how: "index" });
  const rewritten = queue.map((chunk, index) => (index === 4 ? "Learned behaviour is estimated from labelled examples." : chunk));
  assert.deepEqual(locatePosition(at(4), rewritten, sectionStarts), { index: 4, how: "index" }, "an edit in place resumes at the edited sentence");
  // A different section at the saved index means the lecture moved on.
  const renamed = sectionStarts.map((start) => (start.index === 3 ? { ...start, label: "2. Renamed section" } : start));
  assert.deepEqual(locatePosition(at(4), overridden, renamed), { index: 0, how: "changed" });
  // Never the last chunk, even at the same length.
  assert.deepEqual(locatePosition({ ...at(7), snippet: "Reworded closing question." }, queue, sectionStarts), { index: 5, how: "section" });
  assert.deepEqual(locatePosition({ ...at(7), snippet: "Reworded closing question." }, queue, sectionStarts, { allowLast: true }), { index: 7, how: "index" });
});

test("positions are found in a queue of entries", () => {
  const entry = (text) => ({ text, unit: null, map: [], section: "" });
  const queue = ["One.", "Two sentence here.", "Three.", "Four."].map(entry);
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 4, snippet: "Two sentence", section: "" }, queue, []), { index: 1, how: "exact" });
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 9, snippet: "Three.", section: "" }, queue, []), { index: 2, how: "snippet" });
});

// Issue #100: a position also names the block and offset of the sentence, so a
// reworded sentence (an override, a new rule) is found again by where it is.
const unitEntry = (text, blockIndex, start, end, section = "S") => ({ text, unit: { blockIndex, start, end }, map: [], section });

test("a saved unit is tried first and confirmed by its snippet or the queue length", () => {
  const queue = [unitEntry("Title.", 0, 0, 5), unitEntry("First sentence.", 1, 0, 16), unitEntry("Second, reworded.", 1, 16, 34), unitEntry("End.", 2, 0, 4)];
  // Reworded by an override: same queue length, so the coordinates stand.
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 4, snippet: "Second sentence", section: "S", blockIndex: 1, start: 16 }, queue, []), { index: 2, how: "unit" });
  // Snippet confirms even when the length changed.
  assert.deepEqual(locatePosition({ v: 2, index: 9, total: 7, snippet: "Second, re", section: "S", blockIndex: 1, start: 20 }, queue, []), { index: 2, how: "unit" });
  // Shifted blocks: the coordinates point at another sentence, the length differs, so the snippet search decides.
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 9, snippet: "First sentence.", section: "S", blockIndex: 2, start: 0 }, queue, []), { index: 1, how: "exact" });
  // Never the last chunk.
  assert.equal(locatePosition({ v: 2, index: 0, total: 4, snippet: "", section: "S", blockIndex: 2, start: 0 }, queue, []).index !== 3, true);
  assert.deepEqual(normalizePosition({ index: 2, total: 4, snippet: "x", section: "S", blockIndex: 1, start: 16 }), { v: 2, index: 2, total: 4, snippet: "x", section: "S", blockIndex: 1, start: 16 });
  assert.deepEqual(normalizePosition({ index: 2, blockIndex: -1, start: 1.5 }), { v: 2, index: 2, total: 0, snippet: "", section: "" });
});

test("a block and an offset are kept together or not at all", () => {
  const base = { v: 2, index: 2, total: 4, snippet: "x", section: "S" };
  assert.deepEqual(normalizePosition({ ...base, blockIndex: 0, start: 0 }), { ...base, blockIndex: 0, start: 0 }, "zero is a whole number");
  for (const lone of [{ blockIndex: 3 }, { start: 3 }, { blockIndex: 3, start: -1 }, { blockIndex: "3", start: 4 }, { blockIndex: 3, start: Number.NaN }, { blockIndex: null, start: null }]) {
    assert.deepEqual(normalizePosition({ ...base, ...lone }), base, `${JSON.stringify(lone)} names no place`);
  }
  // Stored and read back through storage, the pair survives.
  const storage = memoryStorage();
  const written = writePosition("doc-a", { ...base, blockIndex: 7, start: 120 }, storage);
  assert.deepEqual(readPosition("doc-a", storage), written);
  assert.deepEqual(JSON.parse(storage.raw.get("lumen-narration-doc-a")), { ...base, blockIndex: 7, start: 120 });
  // A version 1 integer and a record without the pair have neither key.
  assert.deepEqual(Object.keys(normalizePosition(5)), ["v", "index", "total", "snippet", "section"]);
  assert.deepEqual(Object.keys(normalizePosition(base)), ["v", "index", "total", "snippet", "section"]);
});

test("a saved unit with no snippet resumes at its sentence", () => {
  const queue = [unitEntry("Title.", 0, 0, 5), unitEntry("One.", 1, 0, 4), unitEntry("Two.", 1, 4, 8), unitEntry("Three.", 2, 0, 6), unitEntry("End.", 3, 0, 4)];
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 0, snippet: "", section: "", blockIndex: 1, start: 4 }, queue, []), { index: 2, how: "unit" });
  // The last offset of a range and one past it.
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 0, snippet: "", section: "", blockIndex: 1, start: 7 }, queue, []), { index: 2, how: "unit" });
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 0, snippet: "", section: "", blockIndex: 1, start: 8 }, queue, []), { index: 1, how: "index" }, "no entry holds offset 8 of block 1: the index chain runs");
});

test("a block that is not in the queue, or a queue of text, leaves the old rules in charge", () => {
  const queue = [unitEntry("Title.", 0, 0, 5), unitEntry("One.", 1, 0, 4), unitEntry("Two.", 1, 4, 8), unitEntry("End.", 2, 0, 4)];
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 4, snippet: "One.", section: "S", blockIndex: 9, start: 0 }, queue, []), { index: 1, how: "exact" });
  // Text entries (Selection, a tutor's answer) have no unit.
  const text = ["One.", "Two sentence here.", "Three.", "Four."].map((value) => ({ text: value, unit: null, map: [], section: "" }));
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 4, snippet: "Three.", section: "", blockIndex: 0, start: 0 }, text, []), { index: 2, how: "snippet" });
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 4, snippet: "Two sentence", section: "", blockIndex: 0, start: 0 }, ["One.", "Two sentence here.", "Three.", "Four."], []), { index: 1, how: "exact" }, "plain strings carry no unit");
});

// An announcement (start 0, end 0) and the first line of the same block both
// hold offset 0: the snippet says which one was playing.
test("among the entries that hold the saved offset, the one that starts with the snippet wins", () => {
  const queue = [
    unitEntry("Intro.", 0, 0, 6),
    unitEntry("Python example, 2 lines.", 1, 0, 0),
    unitEntry("import num pie as np", 1, 0, 20),
    unitEntry("print(w)", 1, 20, 28),
    unitEntry("After.", 2, 0, 6),
    unitEntry("End.", 3, 0, 4),
  ];
  const saved = (snippet, total = 99) => ({ v: 2, index: 0, total, snippet, section: "S", blockIndex: 1, start: 0 });
  assert.deepEqual(locatePosition(saved("Python example"), queue, []), { index: 1, how: "unit" });
  assert.deepEqual(locatePosition(saved("import num pie"), queue, []), { index: 2, how: "unit" });
  // Neither starts with the snippet: the first one that holds the offset, confirmed by the queue length.
  assert.deepEqual(locatePosition(saved("A reworded line", queue.length), queue, []), { index: 1, how: "unit" });
  // Not confirmed (other length, other words): the snippet search finds nothing, so the old rules say changed.
  assert.deepEqual(locatePosition(saved("A reworded line", 99), queue, []), { index: 0, how: "changed" });
});

test("a bookmark on the closing sentence plays it by unit; a resume does not", () => {
  const queue = [unitEntry("Title.", 0, 0, 5), unitEntry("One.", 1, 0, 4), unitEntry("End.", 2, 0, 4)];
  const saved = { v: 2, index: 2, total: 3, snippet: "End.", section: "S", blockIndex: 2, start: 0 };
  assert.deepEqual(locatePosition(saved, queue, [], { allowLast: true }), { index: 2, how: "unit" });
  assert.equal(locatePosition(saved, queue, []).how !== "unit", true);
  assert.equal(locatePosition(saved, queue, []).index !== 2, true, "resume never lands on the last chunk");
});
