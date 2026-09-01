import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationWindow } from "./conversationMemory.js";

const history = Array.from({ length: 8 }, (_, index) => [
  { role: "user", content: `Question ${index + 1}` },
  { role: "assistant", content: `Answer ${index + 1}` },
]).flat();

test("retains recent complete pairs and visibly compacts older turns", () => {
  const result = buildConversationWindow(history, { maxMessages: 6, characterBudget: 2_000 });
  assert.equal(result.messages.length, 6);
  assert.deepEqual(result.messages.map((message) => message.content), ["Question 6", "Answer 6", "Question 7", "Answer 7", "Question 8", "Answer 8"]);
  assert.equal(result.compactedMessages, 10);
  assert.match(result.conversationSummary, /Question 1/);
  assert.match(result.conversationSummary, /deterministic extract/);
});

test("does not invent a summary when every turn fits", () => {
  const result = buildConversationWindow(history.slice(0, 4), { maxMessages: 6, characterBudget: 2_000 });
  assert.equal(result.compactedMessages, 0);
  assert.equal(result.conversationSummary, "");
});

test("excludes orphan, assistant-only, and incomplete turns", () => {
  const windowFor = (messages) => buildConversationWindow(messages, { maxMessages: 12, characterBudget: 2_000 }).messages.map((message) => message.content);
  assert.deepEqual(windowFor([{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }]), ["u1", "a1"]);
  assert.deepEqual(windowFor([{ role: "assistant", content: "a0" }, { role: "user", content: "u1" }, { role: "assistant", content: "a1" }]), ["u1", "a1"]);
  assert.deepEqual(windowFor([{ role: "user", content: "u1" }, { role: "user", content: "u2" }, { role: "assistant", content: "a2" }]), ["u2", "a2"]);
  assert.deepEqual(windowFor([{ role: "user", content: "u1" }, { role: "assistant", content: "partial", incomplete: true }]), []);
  assert.deepEqual(windowFor([{ role: "user", content: "u1" }, { role: "assistant", content: "partial", incomplete: true }, { role: "assistant", content: "retry succeeded" }]), ["u1", "retry succeeded"]);
  assert.deepEqual(windowFor([{ role: "user", content: "u1" }, { role: "assistant", content: "partial", incomplete: true }, { role: "user", content: "u2" }, { role: "assistant", content: "a2" }]), ["u2", "a2"]);
});

test("never exceeds the exact character budget and keeps pair boundaries", () => {
  const longPair = [{ role: "user", content: "u".repeat(200) }, { role: "assistant", content: "a".repeat(200) }];
  for (const characterBudget of [0, 79, 80]) {
    const result = buildConversationWindow(longPair, { characterBudget, maxMessages: 12 });
    assert.equal(result.messages.length % 2, 0);
    assert.ok(result.messages.reduce((total, message) => total + message.content.length, 0) <= characterBudget);
  }
});

test("bounds each message and the summary", () => {
  const longHistory = history.map((message) => ({ ...message, content: message.content.repeat(200) }));
  const result = buildConversationWindow(longHistory, { maxMessages: 2, characterBudget: 500, maxMessageCharacters: 220, summaryBudget: 320 });
  assert.ok(result.messages.every((message) => message.content.length <= 220));
  assert.ok(result.conversationSummary.length < 500);
  assert.ok(result.compactedMessages > 0);
  assert.match(result.conversationSummary, /Question 7|Question 6|Question 5/);
  assert.ok(result.omittedCompactedMessages > 0);
  assert.match(result.conversationSummary, /earlier compacted turn/);
});
