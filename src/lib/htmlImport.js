/**
 * Dependency-free HTML → Markdown import (CONTENT-002, issue #12).
 *
 * Hand-rolled tokenizer rather than DOMParser because the unit gates run in
 * plain Node. Dangerous subtrees (script/style/head/noscript/template/
 * iframe/object/embed/svg) and comments are dropped whole; an allowlist of
 * structural tags converts to GFM; everything else unwraps to its text.
 * javascript:/data:/vbscript: links unwrap to plain text; data: images drop
 * (byte budget) keeping their alt text. Rendering stays safe regardless —
 * the app sanitizes at render — this conversion is about producing clean,
 * study-friendly Markdown.
 */
const DROP_SUBTREES = new Set(["script", "style", "head", "noscript", "template", "iframe", "object", "embed", "svg"]);
const SAFE_HREF = /^(https?:|mailto:)/i;
const SAFE_SRC = /^https?:/i;

const decodeEntities = (value) => String(value || "")
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  })
  .replace(/&#(\d+);/g, (_match, decimal) => {
    const code = Number(decimal);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  })
  .replaceAll("&nbsp;", " ")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&amp;", "&");

/** Escapes characters that would change meaning at the start of a line. */
const escapeTextRun = (value) => value
  .replace(/^([#>\-*+])/gm, "\\$1")
  .replace(/\|/g, "\\|");

const tokenize = (html) => {
  const tokens = [];
  const source = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) tokens.push({ type: "text", text: source.slice(cursor, match.index) });
    tokens.push({
      type: match[0][1] === "/" ? "close" : "open",
      tag: match[1].toLowerCase(),
      attributes: match[2] || "",
      selfClosing: match[3] === "/",
    });
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) tokens.push({ type: "text", text: source.slice(cursor) });
  return tokens;
};

const attribute = (attributes, name) => {
  const match = String(attributes || "").match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return match ? decodeEntities(match[2] ?? match[3] ?? match[4] ?? "") : "";
};

export const htmlToMarkdown = (html) => {
  const tokens = tokenize(html);
  const out = [];
  let drop = 0;
  let pre = false;
  let preLangSlot = -1;
  const listStack = [];
  let title = "";
  let inTitle = false;
  const linkStack = [];
  let tableRow = null;
  let tableRows = null;
  let tableBailed = false;

  const push = (text) => out.push(text);
  const newline = () => {
    while (out.length && out.at(-1) === "\n\n") out.pop();
    out.push("\n\n");
  };

  for (const token of tokens) {
    if (token.type === "text") {
      if (inTitle) {
        title += decodeEntities(token.text);
        continue;
      }
      if (drop) continue;
      const decoded = decodeEntities(token.text);
      if (pre) {
        push(decoded);
      } else if (tableRow) {
        tableRow[tableRow.length - 1] += decoded.replace(/\s+/g, " ");
      } else if (decoded.trim() || decoded.includes(" ")) {
        push(escapeTextRun(decoded.replace(/\s+/g, " ")));
      }
      continue;
    }

    const { tag } = token;
    // <title> usually sits inside the dropped <head>; capture it anyway so
    // the document keeps its declared name.
    if (tag === "title") {
      inTitle = token.type === "open";
      continue;
    }
    if (DROP_SUBTREES.has(tag)) {
      if (!token.selfClosing) drop += token.type === "open" ? 1 : (drop > 0 ? -1 : 0);
      continue;
    }
    if (drop) continue;

    if (token.type === "open") {
      if (/^h[1-6]$/.test(tag)) { newline(); push(`${"#".repeat(Number(tag[1]))} `); }
      else if (tag === "p" || tag === "div" || tag === "section" || tag === "article") newline();
      else if (tag === "br") push("\n");
      else if (tag === "hr") { newline(); push("---"); newline(); }
      else if (tag === "ul" || tag === "ol") { if (!listStack.length) newline(); listStack.push({ ordered: tag === "ol", index: 0 }); }
      else if (tag === "li") {
        const list = listStack.at(-1) || { ordered: false, index: 0 };
        list.index += 1;
        push(`\n${"  ".repeat(Math.max(0, listStack.length - 1))}${list.ordered ? `${list.index}.` : "-"} `);
      } else if (tag === "blockquote") { newline(); push("> "); }
      else if (tag === "strong" || tag === "b") push("**");
      else if (tag === "em" || tag === "i") push("*");
      else if (tag === "code" && !pre) push("`");
      else if (tag === "pre") {
        pre = true;
        newline();
        push("```");
        preLangSlot = out.length;
        push("");
        push("\n");
      } else if (tag === "a") {
        const href = attribute(token.attributes, "href");
        // Keep absolute http(s)/mailto and scheme-less relative links (the
        // internal .md links the Reader and link audit care about); unwrap
        // javascript:/data:/vbscript:/etc. to plain text.
        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
        if (href && (!hasScheme || SAFE_HREF.test(href))) { linkStack.push(href); push("["); }
        else linkStack.push(null);
      } else if (tag === "img") {
        const src = attribute(token.attributes, "src");
        const alt = attribute(token.attributes, "alt");
        if (SAFE_SRC.test(src)) push(`![${alt.replace(/[\[\]]/g, "")}](${src})`);
        else if (alt) push(escapeTextRun(alt));
      } else if (tag === "table") { newline(); tableRows = []; tableBailed = false; }
      else if (tag === "tr" && tableRows) tableRow = [];
      else if ((tag === "td" || tag === "th") && tableRow) {
        if (/(colspan|rowspan)\s*=/i.test(token.attributes)) tableBailed = true;
        tableRow.push("");
      }
      if (pre && tag === "code" && preLangSlot >= 0) {
        const className = attribute(token.attributes, "class");
        const language = className.match(/language-([\w-]+)/);
        if (language) out[preLangSlot] = language[1];
      }
      continue;
    }

    // close tags
    if (/^h[1-6]$/.test(tag)) {
      if (tag === "h1" && !title) {
        for (let index = out.length - 1; index >= 0; index -= 1) {
          if (out[index].startsWith("# ")) break;
          if (!out[index].includes("\n")) { title = title ? title : out[index]; break; }
        }
      }
      newline();
    } else if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "blockquote") newline();
    else if (tag === "ul" || tag === "ol") { listStack.pop(); if (!listStack.length) newline(); }
    else if (tag === "strong" || tag === "b") push("**");
    else if (tag === "em" || tag === "i") push("*");
    else if (tag === "code" && !pre) push("`");
    else if (tag === "pre") { pre = false; preLangSlot = -1; push("\n```"); newline(); }
    else if (tag === "a") {
      const href = linkStack.pop();
      if (href) push(`](${href})`);
    } else if (tag === "tr" && tableRows && tableRow) { tableRows.push(tableRow); tableRow = null; }
    else if (tag === "table" && tableRows) {
      if (tableBailed || !tableRows.length) {
        push(tableRows.flat().map((cell) => cell.trim()).filter(Boolean).join(" · "));
      } else {
        const width = Math.max(...tableRows.map((row) => row.length));
        const rows = tableRows.map((row) => [...row, ...Array(width - row.length).fill("")]);
        const line = (row) => `| ${row.map((cell) => cell.trim()).join(" | ")} |`;
        push([line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
      }
      tableRows = null;
      newline();
    }
  }

  let markdown = out.join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cleanTitle = title.replace(/\s+/g, " ").trim().slice(0, 180);
  if (cleanTitle && !markdown.startsWith("# ")) markdown = `# ${cleanTitle}\n\n${markdown}`;
  return { markdown, title: cleanTitle };
};

export const isHtmlFileName = (name) => /\.html?$/i.test(String(name || ""));
