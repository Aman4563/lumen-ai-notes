import assert from "node:assert/strict";
import { test } from "node:test";

import { createVaultConfig, readVaultConfig, vaultMembershipStored } from "./syncIdentity.js";

const memoryStore = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    raw: map,
  };
};

const withLocalStorage = (store, callback) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => store });
  try {
    return callback();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
};

// Issue #139: where the browser refuses the write, the vault lives only in
// the session's memory copy, so Settings shows it until Lumen is closed or
// reloaded. Create and join must tell the learner that, so the check reads
// what the browser really stored.
test("a vault kept only in this session's memory is not a stored membership", () => {
  const full = memoryStore();
  full.setItem = () => { throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" }); };
  withLocalStorage(full, () => {
    const config = createVaultConfig();
    assert.equal(readVaultConfig()?.vaultId, config.vaultId, "the session still shows the new vault");
    assert.equal(vaultMembershipStored(config), false, "the browser never stored it");
  });
});

test("a vault the browser stored is a stored membership", () => {
  const working = memoryStore();
  withLocalStorage(working, () => {
    const config = createVaultConfig();
    assert.equal(vaultMembershipStored(config), true);
    assert.equal(JSON.parse(working.raw.get("lumen-sync-vault-v1")).vaultId, config.vaultId);
  });
});

test("only this vault counts: another stored vault or none is not this membership", () => {
  const working = memoryStore();
  working.setItem("lumen-sync-vault-v1", JSON.stringify({ vaultId: "another-vault-0001", createdAt: "2026-10-22T00:00:00.000Z", lastSyncAt: "" }));
  withLocalStorage(working, () => {
    assert.equal(vaultMembershipStored({ vaultId: "this-vault-00000001" }), false);
    assert.equal(vaultMembershipStored({ vaultId: "another-vault-0001" }), true);
    assert.equal(vaultMembershipStored(null), false);
  });
  withLocalStorage(undefined, () => assert.equal(vaultMembershipStored({ vaultId: "another-vault-0001" }), false, "no store, no membership"));
});
