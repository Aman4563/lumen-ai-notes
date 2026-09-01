# Chapter 3 — Pretraining, Fine-tuning, Alignment, and Inference

## 1. Pretraining data pipeline

Stages:

```text
source/permission -> parse/normalize -> language/quality/safety filters
-> deduplicate/decontaminate -> mixture weights -> tokenize -> pack/shard
-> train -> evaluate contamination/memorization/capabilities
```

Key issues:

- licensing/consent/privacy/retention;
- source/author/language/domain representation;
- exact/near duplicate causing memorization/benchmark leakage;
- personally identifying/secrets;
- low-quality/generated/spam;
- temporal cutoff;
- data mixture weighting versus raw volume;
- documentation and deletion feasibility.

## 2. Packing and masking

Concatenate documents into fixed-length training sequences to reduce padding. Need:

- document boundary tokens;
- position reset or continuous policy;
- attention across documents allowed or blocked;
- loss mask for padding/control;
- no accidental cross-example leakage for tasks.

Sequence length distribution affects compute. Curriculum from shorter to longer can
improve efficiency but changes learning.

## 3. Scaling and optimization

Large LM training uses AdamW-like optimizers, warmup/decay, gradient clipping,
mixed precision, distributed sharding/parallelism. Monitor:

- token-level loss/perplexity by domain;
- gradient/parameter/update norms;
- learning rate/loss scale;
- data/sequence mix;
- tokens/sec/utilization/communication;
- non-finite/skipped steps;
- validation tasks and memorization.

Checkpoint model/optimizer/RNG/data cursor. At huge scale, replay exact order may
be difficult; design reproducibility and recovery explicitly.

## 4. Instruction tuning / supervised fine-tuning (SFT)

Train on instruction–response/chat examples with causal loss, often masking prompt
tokens so loss applies to assistant response. Choices:

- system/user/assistant template;
- multi-turn truncation;
- response quality/style/refusal;
- task mixture and oversampling;
- loss per token versus per example;
- contamination/dedup;
- safety and capability balance.

SFT teaches behavior format and task patterns; it does not reliably add factual
knowledge that was absent, and can cause catastrophic forgetting/overfit.

## 5. Full fine-tuning versus PEFT

### Full

Update all weights; maximum flexibility, high memory/compute, artifact per model,
forgetting risk.

### Adapters

Small modules inserted, base frozen. Modular but inference composition/latency.

### LoRA

Represent weight update ΔW ≈ BA with low rank r:

> W′ = W + scale · BA

Train A/B only. Reduces trainable parameters/optimizer memory; activations and base
forward still cost. Rank/target modules/scaling/dropout matter.

### QLoRA concept

Quantized frozen base with LoRA adapters and higher-precision compute states. Saves
memory, quality/runtime hardware dependent.

PEFT is not always cheaper operationally if many adapters require routing, cache,
merge/version/security.

## 6. When to prompt, retrieve, or fine-tune

| Failure | First candidate |
|---|---|
| output format/instruction unclear | prompt + schema validation |
| changing private facts | RAG/tool/database |
| consistent domain style/behavior | SFT/PEFT after eval data |
| new complex capability | data + fine-tuning/model choice; verify learnability |
| latency/cost | smaller/distilled/quantized model, prompt/context reduction |
| unsafe actions | deterministic permission/policy architecture, not fine-tune alone |

Use an error taxonomy and controlled eval to choose.

## 7. Preference data

Collect comparisons/rankings/rubrics between responses. Quality issues:

- annotator expertise/instructions;
- position/verbosity/style bias;
- disagreement/subjectivity;
- prompt/domain coverage;
- model-generated candidate diversity;
- safety policy consistency;
- annotator welfare/privacy.

Retain strength/disagreement and hold out evaluation.

## 8. Reward modeling and RLHF concept

Reward model scores preferred response using comparison loss. Policy optimization
maximizes reward while constrained near reference (KL penalty), often PPO-like.

Risks:

- reward hacking/overoptimization;
- proxy bias;
- mode collapse/verbosity;
- capability regressions;
- training instability/cost;
- hidden evaluator exploit.

Evaluate external human/task metrics, not reward alone.

## 9. Direct preference optimization (DPO) concept

