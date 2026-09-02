import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Copy, Download, Play, Send, Smartphone, XCircle } from "lucide-react";

/**
 * Physical-device evidence capture (issues #7/#17, A11Y-001/AUDIO-001).
 *
 * Three tiers of honesty:
 *  - AUTO checks probe what the browser reports and are machine-verified.
 *  - ASSISTED checks run real device behavior on one tap and record their
 *    own verdict from observed events — no human judgment involved.
 *  - HUMAN checks are the residue no script can honestly answer (VoiceOver
 *    behavior, audio routing, interruptions, restart survival).
 *
 * On the LAN serve, the page posts its auto-probe results to the Mac the
 * moment they exist and can send the full report the same way, so the
 * operator's machine verifies real-device capabilities remotely — no cable,
 * no WebDriver. Off the LAN serve the sends fail silently and the
 * download/copy paths still work. Unanswered checks always export empty.
 */
const HUMAN_CHECKS = [
  {
    id: "webllm-load",
    area: "On-device AI (issue #7)",
    criterion: "The On-device Lite model downloaded with consent, loaded into this browser, and completed one lesson answer with visible citations.",
  },
  {
    id: "webllm-reload",
    area: "On-device AI (issue #7)",
    criterion: "After a full Safari reload, the cached model loaded again without re-downloading. (The cache-presence probe above shows whether a model is stored; this check is about the reload behavior.)",
  },
  {
    id: "voice-route",
    area: "Narration routing (AUDIO-001)",
    criterion: "Mid-narration, audio followed a route change (speaker → Bluetooth/AirPods and back) without crashing or double-playing.",
  },
  {
    id: "voice-interrupt",
    area: "Narration interruption (AUDIO-001)",
    criterion: "An interruption (timer, call, or Siri) paused narration; returning to the app required one explicit tap to resume, and audio never auto-played from the background.",
  },
  {
    id: "voiceover-reader",
    area: "VoiceOver (A11Y-001)",
    criterion: "With VoiceOver on, the rotor navigates the Reader by headings, and lecture text reads in document order.",
  },
  {
    id: "voiceover-review",
    area: "VoiceOver (A11Y-001)",
    criterion: "With VoiceOver on, a review card can be revealed and graded; the grade buttons announce their labels and the result is spoken.",
  },
  {
    id: "voiceover-dialogs",
    area: "VoiceOver (A11Y-001)",
    criterion: "Opening a dialog moves VoiceOver focus into it, swiping cannot escape it, and closing returns focus to the opener.",
  },
  {
    id: "quota-eviction",
    area: "Storage (DATA-002)",
    criterion: "The workspace survived a full device restart. (Whether iOS granted persistent storage is machine-verified in the automatic checks above.)",
  },
];

const summarize = (value) => (value === true ? "yes" : value === false ? "no" : String(value ?? "unknown"));

