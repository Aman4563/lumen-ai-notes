import assert from "node:assert/strict";
import test from "node:test";
import { initialProfile, normalizeProfile } from "./db.js";
import { isProfileReplacementNewer, mergeProfileVersions, prepareProfileReplacement } from "./profileSync.js";
import { gradeReviewItem, recordReviewUsage, restoreReviewItemFromAttempt, reverseReviewUsage } from "./review.js";

const NOW = "2026-08-23T10:00:00.000Z";
const earlier = "2026-08-23T09:00:00.000Z";
const later = "2026-08-23T09:30:00.000Z";

const documentRecord = (id, title, raw, updatedAt = earlier) => ({
  id,
  title,
  raw,
  tags: [],
  createdAt: earlier,
  updatedAt,
});

const annotationRecord = (id, quote) => ({
  id,
  documentId: "notes/00-roadmap.md",
  quote,
  start: 0,
  end: quote.length,
  color: "gold",
  purpose: "important",
  comment: "",
  tags: [],
  createdAt: earlier,
  updatedAt: earlier,
});

const reviewRecord = (id, front) => ({
  id,
  type: "basic",
  front,
  back: `Answer for ${front}`,
  documentId: "notes/00-roadmap.md",
  tags: [],
  dueAt: earlier,
  createdAt: earlier,
  updatedAt: earlier,
});

const gradeProfile = (profileValue, id, rating, reviewedAt, attemptId) => {
  const profile = normalizeProfile(profileValue);
  const item = profile.reviewItems.find((candidate) => candidate.id === id);
  const now = new Date(reviewedAt);
  const usage = recordReviewUsage(profile.reviewSessions, item, now, { timeZone: "Asia/Kolkata" });
  const result = gradeReviewItem(item, rating, now, 1_250, {
    confidence: 4,
    sessionKind: usage.kind,
    sessionKey: usage.sessionKey,
  });
  return normalizeProfile({
    ...profile,
    reviewItems: profile.reviewItems.map((candidate) => candidate.id === id ? result.item : candidate),
    reviewAttempts: [...profile.reviewAttempts, { ...result.attempt, id: attemptId }],
    reviewSessions: usage.sessions,
  });
};

const undoLastGrade = (profileValue) => {
  const profile = normalizeProfile(profileValue);
  const attempt = profile.reviewAttempts.at(-1);
  return normalizeProfile({
    ...profile,
    reviewItems: profile.reviewItems.map((item) => item.id === attempt.reviewItemId ? restoreReviewItemFromAttempt(item, attempt) : item),
    reviewAttempts: profile.reviewAttempts.slice(0, -1),
    reviewSessions: reverseReviewUsage(profile.reviewSessions, attempt),
  });
};

const reviewMergeProjection = (profile) => ({
  items: profile.reviewItems,
  attempts: profile.reviewAttempts,
  sessions: profile.reviewSessions,
});

test("two serialized tab writes union concurrent unique learning records", () => {
  const base = normalizeProfile(initialProfile);
  const tabA = normalizeProfile({
    ...base,
    customDocuments: [documentRecord("custom/a.md", "A", "# A")],
    annotations: [annotationRecord("annotation-a", "A quote")],
    reviewItems: [reviewRecord("review-a", "A prompt")],
  });
  const tabB = normalizeProfile({
    ...base,
    customDocuments: [documentRecord("custom/b.md", "B", "# B")],
    annotations: [annotationRecord("annotation-b", "B quote")],
    reviewItems: [reviewRecord("review-b", "B prompt")],
  });

  const firstCommit = mergeProfileVersions(base, tabA, base, { now: NOW, writerId: "tab-a" }).profile;
  const secondCommit = mergeProfileVersions(base, tabB, firstCommit, { now: NOW, writerId: "tab-b" }).profile;

  assert.deepEqual(new Set(secondCommit.customDocuments.map((item) => item.id)), new Set(["custom/a.md", "custom/b.md"]));
  assert.deepEqual(new Set(secondCommit.annotations.map((item) => item.id)), new Set(["annotation-a", "annotation-b"]));
  assert.deepEqual(new Set(secondCommit.reviewItems.map((item) => item.id)), new Set(["review-a", "review-b"]));
  assert.equal(secondCommit.syncMeta.revision, 2);
});

