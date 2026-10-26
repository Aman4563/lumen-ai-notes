import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Database, RefreshCw, Trash2 } from "lucide-react";
import { getStorageBudgetSummary } from "../lib/db.js";
import { cleanupFailureMessage, OfflineCleanupError, STORAGE_FAILURE_COPY, storageFailureKind } from "../lib/storageFailure.js";

const formatBytes = (value) => {
  const amount = Math.max(0, Number(value) || 0);
  if (amount < 1024) return `${amount} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`;
  if (amount < 1024 ** 3) return `${(amount / (1024 ** 2)).toFixed(1)} MB`;
  return `${(amount / (1024 ** 3)).toFixed(2)} GB`;
};

// A measurement that failed is never shown as a real 0 B (issue #147).
const NOT_MEASURED = "Not measured";

// Issue #147: a Cache Storage failure is announced the way Settings announces
// the #139 notice, with its STORAGE_ANNOUNCE_DELAY_MS and
// STORAGE_ANNOUNCE_CLEAR_MS: into a status region already on screen and
// empty, a moment after the message appears, and gone again once read.
const ANNOUNCE_DELAY_MS = 250;
const ANNOUNCE_CLEAR_MS = 5_000;
// Each failure kind is announced once per visit. Settings mounts this panel
// afresh on every open, so the record lives here rather than in state.
const announcedKinds = new Set();

// `{ value }` once `measure` answers, `{ error }` once it rejects or throws
// (synchronously too), so one failing measurement cannot take the others with it.
const settle = async (measure) => {
  try {
    return { value: await measure() };
  } catch (error) {
    return { error };
  }
};
const settledValue = (result) => ("error" in result ? null : result.value ?? null);

const cacheUsage = async () => {
  if (!("caches" in window)) return { bytes: 0, requests: 0 };
  let total = 0;
  let requests = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith("lumen-ai-notes-v")) continue;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    requests += keys.length;
    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;
      const declared = Number(response.headers.get("content-length"));
      total += Number.isFinite(declared) && declared >= 0 ? declared : (await response.clone().blob()).size;
    }
  }
  return { bytes: total, requests };
};

/**
 * WebLLM keeps downloaded model artifacts (weights, WASM, config) in Cache
 * Storage under webllm-prefixed cache names. Reported separately (DATA-002):
 * model bytes dwarf the study workspace and would otherwise read as bloat.
 */
const webllmCacheUsage = async () => {
  if (!("caches" in window)) return { bytes: 0, requests: 0 };
  let total = 0;
  let requests = 0;
  for (const name of await caches.keys()) {
    if (!name.toLowerCase().startsWith("webllm")) continue;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    requests += keys.length;
    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;
      const declared = Number(response.headers.get("content-length"));
      total += Number.isFinite(declared) && declared >= 0 ? declared : (await response.clone().blob()).size;
    }
  }
  return { bytes: total, requests };
};

const ROUTE_LIST = "./offline-routes.json";
// Warm tools are app code too: removing them would only download them again
// on the next launch, and until then their actions would not work offline.
const addRouteFiles = (protectedUrls, list) => {
  if (!Array.isArray(list?.files)) return;
  [...list.files, ...(Array.isArray(list.warm) ? list.warm : [])].forEach((file) => protectedUrls.add(new URL(file, location.href).href));
};

