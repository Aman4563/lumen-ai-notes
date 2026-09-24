import assert from "node:assert/strict";
import { applyPronunciations, chunkSpeechText, normalizePronunciations } from "../src/lib/speech.js";
import { normalizeBoardDocument, normalizeBoardStrokes, normalizeProfile, PROFILE_VERSION } from "../src/lib/db.js";
import { contentCapabilities, foldPluralTerm, pruneRecentSearches, pushRecentSearch, searchDocuments, spellingAlternates, tokenizeExclusions, tokenizeFieldFilters, tokenizeQuery, withinOneEdit } from "../src/lib/search.js";
import { synonymAlternatesFor } from "../src/lib/searchSynonyms.js";
import { MAX_CUSTOM_DOCUMENT_BYTES, selectUploadFiles } from "../src/lib/uploads.js";
import { createId } from "../src/lib/id.js";
import { selectInterviewRound } from "../src/lib/interview.js";
import {
  actionableReviewCount,
  buildReviewQueue,
  classifyReviewItem,
  hasClozeMarkup,
  renderClozePrompt,
  reviewAnalytics,
  createReviewItem,
  gradeReviewItem,
  isNewReviewItem,
  localDayKey,
  recordReviewUsage,
  restoreReviewItemFromAttempt,
  reverseReviewUsage,
  reviewStats,
} from "../src/lib/review.js";

const chunks = chunkSpeechText("A short sentence. " + "optimization ".repeat(80) + "Done!", 120);
assert.ok(chunks.length > 2, "long narration should be split into multiple segments");
assert.ok(chunks.every((chunk) => chunk.length <= 120), "narration segments must respect the safe utterance limit");
assert.deepEqual(tokenizeQuery('"policy gradient" PPO + KL'), ["policy gradient", "ppo", "kl"]);