test("an uncontested deletion persists", () => {
  const record = documentRecord("custom/delete.md", "Delete me", "# Delete me");
  const base = normalizeProfile({ ...initialProfile, customDocuments: [record] });
  const local = normalizeProfile({ ...base, customDocuments: [] });
  const merged = mergeProfileVersions(base, local, base, { now: NOW }).profile;
  assert.equal(merged.customDocuments.length, 0);
});

test("a concurrent edit wins over a deletion and records the decision", () => {
  const original = documentRecord("custom/conflict.md", "Original", "# Original");
  const updated = documentRecord("custom/conflict.md", "Updated", "# Updated safely", later);
  const base = normalizeProfile({ ...initialProfile, customDocuments: [original] });
  const localDeletion = normalizeProfile({ ...base, customDocuments: [] });
  const remoteEdit = normalizeProfile({ ...base, customDocuments: [updated] });
  const result = mergeProfileVersions(base, localDeletion, remoteEdit, { now: NOW });

  assert.equal(result.profile.customDocuments[0].raw, "# Updated safely");
  assert.equal(result.conflicts[0].kind, "delete-vs-update");
  assert.equal(result.profile.syncMeta.conflicts[0].kind, "delete-vs-update");
});

test("an explicit custom-document deletion tombstone defeats a stale edit and prevents private board resurrection guards", () => {
  const original = documentRecord("custom/private.md", "Private", "# Private");
  const base = normalizeProfile({ ...initialProfile, customDocuments: [original] });
  const deletingTab = normalizeProfile({
    ...base,
    customDocuments: [],
    deletedCustomDocumentIds: [original.id],
  });
  const staleEditingTab = normalizeProfile({
    ...base,
    customDocuments: [{ ...original, raw: "# Stale private edit", updatedAt: later }],
  });
  const merged = mergeProfileVersions(base, deletingTab, staleEditingTab, { now: NOW }).profile;

  assert.equal(merged.customDocuments.some((document) => document.id === original.id), false);
  assert.deepEqual(merged.deletedCustomDocumentIds, [original.id]);
});

test("same-ID note edits preserve the losing text as a visible recovered document", () => {
  const original = documentRecord("custom/shared.md", "Shared", "# Original");
  const editA = documentRecord("custom/shared.md", "Shared A", "# Text from A", later);
  const editB = documentRecord("custom/shared.md", "Shared B", "# Text from B", NOW);
  const base = normalizeProfile({ ...initialProfile, customDocuments: [original] });
  const result = mergeProfileVersions(
    base,
    normalizeProfile({ ...base, customDocuments: [editA] }),
    normalizeProfile({ ...base, customDocuments: [editB] }),
    { now: NOW },
  );

  assert.equal(result.profile.customDocuments.length, 2);
  assert.ok(result.profile.customDocuments.some((item) => item.raw === "# Text from A"));
  assert.ok(result.profile.customDocuments.some((item) => item.raw === "# Text from B"));
  assert.ok(result.profile.customDocuments.some((item) => item.id.startsWith("custom/sync-conflict-")));
});

test("same-source personal-note conflicts create a readable recovery document", () => {
  const base = normalizeProfile({ ...initialProfile, personalNotes: { "notes/00-roadmap.md": "Base text" } });
  const local = normalizeProfile({ ...base, personalNotes: { "notes/00-roadmap.md": "Local thought" } });
  const remote = normalizeProfile({ ...base, personalNotes: { "notes/00-roadmap.md": "Remote thought" } });
  const result = mergeProfileVersions(base, local, remote, { now: NOW });

  const values = [result.profile.personalNotes["notes/00-roadmap.md"], ...result.profile.customDocuments.map((item) => item.raw)];
  assert.ok(values.some((value) => value.includes("Local thought")));
  assert.ok(values.some((value) => value.includes("Remote thought")));
});

