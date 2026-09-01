# Chapter 7 — NLP/LLM Interview Workbook

## 1. Rapid answers

### Why subword tokenization?

Balances vocabulary size and sequence length, handles rare/morphological words and
open vocabulary. Tokenization cost varies by language/domain and affects context,
latency, fairness.

### Why transformer over RNN?

Self-attention gives direct token interactions and parallel training, better long-
range paths; costs O(L²) attention and large memory. RNN streams constant state and
linear sequence but sequential training/long dependency limits.

### Encoder versus decoder model?

Encoder bidirectional representations, efficient classification/retrieval. Decoder
causal next-token generation. Encoder–decoder source encoding + causal generation/
cross-attention. Choose task/latency/training ecosystem.

### RAG versus fine-tuning?

RAG for dynamic/private/source-grounded facts with index/permission complexity.
Fine-tuning for behavior/style/task adaptation with data/training/maintenance and
not a reliable frequently changing knowledge database. Can combine.

### Temperature versus top-p?

Temperature rescales all logits; top-p truncates to adaptive cumulative mass.
Both alter sampling, not underlying factual knowledge.

### What is KV cache?

Stored key/value projections for previous tokens/layers during autoregressive
decode, avoiding recomputation. Memory grows with batch/context/layers/KV heads;
isolation and paging matter.

### How prevent prompt injection?

Cannot rely on prompt. Treat retrieved/user/tool content untrusted; deterministic
auth, least-privilege tools/secrets, schema validation, sandbox, allowlists, approval,
isolation, monitoring, adversarial tests.

### How evaluate RAG?

Decompose ingestion, retrieval recall/rank, rerank/context coverage, generation
correctness/grounding/citations/abstention, ACL/security, latency/cost; representative
gold queries and end-to-end online validation.

## 2. Derivations/calculations

1. Multi-head Q/K/V tensor shapes and score memory.
2. Why attention scale √d<sub>head</sub>.
3. Transformer parameter estimate.
4. KV cache bytes for layers/context/KV heads/head dim/dtype/batch.
5. Causal LM factorization and shifted loss mask.
6. Perplexity from average token NLL.
7. LoRA trainable parameter count for target matrices.
8. BM25/RRF/hybrid ranking on toy docs.

## 3. System prompts

### Design enterprise RAG

Clarify users/sources/ACL/freshness/task/scale. Cover connectors, parsing, versions,
chunks, sparse+dense, metadata ACL, rerank, context, citations/abstain, injection,
tenant isolation, deletion, eval, latency/cost, rollout/monitoring.

### Design coding agent

Repository sandbox, read/write/exec tools, patch/diff, tests, network/secrets, user
approval for destructive/external actions, context/index, loop/budget, idempotency,
traces, prompt injection from repo, evaluation on real tasks.

### Model latency doubled

Split queue/TTFT/decode, input/output distribution, batching, cache memory/hits,
model/adapter/quantization, GPU utilization, retrieval/tool, provider, compile,
network, errors/retries. Mitigate safely with rollback/routing/bounds.

### Fine-tuned model worse on general queries

Data mixture/quality/narrow style, catastrophic forgetting, too high rate/epochs,
template/tokenizer, evaluation mismatch, PEFT modules, preference overoptimization.
Rebalance/replay, regularize, lower update, route adapter, and rerun broad eval.

## 4. Part 8 capstone

Build a permission-aware document support assistant.

### Required

1. problem/non-goals/user/action/threat model;
2. versioned source ingestion with parsing/ACL/deletion;
3. sparse baseline + dense + hybrid retrieval;
4. chunking/reranking ablations;
5. context with untrusted-data separation;
6. grounded answer with source-version citations/abstention;
7. 200+ case eval: retrieval, claims, unanswerable, multilingual, injection, ACL;
8. deterministic/tool/LLM/human evaluator calibration;
9. structured traces, redaction, tokens/latency/cost;
10. shadow/canary/rollback/monitoring/runbook.

### Agent extension

Add one read-only tool and one consequential tool. The consequential tool requires
typed validation, idempotency, scoped authorization, preview, human approval, and
receipt verification. Inject timeouts/duplicates/malicious results.

### Fine-tuning extension

Only after error analysis: build SFT/LoRA candidate for a stable behavior category,
compare against prompt/RAG baseline on broad + targeted eval, include memory/cost/
operational adapter analysis.

## 5. Senior interview rubric

| Dimension | Weak | Strong |
|---|---|---|
| Framing | “use LLM” | task/action/non-goals/risk/baseline |
| Knowledge | prompt only | source freshness/ACL/retrieval/citation |
| Evaluation | subjective demos | representative layers, gold, uncertainty, online |
| Security | “system prompt” | deterministic auth/isolation/tools/approval |
| Reliability | retries | deadlines/idempotency/fallback/kill switch/runbook |
| Scale | model name | token/KV/batch/latency/cost estimates |
| Evolution | final diagram | baseline→staged rollout→measured complexity |

## 6. Exit checklist

- [ ] I understand classical NLP/tokenization and strong baselines.
- [ ] I derive transformer attention/shapes/complexity.
- [ ] I explain pretraining/SFT/PEFT/preferences/quantization/decoding.
- [ ] I design and evaluate RAG component by component.
- [ ] I build bounded tool/agent workflows with real security controls.
- [ ] I create calibrated LLM/human/deterministic evaluations.
- [ ] I completed the capstone and red-team tests.

