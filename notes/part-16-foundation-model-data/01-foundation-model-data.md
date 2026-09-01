# Chapter 1 — Foundation-Model Data Engineering

## 1. Data is part of the model specification

For foundation models, data scale does not eliminate curation. Source selection,
filters, deduplication, tokenizer, mixture, order, and post-training feedback shape
capability and risk.

```text
source rights -> acquire -> immutable raw snapshot -> parse/normalize
-> quality/language/safety/privacy filters -> deduplicate/decontaminate
-> mixture and curriculum -> tokenize/pack/shard -> train
-> evaluate/memorization audit -> revise with lineage
```

Every arrow needs versioning, metrics, rejection samples, and an owner.

## 2. Source governance before crawling

Record for every source:

- owner/provider and acquisition method;
- license/terms, consent, and allowed purposes;
- geographic/privacy constraints;
- time range and update/deletion process;
- access control and sensitivity classification;
- expected languages/domains/populations;
- quality and abuse risks;
- whether use in training, evaluation, or release is allowed.

Technical accessibility is not legal/ethical permission. Requirements differ by
jurisdiction and contract; involve qualified policy/legal experts.

## 3. Immutable raw zone and manifests

Keep an access-controlled raw snapshot so transformations are reproducible, while
honoring retention/deletion obligations. A manifest entry might contain:

```json
{
  "object_uri": "object://corpus/raw/shard-00017",
  "sha256": "...",
  "bytes": 184467440,
  "records": 92143,
  "source": "approved-source-v2",
  "acquired_at": "2026-08-19T00:00:00Z",
  "schema": "raw-document-v3",
  "policy": "internal-training"
}
```

Separate immutable versions from movable aliases such as `latest-approved`.
Checksums detect accidental changes, not semantic correctness or permission.

## 4. Storage formats and engines

### Parquet and Arrow

Columnar data with typed schemas supports projection, predicate filtering, and
efficient interchange. Row groups and file sizes influence parallelism and reads.

### Object storage

Durable scalable blobs; design around immutable objects and manifests instead of
POSIX assumptions.

### Lakehouse table formats

Iceberg/Delta-like metadata adds snapshots, partition evolution, transactions, and
time travel over object data. Useful for curated tables and deletion lineage.

### Distributed processing

Spark is strong for large SQL/shuffle ETL; Ray Data integrates Python/ML pipelines
and streaming ingestion; other engines may fit local/streaming constraints. Kafka-
like logs handle ordered partitioned events rather than a static training corpus.

Choose from workload, data size, shuffle, ecosystem, failure semantics, and team
operations. Do not add a distributed engine when one machine with streaming I/O is
enough.

## 5. Parsing and normalization

Documents may be HTML, PDF, code, books, chat, tables, image/audio/video, or
scientific structures. Preserve provenance and structure while extracting content.

Potential transformations:

- decode and normalize encoding;
- remove navigation/boilerplate without deleting semantic text;
- preserve headings, lists, tables, code boundaries, and document order;
- identify language/script;
- standardize only clearly meaningless whitespace/control characters;
- detect corrupt/binary/error pages;
- separate metadata from text;
- record parser version and warnings.

Aggressive normalization can collapse distinct code, mathematical notation, or
languages. Retain before/after samples and domain-specific acceptance tests.

## 6. Exact and near deduplication

### Exact

Hash normalized document or segments. Exact hashing is simple but misses small
changes and can falsely merge content if normalization is too aggressive.

### Near duplicate with shingles and MinHash

Represent a document as token/character n-gram set. Jaccard similarity:

> **J(A,B) = |A ∩ B| ÷ |A ∪ B|**

MinHash signatures approximate Jaccard; locality-sensitive hashing proposes
candidate pairs without comparing every pair. Then apply threshold/cluster policy.

Choices:

- document versus paragraph/code-function granularity;
- shingle definition and language handling;
- similarity threshold;
- which representative to keep;
- cross-split and train-evaluation dedup;
- whether repeated legitimate references should be downweighted rather than removed.