test("concurrent review usage adds independent deltas and unions reviewed IDs", () => {
  const session = {
    id: "2026-08-23@Asia/Kolkata",
    localDate: "2026-08-23",
    timeZone: "Asia/Kolkata",
    newIntroduced: 0,
    reviewCompleted: 3,
    crunchCompleted: 0,
    reviewedItemIds: [],
    createdAt: earlier,
    updatedAt: earlier,
  };
  const cards = [reviewRecord("r-a", "A"), reviewRecord("r-b", "B")];
  const base = normalizeProfile({ ...initialProfile, reviewItems: cards, reviewSessions: [session] });
  const local = normalizeProfile({ ...base, reviewSessions: [{ ...session, reviewCompleted: 4, reviewedItemIds: ["r-a"], updatedAt: later }] });
  const remote = normalizeProfile({ ...base, reviewSessions: [{ ...session, reviewCompleted: 4, reviewedItemIds: ["r-b"], updatedAt: NOW }] });
  const merged = mergeProfileVersions(base, local, remote, { now: NOW }).profile.reviewSessions[0];

  assert.equal(merged.reviewCompleted, 5);
  assert.deepEqual(new Set(merged.reviewedItemIds), new Set(["r-a", "r-b"]));
});

test("review-session undo decreases persist and concurrent signed deltas reconcile", () => {
  const cards = [reviewRecord("r-a", "A"), reviewRecord("r-b", "B")];
  const session = {
    id: "2026-08-23@Asia/Kolkata",
    localDate: "2026-08-23",
    timeZone: "Asia/Kolkata",
    newIntroduced: 0,
    reviewCompleted: 1,
    crunchCompleted: 0,
    reviewedItemIds: ["r-a"],
    createdAt: earlier,
    updatedAt: earlier,
  };
  const base = normalizeProfile({ ...initialProfile, reviewItems: cards, reviewSessions: [session] });
  const undone = normalizeProfile({ ...base, reviewSessions: [{ ...session, reviewCompleted: 0, reviewedItemIds: [], updatedAt: later }] });
  const remoteUnchanged = normalizeProfile(base);
  const singleUndo = mergeProfileVersions(base, undone, remoteUnchanged, { now: NOW }).profile.reviewSessions[0];
  assert.equal(singleUndo.reviewCompleted, 0);
  assert.deepEqual(singleUndo.reviewedItemIds, []);

  const remoteReview = normalizeProfile({ ...base, reviewSessions: [{ ...session, reviewCompleted: 2, reviewedItemIds: ["r-a", "r-b"], updatedAt: NOW }] });
  const concurrent = mergeProfileVersions(base, undone, remoteReview, { now: NOW }).profile.reviewSessions[0];
  assert.equal(concurrent.reviewCompleted, 1, "base 1 - one undo + one review should remain 1");
  assert.deepEqual(concurrent.reviewedItemIds, ["r-b"]);
});

test("concurrent grades on one card replay both attempts and converge in either merge order", () => {
  const card = reviewRecord("shared-review", "Shared card");
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  const tabA = gradeProfile(base, card.id, "hard", later, "attempt-a");
  const tabB = gradeProfile(base, card.id, "easy", later, "attempt-b");

  const leftFirst = mergeProfileVersions(base, tabA, tabB, { now: NOW, advanceRevision: false }).profile;
  const rightFirst = mergeProfileVersions(base, tabB, tabA, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(leftFirst), reviewMergeProjection(rightFirst));

  const mergedCard = leftFirst.reviewItems[0];
  const [first, second] = leftFirst.reviewAttempts;
  assert.equal(mergedCard.reviewCount, 2);
  assert.equal(leftFirst.reviewAttempts.length, 2);
  assert.equal(first.id, "attempt-a", "same-time attempts use ID as the stable replay tie-breaker");
  assert.equal(first.previousState.reviewCount, 0);
  assert.equal(second.previousState.reviewCount, 1);
  assert.equal(second.previousState.dueAt, first.nextDueAt);
  assert.equal(second.nextDueAt, mergedCard.dueAt);
  assert.equal(leftFirst.reviewSessions[0].newIntroduced, 1);
  assert.equal(leftFirst.reviewSessions[0].reviewCompleted, 1);
});

