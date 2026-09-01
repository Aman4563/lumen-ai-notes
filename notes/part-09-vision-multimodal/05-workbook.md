# Chapter 5 — Vision/Multimodal Interview Workbook and Capstone

## 1. Rapid answers

### Why convolution parameter sharing?

Same local pattern can occur anywhere; sharing encodes translation equivariance and
reduces weights/sample need. Exact equivariance broken by boundaries/stride.

### Detection versus segmentation metrics?

Detection AP ranks boxes matched at IoU thresholds; segmentation IoU/Dice per
pixel/mask. State class/threshold/crowd conventions and include operational slices.

### CNN versus ViT?

CNN stronger locality/equivariance/data efficiency; ViT global attention/scales
with pretraining but quadratic tokens and weaker image prior. Modern hybrids;
measure task/compute/robustness.

### Why self-supervised vision?

Use abundant unlabeled images to learn transferable representation via contrastive,
masked, or predictive objectives, reducing label need. Objective/augmentation can
discard downstream signal or learn bias.

### CLIP limitation?

Pair-level alignment from noisy data; prompt/bias, counting/spatial/composition,
false negatives, and similarity not factual reasoning. Evaluate domain.

### Diffusion versus GAN?

Diffusion stable likelihood/denoising-like training and iterative sampling with
coverage/quality; slower inference. GAN adversarial min–max, fast one-pass generation
but unstable/mode collapse. Modern variants blur trade-offs.

## 2. Calculation drills

1. convolution output/parameters/FLOPs/receptive field;
2. ViT tokens/attention memory at resolution;
3. IoU/Dice and NMS;
4. AP ranked matches;
5. CLIP similarity matrix loss;
6. diffusion x<sub>t</sub> from ᾱ and noise.

## 3. Design prompts

- visual defect detection with few positives/new factory;
- medical segmentation across hospitals;
- real-time pedestrian detection on edge;
- video moderation and reviewer workflow;
- OCR + LLM invoice processing under injection;
- multimodal product search;
- safe image generation API.

For each: acquisition/grain/labels/split/baseline/metric/slices/model/latency/
fallback/human/privacy/security/drift.

## 4. Part 9 capstone

Build one:

### A. Detection/segmentation service

- source/site/time grouped data card;
- annotation guideline/agreement;
- classical/simple CNN and transfer/ViT candidate;
- augmentation and shortcut ablations;
- task metric by class/size/site plus calibration;
- pre/postprocessing parity and coordinate tests;
- optimized inference API with p99/cost;
- quality/OOD abstention and review UI;
- shadow/canary/monitoring/model card.

### B. Multimodal retrieval

- image–text dataset provenance/dedup/split;
- sparse/metadata and CLIP-like baselines;
- fine-tuned dual encoder with hard-negative audit;
- image→text and text→image recall/NDCG;
- prompt/language/attribute/counterfactual/safety slices;
- ANN index build/update/delete/ACL;
- reranking/latency/cost and online experiment.

### C. Controlled generation

- permitted domain/data/prompt taxonomy;
- diffusion baseline and conditioning;
- quality/alignment/diversity/memorization/safety suite;
- seed/sampler/version reproducibility;
- input/output policy, provenance, rate/identity controls;
- human red team and incident rollback.

## 5. Exit checklist

- [ ] I understand image acquisition/color/geometry/preprocessing.
- [ ] I design/evaluate detection, segmentation, video, and 3D tasks.
- [ ] I explain ViT and self-supervised objectives.
- [ ] I explain dual encoders/VLM grounding and counterfactual evaluation.
- [ ] I derive diffusion training/sampling intuition.
- [ ] I include domain shift, shortcuts, privacy, safety, and production cost.
- [ ] I completed one capstone and can defend failure modes.

