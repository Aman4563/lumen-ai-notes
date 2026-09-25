import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { startApplicationServer, silentLogger } from "../server/server.mjs";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "lumen-visual-audit-"));
const failures = [];
const runtimeErrors = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

let offlineChecks = "";

const startIsolatedServer = async () => {
  const app = await startApplicationServer({ env: { HOST: "127.0.0.1", PORT: "0", AI_ENABLED: "false", WEB_SEARCH_ENABLED: "false" }, logger: silentLogger });
  let running = true;
  return {
    url: `http://127.0.0.1:${app.server.address().port}/`,
    stop: () => {
      if (!running) return Promise.resolve();
      running = false;
      return new Promise((resolve) => { app.server.closeAllConnections(); app.server.close(resolve); });
    },
  };
};

// Checks the route list the installed worker stored against its own cache.
const missingRouteFiles = (page) => page.evaluate(async () => {
  const list = await (await caches.match(new URL("./offline-routes.json", location.href).href))?.json();
  const files = list?.files || [];
  const missing = [];
  for (const file of files) if (!(await caches.match(new URL(file, location.href).href))) missing.push(file);
  return { files: files.length, missing };
});

const openControlledPage = async (url, errors) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block", { timeout: 15_000 });
  // Stop a server only after its release finished installing and claimed the page.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30_000 });
  return page;
};

// Stopping the server is not enough: fingerprinted assets are served
// `immutable`, so Chrome's HTTP cache (filled by the worker's own install
// fetches) would answer them and hide a worker that never serves its cache.
// Clear it browser-wide; Cache Storage is separate and stays.
const goOffline = async (page, server) => {
  await server.stop();
  const session = await page.createCDPSession();
  await session.send("Network.clearBrowserCache");
  await session.detach();
  const answered = await page.evaluate(() => fetch(`/api/health?offline-audit=${Date.now()}`, { cache: "no-store" }).then(() => true, () => false));
  assert(!answered, "the stopped isolated server still answered; the offline checks would prove nothing");
};

const shellState = (page) => page.evaluate(() => ({
  fatal: document.querySelector(".fatal-error h1")?.textContent || "",
  routeError: document.querySelector(".route-error h1")?.textContent || "",
  bottomNav: Boolean(document.querySelector(".bottom-nav button")),
}));

const tapBottomNav = (page, label) => page.$$eval(".bottom-nav button", (buttons, wanted) => {
  const button = buttons.find((item) => item.textContent.trim() === wanted);
  button?.click();
  return Boolean(button);
}, label);

