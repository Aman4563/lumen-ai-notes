import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

// axe-core is a pinned dev dependency. The app CSP blocks injected <script>
// tags, so its source is evaluated through CDP instead.
const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const baseUrl = (process.env.LUMEN_URL || "http://127.0.0.1:4173/").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-a11y-"));

const ROUTES = [
  { name: "home", hash: "#/home", ready: ".welcome-block", nav: "Home" },
  { name: "library", hash: "#/library", ready: ".library-page", nav: "Library" },
  { name: "reader", hash: `#/read/${encodeURIComponent("notes/part-05-supervised-learning/01-linear-regression.md")}`, ready: ".reader-view .markdown-body h1", nav: "Read" },
  { name: "ai", hash: "#/ai", ready: ".ai-learning-studio", nav: "AI Tutor" },
  { name: "review", hash: "#/review", ready: ".review-center-page", nav: "Review" },
  { name: "notebook", hash: "#/notebook", ready: ".notebook-page", nav: "Notebook" },
  { name: "board", hash: `#/board/${encodeURIComponent("notes/00-roadmap.md")}`, ready: ".board-canvas", nav: "Board" },
  { name: "device-evidence", hash: "#/device-evidence", ready: ".device-evidence-page", nav: null },
];
const THEMES = [["paper", "Paper"], ["dark", "Night"], ["contrast", "Contrast"]];
const VIEWPORTS = [
  ["phone", { width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ["desktop", { width: 1280, height: 800, deviceScaleFactor: 1 }],
];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// Known violations owned by the component waves that follow the accessibility
// foundation. Each entry is one rule inside one component container; anything
// else fails the gate. Remove an entry as soon as its owner fixes it.
const ALLOWLIST = [
  // Home concept map: pointer-only role=button nodes inside role=img (A11Y-SWEEP-15).
  { rule: "nested-interactive", within: ".concept-map", owner: "dashboard" },
  // Whiteboard chrome keeps hard-coded light surfaces under Night/Contrast text tokens (BOARD-3).
  { rule: "color-contrast", within: ".board-header", owner: "whiteboard" },
];

const findings = [];
const runtimeErrors = [];
const stats = { axeRuns: 0, allowlisted: 0, checks: 0 };
const check = (condition, message) => {
  stats.checks += 1;
  if (!condition) findings.push(message);
};

// Theme switches run short color transitions; axe must measure settled colors.
const settle = (page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const finite = document.getAnimations().filter((animation) => animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime));
  await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  await new Promise((resolve) => setTimeout(resolve, 100));
});

const runAxe = async (page, label) => {
  if (!await page.evaluate(() => typeof window.axe !== "undefined")) await page.evaluate(axeSource);
  const violations = await page.evaluate(async (tags, allowlist) => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return result.violations.flatMap((violation) => violation.nodes.map((node) => {
      const element = node.target.length === 1 ? document.querySelector(node.target[0]) : null;
      const allowed = allowlist.find((entry) => entry.rule === violation.id && element?.closest(entry.within));
      return { rule: violation.id, target: node.target.join(" "), summary: (node.failureSummary || "").replace(/\s+/g, " ").slice(0, 220), allowedBy: allowed?.owner || null };
    }));
  }, AXE_TAGS, ALLOWLIST);
  stats.axeRuns += 1;
  for (const violation of violations) {
    if (violation.allowedBy) stats.allowlisted += 1;
    else findings.push(`${label}: axe ${violation.rule} on ${violation.target} — ${violation.summary}`);
  }
};

