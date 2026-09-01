# Strict Coverage Audit: Beginner to Advanced AI/ML Engineering

## 1. Audit conclusion

The original twelve parts form a strong general AI/ML, production, and interview
curriculum. They are sufficient to build sound fundamentals and production-shaped
projects. They are **not, by themselves, a complete preparation for frontier-scale
foundation-model research or infrastructure**. Frontier work adds distributed
accelerator programming, large-model data systems, low-precision numerics,
multi-dimensional parallelism, post-training at scale, research methodology, and
specialized inference systems.

Numbered [Parts 13–23](README.md#all-parts) close those major curriculum gaps.
“Complete” here means broad professional coverage with explicit
depth targets and projects. It does not mean one person has mastered every research
specialty or every vendor tool; frontier labs employ specialists in algorithms,
data, systems, hardware, evaluation, safety, robotics, biology, and other domains.

## 2. Audit standard

Each area was graded at four levels:

| Level | Evidence required |
|---|---|
| Foundation | Can define the idea and work a small example |
| Implementation | Can implement, test, profile, and debug it |
| Production | Can operate it under scale, reliability, security, and cost constraints |
| Frontier | Can read the primary literature, reproduce results, design ablations, and improve the system at large scale |

A keyword mention does not count as coverage. A covered topic should explain:

- what problem it solves;
- its underlying mechanism or formula;
- assumptions and invariants;
- implementation and operational choices;
- failure modes and diagnostics;
- alternatives and trade-offs;
- an exercise or artifact proving understanding.

## 3. Coverage matrix after Parts 13–23

| Competency | Parts 1–12 | Advanced numbered Parts | Expected final depth |
|---|---|---|---|
| Math, probability, statistics, optimization | Parts 2, 5, 7 | Parts 17–18: scaling and training numerics | implementation/frontier foundation |
| Python, SQL, DSA, APIs, testing | Part 3 | research code and performance workflow | production |
| Git and collaborative research workflow | Part 3 overview | Part 13: general Git, internals, collaboration, recovery, run lineage | production |
| Linux, containers, Docker | Parts 3 and 14 Chapters 1–5 | Part 14: systems/OCI/build/runtime/GPU/security | production |
| Kubernetes and Slurm | Parts 11 and 14 Chapters 6–7 | Part 14 Chapters 8–9: ML jobs and incidents | implementation/production |
| Data processing and governance | Parts 4 and 11 | Part 16: foundation-model corpus pipeline | production/frontier foundation |
| Classical and deep ML | Parts 5–7 | Parts 15, 17–18: performance/architecture/training | implementation |
| Transformers and LLMs | Part 8 | Parts 17–19: architecture, scale, and post-training | frontier foundation |
| Vision, multimodal, diffusion | Part 9 | Parts 16–17: multimodal data and scaling interfaces | implementation/frontier foundation |
| Reinforcement learning | Part 10 | Part 20: tabular/deep/offline/model-based/safe/LM RL | implementation/frontier foundation |
| Pretraining and optimization | Parts 7–8 | Part 18: objectives, numerics, optimizers, stability | frontier foundation |
| Distributed training | brief in Part 7 | Part 18: DDP, FSDP/ZeRO, TP, PP, CP, EP | implementation/production |
| Fine-tuning and post-training | Part 8 | Part 19: full FT, PEFT, SFT, RM, DPO, PPO, GRPO, RLAIF | implementation/frontier foundation |
| Inference optimization | Parts 8 and 11 | Parts 15 and 21: kernels, KV systems, serving engines | production/frontier foundation |
| MLOps and platform engineering | Part 11 | Parts 13–14, 18, 21, and 23 | production |
| Evaluation, safety, and security | Parts 8, 11, 12 | Part 22: measurement, red teams, release gates | production/frontier foundation |
| ML system design and leadership | Part 12 | Part 23: technology selection and capstone defense | senior |

## 4. What advanced and frontier-role readiness actually means

There is no single frontier-model role. Target one primary track and maintain working
literacy in adjacent tracks.

### Research scientist

Primary evidence:

- deep mathematical command in a specialty;
- novel hypotheses grounded in literature;
- rigorous experiments, ablations, and uncertainty analysis;
- publication-quality communication;
- ability to identify why a result is surprising or invalid.

Usually requires deeper graduate study beyond this repository in the chosen area.

### Research engineer

Primary evidence:

- faithful and efficient implementation of papers;
- clean experimental systems and reproducibility;
- strong PyTorch or JAX plus distributed training;
- profiling and numerical debugging;
- high-throughput data/evaluation pipelines;
- rapid iteration without sacrificing correctness.

### Training/infrastructure engineer

Primary evidence:

- accelerator, networking, storage, and collective-communication understanding;
- multi-dimensional parallelism and distributed checkpointing;
- schedulers, containers, observability, recovery, capacity, and cost;
- diagnosis of hangs, stragglers, OOMs, silent corruption, and low utilization;
- safe platform APIs used by many research teams.

### Post-training/alignment engineer

Primary evidence:

- high-quality demonstration, preference, critique, and verifier data;
- reward modeling and preference/RL objectives;
- rollout systems and inference-training synchronization;
- capability, safety, calibration, and reward-hacking evaluation;
- human-feedback operations and policy literacy.

### Inference/reliability engineer

Primary evidence:

- prefill/decode performance, KV-cache math, scheduling, and distributed serving;
- quantization, compilation, kernels, batching, routing, and capacity planning;
- latency/throughput/cost measurement under realistic workloads;
- fallbacks, overload protection, isolation, and incident response.

## 5. Technologies: learn categories before brands

Tools change faster than principles. Learn at least one tool deeply per category,
then understand alternatives well enough to migrate.

| Category | Representative technologies | Durable concept |
|---|---|---|
| Source control | Git, Git LFS, code-review platforms | snapshots, DAGs, review, artifact separation |
| Environments | uv/pip, Conda, Poetry, Nix | dependency resolution, lockfiles, reproducibility |
| Containers | Docker/BuildKit, OCI, Compose, containerd | immutable layers, namespaces, cgroups, provenance |
| Cluster scheduler | Slurm, Kubernetes Jobs, Volcano/Kueue | allocation, gang scheduling, quota, preemption |
| Training framework | PyTorch, JAX/XLA, TensorFlow | autograd, compilation, sharding, kernels |
| Large-model training | PyTorch FSDP, TorchTitan, DeepSpeed, Megatron Core, NeMo | parallelism and state placement |
| Distributed runtime | NCCL/RCCL, Gloo, MPI, Ray | collectives, rendezvous, elasticity, task graphs |
| Data | Parquet/Arrow, object storage, Spark, Ray Data, Kafka, Iceberg/Delta | partitioning, streaming, snapshots, lineage |
| Config/orchestration | Hydra, Airflow, Dagster, Argo, Kubeflow | declarative configuration and dependency DAGs |
| Experiment tracking | MLflow, Weights & Biases, internal systems | immutable runs, lineage, comparisons, registry |
| GPU performance | CUDA, ROCm, Triton, CUTLASS, cuDNN, Nsight | memory hierarchy, tiling, fusion, occupancy |
| Model formats | `state_dict`, distributed checkpoints, safetensors, ONNX | safe/versioned portable artifacts |
| LLM training/post-training | Transformers, PEFT, TRL, OpenRLHF-style stacks | SFT, adapters, preference/RL rollouts |
| LLM serving | vLLM, SGLang, TensorRT-LLM, Triton Server, Ray Serve | continuous batching, paged KV, routing |
| Observability | OpenTelemetry, Prometheus, Grafana, DCGM | metrics/logs/traces/profiles tied to versions |

This table is not an endorsement or an exhaustive catalog. A strong engineer can
explain why a category is needed and select a tool from measured requirements.

## 6. Non-negotiable practical evidence

Reading all notes is not proof of readiness. Build these artifacts:

1. a reviewed Git repository with reproducible environment and CI;
2. a non-root, pinned, scanned GPU-capable container;
3. a single-GPU transformer training run with full diagnostics;
4. the same run under DDP and then sharded training, with scaling analysis;
5. a restartable distributed checkpoint and injected worker failure;
6. an SFT or PEFT run with data masks, ablations, and broad evaluation;
7. one preference or RL post-training experiment with reward-hacking checks;
8. an inference benchmark reporting TTFT, inter-token latency, throughput, cost,
   cache utilization, and quality under realistic arrivals;
9. a paper reproduction with confidence intervals and a failed-hypothesis log;
10. a design review explaining data rights, safety, security, and incident response.

## 7. Ruthless quality review result

The current repository contains 23 indexed Parts, topic-level references, explicit
prerequisites, Mermaid diagrams, Markdown-safe formula panels, hands-on labs,
failure injection, interview prompts, capstones, and a machine audit for broken
local links, unbalanced fences/MathML, and non-rendering TeX delimiters. Git,
Linux/Docker/Kubernetes/Slurm, RL, distributed training, post-training, inference,
evaluation, safety, and technology selection now have dedicated numbered Parts.

The review deliberately does **not** award completeness for keyword mentions. A
chapter is useful only when the learner can explain mechanism, calculate/derive,
implement or operate, diagnose failure, compare alternatives, and produce an
artifact. Each advanced Part therefore includes an exit gate or a concrete lab.

## 8. Honest limitations

No static notes can guarantee employment at a frontier lab. Readiness also depends
on demonstrated originality, code quality, collaboration, domain depth, access to
compute, and the role’s current needs. Hardware and software evolve quickly; verify
version-specific APIs in official documentation before operating a real cluster.

Parts 13–23 intentionally teach stable mechanisms and use named tools as
concrete implementations. It marks experimental techniques as such and avoids
claiming that a newer method universally replaces a well-understood baseline.

“All relevant technologies” cannot literally mean every library or proprietary
internal platform. The technology reference covers the major durable categories
and representative tools; version-specific APIs must be checked in official
documentation at the time of use. Completeness is defined by transferable concepts,
selection criteria, failure modes, and the ability to learn or replace a tool—not
by an unbounded catalog of brand names.
