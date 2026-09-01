# Part 9 — Computer Vision and Multimodal Learning

## Goal

Build reliable image/video/multimodal systems while understanding acquisition,
annotation, geometry, modern representations, generative models, evaluation, and
deployment. CNN basics are in Part 7; this part goes deeper into domain tasks and
multimodal systems.

```mermaid
flowchart LR
    WORLD[Scene and acquisition] --> PIX[Pixels video depth]
    PIX --> PRE[Geometry color augmentation]
    PRE --> ENC[CNN ViT multimodal encoder]
    ENC --> HEAD[Class detection mask embedding generation]
    HEAD --> MET[Task and slice metrics]
    MET --> DEP[Deployment monitoring and human review]
    DEP -->|new data and failures| PIX
```

## Chapters

| Order | Chapter |
|---:|---|
| 1 | [Images, geometry, data, and classical vision](01-image-foundations.md) |
| 2 | [Detection, segmentation, video, and 3D](02-vision-tasks.md) |
| 3 | [Vision transformers and self-supervised learning](03-vit-and-self-supervision.md) |
| 4 | [Multimodal learning and diffusion models](04-multimodal-and-diffusion.md) |
| 5 | [Production evaluation, interview workbook, and capstone](05-workbook.md) |

## Exit criteria

- trace pixels from acquisition through geometric/color preprocessing;
- choose labels/metrics for classification, detection, segmentation, tracking;
- explain ViT patching, self-supervised objectives, transfer behavior;
- explain CLIP-like contrastive alignment and multimodal retrieval;
- derive diffusion forward/reverse intuition and sampling trade-offs;
- audit leakage, domain shift, shortcuts, safety, latency, and human review.
