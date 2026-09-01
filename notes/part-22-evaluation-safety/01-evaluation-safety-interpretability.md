# Chapter 1 — Evaluation, Safety, Security, Privacy, and Interpretability

## 1. Evaluation is a measurement system

An evaluation estimates behavior over a declared population under a specific
prompting, tool, decoding, model, and scoring protocol. A benchmark number without
this contract is not an intrinsic property of the model.

```text
capability/safety question -> task distribution -> protocol
-> model outputs/tool trajectories -> scoring/judging
-> uncertainty and slices -> decision threshold -> follow-up
```

## 2. Evaluation layers

| Layer | Example question |
|---|---|
| Training | Is held-out token loss improving without instability? |
| Capability | Can the model solve code, math, reasoning, domain tasks? |
| Behavior | Does it follow instructions, calibrate, abstain, cite? |
| Agent | Does the trajectory use tools correctly and finish the task? |
| Safety | Does it avoid unacceptable harm without excessive refusal? |
| Security | Can untrusted input exfiltrate data or trigger actions? |
| Systems | Does it meet latency, throughput, reliability, and cost? |
| Product/science | Does it improve the real outcome or scientific claim? |

A model can improve one layer and regress another.

## 3. Validation loss and perplexity

Token negative log likelihood (NLL):

> **NLL = −Σ valid tokens log P(correct token) ÷ number of valid tokens**

Perplexity:

> **perplexity = exp(NLL)**

Perplexity comparisons require the same tokenizer/data/masking/normalization. A
tokenizer with different segmentation changes the unit, so raw values may not be
comparable. Low loss measures distribution modeling, not factuality, harmlessness,
or task completion.

## 4. Benchmark construction

Define:

- intended population and non-goals;
- task source/rights/privacy;
- train/development/test separation;
- difficulty and important slices;
- reference answer or rubric and ambiguity;
- prompt/template/tool/decoding budget;
- scorer and acceptable partial credit;
- contamination and memorization checks;
- minimum meaningful improvement and guardrails;
- version/refresh/retirement policy.

Include negative/unanswerable cases and tasks where superficial heuristics fail.

## 5. Contamination and benchmark overfitting

Public benchmarks can appear in pretraining data, model-generated datasets, prompts,
papers, and evaluation code. Teams also overfit through repeated prompt/method
selection against a fixed test.

Mitigate:

- source and time-aware decontamination;
- exact/near question and solution matching;
- private/fresh rotating sets;
- canary transformations and hidden variants;
- limit access to final test;
- preregister primary metrics/stopping;
- report public benchmark exposure uncertainty.

Contamination detection is incomplete; do not claim proof of absence.

## 6. Code and verifiable-task evaluation

For code:

- sandbox execution with CPU/memory/time/process/network limits;
- hidden and adversarial tests;
- deterministic dependencies/compiler;
- forbid reading test answers or modifying harness;
- separate syntax/compile/runtime/correctness/security;
- measure pass rate, resources, and generated length;
- inspect flaky tests and nondeterministic programs.

For n generated samples with c correct, pass@k estimates the chance at least one of
k samples is correct. A common unbiased estimator when n ≥ k is:

> **pass@k = 1 − C(n−c, k) ÷ C(n, k)**

It measures best-of-k capability under a sampling protocol, not single-attempt user
reliability. Report temperature and selection mechanism.

## 7. Math and reasoning evaluation

- final exact answer with canonicalization;
- symbolic/numeric verifier with tolerance;
- proof checker where formalized;
- process-step human/reward assessment;
- robustness to changed numbers, order, wording, and irrelevant context;
- evaluate tool-enabled and tool-free separately;
- detect answer extraction and benchmark-format shortcuts.

Chain-of-thought text can be plausible but unfaithful. Correct answer does not prove
the written reasoning caused it.

## 8. Calibration and selective prediction

For probabilistic events, calibration asks whether events predicted with confidence
p occur about p fraction of the time. Metrics include Brier score, log loss, and
reliability diagrams.

For generative systems, confidence may come from verifier scores, consistency,
retrieval evidence, or a separate model; token probability alone is often poorly
aligned with factual correctness.

Selective risk:

- coverage = fraction answered/acted on;
- risk = error among covered cases.

Plot risk–coverage and define escalation/abstention policy by consequence.

## 9. Statistical comparison

Use paired task-level outcomes when models answer the same tasks. Methods:

- paired bootstrap confidence intervals;
- permutation/randomization tests;
- McNemar-type test for paired binary outcomes;
- hierarchical/mixed models for tasks/raters where justified;
- multiple-comparison correction or predeclared primary endpoint.

Report effect size and uncertainty. Thousands of correlated generated samples from
the same few prompts do not provide thousands of independent units.

## 10. Human evaluation

Write a rubric with anchored examples for correctness, relevance, completeness,
evidence, style, safety, and severity. Design:

- qualified raters and training;
- blinded model identities;
- randomized order and ties;
- multiple ratings/adjudication for critical cases;
- rater disagreement and subgroup analysis;
- privacy and annotator wellbeing;
- gold/attention checks used carefully;
- audit sampling rather than incentives for speed alone.

Pairwise preference is easier than absolute score but can encode verbosity/style
bias and lacks magnitude.

## 11. Model-based judges

Useful for scale, critique, and semantic grading. Risks:

- position, verbosity, and style bias;
- self/family preference;
- prompt injection from candidate content;
- weak domain expertise;
- reference anchoring;
- correlated errors with evaluated model;
- drift when judge/provider changes.

Calibrate on expert-labeled representative and adversarial cases. Randomize order,
use structured evidence/rubric, allow uncertainty/ties, version judge/prompt, and
retain independent executable/human gates for high-impact decisions.

## 12. Agent evaluation

Evaluate full trajectory:

- task success and partial progress;
- selected tools and typed arguments;
- authorization/approval compliance;
- number/cost/latency of steps;
- recovery from timeout, duplicate, malformed, or malicious result;
- idempotency and side-effect verification;
- state/memory correctness;
- loop/horizon budget;
- evidence/receipt and audit trace;
- contamination from environment/tool text.

Create versioned resettable environments and hidden task variants. A task marked
success by the agent is not success; verify external state.

## 13. Capability elicitation versus deployment policy

Research may measure what a model can do under best prompting/sampling/tools; a
deployment eval measures the actual configured product. Keep separate:

- base model capability;
- scaffolded/agent capability;
- safety policy behavior;
- product UI/tool/permission constraints.

A system can be safer because architecture prevents an action even if the model
would attempt it. Conversely, a benign model eval does not guarantee a powerful
tool scaffold is safe.

## 14. Safety evaluation

Build domain-specific taxonomies and severity tiers. Test:

- harmful compliance and useful safe alternatives;
- over-refusal on benign, educational, and counter-speech cases;
- multilingual/paraphrase/encoded/role-play robustness;
- multi-turn escalation and persistence;
- high-impact medical/legal/financial/deception/cyber/bio categories under expert
  governance;
- vulnerable users and protected slices;
- model/tool combination and real-world consequence;
- monitoring/appeal/incident response.

Do not publish operationally harmful test details without appropriate controls.

## 15. Security evaluation

Threat-model assets and trust boundaries:

- direct/indirect prompt injection;
- tool argument injection and confused deputy;
- data exfiltration and cross-tenant cache/memory;
- model/adapter/artifact supply chain;
- training/RAG/evaluation poisoning;
- model extraction and membership inference;
- denial-of-service/wallet;
- sandbox escape and generated-code execution;
- secret leakage in logs/traces/checkpoints;
- unauthorized weight/model endpoint access.

Success criteria should be architectural: no unauthorized data/action even if model
follows malicious text.

## 16. Privacy evaluation

- canary/authorized memorization extraction tests;
- membership-inference risk under defined attacker;
- PII/secret detection in outputs and checkpoints;
- train/eval/log/index/cache retention/deletion;
- cross-user/session/tenant isolation;
- differential privacy accounting if used;
- access to raw prompts and human labels;
- model release implications.

Differential privacy provides a formal bound only under its exact mechanism and
accounting assumptions; attaching “DP” to a pipeline is not sufficient.

## 17. Robustness and distribution shift

Test:

- typos, dialects, languages, format and encoding;
- paraphrase and semantic-preserving transforms;
- adversarial distractors/conflicting evidence;
- long context and relevant-position sweep;
- out-of-domain/time/geography/user slices;
- missing/late/malicious tool results;
- model quantization and serving engine changes;
- repeated stochastic trials;
- prompt/template/tokenizer revision.

Metamorphic tests encode relationships: meaning-preserving changes should preserve
appropriate behavior; controlled meaning changes should change it.

## 18. Interpretability and model internals

Frontier research may study:

- activation/attention probing;
- causal intervention/ablation/patching;
- attribution and feature visualization;
- sparse autoencoder/dictionary features;
- circuits and mechanistic hypotheses;
- representation similarity and linear probes;
- influence/memorization analysis.

Correlational probes do not prove a feature is causally used. Attention maps are not
automatically explanations. A good interpretability claim predicts behavior under a
causal intervention and generalizes beyond selected examples.

## 19. Red teaming

Combine:

- domain experts;
- structured manual attacks;
- automated mutation/search/model-generated attacks;
- multi-turn and tool/environment attacks;
- novel/unseen strategies;
- severity triage and secure disclosure;
- regression conversion after remediation.

Do not optimize only against a public static jailbreak set; it becomes another
benchmark and invites narrow patching.

## 20. Release gates and model cards

Document:

- intended uses and prohibited/high-risk uses;
- architecture/training/post-training overview at safe disclosure level;
- data governance and known limitations;
- capability/safety/security/privacy evaluation;
- subgroup/language/context limitations;
- deployment requirements and safeguards;
- model/tokenizer/license/access;
- monitoring, incident, rollback, update policy;
- responsible owner and approval record.

Open-weight, API, research-preview, and internal deployments have different threat
models and reversibility. Evaluate release externalities, not only hosted endpoint.

## 21. Technology dependencies of trustworthy evaluation

| Need | Technologies to understand | What to prove |
|---|---|---|
| Training | PyTorch or JAX; FSDP/DeepSpeed/Megatron | correct scaling and recovery |
| Accelerators | CUDA/ROCm/TPU, Triton, profilers | bottleneck-based speedup |
| Cluster | Docker/OCI, Slurm/Kubernetes, NCCL/RCCL | reproducible resilient job |
| Data | Arrow/Parquet/object store, Spark/Ray, table format | governed deterministic stream |
| Experiments | Git, Hydra-like config, MLflow/W&B-like tracker | full run lineage |
| Fine-tuning | Transformers, PEFT, TRL-like libraries | masks/objective/quality verified |
| Serving | vLLM/SGLang/TensorRT-LLM/Ray Serve | representative SLO goodput |
| Observability | OpenTelemetry, Prometheus/Grafana, DCGM | version-linked diagnosis |
| Evaluation | task harness, sandboxes, human/judge workflow | valid uncertainty and security |

Learn one stack hands-on and mechanisms across alternatives. Recruiters should see
evidence, not a résumé containing every name.

## 22. Advanced AI/ML interview question bank

### Research method

1. Your new optimizer wins by 0.2 loss points on one run. What evidence is next?
2. How do you compare two models under equal compute rather than equal parameters?
3. A small-scale ranking reverses at large scale. How do you investigate?
4. Design an ablation for an MoE routing improvement.

### Training and numerics

5. A BF16 run is stable but FP16 diverges. Explain and diagnose.
6. Loss spikes every checkpoint interval. What measurements localize it?
7. Derive AdamW state memory and effect of sharding.
8. Why can increasing batch require retuning schedule?
9. How do you verify a fused kernel did not alter the objective?

### Distributed systems

10. Choose DP/FSDP/TP/PP/CP for a long-context 70B-like model on multi-node GPUs.
11. One rank hangs in all-reduce after 10,000 steps. Give a runbook.
12. Checkpoint restore fails at a different world size. What metadata was missing?
13. Scaling efficiency collapses across nodes. How do you distinguish network,
    straggler, data, and compute causes?

### Data

14. Design near-dedup at trillion-token scale and audit minority-language harm.
15. How do you prove training/evaluation decontamination is adequate but not perfect?
16. What state is required to resume a streaming mixed dataset?

### Post-training and RL

