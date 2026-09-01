# Chapter 4 — Data Structures, Algorithms, and Complexity

## 1. Why DSA still matters in ML roles

ML engineers build retrieval, batching, caching, feature pipelines, graph systems,
stream processing, and services. Interviews also use DSA to test decomposition and
correctness. Senior candidates should connect algorithm choice to memory, scale,
failure, and interface constraints.

## 2. Complexity analysis

Analyze input variables explicitly: n users, m edges, d features, k requested
items—not a generic n if several dimensions matter.

- Time complexity: operations as input grows.
- Auxiliary space: extra memory excluding input/output, state convention.
- Amortized complexity: average per operation across a sequence.
- Expected complexity: depends on randomness/distribution (hash table).

Growth order:

```text
1 < log n < n < n log n < n² < n³ < 2ⁿ < n!
```

Worst-case is not always the product bottleneck; include average, tail, memory,
I/O, cache locality, and parallelism.

## 3. Arrays and strings

Dynamic array operations (typical):

| Operation | Time |
|---|---:|
| index | O(1) |
| append | amortized O(1) |
| insert/delete middle | O(n) |
| membership unsorted | O(n) |
| sort | O(n log n) |

Python `list` is a dynamic array of references. Slicing creates a new list O(k).
String concatenation in a loop can become quadratic; collect pieces and `join`.

### Two pointers

Use when a monotonic condition lets pointers move without revisiting states:

- pair sum in sorted array;
- partitioning;
- merging sorted sequences;
- palindrome checks.

### Sliding window

Maintain state for a contiguous window, expanding and shrinking:

```python
def longest_distinct(text: str) -> int:
    last_seen: dict[str, int] = {}
    left = best = 0
    for right, char in enumerate(text):
        left = max(left, last_seen.get(char, -1) + 1)
        last_seen[char] = right
        best = max(best, right - left + 1)
    return best
```

O(n) time because each boundary moves forward.

### Prefix sums

> prefix[i] = sum of first i elements

Range sum [l, r) = prefix[r] − prefix[l], O(1) after O(n) preprocessing. Extend
to 2D images, cumulative counts, and difference arrays.

## 4. Hash tables

Dict/set give expected O(1) insert, lookup, delete, with worst-case O(n) and memory
overhead. Keys require stable hash/equality.

Patterns:

- frequency counting;
- deduplication;
- complement lookup (two-sum);
- grouping/joins;
- memoization/caching.

Pitfalls:

- mutable/unhashable keys;
- unbounded cache;
- relying on hash iteration for cross-language reproducibility;
- collisions/adversarial inputs;
- using float or composite identity without canonicalization.

## 5. Stack, queue, and deque

- Stack LIFO: parsing, DFS, monotonic stack, undo.
- Queue FIFO: BFS, scheduling.
- Deque: O(1) append/pop at both ends in typical implementation.

Python list `pop(0)` is O(n); use `collections.deque.popleft()`.

### Monotonic stack/queue

Maintain increasing/decreasing candidates. Applications: next greater element,
histogram area, sliding-window maximum. Each item enters/exits at most once: O(n).

## 6. Linked lists

O(1) insertion/removal when node/reference known; O(n) indexing/search. Poor cache
locality and object overhead often make arrays faster in practice.

Interview patterns:

- reverse iteratively;
- fast/slow pointers for cycle/middle;
- merge sorted lists;
- dummy/sentinel node to simplify boundaries.

In Python production code, linked lists are rarely the default but teach pointer
invariants.

## 7. Heaps and priority queues

Binary heap:

- peek minimum O(1);
- insert O(log n);
- pop minimum O(log n);
- heapify n elements O(n).

Python `heapq` is min-heap. Patterns:

- top-k: maintain heap of size k → O(n log k);
- k-way merge;
- task scheduling;
- Dijkstra;
- streaming median with two heaps.

For top-k largest, a size-k min-heap preserves current winners. Sorting all values
costs O(n log n) and more memory/order work.

## 8. Trees

### Binary search tree

Left keys < node < right keys under a chosen duplicate policy. Search/insert O(h),
where h can be n when unbalanced. Balanced trees keep O(log n).

Traversals:

- preorder: node, left, right;
- inorder: left, node, right (sorted for BST);
- postorder: left, right, node;
- level order: BFS.

### Trie

Prefix tree stores sequences/strings. Operation O(L) in key length but memory can
be large. Useful for prefix autocomplete/routing; compressed tries and finite-state
structures reduce overhead.

### Segment/Fenwick trees

Support range queries and updates in O(log n). Useful in specialized online
analytics/ranking; know concept rather than memorizing unless role demands it.

## 9. Graphs

G = (V, E), directed/undirected, weighted/unweighted. Representations:

- adjacency list: O(V + E) space; good sparse graphs;
- adjacency matrix: O(V²); O(1) edge check; good dense/small;
- edge list: compact input/batch processing.

### BFS

Queue; explores unweighted shortest path by levels. O(V + E).

```python
from collections import deque

def distances(graph, source):
    distance = {source: 0}
    queue = deque([source])
    while queue:
        node = queue.popleft()
        for nxt in graph.get(node, ()):
            if nxt not in distance:
                distance[nxt] = distance[node] + 1
                queue.append(nxt)
    return distance
```

### DFS

Stack/recursion; connectivity, cycle detection, components, topological logic.
Recursive DFS can overflow Python recursion limit; iterative form is safer for
large/deep graphs.

### Topological sort

Orders vertices in a directed acyclic graph (DAG). Kahn's algorithm repeatedly
removes zero-indegree nodes. If processed count < V, a cycle exists. Used for job/
feature pipeline dependencies.

