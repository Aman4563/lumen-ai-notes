# Chapter 2 — Training, Initialization, Normalization, and Regularization

## 1. A reliable training loop

```text
seed/config -> data/split/loader -> initialize model/optimizer/schedule
-> repeated forward/loss/backward/update -> validation -> checkpoint
-> final held-out evaluation -> artifact/model card
```

Log enough to reproduce: data/model code/version, config, seed, environment,
optimizer/schedule, effective batch, metrics, throughput, hardware, checkpoint.

## 2. Initialization variance

For z = Σ w<sub>j</sub>x<sub>j</sub> with independent zero-mean terms:

> Var(z) ≈ fan_in · Var(w) · Var(x)

To preserve variance, Var(w) ≈ 1/fan_in.

### Xavier/Glorot

For tanh/linear-ish activations:

> Var(w) ≈ 2/(fan_in + fan_out)

Uniform/normal variants differ.

### He/Kaiming

For ReLU-like where roughly half activation zero:

> Var(w) ≈ 2/fan_in

Account for activation negative slope and fan mode. Initialization tuned for one
architecture may not transfer to residual/attention nets unchanged.

## 3. Normalization

### Batch normalization

For activation feature across mini-batch (and spatial positions in CNN):

> x̂ = (x − μ<sub>batch</sub>)/√(variance<sub>batch</sub> + ε)  
> y = γx̂ + β

Training updates running statistics used at evaluation.

Benefits: smoother/easier optimization, permits larger rates, regularizing batch
noise. Limitations: tiny/non-i.i.d. batches, distributed stat sync, train/eval
mismatch, domain shift, sequence padding.

### Layer normalization

Normalizes features within each example/token, independent of batch. Standard in
transformers/RNN contexts. Train/eval same statistics. It changes feature geometry
and has affine parameters.

### Group/instance normalization

GroupNorm normalizes channel groups per example; useful for small-batch vision.
InstanceNorm per sample/channel often style/vision. RMSNorm uses root mean square
without mean subtraction, common transformer variant.

### Placement

Pre-norm transformer: norm before sublayer, better deep gradient flow. Post-norm:
norm after residual, original Transformer style but harder deep training. Architecture
details and residual scaling matter.

## 4. Optimizer choices

### SGD + momentum

Strong image training baseline; requires learning-rate schedule/tuning. Momentum
accelerates consistent directions.

### Adam/AdamW

Adaptive coordinate steps; default for transformers and many tasks. AdamW decouples
weight decay. Often exclude bias and normalization parameters from decay under
architecture convention.

### Optimizer state cost

For parameter count P:

- parameters;
- gradients;
- optimizer moments (Adam two arrays);
- master fp32 weights in mixed precision sometimes;
- activations.

Training memory can be many times raw parameter bytes. Optimizer sharding/offload
targets this.

## 5. Effective batch size

> effective batch = microbatch per device × devices × gradient accumulation steps

Gradient accumulation simulates larger batch if loss scaling and state behavior
are correct, but BatchNorm, dropout randomness, optimizer update count, schedule,
and data order differ from true large batch.

Linear learning-rate scaling is heuristic, often paired with warmup. Validate.

## 6. Learning-rate diagnostics

- diverges/NaN early: rate too high, scale/precision/initialization;
- loss smooth but barely moves: rate too low or no gradient;
- training improves then spikes: schedule, bad batch, overflow, momentum;
- validation worsens: overfit, not necessarily rate;
- loss scale changes with batch/sequence/reduction: effective rate changes.

Learning-rate range tests increase rate briefly and plot loss, but use as heuristic
with representative batches.

## 7. Regularization

### Weight decay/L2

Penalizes/shrinks parameters. Apply thoughtfully; embedding/norm/bias conventions
differ. Decoupled weight decay update:

> θ ← (1 − ηλ)θ − η · optimizer_gradient_step

### Dropout

During training mask activations with probability p and scale survivors by 1/(1−p)
so expectation stays. Evaluation disables masking.

Too much causes underfit; placement differs by architecture. Monte Carlo dropout
at inference is an approximate uncertainty method, not universally calibrated.

### Data augmentation

Encodes invariances and expands effective data. Must preserve label/task semantics.
Mixup interpolates inputs/labels; CutMix combines image regions; text/audio
augmentations require semantic care.

### Label smoothing

