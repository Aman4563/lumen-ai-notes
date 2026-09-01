import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addTrashEntry,
  appendRevision,
  documentFromTrashEntry,
  findDuplicateDocument,
  MAX_REVISIONS_PER_DOCUMENT,
  MAX_REVISIONS_TOTAL,
  MAX_TRASH_ENTRIES,
  purgeExpiredTrash,
  recordActivityEntry,
  revisionForDocument,
  trashEntryForDocument,
} from "./contentOps.js";
import { diffLines, diffSummary } from "./diff.js";

const now = new Date("2026-09-01T12:00:00.000Z");

test("duplicate detection is whitespace- and case-insensitive but content-exact", () => {
  const docs = [{ id: "custom/a.md", title: "A", raw: "# Gradient Descent\n\nIterative   optimization.\n" }];
  assert.equal(findDuplicateDocument(docs, "# gradient descent\niterative optimization."), docs[0]);
  assert.equal(findDuplicateDocument(docs, "# Gradient Descent\n\nIterative optimization with momentum."), null);
  assert.equal(findDuplicateDocument(docs, "   \n"), null, "blank content never matches");
  assert.equal(findDuplicateDocument([], "# anything"), null);
});

test("trash entries preserve content, expire after 30 days, and restore under a fresh id", () => {
  const doc = { id: "custom/a.md", title: "My upload", raw: "# body", tags: ["draft"], collectionId: "col-1" };
  const entry = trashEntryForDocument(doc, now);
  assert.equal(entry.documentId, "custom/a.md");
  assert.equal(entry.raw, "# body");
  assert.equal(entry.collectionId, "col-1");

  const trash = addTrashEntry([], entry);
  assert.equal(purgeExpiredTrash(trash, new Date("2026-09-30T12:00:00.000Z")).length, 1, "day 29 keeps the entry");
  assert.equal(purgeExpiredTrash(trash, new Date("2026-10-02T12:00:01.000Z")).length, 0, "past 30 days purges it");
  assert.equal(purgeExpiredTrash([{ id: "bad", deletedAt: "not-a-date" }], now).length, 0, "unparseable timestamps purge");

  const restored = documentFromTrashEntry(entry, now);
  assert.notEqual(restored.id, "custom/a.md", "restore must mint a new id — the old one is tombstoned");
  assert.match(restored.id, /^custom\/.+\.md$/);
  assert.equal(restored.raw, "# body");
  assert.deepEqual(restored.tags, ["draft"]);
  assert.equal(restored.archived, false);

  const overflow = Array.from({ length: MAX_TRASH_ENTRIES + 10 }, (_, index) => ({ ...entry, id: `trash-${index}` }))
    .reduce((accumulated, item) => addTrashEntry(accumulated, item), []);
  assert.equal(overflow.length, MAX_TRASH_ENTRIES);
});

test("the activity log records newest-first and stays bounded", () => {
  let activity = [];
  for (let index = 0; index < 505; index += 1) {
    activity = recordActivityEntry(activity, { kind: "upload", label: `Upload ${index}`, refId: `custom/${index}.md` }, now);
  }
  assert.equal(activity.length, 500);
  assert.equal(activity[0].label, "Upload 504", "newest entry first");
  assert.equal(activity[0].kind, "upload");
  assert.equal(activity[0].at, now.toISOString());
});

test("revisions honor per-document and global bounds, newest kept", () => {
  let revisions = [];
  for (let index = 0; index < 8; index += 1) {
    revisions = appendRevision(revisions, revisionForDocument("custom/a.md", `v${index}`, "", new Date(now.getTime() + index * 1_000)));
  }
  assert.equal(revisions.filter((entry) => entry.documentId === "custom/a.md").length, MAX_REVISIONS_PER_DOCUMENT);
  assert.equal(revisions[0].text, "v7", "the newest revision survives the per-document cap");
  assert.equal(revisions.at(-1).text, "v3", "the oldest overflow rolled off");

  for (let doc = 0; doc < 14; doc += 1) {
    for (let version = 0; version < 5; version += 1) {
      revisions = appendRevision(revisions, revisionForDocument(`custom/doc-${doc}.md`, `d${doc}v${version}`, "", new Date(now.getTime() + (doc * 10 + version + 100) * 1_000)));
    }
  }
  assert.equal(revisions.length, MAX_REVISIONS_TOTAL, "the global cap holds");
  assert.equal(revisions.some((entry) => entry.documentId === "custom/a.md"), false, "the oldest document's revisions rolled off globally");
});

test("line diff marks additions, removals, and unchanged runs", () => {
  const rows = diffLines("alpha\nbeta\ngamma", "alpha\nbeta prime\ngamma\ndelta");
  assert.deepEqual(rows, [
    { kind: "same", text: "alpha" },
    { kind: "removed", text: "beta" },
    { kind: "added", text: "beta prime" },
    { kind: "same", text: "gamma" },
    { kind: "added", text: "delta" },
  ]);
  assert.deepEqual(diffSummary(rows), { added: 2, removed: 1 });
  assert.deepEqual(diffLines("same", "same"), [{ kind: "same", text: "same" }]);
  const oversized = diffLines(Array.from({ length: 4_001 }, () => "x").join("\n"), "y");
  assert.equal(oversized.length, 2, "oversized inputs fall back to a replace marker");
  assert.match(oversized[0].text, /too large/);
});
