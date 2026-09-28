import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { startApplicationServer, silentLogger } from "../server/server.mjs";

const baseUrl = new URL(process.env.LUMEN_URL || "http://127.0.0.1:4173/");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-chunk-recovery-profile-"));
// The warm-tool drills serve this build from their own servers and stop them.
const dist = resolve(process.env.LUMEN_DIST || resolve(import.meta.dirname, "..", "dist"));
let browser;

const navigationWasReload = (page) => page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type === "reload");

// --- Warm tools (issue #95) ----------------------------------------------
// setOfflineMode does not stop service-worker fetches, so these drills use a
// real worker, their own server, and stop it (as audit:visual does).
const WARM_TOOL_OFFLINE_MESSAGE = "This tool isn't saved on this device yet. Reconnect once, and it will work offline.";
const EDITED_LECTURE = "notes/00-roadmap.md";

const startIsolatedServer = async (distDirectory = dist) => {
  const app = await startApplicationServer({ env: { HOST: "127.0.0.1", PORT: "0", AI_ENABLED: "false", WEB_SEARCH_ENABLED: "false" }, distDirectory, logger: silentLogger });
  let running = true;
  return {
    url: `http://127.0.0.1:${app.server.address().port}/`,
    stop: () => {
      if (!running) return Promise.resolve();
      running = false;
      return new Promise((done) => { app.server.closeAllConnections(); app.server.close(done); });
    },
  };
};

const readRouteListFile = () => JSON.parse(readFileSync(join(dist, "offline-routes.json"), "utf8"));

// A copy of the build made of links into dist, leaving out the named files.
const linkedDist = async (directory, skip) => {
  const linkTree = async (from, to, prefix) => {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await linkTree(join(from, entry.name), join(to, entry.name), `${relative}/`);
      else if (!skip.has(relative)) await symlink(join(from, entry.name), join(to, entry.name));
    }
  };
  await linkTree(dist, directory, "");
};

// The build with its warm files missing: every other file is a link into dist.
const distWithoutWarmTools = async (directory) => {
  const warm = new Set(readRouteListFile().warm || []);
  await linkedDist(directory, warm);
  return { directory, blocked: warm.size };
};

// The build with a copy of its route list, so a drill can publish the same
// files as another release by rewriting only the list's build: a worker
// registered with that build installs from it as an update would.
const distForUpdate = async (directory) => {
  await linkedDist(directory, new Set(["offline-routes.json"]));
  const publish = (build) => writeFile(join(directory, "offline-routes.json"), `${JSON.stringify({ ...readRouteListFile(), build }, null, 2)}\n`);
  await publish(readRouteListFile().build);
  return { directory, publish };
};

// A stored (uncompressed) zip: enough for a one-chapter EPUB.
const storedZip = (files) => {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
};

const writeUploadFixtures = async (directory) => {
  const files = {
    html: join(directory, "warm-drill-page.html"),
    epub: join(directory, "warm-drill-book.epub"),
    markdown: join(directory, "warm-drill-plain.md"),
  };
  await writeFile(files.html, "<html><head><title>Warm drill page</title></head><body><h1>Warm drill page</h1><p>Converted from <strong>HTML</strong> without a connection.</p></body></html>");
  await writeFile(files.epub, storedZip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Warm Drill Book</dc:title></metadata><manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'],
    ["OEBPS/chapter1.xhtml", "<html><head><title>Offline chapter</title></head><body><h1>Offline chapter</h1><p>This chapter was imported from an EPUB while the Lumen server was stopped.</p></body></html>"],
  ]));
  await writeFile(files.markdown, "# Warm drill plain note\n\nMarkdown never needs a converter.\n");
  return files;
};

// One edited lecture with TeX, one upload with a broken link, and one saved
// tutor answer with TeX: each renders through a warm tool.
const seedWarmDrillProfile = (page) => page.evaluate((lectureId) => new Promise((resolveSeed, reject) => {
  const now = new Date().toISOString();
  const turn = (id, role, content) => ({ id, role, content, mode: "explain", createdAt: now, requestId: null, data: null, citationSources: [], webSources: [], responseProfile: "balanced" });
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readwrite");
    const store = transaction.objectStore("study-data");
    const get = store.get("profile");
    // A fresh origin may not have saved a profile yet; the app normalizes
    // whatever it finds, so a partial record is enough.
    get.onsuccess = () => {
      const stored = get.result || {};
      store.put({
        ...stored,
        edits: { ...(stored.edits || {}), [lectureId]: "# Roadmap, edited\n\nThe weights $w^2$ render as math.\n" },
        customDocuments: [{ id: "custom/warm-drill.md", title: "Warm drill links", raw: "# Warm drill links\n\nSee [the missing note](custom/does-not-exist.md).\n", createdAt: now, updatedAt: now, tags: [] }, ...(stored.customDocuments || [])],
        aiTutorHistory: [turn("warm-q", "user", "What is x squared?"), turn("warm-a", "assistant", "It is $x^2$, the square of x.")],
      }, "profile");
    };
    transaction.oncomplete = () => resolveSeed();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("seeding the profile aborted"));
  };
}), EDITED_LECTURE);

