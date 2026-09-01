# Chapter 3 — SQL for Analytics and ML

## 1. Think in relations and grain

SQL describes the result; the optimizer chooses an execution plan. Before every
query, state the **grain**: what does one output row represent?

Example tables:

```text
users(user_id PK, signup_at, country)
events(event_id PK, user_id FK, event_at, event_type, amount)
predictions(prediction_id PK, user_id, scored_at, score, model_version)
```

If output should be one row per user-day, every join/aggregation must preserve or
deliberately transform that grain.

## 2. Logical query processing order

Conceptually:

```text
FROM/JOIN -> WHERE -> GROUP BY -> HAVING -> SELECT -> DISTINCT
-> ORDER BY -> LIMIT
```

Actual execution can be rearranged safely by optimizer. Logical order explains why
a SELECT alias may not be available in WHERE and why filtering before versus after
aggregation differs.

## 3. NULL and three-valued logic

NULL means missing/unknown, not zero or empty string.

- `NULL = NULL` is unknown, not true.
- use `IS NULL` / `IS NOT NULL`.
- WHERE retains only true; false and unknown are removed.
- `NOT IN` with a NULL in its subquery can produce surprising unknown results.
- most aggregates ignore NULL; `COUNT(*)` counts rows while `COUNT(column)` counts
  non-null values.

Prefer `NOT EXISTS` for anti-joins and define missing semantics explicitly.

## 4. Filtering and CASE

```sql
SELECT
    user_id,
    CASE
        WHEN amount < 0 THEN 'invalid'
        WHEN amount < 100 THEN 'low'
        ELSE 'high'
    END AS amount_band
FROM events
WHERE event_at >= TIMESTAMP '2026-01-01 00:00:00';
```

CASE returns first matching branch. Include ELSE; otherwise unmatched rows become
NULL. Boundary tests (`<` versus `<=`) should match product definitions.

## 5. Aggregation

```sql
SELECT
    user_id,
    COUNT(*) AS event_count,
    COUNT(DISTINCT DATE(event_at)) AS active_days,
    SUM(amount) AS total_amount,
    AVG(amount) AS average_amount
FROM events
WHERE event_type = 'purchase'
GROUP BY user_id
HAVING COUNT(*) >= 3;
```

WHERE filters input rows; HAVING filters groups after aggregation.

Common bugs:

- average of averages without weighting;
- `COUNT(DISTINCT ...)` hiding duplicate upstream rows;
- grouping by too many columns, preserving unintended grain;
- integer division;
- denominator mismatch;
- treating missing as zero.

Weighted overall mean from group counts n<sub>g</sub> and means μ<sub>g</sub>:

> overall mean = Σ n<sub>g</sub>μ<sub>g</sub> / Σ n<sub>g</sub>

## 6. Joins and cardinality

### Inner/outer joins

- INNER: matching rows only.
- LEFT: all left plus matches/null right.
- RIGHT/FULL: corresponding preservation.
- CROSS: Cartesian product.

Before a join, profile key uniqueness and expected cardinality.

```sql
SELECT e.event_id, e.user_id, u.country
FROM events e
JOIN users u ON u.user_id = e.user_id;
```

If users has duplicate user_id, events multiply. Database PK/unique constraints
and post-join row assertions prevent silent corruption.

### Semi-join and anti-join

```sql
-- users with at least one purchase
SELECT u.*
FROM users u
WHERE EXISTS (
    SELECT 1
    FROM events e
    WHERE e.user_id = u.user_id
      AND e.event_type = 'purchase'
);
```

`EXISTS` avoids duplicate output rows introduced by joining only to test existence.

```sql
-- users with no events
SELECT u.*
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM events e WHERE e.user_id = u.user_id
);
```

## 7. CTEs and subqueries

```sql
WITH purchase_totals AS (
    SELECT user_id, SUM(amount) AS spend
    FROM events
    WHERE event_type = 'purchase'
    GROUP BY user_id
)
SELECT u.country, AVG(COALESCE(p.spend, 0)) AS avg_spend_per_user
FROM users u
LEFT JOIN purchase_totals p USING (user_id)
GROUP BY u.country;
```

CTEs improve naming/decomposition but may or may not materialize depending on
engine/version. Inspect execution plan; do not assume performance behavior.

Correlated subqueries can execute per row unless optimized. Window functions or
pre-aggregation may be faster and clearer.

## 8. Window functions

Windows compute across related rows without collapsing grain.

Syntax:

```sql
function(...) OVER (
    PARTITION BY ...
    ORDER BY ...
    ROWS BETWEEN ... AND ...
)
```

### Ranking

```sql
SELECT
    user_id,
    event_at,
    ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY event_at DESC, event_id DESC
    ) AS rn
FROM events;
```

- ROW_NUMBER: unique sequence, ties broken by full ORDER BY.
- RANK: gaps after ties.
- DENSE_RANK: no gaps.

Always add deterministic tie-breaker for reproducibility.

### Lag/lead

```sql
SELECT
    user_id,
    event_at,
    event_at - LAG(event_at) OVER (
        PARTITION BY user_id ORDER BY event_at, event_id
    ) AS time_since_previous
FROM events;
```

LEAD looks forward and can cause leakage if used as a prediction feature.

### Rolling aggregates

