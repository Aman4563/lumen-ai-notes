# Chapter 3 — Dimensionality Reduction and Visualization

## 1. Why reduce dimensions?

- visualization/exploration;
- compression/storage;
- denoising;
- faster downstream models/indexes;
- mitigate collinearity/noise;
- latent representations;
- visualization for communication.

Reduction can discard predictive minority/tail signals and complicate explanation.
Evaluate downstream quality and fit only on training.

## 2. PCA recap and derivation

Center X. Find unit v maximizing projected variance:

> maximize vᵀXᵀXv subject to vᵀv = 1

Lagrange stationarity:

> XᵀXv = λv

Top eigenvectors/right singular vectors are components. Projection:

> Z = XV<sub>k</sub>

Reconstruction:

> X̂ = ZV<sub>k</sub>ᵀ

SVD X = UΣVᵀ gives Z = U<sub>k</sub>Σ<sub>k</sub>.

## 3. PCA choices and traps

- Centering is required for ordinary PCA interpretation.
- Standardize when feature units/scales should be equal; not always—physical
  variance can be meaningful.
- Explained variance is not target relevance.
- Outliers dominate covariance/components.
- Component sign arbitrary.
- Correlated feature loadings do not give causal factors.
- Fit scaler/PCA on training folds.
- Incremental/randomized PCA for scale.

Choose k by reconstruction/variance curve, downstream CV, latency/storage, and
stability—not a universal 95% rule.

## 4. Truncated SVD / latent semantic analysis

Applies SVD to sparse matrix without centering (centering would densify). Used on
term-document TF–IDF. Similar to PCA but mathematical centering/variance
interpretation differs. Components mix terms and require qualitative validation.

## 5. Random projection

Project to lower dimension using random matrix. Johnson–Lindenstrauss idea: for a
finite set, pairwise distances can be approximately preserved with dimension
scaling logarithmically in number of points and inverse error squared.

Advantages: fast, data-independent, streaming-friendly. Disadvantages: opaque,
approximate, random variance. Record seed/matrix and validate downstream.

## 6. Factor analysis and ICA

### Factor analysis

Models observed x as latent linear factors plus feature-specific noise:

> x = Λz + ε

Unlike PCA's variance-maximizing reconstruction, explicitly models noise covariance
under assumptions. Rotations affect interpretability.

### Independent component analysis (ICA)

Seeks statistically independent non-Gaussian sources from linear mixtures. Used in
signal separation. Scale/order/sign non-identifiable; needs stronger assumptions
than PCA.

## 7. Multidimensional scaling (MDS)

Embeds points so pairwise distances match target dissimilarities by minimizing
stress. Classical MDS connects to eigendecomposition; metric/nonmetric variants.
O(n²) distances limit scale. Useful when only pairwise dissimilarity known.

## 8. t-SNE

t-distributed stochastic neighbor embedding:

1. convert high-dimensional distances to local neighbor probabilities;
2. define low-dimensional Student-t similarities;
3. minimize KL divergence between neighbor distributions.

Strength: visually separates local neighborhoods/clusters. Critical limitations:

- axes/orientation meaningless;
- distances between far clusters and cluster sizes not reliable;
- apparent clusters can arise from perplexity/sample/preprocessing;
- stochastic and global layout unstable;
- cannot compare separate runs as shared coordinate system;
- standard form has no natural out-of-sample transform (implementations may add).

Perplexity controls effective neighborhood scale. Run multiple values/seeds and
compare with original-space neighbors/domain labels.

## 9. UMAP concepts

Builds local neighbor graph/fuzzy topological representation then optimizes low-
dimensional layout. Parameters:

- `n_neighbors`: local versus broader structure;
- `min_dist`: visual compactness;
- metric;
- output dimension/seed.

Often faster/scalable and supports transform in implementations. Same caution:
2D distances/densities/clusters are distorted and hyperparameter-dependent.

## 10. PCA versus t-SNE versus UMAP

| Property | PCA | t-SNE | UMAP |
|---|---|---|---|
| linear | yes | no | no |
| objective focus | global variance/reconstruction | local neighbor probabilities | local graph/topology approximation |
| deterministic | SVD mostly (sign/randomized caveat) | stochastic | stochastic often |
| transform new data | direct | not standard | supported in common implementations |
| inverse | approximate direct | no ordinary | approximate/not inherent |
| axes/loadings | interpretable linearly | no | no |
| visualization clusters | cautious | very cautious | very cautious |

Common workflow: scale → PCA to 30–100 dims (noise/speed) → t-SNE/UMAP to 2D,
all fit on appropriate data and conclusions checked in original space.

## 11. Autoencoders

Encoder z = g(x), decoder x̂ = h(z), minimize reconstruction loss.

> minimize Σ L(x, h(g(x)))

Undercomplete bottleneck forces compression; nonlinear nets learn nonlinear
manifolds. Overcomplete networks can copy input unless regularized.

Variants:

- denoising: reconstruct clean from corrupted;
- sparse: activation penalty;
- contractive: penalize sensitivity;
- convolutional/sequence;
- variational autoencoder (VAE): probabilistic latent model.

Reconstruction emphasizes frequent/easy variation, not necessarily downstream
semantics. Autoencoder anomaly detection can reconstruct anomalies or fail on
normal rare modes.

## 12. VAE intuition

Encoder approximates posterior q(z ∣ x); decoder p(x ∣ z); prior p(z). Optimize
evidence lower bound (ELBO):

> ELBO = E<sub>q(z∣x)</sub>[log p(x ∣ z)] − KL(q(z ∣ x) ‖ p(z))

First term reconstruction likelihood; second regularizes latent distribution.
Reparameterization writes z = μ + σ ⊙ ε with ε from fixed standard normal so
gradients pass through μ, σ.

Trade-off can produce blurry outputs/posterior collapse depending decoder/data.

## 13. Representation evaluation

- reconstruction error/variance;
- neighbor preservation (trustworthiness/continuity);
- downstream task quality with fixed protocol;
- linear probe;
- retrieval recall;
- clustering stability;
- robustness to nuisance transformations;
- demographic/privacy leakage probes;
- compute/storage/serving.

Avoid using test labels repeatedly to choose unsupervised representation; that is
supervised model selection.

## 14. Visualization checklist

When publishing 2D embedding include:

- sample/population and preprocessing;
- algorithm/version/metric/parameters/seed;
- whether colors/labels used in tuning;
- multiple seeds/neighbor scales;
- density/sample count caveat;
- evidence in original space/downstream;
- no causal/natural-category claim from separation alone.

## 15. Exercises

1. Implement PCA with SVD and verify reconstruction/orthogonality.
2. Show how scaling changes PCA components.
3. Run t-SNE/UMAP seeds/perplexities and document unstable conclusions.
4. Compare PCA/random projection for nearest-neighbor recall.
5. Train an autoencoder and test whether latent variables help downstream.

