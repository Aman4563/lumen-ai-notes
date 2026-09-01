# Chapter 2 — Post-Training Data, Objective, and Systems Laboratory

## 1. Start with the smallest intervention

Use prompting/tooling for interface/knowledge that can remain external; retrieval
for updateable sourced knowledge; SFT for consistent demonstrated behavior; PEFT
for low-cost variants; full fine-tuning for broad capacity/representation changes;
preference optimization for relative choices; online RL when outcomes require
fresh interaction or verifiers. This is a decision sequence, not a prestige ladder.

## 2. SFT objective and masks

For causal LM tokens `x₁…x_T`, a masked average negative log-likelihood is:

> `L_SFT = − [Σ_t m_t log p_θ(x_t | x_<t)] / [Σ_t m_t]`

`m_t` determines which positions train the model. For assistant-only learning,
system/user/padding tokens usually provide context but contribute no target loss.
Off-by-one shift, packed boundaries, truncation, and special-token mistakes can
train on the prompt or ignore the answer.

Tiny-batch acceptance: print original turns, tokens, role IDs, labels, mask,
shifted input/target pairs, and per-token loss. Manually verify every nonignored
position.

## 3. LoRA accounting

For frozen weight matrix `W` of shape `d_out × d_in`, LoRA adds a low-rank update:

> `W′ = W + scale × B A`

where `A` is `r × d_in`, `B` is `d_out × r`, and trainable parameter count is
`r(d_in + d_out)` rather than `d_in d_out`. Scaling commonly depends on `α/r` or
a variant; record the exact convention.

Test targeted modules, initialization, dropout, merge/unmerge equivalence, adapter
dtype, checkpoint contents, base-model identity, and serving compatibility. An
adapter is not self-contained without the exact base/tokenizer and injection map.

## 4. QLoRA reasoning

QLoRA-style training keeps a quantized frozen base and trains higher-precision
adapters, reducing memory. It does not mean all computation/optimizer state is
low precision. Quantization type/grouping, compute dtype, double quantization,
paged optimizer behavior, target modules, and hardware kernels affect quality and
throughput. Compare against a same-data LoRA/full baseline when conclusions matter.

## 5. Preference-pair audit

A pair `(prompt, chosen, rejected)` may reflect annotator taste, length/style bias,
position/order effects, policy distribution, or rubric ambiguity. Record source
policy and sampling, annotator/rubric identity, randomization, ties/strength,
agreement, safety labels, and temporal/domain slice.

Check whether preference is predictable from length, formatting, refusal phrases,
or other shortcuts without semantic quality. If yes, the model can optimize the
shortcut.

## 6. Reward-model objective

For scalar scores `r_φ(x,y)`, a pairwise logistic loss is commonly:

> `L_RM = −log sigmoid(r_φ(x,y_chosen) − r_φ(x,y_rejected))`

Only score differences are identified by pairwise data. Accuracy alone hides
calibration, subgroup, length, policy-shift, and high-score exploit behavior.
Hold out prompts and, when possible, data from policies/time periods distinct from
training.

## 7. DPO-style objective reasoning

Define reference-relative log odds for chosen versus rejected response:

> `z = β[(log π_θ(y_c|x) − log π_ref(y_c|x))`
> `    − (log π_θ(y_r|x) − log π_ref(y_r|x))]`

The loss encourages positive `z` through a logistic classification objective.
Sequence log-probability aggregation and length normalization convention matter.
The reference anchors change; `β` controls strength. DPO avoids an explicit reward
model/online rollout loop but inherits preference-data bias and coverage limits.

## 8. Online rollout identity

Each trajectory must record prompt/data revision, policy/checkpoint, tokenizer,
sampling parameters and RNG, tools/environment, output/actions, old log-probs,
reward/verifier component versions, reference, timing, and termination. Reject or
handle stale rollouts according to a quantified policy; do not mix versions
silently for throughput.

## 9. Evaluation matrix

| Axis | Examples |
|---|---|
| Intended capability | task success, pass rate, groundedness, tool outcome |
| General capability | held-out language, reasoning, code, long-context suites |
| Safety/security | harmful behavior, jailbreak, prompt injection, data exfiltration |
| Calibration | confidence/selective performance, verifier confidence |
| Behavior quality | helpfulness, refusal precision/recall, verbosity/style slices |
| Operational | latency, output length, memory, throughput, failure/tool cost |
| Robustness | paraphrase, distribution, language, adversarial and policy shift |

Use a frozen promotion suite plus exploratory diagnostics. Repeatedly tuning on a
“test” converts it into a development set.

## 10. Required ablations

- base versus SFT/adapter/full update;
- data amount/quality/mixture and masking;
- rank/target modules for LoRA where relevant;
- reference and objective strength for preference methods;
- reward components and verifier robustness for RL;
- output length/style controls;
- checkpoint selection rule decided before final results.

Match compute/data/evaluation as required by the decision. Preserve failed runs.

## 11. Reward-hacking red team

Search high reward but low independent-quality outputs; optimize against a copy of
the reward model to expose shortcuts; perturb formatting/length; hold semantics
constant while changing superficial cues; test adversarial verifier inputs; compare
multiple independent judges and human audits. Never use the training reward alone
as promotion evidence.

## 12. Capstone

Fine-tune a small open model with SFT and one adapter method. Optionally add a tiny
preference method. Deliver data card, mask tests, base/model/tokenizer identities,
memory/throughput measurements, ablations, broad evaluation with uncertainty,
qualitative error clusters, safety/security tests, model card, and rollback rule.

