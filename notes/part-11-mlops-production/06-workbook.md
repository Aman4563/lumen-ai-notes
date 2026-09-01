# Chapter 6 — MLOps Interview Workbook and Production Capstone

## 1. Rapid answers

### CI/CD/CT?

CI validates code/integration/artifacts; CD deploys/promotes software/models; CT
generates model candidates from new data. CT promotion still needs gates/rollout.

### Feature store purpose?

Reusable feature definitions, point-in-time offline retrieval, low-latency online
materialization, metadata/lineage. Does not automatically fix semantics/leakage.

### Data drift versus concept drift?

P(X) change versus P(Y∣X) change. Data drift may be harmless; concept can change
without obvious marginal input drift. Mature performance needed.

### Canary versus A/B?

Canary manages rollout risk to small traffic; A/B randomized estimates causal
product impact. Canary can be randomized but goals/analysis differ.

### Why registry?

Immutable model/preprocess versions, lineage/evaluation/approval, lifecycle aliases,
reproducible deployment/rollback/audit.

### Exactly-once?

Scoped guarantee requiring source/processing/sink; external side effects still need
idempotency. Prefer explicit at-least-once + dedupe where appropriate.

## 2. Design prompts

- ML experiment/training platform for 500 scientists;
- real-time feature store at 1M QPS;
- GPU inference platform for 100 models;
- continuous fraud training with delayed labels;
- multi-tenant LLM serving with adapters/KV;
- model monitoring for recommendation;
- region-resident global ML platform.

Answer requirements/users, API, data/model lifecycle, estimates, storage/compute,
reliability, security, rollout, monitoring, cost, migration.

## 3. Incident prompts

### Training pipeline suddenly produces perfect AUC

Stop promotion; compare lineage/schema/query/time, label-derived features,
duplicates/splits/preprocessing/test; inspect single-feature power and raw rows.

### Online predictions all constant

Fallback/rollback; feature missing/default/units, wrong model/schema, preprocessing,
serialization, output transform, cache key, runtime; compare golden request and
offline recompute.

### GPU endpoints OOM after traffic change

Admission/limit/fallback; input length/batch/concurrency/KV/cache, fragmentation,
model/adapter, memory leak/retained refs; restore bounds then capacity/scheduler.

### Drift alert but quality stable

Assess feature relevance/effect/support/seasonality/reference; avoid retrain solely.
Tune monitor/runbook and continue outcome observation.

## 4. Part 11 capstone

Productionize an earlier model end-to-end:

1. immutable data/feature/label/split manifests;
2. containerized idempotent train/eval DAG;
3. tracked runs, artifacts/checksums, model card;
4. registry gates and champion alias;
5. batch and/or online serving with typed contract;
6. load test and capacity/cost estimate;
7. shadow/canary/A-B/rollback automation;
8. service/data/skew/prediction/delayed-quality/product monitors;
9. retrain candidate strategy and drift experiment;
10. incident game day with postmortem;
11. security/privacy/lineage/deletion;
12. runbooks/ownership/SLO/error budget.

## 5. Senior rubric

Strong answer includes concrete scale estimates, state/consistency, failure modes,
idempotency, compatibility/migration, multi-tenancy/security, cost/operational
ownership, and incremental rollout—not only tool names.

## 6. Exit checklist

- [ ] I reproduce and trace production artifacts.
- [ ] I design idempotent validated training/backfills.
- [ ] I capacity-plan and safely deploy inference.
- [ ] I monitor every layer and handle delayed/selected labels.
- [ ] I distinguish retraining from incident repair.
- [ ] I design platform isolation/reliability/security/cost.
- [ ] I completed the game-day production capstone.

