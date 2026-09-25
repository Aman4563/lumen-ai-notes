import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Guards the theme token contrast cluster: every text token must stay legible
// (WCAG 1.4.3, 4.5:1) on every paper surface, and the focus ring must keep
// 3:1 (WCAG 1.4.11) in Paper, Night, System-dark, and Contrast.
const stylesUrl = new URL("../styles.css", import.meta.url);
// A leading newline lets every block be matched at the start of a line.
const css = `\n${readFileSync(stylesUrl, "utf8")}`;

const blockAfter = (source, opener) => {
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `missing CSS block ${opener}`);
  const open = source.indexOf("{", start + opener.length - 1);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`unterminated CSS block ${opener}`);
};
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

const root = declarations(blockAfter(css, "\n:root {"));
const dark = declarations(blockAfter(css, '\n[data-theme="dark"] {'));
const systemDark = declarations(blockAfter(blockAfter(css, "@media (prefers-color-scheme: dark) {"), '[data-theme="system"] {'));
const contrast = declarations(blockAfter(css, '\n[data-theme="contrast"] {'));
const islands = declarations(blockAfter(css, "\n.app-sidebar,\n.welcome-block,\n.review-hero {"));
const contrastIslands = declarations(blockAfter(css, '\n[data-theme="contrast"] :is(.welcome-block, .review-hero, .app-sidebar) {'));

const THEMES = {
  paper: { ...root },
  night: { ...root, ...dark },
  "system-dark": { ...root, ...systemDark },
  contrast: { ...root, ...contrast },
};

const resolve = (palette, name, seen = new Set()) => {
  assert.ok(!seen.has(name), `circular token ${name}`);
  const value = palette[name];
  assert.ok(value, `token ${name} is not defined`);
  const reference = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (!reference) return value;
  return palette[reference[1]] ? resolve(palette, reference[1], new Set([...seen, name])) : reference[2];
};
const channel = (value) => {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};
const luminance = (color) => {
  const hex = color.replace("#", "");
  assert.match(hex, /^([0-9a-f]{3}|[0-9a-f]{6})$/i, `expected an opaque hex color, got ${color}`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const [red, green, blue] = [0, 2, 4].map((offset) => channel(Number.parseInt(full.slice(offset, offset + 2), 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const ratio = (first, second) => {
  const [light, darkest] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (light + 0.05) / (darkest + 0.05);
};

const SURFACES = ["--paper", "--paper-2", "--paper-3"];
const TEXT_TOKENS = ["--ink", "--ink-soft", "--ink-faint", "--coral-text", "--teal-text", "--danger", "--ai-warn", "--accent"];
const TEXT_PAIRS = [
  ["--ink-faint", "--coral-soft"], ["--ink-faint", "--teal-soft"], ["--ink-faint", "--gold-soft"], ["--ink-faint", "--violet-soft"],
  ["--coral-text", "--coral-soft"], ["--teal-text", "--teal-soft"], ["--ai-warn", "--gold-soft"],
  ["--accent-strong", "--accent-soft"], ["--on-primary", "--primary-bg"],
  ["--sidebar-ink", "--sidebar-bg"], ["--sidebar-ink-muted", "--sidebar-bg"], ["--sidebar-accent", "--sidebar-bg"],
];

for (const [theme, palette] of Object.entries(THEMES)) {
  test(`${theme}: text tokens reach 4.5:1 on every paper surface`, () => {
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACES) {
        const value = ratio(resolve(palette, text), resolve(palette, surface));
        assert.ok(value >= 4.5, `${theme}: ${text} on ${surface} is ${value.toFixed(2)}:1`);
      }
    }
  });

  test(`${theme}: paired text and fill tokens reach 4.5:1`, () => {
    for (const [text, surface] of TEXT_PAIRS) {
      const value = ratio(resolve(palette, text), resolve(palette, surface));
      assert.ok(value >= 4.5, `${theme}: ${text} on ${surface} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${theme}: the focus ring keeps 3:1 against its halo and every surface`, () => {
    const ring = resolve(palette, "--focus-ring");
    for (const surface of ["--focus-halo", ...SURFACES]) {
      const value = ratio(ring, resolve(palette, surface));
      assert.ok(value >= 3, `${theme}: --focus-ring on ${surface} is ${value.toFixed(2)}:1`);
    }
  });
}

test("navy islands carry a focus ring that stays visible on their surface", () => {
  for (const [label, tokens, surfaces] of [
    ["paper/night", islands, ["#172646", "#253c69", resolve(root, "--sidebar-bg")]],
    ["contrast", { ...islands, ...contrastIslands }, ["#000000"]],
  ]) {
    for (const surface of [tokens["--focus-halo"], ...surfaces]) {
      const value = ratio(tokens["--focus-ring"], surface);
      assert.ok(value >= 3, `${label} islands: --focus-ring on ${surface} is ${value.toFixed(2)}:1`);
    }
  }
});

test("system-dark mirrors every Night token", () => {
  for (const [token, value] of Object.entries(dark)) assert.equal(systemDark[token], value, `system-dark ${token} drifted from Night`);
});

test("every custom property referenced by the app stylesheets is defined", () => {
  const sheets = readdirSync(new URL("..", import.meta.url)).filter((name) => name.endsWith(".css")).map((name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
  const defined = new Set(sheets.flatMap((sheet) => [...sheet.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name)));
  // Set at runtime from JavaScript: reader typography style props, whiteboard
  // swatches and landscape layout measurements (Whiteboard.jsx), and each
  // Mermaid diagram's readable width (mermaidDiagrams.js).
  const runtime = new Set(["--font-scale", "--line-height", "--swatch", "--board-offset-top", "--board-toolbar-height", "--diagram-readable-width"]);
  const missing = [...new Set(sheets.flatMap((sheet) => [...sheet.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name)))].filter((name) => !defined.has(name) && !runtime.has(name));
  assert.deepEqual(missing, [], `undefined custom properties: ${missing.join(", ")}`);
});
