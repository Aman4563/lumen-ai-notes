import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  LIBRARY_RETRIEVAL_LIMITS,
  retrieveLibrary,
  tokenizeLibraryQuery,
} from "./libraryRetrieval.js";

const contentIndexUrl = new URL("../generated/content-index.json", import.meta.url);
const contentSearchUrl = new URL("../generated/content-search.json", import.meta.url);
const rootUrl = new URL("../../", import.meta.url);

const loadGeneratedCorpus = async () => {
  const [documents, searchIndex] = await Promise.all([
    readFile(contentIndexUrl, "utf8").then(JSON.parse),
    readFile(contentSearchUrl, "utf8").then(JSON.parse),
  ]);
  return { documents, searchIndex };
};

const loadNote = (id) => readFile(new URL(id, rootUrl), "utf8");
const utf8Bytes = (value) => new TextEncoder().encode(value).byteLength;

test("query tokenization removes conversational noise but preserves technical terms", () => {
  assert.deepEqual(tokenizeLibraryQuery("How does PPO clipping work?").terms, ["ppo", "clipping"]);
  assert.deepEqual(tokenizeLibraryQuery('Compare "policy gradient" with C++ and C#').terms, ["policy", "gradient", "compare", "c++", "c#"]);
  assert.deepEqual(tokenizeLibraryQuery("Why does θ change?").terms, ["θ", "change"]);
});

test("all built-in documents are searched while only bounded candidates are loaded", async () => {
  const { documents, searchIndex } = await loadGeneratedCorpus();
  assert.equal(documents.length, 143, "the checked-in curriculum size changed; review retrieval scale and this expectation");
  assert.equal(Object.keys(searchIndex).length, documents.length);
  let loadCount = 0;
  const startedAt = performance.now();
  const result = await retrieveLibrary("How does the PPO clipped surrogate objective limit policy updates?", {
    documents,
    searchIndex,
    loadSource: async (id) => {
      loadCount += 1;
      return loadNote(id);
    },
  });
  const duration = performance.now() - startedAt;

  assert.equal(result.trace.corpus.documentsScanned, 143);
  assert.equal(result.trace.corpus.builtInDocuments, 143);
  assert.ok(loadCount > 0 && loadCount <= LIBRARY_RETRIEVAL_LIMITS.candidateDocuments);
  assert.equal(result.trace.selection.loadedDocuments, loadCount);
  assert.match(result.passages[0].documentId, /policy-gradients-actor-critic-ppo/);
  assert.match(result.passages[0].anchor, /ppo-clipped-surrogate/);
  assert.equal(result.trace.confidence.level, "high");
  assert.equal(result.trace.webFallback.recommended, false);
  assert.ok(duration < 1_500, `full 143-document retrieval took ${duration.toFixed(1)} ms`);

  const repeated = await retrieveLibrary("How does the PPO clipped surrogate objective limit policy updates?", {
    documents,
    searchIndex: new Map(Object.entries(searchIndex)),
    loadSource: loadNote,
  });
  assert.deepEqual(
    repeated.passages.map(({ id, documentId, anchor }) => ({ id, documentId, anchor })),
    result.passages.map(({ id, documentId, anchor }) => ({ id, documentId, anchor })),
    "provenance identifiers and anchors must be stable across retrievals",
  );
});

test("lazy built-in raw placeholders load the selected Markdown instead of becoming empty sources", async () => {
  const { documents, searchIndex } = await loadGeneratedCorpus();
  const lazyDocuments = documents.map((document) => ({ ...document, raw: "" }));
  let loadCount = 0;
  const result = await retrieveLibrary("Double DQN overestimation bias", {
    documents: lazyDocuments,
    searchIndex,
    loadSource: async (id) => {
      loadCount += 1;
      return loadNote(id);
    },
    maxPassages: 4,
    maxBytes: 8_000,
  });

  assert.ok(loadCount > 0 && loadCount <= LIBRARY_RETRIEVAL_LIMITS.candidateDocuments);
  assert.ok(result.passages.length > 0);
  assert.match(result.passages[0].documentId, /value-learning-and-dqn/);
  assert.match(result.passages[0].text, /Double DQN|overestimation/i);
});

