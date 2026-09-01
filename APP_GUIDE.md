# Lumen AI Notes — iPhone app guide

Lumen is an iPhone-first Progressive Web App (PWA) built around this repository's
complete AI/ML curriculum. It can be installed from Safari and opens full-screen
like an ordinary app. No account or server-side database is required.

## What is included

- all 23 curriculum parts and every built-in Markdown lecture;
- ranked full-text search plus Part, bookmark, in-progress, guide, and upload filters;
- a responsive long-form reader with native MathML formulas, Mermaid diagrams,
  copyable code blocks, tables, external images, in-lecture find, reading progress,
  chapter navigation, sharing, link copy, completion, and Markdown export;
- bookmarks, per-lecture private notes, and selection-based clippings collected
  in the notebook;
- editable local copies of built-in lectures;
- creation and upload of `.md`, `.markdown`, and `.txt` notes;
- text-to-speech using the voices reported by iOS, grouped and filtered by
  language, with on-device/network disclosure, voice preview, speed, pitch,
  volume, presets, pause/resume/stop, previous/next sentence, and current
  sentence, current section, selected-text, or full-lecture scopes;
- teaching mode, which turns each major section into a presentation-style slide
  with section navigation, narration, active-recall conceal/reveal, adjustable
  type, a resettable timer, keyboard control, swipe navigation, and fullscreen
  where the browser supports it;
- a versioned, multi-page whiteboard with page create, rename, duplicate, delete,
  and navigation; grid, dot, and plain backgrounds; select/move, pen, highlighter,
  eraser, line, rectangle, ellipse, arrow, text, and sticky-note tools; object
  recoloring, resizing, duplication, and deletion; 60-step undo/redo, auto-save,
  Apple Pencil pressure/pointer support, and high-resolution per-page PNG export;
- paper, dark, and system themes plus reader width, type-size, and line-height
  controls;
- maximum progress, exact reading position, recent history, personal notes,
  clippings, uploads, edits, and whiteboards stored locally;
- optional screen wake lock while reading or drawing, persistent-storage request,
  unsaved-editor navigation protection, and automatic update notification;
- full JSON backup/import so study data can be moved to another device; and
- a proportional offline production cache containing the app shell plus lecture
  assets as they are visited; and
- a mobile AI workspace with whole-library grounding, live staged Mac-local
  answers, sanitized GFM/KaTeX, evidence/Approach drawers, and free local models.

Dialog primitives are designed to isolate background controls, contain keyboard focus,
support Escape dismissal, restore focus on close, and expose accessible names. Core
iPhone controls are automatically checked for names and practical touch targets, but
not every dialog focus cycle, action result, disabled reason, VoiceOver path, or physical-
device interaction has complete acceptance evidence yet.

## Run it on the Mac

Install dependencies once:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the address printed by Vite. Development mode is for editing and testing;
the installable iPhone version should be served from the production build over
HTTPS.

## Create the uploadable production app

```bash
npm run check
```

This audits the curriculum, builds the app, validates the PWA manifest and icon
dimensions, verifies referenced assets, and checks the production shell plus
proportional on-demand caching. It also checks search ranking, speech segmentation,
profile migration, and whiteboard-data normalization. The finished static site is
the generated `dist/` directory.

For a stable Mac-only AI test, build once and run the integrated app/API server:

```bash
npm run build
npm run start:local-ai
```

Open `http://127.0.0.1:4187/` on that Mac. This command serves the current app,
Ollama API, and optional local-search gateway from the same origin. `npm run preview`
is intentionally a loopback-only static preview: it does **not** provide the AI API
and must not be used to judge Mac-local AI. The iPhone still requires the private-LAN
HTTPS profile described below; `127.0.0.1` on an iPhone means the iPhone itself.

When the production preview is running on port `4173` and Google Chrome is
installed in its standard macOS location, an additional real-browser check is
available:

```bash
npm run audit:visual
```

It uses an iPhone 16 Pro portrait touch viewport to check horizontal overflow, MathML,
Mermaid, teaching mode, the whiteboard canvas, the offline cache, and a complete
offline reload. `LUMEN_URL` and `CHROME_PATH` can override its defaults.

The deeper stateful browser suite is:

```bash
npm run audit:workflow
```

It exercises narration, bookmarking, annotations, clipping copy, reading position,
reader actions and find, editing, active-recall teaching, multi-page whiteboard
history and object operations, note creation/duplicate/delete, upload, notebook
search, library sorting/layout, browser routing, reload persistence, IndexedDB,
and a real downloaded backup.

