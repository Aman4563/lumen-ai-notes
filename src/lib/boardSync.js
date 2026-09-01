import { normalizeBoardDocument } from "./db.js";

export const BOARD_SYNC_CHANNEL = "lumen-board-sync-v1";
export const BOARD_SYNC_SIGNAL_KEY = "lumen-board-sync-signal-v1";

const stableString = (value) => JSON.stringify(value);
const equal = (left, right) => stableString(left) === stableString(right);

// Board conflict IDs only need to be stable across tabs; this is not an
// integrity or security boundary.
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const withoutSyncMeta = (board) => {
  const { syncMeta: _syncMeta, ...payload } = board || {};
  return payload;
};

export const boardPayloadEqual = (left, right) => equal(
  withoutSyncMeta(normalizeBoardDocument(left)),
  withoutSyncMeta(normalizeBoardDocument(right)),
);

const chooseWinner = (left, right) => stableString(left) >= stableString(right) ? left : right;

const mergeOrderedIds = (baseItems, localItems, remoteItems) => {
  const baseIds = baseItems.map((item) => item.id);
  const baseSet = new Set(baseIds);
  const localAdditions = localItems.map((item) => item.id).filter((id) => !baseSet.has(id));
  const remoteAdditions = remoteItems.map((item) => item.id).filter((id) => !baseSet.has(id));
  const groups = [localAdditions, remoteAdditions].sort((left, right) => stableString(left).localeCompare(stableString(right)));
  return [...new Set([...baseIds, ...groups[0], ...groups[1]])];
};

const scalarMerge = (base, local, remote) => {
  const localChanged = !equal(local, base);
  const remoteChanged = !equal(remote, base);
  if (!localChanged) return { value: remote, conflict: false };
  if (!remoteChanged || equal(local, remote)) return { value: local, conflict: false };
  return { value: chooseWinner(local, remote), conflict: true };
};

const conflictRecord = ({ kind, pageId = "", objectId = "", preservedId = "", detectedAt, fingerprint = "" }) => ({
  id: `board-sync-${stableHash(`${kind}\u0000${pageId}\u0000${objectId}\u0000${preservedId}\u0000${fingerprint}`)}`,
  kind,
  pageId,
  objectId,
  preservedId,
  detectedAt,
});

const recoveredObject = (object, pageId, originalId, fingerprint) => ({
  ...object,
  id: `sync-recovered-${stableHash(`${pageId}\u0000${originalId}\u0000${fingerprint}`)}`,
  // A small offset makes two conflicting text/shape versions inspectable
  // instead of rendering at precisely the same coordinates.
  points: object.points.map((point) => ({
    x: Math.max(0, Math.min(1, point.x + 0.014)),
    y: Math.max(0, Math.min(1, point.y + 0.014)),
  })),
});

