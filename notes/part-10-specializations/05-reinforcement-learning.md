# Track 5 — Reinforcement Learning and Bandits

## 1. RL setup

Agent observes state s<sub>t</sub>, selects action a<sub>t</sub>, receives reward
r<sub>t+1</sub>, transitions to s<sub>t+1</sub>.

Markov decision process (MDP): (S, A, P, R, γ).

- transition P(s′ ∣ s,a);
- reward distribution;
- discount γ ∈ [0,1);
- policy π(a ∣ s).

Return:

> G<sub>t</sub> = Σ<sub>k=0</sub><sup>∞</sup> γᵏr<sub>t+k+1</sub>

## 2. Value functions

> V<sup>π</sup>(s) = E<sub>π</sub>[G<sub>t</sub> ∣ s<sub>t</sub>=s]  
> Q<sup>π</sup>(s,a) = E<sub>π</sub>[G<sub>t</sub> ∣ s<sub>t</sub>=s,a<sub>t</sub>=a]

Advantage:

> A<sup>π</sup>(s,a) = Q<sup>π</sup>(s,a) − V<sup>π</sup>(s)

Bellman expectation:

> V<sup>π</sup>(s) = E[r + γV<sup>π</sup>(s′)]

Optimality:

> Q*(s,a) = E[r + γ max<sub>a′</sub>Q*(s′,a′)]

## 3. Dynamic programming

Known finite model:

- policy evaluation via Bellman updates;
- policy improvement greedy Q;
- policy iteration;
- value iteration.

Tabular exact/iterative; state explosion motivates function approximation/sampling.

## 4. Monte Carlo and TD

Monte Carlo learns from complete returns: unbiased-ish under sampling but high
variance, episodic delay.

TD(0):

> V(s) ← V(s) + α[r + γV(s′) − V(s)]

TD error δ = r + γV(s′) − V(s). Bootstraps: lower variance, bias, online.

n-step/TD(λ) trade horizon.

## 5. Q-learning and SARSA

Q-learning off-policy:

> Q(s,a) ← Q(s,a) + α[r + γ max<sub>a′</sub>Q(s′,a′) − Q(s,a)]

SARSA on-policy target uses actual next action Q(s′,a′). Under exploration SARSA
learns safer exploratory path; Q-learning target greedy.

## 6. Exploration

- ε-greedy;
- decaying ε;
- optimistic values/UCB;
- Thompson sampling;
- entropy bonuses;
- intrinsic motivation.

Exploration can harm users/systems. Use simulators, constraints, conservative
policies, approval, offline evaluation, phased rollout.

## 7. Multi-armed/contextual bandits

Bandit has immediate reward, no modeled long-term state transition. Regret:

> cumulative difference from best policy/action

Algorithms ε-greedy, UCB, Thompson; contextual bandit π(a∣x). Log action propensity
for off-policy evaluation. Bandits suit recommendations/notifications when delayed
long-term effects small or approximated; otherwise MDP.

## 8. Deep Q Network (DQN)

Neural Q, replay buffer, target network. Loss:

> [r + γ max<sub>a′</sub>Q<sub>target</sub>(s′,a′) − Q<sub>online</sub>(s,a)]²

Replay breaks correlations/reuses; target stabilizes moving target. Improvements:
Double DQN reduces maximization overestimation, prioritized replay, dueling network.

Deadly triad: function approximation + bootstrapping + off-policy can diverge.

## 9. Policy gradients

Objective J(θ)=expected return. REINFORCE:

> ∇J ≈ Σ ∇ log π<sub>θ</sub>(a<sub>t</sub>∣s<sub>t</sub>) · G<sub>t</sub>

Subtract baseline V(s) reduces variance without bias when independent of action:
advantage actor–critic.

High variance/sample cost; entropy supports exploration.

## 10. PPO concept

Use probability ratio r<sub>t</sub>(θ) = π<sub>θ</sub>(a∣s)/π<sub>old</sub>(a∣s).
Clipped surrogate limits overly large policy update:

> min[rA, clip(r,1−ε,1+ε)A]

plus value/entropy terms. PPO practical but sensitive to reward, advantage
normalization, batch/epochs, clipping, KL, implementation.

## 11. Actor–critic and continuous control

Actor policy, critic value. DDPG/TD3 deterministic continuous actions; SAC
stochastic entropy-regularized objective, robust exploration. Off-policy replay
sample efficient but distribution/instability.

## 12. Reward design

Proxy reward can be hacked:

- engagement → addiction/clickbait;
- speed → unsafe behavior;
- score → exploit evaluator;
- sparse terminal → hard credit assignment.

Use multi-signal/constraints, human feedback, adversarial evaluation, and monitor
real outcomes. Reward model is not ground truth.

## 13. Offline RL

Learn from logged fixed dataset, no exploration. Distributional shift: policy
chooses actions unsupported by data and Q extrapolates optimistically. Conservative
methods constrain to behavior/support. Off-policy evaluation:

- importance sampling (high variance);
- model-based simulation (model bias);
- fitted Q evaluation;
- doubly robust.

Requires logged behavior probabilities/coverage and prospective cautious validation.

## 14. Safety and deployment

- action constraints/shields;
- safe exploration;
- human approval;
- simulation/domain randomization;
- conservative fallback;
- distribution/OOD detection;
- reward/behavior monitoring;
- rollback;
- delayed long-term harm;
- adversarial manipulation.

RL often unnecessary if supervised prediction + optimization/rules solves decision.

## 15. Exercises

1. Solve small MDP with value iteration.
2. Compare SARSA/Q-learning cliff walking.
3. Implement contextual bandit and regret/off-policy logging.
4. Derive policy gradient baseline effect.
5. Critique a reward and design safety constraints.

