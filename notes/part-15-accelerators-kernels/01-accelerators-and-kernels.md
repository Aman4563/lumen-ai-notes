# Chapter 1 — Accelerator Architecture, CUDA, Triton, and Profiling

## 1. Performance begins with a bottleneck model

Do not optimize because an operation “looks expensive.” Measure whether the step is
limited by compute, memory bandwidth, communication, CPU launch/data work, or
synchronization.

> **arithmetic intensity = useful operations ÷ bytes transferred from a memory level**

An operation with low arithmetic intensity is often bandwidth-bound; a dense matrix
multiplication with sufficient reuse may be compute-bound. The roofline idea bounds
attainable performance by the lesser of:

> **peak compute throughput**
>
> **memory bandwidth × arithmetic intensity**

Real kernels are additionally limited by occupancy, dependencies, instruction mix,
tensor shapes, and software overhead.

## 2. GPU execution hierarchy

Using NVIDIA terminology as a concrete model:

- a GPU contains streaming multiprocessors (SMs);
- a kernel launches a grid of thread blocks;
- a block is assigned to an SM and contains threads;
- threads execute in warp-sized groups;
- registers are private logical thread state;
- shared memory is fast on-chip storage shared within a block;
- global/HBM memory is large and high bandwidth but higher latency;
- caches and specialized tensor units sit within the hierarchy.

AMD and other accelerators use different names and details; the durable ideas are
groups of lanes, a memory hierarchy, vector/matrix units, and a device program
scheduled in many parallel workgroups.

## 3. SIMT consequences

Single-instruction multiple-thread execution is efficient when lanes take similar
paths. Divergent branches serialize paths within an execution group. Not every
branch is harmful—predication and compiler choices matter—but irregular control
and memory access often reduce efficiency.

Design kernels around:

- enough independent work to occupy the device;
- coalesced/global memory access;
- reused data in registers/shared memory;
- limited synchronization;
- balanced register/shared-memory use;
- shapes aligned with efficient matrix instructions when possible.

## 4. Memory hierarchy and data movement

Approximate hierarchy from fastest/smallest to slowest/largest:

```text
registers -> shared memory / on-chip caches -> HBM/global memory
-> host memory -> local/network storage
```

Performance engineering is often data-movement engineering. A mathematically
identical fused kernel can be faster because it writes fewer intermediate tensors
to HBM and launches fewer kernels.

### Coalescing

Adjacent lanes should access adjacent/aligned addresses so hardware combines
transactions. A transposed or strided access can multiply memory transactions.

### Tiling

Load a block of operands into fast memory, perform many operations, then write a
tile of output. Matrix multiplication and FlashAttention-like algorithms rely on
tiling to increase reuse and control intermediate storage.

### Fusion

Combine compatible elementwise/reduction operations to avoid materializing
intermediates. Fusion can increase register pressure or complicate scheduling, so
measure the full graph rather than assuming a larger fused kernel wins.

## 5. Matrix multiplication as the central workload

For C = AB with A shaped M×K and B shaped K×N:

> **multiply-add work ≈ 2MKN floating-point operations**

Naïve memory access repeatedly reloads values. A tiled implementation loads
submatrices, reuses them for many multiply-accumulates, and maps compatible tiles
to matrix/tensor instructions.

Transformer dimensions and batch/sequence lengths determine whether matrix shapes
are large enough for high utilization. Tiny batch decode GEMMs can be bandwidth or
launch limited even when prefill/training GEMMs use the device well.

## 6. CUDA programming concepts

CUDA C++ exposes kernels, grids/blocks/threads, device memory, streams, events, and
libraries. You need not hand-write every kernel, but should understand:

- kernel launches are normally asynchronous with respect to the host;
- operations in one stream are ordered; different streams may overlap subject to
  dependencies/resources;
- host-device copies can overlap under suitable pinned memory and streams;
- events express timing/dependencies without a full device synchronization;
- an error can surface at a later synchronization, obscuring the originating op;
- allocator behavior and fragmentation influence peak memory.

Correct timing:

1. warm up compilation, caches, and allocator;
2. use device events or profiler;
3. synchronize only at timing boundaries;
4. repeat enough to observe variance;
5. report input shapes, dtypes, hardware, clocks, and software versions.

