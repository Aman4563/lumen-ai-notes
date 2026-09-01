# Chapter 2 — Profiling and Kernel Laboratory

## 1. Measurement contract

Before optimizing, freeze model/input shapes, dtype, device, warm-up, compilation
state, synchronization, repetitions, arrival/batch pattern, and correctness
tolerance. Record hardware, driver, runtime, framework, clock/power mode where
available, and background load.

GPU launches are asynchronous. Host wall-clock around a launch may measure enqueue
time. Use framework benchmark utilities or device events with appropriate
synchronization. Warm and cold results answer different questions; report both.

## 2. Step decomposition

```text
step time = input wait + host/launch work + device compute/memory
          + communication/exposed synchronization + checkpoint/eval amortization
```

These can overlap, so naive addition may double count. A trace shows concurrency;
summary utilization alone cannot identify useful work.

## 3. Roofline worksheet

For an operation, estimate useful floating-point operations and bytes moved at the
memory level being analyzed:

> `arithmetic intensity = operations / bytes`

> `attainable throughput ≤ min(peak compute, bandwidth × arithmetic intensity)`

Example: elementwise add of two FP32 inputs and one output performs roughly one
operation while reading 8 bytes and writing 4 bytes per element: about `1/12`
operation per byte before cache effects. It is naturally bandwidth-oriented. A
tiled matrix multiplication reuses loaded tiles and can achieve far higher
intensity.

Do not claim the roofline prediction is exact. Cache reuse, instruction mix,
occupancy, launch overhead, shape, and achieved bandwidth matter.

## 4. Profiling ladder

1. end-to-end application phase timing;
2. framework/operator trace with shapes and memory;
3. device kernel timeline and communication overlap;
4. kernel counters/source-level profiling for the proven hot kernel;
5. distributed per-rank timelines for skew and exposed collectives.

Starting at a low-level kernel wastes time if the real bottleneck is data loading,
Python graph breaks, queueing, or checkpoint I/O.

## 5. Kernel correctness matrix

Test against a trusted implementation across:

- tiny, odd, non-power-of-two, empty/degenerate where legal, and production shapes;
- contiguous and supported strided layouts;
- FP32, BF16/FP16, and promoted accumulation behavior;
- large/small logits, infinities/NaNs according to contract;
- forward values, backward gradients, and repeated deterministic behavior where
  promised;
- multiple devices/architectures targeted by deployment.

Use absolute plus relative tolerance. Near-zero reference values make relative
error unstable; large values make a fixed absolute tolerance insufficient.

## 6. Stable softmax experiment

Naive `exp(x)` overflows for large logits. Compute:

> `m = max_i x_i`

> `softmax(x)_i = exp(x_i − m) / Σ_j exp(x_j − m)`

Subtracting the same constant leaves probabilities unchanged and ensures the
largest exponent is 1. Test rows with very large magnitude, equal logits, long
lengths, masks, all-masked invalid cases, and mixed precision. Define all-masked
semantics rather than allowing silent NaNs.

## 7. Tiling/fusion experiment

Implement or compare an unfused pipeline and fused equivalent. Record intermediate
tensor bytes and kernel launches. The hypothesis should be explicit: fusion wins
because it eliminates particular HBM reads/writes and launch boundaries. It may
lose if register pressure lowers occupancy, recomputation grows, fusion blocks a
better library kernel, or shapes are too small.

## 8. Compilation experiment

Measure eager versus compiled execution for static and variable shapes. Separate
first-use compile time from steady state. Count recompilations/graph breaks and
identify the operation or Python/data-dependent control that caused them. Include
compile cache size and deployment startup implications.

## 9. Distributed trace experiment

With at least a conceptual multi-rank trace, mark forward, backward, gradient
ready, collective start/end, optimizer, and input wait. Determine:

> `exposed communication = communication time not hidden behind useful compute`

More overlap can increase memory pressure and contention. Compare per-rank time;
the slowest rank sets synchronous step time.

## 10. Optimization report

Include baseline, hypothesis, trace evidence, change, correctness matrix, benchmark
method, median/tail results, memory, affected shapes, compile cost, portability,
and rollback condition. Reject percentage claims that omit absolute time and
workload distribution.

## 11. Interview prompts

1. GPU utilization is 95%, but throughput is low. What does utilization fail to
   tell you?
2. A fused kernel is faster at batch 32 and slower at batch 1. Explain hypotheses.
3. How do register pressure and occupancy trade off against data reuse?
4. Design a benchmark that prevents asynchronous timing and compile warm-up errors.
5. FlashAttention computes exact attention (within numerical algorithm effects)
   without materializing the full score matrix. Explain why I/O complexity matters.

