import { buildConversationWindow } from "./conversationMemory.js";
import { TUTOR_MAX_HISTORY_MESSAGE_CHARS, TUTOR_MAX_SERVER_HISTORY } from "./tutorRequest.js";
import { withoutCitationLabels } from "./tutorFollowUps.js";

/**
 * Socratic and Interview practice sessions (TFEAT-05). A session is derived
 * from the conversation itself, never stored: the run of practice turns the
 * conversation ends with. Hints and reveals are their own (hidden) modes so
 * they stay inside the session without counting as new questions. Nothing
 * here grades a free-form answer; checking stays inside the conversational
 * Socratic and Interview tasks.
 */

/** Modes that ask the learner questions. */
export const SESSION_MODES = Object.freeze(["socratic", "interview"]);
/** Every mode a session turn can have: questions, hints and reveals. */
export const SESSION_TURN_MODES = Object.freeze([...SESSION_MODES, "hint", "reveal"]);
/** Messages after which Wrap up is suggested, while a recap still covers them all. */
export const SESSION_WRAP_UP_AFTER = 10;

export const HINT_PROMPT = "Give me one hint for your last question without revealing the answer.";
export const REVEAL_PROMPT = "Reveal the answer to your last question and explain it step by step.";
export const NEXT_QUESTION_PROMPT = "Ask me the next question in this session.";
const WRAP_UP_ASK = "what I got right, what I missed, and 3 things to review.";

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

const clip = (value, maximum) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

/**
 * The session the conversation ends with, or null. Walks back from the
 * newest message over turns in session modes and stops at the first turn in
 * any other mode. `questions` counts the tutor's questions (not hints or
 * reveals); `revealed` is true while the newest turn is a reveal.
 */
export const tutorSession = (history) => {
  const list = Array.isArray(history) ? history : [];
  let start = list.length;
  while (start > 0 && SESSION_TURN_MODES.includes(list[start - 1]?.mode)) start -= 1;
  const messages = list.slice(start);
  const questions = messages.filter((message) => message.role === "assistant" && SESSION_MODES.includes(message.mode));
  if (!questions.length) return null;
  const lastQuestion = questions.at(-1);
  return {
    mode: lastQuestion.mode,
    messages,
    questions: questions.length,
    lastQuestion,
    revealed: messages.at(-1)?.mode === "reveal",
    suggestWrapUp: messages.length >= SESSION_WRAP_UP_AFTER,
  };
};

/**
 * Library search words for a hint or a reveal: the tutor's last turn up to
 * its last question (outside code), without citation labels or Markdown
 * marks. A long turn keeps the 300 characters that lead to the question,
 * which name its topic. The chip wording itself ("your last question")
 * names none.
 */
export const sessionRetrievalQuery = (message) => {
  let fenced = false;
  const prose = clean(message?.content).split("\n").filter((line) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  }).join(" ");
  const plain = withoutCitationLabels(prose).replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim();
  const end = plain.lastIndexOf("?");
  if (end < 0) return clip(plain, 300);
  const asked = plain.slice(0, end + 1);
  if (asked.length <= 300) return asked;
  const tail = asked.slice(asked.length - 300);
  return tail.slice(tail.indexOf(" ") + 1);
};

/**
 * Wrap up: a recap of the session's own turns, which are its only material
 * (no library text is sent). Up to 12 messages, within 60% of the input
 * budget and without an older summary. The turns lose their [S#]/[W#]
 * labels: no evidence is supplied with a recap, so a copied label would be
 * an unsupported citation. When the session is longer than the window, the
 * question says which turns the recap covers.
 *
 * Returns { prompt, historyWindow, covered, total }.
 */
export const sessionWrapUp = (messages, { inputLimit = 16_000 } = {}) => {
  const turns = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message, content: withoutCitationLabels(message?.content) }));
  const window = buildConversationWindow(turns, {
    maxMessages: TUTOR_MAX_SERVER_HISTORY,
    characterBudget: Math.floor(inputLimit * 0.6),
    maxMessageCharacters: TUTOR_MAX_HISTORY_MESSAGE_CHARS,
    summaryBudget: 0,
  });
  const total = buildConversationWindow(turns, {
    maxMessages: 10_000,
    characterBudget: Number.MAX_SAFE_INTEGER,
    maxMessageCharacters: TUTOR_MAX_HISTORY_MESSAGE_CHARS,
    summaryBudget: 0,
  }).messages.length;
  const covered = window.messages.length;
  const prompt = covered < total
    ? `Recap the last ${covered} turns of this practice session: ${WRAP_UP_ASK}`
    : `Recap this practice session: ${WRAP_UP_ASK}`;
  return {
    prompt,
    historyWindow: { messages: window.messages, conversationSummary: "", compactedMessages: 0 },
    covered,
    total,
  };
};

/** The label a recap shows, read back from its visible question; "" for other questions. */
export const wrapUpLabel = (question) => {
  const text = clean(question);
  const partial = text.match(/^Recap the last (\d+) turns of this practice session:/);
  if (partial) return `Recap of the last ${partial[1]} turns`;
  return text.startsWith("Recap this practice session:") ? "Session recap" : "";
};
