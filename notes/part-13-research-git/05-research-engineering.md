# Chapter 5 — Research Engineering and Experimental Method

> **Placement:** Read after the general Git Chapters 1–4; use this chapter before
> running expensive training or claiming an improvement.

## 1. Research is uncertainty reduction

A research project begins with uncertainty, not with a preferred architecture.
The job is to design evidence that separates explanations while controlling
confounders and measurement error.

```text
observation -> hypothesis -> predicted difference -> experiment
-> evidence + uncertainty -> update belief -> next experiment
```

An engineering project usually has a known target and uncertain implementation.
A research project may also have an uncertain target, mechanism, or evaluation.
Frontier work combines both: the training system must be reliable enough that a
scientific conclusion is not an infrastructure artifact.

## 2. Turn an idea into a testable claim

Weak claim: “Method A is better.”

Testable claim:

> Under a fixed data mixture, parameter budget, token budget, optimizer budget,
> and evaluation protocol, A improves held-out code pass rate by at least two
> percentage points without a significant regression on language and safety
> suites.

Specify:

- intervention: exact difference between treatment and control;
- population: tasks, domains, languages, lengths, and time range;
- resources held constant: parameters, tokens, FLOPs, wall time, or money;
- primary endpoint and minimum meaningful effect;
- guardrails and disqualifying regressions;
- randomness: initialization, data order, sampling, nondeterministic kernels;
- analysis and stopping rule decided before reading the result.

## 3. The experiment unit

An experiment is more than a run. A complete record contains:

| Layer | Required record |
|---|---|
| Question | hypothesis, motivation, expected mechanism |
| Code | commit, patch/dirty state, dependency and container digest |
| Data | immutable snapshot, filters, mixture, tokenizer, order/seed |
| Model | architecture, initialization, parameter count, precision |
| Training | optimizer, schedule, batch/tokens, parallelism, hardware |
| Evaluation | evaluator version, prompts, decoding, aggregation, slices |
| Output | checkpoints, logs, traces, profiles, sample predictions |
| Analysis | confidence, caveats, anomalies, failed runs, decision |

If a run cannot be related to its code, data, and evaluator, its metric is weak
evidence even if the number looks good.

## 4. Baselines and controls

Use the strongest inexpensive credible baseline, not a deliberately weak one.

- **Negative control:** should not change the result; detects pipeline artifacts.
- **Positive control:** known change should produce an expected effect; validates
  that the measurement can detect improvement.
- **Matched control:** differs only in the intended treatment.
- **Ablation:** removes or changes one component to estimate contribution.
- **Dose response:** varies strength/scale to see whether behavior follows the
  proposed mechanism.

When compute is limited, prioritize runs that distinguish hypotheses. Ten nearly
identical hyperparameter runs may be less informative than one diagnostic
ablation plus a seed replication.

## 5. Randomness and replication

One seed is an observation, not a distribution. Variation can come from:

- parameter initialization;
- sample order and augmentation;
- dropout and stochastic layers;
- distributed reduction order;
- low-precision rounding;
- nondeterministic kernels;
- generation sampling and evaluator variation.

For replicate metric values m₁ … mₙ:

> **sample mean = (m₁ + … + mₙ) ÷ n**
>
> **standard error = sample standard deviation ÷ √n**

Use paired comparisons when the same tasks/seeds are evaluated under both methods;
pairing often reduces noise. Report the distribution and practical effect, not
only whether a p-value crossed a threshold.

Large pretraining runs may be too expensive for many seeds. Compensate with small-
scale replications, mechanistic diagnostics, checkpoint trajectories, evaluation
bootstrap intervals, and explicit uncertainty about scale extrapolation.

## 6. Confounding in model experiments

Common invalid comparisons:

- changing architecture and learning-rate schedule simultaneously;
- comparing equal steps when examples/tokens/FLOPs differ;
- using a faster kernel that silently changes numerical precision;
- changing tokenizer or packing and attributing gain only to data;
- selecting checkpoints on the reported test benchmark;
- comparing serving engines with different output lengths or sampling settings;
- allowing one system more prompt tuning, retrieval data, or human review.

