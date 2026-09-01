# Chapter 5 — PyTorch, Hardware, and Distributed Training

## 1. Tensor fundamentals

A tensor has shape, dtype, device, layout/strides, gradient flag, storage/view.

```python
import torch

x = torch.randn(32, 128, device="cuda", dtype=torch.float32)
assert x.shape == (32, 128)
assert x.is_contiguous()
```

Moving device/dtype creates operations/copies. Avoid per-batch synchronizing calls
such as frequent `.item()` in hot path.

## 2. Autograd

Operations on `requires_grad` tensors build dynamic graph. `loss.backward()`
accumulates gradients into leaf `.grad`.

```python
optimizer.zero_grad(set_to_none=True)
logits = model(inputs)
loss = criterion(logits, targets)
loss.backward()
optimizer.step()
```

Use `torch.no_grad()` or inference mode for evaluation. Detach when intentionally
breaking graph. Do not mutate `.data`; it bypasses autograd safety.

## 3. Module design

```python
class MLP(torch.nn.Module):
    def __init__(self, in_dim: int, hidden: int, classes: int):
        super().__init__()
        self.network = torch.nn.Sequential(
            torch.nn.Linear(in_dim, hidden),
            torch.nn.ReLU(),
            torch.nn.Linear(hidden, classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.ndim != 2:
            raise ValueError(f"expected [batch, features], got {tuple(x.shape)}")
        return self.network(x)
```

Store submodules in `ModuleList`/`ModuleDict`/attributes so parameters register.
Buffers (`register_buffer`) hold non-parameter state that moves/saves with model.

## 4. Dataset and DataLoader

- map-style: `__len__`, `__getitem__`;
- iterable-style: stream/shard manually;
- collate function creates batch/padding/masks;
- sampler controls order/distribution.

With multiple workers, avoid duplicated iterable stream; shard by worker and
distributed rank. Seed worker randomness. Persistent workers/prefetch/pinned memory
can improve throughput; profile.

## 5. Reference training structure

```python
def train_epoch(model, loader, optimizer, scaler, device, accumulation=1):
    model.train()
    optimizer.zero_grad(set_to_none=True)
    total_loss = 0.0
    seen = 0

    for step, (inputs, targets) in enumerate(loader):
        inputs = inputs.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        with torch.autocast(device_type=device.type, enabled=scaler is not None):
            logits = model(inputs)
            raw_loss = torch.nn.functional.cross_entropy(logits, targets)
            loss = raw_loss / accumulation

        if scaler is None:
            loss.backward()
        else:
            scaler.scale(loss).backward()

        should_step = (step + 1) % accumulation == 0 or step + 1 == len(loader)
        if should_step:
            if scaler is None:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
            else:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
            optimizer.zero_grad(set_to_none=True)

        batch = targets.shape[0]
        total_loss += float(raw_loss.detach()) * batch
        seen += batch

    return total_loss / seen
```

Production code handles distributed reductions, variable/token weighting,
non-finite checks, scheduler units, checkpoints, and interruptions. `len(loader)`
may not exist for iterable datasets.

## 6. Evaluation

```python
@torch.inference_mode()
def evaluate(model, loader, device):
    model.eval()
    # Accumulate sufficient counts/predictions carefully.
```

Do not average per-batch averages equally when batch sizes differ; weight by
examples/tokens or accumulate numerator/denominator. Distributed metrics must
reduce sufficient statistics; some metrics require gathering/ranking with memory.

## 7. CPU/GPU execution model

GPU kernels launch asynchronously from CPU. Timing without synchronization is
wrong. Use framework events/profiler/warmup.

GPU strengths: massively parallel regular numeric work. Bottlenecks:

- host-to-device transfer;
- small kernels/launch overhead;
- memory bandwidth;
- low occupancy;
- synchronization;
- dynamic shapes;
- data loader;
- inter-device communication.

