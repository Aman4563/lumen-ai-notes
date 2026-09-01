# Chapter 3 — Data, Splitting, Leakage, and Distribution Shift

## 1. A dataset is a historical measurement process

A table is not reality. It is the result of:

```
real-world process -> collection policy -> sensors/logging -> joins/filters
-> label process -> snapshot/query -> dataset
```

Every arrow can introduce selection, error, delay, missingness, or bias. Before
modeling, ask:

- Why does each row exist?
- Which cases never enter the table?
- When was each field known?
- Who generated the label and under what policy?
- Did previous product decisions change what was observed?
- Which population will receive future predictions?

This **data-generating process** often matters more than the file format or model.

## 2. Population, sample, and generalization

The **population** is the set or distribution of cases about which we care. A
**sample** is the finite observed dataset. We train on the sample but want
performance on new population cases.

Let <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>,</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mo>∼</mo><msub><mi>P</mi><mrow><mi>t</mi><mi>a</mi><mi>r</mi><mi>g</mi><mi>e</mi><mi>t</mi></mrow></msub></mrow></semantics></math> denote an example from the target environment. Ideally,
training examples are representative of this distribution, subject to known
time and policy changes.

### The i.i.d. assumption

Many basic analyses assume examples are **independent and identically distributed**:

1.  independent: one example does not reveal or determine another;
2.  identically distributed: examples come from the same distribution.

Real ML data often violates both:

- multiple transactions belong to the same account;
- frames come from the same video;
- future demand depends on earlier demand;
- a recommender determines which items are exposed and clicked;
- attacker behavior evolves after fraud defenses change.

i.i.d. is an approximation, not a ritual. Splitting and uncertainty estimation
must reflect dependencies and the real deployment scenario.

## 3. Anatomy of an ML dataset

For supervised learning:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi mathvariant="script">𝒟</mi><mo>=</mo><mo stretchy="false" form="prefix">{</mo><mo stretchy="false" form="prefix">(</mo><msub><mi>x</mi><mi>i</mi></msub><mo>,</mo><msub><mi>y</mi><mi>i</mi></msub><mo>,</mo><msub><mi>m</mi><mi>i</mi></msub><mo stretchy="false" form="postfix">)</mo><msubsup><mo stretchy="false" form="postfix">}</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><mo>,</mo></mrow></semantics></math>

where <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><msub><mi>m</mi><mi>i</mi></msub></semantics></math> can include metadata not given to the model—entity ID, timestamp,
geography, source, or evaluation slice. Retaining metadata makes leakage-safe
splits and error analysis possible.

### Common feature types

- numeric continuous: temperature, amount;
- numeric discrete/count: logins in 7 days;
- categorical nominal: merchant category;
- ordinal: severity level;
- boolean: verified or not;
- timestamps and durations;
- text, image, audio, video;
- sets/sequences: viewed items, event history;
- graphs: users, devices, and their relationships;
- missingness indicators or quality metadata.

An identifier may be useful for grouping a split but dangerous as a model feature.
High-cardinality IDs allow memorization and usually fail on unseen entities.

## 4. Why split the data?

We need honest estimates of unseen performance while using other data to learn
and make choices.

| Split | Purpose | Allowed use |
|----|----|----|
| Training | fit parameters | repeated learning and preprocessing fit |
| Validation/development | choose model family, features, threshold, hyperparameters | repeated comparison |
| Test | final estimate after choices are fixed | rare, controlled evaluation |

Typical proportions such as 70/15/15 or 80/10/10 are not laws. With millions of
examples, small percentages may suffice. With small data, cross-validation may
use data more efficiently. Test size should support confidence at the metrics and
slices that matter.

### Why a training score is optimistic

The algorithm directly uses training examples to choose parameters. A sufficiently
flexible model can memorize their peculiarities. Validation approximates new data
for model selection. Once many decisions respond to validation results, some
overfitting to validation also occurs; the untouched test set checks the final
process.

## 5. Choose a split that simulates deployment

### 5.1 Random split

Randomly assign examples when observations are approximately exchangeable and
deployment resembles the same stable population.

Good example: independently sampled manufactured parts from a stable process.

### 5.2 Stratified split

Preserve label proportions, or occasionally important strata, across splits.
Useful when positive cases are uncommon. Stratification reduces accidental
imbalance but does not solve entity dependence, temporal shift, or selection bias.

### 5.3 Grouped split

Keep related examples in one split. Group by patient, user, household, device,
document, session, or source when overlap would allow memorization.

