# Chapter 1 — Images, Geometry, Data, and Classical Vision

## 1. Image as measurement

An image depends on scene, illumination, optics, sensor, exposure, demosaicing,
compression, postprocessing, and metadata. Pixels are not pure object truth.

Dataset shifts arise from camera/site/protocol rather than subject. A medical model
can learn scanner/hospital marker; defect model learns production line lighting.

## 2. Digital representation

Shape conventions:

- grayscale H × W;
- RGB H × W × C or C × H × W;
- batch adds N;
- video adds time T.

Color:

- RGB channel order differs from BGR libraries;
- sRGB values are gamma-encoded, not linear light;
- alpha can be premultiplied;
- YCbCr/Lab/HSV encode different properties;
- 8-bit [0,255], float [0,1], or standardized.

Test known color patches. Channel/order/scale mismatch can ruin deployment silently.

## 3. Sampling and aliasing

Downsampling removes samples. High-frequency content above new Nyquist limit aliases
unless low-pass filtered. Resize library interpolation choices:

- nearest: labels/masks; blocky;
- bilinear: common images;
- bicubic/Lanczos: sharper, ringing/cost;
- area: downsampling average-like.

For masks, nearest preserves class IDs; bilinear creates invalid fractional labels.

## 4. Resize, crop, and pad

- stretch: changes aspect/object geometry;
- center/random crop: may remove target and shift composition;
- letterbox/pad: preserves aspect, adds boundary/padding;
- multi-scale: improves robustness, more compute.

Record transform to map boxes/masks back to original coordinates. Coordinate
conventions (xyxy/xywh, normalized/absolute, inclusive/exclusive) must be explicit.

## 5. Geometric transforms

Homogeneous coordinates allow translation/rotation/scaling/projective mapping.

Affine transformation preserves parallel lines:

```text
[x′]   [a b tx] [x]
[y′] = [c d ty] [y]
[1 ]   [0 0 1 ] [1]
```

Homography 3×3 maps planar/projective views up to scale. Estimate from ≥4 non-
collinear correspondences with robust methods (RANSAC) under outliers.

## 6. Camera model

Pinhole projection:

> image point (homogeneous) ∝ K [R ∣ t] world point

- intrinsics K: focal lengths/principal point/skew;
- extrinsics R,t: camera pose;
- depth causes perspective division;
- lens distortion requires calibration.

Single 2D view loses depth/scale; 3D inference needs assumptions/multiple views/
sensors/learned priors.

## 7. Filters and edges

Convolution kernels:

- blur/smoothing;
- sharpening;
- Sobel derivatives/edges;
- Laplacian;
- morphology (erode/dilate for binary shapes).

Edges respond to intensity gradients, not objects inherently. Canny combines
smoothing, gradient, nonmaximum suppression, hysteresis.

Classical features (SIFT/HOG/ORB) remain useful for low-data, geometry, matching,
latency, and baselines.

## 8. Histograms and thresholding

Color/intensity histograms ignore spatial layout. Histogram equalization changes
contrast; CLAHE local contrast. Otsu threshold chooses intensity split maximizing
between-class variance under bimodal-like assumptions.

These transformations can amplify noise and differ across devices; fit/evaluate
domain protocol.

## 9. Annotation types

- image class;
- multilabel tags;
- bounding boxes (visible/amodal);
- polygons/masks;
- keypoints/skeleton;
- tracks across frames;
- depth/flow;
- captions/pairs.

Guidelines define occlusion, tiny objects, crowd, truncation, ambiguous boundary,
ignore region, hierarchy. Measure inter-annotator IoU/class disagreement and audit
small/rare categories.

## 10. Dataset splitting

Group by:

- person/patient/object identity;
- video/burst/session;
- camera/site/location;
- product batch;
- near duplicate;
- time.

Choose holdout matching claim: new frame, new object, new site, future season. Random
image split often leaks backgrounds/subjects.

## 11. Augmentation validity

Transform image **and labels** consistently. Classification may tolerate crop;
detection boxes clip/filter; masks use nearest; keypoints transform/visibility.

Domain constraints:

- text/digits orientation;
- left/right anatomy/driving;
- color diagnostic;
- object size/context;
- temporal consistency across video frames.

Test augmentation output visually/statistically and ablate.

## 12. Data imbalance

- class long tail;
- object size/occlusion;
- background vs foreground anchors/pixels;
- site/camera imbalance;
- duplicated easy images.

Use sampling/weights/focal loss/augmentation, but evaluate real prevalence and
rare-group uncertainty. Copying rare image via augmentation does not create new
identity/context.

## 13. Leakage and shortcuts

- watermarks/text labels;
- border from annotation/export pipeline;
- background/site/camera;
- post-diagnosis overlay;
- file path/metadata;
- near frames;
- class-specific resolution/compression;
- human cropping includes target knowledge.

Tests: background swap, crop masks, source holdout, metadata-only baseline,
low-resolution/gray, counterfactuals, saliency plus ablation.

## 14. Exercises

1. Trace RGB decode/resize/normalize and reproduce train/serve exactly.
2. Transform boxes/masks through letterbox and inverse.
3. Create patient/video/site split and duplicate audit.
4. Demonstrate aliasing under naïve downsample.
5. Build classical HOG/color baseline before CNN.

