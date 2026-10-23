import { normalizePronunciations, speakable, speakableWithMap } from "./speakable.js";
import { composeMaps, sliceMap, sourceOffsetAt } from "./spokenMap.js";

// The text pass (issue #100) lives in speakable.js and its offset maps in
// spokenMap.js; narration reaches both through this module.
export {
  MAX_PRONUNCIATIONS,
  PRONUNCIATION_PACK,
  SPEECH_MARK,
  normalizePronunciations,
  speakable,
  speakableWithMap,
  stripSpeechMarks,
} from "./speakable.js";
export { collapseWithOffsets, composeMaps, sliceMap, sourceOffsetAt } from "./spokenMap.js";

export const SPEECH_TEXT_LIMIT = 500_000;
export const SPEECH_CHUNK_LIMIT = 180;

export const SPEECH_SCOPES = Object.freeze([
  { id: "sentence", label: "Sentence", shortLabel: "Current sentence" },
  { id: "section", label: "Section", shortLabel: "Current section" },
  { id: "selection", label: "Selection", shortLabel: "Selection" },
  { id: "document", label: "Full", shortLabel: "Full lecture" },
]);

export const normalizeSpeechLanguage = (value) => {
  if (!value || value === "auto") return "auto";
  try {
    return Intl.getCanonicalLocales(String(value).replaceAll("_", "-"))[0] || "auto";
  } catch {
    return "auto";
  }
};

export const normalizeVoiceURI = (value) => typeof value === "string" ? value.slice(0, 500) : "";

const voiceIdentity = (voice) => normalizeVoiceURI(voice?.voiceURI)
  || `${String(voice?.name || "System voice")}\u0000${normalizeSpeechLanguage(voice?.lang)}`;

