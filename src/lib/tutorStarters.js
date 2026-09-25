/**
 * Suggested starts in the tutor's empty state (TFEAT-04), built from what the
 * learner already has on this device: the lesson they last opened, open
 * mistakes, cards they keep forgetting and the next lesson in their plan.
 * Everything is read-only; a starter only fills the question box, so its
 * text leaves the device only when the learner sends it.
 */

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

const clip = (value, maximum) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

// Cloze cards show their hidden text; a starter is about the whole card.
const withoutCloze = (value) => clean(value).replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");

/** Starter fields are clipped so a starter prompt stays far below the prompt limit. */
export const STARTER_FIELD_CHARS = 300;
const LABEL_CHARS = 80;

/**
 * A chapter or an upload the learner can study. The roadmap, audits,
 * indexes and archived notes are not lessons.
 */
export const isStarterLesson = (document) => Boolean(document)
  && typeof document.id === "string"
  && Boolean(clean(document.title))
  && document.archived !== true
  && document.isIndex !== true
  && (document.source === "custom" || (Number.isInteger(document.partNumber) && document.partNumber >= 1));

/** The first "## " headings of a lesson, outside code, as plain text. */
export const lessonHeadings = (markdown, limit = 4) => {
  const headings = [];
  let fenced = false;
  for (const line of clean(markdown).split("\n")) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const match = !fenced && line.match(/^\s{0,3}##\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      // Section numbers ("3.", "2.1)") read oddly inside a starter.
      .replace(/^\d+(?:\.\d+)*[.)]\s+|^\d+(?:\.\d+)+\s+/, "");
    if (text) headings.push(clip(text, LABEL_CHARS));
    if (headings.length >= limit) break;
  }
  return headings;
};

const isOpenMistake = (mistake) => Boolean(mistake) && !mistake.correctedAt && Boolean(clean(mistake.prompt));

/** Open mistakes: this lesson's first, then the most repeated and most recent. */
export const rankOpenMistakes = (mistakes, documentId = "") => (Array.isArray(mistakes) ? mistakes : [])
  .filter(isOpenMistake)
  .sort((left, right) => Number(Boolean(documentId) && right.documentId === documentId) - Number(Boolean(documentId) && left.documentId === documentId)
    || (Number(right.occurrences) || 1) - (Number(left.occurrences) || 1)
    || (Date.parse(right.lastSeenAt || "") || 0) - (Date.parse(left.lastSeenAt || "") || 0)
    || String(left.id).localeCompare(String(right.id)));

/** Active cards forgotten at least twice: this lesson's first, then by lapses. */
export const rankLapsedCards = (items, documentId = "") => (Array.isArray(items) ? items : [])
  .filter((item) => item && !item.archived && !item.suspended && (Number(item.lapses) || 0) >= 2 && Boolean(clean(item.front)))
  .sort((left, right) => Number(Boolean(documentId) && right.documentId === documentId) - Number(Boolean(documentId) && left.documentId === documentId)
    || (Number(right.lapses) || 0) - (Number(left.lapses) || 0)
    || String(left.id).localeCompare(String(right.id)));

const mistakeStarter = (mistake) => ({
  id: `mistake-${mistake.id}`,
  kind: "mistake",
  label: `I keep missing: ${clip(mistake.prompt, LABEL_CHARS)}`,
  modeId: "explain",
  prompt: `I keep getting this wrong: “${clip(mistake.prompt, STARTER_FIELD_CHARS)}”.${clean(mistake.expected) ? ` The correct answer is: “${clip(mistake.expected, STARTER_FIELD_CHARS)}”.` : ""} Explain the idea behind it and the misconception that leads to my mistake.`,
  documentId: clean(mistake.documentId),
});

const cardStarter = (card) => ({
  id: `card-${card.id}`,
  kind: "card",
  label: `Help me remember: ${clip(withoutCloze(card.front), LABEL_CHARS)}`,
  modeId: "explain",
  prompt: `Help me remember this card I keep forgetting: “${clip(withoutCloze(card.front), STARTER_FIELD_CHARS)}”${clean(card.back) ? ` (answer: “${clip(withoutCloze(card.back), STARTER_FIELD_CHARS)}”)` : ""}. Explain the idea and give me one memory hook.`,
  documentId: clean(card.documentId),
});

