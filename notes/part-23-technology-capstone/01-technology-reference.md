# Chapter 1 — AI/ML Technology Reference and Selection Guide

## 1. How to read this chapter

This is a decision map, not a requirement to install everything. For each category:

1. learn the durable mechanism;
2. use one representative tool deeply;
3. understand two alternatives and their trade-offs;
4. record exact versions for real experiments;
5. measure against your workload before standardizing.

Tool availability and APIs change. The project’s official documentation and release
notes are authoritative for version-specific behavior.

## 2. Programming languages

### Python

Primary language for model/data research because of PyTorch, JAX, NumPy, scientific,
and orchestration ecosystems. Weaknesses include interpreter overhead, packaging,
dynamic typing, and concurrency constraints. Move hot loops into vectorized/compiled
kernels rather than rewriting an entire research stack prematurely.

### C++

Used for framework/runtime internals, low-latency serving, custom operators, and
systems components. Requires careful ownership, ABI/build, concurrency, and memory
safety. A Python binding does not eliminate C++ failure modes.

### CUDA C++ / Triton

Used for accelerator kernels. CUDA offers low-level control and mature libraries;
Triton provides block-level language/compiler abstractions for many tensor kernels.
Both require numerical and hardware-aware validation.

### Rust

Useful for safe high-performance services, tokenizers, data tools, and sandboxes.
ML framework/kernels ecosystem may be smaller for some tasks. Choose where safety
and predictable systems behavior justify integration cost.

### Bash/shell

Good for thin launch/composition scripts; poor for complex state and data parsing.
Use strict error handling, quote paths, avoid secrets in arguments, and move durable
logic into tested programs.

## 3. Python environment and packaging

| Tool/category | Best use | Watch for |
|---|---|---|
| `venv` | lightweight standard isolation | no resolver/lock workflow by itself |
| pip | universal package installer | requirements input is not always a complete lock |
| uv | fast resolver/installer/workspace workflows | lock/export semantics and platform markers |
| Poetry/PDM-like | project metadata, lock, publishing | interoperability and workflow policy |
| Conda/Mamba | Python plus native/binary environment | channel mixing, solver and image duplication |
| Nix-like | broad declarative system environments | learning curve and accelerator integration |
| `pyproject.toml` | standardized build/project/tool config | tools still interpret sections differently |

Record Python, resolved packages, platform, CUDA/runtime compatibility, and container
digest. Never assume a lockfile captures the host driver or remote service.

## 4. Source, artifacts, and collaboration

| Technology | Solves | Does not solve |
|---|---|---|
| Git | source snapshots, branches, review history | large model/data storage |
| Git LFS | external storage referenced by Git pointers | lineage/registry governance automatically |
| GitHub/GitLab/Gerrit-like review | approvals, CI, discussion, policy | scientific validity |
| DVC/lakeFS-like systems | map data versions/workflows to object data | unclear data rights or semantics |
| object storage | durable scalable immutable artifacts | relational query/transactions by itself |
| model registry | versions, aliases, metadata, approvals | artifact correctness without gates |

Store code in Git, large bytes in artifact/object storage, and connect them with an
immutable experiment manifest.

## 5. Core numerical and classical ML stack

### NumPy/SciPy

Dense/sparse arrays, linear algebra, statistics, optimization, and reference
implementations. Understand shapes, broadcasting, strides, dtype, BLAS threads, and
copy/view semantics.

### pandas/Polars

Local dataframe analysis. pandas has broad ecosystem and flexible indexed semantics;
Polars emphasizes expression/lazy/parallel columnar execution. Neither is a license
to load a multi-terabyte corpus into one process.

### scikit-learn

Classical estimators, preprocessing pipelines, metrics, model selection. Excellent
baseline and tabular/small-medium workflows; not a distributed foundation-model
training framework.

### XGBoost/LightGBM/CatBoost-like boosting

Strong structured-data baselines with missing/categorical/distributed differences.
Tune leakage-safe features, class/cost objective, calibration, and serving format.

## 6. Deep-learning frameworks

### PyTorch

Dynamic/eager tensor/autograd/module system, compilers, distributed primitives, and
large ecosystem. Core technologies:

- `nn.Module`, autograd, Dataset/DataLoader;
- AMP, `torch.compile`, profiler;
- DDP, DTensor/tensor parallel, FSDP, distributed checkpoint;
- custom C++/CUDA/Triton operators.

### JAX/XLA

Functional array transformations such as JIT, automatic differentiation,
vectorization, and device sharding. Explicit PRNG keys and pure-function style are
central. XLA compilation and mesh/sharding make it strong for TPU and accelerator
research; static/dynamic shape and compile behavior require a different debugging
mindset.

