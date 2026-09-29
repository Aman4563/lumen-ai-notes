import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Brain, BrainCircuit, Check, CircleUserRound, Contrast, Download, Import, Keyboard, Moon, Palette, RefreshCw, RotateCcw, Share, Smartphone, Sparkles, Sun, Trash2, Volume2, Wifi, WifiOff } from "lucide-react";
import ErrorBoundary from "./ErrorBoundary";
import { recoverableImport } from "../lib/chunkRecovery.js";
import { checkDeviceStorage, deviceStorageSaves, subscribeDeviceStorage } from "../lib/safeStorage.js";
import { syncFileNameFor } from "../lib/syncIdentity.js";

// Settings. It left the startup bundle for its budget (issue #95) and is an
// install-tier route screen, so it opens offline after one visit.
const StorageHealth = lazy(() => recoverableImport(() => import("./StorageHealth"), "StorageHealth"));

const THEME_CHOICES = [{ id: "system", label: "System", icon: CircleUserRound }, { id: "paper", label: "Paper", icon: Sun }, { id: "dark", label: "Night", icon: Moon }, { id: "contrast", label: "Contrast", icon: Contrast }];
const THEME_KEY_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// Issue #139: where the browser refuses Web Storage, per-device preferences
// last only until Lumen closes. The notice stays visible on every open but is
// announced once per visit, politely, so reopening Settings does not repeat it.
const STORAGE_NOTICE_TITLE = "This browser is not saving preferences on this device";
const STORAGE_NOTICE_DETAIL = "Choices such as the AI engine, the reader panel and recent searches last until Lumen closes.";
const STORAGE_NOTICE_STUDY_DATA = "Notes, progress and reviews are saved separately and are not affected.";
let storageNoticeAnnounced = false;

function DeviceStorageNotice({ studyDataSaving }) {
  const [announcement, setAnnouncement] = useState("");
  const detail = studyDataSaving ? `${STORAGE_NOTICE_DETAIL} ${STORAGE_NOTICE_STUDY_DATA}` : STORAGE_NOTICE_DETAIL;
  useEffect(() => {
    if (storageNoticeAnnounced) return;
    storageNoticeAnnounced = true;
    // Filled after mount so the polite region changes and is announced.
    setAnnouncement(`${STORAGE_NOTICE_TITLE}. ${detail}`);
  }, [detail]);
  return (
    <div className="settings-storage-notice">
      <AlertTriangle size={19} aria-hidden="true" />
      <div><strong>{STORAGE_NOTICE_TITLE}</strong><span>{detail}</span></div>
      <p className="visually-hidden" role="status">{announcement}</p>
    </div>
  );
}

