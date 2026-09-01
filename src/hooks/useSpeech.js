import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SPEECH_TEXT_LIMIT,
  applyPronunciations,
  chunkSpeechText,
  groupSpeechVoices,
  normalizeSpeechLanguage,
  normalizeSpeechVoices,
  selectSpeechVoice,
  speechErrorMessage,
  speechLanguages,
  speechPreviewText,
  voiceMatchesLanguage,
} from "../lib/speech.js";

export { chunkSpeechText } from "../lib/speech.js";

const hasSpeechAPI = () => typeof window !== "undefined"
  && "speechSynthesis" in window
  && "SpeechSynthesisUtterance" in window;

const clamp = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
};

export function useSpeech({
  voiceURI,
  language = "auto",
  rate = 1,
  pitch = 1,
  volume = 1,
  pronunciations = [],
  onSettingsChange,
}) {
  const supported = hasSpeechAPI();
  const [voices, setVoices] = useState([]);
  const [voiceState, setVoiceState] = useState(supported ? "loading" : "unsupported");
  const [status, setStatus] = useState(supported ? "idle" : "unsupported");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentText, setCurrentText] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [error, setError] = useState("");
  const queueRef = useRef([]);
  const indexRef = useRef(0);
  const utteranceRef = useRef(null);
  const sessionRef = useRef(0);
  const statusRef = useRef(status);
  const voicesRef = useRef([]);
  const configRef = useRef({ voiceURI, language, rate, pitch, volume });
  const refreshVoicesRef = useRef(() => {});
  const restartRequiredRef = useRef(false);
  const resumeTimerRef = useRef(null);
  const sectionStartsRef = useRef([]);
  const sleepDeadlineRef = useRef(0);
  const [sleepMinutes, setSleepMinutes] = useState(0);

  configRef.current = { voiceURI, language: normalizeSpeechLanguage(language), rate, pitch, volume, pronunciations };
  voicesRef.current = voices;
  statusRef.current = status;

  const updateStatus = useCallback((nextStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    if (!supported) return undefined;
    let active = true;
    let emptyTimer;
    const load = () => {
      if (!active) return [];
      const available = normalizeSpeechVoices(window.speechSynthesis.getVoices?.() || []);
      voicesRef.current = available;
      setVoices(available);
      if (available.length) {
        clearTimeout(emptyTimer);
        setVoiceState("ready");
        const config = configRef.current;
        const matching = available.filter((voice) => voiceMatchesLanguage(voice, config.language));
        const preferred = selectSpeechVoice(available, config);
        if (preferred && (config.language === "auto" || matching.length) && preferred.voiceURI !== config.voiceURI) {
          onSettingsChange?.({ voiceURI: preferred.voiceURI });
        }
      }
      return available;
    };
    const markEmpty = () => {
      if (active && !voicesRef.current.length) setVoiceState("empty");
    };
    refreshVoicesRef.current = () => {
      setVoiceState("loading");
      const available = load();
      clearTimeout(emptyTimer);
      if (!available.length) emptyTimer = setTimeout(markEmpty, 1_200);
      return available;
    };
    load();
    emptyTimer = setTimeout(markEmpty, 1_500);
    const retryTimers = [120, 500, 1_100].map((delay) => setTimeout(load, delay));
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => {
      active = false;
      clearTimeout(emptyTimer);
      retryTimers.forEach(clearTimeout);
      window.speechSynthesis.removeEventListener?.("voiceschanged", load);
      refreshVoicesRef.current = () => {};
    };
  }, [onSettingsChange, supported]);

  const clearResumeTimer = useCallback(() => {
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = null;
  }, []);

  const finish = useCallback(() => {
    clearResumeTimer();
    utteranceRef.current = null;
    queueRef.current = [];
    indexRef.current = 0;
    sectionStartsRef.current = [];
    restartRequiredRef.current = false;
    setCurrentText("");
    setActiveLabel("");
    setProgress({ current: 0, total: 0 });
    updateStatus("idle");
  }, [clearResumeTimer, updateStatus]);

  const playIndex = useCallback((index, session) => {
    if (!supported || session !== sessionRef.current) return;
    const queue = queueRef.current;
    if (index >= queue.length) {
      finish();
      return;
    }

    // Sleep timer (AUDIO-001): expire between sentences, never mid-utterance.
    if (sleepDeadlineRef.current && Date.now() >= sleepDeadlineRef.current) {
      sleepDeadlineRef.current = 0;
      setSleepMinutes(0);
      finish();
      setError("The sleep timer ended narration at a sentence boundary.");
      return;
    }

    clearResumeTimer();
    restartRequiredRef.current = false;
    indexRef.current = index;
    const text = queue[index];
    const utterance = new window.SpeechSynthesisUtterance(text);
    const config = configRef.current;
    const selectedVoice = selectSpeechVoice(voicesRef.current, config);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else if (config.language !== "auto") utterance.lang = config.language;
    utterance.rate = clamp(config.rate, 0.6, 1.6, 1);
    utterance.pitch = clamp(config.pitch, 0.7, 1.3, 1);
    utterance.volume = clamp(config.volume, 0, 1, 1);
    utteranceRef.current = utterance;
    setCurrentText(text);
    setProgress({ current: index, total: queue.length });
    updateStatus("speaking");
    setError("");

    utterance.onstart = () => {
      if (session === sessionRef.current) updateStatus("speaking");
    };
    utterance.onpause = () => {
      if (session === sessionRef.current) updateStatus("paused");
    };
    utterance.onresume = () => {
      if (session === sessionRef.current) updateStatus("speaking");
    };
    utterance.onend = () => {
      if (session !== sessionRef.current) return;
      utteranceRef.current = null;
      playIndex(index + 1, session);
    };
    utterance.onerror = (event) => {
      if (session !== sessionRef.current || event.error === "canceled") return;
      utteranceRef.current = null;
      if (event.error === "interrupted") {
        restartRequiredRef.current = true;
        updateStatus("paused");
        setError("Narration was interrupted. Tap Resume to replay the current sentence safely.");
        return;
      }
      updateStatus("error");
      setError(speechErrorMessage(event.error));
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch (speechError) {
      utteranceRef.current = null;
      updateStatus("error");
      setError(speechErrorMessage(speechError?.name || "synthesis-failed"));
    }
  }, [clearResumeTimer, finish, supported, updateStatus]);

  const stop = useCallback(() => {
    clearResumeTimer();
    sessionRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    queueRef.current = [];
    indexRef.current = 0;
    sectionStartsRef.current = [];
    sleepDeadlineRef.current = 0;
    setSleepMinutes(0);
    restartRequiredRef.current = false;
    setCurrentText("");
    setActiveLabel("");
    updateStatus(supported ? "idle" : "unsupported");
    setProgress({ current: 0, total: 0 });
    setError("");
  }, [clearResumeTimer, supported, updateStatus]);

  const speak = useCallback((text, options = {}) => {
    if (!supported) {
      updateStatus("unsupported");
      setError("Narration is unavailable because this browser does not expose the Web Speech API. Use current Safari on iPhone or another supported browser.");
      return false;
    }
    const raw = String(text || "");
    if (raw.length > SPEECH_TEXT_LIMIT) {
      updateStatus("error");
      setError(speechErrorMessage("text-too-long"));
      return false;
    }
    const config = configRef.current;
    const spoken = (value) => applyPronunciations(value, config.pronunciations);
    // Section-aware queueing: each section's chunks are tracked by their
    // first index so heading skip can jump between sections.
    let queue;
    const sectionStarts = [];
    if (Array.isArray(options.sections) && options.sections.length > 1) {
      queue = [];
      for (const section of options.sections) {
        const chunks = chunkSpeechText(spoken(section.text), undefined, config.language);
        if (!chunks.length) continue;
        sectionStarts.push({ index: queue.length, label: String(section.label || "Section").slice(0, 80) });
        queue.push(...chunks);
      }
    } else {
      queue = chunkSpeechText(spoken(raw), undefined, config.language);
    }
    clearResumeTimer();
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    queueRef.current = queue;
    sectionStartsRef.current = sectionStarts;
    indexRef.current = 0;
    restartRequiredRef.current = false;
    if (!queue.length) {
      finish();
      setError("There is no readable text in this target.");
      return false;
    }
    setActiveLabel(String(options.label || "Narration").slice(0, 80));
    const startIndex = Number.isInteger(options.startIndex) ? Math.max(0, Math.min(queue.length - 1, options.startIndex)) : 0;
    playIndex(startIndex, sessionRef.current);
    return true;
  }, [clearResumeTimer, finish, playIndex, supported, updateStatus]);

  const selectedVoice = useMemo(
    () => selectSpeechVoice(voices, { voiceURI, language }),
    [language, voiceURI, voices],
  );

  const preview = useCallback(() => speak(
    speechPreviewText(configRef.current.language, selectSpeechVoice(voicesRef.current, configRef.current)),
    { label: "Voice preview" },
  ), [speak]);

  const seek = useCallback((index) => {
    if (!supported || !queueRef.current.length) return false;
    const nextIndex = Math.max(0, Math.min(queueRef.current.length - 1, index));
    clearResumeTimer();
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    playIndex(nextIndex, sessionRef.current);
    return true;
  }, [clearResumeTimer, playIndex, supported]);

  const next = useCallback(() => seek(indexRef.current + 1), [seek]);
  const previous = useCallback(() => seek(indexRef.current - 1), [seek]);

  const togglePause = useCallback(() => {
    if (!supported) return false;
    if (statusRef.current === "paused") {
      if (restartRequiredRef.current || typeof window.speechSynthesis.resume !== "function") {
        sessionRef.current += 1;
        window.speechSynthesis.cancel();
        playIndex(indexRef.current, sessionRef.current);
        return true;
      }
      try {
        window.speechSynthesis.resume();
        updateStatus("speaking");
        // Safari occasionally leaves a paused utterance wedged after resume.
        // Replay only the current short sentence when the native flag confirms
        // that resume did not take effect; never auto-play after an app switch.
        resumeTimerRef.current = setTimeout(() => {
          if (statusRef.current === "speaking" && window.speechSynthesis.paused === true) {
            sessionRef.current += 1;
            window.speechSynthesis.cancel();
            playIndex(indexRef.current, sessionRef.current);
          }
        }, 650);
        return true;
      } catch {
        restartRequiredRef.current = true;
        setError("Resume is not supported reliably by this iOS voice. Tap Resume once more to replay the current sentence.");
        return false;
      }
    }
    if (statusRef.current === "speaking") {
      if (typeof window.speechSynthesis.pause !== "function") {
        setError("This browser cannot pause narration. Stop playback or move by sentence instead.");
        return false;
      }
      try {
        window.speechSynthesis.pause();
        updateStatus("paused");
        return true;
      } catch {
        setError("This iOS voice could not be paused. Stop playback or move by sentence instead.");
      }
    }
    return false;
  }, [playIndex, supported, updateStatus]);

  const suspendForBackground = useCallback(() => {
    if (!supported || !queueRef.current.length || !["speaking", "paused"].includes(statusRef.current)) return;
    clearResumeTimer();
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    restartRequiredRef.current = true;
    updateStatus("paused");
    setError("Playback paused when Lumen left the foreground. Tap Resume to replay the current sentence; Lumen will not start audio in the background.");
  }, [clearResumeTimer, supported, updateStatus]);

  useEffect(() => {
    if (!supported) return undefined;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") suspendForBackground();
    };
    window.addEventListener("pagehide", suspendForBackground);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", suspendForBackground);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [supported, suspendForBackground]);

  useEffect(() => () => {
    clearResumeTimer();
    sessionRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
  }, [clearResumeTimer, supported]);

  const nextSection = useCallback(() => {
    const start = sectionStartsRef.current.find((section) => section.index > indexRef.current);
    return start ? seek(start.index) : false;
  }, [seek]);

  const previousSection = useCallback(() => {
    const starts = sectionStartsRef.current;
    // "Previous" returns to the current section's start first, then earlier.
    const currentStart = [...starts].reverse().find((section) => section.index <= indexRef.current);
    const target = currentStart && currentStart.index === indexRef.current
      ? [...starts].reverse().find((section) => section.index < indexRef.current)
      : currentStart;
    return target ? seek(target.index) : seek(0);
  }, [seek]);

  const startSleepTimer = useCallback((minutes) => {
    const value = [0, 10, 20, 30].includes(minutes) ? minutes : 0;
    setSleepMinutes(value);
    sleepDeadlineRef.current = value ? Date.now() + value * 60_000 : 0;
  }, []);

  const languages = useMemo(() => speechLanguages(voices), [voices]);
  const voiceGroups = useMemo(() => groupSpeechVoices(voices, language), [language, voices]);
  const matchingVoiceCount = voiceGroups.reduce((count, group) => count + group.voices.length, 0);
  const availabilityReason = useMemo(() => {
    if (!supported) return "Web Speech is unavailable in this browser. Open Lumen in current Safari on iPhone; no server audio fallback is used.";
    if (voiceState === "loading") return "Asking iOS for its installed voice list…";
    if (voiceState === "empty") return "iOS has not reported any voices. Refresh the list, then install a voice in Settings → Accessibility → Spoken Content → Voices if needed.";
    if (!matchingVoiceCount) return "No reported voice matches this language. Choose All languages or install another iOS voice.";
    return "";
  }, [matchingVoiceCount, supported, voiceState]);

  return {
    voices,
    voiceGroups,
    languages,
    voiceState,
    selectedVoice,
    matchingVoiceCount,
    availabilityReason,
    status,
    progress,
    currentText,
    activeLabel,
    error,
    speak,
    preview,
    stop,
    togglePause,
    next,
    previous,
    refreshVoices: () => refreshVoicesRef.current(),
    nextSection,
    previousSection,
    hasSections: (queueRef.current.length > 0) && sectionStartsRef.current.length > 1,
    sleepMinutes,
    startSleepTimer,
    canNext: progress.total > 0 && progress.current < progress.total - 1,
    canPrevious: progress.total > 0 && progress.current > 0,
    canPause: supported && typeof window.speechSynthesis.pause === "function" && typeof window.speechSynthesis.resume === "function",
    supported,
  };
}
