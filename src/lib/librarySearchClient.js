/**
 * Main-thread wrapper for the library-search Web Worker (PERF-001).
 *
 * The wrapper owns request/response correlation with a monotonic request id
 * and latest-wins semantics: a response for a superseded request resolves as
 * `{ stale: true }` so the UI never paints out-of-date results over newer
 * ones. When the Worker API is unavailable or worker construction fails, the
 * client degrades to synchronous main-thread search so the library keeps
 * working; the caller can read `usingWorker` for diagnostics.
 */
import { contentCapabilities, searchDocuments } from "./search.js";

export class LibrarySearchError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "LibrarySearchError";
    this.code = code;
  }
}

const defaultWorkerFactory = () => new Worker(
  new URL("../workers/librarySearch.worker.js", import.meta.url),
  { type: "module", name: "lumen-library-search" },
);

export const createLibrarySearchClient = ({ workerFactory = defaultWorkerFactory } = {}) => {
  let worker = null;
  let terminated = false;
  let requestCounter = 0;
  const pending = new Map();
  // Fallback state mirrors the worker's stores when no worker is available.
  const fallbackBuiltins = new Map();
  const fallbackCustoms = new Map();

  try {
    worker = workerFactory();
  } catch {
    worker = null;
  }

  const rejectAll = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  if (worker) {
    worker.onmessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "result" || message.type === "error") {
        const entry = pending.get(message.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        if (message.type === "result") entry.resolve({ stale: entry.superseded, results: message.results });
        else entry.reject(new LibrarySearchError("WORKER_SEARCH_FAILED", message.message || "Library search failed."));
      }
    };
    worker.onerror = () => {
      // A crashed worker must not strand in-flight searches; fall back to the
      // synchronous path for the rest of the session.
      rejectAll(new LibrarySearchError("WORKER_CRASHED", "The library search worker stopped; searching on the main thread instead."));
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    };
  }

  const client = {
    get usingWorker() {
      return Boolean(worker);
    },
    setCorpus(documents, bodies) {
      if (terminated) return;
      if (worker) {
        worker.postMessage({ type: "corpus", documents, bodies });
        return;
      }
      for (const document of documents) {
        const body = new Map(bodies).get(document.id) || document.searchText || "";
        fallbackBuiltins.set(document.id, { ...document, ...(typeof document.hasCode === "boolean" ? {} : contentCapabilities(body)), raw: "", searchText: body });
      }
    },
    updateCustom(upsert = [], removeIds = []) {
      if (terminated) return;
      if (worker) {
        worker.postMessage({ type: "custom", upsert, removeIds });
        return;
      }
      for (const id of removeIds) fallbackCustoms.delete(id);
      for (const document of upsert) fallbackCustoms.set(document.id, { ...document, ...(typeof document.hasCode === "boolean" ? {} : contentCapabilities(document.raw ?? document.searchText)) });
    },
    search(query, candidateIds) {
      if (terminated) return Promise.reject(new LibrarySearchError("CLIENT_TERMINATED", "The library search client was terminated."));
      requestCounter += 1;
      const requestId = requestCounter;
      if (!worker) {
        const candidates = candidateIds.map((id) => fallbackCustoms.get(id) || fallbackBuiltins.get(id)).filter(Boolean);
        const results = searchDocuments(candidates, query).map((document) => ({
          id: document.id,
          searchScore: document.searchScore,
          snippet: document.description,
          matchedTerms: document.matchedTerms || [],
        }));
        return Promise.resolve({ stale: requestId !== requestCounter, results });
      }
      // Latest wins: mark every earlier in-flight request superseded so its
      // eventual response is delivered as stale instead of applied.
      for (const entry of pending.values()) entry.superseded = true;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, superseded: false });
        worker.postMessage({ type: "search", requestId, query, candidateIds });
      });
    },
    terminate() {
      terminated = true;
      rejectAll(new LibrarySearchError("CLIENT_TERMINATED", "The library search client was terminated."));
      if (worker) {
        try { worker.terminate(); } catch { /* already gone */ }
        worker = null;
      }
    },
  };
  return client;
};
