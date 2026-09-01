import { classifyReviewItem } from "./review.js";

/**
 * Mastery ladder v1 (LEARN-004 slice): a deterministic per-Part aggregation of
 * reading progress and review evidence. This is evidence-based state, not the
 * full seven-level concept graph — states, thresholds, and the reason/next
 * action are explicit so a learner can see why a Part sits where it does.
 *
 * Ladder: not-seen → reading → read → practicing → mastered.
 * - reading: any chapter opened (progress > 0) but not all completed
 * - read: every chapter completed (progress ≥ 0.96)
 * - practicing: read, with active review cards but fewer than the mastery bar
 * - mastered: read, at least three cards mastered (3+ repetitions and a
 *   14-day+ interval), and no card currently overdue
 */
export const PART_MASTERY_STATES = Object.freeze([
  { id: "not-seen", label: "Not seen" },
  { id: "reading", label: "Reading" },
  { id: "read", label: "Read" },
  { id: "practicing", label: "Practicing" },
  { id: "mastered", label: "Mastered" },
]);

const COMPLETED = 0.96;
const MASTERY_CARD_BAR = 3;

export const masteryByPart = (documents, profile, now = new Date()) => {
  const parts = new Map();
  for (const document of documents) {
    if (document.source !== "builtin" || !Number.isInteger(document.partNumber) || document.partNumber < 1 || document.isIndex) continue;
    if (!parts.has(document.partNumber)) {
      parts.set(document.partNumber, { partNumber: document.partNumber, partTitle: document.partTitle || `Part ${document.partNumber}`, documentIds: [], chapters: 0, completed: 0, started: 0, progressSum: 0 });
    }
    const part = parts.get(document.partNumber);
    part.documentIds.push(document.id);
    part.chapters += 1;
    const progress = Number(profile.progress?.[document.id]) || 0;
    part.progressSum += Math.max(0, Math.min(1, progress));
    if (progress >= COMPLETED) part.completed += 1;
    else if (progress > 0) part.started += 1;
  }

  const cardsByDocument = new Map();
  for (const item of profile.reviewItems || []) {
    if (!item.documentId || item.archived) continue;
    if (!cardsByDocument.has(item.documentId)) cardsByDocument.set(item.documentId, []);
    cardsByDocument.get(item.documentId).push(item);
  }

  return [...parts.values()]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => {
      const cards = part.documentIds.flatMap((id) => cardsByDocument.get(id) || []);
      let mastered = 0;
      let overdue = 0;
      let active = 0;
      for (const card of cards) {
        const queueClass = classifyReviewItem(card, now);
        if (queueClass === "overdue") overdue += 1;
        if (queueClass !== "suspended" && queueClass !== "archived") active += 1;
        if ((Number(card.repetitions) || 0) >= 3 && (Number(card.intervalDays) || 0) >= 14) mastered += 1;
      }
      const readPercent = part.chapters ? Math.round((part.progressSum / part.chapters) * 100) : 0;
      const allRead = part.completed === part.chapters && part.chapters > 0;

      let state = "not-seen";
      let reason = "No chapter in this Part has been opened.";
      let nextAction = "Open the first chapter.";
      if (part.completed + part.started > 0 && !allRead) {
        state = "reading";
        reason = `${part.completed} of ${part.chapters} chapters completed (${readPercent}% read).`;
        nextAction = "Finish the remaining chapters.";
      }
      if (allRead) {
        state = "read";
        reason = "Every chapter is completed, but recall is not yet practiced.";
        nextAction = "Create review cards from highlights or clippings in this Part.";
        if (active > 0) {
          state = "practicing";
          reason = `${mastered} of ${active} active cards mastered${overdue ? `; ${overdue} overdue` : ""}.`;
          nextAction = overdue ? "Clear the overdue cards first." : "Keep reviewing until three cards reach a 14-day interval.";
        }
        if (mastered >= MASTERY_CARD_BAR && overdue === 0 && active > 0) {
          state = "mastered";
          reason = `All chapters read and ${mastered} cards hold 14-day+ intervals with nothing overdue.`;
          nextAction = "Maintain the schedule; add harder production-scenario cards to go deeper.";
        }
      }

      return {
        partNumber: part.partNumber,
        partTitle: part.partTitle,
        chapters: part.chapters,
        completedChapters: part.completed,
        readPercent,
        cards: cards.length,
        activeCards: active,
        masteredCards: mastered,
        overdueCards: overdue,
        state,
        reason,
        nextAction,
      };
    });
};
