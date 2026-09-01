# Chapter 1 — Training Numerics and Optimization

## 1. Optimization is a coupled system

Training behavior depends jointly on model, data order, loss reduction, optimizer,
batch, schedule, precision, initialization, normalization, parallel reduction, and
hardware kernels. A learning rate copied from another run is meaningful only with
its full recipe.

```text
data distribution + architecture + objective
-> gradient estimator + numerical representation
-> optimizer/schedule/update
-> learning trajectory + generalization + systems cost
```

## 2. Objective accounting

For causal language modeling with valid-token mask mᵢ:

> **loss = − [Σᵢ mᵢ log Pθ(tokenᵢ | prefixᵢ)] ÷ [Σᵢ mᵢ]**

The denominator matters. Averaging per sequence, per microbatch, per device, or per
token gives different weighting when lengths vary. In distributed training, reduce
the total loss numerator and valid-token denominator or scale local gradients so
the final update corresponds to the declared global objective.

Test shifted inputs/labels, prompt masks, document boundaries, padding, ignore IDs,
and empty microbatches with decoded examples.

## 3. Stochastic gradient descent

For mini-batch gradient gₜ:

> **θₜ₊₁ = θₜ − ηₜgₜ**

The mini-batch gradient is a noisy estimate of the full-data gradient. Noise can
help exploration/generalization, but excessive variance destabilizes updates.

### Momentum

One convention:

> **vₜ = μvₜ₋₁ + gₜ**
>
> **θₜ₊₁ = θₜ − ηₜvₜ**

Libraries differ in momentum initialization, dampening, Nesterov, maximize sign,
and weight-decay placement. Compare equations/config, not optimizer name alone.

## 4. Adam and AdamW

For gradient gₜ:

> **mₜ = β₁mₜ₋₁ + (1 − β₁)gₜ**
>
> **vₜ = β₂vₜ₋₁ + (1 − β₂)gₜ²**
>
> **m̂ₜ = mₜ ÷ (1 − β₁ᵗ)**
>
> **v̂ₜ = vₜ ÷ (1 − β₂ᵗ)**
>
> **θₜ₊₁ = θₜ − ηₜ m̂ₜ ÷ (√v̂ₜ + ε)**

AdamW applies weight decay as a decoupled parameter shrink rather than inserting
L2 gradient into adaptive moment scaling. A simplified update adds:

> **θ ← (1 − ηλ)θ before/with adaptive update**

Exact ordering/fused implementation can vary. Norm and bias-like parameters are
often excluded from decay by recipe, but this is an empirical architectural choice.

## 5. Other optimizer families

### Adafactor

Factorizes second-moment statistics for matrix parameters, saving memory. Relative-
step and scaling options make its learning-rate semantics easy to misconfigure.

### LAMB/LARS-like layerwise scaling

Scale updates relative to parameter norms, developed for very large batches.
Benefits depend on regime and tuning.

### Shampoo and second-order preconditioners

Use structured matrix statistics to precondition gradients more richly than
coordinatewise Adam. They add compute, communication, state, numerical choices,
and implementation complexity.

### Lion-like sign/momentum methods

Can reduce optimizer state and change tuning/generalization. Validate rather than
assuming benchmark gains transfer.

### Muon

Applies an orthogonalization-related update to 2D hidden-layer parameters and uses
another optimizer for embeddings/scalars/other shapes in common implementations.
It is an active empirical choice, not a universal AdamW replacement. Record the
exact implementation, parameter partition, learning-rate adjustment, and scale.

Optimizer selection is a systems decision: state memory, distributed sharding,
kernel support, communication, convergence per token/FLOP, and final quality.

## 6. Learning-rate schedules

### Warmup

Gradually increases learning rate while optimizer moments/representations stabilize.
Warmup length can be specified in steps or tokens; this distinction matters when
global batch changes.

### Cosine decay

After warmup, a common form over normalized progress u ∈ [0,1]:

> **η(u) = ηmin + 0.5(ηmax − ηmin)[1 + cos(πu)]**

### Linear decay

Simple and predictable; may reach a floor at final budget.

### Constant then decay / WSD-style

Warmup, stable high-rate phase, then cooldown. Useful when training horizon may be
extended or checkpoints are evaluated along the path.

Schedules must use optimizer updates, tokens, or another documented clock. Gradient
accumulation changes microbatch count without changing update count.

## 7. Batch size and gradient accumulation

