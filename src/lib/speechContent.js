import { SPEECH_SCOPES, splitSpeechSentences } from "./speech.js";

const READABLE_SELECTOR = "h1, h2, h3, h4, p, li, blockquote, figcaption, td, th, pre";

const cleanText = (value) => String(value || "").replace(/\s+/gu, " ").trim();

const readableBlocks = (article) => [...(article?.querySelectorAll?.(READABLE_SELECTOR) || [])]
  .filter((node) => !node.parentElement?.closest?.("p, li, blockquote, figcaption, td, th, pre"))
  .filter((node) => cleanText(node.textContent));

export const currentSpeechBlock = (article, scrollContainer) => {
  const blocks = readableBlocks(article);
  if (!blocks.length) return null;
  const containerRect = scrollContainer?.getBoundingClientRect?.();
  const target = containerRect
    ? containerRect.top + Math.min(140, Math.max(45, containerRect.height * 0.18))
    : 120;
  const measured = blocks.map((node) => ({ node, rect: node.getBoundingClientRect?.() || { top: 0, bottom: 0 } }));
  const containing = measured.find(({ rect }) => rect.top <= target && rect.bottom >= target);
  if (containing) return containing.node;
  const above = measured.filter(({ rect }) => rect.top <= target).at(-1);
  if (above) return above.node;
  return measured.sort((left, right) => Math.abs(left.rect.top - target) - Math.abs(right.rect.top - target))[0]?.node || blocks[0];
};

const sectionText = (article, currentBlock) => {
  const blocks = readableBlocks(article);
  if (!blocks.length) return "";
  let index = Math.max(0, blocks.indexOf(currentBlock));
  while (index > 0 && !/^H[1-3]$/u.test(blocks[index].tagName)) index -= 1;
  const section = [];
  for (let cursor = index; cursor < blocks.length; cursor += 1) {
    const block = blocks[cursor];
    if (cursor > index && /^H[1-3]$/u.test(block.tagName)) break;
    section.push(cleanText(block.textContent));
  }
  return cleanText(section.join(" "));
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
  const currentBlock = currentSpeechBlock(article, scrollContainer);
  if (normalizedScope === "selection") {
    const text = cleanText(selectedText);
    return text
      ? { available: true, scope: normalizedScope, label: "Selection", text }
      : { available: false, scope: normalizedScope, label: "Selection", text: "", reason: "Select text in the lecture first." };
  }
  if (normalizedScope === "sentence") {
    const sentence = splitSpeechSentences(cleanText(currentBlock?.textContent), language)[0] || "";
    return sentence
      ? { available: true, scope: normalizedScope, label: "Current sentence", text: sentence }
      : { available: false, scope: normalizedScope, label: "Current sentence", text: "", reason: "No readable sentence is visible." };
  }
  if (normalizedScope === "section") {
    const text = sectionText(article, currentBlock);
    return text
      ? { available: true, scope: normalizedScope, label: "Current section", text }
      : { available: false, scope: normalizedScope, label: "Current section", text: "", reason: "No readable section is visible." };
  }
  const text = cleanText(article?.innerText || sourceText);
  return text
    ? { available: true, scope: "document", label: "Full lecture", text }
    : { available: false, scope: "document", label: "Full lecture", text: "", reason: "This lecture has no readable text." };
};
