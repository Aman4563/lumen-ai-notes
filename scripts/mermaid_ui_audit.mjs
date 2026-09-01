import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-mermaid-ui-profile-"));
const runtimeErrors = [];
let browser;
let vite;

const attachDiagnostics = (page, label) => {
  page.on("pageerror", (error) => runtimeErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      runtimeErrors.push(`${label}: ${message.text()}`);
    }
  });
};

// Count the Mermaid package entry itself, not this audit page/fixture or the
// small app-side lifecycle adapter whose filenames also contain "mermaid".
// In Vite development the lazy package entry is served from the optimized
// dependency directory; production builds emit a hashed Mermaid asset.
const mermaidRuntimeRequests = (requests) => requests.filter((url) => {
  const pathname = new URL(url).pathname;
  return /\/node_modules\/\.vite\/deps\/mermaid(?:\.js|-)/iu.test(pathname)
    || /\/assets\/mermaid(?:\.core)?-[^/]+\.js$/iu.test(pathname);
});

try {
  vite = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "mermaid-audit-page",
      configureServer(server) {
        server.middlewares.use("/__mermaid-audit", async (request, response, next) => {
          try {
            const source = '<!doctype html><html data-theme="paper"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mermaid audit</title></head><body><div id="root"></div><script type="module" src="/scripts/mermaid_ui_fixture.jsx"></script></body></html>';
            const html = await server.transformIndexHtml(request.originalUrl || "/__mermaid-audit", source);
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  await vite.listen();
  const address = vite.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });

  const deferred = await browser.newPage();
  attachDiagnostics(deferred, "deferred");
  await deferred.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const deferredRequests = [];
  deferred.on("request", (request) => deferredRequests.push(request.url()));
  await deferred.goto(`${baseUrl}/__mermaid-audit?mode=deferred`, { waitUntil: "networkidle2", timeout: 30_000 });
  await deferred.waitForSelector('.deferred-surface .diagram-shell[data-diagram-status="pending"]');
  assert.equal(await deferred.$(".deferred-surface svg"), null, "an in-flight tutor response rendered Mermaid before completion");
  assert.deepEqual(mermaidRuntimeRequests(deferredRequests), [], "the Mermaid runtime was fetched before a completed fenced block existed");
  assert.match(await deferred.$eval(".deferred-surface .mermaid", (node) => node.textContent), /Library source/u, "pending source was not readable before lazy rendering");
  await deferred.click("button");
  await deferred.waitForSelector('.deferred-surface .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 20_000 });
  assert.ok(mermaidRuntimeRequests(deferredRequests).length > 0, "the Mermaid runtime was not loaded after response completion");
  await deferred.close();

  const page = await browser.newPage();
  attachDiagnostics(page, "complete");
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${baseUrl}/__mermaid-audit`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] svg').length === 5, { timeout: 30_000 });
  await page.waitForSelector('.diagram-shell[data-diagram-status="error"] .diagram-diagnostic', { timeout: 15_000 });

  const initial = await page.evaluate(() => ({
    rendered: document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] svg').length,
    failures: document.querySelectorAll('.diagram-shell[data-diagram-status="error"] .diagram-diagnostic').length,
    labels: [...document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] svg')].map((svg) => svg.textContent),
    counts: [...document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] .mermaid')].map((node) => Number(node.dataset.diagramRenderCount)),
    hasUnsafeElements: Boolean(document.querySelector(".mermaid script, .mermaid foreignObject, .mermaid iframe, .mermaid object, .mermaid embed, .mermaid img")),
    unsafeAttributes: [...document.querySelectorAll(".mermaid *")].flatMap((node) => [...node.attributes]).filter((attribute) => attribute.name.toLowerCase().startsWith("on") || (["href", "xlink:href"].includes(attribute.name.toLowerCase()) && !attribute.value.startsWith("#"))).map((attribute) => `${attribute.name}=${attribute.value}`),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  assert.equal(initial.rendered, 5, "valid common Mermaid syntaxes did not all render");
  assert.equal(initial.failures, 1, "invalid syntax did not produce exactly one diagnostic");
  assert.ok(initial.labels.some((text) => text.includes("Grounded answer")), "reader flowchart labels were lost");
  assert.ok(initial.labels.some((text) => text.includes("chain rule")), "sequence diagram labels were lost");
  assert.ok(initial.labels.some((text) => text.includes("predict")), "class diagram labels were lost");
  assert.equal(initial.hasUnsafeElements, false, "unsafe HTML survived Mermaid SVG sanitization");
  assert.deepEqual(initial.unsafeAttributes, [], "event handlers or external links survived Mermaid SVG sanitization");
  assert.equal(await page.evaluate(() => window.__MERMAID_XSS__), false, "Mermaid author input executed script");
  assert.ok(initial.overflow <= 1, `diagram fixture overflowed the mobile viewport by ${initial.overflow}px`);

  const diagnostic = await page.$eval('.diagram-shell[data-diagram-status="error"]', (shell) => ({
    text: shell.textContent,
    source: shell.querySelector("details code")?.textContent || "",
    retry: Boolean(shell.querySelector('[data-diagram-action="retry"]')),
    copy: Boolean(shell.querySelector('[data-diagram-action="copy"]')),
  }));
  assert.match(diagnostic.text, /Diagram syntax needs attention/u);
  assert.match(diagnostic.source, /BROKEN\[/u, "invalid source was not preserved for repair");
  assert.ok(diagnostic.retry && diagnostic.copy, "invalid diagram did not expose retry and copy actions");
  await page.click('[data-diagram-action="retry"]');
  await page.waitForSelector('.diagram-shell[data-diagram-status="error"] .diagram-diagnostic', { timeout: 15_000 });
  assert.equal(await page.evaluate(() => window.__MERMAID_XSS__), false, "retrying an invalid diagram executed author input");

  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForFunction((counts) => {
    const current = [...document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] .mermaid')].map((node) => Number(node.dataset.diagramRenderCount));
    return current.length === counts.length && current.every((count, index) => count > counts[index]);
  }, { timeout: 30_000 }, initial.counts);
  const themed = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.diagram-shell[data-diagram-status="rendered"] svg')].map((svg) => svg.textContent),
    failures: document.querySelectorAll('.diagram-shell[data-diagram-status="error"] .diagram-diagnostic').length,
    background: getComputedStyle(document.querySelector('.diagram-shell[data-diagram-status="rendered"]')).backgroundColor,
    paper: getComputedStyle(document.documentElement).getPropertyValue("--paper-2").trim(),
  }));
  assert.ok(themed.labels.some((text) => text.includes("Grounded answer")), "theme rerender used generated SVG text instead of the original Mermaid definition");
  assert.ok(themed.labels.some((text) => text.includes("chain rule")), "theme rerender corrupted a non-flowchart diagram");
  assert.equal(themed.failures, 1, "theme rerender converted valid diagrams into failures");
  assert.equal(await page.evaluate(() => window.__MERMAID_XSS__), false, "theme rerender executed author input");

  assert.deepEqual(runtimeErrors, [], `Mermaid browser errors: ${runtimeErrors.join(" | ")}`);
  console.log(`Mermaid UI audit passed. Deferred load requests: ${mermaidRuntimeRequests(deferredRequests).length}; valid diagrams: ${initial.rendered}; safe diagnostics: ${initial.failures}; theme rerenders: ${initial.counts.length}.`);
} finally {
  await browser?.close();
  await vite?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
