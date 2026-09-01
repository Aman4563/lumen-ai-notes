# Chapter 6 — Deep Learning Interview Workbook

## 1. Rapid answers

### Why nonlinear activation?

Without it, affine layer composition remains affine. Nonlinearity creates
piecewise/smooth nonlinear representations.

### Why ReLU often beats sigmoid in hidden layers?

Positive-side derivative does not saturate, cheaper, sparse activations. But dead
negative units and unbounded outputs exist; architecture-dependent.

### BatchNorm versus LayerNorm?

BatchNorm uses batch/spatial statistics per feature with running eval state;
batch-size/distribution dependent. LayerNorm uses features within each example/
token, same train/eval, common sequence models.

### Why residual connections?

Identity information/gradient path, easier residual function optimization, deeper
models. Shape/projection/norm/scaling still important.

### Dropout train versus inference?

Training randomly masks and inverted-scales survivors. Evaluation uses all units
without masking. Mode errors change outputs.

### Adam versus SGD?

Adam adaptive fast/easy, common transformers; SGD momentum can generalize strongly
in vision and uses less state. Compare schedule, batch, weight decay, memory.

### Why attention scale by √d?

Dot-product variance grows with key dimension under standard assumptions, causing
softmax saturation/small gradients. Scaling stabilizes logits.

### What causes GPU OOM?

Peak activations, optimizer/grad/parameter states, attention quadratics, workspace,
retained graph/references, fragmentation. Measure peak and choose checkpointing,
batch/sequence, precision, sharding.

## 2. Derivations

1. dense layer backward;
2. softmax CE p − y;
3. Xavier/He variance;
4. RNN gradient product;
5. convolution output shape/parameter count;
6. receptive field recurrence;
7. scaled attention dimensions;
8. InfoNCE/triplet loss gradients conceptually.

## 3. Debugging prompts

### Loss stays random

Overfit tiny batch; check labels/inputs/loss/task shape, optimizer parameters,
gradient presence/norm, train/eval, detach/in-place, rate, output activation, class
mapping, data augmentation.

### Validation much worse than training

Leakage/duplicates first, train/eval mode, preprocessing mismatch, augmentation,
overcapacity/regularization, shift/slices, label quality. More dropout is not the
first universal answer.

### Multi-GPU slower than one

Small workload/batch, communication/all-reduce, network topology, data loader,
sync/metrics, imbalance, gradient accumulation sync, launch overhead. Profile and
compute scaling efficiency.

### Mixed precision NaNs

Find first nonfinite op/gradient; stable logits losses, loss scaler, unscale before
clip, norm/reduction dtype, extreme input, rate. Prefer bfloat16 if supported; do
not blindly clip outputs.

## 4. Part 7 capstone

Build a deep-learning training repository for image or sequence classification.

Requirements:

1. versioned split/data card and simple linear baseline;
2. custom model plus transfer/pretrained candidate;
3. correct dataset/collate/mask/augmentation;
4. mixed precision, accumulation, clipping, schedule;
5. checkpoint/resume including optimizer/RNG;
6. reproducibility across at least three seeds;
7. training/validation/learning curves and error slices;
8. ablations for augmentation/norm/regularization/pretraining;
9. calibration/threshold if classification action;
10. profiler report and inference benchmark;
11. optional DDP run with scaling analysis;
12. model card/failure examples.

From-scratch companion: scalar autograd + MLP, gradient checked.

## 5. Senior system prompt

“Training time doubled after data and model grew 2×.” Discuss data pipeline,
activation/optimizer memory, compute FLOPs, sequence/resolution quadratic terms,
communication, batch/rate, profiling, checkpoint interval, distributed strategy,
cost, and quality-per-compute—not only add GPUs.

## 6. Exit checklist

- [ ] I derive backprop and shape gradients.
- [ ] I explain stable initialization/norm/optimizer/regularization.
- [ ] I calculate CNN shapes/receptive fields and vision metrics.
- [ ] I explain RNN/LSTM/attention/embeddings and complexity.
- [ ] I write/test/profile a robust framework training loop.
- [ ] I reason about mixed precision and distributed memory/communication.
- [ ] I completed the capstone and can debug its failures.

