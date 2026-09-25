/**
 * One-tap follow-ups under the newest answer (TFEAT-02). Each is a visible
 * question in a listed mode, sent with only the answer it follows as memory,
 * and retrieved with that answer's own topic rather than its topic-less
 * wording. Nothing here sends; the tutor runs these through its shared
 * request path.
 */

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

const clip = (value, maximum) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

/** After a prose answer. */
export const ANSWER_FOLLOW_UPS = Object.freeze([
  { id: "simpler", label: "Simpler", modeId: "explain", prompt: "Explain your previous answer more simply, in under 150 words, with one everyday analogy." },
  { id: "example", label: "Give an example", modeId: "explain", prompt: "Give one concrete worked example of the main idea in your previous answer, step by step." },
  { id: "deeper", label: "Go deeper", modeId: "explain", prompt: "Go one level deeper than your previous answer: the underlying mechanism, the key assumption, and one case where it breaks down." },
  { id: "quiz", label: "Quiz me on this", modeId: "quiz", prompt: "Create 2 multiple-choice questions that test the explanation in your previous answer. Explain each answer." },
  { id: "flashcards", label: "Make flashcards", modeId: "flashcards", prompt: "Create 3 short flashcards from the key ideas in your previous answer." },
  // "I have not answered" tells the server there is no learner answer to
  // assess (issue #82); the explanation it follows is the tutor's own.
  { id: "check", label: "Check my understanding", modeId: "socratic", prompt: "Ask me one question that checks whether I understood your previous answer. I have not answered anything yet, so wait for my reply before explaining." },
]);

/** After a quiz. */
export const QUIZ_FOLLOW_UPS = Object.freeze([
  { id: "harder-quiz", label: "Harder quiz", modeId: "quiz", prompt: "Create 2 harder multiple-choice questions on the same material as your previous quiz. Test application and edge cases rather than recall. Explain each answer." },
  { id: "explain-answers", label: "Explain the answers", modeId: "explain", prompt: "Explain the reasoning behind each correct answer in your previous quiz, and the misconception each wrong option targets." },
]);

/** After flashcards. The tutor does not know which cards a learner missed. */
export const FLASHCARD_FOLLOW_UPS = Object.freeze([
  { id: "more-cards", label: "More cards", modeId: "flashcards", prompt: "Create 3 more flashcards on key ideas that your previous cards did not cover." },
  { id: "quiz-cards", label: "Quiz me on these", modeId: "quiz", prompt: "Create 2 multiple-choice questions that test the ideas on your previous flashcards. Explain each answer." },
]);

// Turns that ask the learner a question: the session strip in the composer
// (TFEAT-05) offers their next steps, so they get no follow-ups.
const QUESTION_MODES = new Set(["socratic", "interview", "hint"]);

/**
 * The follow-ups for the newest turn: only when the conversation ends with a
 * complete answer (not stopped early, not display-capped). Study plans,
 * answer checks, interview practice feedback and the tutor's own questions
 * have none.
 */
export const followUpsForMessage = (message, { isLast = false } = {}) => {
  if (!isLast || !message || message.role !== "assistant" || message.incomplete === true || message.truncated === true) return [];
  if (message.mode === "quiz") return message.data ? QUIZ_FOLLOW_UPS : [];
  if (message.mode === "flashcards") return message.data ? FLASHCARD_FOLLOW_UPS : [];
  if (["study-plan", "feedback", "interview-practice"].includes(message.mode) || QUESTION_MODES.has(message.mode)) return [];
  return ANSWER_FOLLOW_UPS;
};

/** Removes [S#]/[W#] labels, which name evidence of another request. */
export const withoutCitationLabels = (value) => clean(value)
  .replace(/\s*\[[SW]\d+\]/g, "")
  .replace(/[ \t]{2,}/g, " ");

/** The question an answer replied to, or null. */
export const questionForAnswer = (history, answerId) => {
  const list = Array.isArray(history) ? history : [];
  const index = list.findIndex((message) => message?.id === answerId);
  if (index < 1) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (list[cursor]?.role === "user") return list[cursor];
  }
  return null;
};