test("worst-case custom-library scale remains local, fast, and bounded", async () => {
  const { documents: builtIns, searchIndex } = await loadGeneratedCorpus();
  const customDocuments = Array.from({ length: 500 }, (_, index) => ({
    id: `custom/scale-${index}.md`,
    title: `Personal systems note ${index}`,
    source: "custom",
    partTitle: "My uploads",
    tags: ["private", `topic-${index}`],
    raw: `# Personal systems note ${index}\n\nA private observation about service ownership and reliability. ${index === 417 ? "Quasarvector rendezvous preserves the amber checkpoint invariant." : "Routine study material."}`,
    updatedAt: "2026-08-31T00:00:00.000Z",
  }));
  const startedAt = performance.now();
  let builtInLoads = 0;
  const result = await retrieveLibrary("quasarvector rendezvous amber checkpoint invariant", {
    documents: [...builtIns, ...customDocuments],
    searchIndex,
    loadSource: async (id) => {
      builtInLoads += 1;
      return loadNote(id);
    },
    maxBytes: 8_000,
  });
  const duration = performance.now() - startedAt;

  assert.equal(result.trace.corpus.documentsScanned, 643);
  assert.equal(result.trace.corpus.customDocuments, 500);
  assert.equal(result.passages[0].documentId, "custom/scale-417.md");
  assert.ok(builtInLoads <= 10, "retrieval should load only its bounded candidate set, never the full built-in library");
  assert.ok(result.trace.budget.returnedBytes <= 8_000);
  assert.ok(duration < 1_500, `643-document retrieval took ${duration.toFixed(1)} ms`);
});

test("saved personal notes participate in retrieval with explicit provenance", async () => {
  const documents = [{
    id: "notes/example.md",
    title: "Example lecture",
    description: "A general lecture",
    source: "builtin",
  }];
  const result = await retrieveLibrary("lilac tensor ownership incident", {
    documents,
    searchIndex: { "notes/example.md": "general lecture content" },
    personalNotes: { "notes/example.md": "Lilac tensor ownership caused the incident during handoff." },
    loadSource: async () => "# Example lecture\n\n## Ordinary section\n\nNo incident details here.",
  });

  assert.equal(result.trace.corpus.personalNotes, 1);
  assert.equal(result.passages[0].sourceType, "personal-note");
  assert.equal(result.passages[0].anchor, "personal-note");
  assert.match(result.passages[0].text, /Lilac tensor ownership/);
});

test("an edited built-in copy is authoritative over the generated index", async () => {
  const documents = [{ id: "notes/edit.md", title: "Mutable lecture", source: "builtin" }];
  let loads = 0;
  const removed = await retrieveLibrary("obsolete zebra fact", {
    documents,
    searchIndex: { "notes/edit.md": "obsolete zebra fact" },
    edits: { "notes/edit.md": "# Mutable lecture\n\nThe previous claim was removed." },
    loadSource: async () => { loads += 1; return "must not load"; },
  });
  assert.equal(removed.passages.length, 0);
  assert.equal(loads, 0);

  const replacement = await retrieveLibrary("replacement cyan fact", {
    documents,
    searchIndex: { "notes/edit.md": "obsolete zebra fact" },
    edits: { "notes/edit.md": "# Mutable lecture\n\n## Corrected evidence\n\nThe replacement cyan fact is authoritative." },
    loadSource: async () => { throw new Error("must not load"); },
  });
  assert.equal(replacement.passages[0].documentId, "notes/edit.md");
  assert.match(replacement.passages[0].text, /replacement cyan fact/);
});

test("passages are diversified and exact UTF-8 byte budgets are enforced", async () => {
  const repeated = (label) => `# ${label}\n\n## Shared concept\n\n${"distributed systems consistency tradeoff 🧠 ".repeat(120)}`;
  const documents = ["alpha", "beta", "gamma"].map((id) => ({
    id: `custom/${id}.md`, title: `${id} source`, source: "custom", raw: repeated(id),
  }));
  const result = await retrieveLibrary("distributed systems consistency tradeoff", {
    documents,
    searchIndex: {},
    maxDocuments: 3,
    maxPassages: 6,
    maxPassagesPerDocument: 2,
    maxBytes: 1_600,
    maxPassageBytes: 420,
  });

  assert.ok(new Set(result.passages.map((passage) => passage.documentId)).size >= 2);
  assert.ok(result.passages.every((passage) => utf8Bytes(passage.text) <= 420));
  assert.ok(result.passages.reduce((sum, passage) => sum + utf8Bytes(passage.text), 0) <= 1_600);
  assert.ok(result.trace.budget.returnedBytes <= result.trace.budget.maximumBytes);
  assert.equal(result.trace.budget.truncated, true);
});

