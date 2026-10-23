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
// Namespace imports, so a helper this file tests but an older build lacks
// fails its own test instead of the whole file.
import * as speech from "./speech.js";
import * as speechContent from "./speechContent.js";
import pack from "../data/pronunciations.ml.v1.json" with { type: "json" };

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

// Issue #97: narration names the platform the learner is on.
const agents = {
  iPhone: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 },
  // iPadOS asks for desktop sites as a Mac; its touch points give it away.
  iPad: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 },
  macChrome: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 0 },
  // Chrome's phone emulation on a Mac reports one touch point.
  macEmulatingTouch: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 1 },
  windows: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", platform: "Win32", maxTouchPoints: 0 },
  android: { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 },
  linux: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "Linux x86_64", maxTouchPoints: 0 },
};

test("speechPlatform tells iOS, iPadOS, Mac, Windows and Android apart", () => {
  assert.equal(typeof speech.speechPlatform, "function", "speech.js has no speechPlatform");
  assert.deepEqual(
    Object.fromEntries(Object.entries(agents).map(([name, nav]) => [name, speech.speechPlatform(nav)])),
    { iPhone: "ios", iPad: "ios", macChrome: "mac", macEmulatingTouch: "mac", windows: "windows", android: "android", linux: "other" },
  );
  assert.equal(speech.speechPlatform(null), "other");
  assert.equal(speech.speechPlatform({}), "other");
});

test("narration copy names iOS only on iOS and never sends learners to download voices", () => {
  assert.ok(speech.SPEECH_COPY, "speech.js has no SPEECH_COPY table");
  const fields = Object.keys(speech.SPEECH_COPY.ios).sort();
  for (const platform of ["ios", "mac", "windows", "android", "other"]) {
    const copy = speech.speechCopy(platform);
    assert.deepEqual(Object.keys(copy).sort(), fields, `${platform} copy is missing a message`);
    const wording = [...Object.values(copy), ...["not-allowed", "language-unavailable", "voice-unavailable", "synthesis-failed"].map((code) => speech.speechErrorMessage(code, platform))].join(" ");
    // Safari exposes only built-in voices, so installing one in Spoken
    // Content cannot fix an empty or missing list (NM8).
    assert.doesNotMatch(wording, /install|Spoken Content/iu, `${platform} copy suggests installing a voice`);
    if (platform !== "ios") assert.doesNotMatch(wording, /\biOS\b|iPhone|iPad/u, `${platform} copy names iOS`);
    // The microcopy names the voice labels the list shows (issue #92).
    assert.match(copy.microcopy, /“On device”.*voices marked “Network”/u);
  }
  assert.match(speech.speechCopy("ios").microcopy, /^Safari offers the voices built into iOS; voices downloaded in Settings may not appear here\./u);
  assert.match(speech.speechCopy("mac").microcopy, /^Voices come from macOS and this browser\./u);
  assert.match(speech.speechCopy("windows").microcopy, /^Voices come from this device and browser\./u);
  assert.equal(speech.speechCopy("unknown"), speech.speechCopy("other"));
  // Messages that are the same everywhere keep their advice.
  assert.match(speech.speechErrorMessage("network", "mac"), /On device/u);
  assert.match(speech.speechErrorMessage("not-allowed", "ios"), /iPhone or iPad/u);
});

// A failed sentence keeps the player with Retry beside Stop (issue #97), and
// there is no Play control to tap: where Retry exists the messages name it, a
// tutor's reading (no Retry) gets none, and the default says what failed in
// words before the engine's code.
test("narration errors name the Retry control only where it exists", () => {
  for (const platform of ["ios", "mac", "windows", "android", "other"]) {
    for (const code of ["not-allowed", "synthesis-failed", "audio-hardware", ""]) {
      const withRetry = speech.speechErrorMessage(code, platform, { retry: true });
      const withoutRetry = speech.speechErrorMessage(code, platform);
      for (const message of [withRetry, withoutRetry]) assert.doesNotMatch(message, /\bPlay\b/u, `${platform}: “${message}” names a Play control`);
      assert.match(withRetry, /\bTap Retry\b/u, `${platform}: “${withRetry}” does not name Retry`);
      assert.doesNotMatch(withoutRetry, /\bRetry\b/u, `${platform}: “${withoutRetry}” names Retry where there is none`);
    }
  }
  assert.equal(speech.speechErrorMessage("synthesis-failed", "other", { retry: true }), "This sentence could not be spoken (synthesis failed). Tap Retry to try it again.");
  assert.equal(speech.speechErrorMessage(""), "This sentence could not be spoken.");
});

