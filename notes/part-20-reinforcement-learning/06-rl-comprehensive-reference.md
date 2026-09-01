# Chapter 6 — Reinforcement Learning: Comprehensive Theory Reference

> Use this reference after the guided Chapters 1–5 or whenever you need the full
> algorithm map in one place.

## 1. When a problem is truly sequential

Reinforcement learning (RL) optimizes actions whose consequences affect future
states/rewards. If each decision has only an immediate independent outcome, a
contextual bandit or supervised prediction plus optimization may be simpler.

Use RL when:

- actions change what will be observed next;
- delayed consequences matter;
- exploration changes future knowledge;
- a policy must adapt across a trajectory;
- an environment/simulator or safe interaction exists.

RL is not a synonym for “model learns from feedback.”

## 2. Markov decision process

An MDP is (S, A, P, R, γ, ρ₀):

- states S;
- actions A;
- transition P(s′|s,a);
- reward distribution R;
- discount γ ∈ [0,1];
- initial-state distribution ρ₀;
- policy π(a|s).

Markov property: conditioned on current state/action, the modeled next-state
distribution does not require full history. If observation omits relevant state,
the problem is partially observable (POMDP); history/recurrent belief may be needed.

Return:

> **Gₜ = rₜ₊₁ + γrₜ₊₂ + γ²rₜ₊₃ + …**

For continuing tasks γ controls horizon and convergence. For episodic γ=1 can be
valid with finite termination.

## 3. Value functions

> **Vπ(s) = Eπ[Gₜ | sₜ=s]**
>
> **Qπ(s,a) = Eπ[Gₜ | sₜ=s, aₜ=a]**
>
> **Aπ(s,a) = Qπ(s,a) − Vπ(s)**

Bellman expectation:

> **Vπ(s) = Eπ[rₜ₊₁ + γVπ(sₜ₊₁) | sₜ=s]**

Bellman optimality:

> **Q*(s,a) = E[r + γ maxₐ′ Q*(s′,a′)]**

Bellman equations turn long returns into one-step recursive consistency.

## 4. Dynamic programming

When finite transitions/rewards are known:

- iterative policy evaluation applies Bellman expectation backups;
- policy improvement chooses actions greedy with Qπ;
- policy iteration alternates evaluation/improvement;
- value iteration applies optimality backup directly.

Convergence depends on assumptions (discounting/proper episodic structure). Exact DP
is limited by state/action explosion and unknown models, but defines targets for
sampled algorithms.

## 5. Monte Carlo methods

Estimate values from sampled complete returns:

> **V(s) ← V(s) + α[G − V(s)]**

Properties:

- no transition model or bootstrapping;
- unbiased return under sampled policy/episode assumptions;
- high variance and delayed updates;
- naturally episodic;
- first-visit versus every-visit estimators.

For control, combine action values with exploration and improve policy.

## 6. Temporal difference learning

TD(0) uses one-step bootstrap:

> **δₜ = rₜ₊₁ + γV(sₜ₊₁) − V(sₜ)**
>
> **V(sₜ) ← V(sₜ) + αδₜ**

TD learns online before episode end, usually lower variance than MC but biased by
current estimate.

### n-step return

> **Gₜ⁽ⁿ⁾ = rₜ₊₁ + … + γⁿ⁻¹rₜ₊ₙ + γⁿV(sₜ₊ₙ)**

Longer n moves toward MC. TD(λ) combines n-step returns through exponentially
weighted eligibility traces; forward and backward views connect under conditions.

## 7. On-policy versus off-policy

- behavior policy μ generates data;
- target policy π is evaluated/improved.

On-policy: μ=π including exploration. Off-policy: learn π from μ data. Off-policy
correction may use importance ratio:

> **ρₜ = π(aₜ|sₜ) ÷ μ(aₜ|sₜ)**

Products of ratios over long horizons have high variance. Clipping/truncation lowers
variance but introduces bias. Coverage is essential: no estimator can reliably
evaluate actions never represented without strong model assumptions.

## 8. SARSA, Expected SARSA, and Q-learning

SARSA on-policy:

> **Q(s,a) ← Q(s,a) + α[r + γQ(s′,a′) − Q(s,a)]**

Expected SARSA replaces next sampled action with expectation under target policy.

