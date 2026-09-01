/**
 * Deterministic AI retrieval-quality evaluation (P0-4, deterministic tier).
 *
 * Runs the real Library-first retrieval over the real generated corpus and
 * real curriculum Markdown in plain Node — no model, no browser. It scores a
 * versioned fixture corpus (eval/fixtures/v1/retrieval.json) for document
 * hit@k, exact personal-note/edit provenance, web-fallback decision codes,
 * budget safety, retrieval laziness, and replay determinism, then enforces
 * suite-level thresholds.
 *
 * This tier is intentionally model-free so it can run in `npm run check`.
 * Model-level answer/citation quality runs in the separate live tier
 * (`scripts/live_ai_smoke.mjs` against real Qwen) and the physical-device
 * gate; see eval/README.md.
 */
import { readFile } from "node:fs/promises";

import { retrieveLibrary, LIBRARY_RETRIEVAL_LIMITS } from "../src/lib/libraryRetrieval.js";

const rootUrl = new URL("../", import.meta.url);
const fixtureUrl = new URL("eval/fixtures/v1/retrieval.json", rootUrl);

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const documents = JSON.parse(await readFile(new URL("src/generated/content-index.json", rootUrl), "utf8"));
const searchIndex = JSON.parse(await readFile(new URL("src/generated/content-search.json", rootUrl), "utf8"));

const failures = [];
const fail = (caseId, message) => failures.push(`${caseId}: ${message}`);

// Corpus drift must be reported as corpus change, not retrieval regression.
if (documents.length !== fixture.corpus.expectedDocuments) {
  console.error(`AI eval failed: generated corpus has ${documents.length} documents but the v${fixture.suiteVersion} fixture pins ${fixture.corpus.expectedDocuments}. Re-run scripts/generate_content_index.mjs and re-baseline the fixture deliberately.`);
  process.exit(1);
}

const passageFingerprint = (result) => result.passages.map((passage) => (
  `${passage.id}|${passage.documentId}|${passage.anchor}|${passage.rank}|${passage.score}`
)).join("\n");

const CONFIDENCE_ORDER = { none: 0, low: 1, medium: 2, high: 3 };

const runCase = async (testCase) => {
  let loadCount = 0;
  const loadSource = async (id) => {
    loadCount += 1;
    return readFile(new URL(id, rootUrl), "utf8");
  };
  const result = await retrieveLibrary(testCase.query, {
    documents,
    searchIndex,
    loadSource,
    edits: testCase.edits ?? {},
    personalNotes: testCase.personalNotes ?? {},
    maxPassages: testCase.maxPassages ?? 8,
    maxBytes: testCase.maxBytes ?? 24_000,
    ...(testCase.maxPassageBytes ? { maxPassageBytes: testCase.maxPassageBytes } : {}),
  });
  return { result, loadCount };
};

const caseReports = [];
let hitAt1 = 0;
let hitAt3 = 0;
let hitEligible = 0;
let fallbackCodeCorrect = 0;
let fallbackCodeEligible = 0;
let deterministicCases = 0;

