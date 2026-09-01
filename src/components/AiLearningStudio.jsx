import { lazy, Suspense, useState } from "react";
import { Cpu, Laptop, ShieldCheck } from "lucide-react";
import { recoverableImport } from "../lib/chunkRecovery.js";
import "../ai-learning-studio.css";

const AiTutor = lazy(() => recoverableImport(() => import("./AiTutor")));
const PhoneLocalAiTutor = lazy(() => recoverableImport(() => import("./PhoneLocalAiTutor")));

export const AI_ENGINE_OPTIONS = Object.freeze([
  {
    id: "mac-local",
    title: "Mac local · Recommended",
    detail: "Qwen runs through Ollama on your Mac. Best quality and speed for detailed study work.",
  },
  {
    id: "phone-local",
    title: "On-device Lite",
    detail: "A small model runs inside Safari. Works without a paid API, but is slower and less capable.",
  },
]);

export default function AiLearningStudio(props) {
  const [engineMode, setEngineMode] = useState("mac-local");
  const [phoneInteractionLocked, setPhoneInteractionLocked] = useState(false);

  return (
    <section className="ai-learning-studio" data-ai-engine={engineMode}>
      <div className="ai-engine-picker" role="group" aria-labelledby="ai-engine-picker-title">
        <div className="ai-engine-picker__heading">
          <div>
            <span className="eyebrow">Inference location</span>
            <h2 id="ai-engine-picker-title">Choose where the tutor runs</h2>
          </div>
          <span className="ai-engine-picker__privacy"><ShieldCheck size={16} aria-hidden="true" /> No paid model API</span>
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
                disabled={engineMode === "phone-local" && phoneInteractionLocked}
                onClick={() => { if (!phoneInteractionLocked) setEngineMode(option.id); }}
              >
                <Icon size={20} aria-hidden="true" />
                <span><strong>{option.title}</strong><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>
        <p className="ai-engine-picker__note">
          Switching engines never starts a model download. On-device Lite asks separately before downloading its approximately 710 MB model. Its conversation remains only in memory until this page reloads; switching engines preserves it, and leaving phone mode releases GPU memory.
        </p>
      </div>

      {engineMode === "mac-local" ? (
        <Suspense fallback={<div className="view-loading" role="status">Opening the Mac-local tutor…</div>}>
          <AiTutor {...props} />
        </Suspense>
      ) : (
        <Suspense fallback={<div className="view-loading" role="status">Opening the on-device workspace…</div>}>
          <PhoneLocalAiTutor
            sources={props.sources}
            retrieveLibrary={props.retrieveLibrary}
            initialHistory={props.phoneSessionHistory}
            onHistoryChange={props.onPhoneSessionHistoryChange}
            onNavigateSource={props.onNavigateSource}
            onCreateFlashcardDrafts={props.onCreateFlashcardDrafts}
            onNotify={props.onNotify}
            onInteractionChange={setPhoneInteractionLocked}
          />
        </Suspense>
      )}
    </section>
  );
}
