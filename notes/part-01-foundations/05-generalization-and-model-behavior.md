# Chapter 5 — Generalization and Model Behavior

## 1. The actual goal is future performance

Training is successful only when the fitted behavior transfers to relevant unseen
examples. This transfer is **generalization**.

Training risk:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mover><mi>R</mi><mo accent="true">̂</mo></mover><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><mfrac><mn>1</mn><msub><mi>n</mi><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub></mfrac><munder><mo>∑</mo><mrow><mi>i</mi><mo>∈</mo><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></munder><mi>ℓ</mi><mo stretchy="false" form="prefix">(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>,</mo><msub><mi>f</mi><mi>θ</mi></msub><mo stretchy="false" form="prefix">(</mo><msub><mi>x</mi><mi>i</mi></msub><mo stretchy="false" form="postfix">)</mo><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

Population risk:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>R</mi><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><msub><mi mathvariant="double-struck">𝔼</mi><mrow><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>,</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo><mo>∼</mo><msub><mi>P</mi><mrow><mi>t</mi><mi>a</mi><mi>r</mi><mi>g</mi><mi>e</mi><mi>t</mi></mrow></msub></mrow></msub><mo stretchy="false" form="prefix">[</mo><mi>ℓ</mi><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>,</mo><msub><mi>f</mi><mi>θ</mi></msub><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo stretchy="false" form="postfix">)</mo><mo stretchy="false" form="postfix">]</mo><mi>.</mi></mrow></semantics></math>

Generalization gap, estimated using a held-out set:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mtext mathvariant="normal">gap</mtext><mo>=</mo><msub><mover><mi>R</mi><mo accent="true">̂</mo></mover><mrow><mi>v</mi><mi>a</mi><mi>l</mi><mi>i</mi><mi>d</mi><mi>a</mi><mi>t</mi><mi>i</mi><mi>o</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>−</mo><msub><mover><mi>R</mi><mo accent="true">̂</mo></mover><mrow><mi>t</mi><mi>r</mi><mi>a</mi><mi>i</mi><mi>n</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

For losses where lower is better, a large positive gap suggests that performance
on fitted examples transfers poorly. But a small gap does **not** guarantee a good
model: both losses can be high (underfitting), both sets can contain the same
leakage, or both can differ from production.

## 2. Underfitting and overfitting

### Underfitting

The model or training process fails to capture useful structure.

Signals:

- training and validation performance both poor;
- adding capacity/features or training longer helps both;
- errors show systematic patterns;
- optimization has not converged or representation is inadequate.

Possible causes:

- overly simple hypothesis/model family;
- features omit relevant information;
- too much regularization;
- insufficient training or poor optimization;
- target is weakly learnable from available inputs;
- label noise or incorrect formulation.

### Overfitting

The learned function fits sample-specific noise or shortcuts that do not transfer.

Signals:

- training performance continues improving while validation worsens;
- large train–validation gap;
- instability across folds, time periods, seeds, or slices;
- reliance on IDs, artifacts, or fragile correlations.

Possible causes:

- high capacity relative to effective data;
- repeated selection against a small validation set;
- leakage or duplicates;
- noisy labels;
- distribution mismatch;
- weak constraints/regularization.

```
error
 ^       validation error
 |      \              /
 |       \____  ______/
 |            \/
 |      training error  \________
 +---------------------------------> effective model capacity/training
       underfit       useful       overfit
```

This U-shape is a classical mental model, not a universal law. Modern highly
overparameterized models can show **double descent** or continue improving with
scale when data, optimization, architecture, and regularization interact well.
Use measured learning behavior rather than a slogan.

## 3. Bias–variance decomposition

