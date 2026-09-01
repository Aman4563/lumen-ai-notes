# Chapter 6 — LLM Evaluation, Safety, and Security

## 1. Evaluation begins with task taxonomy

Break production traffic into categories and consequences. For each define:

- valid inputs/outputs;
- truth/reference/rubric;
- acceptable uncertainty/abstention;
- high-impact failures;
- latency/cost;
- safety/security policy;
- affected user/slice.

One overall “win rate” hides regressions.

## 2. Evaluation layers

1. component: retrieval, extraction, tool selection, format;
2. end-to-end task success;
3. model quality: correctness, relevance, style;
4. safety/security: policy, injection, permissions;
5. operational: latency, cost, reliability;
6. product: resolution, satisfaction, retention, workload.

## 3. Eval dataset design

- representative sampled traffic, privacy-sanitized;
- stratified difficult/high-impact edge cases;
- counterfactual/paraphrase robustness;
- unanswerable/ambiguous cases;
- multilingual/domain/time slices;
- adversarial safety/injection;
- tool/dependency failures;
- stable regression + rotating fresh set.

Prevent contamination: separate prompt/fine-tune/dev/test; track benchmark exposure;
do not hand-optimize indefinitely against visible test.

## 4. Deterministic metrics

Prefer executable checks where possible:

- exact/normalized match;
- JSON/schema and field constraints;
- code tests/static checks;
- SQL execution/result;
- citation ID/support span;
- retrieval recall;
- tool name/arguments/side effects;
- permission-denied behavior;
- latency/token/cost.

They are reproducible but may miss semantic quality.

## 5. Human evaluation

Rubric dimensions separately: correctness, completeness, relevance, evidence,
clarity, policy. Use concrete anchors/examples; blind/randomize systems; multiple
raters/adjudication; measure agreement; collect reasons; protect annotators.

Pairwise comparison often easier than absolute scoring but lacks magnitude and can
favor style/verbosity. Ties should be allowed.

## 6. LLM-as-judge

Benefits: scalable nuanced evaluation. Biases:

- position/order;
- verbosity/style;
- self/pretraining preference;
- reference anchoring;
- domain incompetence;
- prompt injection in candidate;
- stochasticity;
- correlated errors with system.

Mitigate: explicit rubric, randomized order, structured evidence, multiple judges/
trials, deterministic checks, calibration against expert human set, monitor judge
drift/version. Never use as sole safety/permission authority.

## 7. Factuality and hallucination

Types:

- intrinsic contradiction of provided source;
- extrinsic unsupported claim;
- incorrect citation/attribution;
- fabricated entity/reference;
- stale fact;
- wrong calculation/tool result;
- uncertainty omitted.

Measure claim-level: extract atomic claims, retrieve/identify evidence, judge
support/contradiction/unknown, aggregate with severity. Automated claim/evidence
models have errors; sample human audit.

Mitigation:

- retrieval/tools/source-of-truth;
- require evidence/citations;
- constrain output/validate calculations;
- abstain/escalate;
- reduce unsupported context;
- fine-tune behavior;
- choose capable model;
- product UI communicating uncertainty.

No prompt eliminates hallucination.

## 8. Safety taxonomy

Domain-specific categories: harmful instructions, self-harm, hate/harassment,
sexual content/minors, privacy, fraud, medical/legal/financial risk, malware,
weapons, dangerous acts, deception, copyright, platform abuse.

Evaluate both:

- unsafe compliance rate;
- over-refusal of benign/educational/counter-speech requests;
- consistency across paraphrase/language/context;
- severity-weighted outcomes.

Policies require human/legal/domain ownership and update/versioning.

## 9. Security threat model

Assets: secrets, private context, tool permissions, user data, system prompt,
model weights, availability/budget, external systems.

Threats:

- direct/indirect prompt injection;
- data exfiltration/cross-tenant leak;
- insecure tool call/output handling;
- excessive agency;
- model/prompt extraction;
- training/RAG poisoning;
- membership inference;
- denial-of-wallet/service;
- malicious files/URLs;
- supply-chain model/adapters/dependencies.

Map trust boundaries and enforce least privilege.

## 10. Prompt injection tests

Test instructions embedded in:

- user prompt;
- retrieved page/document/email;
- image/OCR/metadata;
- tool output/API error;
- memory/history;
- file names/links;
- encoded/obfuscated/multilingual content.

Success criteria are architectural: no unauthorized data/action even if model
follows content. Also test false-positive blocking of legitimate instructions.

## 11. Privacy testing

- cross-user/tenant isolation;
- secret/canary extraction;
- deletion/retention;
- logs/traces/redaction;
- training-data memorization probes under authorized research;
- embedding/index ACL;
- caching and conversation reuse;
- tool argument exposure.

Synthetic canaries help detect pathways but do not quantify all privacy risk.

## 12. Robustness

- typos/paraphrases/languages;
- long/distractor context;
- conflicting evidence;
- prompt boundary/control tokens;
- malformed structured inputs;
- dependency timeout/partial result;
- adversarial Unicode;
- model/provider/version change;
- repeated stochastic runs.

Metamorphic test: meaning-preserving change should preserve decision; controlled
meaning change should alter appropriate result.

## 13. Online experimentation

Offline eval gates; shadow tests operations; canary controls risk; A/B measures
causal product impact. Guardrails: safety incidents, escalation, complaints,
resolution, latency/cost, human workload, retention. Randomization unit avoids
conversation/user contamination.

Generated content changes user behavior and future feedback; thumbs-up is sparse/
selected. Use targeted human audits and long-term/ecosystem metrics.

## 14. Monitoring

- request categories/languages/context sizes;
- quality sampling and task completion;
- refusal/safety/incident/appeal;
- retrieval and citation health;
- tool errors/permissions/approvals;
- prompt injection indicators;
- token/cost/cache/model routing;
- p50/p95/p99 latency/time-to-first-token;
- provider/model/prompt/index versions;
- feedback distribution/drift.

Avoid storing raw sensitive prompts by default; use sampling/redaction/access/
retention and safe replay fixtures.

## 15. Release gates

- stable and fresh eval pass;
- no critical security permission violation;
- safety categories within thresholds and over-refusal bounded;
- component regressions explained;
- load/reliability/fallback tested;
- privacy/legal/data approvals;
- model/prompt/tool/index versioned;
- shadow/canary/rollback/kill switch;
- owners/runbooks/on-call.

## 16. Exercises

1. Build 200-case eval suite for support assistant.
2. Calibrate an LLM judge against expert ratings.
3. Implement claim-citation support scoring with audits.
4. Threat-model and red-team a tool agent.
5. Design online KPI/guardrails for generative search.

