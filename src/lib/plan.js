import { buildReviewQueue } from "./review.js";

/**
 * Daily session builder v1 (PLAN-001 slice): a deterministic 15/30/60-minute
 * mix of due reviews, open-mistake corrections, and the next reading step.
 * Estimates are explicit constants so the plan is predictable, not adaptive:
 * ~30 seconds per due card, ~3 minutes per mistake correction, and the
 * chapter's own reading-minutes metadata. Goal capture, reschedule/catch-up,
 * and prerequisite awareness remain open acceptance work.
 */
const MINUTES_PER_CARD = 0.5;
const MINUTES_PER_MISTAKE = 3;

export const SESSION_LENGTHS = Object.freeze([15, 30, 60]);

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

  // 3. Reading: resume the most recent in-progress chapter, else the first
  //    unread built-in chapter in curriculum order.
  const builtin = documents.filter((document) => document.source === "builtin" && !document.isIndex && Number.isInteger(document.partNumber) && document.partNumber >= 1);
  const progressOf = (id) => Number(profile.progress?.[id]) || 0;
  const inProgress = builtin
    .filter((document) => progressOf(document.id) > 0 && progressOf(document.id) < 0.96)
    .sort((left, right) => (profile.recent || []).indexOf(left.id) - (profile.recent || []).indexOf(right.id));
  const unread = builtin
    .filter((document) => progressOf(document.id) === 0)
    .sort((left, right) => left.partNumber - right.partNumber || left.chapterNumber - right.chapterNumber);
  const readingTarget = inProgress[0] || unread[0] || null;
  if (readingTarget && remaining >= 5) {
    const chapterMinutes = Math.max(5, Number(readingTarget.minutes) || 10);
    const readingMinutes = Math.min(remaining, chapterMinutes);
    blocks.push({
      kind: "reading",
      label: `${progressOf(readingTarget.id) > 0 ? "Continue" : "Start"} “${readingTarget.title}”`,
      minutes: readingMinutes,
      documentId: readingTarget.id,
      partial: readingMinutes < chapterMinutes,
    });
    remaining -= readingMinutes;
  }

  return {
    budgetMinutes: budget,
    plannedMinutes: budget - remaining,
    blocks,
    empty: blocks.length === 0,
  };
};