const serverStoppedChecks = async (readerId, readerTitle) => {
  const errors = [];
  // Fresh profile, Home only, then the server stops: every primary screen opens.
  const homeOnly = await startIsolatedServer();
  let page;
  try {
    page = await openControlledPage(homeOnly.url, errors);
    const routes = await missingRouteFiles(page);
    assert(routes.files > 0 && routes.missing.length === 0, `a Home-only visit did not precache the route screens: ${routes.missing.join(", ") || "no route list"}`);
    await goOffline(page, homeOnly);

    assert(await tapBottomNav(page, "Read"), "offline: the Read tab was not found");
    await page.waitForFunction(() => document.querySelector(".markdown-body h1, #main-content .empty-state, .route-error, .fatal-error"), { timeout: 15_000 }).catch(() => {});
    let shell = await shellState(page);
    assert(!shell.fatal && !shell.routeError && shell.bottomNav, `offline Read after a Home-only visit left the shell: ${shell.fatal || shell.routeError || "bottom navigation missing"}`);
    assert(await page.$(".markdown-body h1, #main-content .empty-state"), "offline Read after a Home-only visit rendered neither the lecture nor an in-page message");

    assert(await tapBottomNav(page, "AI Tutor"), "offline: the AI Tutor tab was not found");
    const studio = await page.waitForSelector('[data-ai-engine-option="phone-local"]', { timeout: 15_000 }).catch(() => null);
    assert(Boolean(studio), "offline AI Tutor did not render the AI learning studio after a Home-only visit");
    assert(Boolean(await page.waitForSelector(".ai-learning-studio .ai-tutor", { timeout: 15_000 }).catch(() => null)), "offline Mac-local tutor did not render after a Home-only visit");
    if (studio) {
      await page.click('[data-ai-engine-option="phone-local"]');
      assert(Boolean(await page.waitForSelector(".phone-local-ai", { timeout: 15_000 }).catch(() => null)), "offline On-device Lite tutor did not render after a Home-only visit");
    }
    shell = await shellState(page);
    assert(!shell.fatal && !shell.routeError, `offline AI Tutor degraded: ${shell.fatal || shell.routeError}`);

    await page.evaluate((id) => { location.hash = `#/board/${id}`; }, readerId);
    assert(Boolean(await page.waitForSelector(".board-canvas", { timeout: 15_000 }).catch(() => null)), "offline Whiteboard did not render after a Home-only visit");
    await page.evaluate(() => { location.hash = "#/review"; });
    assert(Boolean(await page.waitForSelector(".review-center-page", { timeout: 15_000 }).catch(() => null)), "offline Review did not render after a Home-only visit");
    await page.evaluate(() => { location.hash = "#/device-evidence"; });
    assert(Boolean(await page.waitForSelector(".device-evidence-page", { timeout: 15_000 }).catch(() => null)), "offline Device evidence did not render after a Home-only visit");

    await page.evaluate(() => { location.hash = "#/home"; });
    const settingsButton = await page.waitForSelector('[aria-label="Open settings"]', { timeout: 10_000 }).catch(() => null);
    assert(Boolean(settingsButton), "offline: the shell lost its Settings button");
    if (settingsButton) {
      await settingsButton.click();
      assert(Boolean(await page.waitForSelector(".storage-health", { timeout: 15_000 }).catch(() => null)), "offline Settings did not render Storage health after a Home-only visit");
      const exportBackup = await page.$$eval(".settings-drawer button", (buttons) => buttons.some((button) => /Export (?:encrypted )?backup/.test(button.textContent) && !button.disabled));
      assert(exportBackup, "offline Settings lost the backup export");
    }
    shell = await shellState(page);
    assert(!shell.fatal, `offline Settings replaced the app: ${shell.fatal}`);

    // Read above mounts the Reader only because Home already loaded the first
    // lecture into memory; another lecture would show the in-page message.
    // Evaluate every route screen's module (and its static imports) from the
    // offline cache, whichever screens the steps above happened to mount.
    const screens = await page.evaluate(async () => {
      const list = await (await caches.match(new URL("./offline-routes.json", location.href).href)).json();
      const failed = [];
      // Each module with the export the app renders from it.
      const modules = [["Reader", "default"], ["markdownMath", "renderMarkdownWithMath"], ["Whiteboard", "default"], ["AiLearningStudio", "default"], ["AiTutor", "default"], ["PhoneLocalAiTutor", "default"], ["ReviewCenter", "default"], ["ReviewCenter", "ReviewCardDialog"], ["AssessmentDialog", "default"], ["StorageHealth", "default"], ["DeviceEvidence", "default"]];
      for (const [name, exported] of modules) {
        const file = list.files.find((item) => item.startsWith(`assets/${name}-`) && item.endsWith(".js"));
        try {
          if (!file) failed.push(`${name}: not in the route list`);
          else if (typeof (await import(new URL(file, location.href).href))[exported] !== "function") failed.push(`${name}: no ${exported} export`);
        } catch (error) {
          failed.push(`${name}: ${error.message}`);
        }
      }
      return failed;
    });
    assert(screens.length === 0, `route screens did not load from the offline cache: ${screens.join(" | ")}`);
  } catch (error) {
    // A reload or a replaced app detaches the page mid-check; report it as a failure.
    assert(false, `offline screens after a Home-only visit broke: ${error.message}`);
  } finally {
    await page?.close().catch(() => {});
    await homeOnly.stop();
  }

  // A lecture visited online reopens after a full reload with the server stopped.
  const visited = await startIsolatedServer();
  let lectureChars = 0;
  try {
    page = await openControlledPage(visited.url, errors);
    // Repair app files deletes every Lumen cache and unregisters the worker
    // (update() would not reinstall the same URL). Its reload must install
    // this build again, route screens included.
    await page.evaluate(async () => {
      for (const key of await caches.keys()) if (key.startsWith("lumen-ai-notes-v")) await caches.delete(key);
      await (await navigator.serviceWorker.getRegistration())?.unregister();
    });
    await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    const reinstalled = await page.waitForFunction(async () => {
      const list = await (await caches.match(new URL("./offline-routes.json", location.href).href))?.json();
      if (!navigator.serviceWorker.controller || !list?.files?.length) return false;
      for (const file of list.files) if (!(await caches.match(new URL(file, location.href).href))) return false;
      return true;
    }, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    assert(reinstalled, "after the repair sequence the worker did not reinstall this build's route screens");
    await page.goto(`${visited.url}#/read/${readerId}`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".markdown-body h1", { timeout: 15_000 });
    // Let the lecture's lazy diagram finish loading while the server is up.
    await page.waitForFunction(() => document.querySelectorAll(".diagram-shell svg").length > 0, { timeout: 15_000 }).catch(() => {});
    await page.waitForFunction(() => caches.match(performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /01-ai-ml-mental-model[^/]*\.js$/.test(name)) || "missing").then(Boolean), { timeout: 15_000 }).catch(() => {});
    await goOffline(page, visited);
    // goto() to the URL already shown is a same-document fragment navigation
    // that keeps the online DOM; reload() really boots the app from the cache.
    await page.evaluate(() => { window.lumenOnlineDocument = true; });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    assert(!(await page.evaluate(() => window.lumenOnlineDocument === true)), "the visited-lecture check did not reload the document");
    const lecture = await page.waitForSelector(".markdown-body h1", { timeout: 15_000 }).catch(() => null);
    assert(Boolean(lecture), "visited lecture did not reload with the server stopped");
    const offlineLecture = lecture ? await page.$eval(".markdown-body", (node) => ({ text: node.textContent.length, heading: node.querySelector("h1")?.textContent || "" })) : { text: 0, heading: "" };
    lectureChars = offlineLecture.text;
    assert(offlineLecture.text > 10_000, "visited lecture did not fully reload from the offline cache with the server stopped");
    assert(offlineLecture.heading === readerTitle, "offline lecture heading did not match the visited source");
  } catch (error) {
    assert(false, `visited lecture offline reload broke: ${error.message}`);
  } finally {
    await page?.close().catch(() => {});
    await visited.stop();
  }
  assert(errors.length === 0, `offline browser errors: ${errors.join(" | ")}`);
  return `Read, AI Tutor, Whiteboard, Review, Device evidence, and Settings opened after a Home-only visit and every route screen loaded from the cache; the repair sequence reinstalled the route screens; a visited lecture reloaded (${lectureChars} characters)`;
};

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
});

