import assert from "node:assert/strict";
import { chunkSpeechText } from "../src/lib/speech.js";
import { normalizeBoardDocument, normalizeBoardStrokes, normalizeProfile, PROFILE_VERSION } from "../src/lib/db.js";
import { searchDocuments, tokenizeQuery } from "../src/lib/search.js";
import { MAX_CUSTOM_DOCUMENT_BYTES, selectUploadFiles } from "../src/lib/uploads.js";
import { createId } from "../src/lib/id.js";
import {
  buildReviewQueue,
  createReviewItem,
  gradeReviewItem,
  isNewReviewItem,
  localDayKey,
  recordReviewUsage,
  restoreReviewItemFromAttempt,
  reverseReviewUsage,
  reviewStats,
} from "../src/lib/review.js";

const chunks = chunkSpeechText("A short sentence. " + "optimization ".repeat(80) + "Done!", 120);
assert.ok(chunks.length > 2, "long narration should be split into multiple segments");
assert.ok(chunks.every((chunk) => chunk.length <= 120), "narration segments must respect the safe utterance limit");
assert.deepEqual(tokenizeQuery('"policy gradient" PPO + KL'), ["policy gradient", "ppo", "kl"]);

const fallbackUuid = createId();
assert.match(fallbackUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.match(createId({ getRandomValues: (bytes) => bytes.fill(17) }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-9[0-9a-f]{3}-[0-9a-f]{12}$/i, "UUID fallback must work when randomUUID is absent");
const uploadFixtures = [{ name: "one.md", size: 10 }, { name: "two.markdown", size: 20 }];
assert.deepEqual(selectUploadFiles(uploadFixtures, 499).accepted.map((file) => file.name), ["one.md"], "499 existing notes plus two uploads may import only one");
assert.equal(selectUploadFiles(uploadFixtures.slice(0, 1), 500).accepted.length, 0, "a full notebook must reject uploads instead of replacing an existing note");
const aggregateFixtures = [{ name: "fits.md", size: 8 }, { name: "overflow.md", size: 8 }];
const aggregateSelection = selectUploadFiles(aggregateFixtures, 2, MAX_CUSTOM_DOCUMENT_BYTES - 10);
assert.deepEqual(aggregateSelection.accepted.map((file) => file.name), ["fits.md"], "uploads must respect the aggregate backup-safe document budget");
assert.equal(aggregateSelection.byteCapacityReached, true);

const results = searchDocuments([
  { id: "body", title: "Other", partTitle: "RL", description: "PPO uses policy gradients", searchText: "policy gradient clipping ppo", raw: "Policy gradient clipping is used by PPO.", partNumber: 2, chapterNumber: 2 },
  { id: "title", title: "Policy Gradient PPO", partTitle: "RL", description: "Interview guide", searchText: "policy gradient ppo", raw: "An overview.", partNumber: 2, chapterNumber: 1 },
  { id: "miss", title: "Policy only", partTitle: "RL", description: "No algorithm", searchText: "policy gradients", raw: "Policy gradients.", partNumber: 2, chapterNumber: 3 },
], '"policy gradient" PPO');
assert.deepEqual(results.map((result) => result.id), ["title", "body"], "search should use AND matching and rank title matches first");
assert.ok(results[1].description.includes("Policy gradient"), "search should return a contextual excerpt");

const normalized = normalizeProfile({
  progress: { good: 0.4, high: 8, bad: "no" },
  readingPositions: { good: -2 },
  bookmarks: ["a", "a", 4],
  clippings: [{ documentId: "a", text: "  selected text  " }, { documentId: "a", text: " " }],
  customDocuments: [{ id: "custom/one.md", title: " Example ", raw: "# Example", tags: ["ml", "ml", 4] }],
  lastDocumentId: "custom/one.md",
  settings: { theme: "invalid", fontScale: 99, lineHeight: 0, speechLanguage: "not_a_locale", speechRate: 4, speechVolume: -4, speechScope: "page", keepScreenAwake: 1 },
});
assert.equal(normalized.version, PROFILE_VERSION);
assert.deepEqual(normalized.progress, { good: 0.4, high: 1 });
assert.equal(normalized.readingPositions.good, 0);
assert.deepEqual(normalized.bookmarks, ["a"]);
assert.equal(normalized.clippings.length, 1);
assert.equal(normalized.clippings[0].text, "selected text");
assert.deepEqual(normalized.customDocuments[0].tags, ["ml"]);
assert.equal(normalized.lastDocumentId, "custom/one.md");
assert.equal(normalized.settings.theme, "system");
assert.equal(normalized.settings.fontScale, 1.35);
assert.equal(normalized.settings.lineHeight, 1.45);
assert.equal(normalized.settings.speechRate, 1.6);
assert.equal(normalized.settings.speechLanguage, "auto");
assert.equal(normalized.settings.speechVolume, 0);
assert.equal(normalized.settings.speechScope, "document");
assert.equal(normalized.settings.keepScreenAwake, true);
assert.deepEqual(normalized.reviewItems, [], "v2 profiles should migrate with an empty review deck");
assert.deepEqual(normalized.reviewAttempts, [], "v2 profiles should migrate without fabricated attempts");

const reviewNow = new Date("2026-08-21T12:00:00.000Z");
const firstCard = createReviewItem({ front: "Question", back: "Answer" }, reviewNow);
const secondCard = createReviewItem({ front: "Second", back: "Answer" }, new Date(reviewNow.getTime() + 1_000));
const limitedQueue = buildReviewQueue([secondCard, firstCard], { dailyNewLimit: 1, dailyReviewLimit: 50 }, reviewNow);
assert.deepEqual(limitedQueue.map((item) => item.id), [firstCard.id], "new-card limit and deterministic creation order should be respected");
const firstGood = gradeReviewItem(firstCard, "good", reviewNow, 1_250);
assert.equal(firstGood.item.repetitions, 1);
assert.equal(firstGood.item.intervalDays, 1);
assert.equal(firstGood.attempt.rating, "good");
assert.equal(firstGood.attempt.elapsedMs, 1_250);
const secondGood = gradeReviewItem(firstGood.item, "good", new Date("2026-08-22T12:00:00.000Z"));
assert.equal(secondGood.item.intervalDays, 3);
const lapse = gradeReviewItem(secondGood.item, "again", new Date("2026-08-25T12:00:00.000Z"));
assert.equal(lapse.item.repetitions, 0);
assert.equal(lapse.item.lapses, 1);
assert.equal(lapse.item.intervalDays, 0.01);
assert.deepEqual(reviewStats([secondGood.item], new Date("2026-09-30T12:00:00.000Z")), { due: 1, newCount: 0, learning: 1, mastered: 0, suspended: 0, archived: 0 });

const thirdCard = createReviewItem({ front: "Third", back: "Answer" }, new Date(reviewNow.getTime() + 2_000));
const firstUsage = recordReviewUsage([], firstCard, reviewNow, { timeZone: "Asia/Kolkata" });
assert.equal(firstUsage.kind, "new");
assert.equal(firstUsage.sessions[0].newIntroduced, 1);
assert.deepEqual(
  buildReviewQueue([secondCard, thirdCard], { dailyNewLimit: 1, dailyReviewLimit: 50 }, reviewNow, firstUsage.sessions, { timeZone: "Asia/Kolkata" }),
  [],
  "grading a new card must consume the persisted daily allowance instead of admitting another card",
);
const reviewedUsage = recordReviewUsage(firstUsage.sessions, firstGood.item, new Date("2026-08-22T12:00:00.000Z"), { timeZone: "Asia/Kolkata" });
assert.equal(reviewedUsage.kind, "review");
assert.equal(reviewedUsage.sessions.at(-1).reviewCompleted, 1);
const gradedAgain = gradeReviewItem(firstGood.item, "again", new Date("2026-08-22T12:00:00.000Z"), 500, { sessionKind: reviewedUsage.kind, sessionKey: reviewedUsage.sessionKey, confidence: 2 });
assert.equal(gradedAgain.item.repetitions, 0);
assert.equal(gradedAgain.item.reviewCount, 2);
assert.equal(isNewReviewItem(gradedAgain.item), false, "Again must not reclassify an established card as new");
assert.equal(gradedAgain.attempt.confidence, 2);
assert.equal(restoreReviewItemFromAttempt(gradedAgain.item, gradedAgain.attempt).dueAt, firstGood.item.dueAt);
assert.equal(reverseReviewUsage(reviewedUsage.sessions, gradedAgain.attempt).at(-1).reviewCompleted, 0);
assert.notEqual(
  localDayKey(new Date("2026-03-08T04:30:00.000Z"), "America/New_York"),
  localDayKey(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"),
  "local-day accounting must survive the spring DST boundary",
);

const board = normalizeBoardStrokes([
  { id: "valid", tool: "arrow", color: "#fff", width: 400, points: [{ x: -1, y: 0.5 }, { x: 2, y: 1 }] },
  { tool: "script", color: "url(javascript:x)", width: "bad", points: [{ x: "bad", y: 1 }] },
]);
assert.equal(board.length, 1);
assert.equal(board[0].tool, "arrow");
assert.equal(board[0].width, 100);
assert.deepEqual(board[0].points, [{ x: 0, y: 0.5 }, { x: 1, y: 1 }]);
const migratedBoard = normalizeBoardDocument(board);
assert.equal(migratedBoard.version, 2);
assert.equal(migratedBoard.pages.length, 1);
assert.equal(migratedBoard.pages[0].objects.length, 1);

console.log("Unit audit passed: narration, search, profile migration, review scheduling, and whiteboard normalization.");
