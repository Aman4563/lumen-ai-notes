const MERMAID_LANGUAGE_ALIASES = new Set(["mermaid", "mermaid-js", "mmd"]);
const MERMAID_TYPED_FENCES = new Set(["diagram", "flowchart"]);
const MERMAID_HEADER_PATTERN = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|^(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|architecture-beta)\b/u;
const FLOWCHART_DIRECTION_PATTERN = /^(?:TB|TD|BT|RL|LR)\b/u;
const MAX_DIAGRAMS_PER_SURFACE = 16;
const MAX_DEFINITION_CHARACTERS = 30_000;
const SAFE_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
const sourceByNode = new WeakMap();
let mermaidImportPromise = null;
let renderQueue = Promise.resolve();
let renderSequence = 0;
let themeObserver = null;
let themeMediaQuery = null;
let observedTheme = null;
const themeSubscribers = new Set();

const normalizeLineEndings = (value) => String(value ?? "").replace(/\r\n?/g, "\n");

const firstDiagramLine = (definition) => {
  const lines = normalizeLineEndings(definition).split("\n");
  let inFrontmatter = false;
  let frontmatterSeen = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!frontmatterSeen && trimmed === "---") {
      inFrontmatter = true;
      frontmatterSeen = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (trimmed.startsWith("%%")) continue;
    return trimmed;
  }
  return "";
};

/**
 * Returns a normalized Mermaid definition when a fenced Markdown block is
 * explicitly Mermaid-compatible. Ambiguous `diagram`/`flowchart` aliases are
 * accepted only when their content has a Mermaid header, so ordinary code is
 * never silently executed as a diagram.
 */
export const mermaidDefinitionForFence = (language, source) => {
  const normalizedLanguage = String(language || "").trim().toLocaleLowerCase().split(/[\s,{]/u, 1)[0];
  let definition = normalizeLineEndings(source).trim();
  if (!definition) return "";
  if (normalizedLanguage === "flowchart" && FLOWCHART_DIRECTION_PATTERN.test(firstDiagramLine(definition))) {
    definition = `flowchart ${definition}`;
  }
  if (MERMAID_LANGUAGE_ALIASES.has(normalizedLanguage)) return definition;
  if (MERMAID_TYPED_FENCES.has(normalizedLanguage) && MERMAID_HEADER_PATTERN.test(firstDiagramLine(definition))) return definition;
  return "";
};

export const mermaidErrorLocation = (error) => {
  const location = error?.hash?.loc || error?.loc || error?.location;
  const lineCandidate = location?.first_line ?? location?.line ?? error?.line;
  const columnCandidate = location?.first_column ?? location?.column ?? error?.column;
  const message = String(error?.message || "");
  const lineFromMessage = message.match(/\bline\s+(\d+)\b/iu)?.[1];
  const line = Number(lineCandidate ?? lineFromMessage);
  const column = Number(columnCandidate);
  return {
    line: Number.isSafeInteger(line) && line > 0 ? line : null,
    column: Number.isSafeInteger(column) && column >= 0 ? column + (location?.first_column !== undefined ? 1 : 0) : null,
  };
};

const currentMermaidTheme = () => {
  if (typeof document === "undefined") return "neutral";
  const scheme = globalThis.getComputedStyle?.(document.documentElement)?.colorScheme || document.documentElement.style.colorScheme || "";
  return /\bdark\b/iu.test(scheme) ? "dark" : "neutral";
};

const notifyThemeSubscribers = () => {
  const nextTheme = currentMermaidTheme();
  // Dialog scroll locks also change root.style. Rebuilding every diagram for
  // those changes clears visible SVGs and can interrupt an active theme render.
  if (nextTheme === observedTheme) return;
  observedTheme = nextTheme;
  themeSubscribers.forEach((listener) => listener());
};

/** One document-level observer serves every rendered answer and reader view. */
export const subscribeToMermaidTheme = (listener) => {
  if (typeof listener !== "function" || typeof document === "undefined") return () => {};
  themeSubscribers.add(listener);
  if (!themeObserver) {
    observedTheme = currentMermaidTheme();
    themeObserver = new MutationObserver(notifyThemeSubscribers);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    themeMediaQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)") || null;
    themeMediaQuery?.addEventListener?.("change", notifyThemeSubscribers);
  }
  return () => {
    themeSubscribers.delete(listener);
    if (themeSubscribers.size) return;
    themeObserver?.disconnect();
    themeObserver = null;
    themeMediaQuery?.removeEventListener?.("change", notifyThemeSubscribers);
    themeMediaQuery = null;
    observedTheme = null;
  };
};

