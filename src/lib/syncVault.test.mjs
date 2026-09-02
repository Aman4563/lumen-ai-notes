import assert from "node:assert/strict";
import { test } from "node:test";

import { initialProfile, normalizeProfile } from "./db.js";
import { canonicalStringify } from "./backup.js";
import {
  adoptVaultConfig,
  checkSyncHeader,
  clearVaultConfig,
  createVaultConfig,
  foldPeerSnapshots,
  getDeviceId,
  loadSyncBaseline,
  readVaultConfig,
  recordVaultSync,
  saveSyncBaseline,
  syncFileNameFor,
} from "./syncVault.js";

const NOW = "2026-09-02T12:00:00.000Z";

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const documentRecord = (id, title) => ({ id, title, raw: `# ${title}\n\nBody.`, createdAt: NOW, updatedAt: NOW, tags: [] });

const deviceProfile = (base, documents, extra = {}) => normalizeProfile({ ...base, customDocuments: documents, ...extra });

test("device identity is durable, validated, and survives corrupt storage", () => {
  const storage = fakeStorage();
  const first = getDeviceId(storage);
  assert.equal(getDeviceId(storage), first, "the id must persist");
  storage.setItem("lumen-device-id-v1", "<script>nope</script>");
  const replaced = getDeviceId(storage);
  assert.notEqual(replaced, "<script>nope</script>", "corrupt ids are replaced, never trusted");
  assert.match(syncFileNameFor(replaced), /\.lumenc$/);
});

test("vault config lifecycle: create, adopt, stamp, leave", () => {
  const storage = fakeStorage();
  assert.equal(readVaultConfig(storage), null);
  const created = createVaultConfig(storage, new Date(NOW));
  assert.equal(readVaultConfig(storage).vaultId, created.vaultId);
  const stamped = recordVaultSync(storage, new Date("2026-09-03T08:00:00.000Z"));
  assert.equal(stamped.lastSyncAt, "2026-09-03T08:00:00.000Z");
  adoptVaultConfig("peer-vault-id-123", storage, new Date(NOW));
  assert.equal(readVaultConfig(storage).vaultId, "peer-vault-id-123");
  clearVaultConfig(storage);
  assert.equal(readVaultConfig(storage), null);
  storage.setItem("lumen-sync-vault-v1", "{broken json");
  assert.equal(readVaultConfig(storage), null, "corrupt config reads as no vault");
});

test("header admission: backups, foreign vaults, and own files are refused typed", () => {
  const identity = { vaultId: "vault-1", deviceId: "device-a" };
  assert.equal(checkSyncHeader({ format: "lumen.backup.enc.v1" }, identity).code, "NOT_SYNC_FILE");
  assert.equal(checkSyncHeader({ vaultId: "vault-2", deviceId: "device-b" }, identity).code, "VAULT_MISMATCH");
  assert.equal(checkSyncHeader({ vaultId: "vault-1", deviceId: "device-a" }, identity).code, "OWN_FILE");
  assert.deepEqual(checkSyncHeader({ vaultId: "vault-1", deviceId: "device-b" }, identity), { ok: true, deviceId: "device-b" });
});

test("folding two peers converges regardless of file-selection order", () => {
  const base = normalizeProfile(initialProfile);
  const local = deviceProfile(base, [documentRecord("custom/c.md", "From C")]);
  const peerA = { deviceId: "device-a", records: { profile: deviceProfile(base, [documentRecord("custom/a.md", "From A")]) } };
  const peerB = { deviceId: "device-b", records: { profile: deviceProfile(base, [documentRecord("custom/b.md", "From B")]) } };

  const forward = foldPeerSnapshots({ baselineRecords: { profile: base }, localRecords: { profile: local }, peers: [peerA, peerB], now: NOW });
  const reversed = foldPeerSnapshots({ baselineRecords: { profile: base }, localRecords: { profile: local }, peers: [peerB, peerA], now: NOW });
  assert.equal(canonicalStringify(forward.profile), canonicalStringify(reversed.profile), "fold order is deviceId-sorted, not selection-ordered");
  assert.deepEqual(new Set(forward.profile.customDocuments.map((doc) => doc.id)), new Set(["custom/a.md", "custom/b.md", "custom/c.md"]));
  assert.equal(forward.replacementApplied, false);
  assert.equal(forward.peersFolded, 2);
});

