// Observable-state waits shared by the browser audits (issue #138). A fixed
// sleep, or one snapshot of the running animations, is a guess about how fast
// the machine is; on a starved runner the state it assumes arrives later and
// the audit measures something in between.

// Resolves once no finite CSS transition or animation has been running (in
// the document, or in `selector`'s subtree) for `quietFrames` consecutive
// animation frames, re-reading the running set every frame. A theme switch
// starts its transitions in waves: an inherited colour only changes, and
// starts the child's own transition, once the parent's transition has ended
// (with reduced motion every element transitions every property for
// 0.01ms), so waiting on the first snapshot misses the later waves. Returns
// { ok, frames, ms } or, at the deadline, { ok: false, running, sample }; it
// never proceeds silently.
export const settleAnimations = (page, { selector = null, quietFrames = 3, timeout = 15_000 } = {}) => page.evaluate(async (scopeSelector, quietTarget, limit) => {
  const started = performance.now();
  // A hidden page runs no animation frames; the timer keeps this bounded.
  const frame = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); setTimeout(resolve, 500); });
  const describe = (animation) => {
    const target = animation.effect?.target;
    const name = animation.transitionProperty || animation.animationName || "animation";
    const className = typeof target?.className === "string" ? target.className.trim().split(/\s+/)[0] : "";
    return `${name} on ${target ? `${target.tagName.toLowerCase()}${className ? `.${className}` : ""}` : "the document"}`;
  };
  // getAnimations flushes pending style first, so transitions that the
  // latest style change starts are already in the list.
  const running = () => {
    const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
    if (!scope) return [];
    return (scopeSelector ? scope.getAnimations({ subtree: true }) : document.getAnimations())
      .filter((animation) => animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime));
  };
  let quiet = 0;
  let frames = 0;
  while (quiet < quietTarget) {
    await frame();
    frames += 1;
    const active = running();
    if (!active.length) {
      quiet += 1;
      continue;
    }
    quiet = 0;
    const left = limit - (performance.now() - started);
    if (left <= 0) return { ok: false, frames, ms: Math.round(performance.now() - started), running: active.length, sample: active.slice(0, 5).map(describe) };
    await Promise.race([Promise.all(active.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, left))]);
  }
  return { ok: true, frames, ms: Math.round(performance.now() - started) };
}, selector, quietFrames, timeout);

// Throws a named error when the page has not settled by the deadline.
export const settled = async (page, label, options) => {
  const result = await settleAnimations(page, options);
  if (!result.ok) throw new Error(`${label}: animations still running after ${result.ms} ms (${result.running}: ${result.sample.join(", ")})`);
  return result;
};

// The app stylesheet paints the page from these tokens in every theme.
export const PAGE_THEME_SAMPLES = [
  { selector: "html", property: "backgroundColor", token: "--paper-2" },
  { selector: "body", property: "color", token: "--ink" },
];

// Samples whose computed colour differs from the theme token it is painted
// with, the token resolved at the sample itself: [{ selector, property,
// token, actual, expected }]. A missing sample is reported too.
export const themeColorMismatches = (page, samples) => page.evaluate((list) => {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const resolve = (node, token) => {
    const value = getComputedStyle(node).getPropertyValue(token).trim();
    probe.style.color = "";
    probe.style.color = value;
    return value && probe.style.color ? getComputedStyle(probe).color : null;
  };
  const mismatches = [];
  for (const { selector, property, token } of list) {
    const node = document.querySelector(selector);
    const expected = node ? resolve(node, token) : null;
    const actual = node ? getComputedStyle(node)[property] : null;
    if (!node || !expected || actual !== expected) mismatches.push({ selector, property, token, actual, expected });
  }
  probe.remove();
  return mismatches;
}, samples);

// After a theme change: the root carries the theme, every transition the
// change started (in all its waves) has finished, and each sample's computed
// colours are the new theme's tokens. Returns { ok, ms } or, at the deadline,
// { ok: false, reason } naming what was still running or off its token.
export const waitForTheme = async (page, theme, { samples = [], timeout = 20_000 } = {}) => {
  const started = Date.now();
  const applied = await page.waitForFunction((value) => document.documentElement.dataset.theme === value, { timeout }, theme).then(() => true, () => false);
  if (!applied) return { ok: false, reason: `the root never took data-theme="${theme}"` };
  const checks = [...PAGE_THEME_SAMPLES, ...samples];
  for (;;) {
    const left = timeout - (Date.now() - started);
    const animations = await settleAnimations(page, { timeout: Math.max(left, 1_000) });
    const mismatches = await themeColorMismatches(page, checks);
    if (animations.ok && !mismatches.length) return { ok: true, ms: Date.now() - started };
    if (Date.now() - started >= timeout) {
      const off = mismatches.map((item) => `${item.selector} ${item.property} ${item.actual} is not ${item.token} ${item.expected}`);
      const running = animations.ok ? [] : [`${animations.running} animations still running (${animations.sample.join(", ")})`];
      return { ok: false, reason: [...running, ...off].join("; ") };
    }
  }
};

// Reads `read` until `predicate` accepts the value, and returns it: for state
// that lands asynchronously (a debounced save, a storage write) in place of
// sleeping a guessed time before one read. At the deadline it returns the
// last value read, so the caller's assertions still decide, with their own
// messages, exactly as they did after the sleep.
export const pollValue = async (read, predicate, { timeout = 10_000, interval = 100 } = {}) => {
  const deadline = Date.now() + timeout;
  const accepts = (value) => { try { return Boolean(predicate(value)); } catch { return false; } };
  for (;;) {
    const value = await read();
    if (accepts(value) || Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
};
