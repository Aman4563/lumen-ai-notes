# Chapter 4 — Sequence Models, Attention, and Representation Learning

## 1. Sequence challenges

Sequences have order, variable length, long dependencies, causality, padding, and
often streaming constraints. Examples: text, audio, events, time series, DNA.

Model must decide:

- causal (past only) versus bidirectional;
- many-to-one, many-to-many, or autoregressive;
- fixed/variable length;
- irregular time gaps;
- state reset/boundary;
- latency and incremental cache.

## 2. Vanilla RNN

> h<sub>t</sub> = φ(W<sub>xh</sub>x<sub>t</sub> + W<sub>hh</sub>h<sub>t−1</sub> + b)  
> y<sub>t</sub> = W<sub>hy</sub>h<sub>t</sub> + c

Weights shared across time. Hidden state summarizes prefix, but finite capacity and
gradient products limit long dependence.

### Backpropagation through time (BPTT)

Unroll recurrence. Gradient to earlier state multiplies recurrent Jacobians:

> ∂L/∂h<sub>t−k</sub> involves product of k Jacobians

Vanishing/exploding depends on recurrent weights, activation derivatives, states.
Truncated BPTT limits backprop window, saving memory but cannot learn dependencies
beyond truncation directly.

## 3. LSTM

Gates (one common notation):

> f<sub>t</sub> = σ(W<sub>f</sub>[h<sub>t−1</sub>, x<sub>t</sub>] + b<sub>f</sub>)  
> i<sub>t</sub> = σ(W<sub>i</sub>[h<sub>t−1</sub>, x<sub>t</sub>] + b<sub>i</sub>)  
> o<sub>t</sub> = σ(W<sub>o</sub>[h<sub>t−1</sub>, x<sub>t</sub>] + b<sub>o</sub>)  
> g<sub>t</sub> = tanh(W<sub>g</sub>[h<sub>t−1</sub>, x<sub>t</sub>] + b<sub>g</sub>)  
> c<sub>t</sub> = f<sub>t</sub> ⊙ c<sub>t−1</sub> + i<sub>t</sub> ⊙ g<sub>t</sub>  
> h<sub>t</sub> = o<sub>t</sub> ⊙ tanh(c<sub>t</sub>)

Cell additive path supports gradient flow; forget/input/output gates control memory.
Still sequential (limited parallelism), long-state capacity finite, and not immune
to gradient/optimization problems.

## 4. GRU

Uses update/reset gates and one hidden state; fewer parameters than LSTM. Exact
formulation varies. Often similar performance; choose empirically based on data,
latency, framework. Do not claim one universally better.

## 5. Bidirectional models

Process forward and backward, combine states. Useful when entire sequence known
(tagging/encoding). Invalid for causal streaming/future prediction if backward
direction sees future tokens. This is a common leakage bug in time series.

## 6. Sequence-to-sequence encoder–decoder

Encoder represents source; decoder generates output token-by-token:

> P(y₁, …, y<sub>T</sub> ∣ x)
> = ∏<sub>t=1</sub><sup>T</sup>P(y<sub>t</sub> ∣ y<sub>&lt;t</sub>, x)

Fixed final encoder vector bottlenecks long inputs; attention lets decoder access
all encoder states.

### Teacher forcing

During training decoder receives true previous token; inference receives own
previous prediction. This exposure mismatch can compound errors. Scheduled
sampling has bias/optimization issues; sequence-level objectives or robust training
are alternatives.

## 7. Attention intuition

Given query q, keys k<sub>i</sub>, values v<sub>i</sub>:

1. score compatibility q with each key;
2. softmax into weights;
3. weighted sum values.

> α<sub>i</sub> = softmax(score(q, k<sub>i</sub>))  
> context = Σ α<sub>i</sub>v<sub>i</sub>

Attention dynamically retrieves information rather than compressing all into one
state.

## 8. Scaled dot-product attention

For matrices Q, K, V:

> Attention(Q, K, V) = softmax(QKᵀ/√d<sub>k</sub> + mask)V

Why divide √d<sub>k</sub>: if independent components variance ~1, dot-product
variance grows with d<sub>k</sub>; scaling avoids softmax saturation.

Mask uses large negative values before softmax:

- padding mask: ignore padded keys;
- causal mask: query t cannot attend future positions;
- structural/local mask.

All-masked rows can produce NaN; design mask/empty sequence.

## 9. Self-, cross-, and multi-head attention

- Self-attention: Q, K, V from same sequence.
- Cross-attention: Q from decoder/query, K/V from source/memory.
- Multi-head: project into h subspaces, attend separately, concatenate/project.

> head<sub>i</sub> = Attention(QW<sub>i</sub><sup>Q</sup>,
> KW<sub>i</sub><sup>K</sup>, VW<sub>i</sub><sup>V</sup>)

Heads can learn varied relations but are not guaranteed human-interpretable roles.

## 10. Attention complexity

Full self-attention score matrix for sequence length L is O(L²) memory/time term,
plus projections O(Ld²) depending dimensions. Long-context methods use:

- local/window/sparse patterns;
- low-rank/kernel approximations;
- recurrence/compression;
- chunking/retrieval;
- state-space/convolutional alternatives;
- optimized exact kernels (reducing memory movement, not quadratic arithmetic).

Part 8 develops transformers/KV caching in detail.

## 11. Positional information

Self-attention without position is permutation-equivariant. Add/order via:

- learned absolute embeddings;
- sinusoidal absolute;
- relative position bias;
- rotary position embeddings;
- recurrence/convolution.

Extrapolation to longer sequences depends on method/training; “supports context
length” does not mean uses all positions reliably.

## 12. Embeddings

Embedding table E ∈ ℝ<sup>V×d</sup> maps discrete ID/token to vector. Lookup selects
row; only used rows receive ordinary sparse gradients.

Learned geometry reflects objective/context. Identifiability: rotations or other
transformations can preserve dot products/predictions, so coordinates have no
absolute semantic meaning.

### Word2Vec concepts

- skip-gram predicts context from center;
- CBOW predicts center from context;
- negative sampling distinguishes observed pairs from sampled negatives.

Frequent-word subsampling and negative distribution affect geometry.

### Static versus contextual

Static word embedding one vector/token type; polysemy collapsed. Contextual model
produces vector per token occurrence based on sequence.

## 13. Metric/contrastive learning

### Contrastive pair loss concept

Pull positive pairs close, push negatives beyond margin. Sampling defines task.

### Triplet loss

Anchor a, positive p, negative n:

> L = max(0, d(a,p) − d(a,n) + margin)

Easy triples yield zero; hard mining speeds learning but false/hard outliers can
destabilize.

### InfoNCE-like loss

For positive pair score s(a,p) among candidates:

> L = −log [exp(s(a,p)/τ) / Σ<sub>j</sub>exp(s(a,c<sub>j</sub>)/τ)]

Temperature τ controls sharpness. In-batch negatives efficient but false negatives,
batch composition, distributed gather, and popularity matter.

## 14. Representation collapse

If encoder maps all inputs same vector, some objectives trivially fail. Contrastive
negatives, stop-gradient/predictor asymmetry, variance/covariance regularization,
and architectural methods prevent collapse. Verify embedding variance, rank,
neighbor quality, not only loss.

## 15. Sequence decoding

### Greedy

Choose highest-probability token each step. Fast, not globally highest-probability
sequence.

### Beam search

Keep B best partial sequences by cumulative log probability. Complexity grows with
beam and vocab scoring; larger beam can favor short/generic sequences.

Length normalization/penalties and constraints affect. Beam is deterministic-ish
search, not diversity sampling.

### Sampling

- temperature;
- top-k;
- nucleus/top-p;
- repetition penalties/constraints.

Sampling changes output distribution, not model knowledge. Evaluate task/safety.

## 16. Time-series/event sequences

Include time gaps, missingness, seasonality, entity history. Avoid future leakage
via bidirectional context/window normalization. Variable-length batching uses masks/
packing. For forecasting multiple horizons, direct, recursive, seq2seq, or
distributional strategies have different compounding/consistency behavior.

## 17. Exercises

1. Unroll RNN three steps and derive recurrent gradient paths.
2. Explain each LSTM gate with failure example.
3. Compute a tiny scaled attention matrix with causal mask.
4. Compare RNN and attention complexity/parallelism.
5. Train triplet/InfoNCE embedding and audit false negatives/collapse.