Reduces one-hot target confidence, can improve generalization and calibration in
some settings but can harm fine-grained confidence/distillation. Track exact
definition.

### Early stopping

Stop on validation metric after patience/min improvement, restore best checkpoint.
Noisy metrics need smoothing/patience. Validation reuse over many trials still
overfits.

## 8. Class imbalance in deep learning

- weighted BCE/CE;
- focal loss:

> FL = −α(1 − p<sub>t</sub>)ᵞ log p<sub>t</sub>

downweights easy examples; γ controls focus. Can hurt calibration.

- balanced sampling/hard negative mining;
- threshold/capacity policy;
- collect labels/augment rare classes;
- macro/per-class evaluation.

Do not apply all simultaneously without ablation.

## 9. Gradient clipping and accumulation

Global norm clipping before optimizer step. In mixed precision, unscale gradients
before clipping. With accumulation divide loss or gradients consistently so
effective scale matches full batch.

```python
optimizer.zero_grad(set_to_none=True)
for microstep, batch in enumerate(loader):
    loss = compute_loss(batch) / accumulation_steps
    loss.backward()
    if (microstep + 1) % accumulation_steps == 0:
        clip_grad_norm_(model.parameters(), max_norm)
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
```

Handle final partial accumulation and scheduler step unit.

## 10. Mixed precision

- float16: limited exponent range, fast hardware, needs dynamic loss scaling.
- bfloat16: float32-like exponent, fewer mantissa bits, often more stable.
- float32 accumulation/master weights for sensitive operations.

Automatic mixed precision casts safe ops and keeps sensitive reductions/norms.
Loss scaling multiplies loss to avoid gradient underflow, then unscales before
update; dynamic scaler skips overflowed steps and adjusts.

Validate numerics, quality, throughput, memory—not assume faster on all hardware.

## 11. Data loaders

Potential bottlenecks:

- disk/network decode;
- CPU augmentation/tokenization;
- too few/many workers;
- serialization/process startup;
- page-locked transfer;
- small batches/kernel launch;
- variable sequence padding;
- remote random access.

Measure accelerator utilization and data wait. Prefetch, cache, shard sequentially,
bucket similar lengths, persistent workers, and async host-to-device transfer.

Correctness:

- deterministic split/shuffle seeds;
- distributed sampler no unintended duplicates/omissions;
- augmentation only train;
- worker RNG initialized;
- corrupt sample policy visible;
- last batch/reduction behavior.

## 12. Checkpointing

For exact-ish resume save:

- model parameters/buffers;
- optimizer and scheduler;
- scaler;
- epoch/global step;
- RNG states;
- data sampler progress if needed;
- config/code/data/artifact IDs;
- best metric/early stopping state.

Write atomically/versioned and validate checksum/load. A weights-only checkpoint is
fine for inference, not full training resume.

## 13. Reproducibility

Seed Python/NumPy/framework/device RNG; deterministic kernels when available;
record versions/hardware. Distributed reduction and GPU kernels can be
nondeterministic. Determinism may cost performance and still differ across
platforms.

Report mean/spread across seeds for unstable small experiments. Never select the
best seed as if it were a hyperparameter then report it alone.

## 14. Diagnosing training

### Overfit a tiny batch

Try near-zero loss on 1–10 examples with regularization/augmentation off. Failure
suggests model/labels/loss/gradient/data bug.

### Inspect distributions

Activations, logits, weights, gradients, norms, saturation, dead units, non-finite
first occurrence. Compare layers/time.

### Baselines

Random/untrained, constant, linear/shallow, shuffled-label (should not generalize),
small-data memorization.

### Ablations

Remove augmentation, normalization, residual, pretrained weights, feature family;
keep budget/splits fixed.

## 15. Scaling laws intuition

Performance often follows smooth power-law-like trends with data/parameters/compute
over ranges. Compute-optimal allocation balances model and data. But extrapolation
can fail due data quality, saturation, distribution, architecture, evaluation
contamination, or capability discontinuities.

Track total training/inference cost and marginal product value.

## 16. Exercises

1. Calculate Xavier/He scales for layer shapes.
2. Compare BatchNorm/LayerNorm behavior at train/eval and batch sizes.
3. Implement accumulation + clipping + mixed precision safely.
4. Diagnose injected NaN, detached gradient, and data-loader bottleneck.
5. Run regularization ablations with fixed compute.