```sql
SUM(amount) OVER (
    PARTITION BY user_id
    ORDER BY event_at
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
)
```

This is seven **rows**, not seven days. Use engine-specific RANGE/time interval or
a point-in-time join for temporal windows. Exclude current outcome event when
necessary.

### Window frame trap

Default frame with ORDER BY differs by engine/function and peer values. Specify
`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` for a clear running total.

## 9. Deduplication

Define “duplicate” and which record wins:

```sql
WITH ranked AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY business_key
            ORDER BY updated_at DESC, ingestion_id DESC
        ) AS rn
    FROM source t
)
SELECT * EXCEPT (rn)
FROM ranked
WHERE rn = 1;
```

Syntax varies across databases. Without deterministic tie-breaking, reruns may
choose different records.

## 10. Time and cohort analysis

### Date spine

Generate all expected dates and left join facts so days with zero events appear.
Absence of rows is not automatically zero; the product definition decides.

### Cohort retention

1. assign signup cohort;
2. define activity event;
3. calculate period since cohort start;
4. count distinct eligible users active at period;
5. divide by consistent cohort denominator.

Beware incomplete recent cohorts and user identity changes.

### Sessionization

Mark a new session when time since prior event exceeds threshold, then cumulative
sum the marker per user. Equal timestamps and late events need deterministic rules.

## 11. Point-in-time feature construction

For each prediction at t<sub>p</sub>, use only feature facts available by t<sub>p</sub>.

Conceptual SQL:

```sql
SELECT p.prediction_id, f.feature_value
FROM prediction_spine p
LEFT JOIN feature_history f
  ON f.user_id = p.user_id
 AND f.available_at <= p.scored_at
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY p.prediction_id, f.feature_name
    ORDER BY f.available_at DESC, f.version DESC
) = 1;
```

If `QUALIFY` is unavailable, use a subquery. Use availability time, not only event
time. Unit-test exact boundary and late-arrival cases.

## 12. Labels in SQL

Example: churn if no qualifying activity in next 30 days. Separate:

- observation/prediction spine;
- future outcome window;
- dataset maturity cutoff;
- censoring/exclusion;
- label definition/version.

Do not label recent examples negative before their 30-day window finishes.

```text
feature lookback  | prediction | label window       | maturity delay
------------------|------------|--------------------|-------------->
```

## 13. Query performance

### Read the plan

Use `EXPLAIN`/`EXPLAIN ANALYZE` carefully. Look for:

- full scans and filter selectivity;
- join order/algorithm;
- row-estimate errors;
- sorts, shuffles, spills;
- partition pruning;
- index use;
- repeated subquery work;
- skewed keys.

### Indexes

B-tree indexes commonly help equality/range/order on leading columns. Composite
index column order matters. Indexes cost storage and slow writes. Low-selectivity
columns alone may not help.

Warehouse columnar systems rely more on partitioning, clustering/sorting, pruning,
compression, and distributed execution than OLTP-style indexes.

### Sargability

Predicates that apply functions to indexed/partition columns may prevent pruning:

```sql
-- often worse
WHERE DATE(event_at) = DATE '2026-01-01'

-- range permits pruning/index use
WHERE event_at >= TIMESTAMP '2026-01-01 00:00:00'
  AND event_at <  TIMESTAMP '2026-01-02 00:00:00'
```

### Join optimization

- filter/project early when semantics allow;
- pre-aggregate at needed grain;
- avoid unnecessary DISTINCT;
- handle skew/hot keys;
- broadcast only truly small tables;
- partition colocated data where beneficial;
- update table statistics.

## 14. Transactions and isolation

ACID:

- Atomicity: all-or-nothing.
- Consistency: constraints/invariants preserved.
- Isolation: concurrent transactions behave according to isolation level.
- Durability: committed changes survive failures.

Anomalies include dirty reads, non-repeatable reads, phantom reads, lost updates,
and write skew. Serializable gives strongest general semantics but costs/aborts may
increase. Use database-specific behavior and retry transactions safely/idempotently.

Analytics snapshots need consistency too: a dataset built across mutating tables
can mix times unless using snapshot/version semantics.

## 15. SQL interview patterns

Master:

- top N per group;
- first/last event;
- consecutive streaks (gaps and islands);
- rolling metrics;
- retention/funnels;
- median/percentile;
- deduplication;
- self-joins and hierarchies;
- sessionization;
- recursive traversal where supported;
- point-in-time joins;
- experiment metric computation.

For every answer, state grain, tie handling, NULL semantics, complexity/data size,
and indexes/partitioning.

## 16. Exercises

### Beginner

1. Write filters demonstrating NULL three-valued logic.
2. Compute per-user purchases without losing users with zero purchases.
3. Compare WHERE and HAVING.
4. Rank events with deterministic ties.

### Intermediate

1. Build 7-day retention with correct denominator and incomplete-cohort handling.
2. Sessionize events with a 30-minute gap.
3. Find three consecutive active days.
4. Construct a point-in-time feature join.

### Advanced/interview

1. Diagnose a join that multiplies model-training rows.
2. Optimize a multi-terabyte skewed aggregation using a query plan.
3. Explain isolation requirements for reproducible dataset snapshots.
4. Write experiment metrics at user randomization grain and detect SRM.

