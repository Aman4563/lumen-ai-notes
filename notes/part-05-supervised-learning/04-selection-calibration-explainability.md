# Chapter 4 — Model Selection, Tuning, Calibration, and Explainability

## 1. Select a pipeline, not an estimator in isolation

The candidate includes:

- example/label definition;
- split;
- preprocessing/features;
- model family/hyperparameters;
- calibration;
- threshold/policy;
- serving constraints.

Every learned step belongs inside CV. Comparing one model with leaked target
encoding against another with clean encoding is not meaningful.

## 2. Development protocol

1. freeze prediction/label/split/evaluation definitions;
2. establish current/no-skill/simple baselines;
3. create train/validation/test or nested CV;
4. choose primary selection metric and guardrails;
5. build end-to-end pipeline;
6. tune on development data only;
7. run error/slice/learning-curve analysis;
8. calibrate/choose threshold on held-out development data;
9. lock candidate;
10. evaluate test once and report uncertainty/cost/latency.

## 3. Cross-validation choices

- K-fold: approximately i.i.d. examples.
- Stratified K-fold: preserve class mix.
- Group K-fold: entities isolated.
- Time series/forward chaining: train past, validate future.
- Nested CV: inner selection, outer performance estimate.

Repeated CV estimates split variability but costs more. Standard error across folds
is not straightforward because folds/training sets overlap; use fold results as a
diagnostic, not a simplistic independent-sample CI.

## 4. Hyperparameter search

### Grid search

Enumerate Cartesian grid. Wasteful when many dimensions/unimportant values; useful
for small carefully chosen spaces.

### Random search

Sample configurations. Covers important dimensions more efficiently and supports
mixed distributions.

Use log-uniform sampling for scale parameters such as learning rate/regularization:
0.0001 to 0.001 matters like 0.1 to 1 more than uniform linear spacing suggests.

### Bayesian/sequential optimization

Surrogate predicts promising configurations, balancing exploration/exploitation.
Useful when trials expensive, less useful with noisy/nonstationary evaluations or
huge conditional spaces without careful setup.

### Successive halving/Hyperband

Evaluate many configurations at small budgets, allocate more to promising. Assumes
early performance predicts final; can eliminate slow starters.

### Search hygiene

- fix per-trial budget and data/splits;
- log failed trials and total compute;
- seed/repeat enough to understand noise;
- include simple defaults;
- avoid choosing on tiny metric differences;
- use final holdout after search;
- count tuning cost in system decision.

## 5. Comparing models statistically

Use paired predictions on same evaluation units. Compute per-unit loss difference
or paired bootstrap metric difference. Resample independent units (users/groups)
and preserve time structure.

Report:

- point difference and CI;
- baseline/model absolute metrics;
- slices;
- latency/cost/model size;
- number of attempted variants;
- practical effect threshold.

For classification errors, McNemar’s test compares paired disagreement counts
under assumptions, but does not replace cost/slice/product evaluation.

## 6. Threshold selection

Choose on validation/calibration set:

- maximize expected utility/cost;
- meet recall with minimum precision;
- meet FPR/false-positive count;
- fit human review capacity;
- optimize Fβ if it genuinely approximates cost;
- use multiple thresholds for actions.

Capacity example: if review handles 1,000/day, select threshold producing ≤1,000
alerts under expected traffic, then evaluate recall/precision and queue bursts.
Monitor prevalence and score distribution because fixed threshold action rate drifts.

## 7. Calibration

### Reliability

Ideal: among predictions near p, observed fraction ≈ p. Evaluate overall and slices
with confidence/counts.

### Sigmoid/Platt scaling

Fit logistic mapping from raw score to probability. Parametric, stable with less
data, limited shape.

### Isotonic regression

Fit nondecreasing piecewise constant mapping. Flexible, needs more calibration data
and can overfit.

### Temperature scaling

For multiclass/deep logits divide by positive T before softmax. Preserves class
ranking and fits one parameter; cannot fix class-specific/complex miscalibration.

### Data partitioning

Model fit, hyperparameter selection, calibrator fit, threshold selection, and final
test all consume information. Use cross-validated calibration or allocate data
deliberately. Never fit calibration on final test.

### Expected calibration error caveat

