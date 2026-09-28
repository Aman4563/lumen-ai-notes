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
  onQueueComplete,
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
  // Sleep timer (AUDIO-001): the armed length and, once a Read starts, its
  // deadline. Stopping keeps both; expiry, Off, or unmount clear them.
  const sleepDeadlineRef = useRef(0);
  const sleepMinutesRef = useRef(0);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const liveCancelRef = useRef(false);

  configRef.current = { voiceURI, language: normalizeSpeechLanguage(language), rate, pitch, volume, pronunciations };
  voicesRef.current = voices;
  statusRef.current = status;
  const onQueueCompleteRef = useRef(null);
  onQueueCompleteRef.current = onQueueComplete;
  const activeLabelRef = useRef("");

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
      // A voice missing on this device is never written back: settings sync
      // between devices with different voice lists, and selectSpeechVoice
      // already falls back at speak time. Only a choice in the panel changes
      // voiceURI.
      if (available.length) {
        clearTimeout(emptyTimer);
        setVoiceState("ready");
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
  }, [supported]);

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
    activeLabelRef.current = "";
    setProgress({ current: 0, total: 0 });
    updateStatus("idle");
  }, [clearResumeTimer, updateStatus]);

  // Sleep timer (AUDIO-001): expire between sentences, never mid-utterance.
  const endIfSleepLapsed = useCallback(() => {
    if (!sleepDeadlineRef.current || Date.now() < sleepDeadlineRef.current) return false;
    sleepDeadlineRef.current = 0;
    sleepMinutesRef.current = 0;
    setSleepMinutes(0);
    finish();
    setError("The sleep timer ended narration at a sentence boundary.");
    return true;
  }, [finish]);

  // Returns true only when an utterance was handed to the engine.
  const playIndex = useCallback((index, session) => {
    if (!supported || session !== sessionRef.current) return false;
    const queue = queueRef.current;
    if (index >= queue.length) {
      // Natural completion only — stop() and the sleep timer never fire this.
      const completedLabel = activeLabelRef.current;
      finish();
      onQueueCompleteRef.current?.({ label: completedLabel });
      return false;
    }
    if (endIfSleepLapsed()) return false;

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
      return true;
    } catch (speechError) {
      utteranceRef.current = null;
      updateStatus("error");
      setError(speechErrorMessage(speechError?.name || "synthesis-failed"));
      return false;
    }
  }, [clearResumeTimer, endIfSleepLapsed, finish, supported, updateStatus]);

  // WebKit before 27 drops an utterance that speak() queues in the same task
  // as a cancel() of live speech ("cancel() removed utterances queued by
  // subsequent speak() calls", fixed in WebKit 27.0). Remember a real cancel
  // until the task ends so the next utterance can wait for the next task.
  const cancelEngine = useCallback(() => {
    const synthesis = window.speechSynthesis;
    if (synthesis.speaking || synthesis.pending) {
      liveCancelRef.current = true;
      setTimeout(() => { liveCancelRef.current = false; }, 0);
    }
    synthesis.cancel();
  }, []);

  // Plays `index` after cancelEngine(). Only after a real cancel does the
  // utterance wait a task; the first speak stays inside the tap, which iOS
  // needs to unlock audio. The session guard drops a superseded deferral.
  // The status says "speaking" at once, as it would for an immediate speak,
  // so callers that treat idle as "finished" (the tutor's Listen) do not
  // end the reading they just started.
  const playAfterCancel = useCallback((index, session) => {
    if (!liveCancelRef.current) return playIndex(index, session);
    indexRef.current = index;
    updateStatus("speaking");
    setTimeout(() => playIndex(index, session), 0);
    return true;
  }, [playIndex, updateStatus]);

  const stop = useCallback(() => {
    clearResumeTimer();
    sessionRef.current += 1;
    if (supported) cancelEngine();
    utteranceRef.current = null;
    queueRef.current = [];
    indexRef.current = 0;
    sectionStartsRef.current = [];
    restartRequiredRef.current = false;
    setCurrentText("");
    setActiveLabel("");
    activeLabelRef.current = "";
    updateStatus(supported ? "idle" : "unsupported");
    setProgress({ current: 0, total: 0 });
    setError("");
  }, [cancelEngine, clearResumeTimer, supported, updateStatus]);

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
    cancelEngine();
    queueRef.current = queue;
    sectionStartsRef.current = sectionStarts;
    indexRef.current = 0;
    restartRequiredRef.current = false;
    if (!queue.length) {
      finish();
      setError("There is no readable text in this target.");
      return false;
    }
    // Every Read starts a fresh sleep countdown. A playlist continuing into
    // the next chapter (`continueSession`) is the same listening session, so
    // it keeps the running deadline and ends where that deadline falls.
    if (sleepMinutesRef.current && !(options.continueSession && sleepDeadlineRef.current)) {
      sleepDeadlineRef.current = Date.now() + sleepMinutesRef.current * 60_000;
    }
    if (endIfSleepLapsed()) return false;
    activeLabelRef.current = String(options.label || "Narration").slice(0, 80);
    setActiveLabel(activeLabelRef.current);
    // `resolveStart(queue, sectionStarts)` places the start in the queue as
    // built here, after pronunciation overrides (saved positions).
    const requested = typeof options.resolveStart === "function" ? options.resolveStart(queue, sectionStarts) : options.startIndex;
    const startIndex = Number.isInteger(requested) ? Math.max(0, Math.min(queue.length - 1, requested)) : 0;
    // True when the utterance was issued, or scheduled for the next task
    // after a real cancel (see playAfterCancel).
    return playAfterCancel(startIndex, sessionRef.current);
  }, [cancelEngine, clearResumeTimer, endIfSleepLapsed, finish, playAfterCancel, supported, updateStatus]);

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
    cancelEngine();
    playAfterCancel(nextIndex, sessionRef.current);
    return true;
  }, [cancelEngine, clearResumeTimer, playAfterCancel, supported]);

  const next = useCallback(() => seek(indexRef.current + 1), [seek]);
  const previous = useCallback(() => seek(indexRef.current - 1), [seek]);

  const togglePause = useCallback(() => {
    if (!supported) return false;
    if (statusRef.current === "paused") {
      // Resuming after the sleep deadline passed re-arms the timer, so the
      // learner's tap is not ended at the next sentence boundary.
      if (sleepMinutesRef.current && sleepDeadlineRef.current && Date.now() >= sleepDeadlineRef.current) {
        sleepDeadlineRef.current = Date.now() + sleepMinutesRef.current * 60_000;
      }
      if (restartRequiredRef.current || typeof window.speechSynthesis.resume !== "function") {
        sessionRef.current += 1;
        cancelEngine();
        playAfterCancel(indexRef.current, sessionRef.current);
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
            cancelEngine();
            playAfterCancel(indexRef.current, sessionRef.current);
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
  }, [cancelEngine, playAfterCancel, supported, updateStatus]);

  const suspendForBackground = useCallback(() => {
    if (!supported || !queueRef.current.length || !["speaking", "paused"].includes(statusRef.current)) return;
    clearResumeTimer();
    sessionRef.current += 1;
    cancelEngine();
    utteranceRef.current = null;
    restartRequiredRef.current = true;
    updateStatus("paused");
    setError("Playback paused when Lumen left the foreground. Tap Resume to replay the current sentence; Lumen will not start audio in the background.");
  }, [cancelEngine, clearResumeTimer, supported, updateStatus]);

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
    sleepDeadlineRef.current = 0;
    sleepMinutesRef.current = 0;
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
    sleepMinutesRef.current = value;
    setSleepMinutes(value);
    // Armed while listening, the countdown starts now; armed while idle, it
    // starts with the next Read (speak sets the deadline).
    const listening = statusRef.current === "speaking" || statusRef.current === "paused";
    sleepDeadlineRef.current = value && listening ? Date.now() + value * 60_000 : 0;
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
    // The label of the section being read (full-lecture queues), which saved
    // positions use to find their place again.
    sectionLabel: progress.total ? sectionStartsRef.current.filter((section) => section.index <= progress.current).at(-1)?.label || "" : "",
    sleepMinutes,
    startSleepTimer,
    canNext: progress.total > 0 && progress.current < progress.total - 1,
    canPrevious: progress.total > 0 && progress.current > 0,
    canPause: supported && typeof window.speechSynthesis.pause === "function" && typeof window.speechSynthesis.resume === "function",
    supported,
  };
}
