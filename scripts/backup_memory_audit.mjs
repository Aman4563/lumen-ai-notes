import assert from "node:assert/strict";
import { createBackup } from "../src/lib/backup.js";
import { initialProfile } from "../src/lib/db.js";
import { MAX_CUSTOM_DOCUMENT_BYTES } from "../src/lib/uploads.js";

globalThis.gc?.();
const before = process.memoryUsage().rss;
const startedAt = performance.now();
const timestamp = "2026-08-23T00:00:00.000Z";
const result = await createBackup({
  profile: {
    ...initialProfile,
    customDocuments: [{
      id: "custom/maximum-memory-gate.md",
      title: "Maximum memory gate",
      raw: "x".repeat(MAX_CUSTOM_DOCUMENT_BYTES),
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  },
}, {
  exportedAt: timestamp,
  secureContext: false,
});
const elapsedMs = performance.now() - startedAt;
const rssGrowth = Math.max(0, process.memoryUsage().rss - before);

assert.ok(result.summary.fileBytes < 25 * 1024 * 1024, "maximum supported workspace must remain exportable");
assert.ok(elapsedMs < 3_000, `maximum backup took ${Math.round(elapsedMs)} ms`);
assert.ok(rssGrowth < 220 * 1024 * 1024, `maximum backup grew RSS by ${Math.round(rssGrowth / 1024 / 1024)} MB`);

// Issue #18: the encrypted container must fit the same memory envelope. The
// plaintext is result.json itself, so this exercises the real maximum size.
globalThis.gc?.();
const { webcrypto } = await import("node:crypto");
const { encryptBackupJson, decryptBackupFile } = await import("../src/lib/backupCrypto.js");
const encryptedBefore = process.memoryUsage().rss;
const encryptedStartedAt = performance.now();
const { blobParts } = await encryptBackupJson(result.json, "memory-gate-password", { cryptoApi: webcrypto, exportedAt: timestamp });
const container = new Uint8Array(blobParts[0].length + blobParts[1].length);
container.set(blobParts[0], 0);
container.set(blobParts[1], blobParts[0].length);
const decrypted = await decryptBackupFile(container.buffer, "memory-gate-password", { cryptoApi: webcrypto });
const encryptedElapsedMs = performance.now() - encryptedStartedAt;
const encryptedGrowth = Math.max(0, process.memoryUsage().rss - encryptedBefore);

assert.equal(decrypted, result.json, "the encrypted round trip must return the byte-exact backup JSON");
assert.ok(encryptedElapsedMs < 12_000, `encrypted round trip took ${Math.round(encryptedElapsedMs)} ms (PBKDF2 600k budgeted)`);
assert.ok(encryptedGrowth < 220 * 1024 * 1024, `encrypted round trip grew RSS by ${Math.round(encryptedGrowth / 1024 / 1024)} MB`);

console.log(`Backup memory audit passed: plain ${Math.round(elapsedMs)} ms / ${Math.round(rssGrowth / 1024 / 1024)} MB RSS / ${result.summary.fileBytes} bytes; encrypted round trip ${Math.round(encryptedElapsedMs)} ms / ${Math.round(encryptedGrowth / 1024 / 1024)} MB RSS / ${container.length} bytes.`);
