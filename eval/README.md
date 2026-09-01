# AI quality evaluation suite

This directory holds the versioned evaluation corpus required by
ENGINEERING_HANDOFF.md P0-4. Quality evidence is layered in three tiers with
different determinism and hardware requirements. Only the first tier can gate
releases automatically; the other two produce dated operator/device evidence.

## Tier 1 — deterministic retrieval/grounding evaluation (release gate)

```bash
npm run audit:ai-eval
```

`scripts/ai_eval.mjs` runs the real Library-first retrieval
(`src/lib/libraryRetrieval.js`) over the real generated corpus
(`src/generated/content-index.json` + `content-search.json`) and real
curriculum Markdown, in plain Node with no model and no browser. The fixture
corpus `fixtures/v1/retrieval.json` pins:

- document hit@1 / hit@3 for realistic learner questions across curriculum
  Parts, with per-case rank requirements;
- exact personal-note provenance (anchor `personal-note`, sourceType) and
  saved-edit authority (edited text must be the retrieved text);
- web-fallback decision codes (`time_sensitive_question`, `no_library_match`)
  and recommendation booleans where they are unambiguous;
- bounded-budget behavior (returned and per-passage byte ceilings);
- retrieval laziness (loaded bodies never exceed the candidate ceiling and
  match the trace's disclosure);
- replay determinism (identical inputs must produce identical rankings);
- adversarial queries (instruction-injection and citation-label text must be
  treated as plain query text, bounded and crash-free).

Suite-level thresholds live in the fixture (`thresholds`). The runner refuses
to score a drifted corpus: if the generated document count no longer matches
the fixture's pin, re-run `scripts/generate_content_index.mjs` and re-baseline
the fixture deliberately, bumping `suiteVersion`.

Versioning rule: bump `suiteVersion` whenever cases, expectations, or
thresholds change; the fixture also pins `trace.version` and the retrieval
`strategy` string so a retrieval-algorithm change fails loudly instead of
silently re-baselining quality.

Known miss (kept honest): lexical retrieval has no stemming or synonyms
(SEARCH-001), so vocabulary-mismatched phrasings can rank the right chapter
low. Cases use realistic phrasing the corpus can support; hit@1 is gated at
0.8, not 1.0. Semantic retrieval remains a separate backlog item (SEARCH-002).

## Tier 2 — live model evaluation on the reviewed Mac (operator-run)

```bash
node scripts/live_ai_smoke.mjs        # integrated origin, defaults to :4202
```

Runs the real UI against the integrated server and the pinned `qwen3.5:4b`
model: fresh-profile Library-first grounding, NDJSON stream-order/terminal
validation, delta/final-text equality, `[S#]` provenance in the fitted
context, KaTeX/heading rendering, and timing metadata, emitting a JSON report
blob to archive alongside the commit SHA. Requires Chrome, a running
integrated server, and Ollama with the reviewed model digest. Record the
output with the release evidence; this tier is deliberately not part of
`npm run check` because it depends on live model output.

## Tier 3 — physical-device gate (open)

On-device Lite quality/latency on a trusted-HTTPS physical iPhone remains an
open device gate (see PHONE_LOCAL_AI.md). Automated phone tests use mocked
WebLLM boundaries and cannot substitute for it.
