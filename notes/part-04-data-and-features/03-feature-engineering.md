# Chapter 3 — Feature Engineering by Data Type

## 1. Feature engineering encodes useful invariances and context

Features should make the target relationship learnable while remaining available,
stable, lawful, and economical at prediction time.

A feature specification needs:

```text
name -> semantic definition -> source -> entity keys -> event/availability time
-> lookback/window -> transformation -> missing/default -> dtype/units
-> owner -> freshness/SLA -> privacy -> tests -> version
```

## 2. Start from the prediction timestamp

For every feature F at prediction time t:

> F(entity, t) = function of events whose availability time ≤ t

Define boundary inclusivity and label overlap. A 30-day purchase count at 10:00
must not use a purchase ingested at 10:01 even if its event timestamp says 09:59
unless the real serving system could have known it.

## 3. Numeric features

### Ratios and rates

Examples:

- clicks/impressions;
- failed/total attempts;
- spend/active_day;
- debt/income.

Define zero denominator and smoothing:

> smoothed rate = (successes + α)/(trials + α + β)

Small denominators create extreme noisy rates. Include numerator/denominator or
confidence so model can distinguish 1/1 from 1,000/1,000.

### Differences and relative changes

> absolute change = current − previous  
> relative change = (current − previous)/baseline

Handle baseline zero/near-zero and sign. Log-ratios can model multiplicative change
for positive values.

### Binning

Domain bins improve interpretability/nonlinearity but lose within-bin ordering and
create boundaries. Quantile bins balance training counts but drift and duplicate
values complicate. Fit edges on training; monitor out-of-range.

### Interactions

Product/cross terms x₁x₂ let linear models represent interactions. Polynomial
expansion grows combinatorially; regularize/select based on domain hypotheses.

## 4. Temporal features

### Calendar

- hour/day/week/month/holiday;
- time since signup/last event;
- account age;
- local versus UTC time.

Calendar cycles are circular. Encode period P:

> sin feature = sin(2πt/P)  
> cos feature = cos(2πt/P)

This makes 23:00 close to 00:00, unlike raw hour integers.

### Windows

Counts/sums/means/max/unique over 1h, 1d, 7d, 30d. Multiple windows capture
short- and long-term behavior.

Velocity:

- events per time;
- current window versus historical baseline;
- burstiness/inter-arrival distribution;
- exponentially decayed history.

Exponential moving feature:

> state<sub>t</sub> = α · value<sub>t</sub> + (1 − α)state<sub>t−1</sub>

For irregular time, decay by elapsed duration rather than update count.

### Recency

> recency = prediction_time − last_available_event_time

Define never-seen sentinel/indicator. Recency often carries more signal than raw
calendar date and generalizes better across eras.

### Trend and seasonality

- slope over historical window;
- ratio recent/long average;
- deviation from same weekday/hour baseline;
- rolling variance;
- seasonal lag.

Forecasting features must be computable recursively/known at each future horizon.

## 5. Categorical/entity features

- count/frequency and smoothed target history;
- diversity/entropy of associated categories;
- age/tenure;
- hierarchical parent/category rollups;
- historical reliability/quality;
- learned embedding.

Avoid raw user/device IDs unless memorization for known entities is explicitly
intended and cold-start evaluation exists. Entity reputation must use mature past
labels point-in-time.

## 6. Text features

### Sparse lexical

- word/character n-grams;
- TF–IDF;
- length, punctuation, casing, URL/domain patterns;
- language/script;
- domain lexicons under validated policy.

Character n-grams handle misspelling/morphology/obfuscation and are strong for
spam/language identification.

### Dense representations

- averaged word embeddings;
- sentence/document encoders;
- transformer representations;
- task-specific fine-tuned embeddings.

Define pooling, truncation/chunking, normalization, encoder version, language,
latency, and privacy. Precomputed embeddings become stale when text or encoder
changes.

### Retrieval features

- lexical BM25 score;
- dense similarity;
- reranker score;
- document authority/freshness;
- query-document interaction;
- source permissions.

Scores from upstream learned models create dependencies and require version/
monitoring; they can leak target if trained on overlapping outcomes.

## 7. Image and vision features

Classical:

- color histograms;
- edges/texture/shape;
- keypoints;
- dimensions/aspect/quality.

Modern:

- pretrained CNN/ViT embeddings;
- object/region features;
- multimodal image–text similarity;
- metadata when trustworthy/permitted.

Avoid label-correlated watermarks, borders, scanner/site artifacts, and duplicated
near frames. Domain holdouts and controlled background tests expose shortcuts.

## 8. Geospatial features

- latitude/longitude (raw coordinates have wrap/pole issues);
- geohash/grid/H3-like cell at multiple resolutions;
- distance/bearing to landmarks;
- region hierarchy;
- local density/activity;
- travel time/routing rather than straight-line distance.

Haversine great-circle distance for coordinates in radians:

> a = sin²(Δlat/2) + cos(lat₁)cos(lat₂)sin²(Δlon/2)  
> distance = 2R · atan2(√a, √(1 − a))

Location is sensitive and can proxy protected attributes. Minimize precision,
control access/retention, and validate legitimate purpose.

## 9. Graph features

Given nodes/entities and edges/interactions:

- degree/in/out degree;
- weighted/recent degree;
- common neighbors/Jaccard;
- connected component;
- PageRank/centrality;
- community;
- motif counts;
- shortest-path distance;
- node/graph embeddings or GNN representations.

Graph features are especially leakage-prone: constructing the graph with future
edges or evaluation labels leaks. Split by time and build graph snapshot available
at prediction time. Transductive methods can use test-node structure under some
research settings, but state whether production permits it.

## 10. Sequence and behavioral features

- last k events/items;
- n-gram/transitions;
- time gaps;
- counts by event type/window;
- session summaries;
- learned sequence encoder state;
- diversity/entropy and repetition.

Padding/masking must distinguish real zero/token from padding. Truncation direction
(most recent versus earliest) changes signal. Evaluation should cover short/new
histories.

## 11. Aggregation and hierarchical leakage

Aggregates over groups (merchant, hospital, school, item) can leak through:

- current row included in its own target mean;
- future labels included;
- validation/test entities contribute;
- group identities cross random split and inflate generalization claim.

Use:

- leave-one-out/out-of-fold within training;
- training-only mapping for held-out;
- time-aware mature history;
- smoothing and minimum support;
- unknown/default for new groups;
- group/domain holdout evaluation.

## 12. Feature crosses and combinatorial control

Cross categorical variables only with hypothesis and support. Country × device ×
product can create sparse rare buckets. Hashing or learned interactions handle
scale, but collisions/overfitting remain.

Tree/boosting/deep models learn many interactions automatically. Manual features
still help when they encode time windows, domain invariance, constraints, or data
not easily inferred.

## 13. Feature importance is not causal importance

- model coefficient depends on scaling/correlation/regularization;
- split gain is biased toward high-cardinality/opportunity features;
- permutation importance is affected by correlated substitutes and evaluation
  distribution;
- SHAP depends on background/conditional assumptions and explains model, not world;
- ablation can include retraining versus inference removal—different questions.

Use importance to generate debugging hypotheses, then validate with interventions,
domain tests, ablations, and causal design.

## 14. Feature selection by total value

Score a feature family on:

> predictive benefit − latency − compute − storage − freshness risk
> − privacy/security risk − operational ownership − brittleness

Measure incremental value through ablation/retraining and confidence. A 0.01%
metric gain from an unreliable cross-region dependency can be negative system value.

## 15. Feature documentation example

```text
name: account_failed_payment_count_24h_v2
entity: account_id
value: count of failed authorization events
window: [prediction_time - 24h, prediction_time)
availability: only events with ingested_at <= prediction_time - 30s watermark
dtype/range: nonnegative int32, capped at 10,000 with capped flag
missing: 0 only when source completeness check passes; otherwise unavailable flag
freshness SLO: p99 < 60s
privacy: internal risk use; 90-day event retention
owner: risk-features
tests: point-in-time, count fixture, late event, duplicate event, source outage
```

## 16. Exercises

1. Design 20 point-in-time fraud features and audit availability.
2. Encode hour/day cycles and explain why two features are needed.
3. Build smoothed historical rate without self/future leakage.
4. Design cold-start features for new users and items.
5. Rank a feature by total production value, not only offline importance.

