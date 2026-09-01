# Chapter 5 — Data and Feature Interview Workbook

## 1. Rapid answers

### Why fit preprocessing on training only?

Using validation/test statistics lets held-out distribution influence training and
makes evaluation optimistic. In cross-validation, refit transformations per fold.

### Standardization versus normalization?

Terminology varies. Standardization commonly subtracts feature mean/divides SD;
normalization may mean scaling range or each vector to unit norm. State formula.

### One-hot versus target encoding?

One-hot is label-free and interpretable but large for high cardinality. Target
encoding is compact/predictive but label-leaky without out-of-fold/time-aware
construction, unstable for rare/new categories, and needs smoothing.

### How do you handle missing values?

First identify mechanism/semantics and pipeline incidents. Choose model-aware
imputation/native handling, missing indicators, fit state on training, evaluate
slices, and monitor serving missingness. Deletion is not a default.

### What is point-in-time correctness?

Every historical feature equals information that would have been available at the
prediction timestamp, respecting event time, ingestion delay, label maturity, and
window boundary.

### Why can oversampling hurt probability output?

It changes training class prior and possibly loss weighting. Ranking may improve
but raw probabilities need correction/calibration on representative prevalence.

### How do you handle unseen categories?

Reserve unknown bucket, hashing, model-native handling, or learned fallback. Log
rate and distinguish new valid category from schema bug. Never crash silently or
map to a meaningful existing class.

### Feature importance equals causal influence?

No. Importance describes model dependence under representation/background;
correlation, substitutes, selection, and proxies matter. Causality requires an
intervention/identification strategy.

## 2. Scenario drills

### Scenario A: random split is 95% accurate, temporal split 72%

Investigate future aggregation, duplicates/entities across random split, policy/
schema era, stale features, label maturity, and concept drift. Temporal result is
closer to future deployment. Compare time slices, audit strongest features, and
simulate availability.

### Scenario B: nulls replaced by zero and performance rose

Maybe missingness is predictive, but zero conflates real absence and unavailable.
Check source/segment/time, add missing indicator or native missing, simulate source
outage, and monitor. Gain may be shortcut to historical collection policy.

### Scenario C: target encoding makes AUC jump 0.20

Assume leakage until disproven. Verify out-of-fold training values, held-out mapping
from training only, smoothing, category/entity overlap, temporal maturity, and
rare IDs. Compare group/time holdouts and category counts.

### Scenario D: new model degrades only for new users

Historical/ID features and target encodings likely fail cold start. Evaluate
history length, missing/default semantics, unknown categories, separate model/
fallback for new users, and collect contextual features.

### Scenario E: online score distribution shifts but source data looks stable

Check feature availability/freshness, transform/model version, online/offline parity,
unit/default/category mapping, request traffic mix, upstream model features, and
policy threshold. Source warehouse aggregates can hide online serving outage.

## 3. Leakage checklist exercise

For each feature answer: available? label-derived? group contamination? policy-
sensitive? legal/stable? serving parity?

1. customer lifetime spend when predicting first-30-day churn;
2. physician's final diagnosis when predicting at admission;
3. product return rate computed from full year for a January prediction;
4. document embedding trained on unlabeled test corpus;
5. user's historical average using future events;
6. reviewer decision used to predict which cases get reviewed;
7. current model score as feature for a new model.

Answers vary by timestamp/intended process. The exercise is to state conditions,
not label every item categorically.

## 4. Part 4 capstone

Create a reproducible, point-in-time dataset and feature pipeline for 30-day churn.

### Required design

- Unit: eligible account at weekly scoring timestamp.
- Observation: prior 90 days.
- Outcome: qualifying churn/cancellation in next 30 days, with maturity cutoff.
- Split: forward time and account grouping.

### Required artifacts

1. Data card with provenance, grain, timestamps, population, label, limitations.
2. Source contracts and validation report.
3. SQL or dataframe point-in-time construction.
4. Feature catalog with 25+ numeric/categorical/temporal/behavior features.
5. Train-only preprocessing pipeline with unknown/missing behavior.
6. Leakage audit and automated split-disjointness tests.
7. Baseline model and error/slice analysis.
8. Imbalance strategy comparing weights, thresholds, and optionally sampling.
9. Offline/online parity fixtures for five features.
10. Monitoring, backfill, versioning, privacy, and deletion plan.

### Advanced extensions

- out-of-fold, time-aware target encoding;
- streaming recency/count feature with late events;
- label-source/noise analysis;
- training data selection under historical retention intervention;
- feature-family ablation including latency/cost.

## 5. Rubric

| Dimension | Beginner-complete | Advanced-complete |
|---|---|---|
| Grain/time | written unit/window | event + availability + maturity boundaries tested |
| Data quality | schema/null checks | reconciliation, source SLA, segment/time monitors |
| Labels | definition | provenance, noise, selection, version, adjudication |
| Features | reasonable list | domain features, cold start, stability, total cost |
| Leakage | obvious future fields removed | OOF/group/time/aggregation/preprocessing audit |
| Pipeline | reproducible train transform | parity, lineage, backfill, migration, fallback |
| Evaluation | baseline metric | real prevalence, calibration, slices, uncertainty |
| Governance | privacy note | purpose/access/retention/deletion/owner |

## 6. Exit checklist

- [ ] I can explain every dataset row, key, and timestamp.
- [ ] I can audit structural, semantic, temporal, and selection quality.
- [ ] I fit all learned transformations only on training folds.
- [ ] I choose preprocessing based on data and model, not recipes.
- [ ] I design leakage-safe aggregate/target/time features.
- [ ] I treat imbalance through metrics, learning, and policy.
- [ ] I can design feature lineage, parity, backfill, and deprecation.
- [ ] I completed the capstone or an equivalent real dataset pipeline.