// A chip's wording and a session hint or reveal name no topic.
// Earlier chip wording is still in stored conversations.
const LEGACY_CHIP_PROMPTS = Object.freeze(["Ask me one question that checks whether I understood your previous answer. Wait for my reply before explaining."]);
const CHIP_PROMPTS = new Set([...[...ANSWER_FOLLOW_UPS, ...QUIZ_FOLLOW_UPS, ...FLASHCARD_FOLLOW_UPS].map((item) => item.prompt), ...LEGACY_CHIP_PROMPTS]);
const TOPICLESS_MODES = new Set(["hint", "reveal"]);
/** Whether a question is a one-tap follow-up's fixed wording. */
export const isFollowUpPrompt = (content) => CHIP_PROMPTS.has(clean(content));
const topicless = (question) => isFollowUpPrompt(question?.content) || TOPICLESS_MODES.has(question?.mode);

/**
 * The question that set an answer's topic, for library search words: the
 * question it replied to or, when that was a one-tap follow-up or a session
 * hint (fixed wording, no topic), the question behind the answer that one
 * followed, and so on back. Following "Give an example" with "Check my
 * understanding" searches for the learner's own question, not for "your
 * previous answer". Null when the answer replied to nothing.
 */
export const topicQuestionFor = (history, answerId) => {
  const list = Array.isArray(history) ? history : [];
  let question = questionForAnswer(list, answerId);
  const visited = new Set();
  while (question && topicless(question) && !visited.has(question.id)) {
    visited.add(question.id);
    const index = list.findIndex((message) => message?.id === question.id);
    const followed = index > 0 ? [...list.slice(0, index)].reverse().find((message) => message?.role === "assistant") : null;
    const earlier = followed ? questionForAnswer(list, followed.id) : null;
    if (!earlier) break;
    question = earlier;
  }
  return question;
};

/**
 * The pair a follow-up remembers, without citation labels: those numbers
 * belong to the earlier request, and a follow-up is grounded in freshly
 * retrieved, freshly numbered passages. `answerText` is the answer as the
 * learner read it (readable Markdown for a quiz or cards).
 */
export const followUpPair = (question, answerText) => {
  const asked = withoutCitationLabels(question?.content);
  const answered = withoutCitationLabels(answerText);
  return asked && answered
    ? [{ role: "user", content: asked }, { role: "assistant", content: answered }]
    : [];
};

/** The first Markdown heading of an answer, outside code. */
export const firstAnswerHeading = (markdown) => {
  let fenced = false;
  for (const line of clean(markdown).split("\n")) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const match = !fenced && line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) return withoutCitationLabels(match[1]).replace(/[*_`]/g, "");
  }
  return "";
};

/**
 * Library search words for a follow-up: the earlier question and the
 * answer's first heading (or a quiz title), at most 300 characters. The chip
 * wording itself ("more simply") names no topic.
 */
export const followUpRetrievalQuery = (question, answer) => {
  const topic = answer?.data && typeof answer.data.title === "string"
    ? answer.data.title
    : firstAnswerHeading(answer?.content);
  return clip([withoutCitationLabels(question?.content), withoutCitationLabels(topic)].filter(Boolean).join(" — "), 300);
};

/** The document an answer cited first: the retrieval hint for its follow-ups. */
export const citedDocumentId = (message) => {
  for (const source of Array.isArray(message?.citationSources) ? message.citationSources : []) {
    const id = clean(source?.original?.documentId || source?.original?.id || source?.documentId);
    if (id) return id.slice(0, 240);
  }
  return "";
};

/**
 * The grounding a follow-up keeps (sourceMode is not stored per answer, so
 * it is read from what the answer carried): a Library-first answer (it has
 * a retrieval trace) searches again; an answer grounded in lessons the
 * learner attached reuses those lessons while their text is still loaded,
 * and otherwise searches the library for them; an answer with no sources
 * stays without the library.
 *
 * Returns { sourceMode, sources? } where `sources` are entries of
 * `loadedSources` (each with an `id`).
 */
export const followUpScope = (message, loadedSources = []) => {
  if (message?.retrievalTrace) return { sourceMode: "library-first" };
  const cited = (Array.isArray(message?.citationSources) ? message.citationSources : []).map((source) => source?.id).filter(Boolean);
  if (!cited.length) return { sourceMode: "none" };
  const byId = new Map((Array.isArray(loadedSources) ? loadedSources : []).map((source) => [source.id, source]));
  const sources = cited.map((id) => byId.get(id)).filter(Boolean);
  return sources.length === cited.length ? { sourceMode: "choose", sources } : { sourceMode: "library-first" };
};
