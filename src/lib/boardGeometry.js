/**
 * Whiteboard page geometry (issue #55).
 *
 * Points are stored as fractions of a page. A page may carry a sparse
 * `size` — the CSS-pixel canvas it was authored on — and is then drawn with
 * one uniform scale, letterboxed into whatever canvas shows it, so a circle
 * drawn on a phone stays a circle on a Mac. Fonts, stroke widths, sticky
 * minimums, the 24px grid, and rotation all live in those authoring pixels.
 * A legacy page without `size` is drawn in the live canvas box exactly as
 * before; the editor adopts that box as its size when it first shows or
 * edits the page, so nothing in the stored points ever has to be rewritten.
 */
export const PAGE_SIZE_MIN = 100;
export const PAGE_SIZE_MAX = 8_000;
export const GRID_STEP = 24;
export const PAGE_FILL = "#fbf8f1";
export const TEXT_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, sans-serif";
export const STICKY_PADDING_X = 14;
export const STICKY_PADDING_TOP = 15;
export const STICKY_PADDING_BOTTOM = 13;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Validates a stored page size; returns null for legacy or malformed values. */
export const normalizePageSize = (value) => {
  if (!value || typeof value !== "object") return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const bounded = (dimension) => Math.round(Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, dimension)));
  return { width: bounded(width), height: bounded(height) };
};

/**
 * The page's authoring size, or — for a legacy page — the live canvas box,
 * rounded exactly as it will be when the page adopts it, so geometry never
 * shifts at the moment of adoption.
 */
export const pageSizeOf = (page, canvas) => normalizePageSize(page?.size) || {
  width: Math.max(1, Math.round(Number(canvas?.width) || 1)),
  height: Math.max(1, Math.round(Number(canvas?.height) || 1)),
};

/** Uniform "contain" fit of a page into a canvas box, centered. */
export const fitPage = (canvas, size) => {
  const canvasWidth = Math.max(1, Number(canvas?.width) || 1);
  const canvasHeight = Math.max(1, Number(canvas?.height) || 1);
  const scale = Math.min(canvasWidth / size.width, canvasHeight / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return { scale, width, height, left: (canvasWidth - width) / 2, top: (canvasHeight - height) / 2 };
};

export const textFont = (object) => `${object.tool === "sticky" ? 650 : 700} ${object.fontSize || 24}px ${TEXT_FONT_FAMILY}`;

/** Deterministic width estimate for environments without a canvas (tests, workers). */
export const approximateMeasure = (text, font) => {
  const fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]) || 24;
  return String(text || "").length * fontSize * 0.56;
};

const layoutCaches = new WeakMap();
const cachedLines = (measure, key, compute) => {
  let cache = layoutCaches.get(measure);
  if (!cache) {
    cache = new Map();
    layoutCaches.set(measure, cache);
  }
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  if (cache.size >= 600) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
};