### TensorFlow/Keras

Tensor/autodiff/model APIs and production ecosystem, including `tf.data`, graph
execution, distributed strategies, and TensorFlow Serving/Lite. Still relevant in
existing systems and mobile/edge. Learn enough to maintain/migrate if the target
team uses it; do not assume PyTorch model code ports automatically.

### Higher-level trainers

Lightning, Accelerate, Keras Trainer-like, and internal abstractions reduce
boilerplate. They can hide sampler, precision, accumulation, callback, and
distributed state. Understand the lower-level loop before debugging an abstraction.

## 7. Foundation-model model/data libraries

### Hugging Face Transformers

Model/config/tokenizer implementations, generation, training integrations, and hub
artifact conventions. Pin model revision and inspect remote/custom code before
trusting it.

### Datasets

Arrow-backed loading, transformations, streaming, caching, and dataset hub. Cache
identity and transformation fingerprints do not replace organizational data lineage
and permissions.

### Tokenizers/SentencePiece

Fast tokenizer runtimes and vocabulary training. Version normalization, special
tokens, and templates together with weights.

### PEFT

LoRA and other parameter-efficient adapters. Validate target modules, base revision,
merge/runtime semantics, and serving support.

### TRL and RL/post-training stacks

SFT, reward models, DPO, GRPO, PPO/RLOO-like workflows. OpenRLHF/NeMo/Ray-based and
internal stacks target larger rollouts/training. Verify the objective, masks, old/
reference log probabilities, KL, reward, and policy freshness rather than trusting
trainer names.

## 8. Large-model training frameworks

### PyTorch FSDP/TorchTitan-style stack

PyTorch-native full sharding, device meshes/tensor parallel, distributed checkpoint,
compiler/kernels, and reference large-model recipes. Good when composability with
PyTorch internals matters.

### DeepSpeed

ZeRO stages, offload, pipeline/training utilities, and configuration-driven launch.
Useful for memory scaling and established integrations. Configuration and checkpoint
conversion need disciplined versioning.

### Megatron Core / Megatron-LM

Optimized transformer components and tensor, sequence, pipeline, context, expert,
and data parallelism. Suitable for large dense/MoE training where topology-aware
performance justifies a specialized stack.

### NVIDIA NeMo

Higher-level model/data/training/post-training ecosystem integrated with Megatron
Core and NVIDIA libraries. Understand what NeMo owns versus Megatron/PyTorch/
Transformer Engine underneath.

### JAX ecosystems

Flax/Equinox-like neural modules and Orbax-like checkpointing are common alongside
XLA sharding. TPU-specific stacks vary by organization.

Selection criteria: target architecture, accelerator, parallelism, kernels,
checkpoint portability, debuggability, team expertise, and measured time to quality.

## 9. Accelerator and communication stack

| NVIDIA-oriented | AMD-oriented | Durable role |
|---|---|---|
| CUDA runtime/driver | ROCm/HIP | device programming/runtime |
| cuBLAS/cuBLASLt | rocBLAS | matrix operations |
| cuDNN | MIOpen | neural primitives |
| NCCL | RCCL | GPU collectives |
| Nsight Systems/Compute | rocprof/Omniperf-like | timeline/hardware profiling |
| Transformer Engine | hardware-specific low-precision libraries | FP8/lower transformer kernels |
| CUTLASS | composable kernel alternatives | low-level GEMM templates |

TPUs use XLA and high-bandwidth mesh collectives. CPU stacks rely on BLAS/oneDNN-
like libraries, SIMD, threading, NUMA, and quantized runtimes. Do not assume kernels,
dtypes, or checkpoint layouts transfer unchanged across accelerators.

## 10. Cluster and resource management

### Slurm

Batch/HPC scheduler: allocations, partitions/QOS/accounts, `sbatch`, `srun`, arrays,
dependencies, reservations, preemption, and accounting. Common in research clusters.

### Kubernetes

Container orchestration with Pods, Jobs, Services, controllers, device plugins,
RBAC, network/storage APIs. Distributed/gang training often needs operators and
queue controllers such as Kueue/Volcano-like systems.

### Ray

Distributed task/actor runtime with Data, Train, Tune, and Serve. Useful for Python-
native data, sweeps, distributed training orchestration, rollout generation, and
model serving. It does not replace an underlying cluster scheduler or efficient
tensor collectives.

### Cloud batch/managed ML

AWS/GCP/Azure and other providers offer object storage, GPU/TPU instances, managed
training, registries, and serving. Learn IAM, network, quota, spot/preemption,
regions, egress, storage consistency, cost allocation, and vendor lock-in.

