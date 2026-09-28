// Issue #92: every <select> in the app is the one themed control (.ui-select
// in src/styles.css). control_audit and ai_ui_audit measure the visible
// selects on each screen that hosts one and report what breaks the contract:
// on a phone or touch screen a 44px target with 16px text (so iOS never
// zooms), no browser-drawn chrome, the token chevron and theme token colors;
// on a desktop, one height, radius and text size per variant.

export const SELECT_THEMES = ["paper", "dark", "contrast"];

// Desktop metrics per variant: .ui-select, and the compact .ui-select--sm.
const DESKTOP_VARIANTS = {
  default: { height: 40, radius: 12, fontSize: 14 },
  sm: { height: 34, radius: 10, fontSize: 13 },
};

export const measureSelects = (page) => page.evaluate(() => {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  // A theme token as the rgb() string the computed style would report, or
  // null when the token is not defined on the element.
  const token = (node, name) => {
    const value = getComputedStyle(node).getPropertyValue(name).trim();
    if (!value) return null;
    probe.style.color = "";
    probe.style.color = value;
    return probe.style.color ? getComputedStyle(probe).color : null;
  };
  // Option labels listed twice under the same select or optgroup. The Listen
  // sheet's lists come from the device's voices, which may repeat a name.
  const repeatedLabels = (node) => {
    if (node.closest(".speech-choice-grid")) return [];
    const seen = new Map();
    const repeated = new Set();
    for (const option of node.options) {
      const label = option.textContent.trim();
      const group = seen.get(option.parentElement) || new Set();
      if (group.has(label)) repeated.add(label);
      seen.set(option.parentElement, group.add(label));
    }
    return [...repeated];
  };
  const records = [...document.querySelectorAll("select")]
    .filter((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !node.closest("[inert]");
    })
    .map((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      // Transient states change the edge and fill on purpose.
      const matches = (selector) => { try { return node.matches(selector); } catch { return false; } };
      const wrapper = node.closest("label")?.cloneNode(true);
      wrapper?.querySelector("select")?.remove();
      const label = node.getAttribute("aria-label") || wrapper?.textContent.replace(/\s+/g, " ").trim().slice(0, 40) || "unnamed";
      return {
        name: label,
        className: node.className,
        variant: node.classList.contains("ui-select--sm") ? "sm" : "default",
        height: Math.round(box.height * 10) / 10,
        fontSize: Number.parseFloat(style.fontSize),
        radius: Number.parseFloat(style.borderTopLeftRadius),
        appearance: style.appearance,
        // The customizable select draws its chevron on the picker icon.
        chevron: style.appearance === "base-select" ? getComputedStyle(node, "::picker-icon").backgroundImage : style.backgroundImage,
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        borderStyle: style.borderTopStyle,
        opacity: style.opacity,
        disabled: node.disabled,
        repeated: repeatedLabels(node),
        busy: [":hover", ":focus-visible", ":open", ":user-invalid", "[aria-invalid='true']"].some(matches),
        tokens: {
          ink: token(node, "--select-ink"),
          bg: token(node, "--select-bg"),
          icon: token(node, "--select-icon"),
          border: token(node, "--control-border"),
          disabledInk: token(node, "--ink-soft"),
          disabledBg: token(node, "--paper-3"),
        },
      };
    });
  probe.remove();
  return records;
});

// Findings for one screen, one line per offending select; an empty list means
// every select keeps the contract. Colours are reported by token name only,
// so the same failure in several themes reads as one line.
export const selectContractProblems = (records, { surface, phone }) => {
  const problems = [];
  for (const select of records) {
    const broken = [];
    if (!/(^|\s)ui-select(\s|$)/.test(select.className)) broken.push("not the shared .ui-select control");
    if (!["none", "base-select"].includes(select.appearance)) broken.push(`browser-drawn (appearance ${select.appearance})`);
    const strokes = select.chevron.split(select.tokens.icon || "--select-icon undefined").length - 1;
    if (!select.tokens.icon || strokes < 2) broken.push("no themed chevron in --select-icon");
    for (const label of select.repeated) broken.push(`lists “${label}” twice`);
    if (select.disabled) {
      if (select.opacity !== "1" || select.borderStyle !== "dashed" || select.color !== select.tokens.disabledInk || select.backgroundColor !== select.tokens.disabledBg) {
        broken.push(`no themed disabled look (opacity ${select.opacity}, ${select.borderStyle} edge)`);
      }
    } else if (!select.busy) {
      const offToken = [
        [select.color, select.tokens.ink, "text --select-ink"],
        [select.backgroundColor, select.tokens.bg, "fill --select-bg"],
        [select.borderColor, select.tokens.border, "edge --control-border"],
      ].filter(([actual, expected]) => !expected || actual !== expected).map(([, , name]) => name);
      if (offToken.length) broken.push(`colours off the theme tokens (${offToken.join(", ")})`);
    }
    if (phone) {
      if (select.height < 44) broken.push(`${select.height}px tall (needs 44px on a phone)`);
      if (select.fontSize < 16) broken.push(`${select.fontSize}px text, so iOS zooms on focus (needs 16px)`);
    } else {
      const expected = DESKTOP_VARIANTS[select.variant];
      if (select.height !== expected.height || select.radius !== expected.radius || select.fontSize !== expected.fontSize) {
        broken.push(`${select.height}px tall, ${select.radius}px radius, ${select.fontSize}px text (the ${select.variant} variant is ${expected.height}px, ${expected.radius}px, ${expected.fontSize}px)`);
      }
    }
    if (broken.length) problems.push(`${surface}: select “${select.name}”: ${broken.join("; ")}`);
  }
  return problems;
};

