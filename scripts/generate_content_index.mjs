import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { contentCapabilities } from "../src/lib/search.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const notesDirectory = join(root, "notes");
const outputDirectory = join(root, "src", "generated");

const stripMarkdown = (value) => value
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const listMarkdown = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listMarkdown(path) : (/\.md$/i.test(entry.name) ? [path] : []);
  }));
  return nested.flat();
};

const pathInfo = (id) => {
  const match = id.match(/^notes\/part-(\d+)-([^/]+)\/(.+)\.md$/);
  if (!match) return {
    id,
    path: id,
    partNumber: 0,
    partSlug: "guides",
    filename: id.split("/").at(-1),
    chapterNumber: id.includes("00-roadmap") ? 1 : 90,
    isIndex: id.endsWith("README.md"),
  };
  const filename = `${match[3]}.md`;
  return {
    id,
    path: id,
    partNumber: Number(match[1]),
    partSlug: match[2],
    filename,
    chapterNumber: filename === "README.md" ? 0 : Number(filename.match(/^(\d+)-/)?.[1] || 99),
    isIndex: filename === "README.md",
  };
};

const files = await listMarkdown(notesDirectory);
const records = await Promise.all(files.map(async (path) => {
  const id = relative(root, path).split(sep).join("/");
  const raw = await readFile(path, "utf8");
  const info = pathInfo(id);
  const title = raw.match(/^#\s+(.+)$/m)?.[1];
  const cleanTitle = title ? stripMarkdown(title) : info.filename.replace(/[-_]/g, " ");
  const paragraph = raw.replace(/^#\s+.+$/m, "").split(/\n\s*\n/).map(stripMarkdown).find((part) => part.length > 45 && !part.startsWith("flowchart"));
  const plain = stripMarkdown(raw);
  return {
    metadata: {
      ...info,
      title: cleanTitle,
      description: paragraph?.slice(0, 220) || "Detailed AI/ML learning notes and practical exercises.",
      minutes: Math.max(1, Math.ceil(plain.split(/\s+/).length / 210)),
      // Content-capability flags for has:code / has:formula search filters,
      // computed here because raw Markdown never ships to the client.
      ...contentCapabilities(raw),
      source: "builtin",
    },
    // Case-preserved so result snippets read naturally; every consumer
    // normalizes before matching.
    search: [id, plain],
  };
}));

records.sort((left, right) => (
  left.metadata.partNumber - right.metadata.partNumber
  || left.metadata.chapterNumber - right.metadata.chapterNumber
  || left.metadata.title.localeCompare(right.metadata.title)
));

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "content-index.json"), `${JSON.stringify(records.map((record) => record.metadata))}\n`),
  writeFile(join(outputDirectory, "content-search.json"), `${JSON.stringify(Object.fromEntries(records.map((record) => record.search)))}\n`),
]);

console.log(`Generated lazy metadata and search indexes for ${records.length} Markdown documents.`);
