import { createId } from "./id.js";

/**
 * Wave-7 content operations (CONTENT-001 / DATA-003 slices): recoverable
 * trash, the bounded activity log, upload duplicate detection, and bounded
 * document revisions. Everything here is pure — callers pass `now` (and the
 * profile slices) so tests stay deterministic, and the profile normalizer in
 * db.js owns the durable bounds these helpers respect.
 */
export const TRASH_RETENTION_DAYS = 30;
export const MAX_TRASH_ENTRIES = 100;
export const MAX_ACTIVITY_ENTRIES = 500;
export const MAX_REVISIONS_PER_DOCUMENT = 5;
export const MAX_REVISIONS_TOTAL = 60;

/** Whitespace-insensitive content identity for duplicate upload detection. */
const contentFingerprint = (raw) => String(raw || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();

export const findDuplicateDocument = (customDocuments, raw) => {
  const fingerprint = contentFingerprint(raw);
  if (!fingerprint) return null;
  return (customDocuments || []).find((doc) => contentFingerprint(doc.raw) === fingerprint) || null;
};

export const trashEntryForDocument = (doc, now = new Date()) => ({
  id: `trash-${createId()}`,
  documentId: doc.id,
  title: doc.title || "Untitled note",
  raw: doc.raw,
  tags: [...(doc.tags || [])],
  collectionId: doc.collectionId || "",
  deletedAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

export const addTrashEntry = (trash, entry) => [entry, ...(trash || [])].slice(0, MAX_TRASH_ENTRIES);

export const purgeExpiredTrash = (trash, now = new Date(), retentionDays = TRASH_RETENTION_DAYS) => {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  return (trash || []).filter((entry) => {
    const deletedAt = Date.parse(entry.deletedAt);
    return Number.isFinite(deletedAt) && deletedAt >= cutoff;
  });
};

/**
 * Restoring reuses the trashed content under a NEW document id: the original
 * id sits in the monotone deletedCustomDocumentIds tombstone union, so a
 * same-id restore would be re-deleted by any concurrent tab's merge.
 */
export const documentFromTrashEntry = (entry, now = new Date()) => ({
  id: `custom/${createId()}.md`,
  title: entry.title,
  raw: entry.raw,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  tags: [...(entry.tags || [])],
  collectionId: entry.collectionId || "",
  archived: false,
  pinned: false,
});

export const activityEntry = ({ kind, label = "", refId = "" }, now = new Date()) => ({
  id: `act-${createId()}`,
  at: now.toISOString(),
  kind,
  label,
  refId,
  updatedAt: now.toISOString(),
});

export const recordActivityEntry = (activity, event, now = new Date()) => (
  [activityEntry(event, now), ...(activity || [])].slice(0, MAX_ACTIVITY_ENTRIES)
);

export const revisionForDocument = (documentId, text, label, now = new Date()) => ({
  id: `rev-${createId()}`,
  documentId,
  text: String(text || ""),
  label: String(label || "").slice(0, 120),
  savedAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

/**
 * Newest-first append honoring both bounds: per-document (oldest of the same
 * document rolls off first) and global (oldest overall rolls off).
 */
export const appendRevision = (revisions, revision) => {
  const next = [revision, ...(revisions || [])]
    .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)) || String(right.id).localeCompare(String(left.id)));
  const perDocument = new Map();
  const kept = [];
  for (const entry of next) {
    const count = perDocument.get(entry.documentId) || 0;
    if (count >= MAX_REVISIONS_PER_DOCUMENT) continue;
    perDocument.set(entry.documentId, count + 1);
    kept.push(entry);
    if (kept.length >= MAX_REVISIONS_TOTAL) break;
  }
  return kept;
};
