import { verbalizeMath } from "./mathSpeech.js";
import { endSentence, sliceMap, stripSpeechMarks } from "./speech.js";
import { collapseWithOffsets, createSpokenBuilder } from "./spokenMap.js";
import { diagramDescriptionFor } from "./mermaidDiagrams.js";

/**
 * What the atomic blocks of a lecture say (issue #100): a table row, a block of
 * code, a Mermaid diagram and a display formula. Each verbalizer is called by
 * speechContent.js as `(block, blockIndex, context)` and returns that block's
 * units, `{ text, unit: { blockIndex, start, end }, map, kind? }` without a
 * section. `context` is `{ code, tables, inline, memo }`: the learner's two
 * settings, the reader of a table cell's inline content (it is the text
 * blocks' own walker, so a cell says its code, scripts and formulas as a
 * paragraph does) and a per-build store for what a table works out once.
 *
 * Offsets follow speechContent.js: `unit.start/end` and every map source index
 * `speechBlockText(block)`, the block's textContent with its whitespace
 * collapsed. An announcement (`kind: "announcement"`) says something about its
 * block and reads none of it: it has no range and no map. This file is the
 * Reader chunk's, imported by speechContent.js alone.
 */

const hasText = (value) => /\S/u.test(String(value ?? ""));
const tagOf = (node) => String(node?.localName || node?.tagName || "").toLowerCase();
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// `text` ended as a sentence: with a full stop unless it already ends in
// punctuation, the markers of code and scripts not counting as text.
const ended = (text) => {
  const plain = stripSpeechMarks(text);
  return endSentence(plain) === plain ? text : `${text}.`;
};

// A sentence about a block that reads none of it.
const announcement = (text, blockIndex) => ({ text, unit: { blockIndex, start: 0, end: 0 }, map: [], kind: "announcement" });

// `value` (a textContent) with its whitespace collapsed, as the block's text
// is: its length, and where an offset into the raw text lands in it.
const collapsing = (value) => {
  const { text, offsets } = collapseWithOffsets(value);
  const last = offsets.length - 1;
  return { length: text.length, toBlock: (raw) => offsets[raw < last ? raw : last] };
};

// ---------------------------------------------------------------------------
// Display math
// ---------------------------------------------------------------------------

/**
 * A display formula is one unit: its words from `verbalizeMath`, a comma at
 * the very end taken off (a displayed formula ends its line with one), and the
 * sentence ended with a full stop that sits where the words end.
 */
export const mathUnits = (math, blockIndex) => {
  const reading = verbalizeMath(math);
  let { text, map } = reading;
  if (text.endsWith(",")) {
    text = text.slice(0, -1);
    map = sliceMap(map, 0, text.length);
  }
  if (!hasText(text)) return [];
  const { length, toBlock } = collapsing(math.textContent);
  const pieces = map.map(({ spoken, source }) => ({ spoken: [...spoken], source: [toBlock(source[0]), toBlock(source[1])] }));
  if (endSentence(text) !== text) {
    const end = pieces.at(-1).source[1];
    pieces.push({ spoken: [text.length, text.length + 1], source: [end, end] });
    text += ".";
  }
  return [{ text, unit: { blockIndex, start: 0, end: length }, map: pieces }];
};

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

/**
 * A diagram is one announcement: "Diagram: " and the description of its
 * definition. A description that starts with the word already ("Diagram", what
 * a definition of an unknown kind is described as) is the whole sentence, and
 * a diagram with no description at all is "Diagram.".
 */
export const diagramUnits = (shell, blockIndex) => {
  const description = String(diagramDescriptionFor(shell) ?? "").trim();
  if (!description) return [announcement("Diagram.", blockIndex)];
  return [announcement(endSentence(/^Diagram\b/u.test(description) ? description : `Diagram: ${description}`), blockIndex)];
};

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

const BOX_DRAWING = /[\u2500-\u257F]/u;

