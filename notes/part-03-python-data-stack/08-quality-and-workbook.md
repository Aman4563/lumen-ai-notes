# Chapter 8 — Testing, Packaging, Reproducibility, and Interview Workbook

## 1. Testing strategy

Tests build confidence at different scopes:

| Level | Tests | Strength | Limitation |
|---|---|---|---|
| Unit | small deterministic component | fast/local diagnosis | misses integration contracts |
| Property | invariants over generated inputs | edge coverage | requires meaningful properties |
| Integration | real compatible boundaries | schema/serialization behavior | slower/environmental |
| End-to-end | complete critical workflow | user-level confidence | expensive/flaky if overused |
| Regression/golden | known prior behavior | catches changes | can freeze incorrect behavior |
| Load/soak | performance and resource behavior | capacity/leaks/tails | needs representative workload |

Test pyramid is guidance, not a quota. Data/ML systems also need data contracts,
statistical tests, and model-quality gates.

## 2. Unit-test design

Arrange–Act–Assert, one behavioral reason to fail, deterministic inputs, clear name.

```python
def test_threshold_includes_equal_score():
    assert decide(score=0.8, threshold=0.8) == "positive"
```

Test boundaries:

- empty and single item;
- duplicate/tied values;
- missing/unknown;
- min/max/out of range;
- shape and dtype;
- NaN/∞;
- exact timestamp boundary;
- exception and cleanup;
- retry/idempotency;
- Unicode/timezone.

Do not test implementation details unnecessarily; refactoring should preserve
contract without rewriting every test.

## 3. Property-based testing

Examples:

- softmax outputs nonnegative and sum approximately 1;
- standardization inverse recovers finite input within tolerance;
- sorting output is ordered and a permutation of input;
- serialize/deserialize round-trip preserves schema;
- batch predictions equal concatenated individual predictions (when model is
  batch-independent);
- point-in-time feature never uses `available_at > prediction_at`.

Generated tests find cases humans omit: empty, huge, repeated, Unicode, extreme
floats. Constrain generators to meaningful domains.

## 4. Floating-point assertions

Use combined absolute/relative tolerance:

> |actual − expected| ≤ atol + rtol · |expected|

Absolute tolerance matters near zero; relative at large magnitude. Set from
algorithm/dtype requirements, not merely enough to pass.

## 5. ML-specific tests

### Data

- schema/range/key/row-count;
- point-in-time correctness;
- split disjointness/grouping;
- label maturity/prevalence;
- transformation fit only on training;
- training/serving parity.

### Model artifact

- loads with declared runtime;
- signature and version match;
- deterministic test vector within tolerance;
- finite outputs and valid probabilities;
- latency/memory budget;
- metric/slice gates versus baseline;
- adversarial/safety regression suite.

### Pipeline

- tiny end-to-end fixture;
- rerun/idempotency/backfill;
- resume from failure/checkpoint;
- immutable inputs and artifact lineage;
- no promotion if validation missing/fails.

## 6. Mocking versus fakes

Mock at unstable/expensive boundary, not every function. Over-mocking tests call
sequence rather than behavior and misses schema/auth/serialization.

- Fake: working simplified implementation, e.g. in-memory store.
- Stub: fixed responses.
- Mock: verifies interaction expectations.
- Contract test: provider/consumer compatibility.

Use real local compatible services/container integration where behavior matters.

## 7. Packaging

Recommended project shape:

```text
project/
├── pyproject.toml
├── README.md
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── cli.py
│       └── model.py
├── tests/
├── configs/
└── scripts/
```

Use `src` layout to avoid accidentally importing the working directory instead of
installed package. Separate library code from notebooks/entry points.

`pyproject.toml` contains build metadata, dependencies, tool config, and entry
points. A lockfile records resolved dependency versions for applications.

### Semantic versioning caveat

MAJOR/MINOR/PATCH communicates API compatibility intent, but ML behavior/data can
change without type signature change. Version model, feature schema, calibration,
threshold, and policy explicitly.

## 8. Configuration

Separate code from environment config, but validate config into a typed immutable
object. Precedence might be defaults < file < environment < CLI; document it.

Do not make every constant configurable. Configuration expands state space and
testing burden. Never store secrets in config files committed to Git.

