# Chapter 3 — Vision Transformers and Self-Supervised Learning

## 1. Vision Transformer (ViT)

Split H×W image into P×P patches. Number patches:

> N = (H/P)(W/P), assuming divisible/non-overlap

Flatten each patch P²C and linearly project to d, add position embeddings and
optional class token, process Transformer encoder.

Patch projection is equivalent to convolution kernel/stride P under common setup.

## 2. Complexity and resolution

Attention O(N²d). Since N grows with image area, doubling H and W makes 4× tokens
and ~16× attention score work. Patch size larger lowers compute but loses fine
detail.

High-resolution strategies: hierarchical/window attention, pooling/patch merging,
local/global attention, CNN hybrid, feature pyramids.

## 3. Inductive bias

CNN has locality, translation equivariance, weight sharing strongly. ViT has global
content interactions and weaker image-specific prior; often needs more data/
pretraining/augmentation but scales well.

Modern hybrids blur boundary. Compare end quality, data, robustness, latency, and
transfer—not “attention replaces convolution.”

## 4. Position and class representation

Absolute learned position grids need interpolation for new resolution; can alter
behavior. Relative/window biases and rotary variants used. Class token pools global
representation; mean pooling alternative. Dense tasks need patch/spatial features.

## 5. Hierarchical transformers

Windowed attention reduces quadratic global cost; shifted windows connect regions.
Patch merging creates multi-scale hierarchy, useful detection/segmentation. Global
communication may require layers/window shifts.

## 6. Self-supervised categories

### Contrastive

Two augmented views of same image positives; other images negatives. Learn
augmentation invariance. InfoNCE. False negatives/batch/temperature/augmentation.

### Non-contrastive

Online predicts target-network representation with stop-gradient/momentum; avoid
collapse via asymmetry, predictor, normalization, variance mechanisms.

### Redundancy reduction

Make paired dimensions aligned while reducing cross-dimension correlation/maintain
variance.

### Masked image modeling

Mask patches and reconstruct pixels/features/discrete targets. Learns context;
target choice and mask ratio matter.

### Clustering/prototypes

Assign representations to balanced prototypes and predict across views; avoid
collapsed single cluster.

## 7. Augmentation defines invariance

Contrastive learning treats crops/color changes as same instance. If color or
location is task-critical, this can remove signal. Small crops might contain
different objects but labeled positive.

Design from downstream semantics and evaluate linear probe/fine-tune/robustness.

## 8. Evaluation protocols

- linear probe with frozen encoder;
- k-NN in embedding space;
- full/partial fine-tuning;
- few-shot;
- transfer across domains/tasks;
- robustness/OOD;
- retrieval;
- segmentation/detection transfer.

Linear probe measures accessible linear information, not all representation quality.
Keep optimization budgets comparable.

## 9. Fine-tuning ViTs

- resolution/position interpolation;
- layer-wise learning-rate decay;
- warmup/AdamW/augmentation;
- head initialization;
- stochastic depth/dropout;
- freeze/adapters/LoRA;
- class token/pooling;
- normalization precision.

Small datasets overfit; pretrained CNN may remain better under compute/latency.

## 10. Distillation

Student matches teacher logits/features/attention or special distillation token.
Can transfer augmentation/ensembles and create efficient model. Evaluate independent
labels/robustness; teacher shortcuts propagate.

## 11. OOD and representation probing

- source/camera/style changes;
- backgrounds/texture versus shape;
- corruption/adversarial;
- nearest-neighbor examples;
- feature rank/variance;
- sensitive attribute predictability;
- memorization/duplicate retrieval.

Large pretraining does not guarantee absence of spurious correlations.

## 12. Exercises

1. Calculate ViT tokens/attention memory across resolutions/patches.
2. Implement patch embedding and position interpolation.
3. Compare contrastive augmentation policies on color-critical task.
4. Run linear probe versus full fine-tune.
5. Detect representation collapse/shortcut using probes.

