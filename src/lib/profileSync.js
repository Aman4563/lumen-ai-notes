import { normalizeProfile } from "./db.js";
import { createId } from "./id.js";
import { gradeReviewItem } from "./review.js";

export const PROFILE_SYNC_CHANNEL = "lumen-profile-sync-v1";
export const PROFILE_SYNC_SIGNAL_KEY = "lumen-profile-sync-signal-v1";
export const PROFILE_REPLACEMENT_EVENT = "lumen:profile-replacement";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const stableString = (value) => JSON.stringify(value);
const equal = (left, right) => stableString(left) === stableString(right);

// A small deterministic hash is sufficient here: it produces stable recovery
// record IDs, not a security boundary or an integrity checksum.
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const isoTime = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isProfileReplacementNewer = (candidateValue, referenceValue) => {
  const candidate = normalizeProfile(candidateValue);
  const reference = normalizeProfile(referenceValue);
  const candidateGeneration = candidate.syncMeta.generation;
  const referenceGeneration = reference.syncMeta.generation;
  if (candidateGeneration === referenceGeneration) return false;
  if (candidateGeneration && !referenceGeneration) return true;
  if (!candidateGeneration) return false;
  const timeDifference = isoTime(candidate.syncMeta.replacedAt) - isoTime(reference.syncMeta.replacedAt);
  if (timeDifference) return timeDifference > 0;
  return candidateGeneration > referenceGeneration;
};

export const prepareProfileReplacement = (profileValue, { reason, writerId = "", now = new Date().toISOString(), generation = createId() } = {}) => {
  if (!["reset", "restore"].includes(reason)) throw new TypeError("Profile replacement reason must be reset or restore");
  const profile = normalizeProfile(profileValue);
  return normalizeProfile({
    ...profile,
    syncMeta: {
      revision: 1,
      updatedAt: now,
      writerId,
      generation,
      replacedAt: now,
      replacementReason: reason,
      conflicts: [],
    },
  });
};

const itemTime = (item) => Math.max(
  isoTime(item?.updatedAt),
  isoTime(item?.reviewedAt),
  isoTime(item?.createdAt),
);

const RECORD_COLLECTION_LIMITS = Object.freeze({
  customDocuments: 500,
  clippings: 2_000,
  mistakes: 2_000,
  annotations: 5_000,
  reviewItems: 10_000,
  reviewAttempts: 50_000,
  aiTutorHistory: 50,
  collections: 100,
  trash: 100,
  assessments: 100,
  activity: 500,
  revisions: 60,
});

// Rolling histories retain the newest records at capacity instead of
// protecting base records; trash/activity/revisions are append-mostly logs
// whose pruning (30-day purge, per-document caps) must not read as conflicts.
const ROLLING_RECORD_COLLECTIONS = new Set(["reviewAttempts", "aiTutorHistory", "trash", "activity", "revisions", "assessments"]);

const compareOldestFirst = (left, right) => (
  itemTime(left) - itemTime(right)
  || String(left?.id || "").localeCompare(String(right?.id || ""))
  || stableString(left).localeCompare(stableString(right))
);

const compareNewestFirst = (left, right) => compareOldestFirst(right, left);

// Deterministic tie-breaking makes A+ B and B+A converge even when both tabs
// create/update in the same millisecond.
const chooseWinner = (left, right) => {
  const timeDifference = itemTime(left) - itemTime(right);
  if (timeDifference) return timeDifference > 0 ? left : right;
  return stableString(left) >= stableString(right) ? left : right;
};

const mergeConflictHistory = (...groups) => {
  const byId = new Map();
  groups.flat().forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  return [...byId.values()].slice(-100);
};

const makeConflict = ({ kind, collection, recordId, preservedRecordId = recordId, detectedAt, fingerprint = "" }) => ({
  id: `sync-${stableHash(`${kind}\u0000${collection}\u0000${recordId}\u0000${preservedRecordId}\u0000${fingerprint}`)}`,
  kind,
  collection,
  recordId,
  preservedRecordId,
  detectedAt,
});

/**
 * Apply the same collection bounds as normalizeProfile before normalization
 * can silently truncate a merge result. Durable learning records protect every
 * surviving base record and admit concurrent additions in a deterministic
 * order. Intentionally rolling histories retain the newest records. Either
 * policy emits sync metadata for every record displaced at the boundary.
 */