> **global tokens per update = microbatch sequences per device × devices
> × accumulation steps × average valid tokens per sequence**

For variable lengths, measure actual valid tokens. Larger batches reduce gradient
noise and optimizer steps per token, but may require learning-rate/warmup changes
and can alter generalization.

Gradient accumulation saves optimizer/communication frequency, not activation
memory for each microbatch. Divide loss or gradients correctly. With DDP, suppress
unnecessary synchronization on non-final accumulation microbatches when supported.

Linear learning-rate scaling with batch is a heuristic over a regime, not a law.
Use small sweeps and monitor update-to-weight ratios.

## 8. Gradient clipping

Global norm clipping:

> **g ← g × min(1, threshold ÷ (||g||₂ + ε))**

In sharded training, compute the true global norm using distributed reductions.
Clip after unscaling mixed-precision gradients and before optimizer step. Log raw
norm, clipped fraction, and threshold. Frequent clipping can hide instability or
change the intended optimizer; diagnose the cause.

Value clipping is different and usually harder to justify.

## 9. Gradient and update diagnostics

Track globally and for key module groups:

- loss and token-normalized loss by data domain;
- gradient norm, non-finite values, clipping rate;
- parameter norm and update norm;
- relative update = ||Δθ|| ÷ (||θ|| + ε);
- optimizer moment statistics;
- logits, entropy, activation/RMS ranges;
- learning rate, batch/tokens, skipped steps;
- router balance for MoE;
- precision scale/amax and overflow/underflow;
- throughput, memory, and communication.

Norms alone are not a quality metric. They diagnose trajectory changes and localize
instability.

## 10. Initialization

For z = Σⱼwⱼxⱼ with independent zero-mean components:

> **Var(z) ≈ fan-in × Var(w) × Var(x)**

Xavier/Glorot and He/Kaiming choose variance based on fan and activation to keep
signals from exploding/vanishing. Deep residual transformers often use additional
residual-output scaling or architecture-specific initialization.

Validate at initialization:

- activation RMS by layer;
- residual-stream growth;
- logits/loss near expected random baseline;
- gradient RMS and propagation;
- tied weights and zero/no-op adapter initialization.

## 11. Normalization and residual stability

LayerNorm/RMSNorm, pre/post norm, residual scaling, gating, and depth affect signal
propagation. Pre-norm provides a direct residual gradient path, while post-norm can
need careful initialization/schedule.

Numerically sensitive reductions (variance, norm, softmax) may accumulate in higher
precision. Fused kernels must preserve intended epsilon and dtype behavior.

## 12. Floating-point formats

### FP32

Wide range and precision; expensive storage/bandwidth versus lower formats.

### TF32-like matrix mode

Uses reduced input mantissa with FP32-like range/accumulation semantics on supported
hardware for faster matrix operations. It is not a storage dtype.

### FP16

More mantissa precision than BF16 but much narrower exponent range; often needs loss
scaling to avoid gradient underflow.

### BF16

FP32-like exponent range with fewer mantissa bits; often more stable for deep
learning, though rounding error remains.

### FP8 and lower formats

Very limited range/precision, requiring scaling recipes, hardware support, and
sensitive-operation exceptions. E4M3-like formats trade range for precision;
E5M2-like formats trade precision for range. Modern libraries track amplitude
statistics and apply per-tensor/block scaling.

Never describe a run as simply “FP8.” State parameter/storage, forward/backward,
accumulation, optimizer state, communication, and scaling policy.

## 13. Mixed precision

A typical policy might use BF16 activations/weights for matrix operations, FP32
accumulation for reductions, and FP32 optimizer moments. Variants keep master FP32
weights or update lower-precision parameters directly.

FP16 dynamic loss scaling:

1. multiply loss by scale S;
2. backpropagate scaled gradients;
3. check non-finite values;
4. unscale gradients;
5. clip and update if finite;
6. adapt S.

BF16 often does not need loss scaling because of range, but this is not a guarantee
against NaNs from invalid math or excessive updates.

## 14. Rounding and reduction order

Floating-point addition is not associative:

> **(a + b) + c may differ from a + (b + c)**

Distributed rank count, reduction tree, fusion, and kernel changes can alter the
trajectory. Bitwise reproducibility across hardware/software is often unrealistic.
Define acceptable reproducibility: invariant tests, curve tolerance, final metric
distribution, and exact manifest.

