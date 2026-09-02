import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBoardDocument } from "./db.js";
import { boardPayloadEqual, mergeBoardVersions } from "./boardSync.js";

const NOW = "2026-08-23T12:00:00.000Z";

const object = (id, text = "", x = 0.1) => ({
  id,
  tool: text ? "text" : "line",
  color: "#17283e",
  fill: "#fff1a8",
  width: 3,
  fontSize: 24,
  text,
  points: text ? [{ x, y: 0.2 }] : [{ x, y: 0.2 }, { x: x + 0.3, y: 0.5 }],
});

const board = (pages = [{ id: "page-1", name: "Page 1", objects: [] }]) => normalizeBoardDocument({
  version: 2,
  activePageId: pages[0].id,
  background: "grid",
  pages,
});

test("serialized tab commits union concurrent unique pages and objects", () => {
  const base = board();
  const tabA = board([
    { id: "page-1", name: "Page 1", objects: [object("object-a")] },
    { id: "page-a", name: "Tab A", objects: [object("page-a-object")] },
  ]);
  const tabB = board([
    { id: "page-1", name: "Page 1", objects: [object("object-b", "B") ] },
    { id: "page-b", name: "Tab B", objects: [object("page-b-object")] },
  ]);

  const first = mergeBoardVersions(base, tabA, base, { now: NOW, writerId: "tab-a" }).board;
  const second = mergeBoardVersions(base, tabB, first, { now: NOW, writerId: "tab-b" }).board;

  assert.deepEqual(new Set(second.pages.map((page) => page.id)), new Set(["page-1", "page-a", "page-b"]));
  assert.deepEqual(new Set(second.pages.find((page) => page.id === "page-1").objects.map((item) => item.id)), new Set(["object-a", "object-b"]));
  assert.equal(second.syncMeta.revision, 2);
});

test("uncontested deletes persist and a stale tab cannot resurrect them", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [object("deleted"), object("kept")] }]);
  const deletion = board([{ id: "page-1", name: "Page 1", objects: [object("kept")] }]);
  const afterDelete = mergeBoardVersions(base, deletion, base, { now: NOW }).board;
  assert.deepEqual(afterDelete.pages[0].objects.map((item) => item.id), ["kept"]);

  const staleAddition = board([{ id: "page-1", name: "Page 1", objects: [object("deleted"), object("kept"), object("new-from-stale-tab")] }]);
  const reconciled = mergeBoardVersions(base, staleAddition, afterDelete, { now: NOW }).board;
  assert.deepEqual(new Set(reconciled.pages[0].objects.map((item) => item.id)), new Set(["kept", "new-from-stale-tab"]));
});

test("an edit racing a delete is kept and recorded", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Original")] }]);
  const deletion = board([{ id: "page-1", name: "Page 1", objects: [] }]);
  const edit = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Edited safely")] }]);
  const result = mergeBoardVersions(base, deletion, edit, { now: NOW });

  assert.equal(result.board.pages[0].objects[0].text, "Edited safely");
  assert.equal(result.conflicts[0].kind, "object-delete-vs-update");
  assert.equal(result.board.syncMeta.conflicts[0].kind, "object-delete-vs-update");
});

test("different edits of one object preserve both payloads", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Original")] }]);
  const tabA = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Text from A")] }]);
  const tabB = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Text from B")] }]);
  const result = mergeBoardVersions(base, tabA, tabB, { now: NOW });
  const texts = result.board.pages[0].objects.map((item) => item.text);

  assert.equal(result.board.pages[0].objects.length, 2);
  assert.ok(texts.includes("Text from A"));
  assert.ok(texts.includes("Text from B"));
  assert.ok(result.board.pages[0].objects.some((item) => item.id.startsWith("sync-recovered-")));
  assert.equal(result.conflicts[0].kind, "concurrent-object-update");
});

