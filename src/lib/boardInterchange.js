import { normalizeBoardDocument } from "./db.js";
import { createId } from "./id.js";

/**
 * Whiteboard JSON interchange `lumen.board.v1` (BOARD-003, issue #11).
 * Export carries authoring content only — background, page names, each
 * page's optional authoring size (issue #55; files without one still import
 * and adopt the importing canvas), objects with their lock state and
 * rotation — never ids, sync metadata, or the active page.
 * Import appends pages to the current board (undoable through the normal
 * history path), regenerates every id, and funnels all content through the
 * hardened normalizeBoardDocument as its validator.
 */
export const BOARD_INTERCHANGE_FORMAT = "lumen.board.v1";
export const MAX_INTERCHANGE_TEXT_BYTES = 5_000_000;
const EDITOR_PAGE_CAP = 20;

export const exportBoardDocument = (board, { title = "", exportedAt = new Date() } = {}) => ({
  format: BOARD_INTERCHANGE_FORMAT,
  exportedAt: exportedAt.toISOString(),
  title: String(title || "").slice(0, 200),
  background: ["grid", "dots", "plain"].includes(board.background) ? board.background : "grid",
  pages: (board.pages || []).map((page) => ({
    name: String(page.name || "Page").slice(0, 60),
    ...(page.size ? { size: { width: page.size.width, height: page.size.height } } : {}),
    objects: (page.objects || []).map((object) => ({
      tool: object.tool,
      color: object.color,
      fill: object.fill,
      width: object.width,
      fontSize: object.fontSize,
      text: object.text,
      locked: object.locked === true,
      ...(object.rotation ? { rotation: object.rotation } : {}),
      points: object.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  })),
});

export const parseBoardInterchange = (jsonText) => {
  if (typeof jsonText !== "string" || jsonText.length > MAX_INTERCHANGE_TEXT_BYTES) {
    return { ok: false, error: "Board files are limited to 5 MB of JSON." };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== BOARD_INTERCHANGE_FORMAT) {
    return { ok: false, error: `Expected a "${BOARD_INTERCHANGE_FORMAT}" board file.` };
  }
  if (!Array.isArray(parsed.pages) || !parsed.pages.length) {
    return { ok: false, error: "The board file has no pages." };
  }
  // Normalize through the same hardened path stored boards use: bounds,
  // tool/color validation, point clamping, and the locked flag all apply.
  const normalized = normalizeBoardDocument({
    version: 2,
    activePageId: "",
    background: parsed.background,
    pages: parsed.pages.map((page) => ({
      id: createId(),
      name: typeof page?.name === "string" ? page.name.slice(0, 60) : "Imported page",
      size: page?.size,
      objects: Array.isArray(page?.objects) ? page.objects : [],
    })),
  });
  const pages = normalized.pages
    .filter((page) => page.objects.length || parsed.pages.length === 1)
    .map((page) => ({
      ...page,
      id: createId(),
      objects: page.objects.map((object) => ({ ...object, id: createId() })),
    }));
  if (!pages.length) return { ok: false, error: "The board file contains no drawable objects." };
  return { ok: true, title: typeof parsed.title === "string" ? parsed.title.slice(0, 200) : "", pages };
};

/** Appends imported pages within the 20-page editor cap. */
export const mergeImportedPages = (board, importedPages) => {
  const room = Math.max(0, EDITOR_PAGE_CAP - board.pages.length);
  const admitted = importedPages.slice(0, room);
  if (!admitted.length) return { board, added: 0, skipped: importedPages.length };
  const renamed = admitted.map((page, index) => ({
    ...page,
    name: board.pages.some((existing) => existing.name === page.name)
      ? `${page.name} (imported${index ? ` ${index + 1}` : ""})`.slice(0, 60)
      : page.name,
  }));
  return {
    board: { ...board, pages: [...board.pages, ...renamed], activePageId: renamed[0].id },
    added: renamed.length,
    skipped: importedPages.length - admitted.length,
  };
};