Arithmetic intensity = operations per byte moved. Matrix multiplication benefits
from reuse; elementwise chains often memory-bound and benefit from fusion.

## 8. Memory accounting

Memory includes:

- parameters;
- gradients;
- optimizer states;
- activations/saved tensors;
- temporary workspace;
- allocator cache/fragmentation;
- batch/input/output;
- communication buffers.

Peak may occur in backward. Remedies:

- smaller microbatch/sequence/resolution;
- mixed precision;
- gradient checkpointing;
- memory-efficient attention;
- optimizer/state sharding;
- activation offload;
- avoid retained graphs/references;
- efficient layouts/in-place only when safe.

## 9. Profiling

Separate:

- data wait;
- forward;
- backward;
- optimizer;
- communication;
- evaluation/checkpoint;
- CPU overhead.

Profile representative warm workload, inspect traces and utilization, change one
bottleneck, remeasure end-to-end including tail and quality.

## 10. Compilation and graph capture

Compiler can fuse ops/select kernels/reduce Python overhead. Dynamic shapes,
data-dependent control, unsupported ops, mutation, and graph breaks reduce gain.
Validate numerical equivalence, compile warmup, cache, memory, and failure fallback.

## 11. Data parallelism

Replicate model on each device; split batch; compute gradients; all-reduce average;
each optimizer updates identically.

Communication roughly parameter gradient volume per step, overlapped with backward
when buckets ready. Scaling efficiency limited by communication, input, batch
size, imbalance, stragglers.

Correctness:

- one process/device common;
- distributed sampler and epoch seed;
- global metric reduction;
- only one rank writes checkpoint/log or coordinates;
- BatchNorm stats handling;
- effective batch/rate schedule;
- failure/restart.

## 12. Model parallelism

### Tensor parallel

Shard matrix operations within layers. Requires frequent collective communication;
helps layers too large for one device.

### Pipeline parallel

Place layer stages on devices and schedule microbatches. Pipeline bubbles reduce
utilization; activation communication and schedule complexity.

### Sequence/context parallel

Shard sequence dimension/attention computation for long contexts.

### Expert parallel

Mixture-of-experts routes tokens to expert shards; all-to-all, load balancing,
capacity/drop, and routing stability.

Hybrid 3D parallel combines data/tensor/pipeline. Choose based on model, memory,
network topology, batch/sequence, operational maturity.

## 13. Sharded data parallel (ZeRO/FSDP concepts)

Shard optimizer states, gradients, and possibly parameters across data-parallel
ranks, gathering parameters for compute. Reduces per-device memory at communication
and implementation/checkpoint complexity.

Checkpoint may be sharded; resharding across world sizes needs supported format.
Saving full state can OOM rank 0.

## 14. Distributed failure modes

- one rank OOM/hangs and all collective waits;
- mismatched collective call/order due conditional branch;
- duplicated/missing data;
- straggler from skew/corrupt sample;
- network timeout;
- nondeterministic resume;
- checkpoint partial/corrupt;
- rank-local metrics mistaken global;
- gradient accumulation sync every microstep unnecessarily.

Use timeouts, health telemetry per rank, elastic restart where suitable, atomic
checkpoints, deterministic sampler state, and reproducible small-scale test.

## 15. Inference optimization preview

- eval/inference mode;
- batch/dynamic batching;
- compile/optimized runtime;
- mixed/low precision;
- quantization;
- pruning/distillation;
- caching;
- async pipeline/overlap;
- smaller inputs/early exit/cascade.

Optimization must preserve task/slice/calibration/safety within tolerances. Benchmark
p50/p99 across realistic request shapes, not peak synthetic throughput only.

## 16. Exercises

1. Implement/train/evaluate an MLP with deterministic fixture.
2. Diagnose unregistered parameters and accumulated gradients.
3. Profile input versus GPU bottleneck.
4. Estimate training memory for Adam with fp16 parameters/fp32 states.
5. Scale DDP 1→8 devices and explain efficiency loss.

