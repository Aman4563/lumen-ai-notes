import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approximateMeasure,
  clampTranslation,
  fitPage,
  normalizePageSize,
  objectBounds,
  pageSizeOf,
  placeBlock,
  placementOffset,
  rotatedBounds,
  stickyHeightForText,
  stickyLayout,
  textLayout,
  translatePoints,
  unionBounds,
} from "./boardGeometry.js";

const phone = { width: 393, height: 478 };
const desktop = { width: 1006, height: 512 };

test("page sizes validate, round, and clamp; legacy pages fall back to the rounded canvas", () => {
  assert.equal(normalizePageSize(undefined), null);
  assert.equal(normalizePageSize({ width: "wide", height: 400 }), null);
  assert.equal(normalizePageSize({ width: -1, height: 400 }), null);
  assert.deepEqual(normalizePageSize({ width: 392.6, height: 20_000 }), { width: 393, height: 8000 });
  assert.deepEqual(normalizePageSize({ width: 12, height: 300 }), { width: 100, height: 300 });
  assert.deepEqual(pageSizeOf({ id: "legacy" }, { width: 402.4, height: 459.5 }), { width: 402, height: 460 });
  assert.deepEqual(pageSizeOf({ size: phone }, desktop), phone, "an authored page keeps its own size on any canvas");
});

test("a page fits any canvas with one uniform scale, so shapes keep their proportions", () => {
  const identity = fitPage(phone, phone);
  assert.deepEqual(identity, { scale: 1, width: 393, height: 478, left: 0, top: 0 });

  // BOARD-2: a 120px square drawn on the phone stays square on the desktop.
  const square = { tool: "rectangle", points: [{ x: 100 / 393, y: 100 / 478 }, { x: 220 / 393, y: 220 / 478 }] };
  const fit = fitPage(desktop, phone);
  const widthOnDesktop = (square.points[1].x - square.points[0].x) * phone.width * fit.scale;
  const heightOnDesktop = (square.points[1].y - square.points[0].y) * phone.height * fit.scale;
  assert.ok(Math.abs(widthOnDesktop - heightOnDesktop) < 1e-9, `square became ${widthOnDesktop}×${heightOnDesktop}`);
  assert.ok(fit.left > 0 && Math.abs(fit.top) < 1e-9, "a tall page is letterboxed left and right on a wide canvas");
  assert.ok(Math.abs(fit.left * 2 + fit.width - desktop.width) < 1e-9, "the page is centered");

  const landscape = fitPage({ width: 852, height: 187 }, phone);
  assert.ok(landscape.height <= 187 + 1e-9 && landscape.width <= 852 + 1e-9, "the page never overflows the canvas");
});

test("edge moves clamp the group's delta and never squash an object (BOARD-5)", () => {
  const rectangle = { tool: "rectangle", points: [{ x: 0.8, y: 0.2 }, { x: 0.95, y: 0.4 }] };
  let points = rectangle.points;
  for (const step of [0.05, 0.05, 0.05, -0.05, -0.05, -0.05]) {
    const delta = clampTranslation(objectBounds({ ...rectangle, points }, phone), step, 0);
    points = translatePoints(points, delta);
  }
  assert.ok(Math.abs((points[1].x - points[0].x) - 0.15) < 1e-9, "three nudges out and three back keep the width");

  const drag = clampTranslation(objectBounds(rectangle, phone), 0.4, 0.9);
  assert.ok(Math.abs(drag.x - 0.05) < 1e-9 && Math.abs(drag.y - 0.6) < 1e-9, "a drag stops at the page edge");
  const moved = translatePoints(rectangle.points, drag);
  assert.ok(Math.abs((moved[1].x - moved[0].x) - 0.15) < 1e-9 && Math.abs((moved[1].y - moved[0].y) - 0.2) < 1e-9);

  const overhanging = { minX: -0.1, maxX: 0.5, minY: 0.2, maxY: 0.3 };
  assert.equal(clampTranslation(overhanging, -0.2, 0).x, 0, "an overhanging group cannot move further out");
  assert.equal(clampTranslation(overhanging, 0.2, 0).x, 0.2, "but may move back inward");
});