test("same attempt ID and timestamp collision preserves both review events deterministically", () => {
  const card = reviewRecord("collision-review", "Collision card");
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  const tabA = gradeProfile(base, card.id, "hard", later, "attempt-collision");
  const tabB = gradeProfile(base, card.id, "easy", later, "attempt-collision");

  const leftFirst = mergeProfileVersions(base, tabA, tabB, { now: NOW, advanceRevision: false }).profile;
  const rightFirst = mergeProfileVersions(base, tabB, tabA, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(leftFirst), reviewMergeProjection(rightFirst));
  assert.equal(leftFirst.reviewItems[0].reviewCount, 2);
  assert.equal(leftFirst.reviewAttempts.length, 2);
  assert.equal(new Set(leftFirst.reviewAttempts.map((attempt) => attempt.id)).size, 2);
  assert.ok(leftFirst.reviewAttempts.some((attempt) => attempt.id.startsWith("sync-conflict-")));
  assert.ok(leftFirst.syncMeta.conflicts.some((conflict) => conflict.collection === "reviewAttempts" && conflict.kind === "concurrent-create"));
});

test("concurrent undo and grade rebuild a coherent card and reversible attempt snapshot", () => {
  const card = reviewRecord("undo-review", "Undo card");
  const pristine = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  const base = gradeProfile(pristine, card.id, "good", earlier, "attempt-base");
  const tabUndo = undoLastGrade(base);
  const tabGrade = gradeProfile(base, card.id, "easy", later, "attempt-new");

  const merged = mergeProfileVersions(base, tabUndo, tabGrade, { now: NOW, advanceRevision: false }).profile;
  const reverseOrder = mergeProfileVersions(base, tabGrade, tabUndo, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(merged), reviewMergeProjection(reverseOrder));
  assert.deepEqual(merged.reviewAttempts.map((attempt) => attempt.id), ["attempt-new"]);
  assert.equal(merged.reviewItems[0].reviewCount, 1);
  assert.equal(merged.reviewAttempts[0].previousState.reviewCount, 0);
  assert.equal(merged.reviewSessions[0].newIntroduced, 1);
  const restored = restoreReviewItemFromAttempt(merged.reviewItems[0], merged.reviewAttempts[0]);
  assert.equal(restored.reviewCount, 0);
  assert.equal(restored.dueAt, pristine.reviewItems[0].dueAt);
});

test("an ordinary single-tab grade and undo keep their exact schedule semantics", () => {
  const card = reviewRecord("ordinary-review", "Ordinary card");
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card] });
  const graded = gradeProfile(base, card.id, "good", later, "attempt-only");
  const mergedGrade = mergeProfileVersions(base, graded, base, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(mergedGrade), reviewMergeProjection(graded));

  const undone = undoLastGrade(graded);
  const mergedUndo = mergeProfileVersions(graded, undone, graded, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(reviewMergeProjection(mergedUndo), reviewMergeProjection(undone));
});

