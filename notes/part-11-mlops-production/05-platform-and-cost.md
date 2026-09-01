# Chapter 5 — ML Platforms, Distributed Systems, Security, and Cost

## 1. Platform goal

Enable product teams to build/deploy safe ML faster with paved paths and escape
hatches. Optimize developer lead time and system reliability, not tool count.

## 2. Platform capabilities

- identity/access/secrets;
- data discovery/contracts/lineage;
- feature computation/store;
- experiment tracking/artifacts/registry;
- training compute/orchestration;
- evaluation/gates;
- serving/deployment;
- monitoring/incident;
- cost/quota/governance;
- templates/SDK/CLI/UI/docs/support.

Build incrementally from repeated needs. Avoid monolith coupling every team.

## 3. Control plane versus data plane

- Control plane: APIs/metadata/scheduling/deploy config/registry/policy.
- Data plane: actual data movement, training compute, inference traffic.

Control plane can tolerate different latency but must be durable/auditable. Data
plane needs throughput/isolation. Outage behavior: existing inference may continue
if control plane down; no unsafe new rollout.

## 4. Multi-tenancy

- authentication/authorization;
- namespaces/projects;
- storage/network/compute isolation;
- quotas and fair scheduling;
- secrets/service identities;
- noisy neighbor protection;
- cost attribution;
- audit;
- tenant-specific encryption/residency.

Shared GPU/serving raises side-channel/cache/data leak. Stronger isolation costs
utilization; classify workloads.

## 5. Metadata architecture

Entities: project, dataset, feature, run, artifact, model, deployment, prediction
schema, monitor, owner. Need immutable IDs, versions, relationships, lifecycle,
search, RBAC, audit.

Metadata database should not store huge artifacts; object store holds content with
checksums. Events update lineage/index asynchronously with reconciliation.

## 6. Distributed data processing

Concepts:

- partitioning/sharding;
- map/filter/aggregate/join;
- shuffle network/disk;
- skew/hot keys;
- serialization;
- lineage/retry;
- checkpoint;
- batch/stream.

Wide transformations shuffle; pre-aggregate/filter, partition keys, salt hot keys,
broadcast small tables. Measure spill and task stragglers.

## 7. Storage choices

- object store: cheap durable immutable large artifacts/data;
- warehouse/lakehouse: analytical tables/snapshots;
- relational DB: metadata/transactions;
- key-value: online features/cache;
- vector/search index: retrieval;
- streaming log: ordered partitioned events.

Choose consistency, latency, query, size, update, retention. Avoid one database for
everything.

## 8. Consistency

Strong consistency, eventual, snapshot; CAP trade under partition context.

ML examples:

- model alias update must be atomic;
- online features tolerate bounded staleness depending risk;
- prediction log at-least-once with dedupe;
- training snapshot consistent across tables;
- index deletion propagation eventual with privacy SLA.

State exact guarantee and user consequence.

## 9. Queues and delivery

- at-most-once: loss possible, no retry duplication;
- at-least-once: retry, duplicates; idempotency;
- exactly-once: scoped processing semantics, not end-to-end side effect automatically.

Ordering typically per partition/key, not global. Backpressure and dead-letter
queues/quarantine need replay/version policy.

## 10. Scheduling GPUs

- requests/limits and topology;
- exclusive/shared/MIG-like partitions;
- gang scheduling distributed;
- queues/priorities/preemption;
- fragmentation/bin packing;
- warm pools/image/artifact locality;
- quota/fairness;
- utilization telemetry.

Small jobs can be packed; untrusted/high-memory need isolation. Preemption works
only with checkpoint economics.

## 11. Reliability architecture

- multi-zone services and durable stores;
- regional routing/data residency;
- stateless control APIs where possible;
- leader election carefully;
- backup/restore tested;
- disaster recovery RPO/RTO;
- dependency deadlines/circuit breakers;
- degraded modes;
- schema/migration compatibility;
- capacity and game days.

RPO = acceptable data loss interval; RTO = recovery time target.

## 12. Security architecture

- workload identity, no static broad keys;
- least privilege per pipeline/model/tool;
- network segmentation/egress controls;
- encryption and KMS;
- secret manager/rotation;
- artifact signing/SBOM/scanning;
- input/model serialization safety;
- tenant/row/attribute permissions;
- audit/tamper resistance;
- privacy retention/deletion;
- incident/revocation.

Threats: malicious model artifact, poisoned data, dependency, notebook exfiltration,
prompt injection, public bucket, overprivileged training job, cross-tenant cache.

## 13. Policy as code

Automate enforceable rules:

- allowed data regions/sensitivity;
- required evaluation/model card;
- artifact signatures;
- deployment approvals;
- resource quotas;
- forbidden public endpoints;
- retention.

Policy versioned, testable, explainable, override with accountable audit/emergency.

## 14. Cost model

Total:

```text
data ingestion/storage/query + labeling + experiments/training
+ artifact/index + serving idle/active + network
+ monitoring/logs + human review + engineering/on-call + incidents
```

Unit economics:

- cost per training run / successful model;
- cost per 1k predictions/tokens/images;
- cost per successful task/incremental KPI;
- utilization and idle share;
- cost by tenant/team/model.

Optimization:

- right-size/autoscale/schedule;
- cache/batch/precompute;
- spot with checkpoint;
- quantize/distill/router;
- data lifecycle/column pruning;
- experiment early stopping;
- quotas/budgets/alerts;
- delete unused endpoints/artifacts.

Do not optimize compute while ignoring engineering/harm cost.

## 15. Platform API design

Paved workflow example:

```text
define dataset/feature -> train job spec -> tracked run
-> evaluation contract -> registered artifact -> deployment spec
-> standard metrics/runbook
```

Use declarative desired state and controllers/reconciliation. Stable API versions,
backward compatibility/migration, SDK thin over API, escape hatch for custom images.

## 16. Developer experience and adoption

- quickstart and golden templates;
- local/staging parity;
- actionable errors;
- discoverable lineage/search;
- sane defaults with rationale;
- documentation/examples;
- support/SLO;
- migration tooling;
- measure lead time, success, incident, adoption, not vanity signups.

Platform forcing extra complexity without value drives bypass/shadow systems.

## 17. Build versus buy

Evaluate differentiating requirements, integration, scale, security/compliance,
operations staff, lock-in/egress, reliability/SLA, extensibility, total cost,
migration. Buy commodity pieces; build domain workflow/control where strategic,
but avoid broad slogans.

## 18. Exercises

1. Draw control/data plane and failure behavior.
2. Design multi-tenant registry/serving isolation.
3. Resolve GPU scheduling fairness/fragmentation.
4. Create cost allocation and optimization plan.
5. Design platform migration from team-specific scripts.

