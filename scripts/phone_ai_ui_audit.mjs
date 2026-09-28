import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { mistakeTutorRequest } from "../src/lib/tutorBridge.js";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-phone-ai-ui-profile-"));
const runtimeErrors = [];
let browser;
let vite;

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const target = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    target?.click();
    return Boolean(target);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

// Phones pick the mode from a native select; wider screens show chips.
const chooseMode = async (page, label) => {
  if (await page.$(".phone-tutor__mode-select select")) {
    const value = await page.$$eval(".phone-tutor__mode-select option", (options, text) => options.find((option) => option.textContent.trim() === text)?.value || "", label);
    assert.ok(value, `the On-device mode select has no “${label}” option`);
    await page.select(".phone-tutor__mode-select select", value);
    return;
  }
  await clickByText(page, ".phone-tutor__mode-tabs button", label);
};

const activeMode = (page) => page.evaluate(() => {
  const select = document.querySelector(".phone-tutor__mode-select select");
  return (select ? select.selectedOptions[0]?.textContent : document.querySelector(".phone-tutor__mode-tabs button[aria-pressed='true']")?.textContent)?.trim() || "";
});

// Depth, Answer length and the web fallback live in the Options sheet
// (#94): one tap opens it, Done closes it.
const withOptions = async (page, action) => {
  await page.click(".phone-tutor__options");
  await page.waitForSelector(".tutor-sheet .phone-tutor__search-toggle input");
  const result = await action();
  await page.click(".tutor-sheet__done");
  await page.waitForSelector(".tutor-sheet", { hidden: true });
  return result;
};
const toggleWebFallback = (page) => withOptions(page, () => page.click(".phone-tutor__search-toggle input"));

// The box starts empty (#94); "Use suggestion" puts the mode's question in it.
const useSuggestion = async (page) => {
  await clickByText(page, ".phone-tutor__composer-meta button", "Use suggestion");
  await page.waitForFunction(() => document.querySelector(".phone-tutor__composer textarea")?.value.length > 0);
};

const touchSize = (page, selector) => page.$$eval(selector, (nodes) => nodes.filter((node) => {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}).map((node) => {
  const rect = node.getBoundingClientRect();
  return { tag: node.tagName.toLowerCase(), type: node.getAttribute("type") || "", name: node.getAttribute("aria-label") || node.textContent.replace(/\s+/g, " ").trim(), width: rect.width, height: rect.height };
}));

// Chat window fit for On-device Lite (#94): the docked question box, the
// Options sheet, the engine card and the conversation against the top bar,
// the bottom navigation and the viewport. The first open (no model yet) is
// checked in the app itself (LUMEN_URL when set); a loaded model and a
// conversation from earlier in the session in the fixture, inside the app's
// shell. Failures are collected so one run names every defect.
// LUMEN_PHONE_AI_UI_CASES=chat-fit runs only these.
const liteGeometry = () => {
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
  };
  const nav = document.querySelector(".bottom-nav");
  const navShown = Boolean(nav) && getComputedStyle(nav).display !== "none";
  const composer = document.querySelector(".phone-tutor__composer");
  const page = document.querySelector(".ai-page");
  return {
    viewport: [innerWidth, innerHeight],
    scrollY: Math.round(scrollY),
    maxScroll: document.documentElement.scrollHeight - innerHeight,
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
    topbar: Math.round(Math.max(0, document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0)),
    navTop: Math.round(navShown ? nav.getBoundingClientRect().top : innerHeight),
    navHidden: navShown && getComputedStyle(nav).visibility === "hidden",
    composer: { ...box(composer), position: getComputedStyle(composer).position },
    field: box(composer.querySelector("textarea")),
    send: box(composer.querySelector("button[type='submit']")),
    options: box(document.querySelector(".phone-tutor__options")),
    welcome: box(document.querySelector(".phone-tutor__welcome")),
    question: box([...document.querySelectorAll(".phone-tutor__message.is-user")].at(-1)),
    end: box(document.querySelector(".phone-tutor__conversation-end")),
    jump: box(document.querySelector(".phone-tutor__jump")),
    card: box(document.querySelector(".phone-local-ai")),
    manage: box(document.querySelector(".phone-local-ai-more > summary")),
    cardDetailsShown: [...document.querySelectorAll(".phone-local-ai-facts, .phone-local-ai-privacy")].some((node) => node.checkVisibility()),
    page: page ? { overflow: page.scrollHeight - page.clientHeight, anchor: getComputedStyle(page).overflowAnchor } : null,
  };
};