// The selected value's text (measured on a canvas in the select's font)
// against the room inside its padding. A value that fits never reaches the
// chevron, its fade or an ellipsis.
export const selectValueFit = (page, selector) => page.$$eval(selector, (selects) => {
  const canvas = document.createElement("canvas").getContext("2d");
  return selects.map((select) => {
    const style = getComputedStyle(select);
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = select.selectedOptions[0]?.textContent || "";
    const room = select.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    const needed = canvas.measureText(text).width;
    return { name: select.getAttribute("aria-label") || select.closest("label")?.firstChild?.textContent?.trim() || "unnamed", text, needed, room, fits: needed <= room + 0.5 };
  });
});

export const clippedValueProblems = (records) => records.filter((record) => !record.fits)
  .map((record) => `“${record.text}” needs ${Math.ceil(record.needed)}px of ${Math.floor(record.room)}px`);

// The customizable select sizes to its current value, so a toolbar select
// can change width after a pick and move what sits beside it. Tries every
// option (value set without events, then restored) and reports each select
// whose width depends on the value.
export const valueDependentWidths = (page, selector) => page.$$eval(selector, async (selects) => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const problems = [];
  for (const select of selects) {
    const original = select.value;
    const widths = new Map();
    for (const option of select.options) {
      select.value = option.value;
      await frame();
      const width = Math.round(select.getBoundingClientRect().width);
      if (![...widths.keys()].some((known) => Math.abs(known - width) <= 1)) widths.set(width, option.textContent.trim());
    }
    select.value = original;
    await frame();
    if (widths.size > 1) problems.push(`select “${select.getAttribute("aria-label") || select.closest("label")?.firstChild?.textContent?.trim() || "unnamed"}” is ${[...widths].map(([width, label]) => `${width}px on “${label}”`).join(", ")}`);
  }
  return problems;
});

// With the customizable select an overlong value is not ellipsized; it must
// fade out under the picker icon well before the chevron. Screenshots the
// select and counts the clear columns between the chevron's first stroke and
// the last visible pixel of the value, in the middle band of the control.
export const chevronClearance = async (page, selector) => {
  const handle = await page.$(selector);
  await handle.evaluate((node) => node.blur());
  const box = await handle.boundingBox();
  const fill = await handle.evaluate((node) => getComputedStyle(node).backgroundColor);
  const shot = await page.screenshot({ clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, encoding: "base64" });
  return page.evaluate(async (data, background) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data: pixels, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const [red, green, blue] = background.match(/[\d.]+/g).map(Number);
    const inked = (x) => {
      for (let y = Math.floor(height * 0.25); y < Math.ceil(height * 0.75); y += 1) {
        const index = (y * width + x) * 4;
        if (Math.max(Math.abs(pixels[index] - red), Math.abs(pixels[index + 1] - green), Math.abs(pixels[index + 2] - blue)) > 48) return true;
      }
      return false;
    };
    let x = width - 3;
    while (x > 0 && !inked(x)) x -= 1;
    const chevronEnd = x;
    while (x > 0 && inked(x)) x -= 1;
    const chevronStart = x + 1;
    let clear = 0;
    while (x > 0 && !inked(x)) { clear += 1; x -= 1; }
    return { clear, valueSeen: x > 0, chevron: [width - chevronEnd, width - chevronStart] };
  }, shot, fill);
};

// Flips the theme attribute the stylesheet keys on, lets the (reduced-motion)
// transitions finish, and measures; restores the starting theme afterwards.
export const measureSelectsInThemes = async (page, themes = SELECT_THEMES) => {
  // A resting pointer over a select marks it :hover, which skips its colours.
  await page.mouse.move(0, 0);
  const original = await page.evaluate(() => document.documentElement.dataset.theme || "");
  const byTheme = {};
  try {
    for (const theme of themes) {
      await page.evaluate((value) => new Promise((resolve) => {
        document.documentElement.dataset.theme = value;
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
      }), theme);
      byTheme[theme] = await measureSelects(page);
    }
  } finally {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, original);
  }
  return byTheme;
};
