# Chapter 4 — Reliability, Safety, Governance, and Senior Leadership

## 1. Reliability is user-visible behavior

Define SLO for successful useful response, not merely HTTP 200. Example:

> 99.9% eligible ranking requests return a policy-valid list within 150ms over 28d

Quality delayed cannot be strict instant SLI, but online proxies/guardrails and
periodic outcome objectives complement.

## 2. Error budgets

99.9% allows ~0.1% unsuccessful under definition/window. Use budget to balance
release velocity/reliability. If exhausted, slow risky changes/fix reliability.
ML quality regression and service error may need separate budgets/gates.

## 3. Graceful degradation ladder

Example recommender:

1. full fresh personalized multi-stage;
2. cached user features/candidates;
3. smaller ranker;
4. followed/category popularity;
5. generic safe content;
6. error only if no safe fallback.

Test quality/safety of each. Fraud/credit may use conservative challenge/manual
rather than fail-open.

## 4. Dependency failures

For feature store, model server, index, external model API:

- deadline/timeout;
- retry policy/idempotency;
- circuit breaker;
- cache/stale tolerance;
- fallback;
- capacity isolation/bulkhead;
- health/readiness;
- telemetry;
- regional failure.

Prevent retry amplification: outer layers coordinate budgets, no each layer 3×.

## 5. Data/model incident severity

Severity based on affected users, decision harm, irreversibility, privacy/security,
duration, workaround—not only traffic. A low-volume credit bias or data leak is
critical.

Prepare kill switches per model/feature/action and communication paths.

## 6. Responsible AI design review

At requirements:

- legitimate purpose/necessity;
- affected stakeholders/harm;
- automated versus human authority;
- alternatives/non-ML;
- data rights/selection;
- metrics/slices/fairness;
- explanation/recourse;
- security/abuse;
- monitoring/retirement.

Document decisions and unresolved risks. Governance should enable safe progress,
not checkbox or vague blocker.

## 7. Fairness in systems

Analyze pipeline:

- access/eligibility;
- data/labels;
- model scores/calibration;
- thresholds/policy;
- downstream human/action;
- feedback/appeal.

Equal score metric can still yield unequal outcome due action/cost/access. Group
metrics may conflict under different base rates. Choose based on harm/legal/domain,
include uncertainty/intersection support, and test interventions.

## 8. Privacy by design

- minimize inputs/context/logs;
- process on-device/aggregate where helpful;
- purpose/retention/deletion;
- access/tenant/region;
- encryption/secret separation;
- no sensitive debug dump;
- lineage and model/data deletion handling;
- privacy threat tests.

Differential privacy: mechanism bounds how much one person's data changes output
under formal ε/δ definition. Trade utility, composition/accounting, clipping/noise,
does not solve group/privacy outside threat model.

Federated learning keeps raw data local but gradients/updates can leak and clients
poison; secure aggregation/DP/auth needed.

## 9. Security design

Threat model assets/actors/trust boundaries. Classical: poisoning/evasion/extraction/
membership/supply chain. GenAI: prompt injection/tool abuse/exfiltration. Controls
at authorization/data/artifact/runtime, not model behavior alone.

Red-team realistic adversary and rate/monitor/respond. Security-through-obscurity
is supplemental.

## 10. Governance artifacts

- impact/risk assessment;
- data/model/system cards;
- experiment/evaluation reports;
- approvals/exception;
- change/audit logs;
- incident/postmortem;
- user notice/recourse;
- retention/retirement.

Automate provenance and required gates; preserve human accountability.

## 11. Senior technical leadership

### Scope ambiguity

Frame decision, state assumptions, gather stakeholders, prototype instrumented
baseline, define reversible milestones.

### Technical strategy

Connect outcome to architecture principles, sequence investments, define buy/build,
interfaces, migration, success measures. Avoid roadmap of tools.

### Cross-team influence

Clarify ownership/RACI, written design/RFC, seek dissent, incorporate security/
legal/ops early, align incentives/adoption, communicate decisions.

### Mentorship

Raise quality through reviews, templates, debugging methods, opportunities and
feedback; not merely fixing code yourself.

### Operational excellence

SLOs/on-call/runbooks/game days/postmortems and capacity. Senior engineer owns
system lifecycle and reduces recurring toil.

## 12. Migration planning

Example from batch rule scores to online model:

1. instrument current and contracts;
2. dual-write features/logs;
3. backfill/validate parity;
4. shadow candidate;
5. canary subset/action;
6. gradual regional/team adoption;
7. preserve fallback/rollback;
8. deprecate old after no consumers;
9. retire data/jobs.

Define compatibility, cutover, ownership, success, cost. Big-bang rarely needed.

## 13. Decision records

Capture context, options, decision, trade-offs, consequences, date/owners, revisit
trigger. Useful senior signal: explain what evidence would make architecture change.

## 14. Conflict/trade-off communication

Use evidence:

- shared goal/constraints;
- alternatives and measured impact;
- reversible experiment;
- explicit owner/decision mechanism;
- dissent recorded;
- commit after decision;
- revisit trigger.

Avoid “I convinced everyone”; show listening and durable outcome.

## 15. SDE-II versus SDE-III behavior examples

| Area | SDE-II | SDE-III |
|---|---|---|
| component | correct scalable implementation | system boundary/API used by teams |
| failure | retries/fallback | SLO/error budget/cross-dependency incidents |
| data | pipeline tests | contracts/ownership/migration/governance |
| model | metrics/tuning | product objective/feedback/strategy |
| rollout | canary | gates/experiments/org adoption/rollback |
| cost | optimize service | portfolio/unit economics/capacity strategy |
| influence | collaborate team | align multiple teams and mentor leads |

## 16. Exercises

1. Write SLO/error budget/degradation for three systems.
2. Run responsible AI review for automated hiring—include whether to build.
3. Threat-model an agent with email/refund tools.
4. Plan feature-platform migration for five teams.
5. Write decision record for buy versus build inference platform.