Example: if images from the same patient occur in train and test, the model may
recognize patient/scanner artifacts instead of disease patterns.

### 5.4 Temporal split

Train on earlier events and validate/test on later events when predicting the
future or when the environment changes over time.

```
time -------------------------------------------------------------->
|--------- training ---------|--- validation ---|------ test ------|
                              model choices       final simulation
```

Temporal splits reveal staleness and drift that random splits hide. Leave a gap
or **embargo** when features and labels have overlapping windows.

### 5.5 Geographic/domain/source holdout

Hold out sites, markets, hospitals, languages, cameras, or vendors when deployment
must generalize to a new domain. This can be harder and more honest than a random
within-site split.

### 5.6 Nested constraints

Real splitting may need time, groups, and stratification together. For example,
evaluate on later users while preventing a household from straddling splits.
Always state which generalization claim the test set supports:

- new event for a known user;
- new user from a known market;
- later time period;
- entirely new market/device/domain.

These are different claims.

## 6. Cross-validation

In <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>K</mi></semantics></math>-fold cross-validation, divide development data into <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>K</mi></semantics></math> folds. Train on
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>K</mi><mo>−</mo><mn>1</mn></mrow></semantics></math> and evaluate on the remaining fold, rotating the held-out fold.

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mtext mathvariant="normal">CV score</mtext><mo>=</mo><mfrac><mn>1</mn><mi>K</mi></mfrac><munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>K</mi></munderover><msub><mi>M</mi><mi>k</mi></msub><mi>.</mi></mrow></semantics></math>

Benefits:

- uses limited data efficiently;
- exposes variability across folds;
- supports more stable hyperparameter comparisons.

Costs and caveats:

- roughly <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>K</mi></semantics></math> times the training cost;
- preprocessing must be fitted separately within every fold;
- ordinary K-fold is wrong for temporal or grouped dependencies;
- use GroupKFold, blocked/time-series validation, or other structure-aware schemes;
- if CV selects the model, a separate test set is still useful for final estimation.

In nested cross-validation, inner folds select hyperparameters and outer folds
estimate the complete selection process. It is useful for small, high-stakes
datasets but computationally expensive.

## 7. Data leakage

**Leakage** occurs when training or evaluation uses information that would not be
legitimately available for the intended prediction, or when evaluation knowledge
contaminates model development. It creates deceptively good offline results.

### 7.1 Target leakage

A feature directly or indirectly reveals the outcome.

- “refund issued” used to predict whether a purchase will be returned;
- a diagnosis code added after treatment used to predict initial disease;
- chargeback investigation result used in an authorization-time fraud model.

The feature may be strongly correlated and perfectly real; it is still invalid at
the prediction timestamp.

### 7.2 Temporal leakage / look-ahead bias

Features use future information or an incorrect time window.

- computing “transactions in the next 24 hours”;
- using end-of-day inventory for a morning forecast;
- a centered moving average that includes future points;
- revised macroeconomic values unavailable at the historical forecast time.

For every feature, enforce:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>t</mi><mrow><mi>e</mi><mi>v</mi><mi>e</mi><mi>n</mi><mi>t</mi></mrow></msub><mo>≤</mo><msub><mi>t</mi><mrow><mi>a</mi><mi>v</mi><mi>a</mi><mi>i</mi><mi>l</mi><mi>a</mi><mi>b</mi><mi>l</mi><mi>e</mi></mrow></msub><mo>≤</mo><msub><mi>t</mi><mrow><mi>p</mi><mi>r</mi><mi>e</mi><mi>d</mi><mi>i</mi><mi>c</mi><mi>t</mi><mi>i</mi><mi>o</mi><mi>n</mi></mrow></msub><mi>.</mi></mrow></semantics></math>

Event time is when reality occurred; availability time is when the feature store
could actually serve the information. Both matter.

### 7.3 Train–test contamination

Information from validation/test enters training:

- duplicates or near-duplicates cross the boundary;
- frames from the same video or records from the same user appear in both;
- a pretrained embedding/model was built using test examples in a task-revealing way;
- synthetic augmentation produces near copies in different splits.

### 7.4 Preprocessing leakage

Preprocessing is fitted on the full dataset before splitting:

- global mean/median imputation;
- standardization using all rows;
- feature selection using all labels;
- target encoding computed without out-of-fold logic;
- vocabulary or PCA learned from test data when the intended pipeline would not.

Correct sequence:

```
split raw examples
-> fit preprocessing on training only
-> transform training/validation/test with that fitted state
-> fit model on transformed training data
```