const postEvidence = async (payload) => {
  try {
    const response = await fetch("/api/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export default function DeviceEvidence({ onNotify }) {
  const [auto, setAuto] = useState(null);
  const [manual, setManual] = useState(() => Object.fromEntries(HUMAN_CHECKS.map((check) => [check.id, { result: "", note: "" }])));
  const [assisted, setAssisted] = useState({ "speech-liveness": { result: "", note: "" } });
  const [speechRunning, setSpeechRunning] = useState(false);
  const [probesSent, setProbesSent] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const checks = {
        capturedAt: new Date().toISOString(),
        userAgent: navigator.userAgent.slice(0, 300),
        secureContext: window.isSecureContext,
        displayMode: window.matchMedia?.("(display-mode: standalone)")?.matches ? "standalone (installed)" : "browser tab",
        viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
        webgpu: "unavailable",
        serviceWorker: "unsupported",
        persistentStorage: "unsupported",
        storageEstimate: "",
        lumenCaches: 0,
        webllmCachePresent: false,
        voices: { total: 0, local: 0, network: 0, languages: 0 },
        badging: typeof navigator.setAppBadge === "function",
        wakeLock: "wakeLock" in navigator,
        webCrypto: Boolean(globalThis.crypto?.subtle),
      };
      try {
        if (navigator.gpu) {
          const adapter = await navigator.gpu.requestAdapter();
          checks.webgpu = adapter ? `adapter present (${adapter.features?.size ?? 0} features)` : "API present, no adapter";
        }
      } catch { checks.webgpu = "API present, adapter request failed"; }
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          checks.serviceWorker = registration ? (registration.active ? "active" : "registered, not active") : "supported, not registered";
        }
      } catch { checks.serviceWorker = "supported, query failed"; }
      try {
        if (navigator.storage?.persisted) {
          checks.persistentStorage = (await navigator.storage.persisted()) ? "granted" : "not granted";
          const estimate = await navigator.storage.estimate?.();
          if (estimate) checks.storageEstimate = `${Math.round((estimate.usage || 0) / 1048576)} MB of ${Math.round((estimate.quota || 0) / 1048576)} MB`;
        }
      } catch { checks.persistentStorage = "query failed"; }
      try {
        if ("caches" in window) {
          const names = await caches.keys();
          checks.lumenCaches = names.filter((name) => name.startsWith("lumen-ai-notes-v")).length;
          checks.webllmCachePresent = names.some((name) => name.toLowerCase().startsWith("webllm"));
        }
      } catch { /* leave defaults */ }
      try {
        const readVoices = () => {
          const voices = window.speechSynthesis?.getVoices?.() || [];
          if (!voices.length) return false;
          checks.voices = {
            total: voices.length,
            local: voices.filter((voice) => voice.localService).length,
            network: voices.filter((voice) => !voice.localService).length,
            languages: new Set(voices.map((voice) => voice.lang)).size,
          };
          return true;
        };
        if (!readVoices()) {
          window.speechSynthesis?.addEventListener?.("voiceschanged", () => { readVoices(); if (active) setAuto((current) => (current ? { ...current, voices: checks.voices } : current)); }, { once: true });
        }
      } catch { /* leave defaults */ }
      if (active) setAuto(checks);
      // Machine verification path: hand the probes to the Mac immediately.
      postEvidence({ format: "lumen.device-evidence.v1", kind: "auto-probe", capturedAt: checks.capturedAt, auto: checks }).then((ok) => {
        if (active && ok) setProbesSent(true);
      });
    })();
    return () => { active = false; };
  }, []);

  /**
   * Assisted check: speaks one short sentence and records the verdict from
   * the synthesis events themselves. A pass proves the speech pipeline is
   * live on this device; every failure mode records its own honest note.
   */
  const runSpeechLiveness = () => {
    if (speechRunning) return;
    const record = (result, note) => {
      setAssisted((current) => ({ ...current, "speech-liveness": { result, note: note.slice(0, 300) } }));
      setSpeechRunning(false);
    };
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      record("fail", "Web Speech API unavailable in this browser.");
      return;
    }
    setSpeechRunning(true);
    const voices = window.speechSynthesis.getVoices?.() || [];
    const voice = voices.find((candidate) => candidate.localService) || voices[0] || null;
    const utterance = new window.SpeechSynthesisUtterance("Lumen device evidence check.");
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    let settled = false;
    const finish = (result, note) => {
      if (settled) return;
      settled = true;
      record(result, note);
    };
    utterance.onend = () => finish("pass", `Spoke to completion via ${voice ? `${voice.name} (${voice.localService ? "on-device" : "network"})` : "the default voice"}.`);
    utterance.onerror = (event) => finish("fail", `Synthesis error: ${event.error || "unknown"}.`);
    setTimeout(() => finish("fail", `No completion event within 8s${voices.length ? "" : " — the device reported no voices"}.`), 8_000);
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      finish("fail", `speak() threw: ${error.message}`);
    }
  };

  const buildReport = () => ({
    format: "lumen.device-evidence.v1",
    capturedAt: new Date().toISOString(),
    auto,
    assisted: Object.entries(assisted).map(([id, entry]) => ({ id, verifiedBy: entry.result ? "automation" : "", ...entry })),
    manual: HUMAN_CHECKS.map((check) => ({ id: check.id, area: check.area, criterion: check.criterion, verifiedBy: manual[check.id].result ? "human" : "", ...manual[check.id] })),
  });

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(buildReport(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-device-evidence-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 2_000);
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildReport(), null, 2));
      onNotify?.("Evidence report copied — paste it into the tracker or an issue comment.");
    } catch {
      onNotify?.("Clipboard unavailable here; use Download instead.", "warning");
    }
  };

  const sendReport = async () => {
    const ok = await postEvidence(buildReport());
    setReportSent(ok);
    onNotify?.(ok
      ? "Report sent to the Mac — the operator can verify it from .local/evidence/."
      : "Could not reach the Mac's evidence endpoint — use Download or Copy instead.", ok ? "success" : "warning");
  };

  const answered = HUMAN_CHECKS.filter((check) => manual[check.id].result).length;
  const speechCheck = assisted["speech-liveness"];

  return (
    <div className="page device-evidence-page">
      <header className="page-title"><div><span className="eyebrow">Release evidence</span><h1>Device evidence</h1><p>Automatic and assisted checks are machine-verified on this device — they record themselves and send straight to the Mac{probesSent ? " (probes already delivered)" : ""}. The human checklist is the residue no script can honestly judge: VoiceOver behavior, audio routing, interruptions, restart survival.</p></div></header>

      <section className="page-section" aria-label="Automatic capability checks">
        <div className="section-heading"><div><span className="eyebrow">Machine-verified {probesSent ? "· sent to the Mac" : "· probed just now"}</span><h2>Automatic checks</h2></div></div>
        {!auto ? <p className="microcopy">Probing this browser…</p> : (
          <dl className="evidence-grid">
            <div><dt>Secure context</dt><dd>{summarize(auto.secureContext)}</dd></div>
            <div><dt>Display mode</dt><dd>{auto.displayMode}</dd></div>
            <div><dt>Viewport</dt><dd>{auto.viewport}</dd></div>
            <div><dt>WebGPU (WebLLM gate)</dt><dd>{auto.webgpu}</dd></div>
            <div><dt>Service worker</dt><dd>{auto.serviceWorker}</dd></div>
            <div><dt>Persistent storage</dt><dd>{auto.persistentStorage}{auto.storageEstimate ? ` · ${auto.storageEstimate}` : ""}</dd></div>
            <div><dt>Offline caches</dt><dd>{auto.lumenCaches} app cache{auto.lumenCaches === 1 ? "" : "s"} · WebLLM cache {auto.webllmCachePresent ? "present" : "absent"}</dd></div>
            <div><dt>Speech voices</dt><dd>{auto.voices.total} total · {auto.voices.local} on-device · {auto.voices.network} network · {auto.voices.languages} languages</dd></div>
            <div><dt>App badging</dt><dd>{summarize(auto.badging)}</dd></div>
            <div><dt>Wake lock</dt><dd>{summarize(auto.wakeLock)}</dd></div>
            <div><dt>WebCrypto</dt><dd>{summarize(auto.webCrypto)}</dd></div>
          </dl>
        )}
      </section>

      <section className="page-section" aria-label="Assisted checks">
        <div className="section-heading"><div><span className="eyebrow">Machine-verified · one tap to run</span><h2>Assisted checks</h2></div></div>
        <article className="evidence-check evidence-assisted">
          <span className="evidence-area">Narration liveness (AUDIO-001)</span>
          <p>Speaks one short sentence through the device's speech pipeline and records the verdict from the synthesis events — a pass proves narration actually produces audio on this device.</p>
          <div className="evidence-assisted-row">
            <button className="button secondary" onClick={runSpeechLiveness} disabled={speechRunning} type="button"><Play size={16} /> {speechRunning ? "Listening for completion…" : speechCheck.result ? "Run again" : "Run speech check"}</button>
            {speechCheck.result && <span className={`evidence-assisted-verdict ${speechCheck.result}`}>{speechCheck.result === "pass" ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {speechCheck.result} — {speechCheck.note}</span>}
          </div>
        </article>
      </section>

      <section className="page-section" aria-label="Human-judgment checklist">
        <div className="section-heading"><div><span className="eyebrow">{answered}/{HUMAN_CHECKS.length} recorded · human judgment only</span><h2>Human checklist</h2></div></div>
        <div className="evidence-checklist">
          {HUMAN_CHECKS.map((check) => (
            <article className="evidence-check" key={check.id}>
              <span className="evidence-area">{check.area}</span>
              <p>{check.criterion}</p>
              <div className="evidence-verdict" role="radiogroup" aria-label={`Result for: ${check.criterion.slice(0, 60)}`}>
                <button className={manual[check.id].result === "pass" ? "active pass" : ""} onClick={() => setManual((current) => ({ ...current, [check.id]: { ...current[check.id], result: "pass" } }))} role="radio" aria-checked={manual[check.id].result === "pass"} type="button"><CheckCircle2 size={15} /> Pass</button>
                <button className={manual[check.id].result === "fail" ? "active fail" : ""} onClick={() => setManual((current) => ({ ...current, [check.id]: { ...current[check.id], result: "fail" } }))} role="radio" aria-checked={manual[check.id].result === "fail"} type="button"><XCircle size={15} /> Fail</button>
                <button className={manual[check.id].result === "skipped" ? "active" : ""} onClick={() => setManual((current) => ({ ...current, [check.id]: { ...current[check.id], result: "skipped" } }))} role="radio" aria-checked={manual[check.id].result === "skipped"} type="button">Skip</button>
              </div>
              <input className="text-input" value={manual[check.id].note} onChange={(event) => setManual((current) => ({ ...current, [check.id]: { ...current[check.id], note: event.target.value.slice(0, 300) } }))} placeholder="Notes (device model, iOS version, what you observed)…" aria-label="Notes for this check" />
            </article>
          ))}
        </div>
      </section>

      <section className="page-section evidence-actions" aria-label="Export the report">
        <button className="button primary" onClick={sendReport} disabled={!auto} type="button"><Send size={16} /> {reportSent ? "Sent — send again" : "Send report to the Mac"}</button>
        <button className="button secondary" onClick={download} disabled={!auto} type="button"><Download size={17} /> Download JSON</button>
        <button className="button secondary" onClick={copyReport} disabled={!auto} type="button"><Copy size={16} /> Copy report</button>
        <p className="microcopy"><Smartphone size={14} /> Automatic and assisted results are machine-verified; human rows count only when a person records them on the device. <ClipboardCheck size={14} /> Unanswered checks export empty — nothing is ever fabricated.</p>
      </section>
    </div>
  );
}