ECE bins |accuracy − confidence| weighted by bin size. It depends strongly on bins,
can hide cancellation/class behavior, and is not a proper scoring rule. Report
reliability plot, Brier/log loss, and operating consequences.

## 8. Ensembling

### Averaging/voting

Average probabilities/scores; reduce variance when errors diverse. Calibrate final
ensemble, not components only.

### Stacking

Meta-model learns from base predictions. Training meta-features must be out-of-fold
to prevent base models predicting their own training rows. Held-out/test predictions
use base models fitted on full development data under consistent procedure.

### Blending

Use a holdout to train meta-model; simpler but sacrifices data and can overfit.

### Cost

Ensembles multiply artifacts, dependencies, latency, memory, debugging and rollout.
Measure incremental total value.

## 9. Explainability levels

Ask who needs explanation and decision:

- model developer debugging;
- reviewer reason/support;
- affected user recourse;
- auditor/global behavior;
- incident responder;
- regulator/policy requirement.

One plot cannot serve all.

## 10. Intrinsic interpretation

- linear coefficients after representation/scaling;
- odds ratios with conditioning caveats;
- shallow tree rules;
- GAM feature curves;
- monotonic constraints;
- prototypes/examples.

Simple model can still be unintelligible with thousands of correlated features and
opaque engineered inputs.

## 11. Permutation importance

On held-out data:

1. measure baseline metric;
2. permute feature values;
3. remeasure;
4. importance = degradation.

Limitations:

- correlated features substitute;
- permutation creates impossible combinations;
- result depends on metric/population/model;
- uncertainty/repeats needed;
- not causal.

Group related features or use conditional permutation under an explicit model.

## 12. Partial dependence and ICE

Partial dependence for feature value z averages predictions after setting feature
to z across examples:

> PD(z) = (1/n)Σ f(z, x<sub>i,other</sub>)

It can create unrealistic combinations when correlated and hides heterogeneous
effects. Individual conditional expectation (ICE) plots each example curve;
centered ICE reveals interactions.

Accumulated local effects (ALE) use local conditional changes and can behave better
with correlation, still model explanations with binning/coverage limitations.

## 13. SHAP concepts

Shapley values allocate prediction difference among features based on cooperative
game axioms. Explanation form:

> f(x) = baseline + Σ φ<sub>j</sub>

But values depend on:

- background/reference data;
- what “missing feature” means;
- interventional versus conditional assumptions;
- model/explainer approximation;
- correlated features;
- output scale (logit/probability).

SHAP explains model behavior under chosen setup, not causal truth or fairness.
Exact calculation exponential generally; specialized/approximate algorithms used.

## 14. Counterfactual explanations

Find small change x′ that changes decision:

> minimize distance(x, x′) + λ · decision_loss(f(x′), desired)

Constraints must ensure actionable, immutable, causal, realistic, and policy-safe
changes. “Change age/country” is not recourse. Model counterfactual does not prove
real-world intervention yields outcome.

## 15. Error analysis framework

Build table of out-of-fold/held-out:

```text
ID, y, score, action, loss, model/policy version,
time, source, group, quality flags, key slices
```

Then:

- top loss/uncertain/FP/FN;
- sample to avoid cherry-picking;
- label review;
- categorize causes;
- quantify frequency × severity;
- feature/model/data/policy hypotheses;
- targeted experiment/ablation;
- record result.

## 16. Learning and validation curves

- learning curve: train/validation vs data size;
- validation curve: performance vs one hyperparameter;
- training curve: loss/metric vs iterations;
- time curve: performance by deployment age;
- slice curve: performance by history/support/target magnitude.

Use them to diagnose bias/variance/optimization/shift, not to guarantee cause.

## 17. Model card content

- problem/output/action/non-goals;
- training/evaluation data and time;
- features/forbidden inputs;
- model/preprocessing/calibration/threshold versions;
- overall/slice metrics and uncertainty;
- latency/cost/size;
- robustness/shift/safety tests;
- limitations and unsupported uses;
- rollout/monitoring/retraining/fallback;
- owners and approvals.

## 18. Exercises

1. Design nested group/time CV for patient readmission.
2. Compare grid/random/Halving search for boosting under fixed compute.
3. Calibrate weighted/sampled classifier and choose review-capacity threshold.
4. Explain a prediction to developer, reviewer, user, and auditor differently.
5. Build out-of-fold stacking without leakage.

