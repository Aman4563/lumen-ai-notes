/**
 * SVG export of one whiteboard page (BOARD-003 slice): a faithful, resolution-
 * independent serialization of the canvas renderer's semantics. Eraser
 * strokes use destination-out compositing on canvas, which SVG cannot
 * express portably — they are exported as background-colored strokes, an
 * approximation that matches solid-background boards exactly.
 */
const escapeXml = (value) => String(value || "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const SHAPE_TOOLS = new Set(["line", "arrow", "rectangle", "ellipse"]);

const polylinePoints = (points, width, height) => points
  .map((point) => `${(point.x * width).toFixed(1)},${(point.y * height).toFixed(1)}`)
  .join(" ");

const wrapLines = (text, maxCharacters) => String(text || "").split("\n").flatMap((line) => {
  const words = line.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && (current.length + word.length + 1) > maxCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  lines.push(current);
  return lines;
});

/** Mirror of the canvas renderer's objectBounds, for rotation centers. */
const boundsOf = (object) => {
  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  let minX = Math.min(...xs);
  const maxXRaw = Math.max(...xs);
  let minY = Math.min(...ys);
  const maxYRaw = Math.max(...ys);
  let maxX = maxXRaw;
  let maxY = maxYRaw;
  if (object.tool === "text") {
    maxX = Math.min(1, minX + 0.42);
    maxY = Math.min(1, minY + Math.max(0.07, ((object.text || "").split("\n").length * (object.fontSize || 24)) / 500));
  }
  if (object.tool === "sticky" && object.points.length === 1) {
    maxX = Math.min(1, minX + 0.36);
    maxY = Math.min(1, minY + 0.22);
  }
  return { minX, minY, maxX, maxY };
};

const objectToSvg = (object, width, height, background) => {
  if (!object.points?.length) return "";
  const start = object.points[0];
  const end = object.points.at(-1);
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  const stroke = object.tool === "eraser" ? background : object.color;
  const opacity = object.tool === "marker" ? 0.26 : 1;
  const strokeAttributes = `stroke="${escapeXml(stroke)}" stroke-width="${object.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"${opacity < 1 ? ` opacity="${opacity}"` : ""}`;

  if (object.tool === "text" || object.tool === "sticky") {
    const isSticky = object.tool === "sticky";
    const fontSize = object.fontSize || 24;
    const boxWidth = isSticky ? Math.max(130, (endX - startX) || width * 0.36) : Math.max(120, width * 0.42);
    const lines = wrapLines(object.text, Math.max(8, Math.floor(boxWidth / (fontSize * 0.56))));
    const textX = startX + (isSticky ? 14 : 0);
    const textY = startY + (isSticky ? 15 : 0);
    const spans = lines.map((line, index) => `<tspan x="${textX.toFixed(1)}" dy="${index === 0 ? fontSize : fontSize * (isSticky ? 1.3 : 1.25)}">${escapeXml(line)}</tspan>`).join("");
    const textElement = `<text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="${isSticky ? 650 : 700}" font-size="${fontSize}" fill="${escapeXml(isSticky ? (object.color || "#17283e") : object.color)}">${spans}</text>`;
    if (!isSticky) return textElement;
    const boxHeight = Math.max(105, (endY - startY) || height * 0.22);
    return `<g><rect x="${startX.toFixed(1)}" y="${startY.toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}" rx="12" fill="${escapeXml(object.fill || "#fff1a8")}" stroke="rgba(70,55,18,.2)" stroke-width="1.5"/>${textElement}</g>`;
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

  const points = object.points.length === 1
    ? [...object.points, { x: start.x + 0.0001, y: start.y + 0.0001 }]
    : object.points;
  return `<polyline points="${polylinePoints(points, width, height)}" ${strokeAttributes}/>`;
};

export const boardPageToSvg = (page, { width = 1600, height = 1000, background = "#ffffff" } = {}) => {
  const objects = (page?.objects || []).map((object) => {
    const markup = objectToSvg(object, width, height, background);
    if (!markup || !object.rotation) return markup;
    // Rotation matches the canvas renderer: about the bounds center, in the
    // pixel space of the viewBox.
    const bounds = boundsOf(object);
    const centerX = (((bounds.minX + bounds.maxX) / 2) * width).toFixed(1);
    const centerY = (((bounds.minY + bounds.maxY) / 2) * height).toFixed(1);
    const degrees = ((object.rotation * 180) / Math.PI).toFixed(2);
    return `<g transform="rotate(${degrees} ${centerX} ${centerY})">${markup}</g>`;
  }).filter(Boolean);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>
${objects.join("\n")}
</svg>
`;
};
