/**
 * Offset maps between what narration says and the text it came from
 * (issue #100), so a spoken word can be traced back to the words on screen.
 *
 * One piece of a map: spoken [start, end) ↔ source [start, end).
 *   MapPiece = { spoken: [number, number], source: [number, number] }
 * A map is MapPiece[] sorted by spoken start and contiguous over the spoken
 * text (the first piece starts at 0, each starts where the previous ends, the
 * last ends at text.length), with non-decreasing, non-overlapping source
 * ranges. A piece whose spoken and source lengths are equal is an identity
 * piece (1:1 characters); any other piece maps its whole spoken span to its
 * whole source span. Removed source text is a gap between pieces; inserted
 * text is a piece with an empty source range at its position.
 */

const isIdentity = ({ spoken, source }) => spoken[1] - spoken[0] === source[1] - source[0];

/**
 * Spoken text assembled from appended parts, whitespace collapsed the way
 * `cleanText` collapses it: every whitespace run becomes one space, with none
 * at either end. An identity append (text equal in length to its source
 * range) maps run by run; a kept space maps to the first source whitespace
 * character of its run, and the rest of the run is a gap. Any other append is
 * one piece for its whole source range.
 */
export const createSpokenBuilder = () => {
  let text = "";
  const map = [];
  // The whitespace run waiting for the next word: it is spoken only between
  // two words. A run keeps the first whitespace character it has in the
  // source; a space the caller inserted keeps an empty range until then.
  let pending = null;
  const push = (value, source) => {
    map.push({ spoken: [text.length, text.length + value.length], source });
    text += value;
  };
  const space = (source) => {
    if (!pending || (pending[0] === pending[1] && source[0] !== source[1])) pending = source;
  };
  const word = (value, source) => {
    if (pending && text) push(" ", pending);
    pending = null;
    push(value, source);
  };
  return {
    append(value, sourceStart, sourceEnd) {
      const part = String(value);
      if (sourceEnd - sourceStart === part.length) {
        for (const match of part.matchAll(/(\s+)|\S+/gu)) {
          const at = sourceStart + match.index;
          if (match[1]) space([at, at + 1]);
          else word(match[0], [at, at + match[0].length]);
        }
        return;
      }
      const inner = part.trim().replace(/\s+/gu, " ");
      if (/^\s/u.test(part)) space([sourceStart, sourceStart]);
      if (!inner) return;
      word(inner, [sourceStart, sourceEnd]);
      if (/\s$/u.test(part)) space([sourceEnd, sourceEnd]);
    },
    build: () => ({ text, map: map.map((piece) => ({ spoken: [...piece.spoken], source: [...piece.source] })) }),
  };
};

// The index of the piece holding spoken offset `offset`: the last piece that
// starts at or before it.
const pieceIndexAt = (map, offset) => {
  let low = 0;
  let high = map.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (map[middle].spoken[0] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

/**
 * The source offset under a spoken offset: exact inside an identity piece, a
 * non-identity piece's source start, and its source end at that piece's
 * spoken end (the end of the text). 0 for an empty map.
 */
export const sourceOffsetAt = (map, spokenOffset) => {
  if (!map?.length) return 0;
  const last = map.at(-1);
  if (spokenOffset >= last.spoken[1]) return last.source[1];
  const piece = map[pieceIndexAt(map, spokenOffset)];
  if (spokenOffset <= piece.spoken[0] || !isIdentity(piece)) return piece.source[0];
  return piece.source[0] + (spokenOffset - piece.spoken[0]);
};

// Where a middle offset lands in `inner`'s source, as the start of a range or
// as its end: exact inside an identity piece, the whole piece otherwise.
const sourceBound = (inner, offset, asEnd) => {
  if (offset >= inner.at(-1).spoken[1]) return inner.at(-1).source[1];
  if (offset <= inner[0].spoken[0]) return inner[0].source[0];
  const piece = inner[pieceIndexAt(inner, asEnd ? offset - 1 : offset)];
  if (isIdentity(piece)) return piece.source[0] + (offset - piece.spoken[0]);
  return asEnd ? piece.source[1] : piece.source[0];
};

/**
 * One map from two: `outer` maps spoken → middle, `inner` maps middle →
 * source. Pieces that land inside one non-identity inner piece merge, so the
 * source ranges never overlap.
 */
export const composeMaps = (outer, inner) => {
  const pieces = [];
  const add = (spoken, source) => {
    const last = pieces.at(-1);
    if (last && source[0] < last.source[1]) {
      last.spoken[1] = spoken[1];
      last.source[1] = Math.max(last.source[1], source[1]);
    } else pieces.push({ spoken: [...spoken], source: [...source] });
  };
  if (!inner?.length) return (outer || []).map((piece) => ({ spoken: [...piece.spoken], source: [0, 0] }));
  for (const piece of outer || []) {
    const [spokenStart, spokenEnd] = piece.spoken;
    const [middleStart, middleEnd] = piece.source;
    if (spokenStart >= spokenEnd) continue;
    if (middleStart === middleEnd || !isIdentity(piece)) {
      const start = sourceBound(inner, middleStart, false);
      add(piece.spoken, [start, middleStart === middleEnd ? start : sourceBound(inner, middleEnd, true)]);
      continue;
    }
    for (let index = pieceIndexAt(inner, middleStart); index < inner.length && inner[index].spoken[0] < middleEnd; index += 1) {
      const part = inner[index];
      const from = Math.max(part.spoken[0], middleStart);
      const to = Math.min(part.spoken[1], middleEnd);
      if (from >= to) continue;
      const spoken = [spokenStart + (from - middleStart), spokenStart + (to - middleStart)];
      add(spoken, isIdentity(part) ? [part.source[0] + (from - part.spoken[0]), part.source[0] + (to - part.spoken[0])] : part.source);
    }
  }
  return pieces;
};

/**
 * The pieces over spoken [start, end), re-based to 0. An identity piece is
 * cut exactly; any other piece keeps its whole source range.
 */
export const sliceMap = (map, start, end) => {
  const pieces = [];
  for (const piece of map || []) {
    const from = Math.max(piece.spoken[0], start);
    const to = Math.min(piece.spoken[1], end);
    if (from >= to) continue;
    const source = isIdentity(piece)
      ? [piece.source[0] + (from - piece.spoken[0]), piece.source[0] + (to - piece.spoken[0])]
      : [...piece.source];
    pieces.push({ spoken: [from - start, to - start], source });
  }
  return pieces;
};

/**
 * `raw` with whitespace collapsed as `cleanText` does, plus where each raw
 * character went: `offsets[i]` is the clean index of raw character `i` (a
 * dropped character takes the clean index of the next kept one) and
 * `offsets[raw.length]` is the clean length.
 */
export const collapseWithOffsets = (raw) => {
  const source = String(raw ?? "");
  const offsets = new Array(source.length + 1);
  let text = "";
  let runStart = -1;
  for (let index = 0; index < source.length; index += 1) {
    if (/\s/u.test(source[index])) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0) {
      // A run between two kept characters is one space at its first
      // character; a leading run is dropped.
      let at = runStart;
      if (text) {
        offsets[at] = text.length;
        text += " ";
        at += 1;
      }
      for (; at < index; at += 1) offsets[at] = text.length;
      runStart = -1;
    }
    offsets[index] = text.length;
    text += source[index];
  }
  // A trailing run is dropped too.
  if (runStart >= 0) for (let at = runStart; at < source.length; at += 1) offsets[at] = text.length;
  offsets[source.length] = text.length;
  return { text, offsets };
};
