import { isStaleChunkError, probeAppServer, recentServerProbe, recoverableImport } from "./chunkRecovery.js";

/**
 * Warm tools (issue #95) are app code that only an action needs: uploads of
 * HTML and EPUB, backup and encrypted export, vault sync, the link check and
 * library retrieval. They are not installed with the app; the service worker
 * fetches them after the first idle. Until that has happened once, an action
 * taken offline cannot load its tool, and says so in these words (the error
 * screen's offline wording) instead of showing a download error.
 */
export const WARM_TOOL_OFFLINE_MESSAGE = "This tool isn't saved on this device yet. Reconnect once, and it will work offline.";
/**
 * The server answers but does not have the tool's file: the page belongs to
 * another build, or the server's build is incomplete. The error screen's
 * "fresh app files" wording, for an action instead of a screen.
 */
export const WARM_TOOL_STALE_MESSAGE = "Lumen needs fresh app files: this tool belongs to a different or incomplete Lumen build. Your notes and progress are safe. Reload Lumen while connected to the Lumen server.";

export class WarmToolUnavailableError extends Error {
  constructor(cause, { stale = false } = {}) {
    super(stale ? WARM_TOOL_STALE_MESSAGE : WARM_TOOL_OFFLINE_MESSAGE, { cause });
    this.name = "WarmToolUnavailableError";
    this.code = stale ? "WARM_TOOL_STALE" : "WARM_TOOL_OFFLINE";
    this.status = stale ? "stale" : "offline";
  }
}

export const isWarmToolUnavailable = (error) => error instanceof WarmToolUnavailableError || ["WARM_TOOL_OFFLINE", "WARM_TOOL_STALE"].includes(error?.code);

const browserOnline = () => globalThis.navigator?.onLine !== false;

/**
 * Loads a warm tool through chunk recovery: a stale build that the server can
 * replace still gets its one bounded reload. A file that cannot be downloaded
 * rejects with a typed error: offline, or with the server unreachable, the
 * tool is not saved on this device yet; with the server answering (after the
 * reload was spent, or within its cooldown), the app files need refreshing.
 * Any other failure keeps its own message. `name` is the tool's chunk name,
 * so loading it clears a recovery marker its own failure left.
 */
export const loadWarmTool = async (loader, name, { load = recoverableImport, isOnline = browserOnline, probe = probeAppServer } = {}) => {
  try {
    return await load(loader, name);
  } catch (error) {
    if (!isStaleChunkError(error)) throw error;
    // Chunk recovery remembers the probe it just ran for this failure; within
    // the reload cooldown it skips the probe, so ask the server here.
    const reachable = isOnline() && (recentServerProbe(error) ?? await Promise.resolve().then(() => probe()).catch(() => false));
    throw new WarmToolUnavailableError(error, { stale: reachable === true });
  }
};

/** A toast for a failed action: the action's own prefix, then why it failed. */
export const warmToolFailureMessage = (error, prefix = "") => `${prefix}${error?.message || String(error)}`;

// A tool loads once per document; later calls reuse the module without
// another trip through the module loader (a tutor's retrieval runs on every
// question).
const warmTool = (loader, name) => {
  let module = null;
  return async () => {
    module ||= await loadWarmTool(loader, name);
    return module;
  };
};

export const loadImportConverters = warmTool(() => import("./importConverters.js"), "importConverters");
export const loadBackupTools = warmTool(() => import("./backupTools.js"), "backupTools");
export const loadLinkAudit = warmTool(() => import("./linkAudit.js"), "linkAudit");
export const loadLibraryRetrieval = warmTool(() => import("./libraryRetrieval.js"), "libraryRetrieval");
