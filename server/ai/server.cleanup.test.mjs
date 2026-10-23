import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// An after() hook can only be seen from outside its process, so this file runs
// server.test.mjs in a child: passing, failing, and with its fixture write
// failing. The child gets its own temp folder (the real one is shared with
// concurrent runs) and none of the runner's NODE_TEST* variables (they would
// change how it runs and reports).

const SERVER_SUITE = fileURLToPath(new URL("./server.test.mjs", import.meta.url));
const FORCED_FAILURE = 'data:text/javascript,import { test } from "node:test"; test("forced failure", () => { throw new Error("forced failure"); });';
const FIXTURE_WRITE_FAILURE = `data:text/javascript,${encodeURIComponent([
  'import fsp from "node:fs/promises";',
  'import { syncBuiltinESMExports } from "node:module";',
  "const { writeFile } = fsp;",
  'fsp.writeFile = (path, ...rest) => (String(path).includes("lumen-server-test-dist-") ? Promise.reject(new Error("forced fixture write failure")) : writeFile(path, ...rest));',
  "syncBuiltinESMExports();",
].join("\n"))}`;

const runServerSuite = async (t, { preload } = {}) => {
  const folder = await mkdtemp(join(tmpdir(), "lumen-server-cleanup-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST"))),
    TMPDIR: folder,
    TMP: folder,
    TEMP: folder,
  };
  const result = spawnSync(process.execPath, ["--test-reporter=tap", ...(preload ? [`--import=${preload}`] : []), SERVER_SUITE], { env, encoding: "utf8", timeout: 120_000 });
  const output = [
    (result.stdout ?? "") + (result.stderr ?? ""),
    result.signal && `(child killed by ${result.signal})`,
    result.error && `(${result.error.message})`,
  ].filter(Boolean).join("\n");
  return {
    status: result.status,
    output,
    pass: Number(/^# pass (\d+)$/m.exec(output)?.[1]),
    fail: Number(/^# fail (\d+)$/m.exec(output)?.[1]),
    leftovers: (await readdir(folder)).sort(),
  };
};

test("the server suite leaves nothing in its temp folder after a passing run", async (t) => {
  const run = await runServerSuite(t);
  assert.equal(run.status, 0, `the server suite did not pass in the child:\n${run.output}`);
  assert.ok(run.pass > 0, `the child ran no tests:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after a passing run`);
});

test("the server suite leaves nothing in its temp folder after a failing run", async (t) => {
  const run = await runServerSuite(t, { preload: FORCED_FAILURE });
  assert.equal(run.status, 1, `the forced failure did not fail the child:\n${run.output}`);
  assert.match(run.output, /^not ok \d+ - forced failure$/m);
  assert.ok(run.fail >= 1 && run.pass > 0, `the child did not run the suite:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after a failing run`);
});

test("the server suite leaves nothing in its temp folder when writing its fixture fails", async (t) => {
  const run = await runServerSuite(t, { preload: FIXTURE_WRITE_FAILURE });
  assert.ok(run.status > 0, `the fixture write failure did not fail the child:\n${run.output}`);
  assert.match(run.output, /forced fixture write failure/, `the child never reached the fixture write:\n${run.output}`);
  assert.deepEqual(run.leftovers, [], `server.test.mjs left ${run.leftovers.join(", ")} after writing its fixture failed`);
});