const lessonName = (lesson) => clip(lesson.title, 120);

const quizStarter = (lesson, heading) => ({
  id: `quiz-${lesson.id}`,
  kind: "quiz",
  label: `Quiz me on ${heading || lessonName(lesson)}`,
  modeId: "quiz",
  prompt: `Create 3 questions to test my understanding of ${heading ? `“${heading}” in ` : ""}the lesson “${lessonName(lesson)}”. Explain each answer.`,
  documentId: lesson.id,
});

const explainStarter = (lesson) => ({
  id: `explain-${lesson.id}`,
  kind: "explain",
  label: `Explain the key ideas of ${lessonName(lesson)}`,
  modeId: "explain",
  prompt: `Explain the key ideas of the lesson “${lessonName(lesson)}” with a short example and one common mistake.`,
  documentId: lesson.id,
});

const socraticStarter = (lesson, heading) => ({
  id: `socratic-${lesson.id}`,
  kind: "socratic",
  label: `Teach me ${heading} step by step`,
  modeId: "socratic",
  prompt: `Teach me “${heading}” from the lesson “${lessonName(lesson)}” step by step, one focused question at a time. Start by checking what I already understand.`,
  documentId: lesson.id,
});

const interviewStarter = (lesson) => ({
  id: `interview-${lesson.id}`,
  kind: "interview",
  label: `Interview me on ${lessonName(lesson)}`,
  modeId: "interview",
  prompt: `Interview me on the lesson “${lessonName(lesson)}” at senior engineer depth, one question at a time.`,
  documentId: lesson.id,
});

/**
 * Up to `limit` starters, most useful first.
 *
 * context: { recent, last, next, mistakes, reviewItems } where recent, last
 * and next are brief documents ({ id, title, isIndex, partNumber, source,
 * archived }): the most recently opened document, the last one read and the
 * plan's next lesson. `lessonText(id)` returns a lesson's Markdown when it is
 * already loaded (headings are never fetched just for a starter).
 *
 * With a lesson: an open mistake from it, a card from it that keeps lapsing,
 * then quiz, explain, interview and step-by-step starters about it. Without
 * one: the next lesson, the top open mistake and the most-lapsed card.
 */
export const buildStarterPrompts = (context, { limit = 6, lessonText = () => "" } = {}) => {
  if (!context || typeof context !== "object") return [];
  const starters = [];
  const add = (starter) => {
    if (starter && !starters.some((item) => item.prompt === starter.prompt)) starters.push(starter);
  };
  const lesson = [context.recent, context.last].find(isStarterLesson) || null;
  const mistakes = rankOpenMistakes(context.mistakes, lesson?.id || "");
  const cards = rankLapsedCards(context.reviewItems, lesson?.id || "");
  if (lesson) {
    const [first, second] = lessonHeadings(lessonText(lesson.id));
    add(mistakes.find((mistake) => mistake.documentId === lesson.id) && mistakeStarter(mistakes.find((mistake) => mistake.documentId === lesson.id)));
    add(cards[0] && cardStarter(cards[0]));
    add(quizStarter(lesson, first));
    add(explainStarter(lesson));
    add(interviewStarter(lesson));
    add(second && socraticStarter(lesson, second));
    add(mistakes.find((mistake) => mistake.documentId !== lesson.id) && mistakeStarter(mistakes.find((mistake) => mistake.documentId !== lesson.id)));
  } else {
    const next = isStarterLesson(context.next) ? context.next : null;
    add(next && explainStarter(next));
    add(mistakes[0] && mistakeStarter(mistakes[0]));
    add(cards[0] && cardStarter(cards[0]));
    add(next && quizStarter(next));
  }
  return starters.slice(0, Math.max(0, limit));
};