### Shortest paths

- BFS: unweighted/equal positive edge weights.
- Dijkstra: nonnegative weights, O((V + E) log V) with heap.
- Bellman–Ford: handles negative edges, detects reachable negative cycles,
  O(VE).
- Floyd–Warshall: all-pairs, O(V³), small dense graphs.

Dijkstra is invalid with negative edges.

### Union–find/disjoint set

Supports `find` and `union`; path compression + union by rank/size gives nearly
constant amortized time. Applications: connectivity, Kruskal MST, clustering.

## 10. Sorting and selection

Know:

- stable versus unstable;
- in-place versus extra memory;
- comparison lower bound Ω(n log n);
- counting/radix can beat it with restricted keys.

Typical:

- mergesort: O(n log n), stable, O(n) extra;
- heapsort: O(n log n), O(1) auxiliary, unstable;
- quicksort: average O(n log n), worst O(n²), cache-friendly;
- Timsort (Python): stable, exploits existing runs.

Quickselect finds kth order statistic average O(n), worst O(n²); deterministic
median-of-medians gives worst O(n) with larger constants.

## 11. Binary search

Use on a monotonic predicate, not only exact sorted lookup.

Template for first true in [lo, hi):

```python
def first_true(lo: int, hi: int, predicate) -> int:
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if predicate(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

State invariant and boundary convention. “Binary search on answer” finds minimum
capacity/threshold satisfying feasibility.

## 12. Recursion and backtracking

Recursion needs:

- base case;
- progress toward it;
- correct combination;
- bounded stack.

Backtracking explores a decision tree, choosing, recursing, then undoing. Worst
case often exponential; pruning eliminates impossible/unpromising branches.

Patterns: subsets, permutations, combinations, constraint solving. Avoid copying
whole state when push/pop suffices, but ensure undo runs on all paths.

## 13. Dynamic programming

DP applies when problems have overlapping subproblems and optimal substructure.

Workflow:

1. define state precisely;
2. define transition;
3. base cases;
4. evaluation order;
5. answer extraction;
6. time/space and reconstruction.

Memoization is top-down recursion + cache. Tabulation is bottom-up.

Example Fibonacci is pedagogical; practical patterns:

- 0/1 and unbounded knapsack;
- edit distance;
- longest common/increasing subsequence;
- grid paths;
- interval DP;
- sequence decoding (Viterbi);
- resource allocation.

Space can often be reduced when only previous rows/states are needed.

## 14. Greedy algorithms

Greedy chooses locally best step without revisiting. Correctness requires proof:
exchange argument, cut property, stays-ahead, or matroid-like structure.

Examples:

- interval scheduling by earliest finish;
- Huffman coding;
- Dijkstra with nonnegative edges;
- Kruskal/Prim MST.

Counterexample thinking is essential; greedy fails for general 0/1 knapsack.

## 15. Intervals and event sweeps

Sort interval endpoints/events, then scan:

- merge intervals;
- meeting rooms/concurrency;
- coverage;
- calendar conflicts;
- resource peak.

Boundary semantics matter: are [start, end) intervals half-open? Can one meeting
start exactly when another ends? Half-open intervals simplify adjacent events.

## 16. Streaming and approximate structures

When data does not fit memory:

- reservoir sampling: uniform sample from unknown-length stream;
- Count-Min Sketch: approximate frequency with one-sided overestimation;
- Bloom filter: approximate membership with false positives, no false negatives
  under normal immutable assumptions;
- HyperLogLog: approximate distinct count;
- online mean/variance;
- heavy-hitter algorithms.

Approximation trades memory/latency for bounded/probabilistic error. State error
guarantees and adversarial/hash assumptions.

## 17. ML-related algorithm examples

- nearest neighbors: indexing/search, heaps, high-dimensional limits;
- decision trees: recursive partition, sorting/histograms;
- beam search: bounded priority candidates;
- retrieval: inverted indexes, approximate nearest neighbor graphs;
- feature DAG: topological scheduling;
- graph fraud: BFS/components/union-find;
- streaming metrics: sketches/reservoirs;
- batching: queues, backpressure, bin packing.

## 18. Interview problem-solving framework

1. Restate and clarify input, output, constraints, duplicates, order, memory.
2. Give examples/edge cases.
3. State brute force and complexity.
4. Identify structure/invariant.
5. Propose algorithm and prove why it works.
6. Implement readable code.
7. Trace normal and edge cases.
8. State time/space and production modifications.

Senior signal: discuss streaming, concurrency, distribution, persistence, failure,
and observability only after solving the core problem.

## 19. Practice progression

- 20 array/string/hash problems;
- 15 stack/queue/heap/interval problems;
- 15 tree/graph problems;
- 10 binary search/greedy problems;
- 15 DP/backtracking problems;
- 10 mixed design/streaming problems.

Track patterns and mistakes, not just solved count. Re-solve failed problems from
blank after spaced intervals.

## 20. Exercises

### Beginner

1. Implement two-sum, valid parentheses, BFS, and merge intervals.
2. Explain amortized list append.
3. Compare heap top-k with sorting.
4. State loop invariant for binary search.

### Intermediate

1. Implement LRU cache with hashmap + doubly linked list.
2. Implement topological sort and cycle detection.
3. Derive a DP for edit distance.
4. Design a streaming top-k per category.

### Advanced/interview

1. Design a memory-bounded approximate distinct counter and state guarantees.
2. Parallelize graph traversal while preserving correctness and avoiding hotspots.
3. Design a batch scheduler minimizing padding under latency deadline.
4. Explain when approximate nearest-neighbor search is preferable to exact search.

