# Chapter 1 — High-Performance Inference and Serving

## 1. Serving objective

Model serving is constrained multi-objective scheduling:

> **maximize successful useful work per unit cost**
>
> subject to latency, availability, quality, safety, privacy, and fairness SLOs.

Peak tokens/s alone is not a product metric. A system can maximize throughput by
delaying requests into huge batches and violate user latency.

## 2. Workload specification

Before choosing an engine, measure:

- request arrival process, average/peak rate, burstiness;
- input/output token distributions and correlations;
- model/adapter mix and tenant mix;
- streaming versus batch/offline;
- cancellation, timeout, and retry behavior;
- context reuse/prefix patterns;
- structured/tool/multimodal outputs;
- quality/sampling settings;
- latency SLO by request class;
- hardware, power, and cost constraints.

A benchmark with fixed short prompts cannot predict a production workload dominated
by long-context prefill or variable reasoning outputs.

## 3. Latency metrics

- **queue time:** admission to scheduled execution;
- **time to first token (TTFT):** request arrival to first streamed token;
- **time per output token (TPOT):** average incremental decode interval;
- **inter-token latency (ITL):** distribution of intervals;
- **end-to-end latency:** arrival to completed response;
- **tokens/s:** input, output, or combined—state which;
- **requests/s:** completion throughput;
- **goodput:** requests meeting SLO/quality contract per time.

Report p50/p95/p99 and by input/output/model/tenant slice. An average hides queue
collapse and long requests.

## 4. Queueing fundamentals

Little’s Law for stable system:

> **average in-flight requests = arrival rate × average time in system**

As utilization approaches saturation, queues/tail latency can rise sharply. Keep
headroom for bursts, failures, and length uncertainty. Use admission control,
bounded queues, quotas, cancellation, and load shedding before memory exhaustion.

Open-loop load generation preserves an external arrival rate; closed-loop clients
wait for responses and can hide overload by reducing offered traffic.

## 5. Prefill versus decode

### Prefill

Processes prompt tokens in parallel, builds KV cache, and uses relatively large
matrix operations. Often compute-intensive; TTFT grows with prompt length, queue,
and chunking.

### Decode

Generates one token per active sequence per step. Reuses KV cache but reads model
weights/cache repeatedly; small/ragged matrices and memory bandwidth often dominate.
TPOT grows with context, active batch, model size, communication, and sampling.

The same hardware/config may not optimize both. Some systems separate prefill and
decode pools, paying KV transfer/routing complexity.

## 6. KV-cache accounting

For a decoder with L layers, B active sequences, S cached tokens, Hkv KV heads,
head dimension D, and b bytes/element:

> **KV bytes ≈ 2 × L × B × S × Hkv × D × b**

Factor 2 is keys plus values. Real usage includes block metadata, fragmentation,
alignment, speculative branches, beam copies, and other workspace. GQA/MQA reduce
Hkv relative to query heads.

Capacity planning should use the distribution of active cached tokens, not only
maximum context × maximum batch.

## 7. Static versus continuous batching

### Static batching

Collect a batch, pad, run until all complete. Simple but short sequences wait for
long ones; freed slots are unused.

### Continuous/in-flight batching

At iteration boundaries, remove completed/cancelled sequences and admit new work.
Improves utilization under variable outputs, but introduces scheduling, cache,
fairness, and reproducibility complexity.

Scheduler policy considers:

- maximum tokens/sequences per step;
- prefill versus decode priority;
- tenant/class weights and starvation;
- deadline and age;
- cache memory and fragmentation;
- adapters/models that can batch together;
- cancellation and preemption;
- speculative/constrained decoding state.

## 8. Paged KV-cache management

Contiguous allocation per maximum sequence wastes memory and fragments under
variable lengths. PagedAttention-style systems divide KV into blocks/pages and map
logical sequence positions to noncontiguous physical blocks, similar to virtual
memory.

Benefits:

- allocate as sequence grows;
- reduce external fragmentation;
- share prefix blocks with copy-on-write semantics;
- free completed/cancelled blocks quickly;
- support more active sequences.

Costs:

- page tables/indirection;
- block-size trade-off between internal fragmentation and metadata/kernel access;
- eviction/offload and consistency complexity;
- privacy/isolation requirements for reused blocks.

## 9. Prefix caching

Cache KV for repeated exact token prefixes such as system prompts or shared
documents.

Cache key must include:

- model and weight revision;
- adapter;
- exact token IDs and position/attention semantics;
- dtype/quantization/cache layout;
- tenant/authorization scope and data version;
- generation features that affect prefix state.

Avoid cross-tenant private prefix sharing and timing side channels. Invalidate on
permission/document deletion. A semantic-equivalent string is not necessarily an
identical token prefix.

## 10. Chunked prefill and scheduling fairness

One huge prompt can monopolize a batch and delay decode tokens for interactive
requests. Chunked prefill divides prompt processing across scheduling iterations,
allowing interleaving with decode. It can reduce tail latency but add overhead and
complicate attention/cache kernels.

