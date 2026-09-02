import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Copy, Download, Smartphone, XCircle } from "lucide-react";

/**
 * Physical-device evidence capture (issues #7/#17, A11Y-001/AUDIO-001).
 *
 * The automated release gates run on desktop Chrome; the tracker's remaining
 * evidence gates need a real iPhone. This page turns each gate into a
 * guided, recordable check: the auto section probes every capability the
 * tracker names, the manual section carries the acceptance criteria verbatim
 * as pass/fail taps, and the result exports as a dated JSON report the
 * operator pastes back into the verification log. Producing the evidence is
 * a ~15-minute pass on the phone; this page never claims it for you.
 */
const MANUAL_CHECKS = [
  {
    id: "webllm-load",
    area: "On-device AI (issue #7)",
    criterion: "The On-device Lite model downloaded with consent, loaded into this browser, and completed one lesson answer with visible citations.",
  },
  {
    id: "webllm-reload",
    area: "On-device AI (issue #7)",
    criterion: "After a full Safari reload, the cached model loaded again without re-downloading.",
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
    criterion: "Storage health shows persistent storage granted (or documents that Safari refused it), and the workspace survived a device restart.",
  },
];

const summarize = (value) => (value === true ? "yes" : value === false ? "no" : String(value ?? "unknown"));

export default function DeviceEvidence({ onNotify }) {
  const [auto, setAuto] = useState(null);
  const [manual, setManual] = useState(() => Object.fromEntries(MANUAL_CHECKS.map((check) => [check.id, { result: "", note: "" }])));

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
    })();
    return () => { active = false; };
  }, []);

  const buildReport = () => ({
    format: "lumen.device-evidence.v1",
    capturedAt: new Date().toISOString(),
    auto,
    manual: MANUAL_CHECKS.map((check) => ({ id: check.id, area: check.area, criterion: check.criterion, ...manual[check.id] })),
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

  const answered = MANUAL_CHECKS.filter((check) => manual[check.id].result).length;

  return (
    <div className="page device-evidence-page">
      <header className="page-title"><div><span className="eyebrow">Release evidence</span><h1>Device evidence</h1><p>Run this page on the physical iPhone over the trusted HTTPS address. Auto-checks probe what the browser reports; the checklist records what only a human on the device can verify. The report is evidence when a person completes it — this page never claims a pass on its own.</p></div></header>

      <section className="page-section" aria-label="Automatic capability checks">
        <div className="section-heading"><div><span className="eyebrow">Probed just now</span><h2>Automatic checks</h2></div></div>
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

      <section className="page-section" aria-label="Manual evidence checklist">
        <div className="section-heading"><div><span className="eyebrow">{answered}/{MANUAL_CHECKS.length} recorded</span><h2>Manual checklist</h2></div></div>
        <div className="evidence-checklist">
          {MANUAL_CHECKS.map((check) => (
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
        <button className="button primary" onClick={download} disabled={!auto} type="button"><Download size={17} /> Download evidence JSON</button>
        <button className="button secondary" onClick={copyReport} disabled={!auto} type="button"><Copy size={16} /> Copy report</button>
        <p className="microcopy"><Smartphone size={14} /> Paste the report into the tracker's verification log or issue #7 — dated, with the device model in the notes. <ClipboardCheck size={14} /> Auto-checks alone are not a pass: the checklist needs a human on the device.</p>
      </section>
    </div>
  );
}