## 9. Reproducibility manifest

Record:

- source commit and dirty status;
- data snapshot/query/feature/label versions;
- split algorithm/seed;
- config/hyperparameters;
- dependency lock and runtime/container digest;
- hardware/accelerator and deterministic flags;
- seeds for every RNG;
- training logs/checkpoints;
- metric code version;
- final artifact/checksum and lineage.

Reproducing same metric within tolerance can be more realistic than bitwise
identity across GPU/library versions. State guarantee.

## 10. CI/CD gates

Typical pipeline:

```mermaid
flowchart LR
    A[Lint/type/unit] --> B[Integration/security]
    B --> C[Build immutable artifact]
    C --> D[Data/model validation]
    D --> E[Registry]
    E --> F[Shadow/canary]
    F --> G[Gradual promotion]
```

Artifact built once should be promoted, not rebuilt per environment. Sign/verify
provenance. Separate code deploy from model/policy rollout where useful.

## 11. Code-review checklist

- correct grain, units, shapes, time semantics;
- readable API and types;
- edge/error behavior;
- no leakage or full-data preprocessing;
- complexity/memory at scale;
- concurrency/idempotency;
- security/privacy/logging;
- deterministic tests and fixtures;
- migration/backward compatibility;
- monitoring/ownership;
- documentation of why/trade-offs.

## 12. Interview rapid answers

### Why use a virtual environment?

Isolate project dependencies/interpreters from system/other projects. It does not
alone guarantee reproducibility; lock versions and environment/image.

### List versus tuple?

List mutable dynamic sequence; tuple immutable sequence suitable for fixed records
and hash keys when elements hashable. Tuples do not make nested mutable elements
immutable.

### Generator advantage and trap?

Lazy streaming lowers memory and composes pipelines. It is one-pass, stateful,
defers errors/resources, and may retain closures.

### Why vectorization?

Moves loops into optimized native kernels and enables hardware efficiency. It can
increase temporary memory and does not improve algorithmic complexity.

### INNER versus LEFT JOIN?

INNER keeps matches; LEFT preserves all left rows with NULL right. Join key
cardinality can multiply rows in both.

### Thread versus process versus async?

Threads share memory and suit blocking I/O/native work; processes isolate and can
parallelize CPU with IPC; async cooperatively handles many waits but blocking CPU/
I/O stalls loop. Choose by workload and failure model.

### Unit versus integration test?

Unit isolates component behavior quickly; integration verifies real boundary
compatibility. Both are required for systems whose failures occur at contracts.

## 13. Coding interview checklist

- clarify constraints and examples;
- brute force then optimize;
- state invariant/proof;
- type and name clearly;
- handle empty/duplicates/bounds;
- trace code;
- give tight time/space;
- discuss scale extensions after core solution.

## 14. Part 3 capstone

Build a small, production-shaped tabular prediction service.

### Components

1. CLI ingests typed CSV/Parquet and validates schema.
2. SQL creates a point-in-time dataset at defined grain.
3. Python package fits train-only preprocessing and a simple model.
4. Artifact bundle stores schema, model, preprocessing, metadata/checksum.
5. HTTP API validates batch request and returns versioned scores.
6. Tests: unit/property/integration/golden/extreme inputs.
7. Container runs non-root with readiness and graceful shutdown.
8. Load test reports p50/p95/p99, throughput, error, memory, and saturation.
9. README contains architecture, run commands, failure/fallback, and limitations.

### Senior extensions

- idempotent batch job with restart/backfill;
- bounded async feature lookup and circuit breaker;
- champion/shadow artifact selection;
- structured metrics/tracing without raw sensitive values;
- compatibility migration across schema/model versions.

## 15. Exit checklist

- [ ] I understand Python references, mutation, scope, iterators, errors, and types.
- [ ] I write shape-safe NumPy and explain views/broadcasting/dtypes.
- [ ] I construct correct joins, windows, cohorts, and point-in-time SQL.
- [ ] I solve core DSA patterns with proofs and complexity.
- [ ] I reason about HTTP, concurrency, backpressure, caching, and containers.
- [ ] I write layered tests and a reproducibility manifest.
- [ ] I completed the capstone or equivalent production-shaped project.