const fallbackUuid = createId();
assert.match(fallbackUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.match(createId({ getRandomValues: (bytes) => bytes.fill(17) }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-9[0-9a-f]{3}-[0-9a-f]{12}$/i, "UUID fallback must work when randomUUID is absent");
const uploadFixtures = [{ name: "one.md", size: 10 }, { name: "two.markdown", size: 20 }];
assert.deepEqual(selectUploadFiles(uploadFixtures, 499).accepted.map((file) => file.name), ["one.md"], "499 existing notes plus two uploads may import only one");
assert.equal(selectUploadFiles(uploadFixtures.slice(0, 1), 500).accepted.length, 0, "a full notebook must reject uploads instead of replacing an existing note");
const aggregateFixtures = [{ name: "fits.md", size: 8 }, { name: "overflow.md", size: 8 }];
const aggregateSelection = selectUploadFiles(aggregateFixtures, 2, MAX_CUSTOM_DOCUMENT_BYTES - 10);
assert.deepEqual(aggregateSelection.accepted.map((file) => file.name), ["fits.md"], "uploads must respect the aggregate backup-safe document budget");
assert.equal(aggregateSelection.byteCapacityReached, true);

const results = searchDocuments([
  { id: "body", title: "Other", partTitle: "RL", description: "PPO uses policy gradients", searchText: "policy gradient clipping ppo", raw: "Policy gradient clipping is used by PPO.", partNumber: 2, chapterNumber: 2 },
  { id: "title", title: "Policy Gradient PPO", partTitle: "RL", description: "Interview guide", searchText: "policy gradient ppo", raw: "An overview.", partNumber: 2, chapterNumber: 1 },
  { id: "miss", title: "Policy only", partTitle: "RL", description: "No algorithm", searchText: "policy gradients", raw: "Policy gradients.", partNumber: 2, chapterNumber: 3 },
], '"policy gradient" PPO');
assert.deepEqual(results.map((result) => result.id), ["title", "body"], "search should use AND matching and rank title matches first");
assert.ok(results[1].description.includes("Policy gradient"), "search should return a contextual excerpt");
assert.deepEqual(results[0].matchedTerms, ["policy gradient", "ppo"], "search must report the terms it matched for snippet highlighting");

// SEARCH-001 advanced-lexical slice: exclusions, typo tolerance, and their bounds.
const advancedCorpus = [
  { id: "gd", title: "Gradient descent", partTitle: "Math", description: "Optimization basics", searchText: "gradient descent learning rate schedules", raw: "", partNumber: 2, chapterNumber: 3 },
  { id: "boost", title: "Boosting", partTitle: "Supervised", description: "Ensembles", searchText: "gradient boosting trees ensembles", raw: "", partNumber: 5, chapterNumber: 3 },
];
assert.deepEqual(tokenizeExclusions("gradient -boosting"), ["boosting"]);
assert.deepEqual(tokenizeExclusions('"policy -gradient" clean'), [], "quoted phrases never produce exclusions");
assert.deepEqual(searchDocuments(advancedCorpus, "gradient -boosting").map((result) => result.id), ["gd"], "-term must exclude documents containing the term");
assert.deepEqual(searchDocuments(advancedCorpus, "gradiant descent").map((result) => result.id), ["gd"], "a single typo in a long term must still match via one-edit tolerance");
assert.equal(searchDocuments(advancedCorpus, "grzdixnt descent").length, 0, "two edits must not match");
assert.equal(searchDocuments(advancedCorpus, "rate").length, 1, "short terms stay exact");
assert.equal(searchDocuments(advancedCorpus, "ratz").length, 0, "short terms get no typo tolerance");
const exactBeatsFuzzy = searchDocuments(advancedCorpus, "gradient");
const fuzzyOnly = searchDocuments(advancedCorpus, "gradiant");
assert.ok(exactBeatsFuzzy[0].searchScore > fuzzyOnly[0].searchScore, "an exact match must outrank the same document reached by typo tolerance");
assert.ok(withinOneEdit("attention", "attentoin") === false && withinOneEdit("attention", "atention") === true, "one-edit boundary must be exact");

const normalized = normalizeProfile({
  progress: { good: 0.4, high: 8, bad: "no" },
  readingPositions: { good: -2 },
  bookmarks: ["a", "a", 4],
  clippings: [{ documentId: "a", text: "  selected text  " }, { documentId: "a", text: " " }],
  customDocuments: [{ id: "custom/one.md", title: " Example ", raw: "# Example", tags: ["ml", "ml", 4] }],
  lastDocumentId: "custom/one.md",
  settings: { theme: "invalid", fontScale: 99, lineHeight: 0, speechLanguage: "not_a_locale", speechRate: 4, speechVolume: -4, speechScope: "page", keepScreenAwake: 1 },
});
assert.equal(normalized.version, PROFILE_VERSION);
assert.deepEqual(normalized.progress, { good: 0.4, high: 1 });
assert.equal(normalized.readingPositions.good, 0);
assert.deepEqual(normalized.bookmarks, ["a"]);
assert.equal(normalized.clippings.length, 1);
assert.equal(normalized.clippings[0].text, "selected text");
assert.deepEqual(normalized.customDocuments[0].tags, ["ml"]);
assert.equal(normalized.lastDocumentId, "custom/one.md");
assert.equal(normalized.settings.theme, "system");
assert.equal(normalized.settings.fontScale, 1.35);
assert.equal(normalized.settings.lineHeight, 1.45);
assert.equal(normalized.settings.speechRate, 1.6);
assert.equal(normalized.settings.speechLanguage, "auto");
assert.equal(normalized.settings.speechVolume, 0);
assert.equal(normalized.settings.speechScope, "document");
assert.equal(normalized.settings.keepScreenAwake, true);
assert.deepEqual(normalized.reviewItems, [], "v2 profiles should migrate with an empty review deck");
assert.deepEqual(normalized.reviewAttempts, [], "v2 profiles should migrate without fabricated attempts");

// LEARN-002 cloze mechanics: {{spans}} conceal until reveal and never touch
// text outside the braces.
assert.equal(hasClozeMarkup("The {{validation}} split"), true);
assert.equal(hasClozeMarkup("No cloze here"), false);
assert.equal(renderClozePrompt("The {{validation}} split tunes {{hyperparameters}}."), "The **[ … ]** split tunes **[ … ]**.");
assert.equal(renderClozePrompt("The {{validation}} split tunes {{hyperparameters}}.", true), "The **validation** split tunes **hyperparameters**.");
assert.equal(renderClozePrompt("Escaped {single} braces stay"), "Escaped {single} braces stay");

// INTERVIEW-002 slice: the interview round selects only interview-flavored,
// non-suspended cards, weak-first (lapses desc, least-recent tiebreak), bounded.
{
  const cardAt = (id, extra) => ({ id, type: "definition", tags: [], front: id, back: "a", lapses: 0, createdAt: "2026-08-01T00:00:00.000Z", ...extra });
  const pool = [
    cardAt("plain"),
    cardAt("tagged", { tags: ["Interview"], lapses: 1 }),
    cardAt("scenario", { type: "production-scenario", lapses: 3, lastReviewedAt: "2026-08-20T00:00:00.000Z" }),
    cardAt("compare-old", { type: "compare", lapses: 3, lastReviewedAt: "2026-08-10T00:00:00.000Z" }),
    cardAt("suspended", { type: "compare", suspended: true }),
    cardAt("archived", { tags: ["interview"], archived: true }),
    cardAt("debugging", { type: "debugging" }),
  ];
  const round = selectInterviewRound(pool);
  assert.deepEqual(round.map((card) => card.id), ["compare-old", "scenario", "tagged", "debugging"],
    "weak-first: highest lapses first, least-recently-reviewed breaking ties; plain/suspended/archived excluded");
  assert.deepEqual(selectInterviewRound(pool), round, "selection must be deterministic");
  assert.equal(selectInterviewRound(pool, { limit: 2 }).length, 2);
  assert.equal(selectInterviewRound([]).length, 0);
}

// SEARCH-001 synonyms: curated alternates at a dedicated tier, spelling and
// hyphen folds at the exact tier, precision operators never expanded.
{
  const synonymCorpus = [
    { id: "opt", title: "Optimization basics", partTitle: "Math", description: "Schedules", searchText: "the learning rate controls the step size of stochastic gradient descent", raw: "", partNumber: 2, chapterNumber: 1, tags: [] },
    { id: "reg", title: "Regularization", partTitle: "Supervised", description: "Shrinkage", searchText: "l2 regularization shrinks weights toward zero", raw: "", partNumber: 5, chapterNumber: 1, tags: [] },
    { id: "exact-sgd", title: "SGD deep dive", partTitle: "Optim", description: "sgd", searchText: "sgd with momentum and sgd variants", raw: "", partNumber: 7, chapterNumber: 1, tags: [] },
  ];
  assert.deepEqual(searchDocuments(synonymCorpus, "sgd").map((result) => result.id), ["exact-sgd", "opt"], "an exact match outranks a synonym match of the same query");
  assert.deepEqual(searchDocuments([synonymCorpus[0]], "lr").map((result) => result.id), ["opt"], "the directed lr → learning-rate expansion works");
  assert.equal(searchDocuments([synonymCorpus[0]], "learning").some((result) => result.id === "opt"), true);
  assert.deepEqual(searchDocuments([synonymCorpus[1]], "regularisation").map((result) => result.id), ["reg"], "British spelling folds onto the corpus's American form");
  assert.deepEqual(spellingAlternates("optimise"), ["optimize"]);
  assert.deepEqual(spellingAlternates("k-means"), ["kmeans"]);
  assert.equal(searchDocuments(synonymCorpus, "sgd -regularization").some((result) => result.id === "reg"), false, "exclusions stay literal");
  // Boundary rule: "reinforcement learning" expands to the short alternate
  // "rl", which must only match as a standalone word — never inside "girl".
  const boundaryDoc = [{ id: "girl", title: "Notes", partTitle: "X", description: "Y", searchText: "a girl studies daily", raw: "", partNumber: 1, chapterNumber: 1, tags: [] }];
  assert.equal(searchDocuments(boundaryDoc, '"reinforcement learning"').length, 0, "short synonym alternates need word boundaries");
  const rlDoc = [{ id: "rl", title: "Notes", partTitle: "X", description: "Y", searchText: "an rl agent explores", raw: "", partNumber: 1, chapterNumber: 1, tags: [] }];
  assert.deepEqual(searchDocuments(rlDoc, '"reinforcement learning"').map((result) => result.id), ["rl"], "the standalone short alternate still matches");
  assert.ok(synonymAlternatesFor("backprop").some((alternate) => alternate.text === "backpropagation"));
  const highlighted = searchDocuments([synonymCorpus[0]], "sgd")[0];
  assert.ok(highlighted.matchedTerms.includes("stochastic gradient descent"), "the matched synonym variant is reported for highlighting");
}

// AUDIO-001 pronunciation overrides: whole-word, case-insensitive, bounded.
{
  const glossary = [{ term: "SQL", spoken: "sequel" }, { term: "ReLU", spoken: "ray loo" }];
  assert.equal(applyPronunciations("SQL and sql joins; NoSQL stays.", glossary), "sequel and sequel joins; NoSQL stays.", "whole-word matching must not touch embedded occurrences");
  assert.equal(applyPronunciations("ReLU then GELU", glossary), "ray loo then GELU");
  assert.equal(applyPronunciations("plain text", []), "plain text");
  const normalized = normalizePronunciations([
    { term: " SQL ", spoken: " sequel " },
    { term: "sql", spoken: "duplicate loses" },
    { term: "", spoken: "dropped" },
    { term: "x".repeat(100), spoken: "bounded" },
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], { term: "SQL", spoken: "sequel" }, "terms trim and case-insensitive duplicates collapse");
  assert.equal(normalized[1].term.length, 60, "term length is bounded");
}

// SEARCH-001 field filters, has: capabilities, and plural folding.
{
  const fieldCorpus = [
    { id: "t5", title: "Transformer architecture", partTitle: "Part 09 Deep Learning", description: "Attention", searchText: "transformer attention encoder optimizers", raw: "", partNumber: 9, chapterNumber: 1, tags: [], hasCode: true, hasFormula: true },
    { id: "t6", title: "Decision trees", partTitle: "Part 05 Classical Supervised Learning", description: "Splits", searchText: "gini entropy transformer mention", raw: "", partNumber: 5, chapterNumber: 2, tags: ["interview"], hasCode: false, hasFormula: false },
  ];
  assert.deepEqual(tokenizeFieldFilters('title:transformer part:9 tag:"interview" has:code has:nonsense'), { title: ["transformer"], part: ["9"], tag: ["interview"], has: ["code"] }, "field filters parse and unknown has: values drop");
  assert.deepEqual(tokenizeQuery("title:transformer gradient"), ["gradient"], "filter tokens never leak into body terms");
  assert.deepEqual(searchDocuments(fieldCorpus, "title:transformer").map((result) => result.id), ["t5"], "title: restricts to title matches");
  assert.deepEqual(searchDocuments(fieldCorpus, "part:5 transformer").map((result) => result.id), ["t6"], "part: restricts by part number");
  assert.deepEqual(searchDocuments(fieldCorpus, "part:supervised transformer").map((result) => result.id), ["t6"], "part: also matches part-title words");
  assert.deepEqual(searchDocuments(fieldCorpus, "tag:interview").map((result) => result.id), ["t6"], "tag: filters on document tags with no body terms required");
  assert.deepEqual(searchDocuments(fieldCorpus, "has:code transformer").map((result) => result.id), ["t5"], "has:code keeps only code-bearing documents");
  assert.deepEqual(searchDocuments(fieldCorpus, "has:formula transformer").map((result) => result.id), ["t5"]);
  assert.equal(searchDocuments(fieldCorpus, "title:zzz").length, 0, "an unmatched filter yields an honest empty result");

  assert.equal(foldPluralTerm("optimizers"), "optimizer");
  assert.equal(foldPluralTerm("queries"), "query");
  assert.equal(foldPluralTerm("losses"), "loss");
  assert.equal(foldPluralTerm("loss"), "loss", "a trailing double-s never folds");
  assert.deepEqual(searchDocuments(fieldCorpus, "optimizer").map((result) => result.id), ["t5"], "singular query matches the plural in the body");
  assert.deepEqual(searchDocuments(fieldCorpus, "optimizerz").map((result) => result.id), ["t5"], "folding and typo tolerance compose without breaking exactness");
  assert.deepEqual(searchDocuments(fieldCorpus, "optimizers")[0].matchedTerms, ["optimizers"], "an exact plural stays the highlighted term");

  const capabilities = contentCapabilities("Intro\n```python\nprint(1)\n```\nInline $E=mc^2$ formula");
  assert.deepEqual(capabilities, { hasCode: true, hasFormula: true });
  assert.deepEqual(contentCapabilities("plain prose only, $5 price"), { hasCode: false, hasFormula: false }, "currency-style dollars never count as formulas");
  assert.equal(contentCapabilities("> f′(x) = lim<sub>h→0</sub> [f(x + h) − f(x)] / h").hasFormula, true, "the curriculum's blockquote/sub formula style counts");
  assert.equal(contentCapabilities("```mermaid\nflowchart LR\n```").hasCode, false, "a mermaid diagram alone is not code");
  assert.equal(contentCapabilities("> a plain quotation without math").hasFormula, false);
}

// Issue #52: exclusion-only queries, exact part numbers, word-bounded short
// terms, ranked typo corrections, lecture snippets, and committed recents.
{
  const doc = (id, title, partNumber, body, extra = {}) => ({ id, title, partTitle: `Part ${partNumber} — ${extra.partName || "Topic"}`, description: extra.description || "Stock description.", searchText: body.toLocaleLowerCase(), snippetText: body, raw: "", partNumber, chapterNumber: extra.chapter || 1, tags: [] });
  const corpus = [
    doc("lin", "Linear Regression", 5, "Linear Regression. Ordinary least squares fits a regression line.", { partName: "Classical Supervised Learning" }),
    doc("docker", "Docker Storage", 15, "Volumes provide storage and average throughput for containers.", { partName: "Accelerators" }),
    doc("rag", "Retrieval pipelines", 8, "RAG systems retrieve passages. Many rags to riches stories.", { partName: "LLMs" }),
    doc("trans", "Transformers", 21, "The transformer stacks attention layers.", { partName: "Inference" }),
    doc("intro", "Course intro", 1, "Welcome. Later chapters cover regressions briefly.", { partName: "Foundations", chapter: 2 }),
  ];
  const ids = (query, docs = corpus) => searchDocuments(docs, query).map((result) => result.id);

  assert.deepEqual(ids("-regression"), ["rag", "docker", "trans"], "an exclusion on its own must exclude (in curriculum order), not return everything");
  assert.deepEqual(ids("−regression"), ids("-regression"), "the typographic minus shown in help excludes like an ASCII hyphen");
  assert.deepEqual(ids("–regression"), ids("-regression"), "an autocorrected en dash also excludes");
  assert.deepEqual(ids('"x −y" regression').length, 0, "a folded minus inside a phrase never turns into an exclusion");

  assert.deepEqual(ids("part:5"), ["lin"], "part:5 matches Part 5 only, never Part 15");
  assert.deepEqual(ids("part:1"), ["intro"], "part:1 never matches Parts 15 or 21");
  assert.deepEqual(ids("part:05"), ["lin"], "zero-padded part numbers still compare numerically");
  assert.deepEqual(ids("part:supervised"), ["lin"], "part: still matches a word of the Part title");

  assert.deepEqual(ids("rag"), ["rag"], "a short term never matches inside another word (storage, average)");
  assert.deepEqual(ids("RAG"), ["rag"], "an all-caps acronym matches only as a whole word");
  assert.deepEqual(ids("-rag"), ["intro", "lin", "docker", "trans"], "short exclusions follow the same word rule");
  assert.deepEqual(ids("tran"), ["trans"], "a short prefix still finds longer words while typing");
  assert.deepEqual(ids("TRAN"), [], "an acronym must be the whole word");
  assert.ok(ids("rags").includes("rag") && ids("RAGS").includes("rag"), "plural forms still match");

  const typo = searchDocuments(corpus, "regresion");
  assert.equal(typo[0].id, "lin", "a typo ranks the document whose title holds the corrected word first");
  assert.deepEqual(typo[0].corrections, [{ term: "regresion", word: "regression" }], "the correction is reported for the results hint");
  assert.ok(typo[0].matchedTerms.includes("regression"), "the corrected word is highlighted");
  assert.ok(searchDocuments(corpus, "regression")[0].searchScore > typo[0].searchScore, "exact still outranks the same document reached by typo tolerance");

  const snippet = searchDocuments(corpus, "least squares")[0].description;
  assert.ok(snippet.includes("Ordinary least squares"), `built-in snippets come from the case-preserved body: ${snippet}`);
  assert.ok(!snippet.startsWith("Linear Regression"), "the snippet skips the repeated title line");
  assert.equal(searchDocuments(corpus, "linear")[0].description, "Stock description.", "a title-only match keeps the stock description");
  assert.equal(searchDocuments(corpus, "zzzz").length, 0);
  const accentedRaw = "# Cafe notes\n\nOther text first. The naïve Bayes café example shows priors.";
  const accented = { id: "custom/cafe.md", title: "Cafe notes", partTitle: "My uploads", description: "Stock.", searchText: accentedRaw, raw: accentedRaw, partNumber: 99, chapterNumber: 1, source: "custom", tags: [] };
  assert.match(searchDocuments([accented], "naive")[0].description, /The naïve Bayes café/, "an accent-folded term still cuts a snippet from an uploaded note");

  const typed = ["d", "dr", "dro", "drop", "dropo", "dropou", "dropout"].reduce((list, entry) => pushRecentSearch(list, entry), ["attention"]);
  assert.deepEqual(typed, ["dropout", "attention"], "unfinished prefixes are replaced by the committed query");
  assert.deepEqual(pushRecentSearch(["attention"], "attention mask"), ["attention mask", "attention"], "a longer query that starts a new word keeps the shorter search");
  assert.deepEqual(pushRecentSearch(["Dropout", "rag"], "dropout"), ["dropout", "rag"], "recents dedupe case-insensitively");
  assert.deepEqual(pushRecentSearch(["−regression"], "-regression"), ["-regression"], "a typographic-minus search is the same recent search");
  assert.deepEqual(pushRecentSearch(["a", "b", "c", "d", "e", "f"], "g").length, 6, "recents stay bounded");
  assert.deepEqual(pruneRecentSearches(["dropout", "dropou", "drop", "dro", "dr", "d", "attenti", 'title:"problem framing a"', 'title:"problem framing and objectives"', "", 4]), ["dropout", "attenti", 'title:"problem framing and objectives"'], "stored prefix junk self-heals on load");
}

// LEARN-003: bury/suspend/archive exclusion, crunch weak-first ordering, and
// Hard/Easy scheduling have direct assertions.
{
  const queueNow = new Date("2026-08-21T12:00:00.000Z");
  const todayKey = localDayKey(queueNow, "UTC");
  const mk = (id, extra = {}) => ({ ...createReviewItem({ front: id, back: "a" }, new Date("2026-08-20T12:00:00.000Z")), id, dueAt: "2026-08-21T10:00:00.000Z", ...extra });
  const eligible = mk("eligible");
  const buried = mk("buried", { buriedOnDay: todayKey });
  const suspendedCard = mk("suspended", { suspended: true });
  const archivedCard = mk("archived", { archived: true });
  const settings = { dailyNewLimit: 10, dailyReviewLimit: 10 };
  const dailyQueue = buildReviewQueue([eligible, buried, suspendedCard, archivedCard], settings, queueNow, [], { timeZone: "UTC" });
  assert.deepEqual(dailyQueue.map((item) => item.id), ["eligible"], "buried, suspended, and archived cards must never enter the daily queue");
  assert.equal(actionableReviewCount({ reviewItems: [eligible, buried, suspendedCard, archivedCard], reviewSettings: settings, reviewSessions: [] }, queueNow, "UTC"), 1, "the shared due count must match the daily queue");
  const forecastNow = new Date("2026-08-21T20:00:00.000Z");
  const forecastCards = [mk("tonight", { dueAt: "2026-08-21T23:00:00.000Z" }), mk("tomorrow-morning", { dueAt: "2026-08-22T06:00:00.000Z" }), mk("in-24h", { dueAt: "2026-08-22T20:00:00.000Z" }), mk("past", { dueAt: "2026-08-21T19:00:00.000Z" })];
  assert.deepEqual(reviewAnalytics([], forecastCards, forecastNow, "UTC").forecast, [1, 2, 0, 0, 0, 0, 0], "the forecast buckets upcoming reviews by local calendar day");

  const weak = mk("weak", { reviewCount: 5, lastReviewedAt: "2026-08-01T00:00:00.000Z", lapses: 4, ease: 1.6, dueAt: "2026-09-30T00:00:00.000Z" });
  const strong = mk("strong", { reviewCount: 5, lastReviewedAt: "2026-08-01T00:00:00.000Z", lapses: 0, ease: 2.8, dueAt: "2026-09-30T00:00:00.000Z" });
  const crunchQueue = buildReviewQueue([strong, weak, suspendedCard, archivedCard, buried], settings, queueNow, [], { timeZone: "UTC", crunch: true, crunchLimit: 5 });
  assert.deepEqual(crunchQueue.map((item) => item.id), ["weak", "strong"], "crunch mode must order weak cards first and still exclude suspended/archived/buried");

  const matured = mk("matured", { reviewCount: 3, lastReviewedAt: "2026-08-01T00:00:00.000Z", repetitions: 3, intervalDays: 10, ease: 2.5 });
  const hard = gradeReviewItem(matured, "hard", queueNow, 900);
  assert.equal(hard.item.intervalDays, 12, "Hard must multiply the prior interval by 1.2");
  assert.equal(hard.item.ease, 2.35, "Hard must reduce ease by 0.15");
  assert.equal(hard.item.repetitions, 4);
  const easy = gradeReviewItem(matured, "easy", queueNow, 900);
  assert.equal(easy.item.intervalDays, Math.max(4, 10 * 2.5 * 1.3), "Easy must expand the interval by ease times 1.3");
  assert.equal(easy.item.ease, 2.65, "Easy must raise ease by 0.15");
  const firstEasy = gradeReviewItem(createReviewItem({ front: "new", back: "a" }, queueNow), "easy", queueNow, 500);
  assert.equal(firstEasy.item.intervalDays, 4, "a first Easy review schedules four days out");
}

// 12-week retention trend buckets attempts oldest-first with null-safe weeks.
{
  const trendNow = new Date("2026-08-21T12:00:00.000Z");
  const attempt = (daysAgo, rating) => ({ reviewedAt: new Date(trendNow.getTime() - daysAgo * 86_400_000).toISOString(), rating, elapsedMs: 1_000 });
  const trend = reviewAnalytics([
    attempt(1, "good"), attempt(2, "again"),            // current week: 50%
    attempt(10, "good"), attempt(11, "good"),           // week -1: 100%
    attempt(80, "again"),                                // week -11: 0%
    attempt(200, "good"),                                // outside the window
  ], [], trendNow, "UTC").retentionTrend;
  assert.equal(trend.length, 12);
  assert.equal(trend[11].percent, 50);
  assert.equal(trend[11].count, 2);
  assert.equal(trend[10].percent, 100);
  assert.equal(trend[0].percent, 0, "the oldest bucket holds the ~80-day-old lapse");
  assert.equal(trend[5].percent, null, "weeks without attempts stay null, not zero");
}

// LEARN-003: queue classes are explicit and mutually exclusive with defined
// precedence (overdue beats learning beats mature on-time due).
const classifyNow = new Date("2026-08-21T12:00:00.000Z");
const classifyFixtures = [
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow) }, expected: "new" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), reviewCount: 4, lastReviewedAt: "2026-08-01T00:00:00.000Z", repetitions: 1, intervalDays: 1, dueAt: "2026-08-21T10:00:00.000Z" }, expected: "learning" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), reviewCount: 4, lastReviewedAt: "2026-08-01T00:00:00.000Z", repetitions: 1, intervalDays: 1, dueAt: "2026-08-19T12:00:00.000Z" }, expected: "overdue" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), reviewCount: 9, lastReviewedAt: "2026-08-01T00:00:00.000Z", repetitions: 5, intervalDays: 30, dueAt: "2026-08-21T11:00:00.000Z" }, expected: "due" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), reviewCount: 9, lastReviewedAt: "2026-08-01T00:00:00.000Z", repetitions: 5, intervalDays: 30, dueAt: "2026-08-15T12:00:00.000Z" }, expected: "overdue" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), reviewCount: 9, repetitions: 5, intervalDays: 30, lastReviewedAt: "2026-08-01T00:00:00.000Z", dueAt: "2026-09-10T12:00:00.000Z" }, expected: "scheduled" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), suspended: true, dueAt: "2026-08-15T12:00:00.000Z" }, expected: "suspended" },
  { fixture: { ...createReviewItem({ front: "q", back: "a" }, classifyNow), archived: true, suspended: true }, expected: "archived" },
];
const classes = ["new", "overdue", "learning", "due", "scheduled", "suspended", "archived"];
for (const { fixture, expected } of classifyFixtures) {
  const actual = classifyReviewItem(fixture, classifyNow, "UTC");
  assert.equal(actual, expected, `queue class for dueAt=${fixture.dueAt} repetitions=${fixture.repetitions} should be ${expected}, got ${actual}`);
  assert.equal(classes.filter((candidate) => candidate === actual).length, 1, "every item maps to exactly one class");
}
assert.equal(reviewStats(classifyFixtures.map((entry) => entry.fixture), classifyNow, "UTC").overdue, 2, "stats must count overdue items");

