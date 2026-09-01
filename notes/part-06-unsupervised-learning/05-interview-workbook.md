# Chapter 5 — Unsupervised Learning Interview Workbook

## 1. Rapid answers

### k-means assumptions?

Squared Euclidean compact roughly spherical/similar-scale clusters; mean is useful;
K known; features scaled/relevant; outliers limited. It finds local optimum.

### k-means versus GMM?

k-means hard assignments and spherical equal-variance-like geometry; GMM soft
probabilities with covariance shapes/mixture weights under Gaussian model. GMM is
more flexible and parameter/degeneracy-sensitive.

### DBSCAN versus k-means?

DBSCAN density-connected arbitrary shapes/noise/no K, but ε/min samples and varying
density/high dimension are hard. k-means scalable centroid assignments but forces
all points into K convex-like groups.

### PCA versus t-SNE?

PCA linear variance/reconstruction with transform/loadings/global geometry; t-SNE
nonlinear local visualization whose axes/intercluster distances/sizes are not
reliable and depends on perplexity/seed.

### How evaluate clusters without labels?

Internal compactness/separation only under metric, plus resample/time/seed stability,
domain profiles, actionability, downstream outcome/use, and prospective validation.
No single silhouette proves meaningful clusters.

### Anomaly versus fraud?

Anomaly means statistically unusual under representation; fraud is a semantic
adversarial outcome. Many anomalies legitimate and many fraud patterns common.

## 2. Scenario answers

### Clusters differ by country only

Could be genuine behavior or scale/proxy/data-source artifact. Check feature
standardization, country-specific logging/currency, within-country clustering,
domain action, fairness/privacy, time stability, and whether country should be
removed/conditioned—not automatically call segments.

### t-SNE shows five islands

Do not declare five classes. Vary perplexity/seed/sample/metric/pre-PCA, inspect
original neighbor graph, compare labels/features, run clustering separately, and
validate stability/domain meaning.

### Isolation forest flags a source outage

Good detection but action differs from fraud. Feature-quality monitor should route
pipeline incident/fallback, not send cases to fraud analyst or train them as fraud.

### Matrix factorization offline gain disappears online

Random interaction split leaked future/user history; logged exposure bias; metric
misaligned; cold start/serving retrieval; latency/staleness; novelty/diversity;
feedback. Use temporal split, candidate-aware evaluation, and A/B test.

## 3. Derivations

1. k-means centroid mean minimizes within-cluster SSE.
2. GMM E-step via Bayes and M-step weighted mean.
3. PCA eigenvector via constrained variance.
4. Relation between unit-vector cosine and squared Euclidean distance.
5. Regularized matrix factor gradient for p<sub>u</sub>, q<sub>i</sub>.

## 4. Part 6 capstone

Choose customer segmentation **or** anomaly detection.

### Segmentation requirements

- business question/non-goals;
- entity/time grain and leakage-safe representation;
- scaling/metric rationale;
- k-means + two alternative families;
- internal, stability, temporal, and domain evaluation;
- profiles with uncertainty/support;
- out-of-sample assignment/version migration;
- privacy/fairness/action experiment;
- explicit claims the clusters do not support.

### Anomaly requirements

- anomaly taxonomy/action/capacity;
- temporal data and realistic/synthetic limitation;
- simple statistical baseline + isolation/density/reconstruction candidate;
- recall/precision at capacity, false alerts/time, detection delay;
- alert grouping/explanation;
- delayed labels/random audits/feedback;
- drift/outage separation and fallback;
- incident simulation.

## 5. Exit checklist

- [ ] I choose distance from semantics and dimension.
- [ ] I derive and diagnose k-means/EM.
- [ ] I compare cluster families and stability.
- [ ] I interpret dimensionality visualizations cautiously.
- [ ] I design anomaly evaluation around action/capacity.
- [ ] I understand factorization, exposure, cold start, and temporal splits.
- [ ] I completed and defended the capstone.