test("rolling review-attempt retention never replays an expired oldest snapshot as an undo", () => {
  const card = {
    ...reviewRecord("full-history-review", "Full history card"),
    dueAt: NOW,
    intervalDays: 30,
    ease: 2.5,
    repetitions: 100,
    reviewCount: 50_000,
    lapses: 4,
    lastReviewedAt: earlier,
    updatedAt: earlier,
  };
  const attempts = Array.from({ length: 50_000 }, (_, index) => ({
    id: `old-attempt-${String(index).padStart(5, "0")}`,
    reviewItemId: card.id,
    rating: "good",
    confidence: 3,
    elapsedMs: 500,
    reviewedAt: earlier,
    previousDueAt: earlier,
    nextDueAt: NOW,
    previousIntervalDays: 29,
    nextIntervalDays: 30,
    previousState: index === 49_999 ? {
      dueAt: earlier,
      intervalDays: 29,
      ease: 2.5,
      repetitions: 99,
      reviewCount: 49_999,
      lapses: 4,
      lastReviewedAt: earlier,
      updatedAt: earlier,
    } : null,
    sessionKind: "review",
    sessionKey: "",
    crunch: false,
  }));
  const base = normalizeProfile({ ...initialProfile, reviewItems: [card], reviewAttempts: attempts });
  const local = gradeProfile(base, card.id, "good", later, "new-attempt");
  const merged = mergeProfileVersions(base, local, base, { now: NOW, advanceRevision: false }).profile;

  assert.equal(merged.reviewAttempts.length, 50_000);
  assert.equal(merged.reviewAttempts.some((attempt) => attempt.id === "old-attempt-00000"), false);
  assert.equal(merged.reviewAttempts.some((attempt) => attempt.id === "new-attempt"), true);
  assert.equal(merged.reviewItems[0].reviewCount, 50_001);
  assert.equal(merged.reviewSessions[0].reviewCompleted, 1);

  const concurrentUndo = undoLastGrade(base);
  const undoAndGrade = mergeProfileVersions(base, concurrentUndo, local, { now: NOW, advanceRevision: false }).profile;
  const replayedAttempt = undoAndGrade.reviewAttempts.find((attempt) => attempt.id === "new-attempt");
  assert.equal(undoAndGrade.reviewItems[0].reviewCount, 50_000);
  assert.equal(undoAndGrade.reviewAttempts.length, 49_999);
  assert.equal(replayedAttempt.previousState.reviewCount, 49_999);
});

test("a 499-document base never silently loses an existing note when two tabs fill the last slot", () => {
  const documents = Array.from({ length: 499 }, (_, index) => documentRecord(
    `custom/base-${String(index).padStart(3, "0")}.md`,
    `Base ${index}`,
    `# Base ${index}`,
  ));
  const base = normalizeProfile({ ...initialProfile, customDocuments: documents });
  const tabA = normalizeProfile({ ...base, customDocuments: [...base.customDocuments, documentRecord("custom/a.md", "A", "# A", NOW)] });
  const tabB = normalizeProfile({ ...base, customDocuments: [...base.customDocuments, documentRecord("custom/b.md", "B", "# B", NOW)] });
  const leftFirst = mergeProfileVersions(base, tabA, tabB, { now: NOW, advanceRevision: false }).profile;
  const rightFirst = mergeProfileVersions(base, tabB, tabA, { now: NOW, advanceRevision: false }).profile;

  assert.equal(leftFirst.customDocuments.length, 500);
  assert.ok(documents.every((document) => leftFirst.customDocuments.some((candidate) => candidate.id === document.id)));
  assert.deepEqual(leftFirst.customDocuments.map((item) => item.id), rightFirst.customDocuments.map((item) => item.id));
  const overflow = leftFirst.syncMeta.conflicts.find((conflict) => conflict.collection === "customDocuments" && conflict.kind === "capacity-overflow");
  assert.ok(overflow, "the concurrent addition that cannot fit must be visible in sync metadata");
  assert.ok(["custom/a.md", "custom/b.md"].includes(overflow.recordId));
  assert.equal(overflow.preservedRecordId, "");
});