17. Compare SFT, DPO, PPO, and GRPO by data, models, and online/offline nature.
18. Reward increases while human quality falls. What is happening?
19. Derive DPO loss inputs and list masking bugs.
20. When is a contextual bandit preferable to full RL?
21. How do offline RL coverage failures appear?

### Inference

22. Estimate KV memory and identify how GQA changes it.
23. TTFT is poor but TPOT is good. Which phase and remedies?
24. How does continuous batching trade throughput and fairness?
25. Quantization improves microbenchmark but not service latency. Why?

### Safety and evaluation

26. An LLM judge prefers longer wrong answers. How do you calibrate it?
27. Design a capability eval resistant to contamination.
28. How do you evaluate a coding agent that can edit its tests?
29. What release risks differ between open weights and hosted API?
30. Explain why a prompt is not an authorization boundary.

## 23. Evaluation review checklist for the Part 23 capstone

The end-to-end build instructions live in [Part 23](../part-23-technology-capstone/README.md).
Use this section only as the evaluation, safety, and evidence review lens for that
project. The model can be tiny; the engineering and evidence must be serious.

### Artifact A — research proposal

- falsifiable hypothesis and mechanism;
- matched baseline and ablations;
- primary metric, guardrails, minimum effect;
- compute/data/resource estimate;
- risk and stopping criteria.

### Artifact B — governed data pipeline

- permitted sources and immutable manifests;
- parsing, quality, dedup, contamination, privacy checks;
- tokenizer and packing tests;
- deterministic distributed loader/resume;
- data card and deletion lineage.

### Artifact C — training system

- tested single-device loop;
- mixed precision with numerical diagnostics;
- DDP and full sharding or equivalent;
- throughput/memory/communication profile;
- distributed checkpoint and fault injection;
- immutable container and scheduled job.

### Artifact D — post-training

- SFT baseline with audited masks;
- LoRA/full or QLoRA-style comparison;
- DPO or small verifiable online RL experiment;
- reward-hacking analysis;
- broad capability/safety evaluation.

### Artifact E — inference service

- modern serving engine or educational equivalent;
- continuous batching and KV metrics;
- open-loop load test with representative lengths;
- quantization or speculative experiment;
- fallback, overload, security, and runbook.

### Artifact F — research report

- all runs, including failures, linked to source/data/config;
- curves and uncertainty, not best checkpoint only;
- ablation and mechanism diagnostics;
- quality/system/cost trade-offs;
- limitations and next most informative experiment;
- 20-minute presentation and adversarial design defense.

## 24. Evaluation review rubric

Score 0–4 each:

| Dimension | 0 | 2 | 4 |
|---|---|---|---|
| Scientific claim | vague | testable | falsifiable, powered, alternative explanations |
| Reproducibility | notebook only | code/config | immutable code/data/env/eval lineage |
| Data | downloaded file | basic filters | rights, dedup, contamination, resume, audits |
| Training | runs once | stable single GPU | profiled distributed, numerical diagnostics |
| Fault tolerance | none | saves checkpoint | corruption-safe restore and injected failure |
| Post-training | API call | SFT/adapter | objective verified, ablated, reward-risk audited |
| RL understanding | names methods | implements one | estimator/coverage/reward trade-offs defended |
| Inference | demo | latency measured | open-loop SLO goodput, cache/cost/fallback |
| Evaluation | cherry-picked | fixed suite | uncertainty, slices, fresh/adversarial/security |
| Communication | claims win | reports result | separates evidence/inference and limits |

Thirty or more indicates strong integrated research-engineering evidence, not a
guarantee of hiring at a leading AI lab. A specialist role may demand much deeper strength
in a subset.

## 25. Continuing study

After the capstone, pick one specialization:

- optimizers/scaling/numerical training;
- distributed training and checkpoint systems;
- GPU kernels/compilers;
- model architecture and long context;
- multimodal/generative modeling;
- post-training, reward modeling, and RL;
- evaluations, interpretability, or safety;
- inference/runtime systems;
- domain science such as robotics, biology, or formal reasoning.

Read primary papers, reproduce results, contribute to a real codebase, and maintain
an experiment journal. Breadth makes collaboration possible; deep demonstrated work
in one area makes you valuable.
