/**
 * Concept map v1 (GRAPH-001 slice): the 23-Part curriculum as a deterministic
 * serpentine grid with prerequisite edges along the curriculum order and the
 * learner's mastery state as the node signal. Coordinates are unit-relative
 * (0..1) so the renderer owns all sizing. Cross-Part concept edges beyond the
 * linear order remain open acceptance work.
 */
export const buildConceptMap = (masteryRows, { columns = 4 } = {}) => {
  const rows = Array.isArray(masteryRows) ? masteryRows : [];
  const columnCount = Math.max(2, Math.min(8, columns));
  const rowCount = Math.max(1, Math.ceil(rows.length / columnCount));
  const nodes = rows.map((part, index) => {
    const gridRow = Math.floor(index / columnCount);
    const forward = index % columnCount;
    const gridColumn = gridRow % 2 ? columnCount - 1 - forward : forward;
    return {
      partNumber: part.partNumber,
      partTitle: part.partTitle,
      state: part.state,
      readPercent: part.readPercent,
      x: (gridColumn + 0.5) / columnCount,
      y: (gridRow + 0.5) / rowCount,
    };
  });
  const byPart = new Map(nodes.map((node) => [node.partNumber, node]));
  const edges = [];
  const ordered = [...nodes].sort((left, right) => left.partNumber - right.partNumber);
  for (let index = 1; index < ordered.length; index += 1) {
    const from = byPart.get(ordered[index - 1].partNumber);
    const to = byPart.get(ordered[index].partNumber);
    edges.push({ from: from.partNumber, to: to.partNumber, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  return { nodes, edges, rows: rowCount, columns: columnCount };
};
