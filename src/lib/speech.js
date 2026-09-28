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

const splitOversizedToken = (token, limit) => {
  const characters = [...token];
  const pieces = [];
  for (let index = 0; index < characters.length; index += limit) pieces.push(characters.slice(index, index + limit).join(""));
  return pieces;
};

const packSpeechParts = (parts, limit, output) => {
  let current = "";
  const flush = () => {
    if (current) output.push(current);
    current = "";
  };
  parts.forEach((rawPart) => {
    const part = String(rawPart || "").trim();
    if (!part) return;
    const pieces = [...part].length > limit ? splitOversizedToken(part, limit) : [part];
    pieces.forEach((piece) => {
      const candidate = `${current} ${piece}`.trim();
      if ([...candidate].length <= limit) current = candidate;
      else {
        flush();
        current = piece;
      }
    });
  });
  flush();
};

export const chunkSpeechText = (text, limit = SPEECH_CHUNK_LIMIT, language = "auto") => {
  const safeLimit = Math.max(40, Math.min(1_000, Math.floor(Number(limit) || SPEECH_CHUNK_LIMIT)));
  const chunks = [];
  splitSpeechSentences(text, language).forEach((sentence) => {
    if ([...sentence].length <= safeLimit) {
      const previous = chunks.at(-1);
      const combined = previous ? `${previous} ${sentence}` : sentence;
      if (previous && [...combined].length <= safeLimit) chunks[chunks.length - 1] = combined;
      else chunks.push(sentence);
      return;
    }
    // Preserve punctuation attached to words. Intl word segmentation exposes
    // punctuation as separate records, and joining those records with spaces
    // changes abbreviations and can alter a synthesizer's prosody. Languages
    // without spaces are still safely divided by splitOversizedToken.
    packSpeechParts(sentence.split(/\s+/u), safeLimit, chunks);
  });
  return chunks;
};

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
 * Pronunciation overrides (AUDIO-001): learner-defined replacements applied
 * to narration text before chunking. Whole-word, case-insensitive, single
 * pass (a replacement never re-triggers another term), bounded to 50 terms.
 */
export const MAX_PRONUNCIATIONS = 50;

export const normalizePronunciations = (value) => (Array.isArray(value) ? value : [])
  .filter((entry) => entry && typeof entry.term === "string" && typeof entry.spoken === "string" && entry.term.trim() && entry.spoken.trim())
  .map((entry) => ({ term: entry.term.trim().slice(0, 60), spoken: entry.spoken.trim().slice(0, 120) }))
  .filter((entry, index, list) => list.findIndex((other) => other.term.toLocaleLowerCase() === entry.term.toLocaleLowerCase()) === index)
  .slice(0, MAX_PRONUNCIATIONS);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const applyPronunciations = (text, pronunciations) => {
  const list = normalizePronunciations(pronunciations);
  if (!list.length) return String(text || "");
  let output = String(text || "");
  for (const { term, spoken } of list) {
    const boundary = /^[a-z0-9]/i.test(term) && /[a-z0-9]$/i.test(term);
    const pattern = new RegExp(boundary ? `\\b${escapeRegExp(term)}\\b` : escapeRegExp(term), "gi");
    output = output.replace(pattern, spoken);
  }
  return output;
};

export const speechPreviewText = (language, selectedVoice) => {
  const candidate = normalizeSpeechLanguage(selectedVoice?.lang || language);
  return PREVIEW_TEXT[candidate.split("-")[0]] || PREVIEW_TEXT.en;
};

// The app has one speech session. The tutors label theirs so they can tell
// their own reading from a lecture's (TFEAT-09), and App leaves a tutor's
// narration messages to the tutor's own controls (issue #97).
export const TUTOR_SPEECH_LABEL = "Tutor answer";

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
