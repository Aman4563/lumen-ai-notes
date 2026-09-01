# Track 3 — Fraud, Abuse, and Rare Events

## 1. Domain characteristics

- extreme imbalance;
- adaptive adversary;
- delayed/noisy/selective labels;
- network/graph behavior;
- real-time latency;
- asymmetric amount/user harm;
- multiple actions/review capacity;
- regulation/appeal/explanation;
- fraud type evolution.

Treat as decision system, not static classifier.

## 2. Prediction and actions

Score risk before transaction/action. Policy:

- approve/allow;
- step-up authentication/challenge;
- delay/limit;
- human review;
- decline/block;
- monitor.

Each action has cost and changes label observability. Calibrated expected loss:

> choose action a minimizing Σ<sub>y</sub>P(y∣x)C(a,y,x)

with capacity, policy, and fairness constraints.

## 3. Labels

- chargeback/confirmed account takeover;
- user report;
- analyst decision;
- rule block;
- law-enforcement/partner signal;
- refund/dispute.

Keep source/confidence/maturity/reversal. Analyst decision is influenced by old
score; blocked cases lack counterfactual outcome. Random audits and challenge
outcomes can reduce blind spots.

## 4. Features

- transaction amount/merchant/channel;
- account/device/payment age;
- velocity windows;
- deviation from user history;
- device/IP/location consistency;
- shared entities/graph components;
- merchant/device reputation point-in-time;
- sequence patterns;
- authentication outcome available before decision;
- feature-quality/staleness.

Avoid post-decision investigation. Reputation uses only mature prior labels.

## 5. Models

- rules for known threats/hard policy;
- regularized logistic baseline and scorecards;
- GBDT for tabular interactions;
- sequence model;
- graph features/GNN;
- anomaly for emerging patterns;
- ensemble/cascade.

Rules provide instant response and explanation but attackers evade; models
generalize but drift/probabilistic. Hybrid defense in depth.

## 6. Evaluation

- recall at fixed legitimate decline/FPR;
- precision/review yield at capacity;
- fraud dollars captured/lost, not counts only;
- legitimate approval/conversion;
- calibration/expected cost;
- time to detect;
- recall by fraud type/amount/segment/new attack;
- customer friction/appeals;
- p99 latency/availability.

Temporal attack holdout and campaign/entity grouping. Mature labels only. Evaluate
policy actions, not score AUC alone.

## 7. Selective labels and counterfactuals

Declined transactions never reveal ordinary chargeback. Training only approvals
creates selection. Options:

- low-risk randomized exploration where safe/legal;
- step-up authentication as signal;
- analyst/random audits;
- delayed/partner labels;
- inverse propensity/off-policy estimators under assumptions;
- reject inference cautiously;
- simulation/synthetic attacks only supplemental.

Do not casually approve risky payments “for labels”; safety/ethics first.

## 8. Adversarial adaptation

Attackers probe thresholds/features, create identities, poison reports, coordinate
graphs, shift merchants/amounts. Defenses:

- rate/velocity/device graph;
- randomized/hidden policy within legal bounds;
- rule/model/version diversity;
- fast campaign detection and response;
- adversarial red team;
- feature secrecy without security-through-obscurity dependence;
- secure logging and insider controls.

## 9. Real-time architecture

```text
authorization -> local rules/cache -> fresh feature service
-> fast model -> policy/challenge/review -> decision within deadline
-> immutable decision log -> delayed outcomes -> training/monitoring
```

Fallback per risk: cached features/simple model/rules, circuit breaker. Feature
outage must not become automatic approve or global decline without policy.

## 10. Monitoring

- service/feature freshness;
- score/action/challenge/decline rates;
- rule/model overlaps;
- merchant/device/geo campaigns;
- mature fraud/approval/calibration;
- selective label coverage;
- analyst queue/decision/overrides;
- user complaints/appeals;
- attack probes/data poisoning;
- cost/latency.

## 11. Exercises

1. Define cost/action thresholds with review capacity.
2. Construct forward/grouped fraud split.
3. Simulate selective-label bias.
4. Design 80ms serving/fallback.
5. Write incident runbook for score collapse and attack spike.

