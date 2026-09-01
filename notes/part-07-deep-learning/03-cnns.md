# Chapter 3 — Convolutional Neural Networks

## 1. Why convolution

Images have local structure and repeated patterns. Dense layer from 224×224×3 to
1,000 outputs needs about 150M weights. Convolution uses:

- local receptive fields;
- shared kernels across locations;
- translation equivariance;
- hierarchical composition.

## 2. 2D convolution operation

Deep-learning “convolution” commonly implements cross-correlation (kernel not
flipped), but learned result makes naming distinction minor.

Input X shape (C<sub>in</sub>, H, W), kernel K shape
(C<sub>out</sub>, C<sub>in</sub>, K<sub>h</sub>, K<sub>w</sub>).

Each output channel/location sums kernel-weighted local input across channels plus
bias.

Parameter count:

> C<sub>out</sub> · C<sub>in</sub> · K<sub>h</sub> · K<sub>w</sub>
> + C<sub>out</sub> biases

Independent of image H/W.

## 3. Output shape

For input size H, kernel K, padding P, dilation D, stride S:

> H<sub>out</sub> = floor[(H + 2P − D(K − 1) − 1)/S + 1]

Apply separately to width.

Effective kernel size:

> K<sub>eff</sub> = D(K − 1) + 1

“Same” padding usually preserves size for stride 1; even kernels/stride >1 have
framework-specific asymmetric definitions.

## 4. Stride, padding, dilation

- Stride >1 downsamples and may alias; learned conv/downsampling.
- Padding controls boundary and output; zero padding creates edge artifact.
- Dilation spaces kernel samples, expanding receptive field without more weights,
  but can create gridding.

## 5. Receptive field

Track receptive field r and jump j (spacing in input between adjacent outputs):

> j<sub>l</sub> = j<sub>l−1</sub> · stride<sub>l</sub>  
> r<sub>l</sub> = r<sub>l−1</sub> + (K<sub>eff,l</sub> − 1)j<sub>l−1</sub>

Start r₀ = 1, j₀ = 1. Theoretical receptive field can be large while effective
influence concentrates centrally.

Stacking two 3×3 stride-1 convs yields 5×5 receptive field with two nonlinearities
and fewer weights than one 5×5 (for similar channels).

## 6. Pooling

- max pooling: strongest local activation;
- average pooling: local average;
- global average pooling: one value per channel.

Pooling adds invariance/downsampling but discards location. Strided convolution can
learn downsampling. For segmentation/localization, preserve or recover resolution.

## 7. Equivariance versus invariance

Convolution is translation equivariant ideally: shifting input shifts feature map.
Padding/stride/boundaries break exactness. Pooling/global aggregation increases
approximate invariance.

Classification wants some translation invariance; segmentation needs equivariant
spatial output. Architecture should match task.

## 8. CNN building blocks

Typical block:

```text
Conv -> normalization -> activation -> optional downsample/dropout
```

Modern details vary: preactivation, bias omitted before norm, stochastic depth,
anti-aliasing, squeeze-excitation.

### 1×1 convolution

Mixes channels per spatial location; changes dimension/bottleneck, adds nonlinearity
between spatial convs. Does not mix neighboring pixels by itself.

### Depthwise separable convolution

Depthwise spatial kernel per input channel then 1×1 pointwise mixing.

Standard approximate multiply cost:

> HWC<sub>in</sub>C<sub>out</sub>K²

Depthwise separable:

> HWC<sub>in</sub>K² + HWC<sub>in</sub>C<sub>out</sub>

Major mobile efficiency, but memory/kernel efficiency determines real latency.

### Grouped convolution

Channels split into groups. Reduces compute/parameters and creates structured
connectivity. Depthwise is groups = C<sub>in</sub> special case.

## 9. Residual networks

Residual block y = F(x) + x. Projection handles channel/stride mismatch. Enables
very deep networks and eases optimization.

Preactivation ResNet puts normalization/activation before convolution, giving
cleaner identity path. Bottleneck block uses 1×1 reduce, 3×3, 1×1 expand.

## 10. Classic architecture lessons

