# Chapter 1 — Experiments, Lineage, Registries, and Reproducibility

## 1. Reproducible run identity

An experiment run is a tuple:

```text
code commit + dirty patch + data snapshot/query + feature/label/split versions
+ config/hyperparameters + environment/container + seeds + hardware
+ parent artifacts -> metrics + logs + checkpoints + final model
```

A run name such as `final_v7` is not lineage.

## 2. Experiment tracking

Track:

- objective/hypothesis/owner;
- parameters/config;
- dataset/artifact IDs;
- metrics by split/slice/step;
- resource/time/cost;
- environment/dependencies;
- stdout/logs/profiler;
- artifact checksums;
- status/failure cause;
- comparison/baseline;
- decision/notes.

Tracking everything without conventions creates an unusable landfill. Define
required fields, metric names/units, tags, retention, and access.

## 3. Configuration management

Use typed validated config, compose environment-independent defaults with explicit
overrides, persist resolved config. Avoid hidden notebook/global values.

Separate:

- model hyperparameters;
- data/split;
- compute/runtime;
- secrets (references, never values);
- deployment policy.

Hash canonical resolved config plus inputs for caching, but code/environment must
also be included.

## 4. Artifact management

Artifacts: dataset manifest, preprocessing, tokenizer, weights, calibration,
threshold, schema/signature, evaluation/model card.

Requirements:

- immutable content-addressed/versioned storage;
- checksums;
- atomic publication;
- metadata/lineage;
- access/encryption/retention;
- large-object lifecycle/tiering;
- compatibility validation;
- deletion/legal hold.

Do not pickle untrusted artifacts. Sign/verify provenance where supply-chain risk.

## 5. Model registry

Registry records versions and lifecycle stages/aliases:

- candidate;
- validated;
- shadow/canary;
- champion/production;
- archived/blocked.

Promotion is metadata/control event after gates, not copying unknown files. Store
model + preprocessing + signature + metrics + approvals + dependencies.

Mutable alias `production` points to immutable version. Prediction logs record
immutable version and policy.

## 6. Validation gates

### Structural

Artifact load, signature, dtype/shape, finite output, dependency/runtime.

### Quality

Primary metric vs baseline, slices, calibration, robustness, confidence, no test
contamination.

### Operational

Latency/throughput/memory/model size, batch behavior, cold start.

### Safety/governance

Forbidden features, privacy/security scan, fairness/safety tests, documentation,
owner/approval.

Gates need version/control and override audit. Automated metric pass does not
replace human decision for high impact.

## 7. Dataset versioning

Options:

- immutable partition/object paths;
- table snapshots/time travel;
- manifests listing file checksums;
- query + source snapshots;
- specialized data-version control.

Store split assignment manifest to reproduce exact examples. Query text alone is
insufficient against mutable tables.

## 8. Feature/label code versioning

Version semantic definition. Changing default/window/unit under same name makes
historical experiments incomparable. Link source schema and code commit.

Feature views should include event/availability semantics; label view policy and
maturity. Transform object version with model.

## 9. Randomness

Seed every generator and store. Distributed data order, GPU kernels, library
versions, threading can still vary. Decide reproducibility contract:

- bitwise same;
- metric within tolerance;
- statistically equivalent across runs.

For scientific claims report seed distribution; for debugging offer deterministic
mode.

## 10. Notebooks versus production code

Notebooks useful exploration/communication; problematic hidden state/order,
environment, large output, testing, reuse.

Workflow:

1. explore notebook;
2. move transforms/model/eval into package with tests;
3. notebook imports package and contains narrative;
4. pipeline invokes versioned entrypoint/config;
5. executed notebook/report optional artifact.

## 11. Reproducibility audit

Given production prediction ID, can you find:

- request/entity/time and served features (privacy-safe);
- model/preprocessing/calibration/threshold/policy version;
- deployment and experiment arm;
- training run;
- exact data/label/splits/code/config/environment;
- evaluation/approval;
- owner/runbook.

If not, incident/root-cause/audit/rollback is impaired.

## 12. Exercises

1. Define run schema and artifact manifest.
2. Reproduce a model from clean environment/snapshot.
3. Design registry promotion/rollback aliases.
4. Threat-model model artifact supply chain.
5. Trace a prediction to source data and approvals.

