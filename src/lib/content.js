import contentIndex from "../generated/content-index.json";
import { createId } from "./id.js";

const sourceLoaders = import.meta.glob("/notes/**/*.md", {
  query: "?raw",
  import: "default",
});
const sourceCache = new Map();
let searchIndexPromise;

const stripMarkdown = (value) => String(value || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const titleFromMarkdown = (raw, fallback) => {
  const match = String(raw || "").match(/^#\s+(.+)$/m);
  return match ? stripMarkdown(match[1]) : fallback;
};

const descriptionFromMarkdown = (raw) => {
  const withoutTitle = String(raw || "").replace(/^#\s+.+$/m, "");
  const paragraph = withoutTitle
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part))
    .find((part) => part.length > 45 && !part.startsWith("flowchart"));
  return paragraph?.slice(0, 220) || "Detailed AI/ML learning notes and practical exercises.";
};

const estimateMinutes = (raw) => Math.max(1, Math.ceil(stripMarkdown(raw).split(/\s+/).length / 210));

const partIndexes = new Map(
  contentIndex.filter((doc) => doc.partNumber > 0 && doc.isIndex).map((doc) => [doc.partNumber, doc]),
);

export const documents = contentIndex.map((doc) => ({
  ...doc,
  raw: "",
  searchText: `${doc.title} ${doc.description}`.toLocaleLowerCase(),
  partTitle: partIndexes.get(doc.partNumber)?.title || (doc.partNumber === 0 ? "Curriculum guides" : `Part ${doc.partNumber}`),
}));

export const documentMap = new Map(documents.map((doc) => [doc.id, doc]));

export const loadDocumentSource = async (id) => {
  if (sourceCache.has(id)) return sourceCache.get(id);
  const loader = sourceLoaders[`/${id}`];
  if (!loader) throw new Error("The lecture source is unavailable");
  const pending = loader().then((source) => String(source || "")).catch((error) => {
    sourceCache.delete(id);
    throw error;
  });
  sourceCache.set(id, pending);
  return pending;
};

export const loadDocumentSearchIndex = async () => {
  if (!searchIndexPromise) {
    searchIndexPromise = import("../generated/content-search.json")
      .then((module) => new Map(Object.entries(module.default || {})))
      .catch((error) => {
        searchIndexPromise = undefined;
        throw error;
      });
  }
  return searchIndexPromise;
};

export const parts = Array.from({ length: 23 }, (_, index) => {
  const number = index + 1;
  const docs = documents.filter((doc) => doc.partNumber === number);
  const indexDoc = docs.find((doc) => doc.isIndex);
  return {
    number,
    title: indexDoc?.title || `Part ${number}`,
    description: indexDoc?.description || "",
    minutes: docs.reduce((sum, doc) => sum + doc.minutes, 0),
    documents: docs,
    startId: indexDoc?.id || docs[0]?.id,
  };
});

export const guides = documents.filter((doc) => doc.partNumber === 0);

export { resolveDocumentLink } from "./links.js";

export const makeCustomDocument = ({ id, title, raw, createdAt = new Date().toISOString(), updatedAt = createdAt, tags = [], collectionId = "", archived = false, pinned = false }) => {
  const documentId = id || `custom/${createId()}.md`;
  return {
    id: documentId,
    path: documentId,
    title: title || titleFromMarkdown(raw, "Untitled note"),
    raw,
    description: descriptionFromMarkdown(raw),
    minutes: estimateMinutes(raw),
    searchText: `${title || ""} ${tags.join(" ")} ${stripMarkdown(raw)}`.toLocaleLowerCase(),
    source: "custom",
    partNumber: -1,
    partTitle: "My uploads",
    chapterNumber: 0,
    isIndex: false,
    createdAt,
    updatedAt,
    tags,
    collectionId,
    archived,
    pinned,
  };
};

export const plainTextFromMarkdown = stripMarkdown;