Dedup can reduce memorization and wasted compute, but may erase minority content or
legitimate repetitions. Audit removal rates by source/domain/language.

## 7. Quality filtering

Signals include:

- text length, alphabetic/token ratios, repetition and entropy;
- language confidence;
- parser success and structure;
- heuristic spam/SEO/adult/malware indicators;
- source reputation;
- classifier or model-based quality score;
- perplexity under a reference model;
- code parse/compile/test signals;
- citation or educational density.

Model-based filters encode their own biases and can create a feedback loop where
future models imitate the filter model’s preferences. Evaluate precision/recall on
expert-labeled stratified samples and retain score distributions/rejection samples.

## 8. Privacy, secrets, and harmful material

Detect and handle:

- personally identifying/sensitive information;
- credentials, tokens, private keys, internal URLs;
- copyrighted or restricted material under policy;
- malware, exploitation, and dangerous operational content;
- non-consensual or child sexual abuse material through specialized legal/safety
  processes;
- private communications and access-controlled documents.

Automated detection is imperfect. Combine source controls, pattern/classifier
filters, restricted review, retention limits, redaction, and incident/deletion
process. Do not expose harmful raw samples broadly in dashboards or logs.

## 9. Benchmark decontamination

Leakage can occur through exact questions, paraphrases, solutions, answer keys,
synthetic expansions, or benchmark discussions.

Use:

- exact/near matching at document and segment levels;
- task-specific canonicalization;
- temporal cutoffs where possible;
- hidden/private evaluation sets;
- exposure analysis and memorization probes;
- fresh dynamically generated or expert-created evaluations.

Absence of a detected match is not proof of no contamination. Document algorithms,
thresholds, benchmark versions, and blind spots.

## 10. Dataset mixture

Raw source volume should not automatically define training probability. If source i
has sampling weight wᵢ:

> **P(select source i) = wᵢ ÷ Σⱼ wⱼ**

Weights can account for quality, domain goals, language coverage, duplication,
rights, and diminishing returns. Temperature-style sampling can flatten source
imbalance, but the correct mixture is empirical and objective-dependent.

Track both raw bytes and actual tokens consumed per source. Small sources may cycle
many epochs and overfit/memorize while large sources are seen once.

## 11. Curriculum and ordering

Possible curricula vary quality, domain, difficulty, modality, or sequence length
over training. A claimed benefit must be separated from changed token counts,
batching efficiency, or learning-rate phase.

Data order is distributed state. For resumability, record enough to reconstruct or
accept a documented at-least-once/reshuffled guarantee:

- dataset/manifest version;
- epoch/global sample or token cursor;
- shuffling seed/counter;
- rank/worker assignment policy;
- sampler and buffer state;
- mixture scheduler state.

## 12. Tokenization

### Vocabulary trade-off

Larger vocabulary reduces sequence length for frequent units but expands embedding/
output parameters and may represent rare units poorly. Smaller vocabularies create
longer sequences and more compute.

Common methods include byte-pair-like merges, unigram language models, WordPiece-
like schemes, and byte/character approaches. Important choices:

- Unicode normalization and invalid-byte handling;
- byte fallback/open vocabulary;
- whitespace/code indentation;
- multilingual balance;
- special/control tokens and chat template;
- normalization before tokenization;
- added tokens and embedding initialization;
- deterministic implementation/version.

Never swap tokenizer while loading an old embedding matrix without an explicit
vocabulary mapping and evaluation.

### Tokenization audit

Measure tokens per character/word by language/domain, unknown/fallback behavior,
code/number/math fragmentation, round-trip properties, and special-token injection.
Tokenization inequity changes effective context and serving cost.

## 13. Packing and sequence construction

Pack documents into fixed/max-length sequences to reduce padding. Decide:

- whether attention crosses document boundaries;
- end-of-document tokens;
- position reset;
- loss mask for prompt/control/padding;
- truncation policy;
- sample weights;
- sequence-length curriculum;
- deterministic packing and resume.

