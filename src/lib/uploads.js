export const MAX_CUSTOM_DOCUMENTS = 500;
export const MAX_UPLOAD_FILES_PER_BATCH = 20;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Keep the complete custom-document corpus comfortably below the backup
// envelope ceiling. This is an aggregate budget, not merely a per-file check.
export const MAX_CUSTOM_DOCUMENT_BYTES = 16 * 1024 * 1024;

export const selectUploadFiles = (files, existingCount, existingBytes = 0) => {
  const offered = Array.from(files || []).slice(0, MAX_UPLOAD_FILES_PER_BATCH);
  const capacity = Math.max(0, MAX_CUSTOM_DOCUMENTS - Math.max(0, Number(existingCount) || 0));
  const valid = offered.filter((file) => /\.(md|markdown|txt|html?|epub)$/i.test(String(file?.name || "")) && Number(file?.size) <= MAX_UPLOAD_BYTES);
  let remainingBytes = Math.max(0, MAX_CUSTOM_DOCUMENT_BYTES - Math.max(0, Number(existingBytes) || 0));
  const accepted = [];
  valid.forEach((file) => {
    const size = Math.max(0, Number(file?.size) || 0);
    if (accepted.length >= capacity || size > remainingBytes) return;
    accepted.push(file);
    remainingBytes -= size;
  });
  return {
    offered,
    accepted,
    rejectedCount: offered.length - accepted.length,
    atCapacity: capacity === 0,
    byteCapacityReached: valid.length > accepted.length && accepted.length < capacity,
    remainingBytes,
  };
};

export const utf8Bytes = (value) => new TextEncoder().encode(String(value || "")).byteLength;

export const customDocumentBytes = (documents, excludingId = "") => (Array.isArray(documents) ? documents : [])
  .filter((document) => document?.id !== excludingId)
  .reduce((total, document) => total + utf8Bytes(document?.raw), 0);