Q-learning off-policy:

> **Q(s,a) ← Q(s,a) + α[r + γ maxₐ′Q(s′,a′) − Q(s,a)]**

In tabular settings with suitable exploration/step assumptions they have convergence
results. With function approximation, off-policy bootstrapping can diverge—the
deadly triad.

## 9. Exploration

- ε-greedy: random action with ε;
- optimistic initialization;
- softmax/Boltzmann action selection;
- upper-confidence bounds;
- Thompson/posterior sampling;
- count/pseudo-count bonuses;
- curiosity/intrinsic prediction error;
- entropy regularization;
- parameter/noisy-network exploration.

Exploration policy is a safety decision. Random actions can harm people/equipment.
Use simulator, shields, constrained actions, staged traffic, and human approval.

## 10. Multi-armed and contextual bandits

Bandits optimize immediate rewards without modeled state transition.

Regret after T steps:

> **regret = reward of best comparator policy − collected reward**

### UCB intuition

Choose action with high estimated mean plus uncertainty bonus, commonly shrinking
with action count and growing logarithmically with total trials.

### Thompson sampling

Sample reward parameters from posterior and choose best under sample. Naturally
balances exploration/exploitation if model/prior are appropriate.

### Contextual bandit

Policy uses context x. Log chosen action probability/propensity and all decision
context for off-policy evaluation. Delayed/censored rewards and nonstationarity need
explicit handling.

## 11. Deep Q-Network (DQN)

Approximate Q(s,a;θ). Target:

> **y = r + γ(1 − terminal) maxₐ′Q(s′,a′; θtarget)**
>
> **L = E[(y − Q(s,a;θ))²]**

Stabilizers:

- replay buffer breaks temporal correlation and reuses samples;
- target network slows target drift;
- reward/observation scaling;
- gradient clipping and robust loss;
- exploration schedule.

Variants:

- Double DQN selects with online and evaluates with target, reducing max bias;
- dueling architecture separates state value and relative advantages;
- prioritized replay samples high-TD-error transitions with correction;
- n-step returns improve propagation;
- distributional RL models return distribution rather than mean;
- noisy networks provide learned parameter-space exploration.

Each changes bias/variance and implementation. Reproduce vanilla DQN first.

## 12. Distributional RL

Instead of expected return Q, learn random return distribution Z(s,a), while:

> **Q(s,a) = E[Z(s,a)]**

Categorical or quantile methods approximate distribution. This can improve learning
and enables risk-sensitive decisions, but distributional Bellman projection and
off-policy behavior require care. Do not confuse return uncertainty with epistemic
model uncertainty.

## 13. Policy-gradient theorem

For differentiable policy:

> **∇θJ = Eπ[Σₜ ∇θ log πθ(aₜ|sₜ) Qπ(sₜ,aₜ)]**

REINFORCE replaces Q with sampled return. Subtracting a state-dependent baseline
b(s) does not bias expectation:

> **∇θJ ≈ Σₜ ∇θ log πθ(aₜ|sₜ)[Gₜ − b(sₜ)]**

Correct sign, termination, discount weighting, log probability, and detached
advantage are common bugs.

## 14. Actor–critic

Actor πθ chooses actions; critic Vφ or Qφ estimates value to reduce variance and
bootstrap. Update critic with TD target and actor with advantage estimate.

- A2C: synchronous parallel actor–critic;
- A3C: asynchronous workers update shared parameters (historically important);
- generalized advantage estimation (GAE) balances bias/variance.

GAE:

> **δₜ = rₜ + γV(sₜ₊₁) − V(sₜ)**
>
> **Âₜ = δₜ + γλδₜ₊₁ + (γλ)²δₜ₊₂ + …**

Mask terminal versus time-limit truncation correctly. Bootstrapping at artificial
time limits can differ from true terminal states.

## 15. Trust regions and PPO

Large policy updates invalidate on-policy data and can collapse performance. TRPO
constrains average KL using second-order approximations. PPO uses simpler clipped
surrogate or KL-penalty approaches.

> **ρₜ = πθ(aₜ|sₜ) ÷ πold(aₜ|sₜ)**
>
> **Lclip = E[min(ρₜÂₜ, clip(ρₜ,1−ε,1+ε)Âₜ)]**

