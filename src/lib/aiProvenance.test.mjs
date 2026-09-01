import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createBackup, preflightBackup } from "./backup.js";
import { initialProfile, normalizeProfile } from "./db.js";
import { materializeAiCardProvenance, materializeAiFlashcard } from "./aiProvenance.js";
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
