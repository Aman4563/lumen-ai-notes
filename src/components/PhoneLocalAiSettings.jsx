import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Database, Download, LoaderCircle, ShieldCheck, Square, Trash2 } from "lucide-react";
import {
  getPhoneLocalAiEngine,
  PHONE_LOCAL_AI_DISCLOSURE,
  PHONE_LOCAL_MODEL,
} from "../lib/phoneLocalAi.js";
import "../phone-local-ai.css";

const formatBytes = (value) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const initialStatus = Object.freeze({ state: "checking", cached: false, loaded: false, consented: false, supported: false, reasons: [], warnings: [], storage: {} });

/**
 * Isolated settings surface. It intentionally does not select an AI provider;
 * App/AiTutor own that product decision. Pass the same engine instance to the
 * tutor adapter so this panel and the tutor share one worker/model lifecycle.
 */
export default function PhoneLocalAiSettings({ engine: providedEngine, onNotify, onStatusChange, interactionBusy = false }) {
  const engine = useMemo(() => providedEngine || getPhoneLocalAiEngine(), [providedEngine]);
  const mounted = useRef(true);
  const operationRef = useRef(false);
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState({ progress: 0, text: "" });
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState("");
  const [operationState, setOperationState] = useState("");

  const publish = useCallback((next) => {
    if (!mounted.current) return;
    setStatus(next);
    onStatusChange?.(next);
  }, [onStatusChange]);

  const refresh = useCallback(async ({ clearError = true } = {}) => {
    if (clearError) setError("");
    try { publish({ ...(await engine.inspect()), state: engine.state }); }
    catch (cause) {
      if (!mounted.current) return;
      setError(cause?.message || "On-device AI compatibility could not be checked.");
      publish({ ...initialStatus, state: "error" });
    }
  }, [engine, publish]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const unsubscribe = engine.subscribeLifecycle?.(() => {
      if (!operationRef.current) void refresh();
    });
    return () => {
      unsubscribe?.();
      mounted.current = false;
      if (engine.state === "loading") engine.cancel?.();
    };
  }, [engine, refresh]);

  const load = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationState("loading");
    setError("");
    if (!status.cached && !status.consented) {
      if (!consentChecked) {
        setError("Confirm the one-time model download before continuing.");
        operationRef.current = false;
        setOperationState("");
        return;
      }
      try { engine.grantDownloadConsent(); }
      catch (cause) { setError(cause.message); operationRef.current = false; setOperationState(""); return; }
    }
    publish({ ...status, state: "loading", consented: true });
    try {
      await engine.load({ onProgress: (next) => mounted.current && setProgress(next) });
      if (!mounted.current) return;
      onNotify?.("On-device Lite is loaded. Prompts can now run locally on this device.");
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      await refresh({ clearError: false });
      setError(cause?.message || "The phone model could not be loaded.");
    } finally { operationRef.current = false; setOperationState(""); }
  };

  const cancel = async () => {
    engine.cancel();
    setProgress({ progress: 0, text: "" });
    onNotify?.("On-device model loading or generation cancelled.", "warning");
    await refresh();
  };

  const unload = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationState("releasing");
    setError("");
    publish({ ...status, state: "releasing" });
    try {
      await engine.unload();
      onNotify?.("On-device model released from memory. Its downloaded files remain cached.");
      await refresh();
    } catch (cause) { await refresh({ clearError: false }); setError(cause?.message || "The model could not be released."); }
    finally { operationRef.current = false; setOperationState(""); }
  };

  const remove = async () => {
    if (operationRef.current) return;
    if (!window.confirm(`Delete the ${formatBytes(PHONE_LOCAL_MODEL.approximateDownloadBytes)} on-device model cache? It must be downloaded again to use On-device Lite.`)) return;
    operationRef.current = true;
    setOperationState("deleting");
    setError("");
    publish({ ...status, state: "deleting" });
    try {
      await engine.deleteModel();
      setConsentChecked(false);
      onNotify?.("On-device model files and their download consent were removed.");
      await refresh();
    } catch (cause) {
      await refresh({ clearError: false });
      setError(cause?.message || "The model cache could not be deleted.");
    } finally { operationRef.current = false; setOperationState(""); }
  };

  const busy = status.state === "checking" || status.state === "loading" || status.state === "releasing" || status.state === "deleting";
  const controlsBusy = busy || Boolean(operationState) || interactionBusy;
  const displayState = operationState || status.state;
  const storageAvailable = Number(status.storage?.available) || 0;
  return (
    <section className="phone-local-ai" aria-labelledby="phone-local-ai-title">
      <div className="phone-local-ai-heading">
        <span className="phone-local-ai-icon" aria-hidden="true"><Cpu size={20} /></span>
        <span><strong id="phone-local-ai-title">On-device Lite</strong><small>Free local inference · no LLM API key</small></span>
        <span className={`phone-local-ai-badge ${status.loaded ? "ready" : status.supported ? "available" : "blocked"}`}>
          {displayState === "deleting" ? "Deleting" : displayState === "releasing" ? "Releasing" : status.loaded ? "Loaded" : displayState === "checking" ? "Checking" : status.supported ? "Available" : "Unsupported"}
        </span>
      </div>

      <p className="phone-local-ai-copy">{PHONE_LOCAL_AI_DISCLOSURE.inference} {PHONE_LOCAL_AI_DISCLOSURE.limitations}</p>
      <dl className="phone-local-ai-facts">
        <div><dt>Model</dt><dd>{PHONE_LOCAL_MODEL.label}</dd></div>
        <div><dt>First download</dt><dd>about {formatBytes(PHONE_LOCAL_MODEL.approximateDownloadBytes)}</dd></div>
        <div><dt>GPU memory</dt><dd>about {formatBytes(PHONE_LOCAL_MODEL.approximateGpuMemoryBytes)} + overhead</dd></div>
        <div><dt>Context</dt><dd>{PHONE_LOCAL_MODEL.contextWindowTokens.toLocaleString()} tokens</dd></div>
        {status.storage?.known && <div><dt>Browser headroom</dt><dd>{formatBytes(storageAvailable)}</dd></div>}
      </dl>

      {status.reasons?.length > 0 && <div className="phone-local-ai-message error" role="alert"><strong>Cannot run on this browser</strong><ul>{status.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
      {status.supported && status.warnings?.length > 0 && <details className="phone-local-ai-message"><summary>Device and storage notes</summary><ul>{status.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}

      {!status.cached && status.supported && !status.consented && status.state !== "loading" && (
        <label className="phone-local-ai-consent">
          <input type="checkbox" checked={consentChecked} disabled={controlsBusy} onChange={(event) => setConsentChecked(event.target.checked)} />
          <span><strong>I approve this one-time large download.</strong><small>{PHONE_LOCAL_AI_DISCLOSURE.download} This approval is remembered for this model in this browser until you clear its files; it is not requested for every local answer.</small></span>
        </label>
      )}

      {status.state === "loading" && (
        <div className="phone-local-ai-progress" aria-live="polite">
          <div><span>{progress.text || "Preparing the on-device model…"}</span><strong>{Math.round((progress.progress || 0) * 100)}%</strong></div>
          <progress value={progress.progress || 0} max="1">{Math.round((progress.progress || 0) * 100)}%</progress>
        </div>
      )}

      {error && <p className="phone-local-ai-error" role="alert">{error}</p>}

      <div className="phone-local-ai-actions">
        {!status.loaded && status.state !== "loading" && <button type="button" className="button primary" onClick={load} disabled={controlsBusy || !status.supported || (!status.cached && !status.consented && !consentChecked)}><Download size={16} />{status.cached ? "Load model" : `Download & load (~${formatBytes(PHONE_LOCAL_MODEL.approximateDownloadBytes)})`}</button>}
        {status.state === "loading" && <button type="button" className="button danger" onClick={cancel}><Square size={15} /> Cancel</button>}
        {status.loaded && <button type="button" className="button ghost" onClick={unload} disabled={controlsBusy}><Square size={15} /> Release memory</button>}
        {(status.cached || status.consented || status.state === "error") && <button type="button" className="button ghost" onClick={remove} disabled={controlsBusy}><Trash2 size={16} /> Clear model files</button>}
        {status.state === "checking" && <span className="phone-local-ai-working"><LoaderCircle className="spin" size={16} /> Checking WebGPU and cache…</span>}
      </div>

      <div className="phone-local-ai-privacy"><ShieldCheck size={17} /><span><strong>Local answers need no repeated consent.</strong> A separate approval appears only when an exact live-search query would leave this device. Only <code>/api/local-search</code> may be called.</span></div>
      <div className="phone-local-ai-privacy"><Database size={17} /><span>Model files use this site's browser cache. “Clear model files” removes them without touching lessons, notes, reviews, or whiteboards.</span></div>
    </section>
  );
}