Put transformations in a pipeline so that cross-validation refits them correctly.

### 7.5 Evaluation leakage / test-set overfitting

Repeatedly checking the test set and changing the model turns it into validation
data. The final score becomes a biased maximum over many attempts. Protect test
access, record evaluations, and refresh the benchmark if it has become a shared
development target.

### 7.6 Label leakage through aggregation

Aggregated features are subtle. A merchant's fraud rate is valid only if computed
from outcomes mature *before* each prediction. Computing it once from the full
table leaks future labels. Use point-in-time joins and smoothing for sparse groups.

### 7.7 Leakage versus useful correlation

A feature is not leakage merely because it is highly predictive. Ask:

1.  Will this exact value be available at inference time?
2.  Was it created using the current/future label?
3.  Would its relationship persist under the deployment policy?
4.  Is it permitted and reliable enough to use?

## 8. Leakage audit procedure

For each feature, maintain:

| Field                   | Audit question                                |
|-------------------------|-----------------------------------------------|
| Definition              | What exactly is calculated?                   |
| Source                  | Which raw events/tables create it?            |
| Event timestamp         | When did the underlying fact occur?           |
| Availability timestamp  | When could serving retrieve it?               |
| Lookback                | Which interval is included?                   |
| Label dependency        | Does construction use outcomes?               |
| Entity scope            | Could it memorize an entity across splits?    |
| Training-serving parity | Is the identical logic available online?      |
| Policy sensitivity      | Will deployment alter this feature's meaning? |

Then run empirical checks:

- inspect suspiciously strong single features;
- compare random and temporal/grouped splits;
- detect exact and approximate duplicates;
- retrain after removing post-outcome or ID-like fields;
- reproduce features from historical point-in-time snapshots;
- compare offline feature values with logged online values.

An unexpectedly spectacular score should trigger an audit, not a celebration.

## 9. Distribution shift

Training assumes historical relationships transfer to deployment. **Distribution
shift** means some relevant distribution changes.

Let training and production distributions be <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>,</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> and
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>,</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

### 9.1 Covariate shift

Input distribution changes but conditional target relationship is assumed stable:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>≠</mo><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>,</mo><mspace width="2.0em"></mspace><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

Example: more mobile traffic but risk at a given feature vector remains similar.

### 9.2 Label/prior shift

Label prevalence changes while class-conditional features are assumed stable:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mo>≠</mo><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mo>,</mo><mspace width="2.0em"></mspace><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>∣</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>∣</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

Example: disease prevalence changes between populations. Thresholds and
probability calibration may need adjustment.

### 9.3 Concept shift/drift

The relationship between inputs and target changes:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>P</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>≠</mo><msub><mi>P</mi><mrow><mi>p</mi><mi>r</mi><mi>o</mi><mi>d</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

Example: attackers change tactics; a phrase changes cultural meaning; a pricing
policy changes purchase behavior. This is usually more damaging than simple
input-frequency change.

### 9.4 Other practical shifts

- **Domain shift:** new country, device, hospital, language, sensor.
- **Policy-induced shift:** the deployed model changes which cases are acted on.
- **Data-pipeline shift:** schema, default, unit, logging, or upstream model changes.
- **Feature staleness:** values technically exist but no longer refresh.
- **Cold start:** new users/items have little history.

“Data drift” is often used loosely. Detecting <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> change does not prove model
quality declined; stable inputs do not prove <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> is stable. Measure
outcomes when mature labels become available.

## 10. Sampling and selection bias

### Selection bias

Observed rows differ systematically from the target population. Survey
respondents, users who click, approved loan applicants, and reviewed fraud cases
are selected subsets.

### Survivorship bias

Only surviving or successful entities remain. Training on current customers can
omit the behavior of those who already left.

### Selective labels

Labels are observed only for cases receiving a particular historical action.
Loan repayment is observed for approved loans, not rejected applicants. A new
model trained naïvely learns within the old policy's selection boundary.

### Exposure/position bias

In recommenders and search, clicks are observed only for displayed items and are
affected by rank position. Unshown items are not negative examples. Randomized
exploration or counterfactual methods may be required.

### Sampling changes the apparent prevalence

If positives are oversampled for training, the model sees an artificial class
prior. Ranking may improve, but raw outputs may not be calibrated to production.
Evaluation should reflect real prevalence, or results must be appropriately
reweighted.

## 11. Labels: delay, noise, disagreement, and censoring

### Label delay

