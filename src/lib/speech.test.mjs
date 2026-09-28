import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEECH_CHUNK_LIMIT,
  chunkSpeechText,
  groupSpeechVoices,
  normalizeSpeechLanguage,
  normalizeSpeechVoices,
  selectSpeechVoice,
  speechErrorMessage,
  speechLanguages,
  splitSpeechSentences,
  voiceMatchesLanguage,
} from "./speech.js";
// A namespace import, so a helper this file tests but an older build lacks
// fails its own test instead of the whole file.
import * as speechContent from "./speechContent.js";

const { buildSpeechTarget, currentSpeechBlock } = speechContent;

const voices = [
  { name: "Cloud US", lang: "en_US", voiceURI: "cloud-us", default: true, localService: false },
  { name: "Local India", lang: "en-IN", voiceURI: "local-in", default: false, localService: true },
  { name: "Local Hindi", lang: "hi-IN", voiceURI: "local-hi", default: false, localService: true },
  { name: "Duplicate", lang: "hi-IN", voiceURI: "local-hi", default: false, localService: true },
];

test("speech chunks are sentence-oriented and remain inside the iOS-safe bound", () => {
  const text = `First sentence. ${"Optimization ".repeat(80)}Done! ${"界".repeat(400)}`;
  const chunks = chunkSpeechText(text);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((chunk) => [...chunk].length <= SPEECH_CHUNK_LIMIT));
  assert.equal(chunks[0], "First sentence.");
  assert.equal(chunks.join(" ").replace(/\s+/gu, " ").includes("Done!"), true);
});

test("sentence segmentation handles multilingual terminal punctuation", () => {
  assert.deepEqual(splitSpeechSentences("पहला वाक्य। दूसरा वाक्य!", "hi-IN"), ["पहला वाक्य।", "दूसरा वाक्य!"]);
  assert.deepEqual(splitSpeechSentences("一つです。二つです！", "ja-JP"), ["一つです。", "二つです！"]);
});

test("voice normalization, language filtering, and preference are deterministic", () => {
  const normalized = normalizeSpeechVoices(voices);
  assert.equal(normalized.length, 3, "duplicate voice URIs must not produce duplicate picker entries");
  assert.equal(normalizeSpeechLanguage("en_US"), "en-US");
  assert.equal(voiceMatchesLanguage(normalized[0], "en"), true);
  assert.equal(selectSpeechVoice(voices, { language: "en-IN" }).voiceURI, "local-in", "an on-device regional voice should beat an unrelated default");
  assert.equal(selectSpeechVoice(voices, { language: "en-US", voiceURI: "cloud-us" }).voiceURI, "cloud-us");
  assert.deepEqual(speechLanguages(voices).map((item) => item.id), ["en-IN", "en-US", "hi-IN"]);
  assert.equal(groupSpeechVoices(voices, "hi-IN")[0].voices.length, 1);
});

const fakeBlock = (tagName, textContent, top, bottom) => ({
  tagName,
  textContent,
  parentElement: { closest: () => null },
  getBoundingClientRect: () => ({ top, bottom }),
});

test("speech targets resolve visible sentence, section, selection, and full lecture", () => {
  const blocks = [
    fakeBlock("H1", "Lecture", 0, 40),
    fakeBlock("H2", "Optimization", 60, 100),
    fakeBlock("P", "Gradient descent moves downhill. Learning rate controls each step.", 105, 190),
    fakeBlock("P", "Momentum smooths updates.", 195, 240),
    fakeBlock("H2", "Evaluation", 260, 300),
    fakeBlock("P", "Measure held-out error.", 305, 350),
  ];
  const article = { querySelectorAll: () => blocks, innerText: blocks.map((block) => block.textContent).join("\n") };
  const scrollContainer = { getBoundingClientRect: () => ({ top: 0, height: 800 }) };
  assert.equal(currentSpeechBlock(article, scrollContainer), blocks[2]);
  assert.equal(buildSpeechTarget({ scope: "sentence", article, scrollContainer }).text, "Gradient descent moves downhill.");
  assert.equal(buildSpeechTarget({ scope: "section", article, scrollContainer }).text, "Optimization Gradient descent moves downhill. Learning rate controls each step. Momentum smooths updates.");
  assert.equal(buildSpeechTarget({ scope: "selection", selectedText: " chosen  text " }).text, "chosen text");
  assert.equal(buildSpeechTarget({ scope: "selection" }).available, false);
  assert.ok(buildSpeechTarget({ scope: "document", article }).text.includes("Measure held-out error."));
});

// Issue #96 (ND2): a section ends at the next heading whose level is at most
// max(its own level, 2). Main returned the heading alone for an H2 followed
// by an H3 ("5. Learning paradigms" read 21 characters) and for the title.
const lecture = () => {
  const blocks = [
    fakeBlock("H1", "Chapter 1", 0, 40),
    fakeBlock("H2", "1. Intelligence", 50, 90),
    fakeBlock("P", "Products act on context.", 95, 140),
    fakeBlock("H3", "Artificial intelligence", 150, 190),
    fakeBlock("P", "AI is the broad field.", 195, 240),
    fakeBlock("H2", "5. Learning paradigms", 250, 290),
    fakeBlock("H3", "5.1 Supervised learning", 300, 340),
    fakeBlock("P", "Labels guide the fit.", 345, 390),
    fakeBlock("H4", "A note", 395, 420),
    fakeBlock("P", "Labels cost money.", 425, 460),
    fakeBlock("H3", "5.2 Unsupervised learning", 470, 510),
    fakeBlock("P", "Structure without labels.", 515, 560),
    fakeBlock("H2", "6. Task taxonomy", 570, 610),
    fakeBlock("P", "Tasks differ by output.", 615, 660),
  ];
  return { blocks, article: { querySelectorAll: () => blocks } };
};
const lineAt = (top) => ({ getBoundingClientRect: () => ({ top: top - 140, height: 800 }) });

