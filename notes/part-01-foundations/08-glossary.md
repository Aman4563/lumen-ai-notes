# Appendix — AI/ML Foundations Glossary

Definitions here are compact retrieval cues. Return to the relevant chapter for
assumptions, formulas, examples, and limitations.

## A–C

**Ablation:** an experiment that removes or changes a component to estimate its
contribution.

**Accuracy:** fraction of all classifications that are correct,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mo stretchy="false" form="prefix">(</mo><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi><mo stretchy="false" form="postfix">)</mo><mi>/</mi><mo stretchy="false" form="prefix">(</mo><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi><mo>+</mo><mi>F</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>N</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Active learning:** a process in which the learner selects examples for labeling
to use annotation effort efficiently.

**Agent:** a system that observes state/context and takes actions; in modern AI,
often a model-centered workflow that selects tools and maintains state under
deterministic permissions and orchestration.

**Aleatoric uncertainty:** uncertainty due to inherent randomness or ambiguity in
the outcome, not merely insufficient training data.

**Annotation:** the act and process of assigning labels or structured judgments
to examples.

**Artifact:** a versioned output of a pipeline, such as a dataset snapshot,
preprocessing object, model weights, calibration mapping, or evaluation report.

**AUC:** area under a curve; context must specify ROC-AUC, PR-AUC convention, or
another curve.

**Baseline:** the reference a new approach must beat, such as the current system,
a heuristic, or a simple learned model.

**Batch inference:** computing predictions for many examples periodically rather
than synchronously per request.

**Bias (statistical learning):** systematic difference between the average fitted
prediction and the true relationship; distinct from social/dataset/estimator bias.

**Brier score:** mean squared error of predicted probabilities for binary outcomes,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>n</mi><mrow><mi>−</mi><mn>1</mn></mrow></msup><msub><mo>∑</mo><mi>i</mi></msub><mo stretchy="false" form="prefix">(</mo><msub><mi>p</mi><mi>i</mi></msub><mo>−</mo><msub><mi>y</mi><mi>i</mi></msub><msup><mo stretchy="false" form="postfix">)</mo><mn>2</mn></msup></mrow></semantics></math>.

**Calibration:** agreement between predicted probabilities and observed outcome
frequencies.

**Canary:** a risk-controlled deployment to a small traffic portion before wider
ramp-up.

**Categorical feature:** a feature whose values represent categories rather than
ordinary numeric magnitude.

**Champion/challenger:** comparison between the deployed reference system and one
or more candidates.

**Class imbalance:** a large difference in class frequencies, often making
accuracy and naïve training/evaluation misleading.

**Classification:** prediction of a discrete class, label set, or associated score.

**Concept drift:** change in the conditional relationship <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Confusion matrix:** counts of actual versus predicted classes; in binary
classification these are TP, FP, FN, and TN.

**Constraint:** a condition the solution must satisfy, such as p99 latency, cost,
safety rate, or memory.

**Covariate shift:** change in input distribution <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> while the relationship
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo>∣</mo><mi>X</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> is assumed stable.

**Cross-validation:** repeated fitting/evaluation across folds to use limited
development data efficiently and measure variation.

## D–H

**Data-generating process:** the real process, policies, logging, selection,
joining, and labeling that produced observed data.

**Data leakage:** illegitimate or unavailable information contaminating training
or evaluation and causing optimistic results.

**Decision policy:** logic that converts predictions/scores plus context and
constraints into actions.

**Deep learning:** machine learning with multilayer neural networks that learn
composed representations.

**Distribution:** a mathematical description of possible values/events and their
probabilities.

**Distribution shift:** a difference between training and deployment distributions.

**Embedding:** a learned or designed numeric vector representation intended to
capture useful relationships.

**Empirical risk:** average training-sample loss,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mover><mi>R</mi><mo accent="true">̂</mo></mover><mi>n</mi></msub><mo stretchy="false" form="prefix">(</mo><mi>θ</mi><mo stretchy="false" form="postfix">)</mo><mo>=</mo><msup><mi>n</mi><mrow><mi>−</mi><mn>1</mn></mrow></msup><msub><mo>∑</mo><mi>i</mi></msub><mi>ℓ</mi><mo stretchy="false" form="prefix">(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>,</mo><msub><mi>f</mi><mi>θ</mi></msub><mo stretchy="false" form="prefix">(</mo><msub><mi>x</mi><mi>i</mi></msub><mo stretchy="false" form="postfix">)</mo><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Ensemble:** a combination of multiple model predictions, often used to improve
quality or reduce variance.

**Epistemic uncertainty:** uncertainty arising from limited knowledge/data that
may reduce with relevant evidence.

**Epoch:** one pass through a training dataset, under the training loader's
definition.

**Error analysis:** structured inspection and quantification of failures to find
high-value improvement hypotheses.

**Evaluation slice:** a defined subset used to expose performance that an aggregate
metric can hide.

**Example/instance:** one unit for which a model learns or makes a prediction.

**False negative (FN):** an actual positive predicted negative.

**False positive (FP):** an actual negative predicted positive.

**Feature:** an input value or representation legitimately available to the model
at prediction time.

**Feature store:** infrastructure and definitions for producing, storing, and
serving reusable features with freshness and point-in-time semantics.

**Feedback loop:** a cycle in which model-driven actions change future data,
labels, user behavior, or environment.

**F1 score:** harmonic mean of precision and recall,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mn>2</mn><mi>T</mi><mi>P</mi><mi>/</mi><mo stretchy="false" form="prefix">(</mo><mn>2</mn><mi>T</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>N</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Generative AI:** systems that produce content such as text, images, code, audio,
or structured data from learned distributions/representations.

**Generalization:** transfer of learned behavior to relevant unseen examples.

**Generalization gap:** difference between held-out and training performance under
a specified metric/loss.

**Guardrail:** a metric or rule bounding unacceptable regression while optimizing
a primary goal.

**Hyperparameter:** a value configuring the model/training/selection process rather
than an ordinary parameter learned directly in a fit.

## I–P

**i.i.d.:** independent and identically distributed; a common approximation that
examples are mutually independent and drawn from the same distribution.

**Inductive bias:** assumptions that make a learner prefer some generalizations
over others.

**Inference:** using a fitted model to make predictions; in statistics the term
can also mean reasoning about an unknown population.

**Label:** an observed training/evaluation encoding of the desired target.

**Label shift:** change in <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> while <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi><mo stretchy="false" form="prefix">(</mo><mi>X</mi><mo>∣</mo><mi>Y</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math> is assumed stable.

**Latency:** time required for an operation/request; tail percentiles are often
more operationally useful than the mean.

**Learning paradigm:** the structure of training signal and interaction, such as
supervised, self-supervised, unsupervised, or reinforcement learning.

**Learning rate:** a hyperparameter controlling update step scale in iterative
optimization.

**Log loss/cross-entropy:** a proper probability scoring loss that penalizes
confident wrong classifications strongly.

**Loss:** the numerical training penalty for prediction behavior, usually per
example or batch.

**Machine learning:** methods that learn useful functions, structure, policies, or
distributions from data/experience rather than explicitly specifying every case.

**Metric:** a defined measurement used to compare or monitor behavior; it need not
be the training loss.

**Model:** a fitted or parameterized mapping/distribution/policy used to produce an
output from input/context.

**Model card:** documentation of a model's versions, use, data, evaluation,
limitations, risks, and operational requirements.

**Monitoring:** ongoing observation of service, data, prediction, model, product,
safety, and cost behavior after deployment.

**Objective:** the expression or criteria the learning/selection process attempts
to optimize, possibly with constraints.

**Online inference:** producing a prediction synchronously or near-real-time for a
live input.

**Online learning:** updating a model incrementally as examples/feedback arrive;
not the same as online inference.

**Overfitting:** fitting sample-specific noise or shortcuts that do not transfer
to the intended environment.

**Parameter:** a value estimated by model fitting, such as a weight or tree split.

**Population:** the complete set or data distribution about which performance or
inference is intended.

**Population risk:** expected loss over the target data-generating distribution.

**Precision:** fraction of predicted positives that are actually positive,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>T</mi><mi>P</mi><mi>/</mi><mo stretchy="false" form="prefix">(</mo><mi>T</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>P</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Prediction horizon:** the future interval or time point the output concerns.

**Prediction time:** the exact moment by which all features must be available and
the model output is needed.

**Prevalence:** fraction/probability of the positive class in a population/sample.

**Proxy:** a measurable quantity used in place of a true outcome that is delayed,
subjective, or unobservable.

## Q–Z

**Recall/sensitivity/TPR:** fraction of actual positives detected,
<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>T</mi><mi>P</mi><mi>/</mi><mo stretchy="false" form="prefix">(</mo><mi>T</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>N</mi><mo stretchy="false" form="postfix">)</mo></mrow></semantics></math>.

**Regression:** prediction of a continuous numeric target or distribution over it.

**Regularization:** constraints/preferences intended to improve generalization or
enforce desired solution structure.

**Reinforcement learning:** learning a policy through interaction and rewards to
optimize expected cumulative return.

**Reproducibility:** ability to regenerate an artifact/result from versioned data,
code, configuration, environment, and randomness controls.

**Residual:** observed target minus prediction, <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>e</mi><mo>=</mo><mi>y</mi><mo>−</mo><mover><mi>y</mi><mo accent="true">̂</mo></mover></mrow></semantics></math> (some tools may use
the opposite sign; state the convention).

**Risk score:** a continuous score, often a probability, estimating undesirable or
desired outcome likelihood.

**Sample:** a finite collection drawn/selected from a population or process.

**Self-supervised learning:** learning from targets constructed from the raw data,
such as masked/next-token or paired-view objectives.

**Shadow deployment:** live inference whose outputs are logged/evaluated but do not
drive the user-facing action.

**Stratification:** splitting/sampling to preserve or control representation of
defined strata, commonly class labels.

**Supervised learning:** learning from input–target pairs.

**Target:** the conceptual outcome the task aims to estimate, which may differ
from the operational label.

**Test set:** held-out data reserved for final/controlled evaluation after model
selection decisions are fixed.

**Threshold:** cutoff converting a continuous score into a discrete decision or
action region.

**Training:** estimating model parameters from data using an objective/algorithm.

**Training–serving skew:** difference between feature computation/input behavior
in offline training and live serving.

**Underfitting:** failure to capture useful structure, causing poor training and
held-out performance.

**Unsupervised learning:** learning structure/representations without ordinary
human-provided target labels.

**Validation/development set:** held-out data used repeatedly for model,
hyperparameter, feature, threshold, or other development choices.

**Variance (statistical learning):** sensitivity of the fitted model to the
particular training sample.