test("narration speed shows as chosen: 1.25×, not 1.3×", () => {
  assert.equal(typeof speech.formatSpeechRate, "function", "speech.js has no formatSpeechRate");
  assert.deepEqual([1.25, 1, 0.8, 0.6, 1.6, 1.05, "1.35", Number.NaN].map(speech.formatSpeechRate), ["1.25×", "1×", "0.8×", "0.6×", "1.6×", "1.05×", "1.35×", "1×"]);
});

test("the verbalizer reads Unicode math the issue's way", () => {
  const cases = [
    ["ŷ = wᵀx + b", "y hat equals w transpose x plus b"],
    ["ŵ = (XᵀX)⁻¹Xᵀy", "w hat equals (X transpose X) inverse X transpose y"],
    ["∇J = 2Xᵀ(Xw − y)", "gradient of J equals 2X transpose (Xw minus y)"],
    ["x² + y³", "x squared plus y cubed"],
    ["x̄ ≈ μ", "x bar approximately mu"],
    ["Σxᵢ", "sum of x i"],
    ["√d", "square root of d"],
    ["A ∈ ℝᵐˣⁿ", "A in R m by n"],
    ["a ≤ b ≥ c ≠ d", "a less than or equal to b greater than or equal to c not equal to d"],
    ["P(y ∣ x)", "P of (y given x)"],
    ["‖x‖₂", "the L2 norm of x"],
    ["½‖w‖²", "one half the squared norm of w"],
    ["𝔼[X]", "expected value of [X]"],
    ["θ, λ, σ", "theta, lambda, sigma"],
    ["x₁ + xᵢ", "x 1 plus x i"],
    ["rₜ₊₁", "r t plus 1"],
    ["e⁻ᶻ", "e to the power of minus z"],
    ["3 × 4 ÷ 2", "3 times 4 divided by 2"],
    ["∂L/∂b = p − y", "partial L over partial b equals p minus y"],
    ["σ(z) = 1 / (1 + e⁻ᶻ)", "sigma of (z) equals 1 over (1 plus e to the power of minus z)"],
    ["data → model", "data leads to model"],
  ];
  for (const [input, expected] of cases) assert.equal(speech.speakable(input), expected, input);
});

test("a word reading stays joined to an adjacent hyphen or en dash", () => {
  assert.equal(speech.speakable("ε-greedy"), "epsilon-greedy");
  assert.equal(speech.speakable("τ-quantile"), "tau-quantile");
  assert.equal(speech.speakable("1-α"), "1-alpha");
});

test("capital Sigma is the letter where it names a matrix and a sum elsewhere", () => {
  const cases = [
    ["A = UΣVᵀ", "A equals U Sigma V transpose"],
    ["aᵀΣa", "a transpose Sigma a"],
    ["covariance Σ.", "covariance Sigma."],
    ["Σ: nonnegative", "Sigma: nonnegative"],
    ["N(μ, Σ)", "N of (mu, Sigma)"],
    ["Σxᵢ", "sum of x i"],
    ["λΣ|w|", "lambda sum of |w|"],
    // An operator is not a function: its own "of" is the only one.
    ["Σ(xᵢ) and 𝔼(X)", "sum of (x i) and expected value of (X)"],
  ];
  for (const [input, expected] of cases) assert.equal(speech.speakable(input), expected, input);
});

test("a norm with subscript F is the Frobenius norm", () => {
  const { subOpen: so, subClose: sc } = speech.SPEECH_MARK;
  assert.equal(speech.speakable(`‖A‖${so}F${sc}`), "the Frobenius norm of A");
  assert.equal(speech.speakable(`‖A‖${so}F${sc}²`), "the squared Frobenius norm of A");
});

test("a function name joins a formula run only as a whole word, and two long words keep their slash", () => {
  assert.equal(speech.speakable("true/false → bool"), "true/false leads to bool");
  assert.equal(speech.speakable("train/test → leakage"), "train/test leads to leakage");
  assert.match(speech.speakable("### Normal/Gaussian(μ, σ²)"), /Normal\/Gaussian/u);
  assert.equal(speech.speakable("log(a/b) = log a − log b"), "log of (a over b) equals log a minus log b");
  assert.equal(speech.speakable("∂L/∂p"), "partial L over partial p");
});

