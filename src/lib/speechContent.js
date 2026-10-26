import { verbalizeMath } from "./mathSpeech.js";
import {
  SPEECH_MARK,
  SPEECH_SCOPES,
  collapseWithOffsets,
  endSentence,
  sliceMap,
  splitSpeechSentenceRanges,
  splitSpeechSentences,
  stripSpeechMarks,
} from "./speech.js";
import { createSpokenBuilder } from "./spokenMap.js";

/**
 * The rendered lecture as speech units (issue #100). A block is an element the
 * narration reads on its own; a unit is one sentence of a text block, or what
 * an atomic block (a table row, code, a diagram, a formula) says.
 *
 * Every offset in a unit indexes `speechBlockText(block)`, the block's
 * `textContent` with its whitespace collapsed, so the Reader can highlight a
 * sentence (issue #101) without searching for it: `unit.start/end` tile the
 * block's text, and `unit.map` says which characters of it each spoken
 * character came from.
 *
 * This file is the Reader chunk's; no entry module may import it.
 */

// Text blocks are read sentence by sentence. Atomic blocks are read as a whole
// by their own verbalizer, and anything inside one is read by it.
const TEXT_BLOCKS = "h1, h2, h3, h4, p, li, blockquote, figcaption";
const ATOMIC_BLOCKS = "tr, pre, .diagram-shell, math[display=\"block\"]";
const READABLE_SELECTOR = `${TEXT_BLOCKS}, ${ATOMIC_BLOCKS}`;

const cleanText = (value) => String(value || "").replace(/\s+/gu, " ").trim();
const hasText = (value) => /\S/u.test(String(value ?? ""));
const WHITESPACE = /\s/u;

/** The block's text as the narration indexes it: the coordinate space of every `unit.start/end`. */
export const speechBlockText = (block) => cleanText(block?.textContent);

// The tag, however the node was made: a DOM element, or a test double that has
// only a tagName.
const tagOf = (node) => String(node?.localName || node?.tagName || "").toLowerCase();
const hasClass = (node, name) => Boolean(node?.classList?.contains?.(name));

/** Which atomic kind `node` is: "row", "code", "diagram" or "math"; "" for anything else. */
const atomicKind = (node) => {
  if (hasClass(node, "diagram-shell")) return "diagram";
  const tag = tagOf(node);
  if (tag === "tr") return "row";
  if (tag === "pre") return "code";
  if (tag === "math" && node.getAttribute?.("display") === "block") return "math";
  return "";
};

// True when a text block has words of its own: a list item that is only code,
// or a paragraph that is only a formula, has none (its atomic block is read
// as a block of its own). Walks without recursion, skipping atomic subtrees.
const hasTextOutsideAtoms = (block) => {
  if (!block.querySelector?.(ATOMIC_BLOCKS)) return true;
  const stack = [block];
  while (stack.length) {
    const children = stack.pop().childNodes || [];
    for (let at = 0; at < children.length; at += 1) {
      const child = children[at];
      if (child.nodeType === 3 || child.nodeType === 4) {
        if (hasText(child.data ?? child.textContent)) return true;
      } else if (child.nodeType === 1 && !atomicKind(child)) stack.push(child);
    }
  }
  return false;
};

/**
 * The blocks the narration reads, in document order: text blocks (headings,
 * paragraphs, list items, quotes, captions) and atomic blocks (table rows,
 * code, diagrams, display math). `unit.blockIndex` indexes this list.
 *
 * A candidate inside an atomic block is read by it (a diagram's failure
 * diagnostic is screen furniture). A text block inside another is read by the
 * outer one, which breaks a sentence at the inner block's edges; an atomic
 * block inside a text block stays a block of its own. A text block with no
 * words outside its atomic descendants, and any node with no text, are not
 * blocks.
 */
