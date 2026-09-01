# Part 10 — Specialization Interview Workbook and Capstones

## 1. Cross-domain prompts

For any prompt answer:

1. decision and causal/action loop;
2. unit/timestamp/horizon;
3. labels/exposure/selection;
4. simple domain baseline;
5. offline split/metric and online experiment;
6. domain model/feature trade-offs;
7. serving/latency/scale;
8. feedback/adversary/interference;
9. safety/fairness/privacy;
10. rollout/monitoring/evolution.

## 2. Rapid distinctions

- Ranking relevance versus click prediction: clicks include exposure/position and
  are a proxy; relevance can be graded/expert.
- Forecast versus causal scenario: forecasting uses associations under expected
  policy; intervention changes covariates/outcome.
- Anomaly versus fraud: rarity versus harmful intent.
- Uplift versus risk: incremental treatment effect versus outcome probability.
- Bandit versus MDP: immediate contextual action versus long-term state transition.
- Transductive versus inductive graph: fixed graph unlabeled nodes versus new
  nodes/graphs/domains.

## 3. Capstone options

### Recommendation/ranking

Two-stage retrieval/rank/re-rank; temporal exposure-aware dataset; baselines;
recall@K/NDCG/diversity; ANN serving; online experiment/ecosystem.

### Forecasting

Multi-series rolling backtest; seasonal baseline; ETS/GBDT/deep candidate;
probabilistic intervals; hierarchy; known-future audit; cost/monitoring.

### Fraud

Rules + calibrated GBDT/graph features; mature/selective labels; amount-weighted
policy; 100ms service/fallback; attack monitoring/review/appeal.

### Causal/uplift

Randomized or defensible observational data; DAG/estimand/overlap; outcome/IPW/AIPW/
CATE; policy value; sensitivity and prospective experiment.

### RL/bandit

Simulator or safe logged domain; supervised/bandit baseline; reward/constraints;
off-policy eval; phased safe rollout. Never uncontrolled high-impact exploration.

### Graph

Temporal node/link task; classical baseline; GraphSAGE/GNN; target-edge leak audit;
new-node evaluation; sampling/index/serving.

## 4. Portfolio standard

Deliver data/model card, reproducible code/tests, experiment table, error analysis,
architecture/estimates, online plan, monitoring/runbook, and a failed hypothesis.

## 5. Exit checklist

- [ ] I can explain every specialization's distinctive data bias/objective.
- [ ] I can choose prediction versus causal/RL formulation.
- [ ] I understand exposure, temporal, adversarial, interference, graph leakage.
- [ ] I completed at least one specialization capstone deeply.
- [ ] I can system-design at least three tracks orally.

