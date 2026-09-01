# Chapter 3 — Distributed Training Laboratory

## 1. Establish a golden reference

Begin with a deterministic tiny batch on one device in FP32. Save inputs, masks,
initial parameters, logits, loss, selected gradients, one-step updated parameters,
and checkpoint round-trip. Every distributed/precision variant must be compared to
an explicit tolerance or statistical contract.

## 2. Batch arithmetic

For data-parallel world size `W`, per-device microbatch `m`, gradient accumulation
steps `A`, and tokens/examples per sample as applicable:

> global examples per optimizer step `= W × m × A`

For variable-length packed language data, examples are misleading. Log non-padding
loss tokens per rank, accumulation, and optimizer step. If loss is normalized per
local sequence while ranks have unequal token counts, the global gradient may not
equal the intended token mean.

## 3. DDP equivalence test

Compare one-device large batch to multi-device shards of exactly the same global
batch. Check loss reduction convention (sum/mean), gradient accumulation scaling,
sampler uniqueness/order, buffer synchronization, dropout/RNG expectations, and
optimizer step count. Differences from floating reduction order are expected
within a contract; large directional differences indicate a bug.

## 4. Memory ledger

Measure rather than repeat a single bytes-per-parameter slogan:

| State | Replicated DP | Sharded strategy |
|---|---|---|
| Parameters | usually replicated | full or transiently gathered by unit |
| Gradients | replicated | reducible/scatter-sharded |
| Optimizer state | replicated | sharded |
| Activations | local batch, often dominant | affected by local batch/checkpointing |
| Temporary buffers | collectives/kernels | can spike during gather/reshard |

Track allocated and reserved device memory plus peak at phase boundaries. Fragmentation
and overlapping prefetch/gathers cause peaks that static estimates omit.

## 5. Collective microbenchmarks

Benchmark supported all-reduce, all-gather, reduce-scatter, and all-to-all across
message sizes and placements. Record topology, ranks per node, network interface,
library/runtime, algorithm settings, warm-up, and distribution of latency. Model
workloads use a range of bucket sizes, not only the largest bandwidth point.

## 6. Scaling experiment

Strong scaling holds total work fixed. Speedup and efficiency:

> `speedup(W) = T(1) / T(W)`

> `parallel efficiency(W) = speedup(W) / W`

Weak scaling grows work with workers and asks whether time remains controlled.
Report tokens/s, model FLOP utilization estimate with assumptions, cost/token,
memory, input wait, exposed communication, imbalance, and quality-equivalent
optimizer behavior.

## 7. Parallelism selection worksheet

1. Does model + optimizer + activations fit on one accelerator? Use DDP if yes and
   throughput benefits.
2. If model state is the issue, use FSDP/ZeRO-style state sharding.
3. If individual layers/operators do not fit or need more compute bandwidth, add
   tensor parallelism within fast topology.
4. If depth partitioning is useful, consider pipeline parallelism and quantify
   bubble/microbatch trade-off.
5. If sequence activations dominate, consider context/sequence parallel methods.
6. For MoE experts, add expert parallelism and all-to-all/load-balance analysis.

Every extra dimension raises configuration, communication, checkpoint, and
debugging complexity. Add it only after a measured constraint.

## 8. Hang drill

Inject one of: skipped collective, rank crash, mismatched tensor shape/count,
slow data rank, or network fault. Set finite timeouts and capture per-rank last
progress marker, stack/collective diagnostics, hostname/device/rank, and scheduler
event. Ensure peers terminate and allocation is released.

Never “fix” a hang by making the timeout infinite.

## 9. Checkpoint failure drill

Interrupt during a distributed save. A restore must reject the incomplete version.
Then publish all shards plus metadata/manifest, verify checksums, restore under a
different allowed world size, and compare the next training step with the reference
contract. Include model, optimizer, scheduler, scaler, dataloader cursor, RNG,
training counters, and format/version metadata as required.

## 10. Numerical failure drill

Create an unstable setting. Instrument first nonfinite activation/gradient,
per-layer norms, update-to-weight ratio, loss scale, logits, optimizer state, and
data batch identity. Bisect model layers/data/precision/optimizer behavior. A NaN
observed in the loss may have originated many operations earlier.

## 11. Straggler analysis

Synchronous step time follows the slowest rank. Correlate per-rank phase times with
input bytes, storage node, CPU throttling, GPU clocks/thermal/power, network path,
errors/retries, and topology. Average utilization hides tails.

## 12. Go/no-go checklist

- tiny reference/equivalence passes;
- global token/batch/schedule accounting is explicit;
- checkpoint interruption and restore pass;
- all ranks use identical immutable code/image/data/evaluator identities;
- collective benchmark is healthy for placement;
- no unexplained memory growth, NaNs, rank skew, or data duplicates;
- scaling/cost justifies added resources;
- run has stop/rollback criteria and on-call ownership.

## 13. Senior interview prompt

A 1,000-accelerator run slowed 18% after enabling longer sequences and FSDP
prefetch. Design a diagnostic plan spanning batch composition, activation/memory
peaks, gather overlap, network, allocator behavior, stragglers, checkpoint/eval
phases, and changes in actual loss tokens per step.

