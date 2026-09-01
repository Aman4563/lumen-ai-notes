import assert from "node:assert/strict";
import { test } from "node:test";

import { buildConceptMap } from "./conceptMap.js";

const rows = Array.from({ length: 23 }, (_, index) => ({
  partNumber: index + 1,
  partTitle: `Part ${index + 1}`,
  state: index === 0 ? "mastered" : "not-seen",
  readPercent: index === 0 ? 100 : 0,
}));

test("the concept map lays 23 Parts on a serpentine grid with curriculum-order edges", () => {
  const map = buildConceptMap(rows, { columns: 4 });
  assert.equal(map.nodes.length, 23);
  assert.equal(map.edges.length, 22, "every consecutive Part pair gets one prerequisite edge");
  assert.equal(map.rows, 6);

  // Serpentine: row one runs left→right, row two right→left.
  const [p1, p4, p5] = [1, 4, 5].map((part) => map.nodes.find((node) => node.partNumber === part));
  assert.ok(p1.x < p4.x, "the first row runs left to right");
  assert.ok(Math.abs(p5.x - p4.x) < 0.001, "the row turn keeps Part 5 under Part 4 (serpentine)");
  assert.ok(p5.y > p4.y);

  for (const node of map.nodes) {
    assert.ok(node.x > 0 && node.x < 1 && node.y > 0 && node.y < 1, "coordinates stay unit-relative");
  }
  assert.equal(map.nodes.find((node) => node.partNumber === 1).state, "mastered", "mastery state rides on the node");
  assert.deepEqual(buildConceptMap(rows, { columns: 4 }), map, "layout is deterministic");
});
