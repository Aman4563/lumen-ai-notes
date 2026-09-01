# Chapter 4 — Anomaly Detection and Matrix Factorization

## 1. Define anomaly operationally

An anomaly can mean:

- point anomaly: one unusual observation;
- contextual: unusual given time/entity/context;
- collective: unusual sequence/group though points ordinary;
- novelty: new pattern absent in training;
- fault/fraud: domain outcome, not identical to statistical rarity.

Rare does not mean harmful; harmful can be common. Define action, review capacity,
label delay, and costs.

## 2. Statistical z-score approaches

Univariate standardized deviation:

> z = (x − μ)/σ

Flag |z| > threshold under rough Gaussian/stable assumptions. Mean/SD are outlier-
sensitive. Robust alternative:

> robust score ≈ 0.6745(x − median)/MAD

Multivariate Mahalanobis uses covariance but fails in high dimension/non-Gaussian/
contaminated covariance without regularization/robust estimation.

## 3. Density methods

Fit p(x); low density indicates unusual. GMM, kernel density estimation, normalizing
flows. Challenges:

- density estimation in high dimensions;
- high-likelihood can differ from typicality;
- contamination and multiple normal modes;
- threshold/calibration;
- density dominated by irrelevant low-level statistics.

Use contextual/conditional density p(x ∣ context) when seasonality/entities matter.

## 4. Local Outlier Factor (LOF)

Compares local density around point with neighbors’ local densities. Detects points
unusual relative to local cluster. Sensitive to k, distance, scaling; standard LOF
is primarily transductive, novelty variants differ.

## 5. Isolation Forest

Randomly select features/split values; anomalies tend to be isolated in fewer
splits. Score based on average path length across trees.

Strengths: scalable, nonlinear, no distance concentration exactly like kNN,
unsupervised. Weaknesses: contamination/threshold, categorical representation,
context/collective anomalies, axis-aligned biases, explanation.

## 6. One-class SVM

Learns boundary around normal data in kernel space. ν controls upper bound-like
outlier fraction/lower bound support-vector fraction under formulation. Sensitive
to scaling/kernel parameters; kernel matrix limits large n.

## 7. Reconstruction anomaly

PCA/autoencoder trained on mostly normal examples; high reconstruction error flags.

Failure modes:

- anomalies reconstruct well due model capacity;
- normal rare modes reconstruct poorly;
- error dominated by high-variance features;
- training contamination;
- shift/outage looks anomalous but has different action.

Evaluate per-feature/context residual and use bottleneck/regularization.

## 8. Supervised, semi-supervised, unsupervised choice

- Labeled positives/negatives representative: supervised cost-sensitive classifier.
- Only trusted normal data: novelty/one-class.
- Mostly unlabeled with contamination: unsupervised ranking + audit/active learning.
- Known rules + emerging patterns: hybrid rules/supervised/unsupervised/human.

“Anomaly detection” is not automatically correct just because positives are rare.

## 9. Anomaly evaluation

Use time-forward data and realistic prevalence. Metrics:

- precision/recall at review capacity;
- recall by anomaly type/severity;
- time to detect;
- false alerts per entity/time;
- alert clustering/deduplication;
- analyst workload and resolution;
- delayed confirmed outcome;
- calibration/risk if available.

Injecting synthetic anomalies tests mechanics but may not represent attacks/faults.
Backtest known incidents, shadow, random audits, and prospective evaluation.

## 10. Alert policy

Raw anomaly score → grouping/suppression → context/rules → threshold/capacity →
human/action. Deduplicate correlated alerts and provide evidence/reason/context.
Monitor feedback selection and attacker adaptation.

## 11. Matrix factorization

For partially observed user–item matrix R, learn user factors p<sub>u</sub> and item
factors q<sub>i</sub>:

> r̂<sub>ui</sub> = μ + b<sub>u</sub> + b<sub>i</sub> + p<sub>u</sub>ᵀq<sub>i</sub>

Optimize observed entries Ω:

> Σ<sub>(u,i)∈Ω</sub>(r<sub>ui</sub> − r̂<sub>ui</sub>)²
> + λ(‖p<sub>u</sub>‖² + ‖q<sub>i</sub>‖² + biases)

Methods: SGD or alternating least squares (fix items solve users, then vice versa).

## 12. Explicit versus implicit feedback

- Explicit: ratings; missing does not mean dislike.
- Implicit: clicks/views/purchases; positives with confidence/exposure, missing
  mostly unknown.

Implicit weighted objective may treat all pairs with preference 0/1 and confidence
c<sub>ui</sub>, but full matrix huge; ALS exploits structure or negative sampling
approximates. Exposure/position/popularity bias remains.

## 13. Factorization limitations

- cold start new users/items;
- sparse tail;
- popularity bias;
- time/context ignored unless added;
- latent dimensions not inherently interpretable;
- feedback loops;
- offline random holdout can leak future interactions;
- serving requires retrieval over item factors.

Hybrid models add content/context features. Two-tower neural retrieval generalizes
factorization with learned user/item encoders.

## 14. Nonnegative matrix factorization (NMF)

Approximate nonnegative X:

> X ≈ WH, with W ≥ 0 and H ≥ 0

Parts-based additive representation can be interpretable for counts/images/topics.
Objective often Frobenius or KL-like. Non-convex jointly, initialization-sensitive,
scale/permutation ambiguity.

## 15. Robust PCA concept

Decompose matrix:

> X = L + S

where L low-rank and S sparse anomalies, using nuclear norm + L1 convex surrogate
under assumptions. Useful for background/foreground and corrupted low-rank data;
fails if anomalies not sparse or low-rank assumption invalid.

## 16. Exercises

1. Compare z-score, isolation forest, and autoencoder on multimodal normals.
2. Design anomaly evaluation with only 100 analyst reviews/day.
3. Implement regularized matrix factorization with SGD.
4. Build temporal interaction split and demonstrate random-split optimism.
5. Explain factor non-identifiability and cold-start mitigation.

