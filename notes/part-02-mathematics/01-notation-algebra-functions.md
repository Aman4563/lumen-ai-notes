# Chapter 1 — Notation, Algebra, Functions, and Numerical Thinking

## 1. Mathematics is executable specification

An equation is not decoration. It specifies objects, operations, and assumptions.
For every expression, ask:

1. What type is each object: scalar, vector, matrix, random variable, set?
2. What are its dimensions or domain?
3. Is the operation defined?
4. What does the result mean in the product/model?
5. Is the computation numerically safe?

Example:

> **Linear score**  
> z = wᵀx + b

If x and w each have d entries, wᵀx is a scalar dot product and b is a scalar.
In code, a silent broadcasting mistake can produce a d × d matrix instead.

## 2. Number systems and intervals

- ℕ: natural numbers, commonly {0, 1, 2, …} or {1, 2, …}; state convention.
- ℤ: integers.
- ℚ: rational numbers.
- ℝ: real numbers.
- ℂ: complex numbers.

Intervals:

- [a, b] includes both endpoints.
- (a, b) excludes both.
- [a, b) includes a but excludes b.
- x ∈ [0, 1] means 0 ≤ x ≤ 1.

ML probabilities live in [0, 1]. Log probabilities can be negative and extend
toward −∞ when a probability approaches zero.

## 3. Variables, constants, indices, and shapes

- A scalar is one number: learning rate η = 0.001.
- A vector is an ordered list: x ∈ ℝᵈ.
- A matrix is a rectangular array: X ∈ ℝⁿˣᵈ.
- A tensor generalizes arrays to more axes.

Common ML convention:

```text
X has n rows (examples) and d columns (features)

             feature 1   feature 2   ... feature d
example 1       x₁₁          x₁₂      ...   x₁d
example 2       x₂₁          x₂₂      ...   x₂d
   ...           ...          ...            ...
example n       xn₁          xn₂      ...   xnd
```

x<sub>ij</sub> means row i, column j. In some fields examples are columns instead;
do not guess—check the definition.

## 4. Sums, products, and averages

### Summation

> **Sum**  
> Σ<sub>i=1</sub><sup>n</sup> x<sub>i</sub>
> = x₁ + x₂ + … + x<sub>n</sub>

Useful rules:

> Σ(a<sub>i</sub> + b<sub>i</sub>) = Σa<sub>i</sub> + Σb<sub>i</sub>  
> Σ(c · a<sub>i</sub>) = c · Σa<sub>i</sub>, when c does not depend on i

### Arithmetic mean

> **Sample mean**  
> x̄ = (1/n) · Σ<sub>i=1</sub><sup>n</sup> x<sub>i</sub>

For [2, 4, 9], x̄ = 15/3 = 5.

### Product notation

> ∏<sub>i=1</sub><sup>n</sup> p<sub>i</sub>
> = p₁ · p₂ · … · p<sub>n</sub>

Independent likelihood terms multiply. Their logarithms add, which is both easier
to optimize and more numerically stable.

## 5. Exponents, roots, and logarithms

### Exponent rules

For positive bases where needed:

> aᵐ · aⁿ = aᵐ⁺ⁿ  
> aᵐ/aⁿ = aᵐ⁻ⁿ  
> (aᵐ)ⁿ = aᵐⁿ  
> a⁰ = 1  
> a⁻ⁿ = 1/aⁿ  
> a¹ᐟ² = √a

### Logarithm

log<sub>b</sub>(x) answers: “to what power must b be raised to obtain x?”

> log<sub>b</sub>(x) = y ⇔ bʸ = x

In ML, `log` usually means natural logarithm ln with base e ≈ 2.71828.

Rules for a, b > 0:

> log(ab) = log a + log b  
> log(a/b) = log a − log b  
> log(aᵏ) = k log a  
> log 1 = 0

Why logs dominate ML:

- products become sums;
- tiny probabilities avoid immediate underflow;
- exponential-family likelihoods simplify;
- relative change becomes additive;
- gradients are often convenient.

