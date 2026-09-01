# Chapter 4 — Multimodal Learning and Diffusion Models

## 1. Multimodal system types

- dual encoder: independent modality embeddings + similarity;
- fusion encoder: early/late cross-modal interaction;
- encoder–decoder: image/audio encoder conditions text decoder;
- unified token model;
- generative diffusion conditioned on text/image/audio;
- tool pipeline: specialist perception + LLM reasoning.

Choose by retrieval versus fine-grained reasoning/generation, data, latency, and
alignment.

## 2. CLIP-like contrastive learning

Batch of matched image/text pairs. Encode normalized u<sub>i</sub>, v<sub>i</sub>.
Similarity:

> s<sub>ij</sub> = u<sub>i</sub>ᵀv<sub>j</sub>/τ

Symmetric cross-entropy makes true pair diagonal high for image→text and text→image.

Benefits: zero-shot classification via text prompts, cross-modal retrieval,
transfer. Limitations:

- noisy web pair bias;
- false negatives/multiple valid captions;
- prompt sensitivity;
- weak counting/spatial/compositional reasoning;
- embedding bias/privacy;
- contrastive batch scale.

## 3. Zero-shot classification

Create text prompts for each class, encode/ensemble templates, compare image cosine,
softmax temperature. Class names/descriptions/templates are part of model; tune on
development only. Calibrate and include unknown/open-set behavior.

## 4. Multimodal fusion

### Early fusion

Combine tokens/features then joint transformer. Rich interaction, expensive and
requires aligned data.

### Cross-attention

One modality queries another. Perceiver/query-former style compresses variable
visual tokens before LLM.

### Late fusion

Combine predictions/embeddings; modular/cheap, misses fine-grained interactions.

## 5. Vision-language model training

Objectives:

- contrastive alignment;
- image–text matching;
- caption/next-token generation;
- masked multimodal modeling;
- instruction tuning on image conversations;
- grounding/region/box tasks;
- preference/safety tuning.

Data quality: captions can omit visible facts, contain bias, private info, OCR
injection, duplicates. Instruction data often synthetic and inherits teacher errors.

## 6. VLM evaluation

- visual QA by skill: OCR, counting, spatial, chart, fine-grained;
- caption factuality/coverage;
- grounding boxes/masks;
- hallucinated objects/attributes;
- cross-modal retrieval;
- robustness to irrelevant text/image regions;
- adversarial text inside image;
- accessibility/use task;
- latency/image token cost.

Text-only priors can answer without image. Use counterfactual image swaps/blanking
and question pairs requiring visual evidence.

## 7. Diffusion forward process

Gradually add Gaussian noise to data x₀:

> q(x<sub>t</sub> ∣ x<sub>t−1</sub>)
> = Normal(√(1 − β<sub>t</sub>)x<sub>t−1</sub>, β<sub>t</sub>I)

Define α<sub>t</sub> = 1 − β<sub>t</sub>, cumulative ᾱ<sub>t</sub> = ∏ α.

Closed form:

> x<sub>t</sub> = √ᾱ<sub>t</sub>x₀ + √(1 − ᾱ<sub>t</sub>)ε,
> with ε ~ Normal(0,I)

At large t data becomes noise.

## 8. Reverse denoising model

Learn network ε<sub>θ</sub>(x<sub>t</sub>, t, condition) to predict noise (or x₀/
velocity variants). Simplified training:

> E[t,x₀,ε] ‖ε − ε<sub>θ</sub>(x<sub>t</sub>,t,c)‖²

At generation start random noise and iteratively denoise using learned reverse
transitions/sampler.

U-Net with timestep embeddings/attention historically common; diffusion
transformers operate latent patches.

## 9. Latent diffusion

Autoencoder maps image to lower-dimensional latent. Run diffusion in latent, then
decode. Reduces compute/memory; autoencoder can lose fine detail/artifact and latent
scale matters.

## 10. Conditioning and classifier-free guidance

Train with condition sometimes dropped, producing conditional and unconditional
noise predictions. Combine:

> ε<sub>guided</sub> = ε<sub>uncond</sub>
> + s(ε<sub>cond</sub> − ε<sub>uncond</sub>)

Higher guidance s improves prompt adherence but can reduce diversity/saturate/artifact.

Additional conditioning: image, mask/inpainting, depth, edge, pose, adapters/control
networks, identity—raises privacy/misuse concerns.

## 11. Sampling

Original stochastic many-step; DDIM-like deterministic/stochastic fewer steps;
ODE/SDE and high-order solvers. Trade quality/diversity/latency. Distillation/
consistency/flow methods reduce steps.

Seed does not guarantee cross-hardware/version bitwise same. Record model, sampler,
steps, guidance, resolution, prompt/negative prompt, seed.

## 12. Generative evaluation

- prompt alignment/human preference;
- perceptual/technical quality;
- diversity/coverage;
- FID-like distribution distance (feature/model/sample-size sensitive);
- CLIP score (alignment proxy, gameable);
- memorization/nearest training examples;
- identity/fairness/representation;
- unsafe content and overblocking;
- watermark/provenance;
- latency/cost.

No scalar captures creativity/factuality/safety. Curate prompt suites and human/
task evaluation.

## 13. Safety and provenance

- nonconsensual imagery/identity/deepfakes;
- minors/sexual/violent content;
- copyrighted/style and training provenance;
- misinformation;
- biometric privacy;
- hidden prompt/OCR injection to VLM;
- generated-image metadata/watermark limitations;
- content credentials/source transparency;
- tool actions based on misperception.

Use policy classifiers, input/output checks, restricted capabilities, rate limits,
identity consent, human review, incident response—recognizing classifier evasion and
false positives.

## 14. Exercises

1. Implement CLIP contrastive loss for a small batch.
2. Evaluate zero-shot prompt template sensitivity.
3. Construct VLM counterfactual image tests.
4. Simulate forward diffusion and train tiny noise predictor conceptually.
5. Sweep guidance/steps and score quality/diversity/cost/safety.

