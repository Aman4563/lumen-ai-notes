import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_WRAP_UP_AFTER,
  sessionRetrievalQuery,
  sessionWrapUp,
  tutorSession,
  wrapUpLabel,
} from "./tutorSession.js";

const turn = (role, mode, content, extra = {}) => ({ role, mode, content, ...extra });

const socraticRun = [
  turn("user", "explain", "What is ridge regression?"),
  turn("assistant", "explain", "Ridge adds an L2 penalty. [S1]"),
  turn("user", "socratic", "Teach me ridge one question at a time."),
  turn("assistant", "socratic", "Let's start. What happens to the weights as λ grows? [S2]"),
  turn("user", "socratic", "They get smaller."),
  turn("assistant", "socratic", "Good. Why would **smaller weights** reduce variance? [S2]"),
];

test("a session is the run of practice turns the conversation ends with", () => {
  const session = tutorSession(socraticRun);
  assert.equal(session.mode, "socratic");
  assert.equal(session.questions, 2, "the Explain turn before the session was counted");
  assert.equal(session.messages.length, 4);
  assert.equal(session.lastQuestion, socraticRun[5]);
  assert.equal(session.revealed, false);
  assert.equal(tutorSession(socraticRun.slice(0, 2)), null, "an Explain conversation is not a session");
  assert.equal(tutorSession([]), null);
  assert.equal(tutorSession([...socraticRun, turn("user", "summarize", "Recap this practice session: …")]), null, "a wrap-up ended nothing");
});

test("hints and reveals stay inside the session without counting as questions", () => {
  const withHint = [...socraticRun, turn("user", "hint", "Give me one hint…"), turn("assistant", "hint", "Think about variance.")];
  assert.equal(tutorSession(withHint).questions, 2, "a hint counted as a new question");
  assert.equal(tutorSession(withHint).lastQuestion, socraticRun[5], "the hint replaced the question it was about");
  const revealed = [...withHint, turn("user", "reveal", "Reveal the answer…"), turn("assistant", "reveal", "Smaller weights…")];
  assert.equal(tutorSession(revealed).revealed, true);
  assert.equal(tutorSession(revealed).questions, 2);
  const next = [...revealed, turn("user", "socratic", "Ask me the next question in this session."), turn("assistant", "socratic", "What does ridge do to correlated features?")];
  assert.equal(tutorSession(next).revealed, false);
  assert.equal(tutorSession(next).questions, 3);
  const interview = [turn("user", "interview", "Interview me."), turn("assistant", "interview", "Design a feature store?")];
  assert.equal(tutorSession(interview).mode, "interview");
});

test("wrap up is suggested once a session reaches ten messages", () => {
  const long = [turn("user", "socratic", "Start.")];
  for (let index = 0; long.length < SESSION_WRAP_UP_AFTER; index += 1) {
    long.push(turn("assistant", "socratic", `Question ${index}?`), turn("user", "socratic", `Answer ${index}`));
  }
  assert.equal(tutorSession(long.slice(0, SESSION_WRAP_UP_AFTER - 1)).suggestWrapUp, false);
  assert.equal(tutorSession(long.slice(0, SESSION_WRAP_UP_AFTER)).suggestWrapUp, true);
});

test("a hint retrieves with the tutor's last question, without labels or Markdown", () => {
  assert.equal(sessionRetrievalQuery(socraticRun[5]), "Good. Why would smaller weights reduce variance?");
  const withCode = { content: "Ridge again.\n\n```python\nwhat = model?\n```\n\nWhat does `alpha` control in ridge? [S3] Take your time." };
  assert.equal(sessionRetrievalQuery(withCode), "Ridge again. What does alpha control in ridge?", "code was searched or the text after the question was kept");
  assert.equal(sessionRetrievalQuery({ content: "Explain overfitting in one sentence." }), "Explain overfitting in one sentence.");
  const long = sessionRetrievalQuery({ content: `${"Ridge shrinks weights. ".repeat(40)}So, what does lambda trade off?` });
  assert.ok(long.length <= 300, `a long turn searched ${long.length} characters`);
  assert.match(long, /So, what does lambda trade off\?$/, "a long turn lost its question");
  assert.match(long, /^[A-Z]|^[a-z]/, "a long turn started mid-word");
});

test("wrap up recaps the session's own turns and says when it covers only the latest", () => {
  const short = sessionWrapUp(socraticRun.slice(2), { inputLimit: 8_740 });
  assert.equal(short.prompt, "Recap this practice session: what I got right, what I missed, and 3 things to review.");
  assert.equal(short.covered, 4);
  assert.equal(short.total, 4);
  assert.deepEqual(short.historyWindow.messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(short.historyWindow.conversationSummary, "", "a recap sent an older summary");
  assert.equal(short.historyWindow.messages.some((message) => /\[[SW]\d+\]/.test(message.content)), false, "a recap without evidence kept citation labels");
  assert.equal(short.historyWindow.messages[1].content, "Let's start. What happens to the weights as λ grows?");
  assert.equal(short.historyWindow.compactedMessages, 0);
  assert.equal(wrapUpLabel(short.prompt), "Session recap");

  const long = [];
  for (let index = 0; index < 10; index += 1) long.push(turn("user", "socratic", `Answer ${index}`), turn("assistant", "socratic", `Question ${index}?`));
  const partial = sessionWrapUp(long, { inputLimit: 8_740 });
  assert.equal(partial.covered, 12, "a recap exceeded the 12-message history limit");
  assert.equal(partial.total, 20);
  assert.match(partial.prompt, /^Recap the last 12 turns of this practice session:/);
  assert.equal(wrapUpLabel(partial.prompt), "Recap of the last 12 turns");
  const budget = sessionWrapUp(long.map((message) => ({ ...message, content: `${message.content} ${"detail ".repeat(400)}` })), { inputLimit: 8_740 });
  const sent = budget.historyWindow.messages.reduce((total, message) => total + message.content.length, 0);
  assert.ok(sent <= Math.floor(8_740 * 0.6), `a recap used ${sent} characters of history`);
  assert.equal(wrapUpLabel("Explain ridge."), "");
});
