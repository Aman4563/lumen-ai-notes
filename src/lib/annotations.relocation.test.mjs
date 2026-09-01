import assert from "node:assert/strict";
import test from "node:test";

import { applyAnnotationHighlights } from "./annotations.js";

/**
 * Deterministic LEARN-001 relocation semantics without a browser: exact
 * anchors keep their offsets, moved quotes relocate to the context-scored
 * position, and missing quotes orphan with a typed reason.
 */
const installDomStubs = (source) => {
  const nodeSize = 512;
  const textNodes = [];
  for (let offset = 0; offset < source.length; offset += nodeSize) {
    textNodes.push({ nodeType: 3, nodeValue: source.slice(offset, offset + nodeSize), parentElement: { closest: () => null } });
  }
  const textNodeSet = new Set(textNodes);
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createTreeWalker: () => {
      let cursor = 0;
      return { nextNode: () => textNodes[cursor++] || null };
    },
    createRange: () => ({
      startContainer: null,
      startOffset: 0,
      endContainer: null,
      endOffset: 0,
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
      setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; },
    }),
  };
  globalThis.CSS = { highlights: new Map() };
  globalThis.Highlight = class Highlight {
    constructor(...ranges) { this.ranges = ranges; this.size = ranges.length; }
  };
  return { root: { contains: (node) => textNodeSet.has(node) } };
};

const rangeOffset = (range, nodeSize = 512) => {
  // Convert a (node, offset) coordinate back to a global text offset.
  const nodes = [];
  let walker = globalThis.document.createTreeWalker();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes.indexOf(range.startContainer) * nodeSize + range.startOffset;
};

test("edited sources relocate anchors by context and missing quotes orphan with a typed reason", () => {
  const quote = "the calibration reliability rule";
  const prefixText = "Before everything else remember that ";
  const suffixText = " applies to every held-out estimate.";
  const originalStart = 700;
  const filler = (length, seed) => Array.from({ length }, (_, index) => "abcdefghij"[(index + seed) % 10]).join("");
  const original = `${filler(originalStart - prefixText.length, 1)}${prefixText}${quote}${suffixText}${filler(1_500, 3)}`;

  // 1. Unchanged source: exact resolution at the stored offsets.
  const exactDom = installDomStubs(original);
  const anchor = {
    id: "a1",
    quote,
    start: originalStart,
    end: originalStart + quote.length,
    prefix: prefixText.slice(-120),
    suffix: suffixText.slice(0, 120),
    color: "teal",
  };
  const exact = applyAnnotationHighlights(exactDom.root, [anchor]).resolved.get("a1");
  assert.equal(exact.status, "exact");
  assert.equal(rangeOffset(exact.range), originalStart);

  // 2. A moderate edit shifts the passage: the anchor must relocate to the
  //    surviving quote, preferring the position whose context still matches.
  const insertion = "A NEW OPENING PARAGRAPH WAS ADDED HERE. ".repeat(5);
  const shifted = `${insertion}${original}`;
  const shiftedDom = installDomStubs(shifted);
  const relocated = applyAnnotationHighlights(shiftedDom.root, [anchor]).resolved.get("a1");
  assert.equal(relocated.status, "relocated");
  assert.equal(rangeOffset(relocated.range), originalStart + insertion.length);

  // 3. Context breaks ties between duplicate quotes: a decoy occurrence with
  //    foreign context must lose to the occurrence that keeps the original
  //    prefix/suffix even though the decoy sits closer to the stored offset.
  const decoy = `zzz DECOY CONTEXT ${quote} UNRELATED TAIL zzz `;
  const duplicated = `${filler(200, 5)}${decoy}${filler(400, 7)}${prefixText}${quote}${suffixText}${filler(800, 9)}`;
  const duplicatedDom = installDomStubs(duplicated);
  const tieBroken = applyAnnotationHighlights(duplicatedDom.root, [{ ...anchor, start: 260, end: 260 + quote.length }]).resolved.get("a1");
  assert.equal(tieBroken.status, "relocated");
  const winnerOffset = rangeOffset(tieBroken.range);
  assert.equal(duplicated.slice(winnerOffset - prefixText.length, winnerOffset), prefixText, "relocation must prefer the context-matching occurrence over a closer decoy");

  // 4. A deleted quote orphans with the typed reason and no range.
  const removed = original.replace(quote, "");
  const removedDom = installDomStubs(removed);
  const orphaned = applyAnnotationHighlights(removedDom.root, [anchor]).resolved.get("a1");
  assert.equal(orphaned.status, "orphaned");
  assert.equal(orphaned.reason, "quote-not-found");
  assert.equal(orphaned.range, null);

  // 5. A record without a quote is orphaned as missing-anchor.
  const missing = applyAnnotationHighlights(removedDom.root, [{ id: "a2", quote: "", start: 0, end: 0, prefix: "", suffix: "", color: "gold" }]).resolved.get("a2");
  assert.equal(missing.status, "orphaned");
  assert.equal(missing.reason, "missing-anchor");
});

test("resolution still classifies anchors when CSS Highlight painting is unsupported", () => {
  const source = `Lead-in text. The important sentence to keep. Trailing text.${"x".repeat(600)}`;
  const dom = installDomStubs(source);
  delete globalThis.CSS;
  delete globalThis.Highlight;
  const quote = "The important sentence to keep.";
  const start = source.indexOf(quote);
  const applied = applyAnnotationHighlights(dom.root, [{
    id: "fallback-1",
    quote,
    start,
    end: start + quote.length,
    prefix: source.slice(0, start).slice(-120),
    suffix: source.slice(start + quote.length, start + quote.length + 120),
    color: "coral",
  }]);
  assert.equal(applied.supported, false, "missing CSS Highlight support must be reported, not guessed");
  const result = applied.resolved.get("fallback-1");
  assert.equal(result.status, "exact", "list navigation needs resolution even without inline painting");
  assert.ok(result.range, "a resolvable range is still required for scroll-to-highlight");
  applied.clear();
});
