# Chapter 2 — Preprocessing, Missingness, Outliers, and Imbalance

## 1. Fit transformations only on training data

Every learned transform—mean, scale, vocabulary, imputer, PCA, target encoder,
feature selector—is fitted inside the training fold/split and applied unchanged to
validation/test/serving.

```text
raw split -> fit transform on train -> transform train/validation/test
          -> fit model on transformed train -> evaluate held-out
```

During cross-validation, each fold refits the complete pipeline.

## 2. Numeric scaling

### Standardization

> z = (x − μ<sub>train</sub>)/σ<sub>train</sub>

Produces training mean near 0 and SD near 1. Useful for gradient-based, distance,
PCA, SVM, and regularized linear models. It does not bound values or make Gaussian.

Handle zero variance explicitly; drop, set transformed zero, or flag depending on
contract. Monitor serving values far outside training range.

### Min–max scaling

> z = (x − min<sub>train</sub>)/(max<sub>train</sub> − min<sub>train</sub>)

Maps training range to [0,1]. Very sensitive to extremes; new values can fall
outside [0,1].

### Robust scaling

> z = (x − median<sub>train</sub>)/IQR<sub>train</sub>

Less influenced by outliers, but does not solve multimodality or distribution shift.

### Unit norm

Scale each vector to norm 1, useful when direction matters (text/embeddings). This
is per-example normalization, not per-feature standardization.

Tree splits generally do not require monotonic scaling, though preprocessing may
still help missingness, numeric precision, constraints, and shared pipelines.

## 3. Transforming skewed numeric variables

### Log transform

For positive x: log x. For nonnegative counts: log(1 + x). Compresses multiplicative
scale/heavy right tail and can linearize relationships.

Do not apply blindly to negatives/zero. Inverse-transform predictions carefully;
mean of exp(log prediction) has retransformation bias due to Jensen’s inequality.

### Power transforms

Box–Cox requires positive values; Yeo–Johnson supports zero/negative. Fit parameters
on training. They can stabilize variance but reduce interpretability.

### Clipping/winsorization

Cap at training-derived or domain bounds. It can stabilize but collapses genuinely
different extremes and hides shift. Keep an “was clipped” indicator and monitor
rate when appropriate.

## 4. Missing-value handling

First distinguish:

- absent because not applicable;
- not collected/permission denied;
- unknown/late;
- sensor/pipeline failure;
- structurally unavailable for certain segments;
- intentionally suppressed.

Strategies:

### Simple imputation

- numeric median (robust) or mean;
- categorical explicit `UNKNOWN`;
- constant plus missing indicator.

Fit value on training. Simple often beats sophisticated imputation when missingness
is strongly signaled and model handles nonlinearities.

### Model-based/multiple imputation

Predict missing values using other features. Multiple imputation creates several
plausible datasets and combines estimates to reflect uncertainty; appropriate for
statistical inference under assumptions, more complex for production prediction.

### Native missing handling

Some tree methods learn missing directions. Still monitor missing semantics and
serving drift.

### Deletion

Drop rows/columns only with explicit representativeness and information-loss
analysis. Complete-case analysis can select a biased population.

## 5. Categorical encoding

### One-hot encoding

One indicator per category. Good for low/moderate cardinality linear models; sparse
representation avoids dense memory.

Handle unknown categories with a reserved bucket. Dropping one dummy can remove
perfect collinearity for unregularized regression, but many predictive pipelines
can keep all with regularization.

### Ordinal encoding

Map ordered categories to numbers only when order is meaningful. Numeric spacing
assumption may be inappropriate; tree models use thresholds that imply order.

### Frequency/count encoding

Replace category with training frequency/count. Compact but loses label relation
and can identify commonness. Compute point-in-time for dynamic categories.

### Hashing trick

Hash categories into fixed buckets. Handles unseen/high cardinality without a
vocabulary, with collisions and reduced interpretability. Use stable hash/seed and
monitor collision/load behavior.

### Target/mean encoding

For category c, smoothed label mean:

> enc(c) = [n<sub>c</sub> · mean<sub>c</sub> + α · global_mean]
> / [n<sub>c</sub> + α]

Naïve full-data computation leaks labels and memorizes rare categories. Use
out-of-fold encodings for training rows, training-only mapping for validation/test,
point-in-time logic for temporal data, smoothing, and unknown fallback.

### Learned embeddings

Useful for high-cardinality categories with enough signal/data. Embedding dimension
and geometry are learned for the objective; cold-start and drift remain.

## 6. Text preprocessing

Choices depend on model:

- Unicode normalization;
- language/encoding detection;
- tokenization;
- case handling;
- punctuation/whitespace;
- stop words/stemming/lemmatization;
- n-grams;
- vocabulary/OOV;
- truncation/chunking.

Do not strip signal blindly: casing, punctuation, emojis, URLs, negation, and
misspellings may matter. For pretrained transformers, use their exact tokenizer
and input format. Normalize security-sensitive text cautiously; attackers exploit
homoglyphs/zero-width characters.

### TF–IDF

Term frequency multiplied by inverse document frequency. A common smoothed IDF:

> idf(t) = log[(1 + N)/(1 + df(t))] + 1

Library definitions vary. Fit vocabulary/IDF on training. Sparse n-gram linear
models are strong text baselines.

## 7. Image/audio preprocessing

Images:

- decode/corruption checks;
- color channel/order and alpha;
- resize/crop/pad with aspect policy;
- pixel scale and channel normalization;
- augmentation only for training;
- orientation/metadata and duplicates.

Audio:

- sample rate/channels;
- duration/chunk policy;
- amplitude normalization;
- spectrogram parameters;
- silence/noise;
- augmentation validity.

Train/serve preprocessing must be identical except stochastic training augmentation.
Validate using test vectors and artifact versions.

## 8. Outlier treatment by model/objective

- squared loss amplifies target outliers;
- MAE/Huber/quantile losses are more robust;
- linear/distance models are sensitive to feature outliers;
- trees often tolerate monotonic feature extremes but can isolate tiny leaves;
- robust scaling/transformation can help;
- label outliers may be measurement error or important tail.

Use error analysis and domain cost. If large delivery delays are most harmful,
removing them produces a misleadingly easy model.

## 9. Imbalanced classification

Treat three layers separately.

### Evaluation

- real prevalence test set;
- precision–recall and operating constraint;
- confusion costs/amount weights;
- calibration and slices;
- sufficient positive counts/uncertainty.

### Learning

- class-weighted loss;
- over/under-sampling training only;
- focal loss for abundant easy examples;
- hard-negative mining;
- anomaly/one-class formulation when positives missing;
- collect better positive labels.

### Decision policy

- threshold by costs/capacity;
- tiered action/review;
- per-segment calibration/policy only with governance;
- abstention and fallback.

### Sampling and calibration

Oversampling positives changes training prior. A discriminative ranker may improve,
but output probabilities reflect sampled distribution unless corrected/calibrated
on representative held-out data.

### SMOTE caution

Interpolates minority feature vectors. It can create impossible mixed categorical/
temporal/entity examples, leak across splits if applied before splitting, and fail
in high-dimensional/sparse settings. Use only inside training folds with domain
validation and compare simpler weighting.

## 10. Feature selection

Goals: reduce cost/noise, improve interpretability/generalization, meet latency.

- Filter: variance, correlation, mutual information—fast, ignores interactions.
- Wrapper: recursive elimination/subset search—expensive and selection-overfits.
- Embedded: L1, tree importance—model-dependent.
- Domain/operational: remove unavailable, unstable, prohibited, expensive features.

Fit feature selection within CV. Correlation-based pruning can discard features
that help through interaction and retain spurious proxies. Validate stability
across time/folds.

## 11. Dimensionality reduction

PCA/Truncated SVD, random projections, autoencoders, and learned embeddings reduce
dimension. Trade-offs: information, interpretability, compute, drift, and serving
parity. Fit only on training and version the reducer.

For sparse TF–IDF, centering densifies; Truncated SVD works without explicit
centering and is often called latent semantic analysis.

## 12. Pipeline pattern

```python
# Conceptual pseudocode
numeric = Pipeline([
    ("impute", MedianImputer()),
    ("scale", StandardScaler()),
])

categorical = Pipeline([
    ("impute", ConstantImputer("UNKNOWN")),
    ("encode", OneHotEncoder(handle_unknown="ignore")),
])

features = ColumnTransformer([
    ("numeric", numeric, numeric_columns),
    ("categorical", categorical, categorical_columns),
])

model = Pipeline([("features", features), ("model", estimator)])
```

Fit this entire object inside each training fold. Serialize transformation state
with model/signature.

## 13. Exercises

1. Choose scaling/encoding for linear, tree, and neural models on same schema.
2. Design missingness handling for a field absent by user privacy choice.
3. Implement leakage-safe out-of-fold target encoding.
4. Compare weighted loss, sampling, and thresholding on rare events.
5. Audit a text preprocessing change for semantic/security loss.