test("a peer's deletion travels by tombstone instead of resurrecting", () => {
  const shared = documentRecord("custom/shared.md", "Shared");
  const base = normalizeProfile({ ...initialProfile, customDocuments: [shared] });
  const local = normalizeProfile(base);
  const peerDeleted = normalizeProfile({ ...base, customDocuments: [], deletedCustomDocumentIds: ["custom/shared.md"] });

  const folded = foldPeerSnapshots({ baselineRecords: { profile: base }, localRecords: { profile: local }, peers: [{ deviceId: "device-b", records: { profile: peerDeleted } }], now: NOW });
  assert.equal(folded.profile.customDocuments.length, 0, "the tombstoned document must not come back");
  assert.ok(folded.profile.deletedCustomDocumentIds.includes("custom/shared.md"));
});

test("a peer reset/restore fences the fold and later stale peers cannot resurrect", () => {
  const base = normalizeProfile({ ...initialProfile, customDocuments: [documentRecord("custom/old.md", "Old world")] });
  const local = normalizeProfile(base);
  const replacement = normalizeProfile({
    ...initialProfile,
    customDocuments: [documentRecord("custom/new.md", "New world")],
    syncMeta: { ...initialProfile.syncMeta, generation: "generation-2", replacedAt: "2026-09-02T11:00:00.000Z", replacementReason: "restore" },
  });
  const stalePeer = normalizeProfile({ ...base, customDocuments: [...base.customDocuments, documentRecord("custom/stale.md", "Stale addition")] });

  const folded = foldPeerSnapshots({
    baselineRecords: { profile: base },
    localRecords: { profile: local },
    peers: [
      { deviceId: "device-a", records: { profile: replacement } },
      { deviceId: "device-z", records: { profile: stalePeer } },
    ],
    now: NOW,
  });
  assert.equal(folded.replacementApplied, true);
  assert.deepEqual(folded.profile.customDocuments.map((doc) => doc.id), ["custom/new.md"], "the restore wins and stale records stay gone");
  assert.equal(folded.profile.syncMeta.generation, "generation-2");
});

test("board records fold per key, including boards this device never had", () => {
  const base = normalizeProfile(initialProfile);
  const stroke = (id) => ({ id, tool: "pen", color: "#111111", size: 3, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], createdAt: NOW });
  const peerBoard = { version: 2, activePageId: "page-1", background: "plain", pages: [{ id: "page-1", name: "Page 1", strokes: [stroke("stroke-a")], createdAt: NOW }], syncMeta: { revision: 1, updatedAt: NOW, writerId: "device-b", conflicts: [] } };
  const folded = foldPeerSnapshots({
    baselineRecords: null,
    localRecords: { profile: base },
    peers: [{ deviceId: "device-b", records: { profile: normalizeProfile(base), "board:notes/x.md": peerBoard } }],
    now: NOW,
  });
  const board = folded.boards["board:notes/x.md"];
  assert.ok(board, "the peer's board must arrive");
  assert.equal(board.pages.length, 1, "adopting a peer-only board must not graft a blank fallback page");
  assert.equal(board.pages[0].objects.length, 1);
  assert.equal(board.pages[0].objects[0].id, "stroke-a");
});

test("baseline persistence no-ops gracefully without IndexedDB", async () => {
  assert.equal(globalThis.indexedDB, undefined, "this test expects a bare Node environment");
  assert.equal(await loadSyncBaseline(), null);
  assert.equal(await saveSyncBaseline({ vaultId: "v", records: {} }), false);
});