Set workload-class budgets: interactive chat, long-context analysis, batch jobs,
and RL rollouts have different SLOs. Global FIFO is rarely fair or efficient.

## 11. Speculative decoding

A cheaper draft proposes k tokens; target evaluates them in parallel and accepts a
prefix using a correction procedure that preserves the target distribution for the
specified sampling algorithm.

Speed depends on:

- draft acceptance rate;
- draft and target cost;
- number of proposed tokens;
- batch/context and hardware utilization;
- verification kernel/scheduling;
- extra KV/cache memory;
- tokenizer/vocabulary compatibility.

Variants use a smaller model, early-exit/self-draft heads, n-grams/retrieval, or
multiple candidate trees. Incorrect “accept if argmax matches” can change sampling
distribution. Validate output distribution and quality.

## 12. Quantization for inference

### Dimensions of a quantization scheme

- weights only versus weights and activations/KV;
- bit width/format: FP8, INT8, INT4, other floating/integer formats;
- per-tensor/channel/group/block scales;
- symmetric/asymmetric and zero points;
- static calibration versus dynamic scaling;
- post-training versus quantization-aware training;
- dequantization/fused kernel availability.

Approximate affine quantization:

> **q = clamp(round(x ÷ scale) + zero_point)**
>
> **x̂ = scale(q − zero_point)**

### Named method categories

- GPTQ-like: layerwise post-training weight quantization using reconstruction/
  second-order approximations;
- AWQ-like: protect/smooth salient activation-weight channels using calibration;
- smooth-quantization approaches move activation difficulty into weights;
- QAT simulates quantization during training;
- weight-only formats reduce model bandwidth but activations/KV remain.

Tool names and formats are not interchangeable. A checkpoint format needs a kernel
that efficiently consumes it on target hardware.

### Quality evaluation

Test perplexity plus downstream, code/math, rare languages, calibration, long
context, safety/refusal, tool JSON, and generation stability. Quantization errors
can be highly nonuniform even if average loss changes little.

## 13. Pruning, sparsity, and distillation

- unstructured weight sparsity needs hardware/kernel support;
- N:M structured sparsity maps to specific units but constrains pattern;
- structured head/channel/layer pruning changes model shape;
- dynamic activation/expert sparsity saves compute with routing/irregularity;
- distillation trains a smaller model and often gives the most portable speedup.

Report realized end-to-end latency and quality. A sparse tensor file is not evidence
of hardware speedup.

## 14. Compilation and model formats

### Framework compilation

`torch.compile`/XLA-style systems fuse and specialize graphs. Dynamic generation,
changing shapes, custom ops, and sampling can create graph breaks/recompilation.

### ONNX and graph interchange

Can represent portable inference graphs, but transformer custom ops/dynamic cache/
generation loops may require extensions. Validate semantic parity.

### TensorRT-style engines

Build hardware/shape/precision-optimized engines with fused kernels and tactic
selection. High performance but hardware/version/build-time compatibility and
engine lifecycle matter.

### Safe weight formats

Prefer non-executable tensor formats when possible. Loading arbitrary pickle/model
code is a code-execution boundary. Verify artifact signatures/checksums and isolate
untrusted models.

## 15. Distributed inference

### Replica/data parallel

Each replica holds full model and serves different requests. Scales throughput when
model fits.

### Tensor parallel

Shards layers across GPUs; adds collectives per layer. Often needed when weights/KV
or target latency require multiple accelerators.

### Pipeline parallel

Splits layers; can improve capacity/throughput with microbatches but adds stage
latency/bubbles and complicates continuous scheduling.

### Expert parallel

Distributes MoE experts with all-to-all routing. Serving traffic imbalance and small
batch sizes challenge utilization; elastic expert placement/replication may help.

### Disaggregated prefill/decode

Separate pools tuned for each phase and transfer KV/state. Can improve independent
scaling/isolation but network transfer, cache layout, routing, failure, and queueing
may negate gains. Measure end-to-end.

## 16. Serving engine landscape

### vLLM

High-throughput LLM engine associated with PagedAttention, continuous batching,
distributed serving, quantization, and OpenAI-compatible APIs.

### SGLang

Serving/runtime focused on structured LM programs, prefix reuse/RadixAttention-like
cache management, multi-GPU and multimodal workloads.

### TensorRT-LLM

NVIDIA-focused optimized engines/runtime with in-flight batching, paged KV,
quantization, and multi-GPU features.

### Triton Inference Server

Multi-framework model serving, scheduling/batching, ensembles, metrics, and model
repository concepts; distinct from the Triton kernel language.

### Ray Serve

General distributed Python serving/composition/autoscaling, often orchestrating
models and preprocessing; an LLM kernel engine may run inside it.

Other stacks include TGI, llama.cpp/CPU-edge runtimes, cloud provider endpoints,
and internal engines. Benchmark exact versions on target hardware/workload.

