import { htmlToMarkdown } from "./htmlImport.js";

/**
 * Dependency-free EPUB import (CONTENT-002, issue #12).
 *
 * An EPUB is a zip of XHTML chapters plus an OPF manifest that fixes the
 * reading order. This module parses the zip container directly — central
 * directory, then per-entry local headers — and inflates entries with the
 * platform's DecompressionStream, so no zip or EPUB library ships in the
 * bundle. Chapters flow through the existing `htmlToMarkdown` converter and
 * come back one markdown document per spine chapter, with an honest report
 * of everything the import skipped (the lossy-import contract HTML import
 * established). DRM'd books are refused, not half-imported; font-only
 * obfuscation (common in legitimate EPUBs) is tolerated because fonts are
 * dropped anyway.
 */
export const MAX_EPUB_CHAPTERS = 40;
/** A converted chapter above this is not study material — skip, report. */
const MAX_CHAPTER_MARKDOWN_BYTES = 2 * 1024 * 1024;
/** Below this, a "chapter" is a cover/blank page, not content. */
const MIN_CHAPTER_MARKDOWN_CHARS = 40;

export const isEpubFileName = (name) => /\.epub$/i.test(String(name || ""));

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Reads the zip central directory into entry records. The central directory
 * is authoritative for sizes — local headers may carry zeros when the writer
 * streamed with data descriptors.
 */
export const parseZipEntries = (bytes) => {
  if (bytes.length < 22) throw fail("EPUB_NOT_ZIP", "This file is not a zip archive.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 22 - 65_535);
  for (let cursor = bytes.length - 22; cursor >= floor; cursor -= 1) {
    if (view.getUint32(cursor, true) === EOCD_SIG) { eocd = cursor; break; }
  }
  if (eocd < 0) throw fail("EPUB_NOT_ZIP", "This file is not a zip archive (no end-of-directory record).");
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || centralOffset === 0xffffffff) {
    throw fail("EPUB_ZIP64_UNSUPPORTED", "This EPUB uses zip64, which is beyond the 2 MB import limit anyway.");
  }
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIG) {
      throw fail("EPUB_NOT_ZIP", "The zip central directory is corrupted.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { name, flags, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const inflateRaw = async (compressed) => {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Extracts one entry's bytes, honoring the central directory's sizes. */
export const readZipEntry = async (bytes, entry) => {
  if (entry.flags & 0x1) throw fail("EPUB_ENCRYPTED", "This EPUB entry is encrypted.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== LOCAL_SIG) {
    throw fail("EPUB_NOT_ZIP", "A zip local header is corrupted.");
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed);
  throw fail("EPUB_NOT_ZIP", `Unsupported zip compression method ${entry.method}.`);
};

const decodeXmlEntities = (value) => String(value || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&");

const attributesOf = (tag) => {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1].toLowerCase()] = match[2];
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*'([^']*)'/g)) attributes[match[1].toLowerCase()] ||= match[2];
  return attributes;
};

