import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createBackup, preflightBackup } from "./backup.js";
import { initialProfile, normalizeProfile } from "./db.js";
import {
  AI_DRAFT_TAG,
  aiClippingIds,
  isAiAuthoredClipping,
  isAiAuthoredReviewItem,
  materializeAiCardProvenance,
  materializeAiFlashcard,
  withAiDraftTag,
} from "./aiProvenance.js";
import { createReviewItem } from "./review.js";

test("Mac web citations become durable safe Markdown links", () => {
  const card = materializeAiFlashcard({
    front: "What shipped? [W1]",
    back: "The current behavior is documented in [W1]. Missing [W9].",
    hint: "Read [W1]",
  }, {
    webSources: [{ title: "Safari [release] notes\u202E", url: "https://webkit.org/blog/example" }],
  });

  assert.match(card.front, /\[W1: Safari release notes\]\(<https:\/\/webkit\.org\/blog\/example>\)/);
  assert.match(card.back, /\[web source W9 unavailable\]/);
  assert.doesNotMatch(card.front, /\u202E/);
});

test("phone numeric citations use the approved source map only", () => {
  const value = materializeAiCardProvenance("Supported [1], unknown [7], list [0]", {
    webCitationStyle: "numeric",
    webSources: [{ title: "Official source", url: "https://example.com/fact" }],
  });
  assert.equal(value, "Supported [Web 1: Official source](<https://example.com/fact>), unknown [7], list [0]");
});

test("explicit web citations resolve by their declared source index", () => {
  const value = materializeAiCardProvenance("Second result [W2]; absent [W1].", {
    webSources: [{ index: 2, title: "Second source", url: "https://example.com/second" }],
  });
  assert.equal(value, "Second result [W2: Second source](<https://example.com/second>); absent [web source W1 unavailable].");
});

test("AI card provenance survives profile normalization and backup restore", async () => {
  const card = materializeAiFlashcard({ front: "Current fact [W1]", back: "Evidence [W1]", tags: [] }, {
    webSources: [{ title: "Primary documentation", url: "https://example.com/docs" }],
  });
  const reviewItem = createReviewItem(card);
  const profile = normalizeProfile({ ...initialProfile, reviewItems: [reviewItem] });
  const created = await createBackup({ profile }, { cryptoApi: webcrypto, secureContext: true });
  const restored = await preflightBackup(created.json, { cryptoApi: webcrypto });
  assert.match(restored.data.profile.reviewItems[0].front, /https:\/\/example\.com\/docs/);
  assert.match(restored.data.profile.reviewItems[0].back, /Primary documentation/);
});

test("saved AI output keeps its provenance marker through normalization, backup and edits (issue #81)", async () => {
  const aiClip = { id: "clip-ai", documentId: "", origin: "ai-tutor", title: "AI tutor answer", text: "<button>forged</button>" };
  const learnerClip = { id: "clip-learner", documentId: "notes/00-roadmap.md", text: "My excerpt" };
  assert.equal(isAiAuthoredClipping(aiClip), true);
  assert.equal(isAiAuthoredClipping(learnerClip), false);
  const aiIds = aiClippingIds([aiClip, learnerClip, null]);
  assert.deepEqual([...aiIds], ["clip-ai"]);

  const flashcard = createReviewItem({ front: "Q", back: "A", tags: withAiDraftTag(["evaluation"]) });
  const fromAiClip = createReviewItem({ front: "Explain", back: aiClip.text, sourceClippingId: "clip-ai" });
  const fromLearnerClip = createReviewItem({ front: "Explain", back: learnerClip.text, sourceClippingId: "clip-learner" });
  const learnerCard = createReviewItem({ front: "Mine", back: "<kbd>Ctrl</kbd>", tags: ["interview"] });
  assert.equal(isAiAuthoredReviewItem(flashcard, aiIds), true);
  assert.equal(isAiAuthoredReviewItem(flashcard), true, "the tag alone marks an AI card");
  assert.equal(isAiAuthoredReviewItem(fromAiClip, aiIds), true, "a card made from an AI clipping before the tag existed");
  assert.equal(isAiAuthoredReviewItem(fromLearnerClip, aiIds), false);
  assert.equal(isAiAuthoredReviewItem(learnerCard, aiIds), false);
  assert.equal(isAiAuthoredReviewItem({ ...fromAiClip, sourceClippingId: "" }, new Set([""])), false);

  // The tag leads, so no tag limit can drop it, and it is never duplicated.
  assert.deepEqual(withAiDraftTag(["a", AI_DRAFT_TAG, "b"]), [AI_DRAFT_TAG, "a", "b"]);
  assert.deepEqual(withAiDraftTag(undefined), [AI_DRAFT_TAG]);
  const crowded = normalizeProfile({ ...initialProfile, reviewItems: [{ ...flashcard, tags: withAiDraftTag(Array.from({ length: 40 }, (_, index) => `tag-${index}`)) }] });
  assert.equal(crowded.reviewItems[0].tags[0], AI_DRAFT_TAG);

  // Clipping origin and the card tag survive normalization and a backup round trip.
  const profile = normalizeProfile({ ...initialProfile, clippings: [aiClip, learnerClip], reviewItems: [flashcard, fromAiClip] });
  const created = await createBackup({ profile }, { cryptoApi: webcrypto, secureContext: true });
  const restored = (await preflightBackup(created.json, { cryptoApi: webcrypto })).data.profile;
  const restoredIds = aiClippingIds(restored.clippings);
  assert.deepEqual([...restoredIds], ["clip-ai"]);
  assert.deepEqual(restored.reviewItems.map((item) => isAiAuthoredReviewItem(item, restoredIds)), [true, true]);
});