Example: multiplying 1,000 probabilities near 0.01 underflows floating point.
Instead compute Σ log p<sub>i</sub> and exponentiate only if actually needed.

## 6. Functions

A function maps each allowed input to exactly one output:

> f: domain → codomain

Example f(x) = 2x + 1 maps real numbers to real numbers. Its **range** is the set
of outputs actually produced.

### Composition

> (f ∘ g)(x) = f(g(x))

Neural networks are compositions of layers. The chain rule differentiates these
compositions efficiently.

### Inverse function

f⁻¹ reverses f only when f is one-to-one over the chosen domain. The notation f⁻¹
does not mean 1/f.

### Common ML functions

**Linear/affine:**

> f(x) = ax + b

Strictly, this is affine if b ≠ 0; ML commonly calls it linear regression.

**Polynomial:**

> f(x) = a₀ + a₁x + a₂x² + … + a<sub>k</sub>xᵏ

**Exponential:**

> f(x) = eˣ

**Sigmoid/logistic:**

> σ(z) = 1 / (1 + e⁻ᶻ)

It maps any real score to (0, 1). σ(0) = 0.5; σ(−z) = 1 − σ(z).

**Hyperbolic tangent:**

> tanh(z) = (eᶻ − e⁻ᶻ)/(eᶻ + e⁻ᶻ)

Maps to (−1, 1).

**ReLU:**

> ReLU(z) = max(0, z)

It is continuous but not differentiable at zero; implementations choose a
subgradient convention there.

**Softmax for K scores:**

> softmax(z)<sub>k</sub> = exp(z<sub>k</sub>) / Σ<sub>j=1</sub><sup>K</sup> exp(z<sub>j</sub>)

The outputs are positive and sum to one. For stability, subtract max(z) before
exponentiating; this leaves the result unchanged.

## 7. Lines, quadratics, and completing the square

### Slope

For two points (x₁, y₁) and (x₂, y₂):

> slope = (y₂ − y₁)/(x₂ − x₁), provided x₂ ≠ x₁

Slope is output change per unit input change.

### Quadratic

> ax² + bx + c = 0, where a ≠ 0

Solutions:

> x = (−b ± √(b² − 4ac))/(2a)

The discriminant Δ = b² − 4ac determines the number of real roots.

Completing the square exposes the minimum of a positive quadratic:

> ax² + bx + c = a(x + b/(2a))² + c − b²/(4a)

Quadratic objectives appear in least squares and L2 regularization.

## 8. Sets, relations, and logic

- x ∈ A: x belongs to set A.
- A ⊆ B: every element of A belongs to B.
- A ∪ B: union.
- A ∩ B: intersection.
- A \ B: elements of A not in B.
- |A|: set cardinality; context distinguishes it from absolute value.
- A × B: Cartesian product of ordered pairs.

Logic:

- ¬P: not P.
- P ∧ Q: P and Q.
- P ∨ Q: P or Q (inclusive unless specified).
- P ⇒ Q: P implies Q.
- P ⇔ Q: equivalence in both directions.
- ∀: for all.
- ∃: there exists.

Contrapositive: P ⇒ Q is logically equivalent to ¬Q ⇒ ¬P, not to Q ⇒ P.

## 9. Absolute values, norms, and distances

For scalar x:

> |x| = x if x ≥ 0, otherwise −x

Absolute error treats positive and negative residual magnitude equally.

For vector x = [x₁, …, x<sub>d</sub>]:

> ‖x‖₁ = Σ |x<sub>j</sub>|  
> ‖x‖₂ = √(Σ x<sub>j</sub>²)  
> ‖x‖∞ = max<sub>j</sub> |x<sub>j</sub>|

Distance induced by a norm:

> d(x, y) = ‖x − y‖

Different norms encode different geometry and regularization behavior.

## 10. Sequences, limits, and asymptotic notation

A sequence is an ordered list a₁, a₂, … . A limit describes behavior as an index
or variable approaches a value.

