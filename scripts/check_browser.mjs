import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { startApplicationServer, silentLogger } from "../server/server.mjs";

const audits = ["workflow", "audio", "review", "annotations", "sync", "visual", "controls", "ai-ui", "phone-ai-ui", "mermaid", "chunks", "responsive", "a11y"];
const requested = process.argv.slice(2);
if (requested.some((name) => !audits.includes(name))) throw new Error(`Choose audits from: ${audits.join(", ")}`);
const chromePath = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
if (!chromePath) throw new Error("Install Chrome or set CHROME_PATH before running browser checks.");
let app;
const results = [];
try {
  // A clean checkout needs no manually started preview or local AI services.
  if (!process.env.LUMEN_URL) app = await startApplicationServer({ env: { HOST: "127.0.0.1", PORT: "0", AI_ENABLED: "false", WEB_SEARCH_ENABLED: "false" }, logger: silentLogger });
  const url = process.env.LUMEN_URL || `http://127.0.0.1:${app.server.address().port}/`;
  const runAudit = (name) => new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", `audit:${name}`], { stdio: "inherit", env: { ...process.env, LUMEN_URL: url, CHROME_PATH: chromePath } });
    child.once("error", (error) => { console.error(error.message); resolve(1); });
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  // Shared CI runners are sometimes starved (a 6 s suite taking minutes, a
  // background tab frozen). A failed suite is retried once and the retry is
  // reported, so a real regression still fails twice while runner stalls do
  // not block unrelated work. LUMEN_BROWSER_RETRIES=0 disables the retry.
  const retries = Math.max(0, Number(process.env.LUMEN_BROWSER_RETRIES ?? 1));
  for (const name of requested.length ? requested : audits) {
    const started = Date.now();
    let code = await runAudit(name);
    const attempts = [code === 0];
    for (let retry = 0; code !== 0 && retry < retries; retry += 1) {
      console.log(JSON.stringify({ audit: name, ok: false, retrying: true, attempt: attempts.length }));
      code = await runAudit(name);
      attempts.push(code === 0);
    }
    results.push({ audit: name, ok: code === 0, ms: Date.now() - started, ...(attempts.length > 1 ? { attempts } : {}) });
    // Continue after failures so one broken workflow cannot hide other gaps.
    console.log(JSON.stringify(results.at(-1)));
  }
  const flaky = results.filter((result) => result.ok && result.attempts);
  if (flaky.length) console.log(`Passed only on retry: ${flaky.map((result) => result.audit).join(", ")}. Investigate if this repeats.`);
  console.log(JSON.stringify({ browserChecks: results, ok: results.every((result) => result.ok) }));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
} finally {
  if (app) await new Promise((resolve) => { app.server.closeAllConnections(); app.server.close(resolve); });
}
