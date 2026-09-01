# Chapter 1 — Data Lifecycle, EDA, Quality, and Labels

## 1. Start with provenance and grain

Before plotting anything, answer:

- What real-world event/entity creates one row?
- Is a row an observation, snapshot, transaction, or aggregation?
- What is the primary/business key?
- Which timestamps exist and what do they mean?
- Who/what decided that this row is present?
- What population is missing?
- Which code/query produced this snapshot?

Example grains:

- one authorization attempt;
- one user at midnight UTC per eligible day;
- one product-store-week;
- one query-candidate pair;
- one document chunk (not one document).

Never join tables until their grains and key cardinalities are written.

## 2. Data lifecycle

```text
purpose -> collection -> transmission -> raw storage -> cleaning/joining
-> labeling -> feature/dataset version -> training -> serving -> retention/deletion
```

For each step document owner, contract, latency, failure handling, and privacy
authority. A data field can be accurate in the warehouse but unavailable at live
prediction time.

## 3. Dataset inventory

Create a table:

| Field | Meaning |
|---|---|
| source | system/table/topic/provider |
| owner | accountable team/person |
| grain/key | one row and uniqueness |
| event time | when reality occurred |
| availability time | when usable downstream |
| update mode | append, upsert, snapshot, correction |
| schema/units | types, enums, units, timezone |
| retention | availability/deletion rules |
| quality SLA | freshness/completeness/accuracy |
| permission | purpose, access, residency, license |
| known bias | selection/measurement/coverage limits |

## 4. EDA is hypothesis generation plus validation

EDA should discover data behavior and possible errors—not manufacture a story.

### Phase A: structural audit

- row/column counts;
- schema and type coercions;
- primary-key duplicates;
- join cardinalities;
- timestamp coverage/order;
- impossible ranges/units;
- missing rates;
- label counts and maturity;
- exact/near duplicates.

### Phase B: univariate

- numeric quantiles, histogram/ECDF, zero/negative rates;
- categorical frequency, cardinality, unseen/rare levels;
- text length/language/encoding/duplicates;
- image dimensions/channels/corruption;
- time volume/seasonality/gaps.

### Phase C: relationships

- feature–target only on training/development data;
- correlation and nonlinear plots;
- segment/cohort/time breakdown;
- missingness versus label/source/time;
- duplicate/entity/campaign concentration;
- suspected proxies/leakage.

### Phase D: action

For every observation record:

```text
finding -> plausible causes -> consequence -> validation test -> decision/owner
```

Example: “40% missing income” is not a preprocessing decision until you know
whether field is optional, unavailable in one country, pipeline-broken, or
selectively omitted.

## 5. Data quality dimensions

### Completeness

Required records/fields exist. Measure null/default/empty rates by source/time/
segment, not only global.

### Validity

Conforms to type, enum, range, units, format, and logical constraints.

Examples:

- amount ≥ 0 where refunds use separate sign/type;
- event_at ≤ ingestion_at within clock-tolerance policy;
- probability ∈ [0, 1];
- ISO country code in reference table.

### Uniqueness

Business/event keys are unique at intended grain. Retry duplicates may share
idempotency key but differ in ingestion ID.

### Consistency

Cross-field/source agreement: end ≥ start; currency and amount units align;
country/store mapping valid.

### Timeliness

Freshness and event delay meet product SLA. Track quantiles and backlog, not only
last timestamp.

### Accuracy

Values correspond to reality/authoritative source. Requires sampled audits,
reconciliation, or domain validation—schema checks cannot prove accuracy.

### Representativeness

Dataset covers target population across time/domain/segments. Row count alone is
not coverage.

## 6. Data contracts

A contract specifies:

- schema/types/nullability;
- semantic meaning and units;
- key/grain;
- event and availability timestamps;
- allowed evolution;
- freshness/completeness/SLA;
- ownership/escalation;
- privacy/classification/retention;
- consumer compatibility/testing.

Schema compatibility does not guarantee semantic compatibility. Changing
“amount” from dollars to cents while retaining integer type is a breaking change.

Use producer and consumer checks. Quarantine invalid batches/events rather than
silently coercing high-impact fields.

## 7. Duplicates

Types:

- exact duplicated row;
- repeated event from at-least-once delivery;
- multiple snapshots/updates of same entity;
- near-duplicate content/campaign;
- legitimate repeated behavior.

