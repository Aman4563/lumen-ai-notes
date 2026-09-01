# Chapter 2 — Distributed Training and Fault Tolerance

## 1. Why distribute

Distribution solves one or more constraints:

- model state does not fit one device;
- activations for desired batch/sequence do not fit;
- one device is too slow for the training deadline;
- data preprocessing/checkpoint/evaluation need more throughput.

It adds communication, synchronization, failure modes, nondeterminism, and
operational cost. Use the smallest topology that meets the requirement.

## 2. Process and rank vocabulary

- world size: number of participating processes in a group;
- global rank: unique process index;
- local rank: device/process index on one node;
- process group: subset participating in collectives;
- rendezvous: workers discover membership and communication endpoints;
- backend: NCCL/RCCL/Gloo/MPI-like implementation;
- device mesh: multidimensional arrangement used to describe sharding groups.

Common GPU model: one process per device. Set the device from local rank before
allocating model tensors or initializing incompatible state.

## 3. Collective operations

### Broadcast

One rank sends the same tensor to all ranks.

### All-reduce

Reduce (often sum) values and distribute result to all. DDP uses it for gradients.

### Reduce-scatter

Reduce values then leave each rank one shard. Useful for sharded gradients.

### All-gather

Gather shards from every rank so each receives the full logical tensor.

### All-to-all

Each rank sends distinct partitions to all ranks. Expert routing often uses it.

### Point-to-point

Send/receive between ranks, central to pipeline stages.

Communication time depends on latency α, bytes n, bandwidth β, topology, and
algorithm. A rough message model is **time ≈ α + n ÷ β**, multiplied/modified by
collective steps and contention. Small messages are latency-sensitive; large ones
are bandwidth-sensitive.

## 4. Data Parallel (DP)

Replicate full model/optimizer on every rank; each processes a different microbatch.
After backward, average/sum gradients so ranks apply identical updates.

If rank r has nᵣ valid tokens and gradient of its local mean gᵣ, the true global
token mean is:

> **global gradient = [Σᵣ nᵣgᵣ] ÷ [Σᵣ nᵣ]**

A simple equal-rank average is wrong when valid-token counts differ unless loss
scaling compensates.

### DDP mechanics

Framework DDP registers autograd hooks, groups gradients into buckets, launches
all-reduce as gradients become ready, and can overlap communication with remaining
backward compute.

Performance/correctness concerns:

- parameter order and bucket size affect overlap;
- unused/dynamic parameters can cause hangs or extra graph traversal;
- accumulation should avoid all-reduce on intermediate microbatches;
- batch normalization may need synchronized statistics or replacement;
- distributed sampler must shard and reseed correctly;
- every rank must execute collectives in compatible order.

## 5. Strong and weak scaling

- **Strong scaling:** fixed global problem/batch, more devices; ideal time shrinks.
- **Weak scaling:** per-device problem fixed, global problem grows; ideal time stays.

> **scaling efficiency from N to kN ≈ time(N) ÷ [k × time(kN)]**

for strong scaling under consistent work. Report changes in global batch, optimizer
steps, sequence padding, and convergence; faster steps do not guarantee faster time
to quality.

## 6. State sharding: ZeRO and FSDP

Data-parallel redundancy includes optimizer states, gradients, and parameters.
Common conceptual stages:

| Stage | Sharded across DP ranks | Main consequence |
|---|---|---|
| ZeRO-1 | optimizer states | less optimizer memory |
| ZeRO-2 | optimizer states + gradients | less state/gradient memory |
| ZeRO-3 / full sharding | optimizer + gradients + parameters | largest saving, more parameter gathers |

FSDP-style full sharding stores parameter shards outside computation, all-gathers
needed parameters before a module’s forward/backward, and reduce-scatters gradients.
Wrapping/grouping granularity controls peak memory, collective size, and overlap.

### FSDP2 concept

Modern PyTorch `fully_shard` uses distributed tensors and per-parameter sharding.
Exact APIs evolve. Understand:

- bottom-up sharding of module groups;
- reshard-after-forward policy;
- mixed-precision policy;
- CPU/offload policy;
- device mesh for pure or hybrid sharding;
- distributed state-dict/checkpoint APIs.

Do not mix a tutorial for one FSDP generation with another API without checking the
installed version.

## 7. Hybrid sharded data parallelism

Shard within a fast local group and replicate across groups, or vice versa. This
reduces expensive cross-node all-gather while retaining some memory savings. Choose
groups from physical topology and failure/throughput measurements.