test("retrieval trace distinguishes sufficient evidence from web fallback", async () => {
  const document = {
    id: "custom/facts.md",
    title: "Stable local facts",
    source: "custom",
    raw: "# Stable local facts\n\n## Gradient accumulation\n\nGradient accumulation approximates a larger batch while preserving a bounded activation footprint.",
  };
  const grounded = await retrieveLibrary("gradient accumulation activation footprint", { documents: [document], searchIndex: {} });
  assert.equal(grounded.trace.webFallback.code, "library_match_sufficient");
  assert.equal(grounded.trace.webFallback.recommended, false);

  const absent = await retrieveLibrary("orbital horticulture on Europa", { documents: [document], searchIndex: {} });
  assert.equal(absent.trace.webFallback.code, "no_library_match");
  assert.equal(absent.trace.webFallback.recommended, true);

  const current = await retrieveLibrary("latest gradient accumulation library release", { documents: [document], searchIndex: {} });
  assert.equal(current.trace.webFallback.code, "time_sensitive_question");
  assert.equal(current.trace.webFallback.recommended, true);
});

test("a request about the open lesson reserves that lesson's passages", async () => {
  const { documents, searchIndex } = await loadGeneratedCorpus();
  const lessonId = "notes/part-05-supervised-learning/01-linear-regression.md";
  const query = "Explain the key ideas in this lesson with a short example and one common mistake.";
  const loadSource = (id) => loadNote(id);
  const unreserved = await retrieveLibrary(query, { documents, searchIndex, loadSource, maxPassages: 8, selectedDocumentId: lessonId });
  // The generic wording alone never finds the open lesson; this is the
  // reported Library-first failure that the reservation exists for.
  assert.equal(unreserved.passages.some((passage) => passage.documentId === lessonId), false);

  const reserved = await retrieveLibrary(query, {
    documents, searchIndex, loadSource, maxPassages: 8, selectedDocumentId: lessonId,
    reservedDocumentId: lessonId, reservedPassages: 4,
  });
  const lessonPassages = reserved.passages.filter((passage) => passage.documentId === lessonId);
  assert.equal(lessonPassages.length, 4);
  assert.deepEqual(reserved.passages.slice(0, 4).map((passage) => passage.documentId), Array(4).fill(lessonId), "reserved passages must lead the evidence list");
  assert.ok(lessonPassages.every((passage) => passage.reserved === true));
  assert.equal(new Set(lessonPassages.map((passage) => passage.section)).size, 4, "reserved passages should span distinct sections");
  assert.deepEqual([...lessonPassages].sort((left, right) => left.startLine - right.startLine).map((passage) => passage.id), lessonPassages.map((passage) => passage.id), "reserved passages keep reading order");
  assert.equal(reserved.trace.selection.reservedDocumentId, lessonId);
  assert.equal(reserved.trace.selection.reservedPassages, 4);
  assert.equal(reserved.trace.webFallback.recommended, false, "a question about the attached open lesson does not need current-web evidence");
  assert.equal(reserved.trace.webFallback.code, "open_lesson_reserved");
  assert.ok(lessonPassages.every((passage) => passage.text.replace(/^#+\s.*$/gmu, "").trim().length >= 40), "a bare heading line is not reserved as evidence");
  assert.ok(reserved.passages.length <= 8);
  assert.ok(reserved.passages.every((passage) => !("matched" in passage) && !("ordinal" in passage)));
});

test("reserved passages respect the byte budget and do not weaken an unrelated match", async () => {
  const { documents, searchIndex } = await loadGeneratedCorpus();
  const lessonId = "notes/part-05-supervised-learning/01-linear-regression.md";
  const loadSource = (id) => loadNote(id);
  const bounded = await retrieveLibrary("Explain this lesson", {
    documents, searchIndex, loadSource, reservedDocumentId: lessonId, reservedPassages: 4, maxBytes: 2_000, maxPassageBytes: 600,
  });
  assert.ok(bounded.passages.length >= 1 && bounded.passages[0].documentId === lessonId);
  assert.ok(bounded.passages.reduce((sum, passage) => sum + utf8Bytes(passage.text), 0) <= 2_000);

  const focused = await retrieveLibrary("How does the PPO clipped surrogate objective limit policy updates?", {
    documents, searchIndex, loadSource, reservedDocumentId: lessonId, reservedPassages: 2,
  });
  assert.ok(focused.passages.some((passage) => /policy-gradients-actor-critic-ppo/.test(passage.documentId)));
  assert.equal(focused.trace.confidence.level, "high", "open-lesson passages must not lower confidence in a strong unrelated match");
  assert.equal(focused.trace.webFallback.recommended, false);

  const missing = await retrieveLibrary("Explain this lesson", { documents, searchIndex, loadSource, reservedDocumentId: "notes/missing.md", reservedPassages: 4 });
  assert.equal(missing.trace.selection.reservedPassages, 0);
});

test("an aborted retrieval stops before loading source documents", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(
    retrieveLibrary("bounded cancellation", {
      documents: [{ id: "custom/abort.md", title: "Abort", source: "custom", raw: "bounded cancellation" }],
      searchIndex: {},
      signal: controller.signal,
    }),
    (error) => error?.name === "AbortError",
  );
});
