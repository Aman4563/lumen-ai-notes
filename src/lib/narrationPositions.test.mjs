import assert from "node:assert/strict";
import { test } from "node:test";

import { POSITION_SNIPPET_LENGTH, clearPosition, locatePosition, readPosition, writePosition } from "./narrationPositions.js";

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