Uses preference pairs to optimize relative log-probability of chosen versus
rejected response compared with reference, avoiding explicit reward-model/RL loop.
Still depends on preference data, reference, temperature/β, coverage, and can
overfit/style-bias. Other preference objectives vary.

## 10. Distillation

Train student on teacher probabilities/logits/generated rationales/data.

- response distillation;
- logit/KL distillation with temperature;
- feature/intermediate distillation;
- task-specific.

Student can inherit teacher errors/bias and generated-data artifacts. Distillation
may violate provider/data terms; track provenance. Evaluate independent gold/adversarial
sets.

## 11. Quantization

Represent weights/activations/KV at lower precision.

- post-training quantization;
- quantization-aware training;
- weight-only versus weight+activation;
- per-tensor/per-channel/group scales;
- symmetric/asymmetric;
- calibration dataset.

Approximate mapping:

> q = round(x/scale) + zero_point  
> x̂ = scale(q − zero_point)

Outliers and sensitive layers hurt. Low bits save memory/bandwidth but real latency
needs optimized kernels/hardware. Evaluate generation, rare/safety tasks, long
context, calibration.

## 12. Pruning and sparsity

Remove weights/heads/neurons/layers/tokens. Unstructured sparsity needs hardware
support to speed; structured pruning easier but quality impact. Magnitude alone
does not prove safe removal; fine-tune and evaluate.

## 13. Decoding

Model gives next-token distribution.

### Greedy

argmax each step; reproducible, can loop/generic, not best sequence.

### Temperature

> p<sub>i</sub> ∝ exp(logit<sub>i</sub>/T)

T→0 more deterministic; higher more diverse/error-prone. T=0 implementations may
be greedy with tie/nondeterminism caveats.

### Top-k

Keep k highest logits, renormalize.

### Top-p/nucleus

Smallest sorted set whose cumulative probability ≥p, renormalize. Adaptive set size.

### Beam

Useful constrained sequence tasks; can reduce diversity and prefer short/generic.

### Constraints

JSON grammars, allowed tokens, stop sequences, repetition/length penalties. Grammar
ensures syntax, not semantic validity/authorization.

## 14. Inference lifecycle

```text
queue -> batch scheduler -> tokenize -> prefill -> iterative decode
-> detokenize/validate -> stream/final response -> metrics
```

Metrics:

- time to first token (TTFT);
- inter-token latency/time per output token;
- end-to-end p50/p95/p99;
- input/output tokens;
- throughput tokens/s, requests/s;
- queue/batch/cache utilization;
- error/cancel/fallback;
- cost/task success.

## 15. Continuous/dynamic batching

Requests have variable prompt/output. Continuous batching inserts/removes sequences
at decode steps, increasing utilization. Trade-offs: scheduling complexity, tail
latency, memory fragmentation, fairness, cancellation, per-tenant quotas.

Prefill is compute-heavy matrix processing; decode often memory-bandwidth/KV-heavy
with sequential tokens. Separate scheduling/disaggregation can optimize.

## 16. KV cache and prefix caching

KV cache memory grows with active sequences/context/layers. Paged cache manages
variable blocks and fragmentation. Prefix caching reuses common system/document
prefix if exact token/model/config match.

Security:

- tenant/auth scope in key;
- no reuse of private prompt across users;
- eviction/deletion;
- model/adapter/position compatibility;
- side-channel consideration.

## 17. Speculative decoding concept

Small draft model proposes multiple tokens; large target verifies in parallel,
accepting prefix that matches sampling correction. Preserves target distribution
under correct algorithm, speeds when draft acceptance high. Extra draft compute and
workload/hardware determine gain.

## 18. Serving strategies

- external API: low ops, privacy/vendor/cost/limits;
- self-host: control/data locality, high ops/capacity;
- dedicated versus multi-tenant;
- model routing/cascade;
- fallback smaller model/template/search;
- prompt/context compression;
- asynchronous batch for noninteractive work.

Total cost includes engineering, idle capacity, tokens, retries, evaluation,
moderation, retrieval, networking, incidents—not only accelerator price.

## 19. Exercises

1. Build SFT masking and prove prompt tokens excluded.
2. Compare full/LoRA/quantization memory and quality.
3. Plot decoding entropy as temperature/top-p changes.
4. Capacity-plan KV cache for a workload.
5. Design an experiment deciding prompting vs RAG vs fine-tuning.