## 17. API and gateway

Separate:

- authentication/authorization/quota;
- request validation and token budget;
- model/adapter/routing policy;
- safety/moderation and tool permissions;
- inference engine;
- streaming transport and cancellation;
- usage/accounting/audit;
- fallback/retry/idempotency.

An OpenAI-compatible API shape does not make backend semantics identical. Document
tokenizer, limits, sampling, deterministic seed guarantees, error codes, and model
revision.

## 18. Model routing and cascades

Route easy/low-risk tasks to smaller models and escalate uncertain/complex cases.
Router features must be available cheaply and must not leak protected information.

Evaluate:

- end-to-end task quality, not router accuracy alone;
- escalation/coverage curve;
- false-cheap decisions by high-risk slice;
- router and model latency/cost;
- distribution shift and feedback;
- fallback when large model unavailable.

Routing based on the smaller model’s calibrated confidence can fail for generation;
learned or verifier-based gates require independent evaluation.

## 19. Autoscaling and capacity

CPU-style utilization autoscaling is insufficient when model load takes minutes and
GPU memory determines concurrency. Signals:

- queued tokens and request age;
- active sequences/cache occupancy;
- prefill/decode tokens scheduled;
- TTFT/TPOT SLO risk;
- model/adapter load state;
- per-replica health and GPU saturation;
- predicted arrival/length.

Use minimum warm capacity, predictive scaling, admission control, and class-based
queues. Scale-down must drain or migrate safely; killing long generation wastes work
and harms users.

## 20. Reliability and degradation

Fallback ladder may include:

1. full model and target context;
2. smaller/quantized model;
3. reduced optional context or retrieval depth;
4. deterministic/search/template response;
5. explicit unavailable/async completion.

Do not bypass safety, authorization, or required evidence to meet availability.

Protect against:

- retry storms and duplicate generation;
- queue/memory overload;
- poisoned/unhealthy replica;
- partial streams and client disconnects;
- bad model rollout;
- KV corruption/cross-request leak;
- adapter/model mismatch;
- tokenizer/prompt-template mismatch;
- region/provider outage.

## 21. Observability

Per request/aggregate, with privacy controls:

- request/tenant/model/adapter/prompt-template/tokenizer versions;
- input/output/cached tokens;
- queue, TTFT, ITL/TPOT, end-to-end;
- scheduler batch size/tokens and cache blocks/hit/eviction;
- GPU memory/utilization/power, kernel/collective time;
- finish reason, cancellation, timeout, retry/fallback;
- safety/routing/tool/retrieval outcome;
- cost and SLO class;
- sampled quality/task success linked to evaluator version.

Avoid logging raw sensitive prompts by default. Use structured redacted traces and
authorized replay fixtures.

## 22. Benchmark methodology

1. freeze model, weights, tokenizer, engine/config, hardware, power/clocks;
2. use representative input/output/arrival/model/adapter distribution;
3. warm model, compiler, and caches;
4. measure open-loop offered load across increasing rates;
5. report throughput versus TTFT/TPOT/tail, failures, and SLO goodput;
6. include cancellation and long-context cases;
7. compare output/quality parity;
8. measure energy/cost and idle capacity;
9. repeat and report variance;
10. keep raw traces/config for reproduction.

Do not compare one engine at greedy short output with another at sampled long output.

## 23. Security and multi-tenancy

- isolate KV/prefix/cache and adapters by authorization scope;
- rate-limit tokens and tool calls to prevent denial-of-wallet;
- validate structured outputs before downstream use;
- sandbox model/tool code and untrusted artifacts;
- prevent prompt/log/cache cross-tenant leakage;
- encrypt traffic/storage and use workload identity;
- restrict admin/model-load endpoints;
- sign/scan images and artifacts;
- test model extraction, membership inference, timing side channels;
- audit consequential requests and approvals.

## 24. Practical labs

1. Calculate KV capacity for MHA/GQA and validate against engine metrics.
2. Benchmark static versus continuous batching under variable lengths.
3. Compare BF16, weight-only low-bit, and FP8/INT8 option where hardware supports;
   include quality suites.
4. Run vLLM, SGLang, or TensorRT-LLM-like engine and produce open-loop curves.
5. Implement admission control/fallback and inject a slow/failed replica.
6. Design a secure multi-tenant prefix cache and threat model.

## 25. Primary references

- [vLLM project and documentation](https://vllm.ai/)
- [PagedAttention/vLLM paper](https://arxiv.org/abs/2309.06180)
- [SGLang documentation](https://docs.sglang.io/)
- [NVIDIA TensorRT-LLM documentation](https://docs.nvidia.com/tensorrt-llm/)
- [Ray Serve documentation](https://docs.ray.io/en/latest/serve/)

Serving engines change quickly. Always record exact version, build flags, kernels,
driver, and model format in benchmark conclusions.