Training includes value loss and often entropy bonus. Monitor:

- approximate KL;
- clip fraction;
- policy/value losses;
- entropy;
- explained variance;
- advantage/return scales;
- episode length/reward components;
- importance ratios.

Multiple epochs over a rollout increase sample reuse but move farther off-policy.
Normalize advantages carefully and keep old log probabilities fixed.

## 16. Continuous-control algorithms

### DDPG

Deterministic actor μ(s), off-policy critic Q(s,a), target networks, replay, and
action noise. Sensitive to Q overestimation/hyperparameters.

### TD3

Uses twin critics (minimum target), delayed actor updates, and target action
smoothing to reduce overestimation/exploitation of critic error.

### Soft Actor-Critic (SAC)

Maximizes reward plus entropy:

> **J = E[Σₜ γᵗ(rₜ + α H(π(·|sₜ)))]**

Off-policy actor–critic with twin Q in common implementation. Temperature α can be
tuned to target entropy. Strong sample efficiency and exploration, but reward/action
scales, squashed distributions, log-prob Jacobian, and terminal handling matter.

## 17. Model-based RL

Learn or use transition/reward model, then plan or generate synthetic experience.

- Dyna alternates real experience, model learning, and simulated updates;
- model predictive control repeatedly plans over horizon and executes first action;
- world-model agents learn latent dynamics and optimize policy/plans within them;
- Monte Carlo Tree Search expands a search tree guided by value/policy/model.

Model bias compounds when policy exploits inaccurate dynamics. Use uncertainty,
short horizons, ensembles, real-data grounding, and out-of-distribution detection.

## 18. Planning and search

Value iteration is planning with known model. For large spaces:

- heuristic search/A* for deterministic structured tasks;
- MCTS balances exploration and value estimates;
- trajectory optimization and MPC for continuous dynamics;
- learned value/policy guides search;
- model sampling approximates future outcomes.

Search compute can improve action quality at inference but changes latency/cost and
requires a trustworthy simulator/model.

## 19. Imitation learning

### Behavioral cloning

Supervised policy learning from expert (s,a) pairs. Simple but suffers covariate
shift: small errors lead to states absent from expert data.

### DAgger

Iteratively run learner, query expert on visited states, aggregate data. Reduces
distribution mismatch but requires safe expert intervention.

### Inverse RL

Infer a reward explaining demonstrations; reward may be non-identifiable and can
generalize poorly.

### GAIL-like adversarial imitation

Train discriminator to distinguish expert/learner occupancy and policy to fool it.
Inherits adversarial optimization and reward ambiguity.

## 20. Offline RL

Learn from a fixed dataset without new exploration. Core problem: policy selects
out-of-distribution actions whose values are overestimated.

Approaches:

- behavioral cloning baseline;
- constrain policy near behavior;
- conservative Q-learning penalizes high unseen-action values;
- implicit Q-learning avoids directly querying arbitrary out-of-distribution
  actions in its value learning recipe;
- advantage-weighted regression selects better logged actions;
- model-based offline RL penalizes uncertain rollouts.

Report dataset coverage, behavior policies, trajectory quality, and support. A high
offline estimated value is not deployment proof.

## 21. Off-policy evaluation (OPE)

### Importance sampling

Trajectory ratio:

> **w = Πₜ π(aₜ|sₜ) ÷ μ(aₜ|sₜ)**

Unbiased under assumptions but often enormous variance. Per-decision and weighted/
self-normalized variants trade properties.

### Direct/model estimator

Estimate value with a learned model/Q; low variance but biased by model error.

### Doubly robust

Combines model estimate with importance-weighted residual; remains dependent on
coverage and at least one component’s correctness conditions.

### Fitted Q evaluation

Learn Q for fixed target policy using logged transitions. Function approximation
and extrapolation can bias.

Use multiple estimators, confidence intervals, overlap diagnostics, and conservative
online validation.

## 22. Constrained and safe RL

Constrained MDP tracks costs c in addition to reward:

> **maximize expected return subject to expected discounted cost ≤ limit**

Methods include Lagrangian penalties, constrained policy optimization, action
shields, control barrier methods, risk-sensitive/CVaR objectives, and safe
exploration.

