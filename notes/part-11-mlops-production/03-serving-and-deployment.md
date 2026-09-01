# Chapter 3 — Inference Serving and Deployment

## 1. Serving modes

| Mode | Use | Strength | Risk |
|---|---|---|---|
| offline batch | periodic scores | throughput/simple/retry | stale |
| online sync | request decision | fresh/interactive | latency/availability |
| async queue | long work | decouple/retry | delayed/duplicate/order |
| streaming | event updates/predictions | near-real-time | state/late/replay |
| on-device/edge | privacy/offline/latency | local | constrained/update/fleet |

Hybrid precomputes heavy embeddings/candidates then online reranks.

## 2. Inference request path

```text
edge/auth -> validation/admission -> feature/context fetch -> preprocess
-> model queue/batch -> inference -> postprocess/calibration/policy
-> response/action log
```

Budget p99 for every segment and dependency. Deadline propagation prevents work
continuing after caller timed out.

## 3. Capacity estimates

Given peak QPS λ, average service time W, concurrency L≈λW. Add burst/headroom and
tail. Throughput per replica measured at representative batch/input mix. Required
replicas roughly:

> replicas ≥ peak throughput demand / sustainable per-replica throughput

Then account for utilization target, zone failure, rollout, cold starts.

GPU capacity often batch/token/sequence dependent; report TTFT/decode separately.

## 4. Batching

- static client batch;
- server dynamic batch waits small window/max size;
- continuous batching for autoregressive.

Trade throughput versus queue latency/fairness/memory. Bucket similar shapes/lengths
to reduce padding. Bound batch and reject/route oversized requests.

## 5. Model server lifecycle

1. download artifact via authenticated checksum;
2. load preprocessing/model;
3. validate signature/test vector;
4. warm kernels/caches;
5. become ready;
6. serve with telemetry;
7. on termination fail readiness, drain, close.

Liveness should detect deadlock, not transient dependency outage. Readiness includes
model loaded and critical local state.

## 6. CPU versus GPU/accelerator

CPU good small models/low QPS/irregular logic; GPU high parallel batch/large nets;
special accelerators depend ops/runtime. Total cost affected by utilization and
idle overprovision. Benchmark real p99 and cost per successful task.

Feature fetch/preprocess/network can dominate accelerator.

## 7. Serialization/runtime

Options native framework, exported graph/interchange, optimized compiler/runtime,
custom kernels. Validate supported ops/dynamic shapes/numerical parity. Model
serialization is code/supply-chain boundary; load only trusted signed artifacts.

Runtime upgrade needs compatibility suite and can change floating behavior.

## 8. Optimization

- quantization;
- pruning/sparsity;
- distillation;
- graph compilation/fusion;
- batch/cache;
- input resolution/sequence limits;
- early exit/cascade;
- approximate retrieval;
- precompute.

For each compare model/task/slice/calibration/safety, p50/p99, throughput, memory,
cost, cold start. Optimize end-to-end.

## 9. Autoscaling

Signals:

- CPU/GPU utilization;
- request concurrency/QPS;
- queue depth/age;
- latency;
- tokens/sec;
- custom model saturation.

Utilization can be misleading: GPU memory full but compute low, or queue grows while
CPU low due dependency. Scale ahead for slow model load; minimum warm replicas;
rate/admission control. Avoid oscillation with stabilization.

## 10. Caching

- feature cache;
- model result cache for deterministic public inputs;
- embedding cache;
- prefix/KV cache;
- candidate cache.

Key includes model/preprocess/policy/user/tenant/permissions/time-dependent context.
TTL/invalidation, privacy, staleness, stampede, size, hit rate. Do not cache unsafe
personal response across identities.

## 11. Reliability patterns

- timeouts and deadline;
- bounded retries with jitter only idempotent;
- circuit breaker;
- bulkheads/resource quotas;
- load shedding/admission;
- fallback model/rules/cache/default/human;
- multi-zone/region;
- idempotent action logging;
- graceful degradation.

Fallback evaluated and monitored; an unused stale fallback can be worse than fail.

## 12. Deployment strategies

### Shadow

Mirror traffic no action; validate compatibility/latency/distribution/cost.

### Canary

Small exposure; operational risk control. Define ramp gates/hold/rollback.

### A/B

Randomized experiment for product causal effect; assignment unit and logging.

### Blue–green

Parallel environments and routing switch; rapid rollback, double capacity.

### Champion/challenger

Parallel model comparison; actions may remain champion.

## 13. Compatibility dimensions

- request/response schema;
- feature definitions/availability;
- preprocessing/tokenizer;
- model runtime/hardware;
- calibration/threshold/policy;
- downstream consumer expectations;
- log/metric names;
- saved state/cache/index.

Roll out coordinated or backward-compatible versions. Test N/N−1 combinations.

## 14. Rollback

Keep last-known-good immutable artifact/config and compatible features. Rollback
trigger, authority, automated/manual, time objective, data/state migration. If new
feature pipeline changed irreversibly, model rollback alone may fail.

## 15. On-device ML

- size/memory/compute/battery;
- quantization/operator support;
- device fragmentation;
- privacy/local data;
- offline behavior;
- signed OTA rollout, staged cohorts;
- telemetry with consent;
- rollback/version skew;
- adversarial extraction/tampering.

Personalization/federated learning adds aggregation/privacy/security complexity.

## 16. Exercises

1. Capacity-plan online model at peak QPS and zone loss.
2. Tune dynamic batching with tail SLA.
3. Design safe feature/model version migration.
4. Load test fallback/circuit breaker/dependency outage.
5. Compare API, self-host GPU, batch, and on-device cost/risks.

