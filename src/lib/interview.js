/**
 * Timed interview round v1 (INTERVIEW-002 slice): a deterministic bounded
 * selection of interview-flavored cards practiced under prep/answer timers.
 * Rounds are practice-only — they never touch the scheduler — and misses
 * feed the mistake notebook with the interview category. Role/seniority
 * tracks, rubric scoring, and recorded answers remain open acceptance work.
 */
export const INTERVIEW_PREP_SECONDS = 30;
export const INTERVIEW_ANSWER_SECONDS = 120;

const INTERVIEW_TYPES = new Set(["production-scenario", "compare", "debugging"]);

export const isInterviewCard = (item) => !item.suspended && !item.archived
  && (INTERVIEW_TYPES.has(item.type) || (item.tags || []).some((tag) => String(tag).toLocaleLowerCase() === "interview"));

export const selectInterviewRound = (items, { limit = 6 } = {}) => (items || [])
  .filter(isInterviewCard)
  .sort((left, right) => (Number(right.lapses) || 0) - (Number(left.lapses) || 0)
    || Date.parse(left.lastReviewedAt || left.createdAt || 0) - Date.parse(right.lastReviewedAt || right.createdAt || 0)
    || String(left.id).localeCompare(String(right.id)))
  .slice(0, Math.max(1, Math.min(limit, 12)));
