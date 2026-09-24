const OPEN_LESSON_REFERENCE = /\b(?:this|these|that|current|open|opened|selected|highlighted)\s+(?:lessons?|lectures?|chapters?|sections?|material|excerpts?|passages?|pages?|notes?|topics?|documents?|readings?|text)\b|\bthe\s+(?:current|open|opened|selected)\s+\w+/iu;

/**
 * True when a Library-first request is about the lesson the learner has open
 * ("explain this lesson", "the selected material", an Ask AI excerpt). Such
 * wording shares no terms with the lesson, so retrieval must reserve it.
 */
export const refersToOpenLesson = (prompt) => OPEN_LESSON_REFERENCE.test(String(prompt || ""));

/** A web query is allowed only when both independent gates are true. */
export const shouldUseWebFallback = ({ learnerAllowedWeb, trace }) => (
  learnerAllowedWeb === true && trace?.webFallback?.recommended === true
);

export const retrievalTraceCounts = (trace) => ({
  candidates: Number.isSafeInteger(trace?.corpus?.documentsScanned)
    ? trace.corpus.documentsScanned
    : Number.isSafeInteger(trace?.selection?.candidateDocuments)
      ? trace.selection.candidateDocuments
      : Number.isSafeInteger(trace?.candidates) ? trace.candidates : null,
  matchedDocuments: Number.isSafeInteger(trace?.selection?.matchedDocuments)
    ? trace.selection.matchedDocuments
    : null,
  passages: Number.isSafeInteger(trace?.selection?.returnedPassages)
    ? trace.selection.returnedPassages
    : Number.isSafeInteger(trace?.passages) ? trace.passages : null,
});

const PROFILE_FALLBACKS = Object.freeze({ fast: 1_200, balanced: 3_000, deep: 8_192 });
const SOURCE_CLIP_MARKER = "\n\n[… source excerpt clipped by Lumen …]\n\n";

const neutralizeSourceLabels = (value) => String(value ?? "")
  // Source text is untrusted and may itself contain label-shaped lines. Use
  // full-width brackets so only Lumen-owned block headers can enter the
  // request's explicit contextCitations contract.
  .replace(/^(\s*)\[([SW])([1-9]\d*)\](?=\s)/gmu, "$1［$2$3］");

const clipSourceExcerpt = (value, maximum) => {
  const text = neutralizeSourceLabels(value).replace(/\r\n?/g, "\n").trim();
  if (text.length <= maximum) return text;
  if (maximum <= SOURCE_CLIP_MARKER.length + 20) return text.slice(0, Math.max(0, maximum));
  const available = Math.max(0, maximum - SOURCE_CLIP_MARKER.length);
  const start = Math.ceil(available * 0.72);
  return `${text.slice(0, start)}${SOURCE_CLIP_MARKER}${text.slice(text.length - (available - start))}`;
};

/**
 * Builds only complete, labelled source blocks. Returning the included labels
 * with the text prevents the UI from claiming that a tail source survived an
 * exact-byte fit when its block was actually omitted or cut mid-header.
 */
export const buildTutorContext = (sources, maximumCharacters) => {
  const candidates = Array.isArray(sources) ? sources : [];
  const maximum = Math.max(0, Math.floor(Number(maximumCharacters) || 0));
  const blocks = [];
  const includedCitationNumbers = [];
  let remaining = maximum;

  for (let index = 0; index < candidates.length && remaining > 0; index += 1) {
    const source = candidates[index];
    const citationNumber = Number(source?.citationNumber);
    if (!Number.isSafeInteger(citationNumber) || citationNumber < 1) continue;
    const title = String(source?.title || "Untitled learning source").replace(/\s+/g, " ").trim().slice(0, 200);
    const section = String(source?.section || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const header = `[S${citationNumber}] ${title}${section ? ` — ${section}` : ""}\n`;
    const separator = blocks.length ? "\n\n" : "";
    const minimumEvidenceCharacters = 48;
    const availableAfterHeader = remaining - separator.length - header.length;
    if (availableAfterHeader < minimumEvidenceCharacters) continue;

    const candidatesLeft = Math.max(1, candidates.length - index);
    const fairBlockCharacters = Math.floor((remaining - separator.length) / candidatesLeft);
    const blockCharacters = Math.min(
      remaining - separator.length,
      Math.max(header.length + minimumEvidenceCharacters, fairBlockCharacters),
    );
    const excerpt = clipSourceExcerpt(source?.text, blockCharacters - header.length);
    if (!excerpt) continue;
    const block = `${header}${excerpt}`;
    if (separator.length + block.length > remaining) continue;
    blocks.push(block);
    includedCitationNumbers.push(citationNumber);
    remaining -= separator.length + block.length;
  }

  return { context: blocks.join("\n\n"), includedCitationNumbers };
};

export const outputTokensForProfile = ({ profile, responseProfiles, maximum, structured = false }) => {
  const safeProfile = ["fast", "balanced", "deep"].includes(profile) ? profile : "balanced";
  const ceiling = Number.isSafeInteger(maximum) && maximum >= 128 ? maximum : 4_096;
  const advertised = responseProfiles?.outputTokens?.[safeProfile];
  const requested = Number.isSafeInteger(advertised) && advertised >= 128 ? advertised : PROFILE_FALLBACKS[safeProfile];
  // Structured schemas need a safety ceiling, not an unconditional increase.
  // Raising Fast/Balanced to 4,096 here made the browser fit against the
  // selected profile's larger input budget while the server correctly
  // reserved 4,096 output tokens and rejected the same payload.
  return Math.max(128, Math.min(ceiling, requested, structured ? 4_096 : Number.POSITIVE_INFINITY));
};
