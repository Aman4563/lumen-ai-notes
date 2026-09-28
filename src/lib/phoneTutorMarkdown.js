import {
  renderTutorInlineMarkdown,
  renderTutorInlineMarkdownUnsanitized,
  renderTutorMarkdown,
  renderTutorMarkdownUnsanitized,
  tutorMarkdownPlainText,
} from "./tutorMarkdown.js";

/**
 * Phone and Mac tutors share explicit `[W#]` web references. Bare numeric
 * brackets remain ordinary learner/model text, so array indexing such as
 * `x[1]` can never become a citation. Citation decoration and its code-fence
 * exclusions are handled once by the shared tutor renderer.
 */
export const adaptPhoneWebCitations = (markdown) => String(markdown || "").replace(/\r\n?/g, "\n");

export const preparePhoneLibraryCitationSources = (librarySources = []) => (
  (Array.isArray(librarySources) ? librarySources : []).map((source, index) => ({
    ...source,
    citationNumber: Number.isSafeInteger(source?.citationNumber) && source.citationNumber > 0
      ? source.citationNumber
      : index + 1,
  }))
);

const phoneRenderArguments = (markdown, librarySources, citations) => [
  adaptPhoneWebCitations(markdown),
  preparePhoneLibraryCitationSources(librarySources),
  citations,
];

/**
 * The shared tutor renderer: model-authored HTML shows as text and citation
 * controls come only from validated [S#]/[W#] markers.
 */
export const renderPhoneTutorMarkdown = (markdown, librarySources = [], citations = [], options = {}) => (
  renderTutorMarkdown(...phoneRenderArguments(markdown, librarySources, citations), options)
);

/** One structured-result field, with the same citation numbering as prose. */
export const renderPhoneTutorInlineMarkdown = (text, librarySources = [], citations = [], options = {}) => (
  renderTutorInlineMarkdown(...phoneRenderArguments(text, librarySources, citations), options)
);

// The same renders before DOMPurify, for unit tests (DOMPurify needs a DOM).
export const renderPhoneTutorMarkdownUnsanitized = (markdown, librarySources = [], citations = [], options = {}) => (
  renderTutorMarkdownUnsanitized(...phoneRenderArguments(markdown, librarySources, citations), options)
);

export const renderPhoneTutorInlineMarkdownUnsanitized = (text, librarySources = [], citations = [], options = {}) => (
  renderTutorInlineMarkdownUnsanitized(...phoneRenderArguments(text, librarySources, citations), options)
);

export const phoneTutorMarkdownPlainText = tutorMarkdownPlainText;
