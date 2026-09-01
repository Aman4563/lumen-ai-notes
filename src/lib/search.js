const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

export const tokenizeQuery = (query) => {
  const normalized = normalize(query).trim();
  if (!normalized) return [];
  const phrases = [...normalized.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const remainder = normalized.replace(/"[^"]+"/g, " ");
  const words = remainder.split(/[^a-z0-9+#.-]+/).filter((word) => word.length > 1);
  return [...new Set([...phrases, ...words])].slice(0, 12);
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

export const searchDocuments = (documents, query) => {
  const terms = tokenizeQuery(query);
  if (!terms.length) return documents;
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
      if (!terms.every((term) => all.includes(term))) return null;
      let score = exact && title.includes(exact) ? 45 : 0;
      score += exact && all.includes(exact) ? 15 : 0;
      for (const term of terms) {
        if (title === term) score += 30;
        else if (title.includes(term)) score += 18;
        if (part.includes(term)) score += 8;
        if (description.includes(term)) score += 7;
        score += Math.min(occurrences(body, term), 6) * 1.5;
      }
      return { ...doc, description: snippetAround(doc, terms[0]), searchScore: score };
    })
    .filter(Boolean)
    .sort((a, b) => b.searchScore - a.searchScore || a.partNumber - b.partNumber || a.chapterNumber - b.chapterNumber)
    .slice(0, 100);
};