export const normalizeSpeechVoices = (value) => {
  const unique = new Map();
  (Array.isArray(value) ? value : []).forEach((voice) => {
    if (!voice || typeof voice !== "object") return;
    const id = voiceIdentity(voice);
    if (!unique.has(id)) unique.set(id, voice);
  });
  return [...unique.values()].sort((left, right) => {
    const languageOrder = normalizeSpeechLanguage(left.lang).localeCompare(normalizeSpeechLanguage(right.lang));
    if (languageOrder) return languageOrder;
    if (Boolean(left.localService) !== Boolean(right.localService)) return left.localService ? -1 : 1;
    if (Boolean(left.default) !== Boolean(right.default)) return left.default ? -1 : 1;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
};

export const voiceMatchesLanguage = (voice, language) => {
  const wanted = normalizeSpeechLanguage(language);
  if (wanted === "auto") return true;
  const actual = normalizeSpeechLanguage(voice?.lang);
  if (actual === wanted) return true;
  // A language-only preference such as `en` deliberately includes en-US,
  // en-GB, and en-IN. A regional preference remains exact.
  return !wanted.includes("-") && actual.split("-")[0] === wanted;
};

export const speechLanguages = (voices) => {
  const counts = new Map();
  normalizeSpeechVoices(voices).forEach((voice) => {
    const language = normalizeSpeechLanguage(voice.lang);
    if (language !== "auto") counts.set(language, (counts.get(language) || 0) + 1);
  });
  return [...counts].map(([id, count]) => ({ id, count }));
};

export const selectSpeechVoice = (voices, { voiceURI = "", language = "auto" } = {}) => {
  const available = normalizeSpeechVoices(voices);
  const matching = available.filter((voice) => voiceMatchesLanguage(voice, language));
  const pool = matching.length ? matching : available;
  const requested = normalizeVoiceURI(voiceURI);
  return pool.find((voice) => voiceIdentity(voice) === requested)
    || pool.find((voice) => voice.default && voice.localService)
    || pool.find((voice) => voice.localService)
    || pool.find((voice) => voice.default)
    || pool[0]
    || null;
};

export const groupSpeechVoices = (voices, language = "auto") => {
  const groups = new Map();
  normalizeSpeechVoices(voices)
    .filter((voice) => voiceMatchesLanguage(voice, language))
    .forEach((voice) => {
      const id = normalizeSpeechLanguage(voice.lang);
      const group = groups.get(id) || { id, voices: [] };
      group.voices.push(voice);
      groups.set(id, group);
    });
  return [...groups.values()];
};

export const speechLanguageLabel = (language, displayLocale) => {
  const normalized = normalizeSpeechLanguage(language);
  if (normalized === "auto") return "All languages";
  try {
    const locale = normalized.split("-")[0];
    const languageName = new Intl.DisplayNames([displayLocale || globalThis.navigator?.language || "en"], { type: "language" }).of(locale);
    return normalized.includes("-") ? `${languageName || locale} (${normalized})` : languageName || normalized;
  } catch {
    return normalized;
  }
};

const sentenceFallback = (text) => text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu) || [text];

export const splitSpeechSentences = (text, language = "auto") => {
  const clean = String(text || "").replace(/\s+/gu, " ").trim();
  if (!clean) return [];
  if (typeof Intl.Segmenter === "function") {
    try {
      const locale = normalizeSpeechLanguage(language);
      return [...new Intl.Segmenter(locale === "auto" ? undefined : locale, { granularity: "sentence" }).segment(clean)]
        .map((part) => part.segment.trim())
        .filter(Boolean);
    } catch {
      // Fall through to the Unicode punctuation splitter for invalid or
      // unsupported locale data.
    }
  }
  return sentenceFallback(clean).map((part) => part.trim()).filter(Boolean);
};

// No piece of a split sentence is shorter than this many words (issue #100):
// a lone "Yes," or "succeeds." sounds like a stumble.
export const MIN_PIECE_WORDS = 3;

const ENUMERATOR = /^\(?(?:\d+(?:\.\d+)*|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.):]?$/u;

/**
 * A sentence that is only a list or heading number: 6., 5.1, (a), a), iv.
 * The segmenter ends a sentence after the "6." of "6. Task taxonomy", which
 * would make the number an utterance of its own. It needs a digit, a bracket
 * or a closing full stop, so a lone word such as "I" or "mix" is not one.
 */
export const isEnumeratorOnly = (text) => {
  const value = String(text ?? "").trim();
  return ENUMERATOR.test(value) && /[\d()]|\.$/u.test(value);
};

// Sentence segments as [start, end) offsets that tile `text`: the
// segmenter's, or the punctuation fallback's, each with the whitespace after
// it.
const sentenceSegments = (text, language) => {
  if (typeof Intl.Segmenter === "function") {
    try {
      const locale = normalizeSpeechLanguage(language);
      return [...new Intl.Segmenter(locale === "auto" ? undefined : locale, { granularity: "sentence" }).segment(text)]
        .map(({ index, segment }) => ({ start: index, end: index + segment.length }));
    } catch {
      // Fall through to the Unicode punctuation splitter for invalid or
      // unsupported locale data.
    }
  }
  return [...text.matchAll(/[^.!?。！？]*[.!?。！？]+\s*|[^.!?。！？]+$/gu)]
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
};

/**
 * The sentences of `text` as [start, end) offsets into it, tiling it: the
 * whitespace after a sentence stays with it, leading whitespace goes with
 * the first. A segment that is only an enumerator ("6. " before "Task
 * taxonomy") joins the one after it.
 */
export const splitSpeechSentenceRanges = (text, language = "auto") => {
  const source = String(text ?? "");
  const ranges = [];
  // Where the next sentence starts while its words are still to come:
  // leading whitespace, or an enumerator waiting for its sentence.
  let from = -1;
  for (const { start, end } of sentenceSegments(source, language)) {
    const value = source.slice(start, end);
    if (!value.trim() && from < 0 && ranges.length) {
      ranges.at(-1).end = end;
      continue;
    }
    if (from < 0) from = start;
    if (!value.trim() || isEnumeratorOnly(value)) continue;
    ranges.push({ start: from, end });
    from = -1;
  }
  // An enumerator with nothing after it is a sentence of its own.
  if (from >= 0 && source.slice(from).trim()) ranges.push({ start: from, end: source.length });
  return ranges;
};

const SPACE = /\s/u;
const wordCount = (text, start, end) => text.slice(start, end).split(/\s+/u).filter(Boolean).length;
const lengthOf = (text, start, end) => [...text.slice(start, end)].length;

// Where a clause may end, by priority: after , ; or : with whitespace after
// it, or after an em dash. A table row ends its cells with "; ", so a row
// breaks between cells before it breaks inside one.
const clauseMarks = (kind) => (kind === "row" ? [";", ",:—"] : [",;:—"]);
const endsClause = (text, at, marks) => {
  const mark = text[at - 1];
  return marks.includes(mark) && (mark === "—" || SPACE.test(text[at] ?? ""));
};

// Where the piece starting at `from` ends: `end` when the rest fits in
// `limit` code points; otherwise the furthest clause end within them, by
// priority, else the furthest space, else the limit itself (`chars`). The
// scan never looks past the limit, so a long sentence splits in linear time.
const pieceEnd = (text, from, end, limit, levels) => {
  const clauses = levels.map(() => -1);
  let space = -1;
  let at = from;
  for (let count = 0; count < limit && at < end; count += 1) {
    at += text.codePointAt(at) > 0xffff ? 2 : 1;
    levels.forEach((marks, level) => {
      if (endsClause(text, at, marks)) clauses[level] = at;
    });
    if (SPACE.test(text[at] ?? "") && !SPACE.test(text[at - 1])) space = at;
  }
  if (at >= end) return { end, chars: false };
  const clause = clauses.find((position) => position > from);
  if (clause !== undefined) return { end: clause, chars: false };
  return space > from ? { end: space, chars: false } : { end: at, chars: true };
};

// Two neighbouring pieces cut again at the space nearest their seam that
// leaves at least MIN_PIECE_WORDS words and at most `limit` code points on
// each side; null when no space does.
const resplitPair = (text, left, right, limit) => {
  let best = null;
  for (const match of text.slice(left.start, right.end).matchAll(/\s+/gu)) {
    const cut = left.start + match.index;
    const next = cut + match[0].length;
    if (best && Math.abs(cut - left.end) >= Math.abs(best[0].end - left.end)) continue;
    if (wordCount(text, left.start, cut) < MIN_PIECE_WORDS || wordCount(text, next, right.end) < MIN_PIECE_WORDS) continue;
    if (lengthOf(text, left.start, cut) > limit || lengthOf(text, next, right.end) > limit) continue;
    best = [{ start: left.start, end: cut, chars: false }, { start: next, end: right.end, chars: false }];
  }
  return best;
};

/**
 * One spoken sentence as pieces of at most `limit` characters, as trimmed
 * [start, end) ranges into `text`. A piece ends at the furthest clause end
 * that fits (a row's "; " first), else at the furthest space, else after
 * `limit` characters. Then no piece keeps fewer than MIN_PIECE_WORDS words
 * when the sentence has twice as many: a short piece joins its neighbour (the
 * next; the previous for the last) when the two fit, or the pair is cut again
 * nearer the middle. A row is exempt, so its cells stay whole, and so are
 * pieces cut by characters, which have no words to move.
 */
export const splitSpokenSentence = (text, { limit = SPEECH_CHUNK_LIMIT, kind = "text" } = {}) => {
  const source = String(text ?? "");
  const max = Math.max(1, Math.floor(Number(limit)) || SPEECH_CHUNK_LIMIT);
  const levels = clauseMarks(kind);
  let end = source.length;
  while (end > 0 && SPACE.test(source[end - 1])) end -= 1;
  const pieces = [];
  for (let start = 0; start < end;) {
    while (SPACE.test(source[start])) start += 1;
    const piece = pieceEnd(source, start, end, max, levels);
    pieces.push({ start, end: piece.end, chars: piece.chars });
    start = piece.end;
  }
  if (kind !== "row" && pieces.length > 1 && wordCount(source, 0, end) >= 2 * MIN_PIECE_WORDS) {
    for (let index = 0; index < pieces.length;) {
      const piece = pieces[index];
      if (pieces.length < 2 || piece.chars || wordCount(source, piece.start, piece.end) >= MIN_PIECE_WORDS) {
        index += 1;
        continue;
      }
      const at = index < pieces.length - 1 ? index : index - 1;
      const [left, right] = [pieces[at], pieces[at + 1]];
      if (lengthOf(source, left.start, right.end) <= max) {
        // Merged, the piece is checked again: two short pieces can still be short.
        pieces.splice(at, 2, { start: left.start, end: right.end, chars: false });
        index = at;
        continue;
      }
      const resplit = resplitPair(source, left, right, max);
      if (resplit) pieces.splice(at, 2, ...resplit);
      index = resplit ? at + 2 : index + 1;
    }
  }
  return pieces.map((piece) => ({ start: piece.start, end: piece.end }));
};

const chunkLimit = (limit) => Math.max(40, Math.min(1_000, Math.floor(Number(limit) || SPEECH_CHUNK_LIMIT)));

// Consecutive whole sentences share an utterance while it stays within
// `limit` characters. A longer sentence is split at its clauses, and its
// pieces stand alone.
const packSentences = (sentences, limit) => {
  const chunks = [];
  let open = false; // the last chunk holds whole sentences and can take another
  for (const sentence of sentences) {
    if (!sentence) continue;
    if ([...sentence].length > limit) {
      for (const { start, end } of splitSpokenSentence(sentence, { limit })) chunks.push(sentence.slice(start, end));
      open = false;
      continue;
    }
    const combined = open ? `${chunks.at(-1)} ${sentence}` : "";
    if (open && [...combined].length <= limit) chunks[chunks.length - 1] = combined;
    else chunks.push(sentence);
    open = true;
  }
  return chunks;
};

/** Text as utterances: whole sentences packed up to `limit`, long ones split at clauses. */
export const chunkSpeechText = (text, limit = SPEECH_CHUNK_LIMIT, language = "auto") => {
  const source = String(text || "");
  const sentences = splitSpeechSentenceRanges(source, language)
    .map(({ start, end }) => source.slice(start, end).replace(/\s+/gu, " ").trim());
  return packSentences(sentences, chunkLimit(limit));
};

// The text path: each sentence through the text pass, then packed. With
// several sections, each is its own run of entries under its label, and a
// section that says nothing is skipped.
const textQueue = (text, { pronunciations, language, sections }) => {
  const runs = Array.isArray(sections) && sections.length > 1
    ? sections.map((section) => ({ label: String(section?.label || "Section").slice(0, 80), text: String(section?.text ?? "") }))
    : [{ label: "", text }];
  const queue = [];
  const sectionStarts = [];
  for (const run of runs) {
    const spoken = splitSpeechSentenceRanges(run.text, language)
      .map(({ start, end }) => speakable(run.text.slice(start, end), { pronunciations }));
    const chunks = packSentences(spoken, SPEECH_CHUNK_LIMIT);
    if (!chunks.length) continue;
    sectionStarts.push({ index: queue.length, label: run.label });
    for (const chunk of chunks) queue.push({ text: chunk, unit: null, map: [], section: run.label });
  }
  return { queue, sectionStarts: sectionStarts.length > 1 ? sectionStarts : [] };
};

// One speech unit as entries: its spoken text split only when over the
// limit. Each entry's range starts where its words start in the block, so the
// entries tile the unit's range, and its map is re-based to its own text. An
// announcement has no range or map, but it reads the learner's terms as the
// rows under it do.
const unitEntries = (unit, pronunciations) => {
  const section = String(unit?.section ?? "").slice(0, 80);
  const { blockIndex = 0, start = 0, end = 0 } = unit?.unit || {};
  if (unit?.kind === "announcement") {
    const text = speakable(unit.text, { pronunciations });
    return splitSpokenSentence(text).map((piece) => ({ text: text.slice(piece.start, piece.end), unit: { blockIndex, start, end }, map: [], section }));
  }
  const spoken = speakableWithMap(unit?.text, { pronunciations, math: unit?.kind !== "code" });
  const map = composeMaps(spoken.map, unit?.map);
  const pieces = splitSpokenSentence(spoken.text, { kind: unit?.kind });
  return pieces.map((piece, index) => ({
    text: spoken.text.slice(piece.start, piece.end),
    unit: {
      blockIndex,
      start: index ? sourceOffsetAt(map, piece.start) : start,
      end: index < pieces.length - 1 ? sourceOffsetAt(map, pieces[index + 1].start) : end,
    },
    map: sliceMap(map, piece.start, piece.end),
    section,
  }));
};

// The units path: no unit shares an entry with another. A section starts at
// the first entry, at a unit marked `sectionStart` (or the next unit that says
// something, when that one says nothing), and where the label changes.
const unitQueue = (units, pronunciations) => {
  const queue = [];
  const sectionStarts = [];
  let startsSection = false;
  for (const unit of units) {
    startsSection = startsSection || unit?.sectionStart === true;
    const entries = unitEntries(unit, pronunciations);
    if (!entries.length) continue;
    const { section } = entries[0];
    if (!queue.length || startsSection || section !== queue.at(-1).section) sectionStarts.push({ index: queue.length, label: section });
    startsSection = false;
    for (const entry of entries) queue.push(entry);
  }
  return { queue, sectionStarts };
};

/**
 * What narration speaks (issue #100): queue entries `{ text, unit, map,
 * section }` and where each section starts. From a string (Selection, a
 * tutor's answer, the voice preview, Try it), entries have no unit and an
 * empty map. From speech units (a lecture's sentences), each entry keeps its
 * block range and a map from its text to the block.
 */
export const buildSpeechQueue = (input, { pronunciations = [], language = "auto", sections = [] } = {}) => (
  Array.isArray(input)
    ? unitQueue(input, pronunciations)
    : textQueue(String(input ?? ""), { pronunciations, language, sections })
);

// A heading, table row or list item heard as its own sentence ends with a
// full stop unless it already ends in punctuation. The tutor's Listen and
// lecture narration share it (issue #100).
export const TERMINAL_PUNCTUATION = /[.!?:;…)"”]$/u;

export const endSentence = (text) => (text && !TERMINAL_PUNCTUATION.test(text) ? `${text}.` : text);

const PREVIEW_TEXT = Object.freeze({
  de: "Dies ist eine Vorschau der ausgewählten Stimme.",
  en: "This is a preview of your selected study voice.",
  es: "Esta es una prueba de la voz seleccionada.",
  fr: "Ceci est un aperçu de la voix sélectionnée.",
  hi: "यह आपकी चुनी हुई अध्ययन आवाज़ का नमूना है।",
  it: "Questa è un'anteprima della voce selezionata.",
  ja: "選択した音声のプレビューです。",
  ko: "선택한 음성의 미리 듣기입니다.",
  pt: "Esta é uma prévia da voz selecionada.",
  zh: "这是所选学习语音的试听。",
});

/**
 * Settings lines as overrides: each line splits at its first `=`, so
 * `SQL = sequel = query` says "sequel = query" and `um =` skips "um". A line
 * without `=` or with an empty term is ignored.
 */
export const parsePronunciationLines = (text) => normalizePronunciations(String(text ?? "").split("\n").flatMap((line) => {
  const at = line.indexOf("=");
  return at < 0 ? [] : [{ term: line.slice(0, at), spoken: line.slice(at + 1) }];
}));

/** Equal override lists once normalized, order included. */
export const samePronunciations = (left, right) => {
  const a = normalizePronunciations(left);
  const b = normalizePronunciations(right);
  return a.length === b.length && a.every((entry, index) => entry.term === b[index].term && entry.spoken === b[index].spoken);
};

// How narration reads code blocks and tables (issue #100); the first is the
// default.
export const NARRATION_CODE_MODES = Object.freeze(["announce", "skip", "read"]);
export const NARRATION_TABLE_MODES = Object.freeze(["rows", "announce"]);

export const speechPreviewText = (language, selectedVoice) => {
  const candidate = normalizeSpeechLanguage(selectedVoice?.lang || language);
  return PREVIEW_TEXT[candidate.split("-")[0]] || PREVIEW_TEXT.en;
};

// The app has one speech session. The tutors label theirs so they can tell
// their own reading from a lecture's (TFEAT-09), and App leaves a tutor's
// narration messages to the tutor's own controls (issue #97).
export const TUTOR_SPEECH_LABEL = "Tutor answer";
// Settings' Try it speaks under its own label, so it never passes for the
// open lecture's reading (issue #100).
export const PRONUNCIATION_TEST_LABEL = "Pronunciation test";

/**
 * Where narration voices come from (issue #97). Each browser speaks with the
 * voices its platform offers, so the wording names the platform the learner
 * is on. iPadOS asks for desktop sites with a Mac user agent; only its touch
 * points tell it apart from a Mac (headless phone emulation reports one).
 */
export const speechPlatform = (nav = globalThis.navigator) => {
  const agent = String(nav?.userAgent || "");
  const platform = String(nav?.platform || "");
  if (/iPhone|iPad|iPod/u.test(agent) || /^(?:iPhone|iPad|iPod)/u.test(platform)) return "ios";
  if (/Android/u.test(agent)) return "android";
  if (/^Mac/u.test(platform) || /Macintosh/u.test(agent)) return Number(nav?.maxTouchPoints) > 1 ? "ios" : "mac";
  if (/^Win/u.test(platform) || /Windows/u.test(agent)) return "windows";
  return "other";
};

const NEUTRAL_SPEECH_COPY = Object.freeze({
  microcopy: "Voices come from this device and browser. “On device” voices can work offline; voices marked “Network” can depend on online services. Pitch support varies by voice.",
  networkVoice: "availability and privacy depend on this browser",
  loading: "Asking this browser for its voice list…",
  empty: "This browser has not reported any voices. Refresh the list, or try another browser on this device.",
  noMatch: "No reported voice matches this language. Choose All languages.",
  unsupported: "Web Speech is unavailable in this browser. Open Lumen in a current version of Safari, Chrome, Edge or Firefox; no server audio fallback is used.",
  notAllowed: "Narration was blocked: the browser starts speech only after a tap.",
  languageUnavailable: "The selected language is unavailable in this browser. Choose All languages or another language.",
  resumeFailed: "This voice could not resume reliably. Tap Resume once more to replay the current sentence.",
  pauseFailed: "This voice could not be paused. Stop playback or move by sentence instead.",
});

// Safari on iOS and iPadOS offers only the voices built into the system:
// voices downloaded in Settings → Accessibility → Spoken Content (Enhanced
// and Premium) are not exposed to Web Speech, so the copy never sends the
// learner there to fix an empty or missing list.
export const SPEECH_COPY = Object.freeze({
  ios: Object.freeze({
    microcopy: "Safari offers the voices built into iOS; voices downloaded in Settings may not appear here. “On device” voices can work offline; voices marked “Network” can depend on Apple services. Pitch support varies by voice.",
    networkVoice: "availability and privacy depend on iOS",
    loading: "Asking iOS for its built-in voice list…",
    empty: "iOS has not reported any voices yet. Refresh the list; Safari offers the voices built into iOS, not voices downloaded in Settings.",
    noMatch: "No voice built into iOS matches this language. Choose All languages; voices downloaded in Settings may not appear here.",
    unsupported: "Web Speech is unavailable in this browser. Open Lumen in current Safari; no server audio fallback is used.",
    notAllowed: "Narration was blocked. Check that this iPhone or iPad is not in a restricted audio state; Safari starts speech only after a tap.",
    languageUnavailable: "The selected language is unavailable. Safari offers only the voices built into iOS, so choose All languages or another language.",
    resumeFailed: "Resume is not supported reliably by this iOS voice. Tap Resume once more to replay the current sentence.",
    pauseFailed: "This iOS voice could not be paused. Stop playback or move by sentence instead.",
  }),
  mac: Object.freeze({
    ...NEUTRAL_SPEECH_COPY,
    microcopy: "Voices come from macOS and this browser. “On device” voices can work offline; voices marked “Network” can depend on online services. Pitch support varies by voice.",
    networkVoice: "availability and privacy depend on macOS and this browser",
    loading: "Asking macOS and this browser for their voice list…",
    empty: "macOS has not reported any voices to this browser. Refresh the list, or try another browser on this Mac.",
  }),
  windows: NEUTRAL_SPEECH_COPY,
  android: NEUTRAL_SPEECH_COPY,
  other: NEUTRAL_SPEECH_COPY,
});

export const speechCopy = (platform) => SPEECH_COPY[platform] || NEUTRAL_SPEECH_COPY;

const RETRY_HINT = "Tap Retry to try it again.";

// `retry`: the learner has a Retry control for this sentence (the Reader's
// player and Listen panel keep a failed sentence's queue, issue #97). A
// blocked or failed sentence then says to tap it; a tutor's reading, which
// has no Retry, gets the message alone.
export const speechErrorMessage = (code, platform = "other", { retry = false } = {}) => {
  const copy = speechCopy(platform);
  const hint = retry ? ` ${RETRY_HINT}` : "";
  switch (String(code || "")) {
    case "not-allowed": return `${copy.notAllowed}${hint}`;
    case "voice-unavailable": return "That voice is no longer available. Choose another voice or refresh the list.";
    case "language-unavailable": return copy.languageUnavailable;
    case "network": return "This voice needs a network resource that is unavailable. Choose a voice marked On device for offline listening.";
    case "audio-busy": return "Another app or browser tab is using speech output. Stop it, then try again.";
    case "text-too-long": return `This reading target exceeds ${SPEECH_TEXT_LIMIT.toLocaleString()} characters. Use Sentence, Section, or Selection mode.`;
    default: return `This sentence could not be spoken${code ? ` (${String(code).replaceAll("-", " ")})` : ""}.${hint}`;
  }
};

/** A narration speed as the learner chose it: 1.25×, 0.8×, 1× (issue #97, NM4). */
export const formatSpeechRate = (value) => {
  const numeric = Number(value);
  return `${Number((Number.isFinite(numeric) ? numeric : 1).toFixed(2))}×`;
};
