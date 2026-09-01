# Chapter 5 — Statistics and Estimation

## 1. Probability runs forward; statistics reasons backward

- Probability: given a distribution/model, what data might occur?
- Statistics: given observed data, what can we infer about the population/model?

```text
probability: parameters/process -> possible samples
statistics:  observed sample     -> uncertain parameter/process conclusions
```

Every inference depends on how the sample was selected, assumptions about the
data-generating process, and the estimator/procedure—not only the number of rows.

## 2. Descriptive versus inferential statistics

**Descriptive statistics** summarize observed data: counts, mean, quantiles,
variance, histograms, correlations.

**Inferential statistics** use a sample to estimate/test claims about a target
population or future process, with uncertainty.

A perfectly computed sample mean can be a terrible population estimate when the
sample is selected, stale, duplicated, or measured incorrectly.

## 3. Measures of center

### Mean

> x̄ = (1/n)Σ x<sub>i</sub>

Uses every value and minimizes sum of squared deviations. Sensitive to outliers.

### Median

Middle order statistic (or average of two middle values under a common even-n
convention). Minimizes sum of absolute deviations and is robust to extreme values.

### Mode

Most frequent value; can be multiple or unstable. For continuous data, depends on
density estimation/binning.

### Trimmed and winsorized means

- Trimmed mean removes a fraction of each tail.
- Winsorized mean caps tail values at chosen quantiles.

They trade some efficiency under ideal Gaussian data for robustness under outliers.
Do not remove/cap anomalies without understanding whether they are errors or the
important rare cases.

## 4. Spread and shape

### Population and sample variance

Population variance:

> σ² = (1/N)Σ(x<sub>i</sub> − μ)²

Sample variance commonly uses Bessel correction:

> s² = [1/(n − 1)]Σ(x<sub>i</sub> − x̄)²

Under i.i.d. finite-variance sampling, s² is unbiased for population variance.
This does not mean s is exactly unbiased for σ.

### Quantiles and IQR

q-th quantile is a value below which roughly q proportion lies. Implementations
differ in interpolation for finite samples.

> IQR = Q₃ − Q₁

IQR and median are robust. A common outlier flag [Q₁ − 1.5 IQR, Q₃ + 1.5 IQR]
is exploratory, not a universal deletion rule.

### Skewness and tails

Skewness describes asymmetry; kurtosis relates to fourth moments/tail and peak
behavior depending on definition. High-order moments are sensitive to outliers.
Inspect plots and quantiles, not just one coefficient.

## 5. Sampling methods and bias

### Simple random sample

Each population unit has equal known selection opportunity under the design.

### Stratified sample

Partition into strata and sample within each, often improving precision and
ensuring minority coverage. Weight back to population proportions for overall
estimates.

### Cluster sample

Sample groups (schools, regions) then units within/all units. Operationally cheap,
but within-cluster similarity increases variance; effective sample size is less
than row count.

### Systematic sample

Choose every k-th unit after a random start. Periodicity can bias results.

### Convenience/voluntary sample

Easy but selection probabilities are unknown and respondents can differ
systematically. Huge size does not repair unknown selection bias.

### Sampling weights

If inclusion probability is π<sub>i</sub>, inverse probability weight is roughly
1/π<sub>i</sub>. Extreme weights increase variance and depend on correct selection
model/design.

## 6. Parameters, statistics, and estimators

- Parameter: fixed unknown population property, e.g. μ.
- Statistic: function of observed sample, e.g. x̄.
- Estimator: rule producing an estimate, e.g. sample mean.
- Estimate: realized numeric value, e.g. 4.82.

An estimator is a random variable before data is observed because it changes
across possible samples.

## 7. Evaluating estimators

### Bias

> Bias(θ̂) = E[θ̂] − θ

Unbiased means expectation equals the true parameter. Unbiased is not automatically
best for prediction.

### Variance

> Var(θ̂) = E[(θ̂ − E[θ̂])²]

### Mean squared error

> MSE(θ̂) = E[(θ̂ − θ)²] = Var(θ̂) + Bias(θ̂)²

A slightly biased estimator can have much lower variance and MSE—regularization
uses this trade-off.

### Consistency

θ̂<sub>n</sub> converges toward θ as n grows under assumptions. A consistent
estimator can still be poor at available sample sizes.

### Efficiency

Among comparable estimators, lower variance is more efficient. Cramér–Rao bounds
provide a lower variance bound for unbiased estimators under regularity conditions.

### Robustness

Sensitivity to outliers/model misspecification. The mean has breakdown point near
0; one arbitrarily extreme value can move it arbitrarily. Median breakdown point
approaches 50%.

## 8. Likelihood

For model p(x ∣ θ) and observed independent data x₁, …, x<sub>n</sub>:

> L(θ; data) = ∏<sub>i=1</sub><sup>n</sup> p(x<sub>i</sub> ∣ θ)

Likelihood is a function of θ with data fixed. It is not generally a probability
distribution over θ and need not integrate to one.

Log-likelihood:

> ℓ(θ) = Σ log p(x<sub>i</sub> ∣ θ)

Logs preserve the maximizing θ, turn products into sums, and improve numerical
stability.

## 9. Maximum likelihood estimation (MLE)

> θ̂<sub>MLE</sub> = arg max<sub>θ</sub> L(θ; data)
> = arg max<sub>θ</sub> ℓ(θ)

### Bernoulli MLE

For y<sub>i</sub> ∈ {0, 1} with success probability p:

> ℓ(p) = Σ [y<sub>i</sub>log p + (1 − y<sub>i</sub>)log(1 − p)]

Differentiate and set to zero:

> p̂ = (1/n)Σ y<sub>i</sub>

The MLE is observed positive fraction.

### Gaussian mean MLE

For independent Normal(μ, σ²) with known σ², maximizing likelihood is equivalent
to minimizing Σ(x<sub>i</sub> − μ)², giving μ̂ = x̄.

If variance is also estimated by MLE, denominator is n, not n − 1. The n − 1
sample variance is unbiased; MLE and unbiasedness optimize different criteria.

### MLE properties and limits

Under regularity/identifiability conditions, MLE is consistent, asymptotically
normal, and efficient. Failures occur with small samples, boundaries, non-
identifiability, separation in logistic regression, misspecification, or violated
independence.

## 10. Bayesian inference and MAP

Bayes’ rule for parameters:

> posterior p(θ ∣ data)
> = likelihood p(data ∣ θ) · prior p(θ) / evidence p(data)

The posterior represents uncertainty about θ under the model/prior.

### Maximum a posteriori (MAP)

> θ̂<sub>MAP</sub> = arg max p(θ ∣ data)
> = arg max [log p(data ∣ θ) + log p(θ)]

Regularization connection:

- Gaussian prior on weights → L2-like penalty.
- Laplace prior → L1-like penalty.

MLE is MAP with a flat prior only under careful parameterization/support notions;
“uninformative” priors are not invariant automatically.

### Beta–Bernoulli example

Prior p ∼ Beta(α, β). Observe s successes and f failures. Posterior:

> p ∣ data ∼ Beta(α + s, β + f)

Posterior mean:

> E[p ∣ data] = (α + s)/(α + β + s + f)

The prior behaves like pseudo-counts and stabilizes sparse rates. Choose it based
on domain/robustness, not to force a desired result.

### Posterior predictive

Prediction integrates parameter uncertainty:

> p(y<sub>new</sub> ∣ data) = integral p(y<sub>new</sub> ∣ θ)p(θ ∣ data) dθ

Point-estimate prediction ignores this integration.

## 11. Standard error

Standard deviation describes variation among observations. **Standard error (SE)**
describes uncertainty of an estimator across repeated samples.

For independent observations with finite variance:

> SE(x̄) = σ/√n, estimated by s/√n

Doubling n does not halve SE; quadrupling approximately does.

For clustered/repeated data, naïve s/√n is too optimistic. Use cluster-robust,
block bootstrap, mixed models, or design-aware methods.

## 12. Confidence intervals

A frequentist 95% confidence procedure produces intervals covering the fixed true
parameter in 95% of repeated samples under assumptions. After observing one
interval, saying “95% probability the fixed parameter is inside” is not the
standard frequentist interpretation.

Approximate mean CI with large n/normal assumptions:

> x̄ ± z<sub>0.975</sub> · SE(x̄)

where z<sub>0.975</sub> ≈ 1.96. With unknown variance and small normal samples, use
a t critical value with n − 1 degrees of freedom.

### Proportion intervals

The simple Wald interval p̂ ± 1.96√[p̂(1 − p̂)/n] performs poorly for small n or
extreme p. Wilson or exact/binomial methods are safer. For dependent users/events,
use unit-aware resampling or modeling.

### Confidence versus prediction interval

- Confidence interval: uncertainty about a population parameter/mean response.
- Prediction interval: uncertainty for a new observation; wider because it
  includes outcome noise.

## 13. Bootstrap

Nonparametric bootstrap:

1. sample n observations with replacement from observed data;
2. compute statistic;
3. repeat B times;
4. use bootstrap distribution for SE/interval/bias assessment.

Assumption: empirical distribution reasonably represents the population and
resampling unit captures independence.

Variants:

- percentile interval;
- basic interval;
- bias-corrected accelerated (BCa);
- parametric bootstrap;
- cluster/block/time-series bootstrap.

