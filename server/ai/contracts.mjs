export const AI_TASKS = Object.freeze([
  "tutor",
  "explain",
  "socratic",
  "quiz",
  "flashcards",
  "interview",
  "summarize",
  "study_plan",
  "answer_feedback",
]);

export const STRUCTURED_TASKS = Object.freeze(["quiz", "flashcards", "study_plan", "answer_feedback"]);

const TASK_SET = new Set(AI_TASKS);
const STRUCTURED_TASK_SET = new Set(STRUCTURED_TASKS);
const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "interview"]);
const RESPONSE_FORMATS = new Set(["markdown", "structured"]);
const RESPONSE_PROFILES = new Set(["fast", "balanced", "deep"]);

const asRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const normalizedText = (value) => value.replace(/\r\n?/g, "\n").trim();

const validateText = (errors, value, field, { required = false, maximum }) => {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field} is required`);
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return "";
  }
  const result = normalizedText(value);
  if (required && !result) errors.push(`${field} cannot be empty`);
  if (result.length > maximum) errors.push(`${field} cannot exceed ${maximum} characters`);
  return result;
};

const REQUEST_KEYS = new Set([
  "task",
  "prompt",
  "context",
  "contextCitations",
  "documentTitle",
  "difficulty",
  "history",
  "conversationSummary",
  "responseFormat",
  "responseProfile",
  "maxOutputTokens",
  "webSearch",
]);

/** Validates an untrusted browser payload without coercing its types. */
export const validateAiRequest = (payload, config) => {
  const errors = [];
  if (!asRecord(payload)) return { ok: false, errors: ["Request body must be a JSON object"] };
  if (!hasOnlyKeys(payload, REQUEST_KEYS)) errors.push("Request contains unsupported fields");

  const task = typeof payload.task === "string" ? payload.task : "";
  if (!TASK_SET.has(task)) errors.push("task is not supported");
  const prompt = validateText(errors, payload.prompt, "prompt", { required: true, maximum: 6_000 });
  const context = validateText(errors, payload.context, "context", { maximum: config.maxInputChars });
  let contextCitations = [];
  if (payload.contextCitations !== undefined) {
    if (!Array.isArray(payload.contextCitations) || payload.contextCitations.length > 8
      || payload.contextCitations.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 9_999)
      || new Set(payload.contextCitations).size !== payload.contextCitations.length) {
      errors.push("contextCitations must contain at most 8 unique positive integer labels");
    } else {
      contextCitations = [...payload.contextCitations];
    }
  }
  const contextHeaderCitations = [...context.matchAll(/^\s*\[S([1-9]\d*)\](?=\s)/gmu)].map((match) => Number(match[1]));
  if (contextHeaderCitations.length || contextCitations.length) {
    const headers = [...new Set(contextHeaderCitations)].sort((left, right) => left - right);
    const declared = [...contextCitations].sort((left, right) => left - right);
    if (JSON.stringify(headers) !== JSON.stringify(declared)) {
      errors.push("contextCitations must exactly match the source headers in context");
    }
  }
  const documentTitle = validateText(errors, payload.documentTitle, "documentTitle", { maximum: 200 });
  const conversationSummary = validateText(errors, payload.conversationSummary, "conversationSummary", { maximum: 3_000 });

  const difficulty = payload.difficulty ?? "intermediate";
  if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty)) {
    errors.push("difficulty must be beginner, intermediate, advanced, or interview");
  }

  const responseFormat = payload.responseFormat ?? "markdown";
  if (typeof responseFormat !== "string" || !RESPONSE_FORMATS.has(responseFormat)) {
    errors.push("responseFormat must be markdown or structured");
  } else if (responseFormat === "structured" && !STRUCTURED_TASK_SET.has(task)) {
    errors.push("structured output is not supported for this task");
  }

  const responseProfile = payload.responseProfile ?? "balanced";
  if (typeof responseProfile !== "string" || !RESPONSE_PROFILES.has(responseProfile)) {
    errors.push("responseProfile must be fast, balanced, or deep");
  }

  let history = [];
  if (payload.history !== undefined) {
    if (!Array.isArray(payload.history) || payload.history.length > 12) {
      errors.push("history must be an array with at most 12 messages");
    } else {
      history = payload.history.map((message, index) => {
        if (!asRecord(message) || !hasOnlyKeys(message, new Set(["role", "content"]))) {
          errors.push(`history[${index}] must contain only role and content`);
          return { role: "user", content: "" };
        }
        if (message.role !== "user" && message.role !== "assistant") {
          errors.push(`history[${index}].role must be user or assistant`);
        }
        const content = validateText(errors, message.content, `history[${index}].content`, { required: true, maximum: 3_000 });
        return { role: message.role, content };
      });
    }
  }

  const profileDefaultTokens = config.responseProfileOutputTokens?.[responseProfile] ?? config.maxOutputTokens;
  const requestedTokens = payload.maxOutputTokens ?? profileDefaultTokens;
  if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 128 || requestedTokens > config.maxOutputTokens) {
    errors.push(`maxOutputTokens must be an integer from 128 to ${config.maxOutputTokens}`);
  } else if (requestedTokens > profileDefaultTokens) {
    // The response profile is a server-owned quality/latency ceiling, not a
    // label that a browser can combine with a larger, differently-budgeted
    // output allowance. Keeping these values coupled also makes the profile's
    // advertised UTF-8 request budget exact at the server boundary.
    errors.push(`maxOutputTokens cannot exceed the ${responseProfile} profile ceiling of ${profileDefaultTokens}`);
  }

  const webSearch = payload.webSearch ?? false;
  if (typeof webSearch !== "boolean") {
    errors.push("webSearch must be a boolean");
  } else if (webSearch && !config.webSearchEnabled) {
    errors.push("webSearch is not enabled on this server");
  }

  const totalCharacters = prompt.length + context.length + documentTitle.length + conversationSummary.length
    + history.reduce((sum, message) => sum + message.content.length, 0);
  if (totalCharacters > config.maxInputChars) {
    errors.push(`Combined AI input cannot exceed ${config.maxInputChars} characters`);
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 12) };
  return {
    ok: true,
    value: {
      task,
      prompt,
      context,
      contextCitations,
      documentTitle,
      difficulty,
      history,
      conversationSummary,
      responseFormat,
      responseProfile,
      maxOutputTokens: requestedTokens,
      webSearch,
    },
  };
};

const strictObject = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

const stringArray = (maximum) => ({ type: "array", items: { type: "string" }, maxItems: maximum });

export const STRUCTURED_SCHEMAS = Object.freeze({
  quiz: {
    name: "learning_quiz",
    description: "A source-grounded quiz with answers and explanations.",
    schema: strictObject({
      title: { type: "string" },
      instructions: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: strictObject({
          id: { type: "string" },
          prompt: { type: "string" },
          options: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
          correctIndex: { type: "integer", minimum: 0, maximum: 5 },
          explanation: { type: "string" },
          difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced", "interview"] },
        }),
      },
    }),
  },
  flashcards: {
    name: "learning_flashcards",
    description: "Atomic active-recall flashcards grounded in the supplied material.",
    schema: strictObject({
      cards: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: strictObject({
          front: { type: "string" },
          back: { type: "string" },
          hint: { type: ["string", "null"] },
          tags: stringArray(4),
        }),
      },
    }),
  },
  study_plan: {
    name: "learning_study_plan",
    description: "A realistic, sequenced learning plan with measurable outcomes.",
    schema: strictObject({
      title: { type: "string" },
      goal: { type: "string" },
      milestones: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: strictObject({
          title: { type: "string" },
          outcome: { type: "string" },
          activities: stringArray(8),
          estimatedMinutes: { type: "integer", minimum: 5, maximum: 2_400 },
          evidenceOfMastery: { type: "string" },
        }),
      },
      cautions: stringArray(8),
    }),
  },
  answer_feedback: {
    name: "learning_answer_feedback",
    description: "Constructive, rubric-like feedback on a learner answer.",
    schema: strictObject({
      score: { type: "integer", minimum: 0, maximum: 100 },
      correct: { type: "boolean" },
      feedback: { type: "string" },
      strengths: stringArray(6),
      gaps: stringArray(6),
      improvedAnswer: { type: "string" },
      nextQuestion: { type: ["string", "null"] },
    }),
  },
});

const exactKeys = (value, keys) => asRecord(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const boundedString = (value, maximum = 20_000) => typeof value === "string" && value.length <= maximum;
const requiredString = (value, maximum = 20_000) => boundedString(value, maximum) && Boolean(value.trim());
const boundedStringArray = (value, maximumItems) => Array.isArray(value)
  && value.length <= maximumItems
  && value.every((item) => boundedString(item, 4_000));

/**
 * Treats provider output as untrusted even when Structured Outputs is enabled.
 * This guards future UI code from persisting malformed generated content.
 */
export const validateStructuredAiResult = (task, value) => {
  if (task === "quiz") {
    if (!exactKeys(value, ["title", "instructions", "questions"])
      || !requiredString(value.title) || !requiredString(value.instructions)
      || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 10) return false;
    const ids = value.questions.map((question) => question?.id);
    if (new Set(ids).size !== ids.length) return false;
    return value.questions.every((question) => exactKeys(question, ["id", "prompt", "options", "correctIndex", "explanation", "difficulty"])
      && requiredString(question.id, 200) && requiredString(question.prompt)
      && Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 6
      && question.options.every((option) => requiredString(option, 4_000))
      && Number.isSafeInteger(question.correctIndex) && question.correctIndex >= 0 && question.correctIndex < question.options.length
      && requiredString(question.explanation)
      && DIFFICULTIES.has(question.difficulty));
  }
  if (task === "flashcards") {
    if (!exactKeys(value, ["cards"]) || !Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 20) return false;
    return value.cards.every((card) => exactKeys(card, ["front", "back", "hint", "tags"])
      && requiredString(card.front) && requiredString(card.back)
      && (card.hint === null || boundedString(card.hint))
      && boundedStringArray(card.tags, 4));
  }
  if (task === "study_plan") {
    if (!exactKeys(value, ["title", "goal", "milestones", "cautions"])
      || !requiredString(value.title) || !requiredString(value.goal)
      || !Array.isArray(value.milestones) || value.milestones.length < 1 || value.milestones.length > 12
      || !boundedStringArray(value.cautions, 8)) return false;
    return value.milestones.every((milestone) => exactKeys(milestone, ["title", "outcome", "activities", "estimatedMinutes", "evidenceOfMastery"])
      && requiredString(milestone.title) && requiredString(milestone.outcome)
      && boundedStringArray(milestone.activities, 8)
      && Number.isSafeInteger(milestone.estimatedMinutes) && milestone.estimatedMinutes >= 5 && milestone.estimatedMinutes <= 2_400
      && requiredString(milestone.evidenceOfMastery));
  }
  if (task === "answer_feedback") {
    return exactKeys(value, ["score", "correct", "feedback", "strengths", "gaps", "improvedAnswer", "nextQuestion"])
      && Number.isSafeInteger(value.score) && value.score >= 0 && value.score <= 100
      && typeof value.correct === "boolean"
      && requiredString(value.feedback) && boundedStringArray(value.strengths, 6) && boundedStringArray(value.gaps, 6)
      && requiredString(value.improvedAnswer) && (value.nextQuestion === null || requiredString(value.nextQuestion));
  }
  return false;
};
