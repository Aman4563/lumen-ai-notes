import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { getStorageBudgetSummary } from "../lib/db.js";

const formatBytes = (value) => {
  const amount = Math.max(0, Number(value) || 0);
  if (amount < 1024) return `${amount} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`;
  if (amount < 1024 ** 3) return `${(amount / (1024 ** 2)).toFixed(1)} MB`;
  return `${(amount / (1024 ** 3)).toFixed(2)} GB`;
};

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
const addRouteFiles = (protectedUrls, list) => {
  if (!Array.isArray(list?.files)) return;
  list.files.forEach((file) => protectedUrls.add(new URL(file, location.href).href));
};

const removeOptionalCache = async () => {
  if (!("caches" in window)) return 0;
  // `/api/*` is deliberately excluded from the service worker. A successful
  // nonce request therefore proves the server is reachable instead of merely
  // replaying a cached shell while the phone is offline.
  const health = await fetch(`/api/health?cache-bust=${Date.now()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!health.ok || !(await health.json()).ok) throw new Error("The server could not be reached. Offline files were kept.");
  const htmlResponse = await fetch("./", { cache: "reload" });
  if (!htmlResponse.ok) throw new Error("The current app shell could not be refreshed. Offline files were kept.");
  const html = await htmlResponse.text();
  const protectedUrls = new Set(Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g)).map((match) => new URL(match[1], location.href).href));
  ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", ROUTE_LIST]
    .forEach((url) => protectedUrls.add(new URL(url, location.href).href));
  // Route screens are shell code the service worker precaches at install.
  // Keep the current build's list and each cache's own installed list.
  const routeResponse = await fetch(ROUTE_LIST, { cache: "reload" });
  const routeList = routeResponse.ok ? await routeResponse.json().catch(() => null) : null;
  if (!Array.isArray(routeList?.files)) throw new Error("The offline screen list could not be refreshed. Offline files were kept.");
  addRouteFiles(protectedUrls, routeList);
  let removed = 0;
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
      if (await cache.delete(request)) removed += 1;
    }
  }
  return removed;
};

export default function StorageHealth({ online, onNotify }) {
  const [state, setState] = useState({ status: "loading", usage: 0, quota: 0, workspaceBytes: 0, workspaceMaximum: 0, boardRecords: 0, boardMaximum: 0, profileBytes: 0, boardBytes: 0, cacheBytes: 0, cacheRequests: 0, webllmBytes: 0, webllmFiles: 0, error: "" });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const [estimate, budget, cache, webllm] = await Promise.all([
        navigator.storage?.estimate?.().catch(() => ({})) || {},
        getStorageBudgetSummary(),
        cacheUsage(),
        webllmCacheUsage().catch(() => ({ bytes: 0, requests: 0 })),
      ]);
      setState({
        status: "ready",
        usage: Number(estimate.usage) || 0,
        quota: Number(estimate.quota) || 0,
        workspaceBytes: budget.bytes,
        workspaceMaximum: budget.maximumBytes,
        boardRecords: budget.boardRecords,
        boardMaximum: budget.maximumBoards,
        profileBytes: budget.profileBytes,
        boardBytes: budget.boardBytes,
        cacheBytes: cache.bytes,
        cacheRequests: cache.requests,
        webllmBytes: webllm.bytes,
        webllmFiles: webllm.requests,
        error: "",
      });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error?.message || "Storage details are unavailable." }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const clearOptional = async () => {
    if (!online) { onNotify?.("Reconnect before removing cached lessons; they must be downloadable again.", "warning"); return; }
    if (!window.confirm("Remove visited lecture, diagram, image, and search files from the offline cache? Your notes, progress, reviews, and whiteboards will not be changed.")) return;
    try {
      const removed = await removeOptionalCache();
      onNotify?.(`${removed} optional cached asset${removed === 1 ? "" : "s"} removed. Open a lecture to download it again.`);
      await refresh();
    } catch (error) {
      onNotify?.(`Optional cache cleanup failed: ${error.message}`, "error");
    }
  };

  const percentage = state.quota ? Math.min(100, (state.usage / state.quota) * 100) : 0;
  const workspacePercentage = state.workspaceMaximum ? Math.min(100, (state.workspaceBytes / state.workspaceMaximum) * 100) : 0;
  return (
    <section className="storage-health" aria-labelledby="storage-health-title">
      <div className="storage-health-heading"><div><Database size={19} aria-hidden="true" /><div><h2 id="storage-health-title">Storage health</h2><small>{state.status === "loading" ? "Measuring this device…" : state.quota ? `${formatBytes(state.usage)} of ${formatBytes(state.quota)} used by this origin` : "Browser quota estimate unavailable"}</small></div></div><button className="icon-button small" onClick={refresh} disabled={state.status === "loading"} aria-label="Refresh storage estimate" title="Refresh" type="button"><RefreshCw className={state.status === "loading" ? "spin" : ""} size={16} /></button></div>
      {state.quota > 0 && <div className="storage-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(percentage.toFixed(1))} aria-valuetext={`${percentage.toFixed(1)}% used`} aria-label="Browser storage quota used"><span style={{ width: `${percentage}%` }} /></div>}
      {state.status !== "loading" && <><div className="storage-budget-line"><span>Backup-safe workspace</span><strong>{formatBytes(state.workspaceBytes)} / {formatBytes(state.workspaceMaximum)}</strong></div><div className="storage-meter workspace" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(workspacePercentage.toFixed(1))} aria-valuetext={`${workspacePercentage.toFixed(1)}% used`} aria-label="Backup-safe workspace budget used"><span style={{ width: `${workspacePercentage}%` }} /></div><dl className="storage-breakdown"><div><dt>Study profile</dt><dd>{formatBytes(state.profileBytes)}</dd></div><div><dt>Whiteboards</dt><dd>{formatBytes(state.boardBytes)} <small>· {state.boardRecords}/{state.boardMaximum}</small></dd></div><div><dt>Offline assets</dt><dd>{formatBytes(state.cacheBytes)} <small>· {state.cacheRequests} files</small></dd></div>{state.webllmBytes > 0 && <div><dt>On-device AI model</dt><dd>{formatBytes(state.webllmBytes)} <small>· {state.webllmFiles} files</small></dd></div>}</dl></>}
      {state.error && <p className="inline-warning" role="status">{state.error}</p>}
      <button className="button ghost storage-cleanup" onClick={clearOptional} disabled={state.status === "loading" || !state.cacheRequests} title={!online ? "Reconnect before clearing files that may need to be downloaded again" : "Keep the app shell and remove optional offline assets"} type="button"><Trash2 size={16} /> Remove optional offline files</button>
    </section>
  );
}
