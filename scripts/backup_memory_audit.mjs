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

console.log(`Backup memory audit passed: ${Math.round(elapsedMs)} ms, ${Math.round(rssGrowth / 1024 / 1024)} MB RSS growth, ${result.summary.fileBytes} bytes.`);
