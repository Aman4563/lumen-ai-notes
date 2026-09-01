# Chapter 5 — Linux, Git, APIs, Concurrency, and Containers

## 1. Linux process model

Know files, processes, signals, environment, permissions, pipes, sockets, and
resource limits.

### Processes

- PID/parent PID;
- exit status: 0 success by convention, nonzero failure;
- stdout/stderr as separate streams;
- current working directory;
- environment variables inherited at process creation;
- file descriptors for files/pipes/sockets;
- signal handling and graceful shutdown.

For a model server receiving SIGTERM:

1. stop accepting new traffic or fail readiness;
2. finish/cancel bounded in-flight work;
3. flush safe telemetry;
4. close resources;
5. exit before orchestration kill deadline.

Do not place secrets in command arguments/logs. Environment variables are
convenient but can leak; use a secret manager and least-privilege identities.

## 2. Files and permissions

- read/write/execute for owner, group, others;
- directories need execute permission to traverse;
- symlinks reference paths and can create traversal/security issues;
- atomic rename can publish a completed local artifact;
- file locks and atomicity vary across local/network filesystems.

Write artifacts to a temporary file, fsync when durability truly matters, validate,
then atomically rename within the same filesystem. Object stores have different
semantics; use versioned immutable objects/manifests.

## 3. Shell principles

Quote variables and paths. Pipelines connect stdout to stdin; by default some
shells report only last command status unless configured. Avoid parsing human-
formatted output when structured formats exist.

Useful diagnostics:

- `ps`, `top`/`htop`: processes/resources;
- `lsof`: open files/sockets;
- `df`, `du`: filesystem usage;
- `free`/platform tools: memory;
- `curl`: HTTP behavior;
- `ss`/`netstat`: sockets;
- `time`: duration/resources;
- `rg`: fast text search;
- logs/metrics/traces specific to runtime.

Understand a command before running it against production paths.

## 4. Git mental model

Git stores commits: immutable snapshots with parent links, metadata, and tree.
Branches are movable references to commits; HEAD indicates current reference/
commit. The working tree, index/staging area, and repository are distinct.

```text
working tree --git add--> index --git commit--> repository history
```

Core workflow:

- inspect `status` and diff;
- make focused changes;
- stage intentionally;
- commit coherent unit with reason;
- rebase/merge according to team policy;
- resolve conflicts semantically and rerun tests;
- review final diff before push/PR.

Never commit secrets, huge raw datasets, or generated model artifacts to ordinary
Git. Removing a secret from latest file does not remove history; rotate it.

### Merge versus rebase

- merge preserves branch topology and creates merge commit when needed;
- rebase replays commits on new base, rewriting their IDs.

Do not rebase shared public history without coordination. Neither resolves semantic
conflicts automatically.

## 5. Networking foundations

### Layers relevant to services

- DNS maps names to addresses.
- TCP provides ordered reliable byte stream with connection/flow/congestion costs.
- TLS authenticates/encrypts transport.
- HTTP defines request/response semantics over transport.
- Load balancers route traffic and health-check instances.

Latency includes DNS/connect/TLS, queue, application, dependencies, serialization,
and network return. Reuse connections and bound timeouts.

### HTTP semantics

Methods conventionally:

- GET retrieve, safe/idempotent;
- POST create/action, not inherently idempotent;
- PUT replace at URI, idempotent;
- PATCH partial update;
- DELETE idempotent in desired final state, though response can differ.

Status categories: 2xx success, 4xx client/contract/auth issue, 5xx server failure.
Do not return 200 with hidden error payload.

## 6. API design for inference

Example contract:

```json
{
  "request_id": "...",
  "model": "fraud-v3",
  "instances": [
    {"amount_cents": 1200, "merchant_id": "m-17"}
  ]
}
```

Response:

```json
{
  "request_id": "...",
  "model_version": "fraud-v3.4.1",
  "predictions": [
    {"risk": 0.083, "quality": "complete"}
  ]
}
```

Design:

- version contract and artifact independently;
- validate types, ranges, batch size, unknown fields policy;
- define units and missing/default semantics;
- bound payload/time/resource use;
- include idempotency key for consequential actions, not just prediction;
- distinguish retryable failures;
- avoid leaking internal model/security details;
- return trace/request/model versions;
- authenticate and authorize at boundary.

### REST versus gRPC

- REST/JSON: ubiquitous, inspectable, browser/tool friendly, larger payload and
  weaker generated contracts unless schemas enforced.
- gRPC/Protobuf: typed contracts, efficient binary, streaming, generated clients;
  operational/browser compatibility considerations.

Choose based on ecosystem, latency, evolution, and debugging—not fashion.

## 7. Timeouts, retries, and idempotency

