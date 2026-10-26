// #147: under Chrome's cookie blocking every Cache Storage call is refused, and
// Settings > Storage health printed the browser's own words for it (the raw
// `caches.keys()` SecurityError text) where a learner expects a plain status.
// This module turns a storage failure into that status.
//
// A failure's kind is decided by the error's name and never its text: names are
// a short, stable vocabulary, while the text differs by browser, version and
// language and is never shown. Only DeviceEvidence records a name (bounded by
// storageErrorName), so its report can say "SecurityError" without ever
// carrying a browser sentence.

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const copy = (title, detail) => Object.freeze({ title, detail });

// Plain copy in the register of the #139 site-data notice. None of it may carry
// that notice's title: the #139 audit counts every status region that does.
export const STORAGE_FAILURE_COPY = Object.freeze({
  blocked: copy(
    "This browser is not saving offline files on this device",
    "Reading online works as usual during this visit, but lectures will not open offline, and downloads such as the On-device Lite model are not saved.",
  ),
  full: copy(
    "This browser has no room for more offline files",
    "Reading online works as usual during this visit, but new lectures may not open offline, and downloads such as the On-device Lite model may not be saved. Free up space on this device to make room.",
  ),
  unknown: copy(
    "Storage details are unavailable right now",
    "Reading online works as usual during this visit, but lectures may not open offline, and downloads such as the On-device Lite model may not be saved.",
  ),
});

// The error's name when it is a short identifier, else "Error". The name is
// read once, inside try, so a hostile getter cannot throw or answer twice.
export const storageErrorName = (error) => {
  try {
    const name = error?.name;
    return typeof name === "string" && ERROR_NAME.test(name) ? name : "Error";
  } catch {
    return "Error";
  }
};

// Compared by name rather than looked up in an object, because a name such as
// "constructor" is a valid identifier too. Only a refused store (SecurityError,
// NotAllowedError) or a full one (QuotaExceededError) is named; any other
// failure, a failed fetch's TypeError included, stays "unknown".
export const storageFailureKind = (error) => {
  const name = storageErrorName(error);
  if (name === "SecurityError" || name === "NotAllowedError") return "blocked";
  if (name === "QuotaExceededError") return "full";
  return "unknown";
};

// Thrown only by Storage health's own cleanup checks, so its message is
// written for learners and may be shown as it is.
export class OfflineCleanupError extends Error {
  constructor(message) {
    super(message);
    this.name = "OfflineCleanupError";
  }
}

// Fetch, JSON and Cache Storage failures carry the browser's own text, so only
// an OfflineCleanupError keeps its words. Anything else gets a fixed sentence,
// which counts what was removed before the failure when anything was.
export const cleanupFailureMessage = (error, removed) => {
  if (error instanceof OfflineCleanupError) return `Optional cache cleanup failed: ${error.message}`;
  if (Number.isInteger(removed) && removed > 0) {
    return `Optional cache cleanup stopped after removing ${removed} optional cached asset${removed === 1 ? "" : "s"}. Open a lecture to download it again.`;
  }
  return "Optional cache cleanup failed. Offline files were kept.";
};