## 11. Data systems

| Technology/category | Typical role | Main failure mode to learn |
|---|---|---|
| Arrow | in-memory columnar interchange | schema/dtype/copy assumptions |
| Parquet | columnar files | poor row-group/file sizing and partitioning |
| Spark | distributed SQL/ETL/shuffle | skew, spill, tiny files, expensive shuffle |
| Ray Data | Python/ML streaming data | backpressure, object memory, repartition |
| Kafka-like log | real-time partitioned events | duplicate/order/offset semantics |
| Iceberg/Delta-like table | snapshot metadata over object files | compaction, metadata, deletion/version policy |
| SQL warehouse | analytics/training extraction | query cost, snapshot/time/leakage |
| Redis/key-value | online cache/features | staleness, eviction, key isolation |
| vector/search engines | approximate retrieval | stale index, ACL, recall, deletion |

## 12. Workflow orchestration and configuration

### Hydra/OmegaConf-like configuration

Composable experiment configs and sweeps. Materialize resolved config, validate
types/combinations, and avoid invisible default changes.

### Airflow

Scheduled DAG orchestration centered on tasks/operators and metadata DB. Strong for
recurring batch pipelines; large data should move through external stores, not the
orchestrator database.

### Dagster/Prefect-like

Asset/data-aware or Python-native orchestration alternatives. Compare retries,
backfills, partitions, lineage, deployment, and team operations.

### Argo Workflows/Kubeflow Pipelines

Container/Kubernetes-native DAGs and ML workflows. Adds cluster-native isolation but
also CRD/controller/YAML/platform complexity.

### Terraform/Pulumi-like infrastructure as code

Provision cloud/network/storage/cluster resources. Plans/state and least privilege
matter; infrastructure code does not orchestrate each model-training step by itself.

## 13. Experiment tracking and model registries

### MLflow

Open tracking server/API, artifact logging, model packaging/registry/aliases. Needs a
durable metadata backend, artifact store, auth, backup, and organization conventions.

### Weights & Biases-like managed tracking

Metrics, artifacts, sweeps, dashboards, reports. Evaluate data/privacy, network,
retention, cost, and offline/self-host constraints.

### TensorBoard

Local/event-based scalar, histogram, graph, image, and profiler visualization. Good
debugging interface; not a complete model-governance registry.

An internal system may be appropriate at unique scale, but it still needs immutable
runs, lineage, comparison, access, retention, and reliable ingestion.

## 14. Hyperparameter search

- grid/random search;
- Bayesian optimization (Optuna-like, managed sweep services);
- Hyperband/successive halving and population-based training;
- Ray Tune or scheduler-integrated sweep controllers.

Search infrastructure must record failed/preempted trials, resource budgets,
selection metric, early-stopping bias, and final untouched evaluation. More trials
increase multiple-comparison/overfitting risk.

## 15. General model serving

### FastAPI/ASGI or gRPC

Useful API boundary for preprocessing/orchestration/small models. Python web server
is not an optimized LLM kernel scheduler.

### ONNX Runtime

Portable graph runtime across providers. Operator coverage, dynamic shapes,
quantization, and numerical parity need validation.

### TensorRT

NVIDIA inference engine builder/runtime with graph, precision, tactic, and kernel
optimizations. Engines have hardware/software/shape compatibility constraints.

### NVIDIA Triton Inference Server

Multi-framework model repository, dynamic batching, ensembles, HTTP/gRPC, metrics.
Do not confuse it with the Triton kernel language.

### KServe/Seldon/BentoML-like systems

Deployment/control-plane/model-serving abstractions over Kubernetes or containers.
Evaluate autoscaling, protocol, rollout, GPU support, observability, and operational
ownership.

## 16. LLM inference engines

| Engine | Strength to understand | Validate |
|---|---|---|
| vLLM | paged KV, continuous batching, broad model/API ecosystem | workload/version/kernel/quantization |
| SGLang | prefix/radix cache and structured/agent/multimodal runtime | cache semantics and supported hardware |
| TensorRT-LLM | NVIDIA-specialized compiled engines and kernels | build/hardware/model compatibility |
| TGI-like | packaged transformer serving and batching | model/feature/performance support |
| llama.cpp-like | CPU/edge and compact quantized formats | quality, hardware kernels, concurrency |
| Ray Serve | distributed composition/autoscaling | engine inside, queueing and failure semantics |

No engine wins every workload. Compare TTFT, TPOT, SLO goodput, memory, quality,
startup, operability, and cost under representative arrivals.

## 17. Observability

### OpenTelemetry

