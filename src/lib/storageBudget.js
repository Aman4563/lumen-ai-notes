export const MAX_OWNED_DATA_BYTES = 20 * 1024 * 1024;
export const MAX_BOARD_RECORDS = 250;

const encoder = new TextEncoder();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const isOwnedDataKey = (key) => key === "profile" || (typeof key === "string" && key.startsWith("board:"));

export class StorageBudgetError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StorageBudgetError";
    this.code = details.code || "STORAGE_BUDGET";
    this.details = details;
  }
}

export const jsonBytes = (value) => {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch (error) {
    throw new StorageBudgetError("This change cannot be serialized for durable storage.", { code: "UNSERIALIZABLE", cause: error?.message });
  }
};

export const ownedRecords = (records) => Object.fromEntries(
  Object.entries(isRecord(records) ? records : {}).filter(([key]) => isOwnedDataKey(key)),
);

/**
 * Reconstruct the exact JSON byte size of an object from the serialized byte
 * size of each value. Object key order does not affect its serialized size.
 * This lets the durable store update one record without serializing every
 * other whiteboard on each autosave.
 */
export const summarizeOwnedRecordBytes = (recordBytes) => {
  const normalized = Object.fromEntries(
    Object.entries(isRecord(recordBytes) ? recordBytes : {})
      .filter(([key, bytes]) => isOwnedDataKey(key) && Number.isSafeInteger(bytes) && bytes >= 0),
  );
  const keys = Object.keys(normalized);
  const membersBytes = keys.reduce((total, key) => total + jsonBytes(key) + 1 + normalized[key], 0);
  return {
    bytes: 2 + membersBytes + Math.max(0, keys.length - 1),
    boardRecords: keys.filter((key) => key.startsWith("board:")).length,
    recordBytes: normalized,
  };
};

export const summarizeOwnedData = (records) => {
  const owned = ownedRecords(records);
  const keys = Object.keys(owned);
  return {
    bytes: jsonBytes(owned),
    boardRecords: keys.filter((key) => key.startsWith("board:")).length,
    recordBytes: Object.fromEntries(keys.map((key) => [key, jsonBytes(owned[key])])),
  };
};

export const assertOwnedDataBudget = (records, options = {}) => {
  const maximumBytes = Number.isFinite(options.maximumBytes) ? options.maximumBytes : MAX_OWNED_DATA_BYTES;
  const maximumBoards = Number.isFinite(options.maximumBoards) ? options.maximumBoards : MAX_BOARD_RECORDS;
  const summary = summarizeOwnedData(records);
  if (summary.boardRecords > maximumBoards) {
    throw new StorageBudgetError(`Lumen supports at most ${maximumBoards} durable whiteboards so every workspace remains recoverable.`, {
      code: "BOARD_LIMIT",
      boardRecords: summary.boardRecords,
      maximumBoards,
    });
  }
  if (summary.bytes > maximumBytes) {
    throw new StorageBudgetError(`This change would exceed Lumen’s ${Math.floor(maximumBytes / (1024 * 1024))} MB backup-safe workspace budget. Export or remove unneeded local material first.`, {
      code: "BYTE_LIMIT",
      bytes: summary.bytes,
      maximumBytes,
    });
  }
  return summary;
};

/**
 * Enforce the cap on net growth, not merely on the resulting state. This is
 * important for users carrying a workspace created before the cap existed:
 * an oversized legacy workspace remains readable and may be reduced, but it
 * cannot grow farther beyond either limit.
 */
export const assertOwnedDataBudgetTransition = (current, next, options = {}) => {
  const maximumBytes = Number.isFinite(options.maximumBytes) ? options.maximumBytes : MAX_OWNED_DATA_BYTES;
  const maximumBoards = Number.isFinite(options.maximumBoards) ? options.maximumBoards : MAX_BOARD_RECORDS;
  const currentSummary = current?.recordBytes ? summarizeOwnedRecordBytes(current.recordBytes) : summarizeOwnedData(current);
  const nextSummary = next?.recordBytes ? summarizeOwnedRecordBytes(next.recordBytes) : summarizeOwnedData(next);

  if (nextSummary.boardRecords > maximumBoards && nextSummary.boardRecords > currentSummary.boardRecords) {
    throw new StorageBudgetError(`Lumen supports at most ${maximumBoards} durable whiteboards so every workspace remains recoverable.`, {
      code: "BOARD_LIMIT",
      boardRecords: nextSummary.boardRecords,
      previousBoardRecords: currentSummary.boardRecords,
      maximumBoards,
    });
  }
  if (nextSummary.bytes > maximumBytes && nextSummary.bytes > currentSummary.bytes) {
    throw new StorageBudgetError(`This change would exceed Lumen’s ${Math.floor(maximumBytes / (1024 * 1024))} MB backup-safe workspace budget. Export or remove unneeded local material first.`, {
      code: "BYTE_LIMIT",
      bytes: nextSummary.bytes,
      previousBytes: currentSummary.bytes,
      maximumBytes,
    });
  }
  return nextSummary;
};