The iPhone interaction-quality gate is:

```bash
npm run audit:controls
```

It checks every visible interactive element across the home, library, reader,
reader-actions dialog, teaching mode, whiteboard, notebook, and settings for an
accessible name and a usable rendered touch target.

Upload the **contents of `dist/`** to any static web host that provides HTTPS for the
reader, notes, review, audio, teaching, whiteboard, and supported On-device Lite local
inference. On-device model download still needs access to its pinned model hosts, and its
optional current-web fallback is unavailable without the same-origin search API. Mac-local
tutoring and either engine's web fallback require Lumen's integrated Node server at the
same origin; a static host or Vite preview cannot provide those API routes. Keep each release's files together at
one URL path; relative asset paths make the build work at a domain root or a
subdirectory.

## Install it on iPhone 16 Pro

1. Open the deployment's stable HTTPS LAN origin in **Safari**. Use the hostname
   or router-reserved address that is present in the trusted certificate and in
   the server's exact `AI_ALLOWED_ORIGINS`; do not copy an old machine IP from a
   previous test run.
2. Wait for the first page to finish loading while online. The service worker
   caches the app shell; lecture chunks are cached proportionally as you visit them.
3. Tap Safari's **Share** button (square with an upward arrow).
4. Choose **Add to Home Screen**. Scroll the action list if it is not visible.
5. Keep the name `Lumen Notes`, tap **Add**, and launch it from the new icon.

The app uses safe-area insets for the Dynamic Island and Home indicator. It is
also responsive on iPad and desktop.

## Add or create notes

- Open **Notebook → Upload** to import one or several Markdown/text files.
- Open **Notebook → New note** to create a blank editable lecture.
- Open any lecture and choose **Edit copy** to change it without touching the
  repository's original source.
- Use **Notes** in the reader toolbar for short private annotations tied to the
  current lecture.
- Select an important passage and choose **Clip selection** to collect it in the
  Notebook's Clippings section.

Uploaded and created documents are stored on that device. They become searchable
and receive the same reader, narration, teaching, editing, and whiteboard tools as
built-in lectures.

## Listen with different voices

Open a lecture and tap the speaker button. Choose one of the voices reported by
iOS, filter them by language, or tap **Test voice** before starting. Lumen labels
each voice **On device** or **May use network** using the information iOS
provides; it does not download a server voice model. Additional Apple voices can
be installed under:

`Settings → Accessibility → Spoken Content → Voices`

iOS may require the first speech action to follow a direct tap. Choose whether
to read the current sentence, current section, selected passage, or full lecture.
Lumen splits text into short sentence-oriented utterances for more reliable
playback and exposes previous/next sentence controls in the compact player.
Language, voice, speed, pitch, volume, and scope are saved on the device.

When Safari backgrounds Lumen, narration is stopped rather than allowed to begin
audio invisibly. Return to Lumen and tap **Resume** to replay the current
sentence. Available voices and their offline behavior still depend on the voices
installed on that particular iPhone.

## Use the free local AI tutor

Open **AI Studio** and choose either **Mac local** or **On-device Lite**. Mac local
uses the fixed Qwen model running through Ollama on the host Mac; On-device Lite
uses the separately consented browser model on supported WebGPU devices. Neither
path uses a paid model API or accepts a provider API key.

The default **Library first** scope accepts a free-form question; it is not limited
to the article currently open. On the device, Lumen searches all 143 built-in
lectures and every supported custom note (up to 500), uses saved edits instead of
stale originals, and includes matching personal notes with explicit provenance.
It lazy-loads only bounded candidate bodies and attaches a small, diversified set
of passages with stable section anchors. Use **Current lesson**, **Choose sources**,
or **No library** when you deliberately want a narrower scope.

Before the first Mac-local request, review and acknowledge the local-model data
categories and limits. Lumen remembers that local-only acknowledgement in this browser,
so it is not another checkbox on every turn; use **Review again** (or clear site
data) to revoke it. Current-web access is a separate one-request authorization.
Fast, Balanced, and Deep allow up to 900, 1,800, and 3,200 output tokens
respectively, under a 4,096-token server ceiling. Larger output budgets leave less
room for input. The app fits the exact submitted JSON/UTF-8 body for the selected
profile, including history and any compacted summary. Deep may use the local
model's private thinking internally, but that text is discarded. The **Approach**
action shows safe orchestration, local retrieval confidence/provenance, and
web-fallback decisions—not hidden reasoning or raw chain-of-thought.

