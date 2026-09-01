# Chapter 7 — Mathematics Interview Workbook

## 1. Mastery method

For each derivation:

1. state object shapes/domains;
2. state assumptions;
3. derive without skipping the decisive step;
4. interpret geometrically/probabilistically;
5. identify numerical or statistical failure modes;
6. connect to an ML algorithm.

## 2. Rapid questions and answer guides

### Q1. Dot product interpretations?

Weighted sum, magnitude–angle geometry, and alignment/projection. It requires
matching dimensions. For normalized embeddings, dot product equals cosine
similarity.

### Q2. Why not explicitly invert a matrix to solve Ax = b?

Factorization-based solve is usually faster, uses less memory, and is more stable.
If A is ill-conditioned, the mathematical problem remains sensitive; SVD,
regularization, or reformulation may be needed.

### Q3. Eigenvalue versus singular value?

Eigenpairs apply to square A and may be complex/incomplete. SVD exists for every
real rectangular matrix; singular values are nonnegative and relate to square
roots of eigenvalues of AᵀA. SVD exposes rank, conditioning, and low-rank structure.

### Q4. What does a gradient mean?

Vector of first partial derivatives of a scalar objective; under Euclidean
geometry it points in steepest local increase. Negative gradient is a local,
not global, descent direction.

### Q5. Why does backpropagation scale?

Reverse-mode autodiff applies chain rule from one scalar loss backward, reusing
intermediate derivatives. Cost is a small constant multiple of forward compute,
while memory stores activations unless recomputed/checkpointed.

### Q6. Convex versus non-convex?

For convex f over convex domain, line interpolation satisfies the convex inequality
and every local minimum is global. Non-convex objectives can have saddles/local
structure; modern optimizers still work empirically due to architecture, scale,
and optimization dynamics.

### Q7. Independence versus zero correlation?

Independence implies zero covariance when moments exist; zero covariance only
rules out linear association. Joint Gaussian variables are a notable case where
zero covariance implies independence.

### Q8. Likelihood versus probability?

Probability treats parameter fixed and outcomes variable. Likelihood treats
observed data fixed and compares parameter values; it is not automatically
normalized over parameters.

### Q9. MLE versus MAP?

MLE maximizes data likelihood. MAP maximizes posterior, combining likelihood with
prior. MAP is a point estimate and differs from posterior mean/predictive
integration. Priors often correspond to regularizers.

### Q10. Why n − 1 in sample variance?

Estimating the mean consumes one degree of freedom; squared residuals around x̄
sum with one linear constraint. Dividing by n − 1 corrects bias for population
variance under i.i.d. assumptions.

### Q11. What does a 95% confidence interval mean?

The procedure covers the fixed true parameter in 95% of repeated samples under
assumptions. It is not automatically a 95% posterior probability statement for
the realized interval.

### Q12. Why can a tiny p-value be unimportant?

With huge n, tiny effects can be estimated precisely. Product importance depends
on effect magnitude, cost, guardrails, and uncertainty, not threshold crossing.

### Q13. Entropy versus cross-entropy?

Entropy is expected surprise under true P. Cross-entropy is expected surprise
when encoding P outcomes using model Q. Their difference is KL(P ‖ Q).

### Q14. What does calibration mean mathematically?

For score S, calibrated prediction satisfies P(Y = 1 ∣ S = s) = s in an idealized
sense. Empirical evaluation bins/smooths and must consider time, slices, and
finite-sample uncertainty.

### Q15. Why does standard error scale as 1/√n?

Variance of independent sample mean is σ²/n, so its standard deviation is σ/√n.
Dependence, weighting, heavy tails, or non-identical distributions change this.

## 3. Core derivations

### Derivation A: least-squares gradient

Given J(w) = (1/n)‖Xw − y‖²:

> J = (1/n)(Xw − y)ᵀ(Xw − y)  
> ∇J = (2/n)Xᵀ(Xw − y)

Setting zero gives XᵀXw = Xᵀy. Discuss rank and why QR/SVD is preferable to
explicit inverse.

### Derivation B: logistic loss gradient

With z = wᵀx, p = σ(z), L = −y log p − (1 − y)log(1 − p):

> ∂L/∂p = −y/p + (1 − y)/(1 − p)  
> ∂p/∂z = p(1 − p)  
> ∂L/∂z = p − y  
> ∂L/∂w = (p − y)x

Mention stable logits implementation and regularization.

### Derivation C: variance of sum

> Var(X + Y)  
> = E[((X − E[X]) + (Y − E[Y]))²]  
> = Var(X) + Var(Y) + 2Cov(X, Y)