const loadMermaid = async () => {
  if (!mermaidImportPromise) {
    mermaidImportPromise = import("mermaid")
      .then((module) => module.default || module)
      .catch((error) => {
        // A stale/offline chunk must be retryable after the learner reloads or
        // connectivity returns; never permanently cache a rejected import.
        mermaidImportPromise = null;
        throw error;
      });
  }
  return mermaidImportPromise;
};

const enqueueRender = (operation) => {
  const result = renderQueue.then(operation, operation);
  renderQueue = result.catch(() => {});
  return result;
};

const makeRenderId = () => {
  renderSequence = (renderSequence + 1) % Number.MAX_SAFE_INTEGER;
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || Math.random().toString(36).slice(2);
  return `lumen-diagram-${renderSequence}-${random}`;
};

const abortRequested = (signal) => signal?.aborted === true;

const safeSvgElement = (svgText) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(String(svgText || ""), "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") return null;
  parsed.querySelectorAll("script, foreignObject, iframe, object, embed, link, meta, audio, video, canvas").forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLocaleLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !attribute.value.trim().startsWith("#")) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return document.importNode(parsed.documentElement, true);
};

const diagramSource = (node) => {
  if (sourceByNode.has(node)) return sourceByNode.get(node);
  const source = normalizeLineEndings(node.textContent).trim();
  sourceByNode.set(node, source);
  return source;
};

const clearDiagramState = (node) => {
  const shell = node.closest(".diagram-shell");
  shell?.classList.remove("diagram-failed");
  if (shell) shell.dataset.diagramStatus = "rendering";
  node.dataset.diagramStatus = "rendering";
  node.dataset.rendering = "true";
  delete node.dataset.processed;
  node.setAttribute("aria-busy", "true");
  node.setAttribute("aria-label", "Rendering Mermaid diagram");
};

const showDiagramFailure = (node, definition, error, kind = "syntax") => {
  if (!node?.isConnected) return;
  const shell = node.closest(".diagram-shell");
  const { line, column } = mermaidErrorLocation(error);
  const diagnostic = document.createElement("div");
  diagnostic.className = "diagram-diagnostic";
  diagnostic.setAttribute("role", "alert");

  const title = document.createElement("strong");
  title.textContent = kind === "load" ? "Diagram renderer unavailable" : kind === "limit" ? "Diagram is too large to render safely" : "Diagram syntax needs attention";
  const explanation = document.createElement("p");
  const location = line ? ` near line ${line}${column ? `, column ${column}` : ""}` : "";
  explanation.textContent = kind === "load"
    ? "The Mermaid module could not be loaded. Reload after reconnecting; the original source remains available below."
    : kind === "limit"
      ? `This diagram exceeds Lumen's ${MAX_DEFINITION_CHARACTERS.toLocaleString()}-character rendering limit. Split it into smaller diagrams.`
      : `Mermaid could not parse or draw this definition${location}. Check the diagram type, arrows, quotes, brackets, and subgraph boundaries.`;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Show Mermaid source";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = definition.slice(0, MAX_DEFINITION_CHARACTERS);
  pre.append(code);
  details.append(summary, pre);
  const actions = document.createElement("div");
  actions.className = "diagram-diagnostic-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button secondary";
  retry.dataset.diagramAction = "retry";
  retry.textContent = "Retry diagram";
  retry.addEventListener("click", () => {
    if (!node.isConnected) return;
    node.textContent = definition;
    void renderMermaidDiagrams(shell || node.parentElement || node);
  });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button secondary";
  copy.dataset.diagramAction = "copy";
  copy.textContent = "Copy source";
  const copyStatus = document.createElement("span");
  copyStatus.setAttribute("role", "status");
  copyStatus.setAttribute("aria-live", "polite");
  copy.addEventListener("click", async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(definition);
        copied = true;
      } else {
        const field = document.createElement("textarea");
        field.value = definition;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        copied = document.execCommand("copy");
        field.remove();
      }
    } catch {
      copied = false;
    }
    copy.textContent = copied ? "Copied" : "Copy failed";
    copyStatus.textContent = copied ? "Mermaid source copied." : "Copy failed. Expand the source and copy it manually.";
    globalThis.setTimeout?.(() => {
      if (copy.isConnected) copy.textContent = "Copy source";
    }, 1_500);
  });
  actions.append(retry, copy, copyStatus);
  diagnostic.append(title, explanation, actions, details);
  node.replaceChildren(diagnostic);
  node.dataset.diagramStatus = "error";
  delete node.dataset.rendering;
  delete node.dataset.processed;
  node.removeAttribute("aria-busy");
  node.setAttribute("aria-label", title.textContent);
  if (shell) {
    shell.classList.remove("diagram-failed");
    shell.dataset.diagramStatus = "error";
  }
};