test("a word reading stays joined to an apostrophe", () => {
  assert.equal(speech.speakable("θ's value"), "theta's value");
  assert.equal(speech.speakable("θ’s value"), "theta’s value");
});

test("a subscript says sub by what the page shows, not by a replacement's words", () => {
  const { subOpen: so, subClose: sc } = speech.SPEECH_MARK;
  assert.equal(speech.speakable(`W${so}KV${sc}`), "W K V");
  assert.equal(speech.speakable(`h${so}LLM${sc}`), "h L L M");
  assert.equal(speech.speakable(`r${so}t+k+1${sc}`), "r sub t plus k plus 1");
  assert.equal(speech.speakable(`d${so}model${sc}`), "d model");
});

test("a long run of unpaired norm bars reads in linear time", () => {
  const input = "‖a ".repeat(8_000);
  const started = performance.now();
  const spoken = speech.speakable(input);
  const elapsed = performance.now() - started;
  assert.equal(spoken, input.trim(), "an unpaired bar is read as a bare symbol");
  // Generous: it guards the complexity (quadratic took about a second), not the machine.
  assert.ok(elapsed < 200, `8,000 unpaired bars took ${Math.round(elapsed)} ms`);
});

test("ASCII operators are words only inside a formula run with a math symbol", () => {
  assert.equal(speech.speakable("Gaussian + identity → linear regression"), "Gaussian + identity leads to linear regression");
  assert.equal(speech.speakable("stale read then write → version/ETag optimistic concurrency"), "stale read then write leads to version/ETag optimistic concurrency");
  assert.equal(speech.speakable("Use x = 5 and y/2 here."), "Use x = 5 and y/2 here.");
  assert.equal(speech.speakable("P(D ∣ +) = 95/590 ≈ 16.1%"), "P of (D given +) equals 95 over 590 approximately 16.1%");
  assert.equal(speech.speakable("See https://x.org/a/b → b"), "See https://x.org/a/b leads to b");
  assert.equal(speech.speakable("An intelligent product observes some context."), "An intelligent product observes some context.");
});

test("marked sub, sup and inline-code spans read as the DOM wrote them", () => {
  const { subOpen: so, subClose: sc, supOpen: po, supClose: pc, plainOpen, plainClose } = speech.SPEECH_MARK;
  assert.equal(speech.speakable(`Σ${so}i=1${sc}${po}n${pc} x${so}i${sc}`), "sum from i equals 1 to n of x i");
  assert.equal(speech.speakable(`x${po}2${pc}`), "x squared");
  assert.equal(speech.speakable(`X${po}T${pc}`), "X transpose");
  assert.equal(speech.speakable(`A${po}−1${pc}`), "A inverse");
  assert.equal(speech.speakable(`e${po}x${pc}`), "e to the power of x");
  assert.equal(speech.speakable(`d${so}model${sc}`), "d model");
  assert.equal(speech.speakable(`r${so}t+k+1${sc}`), "r sub t plus k plus 1");
  assert.equal(speech.speakable(`Run ${plainOpen}θ = a/b${plainClose} once.`), "Run θ = a/b once.");
  assert.equal(speech.speakable(`${plainOpen}np.linalg.lstsq(X, y)${plainClose}`), "np.linalg.least squares(X, y)");
  assert.equal(speech.stripSpeechMarks(`x${so}i${sc} and ${plainOpen}a${plainClose}`), "xi and a");
});

test("a learner's entry beats the pack and nothing is replaced twice", () => {
  assert.equal(speech.speakable("ReLU then tanh"), "ray-loo then tanch");
  assert.equal(speech.speakable("ReLU then tanh", { pronunciations: [{ term: "relu", spoken: "rectifier" }] }), "rectifier then tanch");
  assert.equal(speech.speakable("alpha beta", { pronunciations: [{ term: "alpha", spoken: "beta" }, { term: "beta", spoken: "gamma" }] }), "beta gamma");
  assert.equal(speech.speakable("QLoRA beats LoRA in KV cache use"), "Q lora beats lora in K V cache use");
  assert.equal(speech.speakable("CUDAx and xCUDA"), "CUDAx and xCUDA");
  assert.equal(speech.speakable("MAP and map and mAP"), "M A P and map and mean average precision");
  assert.equal(speech.speakable("C++ code", { pronunciations: [{ term: "C++", spoken: "C plus plus" }] }), "C plus plus code");
  assert.equal(speech.speakable("ReLU, tanh and lstsq"), "ray-loo, tanch and least squares");
});

