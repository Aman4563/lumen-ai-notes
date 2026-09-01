import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupValidationError,
  FALLBACK_CHECKSUM_ALGORITHM,
  canonicalStringify,
  createBackup,
  createRecoverySnapshot,
  preflightBackup,
} from "./backup.js";
import { initialProfile } from "./db.js";
import { MAX_CUSTOM_DOCUMENT_BYTES } from "./uploads.js";

const fixedTime = "2026-08-22T10:30:00.000Z";
const records = () => ({
  profile: {
    ...initialProfile,
    bookmarks: ["notes/part-01"],
    personalNotes: { "notes/part-01": "A durable note" },
    reviewItems: [{
      id: "card-1",
      type: "basic",
      front: "What is gradient descent?",
      back: "An iterative optimization method.",
      documentId: "notes/part-01",
      tags: ["optimization"],
      dueAt: fixedTime,
      intervalDays: 0,
      ease: 2.5,
      repetitions: 0,
      reviewCount: 0,
      lapses: 0,
      createdAt: fixedTime,
      updatedAt: fixedTime,
      lastReviewedAt: "",
    }],
  },
  "board:notes/part-01": {
    version: 2,
    activePageId: "page-1",
    background: "grid",
    pages: [{ id: "page-1", name: "Derivation", objects: [{ id: "line-1", tool: "line", color: "#17283e", fill: "#fff1a8", width: 3, fontSize: 24, text: "", points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] }] }],
  },
});

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => error instanceof BackupValidationError && error.code === code);
};

test("v4 backup round-trips with canonical SHA-256 integrity and inventory", async () => {
  const created = await createBackup(records(), { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: true });
  assert.equal(created.envelope.version, BACKUP_VERSION);
  assert.equal(created.envelope.profileVersion, 4);
  assert.equal(created.envelope.integrity.algorithm, "SHA-256");
  assert.equal(created.envelope.integrity.digest.length, 64);
  assert.equal(created.summary.counts.boards, 1);
  assert.equal(created.summary.counts.boardObjects, 1);
  assert.equal(created.summary.counts.reviewItems, 1);
  assert.equal(created.summary.counts.aiTutorMessages, 0);
  assert.equal(created.summary.fileBytes, new TextEncoder().encode(created.json).byteLength);
  assert.equal(created.json, canonicalStringify(JSON.parse(created.json)));

  const checked = await preflightBackup(created.json, { cryptoApi: webcrypto });
  assert.equal(checked.ok, true);
  assert.equal(checked.integrity.verified, true);
  assert.equal(checked.migrationRequired, false);
  assert.deepEqual(checked.data.profile.bookmarks, ["notes/part-01"]);
  assert.equal(checked.data["board:notes/part-01"].pages[0].objects[0].tool, "line");
});

test("preflight rejects corruption before normalizing data", async () => {
  const created = await createBackup(records(), { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: true });
  const corrupted = JSON.parse(created.json);
  corrupted.data.profile.personalNotes["notes/part-01"] = "silently changed";
  await expectCode(preflightBackup(JSON.stringify(corrupted), { cryptoApi: webcrypto }), "CHECKSUM_MISMATCH");
});

test("preflight rejects a future backup version", async () => {
  const future = { format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, data: { profile: initialProfile } };
  await expectCode(preflightBackup(JSON.stringify(future), { cryptoApi: webcrypto }), "FUTURE_VERSION");
});

test("preflight rejects prototype-pollution keys at any depth", async () => {
  const malicious = `{"format":"${BACKUP_FORMAT}","version":3,"exportedAt":"${fixedTime}","data":{"profile":{"version":3,"settings":{"__proto__":{"polluted":true}}}}}`;
  await expectCode(preflightBackup(malicious, { cryptoApi: webcrypto }), "UNSAFE_KEY");
  assert.equal({}.polluted, undefined);
});

