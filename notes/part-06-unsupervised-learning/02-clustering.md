# Chapter 2 — Clustering and Mixture Models

## 1. What clustering objective asks

Clustering groups points according to chosen representation/objective. Clarify use:

- exploratory summarization;
- compression/prototypes;
- operational segments;
- anomaly pre-grouping;
- downstream features;
- scientific hypothesis.

If the product needs a predefined category, supervised classification/annotation
may be the real task.

## 2. k-means

Given K centroids μ₁, …, μ<sub>K</sub>, minimize within-cluster squared distance:

> J = Σ<sub>i=1</sub><sup>n</sup> ‖x<sub>i</sub> − μ<sub>c(i)</sub>‖₂²

Lloyd algorithm:

1. initialize centroids;
2. assign each point to nearest centroid;
3. update centroid to cluster mean;
4. repeat until assignments/objective/tolerance stops.

Each step does not increase objective; converges to local optimum, not guaranteed
global.

### Initialization

Random can choose poor/duplicate regions. k-means++ samples spread-out initial
centers and improves expected behavior. Use multiple restarts and retain best
objective/stability.

### Assumptions/behavior

k-means prefers roughly spherical, similar-variance/size clusters under Euclidean
geometry. Sensitive to scale/outliers; requires K; hard assignment; empty clusters
need policy. Centroid may not be an actual point.

### Complexity

Roughly O(nKdI) for n points, d dims, K clusters, I iterations. Mini-batch k-means
uses sampled updates for scale with approximation/order sensitivity.

## 3. k-medoids

Center is an actual data point (medoid), enabling arbitrary dissimilarity and more
outlier robustness. More computationally expensive than k-means. PAM and sampling
approximations used.

## 4. Hierarchical clustering

### Agglomerative

Start each point alone; repeatedly merge closest clusters. Produces dendrogram.

Linkage:

- single: minimum pair distance; finds chains/nonconvex, sensitive to bridges;
- complete: maximum; compact clusters, outlier-sensitive;
- average: average pair distance;
- Ward: merge with minimum increase in within-cluster variance, Euclidean-like.

### Divisive

Start all points, recursively split; less common due cost/design choices.

Dendrogram height represents merge dissimilarity/objective; cutting at height/K
creates partition. Visualization can imply stability that should be tested.

Complexity/memory often O(n²), unsuitable for huge n without approximations.

## 5. DBSCAN

Parameters:

- ε neighborhood radius;
- min_samples density threshold.

Point types:

- core: enough neighbors within ε;
- border: reachable from core but insufficient own density;
- noise: neither.

Strengths:

- arbitrary shapes;
- no K;
- explicit noise;
- deterministic mostly aside from border assignment/order nuances.

Weaknesses:

- one ε struggles varying density;
- scaling/high dimensions;
- parameter sensitivity;
- all-noise/one-cluster outcomes;
- neighbor search cost.

k-distance plot can guide ε but is subjective.

## 6. HDBSCAN concept

Builds density hierarchy over varying ε using mutual reachability and extracts
stable clusters. Handles varying density better and provides noise/membership
strength. Still depends on metric/min cluster size/sample, and “stability” is
algorithmic, not semantic truth.

## 7. Gaussian mixture models (GMM)

Assume data generated from K Gaussian components:

> p(x) = Σ<sub>k=1</sub><sup>K</sup> π<sub>k</sub> Normal(x ∣ μ<sub>k</sub>, Σ<sub>k</sub>)

- π<sub>k</sub> ≥ 0 and sum 1;
- soft responsibility for component k:

> r<sub>ik</sub> = P(z<sub>i</sub> = k ∣ x<sub>i</sub>)

Covariance choices: spherical, diagonal, tied, full. Full captures ellipses but
needs many parameters and regularization.

## 8. EM algorithm

For latent variables z:

### E-step

Compute expected latent assignments under current parameters:

> r<sub>ik</sub> ∝ π<sub>k</sub> Normal(x<sub>i</sub> ∣ μ<sub>k</sub>, Σ<sub>k</sub>)

Normalize across k using log-sum-exp for stability.

### M-step

Update weighted parameters:

> N<sub>k</sub> = Σ<sub>i</sub>r<sub>ik</sub>  
> π<sub>k</sub> = N<sub>k</sub>/n  
> μ<sub>k</sub> = (1/N<sub>k</sub>)Σ r<sub>ik</sub>x<sub>i</sub>

Covariance is weighted outer-product residual average plus regularization.

EM monotonically improves/nondecreases likelihood under exact steps and converges
to local stationary point. Mixture likelihood can become singular when covariance
collapses around a point; regularize/min support/restarts.

## 9. k-means as limiting mixture intuition

Equal spherical covariance GMM with variance approaching zero yields hard nearest-
mean assignments resembling k-means. GMM adds probabilities/elliptical covariance
but relies on stronger distributional model.

## 10. Spectral clustering

1. build similarity graph W;
2. compute graph Laplacian (unnormalized L = D − W or normalized variant);
3. use first eigenvectors as embedding;
4. cluster embedded points.

Captures nonconvex graph structure. Sensitive to affinity scale/graph construction,
expensive eigenproblem, and out-of-sample assignment needs design.

## 11. Choosing K / cluster count

- elbow of within-cluster SSE: subjective;
- silhouette;
- gap statistic;
- BIC/AIC for mixture models;
- dendrogram/stability;
- downstream/business usefulness;
- operational actionability/capacity.

Silhouette for point i:

> s(i) = [b(i) − a(i)] / max(a(i), b(i))

a = mean within-cluster distance; b = best other-cluster mean distance. Range
roughly [−1,1]. Favors certain geometry and is costly; high does not ensure domain
meaning.

## 12. Stability analysis

Recluster bootstraps/subsamples/time windows/seeds and compare:

- adjusted Rand index (ARI);
- normalized mutual information;
- centroid matching;
- membership co-assignment;
- cluster size/profile changes.

Labels are permutation-invariant; cluster 1 today may be cluster 3 tomorrow.
Match clusters by centroids/profiles or preserve versioned assignment model.

Stable nonsense is possible; pair stability with external/domain validation.

## 13. External evaluation with labels

If reference labels exist, ARI, NMI, purity. But clustering objective may not align
with those labels. Do not tune exhaustively to “external labels” then call process
unsupervised; labels became supervision/validation.

## 14. Cluster profiling and deployment

After fitting:

- size and support;
- feature distributions versus population;
- examples/medoids;
- temporal/domain stability;
- downstream outcomes not used in construction;
- uncertainty/border points;
- actionable differences;
- privacy/fairness/proxy risk.

For serving, save scaler/representation/cluster model. Define assignment for new
points, unknown/outlier, model version, and retraining label matching. Hierarchical/
DBSCAN may not have a natural prediction method; approximate or choose algorithm
accordingly.

## 15. Exercises

1. Run k-means on moons data and explain failure.
2. Compare linkage methods with outlier/bridge.
3. Tune DBSCAN after scaling and inspect all-noise behavior.
4. Derive EM mean update using responsibilities.
5. Evaluate cluster stability across time and explain whether it is actionable.