For regression with squared loss, assume:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>Y</mi><mo>=</mo><msup><mi>f</mi><mo>*</mo></msup><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>+</mo><mi>ε</mi><mo>,</mo><mspace width="2.0em"></mspace><mi mathvariant="double-struck">𝔼</mi><mo stretchy="false" form="prefix">[</mo><mi>ε</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">]</mo><mo>=</mo><mn>0</mn><mo>,</mo><mspace width="2.0em"></mspace><mrow><mi mathvariant="normal">Var</mi><mo>&#8289;</mo></mrow><mo stretchy="false" form="prefix">(</mo><mi>ε</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><msup><mi>σ</mi><mn>2</mn></msup><mi>.</mi></mrow></semantics></math>

Imagine repeatedly sampling a training dataset <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>D</mi></semantics></math> and fitting
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mover><mi>f</mi><mo accent="true">̂</mo></mover><mi>D</mi></msub><mo stretchy="false" form="prefix">(</mo><mi>x</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>. At a fixed input <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>x</mi></semantics></math>, expected prediction error decomposes as:

> **Bias–variance decomposition for squared error**  
> E<sub>D,ε</sub>[(Y − f̂<sub>D</sub>(x))²]
> = (f*(x) − E<sub>D</sub>[f̂<sub>D</sub>(x)])²
> + E<sub>D</sub>[(f̂<sub>D</sub>(x) − E<sub>D</sub>[f̂<sub>D</sub>(x)])²]
> + σ²  
> = bias² + variance + irreducible noise

### Intuition

- **High bias:** different training samples lead to similarly wrong/simple
  predictions. The model systematically misses structure.
- **High variance:** small changes in training data lead to substantially
  different fitted functions.
- **Irreducible noise:** outcome variation not predictable from available inputs.

“Bias” here is statistical approximation bias, not social unfairness, dataset
selection bias, or estimator bias—though those are also important meanings.

The decomposition is exact under stated squared-error assumptions. Classification
and modern deep networks have more complicated behavior, but the conceptual
trade-off remains useful.

## 4. Model capacity and effective complexity

Capacity is a model family's ability to represent varied functions. It depends on
more than parameter count:

- model architecture and depth;
- regularization;
- optimization and number of training steps;
- feature representation;
- data augmentation;
- early stopping;
- parameter sharing and prior/pretraining;
- hyperparameter search process.

A million-parameter model with strong structure and abundant pretraining can
generalize better than a smaller poorly matched model. “More parameters means
overfitting” is too simplistic.

### Approximation, estimation, and optimization error

A useful conceptual decomposition is:

1.  **Approximation error:** best model in the chosen family cannot express the
    desired relationship.
2.  **Estimation error:** finite data leads us to a different model than infinite
    representative data would.
3.  **Optimization error:** training fails to find the best available parameters
    for the empirical objective.
4.  **Distribution/formulation error:** objective/data do not represent the actual
    deployment goal.

Adding capacity may reduce approximation error but increase estimation or
operational difficulty. Training longer may reduce optimization error but worsen
overfitting. More historical data may not reduce distribution error.

## 5. Regularization

Regularization constrains learning to prefer solutions expected to generalize or
satisfy desired structure.

### 5.1 Explicit parameter penalties

L2 regularization:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>J</mi><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><mover><mi>R</mi><mo accent="true">̂</mo></mover><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>+</mo><mi>λ</mi><munder><mo>∑</mo><mi>j</mi></munder><msubsup><mi>θ</mi><mi>j</mi><mn>2</mn></msubsup><mi>.</mi></mrow></semantics></math>

It discourages large weights and usually shrinks them smoothly.

L1 regularization:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>J</mi><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><mover><mi>R</mi><mo accent="true">̂</mo></mover><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>+</mo><mi>λ</mi><munder><mo>∑</mo><mi>j</mi></munder><mo stretchy="false" form="prefix">|</mo><msub><mi>θ</mi><mi>j</mi></msub><mo stretchy="false" form="prefix">|</mo><mi>.</mi></mrow></semantics></math>

It can produce exact zero weights under common settings, supporting sparse models.
Correlated features can make selected features unstable.

Larger <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>λ</mi></semantics></math> means stronger penalty:

- too small: possible high variance/overfitting;
- too large: possible high bias/underfitting.

Feature scaling matters because penalties act on coefficient magnitudes.

### 5.2 Structural constraints

- maximum tree depth and minimum leaf size;
- pruning;
- low-rank factorization;
- weight sharing (as in convolution);
- monotonic constraints;
- sparsity or smoothness assumptions.

These encode what kinds of solutions are plausible.

### 5.3 Early stopping

Monitor validation performance and stop before additional training primarily fits
noise. The stopping point is a hyperparameter, so retain an independent final
evaluation. Restore the best checkpoint rather than simply the last one.

### 5.4 Data augmentation

Create label-preserving transformations: small image changes, carefully designed
text perturbations, audio shifts, or domain transformations. Augmentation encodes
invariances. Invalid transformations create mislabeled data—for example,
horizontally flipping text or changing a medically meaningful orientation.

### 5.5 Dropout and stochastic training

Dropout randomly masks activations during neural-network training, discouraging
fragile co-adaptation. Mini-batch noise and other stochastic methods can also have
implicit regularization effects.

### 5.6 Ensembling

Averaging diverse model predictions often reduces variance:

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mover><mi>f</mi><mo accent="true">̂</mo></mover><mrow><mi>e</mi><mi>n</mi><mi>s</mi></mrow></msub><mo stretchy="false" form="prefix">(</mo><mi>x</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><mfrac><mn>1</mn><mi>M</mi></mfrac><munderover><mo>∑</mo><mrow><mi>m</mi><mo>=</mo><mn>1</mn></mrow><mi>M</mi></munderover><msub><mover><mi>f</mi><mo accent="true">̂</mo></mover><mi>m</mi></msub><mo stretchy="false" form="prefix">(</mo><mi>x</mi><mo stretchy="false" form="postfix">)</mo><mi>.</mi></mrow></semantics></math>

If model errors are highly correlated, the benefit is limited. Ensembles increase
serving cost, latency, memory, and operational complexity.

### 5.7 More and better data

Representative examples, improved labels, wider coverage, and targeted data for
known failure modes often regularize behavior more effectively than merely tuning
a penalty. Duplicate or irrelevant examples do not provide the same benefit.

## 6. Learning curves

### 6.1 Performance versus training-set size

Train models on increasing fractions of data and plot train/validation error.

Interpretation:

| Pattern | Likely diagnosis | Candidate actions |
|----|----|----|
| Both errors high and close | high bias/underfit | better features, capacity, optimization, weaker regularization |
| Train low, validation much higher | high variance/overfit | more representative data, regularization, simplify, remove leakage |
| Validation still improves with more data | data may help | collect/label targeted additional data |
| Both plateau at unacceptable level | formulation/features/noise limit | revisit target, inputs, label quality, model family |
| Random split strong, temporal split weak | shift/leakage/staleness | point-in-time audit, recent data, robust features, retraining |

### 6.2 Performance versus training time/epochs

Plot training and validation metrics over iterations. If training improves while
validation deteriorates, early stopping or more regularization may help. If both
remain poor, inspect optimization, learning rate, features, labels, and capacity.

### 6.3 Performance versus data freshness

Train on increasingly recent windows or evaluate by time. This reveals whether
older data adds coverage or harmful staleness. A sliding window can adapt faster;
an expanding window provides more data. The best choice is empirical.

## 7. Error analysis: the highest-leverage loop

After a trustworthy baseline:

1.  save out-of-sample predictions, scores, labels, metadata, and model version;
2.  rank or sample false positives, false negatives, and high-loss examples;
3.  inspect representative cases without cherry-picking;
4.  create an error taxonomy;
5.  quantify each category and important slices;
6.  propose the smallest change targeting the largest valuable category;
7.  run a controlled experiment/ablation;
8.  record whether the hypothesis was correct.

Possible error categories for a support classifier:

- ambiguous/multilabel request;
- missing context;
- new product terminology;
- label error;
- language/domain gap;
- preprocessing bug;
- genuinely uncertain boundary;
- malicious/adversarial input.

Do not treat every model–label disagreement as model error. The label can be wrong,
the task can be ambiguous, or the example can violate the intended use.

### Error concentration

If 60% of harmful errors come from one 5% slice, fixing that slice may create more
value than a small global metric improvement. Weight categories by business/safety
impact, not only frequency.

## 8. Ablation studies

An ablation removes or changes one component to estimate its contribution:

- remove a feature family;
- replace a complex model with a simple model;
- disable augmentation;
- vary training-data window;
- remove retrieval reranking;
- replace fresh features with cached ones.

A useful ablation keeps other factors fixed and reports uncertainty/cost. It helps
answer **why** a system improved and whether complexity earns its maintenance cost.

Beware interaction effects: two components may only help together. Factorial or
carefully sequenced experiments may be needed.

## 9. Shortcut learning and spurious correlation

A model uses whatever predictive signal the objective permits, not necessarily
the intended concept.

Examples:

- disease classifier learns hospital-specific image markers;
- animal classifier learns background snow;
- résumé model learns historical hiring proxies;
- LLM evaluation rewards verbose answers because judges prefer length;
- fraud model learns review-policy artifacts.

Detect shortcuts using:

- domain/source holdouts;
- counterfactual or controlled examples;
- feature ablation and attribution followed by causal investigation;
- performance on changed backgrounds/templates;
- group and temporal evaluation;
- expert error review.

Interpretability tools can reveal clues but do not prove the model's causal logic
or safety.

## 10. Robustness, invariance, and uncertainty

A robust system should tolerate expected variation:

- formatting changes, typos, image conditions;
- reasonable missing inputs;
- schema-compatible upstream changes;
- rare but valid values;
- modest temporal/domain shift;
- retries, duplicates, and out-of-order events.

Define invariances deliberately. A spam prediction ideally should not change
because of harmless whitespace; a medical result may legitimately change with a
small measurement difference near a clinical boundary.

### Types of uncertainty

- **Aleatoric uncertainty:** inherent ambiguity/noise in outcomes.
- **Epistemic uncertainty:** uncertainty from limited knowledge/data; may reduce
  with relevant data.
- **Distributional uncertainty:** input differs from training experience.

A single probability does not automatically distinguish these. Ensembles,
Bayesian approximations, conformal methods, and out-of-distribution signals can
help, but none universally guarantees safe uncertainty estimates.

The operational response can be more important than the estimation method:
abstain, request information, fall back, or send high-impact cases to review.

## 11. No free lunch and inductive bias

No learning algorithm is best for every possible data-generating process. Models
succeed by making **inductive biases**—assumptions that prefer some generalizations:

- linear models prefer linear relationships in the representation;
- k-NN assumes nearby examples have similar targets;
- trees prefer piecewise constant rules;
- CNNs encode locality and shared patterns;
- sequence models encode ordering;
- regularization prefers smaller/smoother/sparser solutions.

The practical question is not “Which model is best?” but “Which assumptions,
data, constraints, and failure modes match this problem?”

## 12. A diagnostic decision table

| Observation | Plausible causes | Next checks |
|----|----|----|
| Very high train and test score immediately | easy task or leakage | timestamp, duplicates, label-derived features, naïve baseline |
| Low train and validation quality | bias, bad representation, noise, optimization | overfit a tiny clean subset; label audit; learning curves |
| High train, low validation | variance, mismatch, contamination | group/time split, regularization, more data, ID features |
| Validation good, production poor | shift, skew, metric mismatch, service bug | online/offline feature parity, slices, logs, policy changes |
| Great AUC, poor chosen action | threshold/calibration/cost mismatch | operating-point metrics, reliability curve, policy capacity |
| Overall stable, one group degrades | slice shift/coverage/label issue | sample size, feature health, data source, error review |
| Performance decays after launch | drift or feedback loop | time plots, action/label selection, recent retraining study |
| Results vary greatly by seed/fold | small data, unstable model, split dependence | repeated/grouped CV, simplify, regularize, confidence interval |

Do not change five things at once. Convert the diagnosis into a falsifiable
hypothesis and run the smallest informative experiment.

## 13. Deep-learning nuance for interviews

Classical “more capacity → more overfitting” intuition is incomplete in modern
deep learning. Large models may generalize because of architecture, optimization
bias, augmentation, pretraining, scale, and regularization. Nevertheless:

- train/validation discipline still applies;
- benchmark and validation overfitting still occurs;
- leakage and distribution shift remain decisive;
- memorization and harmful shortcuts remain possible;
- compute scale does not repair an invalid target or dataset.

A good interview response explains the classical model, acknowledges modern
exceptions, and returns to empirical diagnostics.

## 14. Check your understanding

1.  Can a model underfit and overfit in different slices at the same time?
2.  Why does a small train–validation gap not prove good generalization?
3.  Explain each term in the squared-error bias–variance decomposition.
4.  Give explicit and implicit regularization examples.
5.  When will collecting more data probably not solve poor performance?
6.  Design an ablation to test whether user-ID features drive a recommender gain.
7.  What evidence suggests shortcut learning rather than intended learning?
8.  Why should an ensemble's accuracy benefit be weighed against operational cost?