/** Resolves `href` against the OPF's directory, folding `.` and `..`. */
const resolvePath = (baseDir, href) => {
  const clean = decodeURIComponent(String(href || "").split("#")[0].split("?")[0]);
  const segments = [];
  for (const segment of `${baseDir}/${clean}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

const CHAPTER_TYPES = new Set(["application/xhtml+xml", "text/html", "application/html+xml"]);

/**
 * Converts EPUB bytes into ordered markdown chapters.
 *
 * Returns `{ bookTitle, chapters: [{ title, markdown, sourcePath }], report }`
 * where `report` counts everything that did not survive: non-chapter spine
 * items, empty/cover pages, oversized chapters, and a `truncated` flag past
 * MAX_EPUB_CHAPTERS. Throws typed errors (`error.code`) for whole-file
 * problems: EPUB_NOT_ZIP, EPUB_NO_CONTAINER, EPUB_NO_OPF, EPUB_ENCRYPTED,
 * EPUB_ZIP64_UNSUPPORTED, EPUB_NO_CHAPTERS.
 */
export const importEpub = async (input, { maxChapters = MAX_EPUB_CHAPTERS } = {}) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = parseZipEntries(bytes);
  const decoder = new TextDecoder("utf-8");

  const readText = async (path) => {
    const entry = entries.get(path);
    return entry ? decoder.decode(await readZipEntry(bytes, entry)) : "";
  };

  // DRM refusal: encryption.xml naming any (x)html resource means readable
  // content is locked. Font obfuscation alone passes — fonts are dropped.
  const encryptionEntry = entries.get("META-INF/encryption.xml");
  if (encryptionEntry) {
    const encryptionXml = await readZipEntry(bytes, encryptionEntry).then((data) => decoder.decode(data)).catch(() => "");
    if (/uri\s*=\s*"[^"]*\.x?html?["#?]/i.test(encryptionXml)) {
      throw fail("EPUB_ENCRYPTED", "This EPUB is DRM-protected; its chapters cannot be imported.");
    }
  }

  const container = await readText("META-INF/container.xml");
  const opfPath = container.match(/full-path\s*=\s*"([^"]+)"/)?.[1] || container.match(/full-path\s*=\s*'([^']+)'/)?.[1];
  if (!opfPath) throw fail("EPUB_NO_CONTAINER", "This EPUB has no container.xml — it is not a valid book.");
  const opf = await readText(opfPath);
  if (!opf) throw fail("EPUB_NO_OPF", "This EPUB's package manifest is missing.");
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const bookTitle = decodeXmlEntities((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || "").trim()).slice(0, 180);
  const manifest = new Map();
  for (const tag of opf.matchAll(/<item\b[^>]*\/?>/gi)) {
    const attributes = attributesOf(tag[0]);
    if (attributes.id && attributes.href) manifest.set(attributes.id, attributes);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\/?>/gi)].map((tag) => attributesOf(tag[0]));

  const report = { spineCount: spine.length, imported: 0, skipped: 0, skippedReasons: [], truncated: false };
  const skip = (reason) => {
    report.skipped += 1;
    if (!report.skippedReasons.includes(reason)) report.skippedReasons.push(reason);
  };
  const chapters = [];
  for (const itemref of spine) {
    const item = manifest.get(itemref.idref || "");
    if (!item) { skip("unresolved spine entry"); continue; }
    if (itemref.linear === "no") { skip("non-linear section"); continue; }
    if (!CHAPTER_TYPES.has((item["media-type"] || "").toLowerCase())) { skip("non-text section"); continue; }
    if (chapters.length >= maxChapters) { report.truncated = true; skip(`over the ${maxChapters}-chapter limit`); continue; }
    const path = resolvePath(baseDir, item.href);
    const entry = entries.get(path);
    if (!entry) { skip("missing chapter file"); continue; }
    let converted;
    try {
      converted = htmlToMarkdown(decoder.decode(await readZipEntry(bytes, entry)));
    } catch (error) {
      if (error?.code === "EPUB_ENCRYPTED") { skip("encrypted chapter"); continue; }
      throw error;
    }
    const markdown = converted.markdown.trim();
    if (markdown.length < MIN_CHAPTER_MARKDOWN_CHARS) { skip("empty or cover page"); continue; }
    if (new TextEncoder().encode(markdown).byteLength > MAX_CHAPTER_MARKDOWN_BYTES) { skip("oversized chapter"); continue; }
    const title = (converted.title || markdown.match(/^#{1,6}\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, "").trim() || `Chapter ${chapters.length + 1}`).slice(0, 120);
    chapters.push({ title, markdown, sourcePath: path });
    report.imported += 1;
  }
  if (!chapters.length) throw fail("EPUB_NO_CHAPTERS", "No readable chapters were found in this EPUB.");
  return { bookTitle: bookTitle || chapters[0].title, chapters, report };
};

/** One-line human summary of an import for the upload notification. */
export const describeEpubReport = (fileName, result) => {
  const parts = [`${result.report.imported} chapter${result.report.imported === 1 ? "" : "s"}`];
  if (result.report.skipped) parts.push(`${result.report.skipped} item${result.report.skipped === 1 ? "" : "s"} skipped (${result.report.skippedReasons.join(", ")})`);
  return `“${result.bookTitle || fileName}”: ${parts.join(", ")}`;
};