const liteChatFitOnly = Symbol("only the On-device Lite chat window fit checks");
const auditLiteChatFit = async ({ appUrl, fixtureUrl }) => {
  const failures = [];
  const expect = (ok, message, detail) => { if (!ok) failures.push(`${message}: ${JSON.stringify(detail)}`); };
  const settle = (page) => page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    let last = "";
    const started = performance.now();
    const tick = () => {
      const key = `${Math.round(scrollY)}:${document.documentElement.scrollHeight}:${Math.round(document.querySelector(".phone-tutor__composer")?.getBoundingClientRect().top ?? 0)}`;
      frames = key === last ? frames + 1 : 0;
      last = key;
      if (frames >= 6 || performance.now() - started > 3_000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const geometry = async (page) => { await settle(page); return page.evaluate(liteGeometry); };
  const inView = (g, rect) => Boolean(rect) && rect.top >= g.topbar - 1 && rect.bottom <= Math.min(g.navTop, g.viewport[1]) + 1;
  // Docked at or above the navigation; on a page taller than the screen, just
  // above it (the dock keeps an 8px gap) rather than risen off it.
  const docked = (g, { rests = true } = {}) => g.composer.position === "sticky" && g.composer.bottom <= g.navTop && (!rests || g.navTop - g.composer.bottom <= 10);
  const toEnd = (page) => page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  const open = async (label, url, viewport, { largeText = false, keyboard = false } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const phone = viewport.width < 981;
    await page.setViewport({ deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, ...viewport });
    page.on("pageerror", (error) => runtimeErrors.push(`${label}: ${error.message}`));
    await page.evaluateOnNewDocument((large, fakeKeyboard) => {
      try { localStorage.setItem("lumen.ai.engine.v1", "phone-local"); } catch { /* the fixture needs no engine choice */ }
      // 200% text from the first paint, as a browser text-size setting gives.
      if (large) {
        const enlarge = new MutationObserver(() => {
          if (!document.documentElement) return;
          document.documentElement.style.fontSize = "200%";
          enlarge.disconnect();
        });
        enlarge.observe(document, { childList: true });
      }
      if (fakeKeyboard) {
        // Headless Chrome has no on-screen keyboard: a stand-in visual
        // viewport whose height the test shrinks as a keyboard would.
        const visual = new EventTarget();
        window.__lumenKeyboard = 0;
        Object.defineProperties(visual, {
          height: { get: () => innerHeight - window.__lumenKeyboard },
          width: { get: () => innerWidth },
          offsetTop: { get: () => 0 },
          offsetLeft: { get: () => 0 },
          scale: { get: () => 1 },
        });
        Object.defineProperty(window, "visualViewport", { configurable: true, get: () => visual });
      }
    }, largeText, keyboard);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.waitForSelector(".phone-tutor__composer", { timeout: 20_000 });
    await page.waitForFunction(() => !/Checking/.test(document.querySelector(".phone-local-ai-badge")?.textContent || "Checking"), { timeout: 15_000 });
    return { context, page };
  };

  // First open, before the model is downloaded, in the app: the question box
  // and Send are on screen, docked just above the navigation and one line
  // tall; the engine card keeps its details behind a disclosure; Options
  // opens in one tap on Depth, Answer length and the web fallback; and at
  // the page end the dock covers none of the conversation. Wide screens keep
  // a page that grows with the tutor rather than the Mac tutor's column.
  const firstOpen = [
    ["320x568", { width: 320, height: 568 }],
    ["375x667", { width: 375, height: 667 }],
    ["393x852", { width: 393, height: 852 }],
    ["430x932", { width: 430, height: 932 }],
    ["393x852 at 200% text", { width: 393, height: 852 }, { largeText: true }],
    ["320x568 at 200% text", { width: 320, height: 568 }, { largeText: true }],
    ["1280x720", { width: 1280, height: 720 }],
  ];
  for (const [name, viewport, options = {}] of firstOpen) {
    const phone = viewport.width < 981;
    const { context, page } = await open(`lite-first-${name}`, `${appUrl}#/ai`, viewport, options);
    try {
      const g = await geometry(page);
      expect(inView(g, g.field) && inView(g, g.send), `${name}: the question box or Send is off screen at first open`, { field: g.field, send: g.send, topbar: g.topbar, navTop: g.navTop });
      // A first-run card without the download approval (no WebGPU, as on
      // Linux CI) can leave a page no taller than the screen.
      expect(phone ? docked(g, { rests: g.maxScroll > 1 }) : g.composer.position === "sticky", `${name}: the question box is not docked${phone ? " just above the navigation" : ""}`, { composer: g.composer, navTop: g.navTop });
      if (phone && !options.largeText) expect(g.composer.height <= 124, `${name}: the docked composer is taller than about 120px`, g.composer);
      expect(!g.cardDetailsShown, `${name}: the engine card shows its model facts and privacy notes at first open`, g.card);
      expect(!g.sideways, `${name}: the page scrolls sideways`, g.viewport);
      if (!phone) expect(g.page && g.page.overflow <= 1, `${name}: the tutor overflows a fixed-height page`, g.page);
      expect(inView(g, g.options), `${name}: Options is off screen`, g.options);
      if (g.options) {
        await page.click(".phone-tutor__options");
        const sheet = await page.waitForSelector(".tutor-sheet", { timeout: 3_000 }).then(() => page.evaluate(async () => {
          const panel = document.querySelector(".tutor-sheet");
          // Measured once the sheet has slid in.
          await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
          const controls = [...panel.querySelectorAll("select, button")];
          return {
            labels: [...panel.querySelectorAll(".phone-tutor__composer-head label > span")].map((node) => node.textContent).join("|"),
            web: /current-web fallback/i.test(panel.querySelector(".phone-tutor__search-toggle")?.textContent || ""),
            small: controls.filter((node) => node.getBoundingClientRect().height < 44).map((node) => `${node.textContent.trim().slice(0, 20)} ${Math.round(node.getBoundingClientRect().height)}px`),
            outside: [...panel.querySelectorAll("select, .phone-tutor__search-toggle")].filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.top < 0 || rect.bottom > innerHeight + 1;
            }).length,
          };
        }), () => null);
        expect(sheet && sheet.labels === "Depth|Answer length" && sheet.web && !sheet.small.length && (options.largeText || !sheet.outside), `${name}: one tap on Options did not show Depth, Answer length and the web fallback in view at 44px`, sheet);
        if (sheet) {
          await page.click(".tutor-sheet__done");
          await page.waitForSelector(".tutor-sheet", { hidden: true, timeout: 3_000 }).catch(() => {});
        }
      }
      await toEnd(page);
      const end = await geometry(page);
      expect(end.end.bottom <= end.composer.top + 1, `${name}: at the page end the conversation is under the dock`, { end: end.end, composer: end.composer });
      if (phone) expect(docked(end, { rests: end.maxScroll > 1 }), `${name}: at the page end the dock rose off the navigation or sank under it`, { composer: end.composer, navTop: end.navTop });
    } catch (error) {
      failures.push(`${name}: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // Loading the model collapses the engine card to one line with Manage;
  // the conversation starts clear of the dock; a question sent from the dock
  // shows above it; and Jump to latest floats above the dock.
  {
    const { context, page } = await open("lite-load", `${fixtureUrl}/__phone-ai-audit?shell`, { width: 393, height: 852 });
    try {
      await page.click(".phone-local-ai-consent input");
      await page.click(".phone-local-ai-actions .button.primary");
      await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Loaded"), { timeout: 10_000 });
      const g = await geometry(page);
      // One row: the heading's small line may wrap beside Manage.
      expect(g.card.height <= 100 && g.manage && /Manage/.test(await page.$eval(".phone-local-ai-more > summary", (node) => node.textContent)) && g.manage.bottom <= g.card.bottom, "393x852 loaded: the engine card did not collapse to one line with Manage", { card: g.card, manage: g.manage });
      // 27px spare here; a wider font may take some of it.
      expect(g.welcome && g.welcome.bottom <= g.composer.top + 40, "393x852 loaded: the dock covers the conversation at open", { welcome: g.welcome, composer: g.composer });
      expect(inView(g, g.field) && inView(g, g.send) && docked(g, { rests: false }) && g.composer.height <= 124, "393x852 loaded: the question box is not docked, one line and on screen", { composer: g.composer, field: g.field, send: g.send, navTop: g.navTop });
      if (g.manage) {
        await page.click(".phone-local-ai-more > summary");
        const manage = await page.$$eval(".phone-local-ai-more .phone-local-ai-actions button", (nodes) => nodes.map((node) => [node.textContent.trim(), node.getBoundingClientRect().height >= 44]));
        expect(JSON.stringify(manage) === JSON.stringify([["Release memory", true], ["Clear model files", true]]), "393x852 loaded: Manage did not offer Release memory and Clear model files at 44px", manage);
        await page.click(".phone-local-ai-more > summary");
      }
      // An older build without Use suggestion still holds the mode's question.
      if (await page.$eval(".phone-tutor__composer textarea", (field) => !field.value)) await useSuggestion(page);
      await page.evaluate(() => { window.__PHONE_AI_AUDIT__.slowNextGeneration = 60; });
      await page.click(".phone-tutor__composer button[type='submit']");
      await page.waitForSelector(".phone-tutor__message.is-user", { timeout: 5_000 });
      const sent = await page.evaluate(liteGeometry);
      expect(sent.question && sent.question.top >= sent.topbar - 1 && sent.question.bottom <= sent.composer.top + 1, "393x852 loaded: the question sent from the dock is not shown above it", { question: sent.question, composer: sent.composer });
      await page.waitForFunction(() => document.querySelector(".phone-tutor__message.is-streaming")?.getBoundingClientRect().height > 700, { timeout: 8_000 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForSelector(".phone-tutor__jump", { timeout: 3_000 }).catch(() => {});
      const back = await page.evaluate(liteGeometry);
      expect(back.jump && back.jump.top >= back.topbar && back.jump.bottom <= back.composer.top, "393x852 loaded: Jump to latest is not in view above the dock", { jump: back.jump, composer: back.composer, topbar: back.topbar });
      await page.waitForFunction(() => !document.querySelector(".phone-tutor__message.is-streaming"), { timeout: 15_000 });
    } catch (error) {
      failures.push(`393x852 loaded: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // A conversation from earlier in this session opens at its latest turn,
  // just above the dock (in landscape, above the navigation), with scroll
  // anchoring off; at the page end the dock covers none of it.
  const latest = [
    ["393x852", { width: 393, height: 852 }],
    ["320x568", { width: 320, height: 568 }],
    ["393x852 at 200% text", { width: 393, height: 852 }, { largeText: true }],
    ["852x393", { width: 852, height: 393 }],
    ["1280x720", { width: 1280, height: 720 }],
  ];
  for (const [name, viewport, options = {}] of latest) {
    const { context, page } = await open(`lite-latest-${name}`, `${fixtureUrl}/__phone-ai-audit?shell&loaded&history=5`, viewport, options);
    try {
      await page.waitForSelector(".phone-tutor__message.is-assistant", { timeout: 10_000 });
      const g = await geometry(page);
      const edge = g.composer.position === "sticky" ? Math.min(g.composer.top, g.navTop) : g.navTop;
      expect(g.scrollY > 0 && g.end.bottom <= edge + 1 && g.end.bottom >= edge - 120, `${name}: the conversation did not open at its latest turn above the dock`, { scrollY: g.scrollY, end: g.end, composer: g.composer, navTop: g.navTop });
      expect(g.page?.anchor === "none", `${name}: scroll anchoring can still move the page`, g.page);
      await toEnd(page);
      const end = await geometry(page);
      expect(end.end.bottom <= end.composer.top + 1 && inView(end, end.field) && inView(end, end.send), `${name}: at the page end the conversation is under the dock or the question box is off screen`, { end: end.end, composer: end.composer, field: end.field, navTop: end.navTop });
      if (viewport.width < 981 && viewport.height > 480) expect(docked(end), `${name}: at the page end the dock rose off the navigation or sank under it`, { composer: end.composer, navTop: end.navTop });
    } catch (error) {
      failures.push(`${name} latest turn: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // The on-screen keyboard (a stand-in visual viewport): while the question
  // box has focus the dock rises above the keyboard and the navigation
  // hides; both come back on blur.
  {
    const { context, page } = await open("lite-keyboard", `${fixtureUrl}/__phone-ai-audit?shell&loaded`, { width: 393, height: 852 }, { keyboard: true });
    try {
      await page.$eval(".phone-tutor__composer textarea", (field) => field.focus());
      await page.evaluate(() => { window.__lumenKeyboard = 320; window.visualViewport.dispatchEvent(new Event("resize")); });
      const typing = await geometry(page);
      expect(typing.navHidden && Math.abs(typing.composer.bottom - (852 - 320 - 8)) <= 2, "the On-device dock did not rise above the keyboard or the navigation stayed", { composer: typing.composer, navHidden: typing.navHidden });
      await page.$eval(".phone-tutor__composer textarea", (field) => field.blur());
      await page.evaluate(() => { window.__lumenKeyboard = 0; window.visualViewport.dispatchEvent(new Event("resize")); });
      const done = await geometry(page);
      expect(!done.navHidden && docked(done, { rests: false }), "the On-device dock or the navigation did not come back after typing", { composer: done.composer, navTop: done.navTop, navHidden: done.navHidden });
    } catch (error) {
      failures.push(`keyboard: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  assert.deepEqual(failures, [], `On-device Lite chat window fit (#94):\n${failures.join("\n")}`);
};

try {
  vite = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "phone-ai-audit-page",
      configureServer(server) {
        server.middlewares.use("/__phone-wasm-audit.js", (_request, response) => {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.end('WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(() => postMessage({ok:true}), (error) => postMessage({ok:false,message:error?.message || String(error)}));');
        });
        server.middlewares.use("/__phone-ai-audit", async (request, response, next) => {
          try {
            const source = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone AI audit</title></head><body><div id="root"></div><script type="module" src="/scripts/phone_ai_ui_fixture.jsx"></script></body></html>';
            const html = await server.transformIndexHtml(request.originalUrl || "/__phone-ai-audit", source);
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

  await auditLiteChatFit({ appUrl: process.env.LUMEN_URL ? process.env.LUMEN_URL.replace(/\/?$/, "/") : `${baseUrl}/`, fixtureUrl: baseUrl });
  if (process.env.LUMEN_PHONE_AI_UI_CASES === "chat-fit") {
    assert.deepEqual(runtimeErrors, [], `runtime errors: ${runtimeErrors.join(" | ")}`);
    console.log("Phone AI UI audit passed the On-device Lite chat window fit checks (LUMEN_PHONE_AI_UI_CASES=chat-fit).");
    throw liteChatFitOnly;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });

  const requests = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/config") {
      void request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "AUDIT_OFFLINE", message: "Mac tutor intentionally unavailable in phone UI audit." } }) });
      return;
    }
    void request.continue();
  });
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${baseUrl}/#/ai`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector('[data-ai-engine-option="phone-local"]');
  const wasmCspResult = await page.evaluate(async () => {
    let mainThread;
    try {
      await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      mainThread = { ok: true };
    } catch (error) {
      mainThread = { ok: false, message: error?.message || String(error) };
    }
    const worker = new Worker("/__phone-wasm-audit.js", { name: "phone-wasm-csp-audit" });
    const workerResult = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, message: "worker timed out" }), 5_000);
      worker.addEventListener("message", (event) => { clearTimeout(timer); resolve(event.data); }, { once: true });
      worker.addEventListener("error", (event) => { clearTimeout(timer); resolve({ ok: false, message: event.message }); }, { once: true });
    });
    worker.terminate();
    return { mainThread, worker: workerResult };
  });
  assert.equal(wasmCspResult.mainThread.ok, false, "the strict document CSP unexpectedly allowed main-thread WebAssembly compilation");
  assert.equal(wasmCspResult.worker.ok, true, `a same-origin dedicated worker could not compile WebAssembly required by WebLLM: ${wasmCspResult.worker.message || "unknown error"}`);
  const beforeSelection = requests.length;
  await page.click('[data-ai-engine-option="phone-local"]');
  await page.waitForSelector(".phone-local-ai", { timeout: 15_000 });
  const selectionRequests = requests.slice(beforeSelection);
  const remoteModelRequests = selectionRequests.filter((requestUrl) => {
    const url = new URL(requestUrl);
    return !["127.0.0.1", "localhost"].includes(url.hostname)
      || /huggingface|resolve\/main|ndarray-cache|params_shard|mlc-chat-config|tokenizer_model/i.test(requestUrl);
  });
  assert.deepEqual(remoteModelRequests, [], `selecting On-device Lite fetched model data: ${remoteModelRequests.join(", ")}`);

  const cacheActivation = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const unrelatedName = "webllm-audit-model-cache";
    const staleLumenName = "lumen-ai-notes-v9";
    await caches.delete(unrelatedName);
    await caches.delete(staleLumenName);
    const unrelated = await caches.open(unrelatedName);
    await unrelated.put("/audit-model-marker", new Response("keep"));
    const stale = await caches.open(staleLumenName);
    await stale.put("/audit-old-shell", new Response("retire"));
    const registration = await navigator.serviceWorker.register(`/service-worker.js?phone-ai-cache-audit=${Date.now()}`, { scope: "/" });
    const worker = registration.installing || registration.waiting || registration.active;
    if (worker?.state !== "activated") {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for service-worker activation")), 15_000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") { clearTimeout(timeout); resolve(); }
          if (worker.state === "redundant") { clearTimeout(timeout); reject(new Error("Audit service worker became redundant")); }
        });
      });
    }
    const keys = await caches.keys();
    const marker = await caches.match("/audit-model-marker");
    await registration.unregister();
    return { keys, marker: await marker?.text() };
  });
  assert.ok(cacheActivation.keys.includes("webllm-audit-model-cache"), "service-worker activation deleted an unrelated WebLLM-style cache");
  assert.equal(cacheActivation.marker, "keep", "service-worker activation corrupted the unrelated model-cache entry");
  assert.equal(cacheActivation.keys.includes("lumen-ai-notes-v9"), false, "service-worker activation did not retire its stale Lumen cache");

  await page.goto(`${baseUrl}/__phone-ai-audit`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".phone-local-ai");

  const themeSurfaces = async () => page.evaluate(() => {
    const resolveColor = (variable) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = `var(${variable})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    return {
      expected: {
        paper: resolveColor("--paper"),
        paper2: resolveColor("--paper-2"),
        tealSoft: resolveColor("--teal-soft"),
        goldSoft: resolveColor("--gold-soft"),
      },
      panel: getComputedStyle(document.querySelector(".phone-local-ai")).backgroundColor,
      fact: getComputedStyle(document.querySelector(".phone-local-ai-facts > div")).backgroundColor,
      icon: getComputedStyle(document.querySelector(".phone-local-ai-icon")).backgroundColor,
      badge: getComputedStyle(document.querySelector(".phone-local-ai-badge")).backgroundColor,
    };
  });
  const lightThemeSurfaces = await themeSurfaces();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const darkThemeSurfaces = await themeSurfaces();
  assert.equal(darkThemeSurfaces.panel, darkThemeSurfaces.expected.paper, "On-device settings panel ignored the dark-theme paper surface");
  assert.equal(darkThemeSurfaces.fact, darkThemeSurfaces.expected.paper2, "model facts ignored the dark-theme secondary surface");
  assert.equal(darkThemeSurfaces.icon, darkThemeSurfaces.expected.tealSoft, "On-device icon retained a light-only fill in dark mode");
  assert.equal(darkThemeSurfaces.badge, darkThemeSurfaces.expected.goldSoft, "Available badge retained a light-only fill in dark mode");
  assert.notEqual(darkThemeSurfaces.panel, lightThemeSurfaces.panel, "On-device settings panel did not react to a theme change");
  assert.notEqual(darkThemeSurfaces.fact, lightThemeSurfaces.fact, "model facts did not react to a theme change");
  await page.evaluate(() => { document.documentElement.removeAttribute("data-theme"); });

  const downloadButton = await page.$(".phone-local-ai-actions .button.primary");
  assert.ok(downloadButton, "download button was not rendered");
  assert.equal(await downloadButton.evaluate((button) => button.disabled), true, "model download was enabled before explicit consent");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.modelLoads), 0, "model loaded automatically on component mount");
  assert.match(await page.$eval(".phone-local-ai-consent", (node) => node.textContent), /remembered for this model in this browser/i, "one-time download consent scope was not explained");
  await page.click(".phone-local-ai-consent input");
  assert.equal(await downloadButton.evaluate((button) => button.disabled), false, "download consent did not unlock the explicit load action");
  await downloadButton.click();
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.loaded === true);
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Loaded"));
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.modelLoads), 1, "explicit download/load action did not run exactly once");
  assert.equal(await page.$(".phone-local-ai-consent"), null, "remembered model-download consent was requested again after loading");

  const sendButtonSelector = ".phone-tutor__send";
  // The box starts empty with the mode's suggestion one tap away (#94), so
  // Send is not armed with a default question until it is used.
  assert.equal(await page.$eval(sendButtonSelector, (button) => button.disabled), true, "an empty question box armed Send");
  await useSuggestion(page);
  assert.equal(await page.$eval(sendButtonSelector, (button) => button.disabled), false, "loaded local model did not enable a valid prompt");
  await page.click(sendButtonSelector);
  // A model "##" heading renders as h4 below the per-message heading.
  await page.waitForSelector(".phone-tutor__message.is-streaming .phone-tutor__safe-response h4.ai-tutor__md-h2");
  await page.waitForFunction(() => [...document.querySelectorAll(".phone-tutor__message.is-assistant")].some((node) => node.textContent.includes("negative loss gradient")));
  assert.ok(await page.$(".phone-tutor__message.is-assistant .katex-display"), "display LaTeX was not rendered through KaTeX");
  assert.ok(await page.$(".phone-tutor__message.is-assistant table"), "GFM table was not rendered");
  assert.ok(await page.$(".phone-tutor__message.is-assistant .code-shell .code-copy"), "fenced code did not expose a copy action");
  await page.waitForSelector('.phone-tutor__message.is-assistant .diagram-shell[data-diagram-status="rendered"] svg', { timeout: 15_000 });
  assert.equal(await page.$('.phone-tutor__message.is-streaming .diagram-shell[data-diagram-status="rendered"]'), null, "phone tutor ran Mermaid against an in-flight fenced block");
  assert.equal(await page.$('.phone-tutor__message.is-assistant .diagram-diagnostic'), null, "valid on-device tutor Mermaid displayed a failure diagnostic");
  const phoneDiagramRenderCount = await page.$eval(".phone-tutor__message.is-assistant .mermaid", (node) => Number(node.dataset.diagramRenderCount));
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForFunction((before) => Number(document.querySelector(".phone-tutor__message.is-assistant .mermaid")?.dataset.diagramRenderCount) > before, { timeout: 15_000 }, phoneDiagramRenderCount);
  assert.match(await page.$eval(".phone-tutor__message.is-assistant .mermaid svg", (node) => node.textContent), /Parameter update/iu, "phone theme rerender lost the original Mermaid definition");
  assert.equal(await page.$('.phone-tutor__message.is-assistant .diagram-diagnostic'), null, "phone theme change corrupted a valid diagram");
  await page.evaluate(() => { document.documentElement.removeAttribute("data-theme"); });
  assert.ok(await page.$('.phone-tutor__message.is-assistant [data-ai-citation="S1"]'), "library citation was not rendered as a safe navigation control");
  await page.$eval('.phone-tutor__message.is-assistant [data-ai-citation="S1"]', (node) => node.click());
  assert.deepEqual(
    await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.at(-1)),
    { documentId: "notes/audit-gradient-descent.md", anchor: "optimization" },
    "prose [S1] citation did not navigate to its exact source anchor",
  );
  assert.equal(await page.$eval(".phone-tutor__message.is-assistant .phone-tutor__safe-response p strong", (node) => node.textContent), "Gradient descent", "Markdown emphasis rendered incorrectly");
  assert.equal(await page.evaluate(() => window.__PHONE_MARKDOWN_XSS__ === true), false, "model-authored script executed through the Markdown renderer");
  assert.equal(await page.$(".phone-tutor__safe-response script"), null, "sanitized AI Markdown retained a script element");
  // Model HTML is text (issue #69): the answer's forged citation button is
  // not a control, and clicking it navigates nowhere.
  const forgedPhone = await page.evaluate(() => {
    const answer = document.querySelector(".phone-tutor__message.is-assistant .phone-tutor__safe-response");
    const paragraph = [...answer.querySelectorAll("p")].find((node) => node.textContent.includes("Forged phone citation"));
    return {
      controls: [...answer.querySelectorAll("[data-ai-citation]")].map((node) => `${node.tagName}.${node.className}:${node.textContent}`),
      shownAsText: Boolean(paragraph?.textContent.includes('<button class="ai-tutor__citation"')),
      insideControl: Boolean(paragraph?.closest("button, a, [data-ai-citation]") || paragraph?.querySelector("button, a, [data-ai-citation]")),
    };
  });
  // The [[S1]](#/…) line adds a second genuine [S1] button. Its link is
  // dropped, so no citation sits inside a model-chosen link.
  assert.deepEqual(forgedPhone, { controls: ["BUTTON.ai-tutor__citation:[S1]", "BUTTON.ai-tutor__citation:[S1]"], shownAsText: true, insideControl: false }, "a model-authored citation button became a phone citation control");
  const navigationsBeforeForged = await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length);
  await page.evaluate(() => [...document.querySelectorAll(".phone-tutor__message.is-assistant .phone-tutor__safe-response p")].find((node) => node.textContent.includes("Forged phone citation"))?.click());
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length), navigationsBeforeForged, "clicking a forged phone citation navigated");
  // A model link to an in-app route is text, and a citation it wrapped opens
  // only its own source.
  const hashBeforeLinked = await page.evaluate(() => window.location.hash);
  const linkedPhone = await page.evaluate(() => {
    const answer = document.querySelector(".phone-tutor__message.is-assistant .phone-tutor__safe-response");
    const paragraph = [...answer.querySelectorAll("p")].find((node) => node.textContent.includes("Linked citation"));
    return {
      text: paragraph?.textContent || "",
      routeLinks: answer.querySelectorAll('a[href^="#"], a[href^="/"], a[href^="."]').length,
      citationsInLinks: answer.querySelectorAll("a [data-ai-citation], a .ai-tutor__citation").length,
      citation: paragraph?.querySelector("button.ai-tutor__citation")?.textContent || "",
    };
  });
  assert.deepEqual(linkedPhone, { text: "Linked citation [S1] and the forged phone route.", routeLinks: 0, citationsInLinks: 0, citation: "[S1]" }, "a model link to an app route, or around a citation, survived on the phone");
  const navigationsBeforeLinked = await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length);
  await page.evaluate(() => [...document.querySelectorAll(".phone-tutor__message.is-assistant .phone-tutor__safe-response p")].find((node) => node.textContent.includes("Linked citation"))?.querySelector("button.ai-tutor__citation")?.click());
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length), navigationsBeforeLinked + 1, "the linked [S1] citation did not open its source");
  assert.deepEqual(await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.at(-1)), { documentId: "notes/audit-gradient-descent.md", anchor: "optimization" }, "the linked [S1] citation opened the wrong source");
  assert.equal(await page.evaluate(() => window.location.hash), hashBeforeLinked, "a citation click followed a model-chosen link");
  const fitCopy = await page.$eval(".phone-tutor__context-fit", (node) => node.textContent);
  assert.match(fitCopy, /720 of 2,816 safe input bytes/);
  assert.match(fitCopy, /Gradient descent:/);
  assert.match(fitCopy, /verified library labels \[S1\]/i, "verified library grounding was not disclosed in the context-fit evidence");
  const firstCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls[0]);
  assert.equal(firstCall.allowSearchPlanning, false, "ordinary local answer unexpectedly enabled search planning");
  assert.equal(firstCall.payload.task, "explain");
  assert.match(firstCall.payload.context, /Gradient descent updates parameters/);
  assert.deepEqual(await page.evaluate(() => window.__PHONE_AI_AUDIT__.retrievalCalls[0].options), { maxDocuments: 2, maxPassages: 2, maxBytes: 4400 });
  assert.match(await page.$eval(".phone-tutor__evidence", (node) => node.textContent), /searched 143 local documents/i);

  // Answer-to-note (AI-001): a completed on-device prose answer can be saved
  // as a labeled AI note with its library and web provenance attached.
  await page.$$eval(".phone-tutor__message.is-assistant .phone-tutor__message-actions button", (nodes) => nodes.find((node) => /save/i.test(node.textContent))?.click());
  const savedPhoneNote = await page.evaluate(() => window.__PHONE_AI_AUDIT__.savedNotes.at(-1));
  assert.ok(savedPhoneNote, "the phone save-to-notes action did not reach the host callback");
  assert.match(savedPhoneNote.content, /gradient descent/i, "the saved phone note lost the answer text");
  assert.match(savedPhoneNote.title, /on-device/i, "the saved phone note is not labeled as on-device");
  assert.equal(savedPhoneNote.citationSources.length, 1, "the saved phone note lost its library provenance");
  await page.waitForFunction(() => [...document.querySelectorAll(".phone-tutor__message.is-assistant .phone-tutor__message-actions button")].some((node) => /saved/i.test(node.textContent) && node.disabled), { timeout: 4_000 });

  // Structured-field citations (AI-001): [S#] labels inside flashcard fields
  // are the same navigable controls as prose citations, not inert text.
  await chooseMode(page, "Flashcards");
  await useSuggestion(page);
  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__flashcards", { timeout: 10_000 });
  const structuredCitationText = await page.$eval(".phone-tutor__flashcards button.ai-tutor__citation", (node) => node.textContent.trim());
  assert.equal(structuredCitationText, "[S1]", "flashcard front did not render [S1] as a navigable citation control");
  const navigationsBeforeStructured = await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length);
  await page.$eval(".phone-tutor__flashcards button.ai-tutor__citation", (node) => node.click());
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.length), navigationsBeforeStructured + 1, "structured citation click did not navigate");
  assert.deepEqual(
    await page.evaluate(() => window.__PHONE_AI_AUDIT__.navigations.at(-1)),
    { documentId: "notes/audit-gradient-descent.md", anchor: "optimization" },
    "structured [S1] citation did not resolve to its exact source anchor",
  );
  await chooseMode(page, "Explain");
  assert.match(await activeMode(page), /Explain/, "mode did not return to Explain after the structured citation check");

  await page.click(".phone-tutor__sources summary");
  await clickByText(page, ".phone-tutor__source-modes button", "No library");
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".phone-tutor__search-toggle input", (input) => input.checked), false, "leaving Library first did not clear web-fallback permission");
    assert.equal(await page.$eval(".phone-tutor__search-toggle input", (input) => input.disabled), true, "web fallback remained available without a whole-library sufficiency check");
  });
  await clickByText(page, ".phone-tutor__source-modes button", "Library first");
  await withOptions(page, async () => {
    assert.equal(await page.$eval(".phone-tutor__search-toggle input", (input) => input.disabled), false, "returning to Library first did not restore the web-fallback control");
    await page.click(".phone-tutor__search-toggle input");
    assert.equal(await page.$eval(".phone-tutor__search-toggle input", (input) => input.checked), true, "web-fallback proposal preference did not turn on");
    assert.equal(await page.$eval(".phone-tutor__search-toggle", (node) => node.classList.contains("is-enabled")), true, "enabled web fallback was not visibly selected");
    assert.match(await page.$eval(".phone-tutor__search-toggle", (node) => node.textContent), /approve the exact query/i, "web fallback did not explain query approval");
  });
  // Armed web fallback stays visible on the Options button while the sheet is shut.
  assert.match(await page.$eval(".phone-tutor__options", (node) => node.textContent), /web on/i, "the Options button hid that web fallback is on");

  // Learner permission alone is insufficient: a strong full-library match
  // must still answer locally without invoking the planner or showing a card.
  await page.$eval(".phone-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "Explain gradient descent from my library notes.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click(sendButtonSelector);
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.prepareCalls.length >= 2
    && document.querySelectorAll(".phone-tutor__message.is-assistant:not(.is-streaming)").length >= 2
    && document.querySelector(".phone-tutor__send")?.disabled === false);
  const sufficientEvidenceCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls[1]);
  assert.equal(sufficientEvidenceCall.allowSearchPlanning, false, "learner opt-in bypassed the strong-library-evidence gate");
  assert.equal(await page.$(".phone-tutor__search-consent"), null, "strong library evidence produced an unnecessary web consent card");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchRequests), 0, "strong library evidence contacted search");

  // Simulate the real 1B failure mode: retrieval recommends current-web
  // fallback, but the local planner says it can answer. The external gates
  // remain authoritative and must still produce an exact-query consent card.
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.vetoNextSearchPlan = true; });
  await page.$eval(".phone-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "What is the latest Safari 26 WebGPU support?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__search-consent");
  const fallbackCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.at(-1));
  assert.equal(fallbackCall.allowSearchPlanning, true, "time-sensitive weak library evidence did not unlock the separately permitted search proposal");
  assert.match(fallbackCall.webFallbackReason, /release-specific browser behavior/i, "the retrieval reason was not supplied to deterministic query fallback");
  assert.match(await page.evaluate(() => window.__PHONE_AI_AUDIT__.retrievalCalls.at(-1).query), /latest Safari 26/);
  const consentCopy = await page.$eval(".phone-tutor__search-consent", (node) => node.textContent);
  assert.match(consentCopy, /What is the latest Safari 26 WebGPU support\?/);
  assert.match(consentCopy, /full local-library check recommended current-web fallback/i);
  assert.match(consentCopy, /public search engines configured in self-hosted SearXNG/);
  assert.match(consentCopy, /ordinary request metadata/);
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchRequests), 0, "proposed search ran before per-query approval");
  await clickByText(page, ".phone-tutor__search-consent button", "Decline");
  await page.waitForFunction(() => document.querySelector(".phone-tutor__request-state")?.textContent.includes("was not sent"));
  assert.deepEqual(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchDecisions[0]), { searchId: "audit-search-1", consent: false });
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchRequests), 0, "declined search contacted the search service");
  assert.equal(await withOptions(page, () => page.$eval(".phone-tutor__search-toggle input", (input) => input.checked)), true, "declining one exact query incorrectly disabled future web-fallback proposals");

  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__search-consent");
  assert.match(await page.$eval(".phone-tutor__search-consent", (node) => node.textContent), /Safari 26 WebGPU release notes/, "a valid local-planner query was not preferred on the fresh retry");
  assert.deepEqual(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchDecisions), [{ searchId: "audit-search-1", consent: false }], "retry reused the declined proposal instead of creating a fresh approval");
  await clickByText(page, ".phone-tutor__search-consent button", "Send this query");
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.searchRequests === 1);
  assert.equal(await page.$(".phone-tutor__search-consent"), null, "consumed search-consent card remained tappable while its query was already in flight");
  assert.equal(await page.$eval(".phone-local-ai-actions button", (buttons) => buttons.disabled), true, "model lifecycle controls stayed enabled during generation");
  await page.waitForSelector(".phone-tutor__web-sources a");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.searchRequests), 1, "approved query was not searched exactly once");
  assert.equal(await page.$eval(".phone-tutor__web-sources a", (anchor) => anchor.getAttribute("href")), "https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes");
  assert.equal(await page.$eval('.phone-tutor__message.is-assistant [href="https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes"]', (anchor) => anchor.textContent), "[W1]", "explicit phone web citation was not rendered safely");

  // An unresponsive active generation is cancelled authoritatively. The UI
  // must immediately show that GPU memory was released and must never reload
  // the model through Retry behind the learner's back.
  await toggleWebFallback(page);
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.hangNextGeneration = true; });
  await page.click(sendButtonSelector);
  await page.waitForFunction(() => /Library evidence ready|Generating locally/.test(document.querySelector(".phone-tutor__working")?.textContent || ""));
  await clickByText(page, ".phone-tutor__working button", "Cancel");
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Available"));
  assert.equal(await page.$eval(sendButtonSelector, (button) => button.disabled), true, "composer stayed enabled after worker termination released the model");
  const retryButton = await page.$(".phone-tutor__request-state button");
  assert.ok(retryButton, "cancelled request did not expose its retry state");
  assert.equal(await retryButton.evaluate((button) => button.disabled), true, "Retry could silently reload a cancelled model");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.modelLoads), 1, "cancel triggered an implicit model reload");
  const reloadButton = await page.$(".phone-local-ai-actions .button.primary");
  assert.ok(reloadButton, "explicit cached-model load control did not appear after cancellation");
  await reloadButton.click();
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Loaded"));
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.modelLoads), 2, "model was not reloaded through the explicit lifecycle control");

  // A failed privacy deletion must stay locked until verification finishes and
  // its error must remain visible after status refreshes.
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.failNextDelete = true; });
  page.once("dialog", (dialog) => void dialog.accept());
  await clickByText(page, ".phone-local-ai-actions button", "Clear model files");
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Deleting"));
  assert.equal(await page.$$eval(".phone-local-ai-actions button", (buttons) => buttons.every((button) => button.disabled)), true, "lifecycle controls became active before deletion verification finished");
  await page.evaluate(() => window.__PHONE_AI_AUDIT__.finishDeleteVerification());
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-error")?.textContent.includes("Simulated cache deletion verification failure"));
  assert.match(await page.$eval(".phone-local-ai-error", (node) => node.textContent), /deletion verification failure/);
  const reloadAfterDeleteFailure = await page.$(".phone-local-ai-actions .button.primary");
  assert.ok(reloadAfterDeleteFailure, "failed deletion did not leave an explicit cached-model reload path");
  await reloadAfterDeleteFailure.click();
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Loaded"));
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.modelLoads), 3, "failed delete recovery did not use the explicit load control");
  await toggleWebFallback(page);

  // Character count alone is unsafe for a byte-budgeted local model. A prompt
  // that is below the textarea's UTF-16 limit but above the canonical UTF-8
  // request budget must be blocked before retrieval or model generation.
  const callsBeforeUtf8Guard = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length);
  await page.$eval(".phone-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "😀".repeat(800));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".phone-tutor__disabled-reason[role='alert']")?.textContent.includes("UTF-8 input bytes"));
  assert.equal(await page.$eval(sendButtonSelector, (button) => button.disabled), true, "UTF-8-oversized phone prompt remained sendable");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length), callsBeforeUtf8Guard, "UTF-8 preflight contacted the model");

  // Retry rebuilds from the controls that are visible now. It must not retain
  // the failed request's Standard token reserve or its old web-fallback opt-in.
  await page.$eval(".phone-tutor__composer textarea", (field) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, "What is the latest Safari 26 WebGPU support?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.failNextGeneration = true; });
  await page.click(sendButtonSelector);
  await page.waitForFunction(() => document.querySelector(".phone-tutor__request-state.is-error")?.textContent.includes("Simulated bounded generation failure"));
  const failedCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.at(-1));
  assert.equal(failedCall.payload.maxOutputTokens, 640, "retry fixture did not begin at Standard length");
  assert.equal(failedCall.allowSearchPlanning, true, "retry fixture did not begin with web fallback enabled");
  await withOptions(page, async () => {
    await page.select(".phone-tutor__composer-head label:nth-child(2) select", "compact");
    await page.click(".phone-tutor__search-toggle input");
    // The moved controls keep their 44px targets in the sheet.
    const sheetControls = await touchSize(page, ".tutor-sheet button, .tutor-sheet select");
    assert.deepEqual(sheetControls.filter((control) => control.height < 44), [], `undersized On-device options: ${JSON.stringify(sheetControls)}`);
    assert.deepEqual(await page.$$eval(".tutor-sheet .phone-tutor__composer-head label > span", (nodes) => nodes.map((node) => node.textContent)), ["Depth", "Answer length"], "the Options sheet lost the Depth or Answer length label");
  });
  await clickByText(page, ".phone-tutor__request-state button", "Retry");
  await page.waitForFunction((before) => window.__PHONE_AI_AUDIT__.prepareCalls.length > before
    && document.querySelector(".phone-tutor__request-state.is-success"), {}, callsBeforeUtf8Guard + 1);
  const rebuiltRetryCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.at(-1));
  assert.equal(rebuiltRetryCall.payload.maxOutputTokens, 384, "Retry reused the failed Standard output reserve after Compact was selected");
  assert.equal(rebuiltRetryCall.allowSearchPlanning, false, "Retry reused stale web-fallback permission after the toggle was turned off");
  await toggleWebFallback(page);

  const controls = await touchSize(page, ".phone-tutor button, .phone-tutor select, .phone-tutor textarea, .phone-tutor input");
  const undersizedButtons = controls.filter((control) => ["button", "select", "textarea"].includes(control.tag) && control.height < 44);
  assert.deepEqual(undersizedButtons, [], `undersized phone AI controls: ${JSON.stringify(undersizedButtons)}`);

  // One-tap follow-ups (TFEAT-02): On-device Lite offers three under its
  // newest prose answer. A tap sends a visible question with that answer as
  // memory, searches with the question it follows, never plans a web
  // search, and moves focus to Cancel and then to the new answer.
  assert.equal(await page.$$eval(".phone-tutor__follow-ups", (nodes) => nodes.length), 1, "On-device follow-ups were not shown once");
  assert.equal(await page.$eval(".phone-tutor__follow-ups", (node) => node.closest(".phone-tutor__message") === [...document.querySelectorAll(".phone-tutor__message.is-assistant")].at(-1)), true, "On-device follow-ups were not under the newest answer");
  assert.deepEqual(await page.$$eval(".phone-tutor__follow-ups button", (nodes) => nodes.map((node) => [node.textContent, node.getBoundingClientRect().height >= 44])), [["Simpler", true], ["Quiz me on this", true], ["Make flashcards", true]]);
  const followedQuestion = await page.$$eval(".phone-tutor__message.is-user .phone-tutor__user-text", (nodes) => nodes.at(-1).textContent);
  const callsBeforeFollowUp = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length);
  const answersBeforeFollowUp = await page.$$eval(".phone-tutor__message.is-assistant", (nodes) => nodes.length);
  await clickByText(page, ".phone-tutor__follow-ups button", "Simpler");
  await page.waitForFunction((count) => document.querySelectorAll(".phone-tutor__message.is-assistant:not(.is-streaming)").length > count && !document.querySelector(".phone-tutor__working"), { timeout: 10_000 }, answersBeforeFollowUp);
  const followUpCall = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.at(-1));
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length), callsBeforeFollowUp + 1, "an On-device follow-up was not sent exactly once");
  assert.equal(followUpCall.payload.task, "explain");
  assert.match(followUpCall.payload.prompt, /^Explain your previous answer more simply/);
  assert.equal(followUpCall.allowSearchPlanning, false, "an On-device follow-up planned a web search");
  assert.equal(followUpCall.payload.history.length, 2, "an On-device follow-up did not remember the answer it follows");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.retrievalCalls.at(-1).query), followedQuestion, "an On-device follow-up searched with its topic-less wording");
  assert.match(await page.$$eval(".phone-tutor__message.is-user .phone-tutor__user-text", (nodes) => nodes.at(-1).textContent), /^Explain your previous answer more simply/, "the On-device follow-up was not a visible question");
  await page.waitForFunction(() => document.activeElement === [...document.querySelectorAll(".phone-tutor__message.is-assistant")].at(-1), { timeout: 3_000 }).catch(() => assert.fail("focus did not move to the On-device follow-up's answer"));

  // Listen (TFEAT-09): an On-device answer is read by the app's speech
  // hook without code, math or labels; Pause/Stop follow it, and the next
  // question stops it.
  const phoneListen = () => page.$$eval(".phone-tutor__message.is-assistant", (nodes) => [...nodes.at(-1).querySelectorAll(".phone-tutor__message-actions button")].map((node) => node.textContent.trim()).filter((text) => /^(Listen|Pause|Resume|Stop)/.test(text)));
  assert.deepEqual(await phoneListen(), ["Listen to this answer"], "an On-device answer offered no Listen");
  await page.$$eval(".phone-tutor__message.is-assistant", (nodes) => [...nodes.at(-1).querySelectorAll(".phone-tutor__message-actions button")].find((node) => node.textContent.startsWith("Listen")).click());
  await page.waitForFunction(() => [...document.querySelectorAll(".phone-tutor__message-actions button")].some((node) => node.textContent.startsWith("Pause")), { timeout: 3_000 });
  assert.deepEqual(await phoneListen(), ["Pause reading this answer", "Stop reading"]);
  const firstSpoken = await page.evaluate(() => window.__PHONE_SPEECH_LOG__.find(([type]) => type === "speak")?.[1] || "");
  assert.match(firstSpoken, /^Gradient descent\. Gradient descent follows the negative loss gradient\./, `On-device Listen read: ${firstSpoken}`);
  assert.equal(/\[S\d|\$|\\theta/.test(firstSpoken), false, "On-device Listen read math or a citation label");
  const phoneCancels = () => page.evaluate(() => window.__PHONE_SPEECH_LOG__.filter(([type]) => type === "cancel").length);
  const cancelsBeforeNext = await phoneCancels();
  await clickByText(page, ".phone-tutor__follow-ups button", "Simpler");
  await page.waitForFunction((before) => window.__PHONE_SPEECH_LOG__.filter(([type]) => type === "cancel").length > before, { timeout: 5_000 }, cancelsBeforeNext).catch(() => assert.fail("a new On-device question did not stop the answer being read"));
  await page.waitForFunction(() => !document.querySelector(".phone-tutor__working"), { timeout: 10_000 });
  // That second Simpler follows a follow-up: it still searches with the
  // learner's own question, not the first chip's wording.
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.retrievalCalls.at(-1).query), followedQuestion, "a chained On-device follow-up searched with a chip's wording");
  assert.deepEqual(await phoneListen(), ["Listen to this answer"], "Listen did not reset after reading stopped");
  // A reading the speech engine stops by itself says why.
  await page.$$eval(".phone-tutor__message.is-assistant", (nodes) => [...nodes.at(-1).querySelectorAll(".phone-tutor__message-actions button")].find((node) => node.textContent.startsWith("Listen")).click());
  await page.waitForFunction(() => [...document.querySelectorAll(".phone-tutor__message-actions button")].some((node) => node.textContent.startsWith("Pause")), { timeout: 3_000 });
  await page.evaluate(() => speechSynthesis.current?.onerror?.({ error: "synthesis-failed" }));
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.notifications.some(([, kind]) => kind === "error"), { timeout: 3_000 }).catch(() => assert.fail("an On-device reading that failed part-way did not say why"));
  assert.deepEqual(await phoneListen(), ["Listen to this answer"], "a failed On-device reading left Pause and Stop behind");

  // A long answer streams while the learner reads elsewhere (TFEAT-08):
  // "Jump to latest" brings its newest text into view at once under reduced
  // motion, and an answer that lands out of view is offered as "Answer
  // ready", which moves focus to it. Web fallback is off for these turns.
  await toggleWebFallback(page);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.slowNextGeneration = 60; });
  await page.click(sendButtonSelector);
  await page.waitForFunction(() => document.querySelector(".phone-tutor__message.is-streaming")?.getBoundingClientRect().height > 700, { timeout: 8_000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => document.querySelector(".phone-tutor__jump")?.textContent.includes("Jump to latest"), { timeout: 3_000 }).catch(() => assert.fail("On-device Lite offered no Jump to latest while the learner read elsewhere"));
  assert.deepEqual(await page.$eval(".phone-tutor__jump", (node) => ({ role: node.getAttribute("role"), live: node.getAttribute("aria-live"), tall: node.getBoundingClientRect().height >= 44 })), { role: null, live: null, tall: true }, "the On-device jump pill was a live region or too small to tap");
  await page.click(".phone-tutor__jump");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => {
    const end = document.querySelector(".phone-tutor__conversation-end").getBoundingClientRect();
    return end.bottom > 0 && end.bottom <= innerHeight && document.activeElement?.classList.contains("is-streaming");
  }), true, "Jump to latest did not bring the streaming answer's end into view and focus it");
  await page.waitForFunction(() => !document.querySelector(".phone-tutor__message.is-streaming"), { timeout: 10_000 });
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.slowNextGeneration = 30; });
  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__message.is-streaming", { timeout: 5_000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => !document.querySelector(".phone-tutor__message.is-streaming") && document.querySelector(".phone-tutor__jump")?.textContent.includes("Answer ready"), { timeout: 10_000 }).catch(() => assert.fail("an On-device answer that landed out of view was not offered"));
  await page.click(".phone-tutor__jump");
  await page.waitForFunction(() => document.activeElement === [...document.querySelectorAll(".phone-tutor__message.is-assistant")].at(-1), { timeout: 3_000 }).catch(() => assert.fail("Answer ready did not move focus to the new On-device answer"));
  assert.equal(await page.$(".phone-tutor__jump"), null, "the On-device pill stayed after it was used");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  // Keyboard (TFEAT-10). On a touch screen Return stays a new line and no
  // hint is shown; Up arrow in an empty box brings back the last question;
  // Esc stops a running answer, which (like Cancel) releases the model, so
  // it is then loaded again explicitly.
  const phoneField = ".phone-tutor__composer textarea";
  const lastQuestion = await page.$$eval(".phone-tutor__message.is-user .phone-tutor__user-text", (nodes) => nodes.at(-1).textContent);
  const callsBeforeKeys = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length);
  assert.equal(await page.$(".phone-tutor__key-hint"), null, "a phone showed the keyboard hint");
  await page.$eval(phoneField, (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Phone line");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await page.$eval(phoneField, (field) => field.value), "Phone line\n", "Return did not start a new line in On-device Lite on a phone");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length), callsBeforeKeys, "Return sent the question in On-device Lite on a phone");
  await page.$eval(phoneField, (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    field.setSelectionRange(0, 0);
  });
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.$eval(phoneField, (field) => field.value), lastQuestion, "Up arrow did not bring back the last On-device question");
  // A prepared question from another screen (TFEAT-07) reaches On-device
  // Lite too: applied once, in its mode, below a draft, and never sent.
  const modeBeforeInsert = await activeMode(page);
  const preparedQuestion = "Work through this mistake with me, one question at a time.\n\nQuestion: Why does gradient descent step against the gradient?";
  const preparedCallsBefore = await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length);
  await page.$eval(phoneField, (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "My phone draft");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate((prompt) => window.__PHONE_INSERT__({ kind: "prompt", prompt, modeId: "socratic", origin: "mistake notebook", label: "Why does gradient descent step against the gradient?", nonce: 4242 }), preparedQuestion);
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.consumedInserts.includes(4242), { timeout: 5_000 });
  assert.equal(await activeMode(page), "Socratic", "a prepared question did not set its On-device mode");
  assert.equal(await page.$eval(phoneField, (field) => field.value), `My phone draft\n\n${preparedQuestion}`, "a prepared question replaced the On-device draft");
  await page.$eval(phoneField, (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate((prompt) => window.__PHONE_INSERT__({ kind: "prompt", prompt, modeId: "socratic", nonce: 4242 }), preparedQuestion);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await page.$eval(phoneField, (field) => field.value), "", "a consumed prepared question was applied again");
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.prepareCalls.length), preparedCallsBefore, "a prepared question was sent");
  // A long notebook entry is shortened to fit On-device Lite's box whole,
  // never cut off mid-word by the box itself.
  const longMistake = mistakeTutorRequest({ prompt: `Why ${"does lasso zero out weights ".repeat(40)}?`, expected: "the L1 corners sit at zero ".repeat(60), response: "because it squares them ".repeat(60) });
  await page.evaluate((request) => window.__PHONE_INSERT__({ kind: "prompt", ...request, nonce: 4343 }), longMistake);
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.consumedInserts.includes(4343), { timeout: 5_000 });
  assert.equal(await page.$eval(phoneField, (field) => field.value), longMistake.prompt, "a long prepared question was cut off in On-device Lite");
  assert.match(longMistake.prompt, /\nMy answer: .+…$/, "the long prepared question lost the learner's answer");
  await page.$eval(phoneField, (field) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await chooseMode(page, modeBeforeInsert);
  await page.$eval(phoneField, (field, text) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, lastQuestion);
  await page.evaluate(() => { window.__PHONE_AI_AUDIT__.slowNextGeneration = 60; });
  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__message.is-streaming", { timeout: 5_000 });
  await page.$eval(".phone-tutor__working button", (button) => button.focus());
  await page.keyboard.press("Escape");
  await page.waitForSelector(".phone-tutor__request-state.is-cancelled", { timeout: 5_000 }).catch(() => assert.fail("Escape did not stop the On-device answer"));
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Available"), { timeout: 5_000 });
  await (await page.$(".phone-local-ai-actions .button.primary")).click();
  await page.waitForFunction(() => document.querySelector(".phone-local-ai-badge")?.textContent.includes("Loaded"), { timeout: 10_000 });
  await toggleWebFallback(page);

  await page.click(sendButtonSelector);
  await page.waitForSelector(".phone-tutor__search-consent");
  // Leaving releases the model after a short grace period, so a quick return
  // does not reload it; the release itself must still happen.
  const unloadsBeforeLeaving = await page.evaluate(() => {
    const before = window.__PHONE_AI_AUDIT__.unloadCalls;
    window.__UNMOUNT_PHONE_AI_AUDIT__();
    return { before, immediately: window.__PHONE_AI_AUDIT__.unloadCalls };
  });
  assert.equal(unloadsBeforeLeaving.immediately, unloadsBeforeLeaving.before, "leaving On-device Lite unloaded the model without a grace period");
  await page.waitForFunction(() => window.__PHONE_AI_AUDIT__.searchDecisions.some((decision) => decision.searchId === "audit-search-3" && decision.consent === false));
  assert.ok(await page.evaluate(() => window.__PHONE_AI_AUDIT__.cancelCalls >= 1), "unmount did not cancel pending on-device work");
  await page.waitForFunction((before) => window.__PHONE_AI_AUDIT__.unloadCalls > before, {}, unloadsBeforeLeaving.before);
  assert.equal(await page.evaluate(() => window.__PHONE_AI_AUDIT__.loaded), false, "leaving On-device Lite retained its hidden GPU model");
  assert.equal((await page.evaluate(() => window.__PHONE_AI_AUDIT__.interactionStates)).at(-1), false, "unmount left the parent engine picker locked");
  assert.equal(runtimeErrors.length, 0, `phone AI browser errors: ${runtimeErrors.join(" | ")}`);
  console.log("Phone AI UI audit passed: the On-device Lite chat window fit (docked question box, Options sheet, one-line engine card, latest turn), library-first bounded retrieval, token-streamed sanitized GFM/KaTeX, citation and context-fit evidence, strict worker/model lifecycle, prepared questions from other screens applied once, and one-shot web-search consent/decline/approval.");
} catch (error) {
  if (error !== liteChatFitOnly) throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
