# Chapter 2 — Logistic Regression, Naive Bayes, k-NN, and SVM

## 1. Classification output layers

Separate:

1. score/logit;
2. probability (if calibrated/defined);
3. threshold/class decision;
4. product action.

A classifier need not estimate probability. Ranking and decision quality may be
good while calibration is poor.

## 2. Logistic regression

### Model

> z = wᵀx + b  
> p = P(Y = 1 ∣ x) = σ(z) = 1/(1 + e⁻ᶻ)

Log-odds are linear:

> log[p/(1 − p)] = wᵀx + b

Decision boundary p = 0.5 corresponds to z = 0, a hyperplane. A different
threshold shifts boundary parallel in logit space but product policy can use any
threshold.

### Loss / MLE

Negative log likelihood / binary cross-entropy:

> L = −Σ[y<sub>i</sub>log p<sub>i</sub>
> + (1 − y<sub>i</sub>)log(1 − p<sub>i</sub>)]

Gradient:

> ∇<sub>w</sub>(L/n) = (1/n)Xᵀ(p − y)

With L2 add λw (or 2λw depending penalty convention). Optimize from logits stably.

### Coefficient interpretation

Holding represented other features fixed, one-unit x<sub>j</sub> increase adds
w<sub>j</sub> to log-odds and multiplies odds by exp(w<sub>j</sub>). It does not add
a constant probability; probability change depends on current p. Not causal by
default.

### Strengths

- fast sparse/dense training/inference;
- convex objective (with ordinary regularization);
- probabilistic outputs often reasonably calibratable;
- coefficient/feature contribution clarity;
- strong high-dimensional sparse text baseline.

### Weaknesses

- linear log-odds without engineered interactions/bases;
- outlier/scaling and collinearity sensitivity;
- perfect/quasi separation produces unbounded MLE without regularization;
- probability can be wrong under misspecification/shift.

## 3. Multiclass logistic/softmax regression

For K classes:

> z<sub>k</sub> = w<sub>k</sub>ᵀx + b<sub>k</sub>  
> p<sub>k</sub> = exp(z<sub>k</sub> − m)/Σ<sub>j</sub>exp(z<sub>j</sub> − m)

where m = max z for stability.

Cross-entropy:

> L = −Σ<sub>i</sub> log p<sub>i,true class</sub>

Gradient with respect to logits:

> ∂L/∂z<sub>ik</sub> = p<sub>ik</sub> − 1[y<sub>i</sub> = k]

Softmax parameters are non-identifiable up to adding same score offset; frameworks
handle reference/regularization conventions.

### One-vs-rest versus multinomial

- One-vs-rest trains K binary classifiers; scores/probabilities need reconciliation.
- Multinomial jointly normalizes classes and captures competition.

For multilabel tasks use independent sigmoid outputs, not softmax, because labels
can co-occur.

## 4. Naive Bayes

Bayes rule:

> P(Y = c ∣ x) ∝ P(Y = c)P(x ∣ Y = c)

Naive conditional independence assumption:

> P(x ∣ Y = c) = ∏<sub>j</sub>P(x<sub>j</sub> ∣ Y = c)

Use log scores:

> score(c) = log P(Y = c) + Σ<sub>j</sub> log P(x<sub>j</sub> ∣ Y = c)

Choose highest score. This prevents underflow.

### Variants

**Gaussian NB:** each numeric feature Gaussian per class. Estimates mean/variance.

**Multinomial NB:** counts/frequencies such as words. Likelihood based on class-
conditional token probabilities.

**Bernoulli NB:** binary feature presence/absence; absence contributes too.

### Smoothing

Without smoothing, unseen class-token makes probability zero. Additive smoothing:

> P(token t ∣ class c)
> = (count(t,c) + α)/(total token count in c + αV)

V vocabulary size. α = 1 Laplace; smaller Lidstone possible.

### Strengths/weaknesses

- extremely fast, low data, sparse text, incremental sufficient statistics;
- generative assumptions often wrong; probability calibration can be poor;
- duplicated/correlated features double-count evidence;
- still useful because classification boundary can work under imperfect density.

## 5. k-nearest neighbors (k-NN)

No parametric training; store reference examples. For query x:

1. compute distance to training points;
2. select k nearest;
3. vote/average, optionally distance-weighted.

Classification estimate:

> p̂(Y = c ∣ x) = (1/k)Σ<sub>i in neighbors</sub>1[y<sub>i</sub> = c]

Regression: mean/weighted neighbor targets.

### Hyperparameters