test("legacy v1 layout imports with explicit migration and integrity warnings", async () => {
  const legacy = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: "2023-01-01T00:00:00.000Z",
    profile: { version: 1, bookmarks: ["notes/part-01"], settings: { theme: "dark" } },
    boards: { "notes/part-01": [] },
  };
  const checked = await preflightBackup(JSON.stringify(legacy), { cryptoApi: webcrypto });
  assert.equal(checked.sourceVersion, 1);
  assert.equal(checked.targetVersion, 4);
  assert.equal(checked.migrationRequired, true);
  assert.equal(checked.data.profile.version, 4);
  assert.equal(checked.data.profile.settings.theme, "dark");
  assert.ok(checked.data["board:notes/part-01"]);
  assert.ok(checked.warnings.some((warning) => warning.includes("no checksum")));
  assert.ok(checked.warnings.some((warning) => warning.includes("migrated")));
});

test("legacy v2 and v3 data envelopes remain supported", async () => {
  for (const version of [2, 3]) {
    const legacy = {
      format: BACKUP_FORMAT,
      version,
      exportedAt: `202${version}-01-01T00:00:00.000Z`,
      data: { profile: { ...initialProfile, version, bookmarks: [`notes/v${version}`] } },
    };
    const checked = await preflightBackup(JSON.stringify(legacy), { cryptoApi: webcrypto });
    assert.equal(checked.sourceVersion, version);
    assert.equal(checked.data.profile.version, 4);
    assert.deepEqual(checked.data.profile.bookmarks, [`notes/v${version}`]);
    assert.equal(checked.integrity.verified, false);
  }
});

test("creation and preflight enforce configurable byte limits", async () => {
  await expectCode(createBackup(records(), {
    exportedAt: fixedTime,
    cryptoApi: webcrypto,
    secureContext: true,
    maxBytes: 256,
  }), "TOO_LARGE");
  await expectCode(preflightBackup("x".repeat(257), { maxBytes: 256, cryptoApi: webcrypto }), "TOO_LARGE");
});

test("the maximum accepted custom-document corpus remains exportable and restorable", async () => {
  const maximumCorpus = {
    profile: {
      ...initialProfile,
      customDocuments: [{
        id: "custom/maximum.md",
        title: "Maximum backup-safe document corpus",
        raw: "x".repeat(MAX_CUSTOM_DOCUMENT_BYTES),
        createdAt: fixedTime,
        updatedAt: fixedTime,
        tags: [],
      }],
    },
  };
  const created = await createBackup(maximumCorpus, { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: true });
  assert.ok(created.summary.fileBytes < 25 * 1024 * 1024);
  const checked = await preflightBackup(created.json, { cryptoApi: webcrypto });
  assert.equal(checked.data.profile.customDocuments[0].raw.length, MAX_CUSTOM_DOCUMENT_BYTES);
});

test("insecure-context export labels its deterministic fallback checksum", async () => {
  const created = await createBackup(records(), { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: false });
  assert.equal(created.envelope.integrity.algorithm, FALLBACK_CHECKSUM_ALGORITHM);
  assert.equal(created.envelope.integrity.cryptographic, false);
  const checked = await preflightBackup(created.json, { cryptoApi: webcrypto });
  assert.equal(checked.integrity.verified, true);
  assert.ok(checked.warnings.some((warning) => warning.includes("non-cryptographic")));
});

test("recovery snapshot contains identifiers, never the incoming backup", async () => {
  const incoming = await createBackup(records(), { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: true });
  const preflight = await preflightBackup(incoming.json, { cryptoApi: webcrypto });
  const recovery = await createRecoverySnapshot(records(), {
    exportedAt: "2026-08-22T10:31:00.000Z",
    cryptoApi: webcrypto,
    secureContext: true,
    incomingPreflight: preflight,
  });
  assert.equal(recovery.envelope.kind, "recovery");
  assert.equal(recovery.envelope.recovery.incomingChecksum, preflight.integrity.digest);
  assert.equal("backup" in recovery.envelope.recovery, false);
  assert.equal(canonicalStringify(recovery.envelope).includes(incoming.json), false);
});