test("a section runs to the next heading at its own level or above, with H2 as the floor", () => {
  const { article } = lecture();
  const section = (top) => buildSpeechTarget({ scope: "section", article, scrollContainer: lineAt(top) }).text;
  assert.equal(
    section(260),
    "5. Learning paradigms 5.1 Supervised learning Labels guide the fit. A note Labels cost money. 5.2 Unsupervised learning Structure without labels.",
    "an H2 must read through its H3 subsections until the next H2",
  );
  assert.equal(section(310), "5.1 Supervised learning Labels guide the fit. A note Labels cost money.", "an H3 stops at the next H3");
  assert.equal(
    section(10),
    "Chapter 1 1. Intelligence Products act on context. Artificial intelligence AI is the broad field.",
    "a title with no introduction continues through the first section",
  );
  assert.equal(section(620), "6. Task taxonomy Tasks differ by output.");

  const withIntro = [fakeBlock("H1", "Title", 0, 40), fakeBlock("P", "Intro text.", 45, 90), fakeBlock("H3", "Aside", 95, 130), fakeBlock("P", "Aside text.", 135, 170), fakeBlock("H2", "1. First", 175, 210), fakeBlock("P", "Body.", 215, 250)];
  assert.equal(
    buildSpeechTarget({ scope: "section", article: { querySelectorAll: () => withIntro }, scrollContainer: lineAt(10) }).text,
    "Title Intro text. Aside Aside text.",
    "an H1 reads its introduction up to the first H2",
  );
});

test("sentenceIndexAt finds the sentence containing a character offset", () => {
  assert.equal(typeof speechContent.sentenceIndexAt, "function", "speechContent.js must export sentenceIndexAt");
  const { sentenceIndexAt } = speechContent;
  const text = "First one here.  Second  sentence follows. Third!";
  assert.equal(sentenceIndexAt(text, 0), 0);
  assert.equal(sentenceIndexAt(text, 14), 0, "the last character of the first sentence");
  assert.equal(sentenceIndexAt(text, 16), 1, "offsets are in the whitespace-collapsed text");
  assert.equal(sentenceIndexAt(text, 30), 1);
  assert.equal(sentenceIndexAt(text, 42), 2);
  assert.equal(sentenceIndexAt(text, 9_999), 2, "past the end is the last sentence");
  assert.equal(sentenceIndexAt("", 3), 0);
  assert.equal(sentenceIndexAt("पहला वाक्य। दूसरा वाक्य!", 12, "hi-IN"), 1);
});

test("the sentence target on a heading is the first sentence of the text after it", () => {
  const { article } = lecture();
  assert.equal(
    buildSpeechTarget({ scope: "sentence", article, scrollContainer: lineAt(260) }).text,
    "Labels guide the fit.",
    "the line on “5. Learning paradigms” must read the next paragraph's first sentence, not the heading",
  );
  // Without layout (these fakes) the paragraph's first sentence is the fallback.
  assert.equal(buildSpeechTarget({ scope: "sentence", article, scrollContainer: lineAt(350) }).text, "Labels guide the fit.");
});

test("a diagram's failure diagnostic is never narrated", () => {
  const insideDiagram = (tagName, textContent, top, bottom) => ({
    ...fakeBlock(tagName, textContent, top, bottom),
    parentElement: { closest: (selector) => (selector.split(",").map((item) => item.trim()).includes(".diagram-shell") ? { className: "diagram-shell" } : null) },
  });
  const blocks = [
    fakeBlock("H2", "Mental model", 0, 40),
    fakeBlock("P", "Fields nest inside one another.", 45, 90),
    insideDiagram("P", "The Mermaid module could not be loaded. Reload after reconnecting.", 95, 130),
    insideDiagram("PRE", "flowchart TD AI[Artificial Intelligence] --> ML", 135, 170),
    fakeBlock("P", "The nesting is simplified.", 175, 220),
  ];
  const article = { querySelectorAll: () => blocks, innerText: "" };
  for (const scope of ["document", "section"]) {
    const { text } = buildSpeechTarget({ scope, article, scrollContainer: lineAt(10) });
    assert.doesNotMatch(text, /Mermaid module|flowchart|-->/u, `${scope} narration read the diagram diagnostic: ${text}`);
    assert.match(text, /The nesting is simplified\./u);
  }
  assert.equal(buildSpeechTarget({ scope: "sentence", article, scrollContainer: lineAt(110) }).text, "Fields nest inside one another.");
});

test("speech errors explain actionable offline and size failures", () => {
  assert.match(speechErrorMessage("network"), /On device/u);
  assert.match(speechErrorMessage("text-too-long"), /Sentence, Section, or Selection/u);
});
