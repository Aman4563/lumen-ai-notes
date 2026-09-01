# Chapter 1 — Modern Foundation-Model Architectures and Scaling

## 1. Architecture is a resource allocation decision

A model architecture determines what information can interact, how parameters are
used, how computation maps to hardware, and which training signals are expressible.
Compare architectures under explicit budgets:

- total and active parameters;
- training tokens/examples and FLOPs;
- peak memory and communication;
- latency/throughput/context at serving;
- data/evaluation and safety requirements.

Equal parameter count is not equal compute for sparse models; equal training FLOPs
is not equal inference cost.

## 2. Dense decoder transformer accounting

Let:

- L = number of layers;
- d = model width;
- f = feed-forward hidden width;
- V = vocabulary size;
- T = sequence length.

Ignoring biases/norms, one standard multi-head-attention block has about 4d²
projection parameters. A non-gated FFN has about 2df; a gated FFN often has about
3df. Embeddings contribute approximately Vd and may tie to output weights.

> **parameters ≈ Vd + L(4d² + FFN parameters)**

This is a first estimate. Architecture details, MoE, heads, adapters, and untied
outputs change it.

Training a dense transformer is often approximated as a small constant times
parameters × training tokens, with a frequently used rough order near six FLOPs
per parameter-token for forward/backward major matrix operations. It is not exact:
attention, embeddings, recomputation, optimizer, sparsity, and utilization matter.
Use a model-aware profiler for capacity commitments.

## 3. Attention head variants

### Multi-head attention (MHA)

Each query head has separate K/V head. Expressive standard, largest KV cache.

### Multi-query attention (MQA)

Many query heads share one K and V head. Strong cache/bandwidth reduction, possible
quality trade-off.

### Grouped-query attention (GQA)

Query heads share K/V within groups, balancing cache and quality. KV cache elements
per layer are approximately:

> **2 × batch × sequence × KV heads × head dimension**

Multiply by layers and bytes per stored element. Cache memory excludes allocator
metadata, fragmentation, and other activations/workspace.

## 4. Positional methods and long context

Learned absolute, sinusoidal, relative bias, and rotary position representations
encode order differently. RoPE rotates Q/K features by position-dependent angles;
extensions may interpolate/rescale frequencies.

Longer configured context does not prove useful long-context reasoning. Evaluate:

- retrieval at positions throughout context;
- multi-hop integration and distractors;
- extrapolation beyond training lengths;
- positional aliasing and attention sinks;
- KV/activation memory and latency;
- data containing genuinely long dependencies;
- security risks from more untrusted context.

Techniques include efficient exact attention, local/sliding windows, sparse
patterns, recurrence/memory, sequence/context parallelism, retrieval, and context
compression. Each changes capability and systems trade-offs.

## 5. Feed-forward and normalization choices

Gated FFNs such as SwiGLU-like blocks multiply a gate branch by a value branch,
often using a smaller expansion ratio than classic 4d while changing parameter
count. RMSNorm avoids mean subtraction and is common in decoder models.

Pre-norm improves gradient flow in deep residual networks. Residual scaling,
initialization, normalization placement, and optimizer interact; copy a coherent
architecture recipe before altering one component.

## 6. Mixture of Experts (MoE)

Replace some dense FFNs with E experts and a router. For token representation x:

> **router probabilities = softmax(Wᵣx)**

Top-k routing sends a token to k experts and combines their outputs. Total parameter
count grows with E, while active compute grows mainly with k.

### Capacity

If N token assignments are distributed across E experts with capacity factor c, a
rough per-expert capacity is:

> **capacity ≈ ceil(c × N ÷ E)**

Overflow may be dropped, rerouted, or handled by a fallback, each affecting quality
and performance.

### Load balancing

Without regularization, router collapse overloads a few experts. Auxiliary losses
or routing algorithms encourage balanced probability/assignment. Balance is not
the same as useful specialization; inspect both.

### Systems cost

Expert parallelism requires all-to-all token exchange, dispatch/gather, padding or
variable counts, and topology-aware placement. Straggling hot experts can dominate
step time. Track:

- tokens and probability mass per expert;
- capacity overflow/drop rate;
- router entropy and expert similarity;
- all-to-all time and bytes;
- expert compute imbalance;
- behavior by domain/language/task.

MoE increases serving memory and routing/communication complexity even if active
FLOPs stay bounded.

## 7. Scaling laws

Empirical scaling laws model loss as power-law-like functions of model size, data,
and compute over a regime. They help allocate pilot experiments and detect runs far
off trend.

General workflow:

1. train a grid of smaller models/data/compute budgets with consistent recipes;
2. fit held-out loss against scale with uncertainty;
3. identify compute-efficient allocation and irreducible floor in that regime;
4. validate extrapolation on an intermediate scale;
5. include downstream/safety/inference constraints before final choice.

