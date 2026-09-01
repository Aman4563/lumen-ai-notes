const HIGHLIGHT_NAMES = ["lumen-gold", "lumen-coral", "lumen-teal", "lumen-violet"];

const isReadableTextNode = (node, root) => {
  if (!node?.nodeValue || !node.nodeValue.length || !root.contains(node)) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  return !parent.closest("button, script, style, svg, .diagram-shell, [aria-hidden='true']");
};

export const hashSource = (value) => {
  let hash = 0x811c9dc5;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const buildTextIndex = (root) => {
  if (!root) return { text: "", nodes: [] };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  const chunks = [];
  let length = 0;
  let node = walker.nextNode();
  while (node) {
    if (isReadableTextNode(node, root)) {
      const start = length;
      chunks.push(node.nodeValue);
      length += node.nodeValue.length;
      nodes.push({ node, start, end: length });
    }
    node = walker.nextNode();
  }
  return { text: chunks.join(""), nodes };
};

const boundaryOffset = (index, container, offset, preferEnd = false) => {
  if (container.nodeType === Node.TEXT_NODE) {
    const match = index.nodes.find((entry) => entry.node === container);
    if (match) return Math.max(match.start, Math.min(match.end, match.start + offset));
  }

  const boundary = document.createRange();
  try {
    boundary.setStart(container, offset);
  } catch {
    return preferEnd ? index.text.length : 0;
  }
  const candidates = index.nodes.filter(({ node }) => {
    try {
      return preferEnd
        ? boundary.comparePoint(node, node.nodeValue.length) <= 0
        : boundary.comparePoint(node, 0) >= 0;
    } catch {
      return false;
    }
  });
  if (!candidates.length) return preferEnd ? index.text.length : 0;
  return preferEnd ? candidates.at(-1).end : candidates[0].start;
};

const closestHeadingId = (root, range) => {
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const containing = element?.closest("section, article, div")?.querySelector?.(":scope > h1[id], :scope > h2[id], :scope > h3[id], :scope > h4[id]");
  if (containing?.id) return containing.id;
  const headings = [...root.querySelectorAll("h1[id], h2[id], h3[id], h4[id]")];
  let previous = "";
  for (const heading of headings) {
    const relation = range.comparePoint(heading, 0);
    if (relation > 0) break;
    previous = heading.id;
  }
  return previous;
};

export const captureTextAnchor = (root, range, source = "") => {
  if (!root || !range || range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const index = buildTextIndex(root);
  let start = boundaryOffset(index, range.startContainer, range.startOffset);
  let end = boundaryOffset(index, range.endContainer, range.endOffset, true);
  if (end < start) [start, end] = [end, start];
  let quote = index.text.slice(start, end);

  // Element-boundary selections and excluded UI text can make the direct
  // offsets imperfect. The exact selected text provides a stable correction.
  const selected = range.toString();
  if (selected && quote !== selected) {
    const candidates = [];
    let found = index.text.indexOf(selected);
    while (found !== -1) {
      candidates.push(found);
      found = index.text.indexOf(selected, found + 1);
    }
    if (candidates.length) {
      const nearest = candidates.sort((left, right) => Math.abs(left - start) - Math.abs(right - start))[0];
      start = nearest;
      end = nearest + selected.length;
      quote = selected;
    }
  }

  if (!quote.trim()) return null;
  return {
    quote: quote.slice(0, 4_000),
    prefix: index.text.slice(Math.max(0, start - 120), start),
    suffix: index.text.slice(end, end + 120),
    start,
    end,
    headingId: closestHeadingId(root, range),
    sourceHash: hashSource(source),
  };
};

const contextScore = (text, position, anchor) => {
  const before = text.slice(Math.max(0, position - anchor.prefix.length), position);
  const after = text.slice(position + anchor.quote.length, position + anchor.quote.length + anchor.suffix.length);
  let score = 0;
  for (let index = 1; index <= Math.min(before.length, anchor.prefix.length); index += 1) {
    if (before.at(-index) !== anchor.prefix.at(-index)) break;
    score += 2;
  }
  for (let index = 0; index < Math.min(after.length, anchor.suffix.length); index += 1) {
    if (after[index] !== anchor.suffix[index]) break;
    score += 2;
  }
  score -= Math.min(50, Math.abs(position - (Number(anchor.start) || 0)) / 100);
  return score;
};

const rangeAtOffsets = (index, start, end) => {
  // Text nodes are contiguous in the flattened index. At a boundary the
  // start belongs to the preceding node and the end belongs to the following
  // node, matching the prior Array.find/reverse-find behavior exactly.
  let low = 0;
  let high = index.nodes.length - 1;
  let startEntry = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = index.nodes[middle];
    if (entry.end >= start) {
      startEntry = entry;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  low = 0;
  high = index.nodes.length - 1;
  let endEntry = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = index.nodes[middle];
    if (entry.start <= end) {
      endEntry = entry;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (startEntry && (start < startEntry.start || start > startEntry.end)) startEntry = null;
  if (endEntry && (end < endEntry.start || end > endEntry.end)) endEntry = null;
  if (!startEntry || !endEntry) return null;
  const range = document.createRange();
  try {
    range.setStart(startEntry.node, Math.max(0, Math.min(startEntry.node.nodeValue.length, start - startEntry.start)));
    range.setEnd(endEntry.node, Math.max(0, Math.min(endEntry.node.nodeValue.length, end - endEntry.start)));
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
};

const resolveTextAnchorFromIndex = (index, anchor) => {
  if (!anchor?.quote) return { status: "orphaned", range: null, reason: "missing-anchor" };
  const expectedStart = Math.max(0, Number(anchor.start) || 0);
  const expectedEnd = expectedStart + anchor.quote.length;
  if (index.text.slice(expectedStart, expectedEnd) === anchor.quote) {
    return { status: "exact", range: rangeAtOffsets(index, expectedStart, expectedEnd), start: expectedStart, end: expectedEnd };
  }

  const positions = [];
  let position = index.text.indexOf(anchor.quote);
  while (position !== -1 && positions.length < 200) {
    positions.push(position);
    position = index.text.indexOf(anchor.quote, position + 1);
  }
  if (!positions.length) return { status: "orphaned", range: null, reason: "quote-not-found" };
  positions.sort((left, right) => contextScore(index.text, right, anchor) - contextScore(index.text, left, anchor));
  const relocated = positions[0];
  const relocatedEnd = relocated + anchor.quote.length;
  return {
    status: "relocated",
    range: rangeAtOffsets(index, relocated, relocatedEnd),
    start: relocated,
    end: relocatedEnd,
    // Refreshed context lets a reconcile write-back keep future relocation
    // scoring anchored to the new surroundings, not the pre-edit ones.
    prefix: index.text.slice(Math.max(0, relocated - 120), relocated),
    suffix: index.text.slice(relocatedEnd, relocatedEnd + 120),
  };
};

export const resolveTextAnchor = (root, anchor) => {
  if (!root || !anchor?.quote) return { status: "orphaned", range: null, reason: "missing-anchor" };
  return resolveTextAnchorFromIndex(buildTextIndex(root), anchor);
};

export const applyAnnotationHighlights = (root, annotations) => {
  const resolved = new Map();
  const byColor = new Map(HIGHLIGHT_NAMES.map((name) => [name, []]));
  // A rendered document has one flattened text coordinate system. Reusing it
  // for the complete pass avoids rebuilding and walking the same DOM once per
  // annotation (up to the persisted 5,000-annotation limit).
  const index = buildTextIndex(root);
  (Array.isArray(annotations) ? annotations : []).forEach((annotation) => {
    const result = root && annotation?.quote
      ? resolveTextAnchorFromIndex(index, annotation)
      : { status: "orphaned", range: null, reason: "missing-anchor" };
    resolved.set(annotation.id, result);
    if (result.range) byColor.get(`lumen-${annotation.color}`)?.push(result.range);
  });

  if (globalThis.CSS?.highlights && globalThis.Highlight) {
    HIGHLIGHT_NAMES.forEach((name) => CSS.highlights.delete(name));
    byColor.forEach((ranges, name) => {
      if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    });
  }
  return {
    resolved,
    supported: Boolean(globalThis.CSS?.highlights && globalThis.Highlight),
    clear: () => HIGHLIGHT_NAMES.forEach((name) => globalThis.CSS?.highlights?.delete(name)),
  };
};
