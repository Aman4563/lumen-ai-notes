# Chapter 5 — Supervised Learning Interview Workbook

## 1. Rapid comparisons

### Ridge versus Lasso

Ridge L2 shrinks continuously and handles correlated predictors stably; Lasso L1
can create sparsity but selects unstably among correlated features. Both require
scale attention and λ chosen on validation.

### Linear model versus tree

Linear model: affine relationship in representation, extrapolates, fast/sparse,
coefficient clarity. Tree: thresholds/interactions, scale-insensitive, piecewise
constant, unstable/deep overfit, weak extrapolation.

### Bagging versus boosting

Bagging fits learners independently on resamples and averages, mainly reducing
variance. Boosting fits sequential corrections/gradients, reduces bias and can
overfit/noise without shrinkage/constraints.

### Random forest versus gradient boosting

RF robust low-tuning parallel baseline; many deep randomized trees. Boosting often
wins tabular quality with more sensitive sequential tuning and training. Compare
calibration, latency, data size, category support, and cost.

### Generative versus discriminative classifier

Generative models class-conditional/joint data and uses Bayes; discriminative
models conditional/boundary. Generative assumptions can help small data; direct
conditional modeling often better with enough labels.

## 2. Common “why” questions

### Why is logistic regression called regression?

It models a continuous log-odds/conditional probability via a linear predictor,
though used for classification after thresholding. Historical naming.

### Why does regularization improve generalization?

It restricts/preferences solutions, reducing sensitivity/variance and improving
conditioning at cost of bias. It can also encode sparsity/structure.

### Why don't trees need scaling?

Axis-aligned split ordering is invariant under monotonic transformations. But
histogram bins/numerical behavior, mixed pipelines, distance preprocessing, and
regularization elsewhere can still matter.

### Why does random feature selection help forest?

Strong features otherwise dominate top splits, correlating trees. Random subsets
diversify errors so averaging reduces more variance.

### Why can boosting overfit noisy labels?

Sequential residual/error focus allocates capacity to hard/noisy cases. Control
depth/leaves, shrinkage, subsampling, early stopping, robust loss, and label quality.

## 3. Derivation drills

1. OLS gradient and normal equations.
2. Ridge closed form and effect on eigen/singular directions.
3. Logistic loss gradient p − y.
4. Gini/entropy split gain on a 10-row node.
5. Bagging variance with correlated errors.
6. Squared-loss boosting negative gradient.
7. SVM margin width and hinge loss.
8. Naive Bayes log posterior with smoothing.

## 4. Failure scenarios

### Great random CV, poor production

Audit time/group leakage, duplicates, target aggregation, preprocessing, policy
shift, training-serving skew, prevalence/calibration, and service fallback before
changing algorithm.

### Test AUC rises, business KPI flat

Gain may lie outside threshold region, action capacity unchanged, calibration/
threshold wrong, labels/metric proxy misaligned, latency causes fallback, online
feedback changes, or difference too small. Analyze operating point and experiment.

### Feature importance says ZIP code dominates

Possible geographic signal, proxy, leakage, selection, high cardinality. Check
definition/time, group/domain holdout, permutation/ablation, correlated substitutes,
fairness/privacy/legal context, and robustness to location changes.

### Logistic coefficients flip sign across folds

Collinearity, scaling, small sample, interactions, selection, or shift. Examine
correlations/VIF/singular values, regularize, group features, report predictive
stability rather than causal coefficient story.

## 5. From-scratch implementation requirements

### Logistic regression

- stable logits loss;
- vectorized gradient;
- L2 excluding intercept;
- gradient check;
- convergence/learning rate diagnostics;
- probability/threshold methods;
- shape/finite tests.

### Decision tree

- classification Gini or regression SSE;
- numeric threshold candidates;
- stopping/min leaf/max depth;
- deterministic tie behavior;
- predict traversal;
- tests for pure/constant/missing policy;
- complexity note.

### Random forest

- bootstrap samples and feature subsets;
- independent deterministic RNG streams;
- probability average;
- OOB optional;
- parallelization boundary and reproducibility.

### Gradient boosting

- initialize mean/log-odds;
- residual/negative gradient;
- shallow regression trees;
- shrinkage;
- validation early stopping;
- stable classification conversion.

## 6. Part 5 capstone

Use a real tabular dataset with time/entity structure.

1. Problem/label/data card and leakage-safe split.
2. Dummy/current heuristic baseline.
3. Regularized linear/logistic pipeline.
4. tree, random forest, gradient boosting.
5. nested or disciplined tuning under fixed compute.
6. primary operating metric + calibration + threshold/cost.
7. learning curves, error taxonomy, slices, paired uncertainty.
8. importance/PD/SHAP caveats and feature-family ablation.
9. latency/size/cost benchmark.
10. model card recommending winner or no launch.

Advanced: implement two algorithms from scratch and match library behavior within
tolerance on small fixtures.

## 7. Senior answer template

For “which model?” answer:

```text
data size/type/sparsity and target -> baseline -> split/metric/cost
-> candidate inductive biases -> tuning budget -> calibration/threshold
-> error/slice/robustness -> latency/cost/explainability
-> rollout/monitoring/fallback
```

There is no universal best model. Explain what evidence would change your choice.

## 8. Exit checklist

- [ ] I derive linear/logistic objectives and gradients.
- [ ] I explain NB, k-NN, SVM assumptions and scaling.
- [ ] I calculate tree split gain.
- [ ] I compare bagging, RF, AdaBoost, and gradient boosting.
- [ ] I tune pipelines without leakage/test reuse.
- [ ] I calibrate scores and choose cost/capacity thresholds.
- [ ] I use explanation tools with correlation/causality caveats.
- [ ] I completed the capstone and can defend its model choice.