## 8. Tensor Parallelism (TP)

Split individual matrix operations/model dimensions across ranks.

For Y = XW, column-parallel W splits output columns; each rank computes a shard of Y.
Row-parallel W splits input rows and typically requires reduction of partial outputs.
Transformer blocks pair layouts to reduce redundant communication.

TP helps when a layer/activation does not fit one device or matrix is large enough
to utilize local high-bandwidth links. It introduces collective communication inside
every layer, making topology critical. Excessive TP across slow nodes can be worse
than sharding/PP.

## 9. Sequence parallelism

Shard certain activations/operations along sequence dimension, often alongside TP,
to reduce replicated activation memory for norms/dropout/residual-related work.
Exact meaning differs among frameworks; distinguish it from context parallelism and
document which tensors/ops are sharded.

## 10. Pipeline Parallelism (PP)

Partition layers into stages; microbatches flow through them.

With p stages and m microbatches, a simple schedule has fill/drain bubbles. A rough
idealized bubble fraction for basic scheduling is related to:

> **(p − 1) ÷ (m + p − 1)**

Actual training includes forward/backward scheduling, recomputation, imbalance,
communication, and optimizer synchronization.

Schedules include all-forward-then-backward, 1F1B, interleaved/virtual stages, and
zero-bubble-like variants. Key problems:

- balanced layer/compute/memory partition;
- activation send/receive and dtype;
- microbatch count versus memory/latency;
- tied/shared parameters across stages;
- deterministic schedule and loss on last stage;
- checkpoint mapping after repartition.

## 11. Context Parallelism (CP)

Shard a long sequence/context across ranks while computing attention through
ring/all-gather-like K/V exchange or specialized algorithms. It reduces per-rank
activation/attention memory but adds communication proportional to long-context
work.

Validate causal masks, position offsets, variable sequence lengths, packed document
boundaries, and attention backend. CP is useful when sequence length—not layer
width—is the memory bottleneck.

## 12. Expert Parallelism (EP)

Distribute MoE experts across ranks. The router assigns tokens, then all-to-all
dispatches tokens to expert owners and returns outputs.

Concerns:

- token-count imbalance/stragglers;
- capacity and dropped/rerouted tokens;
- variable-size versus padded exchange;
- routing determinism and auxiliary loss;
- expert/data/tensor group composition;
- topology and all-to-all contention;
- expert checkpoint placement and elastic world-size changes.

## 13. Composing parallel dimensions

For one common decomposition:

> **world size = DP × TP × PP × CP × EP**

Not every factor is independent; framework layouts may fold/overlap dimensions,
especially expert-data groups. Use a device mesh and list each process group.

Selection heuristic:

1. use DP while model/optimizer fits and communication scales;
2. add full/hybrid sharding for model-state memory;
3. add TP when individual layers/activations require it, preferably within node;
4. add PP for depth/model partition and node-scale growth;
5. add CP for long context;
6. add EP for MoE experts;
7. benchmark combinations because communication interactions dominate.

This is guidance, not a fixed order for every topology.

## 14. DeepSpeed, Megatron Core, TorchTitan, and JAX

- **DeepSpeed:** ZeRO/sharding, offload, pipeline and training utilities through a
  configuration-driven runtime.
- **Megatron Core:** optimized transformer building blocks with tensor, pipeline,
  sequence, context, expert, and data parallelism.
- **PyTorch FSDP/TorchTitan-style stack:** composable PyTorch-native sharding,
  tensor parallel, checkpoint, and compiler work.
- **JAX/XLA:** logical device meshes, array sharding, compiler transformations,
  and collectives.

Frameworks implement overlapping mechanisms with different state formats and
constraints. Choose from architecture scale, team ability, hardware, kernels,
debugging, checkpoint portability, and measured efficiency—not feature count.

## 15. Distributed checkpointing

A complete training checkpoint includes:

- model parameters and buffers;
- optimizer moments and parameter groups;
- scheduler/update counters;
- gradient scaler/precision metadata;
- RNG state per rank/device;
- sampler/data cursor/mixture state;
- architecture/tokenizer/config versions;
- parallel layout and tensor metadata;
- training statistics needed for exact logic;
- checksum and completion manifest.

### Save protocol

