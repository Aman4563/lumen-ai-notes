# Lumen AI Notes

[![CI](https://github.com/Aman4563/lumen-ai-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/Aman4563/lumen-ai-notes/actions/workflows/ci.yml)
[![Code license: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Notes license: CC BY 4.0](https://img.shields.io/badge/notes-CC%20BY%204.0-lightgrey.svg)](LICENSES/NOTES-CC-BY-4.0.md)

Lumen AI Notes is two things in one repository: a from-scratch AI and machine
learning curriculum, and an iPhone-first, local-first study app for working
through it. The curriculum runs in 23 parts from problem framing and
mathematics to foundation-model training, inference systems and senior
interview preparation. The app installs from Safari, works offline, reads
lectures aloud, schedules spaced review, and includes a private AI tutor that
runs on your own Mac or, experimentally, in the phone's browser. There is no
account, and your study data is stored on your device.

## Features

### Read and listen

- **The full curriculum offline.** All 143 built-in lectures: 23 parts plus
  the roadmap, navigator and coverage audits. The app installs to the Home
  Screen; its shell is cached on install and each lecture is kept for offline
  use once you have opened it.
- **A reader built for technical text.** MathML formulas (and TeX math in
  your own notes), Mermaid diagrams, tables, copyable code blocks, find in
  lecture, bookmarks, reading progress and your exact reading position.
- **Narration** with the voices your device provides, each labelled as on
  device or possibly using the network. Choose voice, speed, pitch and volume;
  read the current sentence, section, a selection or the whole lecture; save
  audio bookmarks; and teach the voice how to pronounce technical terms.
- **Teaching mode** turns each major section into a slide, with an
  active-recall switch that hides the section until you have explained it,
  and can print every section as a PDF.
- **Themes and typography.** Paper, Night, Contrast or follow the system, with
  adjustable text size, line height and reading width.

### Remember and practise

- **Spaced review.** Create cards by hand or from a highlight, including cloze
  cards. Schedule them with Classic (SM-2 family) or Adaptive (FSRS-4.5), which
  can calibrate to your own review history. Export and import decks as JSON.
- **Mistake notebook.** Cards you fail, misses from readiness checks,
  worksheet labs and Mac local tutor quizzes, and missed interview points
  collect in one place, filtered by category, for corrective review.
- **Readiness checks** for each part, built from your own cards.
- **Interview practice.** Authored interview tracks with timed rounds and
  rubrics, plus worksheet labs (Python, SQL, debugging and metrics) with
  self-checks.
- **Planning.** A home dashboard with today's plan, a study goal and the pace
  it implies, mastery by part and a prerequisite map of the curriculum. Lumen
  never sends notifications. An optional app badge counts due reviews in
  browsers that allow it; iPhone shows web-app badges only after notification
  permission is granted, and Lumen does not ask for it.

### AI tutor

- **Mac local.** Lumen's Node server calls [Ollama](https://ollama.com) on the
  same Mac (default model `qwen3.5:4b`). Answers stream with visible progress
  and can be stopped at any time.
- **On-device Lite.** Llama 3.2 1B runs inside the browser through WebLLM on
  devices whose browser supports WebGPU. The model (about 710 MB) is
  downloaded only after you approve it. It is experimental and not yet
  verified on a physical iPhone; Mac local is the recommended engine.
- **Grounded answers with citations.** By default the tutor searches your whole
  local library, including your own notes and edits, and cites the passages
  it used as `[S1]`, `[S2]` and so on. You can limit it to the current lesson,
  chosen sources, or no library at all.
- **Modes.** Mac local offers Explain, Socratic, Quiz, Flashcards, Code
  review, Interview, Summarize and Study plan; On-device Lite offers the same
  without Code review. In a Mac local quiz you can mark how sure you are,
  confident misses are listed first, and misses can be saved to the mistake
  notebook. Generated flashcards can be added to your review deck.
- **Optional web search** through a self-hosted [SearXNG](https://docs.searxng.org)
  instance. It is off by default and each request needs your approval.
- No paid AI service or API key is used.

### Organise and create

- **Search** across built-in lectures and your own notes, ranked, with quoted
  phrases, `-term` exclusions and `title:`, `part:`, `tag:`, `has:code` and
  `has:formula` filters. Press ⌘/Ctrl+K to search from anywhere, or `?` for
  the keyboard shortcut sheet.
- **Highlights** in four colours with comments and tags, a private note per
  lecture, and clippings collected in the Notebook.
- **Your own notes.** Write new notes, import Markdown, text, HTML and EPUB
  files, edit a private copy of any built-in lecture with revision history,
  and export a lecture as Markdown, HTML or a printable PDF.
- **Collections.** Organise your own notes and uploads with tags,
  collections, pinning and archiving. Deleted ones stay restorable from the
  trash for 30 days.
- **Whiteboards.** Multi-page boards with pen, highlighter, eraser, lines,
  shapes, arrows, text and sticky notes, Apple Pencil pressure, undo and redo,
  and PNG, SVG or JSON export.

### Your data

- **Local-first.** Progress, notes, highlights, reviews, whiteboards and
  settings are stored in your browser on your device, mainly in IndexedDB.
- **No account and no tracking.** There is no account to create, and no
  analytics or advertising code.
- **Encrypted backups.** Export everything to one file, optionally encrypted
  with AES-256-GCM under a password. Backups are checksummed, and a restore is
  checked before it replaces anything.
- **Storage health** in Settings shows how much space Lumen uses and can
  remove optional offline files.
- **Sync without a server.** Export your device's encrypted sync file to a
  folder you share (iCloud Drive, Syncthing, a USB stick), then import your
  peers' files to merge them. Nothing syncs in the background, and a vault
  passphrase and HTTPS are required. Open tabs of the same app merge their
  changes automatically.

## Privacy

- Lumen has no cloud service or database of its own. Your study data leaves
  the device only in backup or sync files you export, in tutor requests to
  the Mac that runs Lumen's server, in web searches you approve, and in text
  read aloud by a voice marked "May use network", as described below.
- AI features can be turned off entirely in Settings. You also choose how much
  Mac tutor history is kept, including none.
- Mac local requests go from the app to the Mac that runs Lumen's server,
  which calls Ollama on that Mac. On-device Lite keeps prompts and lesson text
  inside the browser; the model files are downloaded once from WebLLM/MLC
  model hosting after you approve it.
- Web search is off unless it is enabled on the Mac that runs Lumen's server
  and you approve the request. Queries then go through your self-hosted
  SearXNG to the public search engines it is configured to use.
- Narration uses the voices your device provides. Voices marked "May use
  network" can send the text they read to the platform's speech service; the
  voice picker labels each voice.
- A few lectures show images hosted on third-party sites, which load from
  those sites when you open the lecture.

## Quick start

You need Node.js 20.19+ or 22.12+ to run the app, and Node.js 26 (see
`.nvmrc`) to run the full release checks.

```sh
npm ci
npm run dev
```

Open the address Vite prints (by default `http://127.0.0.1:5173`).

**Local AI (optional).** Install [Ollama](https://ollama.com), pull the model
with `ollama pull qwen3.5:4b`, then run `npm run dev:ai` in a second terminal
alongside `npm run dev`. The [local AI server guide](docs/guides/AI_SERVER.md)
covers web search, learner pairing and serving the tutor to an iPhone.

**Install on iPhone.** Build the app, serve it over HTTPS on your home network
([private HTTPS guide](docs/guides/LOCAL_HTTPS.md)), open it in Safari and
choose Share, then Add to Home Screen. The
[app and iPhone guide](docs/guides/APP_GUIDE.md#install-it-on-iphone-16-pro)
has the full steps. On-device Lite is described in the
[On-device Lite guide](docs/guides/PHONE_LOCAL_AI.md).

## Study with the notes

The notes are an interview-oriented path through artificial intelligence and
machine learning. They are written for:

- a beginner who needs the ideas built in the right order;
- a software engineer targeting SDE-II/SDE-III roles that touch ML;
- an aspiring ML engineer, applied AI engineer or data scientist; and
- an experienced engineer preparing for ML coding, ML fundamentals and ML
  system-design interviews.

You can read them in the app or directly on GitHub.

### Start here

1. Open the [curriculum navigator](notes/README.md) for every part and chapter.
2. Read the [complete roadmap](notes/00-roadmap.md) to understand the dependency
   order, projects, pacing and interview expectations.
3. Begin [Part 1: AI/ML foundations](notes/part-01-foundations/README.md). Parts 2
   and 3 may be studied in parallel.
4. After Part 3, take the general-engineering pass: Part 13 Chapters 1–4 (Git) and
   Part 14 Chapters 1–7 (Linux, Docker, Compose, Kubernetes and Slurm). Then
   return to Parts 4–12.
5. After a part's conceptual chapters, use its workbook, lab or interview
   chapter for active recall; recognition alone is not mastery.
6. After Part 12, finish Part 13 Chapters 5–6 and Part 14 Chapters 8–9, then
   continue through Parts 15–23. The [navigator](notes/README.md) gives exact
   prerequisites.

### How to study

Do not only read. For each chapter, use this loop:

```text
Read -> close the notes -> explain aloud -> solve -> implement -> review errors
```

A concept is not yet learned if you can only recognise its definition. You
should be able to:

1. explain it without jargon;
2. derive or interpret its important formula;
3. select it in a realistic engineering scenario;
4. identify when it fails; and
5. connect it to production constraints.

Each part is layered: **beginner** material covers intuition, vocabulary,
notation and small examples; **practitioner** material covers implementation
choices, evaluation, failure modes and exercises; and **advanced (SDE-II/SDE-III)**
material covers derivations, systems trade-offs, production constraints,
incident thinking and interview prompts. Reading alone is not enough: build the
projects, derive the important results, keep an error log and practise
explaining decisions under changing constraints.

Diagrams are Mermaid blocks, and equations are written as MathML or readable
Unicode, so the notes render in an ordinary Markdown preview without a LaTeX
extension. Important equations are also explained in words.

### The 23 parts

| Part | Topic | Chapters |
|---:|---|---:|
| 1 | [AI/ML foundations and problem framing](notes/part-01-foundations/README.md) | 8 |
| 2 | [Mathematical and statistical foundations](notes/part-02-mathematics/README.md) | 7 |
| 3 | [Python, SQL, DSA, and the data stack](notes/part-03-python-data-stack/README.md) | 8 |
| 4 | [Data preparation and feature engineering](notes/part-04-data-and-features/README.md) | 5 |
| 5 | [Classical supervised learning](notes/part-05-supervised-learning/README.md) | 5 |
| 6 | [Unsupervised and representation learning](notes/part-06-unsupervised-learning/README.md) | 5 |
| 7 | [Deep learning foundations](notes/part-07-deep-learning/README.md) | 6 |
| 8 | [NLP, transformers, and LLM applications](notes/part-08-nlp-transformers-llms/README.md) | 7 |
| 9 | [Computer vision and multimodal learning](notes/part-09-vision-multimodal/README.md) | 5 |
| 10 | [Domain specializations](notes/part-10-specializations/README.md) | 7 |
| 11 | [MLOps and production ML](notes/part-11-mlops-production/README.md) | 6 |
| 12 | [ML system design, responsible AI, and senior interviews](notes/part-12-system-design-interviews/README.md) | 6 |
| 13 | [Git, collaboration, research engineering, and reproducibility](notes/part-13-research-git/README.md) | 6 |
| 14 | [Linux, containers, Docker, Compose, Kubernetes, and Slurm](notes/part-14-containers-clusters/README.md) | 9 |
| 15 | [Accelerators, kernels, compilation, and profiling](notes/part-15-accelerators-kernels/README.md) | 2 |
| 16 | [Foundation-model data and tokenization](notes/part-16-foundation-model-data/README.md) | 2 |
| 17 | [Foundation-model architectures and scaling](notes/part-17-architectures-scaling/README.md) | 2 |
| 18 | [Training optimization and distributed systems](notes/part-18-training-distributed/README.md) | 3 |
| 19 | [Fine-tuning, preference learning, and post-training](notes/part-19-fine-tuning-post-training/README.md) | 2 |
| 20 | [Reinforcement learning](notes/part-20-reinforcement-learning/README.md) | 6 |
| 21 | [High-performance inference systems](notes/part-21-inference-systems/README.md) | 3 |
| 22 | [Evaluation, safety, security, and interpretability](notes/part-22-evaluation-safety/README.md) | 3 |
| 23 | [Technology selection, end-to-end capstone, and interview synthesis](notes/part-23-technology-capstone/README.md) | 3 |

Together with each part's index, the roadmap, the navigator and two coverage
audits, that makes 143 lectures. The
[AI/ML curriculum audit](notes/01-advanced-curriculum-coverage-audit.md) and the
[general software-engineering audit](notes/02-general-engineering-coverage-audit.md)
explain the depth each part aims for, which roles it prepares you for, and
where the notes stop.

## Project structure

```text
notes/          the curriculum: one folder per part, plus the navigator and roadmap
src/            the React app: screens, study logic, workers, generated content index
server/         Node server for the built app and the local AI API (Ollama, SearXNG)
public/         PWA manifest, icons, service worker and bundled licence texts
scripts/        content index generator, test and browser check runners, HTTPS helpers
eval/           versioned retrieval and grounding evaluation
infra/searxng/  optional loopback-only SearXNG for web search (Docker Compose)
docs/           guides, design notes and testing notes (see docs/README.md)
LICENSES/       the notes licence, third-party notices and bundled model licences
.github/        contributing guide, code of conduct, security policy, templates, CI
```

## Development

```sh
npm run check           # curriculum checks; unit, scale, storage, backup and
                        # AI suites; retrieval evaluation; production build
                        # and PWA checks
npm run check:browser   # browser suites in Chrome against an isolated server
```

`npm run check:release` runs both. The checks also need Ruby for the
curriculum audit, and the browser suites need Google Chrome (or
`CHROME_PATH`). See the [contributing guide](.github/CONTRIBUTING.md) for setup, the release
gate and the constraints every change must respect, and
[docs/README.md](docs/README.md) for the guides and design notes.

## Contributing

Corrections to the notes and improvements to the app are welcome. Read
the [contributing guide](.github/CONTRIBUTING.md) before opening a pull request, and follow
the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as described in the [security policy](.github/SECURITY.md),
not in a public issue.

## License

- The application code is licensed under the [MIT License](LICENSE).
- The curriculum notes in `notes/` are licensed under
  [Creative Commons Attribution 4.0](LICENSES/NOTES-CC-BY-4.0.md): you may share and adapt
  them with credit. Third-party images and quotations linked from the notes
  keep their owners' licenses.
- Third-party models and runtimes keep their own terms; see
  [the third-party notices](LICENSES/THIRD_PARTY_NOTICES.md).