const enforceRecordCapacity = (collection, baseItems, records, existingConflicts, detectedAt) => {
  const limit = RECORD_COLLECTION_LIMITS[collection];
  if (!limit || records.length <= limit) return { records, conflicts: [...existingConflicts] };

  const rolling = ROLLING_RECORD_COLLECTIONS.has(collection);
  let kept;
  if (rolling) {
    kept = [...records].sort(compareOldestFirst).slice(-limit);
  } else {
    const baseIds = new Set(baseItems.map((item) => item.id));
    const protectedRecords = records
      .filter((item) => baseIds.has(item.id))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)) || stableString(left).localeCompare(stableString(right)));
    const additions = records
      .filter((item) => !baseIds.has(item.id))
      .sort(compareNewestFirst);
    kept = [...protectedRecords.slice(0, limit), ...additions.slice(0, Math.max(0, limit - protectedRecords.length))];
  }

  const keptIds = new Set(kept.map((item) => item.id));
  const displaced = records.filter((item) => !keptIds.has(item.id)).sort(compareOldestFirst);
  const displacedIds = new Set(displaced.map((item) => item.id));
  const conflicts = existingConflicts.map((conflict) => (
    conflict.collection === collection && displacedIds.has(conflict.preservedRecordId)
      ? { ...conflict, kind: `${conflict.kind}-capacity-overflow`, preservedRecordId: "" }
      : conflict
  ));
  displaced.forEach((item) => {
    conflicts.push(makeConflict({
      kind: rolling ? "history-rollover" : "capacity-overflow",
      collection,
      recordId: item.id,
      preservedRecordId: "",
      detectedAt,
      fingerprint: stableString(item),
    }));
  });

  kept.sort((left, right) => {
    const difference = itemTime(left) - itemTime(right);
    if (difference) return rolling ? difference : -difference;
    return String(left.id).localeCompare(String(right.id));
  });
  return { records: kept, conflicts };
};

const cloneConflictRecord = (collection, record, originalId, fingerprint, detectedAt) => {
  const suffix = stableHash(`${collection}\u0000${originalId}\u0000${fingerprint}`);
  const id = collection === "customDocuments" ? `custom/sync-conflict-${suffix}.md` : `sync-conflict-${suffix}`;
  if (collection === "customDocuments") {
    return { ...record, id, title: `${record.title || "Untitled note"} (recovered conflict)`.slice(0, 180), updatedAt: detectedAt };
  }
  return { ...record, id, updatedAt: detectedAt };
};

const semanticReviewChanged = (left, right) => !equal(
  left && { type: left.type, front: left.front, back: left.back, tags: left.tags, documentId: left.documentId },
  right && { type: right.type, front: right.front, back: right.back, tags: right.tags, documentId: right.documentId },
);

const mergeRecordCollection = (collection, baseItems, localItems, remoteItems, detectedAt) => {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  const order = [...new Set([...local.keys(), ...remote.keys(), ...base.keys()])];
  const records = [];
  const recoveryRecords = [];
  const conflicts = [];

  order.forEach((id) => {
    const baseHas = base.has(id);
    const localHas = local.has(id);
    const remoteHas = remote.has(id);
    const baseItem = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);

    if (!baseHas) {
      if (localHas && remoteHas) {
        if (equal(localItem, remoteItem)) {
          records.push(localItem);
          return;
        }
        const winner = chooseWinner(localItem, remoteItem);
        const loser = winner === localItem ? remoteItem : localItem;
        records.push(winner);
        const shouldClone = collection !== "reviewItems" || semanticReviewChanged(winner, loser);
        if (shouldClone) {
          const clone = cloneConflictRecord(collection, loser, id, stableString(loser), detectedAt);
          recoveryRecords.push(clone);
          conflicts.push(makeConflict({ kind: "concurrent-create", collection, recordId: id, preservedRecordId: clone.id, detectedAt, fingerprint: stableString(loser) }));
        }
        return;
      }
      if (localHas) records.push(localItem);
      else if (remoteHas) records.push(remoteItem);
      return;
    }

    if (!localHas && !remoteHas) return;
    if (!localHas) {
      // Local deleted. Respect it only if the other tab did not modify the
      // record relative to the common base; an edit wins over a deletion.
      if (!equal(remoteItem, baseItem)) {
        records.push(remoteItem);
        conflicts.push(makeConflict({ kind: "delete-vs-update", collection, recordId: id, detectedAt, fingerprint: stableString(remoteItem) }));
      }
      return;
    }
    if (!remoteHas) {
      if (!equal(localItem, baseItem)) {
        records.push(localItem);
        conflicts.push(makeConflict({ kind: "delete-vs-update", collection, recordId: id, detectedAt, fingerprint: stableString(localItem) }));
      }
      return;
    }

    const localChanged = !equal(localItem, baseItem);
    const remoteChanged = !equal(remoteItem, baseItem);
    if (!localChanged) records.push(remoteItem);
    else if (!remoteChanged || equal(localItem, remoteItem)) records.push(localItem);
    else {
      const winner = chooseWinner(localItem, remoteItem);
      const loser = winner === localItem ? remoteItem : localItem;
      records.push(winner);
      const shouldClone = collection !== "reviewItems" || semanticReviewChanged(winner, loser);
      if (shouldClone) {
        const clone = cloneConflictRecord(collection, loser, id, stableString(loser), detectedAt);
        recoveryRecords.push(clone);
        conflicts.push(makeConflict({ kind: "concurrent-update", collection, recordId: id, preservedRecordId: clone.id, detectedAt, fingerprint: stableString(loser) }));
      }
    }
  });

  recoveryRecords.forEach((record) => {
    if (!records.some((item) => item.id === record.id)) records.push(record);
  });
  const ascending = collection === "reviewAttempts" || collection === "aiTutorHistory";
  records.sort((left, right) => {
    const difference = itemTime(left) - itemTime(right);
    if (difference) return ascending ? difference : -difference;
    return String(left.id).localeCompare(String(right.id));
  });
  return enforceRecordCapacity(collection, baseItems, records, conflicts, detectedAt);
};