Pitfalls:

- extrapolating across architecture/data/optimizer changes;
- fitting too few correlated points;
- using training rather than held-out loss;
- ignoring data quality/repetition;
- assuming loss improvement uniformly improves desired capabilities;
- ignoring utilization and dollar/time limits.

## 8. Compute-optimal training intuition

For a fixed compute budget, an oversized model trained on too few tokens may
underperform a smaller model trained on more data. Conversely, repeatedly cycling
limited data can overfit. The optimal balance is empirical and changes with data
quality, architecture, and downstream goal.

Record:

- unique and total tokens;
- repeat count by source;
- active/total parameters;
- theoretical and achieved FLOPs;
- validation loss by domain;
- checkpoint performance trajectories;
- inference budget of the final model.

## 9. Retrieval-augmented and external-memory models

Retrieval can provide fresh/private evidence and shift some knowledge from weights
to an index. Training may retrieve documents, contrast positives/negatives, or
jointly train retriever and generator.

Key research questions:

- retriever recall and stale/poisoned evidence;
- differentiable versus decoupled retrieval;
- source authorization and citation;
- context utilization versus mere retrieval;
- index/training snapshot consistency;
- memorization and fallback when retrieval fails.

Retrieval does not universally replace parametric knowledge and adds a security and
latency boundary.

## 10. State-space, recurrent, and hybrid sequence models

Alternatives use recurrence, state-space dynamics, convolution, or hybrids to gain
linear-time streaming or long-range memory. Compare:

- parallel training and recurrent inference;
- memory capacity and selective state updates;
- hardware kernel maturity;
- quality across recall, induction, reasoning, and modalities;
- state reset, chunking, and very long sequences;
- serving batch/state management.

Do not infer practical speed from asymptotic complexity alone; kernel utilization
and matrix shapes matter.

## 11. Multimodal architectures

Common composition:

```text
modality encoder/tokenizer -> projection/resampler
-> shared or cross-attention language backbone -> modality/task head
```

Choices:

- early fusion into one token stream;
- cross-attention from language to modality features;
- separate encoders aligned contrastively;
- discrete image/audio/video tokenizers;
- frozen versus jointly trained encoders;
- resolution/frame/duration token budget;
- modality-specific position/time representation.

Alignment data quality and modality imbalance can cause a model to ignore a
modality. Evaluate counterfactuals where text and image/audio disagree.

## 12. Diffusion and flow-style generative models

Diffusion training corrupts data across noise levels and learns denoising/score-
related prediction. Sampling integrates a reverse process over steps. Important
choices include:

- variance/noise schedule and parameterization;
- latent versus pixel/sample space;
- U-Net versus transformer backbone;
- conditioning and classifier-free guidance;
- sampler/solver and number of steps;
- text/image/audio encoders;
- distillation/consistency methods for faster sampling.

Evaluation must cover prompt adherence, perceptual/factual quality, diversity,
safety, memorization, and latency—not only one distribution metric.

## 13. Architecture search and ablations

Compare under a declared budget. Recommended sequence:

1. reproduce stable baseline recipe;
2. estimate parameters/FLOPs/memory/communication;
3. run tiny overfit and numerical checks;
4. run matched small-scale learning curves with multiple seeds;
5. inspect mechanism-specific diagnostics;
6. test an intermediate scale for trend consistency;
7. evaluate serving and safety consequences;
8. only then allocate a large run.

Changing five fashionable components at once prevents attribution and makes failure
debugging difficult.

## 14. Model configuration contract

Store:

- vocabulary/tokenizer and special-token IDs;
- layers, width, heads, KV heads, FFN/expert dimensions;
- normalization/activation/residual recipe;
- positional method and supported/trained length;
- attention masks/pattern/backend;
- dense/MoE routing and capacity;
- initialization and parameter tying;
- precision policy;
- tensor names/shapes and checkpoint version;
- generation defaults kept separate from weights.

Validate config against loaded tensor shapes before allocating a large job.

## 15. Practical labs

1. Implement parameter and KV-cache estimators; validate against a toy model.
2. Compare MHA/GQA/MQA quality and decode memory on a small transformer.
3. Build a top-2 MoE layer; plot routing balance and overflow.
4. Fit a small scaling curve and test one held-out scale.
5. Design a multimodal contradiction evaluation for modality reliance.

## 16. Primary references

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556)
- [Switch Transformers](https://arxiv.org/abs/2101.03961)
- [FlashAttention](https://arxiv.org/abs/2205.14135)
- [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361)

Treat scaling-law coefficients and architecture recommendations as empirical,
regime-dependent results rather than universal constants.
