const RECOVERY_STORAGE_KEY = "lumen:chunk-recovery-v1";
const RECOVERY_COOLDOWN_MS = 60_000;
const SERVER_PROBE_TIMEOUT_MS = 4_000;
const APP_CACHE_PREFIX = "lumen-ai-notes-v";

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /loading (?:css )?chunk [^ ]+ failed/i,
  /chunkloaderror/i,
  /(?:^|: )load failed$/i,
];

const errorMessage = (error) => {
  if (typeof error === "string") return error;
  return [error?.name, error?.message].filter(Boolean).join(": ");
};

const browserStorage = () => {
  try {
    return globalThis.window?.sessionStorage;
  } catch {
    return undefined;
  }
};

const browserOnline = () => globalThis.navigator?.onLine !== false;

const browserReload = () => globalThis.window?.location?.reload();

const readRecoveryMarker = (storage) => {
  try {
    const value = JSON.parse(storage?.getItem(RECOVERY_STORAGE_KEY) || "null");
    return Number.isFinite(value?.attemptedAt) ? value : null;
  } catch {
    return null;
  }
};

const writeRecoveryMarker = (storage, marker) => {
  try {
    storage?.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(marker));
    return storage?.getItem(RECOVERY_STORAGE_KEY) !== null;
  } catch {
    // Reloading without a durable, tab-scoped marker can create a refresh loop
    // in privacy modes where storage is unavailable. Leave recovery manual.
    return false;
  }
};

const chunkAsset = (error) => {
  const message = errorMessage(error);
  return message.match(/(?:https?:\/\/[^\s)]+)?\/assets\/[^\s)]+/i)?.[0] || "unknown";
};

