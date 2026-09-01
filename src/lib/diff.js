/**
 * Bounded line diff for the revision viewer (CONTENT-001 slice): a classic
 * LCS over lines producing {kind: "same" | "added" | "removed", text} rows.
 * Inputs beyond the bound fall back to a whole-document replace marker so a
 * pathological pair can never freeze the UI thread.
 */
export const MAX_DIFF_LINES = 4_000;

export const diffLines = (beforeText, afterText) => {
  const before = String(beforeText || "").split("\n");
  const after = String(afterText || "").split("\n");
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return [
      { kind: "removed", text: `— ${before.length} lines (too large to diff line by line) —` },
      { kind: "added", text: `— ${after.length} lines (too large to diff line by line) —` },
    ];
  }

  // Single-array LCS table (rows iterated backwards) keeps memory at O(n·m)
  // 32-bit ints for worst-case 4,000×4,000 inputs.
  const columns = after.length + 1;
  const table = new Int32Array((before.length + 1) * columns);
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row * columns + column] = before[row] === after[column]
        ? table[(row + 1) * columns + column + 1] + 1
        : Math.max(table[(row + 1) * columns + column], table[row * columns + column + 1]);
    }
  }

  const rows = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      rows.push({ kind: "same", text: before[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[(beforeIndex + 1) * columns + afterIndex] >= table[beforeIndex * columns + afterIndex + 1]) {
      rows.push({ kind: "removed", text: before[beforeIndex] });
      beforeIndex += 1;
    } else {
      rows.push({ kind: "added", text: after[afterIndex] });
      afterIndex += 1;
    }
  }
  while (beforeIndex < before.length) rows.push({ kind: "removed", text: before[beforeIndex++] });
  while (afterIndex < after.length) rows.push({ kind: "added", text: after[afterIndex++] });
  return rows;
};

export const diffSummary = (rows) => ({
  added: rows.filter((row) => row.kind === "added").length,
  removed: rows.filter((row) => row.kind === "removed").length,
});
