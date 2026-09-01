# Chapter 4 — Probability

## 1. Probability models uncertainty; it does not remove it

Probability is a language for uncertain events and data-generating processes.
It distinguishes:

- uncertainty about which outcome occurs;
- variation across a population;
- uncertainty about unknown parameters;
- uncertainty created by incomplete information.

A probability statement is always conditional on a model, information set, and
event definition—even when that conditioning is left implicit.

## 2. Sample space, events, and axioms

- Sample space Ω: all possible outcomes.
- Outcome ω ∈ Ω: one possible result.
- Event A ⊆ Ω: a set of outcomes.

Probability P satisfies:

1. P(A) ≥ 0.
2. P(Ω) = 1.
3. For disjoint events A₁, A₂, …:

> P(A₁ ∪ A₂ ∪ …) = Σ P(A<sub>i</sub>)

Consequences:

> P(∅) = 0  
> P(Aᶜ) = 1 − P(A)  
> if A ⊆ B, then P(A) ≤ P(B)

General addition rule:

> P(A ∪ B) = P(A) + P(B) − P(A ∩ B)

The intersection is subtracted because it was counted twice.

## 3. Counting tools

### Multiplication principle

If a process has n₁ possibilities, then n₂ possibilities for each first choice,
total possibilities are n₁n₂.

### Factorial and permutations

> n! = n(n − 1)…1, with 0! = 1

Ordered arrangements of k from n:

> P(n, k) = n!/(n − k)!

### Combinations

Unordered choices:

> C(n, k) = n!/[k!(n − k)!]

Example: choosing 2 reviewers from 5 gives C(5, 2) = 10, not 20, because order
does not matter.

## 4. Conditional probability

For P(B) > 0:

> P(A ∣ B) = P(A ∩ B)/P(B)

Conditioning restricts the reference population to B.

Multiplication rule:

> P(A ∩ B) = P(A ∣ B)P(B) = P(B ∣ A)P(A)

Chain rule:

> P(A₁, …, A<sub>n</sub>)
> = P(A₁)P(A₂ ∣ A₁)…P(A<sub>n</sub> ∣ A₁, …, A<sub>n−1</sub>)

Autoregressive language models use this factorization for token sequences.

## 5. Law of total probability and Bayes’ theorem

If B₁, …, B<sub>k</sub> partition Ω:

> P(A) = Σ<sub>i=1</sub><sup>k</sup> P(A ∣ B<sub>i</sub>)P(B<sub>i</sub>)

Bayes’ theorem:

> P(B<sub>j</sub> ∣ A)
> = P(A ∣ B<sub>j</sub>)P(B<sub>j</sub>) / P(A)

or expanding the denominator:

> P(B<sub>j</sub> ∣ A)
> = [P(A ∣ B<sub>j</sub>)P(B<sub>j</sub>)]
> / [Σ<sub>i</sub>P(A ∣ B<sub>i</sub>)P(B<sub>i</sub>)]

Vocabulary:

- prior P(B): belief/base rate before evidence;
- likelihood P(A ∣ B): probability of evidence under hypothesis;
- posterior P(B ∣ A): updated probability after evidence;
- evidence P(A): normalizing probability.

### Medical-test example

Prevalence P(D) = 1%, sensitivity P(+ ∣ D) = 95%, and false-positive rate
P(+ ∣ not D) = 5%.

Imagine 10,000 people:

- 100 have disease; 95 test positive.
- 9,900 do not; 495 test positive.
- total positives = 590.

> P(D ∣ +) = 95/590 ≈ 16.1%

A “95% sensitive” test does not imply a positive result means 95% disease
probability. Base rates matter.

## 6. Independence and conditional independence

A and B are independent if:

> P(A ∩ B) = P(A)P(B)

equivalently, when probabilities are defined, P(A ∣ B) = P(A).

Mutual exclusivity is different. Disjoint nonzero-probability events cannot be
independent: observing one makes the other impossible.

### Pairwise versus mutual independence

Every pair can be independent without the whole set being mutually independent.
Mutual independence requires factorization for every subset.

### Conditional independence

A and B are conditionally independent given C if:

> P(A, B ∣ C) = P(A ∣ C)P(B ∣ C)

Two variables may be dependent marginally but independent given a common cause,
or independent marginally but dependent after conditioning on a collider.

Example: ice cream sales and drowning are associated because hot weather affects
both. Conditioning on temperature may reduce the association.

Naive Bayes assumes features are conditionally independent given the class. This
is often false, yet classification can work because exact probability modeling is
not always required for a useful decision boundary.

## 7. Random variables

A random variable X maps outcomes to numbers.

- Discrete: countable values; described by PMF p(x) = P(X = x).
- Continuous: described by density f(x), with probabilities over intervals.

For a continuous variable, P(X = exact x) = 0 even when f(x) > 0. Density can
exceed 1; its integral over the domain equals 1.

### CDF

> F(x) = P(X ≤ x)