const step = (label) => console.log(`Warm tool drill: ${label}`);

const openWorkerPage = async (url, downloads) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block", { timeout: 15_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30_000 });
  step("worker controls the page; seeding the profile");
  await seedWarmDrillProfile(page);
  await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block", { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30_000 });
  return page;
};

// The route list this worker's install stored, and which warm files its cache holds.
const warmCacheState = (page) => page.evaluate(async () => {
  const list = await (await caches.match(new URL("./offline-routes.json", location.href).href))?.json();
  const warm = Array.isArray(list?.warm) ? list.warm : [];
  const cached = [];
  for (const file of warm) if (await caches.match(new URL(file, location.href).href)) cached.push(file);
  return { warm, cached };
});

// Ask the worker to warm now and wait for its answer (the app asks on idle
// without a port; a concurrent pass is shared, so this waits for it too).
const warmNow = (page) => page.evaluate(() => new Promise((resolveWarm) => {
  const channel = new MessageChannel();
  const timer = setTimeout(() => resolveWarm({ timedOut: true }), 20_000);
  channel.port1.onmessage = (event) => { clearTimeout(timer); resolveWarm(event.data); };
  navigator.serviceWorker.controller.postMessage({ type: "WARM" }, [channel.port2]);
}));

const goOffline = async (page, server) => {
  await server.stop();
  // Assets are served immutable; clear Chrome's HTTP cache so only the
  // worker's Cache Storage can answer (see audit:visual).
  const session = await page.createCDPSession();
  await session.send("Network.clearBrowserCache");
  await session.detach();
  const answered = await page.evaluate(() => fetch(`/api/health?warm-drill=${Date.now()}`, { cache: "no-store" }).then(() => true, () => false));
  assert.equal(answered, false, "the stopped server still answered; the offline drill would prove nothing");
  await page.evaluate(() => { window.lumenWarmDrillDocument = true; });
};

const toastText = (page) => page.$eval(".toast", (node) => node.textContent).catch(() => "");
const waitForToast = (page, pattern, label) => page.waitForFunction(
  (source) => new RegExp(source).test(document.querySelector(".toast")?.textContent || ""),
  { timeout: 20_000 },
  pattern.source,
).catch(async () => assert.fail(`${label}: expected a toast matching ${pattern}, saw "${await toastText(page)}"`));
const dismissToast = async (page) => {
  await page.$eval(".toast button", (button) => button.click()).catch(() => {});
  await page.waitForSelector(".toast", { hidden: true, timeout: 5_000 });
};
const waitForDownload = async (directory, pattern) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = readdirSync(directory).filter((name) => pattern.test(name));
    if (found.length) return found;
    await new Promise((done) => setTimeout(done, 100));
  }
  return [];
};

const shellIntact = async (page, label) => {
  const state = await page.evaluate(() => ({
    sameDocument: window.lumenWarmDrillDocument === true,
    fatal: document.querySelector(".fatal-error h1")?.textContent || "",
    routeError: document.querySelector(".route-error h1")?.textContent || "",
    recoveryMarker: sessionStorage.getItem("lumen:chunk-recovery-v1"),
  }));
  assert.equal(state.sameDocument, true, `${label}: the page reloaded`);
  assert.equal(state.fatal, "", `${label}: the app was replaced by "${state.fatal}"`);
  assert.equal(state.routeError, "", `${label}: the screen was replaced by "${state.routeError}"`);
  assert.equal(state.recoveryMarker, null, `${label}: chunk recovery scheduled a reload`);
};

const openSettings = async (page) => {
  await page.$eval('[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".settings-page .backup-password-field input", { timeout: 15_000 });
};
const closeSettings = (page) => page.$eval(".settings-close", (button) => button.click()).then(() => page.waitForSelector(".settings-drawer", { hidden: true }));
const typeInto = (page, selector, value) => page.$eval(selector, (field, text) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}, value);
const clickButton = (page, scope, pattern) => page.$$eval(`${scope} button`, (buttons, source) => {
  const button = buttons.find((item) => new RegExp(source).test(item.textContent) && !item.disabled);
  button?.click();
  return Boolean(button);
}, pattern.source);
const openNotebook = async (page) => {
  await page.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Notebook").click());
  await page.waitForSelector(".notebook-page .notebook-actions", { timeout: 15_000 });
};

