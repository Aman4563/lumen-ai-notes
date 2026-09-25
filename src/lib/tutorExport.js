/**
 * Learner-readable Markdown for tutor answers: what Copy, Save to notes and
 * the conversation export produce. Structured quiz/flashcard/plan results
 * become the same structure the learner saw instead of raw JSON, every answer
 * carries a list resolving its [S#]/[W#] labels, and incomplete answers stay
 * visibly incomplete.
 */

const text = (value) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");
const heading = (level, value) => `${"#".repeat(Math.min(6, Math.max(1, level)))} ${value}`;
const letter = (index) => String.fromCharCode(65 + index);

const isQuiz = (data) => Array.isArray(data?.questions) && data.questions.every((question) => Array.isArray(question?.options));
const isFlashcards = (data) => Array.isArray(data?.cards);
const isStudyPlan = (data) => Array.isArray(data?.milestones);
const isAnswerFeedback = (data) => typeof data?.feedback === "string" && typeof data?.improvedAnswer === "string" && Array.isArray(data?.gaps);

const quizMarkdown = (quiz, level) => {
  const lines = [heading(level, `Quiz: ${text(quiz.title) || "Check your understanding"}`)];
  if (text(quiz.instructions)) lines.push("", text(quiz.instructions));
  quiz.questions.forEach((question, index) => {
    const difficulty = text(question.difficulty);
    lines.push("", heading(level + 1, `Question ${index + 1}${difficulty ? ` (${difficulty})` : ""}`), "", text(question.prompt), "");
    question.options.forEach((option, optionIndex) => lines.push(`- ${letter(optionIndex)}. ${text(option)}`));
    const correct = Number.isSafeInteger(question.correctIndex) ? question.options[question.correctIndex] : undefined;
    if (correct !== undefined) lines.push("", `**Answer:** ${letter(question.correctIndex)}. ${text(correct)}`);
    if (text(question.explanation)) lines.push("", text(question.explanation));
  });
  return lines.join("\n");
};

const flashcardsMarkdown = (data, level) => {
  const lines = [heading(level, "Flashcards")];
  data.cards.forEach((card, index) => {
    lines.push("", heading(level + 1, `Card ${index + 1}`), "", `**Q:** ${text(card.front)}`, "", `**A:** ${text(card.back)}`);
    if (text(card.hint)) lines.push("", `*Hint:* ${text(card.hint)}`);
    const tags = (Array.isArray(card.tags) ? card.tags : []).map(text).filter(Boolean);
    if (tags.length) lines.push("", `Tags: ${tags.join(", ")}`);
  });
  return lines.join("\n");
};

const studyPlanMarkdown = (plan, level) => {
  const lines = [heading(level, `Study plan: ${text(plan.title) || "Plan"}`)];
  if (text(plan.goal)) lines.push("", `**Goal:** ${text(plan.goal)}`);
  plan.milestones.forEach((milestone, index) => {
    const minutes = Number.isSafeInteger(milestone.estimatedMinutes) ? ` (${milestone.estimatedMinutes} min)` : "";
    lines.push("", heading(level + 1, `${index + 1}. ${text(milestone.title)}${minutes}`));
    if (text(milestone.outcome)) lines.push("", text(milestone.outcome));
    const activities = (Array.isArray(milestone.activities) ? milestone.activities : []).map(text).filter(Boolean);
    if (activities.length) lines.push("", ...activities.map((activity) => `- ${activity}`));
    if (text(milestone.evidenceOfMastery)) lines.push("", `**Evidence of mastery:** ${text(milestone.evidenceOfMastery)}`);
  });
  const cautions = (Array.isArray(plan.cautions) ? plan.cautions : []).map(text).filter(Boolean);
  if (cautions.length) lines.push("", heading(level + 1, "Watch for"), "", ...cautions.map((caution) => `- ${caution}`));
  return lines.join("\n");
};

// An answer check reads as the learner saw it: no score or strengths, which
// the tutor hides for keyed quiz questions.
const answerFeedbackMarkdown = (data, level) => {
  const lines = [heading(level, "Answer check")];
  if (data.correct === true) lines.push("", "*The tutor's second look disagreed with the quiz key.*");
  lines.push("", `**Why:** ${text(data.feedback)}`);
  const gaps = data.gaps.map(text).filter(Boolean);
  if (gaps.length) lines.push("", "**What was missing:**", "", ...gaps.map((gap) => `- ${gap}`));
  lines.push("", `**Correct reasoning:** ${text(data.improvedAnswer)}`);
  if (text(data.nextQuestion)) lines.push("", `**Check yourself:** ${text(data.nextQuestion)}`);
  return lines.join("\n");
};

// Interview practice feedback (TFEAT-06): no score, and the reminder that the
// authored rubric, not the model, decides.
const interviewFeedbackMarkdown = (data, level) => {
  const lines = [heading(level, "Interview practice feedback"), "", "*AI feedback can be generous; trust the rubric.*"];
  const covered = data.strengths.map(text).filter(Boolean);
  if (covered.length) lines.push("", "**What you covered:**", "", ...covered.map((item) => `- ${item}`));
  const gaps = data.gaps.map(text).filter(Boolean);
  if (gaps.length) lines.push("", "**You may have missed:**", "", ...gaps.map((gap) => `- ${gap}`));
  lines.push("", `**Feedback:** ${text(data.feedback)}`, "", `**A stronger answer:** ${text(data.improvedAnswer)}`);
  return lines.join("\n");
};

