# Chapter 1 — Linear Regression and Regularization

## 1. Model and geometry

For x ∈ ℝᵈ:

> ŷ = wᵀx + b

The prediction is an affine hyperplane. “Linear” means linear in parameters; a
model using transformed features [x, x²] remains linear in coefficients while
nonlinear in raw x.

For n examples matrix form:

> ŷ = Xw + b1

Often add a column of ones to X and absorb intercept into parameter vector.

## 2. Ordinary least squares (OLS)

Objective:

> minimize<sub>w,b</sub> (1/n)Σ(y<sub>i</sub> − (wᵀx<sub>i</sub> + b))²

or:

> minimize ‖Xw − y‖₂²

Why squared error:

- differentiable and convex;
- closed-form/efficient solvers;
- penalizes large errors;
- MLE under independent Gaussian errors with constant variance;
- conditional mean is optimal under expected squared loss.

It is not automatically correct for heavy tails, asymmetric costs, censored data,
counts, or heteroscedastic uncertainty.

## 3. Closed-form derivation

> J(w) = (Xw − y)ᵀ(Xw − y)

Gradient:

> ∇J = 2Xᵀ(Xw − y)

Set zero:

> XᵀXw = Xᵀy

If XᵀX is invertible:

> ŵ = (XᵀX)⁻¹Xᵀy

This is conceptual. Numerically use QR/SVD/least-squares solver, not explicit
inverse. When d is huge, iterative optimization may be better.

## 4. Interpretation

w<sub>j</sub> is predicted target change for one-unit increase in represented
x<sub>j</sub>, holding represented other features fixed.

Qualification:

- depends on units/scaling and feature coding;
- interactions/nonlinearity alter interpretation;
- correlation makes individual coefficients unstable;
- association is not causal effect;
- extrapolation beyond training support can be unreasonable.

For log-transformed target/input, coefficient interpretations change (approximate
percent effects under conditions); state exact transformation.

## 5. Statistical assumptions

For classical coefficient inference, common assumptions:

1. linear conditional mean in chosen representation;
2. zero conditional error mean E[ε ∣ X] = 0;
3. independent/correctly modeled errors;
4. no perfect multicollinearity;
5. homoscedasticity for textbook ordinary SE;
6. normal errors for exact small-sample tests, not basic OLS fitting.

Prediction can work despite inference-assumption violations. Robust standard errors
handle some heteroscedasticity, not endogeneity or bad specification.

## 6. Residual diagnostics

Residual e = y − ŷ.

Inspect:

- residual versus fitted: nonlinearity/heteroscedasticity;
- residual over time/group: dependence/shift;
- Q–Q/tails: error distribution;
- leverage/influence: unusual feature points;
- systematic segment bias;
- error versus target magnitude.

High leverage means unusual x; large residual means poor fit; influential points
substantially change coefficients. Cook’s distance combines leverage/residual under
model assumptions.

## 7. Multicollinearity

Correlated/redundant columns make XᵀX ill-conditioned:

- coefficients unstable/large;
- standard errors grow;
- individual signs change across samples;
- predictions may remain stable within observed region.

Diagnose with domain redundancy, correlations, singular values/condition number,
and variance inflation factor (with limitations). Address via feature redesign,
regularization, more diverse data, PCA, or reporting joint effects.

## 8. Ridge regression (L2)

> minimize ‖y − Xw‖₂² + λ‖w‖₂²

Solution (intercept excluded/centered):

> ŵ<sub>ridge</sub> = (XᵀX + λI)⁻¹Xᵀy

Effects:

- shrinks weights continuously;
- improves conditioning;
- reduces variance at cost of bias;
- distributes weight among correlated features;
- rarely makes exact zeros.

Standardize features before penalty so units do not determine shrinkage. Select λ
by CV. Larger λ means stronger shrinkage; library parameterization may divide loss
by n differently.

## 9. Lasso (L1)

> minimize ‖y − Xw‖₂² + λΣ|w<sub>j</sub>|

Effects:

- can set coefficients exactly zero;
- useful for sparse high-dimensional selection;
- unstable choice among correlated features;
- biased shrinkage for large effects;
- no simple ordinary closed form; coordinate descent/proximal methods common.

Geometric intuition: L1 constraint has corners; quadratic loss contours often touch
a corner where coefficients are zero.

## 10. Elastic Net

> minimize loss + λ[α‖w‖₁ + (1 − α)‖w‖₂²]

Combines sparsity and correlated-feature grouping. Libraries differ in α/λ names
and scaling. Tune nested in pipeline.

## 11. Polynomial and basis features

For one x:

> ŷ = w₀ + w₁x + w₂x² + … + w<sub>k</sub>xᵏ

Still linear in parameters. High-degree raw powers are poorly conditioned and
extrapolate wildly. Standardize/use orthogonal polynomials/splines.

### Splines

Piecewise polynomials joined smoothly at knots. They model flexible nonlinear
relationships with local control. Select knots/regularization by validation and
domain. Generalized additive models sum smooth one-feature functions, offering
interpretability and nonlinear fit.

## 12. Alternative regression losses

### MAE / median regression

> minimize Σ|y − ŷ|

Robust to large residuals, predicts conditional median. Nondifferentiable at zero
but optimizable.

### Huber

Quadratic for |error| ≤ δ, linear beyond. Smoothly balances small-error efficiency
and outlier robustness. δ is scale-sensitive.

### Quantile loss

Asymmetric pinball loss predicts conditional quantile; useful for intervals and
asymmetric costs. Train several quantiles, watch quantile crossing.

### Poisson/Tweedie objectives

Counts/nonnegative skewed targets may need generalized linear models with suitable
link/distribution rather than Gaussian squared loss. Validate variance/zero
inflation/exposure.

## 13. Generalized linear model (GLM) idea

GLM combines:

- response distribution from exponential family;
- linear predictor η = wᵀx;
- link g connecting mean μ to η: g(μ) = η.

Examples:

- Gaussian + identity → linear regression;
- Bernoulli + logit → logistic regression;
- Poisson + log → count regression.

Offsets model known exposure, e.g. log time at risk in Poisson rate model.

## 14. Metrics and transformations

Evaluate MAE/RMSE/quantile loss aligned with business costs, plus bias and slices.
R² alone can hide high-tail errors and can be negative out of sample.

If target trained in log space, comparing transformed-space RMSE does not directly
answer original-unit error. Inverse predictions and evaluate original product
units, accounting for desired mean/median.

## 15. Complexity

- Prediction: O(d) per example for dense linear model, O(nnz) sparse.
- Gradient epoch: O(nd).
- Normal equations: forming O(nd²), solving roughly O(d³), plus conditioning;
  shape/regime dependent.
- Sparse linear solvers scale well for text/high-dimensional data.

Linear models are strong production baselines: low latency, compact, explainable,
well-calibratable, easy to retrain.

## 16. Failure modes

- omitted nonlinearities/interactions;
- extrapolation;
- leakage/high-cardinality memorization;
- multicollinearity coefficient instability;
- heteroscedastic/heavy-tailed errors;
- target clipping/censoring;
- correlated repeated observations;
- regularization without scaling;
- preprocessing fitted before split;
- coefficient interpreted causally.

## 17. Exercises

1. Derive normal equations and Ridge solution.
2. Implement OLS via gradient descent and `lstsq`; compare conditioning.
3. Create collinear features and plot coefficient versus λ.
4. Compare squared, absolute, Huber, and quantile loss under outliers.
5. Explain predictions versus coefficient inference assumptions.

