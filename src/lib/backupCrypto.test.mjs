import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";

import { BackupValidationError, createBackup, preflightBackup } from "./backup.js";
import {
  ENCRYPTED_BACKUP_FORMAT,
  ENCRYPTED_MAGIC,
  ITERATION_CEILING,
  MAX_ENCRYPTED_BACKUP_BYTES,
  decryptBackupFile,
  encryptBackupJson,
  readEncryptedHeader,
  sniffEncryptedBackup,
} from "./backupCrypto.js";
import { initialProfile } from "./db.js";

const fixedTime = "2026-09-02T10:00:00.000Z";
const password = "correct horse battery";
// Fast KDF for tests: production always uses PBKDF2_ITERATIONS; the floor is
// enforced on IMPORT header values, and these containers set matching values.
const testIterations = 100_000;

const records = () => ({
  profile: {
    ...initialProfile,
    bookmarks: ["notes/part-01"],
    personalNotes: { "notes/part-01": "An encrypted note survives the round trip: café ☕" },
  },
});

const makeContainer = async (options = {}) => {
  const created = await createBackup(records(), { exportedAt: fixedTime, cryptoApi: webcrypto, secureContext: true });
  const { blobParts, header } = await encryptBackupJson(created.json, options.password ?? password, {
    cryptoApi: webcrypto,
    iterations: testIterations,
    exportedAt: fixedTime,
    ...options,
  });
  const bytes = new Uint8Array(blobParts[0].length + blobParts[1].length);
  bytes.set(blobParts[0], 0);
  bytes.set(blobParts[1], blobParts[0].length);
  return { created, header, bytes };
};

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => error instanceof BackupValidationError && error.code === code);
};

test("an encrypted backup round-trips to the exact canonical JSON and passes preflight", async () => {
  const { created, header, bytes } = await makeContainer();
  assert.equal(header.format, ENCRYPTED_BACKUP_FORMAT);
  assert.equal(sniffEncryptedBackup(bytes), true);
  assert.equal(sniffEncryptedBackup(new TextEncoder().encode(created.json)), false, "plain JSON must never sniff as encrypted");

  const plaintext = await decryptBackupFile(bytes.buffer, password, { cryptoApi: webcrypto });
  assert.equal(plaintext, created.json, "decryption must return the byte-exact canonical backup JSON");
  const checked = await preflightBackup(plaintext, { cryptoApi: webcrypto });
  assert.equal(checked.ok, true);
  assert.equal(checked.integrity.verified, true);
  assert.equal(checked.data.profile.personalNotes["notes/part-01"].includes("café ☕"), true);
});

test("a wrong password and a flipped ciphertext byte both fail as WRONG_PASSWORD", async () => {
  const { bytes } = await makeContainer();
  await expectCode(decryptBackupFile(bytes.buffer, "not the password", { cryptoApi: webcrypto }), "WRONG_PASSWORD");
  const corrupted = bytes.slice();
  corrupted[corrupted.length - 20] ^= 0xff;
  await expectCode(decryptBackupFile(corrupted.buffer, password, { cryptoApi: webcrypto }), "WRONG_PASSWORD");
});

test("header tamper fails authentication through the raw-prefix AAD binding", async () => {
  const { bytes } = await makeContainer();
  // Edit one digit of the iterations count inside the header prefix while
  // keeping length identical: parsing still succeeds, GCM must reject.
  const headerText = new TextDecoder().decode(bytes.subarray(12, readEncryptedHeader(bytes).prefixLength));
  const tampered = headerText.replace(`"iterations":${testIterations}`, `"iterations":${testIterations + 2}`);
  assert.notEqual(tampered, headerText, "fixture must actually change the header");
  const edited = bytes.slice();
  edited.set(new TextEncoder().encode(tampered), 12);
  await expectCode(decryptBackupFile(edited.buffer, password, { cryptoApi: webcrypto }), "WRONG_PASSWORD");
});