const reviewNow = new Date("2026-08-21T12:00:00.000Z");
const firstCard = createReviewItem({ front: "Question", back: "Answer" }, reviewNow);
const secondCard = createReviewItem({ front: "Second", back: "Answer" }, new Date(reviewNow.getTime() + 1_000));
const limitedQueue = buildReviewQueue([secondCard, firstCard], { dailyNewLimit: 1, dailyReviewLimit: 50 }, reviewNow);
assert.deepEqual(limitedQueue.map((item) => item.id), [firstCard.id], "new-card limit and deterministic creation order should be respected");
const firstGood = gradeReviewItem(firstCard, "good", reviewNow, 1_250);
assert.equal(firstGood.item.repetitions, 1);
assert.equal(firstGood.item.intervalDays, 1);
assert.equal(firstGood.attempt.rating, "good");
assert.equal(firstGood.attempt.elapsedMs, 1_250);
const secondGood = gradeReviewItem(firstGood.item, "good", new Date("2026-08-22T12:00:00.000Z"));
assert.equal(secondGood.item.intervalDays, 3);
const lapse = gradeReviewItem(secondGood.item, "again", new Date("2026-08-25T12:00:00.000Z"));
assert.equal(lapse.item.repetitions, 0);
assert.equal(lapse.item.lapses, 1);
assert.equal(lapse.item.intervalDays, 0.01);
assert.deepEqual(reviewStats([secondGood.item], new Date("2026-09-30T12:00:00.000Z")), { due: 1, overdue: 1, newCount: 0, learning: 1, mastered: 0, suspended: 0, archived: 0 });

