import { createId } from "./id.js";
import { FSRS_DEFAULT_RETENTION, fsrsGrade } from "./fsrs.js";

const DAY_MS = 86_400_000;
const DAY_FORMATTER_CACHE_LIMIT = 32;
const dayFormatterCache = new Map();

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const REVIEW_CARD_TYPES = [
  { id: "basic", label: "Basic Q&A" },
  { id: "cloze", label: "Cloze deletion" },
  { id: "formula", label: "Formula" },
  { id: "derivation", label: "Derivation" },
  { id: "compare", label: "Compare / contrast" },
  { id: "debugging", label: "Debugging" },
  { id: "code-output", label: "Predict code output" },
  { id: "production-scenario", label: "Production scenario" },
];

export const REVIEW_RATINGS = [
  { id: "again", label: "Again", score: 0, key: "1" },
  { id: "hard", label: "Hard", score: 1, key: "2" },
  { id: "good", label: "Good", score: 2, key: "3" },
  { id: "easy", label: "Easy", score: 3, key: "4" },
];

export const currentTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const dayFormatterFor = (timeZone) => {
  const cacheKey = String(timeZone || "UTC");
  if (dayFormatterCache.has(cacheKey)) {
    const cached = dayFormatterCache.get(cacheKey);
    // Refresh insertion order so a one-off invalid zone cannot evict a zone
    // that is actively used by review sessions.
    dayFormatterCache.delete(cacheKey);
    dayFormatterCache.set(cacheKey, cached);
    return cached;
  }
  let formatter = null;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: cacheKey,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Cache invalid zones too; repeated malformed imported values must not
    // repeatedly throw while the profile is being normalized or inspected.
  }
  dayFormatterCache.set(cacheKey, formatter);
  if (dayFormatterCache.size > DAY_FORMATTER_CACHE_LIMIT) {
    dayFormatterCache.delete(dayFormatterCache.keys().next().value);
  }
  return formatter;
};