Calling a wall-clock timer around asynchronous launches without synchronization
measures enqueue time, not execution.

## 7. Libraries before custom kernels

Prefer mature optimized paths when they meet requirements:

- BLAS/GEMM libraries;
- convolution/deep-learning primitive libraries;
- framework scaled-dot-product attention;
- fused normalization, optimizer, and communication libraries;
- compiler-generated kernels.

A custom kernel adds numerical, shape, device, maintenance, and security surface.
Write one when profiling identifies a meaningful bottleneck and existing paths
cannot express or optimize the operation.

## 8. Triton mental model

Triton is a language/compiler for parallel accelerator programs. A program instance
usually handles a block of elements; vectorized block operations and masks express
loads, computation, and stores.

Illustrative vector addition:

```python
import triton
import triton.language as tl

@triton.jit
def add_kernel(x_ptr, y_ptr, out_ptr, n_elements: tl.constexpr,
               block_size: tl.constexpr):
    block = tl.program_id(axis=0)
    offsets = block * block_size + tl.arange(0, block_size)
    mask = offsets < n_elements
    x = tl.load(x_ptr + offsets, mask=mask)
    y = tl.load(y_ptr + offsets, mask=mask)
    tl.store(out_ptr + offsets, x + y, mask=mask)
```

The host selects grid and meta-parameters such as block size. Production kernels
need:

- dtype/device/shape/stride contracts;
- boundary masks and empty inputs;
- numerically stable accumulation;
- autotuning or justified configurations;
- backward implementation if gradients are required;
- reference comparison across randomized/adversarial shapes;
- performance benchmark including compilation and steady state separately.

Triton reduces some CUDA boilerplate; it does not remove hardware reasoning.

## 9. Numerical accuracy in kernels

Test against a higher-precision reference with combined tolerance:

> **|actual − expected| ≤ absolute tolerance + relative tolerance × |expected|**

Also test:

- NaN, infinity, signed zero, and extreme values;
- odd/non-power-of-two sizes and noncontiguous layouts;
- accumulation order sensitivity;
- gradient checks where smooth enough;
- deterministic requirements;
- error behavior for unsupported inputs.

A fast kernel that silently changes the training trajectory requires explicit
quality validation, not only unit tolerance on one tensor.

## 10. Stable softmax example

For logits z:

> **softmax(zᵢ) = exp(zᵢ − m) ÷ Σⱼ exp(zⱼ − m), where m = maxⱼ zⱼ**

Subtracting the row maximum prevents overflow without changing the result in exact
arithmetic. A tiled kernel must combine partial maxima and sums using the correct
online normalization identities. Masked rows require defined behavior; all-invalid
rows otherwise create zero denominators/NaNs.

## 11. Why FlashAttention matters

Standard attention may materialize an L×L score/probability matrix in HBM.
FlashAttention is an exact, IO-aware tiled algorithm that recomputes/combines
statistics so it transfers less data and avoids storing the full matrix. It reduces
memory traffic and intermediate memory; it does not magically remove the all-pairs
arithmetic of dense exact attention.

Validate:

- mask and causal alignment;
- dropout RNG semantics;
- backward correctness;
- supported head dimensions/dtypes;
- long-sequence numerical error;
- whether the framework actually selected the optimized backend.

## 12. PyTorch execution and compilation

PyTorch eager mode launches operators dynamically. `torch.compile`-style systems
capture/transform graphs, fuse operations, and generate/select kernels.

Potential blockers:

- data-dependent Python control flow;
- graph breaks and unsupported operations;
- changing shapes causing recompilation;
- mutation/aliasing;
- custom operators without compiler metadata;
- distributed collectives outside capturable regions.

Measure cold compile time and warm steady state. A benchmark that ignores repeated
recompilation can overstate gains for dynamic workloads.

## 13. Profiling workflow

### Level 1 — application timeline

Split data loading, host-to-device, forward, backward, optimizer, collectives,
checkpoint, and evaluation. Determine whether GPUs wait on CPU/data/ranks.

### Level 2 — operator/kernel

Use framework profiler to inspect operator time, shapes, allocations, and stack.
Look for:

- many tiny kernels;
- unexpected device synchronizations;
- copies/layout conversions;
- fallback/unfused attention;
- repeated compilation;
- memory spikes and retained tensors;
- collectives on the critical path.

### Level 3 — hardware counters

Use Nsight Systems/Compute-like tools or hardware equivalent for kernel timeline,
occupancy, achieved bandwidth, instruction mix, stalls, tensor-unit utilization,
and communication overlap. Profile a bounded representative window; full traces
can distort or overwhelm large jobs.

## 14. Common performance traps

- `.item()`, printing, or CPU conversion every step synchronizes the device;
- Python loop over tokens/elements launches tiny work;
- noncontiguous layout triggers hidden copies;
- small matrix dimensions underutilize tensor units;
- excess padding wastes FLOPs;
- gradient accumulation changes optimizer-step overhead but not all activation
  memory;
- checkpointing saves activation memory while adding recomputation;
- excessive checkpoint frequency stalls all ranks/storage;
- a slow data worker causes distributed stragglers;
- host oversubscription creates context switching and loader contention.

## 15. Precision and hardware units

Hardware may execute FP32, TF32-like, BF16, FP16, FP8, integer, or lower-precision
matrix operations at very different rates. Storage dtype, compute dtype,
accumulation dtype, and communication dtype can differ.

Lower precision reduces bytes and can increase throughput, but requires attention
to dynamic range, rounding, scaling, reductions, and sensitive operations. The
training-optimization chapter treats these choices in depth.

## 16. Communication kernels and overlap

Distributed training adds collectives such as all-reduce, all-gather, reduce-
scatter, all-to-all, and point-to-point sends. Performance depends on message size,
topology, algorithm, concurrent compute, and rank skew.

Overlap is possible only when:

- dependencies permit communication to start early;
- compute and communication use resources without destructive contention;
- buckets/chunks are sized well;
- CPU launch and streams are scheduled correctly;
- all ranks reach comparable points.

A trace should prove overlap; asynchronous API calls alone do not.

## 17. Other accelerators and frameworks

### JAX/XLA and TPUs

JAX traces pure array programs for compiler transformation. Arrays can be sharded
over a device mesh; XLA lowers/fuses operations. Learn JIT static/dynamic shape
constraints, functional RNG keys, sharding specifications, and compiler inspection.

### AMD/ROCm

ROCm/HIP and RCCL provide an alternative GPU stack. Kernel availability, dtype
support, profilers, and library behavior differ; avoid assuming CUDA-specific code
is portable.

### CPU inference/training

Vectorization, cache locality, NUMA placement, threading, quantized instructions,
and memory bandwidth dominate many CPU workloads. CPUs remain important for data
processing, retrieval, small models, orchestration, and fallback serving.

## 18. Kernel development checklist

- [ ] bottleneck demonstrated in an end-to-end profile;
- [ ] exact mathematical and layout contract documented;
- [ ] trusted reference implementation;
- [ ] randomized/property/gradient/extreme tests;
- [ ] multiple realistic shapes/dtypes/devices;
- [ ] compile and warm execution measured separately;
- [ ] achieved bandwidth/FLOPs and end-to-end benefit measured;
- [ ] fallback path and unsupported-input behavior;
- [ ] quality regression and determinism implications evaluated;
- [ ] maintenance owner and upstream-library comparison.

## 19. Practical labs

1. Benchmark elementwise, reduction, and matrix operations; classify each with a
   roofline-style argument.
2. Find and remove an accidental synchronization in a training loop.
3. Write a Triton vector/reduction kernel with property and boundary tests.
4. Compare eager and compiled execution across static and changing shapes.
5. Profile attention and verify which backend executes; explain memory difference.

## 20. Primary references

- [Triton documentation and tutorials](https://triton-lang.org/main/index.html)
- [PyTorch profiler](https://docs.pytorch.org/docs/stable/profiler.html)
- [Profiling `torch.compile`](https://docs.pytorch.org/docs/stable/user_guide/torch_compiler/torch.compiler_profiling_torch_compile.html)
- [FlashAttention paper](https://arxiv.org/abs/2205.14135)
- [NVIDIA CUDA programming guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)

Use hardware/vendor documentation for the exact architecture generation you run.