/** Greedy word wrap shared by the canvas renderer, hit-testing, and SVG export. */
export const wrapTextLines = (text, maximumWidth, font, measure = approximateMeasure) => cachedLines(measure, `${font}\u0000${Math.round(maximumWidth)}\u0000${text}`, () => {
  const lines = [];
  String(text || "").split("\n").forEach((paragraph) => {
    let line = "";
    paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
      const candidate = `${line} ${word}`.trim();
      if (line && measure(candidate, font) > maximumWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    else if (!paragraph) lines.push("");
  });
  return lines.map((line) => ({ text: line, width: measure(line, font) }));
});

/** Wrap width of a text object, in authoring pixels. */
export const textWrapWidth = (size) => Math.max(120, size.width * 0.42);

/** Wrapped text block of a text object, in authoring pixels. */
export const textLayout = (object, size, measure = approximateMeasure) => {
  const font = textFont(object);
  const lineHeight = (object.fontSize || 24) * 1.25;
  const lines = wrapTextLines(object.text, textWrapWidth(size), font, measure);
  const width = Math.max((object.fontSize || 24) * 0.6, ...lines.map((line) => line.width));
  return {
    x: object.points[0].x * size.width,
    y: object.points[0].y * size.height,
    font,
    lineHeight,
    lines: lines.map((line) => line.text),
    width,
    height: Math.max(1, lines.length) * lineHeight,
  };
};

const truncateToWidth = (line, maximumWidth, font, measure) => {
  let candidate = line.trimEnd();
  while (candidate && measure(`${candidate}…`, font) > maximumWidth) candidate = candidate.slice(0, -1).trimEnd();
  return `${candidate}…`;
};

/** Sticky-note card and its visible lines, in authoring pixels. */
export const stickyLayout = (object, size, measure = approximateMeasure) => {
  const start = object.points[0];
  const end = object.points.at(-1);
  const x = start.x * size.width;
  const y = start.y * size.height;
  const width = Math.max(130, (end.x - start.x) * size.width || size.width * 0.36);
  const height = Math.max(105, (end.y - start.y) * size.height || size.height * 0.22);
  const font = textFont(object);
  const lineHeight = (object.fontSize || 18) * 1.3;
  const innerWidth = width - STICKY_PADDING_X * 2;
  const wrapped = wrapTextLines(object.text, innerWidth, font, measure).map((line) => line.text);
  const maximumLines = Math.max(1, Math.floor((height - STICKY_PADDING_TOP - STICKY_PADDING_BOTTOM) / lineHeight + 0.02));
  const clipped = wrapped.length > maximumLines;
  const lines = wrapped.slice(0, maximumLines);
  if (clipped) lines[lines.length - 1] = truncateToWidth(lines.at(-1), innerWidth, font, measure);
  return { x, y, width, height, font, lineHeight, lines, clipped, totalLines: wrapped.length };
};

/** Card height that shows every wrapped line of a sticky, within a cap. */
export const stickyHeightForText = (text, fontSize, cardWidth, size, measure = approximateMeasure) => {
  const font = textFont({ tool: "sticky", fontSize });
  const lines = wrapTextLines(text, cardWidth - STICKY_PADDING_X * 2, font, measure).length;
  const needed = STICKY_PADDING_TOP + lines * fontSize * 1.3 + STICKY_PADDING_BOTTOM + 2;
  const minimum = Math.max(105, size.height * 0.22);
  return Math.min(Math.max(minimum, needed), Math.max(minimum, size.height * 0.6));
};

/** Unrotated bounds of an object as page fractions (may exceed [0,1] for text). */
export const objectBounds = (object, size, measure = approximateMeasure) => {
  if (object.tool === "text") {
    const layout = textLayout(object, size, measure);
    const minX = object.points[0].x;
    const minY = object.points[0].y;
    return { minX, minY, maxX: minX + layout.width / size.width, maxY: minY + layout.height / size.height };
  }
  if (object.tool === "sticky") {
    const card = stickyLayout(object, size, measure);
    return { minX: card.x / size.width, minY: card.y / size.height, maxX: (card.x + card.width) / size.width, maxY: (card.y + card.height) / size.height };
  }
  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

export const boundsCenter = (bounds) => ({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });

/** Rotation runs in authoring pixels about the bounds center (BOARD-001). */
export const rotatePoint = (point, center, angle, size) => {
  if (!angle) return point;
  const px = (point.x - center.x) * size.width;
  const py = (point.y - center.y) * size.height;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: center.x + (px * cos - py * sin) / size.width, y: center.y + (px * sin + py * cos) / size.height };
};

/** Axis-aligned bounds of a possibly rotated object, as page fractions. */
export const rotatedBounds = (object, size, measure = approximateMeasure) => {
  const bounds = objectBounds(object, size, measure);
  if (!object.rotation) return bounds;
  const center = boundsCenter(bounds);
  const corners = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]
    .map(([x, y]) => rotatePoint({ x, y }, center, object.rotation, size));
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
};

export const unionBounds = (list) => list.reduce((union, bounds) => union
  ? { minX: Math.min(union.minX, bounds.minX), minY: Math.min(union.minY, bounds.minY), maxX: Math.max(union.maxX, bounds.maxX), maxY: Math.max(union.maxY, bounds.maxY) }
  : { ...bounds }, null);

/**
 * The extent a translation must keep on the page: the rendered (rotated)
 * footprint and the stored, unrotated points. Stored points are clamped to
 * the page, so a rotated object whose footprint still fits could otherwise
 * be pushed until its raw points clamp and it squashes (BOARD-5).
 */
export const translationBounds = (object, size, measure = approximateMeasure) => object.rotation
  ? unionBounds([objectBounds(object, size, measure), rotatedBounds(object, size, measure)])
  : objectBounds(object, size, measure);

/**
 * Limits a translation so the moving group stays on the page (BOARD-5):
 * the whole group moves by one clamped delta, never point by point, so an
 * edge can stop a move but can never squash an object. A group that already
 * overhangs an edge may still move back inward.
 */
export const clampTranslation = (bounds, deltaX, deltaY) => {
  if (!bounds) return { x: deltaX, y: deltaY };
  const lowerX = Math.min(0, -bounds.minX);
  const upperX = Math.max(0, 1 - bounds.maxX);
  const lowerY = Math.min(0, -bounds.minY);
  const upperY = Math.max(0, 1 - bounds.maxY);
  return { x: Math.max(lowerX, Math.min(upperX, deltaX)), y: Math.max(lowerY, Math.min(upperY, deltaY)) };
};

/** Offset for duplicates/pastes: down-right, or up-left when that side has no room. */
export const placementOffset = (bounds, offset) => {
  const axis = (minimum, maximum) => {
    if (maximum + offset <= 1) return offset;
    if (minimum - offset >= 0) return -offset;
    return Math.max(Math.min(0, -minimum), Math.min(Math.max(0, 1 - maximum), offset));
  };
  return bounds ? { x: axis(bounds.minX, bounds.maxX), y: axis(bounds.minY, bounds.maxY) } : { x: offset, y: offset };
};

export const translatePoints = (points, delta) => points.map((point) => ({ ...point, x: clamp01(point.x + delta.x), y: clamp01(point.y + delta.y) }));

/** Keeps a block of the given pixel size inside the page when it is placed. */
export const placeBlock = (point, blockWidth, blockHeight, size, margin = 8) => ({
  x: clamp01(Math.max(0, Math.min(point.x, (size.width - margin - blockWidth) / size.width))),
  y: clamp01(Math.max(0, Math.min(point.y, (size.height - margin - blockHeight) / size.height))),
});
