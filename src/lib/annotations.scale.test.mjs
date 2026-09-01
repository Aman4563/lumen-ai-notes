import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { applyAnnotationHighlights } from "./annotations.js";

test("a maximum-size annotation pass builds one DOM index and preserves exact boundaries", () => {
  const nodeSize = 1_024;
  const source = Array.from({ length: 2 * 1_024 }, (_, index) => {
    const prefix = String(index).padStart(4, "0");
    return `${prefix}:${"abcdefghijklmnopqrstuvwxyz".repeat(40)}`.slice(0, nodeSize);
  }).join("");
  const textNodes = [];
  for (let offset = 0; offset < source.length; offset += nodeSize) {
    textNodes.push({
      nodeType: 3,
      nodeValue: source.slice(offset, offset + nodeSize),
      parentElement: { closest: () => null },
    });
  }
  const textNodeSet = new Set(textNodes);
  const root = { contains: (node) => textNodeSet.has(node) };
  let walkerCount = 0;

  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createTreeWalker: () => {
      walkerCount += 1;
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

  const annotationLimit = 5_000;
  const annotations = Array.from({ length: annotationLimit }, (_, index) => {
    const start = index === 0
      ? nodeSize
      : Math.floor((index / annotationLimit) * (source.length - 32));
    return {
      id: `annotation-${index}`,
      quote: source.slice(start, start + 24),
      start,
      end: start + 24,
      prefix: source.slice(Math.max(0, start - 120), start),
      suffix: source.slice(start + 24, start + 144),
      color: ["gold", "coral", "teal", "violet"][index % 4],
    };
  });

  const startedAt = performance.now();
  const applied = applyAnnotationHighlights(root, annotations);
  const elapsed = performance.now() - startedAt;

  assert.equal(walkerCount, 1, "the rendered corpus must be indexed once per highlight pass");
  assert.equal(applied.resolved.size, annotationLimit);
  assert.ok([...applied.resolved.values()].every((result) => result.status === "exact" && result.range), "all unchanged anchors must resolve exactly");
  assert.equal(globalThis.CSS.highlights.get("lumen-gold").size, annotationLimit / 4);

  const boundaryRange = applied.resolved.get("annotation-0").range;
  assert.equal(boundaryRange.startContainer, textNodes[0], "a start on a node boundary must retain the preceding-node coordinate");
  assert.equal(boundaryRange.startOffset, nodeSize);
  assert.equal(boundaryRange.endContainer, textNodes[1]);
  assert.equal(boundaryRange.endOffset, 24);
  assert.ok(elapsed < 2_500, `maximum annotation pass took ${Math.round(elapsed)}ms (limit: 2500ms)`);
});
