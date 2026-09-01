# Track 6 — Graph Machine Learning

## 1. Graph problem setup

Graph G=(V,E), directed/undirected, weighted, temporal, heterogeneous.

Tasks:

- node classification/regression;
- edge/link prediction;
- graph classification;
- community/cluster;
- ranking/recommendation;
- anomaly/fraud;
- knowledge graph completion.

Define what node/edge means, creation/availability time, sampling, dynamic updates.

## 2. Graph representations

- edge list;
- adjacency list;
- adjacency matrix A;
- degree D;
- node/edge feature matrices;
- sparse CSR/CSC;
- heterogeneous typed graph.

Normalized adjacency/self-loops differ by GNN.

## 3. Classical graph features

- degree/in/out/weighted/temporal;
- clustering coefficient;
- PageRank;
- betweenness/closeness (expensive);
- common neighbors/Jaccard/Adamic–Adar;
- connected components;
- community;
- motifs;
- shortest distance.

Strong GBDT baseline. Compute point-in-time and avoid test/future edges.

## 4. Spectral view

Graph Laplacian L = D − A; normalized forms. Eigenvectors encode smooth graph
structure, spectral clustering, graph Fourier intuition. Large graphs use sparse
iterative approximations.

## 5. Random-walk embeddings

DeepWalk/node2vec generate random-walk sequences, apply word embedding objectives.
node2vec parameters bias BFS-like local versus DFS-like structural exploration.

Transductive: new nodes need retraining/inductive mechanism. Embeddings can leak
future graph and encode popularity/community bias.

## 6. Message-passing GNN

Layer:

> m<sub>v</sub> = AGGREGATE({message(h<sub>u</sub>, edge<sub>uv</sub>) : u∈N(v)})  
> h′<sub>v</sub> = UPDATE(h<sub>v</sub>, m<sub>v</sub>)

Aggregation permutation-invariant (sum/mean/max/attention). After k layers, node
uses k-hop neighborhood.

## 7. GCN

One matrix form:

> H<sup>l+1</sup> = φ(D̃⁻¹ᐟ²ÃD̃⁻¹ᐟ² H<sup>l</sup>W<sup>l</sup>)

Ã=A+I, D̃ degrees. Normalized neighbor averaging + transform. Full batch costly on
huge graph.

## 8. GraphSAGE

Samples neighbors and aggregates, inductive with node features. Sampling controls
explosion but introduces variance and can miss important neighbors. Mean/pool/LSTM
aggregators (LSTM order issue requires handling).

## 9. Graph attention

Learn neighbor weights from features. More expressive/contextual but edge compute/
memory and attention weights not explanations. High-degree sampling needed.

## 10. Expressiveness and oversmoothing

Message passing bounded by Weisfeiler–Lehman-like graph distinction; cannot
distinguish some structures. Deeper layers:

- oversmoothing: node reps become similar;
- oversquashing: exponentially many distant messages compressed through bottleneck;
- vanishing/compute neighbor explosion.

Residuals, normalization, jumping knowledge, rewiring/positional encodings, sampling,
shallow layers help.

## 11. Link prediction

Score pair from embeddings:

- dot/bilinear;
- MLP on concat/product/difference;
- distance;
- path/subgraph model.

Negative sampling: non-edge is not necessarily negative/unexposed. Temporal split
prevents future edges; remove target edge from message graph during training to
avoid trivial leakage. Candidate generation at serving.

## 12. Knowledge graphs

Triples (head, relation, tail). Models:

- translational h+r≈t;
- bilinear/complex;
- relational GNN;
- text-enhanced.

Evaluate filtered ranking (remove other known true triples), MRR/Hits@K. Incomplete
KG makes sampled negatives possibly true.

## 13. Graph splitting/leakage

### Transductive

All nodes/edges structure may be visible, some labels held out. Valid for fixed
known graph label completion, not new graph future.

### Inductive

Hold out nodes/graphs/domains/time; model generalizes from features.

Leakage:

- future edges;
- label-derived edges/features;
- same connected identity clusters across split;
- target edge left in adjacency;
- global normalization/community using test future;
- duplicate accounts/devices.

## 14. Scaling

- neighbor sampling;
- subgraph/cluster mini-batches;
- graph partitioning;
- layer-wise sampling;
- caching embeddings;
- distributed feature store;
- sparse kernels;
- CPU–GPU transfer;
- high-degree/hot node skew.

Serving can precompute node embeddings, but fresh edges/new nodes require incremental
features/encoder and staleness policy.

## 15. Heterogeneous/temporal graphs

Multiple node/edge types need relation-specific transforms/attention. Parameter
explosion and rare relations.

Temporal graphs include event time/order. Time encodings, temporal neighbor sampling
strictly before query, memory state. Backfills/late events and point-in-time graph
snapshot critical.

## 16. Evaluation and explanation

- task metric + baseline classical graph features;
- temporal/new-node/domain slices;
- neighbor-sampling variance;
- calibration;
- latency/memory/staleness;
- fairness/community effects;
- adversarial node/edge injection;
- ablation node features versus graph structure.

GNN explanation subgraphs/features can be unstable and noncausal. Validate with
edge/node removal and domain experts.

## 17. Exercises

1. Compute classical features and GBDT baseline.
2. Implement one GCN layer and verify dimensions.
3. Build temporal link split with target-edge removal.
4. Compare transductive and inductive evaluation.
5. Scale neighbor sampling under power-law degree and hot nodes.