> lim<sub>x→0</sub> sin(x)/x = 1

This limit underlies derivatives of trigonometric functions.

### Complexity notation

- O(g(n)): asymptotic upper bound, commonly used for worst-case growth.
- Ω(g(n)): asymptotic lower bound.
- Θ(g(n)): matching upper and lower asymptotic order.

Examples:

- scanning n examples: Θ(n);
- dense matrix multiplication for two n × n matrices: classical Θ(n³);
- sorting comparisons: O(n log n) for common algorithms;
- storing n × d dense data: Θ(nd).

Constants still matter in ML: GPU kernels, memory traffic, sparsity, batching,
communication, and numerical precision can dominate theoretical order.

## 11. Floating-point reality

Computers approximate real numbers with finite precision.

### Common failures

- overflow: exp(1000) exceeds representable range;
- underflow: multiplying tiny probabilities becomes zero;
- cancellation: subtracting nearly equal large numbers loses precision;
- non-associativity: (a + b) + c may differ from a + (b + c);
- invalid values: log(0), division by zero, square root of negative values;
- accumulation error over very large reductions.

### Stable patterns

**Log-sum-exp:**

> log(Σ exp(z<sub>i</sub>))
> = m + log(Σ exp(z<sub>i</sub> − m)), where m = max(z)

**Stable softmax:** subtract the maximum logit first.

**Clipped probability:** for reporting log loss, prevent log(0) with a clearly
documented ε; prefer stable library functions that operate on logits during
training.

**Variance:** naïve E[X²] − E[X]² can suffer cancellation; stable streaming or
two-pass algorithms are safer.

Do not compare floating-point values for exact equality after nontrivial
calculation; use tolerances appropriate to scale and dtype.

## 12. Units and dimensional analysis

Quantities with units constrain valid operations:

- adding 5 seconds to 3 meters is meaningless;
- dividing distance by time produces speed;
- exponent/log arguments should be dimensionless after scaling;
- coefficients inherit target units per feature unit.

Unit checks catch real feature bugs: milliseconds versus seconds, dollars versus
cents, Celsius versus Fahrenheit. Store units in schemas and tests.

## 13. Translating a formula into code

For mean squared error:

> MSE = (1/n) · Σ(y<sub>i</sub> − ŷ<sub>i</sub>)²

Reason before coding:

1. y and ŷ should have the same shape.
2. subtraction creates n residuals.
3. square is elementwise.
4. mean reduces n values to one scalar.
5. dtype should avoid integer overflow and unwanted truncation.
6. missing/non-finite values require an explicit policy.

```python
import numpy as np

def mean_squared_error(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)
    if y_true.shape != y_pred.shape:
        raise ValueError(f"shape mismatch: {y_true.shape} != {y_pred.shape}")
    if y_true.size == 0:
        raise ValueError("MSE is undefined for an empty input")
    if not (np.isfinite(y_true).all() and np.isfinite(y_pred).all()):
        raise ValueError("inputs must be finite")
    residual = y_true - y_pred
    return float(np.mean(residual * residual))
```

The validation code is part of mathematical correctness.

## 14. Beginner-to-advanced checks

### Beginner

1. Expand Σ<sub>i=1</sub><sup>4</sup>(2i + 1).
2. Compute σ(0), σ(2), and σ(−2) approximately.
3. Explain why log(ab) = log a + log b helps likelihood calculations.
4. State the shapes in z = Xw + b for n examples and d features.

### Intermediate

1. Prove softmax outputs sum to one.
2. Show that subtracting a constant c from every softmax logit does not change
   the result.
3. Compare L1, L2, and L∞ distance for x = [3, −4].
4. Explain how units expose a cents-versus-dollars bug.

### Advanced/interview

1. Why can the mathematically equivalent variance formulas behave differently in
   floating point?
2. What is the difference between a function's codomain and range?
3. Explain why vectorization can improve speed but increase temporary memory.
4. Give a situation in which asymptotic complexity hides the dominant system cost.

