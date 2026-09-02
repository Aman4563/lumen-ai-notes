import { resolveDocumentLink } from "./links.js";
import { slugifyHeading } from "./markdown.js";

/**
 * Broken-internal-link audit (CONTENT-001, issue #12). Scans the learner's
 * OWN content — custom documents and edited built-in copies — because
 * shipped built-ins are already gated at generation time. The verdict reuses
 * resolveDocumentLink and slugifyHeading, so a link reported broken here is
 * exactly a link that fails when clicked in the Reader.
 */
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const stripFences = (markdown) => String(markdown || "").replace(/```[\s\S]*?```/g, "");

/** Approximates rendered heading text: link/emphasis markers removed. */
const headingText = (line) => line
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_~`]/g, "")
  .trim();

/** The h2/h3 anchor ids one document exposes, duplicate-suffixed in order. */
export const documentAnchorIds = (markdown) => {
  const ids = [];
  const counts = new Map();
  let index = 0;
  for (const line of stripFences(markdown).split("\n")) {
    const match = line.match(/^(##|###)\s+(.+)$/);
    if (!match) continue;
    const base = slugifyHeading(headingText(match[2]), index);
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    ids.push(seen === 0 ? base : `${base}-${seen + 1}`);
    index += 1;
  }
  return ids;
};

/**
 * Audits one document's markdown. `knownIds` is the set of every openable
 * document id (built-in and custom); `anchorsFor(id)` lazily returns the
 * anchor ids of a target document when a fragment needs checking.
 */
export const auditDocumentLinks = (documentId, markdown, knownIds, anchorsFor) => {
  const findings = [];
  const source = stripFences(markdown);
  for (const match of source.matchAll(LINK_PATTERN)) {
    const [, label, href] = match;
    if (/^(https?:|mailto:|tel:)/i.test(href)) continue;
    if (href.startsWith("#")) {
      const anchors = anchorsFor?.(documentId);
      if (anchors && !anchors.includes(href.slice(1))) {
        findings.push({ documentId, href, label: label.slice(0, 120), kind: "missing-anchor" });
      }
      continue;
    }
    const targetId = resolveDocumentLink(documentId, href);
    if (targetId === null) {
      // Non-.md relative links can never open in the Reader.
      if (!href.endsWith(".md") && !href.includes(":")) {
        findings.push({ documentId, href, label: label.slice(0, 120), kind: "not-a-document" });
      }
      continue;
    }
    if (!knownIds.has(targetId)) {
      findings.push({ documentId, href, label: label.slice(0, 120), kind: "missing-document", targetId });
      continue;
    }
    const fragment = href.split("#")[1];
    if (fragment) {
      const anchors = anchorsFor?.(targetId);
      if (anchors && !anchors.includes(fragment)) {
        findings.push({ documentId, href, label: label.slice(0, 120), kind: "missing-anchor", targetId });
      }
    }
  }
  return findings;
};

/**
 * Full learner-content sweep: custom documents plus edited built-in copies.
 * `sources` maps documentId → markdown for everything scannable.
 */
export const auditLearnerLinks = ({ customDocuments = [], edits = {}, knownIds, loadedSources = new Map() }) => {
  const sourceById = new Map(loadedSources);
  for (const document of customDocuments) sourceById.set(document.id, document.raw);
  for (const [id, raw] of Object.entries(edits)) sourceById.set(id, raw);
  const anchorCache = new Map();
  const anchorsFor = (id) => {
    if (!anchorCache.has(id)) {
      const source = sourceById.get(id);
      anchorCache.set(id, typeof source === "string" ? documentAnchorIds(source) : null);
    }
    return anchorCache.get(id);
  };
  const findings = [];
  let scanned = 0;
  for (const document of customDocuments) {
    findings.push(...auditDocumentLinks(document.id, document.raw, knownIds, anchorsFor));
    scanned += 1;
  }
  for (const [id, raw] of Object.entries(edits)) {
    findings.push(...auditDocumentLinks(id, raw, knownIds, anchorsFor));
    scanned += 1;
  }
  return { findings: findings.slice(0, 200), scanned };
};
