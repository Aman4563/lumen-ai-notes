import assert from "node:assert/strict";
import { test } from "node:test";

import { BOARD_INTERCHANGE_FORMAT, exportBoardDocument, mergeImportedPages, parseBoardInterchange } from "./boardInterchange.js";

const board = {
  version: 2,
  activePageId: "page-1",
  background: "grid",
  syncMeta: { revision: 4, updatedAt: "x", writerId: "tab", conflicts: [] },
  pages: [{
    id: "page-1",
    name: "Derivation",
    objects: [
      { id: "line-1", tool: "line", color: "#17283e", fill: "#fff1a8", width: 3, fontSize: 24, text: "", locked: true, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] },
      { id: "sticky-1", tool: "sticky", color: "#17283e", fill: "#fff1a8", width: 3, fontSize: 18, text: "Check assumptions", locked: false, points: [{ x: 0.5, y: 0.5 }] },
    ],
  }],
};

test("board export carries authoring content only and round-trips through import", () => {
  const envelope = exportBoardDocument(board, { title: "Gradient Notes", exportedAt: new Date("2026-09-02T10:00:00.000Z") });
  assert.equal(envelope.format, BOARD_INTERCHANGE_FORMAT);
  assert.equal(envelope.pages[0].objects.length, 2);
  assert.equal("id" in envelope.pages[0].objects[0], false, "object ids never travel");
  assert.equal("syncMeta" in envelope, false, "sync metadata never travels");
  assert.equal("activePageId" in envelope, false);
  assert.equal(envelope.pages[0].objects[0].locked, true, "lock state travels");

  const parsed = parseBoardInterchange(JSON.stringify(envelope));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pages[0].objects.length, 2);
  assert.notEqual(parsed.pages[0].id, "page-1", "page ids regenerate on import");
  assert.notEqual(parsed.pages[0].objects[0].id, "line-1", "object ids regenerate on import");
  assert.equal(parsed.pages[0].objects[0].locked, true);
  assert.deepEqual(parsed.pages[0].objects[0].points, [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }]);
});

test("import validates hostile input through the hardened normalizer", () => {
  assert.equal(parseBoardInterchange("not json").ok, false);
  assert.equal(parseBoardInterchange('{"format":"lumen.board.v9","pages":[]}').ok, false);
  assert.equal(parseBoardInterchange(JSON.stringify({ format: BOARD_INTERCHANGE_FORMAT, pages: [] })).ok, false);
  assert.equal(parseBoardInterchange("x".repeat(5_000_001)).ok, false, "the 5MB text guard runs before JSON.parse");

  const hostile = parseBoardInterchange(JSON.stringify({
    format: BOARD_INTERCHANGE_FORMAT,
    pages: [{
      name: "H",
      objects: [
        { tool: "script", color: "url(javascript:x)", width: "bad", points: [{ x: 99, y: -5 }] },
        { tool: "line", color: "#123456", width: 3, points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }] },
      ],
    }],
  }));
  assert.equal(hostile.ok, true);
  const [first, second] = hostile.pages[0].objects;
  assert.equal(first.tool, "pen", "unknown tools fall back through the normalizer");
  assert.notEqual(first.color, "url(javascript:x)", "hostile colors are rejected");
  assert.ok(first.points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1), "points clamp to the unit square");
  assert.equal(second.tool, "line");
});

test("page sizes, rotation, and the real background travel; files without sizes still import (issue #55)", () => {
  const sizedBoard = {
    ...board,
    background: "dots",
    pages: [{ ...board.pages[0], size: { width: 393, height: 478 }, objects: [{ ...board.pages[0].objects[0], rotation: 0.5 }] }],
  };
  const envelope = exportBoardDocument(sizedBoard);
  assert.equal(envelope.format, "lumen.board.v1", "the format stays v1: size is an optional, additive field");
  assert.equal(envelope.background, "dots");
  assert.deepEqual(envelope.pages[0].size, { width: 393, height: 478 });
  assert.equal(envelope.pages[0].objects[0].rotation, 0.5);
  const parsed = parseBoardInterchange(JSON.stringify(envelope));
  assert.deepEqual(parsed.pages[0].size, { width: 393, height: 478 }, "an imported page keeps its authoring size");
  assert.equal(parsed.pages[0].objects[0].rotation, 0.5);

  // A file exported before sizes existed imports unchanged and adopts the
  // importing canvas later, exactly like a legacy stored page.
  const legacyFile = JSON.stringify({ format: BOARD_INTERCHANGE_FORMAT, pages: [{ name: "Old", objects: [{ tool: "line", color: "#17283e", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] }] }] });
  const legacy = parseBoardInterchange(legacyFile);
  assert.equal(legacy.ok, true);
  assert.equal("size" in legacy.pages[0], false);
  assert.deepEqual(legacy.pages[0].objects[0].points, [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]);
  assert.equal("size" in exportBoardDocument({ ...board, pages: legacy.pages }).pages[0], false, "unsized pages export without a size");
});

test("imported pages append within the 20-page cap with collision-safe names", () => {
  const parsed = parseBoardInterchange(JSON.stringify(exportBoardDocument(board)));
  const merged = mergeImportedPages(board, parsed.pages);
  assert.equal(merged.added, 1);
  assert.equal(merged.board.pages.length, 2);
  assert.equal(merged.board.activePageId, merged.board.pages[1].id, "the first imported page becomes active");
  assert.match(merged.board.pages[1].name, /Derivation \(imported\)/, "name collisions are labeled");

  const full = { ...board, pages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, objects: [] })) };
  const refused = mergeImportedPages(full, parsed.pages);
  assert.equal(refused.added, 0);
  assert.equal(refused.skipped, 1, "the editor page cap is honored with an honest skip count");
});
