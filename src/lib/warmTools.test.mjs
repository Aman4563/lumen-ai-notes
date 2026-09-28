import assert from "node:assert/strict";
import test from "node:test";
import { isWarmToolUnavailable, loadWarmTool, WARM_TOOL_OFFLINE_MESSAGE, warmToolFailureMessage } from "./warmTools.js";

const failWith = (message) => async () => { throw new TypeError(message); };

test("a tool that cannot be downloaded rejects with the typed offline message", async () => {
  for (const message of [
    "Failed to fetch dynamically imported module: http://127.0.0.1/assets/backupTools-abc.js", // Chrome
    "error loading dynamically imported module: http://127.0.0.1/assets/linkAudit-abc.js", // Firefox
    "Importing a module script failed.", // Safari
  ]) {
    const error = await loadWarmTool(() => Promise.reject(new TypeError(message)), "backupTools", { load: (loader) => loader() }).catch((caught) => caught);
    assert.equal(isWarmToolUnavailable(error), true, message);
    assert.equal(error.message, WARM_TOOL_OFFLINE_MESSAGE);
    assert.equal(error.cause.message, message, "the download error stays attached for diagnosis");
    assert.equal(warmToolFailureMessage(error, "Backup failed: "), "This tool isn't saved on this device yet. Reconnect once, and it will work offline.");
  }
});

test("a loaded tool resolves, and any other failure keeps its own words", async () => {
  const module = { createBackup: () => "ok" };
  const names = [];
  assert.equal(await loadWarmTool(async () => module, "backupTools", { load: (loader, name) => { names.push(name); return loader(); } }), module);
  assert.deepEqual(names, ["backupTools"], "the chunk name reaches chunk recovery, which clears only that chunk's marker");
  const error = await loadWarmTool(failWith("Backup export time is invalid"), "backupTools", { load: (loader) => loader() }).catch((caught) => caught);
  assert.equal(isWarmToolUnavailable(error), false);
  assert.equal(warmToolFailureMessage(error, "Backup failed: "), "Backup failed: Backup export time is invalid");
});

test("tools load through chunk recovery by default", async () => {
  // recoverableImport passes a loaded module straight through.
  assert.deepEqual(await loadWarmTool(async () => ({ ready: true }), "linkAudit"), { ready: true });
});
