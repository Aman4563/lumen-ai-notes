import { slugifyHeading } from "./markdown.js";

/**
 * Link targets and heading anchors, shared by the Reader and the link audit so
 * a link the audit calls valid is one the Reader opens. Pure and DOM-free, so
 * Node suites run the exact functions the app does; its one import,
 * slugifyHeading, is already startup code.
 */

/** The document id a relative `.md` link opens, or null when it names none. */
export const resolveDocumentLink = (currentPath, href) => {
  if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return null;
  const cleanHref = href.split("#")[0];
  if (!cleanHref.endsWith(".md")) return null;
  try {
    const base = new URL(currentPath, "https://lumen.local/");
    const resolved = new URL(cleanHref, base);
    return resolved.pathname.replace(/^\//, "");
  } catch {
    return null;
  }
};

/** A fragment as the browser reads it; a malformed escape keeps its raw text. */
const decodeFragment = (fragment) => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
};

/**
 * Where a link points, for the Reader and the audit to act on:
 * - `{ documentId, anchor }` — a lecture or note (anchor "" without a fragment);
 * - `{ anchor }` — a heading in the current lecture (`#…`; the anchor may be "");
 * - `{ notADocument: true }` — a relative link that is neither;
 * - null — a link with a scheme, which is the browser's to follow.
 * Anchors are percent-decoded, so they compare against heading ids directly.
 */
export const linkTarget = (currentPath, href) => {
  const link = typeof href === "string" ? href : "";
  const hash = link.indexOf("#");
  const anchor = hash < 0 ? "" : decodeFragment(link.slice(hash + 1));
  if (link.startsWith("#")) return { anchor };
  const documentId = resolveDocumentLink(currentPath, link);
  if (documentId !== null) return { documentId, anchor };
  return link.includes(":") ? null : { notADocument: true };
};

/** What the Reader and Teaching Mode say when a link has nowhere to take the learner. */
export const LINK_NOTICES = Object.freeze({
  missingSection: "That section isn't in this lecture.",
  notADocument: "That link isn't a lecture or note, so it can't open here.",
});

/** Fenced code emptied but its line breaks kept, so line numbers survive. */
const blankFences = (markdown) => String(markdown || "").replace(/```[\s\S]*?```/g, (fence) => fence.replace(/[^\n]/g, ""));

/** Approximates rendered heading text: link/emphasis markers removed. */
const headingText = (line) => line
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_~`]/g, "")
  .trim();

/**
 * The h2/h3 headings one document exposes, in order, as the Reader numbers
 * them: `id` is the slug, duplicate-suffixed (-2, -3); `line` is the heading's
 * 0-based source line. Headings inside code fences do not count, but the
 * fences' lines still do.
 */
export const headingAnchors = (markdown) => {
  const anchors = [];
  const counts = new Map();
  for (const [line, text] of blankFences(markdown).split("\n").entries()) {
    // A lecture saved with CRLF line endings leaves a "\r" on each line; it is not part of the heading.
    const match = text.replace(/\r$/, "").match(/^(##|###)\s+(.+)$/);
    if (!match) continue;
    const base = slugifyHeading(headingText(match[2]), anchors.length);
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    anchors.push({ id: seen === 0 ? base : `${base}-${seen + 1}`, line });
  }
  return anchors;
};

/** The anchor ids one document exposes, for checking a link's fragment. */
export const documentAnchorIds = (markdown) => headingAnchors(markdown).map((heading) => heading.id);

/**
 * The Teaching Mode slide that holds the heading a link names, and that
 * heading's ordinal among the slide's h2/h3 headings; null when no heading has
 * that id. `sections` come from splitTeachingSections, which also starts a slide
 * at a "## " line inside a code fence, so slides are matched to headings by
 * source line rather than by counting headings. Joined with "\n" the sections
 * are the source less a blank intro (which holds no heading).
 */
export const teachingSlideForAnchor = (sections, anchor) => {
  const headings = headingAnchors(sections.map((section) => section.markdown).join("\n"));
  const target = headings.find((heading) => heading.id === anchor);
  if (!target) return null;
  let start = 0;
  for (const [index, section] of sections.entries()) {
    const end = start + section.markdown.split("\n").length;
    if (target.line < end) {
      return { index, ordinal: headings.filter((heading) => heading.line >= start && heading.line < target.line).length };
    }
    start = end;
  }
  return null;
};