const mergeObjects = (pageId, baseItems, localItems, remoteItems, detectedAt) => {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  const records = new Map();
  const conflicts = [];

  mergeOrderedIds(baseItems, localItems, remoteItems).forEach((id) => {
    const baseHas = base.has(id);
    const localHas = local.has(id);
    const remoteHas = remote.has(id);
    const baseItem = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);

    if (!baseHas) {
      if (localHas && remoteHas && !equal(localItem, remoteItem)) {
        const winner = chooseWinner(localItem, remoteItem);
        const loser = winner === localItem ? remoteItem : localItem;
        const fingerprint = stableString(loser);
        const recovered = recoveredObject(loser, pageId, id, fingerprint);
        records.set(id, winner);
        records.set(recovered.id, recovered);
        conflicts.push(conflictRecord({ kind: "concurrent-object-create", pageId, objectId: id, preservedId: recovered.id, detectedAt, fingerprint }));
      } else if (localHas) records.set(id, localItem);
      else if (remoteHas) records.set(id, remoteItem);
      return;
    }

    if (!localHas && !remoteHas) return;
    if (!localHas) {
      // An edit is retained when it races a deletion. A deletion is applied
      // only if the other tab still has the common-base version.
      if (!equal(remoteItem, baseItem)) {
        records.set(id, remoteItem);
        conflicts.push(conflictRecord({ kind: "object-delete-vs-update", pageId, objectId: id, detectedAt, fingerprint: stableString(remoteItem) }));
      }
      return;
    }
    if (!remoteHas) {
      if (!equal(localItem, baseItem)) {
        records.set(id, localItem);
        conflicts.push(conflictRecord({ kind: "object-delete-vs-update", pageId, objectId: id, detectedAt, fingerprint: stableString(localItem) }));
      }
      return;
    }

    const localChanged = !equal(localItem, baseItem);
    const remoteChanged = !equal(remoteItem, baseItem);
    if (!localChanged) records.set(id, remoteItem);
    else if (!remoteChanged || equal(localItem, remoteItem)) records.set(id, localItem);
    else {
      const winner = chooseWinner(localItem, remoteItem);
      const loser = winner === localItem ? remoteItem : localItem;
      const fingerprint = stableString(loser);
      const recovered = recoveredObject(loser, pageId, id, fingerprint);
      records.set(id, winner);
      if (!records.has(recovered.id)) records.set(recovered.id, recovered);
      conflicts.push(conflictRecord({ kind: "concurrent-object-update", pageId, objectId: id, preservedId: recovered.id, detectedAt, fingerprint }));
    }
  });

  // Recovery objects are inserted immediately after their source object when
  // possible, while all ordinary z-order remains stable.
  const ordered = [];
  const recoveredBySource = new Map();
  conflicts.forEach((conflict) => {
    if (!conflict.preservedId) return;
    const recovered = records.get(conflict.preservedId);
    if (!recovered) return;
    const group = recoveredBySource.get(conflict.objectId) || [];
    if (!group.some((item) => item.id === recovered.id)) group.push(recovered);
    recoveredBySource.set(conflict.objectId, group);
  });
  mergeOrderedIds(baseItems, localItems, remoteItems).forEach((id) => {
    if (records.has(id)) ordered.push(records.get(id));
    (recoveredBySource.get(id) || [])
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((item) => ordered.push(item));
  });
  const included = new Set(ordered.map((item) => item.id));
  records.forEach((item) => {
    if (!included.has(item.id)) {
      ordered.push(item);
      included.add(item.id);
    }
  });
  return { records: ordered, conflicts };
};

const mergePage = (basePage, localPage, remotePage, detectedAt) => {
  const pageId = localPage?.id || remotePage?.id || basePage?.id;
  const base = basePage || { id: pageId, name: "", objects: [] };
  const local = localPage || base;
  const remote = remotePage || base;
  const name = scalarMerge(base.name, local.name, remote.name);
  const objects = mergeObjects(pageId, base.objects || [], local.objects || [], remote.objects || [], detectedAt);
  const conflicts = [...objects.conflicts];
  if (name.conflict) {
    const loser = name.value === local.name ? remote.name : local.name;
    conflicts.push(conflictRecord({ kind: "concurrent-page-rename", pageId, detectedAt, fingerprint: String(loser) }));
  }
  return { page: { id: pageId, name: name.value || "Untitled page", objects: objects.records }, conflicts };
};

