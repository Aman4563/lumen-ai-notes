# Chapter 2 — Git Internals, Collaboration, and Reproducibility

> **Placement:** Read after Chapter 1, then complete the recovery lab in Chapter 4.

## 1. Why frontier research needs strict version control

Large experiments are expensive and results influence months of work. Git is not
only a backup tool; it establishes exactly which source snapshot produced an
artifact. Code, however, is only one part of reproducibility. A useful run identity
also includes data, configuration, dependencies, hardware/runtime, and evaluator.

```text
run identity = source commit + resolved config + data manifest
             + environment/container + hardware/runtime + random state
```

Never use a human branch name such as `main` as immutable provenance. Store the
commit object ID and whether the worktree had uncommitted changes.

## 2. Git’s object model

Git is a content-addressed object database plus references.

- **blob:** file contents, not the filename;
- **tree:** mapping from names to blobs/subtrees plus modes;
- **commit:** root tree, parent commit(s), author/committer metadata, message;
- **tag object:** annotated, optionally signed name for another object;
- **reference:** movable name such as a branch pointing to an object ID;
- **HEAD:** symbolic reference or direct detached commit selection.

Commit IDs change if any reachable content or metadata changes. A branch is not a
container of commits; it is a movable pointer to one commit, whose parents describe
history.

```text
o---o---A---B  main
         \
          C---D  experiment/router-loss
```

Merging can create a commit with both B and D as parents. Rebasing D onto B creates
new commits with new object IDs; it does not move the original commit objects.

## 3. Working tree, index, and commit

Three states explain most Git behavior:

```text
working tree -- git add --> index -- git commit --> repository
```

