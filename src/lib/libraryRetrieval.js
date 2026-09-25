/**
 * Local, library-first lexical retrieval for the AI tutor.
 *
 * The generated full-text index is used only to identify candidate documents.
 * Raw Markdown is loaded lazily for those candidates, split at source headings,
 * and reduced to a small set of passages. Nothing in this module performs a
 * network request or sends the library to an inference service.
 */

export const LIBRARY_RETRIEVAL_LIMITS = Object.freeze({
  queryCharacters: 2_000,
  documents: 1_000,
  candidateDocuments: 18,
  documentsReturned: 8,
  passages: 12,
  passagesPerDocument: 3,
  reservedPassages: 6,
  bytes: 48_000,
  passageBytes: 7_000,
});

const DEFAULTS = Object.freeze({
  maxCandidateDocuments: 10,
  maxDocuments: 6,
  maxPassages: 9,
  maxPassagesPerDocument: 2,
  maxBytes: 24_000,
  maxPassageBytes: 4_800,
});

const STOP_WORDS = new Set([
  "a", "about", "all", "also", "am", "an", "and", "answer", "are", "as", "at", "be", "because",
  "been", "but", "by", "can", "could", "did", "do", "does", "explain", "for", "from", "give", "had",
  "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or",
  "our", "please", "should", "show", "so", "tell", "than", "that", "the", "their", "then", "there",
  "these", "they", "this", "to", "use", "using", "want", "was", "we", "were", "what", "when", "where",
  "which", "who", "why", "will", "with", "work", "working", "works", "would", "you", "your",
]);

const TIME_SENSITIVE_PATTERN = /\b(?:latest|newest|today|currently|current\s+(?:release|version|price|status)|recent(?:ly)?|as\s+of|this\s+(?:week|month|year)|release\s+date|price|pricing|availability|changelog|security\s+advisory|cve[- ]?\d*)\b|\b20(?:2[6-9]|[3-9]\d)\b/iu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu;
const encoder = new TextEncoder();

const boundedInteger = (value, fallback, maximum, minimum = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
};

const cleanText = (value, maximum = 1_000_000) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(CONTROL_PATTERN, "")
  .slice(0, maximum);

