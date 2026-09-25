import { AI_REQUEST_CONTRACT_ID } from "./aiContract.js";
import { fitAiRequestContext } from "./aiRequestBudget.js";
import { buildConversationWindow } from "./conversationMemory.js";
import { buildTutorContext, outputTokensForProfile } from "./tutorGrounding.js";

/**
 * The Mac tutor's one request path. A learner's Send and every programmatic
 * tutor action (follow-ups, hints, wrap-up, grading) build their canonical
 * body here, so each is measured, fitted and checked the same way: the
 * selected response profile owns the byte budget, the prompt is kept whole,
 * and only complete source blocks and older conversation turns are dropped.
 */

export const TUTOR_MAX_PROMPT_CHARS = 5_700;
export const TUTOR_MAX_SERVER_HISTORY = 12;
export const TUTOR_MAX_HISTORY_MESSAGE_CHARS = 3_000;
const DEFAULT_INPUT_LIMIT = 16_000;
const DEFAULT_CONTEXT_LIMIT = 16_000;

/** Input, byte and prompt limits for one response profile. */
export const tutorRequestLimits = (config, responseProfile) => {
  const configuredInputLimit = config?.limits?.maxInputChars;
  const maximumBytes = config?.responseProfiles?.maxRequestUtf8Bytes?.[responseProfile]
    ?? config?.limits?.profileMaxRequestUtf8Bytes?.[responseProfile]
    ?? config?.limits?.maxRequestUtf8Bytes;
  const inputLimit = Number.isSafeInteger(configuredInputLimit) && configuredInputLimit >= 2_000 && configuredInputLimit <= 100_000
    ? Math.min(configuredInputLimit, maximumBytes || configuredInputLimit)
    : DEFAULT_INPUT_LIMIT;
  const promptLimit = Math.min(TUTOR_MAX_PROMPT_CHARS, Math.max(800, Math.floor(inputLimit * 0.48)));
  return { inputLimit, maximumBytes, promptLimit };
};

/** Appends the fixed grounding instruction; `sources` is a list or a boolean. */
export const promptForSources = (promptText, sources) => {
  const grounded = Array.isArray(sources) ? sources.length > 0 : Boolean(sources);
  const citationInstruction = grounded
    ? "Use the supplied [S#] labels to cite every source-grounded claim. Do not cite a label that was not supplied."
    : "No relevant library evidence was supplied. Clearly label claims that rely on general knowledge or attached web evidence.";
  return `${String(promptText || "").trim()}\n\n${citationInstruction}`;
};

/** The smallest context that still carries a usable block for every source. */
export const minimumContextBudget = (sources) => (Array.isArray(sources) ? sources : []).reduce(
  (total, source) => total + String(source?.title || "").length + String(source?.section || "").length + 24 + 180,
  0,
);

/**
 * Recent complete turns (whole question/answer pairs) plus a bounded,
 * deterministic memory of older ones, sized around the prompt and any
 * source context the request will carry.
 */
export const tutorConversationWindow = (history, { prompt = "", sources = false, inputLimit = DEFAULT_INPUT_LIMIT } = {}) => {
  const grounded = Array.isArray(sources) ? sources.length > 0 : Boolean(sources);
  const outboundPrompt = promptForSources(prompt, grounded);
  const reservedContext = grounded ? Math.min(4_000, Math.max(600, Math.floor(inputLimit * 0.35))) : 0;
  const characterBudget = Math.max(0, Math.min(
    Math.floor(inputLimit * 0.25),
    inputLimit - outboundPrompt.length - reservedContext - 300,
  ));
  return buildConversationWindow(Array.isArray(history) ? history : [], {
    maxMessages: TUTOR_MAX_SERVER_HISTORY,
    characterBudget,
    maxMessageCharacters: TUTOR_MAX_HISTORY_MESSAGE_CHARS,
    summaryBudget: Math.min(2_400, Math.max(800, Math.floor(inputLimit * 0.12))),
  });
};

/**
 * The memory for a follow-up about one answer (TFEAT-02): only that
 * question/answer pair, with up to 3,000 characters of the answer and half
 * the input budget, and no summary of older turns. The fitter then shrinks
 * source context around it, dropping only whole [S#] blocks.
 */
