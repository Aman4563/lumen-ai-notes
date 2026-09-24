import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildSearchWords, searchDocuments, SEARCH_RESULT_LIMIT, tokenizeQuery } from "./search.js";

const rootUrl = new URL("../../", import.meta.url);

const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

// Mirror the worker's stores: corpus text normalized once at ingestion, with
// the case-preserved plain body kept beside it for result snippets.
const loadBuiltins = async () => {
  const documents = JSON.parse(await readFile(new URL("src/generated/content-index.json", rootUrl), "utf8"));
  const corpus = JSON.parse(await readFile(new URL("src/generated/content-search.json", rootUrl), "utf8"));
  const partTitles = new Map(documents.filter((document) => document.isIndex && document.partNumber > 0).map((document) => [document.partNumber, document.title]));
  return documents.map((document) => {
    const body = corpus[document.id] || "";
    const normalizedBody = normalize(body);
    const partTitle = partTitles.get(document.partNumber) || (document.partNumber === 0 ? "Curriculum guides" : `Part ${document.partNumber}`);
    const metadata = normalize([document.title, partTitle, document.description].filter(Boolean).join(" "));
    return {
      ...document,
      partTitle,
      raw: "",
      snippetText: body,
      normalizedSearchText: normalizedBody,
      searchWords: buildSearchWords(`${metadata} ${normalizedBody}`),
    };
  });
};

test("worst-case worker-shaped search over the real corpus plus 500 custom documents stays within budget", async () => {
  // Custom documents at the 500-document product ceiling with realistic
  // multi-kilobyte bodies.
  const builtins = await loadBuiltins();
  const customs = Array.from({ length: 500 }, (_, index) => {
    const body = `Custom study note ${index} about gradient descent, attention, calibration, and evaluation drift. `.repeat(40);
    const normalizedBody = normalize(body);
    return {
      id: `custom-${index}`,
      title: `Custom note ${index}`,
      partTitle: "Uploads",
      description: "Learner upload",
      partNumber: 99,
      chapterNumber: index,
      source: "custom",
      raw: body,
      normalizedSearchText: normalizedBody,
      searchWords: buildSearchWords(`custom note ${index} learner upload ${normalizedBody}`),
    };
  });
  const all = [...builtins, ...customs];
  assert.equal(builtins.length, 143);

  const queries = [
    "gradient descent optimization",
    "transformer attention",
    "calibration reliability",
    '"data leakage"',
    "evaluation drift custom",
    // Worst cases for the advanced slice: a typo forcing the fuzzy word scan
    // across every candidate, a miss that scans everything without matching,
    // and an exclusion pass over the full corpus.
    "gradiant descent optimizaton",
    "zxqvpltrw nonexistent",
    "gradient -zeppelin",
    // Word-bounded short terms rescan every occurrence of a common fragment.
    "RAG",
    "ai",
  ];
  for (const query of queries) assert.ok(tokenizeQuery(query).length > 0);

  // Warm-up pass excludes one-time JIT/GC noise from the budget.
  searchDocuments(all, queries[0]);
  const startedAt = performance.now();
  for (const query of queries) {
    const results = searchDocuments(all, query);
    if (query === "zxqvpltrw nonexistent") assert.equal(results.length, 0, "a nonsense query must return nothing even with typo tolerance");
    else assert.ok(results.length > 0, `no results for "${query}"`);
    assert.ok(results.length <= SEARCH_RESULT_LIMIT);
  }
  assert.ok(searchDocuments(all, "gradiant descent").length > 0, "the typo query must resolve via one-edit tolerance under worst-case load");
  assert.equal(searchDocuments(all, "-custom").some((result) => result.source === "custom"), false, "an exclusion-only query scans the full corpus and excludes");
  const elapsed = performance.now() - startedAt;
  // The pre-normalized path over 643 documents (~17 MB raw ceiling) must
  // stay comfortably interactive; the previous per-keystroke NFKD pass over
  // the corpus alone dominated this budget.
  assert.ok(elapsed < 2_500, `${queries.length + 2} worst-case searches (incl. fuzzy/miss/exclusion/boundary) took ${Math.round(elapsed)}ms`);
});

test("real-corpus search semantics: exclusions, exact Parts, acronyms, typo ranking, and snippets", async () => {
  const builtins = await loadBuiltins();
  const containsWord = (document, term) => new RegExp(`(^|[^a-z0-9])${term}(e?s)?([^a-z0-9]|$)`).test(`${normalize(document.title)} ${normalize(document.description)} ${document.normalizedSearchText}`);

  const regression = searchDocuments(builtins, "regression");
  const excluded = searchDocuments(builtins, "-regression");
  assert.ok(regression.length > 10);
  assert.equal(excluded.length, builtins.length - builtins.filter((document) => `${normalize(document.title)} ${normalize(document.partTitle)} ${normalize(document.description)} ${document.normalizedSearchText}`.includes("regression")).length, "-regression returns exactly the documents without the term");
  assert.equal(excluded.some((result) => /regression/i.test(result.title)), false);

  for (const part of [1, 5]) {
    const results = searchDocuments(builtins, `part:${part}`);
    assert.ok(results.length > 0 && results.every((result) => result.partNumber === part), `part:${part} must keep only Part ${part}`);
  }

  for (const acronym of ["RAG", "PPO", "LoRA"]) {
    const results = searchDocuments(builtins, acronym);
    const term = acronym.toLocaleLowerCase();
    assert.ok(results.length > 0 && results.length < 30, `${acronym} returned ${results.length} results`);
    assert.ok(results.every((result) => containsWord(result, term) || new RegExp(`(^|[^a-z0-9])${term}`).test(result.normalizedSearchText)), `${acronym} matched a document only inside other words`);
  }
  assert.match(searchDocuments(builtins, "RAG")[0].title, /Retrieval-Augmented/, "the RAG chapter leads the RAG results");
  assert.ok(searchDocuments(builtins, "LoRA").slice(0, 3).some((result) => result.partNumber === 19), "Part 19's fine-tuning chapter ranks near the top for LoRA");

  const typo = searchDocuments(builtins, "regresion");
  assert.match(typo[0].title, /Regression/, "a one-letter typo ranks the Regression chapters first, not curriculum order");
  assert.deepEqual(typo[0].corrections, [{ term: "regresion", word: "regression" }]);

  // Built-in lectures show real match context, not the stock description.
  for (const query of ["backpropagation", "gradient descent", "regression"]) {
    const results = searchDocuments(builtins, query).slice(0, 8);
    const contextual = results.filter((result) => result.description !== builtins.find((document) => document.id === result.id).description);
    assert.ok(contextual.length >= Math.min(6, results.length), `${query}: only ${contextual.length} of ${results.length} snippets carried match context`);
    assert.ok(contextual.every((result) => result.matchedTerms.some((term) => normalize(result.description).includes(term))), `${query}: a snippet missed every matched term`);
  }
});