const LANGUAGES = new Map([
  ["python", "Python"], ["py", "Python"],
  ["js", "JavaScript"], ["javascript", "JavaScript"], ["jsx", "JavaScript"], ["mjs", "JavaScript"],
  ["ts", "TypeScript"], ["typescript", "TypeScript"], ["tsx", "TypeScript"],
  ["bash", "Shell"], ["sh", "Shell"], ["shell", "Shell"], ["zsh", "Shell"], ["console", "Shell"],
  ["sql", "SQL"], ["json", "JSON"], ["yaml", "YAML"], ["yml", "YAML"], ["html", "HTML"], ["css", "CSS"],
  ["c", "C"], ["cpp", "C++"], ["c++", "C++"], ["go", "Go"], ["rust", "Rust"], ["rs", "Rust"], ["java", "Java"], ["r", "R"],
  ["dockerfile", "Dockerfile"], ["docker", "Dockerfile"], ["toml", "TOML"],
  ["text", "Code"], ["plaintext", "Code"], ["txt", "Code"],
]);

// What a fence is called aloud: the language of its label ("python code"), "Code" when it has none.
const languageName = (pre) => {
  const label = String(pre.getAttribute?.("aria-label") ?? "").trim().toLowerCase().replace(/(?:^|\s)code$/u, "");
  const id = label.split(/[\s,{]/u, 1)[0];
  if (!id) return "Code";
  const known = LANGUAGES.get(id);
  if (known) return known;
  // Any other id: capitals up to three letters (INI, XML), else capitalised (Haskell).
  const letters = [...id];
  return letters.length <= 3 ? id.toUpperCase() : letters[0].toUpperCase() + letters.slice(1).join("");
};

// The lines of the code text, without the line feeds that end it.
const linesOf = (raw) => {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === "\n") end -= 1;
  return raw.slice(0, end).split("\n");
};

// One unit per line that has words, with the line's whitespace collapsed. A
// line owns the stretch of the block from its first word to the first word of
// the next line, so the units tile the block: the indentation and the blank
// lines belong to the line before, the first starts at 0 and the last ends at
// the end of the block.
const codeLines = (raw, lines, blockIndex) => {
  const { length, toBlock } = collapsing(raw);
  const found = [];
  let at = 0;
  for (const line of lines) {
    if (hasText(line)) {
      const builder = createSpokenBuilder();
      builder.append(line, at, at + line.length);
      const { text, map } = builder.build();
      found.push({
        text,
        first: toBlock(at + line.search(/\S/u)),
        map: map.map(({ spoken, source }) => ({ spoken, source: [toBlock(source[0]), toBlock(source[1])] })),
      });
    }
    at += line.length + 1;
  }
  return found.map((line, index) => ({
    text: line.text,
    unit: { blockIndex, start: index ? line.first : 0, end: index + 1 < found.length ? found[index + 1].first : length },
    map: line.map,
    kind: "code",
  }));
};

/**
 * A block of code is announced ("Python example, 6 lines."), skipped or read,
 * as the learner chose (`code`: "announce", the default, "skip" or "read"). A
 * block with a box-drawing character is a text diagram and is announced
 * ("Text diagram, 3 lines.") in every mode: read line by line it is noise.
 * Read aloud, each line is a unit of kind "code" (said as written, with
 * pronunciations and no math) after the announcement.
 */
export const codeUnits = (pre, blockIndex, { code }) => {
  const raw = String(pre.textContent ?? "");
  const lines = linesOf(raw);
  const count = plural(lines.length, "line");
  if (BOX_DRAWING.test(raw)) return [announcement(`Text diagram, ${count}.`, blockIndex)];
  if (code === "skip") return [];
  const units = [announcement(`${languageName(pre)} example, ${count}.`, blockIndex)];
  if (code === "read") units.push(...codeLines(raw, lines, blockIndex));
  return units;
};

// ---------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------

const CELLS = new Set(["td", "th"]);
const cellsOf = (row) => Array.from(row.childNodes || []).filter((node) => node.nodeType === 1 && CELLS.has(tagOf(node)));

