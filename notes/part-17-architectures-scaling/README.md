# Part 17 — Foundation-Model Architectures and Scaling

This part connects architecture choices to parameter count, training FLOPs,
activation/KV memory, communication, data, quality, and serving cost. Complete
Parts 7–9, 15, and 16 first.

## Chapters

1. [Modern architectures and scaling](01-model-architectures-and-scaling.md):
   dense transformers, attention variants, positions/long context, MoE, scaling
   laws, retrieval, state-space/hybrids, multimodal, and diffusion/flow models.
2. [Architecture accounting and ablation workbook](02-architecture-accounting-workbook.md):
   derive budgets and design fair experiments before choosing a model.

## Exit gate

Given a configuration, estimate major parameter terms, attention/MLP compute,
activation and KV-cache scaling; compare MHA/GQA/MQA; explain long-context and MoE
trade-offs; interpret scaling laws without extrapolation theater; and propose
matched-budget ablations that separate architecture from data/training changes.