test("duplicates flip their offset at an edge instead of clamping point by point", () => {
  assert.deepEqual(placementOffset({ minX: 0.1, maxX: 0.3, minY: 0.1, maxY: 0.3 }, 0.025), { x: 0.025, y: 0.025 });
  const nearCorner = placementOffset({ minX: 0.8, maxX: 0.99, minY: 0.85, maxY: 1 }, 0.025);
  assert.deepEqual(nearCorner, { x: -0.025, y: -0.025 });
  assert.deepEqual(unionBounds([{ minX: 0.1, maxX: 0.2, minY: 0.5, maxY: 0.6 }, { minX: 0.4, maxX: 0.5, minY: 0.1, maxY: 0.3 }]), { minX: 0.1, maxX: 0.5, minY: 0.1, maxY: 0.6 });
});

test("wrapped text bounds cover every line so any line selects it (BOARD-8)", () => {
  const text = { tool: "text", fontSize: 24, text: "Ridge regression shrinks every weight smoothly while lasso drives some of them exactly to zero and selects features", points: [{ x: 0.2, y: 0.1 }] };
  const layout = textLayout(text, phone);
  assert.ok(layout.lines.length > 4, `expected a wrapped paragraph, got ${layout.lines.length} lines`);
  const bounds = objectBounds(text, phone);
  assert.ok(Math.abs((bounds.maxY - bounds.minY) * phone.height - layout.lines.length * 30) < 1e-9, "height is lines × line height");
  assert.ok((bounds.maxX - bounds.minX) * phone.width <= Math.max(120, phone.width * 0.42) + 1e-9, "width is the widest line, not a fixed guess");
  const short = objectBounds({ ...text, text: "MSE" }, phone);
  assert.ok((short.maxX - short.minX) * phone.width < 60, "short text keeps a short hit box, so it can still move near the right edge");

  const placed = placeBlock({ x: 0.5, y: 0.9 }, layout.width, layout.height, phone);
  assert.ok(placed.y * phone.height + layout.height <= phone.height - 8 + 1e-9, "placement keeps the whole block on the page");
});

test("sticky notes grow to fit their text at creation and mark any overflow with an ellipsis (BOARD-STICKY)", () => {
  const text = "Why does L2 shrink weights smoothly while L1 drives some of them exactly to zero?";
  const width = Math.max(130, phone.width * 0.36);
  const height = stickyHeightForText(text, 18, width, phone);
  assert.ok(height > 105, "the card grows beyond the default height");
  const fitted = { tool: "sticky", fontSize: 18, text, points: [{ x: 0.1, y: 0.1 }, { x: 0.1 + width / phone.width, y: 0.1 + height / phone.height }] };
  const card = stickyLayout(fitted, phone);
  assert.equal(card.clipped, false, "a fitted card shows every line");
  assert.equal(card.lines.length, card.totalLines);

  const cramped = { ...fitted, points: [{ x: 0.1, y: 0.1 }] };
  const clipped = stickyLayout(cramped, phone);
  assert.equal(clipped.clipped, true);
  assert.ok(clipped.lines.at(-1).endsWith("…"), "hidden text is signalled on the last visible line");
  assert.ok(approximateMeasure(clipped.lines.at(-1), clipped.font) <= card.width - 28 + 1e-9, "the ellipsis line still fits the card");
});

test("rotated bounds enclose the turned object in authoring pixels", () => {
  const bar = { tool: "rectangle", rotation: Math.PI / 2, points: [{ x: 0.4, y: 0.45 }, { x: 0.6, y: 0.55 }] };
  const size = { width: 1000, height: 1000 };
  const bounds = rotatedBounds(bar, size);
  assert.ok(Math.abs((bounds.maxX - bounds.minX) - 0.1) < 1e-9 && Math.abs((bounds.maxY - bounds.minY) - 0.2) < 1e-9);
});