- k: small low bias/high variance; large smoother/high bias;
- distance: Euclidean, Manhattan, cosine, domain metric;
- weighting: uniform or inverse distance;
- scaling/feature weights;
- neighbor index/approximation.

### Curse of dimensionality

In high dimensions:

- volume grows, data becomes sparse;
- distances concentrate;
- nearest may not be meaningfully near;
- irrelevant features dominate;
- exponentially more data needed for local coverage.

Scaling, feature selection, metric learning, embeddings, PCA, or approximate
nearest-neighbor indexes help but do not repeal geometry.

### Complexity

Naïve:

- training O(1) beyond storage;
- memory O(nd);
- query O(nd + n log k) roughly, reducible with heap/selection.

KD/ball trees help low/moderate dimension; approximate indexes (HNSW, IVF, product
quantization concepts) trade recall, latency, memory, update behavior.

### Pitfalls

Data leakage through duplicate/entity neighbors; class imbalance; ties; zero
distance; expensive serving; privacy (training example exposure); drift/stale index.

## 6. Support vector machines (SVM)

### Maximum-margin intuition

For labels y ∈ {−1, +1}, linear score wᵀx + b. Scale parameters so closest points
satisfy y(wᵀx + b) ≥ 1. Margin width proportional to 2/‖w‖.

Hard-margin primal:

> minimize ½‖w‖²  
> subject to y<sub>i</sub>(wᵀx<sub>i</sub> + b) ≥ 1 for every i

Only separable data; sensitive to outliers.

### Soft margin and hinge loss

> minimize ½‖w‖² + CΣ max(0, 1 − y<sub>i</sub>(wᵀx<sub>i</sub> + b))

- C large: heavily penalize margin violations, lower regularization, possible
  overfit;
- C small: wider/softer margin, more regularization.

Framework scaling of C/loss differs. Standardize features.

### Support vectors

Examples on/inside margin determine boundary in dual solution. Distant correctly
classified points do not directly affect it. This yields sparse dependency in
examples for kernel SVM, though number of support vectors can be large.

### Kernel trick

Replace dot product φ(x)ᵀφ(z) with kernel K(x, z), avoiding explicit high-dimensional
mapping.

Common:

- linear K = xᵀz;
- polynomial K = (γxᵀz + r)ᵈ;
- RBF K = exp(−γ‖x − z‖²).

RBF:

- γ large: narrow influence, complex/high variance;
- γ small: broad smooth influence, higher bias.

A valid kernel corresponds to PSD Gram matrix under Mercer-like conditions.

### Scaling and probability

Kernel training often scales between O(n²) memory and O(n²–n³) time depending
solver/data, making huge n difficult. Prediction costs support vectors.

SVM score is a margin, not probability. Calibrate with held-out Platt/isotonic;
multiclass uses one-vs-rest/one-vs-one schemes.

## 7. Generative versus discriminative

- Naive Bayes models P(X ∣ Y) and P(Y), then applies Bayes.
- Logistic regression directly models P(Y ∣ X).

Generative models can need less data if assumptions fit and can generate/model
features, but misspecification hurts. Discriminative models focus capacity on the
decision relationship and often win with enough labeled data.

## 8. Choosing among them

| Situation | Strong starting model |
|---|---|
| high-dimensional sparse text, tiny data | Multinomial NB and regularized logistic |
| high-dimensional sparse text, larger data | logistic or linear SVM |
| low-dimensional local smooth boundary | k-NN baseline |
| medium data, nonlinear smooth boundary | RBF SVM if scale permits |
| probability/cost decisions | logistic + calibration checks |
| extreme latency/interpretability | sparse linear model |

Always compare with tree ensembles for tabular nonlinear interactions.

## 9. Common interview comparisons

### Logistic regression versus SVM

- log loss probabilities versus hinge margin;
- all examples influence logistic, support vectors dominate SVM;
- both linear with basic features;
- kernel SVM nonlinearity but scale/cost;
- logistic naturally probabilistic but still needs calibration checks.

### k-NN versus k-means

k-NN is supervised local prediction using labeled neighbors. k-means is
unsupervised clustering minimizing within-cluster squared distance. “k” has no
shared semantic.

### Sigmoid versus softmax

Sigmoid independently maps each logit to (0,1), suitable binary/multilabel.
Softmax couples K logits to probabilities summing one, suitable mutually exclusive
multiclass.

## 10. Exercises

1. Derive logistic gradient and implement stable binary loss.
2. Train NB/logistic on same text features; analyze correlated evidence.
3. Plot k-NN decision regions as k/distance/scaling changes.
4. Compare linear/RBF SVM and calibrate scores.
5. Explain perfect separation and why regularization helps.

