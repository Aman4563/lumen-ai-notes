const MAX_PROVENANCE_SOURCES = 8;

const cleanLabel = (value, fallback) => {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu, " ")
    .replace(/[\[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
};

const normalizeWebSources = (sources) => (Array.isArray(sources) ? sources : [])
  .slice(0, MAX_PROVENANCE_SOURCES)
  .flatMap((source, index) => {
    try {
      const url = new URL(String(source?.url || ""));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      const citationIndex = Number.isSafeInteger(source?.index) && source.index > 0 ? source.index : index + 1;
      return [{ index: citationIndex, title: cleanLabel(source?.title, `Web source ${citationIndex}`), url: url.href }];
    } catch {
      return [];
    }
  });

const markdownLink = (label, source) => `[${label}: ${source.title}](<${source.url}>)`;

/**
 * Materialize transient AI citation tokens into stable Markdown links before a
 * generated card enters the durable review deck. Review cards therefore keep
 * their provenance after tutor history is cleared, reloaded, or backed up.
 */
export const materializeAiCardProvenance = (value, metadata = {}) => {
  const text = String(value || "");
  const sources = normalizeWebSources(metadata.webSources);
  if (!sources.length) return text.replace(/\[W(\d{1,2})\](?!\()/giu, (_match, number) => `[web source W${number} unavailable]`);

  if (metadata.webCitationStyle === "numeric") {
    return text.replace(/\[(\d{1,2})\](?!\()/gu, (match, number) => {
      const source = sources.find((candidate) => candidate.index === Number(number));
      return source ? markdownLink(`Web ${number}`, source) : match;
    });
  }

  return text.replace(/\[W(\d{1,2})\](?!\()/giu, (_match, number) => {
    const source = sources.find((candidate) => candidate.index === Number(number));
    return source ? markdownLink(`W${number}`, source) : `[web source W${number} unavailable]`;
  });
};

export const materializeAiFlashcard = (card, metadata = {}) => ({
  ...card,
  front: materializeAiCardProvenance(card?.front, metadata),
  back: materializeAiCardProvenance(card?.back, metadata),
  hint: card?.hint == null ? card?.hint : materializeAiCardProvenance(card.hint, metadata),
});
