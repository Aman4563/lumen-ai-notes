# Chapter 2 — NumPy, Dataframes, and Visualization

## 1. Array thinking

NumPy arrays store homogeneous typed values in a strided memory layout. Compared
with Python lists, they enable compact storage, vectorized native kernels, and
multidimensional operations.

Always know:

- shape: length of each axis;
- dtype: numeric representation;
- strides/layout: how indices map to memory;
- whether an object owns data or is a view;
- semantic meaning of each axis.

```python
import numpy as np

X = np.asarray([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
assert X.shape == (2, 2)
assert X.ndim == 2
assert X.dtype == np.float64
```

## 2. Indexing, slicing, copies, and views

Basic slicing usually returns a view:

```python
a = np.arange(6)
view = a[1:4]
view[0] = 99
assert a[1] == 99
```

Advanced/fancy integer or boolean indexing usually returns a copy:

```python
copy = a[[1, 3, 5]]
```

Chained indexing can hide whether mutation reaches the original. Select in one
operation or copy explicitly. Views keep base memory alive; a tiny slice can retain
a huge allocation.

## 3. Shapes and axis semantics

```python
x = np.arange(6)          # (6,)
row = x.reshape(1, -1)    # (1, 6)
col = x.reshape(-1, 1)    # (6, 1)
```

Reduction axis:

```python
X.mean(axis=0)  # one mean per column/feature
X.mean(axis=1)  # one mean per row/example
```

`keepdims=True` retains singleton axes and can make subsequent broadcasting clear.
Annotate expected shape in code review.

## 4. Broadcasting

Compare shapes from the right. Dimensions are compatible when equal or one is 1;
missing leading axes behave as 1.

```text
X:       (32, 128)
b:            (128)
result:  (32, 128)
```

Danger: two incorrect shapes can still be broadcast-compatible and silently
produce an outer operation.

```python
pred = np.ones((100, 1))
target = np.ones((100,))
wrong = pred - target       # shape (100, 100), not (100, 1)
```

Assert shapes at boundaries.

## 5. Vectorization

Replace Python element loops with array operations when it improves clarity and
uses optimized kernels:

```python
# Slow Python loop
result = [1.0 / (1.0 + np.exp(-v)) for v in values]

# Vectorized
result = 1.0 / (1.0 + np.exp(-values))
```

Vectorization can create large temporary arrays. Fuse operations, use `out=`,
chunk, or use compiled dataframe/tensor libraries when memory dominates. A vectorized
O(n²) algorithm is still O(n²).

## 6. Dtypes and numerical safety

- `int8`/`int32` can overflow silently in some operations.
- float32 saves memory/compute but has less range/precision than float64.
- float16/bfloat16 need higher-precision accumulation/loss scaling for training.
- object dtype destroys many performance/safety advantages.
- mixing types triggers promotion rules that must be understood.

```python
a = np.array([250], dtype=np.uint8)
# Adding with certain operations/types may wrap or promote; test the exact API.
```

Use `np.isfinite`, inspect ranges, and accumulate large reductions in a suitable
dtype.

## 7. Linear algebra with arrays

- `*`: elementwise multiplication.
- `@` or `np.matmul`: matrix multiplication.
- `np.dot`: behavior varies with dimensions; prefer explicit `@` for matrices.
- `np.einsum`: expressive index contraction but can be opaque/slow if misused.

```python
scores = X @ weights + bias
```

Use `np.linalg.solve`, `lstsq`, `qr`, or `svd` rather than manual inverse.

## 8. Randomness and reproducibility

Use explicit generators:

```python
rng = np.random.default_rng(seed=42)
indices = rng.permutation(len(X))
```

Pass generators/seeds into functions rather than relying on global state. Exact
reproducibility also depends on library/hardware versions, parallel kernels, and
nondeterministic operations. Record environment and distinguish statistical
reproducibility from bitwise identity.

## 9. Dataframe mental model

A dataframe is a labeled table with typed columns and row alignment. It is not a
spreadsheet and should not be treated as a row-by-row Python object collection.

Core operations:

- select/project columns;
- filter rows;
- derive expressions;
- group and aggregate;
- sort/rank/window;
- join/merge;
- reshape pivot/melt;
- handle missing values/time.

The examples use pandas-like APIs; Polars/Spark differ in execution (eager/lazy,
single/distributed) but relational principles transfer.

## 10. Schemas and types

After loading, inspect and enforce:

- required columns;
- numeric/category/string/time types;
- nullability;
- allowed ranges/categories/units;
- key uniqueness;
- timezone;
- row-count/label invariants.

CSV inference is unsafe for stable pipelines: leading zeros, booleans, dates,
large IDs, and missing markers are ambiguous. Prefer typed columnar formats and
explicit schemas.

## 11. Selection and assignment

Use explicit `.loc`/expression selection to avoid chained-assignment ambiguity.