const mergeMap = (collection, baseValue, localValue, remoteValue, detectedAt, conflictRecovery) => {
  const base = baseValue || {};
  const local = localValue || {};
  const remote = remoteValue || {};
  const result = {};
  const conflicts = [];
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])];

  keys.forEach((key) => {
    const baseHas = hasOwn(base, key);
    const localHas = hasOwn(local, key);
    const remoteHas = hasOwn(remote, key);
    if (!baseHas) {
      if (localHas && remoteHas && !equal(local[key], remote[key])) {
        const winner = chooseWinner({ value: local[key] }, { value: remote[key] }).value;
        const loser = winner === local[key] ? remote[key] : local[key];
        result[key] = winner;
        if (conflictRecovery) conflicts.push(conflictRecovery(key, loser, detectedAt, "concurrent-create"));
      } else if (localHas) result[key] = local[key];
      else if (remoteHas) result[key] = remote[key];
      return;
    }
    if (!localHas && !remoteHas) return;
    if (!localHas) {
      if (!equal(remote[key], base[key])) result[key] = remote[key];
      return;
    }
    if (!remoteHas) {
      if (!equal(local[key], base[key])) result[key] = local[key];
      return;
    }
    const localChanged = !equal(local[key], base[key]);
    const remoteChanged = !equal(remote[key], base[key]);
    if (!localChanged) result[key] = remote[key];
    else if (!remoteChanged || equal(local[key], remote[key])) result[key] = local[key];
    else {
      const winner = chooseWinner({ value: local[key] }, { value: remote[key] }).value;
      const loser = winner === local[key] ? remote[key] : local[key];
      result[key] = winner;
      if (conflictRecovery) conflicts.push(conflictRecovery(key, loser, detectedAt, "concurrent-update"));
    }
  });
  return { value: result, conflicts };
};

const mergeNumericProgress = (base, local, remote) => mergeMap("progress", base, local, remote, "").value;

const mergeMembership = (baseItems, localItems, remoteItems) => {
  const base = new Set(baseItems);
  const local = new Set(localItems);
  const remote = new Set(remoteItems);
  const result = new Set();
  const keys = [...new Set([...local, ...remote, ...base])];
  keys.forEach((key) => {
    const baseHas = base.has(key);
    const localHas = local.has(key);
    const remoteHas = remote.has(key);
    const localChanged = localHas !== baseHas;
    const remoteChanged = remoteHas !== baseHas;
    const keep = !localChanged ? remoteHas : (!remoteChanged ? localHas : localHas || remoteHas);
    if (keep) result.add(key);
  });
  return [...localItems, ...remoteItems, ...baseItems].filter((item, index, list) => result.has(item) && list.indexOf(item) === index);
};

const mergeObjectFields = (base, local, remote) => mergeMap("profile", base, local, remote, "").value;

