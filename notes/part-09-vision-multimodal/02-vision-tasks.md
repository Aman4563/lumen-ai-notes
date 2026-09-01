# Chapter 2 — Detection, Segmentation, Video, and 3D

## 1. Classification variants

- single-label multiclass: softmax;
- multilabel: independent sigmoids/label dependencies;
- hierarchical: taxonomy-consistent outputs;
- open-set: abstain/unknown;
- fine-grained: small visual differences;
- few/zero-shot: prompt/prototype evaluation.

Metrics: per-class precision/recall, macro/micro, calibration, top-k, cost/slices.
Open-set needs unknown/OOD evaluation, not closed-set accuracy.

## 2. Object detection pipeline

Components:

- backbone and feature pyramid;
- candidate locations/queries/anchors;
- classification/objectness;
- box regression;
- matching positives/negatives;
- postprocess/NMS;
- evaluation/serving transforms.

## 3. Box parameterization and loss

Common box (x<sub>center</sub>, y<sub>center</sub>, w, h) or corners. Predict offsets
relative to anchors/grid with log scale for sizes.

Loss combines class/objectness and localization (L1/smooth-L1/IoU/GIoU/DIoU-like).
IoU loss aligns overlap but gradient can be weak when boxes disjoint; generalized
variants add enclosing geometry.

## 4. Matching

Anchor-based labels by IoU thresholds; imbalance creates many negatives. Anchor-
free predicts centers/edges. Set-based detector uses bipartite/Hungarian matching
between predictions and ground truth, avoiding ordinary NMS but requiring matching
cost/no-object handling.

Ambiguous assignment and tiny objects strongly affect training.

## 5. Detection metrics

For each class and IoU threshold:

1. sort predictions by confidence;
2. match each to unused ground truth under IoU;
3. produce precision–recall curve;
4. integrate average precision (AP);
5. mean across classes/thresholds per benchmark.

State convention (e.g. AP50 versus average .50:.95), interpolation, crowd/ignore.
Also report size/occlusion/site, recall at proposal K, latency, calibration.

## 6. NMS

Greedy:

1. take highest score;
2. remove remaining boxes IoU > threshold;
3. repeat.

Soft-NMS decays scores. Class-wise versus class-agnostic changes overlaps. NMS can
suppress distinct crowded objects and adds CPU/GPU latency. Tune on validation.

## 7. Semantic segmentation

Pixel class logits. Class imbalance enormous; losses:

- pixel cross-entropy;
- Dice/Tversky;
- focal;
- boundary/region combinations.

Mean IoU averages class IoUs. Background dominance makes pixel accuracy misleading.
Ignore labels/mask void pixels in loss/metric.

U-Net skip connections combine localization details with semantic encoder. Feature
pyramids/dilation/transformers capture scales/context.

## 8. Instance and panoptic segmentation

Instance predicts object masks (proposal-based or set-based). AP over mask IoU.
Panoptic combines “things” instances and “stuff” regions; panoptic quality combines
recognition and segmentation. Handle overlapping/void/crowd conventions.

## 9. Keypoints and pose

Predict heatmaps or coordinates plus visibility. Heatmaps easier spatial uncertainty
but quantization; coordinate regression compact. Metrics often object keypoint
similarity/PCK with scale. Occlusion, left/right, multi-person association.

## 10. Optical flow

Dense motion between frames. Classical brightness constancy/smoothness assumptions;
deep matching/correlation. Occlusion and lighting violate. Endpoint error, outlier
rate; temporal consistency. Flow not equal physical object motion under camera
motion/depth.

## 11. Video understanding

Representations:

- frame CNN + temporal pooling/RNN;
- 3D convolution;
- two-stream RGB/flow;
- video transformer/tubelets;
- sparse frame sampling;
- tracking + event logic.

Trade-offs: temporal coverage, motion detail, compute, annotation. Avoid frames from
same clip across split. Evaluate event boundaries, long duration, streaming delay.

## 12. Object tracking

Detection + data association using motion (Kalman), appearance embeddings, IoU;
or joint models.

Metrics: MOTA (mixes errors), IDF1, HOTA concepts, ID switches, track fragmentation,
detection quality. Occlusion/re-entry/camera motion. Identity is sensitive data.

## 13. Depth and 3D

- monocular depth learns relative/priors; absolute scale ambiguous;
- stereo triangulates disparity with calibration;
- LiDAR point clouds sparse metric depth;
- RGB-D combines.

Point clouds: unordered sets; voxelization, point networks, sparse conv. 3D boxes,
bird’s-eye view, coordinate frames/calibration/time synchronization.

Metrics: depth absolute-relative/RMSE, 3D IoU/AP. Evaluate weather/range/sensor shift.

## 14. OCR/document vision

Pipeline: detect regions → rectify → recognize → layout/table/reading order →
language/model → confidence/human review.

Metrics character/word error rate, field exact match, layout/table structure, end
task. OCR text is untrusted input for downstream LLM/tools; injection/security.

## 15. Production task design

- cascade quality detector → cheap model → expensive model/review;
- tile large images with overlap and merge;
- batch video frames but preserve deadlines;
- pre/postprocessing version and coordinate transforms;
- hardware decode and zero-copy where possible;
- calibrate confidence per class/site;
- abstain on low quality/OOD;
- human UI with original + overlay + uncertainty;
- log versions and privacy-safe artifacts.

## 16. Exercises

1. Calculate detection AP for tiny ranked prediction list.
2. Implement NMS and construct crowded failure.
3. Compare CE/Dice on small foreground.
4. Design video split/tracking metrics.
5. Trace coordinate frames in RGB–LiDAR fusion.