```python
mask = df["amount"].ge(0) & df["status"].eq("settled")
clean = df.loc[mask, ["event_id", "account_id", "amount"]].copy()
```

Parenthesize boolean clauses. Python `and/or` are not elementwise dataframe
operators.

## 12. Missing data

Different missing sentinels and dtypes behave differently. Check:

- `isna`, not equality with NaN;
- aggregation skip-null defaults;
- joins/group keys with nulls;
- nullable integers/booleans;
- empty string versus missing versus not applicable;
- missingness by time and segment.

Never impute before splitting. Fit imputation parameters on training data and
version the transformation.

## 13. Groupby and aggregation

```python
summary = (
    events.groupby("account_id", as_index=False)
    .agg(
        transaction_count=("event_id", "size"),
        total_amount=("amount", "sum"),
        average_amount=("amount", "mean"),
    )
)
```

Know the output grain. One row per account differs from one row per event. Mixing
grains creates duplicate joins and leakage.

- aggregate reduces groups;
- transform returns aligned values at original row grain;
- apply is flexible but often slow and hard to reason about.

## 14. Joins

Before joining, write:

- left/right key and uniqueness;
- expected relationship: one-to-one, many-to-one, one-to-many, many-to-many;
- expected row count/null behavior;
- event-time/availability rule.

```python
joined = left.merge(
    right,
    on="account_id",
    how="left",
    validate="many_to_one",
    indicator=True,
)
```

Many-to-many joins can cause row explosion and biased metrics. Deduplicating after
the join may hide the semantic error.

### Point-in-time/as-of join

For each prediction event, join the latest feature record available no later than
its timestamp. Account for feature event time, processing time, and label maturity.

## 15. Time data

Use timezone-aware timestamps and store UTC plus source timezone when needed.
Daylight-saving transitions create missing/duplicated local times.

Distinguish:

- event time;
- ingestion/processing time;
- feature availability time;
- prediction time;
- label outcome/maturity time.

Rolling windows must be left-closed appropriately so the current/future outcome
does not leak. Test boundary timestamps explicitly.

## 16. Reshaping

- wide: variables/categories spread across columns;
- long/tidy: one observation per row with variable identifiers.

`pivot` expects unique index/column pairs; `pivot_table` aggregates duplicates.
Choosing an aggregation silently can hide duplicate data, so validate first.

## 17. Scaling beyond memory

Options before distributed computing:

1. read only required columns/rows;
2. choose compact dtypes;
3. use Parquet predicate pushdown;
4. stream/chunk associative aggregations;
5. use vectorized/lazy engines;
6. move computation to database/warehouse;
7. distribute only when volume/latency requires it.

Distributed dataframes add shuffle, partitioning, skew, retries, and serialization
cost. “More workers” can worsen a poorly partitioned join.

## 18. Visualization principles

A plot should answer a question without distorting data.

| Question | Useful plot |
|---|---|
| distribution | histogram + ECDF/box/violin with counts |
| relationship of numeric variables | scatter/hexbin with trend and transparency |
| category comparison | dot/bar with uncertainty, sorted |
| time trend | line with consistent interval and missingness |
| model discrimination | ROC/PR plus operating point |
| calibration | reliability curve plus counts |
| errors by segment | heatmap/dot plot with sample size/CI |

Rules:

- label axes, units, population, and time window;
- avoid truncated axes for bar magnitude unless prominently justified;
- show distributions/uncertainty, not only means;
- use colorblind-safe palettes and redundant cues;
- avoid 3D decoration;
- use log scales only with clear explanation and valid values;
- annotate data-quality gaps.

## 19. EDA without leakage

Split before label-driven feature iteration when possible. Use training data for
deep exploration; reserve validation/test discipline. Basic target-blind test
schema checks are okay, but repeated slice/feature design against test outcomes is
test overfitting.

EDA sequence:

1. dataset grain/provenance/time;
2. schema, keys, duplicates, missingness;
3. target definition/prevalence/maturity;
4. univariate distributions and units;
5. relationships and segment coverage;
6. temporal/cohort changes;
7. label/feature availability and leakage audit;
8. documented hypotheses, not post-hoc stories.

## 20. Exercises

### Beginner

1. Predict shapes for ten indexing/broadcasting expressions.
2. Reimplement standardization with train-only state.
3. Group transactions to account-day grain.
4. Create an honest distribution plot with units and missing counts.

### Intermediate

1. Find and fix a `(n, 1) − (n,)` broadcasting bug.
2. Audit a join for row explosion and unmatched keys.
3. Build point-in-time 7/30-day rolling features.
4. Compare memory/runtime for row loop versus vectorized/chunked approach.

### Advanced/interview

1. Explain view/copy semantics and memory retention.
2. Design a dataframe pipeline that scales from memory to warehouse/distributed.
3. Diagnose train/serve mismatch caused by timezone and late events.
4. Critique five charts for selection, scale, and uncertainty problems.