/** Markdown for a validated structured result, or "" when `data` is not one. */
export const structuredResultMarkdown = (data, { headingLevel = 3 } = {}) => {
  if (!data || typeof data !== "object") return "";
  if (isQuiz(data)) return quizMarkdown(data, headingLevel);
  if (isFlashcards(data)) return flashcardsMarkdown(data, headingLevel);
  if (isStudyPlan(data)) return studyPlanMarkdown(data, headingLevel);
  if (isAnswerFeedback(data)) return answerFeedbackMarkdown(data, headingLevel);
  return "";
};

/**
 * Library sources arrive as Mac `{citationNumber, title, section}` records or
 * phone `{title, section}` records numbered by position; web sources carry an
 * explicit index when the server supplied one.
 */
export const tutorSourceList = ({ citationSources = [], webSources = [] } = {}) => {
  const lines = [];
  (Array.isArray(citationSources) ? citationSources : []).forEach((source, index) => {
    const number = Number.isSafeInteger(source?.citationNumber) && source.citationNumber > 0 ? source.citationNumber : index + 1;
    const title = text(source?.title) || `Source ${number}`;
    const section = text(source?.section);
    lines.push(`- [S${number}] ${title}${section ? ` — ${section}` : ""}`);
  });
  (Array.isArray(webSources) ? webSources : []).forEach((source, index) => {
    const number = Number.isSafeInteger(source?.index) && source.index > 0 ? source.index : index + 1;
    const url = text(source?.url);
    lines.push(`- [W${number}] ${text(source?.title) || "Web source"}${url ? ` — ${url}` : ""}`);
  });
  return lines.length ? `Sources:\n${lines.join("\n")}` : "";
};

/** The body of one tutor message as readable Markdown, without a heading. */
export const tutorMessageMarkdown = (message, { headingLevel = 3, includeSources = true } = {}) => {
  if (!message || typeof message !== "object") return "";
  const practice = message.role === "assistant" && message.mode === "interview-practice" && isAnswerFeedback(message.data);
  const body = (practice
    ? interviewFeedbackMarkdown(message.data, headingLevel)
    : message.role === "assistant" ? structuredResultMarkdown(message.data, { headingLevel }) : "") || text(message.content);
  const parts = [];
  if (message.incomplete === true) parts.push("> **Incomplete answer:** generation stopped before it finished.");
  if (message.truncated === true) parts.push("> **Display capped:** the answer was shortened to the tutor's display limit.");
  parts.push(body);
  if (includeSources && message.role === "assistant") {
    const sources = tutorSourceList(message);
    if (sources) parts.push(sources);
  }
  return parts.filter(Boolean).join("\n\n");
};

/** A whole conversation, with mode, profile and state in every heading. */
export const tutorConversationMarkdown = (history, { exportedAt = new Date(), modeLabel = (id) => id, profileLabel = (id) => id } = {}) => {
  const lines = [
    "# Lumen AI Tutor conversation",
    "",
    `Exported ${exportedAt.toISOString().slice(0, 10)}. Answers are model-generated from local sources — verify before relying on them.`,
  ];
  (Array.isArray(history) ? history : []).forEach((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return;
    const labels = [message.role === "assistant" ? "Lumen Tutor" : "You", modeLabel(message.mode)];
    if (message.role === "assistant") {
      labels.push(profileLabel(message.responseProfile));
      if (Number.isFinite(message.durationMs) && message.durationMs > 0) labels.push(`${(message.durationMs / 1_000).toFixed(1)}s`);
      if (message.incomplete === true) labels.push("stopped early");
    }
    lines.push("", heading(2, labels.filter(Boolean).join(" · ")), "", tutorMessageMarkdown(message, { headingLevel: 3 }));
  });
  return `${lines.join("\n")}\n`;
};

const FENCED_OR_INLINE_CODE_OR_MATH = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g;

/**
 * Plain text for pasting where Markdown is unwanted. Code and math are kept
 * verbatim (only their fences/backticks are removed); emphasis markers are
 * removed only in pairs around words, so `for _ in`, `x ** 2`, `y_i` and
 * `learning_rate` survive.
 */
export const tutorPlainText = (markdown) => String(markdown || "").replace(/\r\n?/g, "\n")
  .split(FENCED_OR_INLINE_CODE_OR_MATH)
  .map((segment, index) => {
    if (index % 2 === 1) {
      if (/^(```|~~~)/.test(segment)) return segment.replace(/^(```|~~~)[^\n]*\n?/, "").replace(/\n?(```|~~~)$/, "");
      if (segment.startsWith("`")) return segment.slice(1, -1);
      return segment;
    }
    return segment
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*[-+*][ \t]+/gm, "• ")
      .replace(/(\*\*|__)(?=\S)([^*\n]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([^~\n]*?\S)~~/g, "$1");
  })
  .join("")
  .trim();
