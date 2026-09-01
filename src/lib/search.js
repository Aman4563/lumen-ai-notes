const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

export const tokenizeQuery = (query) => {
  const normalized = normalize(query).trim();
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
  const normalized = normalize(query).trim();
  if (!normalized) return [];
  const remainder = normalized.replace(/"[^"]+"/g, " ");
  const exclusions = [...remainder.matchAll(/(?:^|\s)-([a-z0-9+#.-]{2,})/g)].map((match) => match[1]);
  return [...new Set(exclusions)].slice(0, 6);
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

const occurrences = (haystack, needle) => {
  let count = 0;
  let from = 0;
  while (count < 8) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
};

const snippetAround = (doc, term) => {
  const plain = String(doc.raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~|\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalize(plain);
  const index = lower.indexOf(term);
  if (index < 0) return doc.description;
  const start = Math.max(0, index - 75);
  const end = Math.min(plain.length, index + term.length + 125);
  return `${start ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
};

/**
 * Splits normalized text into the word list used for typo-tolerant matching.
 * The worker calls this once per document at ingestion; ad-hoc callers pay it
 * only for small metadata strings.
 */
export const buildSearchWords = (normalizedText) => [...new Set(String(normalizedText || "").split(/[^a-z0-9+#.-]+/).filter((word) => word.length >= 4))];

const fuzzyWordMatch = (words, term) => {
  for (const word of words) {
    const delta = word.length - term.length;
    if (delta < -1 || delta > 1) continue;
    if (withinOneEdit(word, term)) return true;
  }
  return false;
};

export const searchDocuments = (documents, query) => {
  const terms = tokenizeQuery(query);
  if (!terms.length) return documents;
  const exclusions = tokenizeExclusions(query);
  const exact = normalize(query).replaceAll('"', "").trim();

  return documents
    .map((doc) => {
      const title = normalize(doc.title);
      const part = normalize(doc.partTitle);
      const description = normalize(doc.description);
      // The worker pre-normalizes immutable corpus text once; recomputing the
      // NFKD pass over ~1 MB per keystroke was the dominant search cost.
      const body = typeof doc.normalizedSearchText === "string" ? doc.normalizedSearchText : normalize(doc.searchText);
      const all = `${title} ${part} ${description} ${body}`;
      if (exclusions.some((exclusion) => all.includes(exclusion))) return null;
      // Every term must match; a term of five or more characters may match a
      // document word within one edit so a single typo does not zero results.
      let fuzzyTerms = 0;
      const matchedTerms = [];
      for (const term of terms) {
        if (all.includes(term)) {
          matchedTerms.push(term);
          continue;
        }
        if (term.length >= 5 && !term.includes(" ")) {
          const words = Array.isArray(doc.searchWords) ? doc.searchWords : buildSearchWords(all);
          if (fuzzyWordMatch(words, term)) {
            fuzzyTerms += 1;
            continue;
          }
        }
        return null;
      }
      let score = exact && title.includes(exact) ? 45 : 0;
      score += exact && all.includes(exact) ? 15 : 0;
      for (const term of matchedTerms) {
        if (title === term) score += 30;
        else if (title.includes(term)) score += 18;
        if (part.includes(term)) score += 8;
        if (description.includes(term)) score += 7;
        score += Math.min(occurrences(body, term), 6) * 1.5;
      }
      // A typo-tolerant hit keeps the document visible but ranks below any
      // exact match of the same shape.
      score += fuzzyTerms * 1;
      const snippetTerm = matchedTerms[0] || terms[0];
      return { ...doc, description: snippetAround(doc, snippetTerm), searchScore: score, matchedTerms };
    })
    .filter(Boolean)
    .sort((a, b) => b.searchScore - a.searchScore || a.partNumber - b.partNumber || a.chapterNumber - b.chapterNumber)
    .slice(0, 100);
};