try {
  const page = await browser.newPage();
  // iPhone 16 Pro logical viewport in portrait orientation.
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block", { timeout: 10_000 });

  const home = await page.evaluate(() => ({
    width: window.innerWidth,
    rootWidth: document.documentElement.scrollWidth,
    title: document.title,
    lectureCount: document.querySelectorAll(".part-tile").length,
    overflow: [...document.querySelectorAll("body *")]
      .filter((node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && !node.closest('[aria-hidden="true"], [inert]');
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, className: node.className?.baseVal || node.className || "", left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((item) => item.width > 1 && (item.left < -1 || item.right > window.innerWidth + 1))
      .slice(0, 12),
  }));
  assert(home.title === "Lumen AI Notes", "home title did not render");
  assert(home.lectureCount > 0, "curriculum cards did not render");
  assert(home.rootWidth <= home.width + 1, `home has horizontal overflow: ${home.rootWidth}px in a ${home.width}px viewport`);

  const readerId = encodeURIComponent("notes/part-01-foundations/01-ai-ml-mental-model.md");
  await page.goto(`${baseUrl}#/read/${readerId}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body math", { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll(".diagram-shell svg").length > 0, { timeout: 15_000 }).catch(() => {});
  const reader = await page.evaluate(() => ({
    title: document.querySelector(".markdown-body h1")?.textContent || "",
    math: document.querySelectorAll(".markdown-body math").length,
    diagrams: document.querySelectorAll(".diagram-shell svg").length,
    diagramNodes: [...document.querySelectorAll(".diagram-shell")].map((node) => node.outerHTML.slice(0, 500)),
    width: window.innerWidth,
    rootWidth: document.documentElement.scrollWidth,
  }));
  assert(reader.title.length > 0, "reader heading did not render");
  assert(reader.math > 0, "native MathML formulas did not render into the reader DOM");
  assert(reader.diagrams > 0, "Mermaid diagram did not render to SVG");
  assert(reader.rootWidth <= reader.width + 1, `reader has horizontal overflow: ${reader.rootWidth}px in a ${reader.width}px viewport`);

  const readerDiagramBeforeTheme = await page.$eval(".diagram-shell .mermaid", (node) => ({
    count: Number(node.dataset.diagramRenderCount),
    sourceLabel: node.querySelector("svg")?.textContent || "",
    originalTheme: document.documentElement.getAttribute("data-theme"),
    dark: getComputedStyle(document.documentElement).colorScheme.includes("dark"),
  }));
  const alternateTheme = readerDiagramBeforeTheme.dark ? "paper" : "dark";
  const setTheme = async (theme) => {
    await page.$eval('[aria-label="Open settings"]', (button) => button.click());
    await page.waitForSelector(".theme-choices");
    await page.$$eval(".theme-choices button", (buttons, label) => buttons.find((button) => button.textContent.includes(label)).click(), { system: "System", paper: "Paper", dark: "Night", contrast: "Contrast" }[theme]);
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, {}, theme);
    await page.$eval(".settings-close", (button) => button.click());
  };
  await setTheme(alternateTheme);
  await page.waitForFunction((count) => Number(document.querySelector(".diagram-shell .mermaid")?.dataset.diagramRenderCount) > count, { timeout: 15_000 }, readerDiagramBeforeTheme.count).catch(() => {});
  const readerDiagramAfterTheme = await page.$eval(".diagram-shell .mermaid", (node) => ({
    count: Number(node.dataset.diagramRenderCount),
    sourceLabel: node.querySelector("svg")?.textContent || "",
    failed: Boolean(node.querySelector(".diagram-diagnostic")),
  }));
  assert(readerDiagramAfterTheme.count > readerDiagramBeforeTheme.count, "Reader Mermaid did not rerender after a theme change");
  assert(readerDiagramAfterTheme.sourceLabel.includes("Artificial Intelligence"), "Reader theme rerender lost the original Mermaid definition");
  assert(!readerDiagramAfterTheme.failed, "Reader theme rerender converted a valid built-in diagram into an error");
  await setTheme(readerDiagramBeforeTheme.originalTheme || "system");

  const teachClicked = await page.$$eval(".document-tools .text-button", (buttons) => {
    const button = buttons.find((item) => item.textContent.includes("Teach"));
    button?.click();
    return Boolean(button);
  });
  assert(teachClicked, "teaching mode control was not found");
  const teachMode = await page.waitForSelector(".teach-mode", { timeout: 8_000 }).catch(() => null);
  assert(Boolean(teachMode), "teaching mode did not open");
  if (teachMode) {
    assert(await page.$(".teach-card"), "teaching mode did not render a teaching card");
    await page.click('button[aria-label="Next section"]');
    const teachingDiagram = await page.waitForSelector('.teach-mode .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 15_000 }).catch(() => null);
    assert(Boolean(teachingDiagram), "teaching mode did not render the built-in Mermaid diagram");
    assert(!(await page.$(".teach-mode .diagram-diagnostic")), "teaching mode displayed an error for a valid built-in diagram");
    await page.click('button[aria-label="Exit teaching mode"]');
  }

  const boardClicked = await page.$$eval(".document-tools .text-button", (buttons) => {
    const button = buttons.find((item) => item.textContent.includes("Whiteboard"));
    button?.click();
    return Boolean(button);
  });
  assert(boardClicked, "whiteboard control was not found");
  const boardCanvas = await page.waitForSelector(".board-canvas", { timeout: 8_000 }).catch(() => null);
  assert(Boolean(boardCanvas), "whiteboard did not open");
  if (boardCanvas) {
    const board = await page.$eval(".board-canvas", (canvas) => ({ width: canvas.width, height: canvas.height }));
    assert(board.width > 0 && board.height > 0, "whiteboard canvas has no drawing surface");
  }

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page");
  const review = await page.evaluate(() => ({ width: innerWidth, rootWidth: document.documentElement.scrollWidth, statCount: document.querySelectorAll(".review-stat-grid article").length }));
  assert(review.rootWidth <= review.width + 1, `review center has horizontal overflow: ${review.rootWidth}px in a ${review.width}px viewport`);
  assert(review.statCount === 4, "review center did not render all mastery summaries");
  await page.$eval(".review-title > button", (button) => button.click());
  await page.waitForSelector(".review-card-dialog");
  const reviewDialog = await page.$eval(".review-card-dialog", (node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
  assert(reviewDialog.left >= -1 && reviewDialog.right <= review.width + 1, "review authoring dialog overflows horizontally");
  assert(reviewDialog.top >= -1 && reviewDialog.bottom <= 875, "review authoring dialog is not contained in the iPhone viewport");

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".welcome-block");
  const cachedUrls = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const cacheName = (await caches.keys()).find((name) => name.startsWith("lumen-ai-notes-v"));
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => request.url);
  });
  const cachedCount = cachedUrls.length;
  assert(cachedCount >= 7, `offline cache is missing the application shell (${cachedCount} requests)`);
  assert(cachedUrls.some((url) => url.endsWith("/manifest.webmanifest")), "offline cache omitted the web app manifest");
  assert(cachedUrls.some((url) => /01-ai-ml-mental-model[^/]*\.js$/.test(url)), "visited lecture source was not cached on demand");
  assert(!cachedUrls.some((url) => /content-search[^/]*\.js$/.test(url)), "unused full-text search corpus was eagerly cached");

  const routeCache = await missingRouteFiles(page);
  assert(routeCache.files > 0 && routeCache.missing.length === 0, `service worker did not precache the route screens: ${routeCache.missing.join(", ") || "no route list"}`);

  // "Remove optional offline files" drops visited lectures but keeps the
  // route screens, or every screen would be unavailable offline again.
  const lectureUrl = cachedUrls.find((url) => /01-ai-ml-mental-model[^/]*\.js$/.test(url));
  await page.$eval('[aria-label="Open settings"]', (button) => button.click());
  const cleanup = await page.waitForSelector(".storage-cleanup:not([disabled])", { timeout: 15_000 }).catch(() => null);
  assert(Boolean(cleanup), "Storage health did not offer optional offline file cleanup");
  if (cleanup) {
    page.once("dialog", (dialog) => dialog.accept());
    await cleanup.click();
    const cleaned = await page.waitForFunction(() => /optional cached assets? removed/.test(document.body.textContent), { timeout: 15_000 }).catch(() => null);
    assert(Boolean(cleaned), "optional offline file cleanup did not report its result");
    assert(!(await page.evaluate((url) => caches.match(url).then(Boolean), lectureUrl)), "optional offline file cleanup kept the visited lecture");
    const afterCleanup = await missingRouteFiles(page);
    assert(afterCleanup.files > 0 && afterCleanup.missing.length === 0, `optional offline file cleanup removed route screens: ${afterCleanup.missing.join(", ") || "no route list"}`);
  }
  await page.$eval(".settings-close", (button) => button.click());

  // True offline: setOfflineMode does not block service-worker fetches, so it
  // cannot prove anything about the offline cache. Each case below gets its
  // own server (a fresh origin, service worker, and cache) and stops it.
  offlineChecks = await serverStoppedChecks(readerId, reader.title);

  assert(runtimeErrors.length === 0, `browser errors: ${runtimeErrors.join(" | ")}`);

  if (failures.length) {
    console.error("Visual audit failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
    console.error("Current page excerpt:\n" + (await page.$eval("body", (body) => body.innerText.slice(0, 2_000))).replace(/\n{3,}/g, "\n\n"));
    if (home.overflow.length) console.error("Overflowing elements:\n" + JSON.stringify(home.overflow, null, 2));
    if (reader.diagramNodes.length) console.error("Diagram DOM:\n" + reader.diagramNodes.join("\n"));
    if (runtimeErrors.length) console.error("Runtime errors:\n" + runtimeErrors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Visual audit passed.");
    console.log(`Viewport: ${home.width}px; formulas: ${reader.math}; diagrams: ${reader.diagrams}; cached requests: ${cachedCount}`);
    console.log(`Server stopped: ${offlineChecks}`);
  }
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