const openSettings = async (page) => {
  await page.$eval('button[aria-label="Open settings"]', (button) => button.click());
  await page.waitForSelector(".settings-drawer .theme-choices");
};
const closeSettings = async (page) => {
  await page.$eval(".settings-close", (button) => button.click());
  await page.waitForSelector(".settings-drawer", { hidden: true });
  await settle(page);
};
const navigate = async (page, route) => {
  await page.evaluate((hash) => { location.hash = hash; }, route.hash);
  await page.waitForSelector(route.ready, { timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector(".view-loading"), { timeout: 20_000 }).catch(() => {});
  await settle(page);
};
const sidebarState = (page) => page.$eval(".app-sidebar", (node) => ({ inert: node.inert, hidden: node.getAttribute("aria-hidden") }));

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profileDirectory,
  args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
});

try {
  for (const [viewportName, viewport] of VIEWPORTS) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(`${viewportName}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(`${viewportName}: ${message.text()}`);
    });
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${baseUrl}/#/home`, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.waitForSelector(".welcome-block");

    // Skip link: the first Tab stop, visible when focused, moves focus to the
    // main landmark without touching the hash route.
    await settle(page);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.keyboard.press("Tab");
    await settle(page);
    const skip = await page.evaluate(() => {
      const active = document.activeElement;
      const box = active?.getBoundingClientRect();
      return { isSkip: active?.classList.contains("skip-link"), text: active?.textContent, top: box?.top, bottom: box?.bottom, visible: Boolean(box && box.top >= 0 && box.bottom <= innerHeight && box.width > 0) };
    });
    check(skip.isSkip && skip.visible, `${viewportName}: the first Tab stop is not a visible skip link (${JSON.stringify(skip)})`);
    await page.keyboard.press("Enter");
    const afterSkip = await page.evaluate(() => ({ id: document.activeElement?.id, hash: location.hash }));
    check(afterSkip.id === "main-content" && afterSkip.hash === "#/home", `${viewportName}: the skip link did not focus #main-content without changing the route (${JSON.stringify(afterSkip)})`);
    await page.keyboard.press("Tab");
    const firstStop = await page.evaluate(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return { inMain: Boolean(active?.closest("#main-content")), outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` };
    });
    check(firstStop.inMain && /^solid (2|3)px rgb\(/.test(firstStop.outline), `${viewportName}: Tab after the skip link did not reach page content with an opaque focus ring (${JSON.stringify(firstStop)})`);

    for (const [theme, themeLabel] of THEMES) {
      await navigate(page, ROUTES[0]);
      await openSettings(page);
      await page.$$eval(".theme-choices button", (buttons, label) => buttons.find((button) => button.textContent.includes(label))?.click(), themeLabel);
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, {}, theme);
      await settle(page);
      if (theme === "paper") {
        const radios = await page.$$eval(".theme-choices [role=radio]", (nodes) => nodes.map((node) => ({ checked: node.getAttribute("aria-checked"), tabIndex: node.tabIndex })));
        check(radios.length === 4 && radios.filter((radio) => radio.checked === "true").length === 1 && radios.filter((radio) => radio.tabIndex === 0).length === 1, `${viewportName}: theme choices are not a single-selection radio group (${JSON.stringify(radios)})`);
      }
      await runAxe(page, `${viewportName}/${theme}/settings`);
      const header = await page.$eval(".settings-drawer", (drawer) => {
        drawer.scrollTop = drawer.scrollHeight;
        const close = drawer.querySelector(".settings-close").getBoundingClientRect();
        return { headings: drawer.querySelectorAll("h2").length, closeVisible: close.top >= 0 && close.bottom <= innerHeight && document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2)?.closest(".settings-close") !== null };
      });
      check(header.closeVisible, `${viewportName}/${theme}: Close settings scrolled out of reach`);
      check(header.headings >= 8, `${viewportName}/${theme}: Settings sections are not exposed as headings (${header.headings})`);
      await closeSettings(page);
      if (viewportName === "phone") {
        // A11Y-SWEEP-1: closing any modal must leave the closed drawer hidden.
        const sidebar = await sidebarState(page);
        check(sidebar.inert && sidebar.hidden === "true", `${viewportName}/${theme}: the closed mobile drawer became reachable after Settings closed (${JSON.stringify(sidebar)})`);
      }

      const titles = new Map();
      for (const route of ROUTES) {
        await navigate(page, route);
        const label = `${viewportName}/${theme}/${route.name}`;
        const structure = await page.evaluate(() => ({
          mains: document.querySelectorAll("main, [role='main']").length,
          mainId: document.querySelector("main")?.id,
          title: document.title,
          current: [...document.querySelectorAll(".sidebar-primary [aria-current='page'], .bottom-nav [aria-current='page']")]
            .filter((node) => node.getClientRects().length && !node.closest("[inert]")).map((node) => node.textContent.trim()),
        }));
        check(structure.mains === 1 && structure.mainId === "main-content", `${label}: expected exactly one main landmark (#main-content), found ${structure.mains}`);
        titles.set(route.name, structure.title);
        if (route.nav && (viewportName === "desktop" || ["Home", "Library", "Read", "AI Tutor", "Notebook"].includes(route.nav))) {
          check(structure.current.length === 1 && structure.current[0].startsWith(route.nav), `${label}: aria-current="page" is not on the ${route.nav} navigation item (${JSON.stringify(structure.current)})`);
        }
        await runAxe(page, label);
      }
      check(new Set(titles.values()).size === ROUTES.length, `${viewportName}/${theme}: document titles are not unique per route (${JSON.stringify([...titles])})`);
      check(titles.get("home") === "Lumen AI Notes" && titles.get("library") === "Library · Lumen", `${viewportName}/${theme}: unexpected page titles (${JSON.stringify([...titles])})`);

      if (viewportName === "phone") {
        await navigate(page, ROUTES[0]);
        await page.$eval('[aria-label="Open menu"]', (button) => button.click());
        await page.waitForFunction(() => document.querySelector(".app-sidebar.open") && !document.querySelector(".app-sidebar").inert);
        await settle(page);
        const drawer = await page.$eval(".app-sidebar", (node) => {
          // Inert content is skipped by hit testing, so lift the background's
          // inert flag for one synchronous probe to test real paint order.
          const main = document.querySelector(".app-main");
          const settings = node.querySelector(".sidebar-settings").getBoundingClientRect();
          main.inert = false;
          const onTop = Boolean(document.elementFromPoint(settings.left + settings.width / 2, settings.top + settings.height / 2)?.closest(".sidebar-settings"));
          main.inert = true;
          return { role: node.getAttribute("role"), modal: node.getAttribute("aria-modal"), name: node.getAttribute("aria-label"), settingsOnTop: onTop };
        });
        check(drawer.role === "dialog" && drawer.modal === "true" && drawer.name && drawer.settingsOnTop, `${viewportName}/${theme}: the open drawer is not an exposed modal dialog with a reachable Settings row (${JSON.stringify(drawer)})`);
        await runAxe(page, `${viewportName}/${theme}/drawer`);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector(".app-sidebar")?.inert);
      }
    }

    // The curriculum list's bottom fade never dims the keyboard-focused Part.
    if (viewportName === "desktop") {
      await navigate(page, ROUTES[0]);
      await page.$eval(".sidebar-section-title button", (button) => button.focus());
      const faded = [];
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press("Tab");
        await settle(page);
        const row = await page.evaluate(() => {
          const list = document.querySelector(".sidebar-parts");
          const active = document.activeElement;
          const style = getComputedStyle(list);
          if (!list.contains(active) || (style.maskImage || style.webkitMaskImage || "none") === "none") return null;
          const gap = list.getBoundingClientRect().bottom - active.getBoundingClientRect().bottom;
          return gap < 42 ? `${active.textContent.slice(0, 2)} ${Math.round(gap)}px` : null;
        });
        if (row) faded.push(row);
      }
      check(faded.length === 0, `${viewportName}: keyboard-focused curriculum Parts sit inside the list's fade (${faded.join(", ")})`);
    }

    // A user-initiated route change moves focus to the new page heading.
    await navigate(page, ROUTES[0]);
    const navButton = viewportName === "phone" ? ".bottom-nav button" : ".sidebar-primary button";
    await page.$$eval(navButton, (buttons) => buttons.find((button) => button.textContent.includes("Library")).click());
    await page.waitForSelector(".library-page");
    const routeFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim() }));
    check(routeFocus.tag === "H1" && routeFocus.text === "Your library", `${viewportName}: navigation did not move focus to the new page heading (${JSON.stringify(routeFocus)})`);

    if (viewportName === "phone") {
      // Navigating from the drawer lands on the new heading, not the menu button.
      await page.$eval('[aria-label="Open menu"]', (button) => button.click());
      await page.waitForFunction(() => document.querySelector(".app-sidebar.open") && !document.querySelector(".app-sidebar").inert);
      await page.$$eval(".sidebar-primary button", (buttons) => buttons.find((button) => button.textContent.includes("Notebook")).click());
      await page.waitForSelector(".notebook-page");
      await settle(page);
      const drawerFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim() }));
      check(drawerFocus.tag === "H1", `${viewportName}: navigating from the drawer did not move focus to the new page heading (${JSON.stringify(drawerFocus)})`);

      // A component dialog (reader actions) must not re-expose the closed drawer.
      await navigate(page, ROUTES[2]);
      await page.$eval('[aria-label="Open lecture actions"]', (button) => button.click());
      await page.waitForSelector(".reader-action-menu");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".reader-action-menu", { hidden: true });
      await settle(page);
      const sidebar = await sidebarState(page);
      check(sidebar.inert && sidebar.hidden === "true", `${viewportName}: the closed mobile drawer became reachable after the reader actions menu closed (${JSON.stringify(sidebar)})`);
    }

    // Clicking lecture text must not park focus on <main>: the reader scrolls
    // its own container, so PageDown only works while focus stays on the body.
    if (viewportName === "desktop") {
      await navigate(page, ROUTES[2]);
      const paragraph = await page.evaluate(() => {
        const node = [...document.querySelectorAll(".markdown-body p")].find((item) => { const box = item.getBoundingClientRect(); return box.top > 150 && box.bottom < innerHeight - 150; });
        const box = node?.getBoundingClientRect();
        return box && { x: box.left + 20, y: box.top + box.height / 2 };
      });
      await page.mouse.click(paragraph.x, paragraph.y);
      const clicked = await page.evaluate(() => ({ active: document.activeElement?.tagName, top: document.querySelector(".reader-scroll").scrollTop }));
      await page.keyboard.press("PageDown");
      const scrolled = await page.waitForFunction((top) => document.querySelector(".reader-scroll").scrollTop > top + 100, { timeout: 5_000 }, clicked.top).then(() => true).catch(() => false);
      check(clicked.active === "BODY" && scrolled, `${viewportName}: clicking lecture text moved focus to ${clicked.active} or stopped PageDown from scrolling the reader`);
    }

    // Toasts announce through persistent live regions, pick the icon by kind,
    // and dismiss on schedule even while the app keeps re-rendering (HL-22).
    await navigate(page, ROUTES[0]);
    const regions = await page.evaluate(() => ({ polite: document.querySelectorAll(".toast-live[role=status][aria-live=polite]").length, assertive: document.querySelectorAll(".toast-live[role=alert]").length, empty: [...document.querySelectorAll(".toast-live")].every((node) => !node.textContent) }));
    check(regions.polite === 1 && regions.assertive === 1 && regions.empty, `${viewportName}: persistent toast live regions are missing or pre-filled (${JSON.stringify(regions)})`);
    await openSettings(page);
    await page.$$eval(".settings-drawer button", (buttons) => buttons.find((button) => button.textContent.includes("Restore reading defaults")).click());
    await closeSettings(page);
    const announced = await page.waitForFunction(() => document.querySelector(".toast-live--polite")?.textContent.includes("Reading defaults restored"), { timeout: 5_000 }).then(() => true).catch(() => false);
    check(announced, `${viewportName}: the toast message never reached the persistent status region`);
    check(await page.$eval(".toast svg", (icon) => icon.classList.contains("lucide-circle-check")).catch(() => false), `${viewportName}: success toast does not use the success icon`);
    // Toggling connectivity re-renders the whole shell every 250 ms.
    const churn = setInterval(() => { page.evaluate(() => { window.__lumenFlip = !window.__lumenFlip; window.dispatchEvent(new Event(window.__lumenFlip ? "offline" : "online")); }).catch(() => {}); }, 250);
    const dismissed = await page.waitForSelector(".toast", { hidden: true, timeout: 7_000 }).then(() => true).catch(() => false);
    clearInterval(churn);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    check(dismissed, `${viewportName}: a success toast stayed on screen while the app re-rendered`);

    // Offline: a status pill under the top bar and a text alternative on the sidebar dot.
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForFunction(() => document.querySelector(".offline-status[role=status]")?.textContent.includes("Offline"), { timeout: 5_000 }).catch(() => {});
    const offline = await page.evaluate(() => {
      const pill = document.querySelector(".offline-status")?.getBoundingClientRect() || { width: 0 };
      return { pillVisible: pill.width > 0 && pill.top >= 0 && pill.bottom <= innerHeight, settingsName: document.querySelector(".sidebar-settings").textContent.replace(/\s+/g, " ").trim() };
    });
    check(offline.pillVisible && /offline/i.test(offline.settingsName), `${viewportName}: offline state is not visible or has no text alternative (${JSON.stringify(offline)})`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => !document.querySelector(".offline-status")?.textContent, { timeout: 5_000 }).catch(() => {});

    // ⌘K with a dialog open must not change the route underneath it.
    await openSettings(page);
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await settle(page);
    check(await page.evaluate(() => location.hash === "#/home" && Boolean(document.querySelector(".settings-drawer"))), `${viewportName}: Ctrl+K changed the route behind the Settings dialog`);
    await closeSettings(page);
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await page.waitForSelector(".library-page");
    check(await page.evaluate(() => document.activeElement?.matches(".library-search input")), `${viewportName}: Ctrl+K did not focus the library search`);

    // Forced colors: the current navigation item keeps a visible marker.
    // Puppeteer's media-feature allowlist lacks forced-colors; use CDP directly.
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    await settle(page);
    const forced = await page.evaluate((selector) => {
      const items = [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length);
      const active = items.find((node) => node.getAttribute("aria-current") === "page");
      const other = items.find((node) => node !== active);
      const edge = (node) => { const style = getComputedStyle(node); return `${style.borderTopWidth} ${style.borderTopStyle}`; };
      return { forced: matchMedia("(forced-colors: active)").matches, active: active && edge(active), other: other && edge(other) };
    }, viewportName === "phone" ? ".bottom-nav button" : ".sidebar-primary button");
    check(forced.active && forced.active !== forced.other, `${viewportName}: the current navigation item is indistinguishable in forced colors (${JSON.stringify(forced)})`);
    await cdp.detach();

    await context.close();
  }

  assert.equal(runtimeErrors.length, 0, `browser errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(findings.length, 0, `accessibility failures:\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  console.log(`Accessibility audit passed: ${stats.axeRuns} axe runs (WCAG 2.2 A/AA + best practice) across ${ROUTES.length} routes, Settings, and the drawer in Paper, Night, and Contrast at phone and desktop widths; ${stats.checks} structural checks (one main landmark, skip link, per-route titles, aria-current, heading focus on navigation, drawer inert after dialogs, live-region toasts, offline status, Ctrl+K guard, forced colors); ${stats.allowlisted} allowlisted nodes owned by later component waves.`);
} finally {
  await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