const mergeReviewSessions = (baseItems, localItems, remoteItems) => {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  return [...new Set([...local.keys(), ...remote.keys(), ...base.keys()])].flatMap((id) => {
    const baseline = base.get(id);
    const left = local.get(id);
    const right = remote.get(id);
    if (!baseline) {
      if (!left) return right ? [right] : [];
      if (!right) return [left];
      if (equal(left, right)) return [left];
      return [{
        ...chooseWinner(left, right),
        newIntroduced: Math.max(0, (left.newIntroduced || 0) + (right.newIntroduced || 0)),
        reviewCompleted: Math.max(0, (left.reviewCompleted || 0) + (right.reviewCompleted || 0)),
        crunchCompleted: Math.max(0, (left.crunchCompleted || 0) + (right.crunchCompleted || 0)),
        reviewedItemIds: [...new Set([...(left.reviewedItemIds || []), ...(right.reviewedItemIds || [])])],
      }];
    }

    if (!left && !right) return [];
    if (!left) return equal(right, baseline) ? [] : [right];
    if (!right) return equal(left, baseline) ? [] : [left];

    const leftChanged = !equal(left, baseline);
    const rightChanged = !equal(right, baseline);
    if (!leftChanged) return [right];
    if (!rightChanged || equal(left, right)) return [left];

    const signedDelta = (key) => Math.max(0,
      (baseline[key] || 0)
      + ((left[key] || 0) - (baseline[key] || 0))
      + ((right[key] || 0) - (baseline[key] || 0)),
    );
    return [{
      ...chooseWinner(left, right),
      newIntroduced: signedDelta("newIntroduced"),
      reviewCompleted: signedDelta("reviewCompleted"),
      crunchCompleted: signedDelta("crunchCompleted"),
      reviewedItemIds: mergeMembership(baseline.reviewedItemIds || [], left.reviewedItemIds || [], right.reviewedItemIds || []),
    }];
  });
};

const REVIEW_SCHEDULE_FIELDS = [
  "dueAt",
  "intervalDays",
  "ease",
  "repetitions",
  "reviewCount",
  "lapses",
  "stability",
  "difficulty",
  "fsrsState",
  "lastReviewedAt",
  "updatedAt",
];

const reviewScheduleSnapshot = (item) => Object.fromEntries(
  REVIEW_SCHEDULE_FIELDS.map((key) => [key, item?.[key]]),
);

const applyReviewSchedule = (item, schedule) => ({
  ...item,
  ...Object.fromEntries(REVIEW_SCHEDULE_FIELDS.map((key) => [key, schedule?.[key]])),
});

// Snapshots and calculated interval fields may legitimately be rewritten by a
// prior reconciliation. These fields identify the immutable review event.
const reviewAttemptEvent = (attempt) => ({
  id: attempt?.id,
  reviewItemId: attempt?.reviewItemId,
  rating: attempt?.rating,
  confidence: attempt?.confidence,
  elapsedMs: attempt?.elapsedMs,
  reviewedAt: attempt?.reviewedAt,
  sessionKind: attempt?.sessionKind,
  sessionKey: attempt?.sessionKey,
  crunch: attempt?.crunch,
});

const compareReviewAttempts = (left, right) => (
  isoTime(left?.reviewedAt) - isoTime(right?.reviewedAt)
  || String(left?.id || "").localeCompare(String(right?.id || ""))
  || stableString(reviewAttemptEvent(left)).localeCompare(stableString(reviewAttemptEvent(right)))
);

const replayReviewAttempt = (item, attempt, scheduling = {}) => {
  const reviewedAt = new Date(isoTime(attempt.reviewedAt));
  const sessionKind = attempt.crunch
    ? "crunch"
    : ((Number(item.reviewCount) || 0) > 0 || item.lastReviewedAt ? "review" : "new");
  const replayed = gradeReviewItem(item, attempt.rating, reviewedAt, attempt.elapsedMs, {
    confidence: attempt.confidence,
    sessionKind,
    sessionKey: attempt.sessionKey,
    crunch: attempt.crunch,
    // Reconciliation must replay under the same scheduler the merged profile
    // uses, or two devices would rebuild different card states.
    scheduler: scheduling.scheduler,
    requestRetention: scheduling.requestRetention,
  });
  return {
    item: replayed.item,
    attempt: {
      ...attempt,
      sessionKind,
      previousDueAt: item.dueAt,
      nextDueAt: replayed.item.dueAt,
      previousIntervalDays: item.intervalDays,
      nextIntervalDays: replayed.item.intervalDays,
      previousState: reviewScheduleSnapshot(item),
    },
  };
};