export const isStaleChunkError = (error) => {
  const message = errorMessage(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

/**
 * Lecture bodies are on-demand chunks. Explain a failed download in plain
 * language instead of showing the browser's dynamic-import error.
 */
export const lectureLoadMessage = (message) => (isStaleChunkError(message)
  ? "This lecture is not saved on this device yet and could not be downloaded. Reconnect to the Lumen server and try again; lectures you open once stay available offline."
  : message);

export const clearChunkRecoveryMarker = (storage = browserStorage()) => {
  try {
    storage?.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    // Recovery state is best-effort and never worth breaking app startup.
  }
};

/**
 * Resolves true when the Lumen server answers at all. `/api/*` bypasses the
 * service worker, so a cached shell cannot fake reachability, and any HTTP
 * status (even a static host's 404) proves the network path works. A hung
 * request (a sleeping Mac on the same Wi-Fi) counts as unreachable.
 */
export const probeAppServer = async ({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
  timeoutMs = SERVER_PROBE_TIMEOUT_MS,
} = {}) => {
  if (!fetchImpl) return false;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => fetchImpl(`/api/health?lumen-probe=${now()}`, { cache: "no-store", credentials: "same-origin" }))
        .then(() => true, () => false),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, false); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// The error boundary reuses a probe that just ran for the same failure instead
// of waiting on a second network timeout. React.lazy rethrows the same error
// object on later renders, so only a recent result is trusted.
const probedFailures = new WeakMap();
const rememberProbe = (error, reachable, at) => {
  if (error && typeof error === "object") probedFailures.set(error, { reachable: Boolean(reachable), at });
};
export const recentServerProbe = (error, { now = () => Date.now(), maxAgeMs = 5_000 } = {}) => {
  const result = error && typeof error === "object" ? probedFailures.get(error) : undefined;
  return result && now() - result.at <= maxAgeMs ? result.reachable : undefined;
};

export const createChunkRecovery = ({
  storage = browserStorage(),
  now = () => Date.now(),
  isOnline = browserOnline,
  reload = browserReload,
  cooldownMs = RECOVERY_COOLDOWN_MS,
  probe,
} = {}) => {
  let reloadScheduled = false;
  let pendingRecovery = null;

  // true: a reload may start; false: not a chunk failure, offline, or within
  // the cooldown; null: a reload is already on its way.
  const eligible = (error) => {
    if (!isStaleChunkError(error)) return false;
    if (reloadScheduled) return null;
    const previous = readRecoveryMarker(storage);
    return isOnline() && !(previous && now() - previous.attemptedAt < cooldownMs);
  };

  const schedule = (error) => {
    const allowed = eligible(error);
    if (allowed !== true) return allowed === null;
    if (!writeRecoveryMarker(storage, { attemptedAt: now(), asset: chunkAsset(error) })) return false;

    reloadScheduled = true;
    try {
      reload();
    } catch {
      reloadScheduled = false;
      return false;
    }
    return true;
  };

  // Reload only when a fresh shell can be fetched. While the server is
  // unreachable (the Mac asleep, the phone still on Wi-Fi), a reload only boots
  // the cached shell again, drops in-memory state, and spends the cooldown, so
  // the failure goes to the in-shell boundary instead.
  const recover = async (error) => {
    if (eligible(error) !== true || !probe) return schedule(error);
    pendingRecovery ||= Promise.resolve()
      .then(() => probe())
      .catch(() => false)
      .then((reachable) => {
        rememberProbe(error, reachable, now());
        return reachable ? schedule(error) : false;
      })
      .finally(() => { pendingRecovery = null; });
    return pendingRecovery;
  };

  const load = async (loader) => {
    try {
      const module = await loader();
      if (!reloadScheduled) clearChunkRecoveryMarker(storage);
      return module;
    } catch (error) {
      if ((await recover(error)) || reloadScheduled) {
        // Keep the existing Suspense fallback mounted while the browser changes
        // documents. A promise rejection here would briefly replace the screen
        // with the error boundary before reload completes.
        return new Promise(() => {});
      }
      throw error;
    }
  };

  const listen = (target = globalThis.window) => {
    if (!target?.addEventListener) return () => {};
    const handlePreloadError = (event) => {
      // Vite emits this for both missing JS modules and their extracted CSS.
      // Do not preventDefault: the associated React.lazy promise must still
      // reject on a repeated failure so ErrorBoundary can offer manual repair.
      void recover(event?.payload);
    };
    target.addEventListener("vite:preloadError", handlePreloadError);
    return () => target.removeEventListener("vite:preloadError", handlePreloadError);
  };

  return { listen, load, recover, schedule };
};

export const chunkRecovery = createChunkRecovery({ probe: () => probeAppServer() });
export const recoverableImport = (loader) => chunkRecovery.load(loader);

const verifyApplicationShell = async ({ fetchImpl, location, now }) => {
  if (!fetchImpl || !location) throw new Error("A network check is unavailable in this browser.");
  const probe = new URL(location.href);
  probe.hash = "";
  probe.searchParams.set("lumen-repair", String(now()));
  const response = await fetchImpl(probe, { cache: "no-store", credentials: "same-origin" });
  if (!response?.ok) throw new Error(`The app server returned ${response?.status || "an error"}.`);
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType && !contentType.includes("text/html")) throw new Error("The app server did not return the Lumen shell.");
};

/**
 * Removes only Lumen's versioned application-file caches. IndexedDB,
 * localStorage, and WebLLM's separately named model caches are untouched.
 */
export const repairApplicationFiles = async ({
  cacheStorage = globalThis.caches,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  location = globalThis.window?.location,
  navigatorObject = globalThis.navigator,
  storage = browserStorage(),
  now = () => Date.now(),
} = {}) => {
  if (navigatorObject?.onLine === false) {
    throw new Error("Connect to the Lumen server before repairing app files. Your local work remains available.");
  }

  // Prove the shell is reachable before removing any offline app files. The
  // unique query bypasses both the service worker cache and HTTP caches.
  await verifyApplicationShell({ fetchImpl, location, now });

  if (cacheStorage?.keys && cacheStorage?.delete) {
    const keys = await cacheStorage.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(APP_CACHE_PREFIX))
      .map((key) => cacheStorage.delete(key)));
  }

  try {
    const registration = await navigatorObject?.serviceWorker?.getRegistration?.();
    await registration?.update?.();
    registration?.waiting?.postMessage?.({ type: "SKIP_WAITING" });
  } catch {
    // A clean online reload can repair the shell even when SW update APIs fail.
  }

  // If the deployment is still incomplete, show the actionable boundary after
  // this requested reload instead of immediately scheduling another reload.
  writeRecoveryMarker(storage, { attemptedAt: now(), asset: "manual-repair" });
  location?.reload?.();
};

export const CHUNK_RECOVERY_STORAGE_KEY = RECOVERY_STORAGE_KEY;