Expected constraints can hide rare catastrophic events. Add hard deterministic
guards, scenario testing, human override, and incident response. A learned safety
critic is not an absolute boundary.

## 23. Hierarchical RL

Temporal abstraction uses skills/options:

- initiation set;
- intra-option policy;
- termination condition;
- high-level policy selects option.

Can improve exploration/credit assignment in long tasks, but skill discovery,
nonstationarity, and boundary learning are hard. Agent tool use can be viewed as
hierarchical actions, but ordinary planning/workflow code may be easier to verify.

## 24. Multi-agent RL

Multiple learning agents make environment nonstationary from each agent’s view.
Settings are cooperative, competitive, or mixed. Concepts:

- centralized training with decentralized execution;
- joint value factorization;
- self-play and population training;
- opponent modeling;
- equilibrium/exploitability rather than one reward curve;
- communication and credit assignment.

Avoid evaluating only against training opponents; use held-out populations and
adversarial strategies.

## 25. Partial observability

In a POMDP, observation o does not reveal full state. Policy may use history,
recurrent state, belief distribution, or external memory. Train/evaluate with state
reset, hidden information, observation delays, and recurrent replay sequences.

Leaking simulator state into policy features produces unrealistic results.

## 26. Reward specification and hacking

Goodhart’s law: when a proxy becomes a target, optimization exploits its gaps.

Examples:

- agent reaches goal by crashing simulator;
- robot moves sensor instead of object;
- LM edits tests or guesses formatting signal;
- recommender maximizes clicks through harmful content;
- model prolongs episode to farm shaping reward.

Defenses:

- independent outcome metrics and hidden tests;
- adversarial environment/reward review;
- reward component logging and caps;
- causal checks and counterfactuals;
- human oversight for high-impact actions;
- constraints and sandbox;
- evaluate optimization beyond intended range.

## 27. RL implementation checklist

- exact environment version and seeding;
- distinguish terminated from truncated;
- observation/reward normalization state checkpointed;
- action bounds and squashed log-prob correction;
- replay sampling and priorities reproducible;
- target network update convention;
- no gradients through target/advantage where unintended;
- on/off-policy data and old log probabilities correct;
- evaluation policy deterministic/stochastic as declared;
- multiple seeds and learning curves, not best seed;
- environment steps, wall time, compute, and sample efficiency;
- videos/trajectories and reward components inspected.

## 28. RL for language models

Language generation is a very large discrete sequential action problem, though many
RLHF setups assign reward only after a response and can resemble contextual bandit
feedback at the sequence level. Tokens still produce long-horizon credit and policy
ratio issues.

Connect concepts:

- policy = language model;
- action = token/tool action;
- state = prompt plus generated history/environment;
- reward = human/AI model/verifier/environment outcome;
- reference policy = behavior constraint/KL anchor;
- rollout engine = environment sampling system;
- PPO/GRPO/RLOO = policy-gradient estimators/optimizers;
- DPO = offline preference optimization rather than online environment RL.

Understand general RL before tuning an acronym-specific trainer.

## 29. Practical labs

1. Solve a tabular MDP with value/policy iteration and verify Bellman residual.
2. Compare SARSA and Q-learning in a risky exploration environment.
3. Implement DQN with replay/target, then add Double DQN and one ablation.
4. Implement REINFORCE, GAE actor–critic, and PPO on the same environment.
5. Compare TD3 and SAC on a continuous-control toy task.
6. Build contextual bandit with logged propensities and OPE.
7. Run offline RL versus behavioral cloning under deliberately poor coverage.
8. Design reward-hacking tests for a tool-using language agent.

## 30. Primary references

- [Sutton and Barto, Reinforcement Learning: An Introduction](http://incompleteideas.net/book/the-book-2nd.html)
- [DQN](https://www.nature.com/articles/nature14236)
- [Proximal Policy Optimization](https://arxiv.org/abs/1707.06347)
- [Soft Actor-Critic](https://arxiv.org/abs/1801.01290)
- [Conservative Q-Learning](https://arxiv.org/abs/2006.04779)
- [Implicit Q-Learning](https://arxiv.org/abs/2110.06169)

Reproduce simple baselines before complex variants; RL results are unusually
sensitive to implementation details and evaluation selection.