export const readableBlocks = (root) => {
  const blocks = [];
  for (const node of root?.querySelectorAll?.(READABLE_SELECTOR) || []) {
    const parent = node.parentElement;
    if (parent?.closest?.(ATOMIC_BLOCKS)) continue;
    const atomic = atomicKind(node);
    if (!atomic && parent?.closest?.(TEXT_BLOCKS)) continue;
    if (!hasText(node.textContent)) continue;
    if (!atomic && !hasTextOutsideAtoms(node)) continue;
    blocks.push(node);
  }
  return blocks;
};

/** The block `unit.blockIndex` names, or null. */
export const blockAt = (root, index) => (Number.isInteger(index) && index >= 0 ? readableBlocks(root)[index] ?? null : null);

const headingLevel = (node) => Number(/^H([1-4])$/u.exec(node?.tagName || "")?.[1] || 0);
// Sections are built from H1–H3; an H4 is read as part of its section's body.
const sectionLevel = (node) => (headingLevel(node) <= 3 ? headingLevel(node) : 0);

// The reading line: a fixed band near the top of the reading viewport.
const readingLine = (scrollContainer) => {
  const containerRect = scrollContainer?.getBoundingClientRect?.();
  return containerRect
    ? containerRect.top + Math.min(140, Math.max(45, containerRect.height * 0.18))
    : 120;
};

// The index of the block under `target`: the one that contains it, else the
// last one above it, else the nearest below. -1 for no blocks.
const blockIndexAtLine = (blocks, target) => {
  if (!blocks.length) return -1;
  const measured = blocks.map((node, index) => ({ index, rect: node.getBoundingClientRect?.() || { top: 0, bottom: 0 } }));
  const containing = measured.find(({ rect }) => rect.top <= target && rect.bottom >= target);
  if (containing) return containing.index;
  const above = measured.filter(({ rect }) => rect.top <= target).at(-1);
  if (above) return above.index;
  return measured.sort((left, right) => Math.abs(left.rect.top - target) - Math.abs(right.rect.top - target))[0].index;
};

export const currentSpeechBlock = (article, scrollContainer) => {
  const blocks = readableBlocks(article);
  return blocks[blockIndexAtLine(blocks, readingLine(scrollContainer))] ?? null;
};

/**
 * The index, in `splitSpeechSentences(text)`, of the sentence that contains
 * character `offset` of the whitespace-collapsed text.
 */
export const sentenceIndexAt = (text, offset, language = "auto") => {
  const clean = cleanText(text);
  let found = 0;
  let cursor = 0;
  splitSpeechSentences(clean, language).forEach((sentence, index) => {
    const start = clean.indexOf(sentence, cursor);
    if (start < 0) return;
    if (start <= offset) found = index;
    cursor = start + sentence.length;
  });
  return found;
};

// Offset, in the block's collapsed text, of the first character on the line
// the reading line crosses. Measured with Range boxes rather than hit testing,
// so the narration sheet covering the line on a phone does not matter. Null
// without layout (unit fakes).
const offsetAtLine = (block, line) => {
  const doc = block?.ownerDocument;
  if (!doc?.createRange || !doc.createTreeWalker) return null;
  const collapsed = (value) => value.replace(/\s+/gu, " ").trimStart().length;
  const range = doc.createRange();
  // Collapsed white space has an empty box; measure the next visible
  // character instead so the search below stays monotonic.
  const bottomAt = (node, index) => {
    for (let probe = index; probe < node.length; probe += 1) {
      range.setStart(node, probe);
      range.setEnd(node, probe + 1);
      const box = range.getBoundingClientRect();
      if (box.height > 0) return box.bottom;
    }
    return Infinity;
  };
  const walker = doc.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  let before = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    const boxes = [...range.getClientRects()].filter((box) => box.height > 0);
    if (boxes.length && boxes[0].top > line) break;
    if (boxes.some((box) => box.bottom >= line)) {
      let low = 0;
      let high = node.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (bottomAt(node, middle) < line) low = middle + 1;
        else high = middle;
      }
      return collapsed(before + node.data.slice(0, low));
    }
    before += node.data;
  }
  return collapsed(before);
};

