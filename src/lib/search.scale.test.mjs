import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { searchDocuments, tokenizeQuery } from "./search.js";

const rootUrl = new URL("../../", import.meta.url);

const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

test("worst-case worker-shaped search over the real corpus plus 500 custom documents stays within budget", async () => {
  const documents = JSON.parse(await readFile(new URL("src/generated/content-index.json", rootUrl), "utf8"));
  const corpus = JSON.parse(await readFile(new URL("src/generated/content-search.json", rootUrl), "utf8"));

  // Mirror the worker's stores: corpus text normalized once at ingestion,
  // custom documents at the 500-document product ceiling with realistic
  // multi-kilobyte bodies.
  const { buildSearchWords } = await import("./search.js");
  const builtins = documents.map((document) => {
    const normalizedBody = normalize(corpus[document.id] || "");
    const metadata = normalize([document.title, document.partTitle, document.description].filter(Boolean).join(" "));
    return {
      ...document,
      raw: "",
      normalizedSearchText: normalizedBody,
      searchWords: buildSearchWords(`${metadata} ${normalizedBody}`),
    };
  });
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
  ];
  for (const query of queries) assert.ok(tokenizeQuery(query).length > 0);

  // Warm-up pass excludes one-time JIT/GC noise from the budget.
  searchDocuments(all, queries[0]);
  const startedAt = performance.now();
  for (const query of queries) {
    const results = searchDocuments(all, query);
    if (query === "zxqvpltrw nonexistent") assert.equal(results.length, 0, "a nonsense query must return nothing even with typo tolerance");
    else assert.ok(results.length > 0, `no results for "${query}"`);
    assert.ok(results.length <= 100);
  }
  assert.ok(searchDocuments(all, "gradiant descent").length > 0, "the typo query must resolve via one-edit tolerance under worst-case load");
  const elapsed = performance.now() - startedAt;
  // The pre-normalized path over 643 documents (~17 MB raw ceiling) must
  // stay comfortably interactive; the previous per-keystroke NFKD pass over
  // the corpus alone dominated this budget.
  assert.ok(elapsed < 2_500, `8 worst-case searches (incl. fuzzy/miss/exclusion) took ${Math.round(elapsed)}ms`);
});