test("term = skips a term, and overrides parse from Settings lines", () => {
  assert.deepEqual(speech.parsePronunciationLines("ReLU = ray loo\num =\n  = nothing\nno equals sign\nSQL = sequel = query"), [
    { term: "ReLU", spoken: "ray loo" },
    { term: "um", spoken: "" },
    { term: "SQL", spoken: "sequel = query" },
  ]);
  assert.equal(speech.speakable("So um this works", { pronunciations: [{ term: "um", spoken: "" }] }), "So this works");
  assert.equal(speech.speakable("ReLU", { pronunciations: [{ term: "ReLU", spoken: "" }] }), "");
  assert.deepEqual(speech.normalizePronunciations([{ term: " um ", spoken: "" }, { term: "UM", spoken: "x" }, { term: "", spoken: "y" }]), [{ term: "um", spoken: "" }]);
  assert.equal(speech.normalizePronunciations(Array.from({ length: 60 }, (_, index) => ({ term: `t${index}`, spoken: "x" }))).length, 50);
  assert.equal(speech.samePronunciations([{ term: "a", spoken: "b" }], [{ term: " a ", spoken: "b " }]), true);
  assert.equal(speech.samePronunciations([{ term: "a", spoken: "b" }], [{ term: "a", spoken: "c" }]), false);
});

test("speakableWithMap maps every spoken character back to its source", () => {
  const input = "The loss ŷ = b uses ReLU.";
  const { text, map } = speech.speakableWithMap(input);
  assert.equal(text, "The loss y hat equals b uses ray-loo.");
  assert.equal(map[0].spoken[0], 0);
  assert.equal(map.at(-1).spoken[1], text.length);
  map.forEach((piece, index) => {
    assert.ok(piece.source[0] <= piece.source[1]);
    if (index) {
      assert.equal(piece.spoken[0], map[index - 1].spoken[1]);
      assert.ok(piece.source[0] >= map[index - 1].source[1]);
    }
  });
  const sourceOf = (word) => speech.sourceOffsetAt(map, text.indexOf(word));
  assert.equal(input.slice(sourceOf("ray-loo"), sourceOf("ray-loo") + 4), "ReLU");
  assert.equal(input[sourceOf("y hat")], "ŷ");
  assert.equal(input.slice(sourceOf("uses"), sourceOf("uses") + 4), "uses");
  assert.deepEqual(speech.collapseWithOffsets("  a \n b"), { text: "a b", offsets: [0, 0, 0, 1, 2, 2, 2, 3] });
});

test("speakableWithMap keeps the map contract around markers and constructs", () => {
  const { subOpen: so, subClose: sc, supOpen: po, supClose: pc, plainOpen, plainClose } = speech.SPEECH_MARK;
  const inputs = [
    // a big operator's limits and a norm with sub and sup groups
    `J = Σ${so}i=1${sc}${po}n${pc} ‖x${so}i${sc} − μ‖${so}2${sc}${po}2${pc}`,
    // an inserted "of", a replaced term inside a sub group, inline code
    `P(y ∣ x) uses W${so}KV${sc} and ${plainOpen}lstsq(X, y)${plainClose}.`,
    // groups inside groups
    `e${po}x${pc} ∈ ℝ${po}d${so}model${sc}${pc}, so x${po}${so}2${sc}${pc}`,
    // Unicode scripts, a stray close and an unclosed open
    `rₜ₊₁ ${sc}x${po}T${pc} ½‖w‖² ${so}`,
  ];
  for (const input of inputs) {
    const label = speech.stripSpeechMarks(input);
    const { text, map } = speech.speakableWithMap(input);
    assert.equal(map[0].spoken[0], 0, label);
    assert.equal(map.at(-1).spoken[1], text.length, label);
    map.forEach((piece, index) => {
      const [start, end] = piece.source;
      assert.ok(piece.spoken[0] < piece.spoken[1], `${label}: piece ${index} is empty`);
      assert.ok(start >= 0 && start <= end && end <= input.length, `${label}: piece ${index} is out of bounds`);
      assert.equal(speech.stripSpeechMarks(input.slice(start, end)), input.slice(start, end), `${label}: piece ${index} covers a marker`);
      if (index) {
        assert.equal(piece.spoken[0], map[index - 1].spoken[1], `${label}: a gap before piece ${index}`);
        assert.ok(start >= map[index - 1].source[1], `${label}: piece ${index} overlaps the one before`);
      }
    });
  }
  const [norm] = inputs;
  const { text, map } = speech.speakableWithMap(norm);
  assert.equal(text, "J equals sum from i equals 1 to n of the squared L2 norm of x i minus mu");
  assert.equal(speech.sourceOffsetAt(map, text.indexOf("the squared L2 norm")), norm.indexOf("‖"), "the norm's words start at its opening bar");
});

