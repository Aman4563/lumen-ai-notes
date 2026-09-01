# Track 4 — Causal ML and Uplift

## 1. Prediction versus intervention

- Predictive: E[Y ∣ X=x].
- Causal: E[Y ∣ do(T=t), X=x] or potential outcome contrast.

High churn risk does not mean discount prevents churn. Target users with positive
incremental effect, subject to cost and fairness.

## 2. Potential outcomes

For binary treatment T:

- Y(1), Y(0);
- individual effect τ<sub>i</sub> = Y<sub>i</sub>(1) − Y<sub>i</sub>(0), unobservable
  jointly;
- ATE = E[Y(1) − Y(0)];
- CATE τ(x) = E[Y(1) − Y(0) ∣ X=x];
- ATT = E[Y(1) − Y(0) ∣ T=1].

Specify estimand, population, treatment, outcome/window, assignment, interference.

## 3. Identification assumptions

### Consistency

Observed Y = Y(T); treatment well-defined (no hidden versions).

### Exchangeability/no unmeasured confounding

> (Y(0),Y(1)) independent of T given X

Unverifiable observational assumption; use domain/DAG/sensitivity.

### Positivity/overlap

> 0 < P(T=1 ∣ X=x) < 1

for relevant x. If some users always treated, counterfactual unsupported.

### No interference/SUTVA

One unit's outcome unaffected by others' assignment; often violated in networks/
marketplaces.

Randomization establishes exchangeability by design (with compliance/interference
details).

## 4. DAGs

Use causal graph to decide adjustment:

- confounder C → T and C → Y: adjust;
- mediator T → M → Y: adjusting removes indirect total effect;
- collider T → C ← Y: adjusting opens spurious path;
- instrument Z → T → Y, no other path under strong assumptions.

DAG encodes assumptions; data cannot generally identify direction alone.

## 5. Outcome regression

Fit μ<sub>t</sub>(x) = E[Y ∣ T=t,X=x], estimate:

> τ̂(x) = μ̂₁(x) − μ̂₀(x)

T-learner uses separate models; S-learner one model with treatment feature;
X/R-learners target effects/residuals. Flexible ML requires cross-fitting to reduce
overfit bias for inference.

## 6. Propensity scores

> e(x) = P(T=1 ∣ X=x)

Inverse probability weighted ATE:

> average [TY/e(X) − (1−T)Y/(1−e(X))]

Extreme propensity creates huge variance and exposes positivity failure. Stabilize/
trim only with changed estimand/transparent sensitivity. Balance diagnostics after
weighting, not propensity accuracy alone.

## 7. Doubly robust/AIPW

Combines outcome and propensity:

> τ̂ = average [μ̂₁(X) − μ̂₀(X)
> + T(Y−μ̂₁(X))/ê(X)
> − (1−T)(Y−μ̂₀(X))/(1−ê(X))]

Consistent if either nuisance outcome or propensity model correct under assumptions
(and regularity), hence doubly robust—not immune to confounding/positivity/both bad.
Cross-fit models.

## 8. Uplift modeling

Four groups under binary outcome/treatment:

- persuadables: positive effect;
- sure things: outcome either way;
- lost causes: no outcome either way;
- sleeping dogs: harmed by treatment.

Individual types unobserved. Rank by estimated CATE/uplift.

Metrics:

- uplift/Qini curves;
- policy value;
- AUUC;
- incremental outcome in randomized holdout;
- calibration of CATE by bins (with uncertainty).

Predicting treatment-arm outcomes well does not guarantee accurate difference;
CATE estimation is hard/noisy.

## 9. Policy learning

Choose π(x) ∈ {0,1} maximizing expected outcome minus treatment cost under capacity/
fairness:

> treat if τ(x) > cost/value threshold

Evaluate policy off-policy with randomized/propensity-logged data, then prospective
experiment. Avoid optimizing test policy repeatedly.

## 10. Quasi-experiments

- difference-in-differences: parallel trends and no differential shocks;
- regression discontinuity: assignment threshold, continuity/no manipulation;
- instrumental variables: relevance, exclusion, independence, monotonicity;
- synthetic control: weighted comparison trajectory;
- interrupted time series.

Each estimates local/specific effects. Placebo/pretrend/sensitivity checks support
but do not prove assumptions.

## 11. Causal feature traps

Do not adjust blindly for all available variables:

- post-treatment mediator/collider;
- treatment leakage;
- selection conditioned on outcome;
- bad controls;
- proxy/measurement affected by policy.

Define temporal DAG before dataset.

## 12. Heterogeneous treatment effect risk

Flexible models find spurious subgroup effects. Use honest sample splitting,
cross-fitting, regularization, predeclared/high-value heterogeneity, uncertainty,
randomized validation. Protect groups from harmful experimentation and legal issues.

## 13. Exercises

1. Draw DAG and adjustment set for retention offer.
2. Simulate confounding and compare naïve/outcome/IPW/AIPW.
3. Diagnose overlap and extreme weights.
4. Build uplift policy on randomized data and evaluate value.
5. Critique a difference-in-differences claim.