/**
 * A review card is denormalized state derived from its ordered attempt stream.
 * Generic last-writer-wins is therefore invalid when two tabs grade the same
 * card. Replay every unique attempt delta onto the common base, and rewrite
 * the new attempts' undo snapshots to match that deterministic order.
 */
const reconcileReviewAttemptDeltas = (baseItems, mergedItems, baseAttempts, mergedAttempts, ignoredRemovedAttemptIds = new Set()) => {
  const baseItemsById = new Map(baseItems.map((item) => [item.id, item]));
  const mergedItemsById = new Map(mergedItems.map((item) => [item.id, item]));
  const baseAttemptsById = new Map(baseAttempts.map((attempt) => [attempt.id, attempt]));
  const mergedAttemptsById = new Map(mergedAttempts.map((attempt) => [attempt.id, attempt]));
  const changedCardIds = new Set();

  baseAttempts.forEach((attempt) => {
    const merged = mergedAttemptsById.get(attempt.id);
    if ((!merged && !ignoredRemovedAttemptIds.has(attempt.id)) || (merged && !equal(reviewAttemptEvent(attempt), reviewAttemptEvent(merged)))) {
      changedCardIds.add(attempt.reviewItemId);
    }
  });
  mergedAttempts.forEach((attempt) => {
    const baseline = baseAttemptsById.get(attempt.id);
    if (!baseline || !equal(reviewAttemptEvent(baseline), reviewAttemptEvent(attempt))) changedCardIds.add(attempt.reviewItemId);
  });

  if (!changedCardIds.size) return { items: mergedItems, attempts: mergedAttempts };

  const reconciledAttempts = new Map(mergedAttempts.map((attempt) => [attempt.id, attempt]));
  changedCardIds.forEach((cardId) => {
    const mergedItem = mergedItemsById.get(cardId);
    if (!mergedItem) return;
    const baseItem = baseItemsById.get(cardId);
    const removed = baseAttempts
      .filter((attempt) => {
        if (attempt.reviewItemId !== cardId) return false;
        const merged = mergedAttemptsById.get(attempt.id);
        return (!merged && !ignoredRemovedAttemptIds.has(attempt.id)) || (merged && !equal(reviewAttemptEvent(attempt), reviewAttemptEvent(merged)));
      })
      .sort(compareReviewAttempts)
      .reverse();
    const additions = mergedAttempts
      .filter((attempt) => {
        if (attempt.reviewItemId !== cardId) return false;
        const baseline = baseAttemptsById.get(attempt.id);
        return !baseline || !equal(reviewAttemptEvent(baseline), reviewAttemptEvent(attempt));
      })
      .sort(compareReviewAttempts);

    let cursor;
    if (baseItem) {
      cursor = applyReviewSchedule(mergedItem, baseItem);
    } else {
      const initialSnapshot = additions.find((attempt) => attempt.previousState)?.previousState;
      cursor = initialSnapshot ? applyReviewSchedule(mergedItem, initialSnapshot) : mergedItem;
    }

    removed.forEach((attempt) => {
      if (attempt.previousState) cursor = applyReviewSchedule(cursor, attempt.previousState);
    });
    additions.forEach((attempt) => {
      const result = replayReviewAttempt(cursor, attempt);
      cursor = result.item;
      reconciledAttempts.set(attempt.id, result.attempt);
    });

    // Preserve any later semantic edit timestamp while keeping the schedule
    // and last-review timestamps produced by replay.
    const schedule = reviewScheduleSnapshot(cursor);
    schedule.updatedAt = isoTime(mergedItem.updatedAt) > isoTime(schedule.updatedAt) ? mergedItem.updatedAt : schedule.updatedAt;
    mergedItemsById.set(cardId, applyReviewSchedule(mergedItem, schedule));
  });

  const items = mergedItems.map((item) => mergedItemsById.get(item.id) || item);
  const attempts = mergedAttempts
    .map((attempt) => reconciledAttempts.get(attempt.id) || attempt)
    .sort(compareReviewAttempts);
  return { items, attempts };
};

const sessionCounterField = (attempt) => (
  attempt.sessionKind === "new"
    ? "newIntroduced"
    : attempt.sessionKind === "crunch" ? "crunchCompleted" : "reviewCompleted"
);