// ---------------------------------------------------------------------------
// Text blocks as sentences
// ---------------------------------------------------------------------------

// Markup the walk counts in the offsets and never says: a formula's TeX
// annotation and its hidden parts...
const SILENT_TAGS = new Set(["annotation", "annotation-xml", "mphantom"]);
// ...and screen furniture beside words that are read elsewhere: KaTeX's visible
// copy of a formula it also writes as MathML, and the header of a code block's
// shell (its language and Copy button; the code is a block of its own, and a
// fence under a list item sits inside that item).
const SILENT_CLASSES = ["katex-html", "code-label"];
// Elements whose edges end a sentence whatever their punctuation: a line
// break and the edges of a nested block.
const BREAK_TAGS = new Set(["br", "div", "table", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "p", "li", "blockquote", "figcaption"]);
// Inline elements the text pass reads differently, as its markers.
const MARKS = new Map([
  ["code", [SPEECH_MARK.plainOpen, SPEECH_MARK.plainClose]],
  ["sub", [SPEECH_MARK.subOpen, SPEECH_MARK.subClose]],
  ["sup", [SPEECH_MARK.supOpen, SPEECH_MARK.supClose]],
]);
// They bracket a piece that no sentence may be cut inside (a marker group, a
// formula's words) while a segment is put together, and are gone before the
// sentences are split.
const WHOLE_OPEN = "\uE006";
const WHOLE_CLOSE = "\uE007";

// One stretch of a text block between hard breaks, put together from the walk:
// the spoken text with its whitespace collapsed, and a map whose sources are
// raw offsets into `block.textContent` until `finish` turns them into offsets
// of `speechBlockText`.
const createSegment = () => {
  const builder = createSpokenBuilder();
  let spoken = false;
  return {
    // A text node's data, character for character from `start`.
    text(data, start) {
      builder.append(data, start, start + data.length);
      if (hasText(data)) spoken = true;
    },
    // Words that read the source range [start, end).
    words(value, start, end) {
      builder.append(value, start, end);
      if (hasText(value)) spoken = true;
    },
    // A marker: one character that the source does not have, at `at`.
    mark(character, at) {
      builder.append(character, at, at);
    },
    // null when nothing was said. Otherwise the text without the brackets, the
    // map in `speechBlockText` offsets (`toBlock` turns a raw offset into one)
    // and the stretches that must stay whole, as [start, end) in that text.
    finish(toBlock) {
      if (!spoken) return null;
      const { text, map } = builder.build();
      const pieces = [];
      const parts = [];
      const wholes = [];
      let removed = 0;
      let depth = 0;
      let from = 0;
      for (const piece of map) {
        const [start, end] = piece.spoken;
        const [sourceStart, sourceEnd] = piece.source;
        // A bracket is a piece of its own with no source.
        const bracket = end - start === 1 && sourceStart === sourceEnd ? text[start] : "";
        if (bracket === WHOLE_OPEN || bracket === WHOLE_CLOSE) {
          if (bracket === WHOLE_OPEN) {
            if (depth === 0) from = start - removed;
            depth += 1;
          } else if (depth > 0) {
            depth -= 1;
            if (depth === 0) wholes.push([from, start - removed]);
          }
          removed += 1;
          continue;
        }
        parts.push(text.slice(start, end));
        pieces.push({ spoken: [start - removed, end - removed], source: [toBlock(sourceStart), toBlock(sourceEnd)] });
      }
      if (depth > 0) wholes.push([from, text.length - removed]);
      return { text: parts.join(""), map: pieces, wholes };
    },
  };
};

const MARK_CHARACTERS = new Set(Object.values(SPEECH_MARK));

// True when text[from, to) holds only markers and white space.
const saysNothing = (text, from, to) => {
  for (let at = from; at < to; at += 1) if (!MARK_CHARACTERS.has(text[at]) && !WHITESPACE.test(text[at])) return false;
  return true;
};