// Its own checks throw an OfflineCleanupError, whose message is written for
// learners; any other failure carries the browser's text, which is never
// shown. Each removed file is counted in `progress.removed`, so a cleanup that
// fails part-way can still say how many files went.
const removeOptionalCache = async (progress) => {
  if (!("caches" in window)) return;
  // `/api/*` is deliberately excluded from the service worker. A successful
  // nonce request therefore proves the server is reachable instead of merely
  // replaying a cached shell while the phone is offline.
  const health = await fetch(`/api/health?cache-bust=${Date.now()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!health.ok || !(await health.json()).ok) throw new OfflineCleanupError("The server could not be reached. Offline files were kept.");
  const htmlResponse = await fetch("./", { cache: "reload" });
  if (!htmlResponse.ok) throw new OfflineCleanupError("The current app shell could not be refreshed. Offline files were kept.");
  const html = await htmlResponse.text();
  const protectedUrls = new Set(Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g)).map((match) => new URL(match[1], location.href).href));
  ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", ROUTE_LIST]
    .forEach((url) => protectedUrls.add(new URL(url, location.href).href));
  // Route screens are shell code the service worker precaches at install.
  // Keep the current build's list and each cache's own installed list.
  const routeResponse = await fetch(ROUTE_LIST, { cache: "reload" });
  const routeList = routeResponse.ok ? await routeResponse.json().catch(() => null) : null;
  if (!Array.isArray(routeList?.files)) throw new OfflineCleanupError("The offline screen list could not be refreshed. Offline files were kept.");
  addRouteFiles(protectedUrls, routeList);
  for (const name of await caches.keys()) {
    if (!name.startsWith("lumen-ai-notes-v")) continue;
    const cache = await caches.open(name);
    addRouteFiles(protectedUrls, await (await cache.match(new URL(ROUTE_LIST, location.href).href))?.json().catch(() => null));
  }
  for (const name of await caches.keys()) {
    if (!name.startsWith("lumen-ai-notes-v")) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (new URL(request.url).origin === location.origin && protectedUrls.has(request.url)) continue;
      if (await cache.delete(request)) progress.removed += 1;
    }
  }
};

export default function StorageHealth({ online, onNotify }) {
  // `budget` is getStorageBudgetSummary()'s answer, `cache` and `webllm` are
  // { bytes, requests }, each null when its measurement failed; `failure` is
  // the kind of a Cache Storage failure. Error text is never kept.
  const [state, setState] = useState({ status: "loading", usage: 0, quota: 0, budget: null, cache: null, webllm: null, failure: "" });
  const [announced, setAnnounced] = useState("");

  // Issue #147: this awaited a single Promise.all, so one refused Cache
  // Storage call (Chrome's cookie blocking refuses every one) aborted it,
  // discarded the quota estimate and workspace budget the browser still
  // answered, and put the browser's own error text in the panel. Each
  // measurement now settles alone.
  const refresh = useCallback(async () => {
    // The last failure stays while measuring, so its message does not flicker.
    setState((current) => ({ ...current, status: "loading" }));
    const [estimate, budget, cache, webllm] = await Promise.all([
      settle(() => navigator.storage?.estimate?.()),
      settle(getStorageBudgetSummary),
      settle(cacheUsage),
      settle(webllmCacheUsage),
    ]);
    // A refused quota estimate shows no message of its own, only "Browser
    // quota estimate unavailable": Cache Storage alone decides whether
    // offline files are being saved.
    setState({
      status: "ready",
      usage: Number(estimate.value?.usage) || 0,
      quota: Number(estimate.value?.quota) || 0,
      budget: settledValue(budget),
      cache: settledValue(cache),
      webllm: settledValue(webllm),
      failure: "error" in cache ? storageFailureKind(cache.error) : "",
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const failureCopy = STORAGE_FAILURE_COPY[state.failure];
  const messageText = failureCopy ? `${failureCopy.title}. ${failureCopy.detail}` : "";
  useEffect(() => {
    const kind = state.failure;
    if (!messageText || announcedKinds.has(kind)) return undefined;
    const timer = setTimeout(() => {
      announcedKinds.add(kind);
      setAnnounced(messageText);
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.failure, messageText]);
  useEffect(() => {
    if (!announced) return undefined;
    const timer = setTimeout(() => setAnnounced(""), ANNOUNCE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [announced]);

  const clearOptional = async () => {
    if (!online) { onNotify?.("Reconnect before removing cached lessons; they must be downloadable again.", "warning"); return; }
    if (!window.confirm("Remove visited lecture, diagram, image, and search files from the offline cache? Your notes, progress, reviews, and whiteboards will not be changed.")) return;
    const progress = { removed: 0 };
    try {
      await removeOptionalCache(progress);
      onNotify?.(`${progress.removed} optional cached asset${progress.removed === 1 ? "" : "s"} removed. Open a lecture to download it again.`);
    } catch (error) {
      onNotify?.(cleanupFailureMessage(error, progress.removed), "error");
    }
    await refresh();
  };

  const { budget, cache, webllm } = state;
  const percentage = state.quota ? Math.min(100, (state.usage / state.quota) * 100) : 0;
  const workspacePercentage = budget?.maximumBytes ? Math.min(100, (budget.bytes / budget.maximumBytes) * 100) : 0;
  return (
    <section className="storage-health" aria-labelledby="storage-health-title">
      <div className="storage-health-heading"><div><Database size={19} aria-hidden="true" /><div><h2 id="storage-health-title">Storage health</h2><small>{state.status === "loading" ? "Measuring this device…" : state.quota ? `${formatBytes(state.usage)} of ${formatBytes(state.quota)} used by this origin` : "Browser quota estimate unavailable"}</small></div></div><button className="icon-button small" onClick={refresh} disabled={state.status === "loading"} aria-label="Refresh storage estimate" title="Refresh" type="button"><RefreshCw className={state.status === "loading" ? "spin" : ""} size={16} /></button></div>
      {failureCopy && <div className="storage-health-message"><AlertTriangle size={19} aria-hidden="true" /><div><strong>{failureCopy.title}</strong><span>{failureCopy.detail}</span></div></div>}
      {/* Empty except while announcing; a message that changed or went since is never left behind here. */}
      <p className="visually-hidden storage-health-announcer" role="status">{announced && announced === messageText ? announced : ""}</p>
      {state.quota > 0 && <div className="storage-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(percentage.toFixed(1))} aria-valuetext={`${percentage.toFixed(1)}% used`} aria-label="Browser storage quota used"><span style={{ width: `${percentage}%` }} /></div>}
      {state.status !== "loading" && <>
        <div className="storage-budget-line"><span>Backup-safe workspace</span><strong>{budget ? `${formatBytes(budget.bytes)} / ${formatBytes(budget.maximumBytes)}` : NOT_MEASURED}</strong></div>
        {budget && <div className="storage-meter workspace" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(workspacePercentage.toFixed(1))} aria-valuetext={`${workspacePercentage.toFixed(1)}% used`} aria-label="Backup-safe workspace budget used"><span style={{ width: `${workspacePercentage}%` }} /></div>}
        <dl className="storage-breakdown">
          <div><dt>Study profile</dt><dd>{budget ? formatBytes(budget.profileBytes) : NOT_MEASURED}</dd></div>
          <div><dt>Whiteboards</dt><dd>{budget ? <>{formatBytes(budget.boardBytes)} <small>· {budget.boardRecords}/{budget.maximumBoards}</small></> : NOT_MEASURED}</dd></div>
          <div><dt>Offline assets</dt><dd>{cache ? <>{formatBytes(cache.bytes)} <small>· {cache.requests} files</small></> : NOT_MEASURED}</dd></div>
          {webllm?.bytes > 0 && <div><dt>On-device AI model</dt><dd>{formatBytes(webllm.bytes)} <small>· {webllm.requests} files</small></dd></div>}
        </dl>
      </>}
      <button className="button ghost storage-cleanup" onClick={clearOptional} disabled={state.status === "loading" || !cache?.requests} title={!online ? "Reconnect before clearing files that may need to be downloaded again" : "Keep the app shell and remove optional offline assets"} type="button"><Trash2 size={16} /> Remove optional offline files</button>
    </section>
  );
}