const reconcileReviewSessionCounters = (baseSessions, mergedSessions, baseAttempts, mergedAttempts, ignoredRemovedAttemptIds = new Set()) => {
  const baseAttemptsById = new Map(baseAttempts.map((attempt) => [attempt.id, attempt]));
  const mergedAttemptsById = new Map(mergedAttempts.map((attempt) => [attempt.id, attempt]));
  const deltas = new Map();
  const addDelta = (attempt, direction) => {
    if (!attempt?.sessionKey) return;
    const current = deltas.get(attempt.sessionKey) || { newIntroduced: 0, reviewCompleted: 0, crunchCompleted: 0 };
    current[sessionCounterField(attempt)] += direction;
    deltas.set(attempt.sessionKey, current);
  };

  baseAttempts.forEach((attempt) => {
    const merged = mergedAttemptsById.get(attempt.id);
    if ((!merged && !ignoredRemovedAttemptIds.has(attempt.id)) || (merged && !equal(reviewAttemptEvent(attempt), reviewAttemptEvent(merged)))) addDelta(attempt, -1);
  });
  mergedAttempts.forEach((attempt) => {
    const baseline = baseAttemptsById.get(attempt.id);
    if (!baseline || !equal(reviewAttemptEvent(baseline), reviewAttemptEvent(attempt))) addDelta(attempt, 1);
  });
  if (!deltas.size) return mergedSessions;

  const baseById = new Map(baseSessions.map((session) => [session.id, session]));
  return mergedSessions.map((session) => {
    const delta = deltas.get(session.id);
    if (!delta) return session;
    const baseline = baseById.get(session.id) || {};
    return {
      ...session,
      newIntroduced: Math.max(0, (Number(baseline.newIntroduced) || 0) + delta.newIntroduced),
      reviewCompleted: Math.max(0, (Number(baseline.reviewCompleted) || 0) + delta.reviewCompleted),
      crunchCompleted: Math.max(0, (Number(baseline.crunchCompleted) || 0) + delta.crunchCompleted),
    };
  });
};

const reviewHistoryRolloverIds = (baseAttempts, mergedAttempts, attemptConflicts) => {
  const rolledOff = new Set(attemptConflicts
    .filter((conflict) => conflict.kind === "history-rollover")
    .map((conflict) => conflict.recordId));
  const limit = RECORD_COLLECTION_LIMITS.reviewAttempts;
  if (baseAttempts.length < limit) return rolledOff;

  const mergedIds = new Set(mergedAttempts.map((attempt) => attempt.id));
  const baseIds = new Set(baseAttempts.map((attempt) => attempt.id));
  const additions = mergedAttempts.reduce((count, attempt) => count + (baseIds.has(attempt.id) ? 0 : 1), 0);
  if (!additions) return rolledOff;

  // App writes keep the newest 50,000 attempts. Therefore base attempts that
  // disappear as an oldest prefix while new attempts arrive are retention
  // rollover, not user undo. Excluding them from replay prevents an ancient
  // undo snapshot from resetting the current card schedule.
  let inferred = 0;
  for (const attempt of baseAttempts) {
    if (mergedIds.has(attempt.id) || inferred >= additions) break;
    rolledOff.add(attempt.id);
    inferred += 1;
  }
  return rolledOff;
};

const recoverStringConflict = (collection, recoveryDocuments, conflicts) => (key, loser, detectedAt, kind) => {
  const fingerprint = `${collection}\u0000${key}\u0000${loser}`;
  const id = `custom/sync-conflict-${stableHash(fingerprint)}.md`;
  recoveryDocuments.push({
    id,
    title: `Recovered ${collection === "personalNotes" ? "personal note" : "lecture edit"} conflict`,
    raw: `# Recovered conflict\n\nSource record: ${key}\n\n${String(loser)}`,
    tags: ["recovered", "sync-conflict"],
    createdAt: detectedAt,
    updatedAt: detectedAt,
  });
  return makeConflict({ kind, collection, recordId: key, preservedRecordId: id, detectedAt, fingerprint });
};

/**
 * Three-way, record-aware profile merge.
 *
 * `base` is the last snapshot observed by this tab, `local` is its current
 * state, and `remote` is the latest value read inside the IndexedDB write
 * transaction. Unique IDs are unioned. Deletes apply only when the other side
 * stayed unchanged; a concurrent edit is preserved. Same-ID content conflicts
 * create visible recovered copies instead of silently discarding either text.
 */
