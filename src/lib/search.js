const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

import { synonymAlternatesFor } from "./searchSynonyms.js";

/** Ranked searches return at most this many documents; the UI says "Top N". */
export const SEARCH_RESULT_LIMIT = 100;

/**
 * Autocorrect and copied search tips can put a typographic minus (U+2212) or
 * an en/em dash where the ASCII exclusion hyphen belongs. Folding them at a
 * word start makes "−term" exclude exactly like "-term".
 */
export const normalizeQueryText = (query) => String(query || "").replace(/(^|\s)[−–—](?=\S)/g, "$1-");

/**
 * Field filters (SEARCH-001): `title:term`, `part:5` / `part:math`,
 * `tag:interview`, and `has:code` / `has:formula`. Values may be quoted for
 * phrases. Filter tokens are stripped before ordinary term tokenization so
 * they never double as body terms.
 */
const FIELD_FILTER_PATTERN = /(?:^|\s)(title|part|tag|has):("[^"]*"|[^\s]+)/g;

export const tokenizeFieldFilters = (query) => {
  const filters = { title: [], part: [], tag: [], has: [] };
  for (const match of normalize(normalizeQueryText(query)).matchAll(FIELD_FILTER_PATTERN)) {
    const value = match[2].replaceAll('"', "").trim();
    if (value && filters[match[1]].length < 4) filters[match[1]].push(value);
  }
  filters.has = filters.has.filter((value) => value === "code" || value === "formula");
  return filters;
};

export const stripFieldFilters = (query) => String(query || "").replace(FIELD_FILTER_PATTERN, " ");

export const hasFieldFilters = (filters) => filters.title.length > 0 || filters.part.length > 0 || filters.tag.length > 0 || filters.has.length > 0;

/**
 * Content-capability flags computed once per document at corpus ingestion:
 * fenced/indented code and TeX-style formula markers.
 */