test("endSentence and TERMINAL_PUNCTUATION live in speech.js", () => {
  assert.equal(speech.endSentence("Ridge regression"), "Ridge regression.");
  assert.equal(speech.endSentence("Done!"), "Done!");
  assert.equal(speech.endSentence(""), "");
  assert.equal(speech.TERMINAL_PUNCTUATION.test("Note:"), true);
});

test("the built-in pack covers the issue's terms and lists nothing twice", () => {
  assert.equal(pack.version, 1);
  assert.ok(pack.entries.length >= 110 && pack.entries.length <= 130, `the pack has ${pack.entries.length} entries`);
  for (const term of ["ReLU", "tanh", "SGD", "NDCG", "PR-AUC", "k-NN", "LLM", "LoRA", "QLoRA", "vLLM", "KV cache", "i.i.d.", "argmin", "argmax", "p99", "lstsq", "PyTorch"]) {
    assert.ok(pack.entries.some((entry) => entry.term === term), `the pack has no ${term}`);
  }
  const keys = pack.entries.map((entry) => (entry.matchCase ? entry.term : entry.term.toLowerCase()));
  assert.equal(new Set(keys).size, keys.length, "a pack term is listed twice");
  for (const entry of pack.entries) assert.ok(entry.term.trim() && entry.spoken.trim() && entry.term.length <= 60 && entry.spoken.length <= 120, entry.term);
  assert.equal(speech.PRONUNCIATION_PACK.length, pack.entries.length);
});

// Task 2 composes and slices these maps; the brief's tests above only reach
// them through speakableWithMap and sourceOffsetAt.
test("offset maps build, compose and slice by the MapPiece rules", async () => {
  const { createSpokenBuilder } = await import("./spokenMap.js");
  const piece = (spoken, source) => ({ spoken, source });
  const builder = createSpokenBuilder();
  builder.append("  a  b ", 0, 7);
  builder.append("y hat", 7, 8);
  builder.append(" c", 8, 10);
  assert.deepEqual(builder.build(), {
    text: "a b y hat c",
    map: [piece([0, 1], [2, 3]), piece([1, 2], [3, 4]), piece([2, 3], [5, 6]), piece([3, 4], [6, 7]), piece([4, 9], [7, 8]), piece([9, 10], [8, 9]), piece([10, 11], [9, 10])],
  });
  const map = [piece([0, 5], [10, 15]), piece([5, 10], [15, 16])];
  assert.deepEqual(speech.sliceMap(map, 2, 7), [piece([0, 3], [12, 15]), piece([3, 5], [15, 16])], "an identity piece is cut exactly; any other keeps its source");
  assert.deepEqual(
    speech.composeMaps([piece([0, 3], [0, 3]), piece([3, 4], [3, 4]), piece([4, 9], [4, 5])], [piece([0, 4], [10, 14]), piece([4, 5], [20, 30])]),
    [piece([0, 3], [10, 13]), piece([3, 4], [13, 14]), piece([4, 9], [20, 30])],
  );
  assert.deepEqual(speech.composeMaps([piece([0, 2], [0, 2]), piece([2, 3], [2, 3]), piece([3, 5], [3, 5])], [piece([0, 5], [40, 60])]), [piece([0, 5], [40, 60])], "pieces inside one non-identity piece merge");
  assert.deepEqual(speech.composeMaps([piece([0, 1], [0, 1]), piece([1, 2], [1, 1])], [piece([0, 1], [5, 6])]), [piece([0, 1], [5, 6]), piece([1, 2], [6, 6])], "inserted text keeps an empty source range");
  assert.equal(speech.sourceOffsetAt([], 3), 0);
  assert.equal(speech.sourceOffsetAt(map, 3), 13);
  assert.equal(speech.sourceOffsetAt(map, 7), 15);
  assert.equal(speech.sourceOffsetAt(map, 10), 16, "a non-identity piece's spoken end is its source end");
});