Deduplication requires a business key, event time/version, tie-breaker, and update
semantics. Dropping all duplicate-looking rows can erase real repeated actions.

Near duplicates across train/test allow memorization. Use hashes, normalized
signatures, clustering, or entity/campaign grouping before splitting.

## 8. Outliers: five possible meanings

An extreme value may be:

1. data entry/unit error;
2. pipeline/parser corruption;
3. rare valid observation;
4. distribution from another population;
5. adversarial/important target event.

Actions differ: correct from source, quarantine, transform, cap under justified
measurement limits, use robust loss/model, create indicator, or keep and evaluate
separately.

Detect with domain bounds, robust z-like scores, IQR, isolation methods, and
multivariate/temporal checks. Do not delete based on a universal 3σ rule.

## 9. Labels as measurements

Specify:

- target concept and policy version;
- annotation/operational source;
- positive/negative/abstain/ambiguous definitions;
- outcome window and maturity;
- reviewer qualifications/context;
- consensus/adjudication;
- confidence and source retained;
- coverage/selection;
- quality audits by class/segment/time;
- appeals/reversals/corrections.

### Gold, silver, weak labels

- Gold: high-quality expert/adjudicated, usually small.
- Silver: operational/user behavior with known noise.
- Weak: rules, heuristics, distant supervision, programmatic labeling.

Do not merge them without retaining provenance/confidence. Use gold for evaluation
and calibration where possible; weak labels can scale training with noise-aware
methods.

## 10. Annotation design

1. Write task/ontology and examples/counterexamples.
2. Pilot with multiple annotators.
3. Review disagreements and revise unclear definitions.
4. Sample across likely difficulty/segments, not only easy random cases.
5. Blind irrelevant/model outputs when they would anchor judgment.
6. Insert quality checks but avoid simplistic traps.
7. Measure per-class/annotator confusion and agreement.
8. Adjudicate high-impact ambiguity.
9. Version guideline and relabel when policy changes.

### Agreement

Raw percent agreement ignores chance. Cohen’s κ for two annotators adjusts for
expected chance agreement:

> κ = (p<sub>observed</sub> − p<sub>expected</sub>) / (1 − p<sub>expected</sub>)

Kappa is affected by prevalence and bias; report confusion and disagreement types.
Disagreement may reflect genuine subjectivity, not annotator incompetence.

## 11. Label noise

Class-conditional noise matrix:

> T<sub>ij</sub> = P(observed label = j ∣ true class = i)

Real noise is often instance/segment-dependent. Symptoms:

- irreducible-looking error concentrated by source;
- confident model disagreements validated by experts;
- reviewer drift after guideline change;
- impossible label timing.

Mitigations:

- improve definition/annotation;
- model uncertainty/soft labels;
- robust losses or sample weighting carefully;
- co-teaching/consensus techniques for large noisy datasets;
- audit high-loss examples without assuming model is correct;
- separate policy version/domains.

## 12. Selection and feedback bias

- loans labels only for approved applicants;
- content reports only for exposed/engaged content;
- support labels only for users who contact support;
- human review focuses on high model scores;
- churn survey responds selectively.

Document selection probability/policy and retain exposure/action logs. Use random
audits/exploration where safe and legal. No preprocessing transform can recover
unobserved counterfactual outcomes without assumptions.

## 13. Temporal analysis

Plot by event and ingestion time:

- volume, prevalence, missingness;
- feature quantiles/categories;
- source/schema changes;
- label maturity/reversal;
- model/policy/product releases;
- seasonality and incidents.

Annotate deployments. A “predictive” feature may merely encode a policy era. Use
forward holdouts and recency studies.

## 14. Data cards

A data card contains:

1. motivation/intended use/non-use;
2. composition, grain, counts, slices;
3. collection and selection process;
4. preprocessing and deduplication;
5. label process/quality;
6. split/version/reproducibility;
7. privacy/license/retention/access;
8. known bias/coverage/limitations;
9. maintenance/owner/change log.

## 15. Exercises

1. Write a data inventory for a churn dataset.
2. Diagnose five causes of a sudden 30% null-rate rise.
3. Design an annotation pilot for toxic-content categories.
4. Audit near duplicates across an image split.
5. Explain why operational chargebacks are not perfect fraud labels.