test("attacker-controlled header bounds reject before any key derivation", async () => {
  const { bytes } = await makeContainer();
  const { prefixLength } = readEncryptedHeader(bytes);
  const headerText = new TextDecoder().decode(bytes.subarray(12, prefixLength));

  const withIterations = (value) => {
    const edited = new TextEncoder().encode(headerText.replace(`"iterations":${testIterations}`, `"iterations":${value}`));
    const out = new Uint8Array(12 + edited.length + 32);
    out.set(ENCRYPTED_MAGIC, 0);
    new DataView(out.buffer).setUint32(8, edited.length, false);
    out.set(edited, 12);
    return out;
  };
  assert.throws(() => readEncryptedHeader(withIterations(50_000)), (error) => error.code === "MALFORMED_ENC_HEADER", "iteration floor");
  assert.throws(() => readEncryptedHeader(withIterations(ITERATION_CEILING + 1)), (error) => error.code === "MALFORMED_ENC_HEADER", "iteration ceiling");

  const hugeLength = bytes.slice();
  new DataView(hugeLength.buffer).setUint32(8, 0xffffffff, false);
  assert.throws(() => readEncryptedHeader(hugeLength), (error) => error.code === "MALFORMED_ENC_HEADER", "header length bound");
  assert.throws(() => readEncryptedHeader(bytes.subarray(0, 10)), (error) => error.code === "MALFORMED_ENC_HEADER", "truncated file");

  const unknownFormat = new TextEncoder().encode(headerText.replace(ENCRYPTED_BACKUP_FORMAT, "lumen.backup.enc.v9"));
  const reframed = new Uint8Array(12 + unknownFormat.length + 32);
  reframed.set(ENCRYPTED_MAGIC, 0);
  new DataView(reframed.buffer).setUint32(8, unknownFormat.length, false);
  reframed.set(unknownFormat, 12);
  assert.throws(() => readEncryptedHeader(reframed), (error) => error.code === "UNSUPPORTED_ENC_FORMAT", "future format ids are rejected, not misread");
});

test("NFC normalization derives the same key for composed and decomposed passwords", async () => {
  const composed = "caf\u00e9 secret!";
  const decomposed = "cafe\u0301 secret!";
  assert.notEqual(composed, decomposed, "the fixtures must differ before normalization");
  assert.equal(composed.normalize("NFC"), decomposed.normalize("NFC"));
  const { created, bytes } = await makeContainer({ password: composed });
  const plaintext = await decryptBackupFile(bytes.buffer, decomposed, { cryptoApi: webcrypto });
  assert.equal(plaintext, created.json);
});

test("size and password-policy bounds hold", async () => {
  await expectCode(encryptBackupJson("{}", "short", { cryptoApi: webcrypto }), "MALFORMED_ENC_HEADER");
  const oversized = { size: MAX_ENCRYPTED_BACKUP_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) };
  await expectCode(decryptBackupFile(oversized, password, { cryptoApi: webcrypto }), "TOO_LARGE");
});

test("format-stability vector: fixed salt and IV produce a pinned container prefix", async () => {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const { blobParts } = await encryptBackupJson('{"pinned":true}', password, {
    cryptoApi: webcrypto,
    iterations: testIterations,
    exportedAt: fixedTime,
    unsafeTestSalt: salt,
    unsafeTestIv: iv,
  });
  const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(
    hex(blobParts[0]),
    "4c554d454e454e43000001007b22636970686572223a7b226976223a2243516b4a43516b4a43516b4a43516b4a222c226e616d65223a224145532d47434d222c227461674c656e677468223a3132387d2c22636f6d7072657373696f6e223a226e6f6e65222c226578706f727465644174223a22323032362d30392d30325431303a30303a30302e3030305a222c22666f726d6174223a226c756d656e2e6261636b75702e656e632e7631222c226b6466223a7b2268617368223a225348412d323536222c22697465726174696f6e73223a3130303030302c226e616d65223a2250424b444632222c2273616c74223a22427763484277634842776348427763484277634842773d3d227d7d",
    "container prefix (magic, framing, canonical header) drifted",
  );
  assert.equal(
    hex(blobParts[1]),
    "df432bddac06182382f9b360c5f1f499efd1ac34c8ec9046fb3b62d110d089",
    "ciphertext for the fixed salt/IV/password vector drifted (KDF or cipher assembly changed)",
  );
});

