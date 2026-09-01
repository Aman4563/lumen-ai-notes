import assert from "node:assert/strict";
import { test } from "node:test";

import { boardPageToSvg } from "./boardSvg.js";

const page = {
  objects: [
    { id: "pen", tool: "pen", color: "#17283e", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }] },
    { id: "arrow", tool: "arrow", color: "#b30000", width: 4, points: [{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }] },
    { id: "rect", tool: "rectangle", color: "#005c50", width: 3, points: [{ x: 0.5, y: 0.2 }, { x: 0.7, y: 0.4 }] },
    { id: "ellipse", tool: "ellipse", color: "#3b0080", width: 3, points: [{ x: 0.1, y: 0.6 }, { x: 0.3, y: 0.8 }] },
    { id: "marker", tool: "marker", color: "#f6b73c", width: 12, points: [{ x: 0.4, y: 0.7 }, { x: 0.5, y: 0.7 }] },
    { id: "eraser", tool: "eraser", color: "#000000", width: 20, points: [{ x: 0.45, y: 0.72 }, { x: 0.48, y: 0.72 }] },
    { id: "text", tool: "text", color: "#17283e", fontSize: 24, text: "Gradient <descent> & friends", points: [{ x: 0.1, y: 0.9 }] },
    { id: "sticky", tool: "sticky", color: "#17283e", fill: "#fff1a8", fontSize: 18, text: "Check the assumptions", points: [{ x: 0.6, y: 0.6 }] },
  ],
};

test("a board page serializes to a faithful standalone SVG", () => {
  const svg = boardPageToSvg(page, { width: 1600, height: 1000, background: "#ffffff" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1600 1000"/);
  assert.match(svg, /<polyline points="160.0,100.0 320.0,150.0 480.0,100.0"/, "pen strokes become polylines");
  assert.match(svg, /<path d="M 320.0 500.0 L 960.0 500.0 M 960.0 500.0 L /, "arrows carry their head strokes");
  assert.match(svg, /<rect x="800.0" y="200.0" width="320.0" height="200.0"/);
  assert.match(svg, /<ellipse cx="320.0" cy="700.0" rx="160.0" ry="100.0"/);
  assert.match(svg, /opacity="0.26"/, "marker translucency is preserved");
  assert.match(svg, /stroke="#ffffff" stroke-width="20"/, "eraser strokes paint the background color");
  assert.match(svg, /Gradient &lt;descent&gt; &amp; friends/, "text content is XML-escaped");
  assert.match(svg, /rx="12" fill="#fff1a8"/, "sticky notes keep their card");
  assert.equal(boardPageToSvg({ objects: [] }).includes("<polyline"), false);
});
