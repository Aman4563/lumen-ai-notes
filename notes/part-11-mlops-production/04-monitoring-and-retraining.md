# Chapter 4 — Monitoring, Drift, Incidents, and Retraining

## 1. Monitoring hierarchy

```text
service -> data/features -> prediction/action -> model quality -> product/safety
fast labels --------------------------------------------------> delayed outcomes
```

Each layer can fail independently. Dashboards without decisions/owners/runbooks are
not monitoring.

## 2. Service signals

- traffic/shape/batch/tenant;
- success/error/timeout/retry/fallback;
- p50/p95/p99 end-to-end and stages;
- queue depth/age, saturation;
- CPU/GPU/memory/disk/network;
- cache hit/eviction;
- dependency health;
- cost.

Use SLO and error budget. Alert symptoms users feel and actionable root-cause
signals, avoid cardinality explosion.

## 3. Data/feature signals

- schema/unknown category;
- missing/default/nonfinite/out-of-range;
- freshness/event delay;
- quantiles/category mix;
- join coverage;
- online/offline parity;
- entity/source/segment coverage;
- label volume/prevalence/maturity.

Feature monitor reference must account seasonality/product changes. Statistical
significance with huge traffic is not practical significance.

## 4. Drift detection

- PSI;
- KS for continuous;
- chi-square/category;
- KL/JS;
- Wasserstein;
- embedding two-sample/classifier;
- score/action shifts.

Multiple features/tests create alert noise. Track effect size, sample support,
criticality, persistence, and correlation with quality. Drift detector does not
tell cause or prescribe retraining.

## 5. Delayed quality

Join prediction/action with mature outcome using stable IDs and model/policy. Handle:

- label delay/censoring;
- selective labels due action;
- duplicates/reversals;
- late corrections;
- attribution window;
- experiment/traffic mix.

Report performance by prediction time (not label arrival only) and maturity status.

## 6. Proxy/leading signals

Before labels:

- score/action distribution;
- model disagreement/champion shadow;
- feature health/skew;
- user reports/overrides;
- retrieval/tool success;
- uncertainty/OOD;
- rule/model consistency.

Leading proxies can miss concept drift; never replace mature outcome indefinitely.

## 7. Calibration and threshold monitoring

Reliability by time/slice. Prevalence shift can alter calibration/precision while
ranking stable. Fixed threshold action volume can exceed capacity. Monitor expected
versus actual cost, queue load. Recalibrate/rethreshold may suffice without retrain,
but validate and version.

## 8. Slice monitoring

Predefined high-impact groups plus discovered error clusters. Include sample and
uncertainty, control multiple alerts, privacy/legal access. Aggregate stable while
new users/region/language fails.

## 9. Alert design

An alert states:

- user/business impact;
- condition/window/severity;
- current/reference/support;
- affected model/features/segments;
- likely causes/dependencies;
- owner/runbook/dashboard;
- automated mitigation/rollback.

Test alerts via game days. Suppression/dedup/maintenance windows.

## 10. Incident response

1. detect/declare/severity/owner;
2. protect with rollback/fallback/load shedding;
3. scope time/traffic/versions/actions;
4. correlate deployment/config/data/dependency;
5. diagnose using lineage/log/replay;
6. fix and validate/canary;
7. quantify impact/notify;
8. blameless postmortem and prevention.

Do not delay mitigation to prove root cause when harm ongoing.

## 11. Common incident tree

```text
quality drop
├── service: timeouts/fallback/wrong version
├── input: schema/unit/freshness/missing
├── skew: offline/online transform
├── policy: threshold/action/capacity
├── distribution: covariate/concept/prevalence
├── label: delay/source/definition
└── evaluation: metric/join/logging bug
```

## 12. Retraining triggers

- schedule;
- enough mature new data;
- performance degradation;
- meaningful drift validated;
- source/product/policy change;
- new class/domain;
- model/security fix.

Retraining can worsen under corrupted/poisoned/selected labels. Candidate must pass
same gates and rollout.

## 13. Window strategy

- expanding: more data/stability, stale regimes;
- sliding recent: adapt, less data/forget rare season;
- weighted time decay;
- stratified replay of historical rare cases;
- domain-specific mixture.

Backtest windows/retrain cadence under historical timeline, including label delay.

## 14. Continual/online learning

Benefits rapid adaptation; risks catastrophic forgetting, feedback poisoning,
nonreproducibility, instability. Use replay, regularization, bounded updates,
validation buffer, champion rollback, anomaly filters, audit. High-impact systems
often prefer batch controlled retraining.

## 15. Model retirement

- identify consumers/traffic;
- migrate/verify;
- stop serving/training;
- archive required artifacts/audit;
- revoke endpoints/permissions;
- delete data/artifacts per retention;
- remove monitors/jobs/cost;
- preserve decision history needed.

## 16. Exercises

1. Create monitor matrix with signal/threshold/owner/action.
2. Simulate unit-change feature incident and runbook.
3. Join delayed labels without censoring bias.
4. Backtest retraining windows under drift.
5. Design online-learning safety gates and poisoning defense.