For instruction tuning, incorrectly training on user/system prompt tokens can teach
the wrong behavior. Unit-test labels and masks with a human-readable decoded sample.

## 14. File sharding and streaming loader

Good shards are large enough for sequential efficiency and small enough for
parallelism/recovery. Avoid millions of tiny files and a few giant hot shards.

A distributed loader must ensure:

- rank and worker receive intended disjoint/weighted streams;
- no accidental duplication when workers restart;
- bounded shuffle buffer with known approximation;
- prefetch and local cache do not exceed memory/disk;
- corrupt records are counted/quarantined, not silently skipped without metric;
- slow object reads retry with deadlines and do not hang all ranks;
- data throughput keeps accelerators fed.

Measure tokens/s entering the model, data-wait time, cache hit rate, bytes/s,
records rejected, duplicates, and per-source mix at every rank.

## 15. Multimodal data

Images/video/audio add:

- decoding libraries and malformed-media security;
- resolution, frame/sample rate, duration, aspect policies;
- perceptual/near-duplicate detection;
- caption/alt-text quality and image-text alignment;
- face/voice/biometric privacy;
- temporal synchronization;
- modality token budgets and batching by size;
- content-safety review specific to modality.

Keep original and transformed dimensions/codec/version in lineage. Augmentation
belongs to the experiment specification and may need deterministic RNG per sample.

## 16. Post-training data

### Demonstrations

Record prompt source, policy version, author/model, revision history, tool traces,
quality checks, and task category. Avoid template leakage across split.

### Preferences

Store both candidates, presentation order, model/config, annotator or judge type,
rubric, tie/strength, disagreement, and adjudication. Randomize candidate order to
measure position bias.

### Verifier/reward data

Distinguish outcome labels from process-step labels. Verify that labels cannot be
gamed through formatting, length, or answer leakage.

### Synthetic data

Track teacher model/prompt/sampling/filter. Synthetic data can scale rare tasks but
inherits teacher blind spots and reduces diversity. Mix with trusted human/real data
and evaluate independently.

## 17. Data quality contracts

Every published dataset version should pass:

- schema/types/required fields;
- key uniqueness and referential integrity;
- size/token/source/language distributions;
- filter and duplicate rates;
- PII/secret/safety scan thresholds;
- train/dev/test disjointness and contamination checks;
- tokenization/packing invariants;
- representative manual audit;
- lineage, license/policy, owner, and expiration/deletion metadata.

Tests should fail closed for critical policy violations. For expected noisy fields,
quarantine with an explicit budget and review rather than halting all processing.

## 18. Deletion and model unlearning reality

Deleting raw/processed records, caches, indexes, and future training eligibility is
an engineering workflow. Removing influence from already trained weights is a
different and generally difficult problem. Maintain lineage so affected datasets,
runs, checkpoints, and derived models can be identified. Do not promise that
deleting a row automatically removes its learned influence.

## 19. Practical labs

1. Build a streaming corpus pipeline from two permitted sources with manifests.
2. Implement exact and MinHash-style near dedup; audit false merges/misses.
3. Train/evaluate a tokenizer across code and two languages.
4. Pack sequences with boundary/loss masks and property tests.
5. Scale loader to multiple workers/ranks; prove mix and disjointness invariants.
6. Produce a data card with rights, bias, privacy, contamination, and deletion plan.

## 20. Tool map and primary references

- [Apache Arrow](https://arrow.apache.org/docs/)
- [Apache Parquet](https://parquet.apache.org/docs/)
- [Apache Spark documentation](https://spark.apache.org/docs/latest/)
- [Ray Data with Ray Train](https://docs.ray.io/en/latest/train/user-guides/data-loading-preprocessing.html)
- [SentencePiece paper](https://arxiv.org/abs/1808.06226)

Use tools that preserve the required semantics; a fashionable distributed engine
cannot repair unclear rights, labels, or evaluation leakage.