const thirdCard = createReviewItem({ front: "Third", back: "Answer" }, new Date(reviewNow.getTime() + 2_000));
const firstUsage = recordReviewUsage([], firstCard, reviewNow, { timeZone: "Asia/Kolkata" });
assert.equal(firstUsage.kind, "new");
assert.equal(firstUsage.sessions[0].newIntroduced, 1);
assert.deepEqual(
  buildReviewQueue([secondCard, thirdCard], { dailyNewLimit: 1, dailyReviewLimit: 50 }, reviewNow, firstUsage.sessions, { timeZone: "Asia/Kolkata" }),
  [],
  "grading a new card must consume the persisted daily allowance instead of admitting another card",
);
const reviewedUsage = recordReviewUsage(firstUsage.sessions, firstGood.item, new Date("2026-08-22T12:00:00.000Z"), { timeZone: "Asia/Kolkata" });
assert.equal(reviewedUsage.kind, "review");
assert.equal(reviewedUsage.sessions.at(-1).reviewCompleted, 1);
const gradedAgain = gradeReviewItem(firstGood.item, "again", new Date("2026-08-22T12:00:00.000Z"), 500, { sessionKind: reviewedUsage.kind, sessionKey: reviewedUsage.sessionKey, confidence: 2 });
assert.equal(gradedAgain.item.repetitions, 0);
assert.equal(gradedAgain.item.reviewCount, 2);
assert.equal(isNewReviewItem(gradedAgain.item), false, "Again must not reclassify an established card as new");
assert.equal(gradedAgain.attempt.confidence, 2);
assert.equal(restoreReviewItemFromAttempt(gradedAgain.item, gradedAgain.attempt).dueAt, firstGood.item.dueAt);
assert.equal(reverseReviewUsage(reviewedUsage.sessions, gradedAgain.attempt).at(-1).reviewCompleted, 0);
assert.notEqual(
  localDayKey(new Date("2026-03-08T04:30:00.000Z"), "America/New_York"),
  localDayKey(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"),
  "local-day accounting must survive the spring DST boundary",
);

const board = normalizeBoardStrokes([
  { id: "valid", tool: "arrow", color: "#fff", width: 400, points: [{ x: -1, y: 0.5 }, { x: 2, y: 1 }] },
  { tool: "script", color: "url(javascript:x)", width: "bad", points: [{ x: "bad", y: 1 }] },
]);
assert.equal(board.length, 1);
assert.equal(board[0].tool, "arrow");
assert.equal(board[0].width, 100);
assert.deepEqual(board[0].points, [{ x: 0, y: 0.5 }, { x: 1, y: 1 }]);
const migratedBoard = normalizeBoardDocument(board);
assert.equal(migratedBoard.version, 2);
assert.equal(migratedBoard.pages.length, 1);
assert.equal(migratedBoard.pages[0].objects.length, 1);

console.log("Unit audit passed: narration, search, profile migration, review scheduling, and whiteboard normalization.");