test("front-capped durable collections protect base records and report concurrent overflow", () => {
  const cases = [
    {
      collection: "clippings",
      limit: 2_000,
      make: (id) => ({ id, documentId: "notes/00-roadmap.md", text: `Clip ${id}`, note: "", createdAt: earlier, updatedAt: earlier }),
    },
    {
      collection: "annotations",
      limit: 5_000,
      make: (id) => annotationRecord(id, `Quote ${id}`),
    },
    {
      collection: "reviewItems",
      limit: 10_000,
      make: (id) => reviewRecord(id, `Prompt ${id}`),
    },
  ];

  for (const { collection, limit, make } of cases) {
    const baseRecords = Array.from({ length: limit - 1 }, (_, index) => make(`base-${index}`));
    const base = normalizeProfile({ ...initialProfile, [collection]: baseRecords });
    const tabA = normalizeProfile({ ...base, [collection]: [...base[collection], { ...make("addition-a"), updatedAt: NOW }] });
    const tabB = normalizeProfile({ ...base, [collection]: [...base[collection], { ...make("addition-b"), updatedAt: NOW }] });
    const merged = mergeProfileVersions(base, tabA, tabB, { now: NOW, advanceRevision: false }).profile;
    assert.equal(merged[collection].length, limit, collection);
    assert.ok(baseRecords.every((record) => merged[collection].some((candidate) => candidate.id === record.id)), `${collection} displaced a base record`);
    assert.ok(merged.syncMeta.conflicts.some((conflict) => conflict.collection === collection && conflict.kind === "capacity-overflow"), `${collection} overflow was silent`);
  }
});

test("rolling AI history keeps the deterministic newest window and reports rollover", () => {
  const history = Array.from({ length: 49 }, (_, index) => ({
    id: `history-${String(index).padStart(2, "0")}`,
    role: index % 2 ? "assistant" : "user",
    content: `History ${index}`,
    mode: "explain",
    createdAt: new Date(Date.parse(earlier) + index * 1_000).toISOString(),
  }));
  const base = normalizeProfile({ ...initialProfile, aiTutorHistory: history });
  const tabA = normalizeProfile({ ...base, aiTutorHistory: [...base.aiTutorHistory, { id: "history-a", role: "user", content: "A", mode: "explain", createdAt: NOW }] });
  const tabB = normalizeProfile({ ...base, aiTutorHistory: [...base.aiTutorHistory, { id: "history-b", role: "assistant", content: "B", mode: "explain", createdAt: NOW }] });
  const merged = mergeProfileVersions(base, tabA, tabB, { now: NOW, advanceRevision: false }).profile;

  assert.equal(merged.aiTutorHistory.length, 50);
  assert.ok(merged.aiTutorHistory.some((message) => message.id === "history-a"));
  assert.ok(merged.aiTutorHistory.some((message) => message.id === "history-b"));
  assert.equal(merged.aiTutorHistory.some((message) => message.id === "history-00"), false);
  assert.ok(merged.syncMeta.conflicts.some((conflict) => conflict.collection === "aiTutorHistory" && conflict.kind === "history-rollover"));
});

