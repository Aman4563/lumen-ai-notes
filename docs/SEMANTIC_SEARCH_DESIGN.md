# SEARCH-002 design — optional local semantic search

Status: design accepted 2026-09-02 (issue #13); implementation deliberately
deferred. SEARCH-002 stays `Backlog` until this doc's gate is scheduled —
the M5 roadmap sequences it after AI-002/003/004 and PERF-002.

## Feasibility numbers (measured 2026-09-02)

- Corpus: 143 documents, 155,692 words; the shipped normalized lexical
  corpus is 1,058,753 bytes.
- Chunking at ~200 words with 15% overlap → ~920 chunks.
- **Index size is a non-issue**: 920 × 384-dim vectors = 1.35 MiB f32 or
  0.34 MiB int8 (+~74 KB chunk metadata). Query cost is ~353k
  multiply-adds — sub-millisecond brute force, no ANN structure needed.
- **The binding cost is the model + runtime**: all-MiniLM-L6-v2 int8 ONNX is
  23 MB (measured from the Xenova/all-MiniLM-L6-v2 repo, 2026-09-02;
  f32 90.4 MB, fp16 45.3 MB) plus tokenizer ~1 MB plus onnxruntime-web WASM
  (estimated 10–21 MB — verify at implementation). That is 40–75× the
  ~600 KB-class startup budget, so it can only ship as a lazily consented
  download — the ~710 MiB WebLLM precedent proves the consent UX at ~3–6%
  of that size.
- Index build throughput (estimate, verify): ~3–10 chunks/s WASM on phone →
  a one-time 1.5–5 minute build; tens of seconds on the Mac.

## Design gates (the acceptance surface is a full wave)

1. **Versioned index**: cached in IndexedDB keyed by
   `modelRevision × corpusHash × chunkerVersion`; any component change
   invalidates and rebuilds with progress UI.
2. **Disclosure**: model source, download size, and on-device-only
   inference stated before consent, mirroring the WebLLM card.
3. **Lexical evidence pairing**: every semantic hit must render alongside
   the lexical evidence for its chunk (the SEARCH-002 acceptance criterion) —
   semantic results are never shown as unexplainable matches.
4. **Quality/privacy tests**: retrieval fixtures in the eval suite
   (extending `eval/fixtures/`), plus a no-network assertion during
   inference.

## Why not now

SEARCH-001 lexical search now carries typo tolerance, plural folding,
spelling folds, field/content filters, facets, and a curated synonym tier —
measured against the corpus, the marginal recall a semantic index adds is
concentrated in cross-phrasing queries, which the synonym tier already
covers for the domain vocabulary. The 24–45 MB consented download and the
full acceptance surface make this a deliberate later wave, not a slice.
