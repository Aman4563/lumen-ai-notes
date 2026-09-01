# Chapter 2 — Canonical ML System Architectures

## 1. Search ranking

### Requirements

Query over billions docs, top 10 under ~200ms, relevance/freshness/authority/safety,
ACL and multilingual.

### Design

1. ingest parse/dedup/ACL/index;
2. sparse inverted + dense ANN candidate retrieval;
3. union/filter permission;
4. lightweight pre-rank;
5. cross-feature/neural rerank;
6. diversity/policy;
7. cache safe queries;
8. log query/candidates/exposure/click/dwell/reformulation.

### Labels/bias

Clicks position/exposure biased; expert relevance and randomization/interleaving.
Temporal/query-group split, tail/new docs.

### Metrics

Recall@K retrieval, NDCG/MRR, reformulation/satisfied success, latency, zero results,
safety/ACL. Feedback loops/SEO abuse.

## 2. Feed/recommendation

Candidate sources: followed, similar, trending, exploration. Two-tower/graph retrieval,
GBDT/deep ranker for expected multi-objective utility, re-rank diversity/creator/
policy. Online user/session features + batch item embeddings.

Labels include clicks/watch/hide/survey/long-term retention; proxy risks. Log
exposure/position/propensity. Cold start, popularity, creator ecosystem, harmful
engagement. Cache candidates, online rank within 100–200ms, fallback popularity.

## 3. Ads ranking

Pipeline eligibility/targeting → retrieval → predict CTR/conversion/value → auction/
pacing/budget → policy.

Expected value concept:

> bid/value × predicted action probability × quality adjustments

Calibration critical for pricing/allocation. Delayed conversion attribution,
selection, advertiser/user/fraud. Metrics revenue plus user experience, advertiser
ROI, fairness, policy. Low latency/high QPS; feature freshness/budget consistency.

## 4. Fraud detection

See Part 10: preauthorization features, graph/velocity, rules+GBDT+policy, multiple
actions, 50–100ms, delayed selective labels, amount-weighted recall at legitimate
decline, review capacity, adversary. Strong fallback and audit/appeal.

## 5. Spam/content moderation

Cascade:

- known hash/rules/security;
- cheap high-recall model;
- expensive multimodal/context model;
- policy by severity/confidence;
- human review/appeal;
- campaign clustering.

Labels subjective/policy-version/reports selected. High precision for irreversible
removal; warning/quarantine lower threshold. Multilingual/adversarial. Reviewer
well-being/privacy. Monitor prevalence, campaigns, over-removal, appeal reversals.

## 6. ETA estimation

Prediction at request/order milestones; route/distance/traffic/weather/courier/
restaurant/store features available. GBDT/deep spatial-temporal, quantile forecasts.

Labels actual duration; cancellations/censoring, action/promise affects operations.
Geographic/time split and new-region. Metrics MAE/quantile coverage/tail/bias by
region/distance; product on-time promise/satisfaction. Fresh traffic feature,
fallback route historical, batch/online hybrid.

## 7. Demand forecasting

Product-store-day/week, horizon, known promotions, seasonal naïve + global GBDT/
probabilistic model, rolling backtest, hierarchy reconciliation, quantiles. Inventory
action costs stockout/waste; data affected by stockout (sales ≠ demand), price/
promotion causal. Batch pipeline and manual overrides, monitor bias/coverage.

## 8. Churn/intervention

Weekly eligible user score for 30-day churn. Risk model alone targets high-risk, but
offer policy needs uplift/experiment. Features history up to origin; cancellations
label delay. GBDT/logistic, calibration. Metrics PR/cost, incremental retention/
margin, notification/discount guardrails. Avoid spamming, fairness/consent.

## 9. Credit/risk decision

High impact: explainability, regulation, bias/fairness, adverse action/appeal,
stability. Labels only approved applicants/selective, delayed default. Rules +
scorecard/logistic/GBDT under governance. Calibrated probability of default, loss
given default, exposure:

> expected loss ≈ PD × LGD × EAD

Policy constraints, stress tests, temporal/economic shift, monitoring, manual review.

## 10. Dynamic pricing

Predict demand/elasticity and optimize price under inventory/constraints. Historical
price endogenous; simple supervised demand model cannot estimate counterfactual.
Randomized pricing or causal/instrumental approaches with safeguards. Fairness/
legal/user trust, surge caps, competitor response. Online optimization and rollback.

## 11. Notification system

Candidates from events; eligibility/quiet hours/consent; predict value/annoyance;
frequency cap and scheduling; contextual bandit exploration. Metrics open/action
but long-term retention, opt-out, complaints. Cross-notification interference,
delayed effects, fatigue. Default no-send is valid action.

## 12. Autocomplete/typeahead

Prefix retrieval trie/FST, popularity/recency/personalization, spelling, neural
rerank/generation constrained. Extremely low latency (<50ms), high QPS, cache,
incremental index. Safety/privacy: no private query leakage/offensive suggestions,
k-anonymity thresholds, regional trends. Metrics keystrokes saved, acceptance,
zero/unsafe, latency.

## 13. Visual product search

Image/text dual encoder → ANN candidates → multimodal/metadata rerank → availability/
policy/diversity. Pair labels from clicks/purchases exposure biased. Dedup products,
new catalog, exact attributes. Image processing latency/caching; index freshness,
ACL/market inventory. Recall/NDCG and conversion plus irrelevant/sensitive.

## 14. Common architecture decisions table

| System | Dominant bottleneck | Critical bias | Essential fallback |
|---|---|---|---|
| search | retrieval/rerank latency | position/exposure | sparse/popularity |
| feed | fresh personalization | feedback/popularity | followed/trending |
| ads | QPS/calibration | auction/exposure | rule/simple score |
| fraud | latency/adversary | selective labels | rules/challenge |
| moderation | multilingual/novel abuse | reports/policy | quarantine/review |
| ETA | fresh geospatial context | cancellations/policy | route historical |
| forecasting | horizon/stockouts | observed sales | seasonal naïve |
| credit | governance/shift | approvals | manual/policy |

## 15. Deep-dive prompts

For each canonical design, be ready to deep dive:

- data schema and point-in-time join;
- candidate/index architecture;
- feature store freshness;
- model objective/calibration;
- label/exposure correction;
- capacity estimate;
- rollout/experiment;
- drift/incident;
- privacy/fairness/adversary;
- next version migration.

