# Lumen AI Notes — engineering handoff and current-state audit

**Snapshot date:** 2026-09-01 (Asia/Kolkata)  
**Workspace audited:** `/Users/macbookpro/Desktop/ML-learning`  
**Application version in `package.json`:** `1.0.0`  
**Purpose:** make the present implementation, evidence, limitations, operational state,
and next decisions understandable to an engineer who did not participate in the work.

This is the overall handoff document. [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)
remains the requirement/status source of truth; this document explains how the pieces fit
together, what the status labels actually mean, and what should happen next.

## 1. Read this first

### 1.1 Executive verdict

Lumen is a substantial, usable local-first study PWA, not a finished production product.
The reader, searchable curriculum, local notes, annotations, review system, narration,
teaching mode, multi-page whiteboard, backup/recovery, Mac-local AI, optional browser AI,
library-first retrieval, response rendering, and consented SearXNG path all have working
implementations and meaningful automated coverage.

The current aggregate release command passed on this workspace on 2026-09-01:

```text
npm run check:release: PASS
AI/data tests:        228/228 PASS
Scale tests:          3/3 PASS
Curriculum:           144 Markdown files, 32,755 lines, 23 numbered Parts
Browser audits:       workflow, audio, review, annotations, visual/offline,
                      controls, Mac AI, phone AI, Mermaid, stale chunks — PASS
Production build:     PASS, with documented WebLLM chunk warnings
```

That evidence is real but not sufficient for an unconditional release:

- no requirement is currently `Verified` under the tracker definition;
- this directory has **no Git repository metadata**, so the evidence cannot be tied to a
  commit SHA or a clean tree;
- real On-device Lite execution has not been accepted on a trusted-HTTPS physical iPhone;
- AI grounding is answer/citation guarded, but claim-level faithfulness and recency quality
  do not have a versioned evaluation suite;
- Origin/Host/TLS controls are not user authentication; the server profile is for one
  learner on a trusted private LAN;
- the large WebLLM runtime/worker chunks require actual Safari memory/startup profiling;
- several non-AI requirements remain Partial or Backlog.

The correct disposition is **continue development and evidence collection**, not “all
features verified.”

### 1.2 Critical provenance and secret-handling warning

`git status` currently fails because `.git` is absent. Before another engineer makes
material changes:

1. recover the intended upstream repository/history or initialize a repository;
2. review `.gitignore` before the first commit;
3. establish a known-good baseline commit from this exact source;
4. record Node/npm versions, `package-lock.json`, Ollama model digest, SearXNG OCI digest,
   build output, and the complete release-audit output against that commit; and
5. use pull requests or an equivalent review trail from then on.

Do **not** put these local files in a source archive, commit, ticket, or ordinary handoff:

- `.env`
- `infra/searxng/.env`
- `.local/https/ca-key.pem`
- `.local/https/server-key.pem`
- exported learner backups or browser-profile data

The TLS CA signing key is still present in this workspace. [LOCAL_HTTPS.md](./LOCAL_HTTPS.md)
requires encrypted offline custody and removal from the working Mac after setup. Treat that
as an operational action, not documentation trivia. Transfer any required secret through a
separate secure channel; this document intentionally contains none.

### 1.3 What the status words mean

The tracker now contains 41 requirements:

| Status | Count | Meaning here |
|---|---:|---|
| `Verified` | 0 | All acceptance criteria, relevant automated/browser evidence, build, and required physical/manual evidence completed. |
| `Implemented` | 2 | Source work is materially complete, but final evidence still prevents promotion. |
| `Partial` | 22 | A useful slice exists, but source scope or acceptance evidence remains incomplete. |
| `Backlog` | 17 | Accepted capability is not implemented as a product feature. |

The two `Implemented` requirements are mobile navigation reliability (`BUG-001`) and
stale-build/lazy-chunk recovery (`BUG-004`). “Implemented” still does not mean physically
verified on Mobile Safari.

## 2. Product and architecture at a glance

Lumen is an iPhone-first React/Vite PWA over a 23-Part AI/ML curriculum. Normal study data
is local browser data. Mac AI is a same-origin Node gateway to loopback Ollama. Optional
search is a same-origin bounded gateway to loopback SearXNG/public engines. On-device Lite
runs a pinned 1B model in a browser Web Worker through WebGPU.

```text
                         ┌──────────────────────────────┐
                         │ React 19 / Vite 8 PWA        │
                         │ App.jsx + hash routes        │
                         └──────────────┬───────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             │                          │                          │
             v                          v                          v
  IndexedDB + fallback        Built-in/custom library        AI Learning Studio
  profile v4 / boards         143 built-ins + <=500          Mac or On-device Lite
             │                          │                          │
             │                 lexical Library-first              │
             │                          │            ┌─────────────┴─────────────┐
             │                          │            │                           │
             v                          v            v                           v
  backup/restore, sync       bounded S-labelled   same-origin Node          WebLLM worker
  review, annotations        passages/trace       /api/ai/*                 Llama 1B q4
                                                     │                           │
                                      ┌──────────────┴─────────────┐             │
                                      v                            v             │
                              Ollama qwen3.5:4b              SearXNG :8080       │
                              loopback :11434                loopback only       │
                                                                   │             │
                                                                   v             │
                                                           public search engines │
                                                           only after consent    │
```

### 2.1 Runtime and pinned dependencies

- Node requirement: `>=20.19`
- React/React DOM: `19.2.8`
- Vite: `8.2.2`
- WebLLM: `0.2.82`
- Marked: `18.0.10`
- marked-katex-extension: `5.1.12`
- KaTeX: `0.16.47`
- Mermaid: `11.17.0`
- DOMPurify: `3.4.14`
- Lucide React: `1.33.0`

These are exact package pins, not ranges. Do not upgrade the AI/model/rendering stack as a
routine cleanup. Each upgrade needs a focused security, compatibility, bundle, cache,
Mobile Safari, and output-quality re-audit. In particular, WebLLM `0.2.82` was selected
after an upstream regression report concerning later versions; see
[LOCAL_AI_MODEL_RESEARCH.md](./LOCAL_AI_MODEL_RESEARCH.md).

### 2.2 Main routes and surfaces

Hash routing is owned by [src/App.jsx](./src/App.jsx):

| Route | Surface | Main component |
|---|---|---|
| `#/home` | dashboard/settings entry | `App.jsx` |
| `#/library` | built-in/custom library and search | `App.jsx` |
| `#/read/<documentId>` | reader/editor/notes/annotations | lazy `Reader.jsx` |
| `#/ai` | Mac-local and On-device Lite workspace | lazy `AiLearningStudio.jsx` |
| `#/review` | review queue, authoring, analytics | `ReviewCenter.jsx` |
| `#/notebook` | notes, clips, uploads | `App.jsx` |
| `#/board/<documentId>` | per-document whiteboard | lazy `Whiteboard.jsx` |

Large surfaces are lazy-loaded through the stale-chunk recovery wrapper. `StorageHealth`
is also lazy. Keep those boundaries: eagerly importing Reader, Mermaid, the AI tutors, or
WebLLM would materially worsen mobile startup.

### 2.3 Important directories

| Path | Responsibility |
|---|---|
| `notes/` | 23-Part curriculum and workbooks; 143 built-in documents in generated indexes |
| `src/components/` | product surfaces and dialogs |
| `src/lib/` | persistence, retrieval, AI contracts, rendering, review, search, backup, sync |
| `src/workers/` | browser WebLLM worker |
| `src/generated/` | build-generated content metadata and lexical search corpus |
| `server/` | integrated static/API server and Ollama/SearX adapters |
| `infra/searxng/` | pinned/hardened loopback search deployment |
| `scripts/` | deterministic, scale, browser, live-smoke, TLS, and setup tooling |
| `public/` | service worker, manifest, icons, public license copies |
| `docs/` | focused protocol documentation |
| `dist/` | generated production output; never edit by hand |

## 3. Content, library, and normal study workflow

### 3.1 Curriculum generation and loading

`npm run build` first runs `scripts/generate_content_index.mjs`, which generates compact
metadata and a normalized full-text index. Startup does not import every Markdown body.
`src/lib/content.js` exposes metadata immediately and lazy raw imports for document bodies.

Current audited inventory:

- 23 numbered curriculum Parts;
- 143 generated built-in documents;
- 144 Markdown files total when repository-level documentation is included by the notes
  audit;
- 32,755 Markdown lines at the final 2026-09-01 release check.

Saved edits to built-in content are authoritative. Retrieval and reading must not combine a
stale packaged body and a saved edited copy as though both were current sources.

### 3.2 Reader

The Reader currently provides:

- sanitized Markdown, code, tables, external images, native formula content, and Mermaid;
- heading navigation, previous/next chapter navigation, find-in-document, and sharing;
- exact progress and reading-position restoration;
- bookmarks, completion, local personal notes, clipping, and annotations;
- editable local copies of built-ins and Markdown export;
- narration and Teaching Mode entry;
- citation target navigation for normal heading anchors.

Personal-note citations are now exact deep links: the `personal-note` anchor opens the
Reader's Notes drawer and focuses the note editor, with a browser regression in
`audit:ai-ui` that retrieves a real personal note, clicks its citation, and asserts
the focused editor contains the note.

### 3.3 Search and custom content

The ordinary library search is lexical. It supports useful exact/AND-style ranking and
basic filters but not the complete `SEARCH-001` acceptance set (typo tolerance, robust
stemming/synonyms/exclusions, saved searches, and all content-type filters remain).

Custom uploads are restricted to `.md`, `.markdown`, and `.txt`:

- maximum 2 MiB per file;
- maximum 20 offered files per batch;
- maximum 500 custom documents;
- maximum 16 MiB aggregate custom raw text.