export const mergeProfileVersions = (baseValue, localValue, remoteValue, options = {}) => {
  const base = normalizeProfile(baseValue);
  const local = normalizeProfile(localValue);
  const remote = normalizeProfile(remoteValue);
  const detectedAt = options.now || new Date().toISOString();
  const advanceRevision = options.advanceRevision !== false;
  const conflicts = [];

  if (local.syncMeta.generation !== remote.syncMeta.generation) {
    const authoritative = isProfileReplacementNewer(local, remote) ? local : remote;
    const maximumRevision = Math.max(authoritative.syncMeta.revision, base.syncMeta.revision);
    return {
      profile: normalizeProfile({
        ...authoritative,
        syncMeta: {
          ...authoritative.syncMeta,
          revision: advanceRevision ? Math.min(Number.MAX_SAFE_INTEGER, maximumRevision + 1) : authoritative.syncMeta.revision,
          updatedAt: advanceRevision ? detectedAt : authoritative.syncMeta.updatedAt,
          writerId: advanceRevision ? (options.writerId || authoritative.syncMeta.writerId) : authoritative.syncMeta.writerId,
        },
      }),
      conflicts: [],
      replacementApplied: true,
    };
  }

  const custom = mergeRecordCollection("customDocuments", base.customDocuments, local.customDocuments, remote.customDocuments, detectedAt);
  const deletedCustomDocumentIds = [...new Set([
    ...(base.deletedCustomDocumentIds || []),
    ...(local.deletedCustomDocumentIds || []),
    ...(remote.deletedCustomDocumentIds || []),
  ])].slice(-1_000).sort();
  const deletedCustomDocumentIdSet = new Set(deletedCustomDocumentIds);
  const clippings = mergeRecordCollection("clippings", base.clippings, local.clippings, remote.clippings, detectedAt);
  const annotations = mergeRecordCollection("annotations", base.annotations, local.annotations, remote.annotations, detectedAt);
  const mistakes = mergeRecordCollection("mistakes", base.mistakes || [], local.mistakes || [], remote.mistakes || [], detectedAt);
  const collectionsMerge = mergeRecordCollection("collections", base.collections || [], local.collections || [], remote.collections || [], detectedAt);
  const trashMerge = mergeRecordCollection("trash", base.trash || [], local.trash || [], remote.trash || [], detectedAt);
  const activityMerge = mergeRecordCollection("activity", base.activity || [], local.activity || [], remote.activity || [], detectedAt);
  const revisionsMerge = mergeRecordCollection("revisions", base.revisions || [], local.revisions || [], remote.revisions || [], detectedAt);
  const assessmentsMerge = mergeRecordCollection("assessments", base.assessments || [], local.assessments || [], remote.assessments || [], detectedAt);
  const reviewItems = mergeRecordCollection("reviewItems", base.reviewItems, local.reviewItems, remote.reviewItems, detectedAt);
  const attempts = mergeRecordCollection("reviewAttempts", base.reviewAttempts, local.reviewAttempts, remote.reviewAttempts, detectedAt);
  const aiTutorHistoryTombstones = [...new Set([
    ...(base.aiTutorHistoryTombstones || []),
    ...(local.aiTutorHistoryTombstones || []),
    ...(remote.aiTutorHistoryTombstones || []),
  ])].sort();
  const aiTutorHistoryTombstoneSet = new Set(aiTutorHistoryTombstones);
  const withoutClearedAiMessages = (items) => items.filter((message) => !aiTutorHistoryTombstoneSet.has(message.id));
  const aiHistory = mergeRecordCollection(
    "aiTutorHistory",
    withoutClearedAiMessages(base.aiTutorHistory),
    withoutClearedAiMessages(local.aiTutorHistory),
    withoutClearedAiMessages(remote.aiTutorHistory),
    detectedAt,
  );
  conflicts.push(...custom.conflicts, ...clippings.conflicts, ...annotations.conflicts, ...mistakes.conflicts, ...collectionsMerge.conflicts, ...trashMerge.conflicts, ...activityMerge.conflicts, ...revisionsMerge.conflicts, ...assessmentsMerge.conflicts, ...reviewItems.conflicts, ...attempts.conflicts, ...aiHistory.conflicts);

  const recoveryDocuments = [];
  const personalNotes = mergeMap("personalNotes", base.personalNotes, local.personalNotes, remote.personalNotes, detectedAt, recoverStringConflict("personalNotes", recoveryDocuments, conflicts));
  const edits = mergeMap("edits", base.edits, local.edits, remote.edits, detectedAt, recoverStringConflict("edits", recoveryDocuments, conflicts));
  conflicts.push(...personalNotes.conflicts, ...edits.conflicts);

  let customDocuments = custom.records.filter((record) => !deletedCustomDocumentIdSet.has(record.id));
  recoveryDocuments.forEach((record) => {
    if (!customDocuments.some((item) => item.id === record.id)) customDocuments.push(record);
  });
  const finalCustomCapacity = enforceRecordCapacity("customDocuments", base.customDocuments, customDocuments, conflicts, detectedAt);
  customDocuments = finalCustomCapacity.records;
  conflicts.length = 0;
  conflicts.push(...finalCustomCapacity.conflicts);

  const rolledOffAttemptIds = reviewHistoryRolloverIds(base.reviewAttempts, attempts.records, attempts.conflicts);
  const mergedReviewSettings = mergeObjectFields(base.reviewSettings, local.reviewSettings, remote.reviewSettings);
  const reconciledReviews = reconcileReviewAttemptDeltas(
    base.reviewItems,
    reviewItems.records,
    base.reviewAttempts,
    attempts.records,
    rolledOffAttemptIds,
    { scheduler: mergedReviewSettings.scheduler, requestRetention: mergedReviewSettings.requestRetention },
  );
  const reconciledReviewSessions = reconcileReviewSessionCounters(
    base.reviewSessions,
    mergeReviewSessions(base.reviewSessions, local.reviewSessions, remote.reviewSessions),
    base.reviewAttempts,
    reconciledReviews.attempts,
    rolledOffAttemptIds,
  );

  const maximumRevision = Math.max(base.syncMeta.revision, local.syncMeta.revision, remote.syncMeta.revision);
  const profile = normalizeProfile({
    ...remote,
    version: remote.version,
    syncMeta: {
      revision: advanceRevision ? Math.min(Number.MAX_SAFE_INTEGER, maximumRevision + 1) : maximumRevision,
      updatedAt: advanceRevision ? detectedAt : [base.syncMeta.updatedAt, local.syncMeta.updatedAt, remote.syncMeta.updatedAt].sort().at(-1),
      writerId: advanceRevision ? (options.writerId || "") : (remote.syncMeta.writerId || local.syncMeta.writerId),
      generation: remote.syncMeta.generation || local.syncMeta.generation,
      replacedAt: remote.syncMeta.replacedAt || local.syncMeta.replacedAt,
      replacementReason: remote.syncMeta.replacementReason || local.syncMeta.replacementReason,
      conflicts: mergeConflictHistory(base.syncMeta.conflicts, local.syncMeta.conflicts, remote.syncMeta.conflicts, conflicts),
    },
    customDocuments,
    deletedCustomDocumentIds,
    clippings: clippings.records,
    mistakes: mistakes.records,
    collections: collectionsMerge.records,
    trash: trashMerge.records,
    activity: activityMerge.records,
    revisions: revisionsMerge.records,
    assessments: assessmentsMerge.records,
    goals: mergeObjectFields(base.goals, local.goals, remote.goals),
    annotations: annotations.records,
    reviewItems: reconciledReviews.items,
    reviewAttempts: reconciledReviews.attempts,
    reviewSessions: reconciledReviewSessions,
    aiTutorHistory: aiHistory.records,
    aiTutorHistoryTombstones,
    progress: mergeNumericProgress(base.progress, local.progress, remote.progress),
    readingPositions: mergeNumericProgress(base.readingPositions, local.readingPositions, remote.readingPositions),
    personalNotes: personalNotes.value,
    edits: edits.value,
    bookmarks: mergeMembership(base.bookmarks, local.bookmarks, remote.bookmarks),
    recent: mergeMembership(base.recent, local.recent, remote.recent).slice(0, 50),
    settings: mergeObjectFields(base.settings, local.settings, remote.settings),
    reviewSettings: mergedReviewSettings,
    backupMeta: mergeObjectFields(base.backupMeta, local.backupMeta, remote.backupMeta),
    lastDocumentId: mergeObjectFields({ value: base.lastDocumentId }, { value: local.lastDocumentId }, { value: remote.lastDocumentId }).value,
  });

  return { profile, conflicts };
};

export const profilePayloadEqual = (left, right) => {
  if (left === right) return true;
  const strip = (profile) => {
    const { syncMeta: _ignored, ...payload } = profile || {};
    return payload;
  };
  return equal(strip(left), strip(right));
};
