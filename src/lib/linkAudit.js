import { documentAnchorIds, linkTarget } from "./links.js";

// The anchor ids live with the Reader-side link rule; re-exported for existing importers.
export { documentAnchorIds };

/**
 * Broken-internal-link audit (CONTENT-001, issue #12). Scans the learner's
 * OWN content — custom documents and edited built-in copies — because
 * shipped built-ins are already gated at generation time. The verdict comes
 * from linkTarget and documentAnchorIds, the rule the Reader acts on, so a
 * link reported broken here is exactly a link that fails when clicked in the
 * Reader.
 */
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const stripFences = (markdown) => String(markdown || "").replace(/```[\s\S]*?```/g, "");

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
    const target = linkTarget(documentId, href);
    if (target === null) continue;
    if (target.notADocument) {
      // Non-.md relative links can never open in the Reader.
      findings.push({ documentId, href, label: label.slice(0, 120), kind: "not-a-document" });
      continue;
    }
    if (!("documentId" in target)) {
      // An in-page link: the heading has to exist in this document.
      const anchors = anchorsFor?.(documentId);
      if (anchors && !anchors.includes(target.anchor)) {
        findings.push({ documentId, href, label: label.slice(0, 120), kind: "missing-anchor" });
      }
      continue;
    }
    const targetId = target.documentId;
    if (!knownIds.has(targetId)) {
      findings.push({ documentId, href, label: label.slice(0, 120), kind: "missing-document", targetId });
      continue;
    }
    if (target.anchor) {
      const anchors = anchorsFor?.(targetId);
      if (anchors && !anchors.includes(target.anchor)) {
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
