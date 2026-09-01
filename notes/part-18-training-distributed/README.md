# Part 18 — Training Optimization and Distributed Systems

This part explains how to make large-model training numerically correct,
memory-feasible, efficient, restartable, and diagnosable. Complete Parts 13–17.

## Chapters

1. [Training numerics and optimization](01-training-optimization.md): objectives,
   SGD/AdamW and alternatives, schedules, batching, clipping, precision, stability,
   memory accounting, activation checkpointing, and efficiency.
2. [Distributed training and fault tolerance](02-distributed-training.md):
   collectives, DDP, FSDP/ZeRO, tensor/pipeline/context/expert parallelism,
   checkpointing, hangs, stragglers, and scaling.
3. [Distributed training laboratory](03-distributed-training-lab.md): correctness,
   scale, failure injection, checkpoint portability, and incident exercises.

```mermaid
flowchart LR
    ONE[Correct single-device reference] --> DP[Replicated data parallel]
    DP --> SHARD[Shard state FSDP or ZeRO]
    SHARD --> MP[Add model/context/expert dimensions only if required]
    MP --> SCALE[Measure scaling and cost]
    SCALE --> FAIL[Inject failure and restore]
```

## Exit gate

Explain global-batch and schedule accounting, mixed precision and loss scaling,
NaN diagnosis, optimizer-state memory, activation checkpointing, collective order,
DDP versus state sharding, TP/PP/CP/EP communication, strong/weak scaling,
distributed checkpoint completeness/resharding, and coordinated failure handling.