// With the warm tools cached and the server stopped, every warm action works.
const warmThenOfflineDrill = async (downloads, fixtures) => {
  const server = await startIsolatedServer();
  let page;
  try {
    page = await openWorkerPage(server.url, downloads);
    // "One idle period": the app itself asks the worker after the first idle.
    const warmed = await page.waitForFunction(async () => {
      const list = await (await caches.match(new URL("./offline-routes.json", location.href).href))?.json();
      if (!Array.isArray(list?.warm) || !list.warm.length) return false;
      for (const file of list.warm) if (!(await caches.match(new URL(file, location.href).href))) return false;
      return true;
    }, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    const state = await warmCacheState(page);
    assert.ok(warmed && state.warm.length > 0, `the worker did not warm the tools after the first idle (${state.cached.length} of ${state.warm.length} cached)`);
    assert.ok(state.warm.some((file) => /\/katex-[^/]+\.js$/.test(file)), "KaTeX is not a warm tool");
    step("warmed; stopping the server");
    await goOffline(page, server);

    // Backup export, encrypted export and backup import.
    await openSettings(page);
    assert.ok(await clickButton(page, ".settings-drawer", /^\s*Export backup/), "offline: no Export backup button");
    await waitForToast(page, /Backup verified with SHA-256/, "offline backup export");
    await dismissToast(page);
    await typeInto(page, 'input[aria-label="Optional backup encryption password"]', "warm drill passphrase");
    assert.ok(await clickButton(page, ".settings-drawer", /Export encrypted backup/), "offline: no Export encrypted backup button");
    await waitForToast(page, /encrypted with AES-256-GCM/, "offline encrypted export");
    await dismissToast(page);
    const backups = await waitForDownload(downloads, /^lumen-notes-backup-.*\.json$/);
    assert.equal(backups.length, 1, `offline backup export did not download one JSON file (${readdirSync(downloads).join(", ")})`);
    assert.equal((await waitForDownload(downloads, /^lumen-notes-backup-.*\.lumenc$/)).length, 1, "offline encrypted export did not download its file");
    const importInput = await page.$('.settings-drawer input[type="file"][accept*=".lumenc"]:not([multiple])');
    await importInput.uploadFile(join(downloads, backups[0]));
    await page.waitForSelector(".backup-preflight-dialog", { timeout: 15_000 }).catch(async () => assert.fail(`offline backup import did not reach its preflight review; toast: "${await toastText(page)}"`));
    await page.$eval('.backup-preflight-layer [aria-label="Cancel backup restore"]', (button) => button.click());
    await page.waitForSelector(".backup-preflight-dialog", { hidden: true });

    step("backup export, encrypted export and import worked offline");
    // Sync export (creating a vault needs no tool).
    await openSettings(page);
    await typeInto(page, 'input[aria-label="Sync vault passphrase"]', "warm drill vault passphrase");
    assert.ok(await clickButton(page, ".settings-drawer", /Create sync vault/), "offline: could not create a sync vault");
    await waitForToast(page, /Sync vault created/, "offline vault creation");
    assert.ok(await clickButton(page, ".settings-drawer", /Export my sync file/), "offline: no Export my sync file button");
    await waitForToast(page, /Sync file exported as/, "offline sync export");
    await dismissToast(page);
    await closeSettings(page);
    await shellIntact(page, "offline backup and sync");

    step("sync export worked offline");
    // EPUB and HTML upload, then the link check.
    await openNotebook(page);
    const uploadInput = await page.$('.notebook-actions input[type="file"]');
    await uploadInput.uploadFile(fixtures.html, fixtures.epub);
    await waitForToast(page, /2 documents imported/, "offline HTML and EPUB upload");
    await dismissToast(page);
    const titles = await page.$$eval(".notebook-document-row", (rows) => rows.map((row) => row.textContent));
    assert.ok(titles.some((title) => title.includes("Warm drill page")), "the offline HTML upload is not in the notebook");
    assert.ok(titles.some((title) => title.includes("Warm Drill Book")), "the offline EPUB upload is not in the notebook");
    assert.ok(await clickButton(page, ".notebook-heading-actions", /Check links/), "offline: no Check links button");
    await page.waitForSelector(".link-report", { timeout: 15_000 }).catch(async () => assert.fail(`the offline link check did not report; toast: "${await toastText(page)}"`));
    assert.match(await page.$eval(".link-report", (node) => node.textContent), /does-not-exist\.md/, "the offline link check missed the broken link");
    await shellIntact(page, "offline uploads and link check");

    step("uploads and the link check worked offline");
    // A saved tutor answer with $x^2$ and an edited lecture with TeX draw KaTeX.
    await page.evaluate(() => { location.hash = "#/ai"; });
    await page.waitForSelector(".ai-tutor__response-text .katex", { timeout: 15_000 }).catch(async () => assert.fail(`the saved tutor answer did not render its math offline: ${await page.$eval("#main-content", (node) => node.textContent.slice(0, 300)).catch(() => "")}`));
    assert.equal(await page.$(".ai-tutor__math-pending"), null, "offline tutor math stayed as TeX source after warming");
    await page.evaluate((id) => { location.hash = `#/read/${encodeURIComponent(id)}`; }, EDITED_LECTURE);
    await page.waitForSelector(".markdown-body .katex", { timeout: 15_000 }).catch(() => assert.fail("the edited lecture's TeX did not render as math offline"));

    // Library retrieval, and every other warm module, load from the cache.
    const modules = await page.evaluate(async () => {
      const list = await (await caches.match(new URL("./offline-routes.json", location.href).href)).json();
      const loaded = {};
      for (const [name, exported] of [["libraryRetrieval", "retrieveLibrary"], ["backupTools", "createBackup"], ["importConverters", "importEpub"], ["linkAudit", "auditLearnerLinks"], ["markdownMath", "renderMarkdownWithMath"], ["tutorMath", "tutorMathExtensions"]]) {
        const file = list.warm.find((item) => item.startsWith(`assets/${name}-`) && item.endsWith(".js"));
        try {
          loaded[name] = typeof (await import(new URL(file, location.href).href))[exported];
        } catch (error) {
          loaded[name] = error.message;
        }
      }
      return loaded;
    });
    assert.deepEqual(modules, { libraryRetrieval: "function", backupTools: "function", importConverters: "function", linkAudit: "function", markdownMath: "function", tutorMath: "object" }, "a warm module did not load from the offline cache");
    await shellIntact(page, "offline math and modules");
  } finally {
    await page?.close().catch(() => {});
    await server.stop();
  }
};

// With warming blocked, each warm action says it needs a connection once.
const warmingBlockedDrill = async (downloads, fixtures) => {
  const farm = await distWithoutWarmTools(join(profileDirectory, "dist-without-warm-tools"));
  assert.ok(farm.blocked > 0, "the build names no warm tools to block");
  const server = await startIsolatedServer(farm.directory);
  let page;
  try {
    page = await openWorkerPage(server.url, downloads);
    step("warming blocked: asking the worker to warm");
    const result = await warmNow(page);
    assert.equal(result.timedOut, undefined, "the worker never answered the WARM request");
    assert.equal(result.failed?.length, farm.blocked, `blocked warm files were not reported as failed: ${JSON.stringify(result)}`);
    assert.equal((await warmCacheState(page)).cached.length, 0, "a blocked warm file was cached anyway");
    step("warming failed as blocked; stopping the server");
    await goOffline(page, server);

    const expectTypedToast = async (label) => {
      await waitForToast(page, new RegExp(WARM_TOOL_OFFLINE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
      await dismissToast(page);
      await shellIntact(page, label);
    };
    await openSettings(page);
    assert.ok(await clickButton(page, ".settings-drawer", /^\s*Export backup/), "blocked: no Export backup button");
    await expectTypedToast("blocked backup export");
    await typeInto(page, 'input[aria-label="Optional backup encryption password"]', "warm drill passphrase");
    assert.ok(await clickButton(page, ".settings-drawer", /Export encrypted backup/), "blocked: no Export encrypted backup button");
    await expectTypedToast("blocked encrypted export");
    await (await page.$('.settings-drawer input[type="file"][accept*=".lumenc"]:not([multiple])')).uploadFile(fixtures.markdown);
    await expectTypedToast("blocked backup import");
    await typeInto(page, 'input[aria-label="Sync vault passphrase"]', "warm drill vault passphrase");
    assert.ok(await clickButton(page, ".settings-drawer", /Create sync vault/), "blocked: could not create a sync vault");
    await waitForToast(page, /Sync vault created/, "blocked vault creation");
    assert.ok(await clickButton(page, ".settings-drawer", /Export my sync file/), "blocked: no Export my sync file button");
    await expectTypedToast("blocked sync export");
    await closeSettings(page);

    await openNotebook(page);
    const uploadInput = await page.$('.notebook-actions input[type="file"]');
    await uploadInput.uploadFile(fixtures.html);
    await expectTypedToast("blocked HTML upload");
    await uploadInput.uploadFile(fixtures.epub);
    await expectTypedToast("blocked EPUB upload");
    // Markdown needs no converter, so it still imports.
    await uploadInput.uploadFile(fixtures.markdown);
    await waitForToast(page, /1 document imported/, "blocked-tier Markdown upload");
    await dismissToast(page);
    assert.ok(await clickButton(page, ".notebook-heading-actions", /Check links/), "blocked: no Check links button");
    await expectTypedToast("blocked link check");
    assert.equal(await page.$(".link-report"), null, "a link report appeared although the link check could not load");

    // Math is readable TeX source, never an error.
    await page.evaluate(() => { location.hash = "#/ai"; });
    await page.waitForSelector(".ai-tutor__response-text .ai-tutor__math-pending", { timeout: 15_000 }).catch(() => assert.fail("the saved tutor answer did not show its TeX source with KaTeX blocked"));
    assert.equal(await page.$eval(".ai-tutor__response-text .ai-tutor__math-pending", (node) => node.textContent), "$x^2$", "blocked tutor math is not the readable TeX source");
    assert.equal(await page.$(".ai-tutor__response-text .katex"), null, "tutor math rendered KaTeX although it was blocked");
    await page.evaluate((id) => { location.hash = `#/read/${encodeURIComponent(id)}`; }, EDITED_LECTURE);
    await page.waitForFunction(() => document.querySelector(".markdown-body")?.textContent.includes("The weights $w^2$ render as math."), { timeout: 15_000 })
      .catch(() => assert.fail("the edited lecture did not show its TeX source with KaTeX blocked"));
    assert.equal(await page.$(".markdown-body .katex"), null, "the edited lecture rendered KaTeX although it was blocked");
    await shellIntact(page, "blocked math");
  } finally {
    await page?.close().catch(() => {});
    await server.stop();
  }
};

// The warm files a cache holds, by the route list stored in that cache.
const warmFilesIn = (page, cacheName) => page.evaluate(async (name) => {
  if (!(await caches.has(name))) return { warm: 0, cached: 0 };
  const cache = await caches.open(name);
  const list = await (await cache.match(new URL("./offline-routes.json", location.href).href))?.json();
  const warm = Array.isArray(list?.warm) ? list.warm : [];
  let cached = 0;
  for (const file of warm) if (await cache.match(new URL(file, location.href).href)) cached += 1;
  return { warm: warm.length, cached };
}, cacheName);

// An update found online can take over later, when Lumen opens offline, and
// activation deletes the cache that held the previous release's warm tools.
// The waiting release must have saved its own by then.
const updateDrill = async (downloads) => {
  const release = await distForUpdate(join(profileDirectory, "dist-update"));
  const server = await startIsolatedServer(release.directory);
  let page;
  try {
    page = await openWorkerPage(server.url, downloads);
    const nextBuild = `update-drill-${Date.now().toString(36)}`;
    const nextCache = `lumen-ai-notes-v${nextBuild}`;
    await release.publish(nextBuild);
    // The app's own registration, now with the next release's worker, as when
    // a new release's page registers its build.
    const waiting = await page.evaluate(async (build) => {
      const registration = await navigator.serviceWorker.register(`./service-worker.js?build=${encodeURIComponent(build)}`);
      for (let attempt = 0; attempt < 120 && !registration.waiting?.scriptURL.includes(build); attempt += 1) {
        await new Promise((done) => setTimeout(done, 250));
      }
      return registration.waiting?.scriptURL.includes(build) === true;
    }, nextBuild);
    assert.ok(waiting, "the update's worker did not install and wait");
    step("an update is waiting; checking that it saved its warm tools");
    const saved = await page.waitForFunction(async (name) => {
      if (!(await caches.has(name))) return false;
      const cache = await caches.open(name);
      const list = await (await cache.match(new URL("./offline-routes.json", location.href).href))?.json();
      if (!Array.isArray(list?.warm) || !list.warm.length) return false;
      for (const file of list.warm) if (!(await cache.match(new URL(file, location.href).href))) return false;
      return true;
    }, { timeout: 30_000, polling: 250 }, nextCache).then(() => true, () => false);
    const counts = await warmFilesIn(page, nextCache);
    assert.ok(saved, `the waiting update did not save the warm tools in its own cache (${counts.cached} of ${counts.warm})`);

    // Apply it with the server stopped, as the app's Update button does.
    await goOffline(page, server);
    // The page changes controller as activation starts; the old cache goes
    // when the worker's activate handler has finished.
    const activated = await page.evaluate((build) => new Promise((resolveActivation) => {
      const timer = setTimeout(() => resolveActivation(false), 15_000);
      navigator.serviceWorker.getRegistration().then((registration) => {
        const worker = registration.waiting;
        worker.addEventListener("statechange", () => {
          if (worker.state !== "activated") return;
          clearTimeout(timer);
          resolveActivation(navigator.serviceWorker.controller?.scriptURL.includes(build) === true);
        });
        worker.postMessage({ type: "SKIP_WAITING" });
      });
    }), nextBuild);
    assert.ok(activated, "the update did not take over with the server stopped");
    const appCaches = await page.evaluate(() => caches.keys().then((keys) => keys.filter((key) => key.startsWith("lumen-ai-notes-v"))));
    assert.deepEqual(appCaches, [nextCache], "activation did not retire the previous release's cache, so the drill proves nothing");

    step("the update took over offline; exporting a backup");
    await openSettings(page);
    assert.ok(await clickButton(page, ".settings-drawer", /^\s*Export backup/), "after the update: no Export backup button");
    await waitForToast(page, /Backup verified with SHA-256/, "backup export after an update applied offline");
    await dismissToast(page);
    await closeSettings(page);
    await shellIntact(page, "after an update applied offline");
  } finally {
    await page?.close().catch(() => {});
    await server.stop();
  }
};

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // Force each lazy request through DevTools interception instead of allowing a
  // prior shell-cache response to hide the simulated missing deployment file.
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);

  await page.goto(baseUrl.href, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block");
  await page.evaluate(() => localStorage.setItem("lumen:chunk-recovery-audit", "preserve"));

  let blockWhiteboard = true;
  let blockedWhiteboard = 0;
  let blockPhoneCss = false;
  let blockedPhoneCss = 0;
  let missingWhiteboard = false;
  let missingStorageHealth = false;
  const observedAssets = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/assets/")) observedAssets.push(pathname);
    // A file that is missing from the deployment itself, on every request.
    if ((missingWhiteboard && /\/assets\/Whiteboard-[^/]+\.js$/.test(pathname)) || (missingStorageHealth && /\/assets\/StorageHealth-[^/]+\.js$/.test(pathname))) {
      void request.respond({ status: 404, contentType: "text/plain", body: "missing" });
      return;
    }
    if (blockWhiteboard && /\/assets\/Whiteboard-[^/]+\.js$/.test(pathname)) {
      blockWhiteboard = false;
      blockedWhiteboard += 1;
      void request.abort("failed");
      return;
    }
    if (blockPhoneCss && /\/assets\/PhoneLocalAiTutor-[^/]+\.css$/.test(pathname)) {
      blockPhoneCss = false;
      blockedPhoneCss += 1;
      void request.abort("failed");
      return;
    }
    void request.continue();
  });

  const documentId = encodeURIComponent("notes/00-roadmap.md");
  await page.goto(new URL(`#/board/${documentId}`, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForSelector(".advanced-board", { timeout: 30_000 });
  assert.equal(blockedWhiteboard, 1, `the stale Whiteboard chunk request was not simulated exactly once; observed ${observedAssets.join(", ")}`);
  assert.equal(await navigationWasReload(page), true, "a stale Whiteboard chunk did not trigger the bounded reload");
  assert.equal(await page.evaluate(() => localStorage.getItem("lumen:chunk-recovery-audit")), "preserve", "chunk recovery removed local browser data");
  assert.equal(await page.$(".fatal-error"), null, "Whiteboard remained on the fatal error screen after a fresh chunk became available");

  await page.goto(new URL("#/ai", baseUrl).href, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector('[data-ai-engine-option="phone-local"]');
  assert.equal(await page.evaluate(() => sessionStorage.getItem("lumen:chunk-recovery-v1")), null, "Whiteboard recovery left its cooldown marker after the fresh chunk loaded");
  blockPhoneCss = true;
  let resolvePhoneReload;
  const phoneReloaded = new Promise((resolve) => { resolvePhoneReload = resolve; });
  const handlePhoneReload = () => resolvePhoneReload(true);
  page.once("load", handlePhoneReload);
  await page.click('[data-ai-engine-option="phone-local"]');
  const phoneReloadObserved = await Promise.race([
    phoneReloaded,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  page.off("load", handlePhoneReload);
  assert.equal(phoneReloadObserved, true, `stale on-device tutor CSS did not reload; blocked=${blockedPhoneCss}; assets=${observedAssets.join(", ")}`);
  await page.waitForSelector('[data-ai-engine-option="phone-local"]', { timeout: 30_000 });
  assert.equal(blockedPhoneCss, 1, "the stale on-device tutor CSS request was not simulated exactly once");
  assert.equal(await navigationWasReload(page), true, "stale on-device tutor CSS did not trigger the bounded reload");

  // The repaired document may already restore the remembered engine; choosing
  // it again is harmless and verifies the now-available CSS/module pair works.
  await page.click('[data-ai-engine-option="phone-local"]');
  await page.waitForSelector(".phone-local-ai", { timeout: 30_000 });
  assert.equal(await page.$(".fatal-error"), null, "on-device tutor remained on the fatal error screen after recovery");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("lumen:chunk-recovery-v1")), null, "successful lazy loading did not clear the recovery cooldown marker");

  const routeError = () => page.evaluate(() => ({
    title: document.querySelector(".route-error h1")?.textContent || "",
    actions: [...document.querySelectorAll(".route-error button")].map((button) => button.textContent.trim()),
    bottomNav: Boolean(document.querySelector(".bottom-nav button")),
    fatal: Boolean(document.querySelector(".fatal-error")),
    // The panel lives inside the one <main id="main-content"> landmark.
    inMain: Boolean(document.querySelector("#main-content .route-error")),
    mains: document.querySelectorAll("main, [role='main']").length,
    headingFocused: document.activeElement === document.querySelector(".route-error h1"),
  }));
  const goHomeFromRouteError = async () => {
    await page.$$eval(".route-error button", (buttons) => buttons.find((button) => button.textContent.includes("Go to Home")).click());
    await page.waitForSelector(".welcome-block", { timeout: 15_000 });
    assert.equal(await page.$(".route-error"), null, "navigating Home did not clear the failed screen");
  };

  // Offline, a screen that was never downloaded stays inside the shell and
  // says so; it neither reloads nor replaces the app.
  await page.setOfflineMode(true);
  await page.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Read").click());
  await page.waitForSelector(".route-error", { timeout: 30_000 });
  const offlineScreen = await routeError();
  assert.equal(offlineScreen.title, "This screen is not available offline yet", "an offline chunk failure was not explained as offline");
  assert.equal(offlineScreen.bottomNav, true, "an offline chunk failure removed the bottom navigation");
  assert.equal(offlineScreen.fatal, false, "an offline chunk failure replaced the whole app");
  assert.ok(offlineScreen.actions.some((label) => label.includes("Go to Home")), "the offline screen has no way back to Home");
  assert.equal(offlineScreen.inMain && offlineScreen.mains === 1, true, `the failed screen left the single main landmark (${offlineScreen.mains} mains, inside #main-content: ${offlineScreen.inMain})`);
  await goHomeFromRouteError();
  // React.lazy rethrows the failed import at once, so on a second visit the
  // panel is present when route focus runs and its heading takes focus.
  await page.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Read").click());
  await page.waitForSelector(".route-error h1", { timeout: 15_000 });
  await page.waitForFunction(() => document.activeElement === document.querySelector(".route-error h1"), { timeout: 5_000 }).catch(() => {});
  assert.equal((await routeError()).headingFocused, true, "returning to a failed screen did not move route focus to its heading");
  await goHomeFromRouteError();
  await page.setOfflineMode(false);

  // A file missing from the deployment while the server is reachable: one
  // bounded reload, then an in-shell repair prompt instead of the fatal screen.
  missingWhiteboard = true;
  let resolveBoardReload;
  const boardReloaded = new Promise((resolve) => { resolveBoardReload = resolve; });
  const handleBoardReload = () => resolveBoardReload(true);
  page.once("load", handleBoardReload);
  await page.evaluate((id) => { location.hash = `#/board/${id}`; }, documentId);
  const boardReloadObserved = await Promise.race([boardReloaded, new Promise((resolve) => setTimeout(() => resolve(false), 15_000))]);
  page.off("load", handleBoardReload);
  assert.equal(boardReloadObserved, true, "a missing Whiteboard chunk did not get its one bounded reload");
  await page.waitForFunction(() => document.querySelector(".route-error h1")?.textContent === "Lumen needs fresh app files", { timeout: 30_000 });
  const staleScreen = await routeError();
  assert.equal(staleScreen.bottomNav, true, "a missing chunk after recovery removed the bottom navigation");
  assert.equal(staleScreen.fatal, false, "a missing chunk after recovery replaced the whole app");
  assert.ok(staleScreen.actions.some((label) => label.includes("Repair app files")), "a missing deployment file did not offer app-file repair");
  assert.equal(await page.evaluate(() => localStorage.getItem("lumen:chunk-recovery-audit")), "preserve", "the in-shell failure removed local browser data");
  await goHomeFromRouteError();
  missingWhiteboard = false;

  // Storage health is optional: when it cannot load, Settings and backup
  // export stay usable. The recovery reload was already spent above.
  missingStorageHealth = true;
  await page.$eval('[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".storage-health-unavailable", { timeout: 30_000 });
  assert.equal(await page.$(".fatal-error"), null, "a missing Storage health chunk replaced the whole app");
  assert.equal(await page.$$eval(".settings-drawer button", (buttons) => buttons.some((button) => /Export (?:encrypted )?backup/.test(button.textContent) && !button.disabled)), true, "a missing Storage health chunk made backup export unavailable");
  await page.$eval(".settings-close", (button) => button.click());
  missingStorageHealth = false;
  await page.close();

  // Issue #96 (NM1): a lecture whose Mermaid chunk stays missing while the
  // server answers. The marker names that chunk, so the Reader chunk loading
  // after the one reload must not clear it; before the fix every reload
  // re-armed the next and the tab looped (113 navigations measured). A new
  // tab starts with its own sessionStorage, so no earlier marker applies.
  const lecturePage = await browser.newPage();
  await lecturePage.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await lecturePage.setBypassServiceWorker(true);
  await lecturePage.setCacheEnabled(false);
  await lecturePage.setRequestInterception(true);
  let blockedMermaid = 0;
  let documentLoads = 0;
  let lastDocumentLoad = Date.now();
  lecturePage.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === lecturePage.mainFrame()) {
      documentLoads += 1;
      lastDocumentLoad = Date.now();
    }
    if (/\/assets\/mermaid\.core-[^/]+\.js$/.test(new URL(request.url()).pathname)) {
      blockedMermaid += 1;
      void request.abort("failed");
      return;
    }
    void request.continue();
  });
  const lectureId = encodeURIComponent("notes/part-01-foundations/01-ai-ml-mental-model.md");
  await lecturePage.goto(new URL(`#/read/${lectureId}`, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  // Settled: the diagram shows its failure and no document has loaded for 4 s.
  let settled = false;
  for (const giveUpAt = Date.now() + 30_000; Date.now() < giveUpAt;) {
    const failed = await lecturePage.evaluate(() => Boolean(document.querySelector('.diagram-shell[data-diagram-status="error"]'))).catch(() => false);
    if (failed && Date.now() - lastDocumentLoad > 4_000) {
      settled = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const mermaidReloads = documentLoads - 1;
  assert.ok(blockedMermaid >= 1, "the Mermaid chunk request was never made, so nothing was tested");
  assert.ok(mermaidReloads <= 1, `a lecture whose Mermaid chunk is missing reloaded ${mermaidReloads} times within the cooldown (Mermaid blocked ${blockedMermaid} times)`);
  assert.equal(settled, true, "a missing Mermaid chunk never settled on the diagram failure inside the Reader");
  assert.equal(await lecturePage.$(".fatal-error"), null, "a missing Mermaid chunk replaced the whole app");
  assert.ok(await lecturePage.$(".markdown-body h1"), "the lecture did not stay readable with its diagram unavailable");
  await lecturePage.close();

  // The Notebook and Settings are lazy now (issue #95). Opened while their
  // chunks are still downloading, route focus still ends on the Notebook's
  // heading and Settings still focuses its close button, as when both were
  // in the startup bundle.
  const slowPage = await browser.newPage();
  await slowPage.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await slowPage.setBypassServiceWorker(true);
  await slowPage.setCacheEnabled(false);
  await slowPage.setRequestInterception(true);
  let heldScreens = 0;
  slowPage.on("request", (request) => {
    if (/\/assets\/(?:Notebook|Settings)-[^/]+\.js$/.test(new URL(request.url()).pathname)) {
      heldScreens += 1;
      setTimeout(() => void request.continue(), 1_500);
      return;
    }
    void request.continue();
  });
  await slowPage.goto(baseUrl.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await slowPage.waitForSelector(".welcome-block", { timeout: 30_000 });
  await slowPage.$$eval(".bottom-nav button", (buttons) => buttons.find((button) => button.textContent.trim() === "Notebook").click());
  const notebookLoading = await slowPage.evaluate(() => Boolean(document.querySelector("#main-content .view-loading")) && !document.querySelector(".notebook-page"));
  await slowPage.waitForSelector(".notebook-page h1", { timeout: 15_000 });
  await slowPage.waitForFunction(() => document.activeElement?.matches?.(".notebook-page h1"), { timeout: 5_000 }).catch(() => {});
  const notebookFocus = await slowPage.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim() }));
  assert.equal(notebookLoading, true, "the Notebook was already loaded, so its lazy route focus was not tested");
  assert.deepEqual(notebookFocus, { tag: "H1", text: "Study notebook" }, "route focus stayed on the main landmark after the lazy Notebook rendered");
  await slowPage.$eval('[aria-label="Open settings"]', (button) => button.click());
  await slowPage.waitForSelector(".settings-drawer .settings-page", { timeout: 15_000 });
  assert.equal(await slowPage.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close settings", "Settings did not focus its close button while its content loaded");
  assert.ok(heldScreens >= 2, `the Notebook and Settings chunks were not both requested (${heldScreens})`);
  await slowPage.close();

  // Warm tools: warmed then offline, and with warming blocked.
  const downloads = join(profileDirectory, "downloads");
  await mkdir(downloads, { recursive: true });
  const fixtures = await writeUploadFixtures(profileDirectory);
  assert.ok(existsSync(join(dist, "offline-routes.json")), `no build to serve at ${dist}`);
  await warmThenOfflineDrill(downloads, fixtures);
  const blockedDownloads = join(profileDirectory, "downloads-blocked");
  await mkdir(blockedDownloads, { recursive: true });
  await warmingBlockedDrill(blockedDownloads, fixtures);
  const updateDownloads = join(profileDirectory, "downloads-update");
  await mkdir(updateDownloads, { recursive: true });
  await updateDrill(updateDownloads);

  console.log(`Chunk recovery audit passed: stale Whiteboard JS and on-device tutor CSS each recovered with local data preserved; offline and missing screens stayed inside the shell, Settings kept backup export without Storage health, and a lecture with a missing Mermaid chunk reloaded ${mermaidReloads} time(s), then showed the diagram failure in the Reader. The lazy Notebook and Settings kept their route and dialog focus while their chunks loaded. Warm tools: after one idle, with the server stopped, backup export and import, encrypted export, sync export, HTML and EPUB upload, the link check, a saved tutor answer with math, an edited lecture with TeX, and every warm module worked; with warming blocked each action said it needs a connection once, with no error screen or reload, and math stayed readable TeX source; and a waiting update saved its own warm tools, so backup export still worked after it took over with the server stopped.`);
} finally {
  await browser?.close().catch(() => {});
  await rm(profileDirectory, { recursive: true, force: true });
}
