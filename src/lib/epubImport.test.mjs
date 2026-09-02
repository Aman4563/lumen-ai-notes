import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";

import { describeEpubReport, importEpub, isEpubFileName, parseZipEntries } from "./epubImport.js";

/**
 * Minimal zip writer: local headers + central directory + EOCD, deflate-raw
 * or stored. CRCs are zero — the importer never checks them, and neither
 * does DecompressionStream("deflate-raw").
 */
const makeZip = (files, { store = new Set() } = {}) => {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf-8");
    const raw = Buffer.from(content, "utf-8");
    const method = store.has(name) ? 0 : 8;
    const data = method === 0 ? raw : zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, eocd]);
};

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Deep Learning Field Notes &amp; Tricks</dc:title>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="sub/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="ch2"/>
    <itemref idref="ghost"/>
    <itemref idref="css"/>
    <itemref idref="ch1"/>
  </spine>
</package>`;

const bookFiles = () => [
  ["mimetype", "application/epub+zip"],
  ["META-INF/container.xml", '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
  ["OEBPS/content.opf", OPF],
  ["OEBPS/cover.xhtml", "<html><body><img src=\"cover.jpg\" alt=\"\"/></body></html>"],
  ["OEBPS/chapter1.xhtml", "<html><head><title>Gradient Descent</title></head><body><h1>Gradient Descent</h1><p>Take steps <strong>downhill</strong> along the negative gradient until the loss stops improving on validation data.</p></body></html>"],
  ["OEBPS/sub/chapter2.xhtml", "<html><head><title>Backpropagation</title></head><body><h1>Backpropagation</h1><p>The chain rule, applied backward through the graph; see <a href=\"../chapter1.xhtml\">the previous chapter</a> for the update step.</p><pre><code class=\"language-python\">grad = tape.gradient(loss, weights)</code></pre></body></html>"],
  ["OEBPS/styles.css", "body { margin: 0 }"],
];

test("a real book imports in spine order with an honest lossy report", async () => {
  const zip = makeZip(bookFiles(), { store: new Set(["mimetype", "META-INF/container.xml"]) });
  const book = await importEpub(zip);
  assert.equal(book.bookTitle, "Deep Learning Field Notes & Tricks");
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ["Backpropagation", "Gradient Descent"], "order follows the spine, not the manifest");
  assert.match(book.chapters[0].markdown, /```python\ngrad = tape\.gradient/);
  assert.match(book.chapters[0].markdown, /\[the previous chapter\]\(\.\.\/chapter1\.xhtml\)/, "relative links survive");
  assert.match(book.chapters[1].markdown, /\*\*downhill\*\*/);
  assert.deepEqual(book.report, {
    spineCount: 5,
    imported: 2,
    skipped: 3,
    skippedReasons: ["empty or cover page", "unresolved spine entry", "non-text section"],
    truncated: false,
  });
  assert.match(describeEpubReport("x.epub", book), /2 chapters, 3 items skipped/);
});

test("stored and deflated entries both extract; parser reads the central directory", async () => {
  const zip = makeZip(bookFiles(), { store: new Set(["mimetype", "META-INF/container.xml"]) });
  const entries = parseZipEntries(new Uint8Array(zip));
  assert.equal(entries.get("mimetype").method, 0);
  assert.equal(entries.get("OEBPS/chapter1.xhtml").method, 8);
  assert.equal(entries.size, 7);
});

test("the chapter cap truncates with a report instead of importing a whole library", async () => {
  const zip = makeZip(bookFiles(), { store: new Set(["mimetype"]) });
  const book = await importEpub(zip, { maxChapters: 1 });
  assert.equal(book.chapters.length, 1);
  assert.equal(book.report.truncated, true);
  assert.ok(book.report.skippedReasons.some((reason) => reason.includes("1-chapter limit")));
});

test("DRM refuses whole; font-only obfuscation passes", async () => {
  const drm = makeZip([...bookFiles(), ["META-INF/encryption.xml", '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/chapter1.xhtml"/></CipherData></EncryptedData></encryption>']]);
  await assert.rejects(importEpub(drm), (error) => error.code === "EPUB_ENCRYPTED");
  const fonts = makeZip([...bookFiles(), ["META-INF/encryption.xml", '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/fonts/serif.otf"/></CipherData></EncryptedData></encryption>']]);
  const book = await importEpub(fonts);
  assert.equal(book.report.imported, 2);
});

test("non-books fail typed, never half-import", async () => {
  await assert.rejects(importEpub(Buffer.from("just some text, not a zip")), (error) => error.code === "EPUB_NOT_ZIP");
  const zip = makeZip(bookFiles());
  const eocdOffset = zip.length - 22;
  const corrupted = Buffer.from(zip);
  corrupted.writeUInt32LE(zip.length - 5, eocdOffset + 16);
  await assert.rejects(importEpub(corrupted), (error) => error.code === "EPUB_NOT_ZIP");
  const noContainer = makeZip([["mimetype", "application/epub+zip"], ["OEBPS/a.xhtml", "<p>hello</p>"]]);
  await assert.rejects(importEpub(noContainer), (error) => error.code === "EPUB_NO_CONTAINER");
  const emptyBook = makeZip([
    ["META-INF/container.xml", '<container><rootfile full-path="book.opf"/></container>'],
    ["book.opf", '<package><manifest><item id="c" href="c.css" media-type="text/css"/></manifest><spine><itemref idref="c"/></spine></package>'],
  ]);
  await assert.rejects(importEpub(emptyBook), (error) => error.code === "EPUB_NO_CHAPTERS");
});

test("file-name detection is exact", () => {
  assert.equal(isEpubFileName("book.EPUB"), true);
  assert.equal(isEpubFileName("book.epub.md"), false);
  assert.equal(isEpubFileName("notes.md"), false);
});
