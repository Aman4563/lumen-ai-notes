# Chapter 3 — Generative AI System Designs

## 1. Design a support copilot

### Goal

Help agent resolve tickets faster with grounded draft and suggested actions; human
owns consequential send/refund initially.

### Flow

1. authenticate agent/customer/tenant;
2. retrieve ticket/account/order + ACL documents;
3. classify intent/risk;
4. RAG with source citations;
5. generate structured draft/actions;
6. validate policy/facts/tool args;
7. agent edits/approves;
8. execute idempotent actions;
9. log feedback/outcome.

Metrics resolution time, edit distance/acceptance but first-contact resolution,
CSAT, incorrect action, privacy/safety. Injection in ticket/docs, least privilege.

## 2. Customer-facing support agent

Adds autonomous conversation and greater risk. Use bounded state machine, identity
verification, read-only first, action limits/approval, escalation, no unsupported
claims, citations internally/externally as appropriate, rate/abuse.

Evaluate multi-turn state, adversarial social engineering, tool partial failures,
cross-user context, refund duplication, over-refusal.

## 3. Enterprise RAG/search assistant

Part 8 architecture. Deep dive ACL at retrieval/caches/logs, source version/deletion,
hybrid/rerank, claim citations, unanswerable, index freshness. Multi-tenant region,
connector retries, poisoned docs.

## 4. Coding assistant/agent

Context:

- repository index/symbol graph/search;
- open files/diffs/tests/build/logs;
- user instructions/project rules;
- dependency/docs.

Tools:

- read/search;
- patch with diff;
- test/lint/type/build;
- sandboxed exec;
- network/package with approval;
- Git status, not destructive automatically.

Safety: repo content prompt injection, secrets, arbitrary code, destructive commands,
external PR/messages. Workspace sandbox/least privilege/user confirmation.

Eval on real repo tasks: tests + hidden tests, diff quality, regressions, steps,
cost/time, permission violations, maintainability.

## 5. Natural-language analytics

User question → semantic layer/schema retrieval → plan/SQL generation → static
validation → read-only sandbox with row/time/cost limit → result verification →
chart/explanation with query.

Security: row/column tenant permissions enforced DB identity, parameterization,
no DDL/DML, injection from schema/data, result privacy, aggregation thresholds.
Eval exact execution/result, metric semantic correctness, time grain, empty/NULL.

## 6. Document extraction

OCR/layout → document type → schema extraction constrained → evidence spans →
deterministic validation/cross-field → confidence → human review → downstream.

Do not use generation-only free text. Version schema/prompt/model. Metrics field-
level precision/recall/exact, document completion, review rate, severe field cost,
OCR/source types. Injection text in document cannot alter tool permissions.

## 7. Meeting summarizer

Audio consent → diarization/ASR → segment/chunk → topic/action extraction → summary
with timestamps → participant review/access. Errors compound. Sensitive retention,
speaker identity, cross-meeting leakage. Metrics ASR WER, speaker, factual actions/
owners/dates, omission, privacy.

## 8. Generative search

Query → retrieval/ranking → evidence synthesis with citations → source links and
traditional results fallback. Freshness, attribution, publisher ecosystem, unsafe
queries, answerability, diverse sources. Latency parallel retrieval/LLM streaming;
cache only public stable/permission-safe. Measure task success/citation/zero-click
ecosystem plus cost.

## 9. Personal assistant with memory

Memory categories and explicit consent. Store structured preferences/facts with
source/date/confidence/expiry, user view/edit/delete. Retrieval scoped identity,
never treat stored text as instruction. Tools calendar/email/payments require
separate authorization/approval/idempotency. Evaluate wrong/stale memory harm.

## 10. Content generation platform

Templates/brand context/retrieval → model routing → structured output → policy/
copyright/factual checks → human edit → publish. Provenance, customer data isolation,
prompt/version. Metrics edit acceptance/task impact, not only thumbs-up; safety,
memorization, cost/latency.

## 11. Model routing

Route by task/risk/context/latency/cost:

- deterministic template/search;
- small model;
- large model;
- specialist/fine-tuned;
- human.

Router errors can dominate. Use rules + classifier, uncertainty, fallback. Eval
quality under cost/latency constraints and avoid sending sensitive requests to
unauthorized provider.

## 12. LLM serving estimates

Inputs:

- QPS and concurrency;
- input/output token distributions;
- model parameter/quantization;
- prefill/decode throughput;
- KV cache per active token;
- batching/TTFT SLA;
- number adapters;
- replicas/headroom/failure zones.

Separate prefill and decode; continuous batching; admission max context/output;
queue deadlines; cancellation; fallback. Provider rate limit/backoff.

## 13. Safety architecture

Layered:

```text
identity/authorization -> input classification/routing
-> context permission/injection boundary -> model
-> structured validation/policy -> tool approval/execution
-> output moderation/citation -> logging/monitoring/appeal
```

No one classifier/prompt. Hard controls deterministic. Maintain red-team/eval and
incident kill switch.

## 14. Common GenAI design mistakes

- “vector DB + LLM” as complete design;
- ACL after retrieval/model;
- no golden eval/only demos;
- citations without support validation;
- prompt as security boundary;
- agent with broad credentials/no idempotency;
- retrying costly/side-effect calls blindly;
- logging full private prompts forever;
- no token/KV/cost estimate;
- fine-tuning before error taxonomy;
- no fallback/abstention/human.