1. establish a coordinated logical step;
2. write shards to a new versioned temporary prefix;
3. include per-shard checksum/shape/dtype/rank metadata;
4. ensure all ranks succeed;
5. publish a small final manifest atomically/transactionally;
6. asynchronously clean older versions according to retention only after restore
   validation.

A directory’s existence is not proof that checkpoint is complete.

## 16. Resharding and portability

Saving rank-local pickles tied to world size makes future restore difficult.
Distributed checkpoint formats describe global tensors and placements so tools can
restore under a different DP/sharding layout where supported.

Test:

- same world-size resume;
- changed DP world size;
- inference/export without optimizer;
- architecture-compatible migration;
- partial/corrupt/missing shard detection;
- restore on a fresh cluster/image.

## 17. Fault tolerance

Failure sources:

- process/node/GPU/link failure;
- collective timeout or rank crash;
- preemption/maintenance;
- storage throttling/corruption;
- data shard/parser failure;
- NaN divergence;
- control-plane/scheduler outage.

Recovery time:

> **lost work ≈ checkpoint interval ÷ 2 on average**

plus save and restart time under simple random-failure assumptions. More frequent
checkpointing reduces lost compute but adds I/O/synchronization. Optimize expected
cost using observed failure and checkpoint performance.

Elastic membership is difficult for sharded/model-parallel layouts. Restarting the
whole gang from a valid checkpoint is often simpler and safer.

## 18. Detecting hangs

If ranks execute different collective order, the program can deadlock. Diagnostics:

- per-rank last step/operation/collective and stack dump;
- distributed debug logs and collective timeouts;
- compare data-loader exhaustion and conditional branches;
- verify all ranks see same config/world/process groups;
- isolate communication using collective benchmark;
- inspect network interface/topology and hardware errors;
- identify original failing rank rather than only ranks timing out later.

Never place a collective inside rank-dependent condition unless all ranks in the
group execute compatible communication.

## 19. Stragglers

Synchronous step time is determined by the slowest rank. Causes:

- uneven token/sequence/expert work;
- slow data/object-store shard;
- CPU contention or NUMA mismatch;
- thermal/power/hardware error;
- topology or network contention;
- checkpoint/logging performed by one critical rank;
- allocator fragmentation or kernel fallback;
- another tenant/noisy node.

Log per-rank phase durations and compare distributions. An average-only dashboard
hides stragglers.

## 20. Distributed correctness tests

- one-device and multi-device parameter updates match within expected tolerance;
- global loss/metrics use correct weighting;
- sampler coverage/disjointness and resume;
- accumulation equals equivalent larger batch under controlled layers;
- sharded full state reconstructs the reference;
- collective order works with empty/variable microbatches;
- shared/tied parameters remain synchronized;
- checkpoint round-trip across world sizes;
- injected rank failure terminates all workers and resumes;
- no silent use of the same GPU by multiple unintended ranks.

## 21. Capacity and efficiency experiment

For each topology, report:

| Metric | Why |
|---|---|
| max model/microbatch/sequence | feasibility |
| tokens/s and step p50/p95 | throughput/variance |
| peak memory by rank | imbalance/headroom |
| forward/backward/optimizer/collective time | bottleneck |
| checkpoint save/load time | recovery |
| model FLOPs utilization assumption | compute use |
| validation curve versus tokens/time | time to quality |
| cost/energy estimate | operational decision |

Warm up and benchmark a representative window. Do not compare topologies that use
different effective objectives or data.

## 22. Practical labs

1. Implement gradient averaging with raw collectives; verify against single device.
2. Train the same model under DDP and FSDP/full sharding; compare state memory.
3. Implement toy column/row tensor-parallel linear layers.
4. Simulate pipeline schedules and measure bubble/imbalance.
5. Save distributed checkpoint, change DP world size, and restore if supported.
6. Inject a rank exception and write a hang/recovery runbook.

## 23. Primary references

- [PyTorch distributed](https://docs.pytorch.org/docs/stable/distributed.html)
- [PyTorch FSDP2 `fully_shard`](https://docs.pytorch.org/docs/main/distributed.fsdp.fully_shard.html)
- [DeepSpeed ZeRO](https://deepspeed.readthedocs.io/en/stable/zero3.html)
- [Megatron Core parallelism guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/parallelism-guide.html)
- [JAX distributed arrays and sharding](https://docs.jax.dev/en/latest/notebooks/explicit-sharding.html)

Parallelism APIs evolve rapidly; verify versioned official examples before a large
allocation.
