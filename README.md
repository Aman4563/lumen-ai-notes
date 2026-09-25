# AI/ML Learning Notes

> Prefer studying on iPhone? The repository now includes **Lumen AI Notes**, an
> installable offline reading, narration, annotation, teaching, editing, and
> whiteboard app. See the [app and iPhone installation guide](APP_GUIDE.md).

For maintainers taking over the current implementation, start with the
[engineering handoff and current-state audit](ENGINEERING_HANDOFF.md), then use
[the product requirement tracker](PRODUCT_REQUIREMENTS.md) as the status authority.

This repository is a from-scratch, interview-oriented path through artificial
intelligence and machine learning. It is designed for:

- a beginner who needs the ideas built in the right order;
- a software engineer targeting SDE-II/SDE-III roles that touch ML;
- an aspiring ML engineer, applied AI engineer, or data scientist; and
- an experienced engineer preparing for ML coding, ML fundamentals, and ML
  system-design interviews.

## Start here

1. Open the [curriculum navigator](notes/README.md) for every part and chapter.
2. Read the [complete roadmap](notes/00-roadmap.md) to understand the dependency
   order, projects, pacing, and interview expectations.
3. Begin [Part 1: AI/ML foundations](notes/part-01-foundations/README.md). Parts 2
   and 3 may be studied in parallel.
4. After Part 3, take the general-engineering pass: Part 13 Chapters 1–4 (Git) and
   Part 14 Chapters 1–7 (Linux, Docker, Compose, Kubernetes, and Slurm). Then
   return to Parts 4–12.
5. Use each part's workbook for active recall after reading its conceptual
   chapters; recognition alone is not mastery.
6. After Part 12, finish Part 13 Chapters 5–6 and Part 14 Chapters 8–9, then
   continue through Parts 15–23. The [navigator](notes/README.md) gives exact
   prerequisites.

## Notes currently available

| Part | Topic | Status |
|---:|---|---|
| 1 | [AI/ML foundations and problem framing](notes/part-01-foundations/README.md) | Complete |
| 2 | [Mathematical foundations](notes/part-02-mathematics/README.md) | Complete |
| 3 | [Python, SQL, DSA, and the data stack](notes/part-03-python-data-stack/README.md) | Complete |
| 4 | [Data preparation and feature engineering](notes/part-04-data-and-features/README.md) | Complete |
| 5 | [Classical supervised learning](notes/part-05-supervised-learning/README.md) | Complete |
| 6 | [Unsupervised and representation learning](notes/part-06-unsupervised-learning/README.md) | Complete |
| 7 | [Deep learning foundations](notes/part-07-deep-learning/README.md) | Complete |
| 8 | [NLP, transformers, and LLM applications](notes/part-08-nlp-transformers-llms/README.md) | Complete |
| 9 | [Computer vision and multimodal learning](notes/part-09-vision-multimodal/README.md) | Complete |
| 10 | [Specialized ML domains](notes/part-10-specializations/README.md) | Complete |
| 11 | [MLOps and production ML](notes/part-11-mlops-production/README.md) | Complete |
| 12 | [ML system design, safety, and senior interviews](notes/part-12-system-design-interviews/README.md) | Complete |
| 13 | [Git, collaboration, research engineering, and reproducibility](notes/part-13-research-git/README.md) | Complete |
| 14 | [Linux, Docker, Compose, Kubernetes, and Slurm](notes/part-14-containers-clusters/README.md) | Complete |
| 15 | [Accelerators, kernels, compilation, and profiling](notes/part-15-accelerators-kernels/README.md) | Complete |
| 16 | [Foundation-model data and tokenization](notes/part-16-foundation-model-data/README.md) | Complete |
| 17 | [Foundation-model architectures and scaling](notes/part-17-architectures-scaling/README.md) | Complete |
| 18 | [Training optimization and distributed systems](notes/part-18-training-distributed/README.md) | Complete |
| 19 | [Fine-tuning and post-training](notes/part-19-fine-tuning-post-training/README.md) | Complete |
| 20 | [Reinforcement learning](notes/part-20-reinforcement-learning/README.md) | Complete |
| 21 | [High-performance inference systems](notes/part-21-inference-systems/README.md) | Complete |
| 22 | [Evaluation, safety, security, and interpretability](notes/part-22-evaluation-safety/README.md) | Complete |
| 23 | [Technology selection and end-to-end capstone](notes/part-23-technology-capstone/README.md) | Complete |

Read the [strict AI/ML curriculum audit](notes/01-advanced-curriculum-coverage-audit.md)
and the [general software-engineering audit](notes/02-general-engineering-coverage-audit.md)
for depth expectations, role coverage, technology categories, practical evidence,
and honest limitations.

## How to use these notes

Do not only read. For each chapter, use this loop:

```text
Read -> close the notes -> explain aloud -> solve -> implement -> review errors
```

A concept is not yet learned if you can only recognize its definition. You
should be able to:

1. explain it without jargon;
2. derive or interpret its important formula;
3. select it in a realistic engineering scenario;
4. identify when it fails; and
5. connect it to production constraints.

Mermaid blocks are used for diagrams. Equations are stored as native MathML or
readable Unicode formula panels, so they render in an ordinary browser-based
Markdown preview without a LaTeX/MathJax extension. Every important equation is
also explained in words for readers who are still learning the notation.

## Depth and interview level

Each part is intentionally layered:

- **Beginner:** intuition, vocabulary, notation, and small examples;
- **Practitioner:** implementation choices, evaluation, failure modes, and
  exercises; and
- **Advanced/SDE-II/SDE-III:** derivations, systems trade-offs, production
  constraints, incident thinking, and interview prompts.

The notes are a durable curriculum rather than a promise that reading alone is
enough. Build the projects, derive important results, keep an error log, and
practice explaining decisions under changing constraints.

## Contributing

Corrections to the notes and improvements to the app are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, the release gate, and the
constraints every change must respect, and follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## License

- The application code is licensed under the [MIT License](LICENSE).
- The curriculum notes in `notes/` are licensed under
  [Creative Commons Attribution 4.0](LICENSE-NOTES.md): you may share and adapt
  them with credit. Third-party images and quotations linked from the notes
  keep their owners' licenses.
- Third-party models and runtimes keep their own terms; see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
