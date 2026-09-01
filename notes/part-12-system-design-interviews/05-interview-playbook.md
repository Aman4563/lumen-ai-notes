# Chapter 5 — Complete Interview Preparation Playbook

## 1. Interview loops by role

### ML engineer / SDE ML

- coding/DSA;
- Python/SQL/data;
- ML fundamentals/math;
- model/project deep dive;
- ML system design;
- general system design;
- behavioral/leadership.

### Applied AI/LLM engineer

Adds transformers/RAG/evals/agents/security/LLM serving; backend coding remains.

### Data scientist

More statistics/SQL/experimentation/product cases/modeling; production depth varies.

### Research/applied scientist

More math/papers/novel experiments/model coding/research presentation.

## 2. 12-week interview plan

Adapt after diagnostic.

| Weeks | Focus |
|---|---|
| 1–2 | fundamentals formulas + Python/SQL diagnostic |
| 3–4 | supervised/unsupervised/deep drills + DSA patterns |
| 5–6 | specialization + project deep-dive narrative |
| 7–8 | ML system designs, 3/week |
| 9 | general distributed systems + MLOps incidents |
| 10 | LLM/RAG/eval if relevant; responsible AI |
| 11 | behavioral stories and mock loops |
| 12 | targeted weak areas, full simulations, rest/logistics |

Daily: 45–60 min coding/SQL, 45 min ML recall/derivation, 45–90 min design/project.
Use spaced repetition/error log.

## 3. Fundamentals answer structure

For concept:

```text
definition -> intuition -> formula/assumptions -> example
-> compare alternatives -> failure/diagnosis -> production relevance
```

Example “regularization”: objective penalty/constraint, bias–variance, L1/L2,
scaling/λ CV, too much underfits, model/data-specific and production stability.

## 4. Coding preparation

Prioritize arrays/hash/sliding window, heap/top-k, tree/graph BFS/DFS, binary search,
intervals, DP, concurrency/data-processing tasks. Write tests/complexity aloud.

For ML coding also implement:

- metrics/confusion;
- linear/logistic gradient;
- k-means;
- tree split;
- batching/streaming top-k;
- sampling;
- simple feature pipeline;
- stable softmax/attention shapes.

## 5. SQL preparation

Master joins/grain, windows/rank/lag/rolling, cohorts/retention/funnels,
dedup/sessionization, experiments/SRM, point-in-time features. Explain NULL/ties/
performance/index/partition.

## 6. ML fundamentals bank

Be ready:

- bias/variance/generalization/regularization;
- losses/metrics/threshold/calibration;
- splits/CV/leakage/shift;
- linear/logistic/NB/kNN/SVM;
- trees/RF/boosting;
- clustering/PCA/anomaly;
- deep backprop/norm/optimizer;
- CNN/RNN/attention/transformer;
- experimentation/causality;
- production monitoring/retraining.

Do not memorize one sentence; interviewer changes assumption.

## 7. Project deep dive

Prepare 10–15 minute and 2-minute versions:

1. context/user/problem and your role;
2. baseline/data/constraints;
3. alternatives/trade-off/decision;
4. implementation/architecture;
5. evaluation and actual impact with numbers;
6. failure/diagnosis/iteration;
7. production/monitoring/ownership;
8. what you would change now.

Quantify dataset/traffic/latency/model/KPI/team/timeline. Distinguish your work from
team. Explain one deep technical component and one cross-team decision.

### Follow-ups

- why not simpler model?
- label/leakage?
- offline-online gap?
- biggest failure?
- scale 10×?
- fairness/privacy?
- how know impact causal?
- cost?
- disagreement?
- maintenance after you left?

## 8. Behavioral story bank

Prepare STAR/CARE stories:

- ambiguous ownership;
- high-impact failure/incident;
- disagreement/conflict;
- influence without authority;
- prioritization/trade-off;
- mentoring;
- quality/operational improvement;
- project miss and learning;
- ethical/safety concern;
- strategy/migration.

Structure:

```text
situation (brief) -> task/constraints -> actions and reasoning
-> measurable result -> learning/what changed systemically
```

Senior stories show mechanisms and durable team/system impact, not heroics.

## 9. Design practice scoring

After mock score 0–2:

- requirements/outcome;
- ML framing/data/label;
- estimates;
- baseline;
- offline/online architecture;
- metrics/experiment;
- reliability/fallback;
- monitoring/feedback;
- security/privacy/fairness;
- cost/migration/ownership;
- communication/time.

Record one priority fix and redo within 48h.

## 10. Communication

- lead with assumptions and invite correction;
- top-down architecture then deep dive;
- name trade-off and decision criteria;
- use concrete numbers;
- summarize every 10 minutes;
- if uncertain, propose measurement/prototype;
- do not flood every technology;
- listen to hint and adapt;
- reserve closing minute.

## 11. Resume alignment

Every bullet defensible:

> action + technical scope + scale/constraint + measured outcome

Example: “Designed point-in-time feature pipeline processing 2B events/day,
reducing training-serving mismatch incidents 60% and p99 freshness from 4h to 20m.”

Be prepared to explain measurement/attribution. Do not list technologies without
use depth.

## 12. Mock interview progression

1. self-record answers;
2. peer one-topic;
3. timed full design;
4. adversarial follow-up;
5. complete loop/day;
6. company/role-specific.

Review content and delivery separately. Do not do only comfortable mocks.

## 13. Questions for interviewer

Ask about problem/ownership, data/feedback, system scale, evaluation/experiments,
operational model, team interfaces, current technical challenge, role success and
growth. Avoid questions answered trivially publicly unless context-seeking.

## 14. Final-week checklist

- project numbers and diagrams;
- 8 behavioral stories;
- 6 ML designs and 2 GenAI if role;
- formula/metric sheet;
- coding/SQL error patterns;
- environment/interview logistics;
- questions/company context;
- sleep/rest.