Vendor-neutral traces/metrics/log signals and context propagation. Define model,
run, request, and data versions as safe structured attributes.

### Prometheus/Grafana

Time-series metric scraping/query and dashboards/alerts. Control label cardinality;
request IDs and raw prompts do not belong as metric labels.

### NVIDIA DCGM or accelerator telemetry

GPU utilization, memory, power, temperature, clocks, and health/error counters.
Correlate with rank/step and framework profiler.

### Logs and profiles

Structured logs explain events; traces show distributed critical path; profiles show
CPU/kernel/collective detail. Sampling and retention must protect private data.

## 18. CI/CD and security technology

- GitHub Actions/GitLab CI/Jenkins-like systems execute gates and build artifacts;
- BuildKit builds cached/provenance-aware container images;
- OCI registries store images by digest;
- SBOM tools enumerate components;
- scanners identify known vulnerabilities/misconfiguration;
- Sigstore/cosign-like tooling signs/verifies artifacts;
- Vault/cloud KMS/secret managers issue/store sensitive material;
- OPA/Gatekeeper/Kyverno-like policy engines enforce deployment rules;
- gVisor/Firecracker/VM sandboxes strengthen isolation for untrusted code;
- seccomp/capabilities/network policies reduce runtime privilege.

Security tools are controls in a threat model, not compliance checkboxes.

## 19. Evaluation ecosystems

- custom versioned harnesses for organization tasks;
- lm-evaluation-harness/HELM-like academic capability suites;
- code sandboxes and EvalPlus/SWE-bench-like task families;
- human annotation platforms with rubrics/adjudication;
- model-based judge pipelines calibrated to experts;
- red-team generation/search and security scanners;
- experiment tracker linking evaluator and model versions.

Public benchmark tools accelerate comparison but increase contamination and narrow
optimization risks. Own a fresh private evaluation tied to real use.

## 20. Technology selection scorecard

Score each candidate 1–5 with evidence:

| Dimension | Question |
|---|---|
| Correctness | Does it preserve our objective, masks, dtypes, and outputs? |
| Performance | SLO goodput/time-to-quality on our workload? |
| Scale | Tested at needed data/model/cluster range? |
| Reliability | Failure detection, recovery, checkpoint, rollback? |
| Observability | Can we diagnose per request/rank/stage? |
| Security | Isolation, auth, supply chain, patching? |
| Portability | Hardware/cloud/model/checkpoint lock-in? |
| Ecosystem | Required model/operators/integrations? |
| Maintainability | API stability, tests, upgrades, staff expertise? |
| Cost | Compute, license, networking, storage, engineering/on-call? |

Weight dimensions by the system’s consequences. A research prototype and a
regulated production service should not make the same decision.

## 21. Minimum hands-on technology path

If starting from scratch, use one coherent stack:

1. Python, Git, `pyproject.toml`, a lockfile, pytest;
2. NumPy/pandas or Polars, SQL, Parquet/Arrow;
3. PyTorch, Transformers/Datasets, one experiment tracker;
4. Docker, object storage, Linux profiling;
5. Slurm or Kubernetes Jobs, DDP then FSDP;
6. PEFT/TRL for one SFT and DPO/GRPO-scale toy;
7. vLLM or SGLang for serving benchmark;
8. Prometheus/Grafana/OpenTelemetry-style observability;
9. CUDA/Triton and profiler for one proven bottleneck;
10. then learn JAX/XLA or a second large-model stack to gain portability.

Depth in this stack plus conceptual knowledge of alternatives is stronger than
shallow tutorials for fifty products.

## 22. Exit questions

For every tool on your résumé, answer:

1. What underlying problem and invariant does it address?
2. What did you build with it, at what scale?
3. Which measurement justified it?
4. What failed, and how did you debug it?
5. What alternative did you reject and why?
6. What version-specific limitation affected the design?
7. How would you migrate away from it?

If you cannot answer these, list the concept rather than claiming deep tool
experience.

## 23. Official starting points

- [PyTorch documentation](https://docs.pytorch.org/docs/stable/)
- [JAX documentation](https://docs.jax.dev/)
- [TensorFlow documentation](https://www.tensorflow.org/guide)
- [Hugging Face documentation](https://huggingface.co/docs)
- [Ray documentation](https://docs.ray.io/)
- [Kubernetes documentation](https://kubernetes.io/docs/)
- [Slurm documentation](https://slurm.schedmd.com/documentation.html)
- [Docker documentation](https://docs.docker.com/)
- [MLflow documentation](https://mlflow.org/docs/latest/)

Use release-specific pages and migration guides when executing commands in a real
environment.