Bootstrap can fail for tiny samples, extremes/maxima, non-smooth statistics,
heavy tails, dependence ignored by row resampling, or distribution shift.

## 14. Jackknife and permutation

### Jackknife

Leave one observation out repeatedly to estimate bias/variance influence. Useful
for smooth statistics and influence diagnostics; not universal.

### Permutation/randomization test

Under a null of exchangeability, shuffle treatment labels or paired outcomes and
recompute a statistic. Compare observed statistic to this null distribution.
Permutation must respect experiment design, clusters, pairing, and time. Arbitrary
row shuffling can be invalid.

## 15. Correlation and regression inference

Pearson correlation quantifies linear association. Spearman correlation applies
Pearson to ranks and captures monotonic association with more robustness to scale/
outliers, but neither establishes causation.

Ordinary least squares estimates coefficients minimizing squared residuals.
Classical standard-error inference commonly assumes:

- correct linear conditional-mean specification;
- independent or correctly modeled errors;
- zero conditional error mean (no omitted endogeneity);
- finite variance; often homoscedasticity for textbook SE;
- no perfect multicollinearity;
- normal errors for exact small-sample tests, not for coefficient estimation itself.

Heteroscedasticity-robust SE addresses certain variance misspecification, not
omitted-variable bias, reverse causation, bad measurement, or dependence.

### Coefficient interpretation

In multiple linear regression, β<sub>j</sub> is the model's expected target change
per one-unit x<sub>j</sub> increase while represented other features are held
fixed. This is not automatically a causal effect; “holding fixed” may be
scientifically impossible or conditioned on a collider/mediator.

## 16. Regularization as estimation

Ridge:

> minimize ‖y − Xw‖₂² + λ‖w‖₂²

Solution when defined:

> ŵ = (XᵀX + λI)⁻¹Xᵀy

Adding λI improves conditioning and shrinks coefficients. Intercept is often not
penalized. Scaling changes penalty meaning.

Lasso:

> minimize ‖y − Xw‖₂² + λ‖w‖₁

It can set coefficients exactly zero. Selection is unstable among correlated
features, and post-selection inference requires care.

Regularization introduces bias to reduce variance/prediction error. Choose λ on
validation/CV nested correctly, not by test-set results.

## 17. Missing data mechanisms

- MCAR: missingness independent of observed/unobserved values.
- MAR: missingness depends on observed variables, after conditioning.
- MNAR: missingness depends on unobserved/missing value or other unobserved causes.

Listwise deletion is unbiased only under restrictive conditions and loses power.
Mean imputation distorts variance/correlation and understates uncertainty. Multiple
imputation reflects uncertainty under a model. Missingness indicators can be
predictive but may encode unstable policy/process artifacts.

Production monitoring must distinguish natural missingness from pipeline outage.

## 18. Robust statistics and influence

An estimator's influence function describes sensitivity to infinitesimal
contamination. Practical robust tools:

- median and MAD;
- trimmed/winsorized summaries;
- Huber loss: quadratic near zero, linear in tails;
- quantile regression;
- robust covariance/regression;
- explicit mixture/outlier models.

Robustness is not permission to ignore rare high-impact cases. Fraud, faults, and
safety events may live in the tails the product most needs.

### Median absolute deviation

> MAD = median(|x<sub>i</sub> − median(x)|)

For Gaussian consistency, a scaling factor around 1.4826 is often applied.

## 19. Multiple model selection and optimism

Trying many features/models and reporting the best validation result introduces
selection optimism. Consequences:

- nominal confidence intervals ignore search;
- repeated test peeking invalidates the test claim;
- small improvements are likely noise;
- researcher degrees of freedom enable p-hacking.

Mitigations: preregister key comparisons, log all experiments, use nested CV or a
fresh holdout, correct multiple testing when appropriate, and confirm with
independent/online data.

## 20. Exercises

### Beginner

1. Compute mean, median, sample variance, IQR, and MAD for a small dataset.
2. Explain parameter, statistic, estimator, and estimate with an example.
3. Derive Bernoulli MLE.
4. Distinguish standard deviation and standard error.

### Intermediate

1. Show MSE = variance + bias² for an estimator.
2. Construct a mean CI and explain its repeated-sampling meaning.
3. Implement bootstrap SE for median, resampling at the correct unit.
4. Update a Beta prior after binary outcomes and compute posterior mean.

### Advanced/interview

1. Compare MLE, MAP, posterior mean, and regularized ERM.
2. When does a huge sample still give a misleading narrow CI?
3. Explain why cluster dependence changes effective sample size.
4. Diagnose complete separation in logistic regression and propose remedies.
5. Explain what heteroscedasticity-robust standard errors do and do not fix.