Every remote call needs timeout within end-to-end deadline. Retrying multiplies
load and can cause retry storms.

Retry only transient/idempotent operations with:

- exponential backoff;
- jitter;
- maximum attempts/time budget;
- circuit breaking/load shedding;
- request deadline propagation.

A prediction read can usually retry safely. A “charge customer” action needs an
idempotency key and durable deduplication.

## 8. Concurrency and parallelism

- Concurrency: tasks make overlapping progress.
- Parallelism: tasks execute simultaneously.

### Race condition

Outcome depends on timing of unsynchronized accesses. `counter += 1` is a read-
modify-write sequence, not a language-independent atomic guarantee.

### Synchronization

- mutex/lock: exclusive critical section;
- read–write lock: concurrent readers;
- semaphore: bounded concurrency;
- condition variable/event: wait for state;
- queue/channel: message passing;
- atomic operations: limited hardware/runtime primitives.

Avoid holding locks over network/disk calls. Define lock order to avoid deadlock.

### Deadlock conditions

Mutual exclusion, hold-and-wait, no preemption, circular wait. Break at least one,
commonly via global lock ordering or avoiding nested locks.

### Async I/O

An event loop runs tasks until they await. Good for many network-bound operations.
CPU-heavy code blocks the loop; offload to process/native executor with bounded
queues. Cancellation and deadlines must clean resources.

### Backpressure

When arrival rate exceeds service rate, queues grow and latency/memory explode.
Use bounded queues, admission control, batching, load shedding, and autoscaling.
Little’s Law: average in-flight L = throughput λ × average time W.

## 9. Caching

Cache improves latency/cost but creates staleness and consistency trade-offs.

Define:

- key includes all behavior-affecting inputs/version/tenant;
- value size and serialization;
- TTL/freshness;
- invalidation;
- capacity/eviction;
- stampede prevention;
- negative caching;
- privacy/tenant isolation;
- failure behavior.

Never cache personalized model responses under a key omitting authorization/user
context. “Cache invalidation” is a product correctness problem.

## 10. Containers

A container image packages application filesystem/config metadata; containers
share host kernel and are not lightweight VMs in every security sense.

Good image practices:

- small trusted pinned base image/digest;
- multi-stage build;
- non-root user;
- no build secrets in layers;
- reproducible dependencies;
- `.dockerignore` excludes data/secrets;
- read-only filesystem where possible;
- explicit health/readiness behavior;
- resource requests/limits;
- vulnerability scanning and provenance/SBOM.

### Image layers

Build cache depends on instruction/context. Copy dependency manifests before source
to cache installs, but ensure lockfile changes invalidate. Deleting a secret in a
later layer does not erase earlier layer.

## 11. Orchestration concepts

- deployment controls replicas/rollouts;
- service provides discovery/load balancing;
- readiness: can receive traffic;
- liveness: process stuck and should restart;
- startup probe: slow initialization allowance;
- job: finite batch task;
- autoscaler: reacts to CPU/custom/queue metrics;
- requests/limits guide scheduling/enforcement.

A model-loading pod should not be ready until artifact validation/warmup complete.
Liveness should not restart a healthy process because a dependency is temporarily
down. Graceful termination must fit rollout deadline.

## 12. Security fundamentals

- authenticate identity; authorize every resource/action;
- least privilege and short-lived credentials;
- validate untrusted input and encode output by context;
- parameterize SQL; never concatenate user input;
- secure dependencies and artifact supply chain;
- encrypt transport/storage where required;
- rate-limit and bound compute/payload;
- separate tenants and environments;
- log security-relevant actions without sensitive payload;
- patch, rotate, revoke, and test incident response.

Model files, prompts, retrieved documents, and generated output are untrusted data.

## 13. SDE design habits

For any component, specify:

```text
contract -> state -> concurrency -> failure -> retry/idempotency
-> scalability -> observability -> security -> evolution
```

At SDE-III, include ownership, migration, operational burden, capacity estimates,
and how multiple teams adopt the interface safely.

## 14. Exercises

### Beginner

1. Explain process, thread, file descriptor, and signal.
2. Trace working tree/index/commit through a Git workflow.
3. Define REST request/response validation and status codes.
4. Containerize a small read-only prediction API as non-root.

### Intermediate

1. Implement bounded async fan-out with deadline and cancellation.
2. Add idempotency to a write/action endpoint.
3. Design a versioned cache key and stampede protection.
4. Diagnose readiness/liveness misconfiguration during model loading.

### Advanced/interview

1. Capacity-plan an inference service including tail latency and backpressure.
2. Explain a distributed retry storm and layered timeout budgets.
3. Design artifact rollout with provenance, canary, and rollback.
4. Threat-model a multi-tenant LLM/RAG API.