const showRenderedDiagram = (node, svgText) => {
  if (!node?.isConnected) return false;
  const svg = safeSvgElement(svgText);
  if (!svg) return false;
  node.replaceChildren(svg);
  node.dataset.diagramRenderCount = String((Number(node.dataset.diagramRenderCount) || 0) + 1);
  node.dataset.diagramStatus = "rendered";
  node.dataset.processed = "true";
  delete node.dataset.rendering;
  node.removeAttribute("aria-busy");
  node.setAttribute("aria-label", "Rendered Mermaid diagram");
  const shell = node.closest(".diagram-shell");
  shell?.classList.remove("diagram-failed");
  if (shell) shell.dataset.diagramStatus = "rendered";
  return true;
};

/**
 * Lazily and serially renders every Mermaid block in one Markdown surface.
 * Mermaid configuration is global, so serialization prevents two surfaces or
 * themes from racing each other's initialization. Aborted/stale renders never
 * write into a replaced React subtree.
 */
export const renderMermaidDiagrams = (root, {
  signal,
  theme,
  importer = loadMermaid,
} = {}) => {
  if (!root?.querySelectorAll || abortRequested(signal)) return Promise.resolve({ rendered: 0, failed: 0, skipped: 0 });
  const nodes = [...root.querySelectorAll(".diagram-shell > .mermaid")].slice(0, MAX_DIAGRAMS_PER_SURFACE);
  if (!nodes.length) return Promise.resolve({ rendered: 0, failed: 0, skipped: 0 });
  nodes.forEach(clearDiagramState);
  return enqueueRender(async () => {
    if (abortRequested(signal)) return { rendered: 0, failed: 0, skipped: nodes.length };
    let mermaid;
    try {
      mermaid = await importer();
    } catch (error) {
      if (!abortRequested(signal)) nodes.forEach((node) => showDiagramFailure(node, diagramSource(node), error, "load"));
      return { rendered: 0, failed: abortRequested(signal) ? 0 : nodes.length, skipped: abortRequested(signal) ? nodes.length : 0 };
    }
    if (abortRequested(signal)) return { rendered: 0, failed: 0, skipped: nodes.length };

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: theme || currentMermaidTheme(),
      fontFamily: SAFE_FONT_FAMILY,
      htmlLabels: false,
      maxTextSize: MAX_DEFINITION_CHARACTERS,
      maxEdges: 300,
      logLevel: "fatal",
      flowchart: { htmlLabels: false, useMaxWidth: true },
      sequence: { useMaxWidth: true },
    });

    let rendered = 0;
    let failed = 0;
    let skipped = 0;
    for (const node of nodes) {
      if (abortRequested(signal) || !root.isConnected || !node.isConnected) {
        skipped += 1;
        continue;
      }
      const definition = diagramSource(node);
      if (!definition || definition.length > MAX_DEFINITION_CHARACTERS) {
        showDiagramFailure(node, definition, null, "limit");
        failed += 1;
        continue;
      }
      // Restore the original definition before each render. This is essential
      // after a theme change: textContent of the existing SVG is not Mermaid.
      node.textContent = definition;
      try {
        const { svg } = await mermaid.render(makeRenderId(), definition);
        if (abortRequested(signal) || !root.isConnected || !node.isConnected) {
          skipped += 1;
          continue;
        }
        if (!showRenderedDiagram(node, svg)) throw new Error("Mermaid returned invalid SVG");
        rendered += 1;
      } catch (error) {
        if (abortRequested(signal) || !root.isConnected || !node.isConnected) {
          skipped += 1;
          continue;
        }
        showDiagramFailure(node, definition, error);
        failed += 1;
      }
    }
    return { rendered, failed, skipped };
  });
};

export const MERMAID_RENDER_LIMITS = Object.freeze({
  diagramsPerSurface: MAX_DIAGRAMS_PER_SURFACE,
  definitionCharacters: MAX_DEFINITION_CHARACTERS,
});