export const contentCapabilities = (text) => {
  // Mermaid blocks are diagrams, not code — remove them whole so their
  // closing fence cannot count as a code fence.
  const value = String(text || "").replace(/```mermaid[\s\S]*?```/g, " ");
  return {
    hasCode: /```|~~~/.test(value),
    // Formulas in this corpus are TeX-style ($$, \( \[, inline $…$) or the
    // curriculum's house style: <sub>/<sup> markup and blockquote lines
    // carrying =/≈/≤/≥ math (e.g. "> f′(x) = lim …").
    hasFormula: /\$\$|\\\(|\\\[|<su[bp]>|(?:^|[^$\\])\$[^\s$][^$\n]{0,200}\$/.test(value)
      || /^>\s[^\n]*[=≈≤≥][^\n]*$/m.test(value),
  };
};

/**
 * Deterministic plural folding (SEARCH-001): a term may match its simple
 * singular ("optimizers" → "optimizer", "queries" → "query") or its plain
 * plural. No dictionary — just the three regular English suffixes.
 */
/**
 * Deterministic spelling folds (SEARCH-001 synonyms slice): British -ise
 * variants map onto the corpus's American -ize forms, and hyphen/squash
 * variants (k-means/kmeans) fold both ways. Applied as match alternates,
 * never as index rewrites.
 */
export const spellingAlternates = (term) => {
  const alternates = new Set();
  if (/is(e|ed|es|ing|ation)$/.test(term)) alternates.add(term.replace(/is(e|ed|es|ing|ation)$/, "iz$1"));
  if (/iz(e|ed|es|ing|ation)$/.test(term)) alternates.add(term.replace(/iz(e|ed|es|ing|ation)$/, "is$1"));
  if (term.includes("-")) alternates.add(term.replaceAll("-", ""));
  alternates.delete(term);
  return [...alternates];
};

export const foldPluralTerm = (term) => {
  if (term.length < 4) return term;
  if (term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.endsWith("ses") || term.endsWith("xes") || term.endsWith("hes")) return term.slice(0, -2);
  if (term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
};

export const tokenizeQuery = (query) => {
  const normalized = normalize(stripFieldFilters(normalizeQueryText(query))).trim();
  if (!normalized) return [];
  const phrases = [...normalized.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const remainder = normalized.replace(/"[^"]+"/g, " ");
  const words = remainder.split(/[^a-z0-9+#.-]+/).filter((word) => word.length > 1 && !word.startsWith("-"));
  return [...new Set([...phrases, ...words])].slice(0, 12);
};

/**
 * `-term` tokens exclude documents that contain the term (SEARCH-001).
 * A bare "-" or quoted phrase is never treated as an exclusion.
 */
export const tokenizeExclusions = (query) => {
  const normalized = normalize(stripFieldFilters(normalizeQueryText(query))).trim();
  if (!normalized) return [];
  const remainder = normalized.replace(/"[^"]+"/g, " ");
  const exclusions = [...remainder.matchAll(/(?:^|\s)-([a-z0-9+#.-]{2,})/g)].map((match) => match[1]);
  return [...new Set(exclusions)].slice(0, 6);
};

/**
 * Words typed in capitals ("RAG", "PPO", "GPT4") are acronyms: they match
 * only as whole words (plural allowed), never inside another word.
 */
export const acronymTerms = (query) => new Set(stripFieldFilters(normalizeQueryText(query))
  .replace(/"[^"]*"/g, " ")
  .split(/[^A-Za-z0-9+#.-]+/)
  .map((word) => word.replace(/^-+/, ""))
  .filter((word) => word.length >= 2 && /[A-Z]/.test(word) && !/[a-z]/.test(word))
  .map((word) => normalize(word)));

const isWordCode = (code) => (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

/**
 * How a term must sit in the text: acronyms need whole words, short terms
 * and phrases must start a word ("rag" never matches "storage", while
 * "tran" still finds "transformer" as you type), and longer terms may match
 * anywhere.
 */
export const termMatchMode = (term, acronyms = new Set()) => {
  if (acronyms.has(term)) return "word";
  if (term.includes(" ") || term.length <= 4) return "start";
  return "any";
};

/**
 * Index of the first occurrence of `term` in normalized `haystack` that
 * satisfies `mode` ("any", "start", or "word" with an optional plural
 * suffix), or -1. Plain indexOf scanning keeps boundary checks close to the
 * cost of a substring search over the corpus.
 */
export const findTerm = (haystack, term, mode = "any", from = 0) => {
  if (!term) return -1;
  if (mode === "any") return haystack.indexOf(term, from);
  const checkStart = isWordCode(term.charCodeAt(0));
  const checkEnd = isWordCode(term.charCodeAt(term.length - 1));
  let index = haystack.indexOf(term, from);
  while (index >= 0) {
    if (!checkStart || !isWordCode(haystack.charCodeAt(index - 1))) {
      if (mode === "start" || !checkEnd) return index;
      const end = index + term.length;
      const after = haystack.charCodeAt(end);
      if (!isWordCode(after)) return index;
      if (after === 115 && !isWordCode(haystack.charCodeAt(end + 1))) return index;
      if (after === 101 && haystack.charCodeAt(end + 1) === 115 && !isWordCode(haystack.charCodeAt(end + 2))) return index;
    }
    index = haystack.indexOf(term, index + 1);
  }
  return -1;
};

const countTerm = (haystack, term, mode) => {
  let count = 0;
  let index = findTerm(haystack, term, mode);
  while (index >= 0 && count < 8) {
    count += 1;
    index = findTerm(haystack, term, mode, index + term.length);
  }
  return count;
};

/**
 * Bounded typo tolerance (SEARCH-001): true when two words are within one
 * edit (insertion, deletion, or substitution). Only used for terms of five
 * or more characters so short technical tokens stay exact.
 */
export const withinOneEdit = (left, right) => {
  if (left === right) return true;
  const lengthDelta = left.length - right.length;
  if (lengthDelta < -1 || lengthDelta > 1) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (shorter.length === longer.length) shortIndex += 1;
    longIndex += 1;
  }
  return edits + (longer.length - longIndex) <= 1;
};

/** Markdown reduced to readable plain text for result snippets. */
export const plainSnippetText = (raw) => String(raw || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const SNIPPET_BEFORE = 70;
const SNIPPET_AFTER = 130;
// Case-preserved text plus a folded copy for documents whose snippet text
// is not offset-aligned with the normalized search body (custom Markdown and
// lectures with NFKD-expanding characters). Filled only for returned results.
const snippetSources = new WeakMap();

// Accent-folded when that keeps every offset ("café" → "cafe"), so a folded
// query term still finds its context; otherwise only lowercased.
const offsetSafeFold = (plain) => {
  const folded = normalize(plain);
  return folded.length === plain.length ? folded : plain.toLocaleLowerCase();
};

const snippetSource = (doc) => {
  const cached = snippetSources.get(doc);
  if (cached) return cached;
  let source = null;
  if (typeof doc.snippetText === "string" && doc.snippetText) {
    const plain = doc.snippetText;
    // Built-in lectures: the worker's normalized body lines up with the
    // case-preserved text whenever normalization kept every length.
    const aligned = typeof doc.normalizedSearchText === "string" && doc.normalizedSearchText.length === plain.length;
    source = { plain, lower: aligned ? doc.normalizedSearchText : offsetSafeFold(plain) };
  } else if (doc.raw) {
    const plain = plainSnippetText(doc.raw);
    source = { plain, lower: offsetSafeFold(plain) };
  }
  if (!source || source.lower.length !== source.plain.length) return null;
  if (source.lower !== doc.normalizedSearchText) snippetSources.set(doc, source);
  return source;
};

const snippetWindow = (plain, index, length, floor = 0) => {
  let start = Math.max(floor, index - SNIPPET_BEFORE);
  let end = Math.min(plain.length, index + length + SNIPPET_AFTER);
  if (start > floor) {
    const space = plain.indexOf(" ", start);
    if (space >= 0 && space < index) start = space + 1;
  }
  if (end < plain.length) {
    const space = plain.lastIndexOf(" ", end);
    if (space > index + length) end = space;
  }
  const excerpt = plain.slice(start, end)
    .replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, entity) => HTML_ENTITIES[entity])
    .replace(/^[\s.,;:!?)\]—–-]+/, "")
    .trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < plain.length ? "…" : ""}`;
};

const HTML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", nbsp: " " };

/**
 * A readable excerpt, in the original capitalization, around the first body
 * occurrence of the most specific matched term. A leading title line is
 * skipped so the snippet adds context instead of repeating the card title.
 */
const snippetFor = (doc, candidates) => {
  const source = snippetSource(doc);
  if (!source) return doc.description;
  const titleKey = normalize(doc.title);
  const from = titleKey && source.lower.startsWith(titleKey) ? titleKey.length : 0;
  for (const { text, mode } of candidates) {
    const index = findTerm(source.lower, text, mode, from);
    if (index >= 0) return snippetWindow(source.plain, index, text.length, from);
  }
  return doc.description;
};

/**
 * Splits normalized text into the word list used for typo-tolerant matching.
 * The worker calls this once per document at ingestion; ad-hoc callers pay it
 * only for small metadata strings.
 */
export const buildSearchWords = (normalizedText) => [...new Set(String(normalizedText || "").split(/[^a-z0-9+#.-]+/).filter((word) => word.length >= 4))];

/** The document word within one edit of `term` (trailing dots/hyphens trimmed), or "". */
const fuzzyWordMatch = (words, term) => {
  for (const word of words) {
    const delta = word.length - term.length;
    if (delta < -1 || delta > 1) continue;
    if (withinOneEdit(word, term)) return word.replace(/[.-]+$/, "") || word;
  }
  return "";
};

// A typo-tolerant hit scores the corrected word with the normal field
// weights times this discount — below the synonym tier's 0.5 — so exact >
// synonym > fuzzy holds field for field while the closest corrected match
// (a title hit) still ranks first among corrected results.
const FUZZY_WEIGHT = 0.4;

/**
 * Recent searches record committed queries only (Enter, opening a result,
 * leaving the field, or a pause). A newer entry replaces older entries that
 * were unfinished prefixes of it ("dro" → "dropout"), while "attention"
 * survives "attention mask" because the longer query starts a new word.
 */
export const RECENT_SEARCH_LIMIT = 6;

const recentKey = (entry) => normalizeQueryText(entry).toLocaleLowerCase().replaceAll('"', "").replace(/\s+/g, " ").trim();
const isUnfinishedPrefix = (shorter, longer) => longer.length > shorter.length
  && longer.startsWith(shorter)
  && isWordCode(longer.charCodeAt(shorter.length));

export const pushRecentSearch = (list, entry, limit = RECENT_SEARCH_LIMIT) => {
  const current = Array.isArray(list) ? list : [];
  const value = String(entry || "").trim();
  const key = recentKey(value);
  if (!key) return current;
  const kept = current.filter((item) => {
    const other = recentKey(item);
    return other && other !== key && !isUnfinishedPrefix(other, key);
  });
  return [value, ...kept].slice(0, limit);
};

/** Cleans a stored list: blanks, duplicates, and unfinished prefixes drop out. */
export const pruneRecentSearches = (list, limit = RECENT_SEARCH_LIMIT) => {
  const entries = (Array.isArray(list) ? list : []).filter((entry) => typeof entry === "string" && entry.trim());
  const keys = entries.map(recentKey);
  return entries
    .filter((_, index) => keys.indexOf(keys[index]) === index && !keys.some((other) => isUnfinishedPrefix(keys[index], other)))
    .map((entry) => entry.trim())
    .slice(0, limit);
};

export const searchDocuments = (documents, query) => {
  const text = normalizeQueryText(query);
  const terms = tokenizeQuery(text);
  const filters = tokenizeFieldFilters(text);
  const filtered = hasFieldFilters(filters);
  const exclusions = tokenizeExclusions(text);
  // An exclusion on its own ("-regression") is a real query: everything except.
  if (!terms.length && !filtered && !exclusions.length) return documents;
  const acronyms = acronymTerms(text);
  const modeOf = (term) => termMatchMode(term, acronyms);
  const exact = normalize(stripFieldFilters(text)).replace(/(^|\s)-\S+/g, " ").replaceAll('"', "").replace(/\s+/g, " ").trim();
  const exactMode = exact.includes(" ") ? "start" : modeOf(exact);

  const ranked = [];
  for (const doc of documents) {
    const title = normalize(doc.title);
    const part = normalize(doc.partTitle);
    const description = normalize(doc.description);
    // The worker pre-normalizes immutable corpus text once; recomputing the
    // NFKD pass over ~1 MB per keystroke was the dominant search cost.
    const body = typeof doc.normalizedSearchText === "string" ? doc.normalizedSearchText : normalize(doc.searchText);
    const all = `${title} ${part} ${description} ${body}`;
    if (exclusions.some((exclusion) => findTerm(all, exclusion, modeOf(exclusion)) >= 0)) continue;
    if (filters.title.some((value) => findTerm(title, value, modeOf(value)) < 0)) continue;
    // part:5 means exactly Part 5 (never 15); part:supervised matches a Part-title word.
    if (filters.part.length && !filters.part.every((value) => (/^\d+$/.test(value) ? doc.partNumber === Number(value) : findTerm(part, value, "start") >= 0))) continue;
    if (filters.tag.length) {
      const tags = (doc.tags || []).map((tag) => normalize(tag));
      if (!filters.tag.every((value) => tags.some((tag) => tag.includes(value)))) continue;
    }
    if (filters.has.includes("code") && !doc.hasCode) continue;
    if (filters.has.includes("formula") && !doc.hasFormula) continue;
    // Every term must match; a term of five or more characters may match a
    // document word within one edit so a single typo does not zero results.
    const matched = [];
    const synonymTerms = [];
    const fuzzyTerms = [];
    const corrections = [];
    let missing = false;
    for (const term of terms) {
      const mode = modeOf(term);
      if (findTerm(all, term, mode) >= 0) {
        matched.push({ text: term, mode });
        continue;
      }
      // Plural folding: the singular or plain plural counts as a match and
      // stays highlightable, ranking just below the exact form.
      const folded = foldPluralTerm(term);
      if (folded !== term && findTerm(all, folded, modeOf(folded)) >= 0) {
        matched.push({ text: folded, mode: modeOf(folded) });
        continue;
      }
      if (!term.includes(" ") && findTerm(all, `${term}s`, mode) >= 0) {
        matched.push({ text: `${term}s`, mode });
        continue;
      }
      // Spelling/hyphen folds rank with exact matches; curated synonyms
      // rank at a dedicated half-weight tier above typo tolerance.
      const spelled = spellingAlternates(term).find((alternate) => findTerm(all, alternate, modeOf(alternate)) >= 0);
      if (spelled) {
        matched.push({ text: spelled, mode: modeOf(spelled) });
        continue;
      }
      const synonym = synonymAlternatesFor(term).find((alternate) => findTerm(all, alternate.text, alternate.boundary ? "word" : "any") >= 0);
      if (synonym) {
        synonymTerms.push({ text: synonym.text, mode: synonym.boundary ? "word" : "any" });
        continue;
      }
      if (term.length >= 5 && !term.includes(" ") && !acronyms.has(term)) {
        const words = Array.isArray(doc.searchWords) ? doc.searchWords : buildSearchWords(all);
        const word = fuzzyWordMatch(words, term);
        if (word) {
          fuzzyTerms.push({ text: word, mode: "any" });
          corrections.push({ term, word });
          continue;
        }
      }
      missing = true;
      break;
    }
    if (missing) continue;
    let score = exact && findTerm(title, exact, exactMode) >= 0 ? 45 : 0;
    score += exact && findTerm(all, exact, exactMode) >= 0 ? 15 : 0;
    for (const { text: term, mode } of matched) {
      if (title === term) score += 30;
      else if (findTerm(title, term, mode === "any" ? "start" : mode) >= 0) score += 18;
      // A longer term buried inside a title word ("former" in "transformer") counts for less.
      else if (findTerm(title, term, mode) >= 0) score += 12;
      if (findTerm(part, term, mode) >= 0) score += 8;
      if (findTerm(description, term, mode) >= 0) score += 7;
      score += Math.min(countTerm(body, term, mode), 6) * 1.5;
    }
    // Synonym tier: half the exact field weights, so an exact match of the
    // same shape always outranks a synonym match, which outranks fuzzy.
    for (const { text: alternate, mode } of synonymTerms) {
      if (findTerm(title, alternate, mode) >= 0) score += 9;
      if (findTerm(part, alternate, mode) >= 0) score += 4;
      if (findTerm(description, alternate, mode) >= 0) score += 3.5;
      score += Math.min(countTerm(body, alternate, mode), 6) * 0.75;
    }
    for (const { text: word } of fuzzyTerms) {
      if (findTerm(title, word, "any") >= 0) score += 18 * FUZZY_WEIGHT;
      if (findTerm(part, word, "any") >= 0) score += 8 * FUZZY_WEIGHT;
      if (findTerm(description, word, "any") >= 0) score += 7 * FUZZY_WEIGHT;
      score += Math.min(countTerm(body, word, "any"), 6) * 1.5 * FUZZY_WEIGHT;
    }
    ranked.push({ doc, score, matched, synonymTerms, fuzzyTerms, corrections });
  }

  ranked.sort((a, b) => b.score - a.score || a.doc.partNumber - b.doc.partNumber || a.doc.chapterNumber - b.doc.chapterNumber);
  const filterTerms = [...filters.title, ...filters.tag].map((value) => ({ text: value, mode: modeOf(value) }));
  // Snippets are built only for the documents actually returned.
  return ranked.slice(0, SEARCH_RESULT_LIMIT).map(({ doc, score, matched, synonymTerms, fuzzyTerms, corrections }) => {
    const highlighted = [...matched, ...synonymTerms, ...fuzzyTerms];
    const specificFirst = [...highlighted].sort((left, right) => right.text.length - left.text.length);
    const candidates = [...(exact.includes(" ") ? [{ text: exact, mode: exactMode }] : []), ...specificFirst, ...filterTerms];
    return {
      ...doc,
      description: candidates.length ? snippetFor(doc, candidates) : doc.description,
      searchScore: score,
      matchedTerms: highlighted.map(({ text }) => text),
      corrections,
    };
  });
};