const normalize = (value) => cleanText(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, " ")
  .replace(/[^\p{L}\p{N}+#.\-/\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const markdownToSearchText = (value) => normalize(cleanText(value)
  .replace(/```[^\n]*\n?/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~|]/g, " "));

const hashText = (value) => {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const byteLength = (value) => encoder.encode(String(value || "")).byteLength;

const clipUtf8 = (value, maximumBytes) => {
  const text = String(value || "");
  if (byteLength(text) <= maximumBytes) return text;
  const marker = "\n\n[… passage clipped by Lumen …]";
  const contentBudget = Math.max(1, maximumBytes - byteLength(marker));
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(text.slice(0, middle)) <= contentBudget) low = middle;
    else high = middle - 1;
  }
  let clipped = text.slice(0, low).replace(/\s+\S*$/u, "").trimEnd();
  if (!clipped) clipped = text.slice(0, low).trimEnd();
  return `${clipped}${clipped.length < text.length ? marker : ""}`;
};

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("Library retrieval was cancelled", "AbortError");
};

export const tokenizeLibraryQuery = (query) => {
  const cleaned = normalize(cleanText(query, LIBRARY_RETRIEVAL_LIMITS.queryCharacters));
  if (!cleaned) return { normalized: "", terms: [], phrases: [] };
  const original = cleanText(query, LIBRARY_RETRIEVAL_LIMITS.queryCharacters).toLocaleLowerCase();
  const phrases = [...original.matchAll(/"([^"\n]{2,120})"/g)]
    .map((match) => normalize(match[1]))
    .filter(Boolean)
    .slice(0, 4);
  const candidates = cleaned.split(/[\s/]+/u)
    .map((term) => term.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((term) => (term.length >= 2 || /[^a-z0-9]/iu.test(term)) && !STOP_WORDS.has(term));
  const terms = [...new Set([...phrases.flatMap((phrase) => phrase.split(" ")), ...candidates])].slice(0, 20);
  return { normalized: cleaned, terms, phrases };
};

const countOccurrences = (haystack, needle, maximum = 10) => {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (count < maximum) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    const before = found > 0 ? haystack[found - 1] : "";
    const after = haystack[found + needle.length] || "";
    const beginsAtBoundary = !/^[\p{L}\p{N}]$/iu.test(needle[0]) || !/[\p{L}\p{N}]/iu.test(before);
    const endsAtBoundary = !/[\p{L}\p{N}]$/iu.test(needle.at(-1)) || !/[\p{L}\p{N}]/iu.test(after);
    if (beginsAtBoundary && endsAtBoundary) count += 1;
    offset = found + Math.max(1, needle.length);
  }
  return count;
};

const containsTerm = (haystack, needle) => countOccurrences(haystack, needle, 1) > 0;

const coverageFor = (text, terms) => {
  if (!terms.length) return 0;
  const matched = terms.reduce((total, term) => total + (containsTerm(text, term) ? 1 : 0), 0);
  return matched / terms.length;
};

const lexicalScore = ({ title = "", metadata = "", body = "" }, query) => {
  if (!query.terms.length) return { score: 0, coverage: 0, matches: 0 };
  const normalizedTitle = normalize(title);
  const normalizedMetadata = normalize(metadata);
  const normalizedBody = normalize(body);
  const combined = `${normalizedTitle} ${normalizedMetadata} ${normalizedBody}`;
  let score = 0;
  let matches = 0;
  for (const term of query.terms) {
    const inTitle = containsTerm(normalizedTitle, term);
    const inMetadata = containsTerm(normalizedMetadata, term);
    const bodyCount = countOccurrences(normalizedBody, term);
    if (inTitle || inMetadata || bodyCount) matches += 1;
    if (normalizedTitle === term) score += 18;
    else if (inTitle) score += 10;
    if (inMetadata) score += 4;
    score += Math.min(bodyCount, 6) * 1.25;
  }
  for (const phrase of query.phrases) {
    if (normalizedTitle.includes(phrase)) score += 14;
    else if (combined.includes(phrase)) score += 8;
  }
  if (query.normalized.length > 5 && combined.includes(query.normalized)) score += 8;
  const coverage = matches / query.terms.length;
  score += coverage * 8;
  return { score, coverage, matches };
};

const resolveIndex = async (searchIndex, loadSearchIndex) => {
  const source = searchIndex ?? (typeof loadSearchIndex === "function" ? await loadSearchIndex() : null);
  const resolved = await source;
  if (resolved instanceof Map) return resolved;
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) return new Map(Object.entries(resolved));
  return new Map();
};

const documentIdentity = (document, index) => cleanText(document?.id || document?.documentId || document?.path, 300).trim()
  || `anonymous-document-${index + 1}`;

const documentMetadata = (document) => [
  document?.title,
  document?.description,
  document?.partTitle,
  document?.section,
  ...(Array.isArray(document?.tags) ? document.tags : []),
].filter(Boolean).join(" ");

const slugifyHeading = (value, fallbackIndex = 0) => normalize(value)
  .replace(/[^a-z0-9\s-]/g, "")
  .trim()
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  || `section-${fallbackIndex + 1}`;

const cleanHeading = (value) => cleanText(value, 300)
  .replace(/\s+#+\s*$/u, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_`~]/g, "")
  .trim();

const splitMarkdownSections = (markdown) => {
  const lines = cleanText(markdown).split("\n");
  const sections = [];
  const headings = new Map();
  const hierarchy = [];
  let activeAnchor = "";
  let active = { startLine: 1, lines: [], section: "Introduction", anchor: "" };
  let inFence = false;

  const flush = (endLine) => {
    const text = active.lines.join("\n").trim();
    if (text) sections.push({ ...active, endLine, markdown: text });
  };

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const match = !inFence ? line.match(/^(#{1,4})\s+(.+?)\s*$/) : null;
    if (!match) {
      active.lines.push(line);
      return;
    }

    flush(index);
    const level = match[1].length;
    const heading = cleanHeading(match[2]);
    hierarchy[level] = heading;
    hierarchy.length = level + 1;
    if (level === 2 || level === 3) {
      const base = slugifyHeading(heading, headings.size);
      const duplicate = headings.get(base) || 0;
      activeAnchor = duplicate ? `${base}-${duplicate + 1}` : base;
      headings.set(base, duplicate + 1);
    }
    active = {
      startLine: index + 1,
      lines: [line],
      section: hierarchy.filter(Boolean).slice(1).join(" › ") || heading || "Introduction",
      anchor: activeAnchor,
    };
  });
  flush(lines.length);
  return sections;
};

const splitLargeBlock = (block, targetCharacters) => {
  if (block.length <= targetCharacters) return [block];
  const pieces = [];
  let remaining = block;
  while (remaining.length > targetCharacters) {
    const candidate = remaining.slice(0, targetCharacters);
    const breakAt = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(". "), candidate.lastIndexOf("; "));
    const end = breakAt >= Math.floor(targetCharacters * 0.55) ? breakAt + 1 : targetCharacters;
    pieces.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
};

const sectionPassages = (section, targetCharacters = 1_800) => {
  const blocks = section.markdown.split(/\n\s*\n/u)
    .flatMap((block) => splitLargeBlock(block.trim(), targetCharacters))
    .filter(Boolean);
  const results = [];
  let current = [];
  let length = 0;
  const flush = () => {
    if (!current.length) return;
    results.push(current.join("\n\n"));
    current = [];
    length = 0;
  };
  blocks.forEach((block) => {
    if (current.length && length + block.length + 2 > targetCharacters) flush();
    current.push(block);
    length += block.length + (current.length > 1 ? 2 : 0);
  });
  flush();
  return results;
};

const sourceForDocument = async (record, { edits, personalNotes, loadSource, signal }) => {
  throwIfAborted(signal);
  const hasEdit = Object.hasOwn(edits, record.id);
  if (hasEdit) return cleanText(edits[record.id]);
  const inline = record.document?.raw ?? record.document?.text ?? record.document?.content;
  // Built-in metadata intentionally carries raw: "" so the 143-document
  // corpus remains lazy at startup. An empty placeholder is not an authored
  // empty document; load the selected candidate's Markdown on demand.
  if (typeof inline === "string" && inline.trim()) return cleanText(inline);
  if (typeof loadSource !== "function") return "";
  const loaded = await loadSource(record.id, { signal });
  throwIfAborted(signal);
  return cleanText(loaded);
};

const makeCandidatePassages = (record, markdown, personalNote, query, selectedDocumentId, { includeUnmatched = false } = {}) => {
  const revision = cleanText(record.document?.updatedAt || record.document?.revision, 120).trim()
    || hashText(markdown);
  const sourceType = record.document?.source === "custom" || record.id.startsWith("custom/") ? "custom" : "builtin";
  const rawSections = splitMarkdownSections(markdown);
  const sections = personalNote?.trim()
    ? [...rawSections, { section: "Personal note", anchor: "personal-note", startLine: 0, endLine: 0, markdown: cleanText(personalNote, 100_000) }]
    : rawSections;
  const candidates = [];
  sections.forEach((section, sectionIndex) => {
    sectionPassages(section).forEach((text, passageIndex) => {
      const result = lexicalScore({ title: record.document?.title, metadata: section.section, body: markdownToSearchText(text) }, query);
      // A reserved (open) lesson contributes passages even when a deictic
      // request such as "explain this lesson" shares no terms with them.
      if (!result.matches && !includeUnmatched) return;
      const selectionBoost = record.id === selectedDocumentId ? 1.5 : 0;
      const noteBoost = section.section === "Personal note" ? 1.25 : 0;
      const score = result.score + selectionBoost + noteBoost + Math.min(1.5, Math.log2(Math.max(2, text.length)) / 8);
      const locator = `${record.id}|${section.anchor}|${section.startLine}|${sectionIndex}|${passageIndex}`;
      candidates.push({
        id: `library-passage-${hashText(locator)}`,
        documentId: record.id,
        title: cleanText(record.document?.title || "Untitled source", 240).trim(),
        section: cleanText(section.section || record.document?.partTitle || "", 300).trim(),
        anchor: cleanText(section.anchor, 240),
        text: text.trim(),
        startLine: section.startLine,
        endLine: section.endLine,
        revision: section.section === "Personal note" ? `${revision}:personal-note:${hashText(personalNote)}` : revision,
        sourceType: section.section === "Personal note" ? "personal-note" : sourceType,
        score,
        coverage: result.coverage,
        matched: result.matches > 0,
        ordinal: candidates.length,
      });
    });
  });
  return candidates;
};

/**
 * Picks the open lesson's passages for a request about "this lesson": its
 * opening passage, then its best query matches, then its earliest remaining
 * sections, preferring one passage per section. Returned in reading order.
 */
const reservedDocumentPassages = (candidates, documentId, count) => {
  if (!documentId || count < 1) return [];
  const all = candidates.filter((candidate) => candidate.documentId === documentId)
    .sort((left, right) => left.ordinal - right.ordinal);
  // A bare heading line is not evidence.
  const body = (candidate) => candidate.text.replace(/^#+\s.*$/gmu, "").trim().length;
  const own = all.some((candidate) => body(candidate) >= 40) ? all.filter((candidate) => body(candidate) >= 40) : all;
  if (!own.length) return [];
  const opener = own.find((candidate) => body(candidate) >= 160) || own[0];
  const picks = [opener];
  const sections = new Set([opener.section]);
  const take = (pool, distinctSections) => {
    for (const candidate of pool) {
      if (picks.length >= count) return;
      if (picks.includes(candidate) || (distinctSections && sections.has(candidate.section))) continue;
      picks.push(candidate);
      sections.add(candidate.section);
    }
  };
  const matched = own.filter((candidate) => candidate.matched)
    .sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
  take(matched, true);
  take(own, true);
  take(matched, false);
  take(own, false);
  picks.forEach((candidate) => { candidate.reserved = true; });
  return picks.sort((left, right) => left.ordinal - right.ordinal);
};

const selectDiversifiedPassages = (candidates, limits, reserved = []) => {
  const sorted = [...candidates].sort((left, right) => right.score - left.score
    || right.coverage - left.coverage
    || left.documentId.localeCompare(right.documentId)
    || left.startLine - right.startLine
    || left.id.localeCompare(right.id));
  const selected = [];
  const counts = new Map();
  const admittedDocuments = new Set();
  const reservedCounts = new Map();
  reserved.forEach((candidate) => reservedCounts.set(candidate.documentId, (reservedCounts.get(candidate.documentId) || 0) + 1));
  let bytes = 0;
  let budgetTruncated = false;

  // Returns false when the byte budget is exhausted.
  const admit = (candidate) => {
    candidate.selected = true;
    const metadataBytes = byteLength([
      candidate.id,
      candidate.documentId,
      candidate.title,
      candidate.section,
      candidate.anchor,
      candidate.revision,
      candidate.sourceType,
    ].join("\n")) + 64;
    const remaining = limits.maxBytes - bytes - metadataBytes;
    if (remaining < 180) {
      budgetTruncated = true;
      return false;
    }
    const maximum = Math.min(limits.maxPassageBytes, remaining);
    const text = clipUtf8(candidate.text, maximum);
    const textBytes = byteLength(text);
    if (!text || textBytes > remaining) {
      budgetTruncated = true;
      return true;
    }
    selected.push({ ...candidate, text, rank: selected.length + 1 });
    delete selected.at(-1).selected;
    bytes += metadataBytes + textBytes;
    admittedDocuments.add(candidate.documentId);
    counts.set(candidate.documentId, (counts.get(candidate.documentId) || 0) + 1);
    if (text !== candidate.text) budgetTruncated = true;
    return true;
  };

  // Reserved open-lesson passages go first, through the same byte accounting.
  for (const candidate of reserved) {
    if (selected.length >= limits.maxPassages) break;
    if (!admit(candidate)) return { passages: selected, bytes, budgetTruncated };
  }

  while (selected.length < limits.maxPassages) {
    let bestIndex = -1;
    let bestAdjustedScore = -Infinity;
    sorted.forEach((passage, index) => {
      if (passage.selected) return;
      const count = counts.get(passage.documentId) || 0;
      if (count >= Math.max(limits.maxPassagesPerDocument, reservedCounts.get(passage.documentId) || 0)) return;
      if (!admittedDocuments.has(passage.documentId) && admittedDocuments.size >= limits.maxDocuments) return;
      const adjusted = passage.score * (count ? 0.72 / count : 1);
      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    if (!admit(sorted[bestIndex])) break;
  }
  return { passages: selected, bytes, budgetTruncated };
};

const confidenceFor = (passages, query, { indexAvailable, failedLoads }) => {
  if (!passages.length || !query.terms.length) {
    return { score: 0, level: "none", coverage: 0, lexicalStrength: 0, diversity: 0 };
  }
  // Reserved open-lesson passages lead the list in reading order; judge the
  // evidence by the relevance-ordered selection that follows them.
  const ranked = [...passages.filter((passage) => !passage.reserved), ...passages.filter((passage) => passage.reserved)];
  const top = ranked[0];
  const coverage = Math.max(...ranked.slice(0, 3).map((passage) => passage.coverage));
  const lexicalStrength = Math.min(1, top.score / Math.max(18, 8 + query.terms.length * 5));
  const uniqueDocuments = new Set(passages.map((passage) => passage.documentId)).size;
  const diversity = Math.min(1, uniqueDocuments / Math.min(3, passages.length));
  const availabilityPenalty = indexAvailable ? 1 : 0.82;
  const loadPenalty = failedLoads ? 0.94 : 1;
  const score = Math.max(0, Math.min(1,
    (coverage * 0.58 + lexicalStrength * 0.34 + diversity * 0.08) * availabilityPenalty * loadPenalty,
  ));
  return {
    score: Number(score.toFixed(3)),
    level: score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low",
    coverage: Number(coverage.toFixed(3)),
    lexicalStrength: Number(lexicalStrength.toFixed(3)),
    diversity: Number(diversity.toFixed(3)),
  };
};

const fallbackDecision = ({ rawQuery, confidence, indexAvailable, passages }) => {
  if (TIME_SENSITIVE_PATTERN.test(rawQuery)) return {
    recommended: true,
    code: "time_sensitive_question",
    reason: "The question asks for current or version-specific information that local notes may not contain.",
  };
  if (passages.some((passage) => passage.reserved)) return {
    recommended: false,
    code: "open_lesson_reserved",
    reason: "The request is about the open lesson, and that lesson's passages are attached.",
  };
  if (!indexAvailable && confidence.level !== "high") return {
    recommended: true,
    code: "library_index_unavailable",
    reason: "The complete local search index was unavailable, so the library could not be checked reliably.",
  };
  if (!passages.length) return {
    recommended: true,
    code: "no_library_match",
    reason: "No relevant passage was found anywhere in the local library.",
  };
  if (confidence.score < 0.52 || confidence.coverage < 0.55) return {
    recommended: true,
    code: "weak_library_match",
    reason: "The local passages cover too little of the question for a well-grounded answer.",
  };
  return {
    recommended: false,
    code: "library_match_sufficient",
    reason: "The local library contains sufficiently strong evidence for this question.",
  };
};

/**
 * Search the complete local library and return only bounded, source-anchored
 * passages. Web search is never called here; `trace.webFallback` tells the
 * caller whether a separate, consented web-grounding step is warranted.
 */
export const retrieveLibrary = async (queryValue, options = {}) => {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const rawQuery = cleanText(queryValue, LIBRARY_RETRIEVAL_LIMITS.queryCharacters).trim();
  const query = tokenizeLibraryQuery(rawQuery);
  const documents = (Array.isArray(options.documents) ? options.documents : [])
    .filter((document) => document && typeof document === "object")
    .slice(0, LIBRARY_RETRIEVAL_LIMITS.documents);
  const edits = options.edits && typeof options.edits === "object" ? options.edits : {};
  const personalNotes = options.personalNotes && typeof options.personalNotes === "object" ? options.personalNotes : {};
  const limits = {
    maxCandidateDocuments: boundedInteger(options.maxCandidateDocuments, DEFAULTS.maxCandidateDocuments, LIBRARY_RETRIEVAL_LIMITS.candidateDocuments),
    maxDocuments: boundedInteger(options.maxDocuments, DEFAULTS.maxDocuments, LIBRARY_RETRIEVAL_LIMITS.documentsReturned),
    maxPassages: boundedInteger(options.maxPassages, DEFAULTS.maxPassages, LIBRARY_RETRIEVAL_LIMITS.passages),
    maxPassagesPerDocument: boundedInteger(options.maxPassagesPerDocument, DEFAULTS.maxPassagesPerDocument, LIBRARY_RETRIEVAL_LIMITS.passagesPerDocument),
    maxBytes: boundedInteger(options.maxBytes ?? options.maxCharacters, DEFAULTS.maxBytes, LIBRARY_RETRIEVAL_LIMITS.bytes, 512),
    maxPassageBytes: boundedInteger(options.maxPassageBytes, DEFAULTS.maxPassageBytes, LIBRARY_RETRIEVAL_LIMITS.passageBytes, 256),
  };
  limits.maxPassageBytes = Math.min(limits.maxPassageBytes, limits.maxBytes);
  throwIfAborted(options.signal);

  let searchIndex = new Map();
  let indexAvailable = false;
  let indexError = "";
  try {
    searchIndex = await resolveIndex(options.searchIndex, options.loadSearchIndex);
    indexAvailable = searchIndex.size > 0;
  } catch (error) {
    if (options.signal?.aborted) throwIfAborted(options.signal);
    indexError = cleanText(error?.message || "Search index unavailable", 240);
  }
  throwIfAborted(options.signal);

  const records = documents.map((document, index) => {
    const id = documentIdentity(document, index);
    const hasEdit = Object.hasOwn(edits, id);
    const inlineValue = document.raw ?? document.text ?? document.content;
    const inline = typeof inlineValue === "string" ? inlineValue : "";
    const hasIndexedBody = searchIndex.has(id);
    const indexed = hasEdit ? edits[id] : (inline || searchIndex.get(id) || document.searchText || "");
    const personal = cleanText(personalNotes[id], 100_000);
    const lexical = lexicalScore({
      title: document.title,
      metadata: documentMetadata(document),
      body: `${markdownToSearchText(indexed)} ${markdownToSearchText(personal)}`,
    }, query);
    const selectedBoost = id === options.selectedDocumentId && lexical.matches ? 1.5 : 0;
    return {
      id,
      document,
      lexical: { ...lexical, score: lexical.score + selectedBoost },
      personal,
      bodySearchable: hasEdit || Boolean(inline) || hasIndexedBody,
    };
  });
  const corpusSearchComplete = records.every((record) => record.bodySearchable);
  const matched = records.filter((record) => record.lexical.matches > 0)
    .sort((left, right) => right.lexical.score - left.lexical.score
      || right.lexical.coverage - left.lexical.coverage
      || left.id.localeCompare(right.id));
  // A request about the open lesson ("explain this lesson", an unedited mode
  // default, or an Ask AI excerpt) reserves that lesson's passages, whether
  // or not its generic wording matches the lesson lexically.
  const reservedCount = boundedInteger(options.reservedPassages, 0, Math.min(LIBRARY_RETRIEVAL_LIMITS.reservedPassages, limits.maxPassages), 0);
  const reservedRecord = reservedCount && options.reservedDocumentId
    ? records.find((record) => record.id === options.reservedDocumentId) || null
    : null;
  const candidateRecords = matched.slice(0, limits.maxCandidateDocuments);
  if (reservedRecord && !candidateRecords.includes(reservedRecord)) candidateRecords.push(reservedRecord);
  const loadStartedAt = globalThis.performance?.now?.() ?? Date.now();
  const loadedResults = await Promise.all(candidateRecords.map(async (record) => {
    try {
      const markdown = await sourceForDocument(record, {
        edits,
        personalNotes,
        loadSource: options.loadSource,
        signal: options.signal,
      });
      return { record, markdown, error: "" };
    } catch (error) {
      if (options.signal?.aborted) throwIfAborted(options.signal);
      return { record, markdown: "", error: cleanText(error?.message || "Source unavailable", 240) };
    }
  }));
  throwIfAborted(options.signal);

  const passageCandidates = loadedResults.flatMap(({ record, markdown }) => (
    makeCandidatePassages(record, markdown, record.personal, query, options.selectedDocumentId, { includeUnmatched: record === reservedRecord })
  ));
  const reserved = reservedRecord ? reservedDocumentPassages(passageCandidates, reservedRecord.id, reservedCount) : [];
  const reservedIds = new Set(reserved.map((candidate) => candidate.id));
  // Unmatched open-lesson passages are eligible only as reserved passages.
  const eligible = passageCandidates.filter((candidate) => candidate.matched || reservedIds.has(candidate.id));
  const selection = selectDiversifiedPassages(eligible, limits, reserved);
  const failedLoads = loadedResults.filter((result) => result.error);
  const confidence = confidenceFor(selection.passages, query, { indexAvailable: corpusSearchComplete, failedLoads: failedLoads.length });
  const webFallback = fallbackDecision({ rawQuery, confidence, indexAvailable: corpusSearchComplete, passages: selection.passages });
  const sources = [...new Map(selection.passages.map((passage) => [passage.documentId, {
    id: passage.documentId,
    documentId: passage.documentId,
    title: passage.title,
    sourceType: records.find((record) => record.id === passage.documentId)?.document?.source === "custom"
      || passage.documentId.startsWith("custom/") ? "custom" : "builtin",
    revision: passage.revision.split(":personal-note:")[0],
    anchors: [],
  }])).values()].map((source) => ({
    ...source,
    anchors: [...new Set(selection.passages
      .filter((passage) => passage.documentId === source.documentId)
      .map((passage) => passage.anchor)
      .filter(Boolean))],
  }));
  const finishedAt = globalThis.performance?.now?.() ?? Date.now();

  return {
    passages: selection.passages.map(({ coverage, matched: _matched, ordinal: _ordinal, ...passage }) => ({
      ...passage,
      score: Number(passage.score.toFixed(3)),
    })),
    sources,
    trace: {
      version: 1,
      strategy: "library_first_lexical_v1",
      query: { normalized: query.normalized, terms: query.terms, phrases: query.phrases },
      corpus: {
        documentsScanned: records.length,
        builtInDocuments: records.filter((record) => record.document?.source !== "custom" && !record.id.startsWith("custom/")).length,
        customDocuments: records.filter((record) => record.document?.source === "custom" || record.id.startsWith("custom/")).length,
        personalNotes: records.filter((record) => record.personal.trim()).length,
        searchIndex: indexAvailable ? "ready" : (corpusSearchComplete ? "not_required" : "unavailable"),
      },
      selection: {
        matchedDocuments: matched.length,
        candidateDocuments: candidateRecords.length,
        loadedDocuments: loadedResults.length - failedLoads.length,
        failedDocuments: failedLoads.map((result) => result.record.id).slice(0, 8),
        returnedDocuments: sources.length,
        returnedPassages: selection.passages.length,
        reservedDocumentId: reservedRecord ? reservedRecord.id : "",
        reservedPassages: selection.passages.filter((passage) => reservedIds.has(passage.id)).length,
      },
      budget: {
        maximumBytes: limits.maxBytes,
        returnedBytes: selection.bytes,
        maximumPassages: limits.maxPassages,
        truncated: selection.budgetTruncated,
      },
      confidence,
      webFallback,
      diagnostics: {
        indexError,
        loadMilliseconds: Number(Math.max(0, finishedAt - loadStartedAt).toFixed(2)),
        totalMilliseconds: Number(Math.max(0, finishedAt - startedAt).toFixed(2)),
      },
    },
  };
};