Maintain a comparison contract listing what is held equal and why that notion of
fairness matches the research question. Equal parameters, equal active parameters,
equal training FLOPs, equal wall time, and equal dollar cost answer different
questions.

## 7. Ablation design

For components A, B, and C, a one-at-a-time ablation does not identify interactions.
A full factorial can be expensive. Use staged design:

1. validate the full system beats baseline;
2. remove each plausible major contributor;
3. investigate important interactions;
4. replicate effects near the operating regime;
5. test robustness across scale/data/task slices.

Do not conclude “component is unnecessary” merely because removing it caused no
statistically detectable change in an underpowered experiment.

## 8. Learning curves and checkpoint analysis

Log metrics against:

- optimizer steps;
- examples or tokens processed;
- estimated FLOPs;
- wall-clock time;
- energy or monetary cost.

Compare curves, not only endpoints. A method may learn faster early but converge
to the same value, or improve loss while harming a downstream capability. Inspect
gradient norms, update norms, data domains, evaluation slices, and failure cases
along the trajectory.

## 9. Paper-reading protocol

### Pass 1 — claim and evidence

Read abstract, figures, tables, limitations, and conclusion. Write:

- the exact claim;
- the strongest evidence;
- the comparison contract;
- the largest unresolved alternative explanation.

### Pass 2 — method

Trace tensor shapes, objective, data, compute, and evaluation. Recalculate a toy
example. Identify dependencies hidden behind phrases such as “standard setup.”

### Pass 3 — reproduction plan

Read appendices and code. Produce:

- minimal faithful implementation;
- tests and expected invariants;
- resource estimate;
- checkpoints for detecting divergence early;
- expected table/curve;
- deviations forced by your environment.

## 10. Reproduction levels

| Level | Meaning |
|---|---|
| Re-execution | run authors’ code/artifact |
| Reproduction | independently obtain result with same method/data regime |
| Replication | test claim with meaningfully different implementation/data |
| Extension | introduce a justified change and test new hypothesis |

Do not label a single successful script run as independent replication.

## 11. Debug scientific anomalies

When a result is unexpectedly good, first suspect a bug:

1. leakage or benchmark contamination;
2. evaluator mismatch or cached answers;
3. sample-count/denominator error;
4. distributed aggregation mistake;
5. train/eval mode or dropout error;
6. checkpoint/model/tokenizer mismatch;
7. duplicated tasks or outputs;
8. changed decoding budget;
9. comparison not compute/data matched;
10. genuine improvement.

Unexpected failures deserve the same discipline: reproduce on a tiny deterministic
case, compare intermediate tensors, bisect code/data changes, and localize the
first divergent invariant.

## 12. Research code architecture

Keep the scientific treatment explicit:

```text
configs/       immutable experiment configs
src/           reusable model/data/training/eval code
tests/         unit, property, distributed, numerical tests
scripts/       thin launch and conversion entry points
evals/         versioned task definitions and rubrics
reports/       generated tables plus human conclusions
manifests/     data/model/environment lineage
```

Avoid notebooks as the only source of a result. Use them for exploration, then
move durable logic into tested modules. A launch command should write the resolved
configuration before training begins.

## 13. Communication in a research lab

A useful experiment report is concise and falsifiable:

1. question and why it matters;
2. method and controlled variables;
3. result with uncertainty and cost;
4. failure analysis and representative samples;
5. interpretation versus alternatives;
6. decision and next most informative experiment.

Separate observation (“validation loss fell 0.03”) from inference (“the routing
regularizer improved specialization”). The latter needs additional evidence.

## 14. Exercises

1. Select one Part 7 or Part 8 result and write a preregistered comparison.
2. Reproduce it with three seeds on a toy dataset and report paired uncertainty.
3. Add a negative control that detects label leakage.
4. Bisect an intentionally introduced regression using tests and metrics.
5. Read one primary paper and create a reproduction manifest before coding.

## 15. Exit criteria

You are ready to proceed when you can reject your own attractive result for a
specific methodological flaw, reproduce a run from an immutable manifest, and
explain which next experiment maximally reduces the important uncertainty.