The cumulative distribution function is nondecreasing, approaches 0 to the left
and 1 to the right, and works for discrete, continuous, and mixed distributions.

For continuous differentiable CDF, f(x) = F′(x).

## 8. Expectation

Discrete:

> E[X] = Σ<sub>x</sub> x · P(X = x)

Continuous:

> E[X] = integral of x f(x) over the domain

Expectation is a probability-weighted long-run average, not necessarily a
possible outcome. A fair die has mean 3.5.

### Linearity

> E[aX + bY + c] = aE[X] + bE[Y] + c

Linearity does **not** require independence.

Law of the unconscious statistician:

> E[g(X)] = Σ g(x)p(x) or integral of g(x)f(x)

In general E[g(X)] ≠ g(E[X]). Jensen’s inequality describes the direction for
convex/concave g.

## 9. Variance, standard deviation, and moments

> Var(X) = E[(X − μ)²], where μ = E[X]

Equivalent identity:

> Var(X) = E[X²] − E[X]²

Standard deviation:

> SD(X) = √Var(X)

Rules:

> Var(aX + b) = a²Var(X)  
> Var(X + Y) = Var(X) + Var(Y) + 2Cov(X, Y)

If X and Y are independent, covariance is zero and variances add. Zero covariance
does not generally imply independence, except in special families such as jointly
Gaussian variables.

Higher moments describe skewness and tail/heaviness, but can be unstable or not
exist for heavy-tailed distributions.

## 10. Covariance and correlation

> Cov(X, Y) = E[(X − E[X])(Y − E[Y])]

Equivalent:

> Cov(X, Y) = E[XY] − E[X]E[Y]

Pearson correlation:

> ρ<sub>XY</sub> = Cov(X, Y)/(SD(X)SD(Y))

when both standard deviations are positive. Correlation is dimensionless and in
[−1, 1], measuring linear association.

Warnings:

- correlation does not imply causation;
- zero Pearson correlation does not mean no nonlinear dependence;
- outliers can dominate;
- aggregation can reverse relationships (Simpson’s paradox);
- selection/conditioning can create spurious association.

Covariance matrix Σ has entries Σ<sub>ij</sub> = Cov(X<sub>i</sub>, X<sub>j</sub>)
and is symmetric PSD.

## 11. Joint, marginal, and conditional distributions

Joint P(X, Y) describes variables together. Marginalize to remove a variable:

> P(X = x) = Σ<sub>y</sub> P(X = x, Y = y)

Conditional:

> P(Y = y ∣ X = x) = P(X = x, Y = y)/P(X = x)

Factorization:

> P(X, Y) = P(Y ∣ X)P(X)

ML often models P(Y ∣ X) discriminatively, or a joint/generative factorization.

## 12. Conditional expectation and variance

E[Y ∣ X] is itself a random variable/function of X. Under squared error, the
optimal prediction is the conditional mean:

> f*(x) = E[Y ∣ X = x]

Under absolute error, a conditional median is optimal. Under asymmetric quantile
loss, the conditional quantile is optimal.

Law of total expectation:

> E[Y] = E[E[Y ∣ X]]

Law of total variance:

> Var(Y) = E[Var(Y ∣ X)] + Var(E[Y ∣ X])

Interpretation: total variation equals average unexplained within-X variation plus
variation explained by conditional means.

## 13. Common discrete distributions

### Bernoulli(p)

X ∈ {0, 1}, P(X = 1) = p.

> E[X] = p  
> Var(X) = p(1 − p)

Models one binary trial.

### Binomial(n, p)

Number of successes in n independent equal-probability Bernoulli trials:

> P(X = k) = C(n, k)pᵏ(1 − p)ⁿ⁻ᵏ  
> E[X] = np  
> Var(X) = np(1 − p)

Independence and constant p are assumptions, not guaranteed by “n trials.”

### Categorical and multinomial

Categorical selects one of K categories with probabilities p₁, …, p<sub>K</sub>.
Multinomial counts category outcomes across n independent categorical trials.

### Geometric(p)

Trials until first success (support convention may begin at 0 or 1; state it).
It is memoryless.

### Poisson(λ)

Counts events in an interval under independent constant-rate assumptions:

> P(X = k) = e⁻λ λᵏ/k!  
> E[X] = Var(X) = λ

Real count data often has variance greater than mean (overdispersion), motivating
negative binomial or richer models.

## 14. Common continuous distributions

### Uniform(a, b)

Constant density on [a, b].

> E[X] = (a + b)/2  
> Var(X) = (b − a)²/12

### Normal/Gaussian(μ, σ²)

Bell-shaped density determined by mean and variance:

> f(x) = [1/(σ√(2π))] · exp(−(x − μ)²/(2σ²))

Standardization:

> Z = (X − μ)/σ

Normality is often an approximation for errors or sample averages, not a law for
all raw features. Heavy tails and skew matter.

### Exponential(λ)

Waiting time in a constant-rate Poisson process:

> f(x) = λe⁻λˣ for x ≥ 0  
> E[X] = 1/λ

It is memoryless.

### Beta(α, β)

Support (0, 1), flexible for probabilities. Conjugate prior for Bernoulli/binomial
probability under a standard Bayesian model.

> E[X] = α/(α + β)

### Gamma

Positive-valued flexible distribution for waiting times, rates, and scale
parameters. Parameterizations differ (rate versus scale); always check the API.

### Multivariate Gaussian

Characterized by mean vector μ and covariance Σ. Equal-density contours are
ellipsoids. When Σ is singular, density on full space is not ordinary but the
distribution can exist on a lower-dimensional subspace.

## 15. Transformations and standardization

If Y = g(X) and g is one-to-one differentiable, density transformation includes
the Jacobian:

> f<sub>Y</sub>(y) = f<sub>X</sub>(g⁻¹(y)) · |d g⁻¹(y)/dy|

The Jacobian accounts for expansion/compression of volume. Normalizing flows use
invertible transformations and tractable Jacobian determinants.

Standard score z = (x − μ)/σ has mean 0 and variance 1 when μ and σ are the true
mean/SD. It does not make a non-Gaussian distribution Gaussian.

## 16. Law of large numbers and central limit theorem

### Law of large numbers (LLN)

Under suitable conditions, sample mean converges to population mean as n grows:

> X̄<sub>n</sub> → μ

It does not say small samples are accurate or that every sequence improves
monotonically.

### Central limit theorem (CLT)

Under suitable independence/weak-dependence and finite-variance conditions:

> √n (X̄ − μ)/σ converges in distribution toward Normal(0, 1)

Consequences:

- standard error of mean decreases roughly as 1/√n;
- four times the sample size roughly halves standard error;
- sums/means may be approximately normal even when individual observations are not.

CLT quality can be poor for small n, heavy tails, strong dependence, extreme
skew, or rare-event metrics. It does not make the original data normal.

## 17. Concentration inequalities

They bound deviation without necessarily knowing an exact distribution.

### Markov

For nonnegative X and a > 0:

> P(X ≥ a) ≤ E[X]/a

### Chebyshev

For finite variance:

> P(|X − μ| ≥ kσ) ≤ 1/k²

These are broad but loose. Hoeffding/Chernoff bounds use stronger boundedness or
moment assumptions and give exponential concentration. Generalization theory uses
concentration to relate sample and population behavior.

## 18. Monte Carlo estimation

Approximate expectation with samples X₁, …, X<sub>n</sub>:

> E[g(X)] ≈ (1/n)Σ g(X<sub>i</sub>)

Error usually decreases at O(1/√n), largely independent of dimension, but variance
can be huge. Variance reduction: importance sampling, control variates,
antithetic sampling, stratification, and quasi-Monte Carlo.

### Importance sampling

Estimate under target p using samples from proposal q:

> E<sub>p</sub>[f(X)] = E<sub>q</sub>[f(X)p(X)/q(X)]

where q covers all regions p does. Poor proposals create enormous weights and
unstable estimates. Off-policy evaluation shares this issue.

## 19. Probability calibration and odds

Odds for probability p:

> odds = p/(1 − p)

Log-odds/logit:

> logit(p) = log[p/(1 − p)]

Inverse is sigmoid. Logistic regression models log-odds as an affine function:

> logit(P(Y = 1 ∣ x)) = wᵀx + b

A one-unit increase in feature x<sub>j</sub> multiplies odds by exp(w<sub>j</sub>)
when other represented features are held fixed. This is association under the
model, not necessarily causal effect.

## 20. Common reasoning traps

- Base-rate neglect: ignoring prevalence in posterior probability.
- Prosecutor’s fallacy: confusing P(evidence ∣ innocent) with
  P(innocent ∣ evidence).
- Independence assumption made from convenience rather than process.
- Treating zero correlation as independence.
- Believing a density value is a probability.
- Conditioning on a collider and creating association.
- Assuming samples are independent when repeated users/sessions exist.
- Interpreting frequentist confidence as posterior probability.
- Using probability outputs as calibrated without checking.

## 21. Exercises

### Beginner

1. Draw a two-event Venn diagram and derive the addition rule.
2. Solve the medical-test example using both counts and Bayes’ formula.
3. Compute mean and variance for a Bernoulli variable.
4. Distinguish mutual exclusivity and independence with coin/die examples.

### Intermediate

1. Prove Var(aX + b) = a²Var(X).
2. Derive law of total expectation for a discrete partition.
3. Find dependent random variables with zero covariance.
4. Simulate the LLN and CLT for a skewed distribution.

### Advanced/interview

1. Explain Simpson’s paradox and collider bias using causal diagrams.
2. Derive the Bayes-optimal binary decision under unequal costs.
3. Explain why importance sampling fails when proposal tails are too light.
4. Describe how prevalence shift affects precision and calibration.
5. When is a Poisson model inappropriate for production count data?