PDF, EPUB, HTML, GitHub import, broad export formats, collections, revisions/diff, archive,
and semantic search are not implemented product capabilities.

### 3.4 Annotations, review, and learning state

Annotations persist quote, prefix/suffix, offsets, heading, source hash, color, comment,
and tags. Exact-offset resolution is preferred; quote/context scoring can relocate after a
source edit. The system can identify exact, relocated, and orphaned anchors, but broader
relocation/orphan repair and backup-restore evidence remain open.

Review supports eight item types, source provenance, safe previews, due-before-new queue,
Again/Hard/Good/Easy, confidence, local-day limits, pause/bury, undo, crunch mode, edit,
archive/restore, analytics, forecast, keyboard controls, and 24-card pagination. Current
scale coverage reaches 10,000 cards and 50,000 attempts. The scheduler is deterministic but
still heuristic rather than a calibrated complete-history model.

AI flashcards are explicit `ai-draft` records and require a learner action before entering
the durable review deck. Exact duplicates are rejected and a generated batch is capped.

Mastery is currently aggregate review state, not the planned seven-level concept/prerequisite
evidence model. Mistake notebook, assessments, learning plans, labs, and formal interview
session products remain Backlog even though the curriculum contains related prose.

## 4. Persistence, backup, and concurrency

### 4.1 Storage model

`src/lib/db.js` uses:

- IndexedDB database `lumen-ai-notes`, schema version 1;
- object store `study-data`;
- public records `profile` and `board:<documentId>`;
- normalized profile schema version 4;
- a localStorage fallback journal and an in-memory emergency fallback;
- an internal budget ledger and authoritative replacement snapshots.

The profile contains progress, reading positions, bookmarks, notes, clips, annotations,
review data, backup metadata, Mac tutor history/tombstones, edits, custom documents,
recents, last document, and user settings. Boards are separate records.

Key safety limits include:

| Data | Limit |
|---|---:|
| Owned profile + board data | 20 MiB |
| Board records | 250 |
| UI whiteboard pages per board | 20 (normalizer safety cap is 40) |
| Custom documents | 500 |
| Custom raw text aggregate | 16 MiB |
| Clippings | 2,000 |
| Annotations | 5,000 |
| Review cards | 10,000 |
| Review attempts | 50,000 |
| Review sessions | 730 |
| Durable Mac AI messages | 50 |
| Phone visible session messages | 30, not persisted |

Do not replace atomic updater callbacks with read-then-write persistence. Generation
fences, tombstones, and authoritative reset/restore snapshots are intentional defenses
against stale-tab resurrection.

### 4.2 Same-origin tab synchronization

`profileSync.js` combines BroadcastChannel with a localStorage signal fallback and
record-aware three-way reconciliation. It unions independent records, replays review
events, uses deterministic tie-breaks, preserves conflicting text as recovered notes,
and protects reset/restore with a monotonic generation. `boardSync.js` separately merges
boards.

This is **same-origin browser-tab convergence**, not encrypted device synchronization.
`SYNC-001` remains Backlog. There is no account, remote server database, device pairing,
or cross-device conflict history.

### 4.3 Backup and restore

The JSON backup format is `lumen-ai-notes-backup`, current version 4, with compatibility
for versions 1–4. It uses canonical serialization and SHA-256 where secure WebCrypto is
available; an explicitly labeled deterministic fallback checksum exists for insecure
contexts. It rejects unsafe prototype keys, future versions, excessive nesting/nodes,
bad checksums, oversized files, and excessive board counts.

Restore is deliberately two-phase:

1. create/download a recovery snapshot of current data;
2. confirm current data has not changed;
3. atomically replace owned records under a new generation;
4. reload.

The 2026-09-01 memory gate processed a 16,778,784-byte supported backup at 94 MB RSS
growth. This is desktop evidence, not a physical-iPhone memory guarantee.

