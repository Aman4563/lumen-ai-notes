import assert from "node:assert/strict";
import test from "node:test";
import { isWarmToolUnavailable, loadWarmTool, WARM_TOOL_OFFLINE_MESSAGE, WARM_TOOL_STALE_MESSAGE, warmToolFailureMessage } from "./warmTools.js";

const failWith = (message) => async () => { throw new TypeError(message); };
const direct = (loader) => loader();
const unreachable = async () => false;

test("a tool that cannot be downloaded rejects with the typed offline message", async () => {
  for (const message of [
    "Failed to fetch dynamically imported module: http://127.0.0.1/assets/backupTools-abc.js", // Chrome
    "error loading dynamically imported module: http://127.0.0.1/assets/linkAudit-abc.js", // Firefox
    "Importing a module script failed.", // Safari
  ]) {
    const error = await loadWarmTool(() => Promise.reject(new TypeError(message)), "backupTools", { load: direct, probe: unreachable }).catch((caught) => caught);
    assert.equal(isWarmToolUnavailable(error), true, message);
    assert.equal(error.message, WARM_TOOL_OFFLINE_MESSAGE);
    assert.equal(error.status, "offline");
    assert.equal(error.cause.message, message, "the download error stays attached for diagnosis");
  }
});

// Review round 1: an action's toast is announced assertively on its own, so
// it names the action as every other failure toast does. (The typed message
// used to replace the prefix; that assertion changed on purpose.)
test("the failure toast keeps the action's prefix before the typed reason", async () => {
  const error = await loadWarmTool(failWith("Importing a module script failed."), "backupTools", { load: direct, probe: unreachable }).catch((caught) => caught);
  assert.equal(warmToolFailureMessage(error, "Backup failed: "), "Backup failed: This tool isn't saved on this device yet. Reconnect once, and it will work offline.");
  assert.equal(warmToolFailureMessage(error), WARM_TOOL_OFFLINE_MESSAGE);
});

// Review round 1: with the server answering, the file is missing from the
// build it serves, and "reconnect once" would be wrong. The wording follows
// the error screen's stale state instead.
test("the typed reason follows the connection: offline, unreachable, or a server without the file", async () => {
  const stale = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1/assets/backupTools-abc.js");
  const outcome = async (options) => {
    let probes = 0;
    const error = await loadWarmTool(() => Promise.reject(stale), "backupTools", {
      load: direct,
      ...options,
      probe: async () => { probes += 1; return options.reachable; },
    }).catch((caught) => caught);
    return { status: error.status, message: error.message, probes, typed: isWarmToolUnavailable(error) };
  };
  assert.deepEqual(await outcome({ isOnline: () => false, reachable: true }), { status: "offline", message: WARM_TOOL_OFFLINE_MESSAGE, probes: 0, typed: true }, "offline never probes");
  assert.deepEqual(await outcome({ isOnline: () => true, reachable: false }), { status: "offline", message: WARM_TOOL_OFFLINE_MESSAGE, probes: 1, typed: true }, "an unreachable server reads as offline");
  assert.deepEqual(await outcome({ isOnline: () => true, reachable: true }), { status: "stale", message: WARM_TOOL_STALE_MESSAGE, probes: 1, typed: true }, "a reachable server without the file needs fresh app files");
  assert.match(WARM_TOOL_STALE_MESSAGE, /fresh app files/u);
  assert.doesNotMatch(WARM_TOOL_STALE_MESSAGE, /Reconnect once/u);
  const failedProbe = await loadWarmTool(() => Promise.reject(stale), "backupTools", { load: direct, isOnline: () => true, probe: async () => { throw new Error("probe crashed"); } }).catch((caught) => caught);
  assert.equal(failedProbe.status, "offline", "a probe that throws counts as unreachable");
});

test("a loaded tool resolves, and any other failure keeps its own words", async () => {
  const module = { createBackup: () => "ok" };
  const names = [];
  assert.equal(await loadWarmTool(async () => module, "backupTools", { load: (loader, name) => { names.push(name); return loader(); } }), module);
  assert.deepEqual(names, ["backupTools"], "the chunk name reaches chunk recovery, which clears only that chunk's marker");
  let probes = 0;
  const error = await loadWarmTool(failWith("Backup export time is invalid"), "backupTools", { load: direct, probe: async () => { probes += 1; return true; } }).catch((caught) => caught);
  assert.equal(isWarmToolUnavailable(error), false);
  assert.equal(probes, 0, "an ordinary failure never probes the server");
  assert.equal(warmToolFailureMessage(error, "Backup failed: "), "Backup failed: Backup export time is invalid");
});

test("tools load through chunk recovery by default", async () => {
  // recoverableImport passes a loaded module straight through.
  assert.deepEqual(await loadWarmTool(async () => ({ ready: true }), "linkAudit"), { ready: true });
});