Independence removes covariance; uncorrelated is enough for this equality but not
for factorizing full distribution.

### Derivation D: Bayes classifier under costs

Let p = P(Y = 1 ∣ x), false-positive cost C<sub>FP</sub>, false-negative cost
C<sub>FN</sub>.

> expected cost predict 1 = (1 − p)C<sub>FP</sub>  
> expected cost predict 0 = pC<sub>FN</sub>

Predict 1 when:

> p > C<sub>FP</sub>/(C<sub>FP</sub> + C<sub>FN</sub>)

State assumptions: calibrated probability, only two actions/costs, costs constant
by case, no capacity or long-term effects.

### Derivation E: PCA direction

For centered X, maximize projected squared norm:

> maximize vᵀXᵀXv subject to vᵀv = 1

Lagrangian stationarity gives:

> XᵀXv = λv

Thus v is an eigenvector; largest eigenvalue gives maximum variance. Subsequent
components add orthogonality.

## 4. Numerical drills

### Drill 1: shapes

X shape (128, 20), W shape (20, 5), b shape (5,).

- XW shape: (128, 5).
- adding b broadcasts across examples.
- summing cross-entropy across class axis gives one loss per example.
- gradient dW shape must be (20, 5).

### Drill 2: Bayes

Prevalence 2%, sensitivity 90%, FPR 4%.

> precision = (0.90 · 0.02)/[(0.90 · 0.02) + (0.04 · 0.98)]  
> = 0.018/0.0572 ≈ 31.47%

### Drill 3: confidence interval

n = 100, x̄ = 50, s = 10. Large-sample approximate 95% CI:

> SE = 10/√100 = 1  
> CI ≈ 50 ± 1.96 = [48.04, 51.96]

For a small normal sample use t critical value; for clustered observations this
calculation is optimistic.

### Drill 4: regularization

Two weights [3, 4]:

> L1 = 7  
> squared L2 penalty = 3² + 4² = 25  
> L2 norm = 5

Do not confuse L2 norm with squared L2 penalty.

## 5. Applied interview prompts

### Prompt 1: offline metric rose 0.2%; is it real?

Ask about paired examples, sample size, repeated experiments, time/group
dependence, variance across seeds/folds, multiple comparisons, metric uncertainty,
slices, and product importance. Bootstrap paired differences at independent unit
or run a controlled online experiment.

### Prompt 2: experiment p = 0.03 but guardrail worsened

Do not launch mechanically. Compare predefined decision rule, effect and CI,
guardrail severity/uncertainty, multiplicity, SRM/data quality, exposure, and
long-term risk. Primary improvement cannot trade through a hard safety/reliability
constraint without an explicit decision process.

### Prompt 3: correlation collapses after segmentation

Investigate confounding/Simpson’s paradox, selection, measurement, sample sizes,
within-group relationships, and causal DAG. Aggregation weights can produce the
overall association.

### Prompt 4: loss is NaN after mixed-precision change

Find first non-finite tensor; inspect logits, exp/log/division, loss scaling,
gradient norms, reductions, dtype casts, input ranges. Use stable with-logits
losses, max subtraction, appropriate accumulation precision, and controlled
rollback—not arbitrary clipping alone.

## 6. Part 2 capstone

Build a small binary logistic regression package using only NumPy for model math.

Requirements:

- validated shapes and finite inputs;
- stable sigmoid/log-loss from logits;
- analytic gradients and finite-difference check;
- mini-batch gradient descent with seed/config;
- optional L2 regularization excluding intercept;
- train/validation split created before preprocessing;
- standardization fitted only on training;
- loss curves, confusion metrics, ROC/PR operating analysis, calibration bins;
- bootstrap confidence interval for one paired model comparison;
- README deriving gradients and documenting assumptions/failures;
- unit tests including extreme logits and empty/mismatched inputs.

Advanced extension: compare closed-form/QR/Ridge linear regression conditioning on
a deliberately collinear dataset.

## 7. Exit checklist

- [ ] I can annotate every vector/matrix dimension.
- [ ] I can explain projection, eigenvectors, SVD, and conditioning.
- [ ] I can derive least-squares and logistic gradients.
- [ ] I can apply conditional probability and Bayes with base rates.
- [ ] I distinguish independence, correlation, and causality.
- [ ] I distinguish estimator bias, variance, SE, and data/model bias.
- [ ] I interpret confidence intervals and p-values correctly.
- [ ] I can design and debug an A/B experiment.
- [ ] I explain entropy, cross-entropy, KL, and mutual information.
- [ ] I completed the capstone or equivalent derivations/tests.