Fraud chargebacks can take weeks; long-term retention takes months. Recent rows
may look negative only because outcomes have not matured. Define a maturity cutoff.

### Label noise

Observed label <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mover><mi>Y</mi><mo accent="true">̃</mo></mover></semantics></math> can differ from true target <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>Y</mi></semantics></math>. Noise may be:

- random;
- class-dependent;
- feature/segment-dependent;
- adversarial;
- generated by disagreement or unclear instructions.

Inspect a stratified sample, estimate inter-annotator agreement when relevant,
adjudicate difficult cases, and keep uncertainty rather than forcing false
precision.

### Censoring

The full outcome is not observed by dataset creation time. In survival analysis,
a customer still active at day 30 has not necessarily “never churned”; their time
to churn is right-censored.

### Human labels are measurements, not unquestionable truth

Write annotation guidelines, include examples, blind annotators to irrelevant
signals, measure disagreement, audit slices, and distinguish subjective policy
judgments from objective observations.

## 12. Missing data

Missingness itself has a process:

- **MCAR:** missing completely at random (strong and rare assumption);
- **MAR:** missingness depends on observed variables;
- **MNAR:** missingness depends on the missing value or unobserved factors.

Example: income may be missing more often for very high or very low earners
(MNAR). A zero, an absent field, an unknown value, and “not applicable” should not
be carelessly collapsed.

Track missing rates by time and segment. In production, sudden missingness can be
a pipeline incident rather than a statistical inconvenience.

## 13. Imbalanced data

When positives are rare:

- accuracy can be meaningless;
- random splitting can yield unstable positive counts;
- labels may be noisy relative to the small positive class;
- model outputs require threshold/cost analysis;
- evaluation needs precision–recall and confidence intervals;
- sampling or class weighting can help training but changes calibration concerns.

Do not rebalance the test set unless the evaluation question explicitly uses
reweighting. The test distribution should normally simulate deployment.

## 14. Data quality dimensions

| Dimension | Example check |
|----|----|
| Completeness | required fields present; missing rate by segment/time |
| Validity | type, range, format, units, category vocabulary |
| Uniqueness | duplicate event/primary key rules |
| Consistency | same entity/value agrees across sources |
| Timeliness | event and feature freshness within SLA |
| Accuracy | sampled values match an authoritative source |
| Referential integrity | foreign keys resolve as intended |
| Label quality | maturity, noise, disagreement, coverage |
| Representativeness | sample matches target population/slices |
| Point-in-time correctness | no value from after prediction time |

Automated schema tests catch structural failures. Statistical tests catch
unexpected distributions. Neither replaces semantic review.

## 15. Reproducibility and dataset documentation

A reproducible dataset records:

- immutable raw/source snapshot identifiers;
- query/transformation code version;
- feature definitions and timestamps;
- label definition, window, maturity, and provenance;
- split assignment logic and random seed where applicable;
- exclusion/filter criteria;
- row and label counts by split and important slices;
- quality test results;
- permissions, licenses, privacy constraints, and retention;
- known limitations and intended uses.

Hashing stable entity keys can produce deterministic assignments, but temporal
or grouped constraints may require more careful logic. Version data and code
together; “same notebook” does not guarantee the same dataset.

## 16. Interview scenario: medical readmission

Question: design a dataset to predict 30-day hospital readmission at discharge.

A strong answer identifies:

1.  one hospitalization ending at discharge as the example;
2.  prediction timestamp just before discharge;
3.  only information available by discharge;
4.  label from readmission within 30 days, including cross-hospital coverage limits;
5.  patient-grouped split to prevent patient identity leakage;
6.  temporal/site holdout to test future/new-hospital generalization;
7.  mortality and lost follow-up as competing/missing outcomes;
8.  coding changes and health-access bias;
9.  calibration, subgroup analysis, and an intervention workflow;
10. a prospective rollout because retrospective evaluation cannot prove benefit.

## 17. Check your understanding

1.  Why might a random split overestimate demand-forecast quality?
2.  Is learning a text vocabulary from all inputs always target leakage? Is it
    still evaluation contamination? Explain the intended pipeline.
3.  Design a split for product reviews where each product has many reviews and the
    model will serve future reviews for both existing and new products.
4.  Give one example each of target leakage, preprocessing leakage, and entity
    leakage.
5.  Distinguish label shift from concept drift.
6.  Why are rejected loan applicants not ordinary negative repayment examples?
7.  Why can detected feature drift be harmless, and undetected concept drift harmful?
8.  Create a feature audit row for “merchant fraud rate in the previous 30 days.”