// Where each sentence of a segment ends, in order, the last at the end of the
// text. A sentence end the segmenter finds strictly inside a piece that must
// stay whole (a full stop and a capital in inline code or in a formula's
// words) is no end: the sentence goes on past the piece. The exception is an
// end with only closing markers left in the piece: the segmenter starts the
// next sentence at a closing marker (`foo.` and then the marker of its code
// span), so the sentence ends with the piece.
const sentenceEnds = (text, wholes, language) => {
  const ranges = splitSpeechSentenceRanges(text, language);
  const ends = [];
  let whole = 0;
  for (let at = 0; at < ranges.length - 1; at += 1) {
    let { end } = ranges[at];
    while (whole < wholes.length && wholes[whole][1] <= end) whole += 1;
    if (whole < wholes.length && wholes[whole][0] < end) {
      if (!saysNothing(text, end, wholes[whole][1])) continue;
      end = wholes[whole][1];
    }
    if (end > (ends.at(-1) ?? 0) && end < text.length) ends.push(end);
  }
  ends.push(text.length);
  return ends;
};

// A segment's sentences, added to `out` as { text, map, start }: the trimmed
// sentence, a map from it to the block, and where it starts in the block.
// The last one ends as a sentence, with a full stop that has an empty source
// range at the end of its words unless it already ends in punctuation.
const addSentences = (out, { text, map, wholes }, language) => {
  const kept = [];
  let cursor = 0;
  let from = 0;
  for (const end of sentenceEnds(text, wholes, language)) {
    let start = from;
    let stop = end;
    from = end;
    while (start < stop && WHITESPACE.test(text[start])) start += 1;
    while (stop > start && WHITESPACE.test(text[stop - 1])) stop -= 1;
    const sentence = text.slice(start, stop);
    // White space or markers alone say nothing: not a unit.
    if (!hasText(stripSpeechMarks(sentence))) continue;
    // The pieces over this sentence, found by sweeping: the sentences of a
    // segment together cost one pass over its map, not one pass each.
    while (cursor < map.length && map[cursor].spoken[1] <= start) cursor += 1;
    let last = cursor;
    while (last < map.length && map[last].spoken[0] < stop) last += 1;
    const sentenceMap = sliceMap(map.slice(cursor, last), start, stop);
    kept.push({ text: sentence, map: sentenceMap, start: sentenceMap[0].source[0] });
  }
  const closing = kept.at(-1);
  if (closing) {
    const plain = stripSpeechMarks(closing.text);
    if (endSentence(plain) !== plain) {
      const at = closing.map.at(-1).source[1];
      closing.map.push({ spoken: [closing.text.length, closing.text.length + 1], source: [at, at] });
      closing.text += ".";
    }
  }
  for (const sentence of kept) out.push(sentence);
};

const childrenOf = (node) => node.childNodes || [];

