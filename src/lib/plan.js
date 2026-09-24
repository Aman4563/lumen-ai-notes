import { buildReviewQueue } from "./review.js";

/**
 * Daily session builder v1 (PLAN-001 slice): a deterministic 15/30/60-minute
 * mix of due reviews, open-mistake corrections, and reading that fills the
 * remaining minutes (up to four blocks). Estimates are explicit constants so
 * the plan is predictable, not adaptive: ~30 seconds per due card, ~3
 * minutes per mistake correction, and the chapter's own reading-minutes
 * metadata (the unread share for a started lecture). Reschedule/catch-up and
 * prerequisite awareness remain open acceptance work.
 */
const MINUTES_PER_CARD = 0.5;
const MINUTES_PER_MISTAKE = 3;
const COMPLETED = 0.96;
const MIN_READING_BLOCK = 5;
const MAX_READING_BLOCKS = 4;

export const SESSION_LENGTHS = Object.freeze([15, 30, 60]);

/**
 * Reading order shared by every Home surface: started-but-unfinished
 * lectures, most recently opened first (built-in chapters that fell out of
 * the bounded recent list follow in curriculum order), then unread built-in
 * chapters with the learner's goal Parts first and curriculum order after.
 */
const readingOrder = ({ profile, documents }) => {
  const progressOf = (id) => Number(profile.progress?.[id]) || 0;
  const recent = profile.recent || [];
  const recency = (id) => {
    const index = recent.indexOf(id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const isChapter = (document) => document.source === "builtin" && !document.isIndex && Number.isInteger(document.partNumber) && document.partNumber >= 1;
  const curriculum = (left, right) => left.partNumber - right.partNumber || left.chapterNumber - right.chapterNumber;
  const goalParts = new Set(profile.goals?.targetParts || []);
  const inProgress = documents
    .filter((document) => !document.archived && progressOf(document.id) > 0 && progressOf(document.id) < COMPLETED && (isChapter(document) || recency(document.id) < Number.MAX_SAFE_INTEGER))
    .sort((left, right) => recency(left.id) - recency(right.id) || curriculum(left, right));
  const unread = documents
    .filter((document) => isChapter(document) && progressOf(document.id) === 0)
    .sort((left, right) => Number(goalParts.has(right.partNumber)) - Number(goalParts.has(left.partNumber)) || curriculum(left, right));
  return { inProgress, unread, progressOf, goalParts };
};

/**
 * The single "Continue" rule (issue #52): the most recently opened lecture
 * that is started but not finished; otherwise the next unread chapter. A
 * completed lecture is never offered as "Continue". Null when everything
 * is read.
 */
export const resumeTarget = ({ profile, documents }) => {
  const { inProgress, unread, progressOf } = readingOrder({ profile, documents });
  if (inProgress.length) return { document: inProgress[0], action: "continue", progress: progressOf(inProgress[0].id) };
  if (unread.length) return { document: unread[0], action: "start", progress: 0 };
  return null;
};

export const buildDailySession = (minutes, { profile, documents }, now = new Date()) => {
  const budget = SESSION_LENGTHS.includes(minutes) ? minutes : 30;
  let remaining = budget;
  const blocks = [];

  // 1. Due reviews first: retention decays fastest.
  const queue = buildReviewQueue(profile.reviewItems || [], profile.reviewSettings || {}, now, profile.reviewSessions || []);
  if (queue.length) {
    const affordable = Math.min(queue.length, Math.max(1, Math.floor((remaining * 0.5) / MINUTES_PER_CARD)));
    const reviewMinutes = Math.ceil(affordable * MINUTES_PER_CARD);
    blocks.push({ kind: "review", label: `Review ${affordable} due card${affordable === 1 ? "" : "s"}`, minutes: reviewMinutes, count: affordable });
    remaining -= reviewMinutes;
  }

  // 2. One or two open mistakes, most-repeated first.
  const openMistakes = (profile.mistakes || [])
    .filter((mistake) => !mistake.correctedAt)
    .sort((left, right) => (Number(right.occurrences) || 1) - (Number(left.occurrences) || 1)
      || Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0)
      || String(left.id).localeCompare(String(right.id)));
  const affordableMistakes = Math.min(openMistakes.length, Math.floor(remaining / MINUTES_PER_MISTAKE), budget >= 30 ? 2 : 1);
  if (affordableMistakes > 0) {
    blocks.push({
      kind: "mistakes",
      label: `Correct ${affordableMistakes} open mistake${affordableMistakes === 1 ? "" : "s"}`,
      minutes: affordableMistakes * MINUTES_PER_MISTAKE,
      count: affordableMistakes,
      mistakeIds: openMistakes.slice(0, affordableMistakes).map((mistake) => mistake.id),
    });
    remaining -= affordableMistakes * MINUTES_PER_MISTAKE;
  }

  // 3. Reading fills the rest of the chosen length: first the Continue
  //    target every Home surface shares, then other started lectures, then
  //    unread chapters (goal Parts first, curriculum order after), until
  //    less than a useful block remains.
  const { inProgress, unread, progressOf, goalParts } = readingOrder({ profile, documents });
  let readingBlocks = 0;
  for (const target of [...inProgress, ...unread]) {
    if (remaining < MIN_READING_BLOCK || readingBlocks >= MAX_READING_BLOCKS) break;
    const progress = progressOf(target.id);
    const fullMinutes = Math.max(MIN_READING_BLOCK, Number(target.minutes) || 10);
    // A started lecture only needs its unread share.
    const chapterMinutes = progress > 0 ? Math.max(3, Math.ceil(fullMinutes * (1 - progress))) : fullMinutes;
    const readingMinutes = Math.min(remaining, chapterMinutes);
    blocks.push({
      kind: "reading",
      label: `${progress > 0 ? "Continue" : "Start"} “${target.title}”`,
      reason: progress > 0
        ? `${Math.round(progress * 100)}% read so far`
        : goalParts.has(target.partNumber) ? `Next in your goal Part ${target.partNumber}` : "Next in curriculum order",
      minutes: readingMinutes,
      documentId: target.id,
      partial: readingMinutes < chapterMinutes,
    });
    remaining -= readingMinutes;
    readingBlocks += 1;
  }

  return {
    budgetMinutes: budget,
    plannedMinutes: budget - remaining,
    blocks,
    empty: blocks.length === 0,
  };
};

/**
 * Goal pacing (PLAN-001): given target Parts and a target date, how many
 * chapters per day the remaining runway requires, with an honest status.
 * Copy is deliberately neutral — behind is a scheduling fact, not a failing.
 */
export const planPace = ({ profile, documents }, now = new Date()) => {
  const goals = profile.goals;
  if (!goals?.targetDate || !(goals.targetParts || []).length) return null;
  const targetMs = Date.parse(`${goals.targetDate}T23:59:59`);
  if (!Number.isFinite(targetMs)) return null;
  const targetParts = new Set(goals.targetParts);
  const remainingChapters = documents.filter((document) => document.source === "builtin"
    && !document.isIndex
    && targetParts.has(document.partNumber)
    && (Number(profile.progress?.[document.id]) || 0) < 0.96).length;
  const daysLeft = Math.ceil((targetMs - now.getTime()) / 86_400_000);
  if (remainingChapters === 0) {
    return { status: "done", remainingChapters: 0, daysLeft: Math.max(0, daysLeft), chaptersPerDay: 0, message: "Every chapter in your goal Parts is read — reviews keep it durable." };
  }
  if (daysLeft <= 0) {
    return { status: "past-due", remainingChapters, daysLeft: 0, chaptersPerDay: remainingChapters, message: `${remainingChapters} chapter${remainingChapters === 1 ? "" : "s"} remain past the target date. Pick a new date that fits — steady beats rushed.` };
  }
  const chaptersPerDay = Math.ceil((remainingChapters / daysLeft) * 10) / 10;
  const status = chaptersPerDay <= 1 ? "on-track" : chaptersPerDay <= 2 ? "tight" : "behind";
  const message = status === "on-track"
    ? `${remainingChapters} chapter${remainingChapters === 1 ? "" : "s"} over ${daysLeft} day${daysLeft === 1 ? "" : "s"} — about ${chaptersPerDay}/day keeps you on track.`
    : status === "tight"
      ? `${chaptersPerDay} chapters/day needed — doable, but consider trimming the goal or the date.`
      : `${chaptersPerDay} chapters/day needed. Moving the date or narrowing the Parts keeps the plan honest.`;
  return { status, remainingChapters, daysLeft, chaptersPerDay, message };
};

/** Due count for the opt-in app badge: actionable reviews right now. */
export const actionableDueCount = (profile, now = new Date()) => (profile.reviewItems || [])
  .filter((item) => !item.suspended && !item.archived && Date.parse(item.dueAt) <= now.getTime()).length;
