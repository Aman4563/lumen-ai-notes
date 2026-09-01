/**
 * Ordinary library full-text search off the main thread (PERF-001).
 *
 * The main thread sends the immutable built-in corpus once and incremental
 * custom-document updates; each search request carries the visible candidate
 * ids so profile-dependent facet filtering stays on the main thread. The
 * worker pre-normalizes corpus text a single time, which removes the
 * per-keystroke NFKD pass over the ~1 MB corpus that previously ran during
 * React render.
 */
import { buildSearchWords, contentCapabilities, searchDocuments } from "../lib/search.js";

const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

const builtins = new Map();
const customs = new Map();

const upsertBuiltin = (document, body) => {
  const normalizedBody = normalize(body ?? document.searchText);
  const metadata = normalize([document.title, document.partTitle, document.description].filter(Boolean).join(" "));
  builtins.set(document.id, {
    ...document,
    ...contentCapabilities(body ?? document.searchText),
    raw: "",
    searchText: "",
    normalizedSearchText: normalizedBody,
    // Precomputed once so typo-tolerant matching never re-tokenizes ~1 MB
    // of corpus text per keystroke.
    searchWords: buildSearchWords(`${metadata} ${normalizedBody}`),
  });
};

const upsertCustom = (document) => {
  const normalizedBody = normalize(document.searchText);
  const metadata = normalize([document.title, document.partTitle, document.description].filter(Boolean).join(" "));
  customs.set(document.id, {
    ...document,
    ...contentCapabilities(document.raw ?? document.searchText),
    normalizedSearchText: normalizedBody,
    searchWords: buildSearchWords(`${metadata} ${normalizedBody}`),
  });
};

self.onmessage = (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  try {
    if (message.type === "corpus") {
      const bodies = new Map(Array.isArray(message.bodies) ? message.bodies : []);
      for (const document of Array.isArray(message.documents) ? message.documents : []) {
        upsertBuiltin(document, bodies.get(document.id));
      }
      self.postMessage({ type: "ready", corpusSize: builtins.size });
      return;
    }
    if (message.type === "custom") {
      for (const id of Array.isArray(message.removeIds) ? message.removeIds : []) customs.delete(id);
      for (const document of Array.isArray(message.upsert) ? message.upsert : []) upsertCustom(document);
      return;
    }
    if (message.type === "search") {
      const candidates = (Array.isArray(message.candidateIds) ? message.candidateIds : [])
        .map((id) => customs.get(id) || builtins.get(id))
        .filter(Boolean);
      const results = searchDocuments(candidates, message.query).map((document) => ({
        id: document.id,
        searchScore: document.searchScore,
        snippet: document.description,
        matchedTerms: document.matchedTerms || [],
      }));
      self.postMessage({ type: "result", requestId: message.requestId, results });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: typeof message.requestId === "number" ? message.requestId : null,
      message: String(error?.message || error || "Library search failed in the worker"),
    });
  }
};
