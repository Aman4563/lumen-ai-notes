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
  // The eraser removes earlier ink only (never the background, never later
  // objects): it becomes a mask over everything drawn before it.
  assert.match(svg, /<mask id="board-erase-1"[^>]*><rect width="1600" height="1000" fill="#fff"\/><polyline points="720.0,720.0 768.0,720.0" stroke="#000" stroke-width="20"/);
  const maskOpen = svg.indexOf('<g mask="url(#board-erase-1)">');
  const maskClose = svg.indexOf("</g>", maskOpen);
  assert.ok(maskOpen > 0 && maskOpen < svg.indexOf("<polyline points=\"160.0") && svg.indexOf('opacity="0.26"') < maskClose, "ink drawn before the eraser sits inside its mask");
  assert.ok(svg.indexOf("Gradient") > maskClose, "text drawn after the eraser is not masked");
  assert.match(svg, /Gradient &lt;descent&gt; &amp; friends/, "text content is XML-escaped");
  assert.match(svg, /rx="12" fill="#fff1a8"/, "sticky notes keep their card");
  assert.equal(boardPageToSvg({ objects: [] }).includes("<polyline"), false);
  assert.equal(boardPageToSvg({ objects: [page.objects[5]] }).includes("<mask"), false, "an eraser with nothing under it adds no mask");
});

test("the SVG uses the page's authoring pixels, so it matches the canvas and PNG (BOARD-SVG)", () => {
  // A phone page: 24px text, a 3px stroke, and a sticky with a long question.
  const phonePage = {
    objects: [
      { id: "circle", tool: "ellipse", color: "#17283e", width: 3, points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.45 }] },
      { id: "label", tool: "text", color: "#17283e", fontSize: 24, text: "MSE loss", points: [{ x: 0.1, y: 0.6 }] },
      { id: "note", tool: "sticky", color: "#17283e", fill: "#fff1a8", fontSize: 18, text: "Why does L2 shrink weights smoothly while L1 drives some of them exactly to zero?", points: [{ x: 0.5, y: 0.6 }] },
    ],
  };
  const measure = (text, font) => String(text).length * (Number(/(\d+)px/.exec(font)[1]) * 0.5);
  const svg = boardPageToSvg(phonePage, { width: 393, height: 478, outputWidth: 1600, outputHeight: 1946, background: "#fbf8f1", pattern: "grid", measure });
  assert.match(svg, /viewBox="0 0 393 478" width="1600" height="1946"/, "the viewBox is the page, the size attributes only scale it");
  assert.match(svg, /font-size="24"[^>]*>/, "font sizes stay in page pixels, proportional to the shapes");
  assert.match(svg, /<ellipse [^>]*stroke-width="3"/, "stroke widths stay in page pixels");
  assert.match(svg, /<rect x="196.5" y="286.8" width="141.5" height="105.2" rx="12"/, "the sticky card matches the canvas card");
  assert.match(svg, /<tspan[^>]*>[^<]*…<\/tspan><\/text><\/g>/, "an overflowing sticky ends with an ellipsis like the canvas");
  assert.ok((svg.match(/<tspan/g) || []).length >= 4, "text wraps with the caller's measurement");
  assert.match(svg, /<pattern id="board-background" x="12" y="12" width="24" height="24"/, "the 24px grid is exported");
  assert.match(svg, /<rect width="393" height="478" fill="url\(#board-background\)"\/>/);
});

test("rotated objects export wrapped in a center-anchored rotate transform", () => {
  const page = {
    id: "page-1",
    name: "Rotation",
    objects: [
      { id: "straight", tool: "rectangle", color: "#17283e", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }] },
      { id: "tilted", tool: "rectangle", color: "#17283e", width: 3, rotation: Math.PI / 2, points: [{ x: 0.4, y: 0.4 }, { x: 0.8, y: 0.6 }] },
    ],
  };
  const svg = boardPageToSvg(page, { width: 1000, height: 500 });
  assert.match(svg, /<g transform="rotate\(90\.00 600\.0 250\.0\)"><rect/, "rotation must anchor at the object's bounds center in viewBox pixels");
  assert.equal(svg.match(/<g transform="rotate/g)?.length, 1, "unrotated objects must not grow a transform group");
});
