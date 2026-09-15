import { join } from "node:path";

// Cover the dark, scrolled embedded preview from the reported screenshot, plus
// phone rotation/keyboard resizing. Horizontal bounds alone cannot detect it.
export async function auditViewportScrolling({ browser, baseUrl, artifactDirectory, results, runtimeErrors }) {
  const cases = [
    { device: "embedded-preview", sizes: [[1225, 671], [1225, 450], [1225, 878]], embedded: true },
    { device: "theme-phone", sizes: [[390, 680], [568, 320], [390, 800]] },
  ].filter(({ device }) => !process.env.LUMEN_LAYOUT_CASES || process.env.LUMEN_LAYOUT_CASES.split(",").includes(device));
  for (const { device, sizes, embedded } of cases) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push({ device, error: error.message }));
    const resize = async ([width, height]) => {
      await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: !embedded });
    };
    await resize(sizes[0]);
    // Keep normal smooth-scroll behavior: section navigation must still reset
    // immediately, even if an old page had an animated scroll in progress.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    // Match the editor preview's content viewport. The production app rejects
    // iframe embedding, so retain its security headers and use a regular tab.
    await page.goto(`${baseUrl}/#/home`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".welcome-block");
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clickLabel = async (selector, label) => {
      const buttons = await page.$$(selector);
      const target = (await Promise.all(buttons.map(async (button) => ({ button, text: await button.evaluate((node) => node.textContent) })))).find(({ text }) => text.includes(label));
      if (!target) throw new Error(`Missing ${label} in ${selector}`);
      try {
        // Wait for moving drawers to settle before computing click coordinates.
        await target.button.asLocator().click();
      } catch (error) {
        console.error(JSON.stringify({ device, label, navigation: await page.evaluate(() => ({
          hash: location.hash, scrollY, height: innerHeight,
          nodes: [...document.querySelectorAll("html, body, .app-sidebar, .sidebar-primary button")].map((node) => ({
            name: node.className || node.tagName, inert: node.inert,
            rect: node.getBoundingClientRect().toJSON(), position: getComputedStyle(node).position,
            transform: getComputedStyle(node).transform, overflow: getComputedStyle(node).overflow,
          })),
        })) }));
        await page.screenshot({ path: join(artifactDirectory, `${device}-navigation-error.png`) });
        throw error;
      }
    };
    const navigate = async (label, selector) => {
      if (await page.$eval(".app-sidebar", (node) => matchMedia("(max-width: 980px)").matches && !node.classList.contains("open"))) {
        await page.click('[aria-label="Open menu"]');
        await page.waitForFunction(() => document.querySelector(".app-sidebar").classList.contains("open") && !document.querySelector(".app-sidebar").inert);
        await page.$eval(".app-sidebar", async (node) => {
          node.getBoundingClientRect();
          await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
        });
      }
      await clickLabel(".sidebar-primary button", label);
      await page.waitForSelector(selector, { timeout: 10_000 }).catch(async (error) => {
        console.error(JSON.stringify({ device, label, navigation: await page.evaluate(() => ({ hash: location.hash, sidebar: document.querySelector(".app-sidebar")?.outerHTML.slice(0, 1200), scrollY })) }));
        await page.screenshot({ path: join(artifactDirectory, `${device}-navigation-error.png`) });
        throw error;
      });
      await settle();
    };
    const bottom = async () => {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await settle();
    };
    const inspect = async (surface, theme, { atTop = false, atBottom = false } = {}) => {
      await settle();
      const finding = await page.evaluate(({ atTop, atBottom }) => {
        const root = document.documentElement;
        const body = document.body;
        const main = document.querySelector(".app-main").getBoundingClientRect();
        const viewport = window.visualViewport;
        const problems = [];
        if (getComputedStyle(root).backgroundColor !== getComputedStyle(body).backgroundColor) problems.push("Document canvas does not match the active theme");
        if ([root, body].some((node) => getComputedStyle(node).overscrollBehaviorY !== "none")) problems.push("Vertical overscroll can expose empty canvas or escape the embedded app");
        if (main.bottom < innerHeight - 2 || body.getBoundingClientRect().bottom < innerHeight - 2) problems.push("App ends above the viewport bottom");
        if (root.scrollWidth > innerWidth + 2) problems.push("Page extends horizontally beyond the viewport");
        if (atTop && scrollY > 1) problems.push("Section navigation retained the previous page scroll position");
        if (atBottom && Math.abs(scrollY + innerHeight - root.scrollHeight) > 2) problems.push("Page bottom is not reachable after resizing or collapsing details");
        const composer = document.querySelector(".ai-tutor__submit-row")?.getBoundingClientRect();
        if (atBottom && composer && (composer.bottom < 0 || composer.top > innerHeight)) problems.push("AI composer is outside the viewport at the page bottom");
        return { problems, scrollY, viewportHeight: viewport?.height, bounds: { top: main.top, bottom: main.bottom }, width: innerWidth, height: innerHeight };
      }, { atTop, atBottom });
      const result = { device, surface, theme, ok: finding.problems.length === 0, ...finding };
      results.push(result);
      if (!result.ok || (theme === "dark" && ["ai-bottom", "ai-resized-tall"].includes(surface))) {
        await page.screenshot({ path: join(artifactDirectory, `${device}-${theme}-${surface}.png`) });
      }
      console.log(JSON.stringify(result));
    };
    try {
      for (const [theme, label, system] of [
        ["paper", "Paper", "light"], ["dark", "Night", "light"],
        ["contrast", "Contrast", "light"], ["system-light", "System", "light"], ["system-dark", "System", "dark"],
      ]) {
        await resize(sizes[0]);
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: system }]);
        await page.click('[aria-label="Open settings"]');
        await page.waitForSelector(".theme-choices");
        await clickLabel(".theme-choices button", label);
        await page.waitForFunction((value) => document.documentElement.dataset.theme === value, {}, theme.startsWith("system") ? "system" : theme);
        await page.click(".settings-close");
        await page.waitForSelector(".settings-drawer", { hidden: true });
        await navigate("Library", ".library-page");
        await bottom();
        await navigate("AI Tutor", ".ai-tutor");
        await inspect("ai-navigation", theme, { atTop: true });
        await bottom();
        await inspect("ai-bottom", theme, { atBottom: true });
        await page.click(".ai-tutor__privacy-toggle");
        await bottom();
        // The toggle is above the viewport while details are expanded. Scroll
        // it into view exactly as a user would before collapsing the panel.
        await page.$eval(".ai-tutor__privacy-toggle", (node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
        await page.click(".ai-tutor__privacy-toggle");
        await bottom();
        await inspect("ai-details-collapsed", theme, { atBottom: true });
        await resize(sizes[1]);
        await bottom();
        await inspect("ai-resized-short", theme, { atBottom: true });
        await resize(sizes[2]);
        await settle();
        await inspect("ai-resized-tall", theme);
        await bottom();
        await inspect("ai-resized-tall-bottom", theme, { atBottom: true });
        // Selecting the active section should also take users back to its top.
        await navigate("AI Tutor", ".ai-tutor");
        await inspect("ai-reselect", theme, { atTop: true });
        await bottom();
        await navigate("Home", ".welcome-block");
        await inspect("home-navigation", theme, { atTop: true });
      }
    } finally {
      await context.close();
    }
  }
}
