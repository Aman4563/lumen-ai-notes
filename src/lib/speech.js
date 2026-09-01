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

export const speechPreviewText = (language, selectedVoice) => {
  const candidate = normalizeSpeechLanguage(selectedVoice?.lang || language);
  return PREVIEW_TEXT[candidate.split("-")[0]] || PREVIEW_TEXT.en;
};

export const speechErrorMessage = (code) => {
  switch (String(code || "")) {
    case "not-allowed": return "Narration was blocked. Tap Play again and confirm the iPhone is not in a restricted audio state.";
    case "voice-unavailable": return "That voice is no longer available. Choose another installed voice or refresh the list.";
    case "language-unavailable": return "The selected language is unavailable. Install an iOS voice for that language or choose All languages.";
    case "network": return "This voice needs a network resource that is unavailable. Choose a voice marked On device for offline listening.";
    case "audio-busy": return "Another app or browser tab is using speech output. Stop it, then try again.";
    case "text-too-long": return `This reading target exceeds ${SPEECH_TEXT_LIMIT.toLocaleString()} characters. Use Sentence, Section, or Selection mode.`;
    default: return `Narration stopped${code ? ` (${String(code).replaceAll("-", " ")})` : " because speech synthesis failed"}.`;
  }
};
