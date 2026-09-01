# Chapter 3 — Senior and Domain Interview Synthesis

## 1. Interview loop map

| Round | Evidence expected |
|---|---|
| Coding/DSA | correct code, complexity, tests, communication, edge cases |
| ML fundamentals | derivations, assumptions, model/data/evaluation failure modes |
| ML coding | tensor/data pipeline correctness, numerics, experiment design |
| Domain depth | papers/mechanisms, implementation, profiling and ablations |
| System design | requirements, estimates, architecture, reliability, safety, cost |
| Project deep dive | personal decisions, metrics, failures, debugging, impact |
| Behavioral/leadership | ownership, conflict, ambiguity, mentoring, strategy, learning |

## 2. Role emphasis

- ML engineer: Parts 3–8, 11–14, 18, 21, 22.
- Applied LLM/post-training engineer: Parts 8, 13, 16–22.
- Training infrastructure: Parts 3, 11, 13–15, 18, 21.
- Inference engineer: Parts 7–8, 14–15, 17–18, 21–22.
- Research engineer: Parts 2, 7–9, 13, 15–20, 22.
- Research scientist: add graduate-depth theory and current literature/research
  evidence in a specialization; this repository is a base, not a substitute.
- SDE-II/SDE-III on AI product: Parts 3, 8, 11–14, 21–23 plus relevant modeling.

## 3. System-design response spine

```text
clarify users and decision -> define success and guardrails -> estimate scale
-> establish baseline -> design data/labels/evaluation -> model/training
-> serving and feedback -> reliability/security/privacy/safety
-> rollout/monitoring/cost -> alternatives and evolution
```

Quantify at least QPS/arrivals, item/token sizes, storage/retention, latency budget,
batch/concurrency/KV memory, training frequency/compute, and cost. State assumptions
and calculate units; false precision is worse than a transparent estimate.

## 4. Depth answer pattern

For an algorithm/technology:

1. problem and assumptions;
2. mechanism and central equation/data flow;
3. implementation and complexity/resource needs;
4. failure modes and diagnostic signals;
5. alternatives and selection criteria;
6. production, security, and operational implications;
7. experiment that would change your decision.

## 5. Project deep dive

Prepare a 2-minute overview and 30-minute depth. Own precise contributions without
inflating team work. Be ready for data lineage, baseline, metric validity, hardest
bug, failed approach, ablation, architecture, scaling, incident, privacy/security,
cost, organizational trade-off, and what you would change now.

Senior signal is not maximum complexity; it is choosing the simplest system that
meets constraints, identifying irreversible decisions, creating leverage for
others, and managing risk under ambiguity.

## 6. Technology selection matrix

Never answer only with a brand. Compare:

| Dimension | Questions |
|---|---|
| Correctness/fit | Does it support model, objective, precision, topology, semantics? |
| Performance | Representative throughput, tail latency, memory, startup, scaling? |
| Operability | Debugging, observability, checkpoint/upgrade/rollback? |
| Security/governance | identity, isolation, provenance, license, vulnerabilities? |
| Ecosystem | maturity, maintainers, interoperability, migration path? |
| Cost | compute, storage/network, engineering and operational burden? |
| Lock-in/risk | portable formats/interfaces, failure/vendor contingency? |

## 7. Constraint-change drills

Practice redesign after each change:

- traffic grows 10× and p99 must stay fixed;
- GPU capacity halves;
- labels arrive after 60 days;
- data from one region must be deleted and cannot leave region;
- one protected language regresses;
- a model judge is discovered biased;
- an adaptive attacker controls retrieved documents;
- checkpoint format changes during a long training program;
- budget drops 40% with no primary-quality regression.

Explain what stays invariant, what changes, migration/rollback, and evidence needed.

## 8. Behavioral story bank

Prepare stories for ownership, serious failure, conflict, ambiguity, influencing
without authority, trade-off, mentorship, raising quality, incident, and long-term
strategy. Use context, responsibility, alternatives, action, measured outcome,
reflection. Include your mistaken assumption and changed mechanism; polished
stories with no learning sound shallow.

## 9. Mock interview rubric

Score 0–4 on clarification, fundamentals, numerical correctness, data/evaluation,
scale estimates, architecture, failure/reliability, security/privacy/safety,
trade-offs, communication, and leadership. Record exact weak answers in an error
log and rehearse changed constraints; do not merely watch solutions.