export const tutorFollowUpWindow = (pair, { inputLimit = DEFAULT_INPUT_LIMIT } = {}) => {
  const window = buildConversationWindow(Array.isArray(pair) ? pair : [], {
    maxMessages: 2,
    characterBudget: Math.floor(inputLimit * 0.5),
    maxMessageCharacters: TUTOR_MAX_HISTORY_MESSAGE_CHARS,
    summaryBudget: 0,
  });
  return { messages: window.messages, conversationSummary: "", compactedMessages: 0 };
};

/**
 * What a learner reads when a one-tap action (a follow-up, a starter, an
 * answer check) cannot start and its prompt is put in the question box
 * instead. `configMessage` explains a tutor that is not ready.
 */
export const tutorActionIssueReason = (issue, { configMessage = "" } = {}) => ({
  "not-ready": configMessage || "The tutor is not ready yet.",
  disclosure: "Tick the local-model permission above your question, then send it.",
  busy: "Wait for the current answer to finish, then send it.",
  "web-unavailable": "Web search is not available right now. Send it without the web.",
  "empty-prompt": "Write your question, then send it.",
  "prompt-too-long": "It is longer than this server accepts. Shorten it, then send it.",
  "context-too-small": "Its sources do not all fit. Choose fewer sources, then send it.",
  "request-too-large": "It does not fit the local model's request limit. Shorten it, then send it.",
}[issue] || "");

/**
 * Builds and fits the exact canonical request body. `mode` is the request's
 * own mode ({ task, structured, contextLimit }), never whatever the composer
 * shows, and the byte budget is that of `responseProfile`. Sources are
 * labelled blocks ({ citationNumber, title, section, text }); only complete
 * blocks enter the context and `includedCitationNumbers` lists exactly those.
 */
export const fitTutorRequest = ({
  mode,
  prompt,
  sources = [],
  history = [],
  conversationSummary = "",
  webSearch = false,
  difficulty = "intermediate",
  responseProfile = "balanced",
  config = null,
}) => {
  const { inputLimit, maximumBytes } = tutorRequestLimits(config, responseProfile);
  const sourceList = Array.isArray(sources) ? sources : [];
  const historyList = Array.isArray(history) ? history : [];
  const summary = String(conversationSummary || "");
  const structured = mode?.structured === true;
  const maxOutputTokens = outputTokensForProfile({
    profile: responseProfile,
    responseProfiles: config?.responseProfiles,
    maximum: config?.limits?.maxOutputTokens,
    structured,
  });
  const preparedPrompt = promptForSources(prompt, sourceList);
  const historyCharacters = historyList.reduce((total, message) => total + String(message?.content || "").length, 0);
  const availableContextBudget = Math.max(0, Math.min(
    mode?.contextLimit || DEFAULT_CONTEXT_LIMIT,
    inputLimit - preparedPrompt.length - historyCharacters - summary.length - 300,
  ));
  let includedCitationNumbers = [];
  const fitted = fitAiRequestContext({
    maximumBytes,
    maximumContextCharacters: availableContextBudget,
    buildContext: (budget) => {
      const built = buildTutorContext(sourceList, budget);
      includedCitationNumbers = built.includedCitationNumbers;
      return built.context;
    },
    buildPayload: (context) => ({
      contract: AI_REQUEST_CONTRACT_ID,
      task: mode?.task,
      prompt: preparedPrompt,
      context,
      contextCitations: [...includedCitationNumbers],
      documentTitle: sourceList.length === 1
        ? sourceList[0].title
        : sourceList.length ? `${sourceList.length} selected Lumen sources` : "General AI/ML learning question",
      difficulty,
      responseProfile,
      history: historyList,
      conversationSummary: summary.slice(0, 3_000),
      responseFormat: structured ? "structured" : "markdown",
      webSearch: webSearch === true,
      maxOutputTokens,
    }),
  });
  return { ...fitted, includedCitationNumbers: [...includedCitationNumbers], maxOutputTokens, inputLimit };
};

/**
 * Why a fitted request must not be sent, or "" when it can be. Sources that
 * the learner attached by hand must all fit (`requireAllSources`); retrieved
 * Library-first passages are refitted at send time instead.
 */
export const tutorRequestIssue = ({ prompt, promptLimit, fitted, sources = [], requireAllSources = false }) => {
  const text = String(prompt || "").trim();
  if (!text) return "empty-prompt";
  if (text.length > promptLimit) return "prompt-too-long";
  if (requireAllSources && sources.length > 0 && fitted.contextBudget < minimumContextBudget(sources)) return "context-too-small";
  if (Number.isSafeInteger(fitted.maximumBytes) && fitted.bytes > fitted.maximumBytes) return "request-too-large";
  return "";
};
