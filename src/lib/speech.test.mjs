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
import { buildSpeechTarget, currentSpeechBlock } from "./speechContent.js";

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

test("speech errors explain actionable offline and size failures", () => {
  assert.match(speechErrorMessage("network"), /On device/u);
  assert.match(speechErrorMessage("text-too-long"), /Sentence, Section, or Selection/u);
});