// What a table says about its rows, worked out once for all of them (a table
// of a thousand rows asks for it a thousand times): its most cells in a row,
// its header row (the first row, when every cell of it is a th) and the
// header's labels, its rows that have words and the number of each of them
// among the rows that are not the header, and the first row that has words,
// which says the table's announcement.
const tableInfo = (row, { inline, memo = new WeakMap() }) => {
  const table = row.closest?.("table") ?? null;
  const key = table ?? row;
  if (memo.has(key)) return memo.get(key);
  // The rows of a table nested in one of its cells belong to that table.
  const rows = table ? Array.from(table.querySelectorAll("tr")).filter((item) => item.closest("table") === table) : [row];
  let columns = 0;
  for (const item of rows) columns = Math.max(columns, cellsOf(item).length);
  const firstCells = rows.length ? cellsOf(rows[0]) : [];
  const header = firstCells.length && firstCells.every((cell) => tagOf(cell) === "th") ? rows[0] : null;
  const labels = header ? firstCells.map((cell) => inline(cell, 0, (raw) => raw)?.text ?? "") : [];
  const spoken = rows.filter((item) => hasText(item.textContent));
  const ranks = new Map();
  for (const item of spoken) if (item !== header) ranks.set(item, ranks.size + 1);
  const info = { columns, header, labels, rows: ranks.size, ranks, first: spoken[0] ?? null };
  memo.set(key, info);
  return info;
};

// "Table, 3 columns: Situation, First inspect, Safe action." The header's
// empty labels are left out; the rows are counted only when they are not read.
const tableAnnouncement = (info, tables) => {
  const shape = `Table, ${plural(info.columns, "column")}${tables === "announce" ? `, ${plural(info.rows, "row")}` : ""}`;
  const names = info.labels.filter(Boolean);
  return ended(names.length ? `${shape}: ${names.join(", ")}` : shape);
};

// "Row 1. Situation: Disk full; First inspect: df -h; Safe action: Free space."
// The words of each cell that has any, under the label of its column (none
// when the header has no label there), cells joined by "; ". The label,
// the separators and the full stop are inserted: pieces with an empty source
// range where the thing they introduce starts or ends. The cells' own pieces
// map to the row's text.
const dataRow = (row, blockIndex, rank, info, inline) => {
  const { length, toBlock } = collapsing(row.textContent);
  // Where each cell starts in the row's textContent: every child that has text moves the offset.
  const cells = [];
  let raw = 0;
  for (const node of row.childNodes || []) {
    if (node.nodeType === 3 || node.nodeType === 4) raw += String(node.data ?? node.textContent ?? "").length;
    else if (node.nodeType === 1) {
      if (CELLS.has(tagOf(node))) cells.push({ node, raw, column: cells.length });
      raw += String(node.textContent ?? "").length;
    }
  }
  // A row with no cell element is one cell.
  if (!cells.length) cells.push({ node: row, raw: 0, column: 0 });
  const said = [];
  for (const { node, raw: start, column } of cells) {
    const reading = inline(node, start, toBlock);
    if (reading) said.push({ reading, label: info.labels[column] ?? "" });
  }
  if (!said.length) return null;
  let text = "";
  const map = [];
  const put = (value, source) => {
    map.push({ spoken: [text.length, text.length + value.length], source });
    text += value;
  };
  const startOf = (reading) => reading.map[0].source[0];
  const endOf = (reading) => reading.map.at(-1).source[1];
  put(`Row ${rank}. `, [startOf(said[0].reading), startOf(said[0].reading)]);
  said.forEach(({ reading, label }, at) => {
    if (at) put("; ", [endOf(said[at - 1].reading), endOf(said[at - 1].reading)]);
    if (label) put(`${label}: `, [startOf(reading), startOf(reading)]);
    for (const piece of reading.map) map.push({ spoken: [text.length + piece.spoken[0], text.length + piece.spoken[1]], source: piece.source });
    text += reading.text;
  });
  if (ended(text) !== text) put(".", [endOf(said.at(-1).reading), endOf(said.at(-1).reading)]);
  return { text, unit: { blockIndex, start: 0, end: length }, map, kind: "row" };
};

/**
 * A table row. The table's first row that has words announces the table
 * ("Table, 3 columns: A, B, C." with a header, "Table, 3 columns." without
 * one; with `tables: "announce"` the rows are counted too: "Table, 3 columns,
 * 2 rows: A, B, C."). With `tables: "rows"`, the default, every row but the
 * header is also one unit, "Row k. …", k counting the rows that are not the
 * header.
 */
export const rowUnits = (row, blockIndex, context) => {
  const info = tableInfo(row, context);
  const units = [];
  if (row === info.first) units.push(announcement(tableAnnouncement(info, context.tables), blockIndex));
  if (context.tables !== "announce" && info.ranks.has(row)) {
    const unit = dataRow(row, blockIndex, info.ranks.get(row), info, context.inline);
    if (unit) units.push(unit);
  }
  return units;
};