for (const testCase of fixture.cases) {
  const { result, loadCount } = await runCase(testCase);
  const replay = await runCase(testCase);

  if (result.trace.version !== fixture.traceVersion || result.trace.strategy !== fixture.strategy) {
    fail(testCase.id, `trace identity changed (${result.trace.version}/${result.trace.strategy}); bump the eval suite deliberately`);
  }
  if (result.trace.corpus.documentsScanned !== documents.length) {
    fail(testCase.id, `retrieval scanned ${result.trace.corpus.documentsScanned} of ${documents.length} documents`);
  }
  if (result.trace.corpus.searchIndex !== "ready") {
    fail(testCase.id, `search index was ${result.trace.corpus.searchIndex}, not ready`);
  }

  // Replay determinism: identical inputs must produce identical rankings.
  if (passageFingerprint(result) === passageFingerprint(replay.result)) {
    deterministicCases += 1;
  } else {
    fail(testCase.id, "replayed retrieval produced a different passage ranking");
  }

  // Laziness: only bounded candidate bodies may load, and the count must be
  // reported honestly in the trace.
  if (loadCount > LIBRARY_RETRIEVAL_LIMITS.candidateDocuments) {
    fail(testCase.id, `loaded ${loadCount} sources, above the ${LIBRARY_RETRIEVAL_LIMITS.candidateDocuments}-candidate ceiling`);
  }
  // Saved edits are served without touching loadSource, so observed loads
  // may be below (never above) the trace's loaded-document count.
  if (loadCount > result.trace.selection.loadedDocuments) {
    fail(testCase.id, `trace reports ${result.trace.selection.loadedDocuments} loaded documents but ${loadCount} loads were observed`);
  }

  const matchesExpectation = (documentId) => (
    (testCase.expectDocument && documentId === testCase.expectDocument)
    || (testCase.expectDocumentPrefix && documentId.startsWith(testCase.expectDocumentPrefix))
  );
  const expectedRank = (testCase.expectDocument || testCase.expectDocumentPrefix)
    ? (result.passages.findIndex((passage) => matchesExpectation(passage.documentId)) + 1) || null
    : null;

  if (testCase.expectDocument || testCase.expectDocumentPrefix) {
    hitEligible += 1;
    const requiredWithin = testCase.expectHitAt ?? 1;
    if (expectedRank !== null && expectedRank === 1) hitAt1 += 1;
    if (expectedRank !== null && expectedRank <= 3) hitAt3 += 1;
    if (expectedRank === null || expectedRank > requiredWithin) {
      fail(testCase.id, `expected ${testCase.expectDocument || testCase.expectDocumentPrefix} within top ${requiredWithin}, got rank ${expectedRank ?? "none"} (top: ${result.passages.slice(0, 3).map((passage) => passage.documentId).join(", ") || "no passages"})`);
    }
  }

  if (testCase.expectAnchor) {
    const anchors = result.passages.filter((passage) => matchesExpectation(passage.documentId)).map((passage) => passage.anchor);
    if (!anchors.includes(testCase.expectAnchor)) {
      fail(testCase.id, `expected anchor ${testCase.expectAnchor} from ${testCase.expectDocument}, got [${anchors.join(", ")}]`);
    }
  }
  if (testCase.expectSourceType) {
    const types = result.passages.filter((passage) => matchesExpectation(passage.documentId)).map((passage) => passage.sourceType);
    if (!types.includes(testCase.expectSourceType)) {
      fail(testCase.id, `expected sourceType ${testCase.expectSourceType}, got [${types.join(", ")}]`);
    }
  }
  if (testCase.expectPassageContains) {
    if (!result.passages.some((passage) => passage.text.includes(testCase.expectPassageContains))) {
      fail(testCase.id, `no returned passage contains "${testCase.expectPassageContains}" (saved edits must be authoritative)`);
    }
  }
  if (testCase.expectPassages !== undefined && result.passages.length !== testCase.expectPassages) {
    fail(testCase.id, `expected exactly ${testCase.expectPassages} passages, got ${result.passages.length}`);
  }

  if (testCase.expectFallbackCode !== undefined) {
    fallbackCodeEligible += 1;
    if (result.trace.webFallback.code === testCase.expectFallbackCode) fallbackCodeCorrect += 1;
    else fail(testCase.id, `expected fallback code ${testCase.expectFallbackCode}, got ${result.trace.webFallback.code}`);
  }
  if (testCase.expectFallbackRecommended !== undefined
    && result.trace.webFallback.recommended !== testCase.expectFallbackRecommended) {
    fail(testCase.id, `expected fallback recommended=${testCase.expectFallbackRecommended}, got ${result.trace.webFallback.recommended} (${result.trace.webFallback.code})`);
  }
  if (testCase.expectMaxConfidenceLevel !== undefined) {
    const level = result.trace.confidence.level;
    if (CONFIDENCE_ORDER[level] > CONFIDENCE_ORDER[testCase.expectMaxConfidenceLevel]) {
      fail(testCase.id, `expected confidence at most ${testCase.expectMaxConfidenceLevel}, got ${level} (${result.trace.confidence.score})`);
    }
  }

  const maximumBytes = result.trace.budget.maximumBytes;
  if (result.trace.budget.returnedBytes > maximumBytes) {
    fail(testCase.id, `returned ${result.trace.budget.returnedBytes} bytes above the ${maximumBytes}-byte budget`);
  }
  if (testCase.expectWithinBudget) {
    const encoder = new TextEncoder();
    const perPassageLimit = testCase.maxPassageBytes ?? LIBRARY_RETRIEVAL_LIMITS.passageBytes;
    for (const passage of result.passages) {
      if (encoder.encode(passage.text).byteLength > perPassageLimit) {
        fail(testCase.id, `a passage exceeded the ${perPassageLimit}-byte passage budget`);
      }
    }
  }

  caseReports.push({
    id: testCase.id,
    adversarial: testCase.adversarial === true,
    rank: expectedRank,
    passages: result.passages.length,
    confidence: `${result.trace.confidence.level}:${result.trace.confidence.score}`,
    fallback: `${result.trace.webFallback.recommended ? "recommended" : "not-needed"}:${result.trace.webFallback.code}`,
    returnedBytes: result.trace.budget.returnedBytes,
    loadedDocuments: loadCount,
  });
}

const metrics = {
  suiteVersion: fixture.suiteVersion,
  cases: fixture.cases.length,
  hitAt1: hitEligible ? Number((hitAt1 / hitEligible).toFixed(3)) : null,
  hitAt3: hitEligible ? Number((hitAt3 / hitEligible).toFixed(3)) : null,
  fallbackCodeAccuracy: fallbackCodeEligible ? Number((fallbackCodeCorrect / fallbackCodeEligible).toFixed(3)) : null,
  replayDeterminism: Number((deterministicCases / fixture.cases.length).toFixed(3)),
};

if (metrics.hitAt1 !== null && metrics.hitAt1 < fixture.thresholds.hitAt1) {
  failures.push(`suite: hit@1 ${metrics.hitAt1} is below the ${fixture.thresholds.hitAt1} threshold`);
}
if (metrics.hitAt3 !== null && metrics.hitAt3 < fixture.thresholds.hitAt3) {
  failures.push(`suite: hit@3 ${metrics.hitAt3} is below the ${fixture.thresholds.hitAt3} threshold`);
}
if (metrics.fallbackCodeAccuracy !== null && metrics.fallbackCodeAccuracy < fixture.thresholds.fallbackCodeAccuracy) {
  failures.push(`suite: fallback-code accuracy ${metrics.fallbackCodeAccuracy} is below the ${fixture.thresholds.fallbackCodeAccuracy} threshold`);
}
if (metrics.replayDeterminism < fixture.thresholds.replayDeterminism) {
  failures.push(`suite: replay determinism ${metrics.replayDeterminism} is below the ${fixture.thresholds.replayDeterminism} threshold`);
}

console.log(JSON.stringify({ metrics, cases: caseReports }, null, 2));

if (failures.length) {
  console.error(`AI eval failed (${failures.length} finding${failures.length === 1 ? "" : "s"}):\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`AI eval passed: ${fixture.cases.length} versioned retrieval cases (hit@1 ${metrics.hitAt1}, hit@3 ${metrics.hitAt3}, fallback-code accuracy ${metrics.fallbackCodeAccuracy}, determinism ${metrics.replayDeterminism}).`);
