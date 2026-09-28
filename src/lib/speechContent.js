import { SPEECH_SCOPES, splitSpeechSentences } from "./speech.js";

const READABLE_SELECTOR = "h1, h2, h3, h4, p, li, blockquote, figcaption, td, th, pre";

const cleanText = (value) => String(value || "").replace(/\s+/gu, " ").trim();

// A diagram's failure diagnostic (its message and raw Mermaid source) sits in
// .diagram-shell as <p> and <pre>; it is screen furniture, never narration.
const readableBlocks = (article) => [...(article?.querySelectorAll?.(READABLE_SELECTOR) || [])]
  .filter((node) => !node.parentElement?.closest?.("p, li, blockquote, figcaption, td, th, pre, .diagram-shell"))
  .filter((node) => cleanText(node.textContent));

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

const blockAtLine = (blocks, target) => {
  if (!blocks.length) return null;
  const measured = blocks.map((node) => ({ node, rect: node.getBoundingClientRect?.() || { top: 0, bottom: 0 } }));
  const containing = measured.find(({ rect }) => rect.top <= target && rect.bottom >= target);
  if (containing) return containing.node;
  const above = measured.filter(({ rect }) => rect.top <= target).at(-1);
  if (above) return above.node;
  return measured.sort((left, right) => Math.abs(left.rect.top - target) - Math.abs(right.rect.top - target))[0]?.node || blocks[0];
};

export const currentSpeechBlock = (article, scrollContainer) => blockAtLine(readableBlocks(article), readingLine(scrollContainer));

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

const sentenceTarget = (blocks, currentBlock, line, language) => {
  // On a heading, the sentence under the line is the first one of the text
  // that follows it.
  const block = headingLevel(currentBlock)
    ? blocks.slice(blocks.indexOf(currentBlock) + 1).find((node) => !headingLevel(node)) || currentBlock
    : currentBlock;
  const text = cleanText(block?.textContent);
  const sentences = splitSpeechSentences(text, language);
  const offset = block === currentBlock ? offsetAtLine(block, line) : null;
  return sentences[offset === null ? 0 : sentenceIndexAt(text, offset, language)] || "";
};

/**
 * The section at the reading line. It starts at the nearest H1–H3 at or above
 * the line and ends at the next heading whose level is at most max(level, 2):
 * an H2 includes its H3s, an H3 stops at the next H3 or H2, and an H1 reads
 * its introduction up to the first H2. A heading with no body text of its own
 * continues through the next section. Text before the first heading ends at
 * the first heading.
 */
const sectionText = (blocks, currentBlock) => {
  if (!blocks.length) return "";
  let start = Math.max(0, blocks.indexOf(currentBlock));
  while (start > 0 && !sectionLevel(blocks[start])) start -= 1;
  const level = sectionLevel(blocks[start]);
  let stopAt = level ? Math.max(level, 2) : 3;
  let hasBody = !level;
  const parts = [cleanText(blocks[start].textContent)];
  for (let cursor = start + 1; cursor < blocks.length; cursor += 1) {
    const block = blocks[cursor];
    const blockLevel = sectionLevel(block);
    if (blockLevel && blockLevel <= stopAt) {
      if (hasBody) break;
      stopAt = Math.max(blockLevel, 2);
    } else if (!blockLevel) hasBody = true;
    parts.push(cleanText(block.textContent));
  }
  return cleanText(parts.join(" "));
};

/**
 * Splits the rendered article into narration sections at H1–H3 boundaries
 * (AUDIO-001 heading skip). Falls back to one section for heading-free text.
 */
export const buildSpeechSections = (article) => {
  const blocks = readableBlocks(article);
  if (!blocks.length) return [];
  const sections = [];
  let current = null;
  for (const block of blocks) {
    const text = cleanText(block.textContent);
    if (/^H[1-3]$/u.test(block.tagName) || !current) {
      current = { label: /^H[1-3]$/u.test(block.tagName) ? text.slice(0, 80) : "Introduction", parts: [] };
      sections.push(current);
    }
    current.parts.push(text);
  }
  return sections
    .map((section) => ({ label: section.label, text: cleanText(section.parts.join(" ")) }))
    .filter((section) => section.text);
};

export const buildSpeechTarget = ({
  scope = "document",
  selectedText = "",
  article,
  scrollContainer,
  sourceText = "",
  language = "auto",
} = {}) => {
  const normalizedScope = SPEECH_SCOPES.some((item) => item.id === scope) ? scope : "document";
  if (normalizedScope === "selection") {
    const text = cleanText(selectedText);
    return text
      ? { available: true, scope: normalizedScope, label: "Selection", text }
      : { available: false, scope: normalizedScope, label: "Selection", text: "", reason: "Select text in the lecture first." };
  }
  if (normalizedScope === "sentence" || normalizedScope === "section") {
    const blocks = readableBlocks(article);
    const line = readingLine(scrollContainer);
    const currentBlock = blockAtLine(blocks, line);
    if (normalizedScope === "sentence") {
      const sentence = sentenceTarget(blocks, currentBlock, line, language);
      return sentence
        ? { available: true, scope: normalizedScope, label: "Current sentence", text: sentence }
        : { available: false, scope: normalizedScope, label: "Current sentence", text: "", reason: "No readable sentence is visible." };
    }
    const text = sectionText(blocks, currentBlock);
    return text
      ? { available: true, scope: normalizedScope, label: "Current section", text }
      : { available: false, scope: normalizedScope, label: "Current section", text: "", reason: "No readable section is visible." };
  }
  const sections = buildSpeechSections(article);
  const text = sections.length ? sections.map((section) => section.text).join(" ") : cleanText(article?.innerText || sourceText);
  return text
    ? { available: true, scope: "document", label: "Full lecture", text, sections }
    : { available: false, scope: "document", label: "Full lecture", text: "", reason: "This lecture has no readable text." };
};