test("AI history clear tombstones beat stale records while preserving a concurrent new message", () => {
  const message1 = { id: "message-1", role: "user", content: "Clear me", mode: "explain", createdAt: earlier };
  const message2 = { id: "message-2", role: "assistant", content: "Keep me", mode: "explain", createdAt: later };
  const base = normalizeProfile({ ...initialProfile, aiTutorHistory: [message1] });
  const clearingTab = normalizeProfile({ ...base, aiTutorHistory: [], aiTutorHistoryTombstones: [message1.id] });
  const addingTab = normalizeProfile({ ...base, aiTutorHistory: [message1, message2] });

  const merged = mergeProfileVersions(base, clearingTab, addingTab, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(merged.aiTutorHistory.map((message) => message.id), [message2.id]);
  assert.deepEqual(merged.aiTutorHistoryTombstones, [message1.id]);

  const staleCommit = mergeProfileVersions(base, addingTab, merged, { now: NOW, advanceRevision: false }).profile;
  assert.deepEqual(staleCommit.aiTutorHistory.map((message) => message.id), [message2.id]);
  assert.deepEqual(staleCommit.aiTutorHistoryTombstones, [message1.id]);
});

test("AI tutor history normalization is bounded and strips source text", () => {
  const profile = normalizeProfile({
    ...initialProfile,
    aiTutorHistory: Array.from({ length: 60 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: `Message ${index}`,
      mode: "explain",
      createdAt: NOW,
      data: { cards: [{ front: "F", back: "B" }] },
      webFallbackStatus: index % 2 ? "used" : "not-needed",
      conversationMemory: { compactedMessages: 4, summary: "Earlier bounded memory" },
      retrievalTrace: { strategy: "library-first", passages: 1, confidenceLevel: "medium", confidenceScore: 0.7 },
      approach: { summary: "Use the library", steps: ["Retrieve", "Answer"] },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      responseProfile: "deep",
      durationMs: 1234,
      incomplete: index === 10,
      truncated: index === 10,
      citationSources: [{
        id: "source-1",
        title: "Roadmap",
        citationNumber: 123,
        text: "SECRET SOURCE BODY",
        original: { documentId: "notes/00-roadmap.md", title: "Roadmap", text: "SECRET SOURCE BODY" },
      }],
      webSources: [{ index: 2, title: "Second result", url: "https://example.com/second" }],
    })),
  });

  assert.equal(profile.aiTutorHistory.length, 50);
  assert.equal(profile.aiTutorHistory[0].id, "message-10");
  assert.equal(JSON.stringify(profile.aiTutorHistory).includes("SECRET SOURCE BODY"), false);
  assert.deepEqual(profile.aiTutorHistory[0].data, { cards: [{ front: "F", back: "B" }] });
  assert.equal(profile.aiTutorHistory[0].webFallbackStatus, "not-needed");
  assert.deepEqual(profile.aiTutorHistory[0].conversationMemory, { compactedMessages: 4, summary: "Earlier bounded memory" });
  assert.equal(profile.aiTutorHistory[0].retrievalTrace.passages, 1);
  assert.deepEqual(profile.aiTutorHistory[0].approach, { summary: "Use the library", steps: ["Retrieve", "Answer"] });
  assert.deepEqual(profile.aiTutorHistory[0].usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  assert.equal(profile.aiTutorHistory[0].responseProfile, "deep");
  assert.equal(profile.aiTutorHistory[0].durationMs, 1234);
  assert.equal(profile.aiTutorHistory[0].incomplete, true);
  assert.equal(profile.aiTutorHistory[0].truncated, true);
  assert.equal(profile.aiTutorHistory[0].citationSources[0].citationNumber, 123);
  assert.equal(profile.aiTutorHistory[0].webSources[0].index, 2);
});

test("an explicit replacement epoch fences a stale dirty tab write", () => {
  const base = normalizeProfile(initialProfile);
  const dirtyTab = normalizeProfile({
    ...base,
    customDocuments: [documentRecord("custom/stale.md", "Stale dirty note", "# Must not resurrect")],
  });
  const replacement = prepareProfileReplacement(initialProfile, {
    reason: "reset",
    writerId: "reset-tab",
    now: NOW,
    generation: "replacement-generation",
  });
  const staleCommit = mergeProfileVersions(base, dirtyTab, replacement, {
    writerId: "stale-tab",
    now: "2026-08-23T10:00:01.000Z",
  });

  assert.equal(staleCommit.profile.customDocuments.length, 0, "stale work queued before reset must not resurrect after replacement");
  assert.equal(staleCommit.profile.syncMeta.generation, "replacement-generation");
  assert.equal(staleCommit.replacementApplied, true);
});

test("replacement generations are ordered by replacement time", () => {
  const first = prepareProfileReplacement(initialProfile, {
    reason: "restore",
    now: "2026-08-23T10:00:00.000Z",
    generation: "generation-a",
  });
  const second = prepareProfileReplacement({ ...initialProfile, bookmarks: ["notes/00-roadmap.md"] }, {
    reason: "reset",
    now: "2026-08-23T10:00:02.000Z",
    generation: "generation-b",
  });
  assert.equal(isProfileReplacementNewer(second, first), true);
  assert.equal(isProfileReplacementNewer(first, second), false);
  const merged = mergeProfileVersions(first, first, second, { now: "2026-08-23T10:00:03.000Z" }).profile;
  assert.deepEqual(merged.bookmarks, ["notes/00-roadmap.md"]);
  assert.equal(merged.syncMeta.generation, "generation-b");
});
