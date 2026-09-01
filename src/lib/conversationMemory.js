const clean = (value, maximum = 20_000) => typeof value === "string"
  ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
  : "";

const clip = (value, maximum) => {
  const text = clean(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

const groupTurns = (history) => {
  const groups = [];
  let pendingUser = null;
  for (const message of Array.isArray(history) ? history : []) {
    if (!message || !["user", "assistant"].includes(message.role) || !clean(message.content)) continue;
    if (message.role === "user") {
      pendingUser = message;
    } else if (pendingUser) {
      // A stopped/failed streamed answer is useful to display, but it must not
      // consume the learner turn. If a retry later succeeds, pair that latest
      // complete answer with the original question. A following user message
      // will still replace pendingUser and correctly leave the failed turn out
      // of model memory.
      if (message.incomplete !== true) {
        groups.push([pendingUser, message]);
        pendingUser = null;
      }
    }
  }
  return groups;
};

/**
 * Keeps recent turns atomically and creates a deterministic, visible memory of
 * older turns. It never invokes a model, so compaction adds no inference wait.
 */
export const buildConversationWindow = (history, {
  maxMessages = 12,
  characterBudget = 6_000,
  maxMessageCharacters = 3_000,
  summaryBudget = 2_000,
} = {}) => {
  const groups = groupTurns(history);
  const retainedGroups = [];
  let retainedCharacters = 0;
  let retainedMessages = 0;
  const budget = Math.max(0, Math.floor(characterBudget));

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (retainedMessages + group.length > Math.max(1, maxMessages)) break;
    const remaining = budget - retainedCharacters;
    if (remaining < group.length) break;
    let prepared = group.map((message) => ({
      role: message.role,
      content: clip(message.content, maxMessageCharacters),
    }));
    let size = prepared.reduce((total, message) => total + message.content.length, 0);
    if (size > remaining) {
      const firstBudget = Math.max(1, Math.floor(remaining / 2));
      const secondBudget = Math.max(1, remaining - firstBudget);
      prepared = prepared.map((message, messageIndex) => ({
        ...message,
        content: clip(message.content, messageIndex === 0 ? firstBudget : secondBudget),
      }));
      size = prepared.reduce((total, message) => total + message.content.length, 0);
    }
    if (size > remaining || prepared.some((message) => !message.content)) break;
    retainedGroups.unshift(prepared);
    retainedCharacters += size;
    retainedMessages += prepared.length;
  }

  const compactedGroups = groups.slice(0, Math.max(0, groups.length - retainedGroups.length));
  const candidateLines = compactedGroups.map((group) => {
    const user = group.find((message) => message.role === "user");
    const assistant = group.find((message) => message.role === "assistant");
    return [
      user ? `Learner asked: ${clip(user.content, 220)}` : "",
      assistant ? `Tutor answered: ${clip(assistant.content, 300)}` : "",
    ].filter(Boolean).join(" | ");
  }).filter(Boolean);
  const summaryLines = [];
  let summaryCharacters = 0;
  let omittedGroups = 0;
  for (let index = candidateLines.length - 1; index >= 0; index -= 1) {
    const available = Math.max(0, summaryBudget - 100 - summaryCharacters);
    const line = summaryLines.length
      ? `- ${candidateLines[index]}`
      : `- ${clip(candidateLines[index], Math.max(1, available - 3))}`;
    if (summaryCharacters + line.length + 1 > Math.max(120, summaryBudget - 100)) {
      omittedGroups = index + 1;
      break;
    }
    summaryLines.unshift(line);
    summaryCharacters += line.length + 1;
  }
  if (omittedGroups) summaryLines.unshift(`- … ${omittedGroups} earlier compacted turn${omittedGroups === 1 ? "" : "s"} omitted from this bounded memory …`);

  return {
    messages: retainedGroups.flat(),
    conversationSummary: summaryLines.length ? `Older conversation memory (deterministic extract):\n${summaryLines.join("\n")}` : "",
    compactedMessages: compactedGroups.reduce((total, group) => total + group.length, 0),
    omittedCompactedMessages: compactedGroups.slice(0, omittedGroups).reduce((total, group) => total + group.length, 0),
    retainedMessages,
  };
};
