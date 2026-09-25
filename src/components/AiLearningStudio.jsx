import { lazy, Suspense, useCallback, useState } from "react";
import { Cpu, Laptop } from "lucide-react";
import { recoverableImport } from "../lib/chunkRecovery.js";
import "../ai-learning-studio.css";

const AiTutor = lazy(() => recoverableImport(() => import("./AiTutor")));
const PhoneLocalAiTutor = lazy(() => recoverableImport(() => import("./PhoneLocalAiTutor")));

export const AI_ENGINE_OPTIONS = Object.freeze([
  {
    id: "mac-local",
    title: "Mac local",
    detail: "For detailed study",
  },
  {
    id: "phone-local",
    title: "On-device Lite",
    detail: "For short questions on this device",
  },
]);

// The engine choice is a per-browser UI preference, not study data: it stays
// out of the profile and backups and survives route changes and reloads.
const ENGINE_PREFERENCE_KEY = "lumen.ai.engine.v1";

const readEnginePreference = () => {
  try {
    const stored = globalThis.localStorage?.getItem(ENGINE_PREFERENCE_KEY);
    return AI_ENGINE_OPTIONS.some((option) => option.id === stored) ? stored : "mac-local";
  } catch {
    return "mac-local";
  }
};

const rememberEnginePreference = (engine) => {
  try {
    globalThis.localStorage?.setItem(ENGINE_PREFERENCE_KEY, engine);
  } catch {
    // Restricted storage only loses the preference, never the engine switch.
  }
};

export default function AiLearningStudio(props) {
  const [engineMode, setEngineModeState] = useState(readEnginePreference);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const setEngineMode = useCallback((engine) => {
    setEngineModeState(engine);
    rememberEnginePreference(engine);
  }, []);

  return (
    <section className="ai-learning-studio" data-ai-engine={engineMode}>
      <div className="ai-engine-picker" role="group" aria-labelledby="ai-engine-picker-title">
        <div className="ai-engine-picker__heading">
          <div>
            <h2 id="ai-engine-picker-title">Tutor engine</h2>
          </div>
        </div>
        <div className="ai-engine-picker__options">
          {AI_ENGINE_OPTIONS.map((option) => {
            const selected = engineMode === option.id;
            const Icon = option.id === "mac-local" ? Laptop : Cpu;
            return (
              <button
                key={option.id}
                type="button"
                className={selected ? "is-selected" : ""}
                aria-pressed={selected}
                data-ai-engine-option={option.id}
                disabled={interactionLocked}
                onClick={() => { if (!interactionLocked) setEngineMode(option.id); }}
              >
                <Icon size={20} aria-hidden="true" />
                <span><strong>{option.title}</strong><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>
        <details className="ai-engine-picker__note"><summary>About the engines</summary>
          <p>Mac local uses Ollama on your Mac. On-device Lite uses a smaller model on this device and asks before downloading about 710 MB. Its conversation clears on reload. Neither engine uses a paid model API.</p>
        </details>
      </div>

      {engineMode === "mac-local" ? (
        <Suspense fallback={<div className="view-loading" role="status">Opening the Mac-local tutor…</div>}>
          <AiTutor {...props} onInteractionChange={setInteractionLocked} onUseOnDevice={() => setEngineMode("phone-local")} />
        </Suspense>
      ) : (
        <Suspense fallback={<div className="view-loading" role="status">Opening the on-device workspace…</div>}>
          <PhoneLocalAiTutor
            sources={props.sources}
            insertPrompt={props.insertPrompt}
            onInsertConsumed={props.onInsertConsumed}
            retrieveLibrary={props.retrieveLibrary}
            initialHistory={props.phoneSessionHistory}
            onHistoryChange={props.onPhoneSessionHistoryChange}
            onNavigateSource={props.onNavigateSource}
            onCreateFlashcardDrafts={props.onCreateFlashcardDrafts}
            onSaveAnswerNote={props.onSaveAnswerNote}
            onNotify={props.onNotify}
            onInteractionChange={setInteractionLocked}
          />
        </Suspense>
      )}
    </section>
  );
}
