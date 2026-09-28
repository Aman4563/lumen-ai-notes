import { isStaleChunkError, recoverableImport } from "./chunkRecovery.js";

/**
 * Warm tools (issue #95) are app code that only an action needs: uploads of
 * HTML and EPUB, backup and encrypted export, vault sync, the link check and
 * library retrieval. They are not installed with the app; the service worker
 * fetches them after the first idle. Until that has happened once, an action
 * taken offline cannot load its tool, and says so in these words (the error
 * screen's offline wording) instead of showing a download error.
 */
export const WARM_TOOL_OFFLINE_MESSAGE = "This tool isn't saved on this device yet. Reconnect once, and it will work offline.";

export class WarmToolUnavailableError extends Error {
  constructor(cause) {
    super(WARM_TOOL_OFFLINE_MESSAGE, { cause });
    this.name = "WarmToolUnavailableError";
    this.code = "WARM_TOOL_OFFLINE";
  }
}

export const isWarmToolUnavailable = (error) => error?.code === "WARM_TOOL_OFFLINE";

/**
 * Loads a warm tool through chunk recovery: a stale build that the server can
 * replace still gets its one bounded reload, while a file that cannot be
 * downloaded (offline, or the server unreachable) rejects with the typed
 * error. Any other failure keeps its own message. `name` is the tool's chunk
 * name, so loading it clears a recovery marker its own failure left.
 */
export const loadWarmTool = async (loader, name, { load = recoverableImport } = {}) => {
  try {
    return await load(loader, name);
  } catch (error) {
    throw isStaleChunkError(error) ? new WarmToolUnavailableError(error) : error;
  }
};

/** A toast for a failed action: the typed offline text alone, anything else after the action's own prefix. */
export const warmToolFailureMessage = (error, prefix = "") => (isWarmToolUnavailable(error)
  ? error.message
  : `${prefix}${error?.message || String(error)}`);

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