test("v2 sync containers carry authenticated vault and device identity", async () => {
  const { bytes } = await makeContainer({ vaultId: "vault-alpha", deviceId: "device-one" });
  const { header } = readEncryptedHeader(bytes);
  assert.equal(header.format, "lumen.backup.enc.v2");
  assert.equal(header.vaultId, "vault-alpha");
  assert.equal(header.deviceId, "device-one");
  const json = await decryptBackupFile(bytes.buffer, password, { cryptoApi: webcrypto });
  const checked = await preflightBackup(json, { cryptoApi: webcrypto });
  assert.equal(checked.data.profile.bookmarks[0], "notes/part-01", "v2 plaintext is the same canonical backup JSON");
});

test("v2 identity is tamper-evident: editing the header in place fails authentication", async () => {
  const { bytes } = await makeContainer({ vaultId: "vault-alpha", deviceId: "device-one" });
  const headerText = new TextDecoder().decode(bytes);
  const index = headerText.indexOf("device-one");
  const tampered = new Uint8Array(bytes);
  tampered.set(new TextEncoder().encode("device-two"), index);
  const parsed = readEncryptedHeader(tampered);
  assert.equal(parsed.header.deviceId, "device-two", "the parse itself cannot detect the swap");
  await assert.rejects(
    decryptBackupFile(tampered.buffer, password, { cryptoApi: webcrypto }),
    (error) => error instanceof BackupValidationError && error.code === "WRONG_PASSWORD",
    "re-attribution must fail the GCM tag",
  );
});

test("sync fields are version-gated: v1 rejects them, v2 requires both, unknown v2 fields refuse", async () => {
  await assert.rejects(
    makeContainer({ vaultId: "vault-alpha" }),
    (error) => error instanceof BackupValidationError && error.code === "MALFORMED_ENC_HEADER",
    "a vault id without a device id must refuse at encrypt time",
  );
  const { bytes } = await makeContainer({ vaultId: "vault-alpha", deviceId: "device-one" });
  const rewriteHeader = (mutate) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const headerLength = view.getUint32(ENCRYPTED_MAGIC.length, false);
    const start = ENCRYPTED_MAGIC.length + 4;
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headerLength)));
    mutate(header);
    const rewritten = new TextEncoder().encode(JSON.stringify(header));
    const out = new Uint8Array(ENCRYPTED_MAGIC.length + 4 + rewritten.length + 16);
    out.set(ENCRYPTED_MAGIC, 0);
    new DataView(out.buffer).setUint32(ENCRYPTED_MAGIC.length, rewritten.length, false);
    out.set(rewritten, start);
    return out;
  };
  assert.throws(
    () => readEncryptedHeader(rewriteHeader((header) => { header.format = ENCRYPTED_BACKUP_FORMAT; })),
    (error) => error.code === "UNSUPPORTED_ENC_FORMAT",
    "a v1 header carrying sync fields is refused as unknown fields",
  );
  assert.throws(
    () => readEncryptedHeader(rewriteHeader((header) => { delete header.deviceId; })),
    (error) => error.code === "MALFORMED_ENC_HEADER",
    "a v2 header without a device id is malformed",
  );
  assert.throws(
    () => readEncryptedHeader(rewriteHeader((header) => { header.relayUrl = "https://x"; })),
    (error) => error.code === "UNSUPPORTED_ENC_FORMAT",
    "future fields force an explicit version bump",
  );
});