![Official Pro Git diagram of the working tree, staging area, and Git directory](https://git-scm.com/book/en/v2/images/areas.png)

*Web visual: [Pro Git, “What is Git?”](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F),
licensed under CC BY-NC-SA 3.0. The text diagram above is the offline fallback.*

- working tree: current editable files;
- index/staging area: proposed content for the next commit;
- HEAD commit: committed snapshot currently checked out.

Inspect intentionally:

```bash
git status --short
git diff                 # working tree versus index
git diff --staged        # index versus HEAD
git diff HEAD            # working tree/index result versus HEAD
git log --oneline --graph --decorate --all
```

Stage by hunk when a file contains unrelated changes:

```bash
git add --patch path/to/file.py
git diff --staged
```

Atomic commits isolate one coherent reason for change. “Refactor data loader” and
“change training mixture” should normally be separate because one is behavioral
infrastructure and the other is a scientific intervention.

## 4. Branching workflow for experiments

Use short-lived branches for changes that may merge. Give experiments immutable
run IDs rather than keeping thousands of long-lived branches.

A healthy flow:

1. update local knowledge using `git fetch`;
2. create branch from an explicit base commit;
3. implement with tests and small verified commits;
4. sync with target branch according to team policy;
5. review the entire branch diff, not only the last commit;
6. run fast and integration validation;
7. merge through reviewed pull request;
8. preserve run metadata independently from branch cleanup.

Commands:

```bash
git switch --create experiment/router-loss origin/main
git log --left-right --cherry-pick --oneline origin/main...HEAD
git diff --stat origin/main...HEAD
```

The three-dot diff compares the merge base to the branch tip, often matching pull-
request intent. Two-dot history/diff semantics differ; understand the command you
are reviewing.

## 5. Merge, rebase, cherry-pick, and revert

### Merge

Combines histories using their merge base. It preserves topology and may produce a
merge commit. Good when the topology matters or commits are already shared.

### Rebase

Replays a series of changes onto a new base, creating new commits. Useful to clean
local history, but rewriting shared history disrupts collaborators and invalidates
recorded commit IDs.

```bash
git fetch origin
git rebase origin/main
```

During a conflict, understand base/ours/theirs semantics for the operation; do not
blindly accept one side. Resolve the intended final behavior, stage it, continue,
and rerun tests.

### Cherry-pick

Applies the change represented by selected commit(s) to the current branch,
creating new commit(s). Use for deliberate backports, not as a default method of
moving arbitrary history.

### Revert

Creates a new commit that undoes an earlier change. It is appropriate for shared
history and preserves auditability. Reverting a merge requires selecting the main
parent and understanding future-merge consequences.

## 6. Restore, reset, clean, and reflog

These commands have different risk:

- `git restore`: copy content into working tree and/or index;
- `git reset`: move a reference and optionally reset index/working tree;
- `git clean`: remove untracked files;
- `git reflog`: local record of recent reference movements.

Before any destructive variant, inspect exact paths and status. Prefer a commit,
stash, patch, or worktree when uncertain. `reflog` can recover reachable commits
after an accidental branch move, but it is local and subject to expiry; it is not a
backup or artifact registry.

## 7. Interactive rebase for reviewable history

Before sharing, interactive rebase can reorder, edit, squash, or split local
commits:

```bash
git rebase --interactive origin/main
```

Use it to make reasoning reviewable, not to hide failed experiments that are
scientifically important. Experimental outcomes belong in the tracker/report even
if temporary implementation commits are cleaned.

## 8. Debugging with bisect and blame

`git bisect` performs binary search over commits using a good/bad predicate:

```bash
git bisect start
git bisect bad HEAD
git bisect good known-good-tag
git bisect run ./scripts/reproduce_regression.sh
git bisect reset
```

The predicate must be deterministic enough to classify a commit. For stochastic
ML regressions, use a fast invariant, a fixed fixture, or repeated statistical
criterion rather than a noisy full benchmark.

`git blame` finds the commit last touching each line. It is a navigation tool, not
a reliable assignment of responsibility; refactors and moved code distort it.

## 9. Worktrees for parallel experiments

Linked worktrees share the object database and most refs while providing separate
working directories:

```bash
git worktree add ../run-router experiment/router-loss
git worktree list
```

They are safer than repeatedly switching a dirty directory and lighter than full
clones. Each branch can normally be checked out in only one worktree. Keep generated
data and secrets outside worktrees or explicitly ignored.

## 10. Submodules, subtrees, and monorepos

### Submodule

The parent repository records another repository’s commit as a gitlink. It
preserves independent history and exact dependency revision, but clone/update,
detached HEAD, permissions, and recursive commands create operational complexity.

### Subtree/vendor copy

Imports another tree into the repository. Easier checkout, harder upstream sync
and history separation.

### Package dependency

Publish versioned packages/images where interfaces are stable. This often avoids
source-level coupling.

### Monorepo

Enables atomic cross-component changes and shared tooling, but requires ownership,
test selection, build caching, access control, and repository-scaling strategy.

Choose from organizational boundaries and change coupling, not fashion.

## 11. Large data and model artifacts

Ordinary Git is poor for frequently changing multi-gigabyte checkpoints and data.

- Git LFS stores pointer files in Git and content in an LFS store; cloning still
  requires correct LFS availability and retention.
- Object storage plus immutable manifest is common for datasets/checkpoints.
- A model/experiment registry adds metadata, aliases, approvals, and lineage.
- Data-versioning tools can map logical dataset versions to object-store content.

Never overwrite the bytes behind an immutable artifact URI. Store checksum, size,
schema/format, producer run, and access policy. A model alias such as `candidate`
may move; the resolved artifact digest must not.

## 12. Secrets and sensitive material

`.gitignore` prevents future untracked addition; it does not remove history.
Prevention:

- secret manager and short-lived workload identity;
- pre-commit and server-side scanning;
- least-privilege repository access;
- generated config with secret references, not values;
- review logs/notebooks/test fixtures for copied data.

If a secret is committed, revoke/rotate it first. History rewriting may reduce
exposure but cannot prove that existing clones, caches, logs, or forks forgot it.

## 13. Signed, reviewed, and attributable changes

Organizations may require signed commits/tags, protected branches, mandatory
reviews, status checks, provenance attestations, and CODEOWNERS. These controls
provide evidence and policy enforcement; they do not prove code correctness.

Review an ML change across:

- algorithm and tensor shapes;
- data and label semantics;
- numerical stability and precision;
- distributed behavior and deterministic aggregation;
- checkpoint compatibility and migration;
- memory/throughput/cost;
- evaluation contamination and metric validity;
- security, privacy, and licensing;
- logs, alerts, and rollback.

## 14. Dependency environments

### What must be pinned

- Python and accelerator runtime compatibility;
- direct and transitive Python packages through a lock;
- system libraries/compilers when behavior depends on them;
- container base image by digest for a promoted artifact;
- model/tokenizer/data revisions;
- driver/runtime constraints documented separately from image contents.

Exact pins increase reproducibility but delay security patches. Use an explicit
update process: renovate dependencies, run compatibility/evaluation suites, build a
new immutable artifact, and promote it. Never mutate a production image in place.

### Environment tools

`venv` provides isolation; pip/uv/Poetry/Conda-like tools resolve/install; Nix-like
systems can describe broader environments; containers package filesystem and
metadata. None independently captures data, hardware, randomness, or external
services.

## 15. Configuration management

A resolved configuration should be a typed, immutable input to the run.

```yaml
model:
  hidden_size: 1024
  layers: 24
data:
  manifest: object://datasets/corpus/sha256-...
training:
  tokens: 1000000000
  precision: bf16
  seed: 1729
```

Hydra-style composition can manage config groups/sweeps, but hidden defaults and
interpolation can make a run hard to read. Always materialize the fully resolved
config and validate illegal combinations before allocating GPUs.

## 16. Experiment tracking and registries

MLflow, Weights & Biases, or an internal tracker should record structured metrics
and artifacts, not replace source control. Track:

- immutable run ID and parent/sweep relation;
- Git commit and patch/dirty hash;
- data/evaluator/artifact versions;
- config and environment;
- scalar curves and distributions;
- checkpoints and profiles;
- status, owner, purpose, conclusion;
- lineage from run to registered model.

Aliases such as `champion` are operational references. Resolve and log the concrete
version/digest at deployment and prediction time.

## 17. CI for research repositories

Suggested tiers:

1. formatting, linting, types, secret/license scan;
2. unit/property/numerical gradient tests;
3. CPU tiny end-to-end training/eval;
4. single-GPU compatibility and deterministic fixture;
5. multi-GPU collective/checkpoint test;
6. scheduled nightly benchmark and quality regression;
7. manual high-cost reproduction or release gate.

Do not require a costly full training run on every change. Build high-signal tiny
tests for the invariants that have caused real failures.

## 18. Practical lab

Create a repository where a two-layer transformer experiment can be reproduced by
another person from one documented command. Deliver:

- atomic history with reviewed branch;
- locked environment and resolved config;
- data manifest with checksum;
- CI tiny-train and checkpoint round-trip;
- run tracker entry linked to commit;
- `git bisect` script detecting an injected masking bug;
- recovery note showing how an accidental branch deletion was diagnosed.

## 19. Primary references

- [Git user manual](https://git-scm.com/docs/user-manual)
- [Git worktree documentation](https://git-scm.com/docs/git-worktree)
- [Git submodules documentation](https://git-scm.com/docs/gitsubmodules)
- [MLflow experiment tracking](https://mlflow.org/docs/latest/ml/tracking)

Verify commands against the installed Git/tool versions and team policy.