export default function SettingsView({ settings, backupMeta, aiHistoryCount, onClearAiHistory, onSettingsChange, onResetSettings, onResetApp, onExport, onImport, onInstall, onShowShortcuts, onNotify, online, secureContext, saveStatus, wakeLock, storagePersisted, onRequestStorage, syncVault, syncDeviceId, onCreateSyncVault, onLeaveSyncVault, onSyncExport, onSyncImport }) {
  const importRef = useRef(null);
  const syncImportRef = useRef(null);
  const themeButtonsRef = useRef([]);
  const [backupPassword, setBackupPassword] = useState("");
  const [syncPassphrase, setSyncPassphrase] = useState("");
  const cryptoAvailable = secureContext && Boolean(globalThis.crypto?.subtle);
  const checkedTheme = Math.max(0, THEME_CHOICES.findIndex(({ id }) => id === settings.theme));
  // Radio-group keyboard contract: arrows move and select, Home/End jump.
  const handleThemeKey = (event, index) => {
    const target = event.key in THEME_KEY_STEPS ? (index + THEME_KEY_STEPS[event.key] + THEME_CHOICES.length) % THEME_CHOICES.length : event.key === "Home" ? 0 : event.key === "End" ? THEME_CHOICES.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    onSettingsChange({ theme: THEME_CHOICES[target].id });
    themeButtonsRef.current[target]?.focus();
  };
  const storageSaves = useSyncExternalStore(subscribeDeviceStorage, deviceStorageSaves, deviceStorageSaves);
  // A probe write catches a store that nothing has touched yet this visit.
  useEffect(() => { checkDeviceStorage(); }, []);
  const fontScaleLabel = `${Math.round(settings.fontScale * 100)}%`;
  const lineHeightLabel = String(settings.lineHeight);
  return (
    <div className="page settings-page">
      <p className="settings-intro">Appearance, reading comfort, narration, AI, backups, storage, and iPhone installation.</p>
      {!storageSaves && <DeviceStorageNotice studyDataSaving={saveStatus !== "error"} />}
      <section className="settings-card" aria-labelledby="settings-appearance-title">
        <div className="settings-card-heading"><Palette size={21} aria-hidden="true" /><div><h2 id="settings-appearance-title">Appearance and reading</h2><span>Choose a reading atmosphere and comfortable text.</span></div></div>
        <div className="theme-choices" role="radiogroup" aria-label="Theme">
          {THEME_CHOICES.map(({ id, label, icon: Icon }, index) => <button ref={(node) => { themeButtonsRef.current[index] = node; }} className={settings.theme === id ? "active" : ""} role="radio" aria-checked={settings.theme === id} tabIndex={index === checkedTheme ? 0 : -1} onClick={() => onSettingsChange({ theme: id })} onKeyDown={(event) => handleThemeKey(event, index)} key={id} type="button"><Icon size={21} aria-hidden="true" /><span>{label}</span>{settings.theme === id && <Check size={16} aria-hidden="true" />}</button>)}
        </div>
        <label className="setting-range"><span><strong>Default text size</strong><small>{fontScaleLabel}</small></span><input type="range" min="0.85" max="1.35" step="0.05" value={settings.fontScale} onChange={(event) => onSettingsChange({ fontScale: Number(event.target.value) })} aria-label="Default reading text size" aria-valuetext={fontScaleLabel} /></label>
        <label className="setting-range"><span><strong>Default line spacing</strong><small>{lineHeightLabel}</small></span><input type="range" min="1.45" max="2" step="0.05" value={settings.lineHeight} onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })} aria-label="Default reading line spacing" aria-valuetext={lineHeightLabel} /></label>
        <label className="setting-toggle"><span><strong>Keep screen awake while studying</strong><small>{wakeLock.supported ? (wakeLock.active ? "Active now" : "Activates in reader and whiteboard") : "Not supported by this browser"}</small></span><input type="checkbox" role="switch" checked={settings.keepScreenAwake} disabled={!wakeLock.supported} onChange={(event) => onSettingsChange({ keepScreenAwake: event.target.checked })} aria-label="Keep screen awake while studying" /></label>
        {wakeLock.error && <p className="inline-warning">{wakeLock.error}</p>}
        <button className="button ghost settings-reset-button" onClick={onResetSettings} type="button"><RotateCcw size={16} /> Restore reading defaults</button>
      </section>

      <section className="settings-card" aria-labelledby="settings-narration-title">
        <div className="settings-card-heading"><Volume2 size={21} aria-hidden="true" /><div><h2 id="settings-narration-title">Narration pronunciation</h2><span>Teach the voice how to say project-specific terms.</span></div></div>
        <label className="pronunciation-editor"><span>One override per line, as <code>term = spoken form</code></span>
          <textarea
            defaultValue={(settings.pronunciations || []).map((entry) => `${entry.term} = ${entry.spoken}`).join("\n")}
            onBlur={(event) => {
              const pronunciations = event.target.value.split("\n")
                .map((line) => line.split("="))
                .filter((parts) => parts.length >= 2 && parts[0].trim() && parts.slice(1).join("=").trim())
                .map((parts) => ({ term: parts[0].trim().slice(0, 60), spoken: parts.slice(1).join("=").trim().slice(0, 120) }))
                .slice(0, 50);
              onSettingsChange({ pronunciations });
              if (pronunciations.length) onNotify?.(`${pronunciations.length} pronunciation override${pronunciations.length === 1 ? "" : "s"} saved.`);
            }}
            placeholder={"SQL = sequel\nReLU = ray loo\nscikit-learn = sy kit learn"}
            rows={4}
            aria-label="Pronunciation overrides, one per line as term equals spoken form"
          />
        </label>
        <p className="microcopy">Overrides apply to narration only, match whole words case-insensitively, and are limited to 50 terms. They sync with your profile.</p>
      </section>

      <section className="settings-card" aria-labelledby="settings-ai-title">
        <div className="settings-card-heading"><BrainCircuit size={21} aria-hidden="true" /><div><h2 id="settings-ai-title">AI tutor</h2><span>Decide whether AI is available and what conversation history stays on this device.</span></div></div>
        <div className="settings-local-data"><div><strong>AI features</strong><span>{settings.aiFeaturesEnabled !== false ? "The AI learning studio is available. Turning it off hides AI surfaces without touching your notes or reviews." : "The AI learning studio is hidden. Reading, notes, reviews, narration, and whiteboards are unaffected."}</span></div><button className="button ghost" onClick={() => { const next = settings.aiFeaturesEnabled === false; onSettingsChange({ aiFeaturesEnabled: next }); onNotify(next ? "AI features are enabled again." : "AI features are now off. You can re-enable them here at any time."); }} type="button"><BrainCircuit size={16} /> {settings.aiFeaturesEnabled !== false ? "Turn AI off" : "Turn AI on"}</button></div>
        <div className="settings-local-data"><div><strong>Mac tutor history retention</strong><span>Choose how many tutor messages stay saved in this browser and in backups. “Session only” stops saving and removes the stored conversation.</span></div><label className="settings-retention"><span className="visually-hidden">Mac tutor history retention</span><select className="ui-select" value={[0, 10, 25, 50].includes(settings.aiHistoryRetention) ? settings.aiHistoryRetention : 50} onChange={(event) => { const retention = Number(event.target.value); onSettingsChange({ aiHistoryRetention: retention }); onNotify(retention === 0 ? "Tutor history is now session-only; the saved conversation was removed." : `Up to ${retention} tutor messages will be kept locally.`); }}><option value={50}>Up to 50 messages</option><option value={25}>Up to 25 messages</option><option value={10}>Up to 10 messages</option><option value={0}>Session only</option></select></label></div>
        <div className="settings-local-data"><div><strong>AI tutor history</strong><span>{aiHistoryCount ? `${aiHistoryCount} locally saved message${aiHistoryCount === 1 ? "" : "s"}; included in backups.` : "No locally saved AI conversation messages."}</span></div><button className="button ghost" onClick={onClearAiHistory} disabled={!aiHistoryCount} type="button"><Trash2 size={16} /> Clear AI history</button></div>
      </section>

      <section className="settings-card" aria-labelledby="settings-reminders-title">
        <div className="settings-card-heading"><Brain size={21} aria-hidden="true" /><div><h2 id="settings-reminders-title">Study reminders</h2><span>Quiet, opt-in signals. Lumen never sends notifications.</span></div></div>
        <div className="settings-local-data"><div><strong>App badge for due reviews</strong><span>{typeof navigator !== "undefined" && "setAppBadge" in navigator ? "Shows today’s due-card count on the app icon. Opt-in, silent, no notifications; it clears the moment the queue drains." : "This browser does not support app badges; nothing will be shown either way."}</span></div><label className="setting-toggle settings-badge-toggle"><span className="visually-hidden">App badge for due reviews</span><input type="checkbox" role="switch" checked={Boolean(settings.dueBadgeEnabled)} onChange={(event) => onSettingsChange({ dueBadgeEnabled: event.target.checked })} aria-label="Show due-review count on the app icon" /></label></div>
      </section>

      <section className="settings-card" aria-labelledby="settings-backup-title">
        <div className="settings-card-heading"><Share size={21} aria-hidden="true" /><div><h2 id="settings-backup-title">Backup and transfer</h2><span>Move your private study data between devices.</span></div></div>
        <input ref={importRef} type="file" accept="application/json,.json,.lumenc" hidden onChange={onImport} />
        <label className="backup-password-field"><span>Backup password <small>optional — encrypts the export with AES-256-GCM</small></span><input className="text-input" type="password" value={backupPassword} minLength={8} maxLength={128} onChange={(event) => setBackupPassword(event.target.value)} placeholder={cryptoAvailable ? "Leave empty for a plain backup" : "Needs a secure (HTTPS) context"} disabled={!cryptoAvailable} autoComplete="new-password" aria-label="Optional backup encryption password" /></label>
        {backupPassword && <p className="inline-warning">A forgotten password means permanent loss of this file — there is no recovery or escrow. The pre-restore recovery download stays unencrypted so a restore can always be undone.</p>}
        <div className="settings-action-row"><button className="button secondary" onClick={() => onExport(backupPassword.trim() || undefined)} disabled={Boolean(backupPassword.trim()) && backupPassword.trim().length < 8} type="button"><Download size={17} /> Export {backupPassword.trim() ? "encrypted " : ""}backup</button><button className="button secondary" onClick={() => importRef.current?.click()} type="button"><Import size={17} /> Import backup</button>{!storagePersisted && <button className="button ghost" onClick={onRequestStorage} type="button">Protect local storage</button>}</div>
        <p className="microcopy">Backups include progress, positions, bookmarks, highlights, clippings, review history, locally saved AI conversations, personal notes, edited copies, uploads, preferences, and whiteboards. Every new backup is checksummed and every restore is preflighted. Storage: {storagePersisted ? "persistent" : "best effort"} · Save status: {saveStatus} · Last export: {backupMeta?.lastExportAt ? new Date(backupMeta.lastExportAt).toLocaleString() : "never"}.</p>
      </section>
      <section className="settings-card sync-card" aria-labelledby="settings-sync-title">
        <div className="settings-card-heading"><RefreshCw size={21} aria-hidden="true" /><div><h2 id="settings-sync-title">Cross-device sync</h2><span>Encrypted, account-free vault sync through files you control.</span></div></div>
        <input ref={syncImportRef} type="file" accept=".lumenc" multiple hidden onChange={(event) => { const files = [...(event.target.files || [])]; event.target.value = ""; if (files.length) onSyncImport(files, syncPassphrase); }} />
        {!cryptoAvailable && <p className="inline-warning">Sync needs WebCrypto in a secure (HTTPS) context. There is no weak-crypto fallback.</p>}
        {!syncVault && <p className="microcopy">Each device in a vault writes one encrypted file into a folder you share however you like — iCloud Drive, Syncthing, a USB stick. One passphrase per vault, entered on each device and never stored. Create a vault here, or pick a peer's <code>.lumenc</code> sync file to join theirs.</p>}
        {syncVault && <p className="microcopy sync-status-line">Vault <code>{syncVault.vaultId.slice(0, 8)}…</code> · this device <code>{syncDeviceId.slice(0, 8)}…</code> · last sync {syncVault.lastSyncAt ? new Date(syncVault.lastSyncAt).toLocaleString() : "never"}. Your file is <code>{syncFileNameFor(syncDeviceId)}</code>; each device only ever writes its own.</p>}
        <label className="backup-password-field"><span>Vault passphrase <small>never stored — needed for every export and import</small></span><input className="text-input" type="password" value={syncPassphrase} minLength={8} maxLength={128} onChange={(event) => setSyncPassphrase(event.target.value)} placeholder={syncVault ? "Required for export and import" : "Required to create or join a vault"} disabled={!cryptoAvailable} autoComplete="off" aria-label="Sync vault passphrase" /></label>
        {!syncVault && <div className="settings-action-row">
          <button className="button secondary" onClick={onCreateSyncVault} disabled={!cryptoAvailable || syncPassphrase.length < 8} type="button"><RefreshCw size={16} /> Create sync vault</button>
          <button className="button ghost" onClick={() => syncImportRef.current?.click()} disabled={!cryptoAvailable || syncPassphrase.length < 8} type="button"><Import size={16} /> Join via a peer's file</button>
        </div>}
        {syncVault && <div className="settings-action-row">
          <button className="button secondary" onClick={() => onSyncExport(syncPassphrase)} disabled={!cryptoAvailable || syncPassphrase.length < 8} type="button"><Download size={17} /> Export my sync file</button>
          <button className="button secondary" onClick={() => syncImportRef.current?.click()} disabled={!cryptoAvailable || syncPassphrase.length < 8} type="button"><Import size={17} /> Import peer files</button>
          <button className="button ghost" onClick={onLeaveSyncVault} type="button">Leave vault</button>
        </div>}
        <p className="microcopy">Import folds every selected peer file through the same conflict-safe merge that already reconciles your tabs, then asks you to re-export so peers see the result. Deletions travel as tombstones, concurrent edits become recovered copies, and a reset/restore on one device propagates instead of resurrecting. A forgotten passphrase cannot be recovered.</p>
      </section>
      <ErrorBoundary fallback={<section className="settings-card storage-health-unavailable"><div className="settings-card-heading"><AlertTriangle size={21} aria-hidden="true" /><div><h2>Storage health</h2><span>Storage details are unavailable right now. Backups and other settings still work.</span></div></div></section>}><Suspense fallback={<div className="settings-card"><p className="microcopy">Measuring storage health…</p></div>}><StorageHealth online={online} onNotify={onNotify} /></Suspense></ErrorBoundary>
      <section className="settings-card install-card" aria-labelledby="settings-install-title">
        <div className="settings-card-heading"><Sparkles size={21} aria-hidden="true" /><div><h2 id="settings-install-title">Install on iPhone</h2><span>Use Lumen like a native full-screen app.</span></div></div>
        {!secureContext && <p className="inline-warning">This HTTP connection supports reading and local notes, but iPhone installation and offline caching require an HTTPS address.</p>}
        <button className="button primary" onClick={onInstall} type="button">{secureContext ? "Show installation steps" : "See HTTPS requirement"}</button>
        <div className={online ? "connection-state online" : "connection-state offline"}>{online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}{online ? "Online · content updates available" : "Offline · cached content remains available"}</div>
      </section>
      <section className="settings-card help-card" aria-labelledby="settings-help-title">
        <div className="settings-card-heading"><Keyboard size={21} aria-hidden="true" /><div><h2 id="settings-help-title">Help and diagnostics</h2><span>Keyboard shortcuts and the guided release-evidence checks.</span></div></div>
        <div className="settings-help-actions"><button className="button secondary" onClick={onShowShortcuts} type="button"><Keyboard size={16} /> Keyboard shortcuts</button><button className="button ghost" onClick={() => { window.location.hash = "#/device-evidence"; }} title="Guided physical-device evidence capture for the release tracker" type="button"><Smartphone size={16} /> Device evidence</button></div>
      </section>
      <section className="privacy-card"><div className="privacy-icon" aria-hidden="true">L</div><div><strong>Local-first by design</strong><p>No account is required. Notes, whiteboards, and AI conversation history remain in this browser’s storage unless you export or clear them. AI sends only the prompt and sources you explicitly approve for that request.</p></div></section>
      <section className="settings-card danger-zone" aria-labelledby="settings-reset-title"><div className="settings-card-heading"><AlertTriangle size={21} aria-hidden="true" /><div><h2 id="settings-reset-title">Reset local app data</h2><span>Permanently removes progress, notes, uploads, clippings, edits, and every whiteboard from this browser.</span></div></div><p className="microcopy">Export a backup first if you may need this work again.</p><button className="button danger-button" onClick={onResetApp} type="button"><Trash2 size={17} /> Reset everything</button></section>
    </div>
  );
}
