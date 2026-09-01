import { renderTutorMarkdown, tutorMarkdownPlainText } from "./tutorMarkdown.js";

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

export const renderPhoneTutorMarkdown = (markdown, librarySources = [], citations = []) => {
  const sources = preparePhoneLibraryCitationSources(librarySources);
  return renderTutorMarkdown(adaptPhoneWebCitations(markdown, citations), sources, citations);
};

export const phoneTutorMarkdownPlainText = tutorMarkdownPlainText;