test("same-base conflict resolution is deterministic regardless of tab order", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [object("shared", "Original")] }]);
  const tabA = board([{ id: "page-1", name: "Renamed A", objects: [object("shared", "Text A"), object("unique-a")] }]);
  const tabB = board([{ id: "page-1", name: "Renamed B", objects: [object("shared", "Text B"), object("unique-b")] }]);
  const leftRight = mergeBoardVersions(base, tabA, tabB, { now: NOW, writerId: "writer" }).board;
  const rightLeft = mergeBoardVersions(base, tabB, tabA, { now: NOW, writerId: "writer" }).board;

  assert.ok(boardPayloadEqual(leftRight, rightLeft));
  assert.deepEqual(leftRight.syncMeta.conflicts, rightLeft.syncMeta.conflicts);
});

test("a page edit wins over a concurrent page deletion", () => {
  const base = board([
    { id: "page-1", name: "Page 1", objects: [] },
    { id: "page-2", name: "Original", objects: [object("page-two-object")] },
  ]);
  const deletion = board([{ id: "page-1", name: "Page 1", objects: [] }]);
  const edit = board([
    { id: "page-1", name: "Page 1", objects: [] },
    { id: "page-2", name: "Edited", objects: [object("page-two-object"), object("new-object")] },
  ]);
  const result = mergeBoardVersions(base, deletion, edit, { now: NOW });

  assert.equal(result.board.pages.find((page) => page.id === "page-2").name, "Edited");
  assert.ok(result.conflicts.some((conflict) => conflict.kind === "page-delete-vs-update"));
});


test("a z-order reorder survives the merge instead of snapping back to base order", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [object("a"), object("b", "", 0.2), object("c", "", 0.3)] }]);
  // Local brings "a" to the front (end of the array); remote is unchanged —
  // the exact shape of persistBoard's merge on every debounced save.
  const local = normalizeBoardDocument({ ...base, pages: [{ ...base.pages[0], objects: [base.pages[0].objects[1], base.pages[0].objects[2], base.pages[0].objects[0]] }] });
  const result = mergeBoardVersions(base, local, base, { now: NOW });
  assert.deepEqual(result.board.pages[0].objects.map((item) => item.id), ["b", "c", "a"], "the local reorder must hold after the merge");
  assert.equal(result.conflicts.some((conflict) => conflict.kind === "concurrent-order-change"), false, "an uncontested reorder is not a conflict");

  // Both sides reorder differently: deterministic winner + a recorded conflict.
  const remote = normalizeBoardDocument({ ...base, pages: [{ ...base.pages[0], objects: [base.pages[0].objects[2], base.pages[0].objects[0], base.pages[0].objects[1]] }] });
  const contested = mergeBoardVersions(base, local, remote, { now: NOW });
  const forward = contested.board.pages[0].objects.map((item) => item.id);
  const reversed = mergeBoardVersions(base, remote, local, { now: NOW }).board.pages[0].objects.map((item) => item.id);
  assert.deepEqual(forward, reversed, "contested reorders resolve identically regardless of tab order");
  assert.ok(contested.conflicts.some((conflict) => conflict.kind === "concurrent-order-change"), "a contested reorder is recorded");

  // A deletion on one side must never read as a reorder on the other.
  const deleted = normalizeBoardDocument({ ...base, pages: [{ ...base.pages[0], objects: [base.pages[0].objects[0], base.pages[0].objects[2]] }] });
  const deleteMerge = mergeBoardVersions(base, deleted, base, { now: NOW });
  assert.deepEqual(deleteMerge.board.pages[0].objects.map((item) => item.id), ["a", "c"]);
  assert.equal(deleteMerge.conflicts.some((conflict) => conflict.kind === "concurrent-order-change"), false);
});

test("the locked flag survives merge and normalization", () => {
  const base = board([{ id: "page-1", name: "Page 1", objects: [{ ...object("a"), locked: true }] }]);
  assert.equal(base.pages[0].objects[0].locked, true, "normalizeBoardStrokes preserves locked");
  const merged = mergeBoardVersions(base, base, base, { now: NOW });
  assert.equal(merged.board.pages[0].objects[0].locked, true);
});
