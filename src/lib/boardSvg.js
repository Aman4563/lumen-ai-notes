import {
  approximateMeasure,
  boundsCenter,
  GRID_STEP,
  objectBounds,
  STICKY_PADDING_TOP,
  STICKY_PADDING_X,
  stickyLayout,
  textLayout,
} from "./boardGeometry.js";

/**
 * SVG export of one whiteboard page (BOARD-003 slice): a faithful, resolution-
 * independent serialization of the canvas renderer's semantics. The viewBox
 * is the page's authoring size in CSS pixels (issue #55), so stroke widths,
 * font sizes, sticky cards, and the grid keep exactly the proportions the
 * canvas and PNG show; `outputWidth`/`outputHeight` only set the rendered
 * size. Text wraps through the same measured layout as the canvas when the
 * caller passes its `measure` function. The eraser removes ink drawn before
 * it, never the background, so each eraser stroke becomes a mask over the
 * earlier objects — the same result as the canvas ink layer.
 */
const escapeXml = (value) => String(value || "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const SHAPE_TOOLS = new Set(["line", "arrow", "rectangle", "ellipse"]);
const FONT_FAMILY_ATTRIBUTE = "-apple-system, BlinkMacSystemFont, sans-serif";

const polylinePoints = (points, width, height) => points
  .map((point) => `${(point.x * width).toFixed(1)},${(point.y * height).toFixed(1)}`)
  .join(" ");

const strokePoints = (object) => object.points.length === 1
  ? [...object.points, { x: object.points[0].x + 0.0001, y: object.points[0].y + 0.0001 }]
  : object.points;

const textElement = ({ lines, x, y, fontSize, lineHeight, weight, color }) => {
  const spans = lines.map((line, index) => `<tspan x="${x.toFixed(1)}" dy="${index === 0 ? fontSize : lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT_FAMILY_ATTRIBUTE}" font-weight="${weight}" font-size="${fontSize}" fill="${escapeXml(color)}">${spans}</text>`;
};

const objectToSvg = (object, size, measure) => {
  if (!object.points?.length) return "";
  const { width, height } = size;
  const start = object.points[0];
  const end = object.points.at(-1);
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  const opacity = object.tool === "marker" ? 0.26 : 1;
  const strokeAttributes = `stroke="${escapeXml(object.color)}" stroke-width="${object.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"${opacity < 1 ? ` opacity="${opacity}"` : ""}`;

  if (object.tool === "text") {
    const layout = textLayout(object, size, measure);
    // The canvas draws with a top baseline; the first tspan's dy of one font
    // size approximates that for the alphabetic SVG baseline.
    return textElement({ lines: layout.lines, x: layout.x, y: layout.y, fontSize: object.fontSize || 24, lineHeight: layout.lineHeight, weight: 700, color: object.color });
  }

  if (object.tool === "sticky") {
    const card = stickyLayout(object, size, measure);
    const text = textElement({ lines: card.lines, x: card.x + STICKY_PADDING_X, y: card.y + STICKY_PADDING_TOP, fontSize: object.fontSize || 18, lineHeight: card.lineHeight, weight: 650, color: object.color || "#17283e" });
    return `<g><rect x="${card.x.toFixed(1)}" y="${card.y.toFixed(1)}" width="${card.width.toFixed(1)}" height="${card.height.toFixed(1)}" rx="12" fill="${escapeXml(object.fill || "#fff1a8")}" stroke="rgba(70,55,18,.2)" stroke-width="1.5"/>${text}</g>`;
  }

  if (SHAPE_TOOLS.has(object.tool) && object.points.length >= 2) {
    if (object.tool === "rectangle") {
      return `<rect x="${Math.min(startX, endX).toFixed(1)}" y="${Math.min(startY, endY).toFixed(1)}" width="${Math.abs(endX - startX).toFixed(1)}" height="${Math.abs(endY - startY).toFixed(1)}" ${strokeAttributes}/>`;
    }
    if (object.tool === "ellipse") {
      return `<ellipse cx="${((startX + endX) / 2).toFixed(1)}" cy="${((startY + endY) / 2).toFixed(1)}" rx="${(Math.abs(endX - startX) / 2).toFixed(1)}" ry="${(Math.abs(endY - startY) / 2).toFixed(1)}" ${strokeAttributes}/>`;
    }
    let path = `M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    if (object.tool === "arrow") {
      const angle = Math.atan2(endY - startY, endX - startX);
      const head = Math.max(12, object.width * 4);
      for (const side of [-1, 1]) {
        path += ` M ${endX.toFixed(1)} ${endY.toFixed(1)} L ${(endX - head * Math.cos(angle + side * Math.PI / 6)).toFixed(1)} ${(endY - head * Math.sin(angle + side * Math.PI / 6)).toFixed(1)}`;
      }
    }
    return `<path d="${path}" ${strokeAttributes}/>`;
  }

  return `<polyline points="${polylinePoints(strokePoints(object), width, height)}" ${strokeAttributes}/>`;
};

const backgroundPattern = (pattern) => {
  // Offsetting the tile by half a step puts lines/dots on multiples of the
  // 24px grid, exactly where the canvas renderer draws them.
  const half = GRID_STEP / 2;
  if (pattern === "grid") {
    return `<pattern id="board-background" x="${half}" y="${half}" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><path d="M ${half} 0 V ${GRID_STEP} M 0 ${half} H ${GRID_STEP}" stroke="rgba(20,34,52,.075)" stroke-width="1" fill="none"/></pattern>`;
  }
  if (pattern === "dots") {
    return `<pattern id="board-background" x="${half}" y="${half}" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle cx="${half}" cy="${half}" r="1.15" fill="rgba(20,34,52,.13)"/></pattern>`;
  }
  return "";
};

/**
 * `width`/`height` are the page's authoring size (the viewBox). The optional
 * `outputWidth`/`outputHeight` set the SVG's rendered size and default to it.
 */
export const boardPageToSvg = (page, {
  width = 1600,
  height = 1000,
  outputWidth = width,
  outputHeight = height,
  background = "#ffffff",
  pattern = "plain",
  measure = approximateMeasure,
} = {}) => {
  const size = { width, height };
  const masks = [];
  let ink = "";
  for (const object of page?.objects || []) {
    if (object.tool === "eraser") {
      if (!object.points?.length || !ink) continue;
      const id = `board-erase-${masks.length + 1}`;
      masks.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/><polyline points="${polylinePoints(strokePoints(object), width, height)}" stroke="#000" stroke-width="${object.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask>`);
      ink = `<g mask="url(#${id})">${ink}</g>`;
      continue;
    }
    let markup = objectToSvg(object, size, measure);
    if (!markup) continue;
    if (object.rotation) {
      // Rotation matches the canvas renderer: about the bounds center, in the
      // authoring-pixel space of the viewBox.
      const center = boundsCenter(objectBounds(object, size, measure));
      const degrees = ((object.rotation * 180) / Math.PI).toFixed(2);
      markup = `<g transform="rotate(${degrees} ${(center.x * width).toFixed(1)} ${(center.y * height).toFixed(1)})">${markup}</g>`;
    }
    ink += `\n${markup}`;
  }
  const patternMarkup = backgroundPattern(pattern);
  const defs = patternMarkup || masks.length ? `<defs>${patternMarkup}${masks.join("")}</defs>\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${outputWidth}" height="${outputHeight}">
${defs}<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>
${patternMarkup ? `<rect width="${width}" height="${height}" fill="url(#board-background)"/>\n` : ""}${ink.trim()}
</svg>
`;
};
