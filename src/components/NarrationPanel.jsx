import {
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  X,
} from "lucide-react";
import {
  SPEECH_SCOPES,
  selectSpeechVoice,
  speechLanguageLabel,
  voiceMatchesLanguage,
} from "../lib/speech.js";

const voiceValue = (voice) => voice?.voiceURI || "";

const voiceLabel = (voice) => {
  const qualities = [];
  if (voice.default) qualities.push("Default");
  qualities.push(voice.localService ? "On device" : "May use network");
  return `${voice.name || "System voice"} · ${qualities.join(" · ")}`;
};

export default function NarrationPanel({
  settings,
  speech,
  hasSelection,
  target,
  onSettingsChange,
  onRead,
  onClose,
  audioBookmarks = [],
  onPlayBookmark,
  onDeleteBookmark,
  panelRef,
}) {
  const active = speech.status === "speaking" || speech.status === "paused";
  const matchingVoiceValues = new Set(speech.voiceGroups.flatMap((group) => group.voices.map(voiceValue)));
  const selectedValue = matchingVoiceValues.has(voiceValue(speech.selectedVoice)) ? voiceValue(speech.selectedVoice) : "";

  const changeLanguage = (nextLanguage) => {
    const candidates = speech.voices.filter((voice) => voiceMatchesLanguage(voice, nextLanguage));
    const preferred = selectSpeechVoice(candidates, { language: nextLanguage });
    onSettingsChange({ speechLanguage: nextLanguage, voiceURI: voiceValue(preferred) });
  };

  return (
    <div ref={panelRef} id="reader-narration-panel" className="reader-popover speech-popover" role="dialog" aria-labelledby="reader-narration-title">
      <div className="popover-heading">
        <div>
          <span className="eyebrow">Listen</span>
          <strong id="reader-narration-title">{speech.supported ? `${speech.voices.length} device voice${speech.voices.length === 1 ? "" : "s"} available` : "Speech is unavailable"}</strong>
        </div>
        <button className="icon-button small" onClick={onClose} aria-label="Close narration" type="button"><X size={17} /></button>
      </div>

      <fieldset className="speech-scope-fieldset">
        <legend>Read</legend>
        <div className="speech-scope-grid" role="radiogroup" aria-label="Narration target">
          {SPEECH_SCOPES.map((scope) => (
            <button
              className={settings.speechScope === scope.id ? "active" : ""}
              key={scope.id}
              onClick={() => onSettingsChange({ speechScope: scope.id })}
              role="radio"
              aria-checked={settings.speechScope === scope.id}
              aria-label={scope.id === "selection" && !hasSelection ? "Selection, select lecture text first" : scope.shortLabel}
              type="button"
            >
              {scope.label}
              {scope.id === "selection" && hasSelection && <span aria-hidden="true">Ready</span>}
            </button>
          ))}
        </div>
        <p className={target.available ? "speech-target-status" : "speech-target-status warning"}>
          {target.available ? `${target.label} · ${target.text.length.toLocaleString()} characters` : target.reason}
        </p>
      </fieldset>

      {/* Play and transport sit right under the target so they stay above
          the fold on phones; voice and sound settings follow. */}
      <div className="speech-controls">
        {active ? (
          <>
            <button className="icon-button" onClick={speech.previous} disabled={!speech.canPrevious} aria-label="Previous narration sentence" type="button"><SkipBack size={18} /></button>
            <button className="button primary" onClick={speech.togglePause} disabled={!speech.canPause && speech.status !== "paused"} type="button">{speech.status === "paused" ? <Play size={18} /> : <Pause size={18} />} {speech.status === "paused" ? "Resume" : "Pause"}</button>
            <button className="icon-button" onClick={speech.next} disabled={!speech.canNext} aria-label="Next narration sentence" type="button"><SkipForward size={18} /></button>
            <button className="button secondary" onClick={speech.stop} type="button"><Square size={16} fill="currentColor" /> Stop</button>
            <span className="speech-count">{speech.progress.current + 1}/{speech.progress.total}</span>
          </>
        ) : (
          <>
            <button className="button primary" onClick={onRead} disabled={!speech.supported || !target.available} type="button"><Play size={18} fill="currentColor" /> Read {target.label.toLocaleLowerCase()}</button>
            <button className="button secondary" onClick={speech.preview} disabled={!speech.supported} type="button"><Volume2 size={17} /> Test voice</button>
          </>
        )}
      </div>

      <div className="speech-choice-grid">
        <label>
          <span>Language</span>
          <select
            value={settings.speechLanguage}
            onChange={(event) => changeLanguage(event.target.value)}
            disabled={!speech.supported}
            aria-label="Narration language"
          >
            <option value="auto">All languages ({speech.voices.length})</option>
            {speech.languages.map((item) => (
              <option value={item.id} key={item.id}>{speechLanguageLabel(item.id)} · {item.count}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Voice</span>
          <select
            value={selectedValue}
            onChange={(event) => onSettingsChange({ voiceURI: event.target.value })}
            disabled={!speech.supported || !speech.matchingVoiceCount}
            aria-label="Narration voice"
          >
            {!speech.matchingVoiceCount && <option value="">System default</option>}
            {speech.voiceGroups.map((group) => (
              <optgroup label={speechLanguageLabel(group.id)} key={group.id}>
                {group.voices.map((voice, index) => (
                  <option value={voiceValue(voice)} key={`${voiceValue(voice)}-${voice.name}-${index}`}>{voiceLabel(voice)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {speech.selectedVoice && (
        <div className="speech-voice-detail">
          <Volume2 size={16} />
          <span><strong>{speech.selectedVoice.name}</strong>{speech.selectedVoice.lang} · {speech.selectedVoice.localService ? "reported on device" : "availability and privacy depend on iOS"}</span>
        </div>
      )}

      {speech.availabilityReason && (
        <div className="speech-availability" role="status">
          <span>{speech.availabilityReason}</span>
          {speech.supported && <button className="text-button" onClick={speech.refreshVoices} type="button"><RefreshCw size={15} /> Refresh</button>}
        </div>
      )}

      <div className="range-grid speech-range-grid">
        <label>
          <span>Speed <output>{Number(settings.speechRate).toFixed(1)}×</output></span>
          <input aria-label="Narration speed" type="range" min="0.6" max="1.6" step="0.1" value={settings.speechRate} onChange={(event) => onSettingsChange({ speechRate: Number(event.target.value) })} />
        </label>
        <label>
          <span>Pitch <output>{Number(settings.speechPitch).toFixed(1)}</output></span>
          <input aria-label="Narration pitch" type="range" min="0.7" max="1.3" step="0.1" value={settings.speechPitch} onChange={(event) => onSettingsChange({ speechPitch: Number(event.target.value) })} />
        </label>
        <label>
          <span>Volume <output>{Math.round(Number(settings.speechVolume) * 100)}%</output></span>
          <input aria-label="Narration volume" type="range" min="0" max="1" step="0.1" value={settings.speechVolume} onChange={(event) => onSettingsChange({ speechVolume: Number(event.target.value) })} />
        </label>
      </div>

      <div className="speech-preset-row" aria-label="Narration speed presets">
        {[{ label: "Calm", value: 0.8 }, { label: "Natural", value: 1 }, { label: "Review", value: 1.25 }].map((preset) => (
          <button className={Math.abs(settings.speechRate - preset.value) < 0.01 ? "active" : ""} onClick={() => onSettingsChange({ speechRate: preset.value })} key={preset.label} type="button">{preset.label} <span>{preset.value}×</span></button>
        ))}
        <button onClick={() => onSettingsChange({ speechRate: 1, speechPitch: 1, speechVolume: 1 })} aria-label="Reset narration sound" title="Reset speed, pitch, and volume" type="button"><RotateCcw size={15} /></button>
      </div>

      {audioBookmarks.length > 0 && (
        <div className="speech-bookmarks" aria-label="Audio bookmarks">
          <span className="speech-bookmarks-title">Audio bookmarks</span>
          {audioBookmarks.slice(0, 6).map((bookmark) => (
            <div className="speech-bookmark-row" key={bookmark.id}>
              <button className="speech-bookmark-play" onClick={() => onPlayBookmark?.(bookmark)} title="Play the full lecture from this sentence" type="button"><Play size={13} /> <span>{bookmark.snippet || `Sentence ${bookmark.index + 1}`}</span></button>
              <button className="icon-button small" onClick={() => onDeleteBookmark?.(bookmark.id)} aria-label="Delete this audio bookmark" type="button"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="speech-sleep-row speech-autoadvance-row">
        <span>Playlist</span>
        <label className="setting-toggle">
          <span>Continue into the next chapter</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.narrationAutoAdvance === true}
            onChange={(event) => onSettingsChange({ narrationAutoAdvance: event.target.checked })}
            aria-label="Continue narration into the next chapter of this Part"
          />
        </label>
      </div>

      <div className="speech-sleep-row" role="radiogroup" aria-label="Sleep timer">
        <span>Sleep timer</span>
        {[0, 10, 20, 30].map((minutes) => (
          <button
            className={speech.sleepMinutes === minutes ? "active" : ""}
            key={minutes}
            onClick={() => speech.startSleepTimer(minutes)}
            role="radio"
            aria-checked={speech.sleepMinutes === minutes}
            type="button"
          >
            {minutes === 0 ? "Off" : `${minutes} min`}
          </button>
        ))}
      </div>

      <div className="speech-live" role="status" aria-live="polite">
        {speech.currentText && <p className="speech-current"><strong>{speech.activeLabel}</strong>{speech.currentText}</p>}
        {speech.error && <p className="inline-warning">{speech.error}</p>}
      </div>
      <p className="microcopy">Voices come from iOS. “On device” voices can work offline; voices marked “May use network” can depend on Apple services. Pitch support varies by voice.</p>
    </div>
  );
}
