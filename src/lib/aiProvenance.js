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

/**
 * Provenance of saved AI output (issue #81). An AI flashcard carries the
 * `ai-draft` tag, and an answer saved to notes is a clipping with origin
 * `ai-tutor`. Wherever that text renders later it goes through the untrusted
 * Markdown profile (untrustedMarkdown.js), never the Reader's renderer, which
 * keeps author HTML for learner notes.
 */
export const AI_DRAFT_TAG = "ai-draft";

export const isAiAuthoredClipping = (clip) => clip?.origin === "ai-tutor";

/** Ids of the clippings the tutor wrote, for isAiAuthoredReviewItem. */
export const aiClippingIds = (clippings) => new Set((Array.isArray(clippings) ? clippings : [])
  .filter(isAiAuthoredClipping)
  .map((clip) => clip.id));

/**
 * True for a card the tutor wrote: an AI flashcard, or a card made from an AI
 * clipping (cards made before #81 carry no tag, only the clipping id).
 */
export const isAiAuthoredReviewItem = (item, aiClippingIdSet = new Set()) => Boolean(item) && (
  (Array.isArray(item.tags) && item.tags.includes(AI_DRAFT_TAG))
  || (typeof item.sourceClippingId === "string" && item.sourceClippingId !== "" && aiClippingIdSet.has(item.sourceClippingId))
);

/** Tags with `ai-draft` first, so a tag limit can never drop the provenance. */
export const withAiDraftTag = (tags) => [AI_DRAFT_TAG, ...(Array.isArray(tags) ? tags : []).filter((tag) => tag !== AI_DRAFT_TAG)];
