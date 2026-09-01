# Chapter 7 — Slurm and HPC Fundamentals

Slurm is a workload manager common on high-performance computing and research
clusters. It tracks resources, queues jobs under policy, allocates nodes, launches
steps/tasks, and records accounting. Site configuration is authoritative; resource
names and launch integrations vary.

## 1. Cluster vocabulary

- node: compute machine managed by Slurm;
- partition: named set/policy grouping of nodes, often called queue informally;
- job: resource request and workload submitted to scheduler;
- allocation: granted resources for a job;
- job step: work launched within an allocation, commonly through `srun`;
- task: process/rank launched as part of a step;
- account/QOS/association: policy, charging, limits, priority/fair-share context;
- GRES/TRES: trackable resources such as GPUs and aggregate resource accounting;
- reservation/constraint/feature: availability or node selection mechanisms.

## 2. Submit, allocate, and launch

```bash
sbatch job.sh
salloc --time=00:30:00 --cpus-per-task=4 --mem=8G
srun hostname
```

`sbatch` submits a script to run later. `salloc` requests interactive allocation;
commands still need correct launch/placement. `srun` creates a job step or submits/
launches according to context. Running a command directly on a login node or inside
an allocation without `srun` can violate site policy or fail to use allocated task
placement.

## 3. Resource requests

Common dimensions include nodes, tasks, tasks per node, CPUs per task, memory (per
node or CPU depending option), generic/GPU resources, time, partition, account,
QOS, constraints, and exclusive/shared use.

Distinguish:

- number of processes/ranks (`ntasks`);
- threads/CPU cores needed by each process (`cpus-per-task`);
- nodes across which tasks are distributed;
- accelerator allocation and binding;
- memory scope of the selected option.

Over-requesting increases queue time/wastes capacity; under-requesting causes
throttling/OOM/timeout. Measure peak and actual utilization.

## 4. Batch script anatomy

```bash
#!/usr/bin/env bash
#SBATCH --job-name=example
#SBATCH --time=00:20:00
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=8G
#SBATCH --output=logs/%x-%j.out

set -euo pipefail
srun python -m app.batch --config configs/example.yaml
```

Directives are parsed by `sbatch` only before the script’s first ordinary commands
according to syntax. Shell variables inside directive lines are not ordinary
runtime expansion. Create output directory before submission or follow site rules;
Slurm opens output before script commands run.

## 5. Observe state

```bash
squeue -u USER
scontrol show job JOB_ID
sacct -j JOB_ID --format=JobID,State,Elapsed,ExitCode,AllocTRES,MaxRSS
sinfo
```

Common states include Pending, Running, Completing, Completed, Failed, Cancelled,
Timeout, OutOfMemory, Preempted, and NodeFail. State names/reasons vary. A Pending
reason such as priority, dependency, resources, reservation, QOS/limit, or node
unavailability guides action; repeatedly cancel/resubmit may lose priority and
hide the constraint.

Accounting may lag and child steps have separate records. Exit code combines
process and signal information; interpret job and step records.

## 6. Job arrays and parameter work

Arrays represent many similar jobs with indexed environment/state:

```bash
#SBATCH --array=0-99%10
```

Limit concurrent elements to protect cluster/downstream systems. Map index to a
versioned manifest/config table, validate bounds, make outputs unique/idempotent,
and distinguish failed/preempted from legitimately poor experiment results.

## 7. Dependencies

Submit jobs conditional on states such as successful completion or any completion.
Dependency syntax and handling vary. A DAG should account for partial arrays,
failure propagation, retries, idempotency, and artifact completeness—dependency
only reflects scheduler state, not scientific validity.

## 8. Environment, modules, and containers

Batch jobs start with non-interactive environment and site-specific export rules.
Record modules, paths, environment, code and container identity. Environment modules
modify variables to select compilers/libraries; order/conflicts matter.

Clusters may use Apptainer/Singularity, Pyxis/Enroot, OCI integration, or no
containers. Follow supported launcher/device/network/storage templates. A Docker
command from a laptop is not automatically valid on HPC.

## 9. Signals, time limits, preemption, and requeue

Slurm can signal before time limit/preemption. Applications should checkpoint at
safe boundaries within remaining time, publish atomically, and exit meaningfully.
Requeue/restart must restore exact compatible state and avoid duplicating side
effects. A scheduler retry without application idempotency corrupts results.

Cancellation:

```bash
scancel JOB_ID
```

Confirm exact job/array target and whether cancellation is authorized/desired.

## 10. Fair share, priority, and etiquette

Priority can combine age, fair-share usage, job size, partition/QOS, reservations,
and site factors. More jobs do not create more capacity. Use arrays, concurrency
limits, realistic time/resource requests, cleanup, local scratch, and recommended
data patterns. Do not run heavy work on login nodes.

## 11. Storage and data movement

Home, project/shared filesystem, scratch, local node NVMe, and object storage have
different quota, performance, durability, backup, and cleanup. Stage large sequential
shards rather than millions of metadata operations; avoid simultaneous checkpoint
storms; copy only complete outputs and verify. Know purge policy for scratch.

## 12. Multi-process and MPI/distributed launching

Slurm can place tasks and expose rank/node information. MPI/framework launchers may
integrate through PMI/PMIx or start local workers themselves. Avoid double spawning.
Verify hostname, global/local rank, CPU/GPU binding, world size, network interface,
and one intended process per device in a smoke job.

## 13. Troubleshooting matrix

| Symptom/state | First evidence |
|---|---|
| Pending long | `Reason`, requested constraints/TRES, partition/account/QOS |
| exits immediately | output/error, script executable/shell, path/env/module, exit code |
| OOM | state/accounting peak, request scope, cgroup/job-step, application peak |
| timeout | time limit and phase timings/checkpoint behavior |
| underuses CPUs | tasks/threads/binding, BLAS/OpenMP and data bottleneck |
| GPU missing | allocation/GRES, binding/visibility, site container integration |
| one node fails | NodeFail/events, coordinated job behavior, checkpoint completeness |
| output absent | output path existed at submit/start, quota/permissions, buffering |

## 14. Slurm lab

In an authorized cluster or through paper simulation, submit one batch job, an
interactive allocation, an array with concurrency limit, and a dependent validation
job. Inspect pending/running/history, resource utilization and exit codes. Inject
nonzero exit, OOM/time limit conceptually, signal-aware checkpoint, and incomplete
artifact; write the recovery decision.

## 15. Exit questions

Explain job versus step versus task, node versus partition, `sbatch` versus `salloc`
versus `srun`, task versus CPU per task, pending reason versus state, array versus
loop, dependency versus data validity, account/QOS/fair share, scratch versus home,
and why site launch guidance overrides a copied internet script.