- LeNet: early conv/pooling.
- AlexNet: deep ReLU/GPU/dropout data scale.
- VGG: repeated small kernels, simple but heavy.
- Inception: multiscale branches/1×1 bottlenecks.
- ResNet: residual learning.
- DenseNet: feature reuse via dense connections.
- MobileNet/EfficientNet: depthwise/compound scaling/mobile efficiency.
- Vision Transformer: patch tokens + attention; less built-in locality, scale/data.

Know principles, not layer-count trivia.

## 11. Transfer learning

Use pretrained backbone:

1. match preprocessing/input channels;
2. replace task head;
3. train head with frozen backbone baseline;
4. unfreeze later layers/all with lower learning rates;
5. use normalization mode carefully;
6. validate domain shift and license/provenance.

Small target data benefits. Negative transfer occurs when source/domain/task mismatch.
Fine-tuning can forget/pretrained representations; discriminative learning rates,
gradual unfreeze, adapters, regularization help.

## 12. Data augmentation

Geometric: crop, resize, flip, rotate, perspective. Photometric: brightness,
contrast, color, blur, noise. Advanced: Mixup, CutMix, RandAugment-like policies.

Validity is task-dependent:

- horizontal flip may swap left/right medical meaning;
- rotation may invalidate digits/orientation;
- aggressive crop removes target;
- color change may erase diagnostic signal;
- detection/segmentation labels must transform consistently.

Evaluate augmentation ablation and realistic corruptions.

## 13. Detection

Output classes + bounding boxes.

- two-stage: region proposals then classify/refine (Faster R-CNN concepts);
- one-stage: dense predictions (YOLO/SSD/RetinaNet concepts);
- transformer detectors: set prediction/attention.

Intersection over Union:

> IoU = area(pred ∩ truth)/area(pred ∪ truth)

Non-maximum suppression removes overlapping boxes by score/IoU; can suppress nearby
distinct objects. Metrics: average precision across classes/IoU thresholds, plus
size/latency/slices. AP implementation conventions matter.

Anchor design/imbalance, box parameterization, focal loss, and matching are central.

## 14. Segmentation

- semantic: class per pixel;
- instance: separate object masks;
- panoptic: combines stuff/things.

Architectures: encoder–decoder, skip connections (U-Net), dilated conv, feature
pyramids, transformer decoders.

Metrics:

> Dice = 2|P ∩ G|/(|P| + |G|)  
> IoU = |P ∩ G|/|P ∪ G|

For binary masks Dice = 2IoU/(1 + IoU) under same threshold. Empty masks need
defined convention. Pixel accuracy hides small-class failures.

## 15. Vision failure modes

- train/test near duplicates/videos/patients;
- background/watermark/site shortcuts;
- class/size imbalance;
- label boxes/masks inconsistent;
- image decode/color/channel mismatch;
- crop/resize train-serve mismatch;
- domain shift cameras/weather/sites;
- adversarial patches/physical changes;
- calibration and selective review;
- latency dominated by decode/pre/post-processing.

## 16. Explainability/robustness

Saliency/Grad-CAM visualize sensitivity/localization, but can be noisy, method-
dependent, and reassuring even for bad models. Sanity-check against parameter/label
randomization and controlled perturbations.

Robust evaluation:

- corruptions/lighting/blur/compression;
- acquisition device/site;
- backgrounds/counterfactuals;
- occlusion;
- worst-group/small objects;
- adversarial threat model;
- abstention/quality detector.

## 17. Compute and memory

Convolution FLOPs approximate output spatial × kernel × in/out channels; counting
multiply-add as one or two differs. FLOPs do not equal latency: memory bandwidth,
kernel fusion, batch, layout, accelerator, quantization matter.

Use profiling. Optimizations: lower resolution, channel/depth scaling, efficient
ops, mixed precision, compilation/fusion, pruning/distillation/quantization, cascade.

## 18. Exercises

1. Calculate output shape/parameters/receptive field for a CNN.
2. Implement convolution for a tiny array and compare library.
3. Fine-tune backbone with freeze/unfreeze ablation.
4. Create background shortcut dataset and test domain holdout.
5. Calculate IoU/Dice/AP concepts for toy detections.