// The sentences of one text block, as { text, map, start }, and the length of
// the block's text.
const textSentences = (block, language) => {
  const { text: blockText, offsets } = collapseWithOffsets(block.textContent);
  const lastOffset = offsets.length - 1;
  const toBlock = (raw) => offsets[raw < lastOffset ? raw : lastOffset];
  const sentences = [];
  let segment = createSegment();
  // Offset in `block.textContent`: every text node moves it, the ones that
  // are not spoken included, so the offsets match what the DOM reports.
  let raw = 0;
  // Open marker groups (code, sub, sup): written at the first words inside
  // them, so an empty one leaves nothing, and closed and written again around
  // a hard break so every segment holds balanced markers.
  const groups = [];
  const open = (at) => {
    for (const group of groups) {
      if (group.written) continue;
      segment.mark(WHOLE_OPEN, at);
      segment.mark(group.open, at);
      group.written = true;
    }
  };
  const close = (group) => {
    if (!group.written) return;
    segment.mark(group.close, raw);
    segment.mark(WHOLE_CLOSE, raw);
  };
  const breakSentence = () => {
    for (let at = groups.length - 1; at >= 0; at -= 1) close(groups[at]);
    const done = segment.finish(toBlock);
    segment = createSegment();
    for (const group of groups) group.written = false;
    if (done) addSentences(sentences, done, language);
  };
  const skip = (node) => { raw += String(node.textContent ?? "").length; };
  const speakMath = (node) => {
    const start = raw;
    skip(node);
    const reading = verbalizeMath(node);
    if (!hasText(reading.text)) return;
    open(start);
    segment.mark(WHOLE_OPEN, start);
    if (reading.map.length) {
      for (const piece of reading.map) segment.words(reading.text.slice(piece.spoken[0], piece.spoken[1]), start + piece.source[0], start + piece.source[1]);
    } else segment.words(reading.text, start, raw);
    segment.mark(WHOLE_CLOSE, raw);
  };

  // A test double with no child nodes is one text node holding its textContent.
  const frames = [{ nodes: block.childNodes || [{ nodeType: 3, data: block.textContent }], index: 0, marked: false, breaks: false }];
  while (frames.length) {
    const frame = frames.at(-1);
    if (frame.index >= frame.nodes.length) {
      frames.pop();
      if (frame.marked) close(groups.pop());
      if (frame.breaks) breakSentence();
      continue;
    }
    const node = frame.nodes[frame.index];
    frame.index += 1;
    if (node.nodeType === 3 || node.nodeType === 4) {
      const data = String(node.data ?? node.textContent ?? "");
      if (hasText(data)) open(raw);
      segment.text(data, raw);
      raw += data.length;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = tagOf(node);
    if (atomicKind(node)) {
      // The block is read on its own: say what came before, and none of it.
      breakSentence();
      skip(node);
    } else if (SILENT_TAGS.has(tag) || SILENT_CLASSES.some((name) => hasClass(node, name))) skip(node);
    else if (tag === "math") speakMath(node);
    else if (tag === "br") breakSentence();
    else {
      const mark = MARKS.get(tag);
      const breaks = BREAK_TAGS.has(tag);
      if (breaks) breakSentence();
      if (mark) groups.push({ open: mark[0], close: mark[1], written: false });
      frames.push({ nodes: childrenOf(node), index: 0, marked: Boolean(mark), breaks });
    }
  }
  breakSentence();
  return { sentences, length: blockText.length };
};

// The units of one text block. The sentences tile the block's text: the first
// starts at 0, each starts where the previous one ended, and the last ends at
// the end of the text, so whatever lies between two sentences (the space, a
// hidden copy of a formula, the code inside a list item) belongs to the
// earlier one.
const textUnits = (block, blockIndex, { language }) => {
  const { sentences, length } = textSentences(block, language);
  return sentences.map((sentence, at) => ({
    text: sentence.text,
    unit: {
      blockIndex,
      start: at ? sentence.start : 0,
      end: at + 1 < sentences.length ? sentences[at + 1].start : length,
    },
    map: sentence.map,
  }));
};

// ---------------------------------------------------------------------------
// Atomic blocks
// ---------------------------------------------------------------------------

// An atomic block is a block of its own (it counts in `readableBlocks` and in
// every `blockIndex`) but says nothing yet: Task 3c plugs each kind's
// verbalizer in here. A verbalizer is called with (block, blockIndex,
// { code, tables, language }) and returns that block's units, each
// { text, unit: { blockIndex, start, end }, map, kind } without a section.
const ATOMIC_UNITS = Object.freeze({
  row: () => [], // tr: the table's header announcement and its "Row k." units
  code: () => [], // pre: "Python example, N lines." and, with code "read", its lines
  diagram: () => [], // .diagram-shell: "Diagram: …"
  math: () => [], // math[display="block"]: the formula in words
});

const blockUnits = (block, blockIndex, context) => {
  const kind = atomicKind(block);
  return kind ? ATOMIC_UNITS[kind](block, blockIndex, context) : textUnits(block, blockIndex, context);
};

// ---------------------------------------------------------------------------
// Sections, units and targets
// ---------------------------------------------------------------------------

const sectionLabel = (heading) => speechBlockText(heading).slice(0, 80);

// The label of the section that holds blocks[index]: the nearest H1–H3 at or
// above it; text before the first heading is the Introduction.
const sectionLabelAt = (blocks, index) => {
  for (let at = Math.min(index, blocks.length - 1); at >= 0; at -= 1) if (sectionLevel(blocks[at])) return sectionLabel(blocks[at]);
  return "Introduction";
};

// The units of each block in [from, to), with the section each belongs to, a
// block at a time so that a caller can stop at the one it wants: the sentence
// target never builds the rest of the lecture. The first unit of each section
// is marked.
function* sectionedUnits(blocks, from, context, to = blocks.length) {
  let section = sectionLabelAt(blocks, from);
  let fresh = from === 0;
  for (let index = from; index < to; index += 1) {
    const block = blocks[index];
    if (sectionLevel(block)) {
      section = sectionLabel(block);
      fresh = true;
    }
    const units = [];
    for (const own of blockUnits(block, index, context)) {
      units.push(fresh ? { ...own, section, sectionStart: true } : { ...own, section });
      fresh = false;
    }
    yield { index, units };
  }
}

const speechContext = ({ code = "announce", tables = "rows", language = "auto" } = {}) => ({ code, tables, language });

const unitsOfBlocks = (blocks, context) => {
  const units = [];
  for (const { units: own } of sectionedUnits(blocks, 0, context)) for (const unit of own) units.push(unit);
  return units;
};

/**
 * The speech units of the rendered lecture, in reading order. Each is
 * `{ text, unit: { blockIndex, start, end }, map, section, sectionStart?, kind? }`:
 * `text` is what the text pass starts from (formulas already in words, the
 * markers of code, subscripts and superscripts kept); `unit.blockIndex`
 * indexes `readableBlocks(root)`; `unit.start/end` are offsets in
 * `speechBlockText(block)` and `map` goes from `text` to them (see
 * spokenMap.js). `kind` is absent for a sentence of a text block.
 *
 * Options: `code` ("announce", "skip" or "read") and `tables` ("rows" or
 * "announce") say how atomic blocks are read (Task 3c); `language` is the
 * voice language sentences are split for.
 */
export const buildSpeechUnits = (root, options) => unitsOfBlocks(readableBlocks(root), speechContext(options));

const unitsText = (units) => units.map((unit) => stripSpeechMarks(unit.text)).join(" ");

const sectionsOfUnits = (units) => {
  const sections = [];
  let current = null;
  for (const unit of units) {
    if (!current || unit.sectionStart) {
      current = { label: unit.section, parts: [] };
      sections.push(current);
    }
    current.parts.push(stripSpeechMarks(unit.text));
  }
  return sections.map(({ label, parts }) => ({ label, text: parts.join(" ") }));
};

/**
 * The lecture in narration sections (AUDIO-001 heading skip): per H1–H3, its
 * units' text joined with spaces. Text before the first heading is the
 * Introduction; a lecture with nothing to read has none.
 */
export const buildSpeechSections = (root, options) => sectionsOfUnits(buildSpeechUnits(root, options));

/**
 * The section at the reading line, as the range [start, end) of block
 * indices. It starts at the nearest H1–H3 at or above the line and ends at the
 * next heading whose level is at most max(level, 2): an H2 includes its H3s,
 * an H3 stops at the next H3 or H2, and an H1 reads its introduction up to the
 * first H2. A heading with no body text of its own continues through the next
 * section. Text before the first heading ends at the first heading.
 */
const sectionRange = (blocks, currentIndex) => {
  let start = Math.max(0, currentIndex);
  while (start > 0 && !sectionLevel(blocks[start])) start -= 1;
  const level = sectionLevel(blocks[start]);
  let stopAt = level ? Math.max(level, 2) : 3;
  let hasBody = !level;
  let end = start + 1;
  for (; end < blocks.length; end += 1) {
    const blockLevel = sectionLevel(blocks[end]);
    if (blockLevel && blockLevel <= stopAt) {
      if (hasBody) break;
      stopAt = Math.max(blockLevel, 2);
    } else if (!blockLevel) hasBody = true;
  }
  return [start, end];
};

const sectionUnits = (blocks, currentIndex, context) => {
  const [start, end] = sectionRange(blocks, currentIndex);
  const units = [];
  for (const { units: own } of sectionedUnits(blocks, start, context, end)) for (const unit of own) units.push(unit);
  return units;
};

// The unit of a block that holds `offset`: the units tile the block, so it is
// the last one that starts at or before it (the last one for an offset past
// the end).
const unitAtOffset = (units, offset) => units.findLast((unit) => unit.unit.start <= offset) ?? units[0];

// On a heading the sentence under the line is the first one of the text that
// follows it. A block that says nothing hands over to the next one that does.
// Only the block under the line is measured against the line.
const sentenceUnit = (blocks, currentIndex, line, context) => {
  let at = currentIndex;
  if (headingLevel(blocks[currentIndex])) {
    const next = blocks.findIndex((node, index) => index > currentIndex && !headingLevel(node));
    if (next >= 0) at = next;
  }
  for (const { index, units } of sectionedUnits(blocks, at, context)) {
    if (!units.length) continue;
    if (index !== currentIndex) return units[0];
    const offset = offsetAtLine(blocks[index], line);
    return offset === null ? units[0] : unitAtOffset(units, offset);
  }
  return null;
};

export const buildSpeechTarget = ({
  scope = "document",
  selectedText = "",
  article,
  scrollContainer,
  sourceText = "",
  language = "auto",
  code,
  tables,
} = {}) => {
  const normalizedScope = SPEECH_SCOPES.some((item) => item.id === scope) ? scope : "document";
  if (normalizedScope === "selection") {
    const text = cleanText(selectedText);
    return text
      ? { available: true, scope: normalizedScope, label: "Selection", text }
      : { available: false, scope: normalizedScope, label: "Selection", text: "", reason: "Select text in the lecture first." };
  }
  const context = speechContext({ code, tables, language });
  if (normalizedScope === "sentence" || normalizedScope === "section") {
    const blocks = readableBlocks(article);
    const line = readingLine(scrollContainer);
    const currentIndex = blockIndexAtLine(blocks, line);
    if (normalizedScope === "sentence") {
      const unit = currentIndex < 0 ? null : sentenceUnit(blocks, currentIndex, line, context);
      return unit
        ? { available: true, scope: normalizedScope, label: "Current sentence", text: unitsText([unit]), units: [unit] }
        : { available: false, scope: normalizedScope, label: "Current sentence", text: "", reason: "No readable sentence is visible." };
    }
    const units = currentIndex < 0 ? [] : sectionUnits(blocks, currentIndex, context);
    return units.length
      ? { available: true, scope: normalizedScope, label: "Current section", text: unitsText(units), units }
      : { available: false, scope: normalizedScope, label: "Current section", text: "", reason: "No readable section is visible." };
  }
  const units = unitsOfBlocks(readableBlocks(article), context);
  if (units.length) return { available: true, scope: "document", label: "Full lecture", text: unitsText(units), units, sections: sectionsOfUnits(units) };
  // Nothing in the page makes a unit: speak whatever text it has.
  const text = cleanText(article?.innerText || sourceText);
  return text
    ? { available: true, scope: "document", label: "Full lecture", text, sections: [] }
    : { available: false, scope: "document", label: "Full lecture", text: "", reason: "This lecture has no readable text." };
};
