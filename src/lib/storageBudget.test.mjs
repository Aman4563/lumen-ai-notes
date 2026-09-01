import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOwnedDataBudget,
  assertOwnedDataBudgetTransition,
  MAX_BOARD_RECORDS,
  MAX_OWNED_DATA_BYTES,
  StorageBudgetError,
  summarizeOwnedData,
  summarizeOwnedRecordBytes,
} from "./storageBudget.js";

test("mixed profile and board state is measured as one backup-safe workspace", () => {
  const records = {
    profile: {
      customDocuments: [{ raw: "c".repeat(8 * 1024 * 1024) }],
      edits: { a: "e".repeat(3 * 1024 * 1024) },
      personalNotes: { a: "n".repeat(1024 * 1024) },
      reviewItems: [{ front: "q".repeat(100_000), back: "a".repeat(100_000) }],
    },
    "board:one": { pages: [{ objects: [{ text: "b".repeat(2 * 1024 * 1024) }] }] },
  };
  const summary = assertOwnedDataBudget(records);
  assert.ok(summary.bytes < MAX_OWNED_DATA_BYTES);
  assert.equal(summary.boardRecords, 1);
  assert.ok(summary.recordBytes.profile > summary.recordBytes["board:one"]);
});

test("aggregate bytes reject a cross-category overshoot", () => {
  assert.throws(
    () => assertOwnedDataBudget({ profile: { edits: { a: "x".repeat(MAX_OWNED_DATA_BYTES) } } }),
    (error) => error instanceof StorageBudgetError && error.code === "BYTE_LIMIT",
  );
});

test("whiteboard count is aligned with the backup format", () => {
  const records = { profile: {} };
  for (let index = 0; index <= MAX_BOARD_RECORDS; index += 1) records[`board:${index}`] = { pages: [] };
  assert.equal(summarizeOwnedData(records).boardRecords, MAX_BOARD_RECORDS + 1);
  assert.throws(
    () => assertOwnedDataBudget(records),
    (error) => error instanceof StorageBudgetError && error.code === "BOARD_LIMIT",
  );
});

test("the incremental record ledger is byte-exact for Unicode keys and values", () => {
  const records = {
    profile: { note: "mathematics λλλ" },
    "board:diagram/线性": { label: "矩阵 🧠" },
    "unowned-cache": { ignored: true },
  };
  const full = summarizeOwnedData(records);
  const incremental = summarizeOwnedRecordBytes(full.recordBytes);
  assert.deepEqual(incremental, full);
});

test("legacy oversized state may shrink but may not grow farther", () => {
  const current = summarizeOwnedData({ profile: { raw: "x".repeat(MAX_OWNED_DATA_BYTES + 1024) } });
  const smaller = summarizeOwnedData({ profile: { raw: "x".repeat(MAX_OWNED_DATA_BYTES + 512) } });
  const larger = summarizeOwnedData({ profile: { raw: "x".repeat(MAX_OWNED_DATA_BYTES + 2048) } });
  assert.equal(assertOwnedDataBudgetTransition(current, smaller).bytes, smaller.bytes);
  assert.throws(
    () => assertOwnedDataBudgetTransition(current, larger),
    (error) => error instanceof StorageBudgetError
      && error.code === "BYTE_LIMIT"
      && error.details.previousBytes === current.bytes,
  );
});
