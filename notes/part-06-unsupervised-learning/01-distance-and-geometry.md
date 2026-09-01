# Chapter 1 — Distance, Similarity, and High-Dimensional Geometry

## 1. Representation defines geometry

Before selecting an unsupervised algorithm, define:

- one point/entity;
- feature semantics/units;
- scaling and missingness;
- similarity invariances;
- sparse/dense behavior;
- time/context;
- population/selection.

Two customers can be “similar” by spending, product mix, lifecycle, geography, or
behavior sequence—different representations answer different questions.

## 2. Metric properties

A distance d is a metric if:

1. d(x, y) ≥ 0;
2. d(x, y) = 0 iff x = y;
3. d(x, y) = d(y, x);
4. d(x, z) ≤ d(x, y) + d(y, z) (triangle inequality).

Some useful dissimilarities violate one or more; algorithms/indexes relying on a
metric may break or lose guarantees.

## 3. Minkowski distances

> d<sub>p</sub>(x, y) = [Σ |x<sub>j</sub> − y<sub>j</sub>|ᵖ]¹ᐟᵖ

- p = 1 Manhattan;
- p = 2 Euclidean;
- p → ∞ Chebyshev, maximum coordinate difference.

Scaling is decisive. One feature measured in dollars can dominate one in [0,1].
Standardize, robust-scale, or choose domain weights.

## 4. Cosine similarity

> cos(x, y) = xᵀy/(‖x‖₂‖y‖₂)

For unit vectors:

> ‖x − y‖₂² = 2 − 2cos(x, y)

Useful when direction/composition matters more than magnitude: TF–IDF/embeddings.
Undefined for zero vector; embeddings can have anisotropy/hubs, and cosine does
not guarantee semantic equivalence.

## 5. Other similarities

### Jaccard

For sets A, B:

> J(A, B) = |A ∩ B|/|A ∪ B|

Good for binary presence. Empty–empty convention must be defined.

### Hamming

Number/proportion of positions that differ; categorical/binary sequences of equal
length.

### Mahalanobis

> d(x, μ) = √[(x − μ)ᵀΣ⁻¹(x − μ)]

Accounts for scale/correlation. Covariance must be estimated/inverted; high-d/small
n is unstable, requiring shrinkage/robust covariance.

### Edit distance

Minimum insert/delete/substitute operations between sequences. Dynamic programming
O(mn); weights can be domain-specific.

### Learned metrics

Siamese/triplet/contrastive learning learns representation so desired pairs are
close. Quality depends on pair sampling/labels and can encode bias.

## 6. Mixed data

Euclidean on arbitrary one-hot + standardized numerics weights dimensions
implicitly. Options:

- Gower-like dissimilarity combining scaled per-feature distances;
- k-prototypes for numeric + categorical;
- model-based mixtures;
- domain-weighted components;
- learned embeddings.

Missing dimensions need pairwise policy; varying compared dimensions can make
distances incomparable.

## 7. Curse of dimensionality

As d grows:

- space volume expands;
- fixed-radius neighborhoods become empty;
- required sample grows exponentially for coverage;
- nearest/farthest distances can concentrate;
- noise dimensions accumulate;
- density estimation becomes hard.

For independent noise coordinates, squared Euclidean distances sum many terms and
relative variation can shrink. “Nearest” may be only marginally closer.

Mitigate with feature selection, domain representation, PCA/embeddings, cosine for
sparse direction, regularization, and more relevant data—not only faster search.

## 8. Standardization and whitening

Standardization makes each training feature mean 0/SD 1 but ignores correlations.

Whitening transforms covariance approximately I. PCA whitening:

> z = Λ⁻¹ᐟ²Uᵀ(x − μ)

Small eigenvalues amplify noise; add ε/drop components. Whitening may erase
meaningful variance scale and is sensitive to shift.

## 9. Distance computation at scale

Exact all-pairs distance for n points costs O(n²d) time and O(n²) storage if
materialized. Avoid full matrix when unnecessary.

Strategies:

- block computation and top-k heaps;
- sparse kernels;
- trees for low dimensions;
- locality-sensitive hashing;
- inverted files/product quantization;
- navigable graphs (HNSW concepts);
- GPU/batched matrix operations;
- candidate filtering.

Approximate nearest-neighbor evaluation:

- recall@k against exact subset;
- latency/throughput/tail;
- memory/build/update;
- filter support;
- drift/deletions;
- index reproducibility.

## 10. Similarity pitfalls

- leakage in pretrained embedding/evaluation overlap;
- duplicated entities dominate neighborhoods;
- popularity/frequency controls embedding norm;
- missing/zero vectors;
- feature scales and correlated copies;
- temporal staleness;
- protected/proxy geometry;
- distance metric not aligned with downstream action.

## 11. Exercises

1. Compute L1/L2/cosine/Jaccard for sample points and explain differences.
2. Show how one unscaled feature changes nearest neighbor.
3. Simulate distance concentration as dimensions grow.
4. Design an ANN benchmark including recall and operations.
5. Define similarity for customers with numeric, categorical, and sequence data.