Optional password protection (issue #18, 2026-09-02) wraps the exact canonical
JSON in a binary `lumen.backup.enc.v1` container: "LUMENENC" magic ‖ uint32-BE
header length ‖ canonical header (PBKDF2-HMAC-SHA256 600k per OWASP, 16-byte
salt, AES-256-GCM with 12-byte IV) ‖ ciphertext, with the raw file prefix as
GCM AAD so header tamper fails authentication. `src/lib/backup.js` is
untouched — decrypt feeds the unchanged preflight, and the plain v4 path stays
byte-identical. Wrong password surfaces as typed `WRONG_PASSWORD` (honestly
indistinguishable from corruption under GCM); insecure contexts disable the
feature (`CRYPTO_UNAVAILABLE`) with no weak fallback; the mid-restore recovery
snapshot deliberately stays plaintext so restores survive a forgotten
password. The extended memory gate round-trips the maximum workspace encrypted
(2026-09-02: +284 bytes container overhead, 65 MB RSS, ~0.2 s including both
PBKDF2 derivations on the reviewed Mac). Full rationale:
docs/ENCRYPTED_BACKUP_DESIGN.md.

Critical history distinction:

- Mac tutor history is automatically retained as disclosed local profile data, capped at
  50 messages, clearable, and included in backups;
- phone tutor history is App/React session memory, survives route/engine switches, but is
  cleared by a full reload and excluded from backups.

## 5. AI product behavior: exact current semantics

### 5.1 Two engines, no paid model API

AI Studio exposes:

| Engine | Runtime | Data path | Intended role |
|---|---|---|---|
| Mac local (recommended) | fixed `qwen3.5:4b` in Ollama on serving Mac | browser → same-origin Node → loopback Ollama | stronger explanations, interviews, structured work, web tool |
| On-device Lite | pinned Llama 3.2 1B q4f16 via WebLLM worker | browser-local WebGPU after model download | lightweight/offline-capable study assistance |

There is no OpenAI/Anthropic/Google model call, API-key input, arbitrary browser-selected
provider, provider URL, model name, or unrestricted tool. “Free” means no paid model/search
API in the current design; it does not erase hardware, electricity, storage, bandwidth,
Docker, or public-search privacy costs.

### 5.2 User-visible modes and source scopes

Current study modes are:

- Explain
- Socratic
- Quiz
- Flashcards
- Code review
- Interview
- Summarize
- Study plan

Difficulty/depth is separate. The older requirement taxonomy also mentions explicit
derivation, analogy, and challenge strategies; those are not distinct shipped modes.

Source scopes are:

- **Library first** — default; search the complete supported local corpus;
- **Current lesson** — deliberately use the active document;
- **Choose sources** — manually select a bounded set;
- **No library** — ask general knowledge without claiming curriculum grounding.

A learner can ask a free question without opening an article. The old “only opened article
is usable” behavior is no longer the default.

### 5.3 What “Library first, then web” actually means

This phrase has a precise implementation meaning:

1. before model generation, browser-local lexical retrieval searches the complete local
   index and creates a bounded confidence/coverage trace;
2. saved built-in edits replace packaged originals; custom notes and personal notes are
   eligible with provenance;
3. only top candidate bodies are lazy-loaded, split by headings, scored, diversified, and
   fitted as complete source blocks;
4. the trace recommends fallback when the question is time-sensitive, the index is
   unavailable, nothing matches, or lexical coverage/confidence is weak;
5. web is eligible only if the learner separately allowed it for that request;
6. strong local evidence keeps web off even when permission was checked.

This is **pre-generation retrieval sufficiency**, not “generate an answer, have another
judge decide it is inadequate, then browse.” If answer-level post-generation insufficiency
routing is desired, specify and evaluate it as a new design rather than assuming it exists.

`src/lib/libraryRetrieval.js` hard maxima are 1,000 metadata documents, 18 candidates,
8 returned documents, 12 passages, 3 passages/document, 48,000 total bytes, and 7,000
bytes/passage. Normal Mac defaults are 10 candidates, 6 documents, 9 passages, 2 per
document, 24,000 bytes, and 4,800 bytes/passage. The phone asks for at most two passages
under a 4,400-byte retrieval-entry budget including metadata and text.

Retrieval is local lexical ranking, not semantic embeddings and not proof of entailment.
Full-text parse/rank remains main-thread work. Do not increase limits without realistic
500-document latency/memory evidence.

### 5.4 Mac request profiles and exact budget contract

The current live server advertises:

| Profile | Output cap | Exact browser request-byte cap | Thinking |
|---|---:|---:|---|
| Fast | 900 tokens | 9,340 UTF-8 bytes | off |
| Balanced | 1,800 tokens | 8,440 UTF-8 bytes | off |
| Deep | 3,200 tokens | 7,040 UTF-8 bytes | `think: true` |

Absolute defaults are a 4,096 output-token ceiling and 16,384-token Ollama context. The
public general `maxInputChars` value is 24,000, but it is not permission to submit 24,000
arbitrary characters; the profile-specific exact serialized-byte budget is authoritative.

The browser constructs the canonical body before measurement, including task, prompt,
context, server-owned S-label declaration (`contextCitations`), document title, difficulty,
history, deterministic conversation summary, response profile, response format, web flag,
and output cap. It measures the exact `JSON.stringify` UTF-8 bytes it will send and checks
again immediately before transport. The server independently validates and remeasures the
serialized provider messages/tool/schema framing.

This repaired the reported input-budget incident: a structured request previously asked
for 4,096 output tokens after the UI had fitted input against Balanced/1,800 headroom. The
server correctly saw a smaller real input budget and rejected it. The selected profile now
owns both input and output ceilings across initial, retrieval, no-match, retrieval-error,
structured, web, and retry branches.

Never “fix” this by comparing JavaScript string length. CJK, emoji, JSON quotes, slashes,
metadata, summaries, tools, and schema framing are exactly why character counts failed.

### 5.5 Mac conversation memory

Only chronological complete learner→assistant pairs become outbound history. Orphan
learners, assistant-only imports, stopped/failed partials, and incomplete retry drafts are
excluded. Recent pairs remain verbatim. Older complete pairs become a deterministic,
visible, bounded local extract (maximum 3,000 characters on the wire), not another model
summarization call. It is framed as untrusted continuity text.

Persisted history normalizes bounded sources, usage, trace, Approach, response profile,
incomplete/truncated flags, and web state. Preserve those fields; losing `incomplete` on
reload previously risked treating a rejected partial as trusted conversation.

### 5.6 Streaming truth, including the deliberate integrity trade-off

Mac uses `POST /api/ai/respond/stream` with `application/x-ndjson` protocol
`lumen.ai.ndjson.v1`:

```text
start → approach → phase/heartbeat/source/delta* → exactly one complete OR error
```

The client checks event keys, order, sequence, request ID, cumulative bounds, sources,
terminal uniqueness, and post-terminal data. For Markdown, final text must equal accumulated
deltas. Structured tasks emit no partial JSON and return a validated final object.

Visibility semantics:

| Response kind | What the learner sees during provider generation |
|---|---|
| Source-free Mac Markdown | provider text deltas rendered at animation-frame cadence |
| Library/web-grounded Mac Markdown | phases, heartbeats, elapsed time, and Stop; answer text is withheld until terminal citation validation, then released |
| Mac structured result | progress only; complete schema-valid component at terminal |
| Phone prose | token updates at animation-frame cadence; commit only after terminal/grounding validation |
| Phone structured result | buffered until valid object |

Therefore, it is false to say every grounded Mac answer visibly renders each provider token
while it is generated. Buffering prevents a fluent unsupported draft from appearing and
remaining after citation validation rejects it. The UI now says grounded text appears after
completion/citation validation instead of misleadingly saying it is waiting for a first
token.

If product leadership later wants provisional grounded drafts, design an explicit
“unverified draft” state, removal behavior, accessibility announcement, persistence rule,
and adversarial test matrix. Do not weaken terminal grounding silently.

### 5.7 Output-limit and terminal handling

The reported output-limit incident was real: Balanced Qwen used all 1,800 tokens and ended
with `done_reason=length` after about 63.9 seconds. Current handling:

- a provider completion is valid only with exact `done: true` and `done_reason: "stop"`;
- completion instructions target a margin below the configured ceiling and prioritize a
  complete shorter answer/valid smaller structured set;
- a buffered grounded length-stop draft can be discarded and regenerated once under a
  stricter target;
- no failed grounded draft is released;
- a second length stop remains a typed incomplete error rather than chopped “success”;
- phone streaming rejects missing terminals, length terminals, multiple terminals, and
  content after a terminal;
- the response UI enforces a bounded display contract instead of silently clipping a
  successful answer.

This reduces but cannot eliminate model length failures. Prompts asking for broad books,
exhaustive surveys, or too many artifacts still need scope/length controls and realistic
quality evaluation.

### 5.8 Citations and grounding checks

Library evidence uses explicit uppercase `[S1]`, `[S2]`, … labels. Web evidence uses
uppercase `[W1]`, `[W2]`, … labels. Current guards:

- context labels are declared separately and must match server-owned source-block headers;
- label-shaped learner/source lines are neutralized to prevent source-label injection;
- every citation outside GFM inline/fenced code must resolve;
- lowercase and invented/sparse labels do not pass accidentally;
- only complete fitted library blocks count as supplied;
- web evidence is compacted/relabelled to what actually reached the synthesis turn;
- searched responses must cite retained W evidence;
- structured strings are included in validation;
- one buffered structured citation-placement repair is allowed, then failure is terminal;
- code like `x[1]` is not reinterpreted as a web citation.

These are syntax/provenance integrity checks, not claim-level entailment. One valid citation
can still be attached to a weakly supported or partially unsupported claim. The main release
quality gap is a versioned, reviewed claim-level evaluation set with expected evidence and
recency judgments.

Mac prose citations are inline/clickable. Phone prose citations are inline/clickable.
Structured Quiz/Flashcard/Study-plan string fields now render navigable [S#]/[W#]
citation controls on both surfaces (including quiz options, card hints, and milestone
titles), and personal-note citations focus the exact note editor. AI-001 remains
Partial for claim-level support and evaluation reasons, not citation navigability.

### 5.9 Reasoning and Approach

The request to “show reasoning” was intentionally implemented as a safer substitute:

- Deep may ask the local model to think privately;
- `message.thinking` is discarded and never streamed, returned, logged as answer content,
  put into history, or shown;
- **Approach** displays deterministic task/orchestration, retrieval confidence, context fit,
  evidence, web decision, and conversation-compaction metadata;
- raw chain-of-thought is not a shipped or planned disclosure contract.

This is a deliberate product/safety decision, not a claim that private reasoning is shown.

Deep is capability-gated on both sides: the server rejects a Deep request with a typed
`AI_PROFILE_UNSUPPORTED` error unless the installed model attests Ollama thinking
support, and the UI disables the Deep option with the capability reason and falls back
to Balanced when a configured model lacks the attestation.

## 6. Current-web fallback

### 6.1 Consent model

Web is off by default. Local-model acknowledgement and web authorization are distinct:

- the Mac local-model disclosure is remembered in localStorage until **Review again** or
  site-data clearing;
- Mac web authorization is consumed per request, including retry;
- phone fallback first needs the local retrieval recommendation and the learner toggle,
  then always displays the exact proposed query and requires a separate single-use approval;
- decline, expiry, cancellation, and use consume a phone proposal.

On Mac, the disclosed bounded planner query may reproduce words or fragments from prompt,
context, or history and is not separately previewed as an exact string. On phone, only the
displayed approved exact query may leave.

### 6.2 Mac orchestration

When both Library-first insufficiency/time sensitivity and learner authorization exist:

1. Qwen receives exactly one allowlisted `search_web` schema, never arbitrary URL open,
   fetch, shell, filesystem, or background action;
2. if Qwen skips the required tool, its provisional answer is discarded and a bounded
   learner-question query is searched deterministically;
3. if a planned query is empty and a disclosed round remains, the bounded learner-question
   query may use that round;
4. Markdown can perform one bounded refinement and then a tool-free synthesis;
5. structured tasks plan/retrieve without response schema, then run a tool-free schema
   finalization; unsolicited final tool calls fail;
6. evidence is fitted to the synthesis context, and only retained/relabelled evidence can
   validate or be returned;
7. a missing result, bad terminal, invalid schema, unresolved citation, or ungrounded answer
   fails closed.

### 6.3 Phone orchestration

The 1B planner is schema-constrained to `answer` or `search_web`, but it is not trusted to
veto an independently established fallback. When both external gates are true:

- a valid planner query is preferred;
- `answer`, malformed/empty output, or other non-cancellation planning failure creates a
  deterministic sanitized query of at most 180 characters from the learner prompt;
- the exact query and reason are shown;
- nothing is sent until approval;
- proposals expire after five minutes; at most three are pending;
- search approval is never remembered globally.

Retrieval-unavailable is an independent insufficiency reason. If fallback was separately
enabled, phone can still prepare an exact-query card; the older documentation and Evidence
copy that said fallback was disabled have been corrected.

Phone preflight reserves room before WebLLM load or query egress for at least 48 UTF-8 bytes
of real library evidence and a bounded worst-case web result containing at least a 96-byte
snippet. This prevents the known failure class where search leaves the device and only then
the 4K model context proves impossible.

### 6.4 SearXNG and evidence boundary

The included SearXNG service is:

- bound to `127.0.0.1:8080`;
- pinned by tag and OCI digest;
- non-root UID 977;
- read-only with required tmpfs paths;
- capabilities dropped with `no-new-privileges`;
- PID/CPU/memory bounded and health checked;
- configured with Docker logging disabled because engine adapters may log exact queries.

The app accepts a query of 1–240 characters, rejects control/default-ignorable text and
SearX bang/category controls, fixes the search category/safe settings, bounds body/time/
result counts, sanitizes fields, rejects unsafe/private/credentialed URLs, strips tracking
parameters/fragments, canonicalizes, deduplicates, and reranks up to 96 candidates. Default
public limits are 5 returned results, 2 search rounds, and up to 8 total sources.

Feature-specific queries require majority overlap across distinctive terms so a generic
product page cannot support an unrelated feature merely by sharing the product name.

The server does **not** fetch or verify result pages. Model evidence is the SearX-provided
title/snippet/source/date metadata. This reduces SSRF and arbitrary browsing surface but
means “best web grounding” is not achieved in the strong sense. Search engines may return
stale, irrelevant, challenged, or missing snippets. Brave/DuckDuckGo degradation and weak
Bing ranking have been observed. Treat important current claims as links to verify, not an
authoritative live-facts service.

Do not add arbitrary page fetch as a quick quality patch. It requires a separate threat
model for DNS rebinding, redirects, content types, decompression bombs, HTML injection,
robots/terms, privacy, extraction, citations, deadlines, caching, and user disclosure.

## 7. On-device Lite model, cache, and lifecycle

### 7.1 Fixed reviewed configuration

- Model: `Llama-3.2-1B-Instruct-q4f16_1-MLC`
- WebLLM: `0.2.82`
- immutable Hugging Face model revision and compatible WASM revision
- approximately 710 MiB network download
- approximately 879 MiB required GPU memory reported by WebLLM
- 4,096-token context
- 384/640/768 response-token choices, absolute phone cap 768
- dedicated Web Worker and singleton engine

The UI prominently includes “Built with Llama” and ships the required Llama and Apache
license materials. The model is free to run subject to its license; it is not public domain.

### 7.2 Consent and integrity

Selecting phone mode can lazy-load roughly 5–6 MiB of app/runtime code to inspect state,
but model weights are not requested before the explicit large-download approval. Consent is
bound to model/runtime/artifact identity rather than only a friendly model name. Changing
the artifact invalidates old approval.

Before WebLLM loads, Lumen reads/downloads bounded artifact streams and verifies pinned
SHA-256 for model config, WASM, and tokenizer. Tensor shards rely on immutable revision +
HTTPS. Readiness checks exact named WebLLM caches rather than global Cache API matches.

Capability checks fail closed for insecure context, absent Worker/Cache/Web Locks/WebGPU,
adapter failure, known inadequate buffer limits, known memory below 4 GB, or known storage
headroom below roughly 1.15 GB for a new download. Safari often hides memory/quota; unknown
is shown as a warning rather than guessed.

### 7.3 Cross-tab and failure semantics

Web Locks serialize load/delete across same-origin tabs. A persisted revocation epoch plus
BroadcastChannel/storage notification cancels older loads before they can repopulate files
after **Clear model files**. Direct cache deletion handles partial/offline/broken-runtime
states and verifies owned entries are gone before success. Consent revocation is read back
and fails visibly if storage refuses it.

Unload is single-flight. A graceful WebLLM unload has a bounded grace period, after which
worker termination is authoritative. Cancellation can terminate an unresponsive worker,
clear engine state, update status, and require an explicit reload. Retry is gated so it
cannot silently reload a model whose status became unloaded.

These behaviors are strongly mocked/tested but have not been accepted under actual iOS
suspend, GPU reset, memory pressure, storage eviction, or long generation.

### 7.4 Exact phone fitting

The composer has an 1,800-character prompt cap but readiness is based on canonical UTF-8,
not that character count. Context fitting reserves output and framing, removes oldest
history pairs, keeps complete source blocks, preserves original sparse citation numbers,
and trims evidence under explicit markers. At least real source body evidence—not only an
`[S#]` header—must survive when a grounded source scope is requested.

Only the latest complete conversation pair is sent to the 1B model. Request-affecting
changes (Compact/Standard/Detailed, mode, scope, search setting) rebuild or invalidate a
retry; retry does not silently use stale hidden settings.

## 8. Markdown, math, Mermaid, and response UI

Prose/Markdown surfaces use Marked + KaTeX + DOMPurify. Supported presentation includes
GFM headings, emphasis, lists, blockquotes, tables, links, code, code-copy controls, inline
`$...$`, display `$$...$$`, and compatible fenced Mermaid. Model HTML is never trusted.

Structured Quiz/Flashcard/Study-plan results use dedicated validated React components.
They are not general Markdown/KaTeX/Mermaid surfaces. Keep documentation scoped accordingly.

Mermaid is lazy-loaded only when a completed surface actually contains a supported fence.
One shared serialized renderer is used by Reader, Teaching Mode, Mac tutor, and phone tutor
because Mermaid configuration is global. It preserves the original definition through SVG
replacement, rerenders from that source on theme changes, discards stale async DOM writes,
sanitizes returned SVG, and provides bounded source/copy/retry diagnostics when loading,
syntax, or size fails. Streaming partial fences remain readable source and are not rendered
on every token.

The reported “diagram could not be rendered below an existing image” came from rereading
the generated SVG text as Mermaid source on a theme rerender. The shared source-preserving
renderer fixed that lifecycle. A malformed model diagram can still legitimately produce a
safe diagnostic; tests cannot make arbitrary invalid Mermaid valid.

Current automated Mermaid evidence: one deferred runtime request, five valid rendered
diagrams, one safe invalid-definition diagnostic, and five source-preserving theme
rerenders. Physical Safari, VoiceOver semantics, broad curriculum/model-output corpus, and
very large diagram performance remain open.

## 9. Audio, teaching mode, and whiteboard

> **Rotation deferral note (BOARD-001, 2026-09-02).** Object rotation is the
> one transform deliberately not shipped with lock/z-order/snap/interchange:
> a `rotation` field touches every layer at once — the stroke normalizer and
> `boardPayloadEqual`, canvas draw (transform per object), axis-aligned
> `objectBounds`/hit-testing (which become oriented boxes), the resize handle
> math, marquee containment, the SVG exporter, and the interchange schema —
> and half-shipping it (e.g. rotating draw without rotated hit-testing) makes
> objects unselectable at their visible position. Ship it only as one
> coherent slice with oriented-bounds hit tests and audit coverage.

### 9.1 Multiple audio options

Narration uses browser `SpeechSynthesis`; there is no server audio provider. It now supports:

- every asynchronously reported system voice, grouped/filterable by language;
- conservative “On device” versus “May use network” disclosure from browser metadata;
- matching-language preview/test voice;
- persisted language, voice, rate, pitch, volume, scope, and presets;
- current sentence, current section, selected passage, or full document;
- short sentence-oriented chunks with previous/next, pause/resume/stop;
- explicit foreground/background interruption handling and Safari resume fallback;
- actionable empty-voice and unsupported states.

The browser/OS controls which voices exist and whether a labeled voice truly remains
offline. Physical-iPhone enumeration, Bluetooth/audio routing, phone calls/backgrounding,
precise persisted resume, spoken-sentence highlighting, heading skip, bookmarks, sleep
timer, playlists, pronunciation overrides, and VoiceOver evidence remain open.

### 9.2 Teaching Mode

Teaching Mode builds section slides with navigation, timer, active-recall conceal/reveal,
narration, text size, swipe/keyboard controls, and fullscreen where supported. Authored
decks, speaker notes, audience-safe views, templates, remote control, AirPlay evidence, and
PDF export remain open.

### 9.3 Whiteboard

The current board supports versioned multi-page records, create/rename/duplicate/delete,
grid/dot/plain backgrounds, pen/highlighter/eraser, line/rectangle/ellipse/arrow, text,
sticky notes, selection/move/recolor/stroke size/duplicate/delete, 60-step undo/redo,
autosave, pointer pressure, cross-tab merge/rebase, and high-resolution per-page PNG.

`BUG-002` and `BOARD-001` remain Partial because the complete matrix of touch/mouse/Pencil
line creation, rejected taps, redraw, page switch, reload, backup/restore, transforms,
history, export, multi-tab conflict, and physical-device behavior is not all covered.
Multi-select/lasso, geometry resize/rotate, groups/layers/order, copy/paste, snap/guides,
structured diagrams/formulas/images/tables, zoom/pan/minimap, PDF/SVG, and import are not
complete.

Geometry (issue #55, `src/lib/boardGeometry.js`): points are fractions of a page, and a page
carries a sparse authoring `size` in CSS pixels. The editor draws it with one uniform scale,
letterboxed inside the canvas, so shapes keep their proportions on every screen. Fonts, stroke
widths, the 24px grid, rotation, and wrapped-text bounds use those authoring pixels. A legacy
page without `size` renders in the live canvas box as before. It adopts that box the first time it
is shown in portrait or on a desktop, and never while a phone is in landscape, not even when it is
edited there. An empty page adopts on its first edit. Points are never rewritten. Moves, nudges,
duplicates, and pastes are limited by both the rotated footprint and the stored points, so a
rotated object at an edge is never clamped into a narrower shape. The size merges like a page name,
travels in `lumen.board.v1`, and is the SVG viewBox. The background is a separate canvas
under the ink, so the eraser's `destination-out` affects ink only.

## 10. PWA, caching, stale chunks, and deployment

### 10.1 Service-worker strategy

`public/service-worker.js` receives a build identifier through its registration URL and
uses a distinct `lumen-ai-notes-v<build>` shell cache per release. Install caches the shell
and the exact entry JS/CSS discovered from built HTML; missing entry assets fail install so
the previous working worker remains. Activation deletes only old Lumen shell caches and
never WebLLM caches.

`/api/*` is never service-worker cached. Navigations are network-first with cached shell
fallback. Same-origin static assets are cached on use. External image caching is bounded.

### 10.2 Stale hashed-asset recovery

The reported missing `PhoneLocalAiTutor-*.css` and `Whiteboard-*.js` files were stale
fingerprints from an old shell/stopped or replaced deployment—not deleted learner data and
not the whiteboard/AI feature logic itself.

`chunkRecovery.js` recognizes browser/Vite lazy JS and extracted-CSS failures. While online,
it attempts at most one reload per tab/cooldown and requires a durable session marker to
avoid loops. Repeated failure reaches an actionable boundary. Manual repair first proves a
fresh HTML shell is reachable with a no-store probe, then removes only Lumen shell caches,
updates the worker, and reloads. IndexedDB, localStorage, and WebLLM caches survive.

`audit:chunks` deliberately reproduces both reported asset classes and verifies recovery
plus localStorage preservation.

### 10.3 Deployment invariants

Deploy a release atomically:

1. run the full build from the immutable reviewed source;
2. upload all new fingerprinted assets first;
3. verify referenced asset existence;
4. publish matching `index.html` and service worker last;
5. do not rebuild a `dist/` directory that is actively being served;
6. do not deploy only HTML or only assets;
7. preserve the same-origin `/api` route for integrated AI/search deployments;
8. test an old open tab/PWA upgrading to the new release.

Immediate operational incident found during this handoff: the current `dist` sent
`contextCitations`, but an old Node process on `127.0.0.1:4187` rejected it while
`/api/ai/config` still looked Ready. The stale process was restarted; a canonical payload
including `contextCitations: []` then completed against real Qwen with `READY`. HTTPS 4194
already accepted the contract.

The durable prevention is now implemented: `src/lib/aiContract.js` defines
`lumen.ai.request.v2`, `/api/health` and `/api/ai/config` publish it as
`requestContract`, every AI request must declare it as `contract`, and either
side fails closed with a typed `AI_CONTRACT_MISMATCH` error plus reload/restart
guidance instead of a misleading Ready state. Deploying immutable server +
`dist` together from one build remains the operational rule; the handshake makes
violations visible rather than making them safe.

## 11. Server, network, and security boundary

### 11.1 Integrated server endpoints

`server/server.mjs` serves static production assets plus:

- `GET /api/health`
- `GET /api/ai/config`
- `GET /api/ai/health`
- `POST /api/ai/respond`
- `POST /api/ai/respond/stream`
- `POST /api/local-search`

Current default controls:

| Control | Default |
|---|---:|
| request body cap | 128 KiB |
| body read timeout | 12 s |
| AI deadline | 240 s |
| browser client deadline | 255 s |
| rate limit | 12 requests / 60 s / client hash |
| global AI concurrency | 2 |
| per-client AI concurrency | 1 |
| upstream stream idle | 60 s |
| heartbeat | 10 s |
| downstream backpressure deadline | 15 s |
| browser stream body cap | 4 MiB |
| search timeout | 8 s |

Logs contain sanitized event/request/timing/count metadata, not prompts, responses, or
queries. Preserve this rule when adding diagnostics.

### 11.2 Identity and capability attestation

The operator owns the Ollama URL/model/digest. Browser requests cannot select them. The
server probes tags/show and verifies installation, configured digest, completion, tools,
and thinking capability. An admitted inference gets a fresh digest guard so a briefly
cached Ready result cannot authorize a changed mutable tag.

The reviewed live model is `qwen3.5:4b` with the digest documented in the private operator
configuration/example. Never copy a newly pulled tag into production without reviewing
and updating the expected digest and rerunning evaluation.

### 11.3 Origin/TLS assumptions

Loopback development allows literal localhost/127.0.0.1 Hosts. Non-loopback serving fails
closed unless TLS credentials and exact HTTPS `AI_ALLOWED_ORIGINS` are configured. Ollama
and SearXNG remain loopback-only. Host checks defend ordinary DNS-rebinding browser paths.

Origin/Host checks alone are **not authentication**. As of 2026-09-01 the server also
supports learner pairing (`AI_AUTH=pairing` + `AI_PAIRING_CODE`): the AI/search POST
endpoints then require a stateless HMAC session issued by `POST /api/auth/pair` into an
HttpOnly SameSite=Strict cookie, with constant-time code comparison, a five-attempt
per-client pairing rate limit, and revocation by code/secret rotation or restart.
Serving AI or search beyond loopback now fails closed at startup unless pairing is
enabled or `AI_ALLOW_UNAUTHENTICATED_LAN=true` explicitly acknowledges the documented
single-learner trusted-LAN profile. Shared classroom/office use should enable pairing;
hostile-network exposure remains out of scope.

Use a stable certificate-covered hostname or router-reserved address. The Mac address was
`192.168.30.96` during the latest diagnostic, but DHCP addresses change; do not hard-code
that value as durable truth. Renew the leaf while retaining the CA when the SAN changes,
update exact allowed origins, restart the integrated server, and reinstall/reopen the PWA
at the new origin. Each origin has separate browser data/caches.

### 11.4 Static versus integrated capability matrix

| Deployment | Reader/study | On-device Lite local inference | Mac local AI | Current-web fallback |
|---|---|---|---|---|
| Static HTTPS `dist/` | yes | possible on supported secure WebGPU browser, with model-host access | no | no same-origin gateway |
| Vite static preview | development viewing only | localhost may be technically secure, but not release evidence | no | no |
| Vite + `dev:ai` proxy | yes on loopback | development only | yes | off unless search profile used |
| `start:local-ai` on 4187 | integrated loopback Mac use | supported on same Mac browser | yes | yes when configured |
| HTTPS `npm start` on LAN | intended phone-integrated profile | supported subject to physical-device gate | yes | yes when configured/consented |

The common “AI server is not reachable” error usually means the user opened a static
preview, stopped/old port, stale PWA origin, changed Mac address, disallowed Origin, or
untrusted certificate—not necessarily an Ollama/model failure.

## 12. Incident history and what changed

This section prevents a future engineer from rediscovering the same failure classes.

### 12.1 Missing lazy CSS/JS and crashed Whiteboard/phone AI screen

**Symptoms:** `Unable to preload CSS ... PhoneLocalAiTutor-<old>.css` and `Failed to fetch
dynamically imported module ... Whiteboard-<old>.js`.

**Cause:** old shell/module graph requested fingerprints absent from the new/stopped
deployment.

**Fix:** build-specific worker/cache, fail-closed shell install, recoverable lazy imports,
bounded reload/manual repair, atomic deployment documentation, browser regression.

### 12.2 Mac AI unreachable

**Symptom:** local AI server unreachable at app address.

**Observed causes:** 4187 process stopped while an old shell remained; static preview used;
LAN IP changed while certificate/origin still named old IP.

**Fix/operation:** use the same integrated origin; verify `/api/health` and
`/api/ai/config`; renew cert/update exact origin on address change; restart server. UI error
guidance now points to the integrated origin and invalidates stale Ready state on network/
model/contract errors.

### 12.3 Request UTF-8 budget rejection

**Symptom:** request exceeds advertised local model UTF-8 budget.

**Cause:** structured output requested 4,096 tokens after fitting against Balanced 1,800
headroom; earlier paths also measured incomplete envelopes and post-search evidence could
overflow synthesis.

**Fix:** selected profile owns output/input; canonical exact body; transport assertion;
every branch fitted; post-search evidence compacted; phone reserves actual future evidence.

### 12.4 Output-limit failure

**Symptom:** model reached output limit before completion.

**Cause:** Qwen used all 1,800 Balanced tokens on an overly broad request.

**Fix:** completion target margin, stricter one-time buffered grounded regeneration, strict
terminal validation, focused prompts. Persistent length failure remains explicit.

### 12.5 Web fallback appeared not to work

**Causes found:** strong library match correctly prevented egress; weak phone planner could
say `answer`; Qwen could skip Mac tool; planned query could be empty; irrelevant/generic
engine results could be accepted too easily; UI states were ambiguous.

**Fix:** explicit two-gate states; deterministic Mac query if skipped; phone exact-query
proposal even if planner vetoes/fails; optional empty-query refinement; stricter relevance;
typed no-evidence/ungrounded failures. Search still depends on public-engine quality.

### 12.6 Markdown and Mermaid response failures

**Causes:** line-splitter was not a real Markdown renderer; tutor Mermaid fences were never
initialized; Reader reread generated SVG on theme change.

**Fix:** shared sanitized GFM/KaTeX pipeline; shared lazy source-preserving Mermaid renderer;
render completed fences only; accessible safe fallback.

### 12.7 Repeated local-model consent

**Cause:** local-only disclosure and per-web-request permission had been conflated.

**Fix:** local acknowledgement remembered in browser; Review again revokes it; web remains
one-request authorization; phone exact query remains separately approved.

### 12.8 Audio only exposed one option

**Cause:** initial speech hook/UI treated one selected system voice as the whole experience.

**Fix:** language-grouped multiple voice inventory, filters, preview, rate/pitch/volume,
four scopes, presets, persistence, transport controls, and interruption handling.

## 13. Requirement reconciliation performed for this handoff

The requirements were re-read against current source and tests, not merely copied from the
old narrative. [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md) was corrected as follows:

- the verification-through date now includes 2026-09-01;
- the 2026-08-24 matrix is explicitly a baseline rechecked on 2026-09-01;
- the top “Study Loop v1” table is explicitly a subset, not whole-product status;
- `BUG-004` now traces stale-build/lazy-chunk recovery and adds the missing client/server
  contract-version/atomic-deployment acceptance condition;
- `PERF-002` now traces local-AI latency/resource SLOs instead of treating selected smokes
  as performance proof;
- `AI-004` now traces safe Markdown/diagram presentation, terminal integrity, buffering,
  cancellation, and accessibility/device evidence;
- AI-001 shipped modes and planned prompt strategies are no longer conflated;
- AI-001 grounding criteria are scoped to grounded requests, while No-library must disclose
  its evidence limitation;
- AI-001 presentation wording distinguishes prose Markdown from structured components;
- AI-002 records the unresolved Deep/thinking-capability compatibility issue;
- AI-003 records bounded empty-query refinement, feature relevance filtering, retained
  evidence, structured citation repair, and the missing adversarial evaluation corpus;
- the older August streaming smoke is marked historical and not evidence of live grounded
  provider-token visibility;
- the aggregate release gate and the stale 4187 contract recovery are recorded as dated
  evidence;
- `npm run check:release` is explicitly the aggregate deterministic + browser command.

Other documentation corrections made in the same pass:

- APP guide now distinguishes source-free token-live text from validation-buffered grounded
  text and scopes Markdown claims to prose surfaces;
- APP guide no longer overclaims full dialog/focus evidence;
- static HTTPS versus integrated Node AI capabilities are distinguished;
- phone documentation now matches retrieval-unavailable fallback behavior;
- phone's 4,400-byte retrieval-entry budget and pre-egress reserves are described precisely;
- streaming docs limit delta/final-text equality to Markdown;
- Mac browser history is described as automatic, disclosed, clearable local retention, not
  a separate opt-in setting;
- model research is explicitly a dated snapshot requiring revalidation.

### 13.1 Current requirement matrix

| Area | IDs and current state | Critical open condition |
|---|---|---|
| Reliability | BUG-001 Implemented; BUG-002/003 Partial; BUG-004 Implemented | physical Safari, complete input/control/dialog matrix, real atomic update drill, contract handshake |
| Data/performance | DATA-001/002/003 Partial; PERF-001/002 Partial | independent schemas, full migrations/activity/trash, iPhone budgets, AI SLOs |
| Learning loop | LEARN-001–004 Partial; LEARN-005 Backlog | relocation/restore, calibrated scheduler, mastery graph, mistakes |
| Assess/plan | ASSESS-001/002, PLAN-001/002 Backlog | complete product models and workflows |
| Labs/interviews | LAB-001/002/003, INTERVIEW-001/002 Backlog | runtimes, attempts, rubrics, session UX |
| Search/content | SEARCH-001 Partial; SEARCH-002/GRAPH-001 Backlog; CONTENT-001/002 Partial | advanced lexical, semantic/privacy design, graph, collections/revisions/import/export |
| AI | AI-001/002/003/004 Partial | claim-level quality, phone device proof, auth, retention/no-AI preference, exact-query/engine quality, accessibility/SLOs |
| Sync/collab | SYNC-001 and COLLAB-001 Backlog | encrypted cross-device model before sharing |
| Teaching/board | TEACH-001 and BOARD-001 Partial; BOARD-002/003 Backlog | authored decks/export; advanced board objects/navigation |
| Audio/a11y | AUDIO-001 and A11Y-001 Partial; AUDIO-002 Backlog | physical voice/routing, long-form features, VoiceOver/WCAG/manual evidence |

### 13.2 Explicit product decisions that must not be misrepresented

1. **Approach, not chain-of-thought:** provider reasoning is private/discarded; visible
   Approach is deterministic metadata.
2. **Lexical pre-generation routing:** Library-first does not generate then judge an answer.
3. **Grounded integrity over first-token display:** Mac grounded text is withheld until
   citations validate.
4. **Snippet-only web evidence:** result pages are not fetched; quality remains Partial.
5. **No-library is general knowledge:** it must not imply curriculum citations.
6. **Static HTTPS can run phone-local inference:** integrated Node is required for Mac AI
   and same-origin search, not necessarily for already supported WebGPU inference itself.
7. **Same-origin tab sync is not cloud sync.**
8. **No paid API does not mean zero operating/privacy cost.**

## 14. Verification evidence and its limits

### 14.1 Final aggregate run on 2026-09-01

`npm run check:release` completed with exit code 0 after current source changes that preceded
this documentation pass. It ran:

- notes audit: 144 Markdown files, 32,755 lines, 23 Parts;
- general unit audit: narration, search, profile migration, review scheduling, whiteboard
  normalization;
- scale: 5,000-annotation path, 10,000-card queue/statistics, 50,000-attempt analytics;
- storage: recovery, generation fencing, byte/board budgets, fallback parity;
- backup memory: 16,778,784 bytes and 94 MB RSS growth;
- AI/data: 228/228;
- production build and app/PWA/static-asset audit;
- browser workflow, audio, review, annotations, visual/offline, controls, AI UIs, Mermaid,
  and stale chunks.

Browser result highlights:

- 182 visible controls inspected across the current main surfaces;
- visual audit at 402 px: 46 formulas, 1 diagram, 45 cached requests;
- audio: multiple voices/languages, preview, parameters, scopes, foreground safety,
  persistence, empty inventory, phone layout;
- Mermaid: 1 deferred runtime load, 5 valid diagrams, 1 safe diagnostic, 5 theme rerenders;
- stale chunks: forced Whiteboard JS and phone-AI CSS failures recovered with local data.

The small text-only UI copy changes made during this handoff were followed by focused
build/browser verification in the final handoff checklist below; documentation edits do
not alter runtime contracts.

### 14.2 Real-model evidence

Recorded real Qwen smokes include:

- source-free Markdown: 52 deltas, 8.338 seconds on one historical run;
- fresh 393×852 HTTPS Library-first: live card in 32 ms, complete cited Markdown/KaTeX
  answer in 20.069 seconds, 280 validated deltas, 2,035 input / 290 output tokens;
- relevance-filtered current-web prose: 12.172 seconds, one retained source, `[W1]`;
- structured flashcard over the repaired profile path: 12.036 seconds, one source, valid
  in-schema `[W1]`;
- post-restart loopback canonical request containing `contextCitations: []`: completed
  `READY` against `qwen3.5:4b` (2 output tokens).

These are selected smokes, not p50/p95 latency, failure-rate, factuality, pedagogical
quality, or regression benchmarks. There is no committed immutable report bundle or source
SHA. Re-run and archive them after establishing Git.

### 14.3 What browser/unit tests do not prove

- Mac AI UI audit intercepts responses; it proves UI/request contracts, not Qwen quality.
- Phone engine tests inject fake WebLLM, worker, WebGPU/cache/search boundaries.
- Phone UI audit uses a fake engine in headless desktop Chrome at a mobile viewport.
- Mermaid fixture proves runtime safety/lifecycle, not arbitrary model diagram correctness.
- Desktop Chrome mobile emulation is not Mobile Safari, WebGPU, storage eviction, OS
  backgrounding, Apple Pencil, VoiceOver, real audio routing, heat, or battery evidence.
- Search tests and selected live queries are not a versioned recency/relevance/entailment
  evaluation corpus.
- Origin/Host tests are not authentication proof.

### 14.4 Build warnings

The production build succeeds but reports large chunks. The current generated output has
approximately 6.0 MB WebLLM library and approximately 6.0 MB phone worker JavaScript before
gzip, both above the configured 1.8 MB warning threshold. Vite also externalizes WebLLM's
Node `url` import in the browser build. The app startup entry remains under the static gate,
because phone AI is lazy.

Treat these warnings as a physical-Safari compatibility/performance risk, not harmless
noise and not a compile failure. Measure parse/startup/peak memory, determine whether worker
and main chunks duplicate runtime bytes, and validate the externalization path before
changing the bundle.

## 15. Prioritized open work

### P0 — required before a credible release handoff

1. **Restore source provenance.** Establish/recover Git, baseline commit, clean-tree proof,
   lockfile and artifact digests, and archived audit reports.
2. **Add client/server contract identity.** Publish it in config and fail clearly on skew;
   deploy server + `dist` atomically.
3. **Complete the physical-iPhone matrix.** Trusted HTTPS, real 710 MiB download, inference,
   offline reload, storage eviction/redownload, cache deletion, cancellation, background/
   suspend, memory, latency, heat, battery, and exact-query search.
4. **Build an AI quality/evidence suite.** Delivered in part 2026-09-01: the versioned
   deterministic tier (`eval/fixtures/v1` + `npm run audit:ai-eval`, 27 cases covering
   retrieval hit@k, personal-note/edit provenance, fallback codes, budgets, adversarial
   queries, determinism) now gates `npm run check`; the live-Qwen tier remains the
   operator-run `scripts/live_ai_smoke.mjs` and the phone model remains a device gate
   (see eval/README.md).
5. **Add authentication before untrusted/shared LAN.** Delivered 2026-09-01 as opt-in
   learner pairing with fail-closed non-loopback startup (see §11.3); physical multi-
   device pairing evidence on the real LAN remains an operator step.
6. **Secure secrets.** Move CA key to encrypted offline custody; never bundle env/private
   keys; rotate the SearX secret if any external tool/session log exposed it.

### P1 — correctness, UX, and evidence

1. ~~Gate Deep on `thinkingCapable`~~ — done 2026-09-01 (server typed rejection + UI gate).
2. ~~Make phone structured citations inline navigable and personal-note citations focus
   the exact note target~~ — done 2026-09-01 with browser-audit coverage.
3. Define PERF-002 p50/p95 cold/warm SLOs and archive machine/model/prompt metadata.
4. ~~Add answer-to-note and code-review~~ — done 2026-09-01; deciding whether
   derivation/analogy/challenge need distinct UX or prompt controls remains open.
5. ~~Add an explicit saved no-AI preference and configurable Mac history retention~~ —
   done 2026-09-01.
6. ~~Move library full-text parsing/ranking to a worker; benchmark worst-case custom
   corpus~~ — done 2026-09-01 (librarySearch worker + 643-document scale gate).
7. ~~Complete BUG-002/003 pointer matrix and dialog focus loops~~ — line matrix and
   five-dialog focus contract delivered 2026-09-01 (a real focus-restoration defect
   was found and fixed); every-critical-action contracts, Mobile Safari, and
   VoiceOver remain.
8. ~~Complete annotation relocation/orphan/restore acceptance~~ — delivered
   2026-09-01 (unit semantics + full browser matrix incl. backup restore);
   the calibrated review scheduler remains.
9. Profile/split the WebLLM runtime and worker without breaking integrity/cache/lazy-load
   contracts.
10. Decide whether Mac exact-query preview/edit is required; preserve per-request consent.

### P2 — roadmap delivery

Waves 6–10 (PRs #19–#23, 2026-09-01/02) delivered large slices of this
roadmap; PRODUCT_REQUIREMENTS.md's verification log is the authority.

- ~~mistake notebook~~, ~~daily session builder~~, ~~mastery ladder~~,
  ~~readiness assessments~~ (PR #27: frozen versioned questions, rubric
  scoring, advisory recommendations), ~~goal capture/pacing~~, and the
  ~~calibrated scheduler~~ (PR #26: opt-in FSRS-4.5, engine-exact against
  ts-fsrs vectors, history-replay migration); per-learner weight
  optimization remains;
- ~~worksheet labs~~ (PR #28: Python/SQL/debugging/metrics with verified
  literals); the isolated WASM runtime remains;
- ~~timed interview rounds~~ and ~~structured per-track question banks~~
  (PR #28, PR #37: all eight tracks seeded, 76 questions with rubrics);
- ~~advanced lexical search~~ (typo tolerance, exclusions, saved/recent,
  highlighted snippets, title:/part:/tag: field filters, has:code/has:formula,
  plural folding, facet counts); ~~concept map v1~~ (Part-level serpentine
  grid with mastery overlay); ~~synonyms~~ (PR #31); semantic search and the
  concept-level graph remain (design-gated: docs/SEMANTIC_SEARCH_DESIGN.md);
- ~~collections/organize/pins/archive~~, ~~30-day trash~~, ~~revisions with
  line diff~~, ~~HTML export~~, ~~review-card JSON interchange~~,
  ~~activity ledger~~, ~~upload duplicate detection~~, ~~HTML import with
  link audit~~ (PR #30), ~~EPUB import and print/save-as-PDF~~ (PR #36);
  PDF/GitHub import stays deferred (docs/IMPORT_DEFERRAL.md);
- ~~encrypted backups~~ (PR #25: lumen.backup.enc.v1), the ~~sync
  design~~ (PR #32), and ~~sync v1 itself~~ (PR #38: lumen.backup.enc.v2
  vault files, deviceId-sorted peer fold, Settings vault flow);
  folder-watching, the relay, and collaboration remain, in that order;
- ~~board multi-select/copy-paste/resize/zoom-pan/SVG export~~,
  ~~teaching print-to-PDF~~, ~~lock/z-order/snap/JSON interchange~~
  (PR #29), and ~~rotation~~ (PR #45: pixel-space center-anchored, rotated
  hit-testing, SVG transforms); authored decks and layers remain;
- ~~narration depth~~ (section skip, sleep timer, persisted resume,
  pronunciation overrides, spoken-block follow), ~~audio bookmarks~~
  (PR #33), and ~~playlists~~ (PR #39: opt-in next-chapter auto-advance);
  generated audio (AUDIO-002) remains;
- ~~high-contrast theme, keyboard board nudging, reduced-motion coverage,
  shortcuts sheet~~; WCAG 2.2 AA/VoiceOver device evidence remains.

## 16. Operator runbook

### 16.1 Prerequisites

- macOS host or equivalent trusted local server
- Node `>=20.19` and npm
- Ollama installed and running on loopback
- Docker/Compose for optional SearXNG
- trusted local HTTPS certificate for iPhone/LAN WebGPU
- Chrome for automated browser audits

Install exactly from the lockfile for a reproducible baseline:

```bash
npm ci
```

Use `npm install` only when intentionally changing dependencies/lockfile.

### 16.2 Mac loopback development

AI without web:

```bash
# terminal 1
npm run dev:ai

# terminal 2
npm run dev
```

AI with configured loopback SearXNG:

```bash
npm run dev:ai:search
npm run dev
```

Vite serves `127.0.0.1` and proxies `/api` to `127.0.0.1:8787`. Do not expose this profile
as a LAN security configuration.

### 16.3 Integrated Mac loopback

```bash
npm run build
npm run start:local-ai
```

Open `http://127.0.0.1:4187/`. This is the correct stable Mac test path, not
`npm run preview` on port 4173.

### 16.4 Private-LAN iPhone profile

1. choose a stable mDNS hostname or router-reserved IP;
2. create/renew a leaf certificate containing that exact hostname/IP;
3. trust the public CA on the phone;
4. set `HOST=0.0.0.0`, the HTTPS port, cert/key paths, exact comma-separated HTTPS origins,
   AI/search flags, reviewed model and digest, and 16K context in the private `.env`;
5. keep Ollama and SearXNG loopback-only;
6. run `npm run build` then `npm start`;
7. open that exact HTTPS origin in Safari and install the PWA there.

See [LOCAL_HTTPS.md](./LOCAL_HTTPS.md) and [AI_SERVER.md](./AI_SERVER.md). Do not solve an
Origin error with wildcard CORS or by exposing Ollama/SearXNG.

### 16.5 SearXNG

Use the repository setup command and Compose file documented in
[infra/searxng/README.md](./infra/searxng/README.md). Verify:

- container image digest, UID 977, read-only root, dropped capabilities, resource bounds;
- loopback port only;
- `/config` health;
- a real JSON query;
- no exact query appears in persistent Docker logs.

Do not include `infra/searxng/.env` in a support archive.

### 16.6 Health probes

Use the exact app origin:

```bash
curl -fsS http://127.0.0.1:4187/api/health
curl -fsS http://127.0.0.1:4187/api/ai/config
```

For HTTPS, use the trusted CA and exact certificate hostname/IP. A healthy public AI config
must show enabled, `ollama-local`, expected model, reachable/installed/identity verified,
completion capable, and—before web is offered—tool capable and search available.

Config readiness now includes contract identity: a healthy config must show
`requestContract: "lumen.ai.request.v2"` matching the deployed UI's compiled
value, and a skewed pair fails with `AI_CONTRACT_MISMATCH`. A canonical
no-source request containing `contextCitations: []` after a restart/deploy
remains a useful end-to-end smoke but is no longer the only skew defense.

### 16.7 Release commands

```bash
npm run check:release
```

This expands to deterministic checks and the full browser suite. Useful focused commands:

```bash
npm run check
npm run check:browser
npm run audit:ai
npm run audit:phone-ai
npm run audit:ai-ui
npm run audit:phone-ai-ui
npm run audit:mermaid
npm run audit:chunks
npm run audit:workflow
npm run audit:audio
npm run audit:review
npm run audit:annotations
npm run audit:visual
npm run audit:controls
npm run audit:sync
```

Run browser/build commands sequentially. One audit rebuilding `dist` while another browses
it can create false missing-asset/cache failures.

After Git is restored, archive:

- commit SHA and clean-tree status;
- Node/npm/OS/browser/device versions;
- package-lock checksum;
- Qwen tag + Ollama digest/capabilities;
- SearXNG tag + OCI digest/config;
- certificate origin (never private key);
- complete command output and timestamps;
- live-smoke prompt fixture, profile, request bytes/tokens, timings, sources, result;
- physical-device screenshots/telemetry where required.

## 17. Troubleshooting playbook

### “Local AI server is not reachable”

1. inspect the address bar: static preview/old IP/old PWA origins have no usable same-origin
   API;
2. request `/api/health` and `/api/ai/config` from that exact origin;
3. confirm the Node listener and Ollama `127.0.0.1:11434`;
4. confirm model installed/digest/capabilities;
5. for LAN, verify certificate SAN, trust, Host, and exact allowed Origin;
6. restart the integrated server after server-source/contract changes;
7. if config is green but requests reject fields, suspect server/UI version skew.

### “Request data exceeds UTF-8 budget”

1. record request ID, mode, profile, exact request bytes, source count, history/summary, and
   web state from structured logs/UI;
2. retry Fast/shorter prompt or clear older turns only as a user workaround;
3. reproduce with the canonical request builder; do not manually strip hidden fields;
4. inspect whether complete source blocks survived and whether post-search evidence was
   fitted;
5. treat a server rejection of a UI-enabled unchanged body as a contract regression.

### “Model reached output limit”

1. inspect `done_reason`, profile, output tokens, elapsed time, and whether the one grounded
   regeneration ran;
2. keep the result failed unless terminal is exact stop;
3. ask a narrower question or select Fast/Balanced scope;
4. add a regression fixture before changing margins/caps;
5. do not accept or save chopped prose as complete.

### “Web fallback did nothing/failed”

1. confirm Library-first mode;
2. distinguish permission armed, not needed due strong local evidence, searching, used,
   failed, and phone waiting for exact approval;
3. inspect retrieval trace/code and whether authorization was consumed;
4. check SearX health, engine degradation, query relevance, empty-result filter, retained W
   evidence, citation validation, and synthesis context;
5. remember that a typed no-evidence/ungrounded failure is intentional fail-closed behavior.

### “Diagram could not be rendered”

1. check whether it is an active partial fence (should remain source), malformed syntax,
   unsupported alias, source-size bound, Mermaid import failure, sanitizer rejection, theme
   rerender, or stale lazy chunk;
2. use the diagnostic source/copy/retry controls;
3. verify only one SVG and no stale failure state across rapid theme changes;
4. never render unsanitized Mermaid SVG.

### Missing Whiteboard/phone-AI JS or CSS chunk

1. confirm the requested fingerprint is absent/current;
2. allow the one bounded automatic online reload;
3. use manual app-file repair only after its online shell probe succeeds;
4. verify IndexedDB/localStorage/WebLLM caches remain;
5. inspect deployment atomicity rather than resetting learner data.

### On-device model will not load

Check secure context, WebGPU/adapter, Worker, Cache API, Web Locks, known buffer/memory/quota,
artifact hashes/redirect, exact cache names, consent identity, revocation epoch, and worker
status. Do not bypass capability checks or integrity verification to get a demo working.

### Audio voice missing or playback interrupted

Refresh asynchronous voices, filter by correct language, install the voice in iOS settings,
use Test voice from a direct tap, verify network label, return app to foreground, and resume
the current sentence. The app cannot manufacture voices absent from the OS inventory.

## 18. Invariants a future change must preserve

### Data

- IndexedDB/profile/board generation fencing, tombstones, and atomic updater semantics.
- Reset/restore cannot be undone by a stale tab or delayed board save.
- Board points are fractions of the page's authoring `size` (a legacy page without one renders
  in the live canvas until it adopts one); migrate by adopting a size, never by rewriting points,
  and scale x and y uniformly.
- Backup preflight and recovery snapshot precede destructive replacement.
- Failures remain visible; never claim data/cache deletion before post-check succeeds.

### AI input/output

- Measure the exact canonical serialized request, not approximate visible text.
- The selected response profile owns both output and corresponding input budget.
- Preserve the current prompt; drop only complete old history/source units under fit rules.
- Require exact provider terminal success; reject post-terminal data.
- Never persist an invalid/incomplete grounded/schema result as complete.
- Do not expose provider thinking/chain-of-thought.

### Grounding/search

- Untrusted context cannot declare its own citation labels.
- Every S/W marker outside code resolves to evidence actually supplied.
- Returned/displayed sources are exactly retained sources, with immutable indices.
- Web requires server capability + Library-first insufficiency/time-sensitive trace + learner
  per-request permission; phone additionally requires exact-query approval.
- No arbitrary fetch/URL/shell/filesystem/background tool.

### Phone model

- No weights before artifact-bound consent.
- Immutable revisions and supported artifact hashes fail closed.
- Named-cache inspection/deletion; no network fetch during deletion.
- Web Lock + revocation epoch prevents cross-tab delete/load races.
- Unresponsive worker can be terminated and UI status must follow engine status.

### Rendering/PWA

- Sanitize Markdown/KaTeX output and Mermaid SVG.
- Never render Mermaid for each streaming token; preserve original source for rerender.
- API responses are never service-worker cached.
- Worker activation only after matching shell assets exist.
- Repair deletes only Lumen app caches, not study data or model caches.

### Privacy/security

- No prompt/query contents in normal server logs.
- No provider key or arbitrary service/model/tool control in browser payload.
- No wildcard/non-TLS LAN origin workaround.
- Do not describe Origin checks as authentication.
- Keep env files, CA/server keys, search secret, and learner backups out of source/support
  bundles.

## 19. Key-file map for the next engineer

### Frontend orchestration and state

- [src/App.jsx](./src/App.jsx) — routes, profile lifecycle, persistence, document state,
  backup/reset, AI adapters/history, source navigation, review/board integration.
- [src/lib/db.js](./src/lib/db.js) — profile v4 normalizer, IndexedDB/fallback, budgets,
  authoritative replace.
- [src/lib/profileSync.js](./src/lib/profileSync.js) — record-aware cross-tab profile merge.
- [src/lib/boardSync.js](./src/lib/boardSync.js) — board merge/rebase.
- [src/lib/backup.js](./src/lib/backup.js) — canonical backup, integrity, preflight.
- [src/lib/storageBudget.js](./src/lib/storageBudget.js) — 20 MiB/250-board aggregate gate.

### Content and learning

- [src/lib/content.js](./src/lib/content.js) — metadata and lazy Markdown/search imports.
- [src/lib/search.js](./src/lib/search.js) — ordinary library lexical search.
- [src/lib/libraryRetrieval.js](./src/lib/libraryRetrieval.js) — AI Library-first retrieval.
- [src/components/Reader.jsx](./src/components/Reader.jsx) — reading/editing/notes/anchors.
- [src/lib/annotations.js](./src/lib/annotations.js) — text index, anchor resolve/relocate.
- [src/lib/review.js](./src/lib/review.js) — scheduling/queue/grade/undo.
- [src/components/ReviewCenter.jsx](./src/components/ReviewCenter.jsx) — review UI/authoring.
- [src/hooks/useSpeech.js](./src/hooks/useSpeech.js), [src/lib/speech.js](./src/lib/speech.js),
  [src/components/NarrationPanel.jsx](./src/components/NarrationPanel.jsx) — audio.
- [src/components/TeachingMode.jsx](./src/components/TeachingMode.jsx) — slide teaching.
- [src/components/Whiteboard.jsx](./src/components/Whiteboard.jsx) — board editor.

### AI frontend and shared contracts

- [src/components/AiLearningStudio.jsx](./src/components/AiLearningStudio.jsx) — engine chooser.
- [src/components/AiTutor.jsx](./src/components/AiTutor.jsx) — Mac UI/request orchestration.
- [src/lib/aiClient.js](./src/lib/aiClient.js) — same-origin HTTP/NDJSON validation.
- [src/lib/aiRequestBudget.js](./src/lib/aiRequestBudget.js) — canonical request-byte fit.
- [src/lib/conversationMemory.js](./src/lib/conversationMemory.js) — complete-pair memory.
- [src/lib/tutorGrounding.js](./src/lib/tutorGrounding.js) — safe S-labelled context blocks.
- [src/lib/aiProvenance.js](./src/lib/aiProvenance.js) — durable AI draft/source materialization.
- [src/lib/tutorMarkdown.js](./src/lib/tutorMarkdown.js) — sanitized prose/citations.
- [src/lib/markdown.js](./src/lib/markdown.js) — shared Markdown extension points.
- [src/lib/mermaidDiagrams.js](./src/lib/mermaidDiagrams.js) and
  [src/lib/useMermaidDiagrams.js](./src/lib/useMermaidDiagrams.js) — diagram lifecycle.

### Phone AI

- [src/components/PhoneLocalAiSettings.jsx](./src/components/PhoneLocalAiSettings.jsx) —
  compatibility, download/load/release/delete.
- [src/components/PhoneLocalAiTutor.jsx](./src/components/PhoneLocalAiTutor.jsx) — phone
  retrieval, composer, history, stream, evidence, exact-query consent.
- [src/lib/phoneLocalAi.js](./src/lib/phoneLocalAi.js) — artifact, lifecycle, fit, planner,
  inference, grounding, search contracts.
- [src/workers/phoneLocalAi.worker.js](./src/workers/phoneLocalAi.worker.js) — WebLLM worker.
- [PHONE_LOCAL_AI.md](./PHONE_LOCAL_AI.md) — runtime/security/device contract.

### Server/search/operations

- [server/server.mjs](./server/server.mjs) — static server, routing, admission/security/logs.
- [server/ai/config.mjs](./server/ai/config.mjs) — env/defaults/public capability envelope.
- [server/ai/contracts.mjs](./server/ai/contracts.mjs) — request/structured validation.
- [server/ai/ollama.mjs](./server/ai/ollama.mjs) — prompt, tools, exact fit, generation,
  terminal/citation/repair logic.
- [server/ai/streaming.mjs](./server/ai/streaming.mjs) — downstream NDJSON protocol.
- [server/ai/searxng.mjs](./server/ai/searxng.mjs) — query/URL/result safety/ranking.
- [infra/searxng/compose.yaml](./infra/searxng/compose.yaml) — hardened deployment.
- [scripts/create_local_https.sh](./scripts/create_local_https.sh) — CA/leaf create/renew.
- [AI_SERVER.md](./AI_SERVER.md), [docs/AI_STREAMING.md](./docs/AI_STREAMING.md),
  [LOCAL_HTTPS.md](./LOCAL_HTTPS.md) — operator/protocol docs.

### Build/PWA/recovery

- [vite.config.js](./vite.config.js) — build ID, proxy, target, chunk warning.
- [src/main.jsx](./src/main.jsx) — early preload recovery and SW registration.
- [public/service-worker.js](./public/service-worker.js) — release cache strategy.
- [src/lib/chunkRecovery.js](./src/lib/chunkRecovery.js) — reload/manual repair.
- [APP_GUIDE.md](./APP_GUIDE.md) — user/operator workflow.

### Test/audit entry points

- `scripts/unit_audit.mjs`
- `scripts/workflow_audit.mjs`
- `scripts/audio_audit.mjs`
- `scripts/review_audit.mjs`
- `scripts/annotation_audit.mjs`
- `scripts/storage_audit.mjs`
- `scripts/backup_memory_audit.mjs`
- `scripts/cross_tab_audit.mjs`
- `scripts/visual_audit.mjs`
- `scripts/control_audit.mjs`
- `scripts/ai_ui_audit.mjs`
- `scripts/phone_ai_ui_audit.mjs`
- `scripts/mermaid_ui_audit.mjs`
- `scripts/chunk_recovery_audit.mjs`
- `scripts/live_ai_smoke.mjs`

## 20. Immediate continuation checklist

Before accepting this handoff as a durable engineering baseline:

- [x] Recover/initialize Git and verify ignore rules without adding env/private keys.
      (Done 2026-09-01: baseline commit `fecbc6a` on `main`, private repository
      `Aman4563/lumen-ai-notes`.)
- [ ] Move the CA signing key to encrypted offline storage.
- [x] Create a baseline commit and record its SHA. (`fecbc6a`, 2026-09-01.)
- [x] Add a public client/server request-contract identifier and mismatch UI/test.
      (Done 2026-09-01: `lumen.ai.request.v2` handshake, typed
      `AI_CONTRACT_MISMATCH`, `audit:ai` + `audit:ai-ui` coverage.)
- [ ] Rebuild server + `dist` from that commit and deploy atomically.
- [ ] Run `npm run check:release` sequentially and archive complete output.
- [ ] Run a canonical real-Qwen request containing `contextCitations: []` on every intended
      origin.
- [ ] Run live Library-first, source-free, prose-web, and structured-web fixtures.
- [ ] Execute the trusted-HTTPS physical-iPhone matrix in
      [PHONE_LOCAL_AI.md](./PHONE_LOCAL_AI.md).
- [x] Establish the versioned claim-level/search quality evaluation set.
      (Deterministic tier delivered 2026-09-01 as `eval/fixtures/v1` +
      `audit:ai-eval` in `npm run check`; live-Qwen and device tiers remain
      operator/device-run evidence — see eval/README.md.)
- [x] Decide authentication scope before any shared-LAN use. (Decided and
      delivered 2026-09-01: opt-in learner pairing, fail-closed non-loopback
      startup, explicit single-learner waiver flag.)
- [ ] Record all failures as typed request IDs/log metadata without private prompt contents.

## 21. Final critical assessment

The strongest part of this system is not any individual UI feature; it is the increasingly
explicit boundary discipline: local-first data, canonical request fitting, bounded tools,
per-request consent, strict terminals, source-label integrity, safe rendering, atomic
recovery, and honest Partial statuses. Preserve that discipline.

The weakest part is evidence governance. Many meaningful repairs were completed rapidly,
but a non-Git workspace, narrative-only live timings, mocked phone runtime, no physical
iPhone acceptance, and no versioned grounding benchmark make it too easy to confuse
“passed current tests” with “production-proven.” The next engineer should resist adding
more breadth until provenance, contract versioning, device evidence, quality evaluation,
and authentication are addressed.

If a future change makes the demo look smoother by weakening input fitting, terminal
validation, citation checks, consent, cache deletion, synchronization fences, sanitization,
or error visibility, it is a regression—even if the happy-path screenshot improves.