export const localDayKey = (date = new Date(), timeZone = currentTimeZone()) => {
  try {
    const formatter = dayFormatterFor(timeZone);
    if (!formatter) throw new RangeError("Invalid time zone");
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}@${timeZone}`;
  } catch {
    return `${date.toISOString().slice(0, 10)}@UTC`;
  }
};

export const emptyReviewSession = (now = new Date(), timeZone = currentTimeZone()) => {
  const id = localDayKey(now, timeZone);
  return {
    id,
    localDate: id.split("@")[0],
    timeZone,
    newIntroduced: 0,
    reviewCompleted: 0,
    crunchCompleted: 0,
    reviewedItemIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

export const getTodayReviewUsage = (sessions = [], now = new Date(), timeZone = currentTimeZone()) => {
  const id = localDayKey(now, timeZone);
  return sessions.filter((session) => session.id === id).reduce((usage, session) => ({
    ...usage,
    newIntroduced: usage.newIntroduced + (Number(session.newIntroduced) || 0),
    reviewCompleted: usage.reviewCompleted + (Number(session.reviewCompleted) || 0),
    crunchCompleted: usage.crunchCompleted + (Number(session.crunchCompleted) || 0),
    reviewedItemIds: [...new Set([...usage.reviewedItemIds, ...(session.reviewedItemIds || [])])],
  }), {
    id,
    localDate: id.split("@")[0],
    timeZone,
    newIntroduced: 0,
    reviewCompleted: 0,
    crunchCompleted: 0,
    reviewedItemIds: [],
  });
};

export const recordReviewUsage = (sessions = [], item, now = new Date(), options = {}) => {
  const timeZone = options.timeZone || currentTimeZone();
  const id = localDayKey(now, timeZone);
  const kind = options.crunch ? "crunch" : ((Number(item.reviewCount) || 0) > 0 || item.lastReviewedAt ? "review" : "new");
  const existingIndex = sessions.findIndex((session) => session.id === id);
  const existing = existingIndex >= 0 ? sessions[existingIndex] : emptyReviewSession(now, timeZone);
  const updated = {
    ...existing,
    newIntroduced: (Number(existing.newIntroduced) || 0) + (kind === "new" ? 1 : 0),
    reviewCompleted: (Number(existing.reviewCompleted) || 0) + (kind === "review" ? 1 : 0),
    crunchCompleted: (Number(existing.crunchCompleted) || 0) + (kind === "crunch" ? 1 : 0),
    reviewedItemIds: [...new Set([...(existing.reviewedItemIds || []), item.id])].slice(-10_000),
    updatedAt: now.toISOString(),
  };
  const next = existingIndex >= 0
    ? sessions.map((session, index) => index === existingIndex ? updated : session)
    : [...sessions, updated];
  return { sessions: next.slice(-730), kind, sessionKey: id };
};

export const reverseReviewUsage = (sessions = [], attempt) => {
  if (!attempt?.sessionKey || !attempt.sessionKind) return sessions;
  return sessions.map((session) => {
    if (session.id !== attempt.sessionKey) return session;
    const field = attempt.sessionKind === "new"
      ? "newIntroduced"
      : attempt.sessionKind === "crunch" ? "crunchCompleted" : "reviewCompleted";
    return { ...session, [field]: Math.max(0, (Number(session[field]) || 0) - 1), updatedAt: new Date().toISOString() };
  });
};

export const createReviewItem = ({ front, back, documentId = "", sourceClippingId = "", sourceAnnotationId = "", tags = [], type = "basic" }, now = new Date()) => ({
  id: createId(),
  type: REVIEW_CARD_TYPES.some((entry) => entry.id === type) ? type : "basic",
  front: String(front || "").trim().slice(0, 10_000),
  back: String(back || "").trim().slice(0, 20_000),
  documentId,
  sourceClippingId,
  sourceAnnotationId,
  tags: [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 30),
  suspended: false,
  archived: false,
  buriedOnDay: "",
  dueAt: now.toISOString(),
  intervalDays: 0,
  ease: 2.5,
  repetitions: 0,
  reviewCount: 0,
  lapses: 0,
  // FSRS-4.5 state (opt-in scheduler); 0/empty = unseeded.
  stability: 0,
  difficulty: 0,
  fsrsState: "",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  lastReviewedAt: "",
});

export const isNewReviewItem = (item) => (Number(item.reviewCount) || 0) === 0 && !item.lastReviewedAt;

const isDueAt = (item, nowMilliseconds, todayKey) => {
  if (item.suspended || item.archived || item.buriedOnDay === todayKey) return false;
  const dueAt = Date.parse(item.dueAt);
  return Number.isFinite(dueAt) && dueAt <= nowMilliseconds;
};

export const isDue = (item, now = new Date(), timeZone = currentTimeZone()) => (
  isDueAt(item, now.getTime(), localDayKey(now, timeZone))
);

const isLearningItem = (item) => (Number(item.repetitions) || 0) < 3 || (Number(item.intervalDays) || 0) < 14;

/**
 * Explicit, mutually exclusive queue classes (LEARN-003): every item is
 * exactly one of new / overdue / learning / due / scheduled / suspended /
 * archived. Precedence for a due item: overdue (a full day or more past its
 * due time) beats learning beats mature-on-time "due".
 */
export const classifyReviewItem = (item, now = new Date(), timeZone = currentTimeZone()) => {
  if (item.archived) return "archived";
  if (item.suspended) return "suspended";
  if (isNewReviewItem(item)) return "new";
  if (!isDueAt(item, now.getTime(), localDayKey(now, timeZone))) return "scheduled";
  const dueAt = Date.parse(item.dueAt);
  if (Number.isFinite(dueAt) && now.getTime() - dueAt >= 86_400_000) return "overdue";
  return isLearningItem(item) ? "learning" : "due";
};

const weakFirst = (left, right) => (
  (Number(right.lapses) || 0) - (Number(left.lapses) || 0)
  || (Number(left.ease) || 2.5) - (Number(right.ease) || 2.5)
  || Date.parse(left.dueAt) - Date.parse(right.dueAt)
  || String(left.id).localeCompare(String(right.id))
);

// How far ahead of its due time a learning step may be offered when the learner asks for
// it. Nothing counts such a card as due until its time comes.
export const LEARN_AHEAD_MINUTES = 20;

/**
 * A learning step: a card the learner has already seen whose interval is under a day,
 * like the 10-minute step Again sets. A step stored as 0.01 day by an earlier build is
 * one too; it is read as it is and never rewritten.
 */
export const isLearningStep = (item) => {
  const intervalDays = Number(item.intervalDays) || 0;
  return !isNewReviewItem(item) && intervalDays > 0 && intervalDays < 1;
};

/**
 * Learning steps that are not due yet but come due within `minutes`, earliest first:
 * what a review session may offer early instead of an empty queue while a failed card
 * waits out its step. Suspended, archived and buried-today cards are left out. This
 * only lists; a card enters a queue when the caller passes its id to buildReviewQueue.
 */
export const learnAheadCards = (items, now = new Date(), { minutes = LEARN_AHEAD_MINUTES, timeZone = currentTimeZone() } = {}) => {
  const todayKey = localDayKey(now, timeZone);
  const nowMilliseconds = now.getTime();
  const horizon = nowMilliseconds + minutes * 60_000;
  return items
    .filter((item) => {
      if (item.suspended || item.archived || item.buriedOnDay === todayKey || !isLearningStep(item)) return false;
      const dueAt = Date.parse(item.dueAt);
      return Number.isFinite(dueAt) && dueAt > nowMilliseconds && dueAt <= horizon;
    })
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || String(left.id).localeCompare(String(right.id)));
};

export const buildReviewQueue = (items, settings, now = new Date(), sessions = [], options = {}) => {
  const timeZone = options.timeZone || currentTimeZone();
  const todayKey = localDayKey(now, timeZone);
  const nowMilliseconds = now.getTime();
  if (options.crunch) {
    return items
      .filter((item) => !item.suspended && !item.archived && item.buriedOnDay !== todayKey)
      .sort(weakFirst)
      .slice(0, clamp(Number(options.crunchLimit) || 20, 1, 100));
  }

  const usage = getTodayReviewUsage(sessions, now, timeZone);
  const reviewRemaining = Math.max(0, (Number(settings.dailyReviewLimit) || 0) - usage.reviewCompleted);
  const newRemaining = Math.max(0, (Number(settings.dailyNewLimit) || 0) - usage.newIntroduced);
  const due = [];
  const fresh = [];
  for (const item of items) {
    if (!isDueAt(item, nowMilliseconds, todayKey)) continue;
    if (isNewReviewItem(item)) fresh.push(item);
    else due.push(item);
  }
  due.sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || weakFirst(left, right));
  fresh.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || String(left.id).localeCompare(String(right.id)));
  // A due learning step is not held back by the daily review limit: a card failed on the
  // last allowed review must still come back after its step, not tomorrow. Steps keep
  // their due order among the reviews and use no slot; other reviews fill what is left.
  let reviewSlots = reviewRemaining;
  const reviews = [];
  for (const item of due) {
    if (isLearningStep(item)) reviews.push(item);
    else if (reviewSlots > 0) {
      reviews.push(item);
      reviewSlots -= 1;
    }
  }
  // Learning ahead is opt-in: only steps the caller lists, and of those only the ones
  // learnAheadCards allows, so a stale or unknown id admits nothing.
  const listed = Array.isArray(options.learnAheadIds) && options.learnAheadIds.length > 0 ? new Set(options.learnAheadIds) : null;
  const early = listed ? learnAheadCards(items, now, { timeZone }).filter((item) => listed.has(item.id)) : [];
  return [...reviews, ...fresh.slice(0, newRemaining), ...early];
};

/**
 * The single due count every surface shows (Home widgets, the sidebar and
 * app-icon badges, the review hero): cards actionable in today's queue — not
 * suspended, archived, or buried for today, and within the remaining daily
 * new/review limits (a learning step that is due now is past the review limit).
 * It is exactly the queue that Start review opens, and it stays "due now": it
 * never passes `learnAheadIds`, so a card reachable only by learning ahead is
 * not counted.
 */
export const actionableReviewCount = ({ reviewItems = [], reviewSettings = {}, reviewSessions = [] } = {}, now = new Date(), timeZone = currentTimeZone()) => (
  buildReviewQueue(reviewItems, reviewSettings, now, reviewSessions, { timeZone }).length
);

export const reviewStats = (items, now = new Date(), timeZone = currentTimeZone()) => {
  const stats = { due: 0, overdue: 0, newCount: 0, learning: 0, mastered: 0, suspended: 0, archived: 0 };
  const todayKey = localDayKey(now, timeZone);
  const nowMilliseconds = now.getTime();
  for (const item of items) {
    if (isDueAt(item, nowMilliseconds, todayKey)) stats.due += 1;
    if (classifyReviewItem(item, now, timeZone) === "overdue") stats.overdue += 1;
    if (item.archived) {
      stats.archived += 1;
      continue;
    }
    if (item.suspended) {
      stats.suspended += 1;
      continue;
    }
    if (isNewReviewItem(item)) stats.newCount += 1;
    else if (item.repetitions < 3 || item.intervalDays < 14) stats.learning += 1;
    else if (item.repetitions >= 3 && item.intervalDays >= 14) stats.mastered += 1;
  }
  return stats;
};

// The schedule rule every new attempt records, so sync replay grades it the way it
// was graded. Rule 1 multiplied the interval however recently the card was
// reviewed (attempts recorded before #148 carry no rule and replay under it);
// rule 2 grows an early review from the elapsed time; rule 3 stores a step under a
// day to the minute under Classic and FSRS, so 10 minutes is due in 10 minutes.
export const REVIEW_SCHEDULE_RULE = 3;
// From this rule on, Classic grading is early-aware; a later build's rule keeps it.
const EARLY_AWARE_SCHEDULE_RULE = 2;
// From this rule on, a step under a day is stored to the minute; a later build's rule keeps it.
const MINUTE_STEP_SCHEDULE_RULE = 3;
const MAX_SCHEDULE_RULE = 1_000;

export const normalizeScheduleRule = (value, fallback = 1) => {
  const rule = Number(value);
  return Number.isInteger(rule) && rule >= 1 ? Math.min(rule, MAX_SCHEDULE_RULE) : fallback;
};

const intervalForRating = (item, rating, now, scheduleRule) => {
  const priorInterval = Number(item.intervalDays) || 0;
  const priorEase = Number(item.ease) || 2.5;
  const firstReview = isNewReviewItem(item);
  if (rating === "again") return { intervalDays: 10 / 1_440, ease: clamp(priorEase - 0.2, 1.3, 3.5), repetitions: 0 };
  // Reviewed before its interval ran out (Extra practice): grow from the time
  // waited, so quick repeat passes cannot compound it. A stored due time is exactly
  // the last review plus the rounded interval, so comparing whole milliseconds keeps
  // a due card from reading as early. A last review ahead of now counts as no time
  // waited; an unreadable one is not early.
  if (scheduleRule >= EARLY_AWARE_SCHEDULE_RULE && !firstReview && priorInterval >= 1) {
    const lastReviewedMs = Date.parse(item.lastReviewedAt);
    const waitedMs = Math.max(0, now.getTime() - lastReviewedMs);
    if (Number.isFinite(lastReviewedMs) && waitedMs < Math.round(priorInterval * DAY_MS)) {
      const factor = rating === "hard" ? 1.2 : rating === "good" ? priorEase : priorEase * 1.3;
      return { intervalDays: Math.max(priorInterval, (waitedMs / DAY_MS) * factor), ease: priorEase, repetitions: Number(item.repetitions) || 0 };
    }
  }
  if (rating === "hard") return { intervalDays: firstReview ? 1 : Math.max(1, priorInterval * 1.2), ease: clamp(priorEase - 0.15, 1.3, 3.5), repetitions: (Number(item.repetitions) || 0) + 1 };
  if (rating === "good") return { intervalDays: firstReview ? 1 : item.repetitions <= 1 ? 3 : Math.max(1, priorInterval * priorEase), ease: priorEase, repetitions: (Number(item.repetitions) || 0) + 1 };
  return { intervalDays: firstReview ? 4 : Math.max(4, priorInterval * priorEase * 1.3), ease: clamp(priorEase + 0.15, 1.3, 3.5), repetitions: (Number(item.repetitions) || 0) + 1 };
};

// The interval a rule stores and how long until it is due. From rule 3 a step under
// a day is kept to the minute, since 0.01 day is 14.4 minutes and a 10-minute step
// came due late; a longer interval, and any older rule, rounds to 0.01 day, so
// replaying an earlier attempt rebuilds the card it was graded into.
const scheduledInterval = (days, scheduleRule) => {
  const clamped = clamp(days, 10 / 1_440, 36_500);
  if (scheduleRule >= MINUTE_STEP_SCHEDULE_RULE && clamped < 1) {
    const minutes = Math.round(clamped * 1_440);
    return { intervalDays: minutes / 1_440, dueInMs: minutes * 60_000 };
  }
  const intervalDays = Math.round(clamped * 100) / 100;
  return { intervalDays, dueInMs: intervalDays * DAY_MS };
};

export const previewReviewIntervals = (item, { scheduler = "sm2", requestRetention = FSRS_DEFAULT_RETENTION, weights, now = new Date() } = {}) => Object.fromEntries(REVIEW_RATINGS.map(({ id }) => {
  if (scheduler === "fsrs") {
    const result = fsrsGrade(item, id, now, { requestRetention, ...(Array.isArray(weights) && weights.length === 17 ? { weights } : {}) });
    return [id, scheduledInterval(result.intervalDays, REVIEW_SCHEDULE_RULE).intervalDays];
  }
  const result = intervalForRating(item, id, now, REVIEW_SCHEDULE_RULE);
  return [id, scheduledInterval(result.intervalDays, REVIEW_SCHEDULE_RULE).intervalDays];
}));

const schedulingSnapshot = (item) => ({
  dueAt: item.dueAt,
  intervalDays: item.intervalDays,
  ease: item.ease,
  repetitions: item.repetitions,
  reviewCount: item.reviewCount,
  lapses: item.lapses,
  stability: item.stability,
  difficulty: item.difficulty,
  fsrsState: item.fsrsState,
  lastReviewedAt: item.lastReviewedAt,
  updatedAt: item.updatedAt,
});

export const gradeReviewItem = (item, rating, now = new Date(), elapsedMs = 0, metadata = {}) => {
  if (!REVIEW_RATINGS.some((entry) => entry.id === rating)) throw new Error("Unknown review rating");
  const priorInterval = Number(item.intervalDays) || 0;
  const priorReviewCount = Number(item.reviewCount) || (item.lastReviewedAt ? 1 : 0);
  const useFsrs = metadata.scheduler === "fsrs";
  const scheduleRule = normalizeScheduleRule(metadata.scheduleRule, REVIEW_SCHEDULE_RULE);
  // FSRS mode keeps writing the legacy fields (intervalDays, frozen ease,
  // repetitions) so stats, mastery, weak-first ordering, and interval labels
  // stay correct and toggling back to SM-2 is graceful.
  const fsrs = useFsrs ? fsrsGrade(item, rating, now, { requestRetention: metadata.requestRetention, ...(Array.isArray(metadata.weights) && metadata.weights.length === 17 ? { weights: metadata.weights } : {}) }) : null;
  const schedule = useFsrs
    ? {
      intervalDays: fsrs.intervalDays,
      ease: Number(item.ease) || 2.5,
      repetitions: rating === "again" ? 0 : (Number(item.repetitions) || 0) + 1,
    }
    : intervalForRating(item, rating, now, scheduleRule);
  const { intervalDays, dueInMs } = scheduledInterval(schedule.intervalDays, scheduleRule);
  const nextDueAt = new Date(now.getTime() + dueInMs).toISOString();
  const lapses = (Number(item.lapses) || 0) + (rating === "again" && priorReviewCount > 0 ? 1 : 0);
  const updated = {
    ...item,
    ...(fsrs ? { stability: fsrs.stability, difficulty: fsrs.difficulty, fsrsState: fsrs.fsrsState } : {}),
    intervalDays,
    ease: Math.round(schedule.ease * 100) / 100,
    repetitions: schedule.repetitions,
    reviewCount: priorReviewCount + 1,
    lapses,
    dueAt: nextDueAt,
    buriedOnDay: "",
    lastReviewedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const attempt = {
    id: createId(),
    reviewItemId: item.id,
    rating,
    confidence: clamp(Math.round(Number(metadata.confidence) || 3), 1, 5),
    elapsedMs: Math.max(0, Math.min(3_600_000, Math.round(elapsedMs) || 0)),
    reviewedAt: now.toISOString(),
    previousDueAt: item.dueAt,
    nextDueAt,
    previousIntervalDays: priorInterval,
    nextIntervalDays: intervalDays,
    previousState: schedulingSnapshot(item),
    sessionKind: metadata.sessionKind || (priorReviewCount > 0 ? "review" : "new"),
    sessionKey: metadata.sessionKey || "",
    crunch: Boolean(metadata.crunch),
    scheduleRule,
  };
  return { item: updated, attempt };
};

export const restoreReviewItemFromAttempt = (item, attempt) => {
  if (!attempt?.previousState || item.id !== attempt.reviewItemId) return item;
  return { ...item, ...attempt.previousState };
};

export const reviewAnalytics = (attempts = [], items = [], now = new Date(), timeZone = currentTimeZone()) => {
  const nowMilliseconds = now.getTime();
  let count7 = 0;
  let retained7 = 0;
  let count30 = 0;
  let retained30 = 0;
  const latencies = [];
  const activeDays = new Set();
  // Twelve weekly retention buckets covering ~90 days, oldest first.
  const trendWeeks = 12;
  const trendCounts = Array(trendWeeks).fill(0);
  const trendRetained = Array(trendWeeks).fill(0);
  for (const attempt of attempts) {
    const reviewedAt = Date.parse(attempt.reviewedAt);
    if (!Number.isFinite(reviewedAt)) continue;
    const age = nowMilliseconds - reviewedAt;
    const retained = attempt.rating !== "again";
    if (age <= 7 * DAY_MS) {
      count7 += 1;
      if (retained) retained7 += 1;
    }
    if (age <= 30 * DAY_MS) {
      count30 += 1;
      if (retained) retained30 += 1;
      latencies.push(Number(attempt.elapsedMs) || 0);
    }
    const week = Math.floor(age / (7 * DAY_MS));
    if (week >= 0 && week < trendWeeks) {
      const bucket = trendWeeks - 1 - week;
      trendCounts[bucket] += 1;
      if (retained) trendRetained[bucket] += 1;
    }
    activeDays.add(localDayKey(new Date(reviewedAt), timeZone).split("@")[0]);
  }
  latencies.sort((left, right) => left - right);
  let streak = 0;
  for (let cursor = new Date(now), guard = 0; guard < 3650; guard += 1) {
    const key = localDayKey(cursor, timeZone).split("@")[0];
    if (!activeDays.has(key)) {
      if (guard === 0) { cursor = new Date(cursor.getTime() - DAY_MS); continue; }
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  // Upcoming reviews bucketed by local calendar day (index 0 = the rest of
  // today), so the chart's "Today"/"Tomorrow" labels mean what they say.
  const forecast = Array(7).fill(0);
  const calendarDay = (date) => {
    const [year, month, day] = localDayKey(date, timeZone).split("@")[0].split("-").map(Number);
    return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
  };
  const today = calendarDay(now);
  for (const item of items) {
    if (item.suspended || item.archived) continue;
    const dueAt = Date.parse(item.dueAt);
    if (!Number.isFinite(dueAt) || dueAt < nowMilliseconds || dueAt - nowMilliseconds >= 8 * DAY_MS) continue;
    const bucket = calendarDay(new Date(dueAt)) - today;
    if (bucket >= 0 && bucket < forecast.length) forecast[bucket] += 1;
  }
  return {
    retention7: count7 ? Math.round((retained7 / count7) * 100) : null,
    retention30: count30 ? Math.round((retained30 / count30) * 100) : null,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    streak,
    forecast,
    retentionTrend: trendCounts.map((count, index) => ({
      count,
      percent: count ? Math.round((trendRetained[index] / count) * 100) : null,
    })),
  };
};

export const formatInterval = (days) => {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1_440))} min`;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hr`;
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} yr`;
};

export const formatLatency = (milliseconds) => {
  if (milliseconds === null || milliseconds === undefined) return "—";
  const seconds = Math.max(0, milliseconds) / 1_000;
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

/**
 * Cloze mechanics (LEARN-002): `{{hidden text}}` spans in a cloze card's
 * prompt are concealed until reveal. The transform runs on the raw Markdown
 * before rendering, so the sanitized pipeline is unchanged.
 */
export const hasClozeMarkup = (text) => /\{\{[^{}]+\}\}/.test(String(text || ""));

export const renderClozePrompt = (text, revealed = false) => String(text || "").replace(
  /\{\{([^{}]+)\}\}/g,
  (_match, hidden) => (revealed ? `**${hidden.trim()}**` : "**[ … ]**"),
);