Mac-local requests show live stages, elapsed time, and Stop immediately. Source-free
Markdown appears incrementally as provider text arrives. Library- and web-grounded
Markdown is deliberately withheld until completion and citation validation, then released;
it is not provider-token-live. Structured quizzes,
flashcards, and plans wait for complete, schema-valid JSON instead of showing
broken partial data. Prose/Markdown surfaces in both engines render sanitized GitHub-flavored Markdown,
tables, lists, code blocks, links, KaTeX formulas using `$...$` and `$$...$$`, and
compatible fenced Mermaid diagrams. Mermaid loads only for a completed surface,
uses the saved source again when the theme changes, and shows source/copy/retry
diagnostics when a definition cannot be rendered. Responses provide copy,
reuse/regenerate, evidence, and compact mobile drawers.
Streaming improves progress and cancellation feedback; source-free prose can improve
time to visible text. It does not guarantee that a grounded or complete answer finishes faster.

As a Mac-local conversation grows, recent complete request/answer pairs remain
verbatim and older pairs are compacted deterministically into bounded visible
memory. Expand **Approach → Older turns compacted** to inspect it. This is local
extraction, not a second summarization model call. On-device Lite conversation
history remains session-only and uses a much smaller context window.

Current-web search is optional and off by default. In Library-first mode, checking
**Allow current-web fallback** only grants permission: the app still searches the
local library first and uses the web only when the question is time-sensitive or
the local match is missing/weak. Mac-local search may send bounded model-generated
queries through self-hosted SearXNG. The response shows whether permission is
armed, not needed, searching, used, or failed. If Qwen skips its authorized tool,
Lumen searches a bounded form of the learner's approved question instead of
silently omitting the fallback. On-device Lite prefers a valid local-planner query;
if the 1B planner says `answer` or produces unusable output after both gates pass,
it prepares a bounded query from the learner prompt. It always shows that exact
query and requires another single-use approval tap before any network call.
Returned links are sanitized, canonicalized,
deduplicated, and reranked using query/domain/recency signals, but Lumen does not
open the result pages. Public engines can still degrade or provide poor snippets,
so verify important current claims using the attached links.

On-device Lite settings, model facts, and tutor controls use the same
paper/dark/system surface, text, border, and accent tokens as the rest of Lumen.
The first large model-download approval is remembered for that exact artifact
until **Clear model files**; it is distinct from the per-query web approval above.

Library confidence and answer citations are useful evidence, not a guarantee that
every generated claim is supported. High-stakes answers and senior-level design
judgment still need source review. Real Mac streaming has been exercised; real
On-device Lite model weights, performance, heat, battery, and interruption behavior
plus exact-query live search remain to be verified on a trusted-HTTPS physical iPhone.

## Back up private work

Open **Settings → Export backup**. The JSON file includes progress and reading
positions, bookmarks, clippings, annotations, edited copies, uploads,
preferences, and complete versioned whiteboard pages/objects. Save it to Files or another location you
control. Use **Import backup** on another Lumen installation to restore it.

Import intentionally replaces the destination installation's existing local
study data after confirmation. Built-in curriculum files are part of the app and
are not duplicated in the backup.

## Data and privacy model

Lumen is local-first. IndexedDB is the primary store; a small local-storage
fallback keeps the session usable if IndexedDB is temporarily unavailable. There
is no account, analytics SDK, ad SDK, remote database, or automatic cloud sync.
Deleting the site data or the installed PWA can delete work that has not been
exported, so make periodic backups.

## Updating the curriculum or interface

Edit files in `notes/` or `src/`, then run:

```bash
npm run check
```

Deploy the new `dist/` as one complete release. Prefer a versioned release
directory with an atomic symlink/directory switch. If the host only supports
file uploads, upload `dist/assets/` first, retain the previous hashed assets,
and replace `index.html` and `service-worker.js` last. Do not empty or rebuild a
`dist/` directory while `vite preview` (or another static server) is serving it.
That can leave an already-open tab requesting a Whiteboard or AI chunk that no
longer exists.

Each build registers a build-specific service worker. It installs the new shell
in the background and the app presents an **Update now** action once the shell
is complete. Existing user notes, whiteboards, and progress remain in browser
storage because deployments and app-file cache repair do not replace IndexedDB.

## Current boundary

The shipped app is deliberately account-free and single-user. It does not yet
provide automatic cross-device sync, real-time multi-user teaching rooms, video
calling, or server-generated neural voices. Those require authentication,
backend storage, privacy choices, and operating cost. Backup/import provides a
complete portable path without introducing those dependencies.