const mergePages = (baseItems, localItems, remoteItems, detectedAt) => {
  const base = new Map(baseItems.map((page) => [page.id, page]));
  const local = new Map(localItems.map((page) => [page.id, page]));
  const remote = new Map(remoteItems.map((page) => [page.id, page]));
  const pages = [];
  const conflicts = [];

  mergeOrderedIds(baseItems, localItems, remoteItems).forEach((id) => {
    const baseHas = base.has(id);
    const localHas = local.has(id);
    const remoteHas = remote.has(id);
    const basePage = base.get(id);
    const localPage = local.get(id);
    const remotePage = remote.get(id);

    if (!baseHas) {
      if (localHas && remoteHas) {
        const result = mergePage(null, localPage, remotePage, detectedAt);
        pages.push(result.page);
        conflicts.push(...result.conflicts);
      } else if (localHas) pages.push(localPage);
      else if (remoteHas) pages.push(remotePage);
      return;
    }
    if (!localHas && !remoteHas) return;
    if (!localHas) {
      if (!equal(remotePage, basePage)) {
        pages.push(remotePage);
        conflicts.push(conflictRecord({ kind: "page-delete-vs-update", pageId: id, detectedAt, fingerprint: stableString(remotePage) }));
      }
      return;
    }
    if (!remoteHas) {
      if (!equal(localPage, basePage)) {
        pages.push(localPage);
        conflicts.push(conflictRecord({ kind: "page-delete-vs-update", pageId: id, detectedAt, fingerprint: stableString(localPage) }));
      }
      return;
    }

    const result = mergePage(basePage, localPage, remotePage, detectedAt);
    pages.push(result.page);
    conflicts.push(...result.conflicts);
  });
  return { pages, conflicts };
};

const mergeConflictHistory = (...groups) => {
  const byId = new Map();
  groups.flat().forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  return [...byId.values()].slice(-100);
};

/**
 * Three-way, record-aware whiteboard merge.
 *
 * `base` is the last snapshot observed by this tab, `local` is its current
 * state, and `remote` is read inside the same IndexedDB write transaction that
 * stores the result. Unique pages/objects are unioned. An edit wins over a
 * concurrent deletion, and different edits of one object preserve a recovered
 * copy so neither drawing or text payload silently disappears.
 */
export const mergeBoardVersions = (baseValue, localValue, remoteValue, options = {}) => {
  const base = normalizeBoardDocument(baseValue);
  const local = normalizeBoardDocument(localValue);
  const remote = remoteValue === undefined || remoteValue === null ? base : normalizeBoardDocument(remoteValue);
  const detectedAt = options.now || new Date().toISOString();
  const advanceRevision = options.advanceRevision !== false;
  const pages = mergePages(base.pages, local.pages, remote.pages, detectedAt);
  const background = scalarMerge(base.background, local.background, remote.background);
  const activePageId = scalarMerge(base.activePageId, local.activePageId, remote.activePageId);
  const conflicts = [...pages.conflicts];
  if (background.conflict) conflicts.push(conflictRecord({ kind: "concurrent-background-change", detectedAt, fingerprint: `${local.background}\u0000${remote.background}` }));

  const maximumRevision = Math.max(
    Number(base.syncMeta?.revision) || 0,
    Number(local.syncMeta?.revision) || 0,
    Number(remote.syncMeta?.revision) || 0,
  );
  const validPageIds = new Set(pages.pages.map((page) => page.id));
  const selectedPageId = [activePageId.value, remote.activePageId, local.activePageId, base.activePageId]
    .find((id) => validPageIds.has(id)) || pages.pages[0]?.id;
  const board = normalizeBoardDocument({
    version: 2,
    activePageId: selectedPageId,
    background: background.value,
    pages: pages.pages,
    syncMeta: {
      revision: advanceRevision ? Math.min(Number.MAX_SAFE_INTEGER, maximumRevision + 1) : maximumRevision,
      updatedAt: advanceRevision ? detectedAt : [base.syncMeta?.updatedAt, local.syncMeta?.updatedAt, remote.syncMeta?.updatedAt].filter(Boolean).sort().at(-1) || "",
      writerId: advanceRevision ? String(options.writerId || "").slice(0, 200) : (remote.syncMeta?.writerId || local.syncMeta?.writerId || ""),
      conflicts: mergeConflictHistory(base.syncMeta?.conflicts, local.syncMeta?.conflicts, remote.syncMeta?.conflicts, conflicts),
    },
  });
  return { board, conflicts };
};