Stochastic rounding can reduce systematic loss when storing/updating low-precision
values, but adds RNG/state and hardware/library dependencies.

## 15. Softmax, logits, and cross-entropy stability

Use log-sum-exp stabilization:

> **log Σᵢ exp(zᵢ) = m + log Σᵢ exp(zᵢ − m), m = maxᵢ zᵢ**

Very large logits can produce overconfidence, gradients concentrated on a few
tokens, or overflow in poor implementations. Techniques such as logit regularizers,
soft capping, label smoothing, or temperature alter objectives and require
evaluation; they are not substitutes for diagnosing data/optimizer instability.

## 16. NaN and divergence playbook

1. stop at first non-finite tensor using anomaly hooks on a small run;
2. record batch IDs, rank, step, checkpoint, scale, and RNG/data cursor;
3. verify inputs/labels/masks and denominator are finite/nonempty;
4. inspect logits/loss before backward;
5. inspect per-layer activations/gradients and optimizer state;
6. compare higher precision and one device;
7. lower learning rate or disable suspect fused/compiled kernel as diagnostic;
8. test checkpoint corruption/resume and rank consistency;
9. reproduce on the exact bad batch;
10. fix mechanism, then re-enable performance features one at a time.

Do not merely skip every bad step; repeated skipping biases training and hides root
cause.

## 17. Memory accounting

For P parameters, raw storage is P × bytes per element. Training additionally holds
gradients, optimizer moments, optional master parameters, activations, temporary
workspaces, communication buffers, allocator cache, and data.

Example conceptual Adam policy:

- BF16 parameters: 2P bytes;
- BF16 gradients: 2P;
- FP32 master parameters: 4P if used;
- two FP32 moments: 8P;

This already totals 12–16P bytes before activations/workspaces, depending policy.
Do not quote a universal multiplier without listing the representation.

## 18. Activation checkpointing and offload

Checkpoint selected activations and recompute missing intermediates during backward.
Trade memory for extra compute. Granularity affects recomputation and peak memory;
RNG-dependent layers need correct state handling.

CPU/NVMe offload trades accelerator memory for transfer bandwidth/latency and can
destroy throughput if not overlapped. Profile rather than assuming a model that fits
will train efficiently.

## 19. Training efficiency metrics

- tokens/s or samples/s;
- step time distribution and time breakdown;
- achieved accelerator FLOPs;
- model FLOPs utilization (estimated model FLOPs ÷ theoretical peak-time);
- hardware FLOPs utilization where measured;
- scaling efficiency from N to kN devices;
- data/communication/checkpoint wait;
- energy and cost per token or quality target.

MFU estimates depend on the FLOP formula and peak precision mode. State assumptions.

## 20. Hyperparameter tuning strategy

1. validate correctness with tiny overfit;
2. choose stable baseline recipe from a close architecture/data regime;
3. tune learning rate and warmup across a small log-scale range;
4. tune batch/sequence and decay jointly with systems constraints;
5. inspect learning curves, norms, and held-out domains;
6. replicate promising settings;
7. retune after major scale, data, precision, or optimizer changes;
8. reserve untouched evaluation for final decisions.

Early small-scale rankings may reverse at scale. Use scaling pilots and do not over-
optimize against a single benchmark.

## 21. Practical labs

1. Implement SGD momentum and AdamW from equations; compare to framework on a fixed
   tensor sequence.
2. Demonstrate per-token versus per-sequence loss weighting difference.
3. Train FP32, FP16+scaling, and BF16; trace first numerical divergence.
4. Estimate parameter/optimizer/activation memory and compare to profiler peak.
5. Run learning-rate/batch pilot with three seeds and justify the selected recipe.
6. Inject NaN data and a fused-kernel bug; write a diagnostic report.

## 22. Primary references

- [Adam paper](https://arxiv.org/abs/1412.6980)
- [Decoupled Weight Decay Regularization](https://arxiv.org/abs/1711.05101)
- [PyTorch optimizers](https://docs.pytorch.org/docs/stable/optim.html)
- [PyTorch automatic mixed precision](https://docs.pytorch.org/docs/stable/amp.html)
- [NVIDIA Transformer Engine low-precision training](https://docs.nvidia.com/deeplearning/transformer-engine/user-guide/features/low_precision_training/index.html)

Version-specific optimizer defaults and low-precision behavior must be checked in
the actual library release.
