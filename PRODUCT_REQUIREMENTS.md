# Lumen Product Requirements and Delivery Tracker

This document is the source of truth for missing product capabilities, implementation
status, and verification status. A requirement is not `Verified` until **all** of its
acceptance criteria have appropriate automated coverage, the production build passes,
and any required real-device or manual evidence is recorded. Passing a test for one
delivered slice does not verify the parent requirement.

The baseline status matrix below reflects a source-and-test audit performed on
**2026-08-24** and rechecked against the current workspace on **2026-09-01**; the
append-only verification log is current through **2026-09-01**. Entries
describe working behavior, not intended behavior or the presence of a button.

## Status legend

| Status | Meaning |
|---|---|
| `Backlog` | Accepted requirement; implementation has not started. |
| `Ready` | Scope and acceptance criteria are sufficiently defined. |
| `Partial` | A usable or foundational slice exists, but one or more acceptance criteria or required evidence remain open. |
| `In progress` | Source changes are actively being implemented. |
| `Implemented` | Source changes are complete but final verification is pending. |
| `Verified` | Implementation, regression coverage, production build, and relevant browser audits pass. |
| `Blocked` | A recorded external or product decision prevents safe implementation. |

## Current delivery milestone — Study Loop v1 subset

This table tracks the immediate Study Loop milestone only; it is not the whole-product
status matrix. The comprehensive matrix below remains authoritative for AI, audio,
accessibility, board, search, synchronization, and later milestones.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| BUG-001 | Reliable mobile top-menu, sidebar close, scrim close, Escape close, and navigation close behavior | `Implemented` | `audit:workflow` asserts focus enter/return, body scroll lock, inert background, Escape/scrim/route/sidebar-action close, repeated-toggle consistency, and the 360px viewport; only Mobile Safari real-device evidence remains |
| BUG-002 | Reliable straight-line whiteboard tool for touch, Apple Pencil, and mouse | `Partial` | The complete line matrix passes `audit:workflow` (touch, mouse, pen-pressure, tap rejection, undo/redo, move/recolor/resize, page-switch/reload, PNG export); imported-backup board restore and physical Apple Pencil evidence remain |
| BUG-003 | Systematic interaction audit for every visible control and disabled state | `Partial` | Accessible-name/touch-size checks plus the five-dialog focus contract pass `audit:controls`; critical-action state/feedback/disabled-reason contracts remain |
| BUG-004 | Recover safely from stale fingerprinted application chunks | `Implemented` | Build-specific service-worker caches and bounded chunk repair pass `audit:chunks`; an atomic real-host deployment/update drill remains |
| DATA-001 | Versioned Study Loop profile schema and safe migration | `Partial` | Profile/backup v4, integrity preflight, fallback-journal recovery, and authoritative reset/restore recovery are covered; independent stores, full migration fixtures, and final cross-tab evidence remain |
| LEARN-001 | Durable text-anchored highlights and annotations | `Partial` | Creation, paint, edit, conversion, reload, relocation/orphan/relink, backup restore, no-paint fallback, and copy/export pass `audit:annotations` + unit suites; the relocated-offset write-back decision and real-device evidence remain |
| LEARN-002 | Convert a highlight, clipping, concept, or custom prompt into a review card | `Partial` | Eight authorable type labels with working cloze concealment, duplicate prevention, safe Markdown preview, edit/archive/restore, and blank/clipping/highlight/AI/mistake sources exist; heading sources, diagram card rendering, and backup-restore evidence remain |
| LEARN-003 | Daily review queue with Again/Hard/Good/Easy scheduling | `Partially Implemented` | Durable local-day limits, four grades, confidence, undo, bury/crunch/suspend exclusion, reload, DST day keys, explicit queue classes, and an opt-in FSRS-4.5 adaptive scheduler (per-card stability/difficulty, configurable retention, one-time history-replay migration, engine-exact against ts-fsrs@3.5.7 vectors, sync replay under the merged scheduler) are tested; per-learner weight optimization remains |
| LEARN-004 | Concept mastery states and mastery-based dashboard | `Partial` | Review aggregates exist; the evidence ladder, concept aggregation, provenance, and recommendations remain |
| LEARN-005 | Mistake notebook generated from failed reviews and assessments | `Partial` | Auto-capture on Again, manual capture dialog, merge/reopen, blur-committed corrections, category/corrected filters, linked and unlinked corrective scheduling, per-category/most-repeated analytics, cross-tab merge, and backup round-trip all pass `audit:review`/`audit:ai` suites; assessment-driven capture remains (ASSESS-00x is Backlog) |

## Verification log

| Date | Delivered and tested | Evidence |
|---|---|---|
| 2026-08-21 | Mobile sidebar open/close hardening and touch straight-line creation slice | `npm run audit:workflow`; this is not full BUG-001/002 acceptance coverage |
| 2026-08-21 | Profile v3 normalizer plus bounded review/annotation schemas | `npm run audit:unit`, `npm run check`; no persisted-v2/idempotence/failure test |
| 2026-08-21 | Blank and clipping-linked review-card authoring | `npm run audit:review`, `npm run audit:workflow` |
| 2026-08-21 | Queue/scheduling primitives, review history, and aggregate summaries | `npm run audit:unit`, `npm run audit:review`; pause/delete, four UI grades, and true daily limits are not all covered |
| 2026-08-21 | Review UI responsive layout and visible-control name/size checks | `npm run audit:visual`, `npm run audit:controls`; this is not a complete control contract |
| 2026-08-22 | Anchored highlight creation, inline paint, metadata edit, review conversion, storage, and reload | `npm run audit:annotations`; relocation/orphan repair, copy/export, and backup restore remain open |
| 2026-08-22 | Same-origin AI proxy/client foundation and structured contracts | `npm run audit:ai`: 11/11 pass; the foundation is covered, but no learner-facing tutor is integrated |
| 2026-08-23 | Profile/backup v4 integrity and storage-outage recovery | `audit:storage`; backup unit suite covers SHA-256, corruption, legacy v1-v3, prototype-pollution rejection, recovery snapshot, size bounds, and max accepted custom-document corpus |
| 2026-08-23 | Durable review limits and advanced authoring/session controls | `audit:unit`, `audit:review`; local-day ledger, confidence, undo, bury, crunch, eight item types, edit/archive/restore, and reload pass |
| 2026-08-23 | Proportional startup/offline caching | `audit:app` plus production SW browser evidence: 143 lecture chunks load on demand, search corpus stays lazy, and a visited 20k-character lecture reloads offline |
| 2026-08-23 | Insecure-LAN and capacity-loss regressions | Browser fixtures verify UUID fallback/bookmark flow with no runtime error and 499+2/500+1 uploads reject overflow without replacing an old document |
| 2026-08-23 | Learner-facing AI tutor and secure provider boundary | The then-current `audit:ai-ui` passed with intercepted same-origin responses and no paid call: a disclosure gate, citations/navigation, validated quiz, bounded local history/clear, and unsafe/disabled fail-closed states. The disclosure interaction was replaced by the remembered acknowledgement recorded in the 2026-08-31 repair row. |
| 2026-08-23 | Same-origin concurrent-tab profile safety and destructive-operation fencing | 10/10 merge/replacement unit tests plus browser reproduction: unique records union, text conflicts create recovered notes, counters reconcile, and fast dirty-create → reset no longer resurrects data |
| 2026-08-23 | Aggregate backup-safe storage and recovery hardening | `audit:storage` and `audit:backup-memory`: one atomic 20 MiB/250-board budget covers profile and boards, fallback replacement cannot resurrect deleted records, restore requires a confirmed recovery file, and a supported 16 MiB corpus stays below the desktop peak-memory gate |
| 2026-08-23 | Maximum-scale annotation and review paths | `audit:scale`, `audit:review`, and `audit:annotations`: one shared annotation DOM index; 24-card deck pagination; cached day formatting; 5,000-highlight, 10,000-card, and 50,000-attempt budgets pass on the test Mac. Physical-iPhone budgets remain open |
| 2026-08-23 | Free Mac-local AI backend and bounded current-information tool | Local-AI regression coverage exercises Ollama `/api/tags` + `/api/show` capability probes, serialized request/context budgets, strict completion terminals, schema validation, mandatory searched-answer citations, tool denial without consent, and a two-phase retrieve-then-schema path. One allowlisted SearXNG tool and the exact-query gateway are bounded by SSRF/origin/body/rate/concurrency/round/deadline controls and have no paid key/provider path. Real `qwen3.5:4b` plain and two-phase structured searched requests completed on the Mac; loopback SearXNG returned sanitized public results. This is Mac evidence, not physical-iPhone evidence |
| 2026-08-23 | Optional On-device Lite tutor | Phone engine/unit coverage exercises immutable model/runtime revisions, selected artifact integrity checks, artifact-identity-bound ~710 MiB download consent, exact named-cache inspection/deletion, bounded unload/cancellation with worker termination, serialized UTF-8 context fitting with source-usage disclosure, token/character output ceilings, validated structured output, and one-shot exact-query search approval. The mocked browser audit covers the selector, consent, download/release/delete, tutoring, context-fit, and search-approval UI. Automation deliberately fetches no real model weights; trusted-HTTPS physical-iPhone download, inference, cache/offline, memory, latency, thermal, battery, and cancellation evidence remains open |
| 2026-08-23 | Private-LAN HTTPS and local-service boundary | Source/tests require non-loopback AI serving to use TLS plus exact HTTPS origins, reject loopback DNS-rebinding Host/Origin pairs, keep Ollama/SearXNG URLs server-only, and expose sanitized public capability/privacy metadata. The local-CA procedure uses a stable origin, fingerprint verification, explicit trust, preserved offline CA key, explicit serial state, and renewable leaf certificates. SearXNG is loopback-only and container-hardened with an immutable image digest, non-root/read-only execution, dropped capabilities, resource bounds, and health checking. A dated trusted-HTTPS Safari run on the physical iPhone is still required |
| 2026-08-24 | Final local-AI release audit and live smoke | `npm run check` passes, including 132/132 AI/data tests and the production build/app audit; the 33/33 phone-engine slice verifies the exact WebLLM 0.2.82 manifest/lock/install pin, expected immutable Hugging Face redirect, bounded-stream pinned-artifact SHA-256 checks, broken-runtime cache recovery, cross-tab load/delete revocation, consent/cancellation bounds, and structured/search contracts. A real no-weight network smoke fetched and verified the pinned WASM/config/tokenizer bytes. `npm run check:browser` passes workflow, review, annotation, visual, 182-control, Mac-tutor, and phone-tutor UI audits. The live HTTPS endpoint verified the reviewed Qwen digest and completed a real local lesson response. A real tool call reached SearXNG and returned sanitized public evidence; the model correctly refused to answer when those snippets were irrelevant. Current Bing ranking was weak while Brave/DuckDuckGo were degraded, so current-information quality remains `Partial`, and physical-iPhone WebLLM/Safari evidence remains open |
| 2026-08-26 | Default local-AI reliability and multi-voice narration | Two independent real fresh-profile, 393×852 HTTPS browser runs against `qwen3.5:4b` use a focused under-350-word Explain contract, 2,985 source characters, and 1,200-token completion headroom; both local response calls returned 200 and rendered cited lesson answers. `npm run check` passes all 137 AI/data/unit tests and the production build/app audit. `npm run check:browser` passes workflow, multi-voice audio, review, annotations, visual/offline, 182-control, Mac-tutor, and phone-tutor audits; `audit:sync` additionally verifies simultaneous two-tab note creation, broadcast convergence, and durable reload. The audio audit covers four reported voices, language grouping/filtering, Hindi preview, local/network disclosure, persisted voice/language/rate/pitch/volume/scope, sentence/section/selection/document targets, compact controls, foreground-safe resume, empty-voice recovery, and mobile containment. Physical-iPhone voice inventory/routing/interruption evidence remains open |
| 2026-08-27 | Stale-build recovery and exact-origin AI/Whiteboard incident closure | The reported missing `Whiteboard-*.js` and `PhoneLocalAiTutor-*.css` paths were fingerprints from an old stopped `4187` deployment, not board-data or WebLLM failures. Build-specific service-worker identities, fail-closed shell installation, recoverable lazy imports, one bounded automatic reload, and an online-verified manual app-file repair now preserve IndexedDB, localStorage, and WebLLM caches. `npm run check` plus the focused network-guidance regression pass 146 AI/data/unit tests, scale/storage/backup gates, and the final production build. The complete browser suite passes workflow/Whiteboard, multi-voice audio, review, annotations, visual/offline, 182 controls, both AI UIs, and `audit:chunks`, which deliberately aborts each reported asset class and verifies recovery plus data preservation. Real 393×852 Qwen runs through both `http://127.0.0.1:4187/` and the exact iPhone-facing `https://192.168.1.13:4194/` returned 200 configuration/completion responses and rendered lesson answers. Physical-iPhone WebLLM execution remains an open device gate. |
| 2026-08-31 | Library-first, incrementally streamed AI workspace | Focused library-retrieval tests search all 143 built-in lectures and a worst-case 500-custom-document corpus while lazily loading only bounded candidates; they also cover authoritative edits, personal-note provenance, stable source anchors, UTF-8 byte budgets, confidence-based web-fallback recommendations, and cancellation. The Mac path now uses bounded `application/x-ndjson` streaming with protocol/sequence/terminal validation, upstream cancellation, backpressure, idle/overall deadlines, a live mobile response card, sanitized GFM + KaTeX, Fast/Balanced/Deep 900/1,800/3,200-token profiles under a 4,096-token server ceiling, disclosure-safe Approach metadata, and deterministic visible conversation compaction. SearXNG results are canonicalized, deduplicated, sanitized, and ranked with transparent query/domain/recency signals before the bounded evidence set reaches Qwen. A real `qwen3.5:4b` Markdown smoke on the reviewed Mac completed in 8.338 seconds and delivered 52 text-delta events before the terminal response. This demonstrates protocol delta delivery on that run; it does not establish provider-token visibility for later validation-buffered grounded requests, whose current behavior is recorded in the 2026-09-01 row. `audit:ai`, `audit:ai-ui`, and `audit:phone-ai-ui` contain the focused contracts; claim-level grounding/answer quality, degraded public engines, and trusted-HTTPS physical-iPhone model execution remain `Partial`. |
| 2026-08-31 | Local-AI request, authorization, and diagram reliability repair | Every Mac request branch now fits and submits the same canonical JSON body—including normalized format and conversation-summary fields—against the advertised profile-specific UTF-8 limit; the server accepts a canonical boundary-sized body. The Mac disclosure is a locally remembered acknowledgement, while web egress remains a separate one-request authorization with visible `armed`, `not needed`, `searching`, `used`, and `failed` states. If Qwen skips the only authorized tool, the server uses a bounded deterministic query derived from the approved learner question instead of silently omitting the search. On-device Lite likewise cannot let an `answer`/malformed planner result veto an independently gated fallback: it shows a bounded deterministic exact-query card and still sends nothing until the learner approves it. The Mac repair's 71 focused pipeline/storage tests and production build pass; the phone engine's 37 focused tests, phone browser audit, and production build pass. A shared lazy Mermaid renderer is implemented for Reader, Teaching Mode, Mac tutor, and phone tutor with original-source-preserving theme rerenders and actionable safe diagnostics; its unit suite passes 5/5 and the production build passes. The focused Mermaid browser audit passes: the runtime loads exactly once and only after a completed response, five valid diagrams render, one invalid definition produces a safe diagnostic, and all five valid diagrams rerender from their preserved definitions after a theme change. Claim-level answer/search quality and trusted-HTTPS physical-iPhone inference/search remain `Partial`. |
| 2026-09-01 | Local-AI limit, grounding, fallback, and terminal repair | The two reported incidents were reproduced: Balanced Qwen exhausted 1,800 tokens on an over-broad answer, while structured output requested 4,096 tokens after fitting input against the smaller 1,800-token profile reserve. Profiles now own both input and output ceilings; completion prompts reserve a closing margin and one buffered grounded length-stop receives a stricter one-time regeneration. Every initial and post-search synthesis body is byte-fitted, web evidence is compacted/relabelled to exactly what reached Qwen, all S/W labels must resolve outside code, source-label injection is neutralized, and terminal signals fail closed. An empty model-planned search can spend one remaining disclosed round on the bounded learner-question query; generic pages that match only one token of a feature-specific query are rejected, and one buffered structured draft may be regenerated with explicit in-schema citation placement. Phone preflight now reserves real library and web evidence before any query egress, retries use visible settings, and post-terminal stream data is rejected. `audit:ai` passes 228/228; Mac and phone AI browser audits, Mermaid audit, and production build pass. A real fresh-profile 393×852 HTTPS Library-first Qwen run showed the live card in 32 ms and completed a cited Markdown/KaTeX answer in 20.069 s with 280 validated deltas. A relevance-filtered live current-web prose answer completed in 12.172 s with one retained source and `[W1]`; a structured flashcard over the formerly mismatched profile path completed in 12.036 s with the same supported evidence and valid in-schema citation. Grounded prose is deliberately released only after terminal citation validation; source-free prose remains token-live. Physical-iPhone WebLLM/Safari execution and claim-level retrieval quality remain `Partial`. |
| 2026-09-01 | Current-workspace aggregate release gate and loopback contract recovery | `npm run check:release` passed end to end: 144 curriculum Markdown files/32,755 lines/23 Parts, unit checks, 3 scale tests, storage recovery, 16,778,784-byte backup with 94 MB RSS growth, 228/228 AI/data tests, production build/app audit, and the workflow, multi-voice audio, review, annotation, visual/offline, 182-control, Mac AI, phone AI, Mermaid, and stale-chunk browser audits. During the handoff audit an old process on `127.0.0.1:4187` still rejected the new `contextCitations` request field while reporting Ready. It was stopped and restarted from current source; a canonical real-Qwen request including `contextCitations: []` then completed with `READY`. HTTPS `4194` already accepted the same contract. This closes the immediate process skew but does not close the missing client/server contract-version handshake, immutable source revision, physical-iPhone, or quality-evaluation gates. |
| 2026-09-01 | Client/server request-contract identity handshake (BUG-004) | `src/lib/aiContract.js` now defines the single request-contract identity (introduced as `lumen.ai.request.v1`, advanced to v2 by the same-day mode addition below) imported by both the server and the built UI. `/api/health` and `/api/ai/config` publish it as `requestContract`; `validateAiRequest` requires it as the `contract` request field and a mismatch returns typed HTTP 409 `AI_CONTRACT_MISMATCH` with reload/restart guidance before any field-level validation detail. The browser client refuses to cache or report Ready for a configuration whose advertised contract differs from its compiled value, rejects contract-less payloads before transport so the measured canonical bytes cannot skew, and the tutor surfaces the mismatch with recovery guidance. `audit:ai` passes 232/232 including new contract tests; `audit:ai-ui` passes with a new version-skew scenario asserting fail-closed guidance and zero respond calls; the production build passes. The real-host atomic deployment/update drill remains open. |
| 2026-09-01 | AI capability gating, code review, answer-to-note, exact citations, and AI preferences (AI-001/AI-002/AI-004) | The request contract advanced to `lumen.ai.request.v2`. The Deep profile is now capability-gated: the server rejects Deep with typed `AI_PROFILE_UNSUPPORTED` unless the installed model attests Ollama thinking support, and the UI disables the option with the reason and falls back to Balanced. A code-review mode ships end to end (task allowlist, senior-review server instruction, composer template). Completed prose answers can be saved to the Notebook as labeled AI-origin clippings with materialized `[W#]` links, a plain-text `[S#]` source footer, and a bounded 4,000-character body; the Notebook labels them as AI drafts. Structured quiz/flashcard/study-plan string fields render navigable `[S#]`/`[W#]` citations on both Mac and phone (including options, hints, and milestone titles), and a personal-note citation now opens the Reader's Notes drawer and focuses the exact note editor. A saved no-AI preference hides AI surfaces without touching study data, and Mac tutor history retention is configurable (50/25/10/session-only) with immediate tombstoned trims. Evidence: `audit:ai` 234/234; `audit:ai-ui` adds thinking-gate, save-to-note, and personal-note deep-link scenarios; `audit:phone-ai-ui` adds structured-citation navigation; workflow/annotation/control audits and the production build pass. |
| 2026-09-01 | Versioned deterministic AI evaluation tier and learner pairing (P0-4 partial, P0-5, AI-002, AI-003 partial) | `eval/fixtures/v1/retrieval.json` + `scripts/ai_eval.mjs` now run the real Library-first retrieval over the real generated corpus in plain Node: 27 versioned cases covering document hit@1/hit@3 across curriculum Parts, exact personal-note and saved-edit provenance, web-fallback decision codes, byte budgets, retrieval laziness, replay determinism, and adversarial injection-shaped queries, with suite thresholds hit@1 ≥ 0.8 (measured 0.913) and hit@3 ≥ 0.95, fallback-code accuracy and determinism gated at 1.0 (all four measured at or above threshold). The suite gates `npm run check` as `audit:ai-eval`; the live-Qwen tier remains the operator-run `scripts/live_ai_smoke.mjs` and the phone model remains a device gate (eval/README.md). Learner pairing shipped: `AI_AUTH=pairing` + `AI_PAIRING_CODE` guard `/api/ai/respond`, `/api/ai/respond/stream`, and `/api/local-search` behind a stateless HMAC session in an HttpOnly SameSite=Strict cookie minted by `POST /api/auth/pair` (constant-time compare, five attempts per client per five minutes, TTL `AI_SESSION_TTL_HOURS`, revocation via code/secret rotation or restart); non-loopback AI/search startup fails closed without pairing or `AI_ALLOW_UNAUTHENTICATED_LAN=true`; config reports `auth.sessionActive`; the tutor shows a pairing gate, and the On-device tutor gains a save-to-notes action completing answer-to-note on both engines. Evidence: `audit:ai` 237/237 including pairing/session/rate-limit/startup suites; `audit:ai-eval` passes; `audit:ai-ui` adds the pairing scenario; `audit:phone-ai-ui` adds phone save-to-note; production build passes. |
| 2026-09-01 | Search worker, annotation relocation/repair evidence, whiteboard line matrix, and dialog focus contract (PERF-001, LEARN-001, BUG-002, BUG-003) | Ordinary library full-text parsing/ranking moved into a dedicated Web Worker (`src/workers/librarySearch.worker.js` + `src/lib/librarySearchClient.js`): one-time pre-normalized corpus transfer, incremental custom-document updates, latest-wins request correlation with typed errors and a main-thread fallback, plus a 643-document worst-case scale gate in `audit:scale` and a worker-client unit suite. `audit:annotations` now covers relocation after real source edits (asserting the documented display-only no-writeback), orphan detection with selection-gated Relink, id- and review-link-preserving repair, backup export/two-phase restore of annotations and linked cards, the non-CSS-Highlight fallback, and new Notebook highlight copy/Markdown-export actions. `audit:workflow` gains the complete straight-line matrix (mouse and pen-pressure creation proven by stored width, tap rejection with visible feedback, redraw/page-switch/reload persistence, undo/redo transitions, move/recolor/resize, PNG export verified by magic bytes). `audit:controls` gains a five-dialog focus contract (inert background, Tab trap/wrap, Shift+Tab wrap, Escape, exact opener restore) that surfaced and fixed a real defect: three dialogs plus the nested install sheet restored focus while the opener was still inert, a silent no-op; the repair defers restoration one frame past inert cleanup. The server app-shell test became hermetic (fixture dist) so CI passes on fresh clones. |
| 2026-09-01 | Advanced lexical search and mistake notebook (SEARCH-001, LEARN-005, LEARN-002 partials) | Library search gains one-edit typo tolerance for long terms (exact always outranks fuzzy), `-term` exclusions that ignore quoted phrases, profile-synced saved searches with star/chip management plus device-local recents, and `<mark>`-highlighted snippets; word sets are precomputed in the search worker, and unit (`audit:unit`), worst-case scale (`audit:scale`), and browser (`audit:workflow`) coverage all pass. The mistake notebook ships: an “Again” grade auto-logs a mistake linked to the card/document with a derived category; repeats merge and reopen corrected entries; the Review Center edits blur-committed corrections, filters by category/corrected state, and schedules corrective review (linked card due now, or a new tagged card — delivering LEARN-002's mistake source); records are bounded at 2,000, merge across tabs (`audit:sync` collection), and travel through backups. Building the audit surfaced and fixed a real dropped-keystroke defect: per-keystroke profile writes re-rendered the center and lost characters typed between commits; the correction field now keeps keystrokes local and commits on blur. `audit:ai` includes the new mistakes suite; `audit:review` covers the end-to-end notebook flow. |
| 2026-09-01 | Wave 6 learning loop: queue classes, analytics, manual mistakes, annotation write-back, mastery ladder, daily plan, cloze, interview rounds (LEARN-001/002/003/005, PLAN-001, INTERVIEW-002 partials) | A verification sweep of all 41 requirements ran first: five parallel audits confirmed 29 rows accurate and produced 18 findings — eleven tracker corrections, six evidence-gap tests (all added and green), one rendered-count fix, and the cloze opportunity delivered below. Review queue classes are now explicit and mutually exclusive (`classifyReviewItem`: new/overdue/learning/due/scheduled/suspended/archived; overdue ≥ 1 day past due, shown per-card and in the hero), analytics add a 12-week retention trend and mistake summary, and manual mistake capture ships behind a focus-trapped dialog. Relocated annotation anchors now write back once per saved edit with fresh prefix/suffix (merge-safe by newer `updatedAt`; ordinary renders never write), closing LEARN-001's self-heal gap with `audit:annotations` asserting the shifted stored offset. Home gains the evidence-based per-Part mastery ladder (not-seen→reading→read→practicing→mastered with reason and next action) and a deterministic 15/30/60-minute daily plan (due reviews first, then most-repeated open mistakes, then resume/start reading). Cloze cards conceal `{{span}}` markup until reveal. Timed interview rounds run a weak-first deterministic selection under 30s-prep/2min-answer countdowns; misses log Interview-category mistakes linked to their card; rounds never touch the scheduler. Building the gate surfaced and fixed a real mobile regression: the retention-trend card overflowed the analytics grid and zoomed the whole page out; it now spans a full row and the visual audit re-passes. Evidence: `npm run check` fully green (unit suite covers classification, trend buckets, Hard/Easy/first-Easy scheduling, cloze transforms, interview selection; `audit:scale` includes the overdue stats shape); `npm run check:browser` fully green including the extended `audit:review` (duplicate rejection, corrective scheduling, manual capture, full interview round with miss-to-notebook verification) and `audit:sync` mistake merging. |
| 2026-09-02 | Wave 7 content and data operations (CONTENT-001/002, DATA-002/003 partials) | One normalizer pass added four merge-safe profile collections — collections (100), 30-day trash (100, full content), activity (500, newest-first), revisions (5/document, 60 total) — wired through the three-way cross-tab merge as rolling histories and through backups, with sync-union/newer-edit-wins/deletion-stickiness and round-trip tests. Shipped on top: collection chips with counts and an Organize dialog (rename, tags, collection with inline creation, pin-first ordering, archive round-trip); duplicate-upload detection by whitespace/case-insensitive content identity; recoverable trash in the Notebook (restore mints a fresh id because the original stays tombstoned; delete-forever; purge on load); a Recent-activity panel on Home; revision capture on every overwrite save with an LCS line-diff History dialog and load-back-into-editor; a self-contained printable HTML export with provenance footer; the lumen.cards.v1 review-card interchange (validated import, duplicate skip, fresh scheduling, activity entry); and measured on-device AI model bytes (webllm caches) as a storage-breakdown row. Two real defects were found and fixed by building the evidence: dialogs reset their form state on record identity churn from the debounced profile commit (now keyed to the id), and deferred rAF initial focus fired late under frame throttling and stole keystrokes mid-typing (all dialog initial focus is now synchronous; the workflow audit passed three consecutive runs and the five-dialog focus contract re-passed). Evidence: `npm run check` fully green including new contentOps/diff/interchange suites; `npm run check:browser` fully green with the workflow audit extended to organize/trash/dedup/activity/revisions/HTML-export flows. |
| 2026-09-02 | Wave 8 search language and knowledge map (SEARCH-001, GRAPH-001 partials) | The query language gains title:/part:/tag: field filters (quoted values, applied even with zero body terms, stripped before term tokenization), has:code / has:formula content filters, and deterministic plural folding at the exact-rank tier. Capability flags moved into the build-time content generator after browser evidence showed the shipped search index strips Markdown syntax — and a unit test caught mermaid-only documents counting as code via their closing fence (104→65 code documents after the fix; 70 formula documents detected via TeX and the curriculum's blockquote/sub math style). Library searches show per-Part facet chips with counts that jump to the Part filter; Notebook search covers the mistake log with a review-center link. Home gains the GRAPH-001 curriculum map: 23 Parts on a deterministic serpentine grid (unit-tested layout lib) with prerequisite edges and mastery-state coloring, tap-to-open per Part. Evidence: `npm run check` green (field-filter/folding/capability unit fixtures; scale suite); `npm run check:browser` green with `audit:workflow` extended to title: filtering, plural folding, facet-chip navigation, and a measured has:formula narrowing assertion. |
| 2026-09-02 | Wave 9 narration depth, teaching export, and accessibility (AUDIO-001, TEACH-001, A11Y-001 partials) | Full-lecture narration is now section-aware (H1–H3 boundaries from the rendered article) with next/previous-section transport; a 10/20/30-minute sleep timer ends narration at a sentence boundary; the document scope resumes from a device-local persisted position (cleared on completion); a Settings glossary applies whole-word case-insensitive pronunciation overrides before chunking (bounded 50, profile-synced, normalized in db.js); and the spoken block is tinted and kept centered while speaking, respecting reduced motion and degrading gracefully when overrides rewrite the sentence. Teaching Mode exports every section through a print-only document to browser print-to-PDF. Accessibility: a fourth high-contrast theme (pure white/near-black tokens, hard borders), keyboard whiteboard nudging through the normal history path, a reduced-motion helper now covering all nine explicit JS smooth scrolls the CSS override cannot reach, and a focus-trapped “?” shortcuts sheet. Evidence: `npm run check` green (pronunciation matching/bounds units); `npm run check:browser` green with `audit:audio` extended to section skip, persisted resume (exact index round-trip), sleep-timer arming, and the spoken-block highlight; controls/review/workflow audits re-passed. |
| 2026-09-02 | Wave 10 board depth and final polish (BOARD-001/003, AI-002/PERF-002, CONTENT/LEARN slices) | The whiteboard gains marquee/Shift multi-select with group move, arrow-key nudging, copy/paste, single-selection geometry resize, 1×–4× zoom/pan (pinch, ctrl-wheel, toolbar steps), and a unit-tested scalable SVG export — every input path maps through the inverse view and every draw path through the forward view, so the identity view keeps the existing line-matrix audits byte-identical, and the workflow audit additionally drives marquee selection, a measured 1% group nudge, copy/paste/delete, SVG download validation, and a 125%-and-back zoom step. The Mac tutor shows session statistics (answers, median latency, output tokens) and exports conversations to Markdown; the mistake notebook exports to Markdown (download verified with category and occurrence detail); Home opens with a Today row (due cards, open mistakes, continue reading); the PWA manifest gains Review/AI/Library shortcuts; the Reader shows estimated minutes remaining; and a lecture selection quick-inserts into the tutor prompt (browser-driven end to end). Two latent defects were fixed: a missing icon import that only conditional rendering had hidden, and a search-count race against the worker's capped results. One transient Puppeteer ProtocolError interrupted a full browser-gate run; the suite passed clean end to end on rerun. `npm run check` and `npm run check:browser` are fully green. |
| 2026-09-02 | Operational sweep, live-model re-verification, and measured latency SLOs (issues #7/#8/#15 slices) | The stale pre-handshake server on :4193 (9d20h uptime, predating the contract handshake) was identified and killed; `.env` was confirmed to hold no AI auth keys (fail-closed on next LAN start; operator adds pairing or the waiver) and the CA key remains a physical-custody operator action (gitignored, never committed). Ollama 0.33.0 with the reviewed `qwen3.5:4b` was started and the current build served over trusted HTTPS on loopback :4202 (contract `lumen.ai.request.v2`); `scripts/live_ai_smoke.mjs` passed — live card 152 ms, validated cited Markdown+display-math answer 20.9 s, 301 deltas, zero runtime errors. A new operator-run benchmark (`scripts/ai_slo_bench.mjs`, PERF-002) measures both streaming variants against the real server: grounded (citation-validation buffering makes first delta ≈ total by design) p50 6.1 s / p95 6.4 s to validated answer; source-free token-live first delta p50 87 ms, total p50 8.2 s; ~32 tokens/s; 0% failures over 8 runs. Building it also confirmed a guardrail live: curriculum-flavored source-free prompts tempt the model into inventing [S#] labels, which the server correctly rejects as `AI_CURRICULUM_UNGROUNDED` — the benchmark's source-free fixture is deliberately citation-neutral. |
| 2026-09-02 | Password-protected encrypted backups (issue #18, DATA-001) | Shipped per the mandated design doc (docs/ENCRYPTED_BACKUP_DESIGN.md): encryption is a pure transport wrapper — the plaintext is the exact canonical JSON `createBackup` produces and decryption feeds the unchanged two-phase preflight, so the plain v4 format stays byte-identical by construction (backup.js untouched). The binary `lumen.backup.enc.v1` container (magic ‖ header length ‖ canonical header ‖ AES-256-GCM ciphertext) was chosen over JSON+base64 to avoid ~33% inflation against the 25 MB cap and mobile-Safari string amplification; measured overhead on the maximum 16.78 MB workspace is +284 bytes, 65 MB RSS, ~0.2 s for both PBKDF2-HMAC-SHA256 600,000-iteration derivations (OWASP current guidance) inside the extended `audit:backup-memory` gate. The exact file prefix bytes are the GCM AAD, so header tamper fails authentication (unit-tested by editing iteration digits in place); attacker-controlled header bounds (iteration floor/ceiling, header length, file size) reject before any key derivation; passwords NFC-normalize; wrong password and corruption surface as one honest typed WRONG_PASSWORD; insecure contexts disable the feature with no weak fallback. Import sniffs the 8-byte magic and routes to a retry-friendly password dialog; the restore confirm states the recovery snapshot stays unencrypted so a restore survives a forgotten password. Evidence: 7-test crypto suite including pinned format-stability vectors (fixed salt/IV → pinned prefix+ciphertext hex), backup.test.mjs unchanged as the plain-path regression, `npm run check` and controls/workflow audits green. |
| 2026-09-02 | Opt-in FSRS-4.5 adaptive scheduler with faithful migration (issue #16, LEARN-003) | `src/lib/fsrs.js` implements FSRS-4.5 from the algorithm wiki (canonical 17 default weights cross-checked against fsrs-rs v0.6.4; DECAY −0.5, FACTOR 19/81) and is pinned engine-exact against ground-truth vectors generated with ts-fsrs@3.5.7 — reproducing the six-step Good/Good/Again/Good/Hard/Easy trajectory to 8 decimals required matching the engine's per-step rounding of stored stability, difficulty, AND retrievability. Version discipline is documented and tested: D0/mean-reversion/decay changed in FSRS-5+, and the absence of the post-lapse stability cap is structurally proven. The scheduler is opt-in (`reviewSettings.scheduler`, Classic SM-2 default) with an 80–95% target-retention control; FSRS mode keeps writing the legacy interval/ease/repetitions fields so stats, mastery, weak-first ordering, and labels stay correct and switching back is graceful. Enabling it runs a one-time migration: faithful replay of each card's complete attempt trail through the engine where the trail covers every recorded review, otherwise a labeled SM-2 heuristic (S = interval because I(0.9, S) = S; ease 2.5 → D0(Good), 1.3 → 10); new cards stay untouched. FSRS state rides undo snapshots, both sync snapshot paths, cross-tab replay (which now reconciles under the MERGED profile's scheduler, closing a divergence risk), normalization whitelists, and backups. Evidence: 4-suite fsrs.test.mjs (trajectory, formula identities, migration tiers, grade/undo/preview integration); `npm run check` green; `audit:review` drives the toggle end to end and verifies seeded stability in the stored profile; `audit:sync` and controls green. |
| 2026-09-02 | Readiness assessments, study goals, honest pacing, and the opt-in badge (issue #9; ASSESS-001/002, PLAN-001/002) | `src/lib/assessment.js` synthesizes a bounded per-Part diagnostic from the learner's own review cards: weakest-first selection, schema-versioned choice/cloze/self questions with deterministic distractors and option order (hashed on the stable card id — a determinism test caught the generated-id hash breaking reproducibility), cloze per-blank partial credit, an explicit 0/0.5/1 self-grade rubric, and every question embedded frozen in the attempt record so later card edits never invalidate history. Recommendations are advisory only — skip requires ≥80% AND a fully read Part and the copy keeps prerequisites visible; every sub-full-credit answer merges into the mistake notebook through the existing card-linked fingerprint. Home gains a study-goal editor (target Parts + date, merged/synced/backed up via one normalizer pass with the assessments collection) with an honest pace line (on-track/tight/behind/past-due; behind is worded as a scheduling fact, not a failing) and goal-biased reading selection in the daily session. PLAN-002 ships as the deliberately minimal ethical slice: an opt-in, silent, feature-detected app-icon badge of today's actionable due count that clears predictably; notification reminders stay unshipped pending ethical review. Evidence: 5-suite assessment/pacing tests (determinism, rubric bounds, frozen-record normalization, advisory invariants, actionable-only badge count); `npm run check` green; `audit:workflow` drives a full readiness check end to end (rubric grading, 33% score, frozen questions, notebook capture, mastery-row score surfacing); visual/controls/sync audits green. |
| 2026-09-02 | Authored interview tracks and worksheet labs (issue #10; INTERVIEW-001, LAB-001/002) | Two versioned content banks ship as lazily-imported JSON modules (they never weigh on the startup entry, which the app audit re-verified): `lumen.interview.tracks.v1` registers all eight PRD tracks — six seeded (MLE, Applied AI, ML Platform, Data Science, LLM/Inference, AI-SDE) with 54+ questions carrying round type (all six INTERVIEW-002 round types covered), concepts, seniority, expected minutes, and 3–6 rubric bullets drawn from the eight scoring dimensions; every question anchors to a real lecture id (validated against the generated content index in the unit gate) and Research-engineering/Vision are honestly registered as unseeded. Deterministic track rounds (missed-first via interview-track mistake fingerprints, seniority ascent, bounded 6) feed the existing timed InterviewRound with per-question answer seconds (expectedMinutes×60, clamped 60–300) and rubric+follow-up reveal; misses categorize as system-design/code/interview by round type. `lumen.labs.v1` ships four worksheet labs (Python gradient descent with verified w₁=1.5/w₂=2.25 arithmetic, SQL aggregation with hand-computed outputs, a planted-bug debugging lab, and a precision/recall/F1 metrics lab) — inline datasets, deterministic self-check literals, tolerant matching (case/whitespace/trailing-zero/quote forgiveness), reveal with worked solutions, and every miss drafted into the mistake notebook under the code category. Deliberately NO code-execution runtime: an isolated WASM runner behind the WebLLM-style consented-download pattern is the documented follow-up. Evidence: 4-suite bank-integrity/behavior tests (anchors resolve, rubric/answer quality floors, deterministic missed-first rounds, self-check literals pass their own checks); `npm run check` green; `audit:review` drives an authored track round (rubric reveal asserted) and a lab miss into the notebook; controls/visual green. |
| 2026-09-02 | Whiteboard lock, z-order, snap, and JSON interchange (issue #11; BOARD-001/003) | The load-bearing piece shipped first: the board's three-way id merge was order-blind (always re-emitting base order), so any z-order change would have snapped back ~350 ms later when the debounced save re-merged — `mergeOrderedIds` now projects each side onto the common-id set, keeps an uncontested reorder, resolves contested reorders deterministically with a recorded `concurrent-order-change` conflict, and provably never mistakes a deletion for a reorder (three new sync tests, including tab-order commutativity). On top: per-object lock (selectable but refusing every mutation, marquee-excluded, duplicates arrive unlocked), bring-forward/send-backward preserving relative order within a selection, off-by-default snap-to-grid quantizing shape endpoints, text/sticky placement, move deltas (anchored on the grabbed object's corner), and resize corners to the rendered 24 px grid in world coordinates — zoom-independent, with freehand strokes and accessibility nudges deliberately never snapped — and the `lumen.board.v1` interchange (authoring content only, hardened-normalizer validation, id regeneration, capped undoable append). Rotation is deferred with an explicit coherent-slice note in the handoff (half-shipping it breaks hit-testing at the visible position). Evidence: `npm run check` green with new boardSync order tests and a 3-suite interchange suite (hostile input passes through the normalizer clamps); `audit:workflow` drives lock refusal, persisted z-order round-trip, measured on-grid snapping (fresh-rect assertion), and an export→import→undo interchange cycle; sync/controls/visual green. |
| 2026-09-02 | Broken-link audit, batch actions, and HTML import (issue #12; CONTENT-001/002) | Three wins with no new profile fields (so the normalizer/sync/backup chain is untouched). (1) The broken-internal-link audit scans custom documents and edited built-in copies on demand from the Notebook, reusing the extracted `resolveDocumentLink` and the reader's heading-slug rules — a link reported broken is exactly a link that fails when clicked; findings list document, href, and kind (missing document/anchor, not-a-document). (2) Batch actions: a select mode with per-row checkboxes and a toolbar for assign-collection (inline options from real collections), context-aware archive/unarchive, and trash — one pure reducer pass, one activity entry, full tombstone/cleanup parity with single deletion. (3) A dependency-free HTML→Markdown importer (hand-rolled tokenizer because the unit gates run in plain Node): allowlist conversion with nested lists, GFM tables (colspan bails honestly to text), per-block code-fence languages, entity decoding, dangerous subtrees dropped whole, javascript:/data: links unwrapped to text, data: images reduced to alt text, relative internal links preserved (a browser-audit failure caught the first version dropping them), and <title>→h1→filename title precedence — wired into uploads before dedupe so every downstream feature sees clean Markdown. PDF/EPUB deferral rationale recorded in docs/IMPORT_DEFERRAL.md. Evidence: 5-suite lib tests; `npm run check` green; `audit:workflow` drives an HTML upload with script-stripping verification, a detected broken link, and the full batch archive/assign/unarchive cycle; sync/controls/visual green. |
| 2026-09-02 | Curated search synonyms and the semantic-search decision (issue #13; SEARCH-001/002) | A ~60-group curated ML/AI synonym table joins the query pipeline as pure query-side expansion: alternates match at a dedicated half-weight tier (exact > synonym > fuzzy ordering — the fuzzy bonus dropped to 0.5 so one synonym body hit strictly outranks it), directed one-way entries keep ambiguous acronyms (lr, cv, nn, gd) from cross-polluting senses, alternates of ≤3 characters require word boundaries (unit-proven: a quoted "reinforcement learning" query's "rl" alternate never fires inside "girl"), matched variants feed the existing highlight pipeline, and exclusions plus field-filter values are never expanded. Deterministic British-spelling (-ise↔-ize) and hyphen folds ride at the exact tier, corpus-informed (the lectures contain zero British spellings or squashed forms, so folds beat table entries). SEARCH-002 is deliberately a design decision, not code: measured sizing shows the index itself is trivial (~920 chunks, 0.34 MiB int8, sub-millisecond brute force) but the model+runtime is a 24–45 MB consented download 40–75× the startup budget — docs/SEMANTIC_SEARCH_DESIGN.md records the numbers, the four design gates (versioned index, disclosure, lexical evidence pairing, quality/privacy tests), and the M5 sequencing rationale. Evidence: synonym/spelling/boundary/ordering unit fixtures in `audit:unit`; scale and workflow audits green. |
| 2026-09-02 | Audio bookmarks (issue #17, AUDIO-001) | Device-local audio bookmarks complete the implementable narration slice: during full-lecture narration a bookmark button captures the current queue index and spoken snippet (one bookmark per sentence — re-bookmarking refreshes; bounded at 100; corrupt storage degrades to empty), the narration panel lists the current document's bookmarks with play-from (seeding the section-aware queue's startIndex) and delete, and positions stay per-device by design, like narration resume. Evidence: bounded/dedupe/hostile-storage unit suite; `audit:audio` drives save → jump-to-exact-index → delete end to end; `npm run check`, controls, and visual audits green. Remaining in AUDIO-001: playlists and the physical-iPhone voice/routing/interruption evidence. |
| 2026-09-02 | Campaign closeout: FSRS cross-tab replay defect fixed, full gate re-verified on the merged whole | Writing the researcher-specified but previously unclaimed evidence — a cross-tab test asserting attempt replay under the merged FSRS scheduler is deterministic, convergent (A+B = B+A), and idempotent — caught a real shipped defect from PR #26: the scheduler threading into `reconcileReviewAttemptDeltas` had been applied to the caller but not the function, so sync reconciliation silently replayed every delta attempt under SM-2, wiping FSRS stability/difficulty/state on the receiving tab (a probed merge showed stability 3.7145 → 0). Both threading points are now in place and the 23-test sync suite passes with exact-state convergence. A repo-wide NUL-byte sweep is clean (the htmlImport incident was the second occurrence of that corruption class). The SYNC-001 matrix row now references its accepted design doc, and the handoff P2 roadmap is reconciled with the campaign (FSRS strikes the calibrated-scheduler line; assessments, tracks, labs, encrypted backups, and the sync design all recorded). Evidence: `npm run check` AND the complete `npm run check:browser` (all eleven audits, including annotations/ai-ui/phone-ai-ui/mermaid/chunks which had not run since the campaign started) pass end to end on the merged whole plus this fix. |
| 2026-09-02 | Operator-gate resolution and device-evidence tooling (issues #7/#8 slices) | The LAN auth gate is now CONFIGURED AND PROVEN, not just available: `AI_AUTH=pairing` with a CSPRNG-generated, iPhone-typeable grouped pairing code was written to the gitignored `.env` (the code lives only there), and a loopback boot verified the full contract — unauthenticated `/api/ai/respond` returns typed `AI_AUTH_REQUIRED`, the configured code pairs with HTTP 200 and a 30-day session, a wrong code returns typed `PAIRING_CODE_INVALID`. Enforcement is global (no loopback exemption), so dev serves and the automated live smoke now also hit the pairing gate while it is set — documented as intended posture. CA custody is staged to one command: `scripts/secure_ca_key.sh <usb-path>` verifies the leaf certificate has >90 days of validity (measured: valid to 2027-10-03, so the CA key is operationally unneeded until renewal), copies key+serial with byte-compare verification, removes the locals, and boot-checks the HTTPS serve (which was confirmed to read only the server-leaf files); the physical USB move remains the operator's. The PAT was inspected: a classic token with near-total account scope (admin:org, delete_repo, workflow, …) — rotation guidance is now surgical (fine-grained, single-repo, Contents/Issues/PRs). The hardware gates became guided capture: `#/device-evidence` (lazy route, Settings entry) probes every tracker-named capability (WebGPU adapter, service worker, persistent storage, WebLLM cache, full voice inventory with on-device/network split, badging, wake lock, WebCrypto) and carries the WebLLM/routing/interruption/VoiceOver/storage acceptance criteria as recordable pass/fail checks with notes, exporting a dated `lumen.device-evidence.v1` JSON. The page states explicitly that auto-checks alone are not a pass — evidence exists when a person completes the checklist on the phone; tracker rows stay Partial until that report lands. Evidence: `npm run check` green; `audit:workflow` drives the page end to end (probed capabilities, recorded verdict, exported report, unanswered checks proven to export empty rather than fabricated); controls/visual green. |
| 2026-09-02 | EPUB import and print/PDF export (issue #12, CONTENT-002) | The two remaining implementable import/export formats shipped dependency-free. EPUB: `src/lib/epubImport.js` parses the zip container directly (central directory authoritative for sizes, stored + deflate via the platform's `DecompressionStream("deflate-raw")`, zip64 and encrypted entries refused typed), resolves container.xml → OPF → manifest/spine, and fans each spine chapter through the existing `htmlToMarkdown` into one document per chapter in reading order — with an honest lossy report (covers, non-text spine items, unresolved refs, oversized chapters, 40-chapter truncation) surfaced in the upload notification. DRM'd books are refused whole (encryption.xml naming (x)html resources), while font-only obfuscation passes since fonts are dropped anyway. Uploads now also enforce the 16 MB backup envelope on POST-conversion bytes (EPUB/HTML text can outgrow the compressed file the picker admitted). PDF export: a `Print / Save PDF` reader action plus an `@media print` stylesheet that strips chrome/drawers/overlays, unrolls the scroll container, and prints black-on-white — the browser's print dialog is the PDF engine, zero dependencies. Evidence: 6-test unit suite (in-test zip writer; spine order, stored+deflated entries, chapter cap, DRM vs font obfuscation, typed corruption failures); `audit:workflow` uploads a real in-memory EPUB and verifies two chapter documents with the `epub` tag persist plus the toast report, and stubs `window.print` to prove the action fires; backup counts re-pinned through the added documents; full `npm run check` + all eleven browser audits green. |
| 2026-09-02 | Research Engineering and Computer Vision tracks seeded (issue #10, INTERVIEW-001 complete) | The last two registered-but-unseeded tracks now carry 10 authored questions each (bank total 76), agent-authored and machine-verified before merge: every question passed `normalizeTrackBank` unaltered with exactly 4 rubric bullets, 2–4 kebab-case concepts, and 1–2 follow-ups; prompts 30–70 words and model answers 140–240 words in the bank's interview voice; pure ASCII; ids unique across the whole bank; and every `documentId` verified to exist both on disk and in the generated content index. Research Engineering anchors to parts 13/15/16/17/18/22 (reproducibility, profiling, pretraining data, scaling laws, distributed-training debugging, contamination) and Computer Vision to parts 7/9/17 (conv arithmetic, ResNet, transfer learning, ViT, detection/NMS, segmentation, diffusion, CLIP). Both tracks satisfy the required per-track mixes (≥1 each of debugging/model-design/system-design; 1 junior / 4 mid / 4 senior / 1 staff) and their picker options enable automatically via the `seeded` flag. Evidence: updated bank-integrity suite pins 8 seeded tracks, ≥70 questions, per-track ≥8, all-round-type coverage, and preserves the unseeded-refusal path via a synthetic bank; `npm run check` green; `audit:review` re-drives an authored track round on the grown bank. |
| 2026-09-02 | Cross-device sync v1 shipped (issue #14, SYNC-001) | The accepted design is now running code, implemented exactly along its own lines. Container: `lumen.backup.enc.v2` adds `vaultId` + `deviceId` inside the AAD-authenticated header — re-attributing a sync file to another device flips the GCM tag (proven by an in-place header-edit test), v1 files stay readable, v1 headers still reject sync fields, and unknown v2 fields refuse (future fields force a version bump). `src/lib/syncVault.js` owns durable device identity (`lumen-device-id-v1`, validated, corruption-safe), vault membership, and the deviceId-sorted peer fold: peers are always the `remote` merge argument, deletions travel by tombstone, a peer reset/restore fences the fold AND resets the baseline mid-fold so later stale peers cannot resurrect pre-replacement records, and peer-only boards adopt whole rather than merging against a fabricated empty page. The vault baseline (last agreed merge result) lives in its own IndexedDB database — `getAllData` cannot enumerate it and backups cannot embed it. Settings grew a sync card: create vault / join via a peer's file (with explicit confirm), export `<deviceId>.lumenc` (600k-iteration PBKDF2, snapshot-merge discipline identical to backup export), import peer files (per-file typed admission: NOT_SYNC_FILE / VAULT_MISMATCH / OWN_FILE skip with reasons in the toast), leave vault. Passphrase is never stored. Evidence: 8-test syncVault suite (order-independent convergence via canonical stringify, tombstone travel, replacement fencing with stale-peer resurrection attempt, board adoption, IDB-free degradation) + 3 new container tests (v2 round-trip, tamper-evidence, version gating); `audit:workflow` drives the whole loop in the real UI — vault creation, v2 export named after the device, Node-side decrypt/verify of the header, a peer file built and folded in (document arrives), and idempotent re-import (no duplicates, count pinned); full `npm run check` (315 passing) + all eleven browser audits green. Remaining: folder-watching and relay transport (tracked in the design doc). |
| 2026-09-02 | Narration playlists (issue #17, AUDIO-001) | Opt-in continuous listening: a new `onQueueComplete` hook in `useSpeech` fires only on natural queue completion (never from stop() or the sleep timer), and when the narration panel's "Continue into the next chapter" toggle (persisted as `settings.narrationAutoAdvance`, default off) is on and a full lecture ends, the app opens the next chapter of the same Part and starts its full-lecture narration from the top; at a Part boundary it stops with an honest end-of-Part notice instead of rolling into unrelated material. The auto-started narration is a normal user-initiated session — pagehide cancel and explicit-tap resume (the iOS foreground-safety contract) apply unchanged, which `audit:audio`'s existing foreground-safety block still proves. Evidence: `audit:audio` arms the toggle, drives every utterance of a full lecture to natural completion, and asserts navigation to chapter 02, a fresh full-lecture queue speaking, and clean stop; full `npm run check` + all eleven browser audits green. |
| 2026-09-02 | Per-learner FSRS calibration (issue #16, LEARN-003) | The scheduler now fits itself to the learner: `optimizeFsrsWeights` replays the entire review history under candidate weights (the smooth, unrounded mirror of `fsrsGrade` — every spaced review is a labeled prediction of retrievability vs actual recall) and minimizes mean binary log-loss with a deterministic sign-based descent — per-weight steps that grow 1.2× while the numeric-gradient sign holds and halve on a flip, an L2 pull toward the published FSRS-4.5 defaults so low-data runs cannot wander, per-weight clamps mirroring the official optimizer's bounds, and zero randomness (same history → same weights, asserted). It refuses typed below 50 spaced reviews (NOT_ENOUGH_REVIEWS) or 5 lapses (NOT_ENOUGH_LAPSES — all-recall data cannot locate the forgetting curve), and returns DEFAULTS_ALREADY_FIT rather than shipping a non-improvement. Accepted weights persist as `reviewSettings.fsrsWeights` (normalized in db.js: exactly 17 finite numbers or empty-=-defaults) and thread everywhere scheduling happens: `gradeReviewItem` → `fsrsGrade`, `previewReviewIntervals` (grade-button interval labels), and — critically — the cross-tab/cross-device attempt replay in `profileSync` (`scheduling.weights`), so two synced devices rebuild identical card state under the calibrated scheduler. UI: a Calibrate-from-my-history button in the review settings strip (FSRS mode), a Calibrated badge with one-tap Reset to defaults, and a success toast reporting reviews used, lapses, and prediction-error improvement. Evidence: 6-test suite — a synthetic fast-forgetting learner (deterministic LCG outcomes, no Math.random) where calibration beats the defaults' log-loss, determinism, bound enforcement, typed thin/degenerate refusals, elapsed-0 lapse finiteness, and custom weights changing real `fsrsGrade` scheduling; `audit:review` drives the honest thin-history refusal in the real UI; full `npm run check` + all eleven browser audits green. |
| 2026-09-02 | Device-testing paths documented and simulator run automated (issues #7/#17) | `docs/DEVICE_TESTING.md` lays out the three evidence paths in fidelity order — physical iPhone over LAN (CA trust install → #/device-evidence, ~15 min), physical iPhone over USB (Web Inspector + Remote Automation → safaridriver WebDriver target, plus Develop-menu inspection), and the iOS Simulator for the no-iPhone case. `scripts/simulator_evidence.sh` automates the simulator path end to end: guards on full Xcode being active (with the exact setup commands), builds and serves the production bundle over HTTPS, boots the newest iPhone simulator, trusts the local CA inside it via `simctl keychain add-root-cert`, opens the evidence page, and captures a dated screenshot. Both documents are explicit about simulator limits — WebGPU/WebLLM performance, audio routing, thermal, and quota pressure are NOT simulator-faithful and must be marked SKIPPED — so a simulator report can close the iOS-behavior rows without ever impersonating device-performance evidence. Verified: script syntax-checked; its no-Xcode guard exercised on this machine (correctly refuses with setup guidance since only CommandLineTools is present). |
| 2026-09-02 | Retention-vs-workload planner (issue #16 closeout, LEARN-003 complete) | The last LEARN-003 remainder: `retentionWorkloadCurve` computes the steady-state daily review load at each target-retention choice (a card with interval I contributes 1/I reviews per day; learning/relearning cards join through their current stability since their post-graduation interval is I(R,S); SM-2 cards are counted separately, never faked into the curve) plus the average interval per choice. The review settings area (FSRS mode) renders a Workload planner strip — one button per retention choice showing ~reviews/day, average interval on hover, tap-to-apply — so the retention dial finally shows its price before it is turned. Evidence: 3-test suite (exact 1/interval sum at 90%, monotonicity both directions, archived/suspended exclusion, SM-2 separation, empty-deck zeros); `audit:review` asserts four rendered choices, monotone workloads, and tap-to-apply updating the retention setting; full gates green. |
| 2026-09-02 | Assessment depth: numeric auto-grading, retry, source links, reminders design (issue #9) | Readiness checks grew the three highest-value remainders. Numeric response type: a card whose answer is a plain number or signed percent becomes a `numeric` question auto-graded through the labs' tolerant matcher (" 1.50 " matches "1.5"; wrong numbers still fail) instead of hiding behind self-grading or leaking as one obviously-numeric choice option; the type survives storage normalization. In-place retry: the result screen re-asks the SAME frozen questions as a fresh attempt with each finish recorded separately (repeat misses merge in the notebook by fingerprint). Missed-question source links: every sub-full-credit question on the result screen links straight back to its source lecture. And the PLAN-002 "reminders design" deferral is now an accepted design (docs/REMINDERS_DESIGN.md): opt-in per mechanism, silent-first ladder, one quiet daily foreground notification at most, no guilt mechanics, Web Push rejected permanently as anti-local-first, and honest iOS copy about foreground-only firing. Evidence: assessment suite grew a numeric build/grade/normalize test; `audit:workflow`'s readiness block rewritten to the richer flow — four questions (three choice + one numeric), a 50% first round with two misses and two source links asserted, retry to 100%, both attempts persisted with frozen questions and the numeric type recorded, mastery row showing the latest score; full gates green. |
| 2026-09-02 | SLO bench: pairing-aware and memory-measuring, fresh live numbers (issue #15) | Two bench gaps closed. First, with `AI_AUTH=pairing` now enforced globally, the bench authenticates like any client: it POSTs `AI_PAIRING_CODE` to `/api/auth/pair` and rides the session cookie — without this the bench had silently become unrunnable against the hardened server. Second, the memory SLO is now measured: the bench samples the Ollama processes' resident set (pgrep+ps, sudo-free) idle, per-run, and settled; energy/thermal need root `powermetrics` and stay operator-manual, stated in the output. Fresh live run (Mac, qwen3.5:4b, balanced profile, 5 runs/variant, 0% failures): memory idle 24 MB → peak 3,957 MB (the 3.4 GB model resident) → settled 3,868 MB; grounded cold 16.4 s, warm total p50 5.3 s / p95 5.9 s at 28.8 tok/s (first delta ≈ total by citation-buffering design); source-free first delta p50 112 ms / p95 114 ms, total p50 7.5 s at 30.8 tok/s. |
| 2026-09-02 | Whiteboard rotation (issue #11, BOARD-001) | The deferred coherent slice shipped whole. Every object carries an optional `rotation` (radians about its bounds center, applied in PIXEL space — the canvas aspect is non-uniform in normalized coordinates, so a normalized-space rotation would shear). Points stay stored unrotated; a handle floating above a single selection spins the object (15° quantization when grid-snap is armed); hit-testing inverse-rotates the pointer into the object's local frame so selection follows the rotated shape exactly; the resize corner works on rotated objects by mapping the drag through the original center; marquee containment uses the rotated screen-space AABB; the selection box and handles render rotated. Persistence is a SPARSE field (only written when non-zero) so legacy boards, their backups, and payload-equality checks stay byte-identical; the three-way board merge carries it as ordinary object data (test: an uncontested peer rotation wins; normalization clamps into [-π, π]); SVG export wraps rotated objects in a center-anchored `rotate()` transform mirroring the canvas math. A debugging find worth recording: selecting an object RESIZES the canvas (the toolbar grows a row), so the audit measures the canvas box after every selection change — coordinates computed against a stale box grab thin air. Evidence: 2 new unit tests (SVG transform anchoring, merge/clamp) plus the audited loop — draw, select, grab the handle, spin to ~90°, stored rotation pinned near π/2, click inside the rotated-only footprint reselects (rotated hit-testing), exported SVG carries `rotate(90.…)`, cleanup delete; two audit-flake hardenings landed alongside (ai-ui respond-call race poll, search-count settling under a still-filling index) after a run with 73 external Chromium processes exposed them; full `npm run check` + all eleven browser audits green. |
| 2026-09-02 | Remote AI verification of device evidence (issues #7/#17) | The evidence page's checklist is corrected into three honesty tiers so the operator's AI verifies everything machine-verifiable on the real phone with no cable, no WebDriver, and no admin password. AUTO probes now post themselves to a new same-origin `/api/evidence` intake the moment they exist (typed refusal for non-evidence payloads, gitignored `.local/evidence/`, newest 20 kept, honest failure toast when the endpoint is absent — e.g. on the audit's static serve). A new ASSISTED tier runs real device behavior on one tap and records its own verdict from observed events: the speech-liveness check speaks one sentence and records pass/fail from the synthesis events with the voice class used — no human judgment involved. The HUMAN tier shrinks to the true residue (VoiceOver behavior, audio routing, interruption recovery, WebLLM download/reload, restart survival), with the storage criterion reworded since the persistent-storage grant is machine-probed. Reports carry `verifiedBy` per entry ("automation" vs "human"), and a Send-to-Mac action ships the full report over the LAN. Also fixed this session: the AI serve was down (processes stopped after benching) AND the LAN IP had changed — the TLS leaf was re-issued to cover the new address and the origin allowlist updated; all three origins now return 200 with real certificate validation and a paired live answer streams. Evidence: `audit:workflow` drives the corrected page — assisted check self-records a pass naming the on-device voice, send degrades honestly off the LAN serve, human verdict + note recorded, downloaded report pins `verifiedBy` fields and empty-unanswered; endpoint verified live (accept + typed reject); full `npm run check` + all eleven browser audits green. |
| 2026-09-04 | AI resilience under small-model tool hallucination; frictionless pairing (live-failure driven) | Yesterday's real session logs showed two learner-facing failures. First, qwen3.5:4b fabricated a tool call during a tool-free generation turn, discarding a 30-second generation with a hard AI_TOOL_NOT_ALLOWED — the server now grants ONE bounded recovery turn (no-tools instruction appended to the system message, matching the completion/grounding recovery idiom) before failing typed, guarded to never fire after tokens have already streamed live (a stream cannot be un-said); proven by mocked-sequence tests (spurious call → recovery → clean answer; repeat offense → typed failure; existing budget/final-phase tests re-pinned with the extra recovery turn). Second, the pairing code was too hard to find and use, so auth grew two ergonomics layers with the strict contract preserved under test: `AI_AUTH_LOOPBACK=exempt` (new default; `require` restores the global gate, and the existing pairing tests now pin `require` explicitly) trusts the serving machine itself — whoever sits there can read `.env` — with `auth.sessionActive` reported true so the UI never prompts; and one-scan device pairing — `POST /api/auth/pair/ticket` (mintable only from loopback or an already-paired session, single-use, 5-minute TTL, 20 outstanding max) plus `#/pair?ticket=…` redemption in the app and `scripts/pair_device.sh` which mints, QR-renders, and opens Preview. Verified live on the running server: an unpaired loopback query streams a full answer; mint → redeem → 200 with an HttpOnly session; replaying the used ticket → 401 PAIRING_TICKET_INVALID. Evidence: 46 AI-path tests + 28 server tests green (4 new); full `npm run check` + all eleven browser audits green. |
| 2026-09-04 | Web-search relevance rescue and model warm-keeping (live-failure driven) | The learner's failed current-web query (72 s → WEB_SEARCH_NO_RESULTS, request 1f0d8469) was NOT a dead search backend — SearXNG answered 30 results — but the strict relevance gate: verbose model-written queries need 60% distinctive-token coverage per result, and exact-token matching is defeated by ordinary morphology (transformer/transformers, encoding/encodes), so every genuinely relevant page can be zeroed out. `rankPublicSearchResults` now runs ONE relaxed second pass when the strict pass returns empty against non-empty candidates: a third of the distinctive tokens minimum (never below one) with shared 5-character-stem matching — the downstream web-grounding validator still decides what may actually be cited, so precision guarantees stay. Latency: the biggest real cause of "not responding" was cold model loads (10–30 s of first-token dead air), so the server now warms the model at boot (single-token fire-and-forget request, `model_warmup` logged, failures never gate) and `OLLAMA_KEEP_ALIVE` (new config, default 30m, validated; .env set to 2h) rides every request so the model stays resident between study sessions. Thinking stays gated to the Deep profile — no quality knobs were touched. Evidence: 77 server-side tests green (new: strict-zero → relaxed rescue keeping the relevant page while still dropping the unrelated one; keep-alive riding buildOllamaRequest from config; warm-up posts one num_predict:1 request and degrades to false on failure); live end-to-end proof on the running server — boot log shows `model_warmup ok:true`, and the previously-failing query class ("current stable Python version") completed in 18 s with 5 ranked sources and honest [W#] citations; full `npm run check` + all eleven browser audits green. |
| 2026-09-24 | Reader phone tools, panels, and settings (issue #53; A11Y-001, AUDIO-001, TEACH-001, CONTENT-001 partials) | A reader audit on 320–430 px phones, a tablet, and 1024–1920 px desktops in Paper, Night, and Contrast reproduced unreachable tools and broken settings, fixed as one slice. Selecting text on a phone now raises Highlight/Clip/Ask AI/Listen above the bottom navigation at any scroll depth, and the tool row wraps instead of hiding Whiteboard and Actions. The closed phone side sheet is inert and hidden; open, it, the Actions menu, revision history, Teaching Mode, and the highlight editor share one modal contract (inert background with each region's prior state restored, focus in, Tab wrap over rendered controls, stacked Escape, focus return). A tutor citation's target now owns the first scroll instead of the saved reading position (TF-2). Mermaid diagrams keep 72% of natural size and scroll in their frame with an edge cue, and their accessible name lists nodes and edges from the preserved source; SVG sanitization and per-completion rendering are unchanged. Line length is a text measure (30/36/46 × text size) with an explanation where the window caps it; the outline starts hidden below 1240 px and Table of contents toggles it; minutes-left sits beside the progress chip; lecture text is rem-based and a text-size change keeps the current passage in place. Reset confirms in the app and banks unsaved typing as a revision; history markers match Load into editor. Narration puts Read under the target picker and takes focus; the mini player uses two rows on phones. Code, tables, and diagrams are focusable named scroll groups (shared with the tutor renderer); table cells keep whole words; TeX in edited copies and uploads lazily renders through sanitized KaTeX. Evidence: new unit tests for the diagram text alternative, TeX detection, and scroller markup; regression checks added to the workflow, annotation, audio, control, responsive, and AI UI audits (the citation check fails on the previous build with the cited heading 4,507 px below the viewport); `npm run check` and `npm run check:browser` green. Remaining: page title/landmarks and token contrast belong to the shared foundation (#51), the Ask AI composer focus to the tutor work, and 44 px toolbar targets and a typeface choice are deferred. |
| 2026-09-24 | Whiteboard touch placement, aspect-true page geometry, reachable phone toolbar, and themed chrome (issue #55) | A touch-emulated audit and an independent verifier confirmed the whiteboard defects tracked in issue #55. Text and sticky placement moved from `pointerdown` to the click that ends the tap, so a touch's compatibility click no longer lands on the new dialog's scrim and closes it (BOARD-1). Pages now carry a sparse authoring `size` (the CSS-pixel canvas they were drawn on) and render with one uniform scale, letterboxed as a sheet, so a phone-drawn circle stays a circle on a Mac and across rotation (BOARD-2). Fonts, stroke widths, the 24px snap grid, rotation, wrapped-text bounds (BOARD-8), and sticky cards all use those authoring pixels. Migration never rewrites points: a legacy page adopts the canvas it is first shown on in portrait or on a desktop, which is exactly how it already looked there. An empty page adopts on its first edit, and a phone in landscape never adopts a page that already has content, not even when it is edited there. The size merges like a page name (racing adoptions resolve without a conflict; changing an existing size records `concurrent-page-resize`), travels in `lumen.board.v1` (older files still import), and is the SVG viewBox, so SVG, PNG, and canvas match (BOARD-SVG). Moves, nudges, duplicates, and pastes translate the group by one delta, limited by its rotated footprint and its stored points, instead of clamping each point, so rotated objects never squash either (BOARD-5). Phones get one row of drawing tools with Shapes, Ink, and Page/View panels that fit above the bottom navigation, undo/redo always on screen, and one labelled Export menu; landscape puts the tool row above a canvas sized to the space over the navigation (BOARD-4/LAND/15). Board chrome follows Paper/Night/Contrast (BOARD-3/16). Tools, named colour swatches, and backgrounds expose `aria-pressed` (BOARD-12), every tool has a tooltip with its key (BOARD-TIPS), the phone hint wraps at a readable size with touch wording (BOARD-20), and the save status is a live region (BOARD-LM). Board keys ignore native controls, dialogs, and menus, and tool changes clear the selection (BOARD-6). Tab/Shift+Tab select and announce objects, and Enter, double-click, double-tap, or an Edit action reopen text and sticky notes (BOARD-13/EDIT). The eraser draws on an ink layer above a separate background canvas (BOARD-7). Wheel, Shift+wheel, Space+drag, and middle-drag pan a zoomed board (BOARD-11). Recolour and stroke size apply to the whole selection (BOARD-18), all four corners resize with touch-sized hit zones (BOARD-19), and sticky notes grow to fit their text and mark any overflow with an ellipsis (BOARD-STICKY). Evidence: new `boardGeometry` unit tests and sync/interchange/SVG migration and round-trip cases (26 board tests; the SVG eraser assertion changed from background-coloured strokes to masks because the eraser no longer erases the background); `audit:workflow` adds touch-tap placement at 20% height, in-place edit, keyboard selection, edge-nudge shape preservation, select- and modal-safe keys, a background pixel under an eraser stroke, the stored authoring size, a rotated rectangle nudged into the edge and back, and a legacy page that keeps its points and adopts no landscape canvas; `audit:responsive` now measures the canvas area visible above the fixed navigation with Undo on screen, which reproduces BOARD-LAND on the pre-fix build (568×13 px visible) and passes after. `npm run check` and all browser audits pass. The app-wide eyebrow contrast, the `<main>` landmark, the shared `.popover-heading` layout, and listing board keys in the `?` sheet stay with the shell and Reader work (#51/#53). |

## Comprehensive status and evidence audit — baseline 2026-08-24, rechecked 2026-09-01

No requirement is `Verified` as of the 2026-09-01 recheck. `Implemented` means the known source
work is complete but acceptance evidence is still missing; `Partial` means the source
itself still has open acceptance work. Content that merely discusses a capability is
not evidence that the product implements it.

| Milestone | ID | Audited status | Shipped evidence | Required before promotion |
|---|---|---|---|---|
| M0 | BUG-001 | `Implemented` | Menu semantics, close/scrim/Escape handling, inert background, scroll lock, focus management, and narrow-viewport workflow coverage | Record Mobile Safari real-device evidence (the focus-return, scroll-lock, route/sidebar-action-close, and repeated-toggle assertions are covered by `audit:workflow`) |
| M0 | BUG-002 | `Partial` | Two-point line objects with history/persistence/PNG, and the complete `audit:workflow` line matrix delivered 2026-09-01: mouse and pen-pressure creation (stored width proves the pen path), tap rejection with visible feedback, redraw/page-switch/reload persistence, undo/redo transitions, select/move/recolor/resize, duplicate/delete, PNG export verified by magic bytes | Imported-backup board restore drill and physical Apple Pencil evidence |
| M0 | BUG-003 | `Partial` | Visible-control accessible-name/touch-size checks (190 controls) plus the 2026-09-01 five-dialog focus contract in `audit:controls`: inert background, Tab trap/wrap, Shift+Tab wrap, Escape close, and exact opener focus-restore (which surfaced and fixed a real inert-restore defect) | Invoke every critical action with state/feedback/disabled-reason assertions across all surfaces |
| M0 | BUG-004 | `Implemented` | Build-specific service-worker/cache identity, fail-closed shell install, one bounded online reload, selective manual repair, and browser regression for stale Whiteboard JS and phone-AI CSS while local data survives | Perform an assets-first/index-and-worker-last deployment/update drill on the real host and Mobile Safari; retain an older shell through deployment and prove recovery without a reload loop or data/cache loss |
| M1 | DATA-001 | `Partially Implemented` | Profile/backup v4 normalization; SHA-256/FNV integrity; restore preflight and recovery snapshot; v1-v3 compatibility; failure-injected fallback journal, tombstones, retry, authoritative replacement; optional password-protected export (`lumen.backup.enc.v1` binary container: PBKDF2-SHA-256 600k, AES-256-GCM, raw-prefix AAD, typed WRONG_PASSWORD, no weak-crypto fallback, plain v4 byte-identical) | Independent stores and per-record schema versions; broader real-device migration fixtures; complete concurrent-tab conflict evidence; encrypting the mid-restore recovery snapshot |
| M1 | DATA-002 | `Partial` | Usage/quota/persistence and last-backup health; profile/board/offline-cache breakdown with measured on-device AI model bytes (webllm caches) as its own row; atomic 20 MiB/250-board backup-safe budget with typed failures; online-verified optional-cache cleanup; On-device Lite download/storage warning plus cache status/release/delete controls | Add audio/dataset categories when shipped; record Mobile Safari quota/eviction and model redownload evidence |
| M1 | DATA-003 | `Partially Implemented` | Recently opened list; destructive-action confirmations; 30-day recoverable trash for custom documents (restore under a fresh sync-safe id, delete-forever, purge on load); bounded 500-event activity ledger (uploads, creates, renames, deletes, restores, imports) with a Home panel; bounded document revisions | Privacy-selective diagnostic export; activity coverage for review sessions and backups |
| M2 | PERF-001 | `Partial` | Metadata-only startup, 143 on-demand lecture chunks, separate search corpus, lazy Reader/Whiteboard/Mac AI/phone AI/WebLLM boundaries, proportional visited caching, single-index annotation paint, paginated review deck, automated 5k-highlight/10k-card/50k-attempt scale gates, and (2026-09-01) worker-side library search with a pre-normalized one-time corpus transfer, incremental custom-document updates, latest-wins correlation, main-thread fallback, and a 643-document worst-case scale gate | Physical-iPhone startup/interaction/memory/thermal budgets, including the optional phone model runtime |
| M5 | PERF-002 | `Partially Implemented` | Fast/Balanced/Deep budgets, live phases/heartbeats/cancellation, dated real-Qwen smokes; `scripts/ai_slo_bench.mjs` measures cold/warm p50/p95 per variant against a live server — 2026-09-02 on the reviewed Mac (qwen3.5:4b, Balanced): grounded validated-answer p50 6.1s / p95 6.4s (first delta ≈ total by design), source-free first-delta p50 87ms / total p50 8.2s, ~32 tokens/s, 0% failures over 8 runs | Memory/energy/thermal SLOs; physical-iPhone measurements; scheduled regression tracking |
| M3 | LEARN-001 | `Partial` | Anchored colored highlight creation, metadata, inline CSS painting, Reader/Notebook navigation and filtering, edit/delete, review conversion, persistence, and reload | Delivered 2026-09-01: deterministic relocation-semantics unit suite plus browser scenarios for relocation, orphan+relink repair, backup restore of annotations and linked cards, non-CSS-Highlight fallback, and Notebook copy/Markdown export. Remaining: decide whether relocated offsets should persist (cross-tab merge interaction) and record real-device evidence |
| M3 | LEARN-002 | `Partial` | Eight required item types; blank, clipping, annotation, and AI-card sources; exact duplicate detection; post-save edit/archive/restore; source provenance; safe Markdown/code preview | Add heading and mistake sources, MathML/Mermaid card preview, similarity-based duplicate review, and explicit backup-restore coverage |
| M3 | LEARN-003 | `Implemented` | Deterministic due-before-new queue; durable local-day counters; four ratings with latency/confidence; pause/bury/undo/crunch; explicit queue classes; opt-in FSRS-4.5 scheduler (`src/lib/fsrs.js`: canonical wiki weights, 8-decimal engine parity, interval-ordering rules, no post-lapse cap) with 80–95% retention control, one-time migration (attempt-trail replay first, labeled SM-2 seed fallback), undo/sync/backup carrying stability/difficulty/state; per-learner weight calibration (`src/lib/fsrsOptimizer.js`: deterministic Rprop-lite descent on mean review log-loss with L2 pull toward the published defaults, official-optimizer-style per-weight clamps, typed refusals below 50 spaced reviews / 5 lapses, acceptance only on measurable improvement; calibrated weights ride `reviewSettings.fsrsWeights`, thread through grading, interval preview, AND cross-device sync replay) | Long-horizon load simulation (nice-to-have) |
| M3 | LEARN-004 | `Partial` | Due, learning, mastered, suspended, and recent recall aggregates | Seven-state evidence ladder; review/assessment/lab/explanation evidence; concept/lecture/Part/role/prerequisite aggregation; state-change explanation and next action |
| M3 | LEARN-005 | `Partial` | Auto-capture from failed reviews with card/document links and derived categories, repeat merge with reopening, blur-committed corrections, category/corrected filters, corrective scheduling (due-now or new tagged card), 2,000-record bound, cross-tab merge, backup flow-through, a manual capture dialog with response/hints/category, per-category and most-repeated analytics, and unit + browser tests incl. sync-merge and backup round-trips | Assessment-driven capture (blocked on ASSESS-00x) |
| M4 | ASSESS-001 | `Partial` | Versioned per-Part readiness checks built from the learner's own cards: schema-versioned choice/cloze/self questions embedded frozen in the attempt record (later card edits never invalidate history), deterministic distractors and option order, bounded 100-record persistence through sync and backups; numeric response type (plain numbers and signed percents auto-grade through the labs' tolerant matcher — trailing zeros/whitespace forgiven); in-place retry (same frozen questions, each attempt recorded separately); missed-question source links reopening the exact lecture | Ordering/code response types |
| M4 | ASSESS-002 | `Partial` | Deterministic scoring with cloze partial credit and an explicit 0/0.5/1 self-grade rubric; advisory skip/review/study recommendations (skip requires ≥80% AND a fully read Part, and never hides prerequisites); every sub-full-credit answer merges into the mistake notebook | Authored question pools; timed diagnostics |
| M4 | PLAN-001 | `Partial` | Goal capture (target Parts + date, synced), honest daily-pace status (on-track/tight/behind/past-due with neutral copy), goal-biased reading selection in the deterministic 15/30/60-minute daily session | Prerequisite-aware scheduling, pause/recalculation, role/experience capture |
| M4 | PLAN-002 | `Partial` | Explicitly opt-in app-icon badge showing today's actionable due count — silent (no notifications, no permission prompts), feature-detected, clears predictably when the queue drains or the toggle turns off; neutral no-guilt pacing copy doubles as the ethical baseline; the reminders design is now accepted (docs/REMINDERS_DESIGN.md): opt-in per mechanism, silent-first ladder (badge → one quiet daily foreground notification), no guilt mechanics, Web Push permanently rejected as anti-local-first, honest iOS capability copy | The quiet-notification rung, per the accepted design |
| M6 | LAB-001 | `Partial` | Worksheet labs (`lumen.labs.v1`): Python gradient-descent and debugging labs with inline datasets, deterministic self-check literals (arithmetic verified), tolerant answer matching, reveal with worked solutions, and miss→mistake-notebook capture under the code category | Isolated Python runtime (Pyodide behind the WebLLM-style consented-download pattern), hidden tests, timeout/reset |
| M6 | LAB-002 | `Partial` | SQL worksheet lab with an inline table, exact expected outputs computed by hand, and metrics lab (precision/recall/F1 from an inline confusion matrix) | Local SQL engine (sql.js behind consented download), plans/errors/result comparison, persisted lab state |
| M6 | LAB-003 | `Backlog` | None | Safe parameterized ML/system simulations, intermediate-state visualizations, and explicit external-notebook handoff |
| M6 | INTERVIEW-001 | `Implemented` | Versioned authored bank (`lumen.interview.tracks.v1`, lazily loaded): all 8 PRD tracks seeded (MLE, Applied AI, ML Platform, Data Science, LLM/Inference, AI-SDE, Research Engineering, Computer Vision) with 76 questions carrying round type, concepts, seniority, expected minutes, 4–6 rubric bullets from the eight scoring dimensions, and verified lecture anchors; deterministic missed-first track rounds through the timed InterviewRound with per-question answer timing and rubric reveal | Per-question difficulty calibration (nice-to-have) |
| M6 | INTERVIEW-002 | `Partially Implemented` | Timed interview rounds (30s prep / 2min answer countdowns) over a weak-first selection of interview-tagged and scenario/compare/debugging cards; misses log Interview-category mistakes linked to the card | Round templates per track, typed/recorded answers, rubric scoring, and per-dimension feedback |
| M2 | SEARCH-001 | `Partially Implemented` | Exact phrases, AND matching, ranking, Part/source filters, worker-side execution, one-edit typo tolerance, `-term` exclusions, title:/part:/tag: field filters, has:code / has:formula content filters (build-time flags), deterministic plural folding, per-Part facet counts, saved/recent searches, highlighted snippets, a curated ~60-group ML/AI synonym tier (directed acronym expansion, word-boundary guard for short alternates, exact > synonym > fuzzy ordering) with deterministic British-spelling and hyphen folds; Notebook search covers mistakes | Annotation/clipping/personal-note search within the unified library search |
| M5 | SEARCH-002 | `Backlog` | None | Versioned embedding index, local/selected-provider controls, privacy/source disclosure, lexical evidence pairing, and relevance/privacy tests |
| M2 | GRAPH-001 | `Partial` | Curriculum map on Home: 23 Parts on a deterministic serpentine grid with prerequisite edges in curriculum order and per-Part mastery-state coloring; nodes open their Part | Versioned concept/edge model beyond Part granularity, backlinks/path explanations, weak-cluster UI, integrity tests |
| M2 | CONTENT-001 | `Partially Implemented` | Collections with inline creation and chip filtering; Organize dialog (rename, tags, collection, pin, archive/restore); whitespace/case-insensitive duplicate-upload detection; bounded revisions (5/document, 60 total) with an LCS line-diff history dialog and load-back-into-editor; plus tags, duplicate/delete, bookmarks, editable copies; batch select with assign-collection/archive/unarchive/trash in one pass; an on-demand broken-internal-link audit over custom documents and edited copies reusing the reader's exact resolution | Cross-document move UI |
| M2 | CONTENT-002 | `Implemented (PDF/GitHub import deferred by design)` | Bounded Markdown/text import; per-document Markdown export; self-contained printable HTML export with provenance footer; print/save-as-PDF via a dedicated print stylesheet; versioned review-card JSON interchange; dependency-free HTML import (allowlist conversion to GFM, dangerous subtrees dropped whole, unsafe schemes unwrapped, relative internal links preserved); dependency-free EPUB import (hand-parsed zip + DecompressionStream, spine-ordered chapter fan-out, DRM refusal, lossy-import report in the notification); aggregate 16 MB post-conversion byte budget; complete JSON backup path | PDF/GitHub import stay deferred with rationale in docs/IMPORT_DEFERRAL.md |
| M5 | AI-001 | `Partial` | Integrated eight-mode Mac-local Qwen tutor (including code review) plus On-device Lite workspace; Library-first searches all 143 built-ins and the supported 500-document custom corpus, including authoritative edits and personal notes, then sends only bounded source-anchored passages; alternative current/selected/no-library scopes; confidence/provenance disclosure; token-live source-free prose and validation-buffered grounded prose; sanitized GFM + KaTeX Markdown; lazy source-preserving Mermaid rendering in reader, teaching, and completed prose surfaces; validated dedicated structured-result components; Fast/Balanced/Deep response profiles; deterministic visible conversation compaction; cancellation/retry; AI cards remain labeled drafts; answers can be saved as labeled AI-origin notebook clippings with durable provenance; phone structured-field and Mac structured-field citation labels are navigable; personal-note citations focus the exact note editor | Enforce and evaluate claim-level source support rather than only answer-level citations; decide whether derivation/analogy/challenge need distinct UX; strengthen unsupported-inference UX; run versioned grounded-answer/interview-quality evaluations across real Mac and phone models; record physical-iPhone evidence |
| M5 | AI-002 | `Partial` | Zero-paid-API architecture: fixed Ollama/Qwen host model with operator-pinned digest verification, optional pinned WebLLM/Llama phone model, no client/provider key or arbitrary provider/model URL path, stateless application server, canonical profile-aware UTF-8 input fitting plus bounded output/NDJSON streaming with cancellation/backpressure/deadlines, no returned provider thinking, capability probes, exact-origin/Host controls, private-LAN HTTPS/config attestation, a remembered local-only disclosure acknowledgement separated from one-request web authorization, history clear, verified phone cache deletion, session-only phone history, a saved no-AI preference that hides AI surfaces, configurable Mac history retention (50/25/10/session-only with immediate tombstoned trims), a Deep profile gated on attested model thinking support on both server and UI, and opt-in learner pairing (HMAC sessions, constant-time codes, pairing rate limit, fail-closed non-loopback startup) | Surface measured token/latency/energy budgets; record physical multi-device pairing evidence on a real LAN; and record trusted-HTTPS physical-iPhone model evidence |
| M5 | AI-003 | `Partial` | Pinned and hardened self-hosted loopback SearXNG; Library-first gates any consented Mac fallback on time-sensitivity or insufficient local confidence; one schema-validated `search_web` tool plus bounded approved-question fallback/refinement when Qwen skips or empties the planned query; exact query-only phone gateway with a deterministic proposal when the 1B planner vetoes or fails; query/result/body/round/time/URL bounds; feature-query lexical relevance filtering; no result-page fetch; canonical URL deduplication and transparent lexical/domain/recency reranking; sanitized retained evidence; mandatory resolved searched-answer citations; one buffered structured citation-repair attempt; phone exact-query one-shot approval; typed empty-evidence/ungrounded failures | A versioned deterministic retrieval-quality/adversarial-query suite now gates `npm run check` (`eval/fixtures/v1`, `audit:ai-eval`); still open: model-level claim/recency/citation-quality evaluations on the pinned models, upstream-engine degradation measurement, a user-editable Mac-local planned-query confirmation if exact-query approval is adopted there, and physical-iPhone search evidence |
| M5 | AI-004 | `Partial` | Strict NDJSON ordering/terminal checks, source-free token delivery, grounded/schema buffering, Stop/cancellation, bounded Markdown display, DOMPurify GFM/KaTeX, deferred sanitized Mermaid, theme rerender, and malformed-diagram diagnostics pass automated unit/browser audits | Define response-latency SLOs; verify VoiceOver/live-region behavior and Mobile Safari rendering/cancellation; add a real-host update/interruption matrix; decide and document whether any provisional grounded draft may ever be displayed |
| M8 | SYNC-001 | `Implemented (v1 manual file flow)` | Encrypted, account-free cross-device sync per docs/SYNC_DESIGN.md: `lumen.backup.enc.v2` container with authenticated `vaultId`/`deviceId`; durable device identity; one file per writer (`<deviceId>.lumenc`); deviceId-sorted peer fold reusing `mergeProfileVersions`/`mergeBoardVersions` (tombstones, recovered-copy conflicts, generation fencing with baseline reset on replacement); vault baseline in its own IndexedDB database so backups never embed sync state; Settings vault UI (create/join/export/import/leave) with a never-stored passphrase | Folder-watching (File System Access API) and the relay transport; COLLAB-001 stays gated |
| M7 | TEACH-001 | `Partial` | Automatic section slides, navigation, timer, recall concealment, narration, text sizing, swipe/keyboard, fullscreen, and all-section print/PDF export via a print-only document | Authored ordered decks, speaker notes, audience-safe view, reusable templates, remote controls, AirPlay evidence |
| M8 | COLLAB-001 | `Backlog` | None; intentionally depends on verified synchronization | Explicit-item sharing, owner/editor/viewer permissions, revocation, moderation, audit history, and conflict/privacy tests |
| M7 | BOARD-001 | `Partially Implemented` | Marquee/Shift multi-select with group move, arrow nudging, copy/paste, resize handle; per-object lock (selectable but refuses move/resize/nudge/delete/recolor/reorder; marquee skips locked; duplicates arrive unlocked); bring-forward/send-backward z-order persisted through a new order-aware three-way board merge (uncontested reorders hold, contested ones resolve deterministically with a recorded conflict, deletions never read as reorders); off-by-default snap-to-grid quantizing shape endpoints, placement, move deltas, and resize corners to the rendered 24px grid in world coordinates (zoom-independent; freehand and keyboard nudges never snap); per-object rotation (handle above a single selection spins about the bounds center in pixel space; 15° snap steps under grid-snap; hit-testing, resize, and marquee all map through the rotated frame; SVG export carries a center-anchored transform; rotation is a sparse merge-safe field so legacy boards stay byte-identical) | Layers panel, guides |
| M7 | BOARD-002 | `Backlog` | Primitive text, sticky, arrow, and shape objects do not satisfy this requirement | Attached connectors, formula/Mermaid/image/table/mind-map/frame/templates, source links, sticky-to-review conversion, import safety, and persistence tests |
| M7 | BOARD-003 | `Partially Implemented` | 1×–4× zoom/pan; PNG + unit-tested SVG export; `lumen.board.v1` JSON interchange — export carries authoring content only (no ids or sync metadata, lock state travels), import validates through the hardened board normalizer, regenerates every id, appends within the 20-page cap with collision-safe names, and is undoable | Infinite canvas, minimap, text search, PDF export, large-board performance tests |
| M7 | AUDIO-001 | `Partially Implemented` | Voice grouping/disclosure/preview and persisted sound settings; sentence/section/selection/document queues with full transport; section-aware document queues with heading skip; spoken-block highlighting with reduced-motion-aware follow; device-local persisted resume position; 10/20/30-minute sleep timer ending at sentence boundaries; profile-synced pronunciation overrides (whole-word, 50 max); foreground-safe interruption recovery; device-local audio bookmarks (save the spoken sentence during full-lecture narration, jump back from the panel, delete; bounded 100, one per sentence); opt-in narration playlists (a finished full lecture continues into the next chapter of the same Part and starts narrating, with an end-of-Part notice) | Physical-iPhone voice/routing/interruption tests (captured via #/device-evidence) |
| M7 | AUDIO-002 | `Backlog` | None | Provider/voice/cost/privacy disclosure, generated-file storage/download/delete, offline independence, and DATA-002 quota integration |
| M0/M7 | A11Y-001 | `Partial` | Accessible-name/touch checks, focus-visible styles, text controls, a dedicated high-contrast theme, reduced-motion CSS plus a helper covering all JS smooth scrolls, keyboard whiteboard nudging (arrows, Shift steps), and a ? shortcuts sheet | VoiceOver/manual WCAG 2.2 AA evidence, rotor/dialog/status/chart/diagram checks, robust large-text, color-blind modes |

## Dependency-ordered delivery milestones

| Order | Milestone | Included requirements | Exit gate |
|---:|---|---|---|
| 0 | Evidence and interaction gate | BUG-001–004, A11Y-001 baseline | Critical action contracts and stale-release recovery pass automated audits; required real-host, Mobile Safari, and assistive-technology evidence is recorded |
| 1 | Durable local data | DATA-001–003 | Independent schemas/stores, migrations, restore, quota, failure recovery, activity, and recoverable delete pass |
| 2 | Scalable source and knowledge substrate | PERF-001, SEARCH-001, GRAPH-001, CONTENT-001–002 | Lazy loading and worker indexing meet iPhone budgets; stable source/concept IDs and revision-safe content operations exist |
| 3 | Complete learning loop | LEARN-001–005 | Annotation → review → schedule → mastery → mistake correction works through reload and backup restore |
| 4 | Assessment and planning | ASSESS-001–002, PLAN-001–002 | Versioned evidence feeds mastery/mistakes/plans; reminders expose only accurate actionable work and are opt-in |
| 5 | Privacy-first AI | AI-002, AI-003, AI-004, PERF-002, then SEARCH-002 and AI-001 | Local-model/privacy controls precede tutor UI; consented bounded tools, grounded citations, safe presentation, disclosure, draft-only writes, zero-paid-API/error handling, latency/resource SLOs, and evaluations pass |
| 6 | Practice and interviews | LAB-001–003, INTERVIEW-001–002 | Attempts reuse assessment/mastery/mistake contracts and optional runtimes stay outside the default cache |
| 7 | Teaching, board, audio, and full accessibility | TEACH-001, BOARD-001–003, AUDIO-001–002, A11Y-001 completion | Advanced media workflows persist/export safely and have touch, keyboard, VoiceOver, reduced-motion, and non-drag alternatives |
| 8 | Sync before collaboration | SYNC-001, then COLLAB-001 | Encryption, recovery, conflict history, selective sync, permissions, revocation, and privacy tests pass before shared sessions ship |

## A. Reliability, platform, and data foundations

### BUG-001 — Mobile navigation reliability

Status: `Implemented`

Evidence gap: `audit:workflow` asserts focus enter/return, body scroll lock and
restore, inert background, Escape/scrim/route/sidebar-action close, repeated-toggle
consistency, and the 360px viewport; only Mobile Safari real-device evidence is
still required before `Verified`.

Acceptance criteria:

- Top menu toggles the sidebar and exposes `aria-expanded`/`aria-controls`.
- Close button, outside scrim, Escape, route change, and successful sidebar action close it.
- Background page is inert and cannot scroll while the sidebar is open.
- Focus enters the sidebar on open and returns to the opener on close.
- Rapid repeated taps cannot leave the scrim and sidebar in inconsistent states.
- Behavior is verified at iPhone 16 Pro and narrow 360-pixel viewports.

### BUG-002 — Whiteboard straight-line reliability

Status: `Partial`

Delivered slice: the complete line matrix now has browser acceptance coverage in
`audit:workflow` — touch, mouse, and pen-pressure creation (the stored stroke width
proves the pen path executed), rejected taps with visible feedback, redraw,
page-switch and reload persistence, undo/redo with disabled-state transitions,
select/drag-move/recolor/stroke-resize, duplicate/delete, and a captured PNG export
verified by magic bytes. The imported-backup board-restore drill and physical
Apple Pencil evidence remain open.

Acceptance criteria:

- Selecting Line visibly activates the tool.
- Touch, mouse, and pointer events create a two-point line.
- A tap without a meaningful drag does not create an invisible object.
- The line remains visible after redraw, page switch, reload, backup, and restore.
- Undo, redo, select, move, recolor, resize, duplicate, delete, and PNG export work.

### BUG-003 — Complete control contract

Status: `Partial`

Delivered slice: visible controls are inspected for a computed name and rendered
size (190 across the current surfaces), and the dialog focus contract is now
enforced for five dialogs — reader actions menu, create-note, review card, settings
drawer, and the nested install sheet — covering inert background, Tab trap and
wrap, Shift+Tab wrap, Escape close, and exact opener focus-restore. Building that
coverage surfaced a real defect (focus restored while the opener was still inert
was a silent no-op in three dialogs plus the nested sheet); the repair defers the
restore one frame past inert cleanup and is verified by the same audit. Invoking
every critical action with state/feedback/disabled-reason assertions remains open.

Acceptance criteria:

- Every visible interactive element has an accessible name.
- Primary mobile controls have practical touch targets.
- Dialog backgrounds are inert and focus is contained and restored.
- Critical actions produce state change, feedback, or an explicit disabled reason.
- Home, library, reader, teaching, notebook, whiteboard, and settings are audited.

### BUG-004 — Stale-build and lazy-chunk recovery

Status: `Implemented`

Delivered slice: every production build registers a build-specific service-worker URL
and owns an isolated shell cache. Shell installation fails closed when referenced entry
assets are missing. Recoverable lazy imports recognize missing fingerprinted JS and CSS,
perform at most one online automatic reload per tab/cooldown, and otherwise present an
online-verified manual repair that removes only Lumen application-file caches. IndexedDB,
localStorage, user backups, and WebLLM model caches are not cleared. `audit:chunks`
reproduces the reported Whiteboard-JS and phone-tutor-CSS failures and verifies recovery
with local data preserved. The client/server request-contract handshake is delivered:
`src/lib/aiContract.js` defines `lumen.ai.request.v2`, `/api/health` and
`/api/ai/config` publish it as `requestContract`, every AI request body must declare it
as `contract`, a skewed pair fails with typed HTTP 409 `AI_CONTRACT_MISMATCH` and
reload/restart guidance, and the browser refuses a Ready state against a server that
advertises a different or missing contract (covered by `audit:ai` and the
`audit:ai-ui` version-skew scenario). A real-host atomic deployment/update drill
remains open.

Acceptance criteria:

- Give every release a distinct service-worker and shell-cache identity.
- Never activate a shell whose entry JS or CSS is absent.
- Recover a stale fingerprinted lazy JS/CSS request without an infinite reload loop.
- Preserve study records, preferences, and separately owned model caches during repair.
- Deploy assets first and publish the matching HTML/service worker last; verify a real
  old-shell-to-new-release update on desktop and Mobile Safari.
- Publish a client/server request-contract identifier so a new UI fails clearly against
  an old integrated Node process instead of showing a misleading Ready state.
  (Delivered 2026-09-01: `requestContract`/`contract` handshake with typed
  `AI_CONTRACT_MISMATCH` fail-closed behavior on both sides.)

### DATA-001 — Normalized, versioned study data

Status: `Partial`

Delivered slice: profile and backup schema v4, bounded validation for study and AI
records, checksummed canonical export, corruption/unsafe-key rejection, preflighted
v1-v3 restore, an automatic pre-restore recovery snapshot, and failure-injected
IndexedDB fallback/reconciliation. Reset/restore fallback is an authoritative snapshot,
so omitted boards cannot resurrect after recovery. Same-origin tabs perform atomic
three-way merges, preserve competing text as visible recovered notes, and use a
monotonic replacement generation so stale saves cannot undo reset/restore. Independent
stores, per-record schema versions, broader migration/idempotence fixtures, and final
whiteboard/browser conflict coverage are still required.

Acceptance criteria:

- Reviews, attempts, annotations, documents, boards, activity, and settings can evolve independently.
- Every persisted record has an ID, schema version, timestamps, and validation limits.
- Migration from profile v2 is lossless and idempotent.
- Backup format is versioned and can restore older supported versions.
- Partial write failure cannot silently corrupt previously saved study data.

### DATA-002 — Storage health and asset management

Status: `Partial`

Delivered slice: Settings reports browser usage/quota/persistence, successful-backup
health, an exact backup-safe workspace meter, study-profile/whiteboard/offline-cache
breakdown, and safe optional-asset cleanup only after a service-worker-excluded health
check proves the server is reachable. All profile and board mutations share one atomic
20 MiB/250-board budget, including fallback/recovery paths, with typed quota feedback.
On-device Lite separately shows its approximate 710 MiB download, measured browser
headroom, cache/load state, and release/delete controls. The breakdown now reports measured
on-device AI model bytes (webllm-prefixed caches) as a separate row; Mobile Safari
eviction/redownload evidence remains.

Acceptance criteria:

- Show estimated usage, quota, persistence, and last successful backup.
- Break down curriculum cache, documents, boards, audio, datasets, and local models.
- Allow safe removal and redownload of optional assets.
- Warn before large downloads and gracefully handle quota errors.

### DATA-003 — Activity and recovery history

Status: `Partial`

Delivered slice: recently opened documents; destructive-action confirmations;
a 30-day recoverable trash for custom documents (deletion moves content to the
trash while linked study data is deleted immediately; restore mints a fresh id
because the original stays in the sync tombstone union; expired entries purge on
load); a bounded 500-event newest-first activity ledger covering uploads,
creates, duplicates, renames, deletes, restores, and card imports, surfaced on
Home; and bounded document revisions (see CONTENT-001). All three collections
merge across tabs and travel through backups. A privacy-selective diagnostics
export remains open.

Acceptance criteria:

- Record meaningful local study events without external analytics.
- Provide recent activity, recoverable delete where practical, and document revision history.
- Export diagnostics without including private note contents unless explicitly selected.

### PERF-001 — Scalable loading and indexing

Status: `Partial`

Delivered slice: startup imports compact curriculum metadata only. The 143 lecture
bodies, Reader, Whiteboard, AI tutor, diagrams, and the full-text corpus load on demand;
the service worker installs only the shell/entry assets and then caches visited assets.
The Mac-local tutor, phone-tutor UI, and WebLLM runtime are nested lazy boundaries; a
mode switch never starts the model-weight download. Service-worker upgrades delete
only old Lumen shell caches and preserve the separately owned WebLLM model cache.
The production entry budget, full visited-lecture offline revisit, shared-index 5,000-
annotation paint, paginated 10,000-card deck, and single-pass 50,000-attempt analytics
have automated desktop budgets. Ordinary library search now parses and ranks in a
dedicated Web Worker (`src/workers/librarySearch.worker.js` +
`src/lib/librarySearchClient.js`): the immutable corpus transfers once and is
normalized at ingestion, custom documents update incrementally, responses use
latest-wins correlation so stale results never paint, and a synchronous
metadata-only fallback covers worker-less or pre-corpus moments. A worst-case
643-document scale gate (143 built-ins plus 500 custom documents) runs in
`audit:scale`. Physical-iPhone interaction/memory/thermal budgets remain open.

Acceptance criteria:

- Avoid loading and indexing every full document on the main thread at startup.
- Build search indexes in a worker and update them incrementally.
- Lazy-load optional lab, AI, audio, and dataset runtimes.
- Define and enforce startup, interaction, and memory budgets on iPhone.

### PERF-002 — Local-AI latency and resource budgets

Status: `Partial`

Delivered slice: response profiles bound input/output trade-offs; live cards expose
phase, elapsed time, cancellation, and returned token metadata; dated single-run Qwen
smokes cover source-free, library-grounded, prose-web, and structured-web paths. These
selected smokes are diagnostic evidence, not statistically meaningful performance SLOs.
Grounded Mac prose is intentionally withheld until terminal citation validation, so its
relevant latency is time to validated answer rather than provider time to first token.
No physical-iPhone WebLLM resource measurements exist.

Acceptance criteria:

- Define a versioned prompt/device/profile matrix and cold versus warm test method.
- Record p50/p95 time to live progress, source-free first token, validated grounded
  answer, and complete structured result, plus tokens/second and failure rate.
- Measure peak memory, model/storage footprint, energy, thermal state, and battery impact
  for the reviewed Mac and trusted-HTTPS physical-iPhone configurations.
- Set explicit regression budgets and fail the release gate when they are exceeded.
- Keep progress/streaming wording honest when validation deliberately buffers answer text.

## B. Learning loop and assessment

### LEARN-001 — Anchored highlights and marginal annotations

Status: `Partial`

Delivered core (covered by `npm run audit:annotations`): exact quote/context/offset/
heading/source-hash capture, colored inline rendering, purpose/comment/tags, Reader
and Notebook lists and filtering, edit/recolor/delete, review-card conversion,
persistence, and reload. Copy and Markdown export are delivered in the Notebook
(per-highlight copy with source attribution and a filtered bulk export). The
relocation semantics — exact offsets, context-scored relocation that beats a
closer decoy occurrence, typed `quote-not-found`/`missing-anchor` orphaning, and
resolution without CSS Highlight painting — are pinned by a deterministic unit
suite (`annotations.relocation.test.mjs`), and `audit:annotations` now drives the full
browser matrix: relocation after a real source edit, orphan detection with a
selection-gated Relink, manual relink that preserves the annotation id and its
review-card link, backup export and two-phase preflight restore of annotations
plus linked cards, the non-CSS-Highlight fallback reader, and Notebook
copy/Markdown export. The write-back design question is resolved (2026-09-01):
a saved edit is the explicit reconcile point — confidently relocated anchors
persist their fresh offsets and refreshed prefix/suffix context with a newer
`updatedAt` (merge-safe across tabs), so anchors self-heal instead of
re-running the fuzzy search on every future open; ordinary renders never write
back, and Relink remains the manual repair for orphans.

Acceptance criteria:

- Create colored highlights with purpose, tags, and an optional comment.
- Store exact quote, prefix/suffix context, text offsets, heading ID, and source revision.
- Restore anchors after moderate source changes or mark them as orphaned with repair UI.
- Navigate between highlights and filter them in the Notebook.
- Edit, recolor, tag, copy, export, and delete annotations.
- Convert an annotation into a review item.

### LEARN-002 — Review-item authoring

Status: `Partial`

Delivered slice: users can label cards with the eight required types (basic, cloze,
formula, derivation, compare, debugging, code-output, production-scenario) — the
types carry provenance, and cloze cards now conceal `{{span}}` markup until
reveal — authored from a blank form, clipping,
highlight, or reviewed AI flashcard draft. Exact duplicates are rejected; source
provenance, safe Markdown/code preview, post-save edit without schedule reset,
suspend/resume, archive/restore, and delete are implemented. Mistake sources are delivered via the mistake notebook's corrective scheduling
(LEARN-005). Heading sources, similarity review, MathML/Mermaid card rendering,
and explicit backup-restore evidence remain open.

Acceptance criteria:

- Support basic, cloze, formula, derivation, compare, debugging, code-output, and production-scenario items.
- Create items from a highlight, clipping, heading, mistake, or blank form.
- Preserve source document and source-anchor links.
- Detect likely duplicates and allow edit, suspend, archive, and delete.
- Preview front/back and render Markdown, code, MathML, and diagrams safely.

### LEARN-003 — Scheduled retrieval queue

Status: `Partial`

Delivered slice: deterministic due-before-new queuing, persisted per-local-day new and
review counters, Again/Hard/Good/Easy with elapsed time and confidence, lapse/history
records, pause, bury-until-tomorrow, reversible last grade and ledger usage, interview
crunch mode, live clock/focus refresh, 7/30-day retention, latency, streak, and forecast.
Unit/browser coverage includes reload and DST/timezone boundaries. Explicit mutually
tested overdue/learning queue semantics and a calibrated complete-history scheduling
algorithm remain open.

Acceptance criteria:

- Present due, learning, new, and overdue items in a deterministic daily queue.
- Record Again, Hard, Good, and Easy outcomes with elapsed time and confidence.
- Calculate the next interval from complete review history.
- Support daily limits, pause, bury, undo-last-grade, and interview-crunch mode.
- Work fully offline and remain correct across time zones and daylight-saving changes.

### LEARN-004 — Evidence-based mastery

Status: `Partial`

Delivered slice: the Review Center reports due, learning, mastered, suspended, and
recent recall-rate aggregates. The complete evidence ladder and concept-level
aggregation remain open.

Acceptance criteria:

- Track `Not seen → Read → Recognized → Recalled → Applied → Explained → Mastered`.
- Derive mastery from reviews, assessments, labs, and explanations rather than scrolling alone.
- Aggregate mastery by concept, lecture, Part, role track, and prerequisite cluster.
- Explain why a mastery state changed and what action improves it.

### LEARN-005 — Mistake notebook

Status: `Partial`

Delivered slice: grading a card “Again” automatically logs a mistake linked to
the card, the source document, and a category derived from the card type/tags
(misconception, formula, code, system design, interview); repeats of the same
card — or the same category+prompt pair for free-text entries — merge into one
record with a rising occurrence count, and a recurrence reopens a corrected
mistake. The Review Center's Mistake notebook edits corrections in place
(committed on blur so fast typing cannot drop keystrokes), filters by category
and corrected state, marks entries corrected/reopened, deletes them, and
schedules corrective review: a still-linked card becomes due immediately and an
unlinked mistake becomes a new tagged card, which also delivers LEARN-002's
mistake card source. Records live in the profile (bounded at 2,000), merge
across tabs, and travel through backups. Unit and browser coverage exist for
capture, merge/reopen, correction persistence, corrective scheduling, and
filters, manual capture with response/hints fields, and per-category/most-
repeated analytics. Capture from assessments remains open (ASSESS-00x is
Backlog).

Acceptance criteria:

- Capture prompt, response, expected reasoning, error category, hints, and correction.
- Link mistakes to concepts and source sections.
- Merge repeated mistakes and schedule corrective review.
- Filter by misconception, formula, code, system design, and interview category.

### ASSESS-001 — Chapter checkpoints

Status: `Backlog`

Acceptance criteria:

- Support multiple choice, multi-select, short answer, numeric, formula, ordering, and code questions.
- Provide immediate explanation, source citation, and retry behavior.
- Version questions so content updates do not invalidate attempt history.

### ASSESS-002 — Diagnostic and mastery assessments

Status: `Backlog`

Acceptance criteria:

- Offer prerequisite diagnostics and post-Part mastery tests.
- Use question pools, deterministic scoring, partial credit, and explicit rubrics.
- Recommend skip, study, or review actions without hiding required prerequisites.
- Feed results into mastery and the mistake notebook.

### PLAN-001 — Goals, learning plans, and daily queue

Status: `Backlog`

Acceptance criteria:

- Capture target role, interview date, experience, availability, and weak areas.
- Generate a prerequisite-aware plan and a 15/30/60-minute daily session.
- Mix learning, review, labs, interview practice, and mistake correction.
- Support reschedule, catch-up, pause, and recalculation after missed days.

### PLAN-002 — Ethical reminders and badges

Status: `Backlog`

Acceptance criteria:

- User explicitly opts into review reminders after installing the Home Screen app.
- Frequency, quiet hours, Focus behavior, and reminder categories are configurable.
- Badge represents actionable due work and can be cleared predictably.
- No guilt messaging, punitive streak loss, or dark-pattern permission prompts.

## C. Practice laboratories

### LAB-001 — Browser Python laboratory

Status: `Backlog`

Acceptance criteria:

- Execute Python in an isolated worker with timeout and reset controls.
- Support curated NumPy, pandas, plotting, and introductory ML exercises.
- Provide starter code, visible/hidden tests, progressive hints, solution, and complexity notes.
- Persist attempts without placing the runtime in the default offline cache.

### LAB-002 — Browser SQL laboratory

Status: `Backlog`

Acceptance criteria:

- Execute SQL locally against curated and uploaded CSV/JSON/Parquet data.
- Render tables, query plans, errors, and expected-result comparisons.
- Cover joins, aggregation, windows, data quality, and analytics interview tasks.

### LAB-003 — ML and systems simulations

Status: `Backlog`

Acceptance criteria:

- Provide safe small-scale gradient, metric, tokenization, attention, quantization, distributed-training, and RL calculations.
- Visualize intermediate state and allow parameter changes.
- Hand off GPU-scale work to a user-selected external notebook rather than pretending to train large models locally.

## D. Interview preparation

### INTERVIEW-001 — Role-specific interview tracks

Status: `Backlog`

Acceptance criteria:

- Include MLE, Applied AI, ML Platform, Data Science, Research Engineering, LLM/Inference, Vision, and AI-SDE tracks.
- Map every question to concepts, seniority, expected duration, and rubric.

### INTERVIEW-002 — Timed mock sessions

Status: `Partially Implemented` — the review center runs timed interview
rounds: a deterministic weak-first selection (up to six cards tagged
`interview` or typed production-scenario/compare/debugging), a 30-second
preparation countdown, a 2-minute answer countdown, reveal-and-self-grade,
and a summary. Rounds never touch the scheduler; each miss logs an
Interview-category mistake back-linked to its card, so corrective work flows
through the mistake notebook. Round templates, typed/recorded answers, and
rubric scoring remain open.

Acceptance criteria:

- Support rapid fundamentals, coding, debugging, model design, production incident, and system-design rounds.
- Capture typed or recorded answers with preparation and response timers.
- Score assumptions, correctness, clarity, trade-offs, scale, cost, observability, and safety.
- Convert weaknesses and missed follow-ups into review items.

## E. Search, knowledge organization, and content

### SEARCH-001 — Advanced lexical search

Status: `Partial`

Delivered slice: exact-phrase tokenization, AND matching, title/body weighting,
context snippets, and basic library filters — now executed in the search worker —
plus one-edit typo tolerance for terms of five or more characters (an exact match
of the same shape always outranks the fuzzy-reached match of the same document), `-term` exclusions that never fire inside quoted
phrases, saved searches persisted in profile settings with star/chip management,
device-local recent-search chips, and `<mark>` highlighting of matched terms in
result snippets. Unit, worst-case scale, and browser coverage exist for each.
Custom-document bodies already participate through the worker. Queries now also
support title:/part:/tag: field filters (quoted values allowed; applied even
with no body terms), has:code and has:formula content filters backed by flags
computed in the build-time generator (raw Markdown never ships to the client;
mermaid-only documents deliberately do not count as code), deterministic plural
folding (singular↔plural at the exact-rank tier, still highlightable), and
per-Part facet chips with counts that jump to the Part filter. The Notebook's
unified search additionally covers the mistake log. Synonyms and
annotation/clipping/personal-note search inside the library view remain open.

Acceptance criteria:

- Add typo tolerance, stemming/synonyms, phrase, exclusion, and field filters.
- Filter formulas, code, questions, annotations, incomplete work, and user content.
- Provide saved/recent searches and highlighted snippets.

### SEARCH-002 — Optional semantic search

Status: `Backlog`

Acceptance criteria:

- Use a versioned embedding index with source and privacy disclosure.
- Run locally when supported or use an explicitly selected provider.
- Always show the lexical/source evidence behind semantic results.

### GRAPH-001 — Concept and prerequisite graph

Status: `Partial`

Delivered slice: a curriculum map on Home renders the 23 Parts as a
deterministic serpentine grid (`src/lib/conceptMap.js`, unit-tested layout)
with prerequisite edges along the curriculum order, mastery-state coloring
from the evidence-based ladder, and tap-to-open navigation per Part. The
concept-level graph (concepts, formulas, labs, backlinks, path explanations,
weak clusters) remains open.

Acceptance criteria:

- Represent concepts, prerequisites, related concepts, formulas, labs, questions, and documents.
- Provide backlinks and explain blocked/recommended learning paths.
- Overlay user mastery and weak clusters.

### CONTENT-001 — Collections, tags, archive, and document history

Status: `Partial`

Delivered slice: collections (created inline from the Organize dialog, filtered
by chips with per-collection counts), an Organize dialog per custom document
(rename, tag editing, collection assignment, pin-to-top, archive/restore —
archived documents leave the default lists but keep content and study data),
whitespace/case-insensitive duplicate detection on upload, and bounded
revisions: every save over existing content banks the replaced text (5 per
document, 60 total), and the editor's History dialog shows an LCS line diff
against the current draft and loads any revision back for explicit re-saving.
Batch actions, a cross-document move UI, and broken-link checks remain open.

Acceptance criteria:

- Create folders/collections; rename, tag, move, archive, restore, and batch-manage documents.
- Keep local document revisions and provide side-by-side comparison.
- Detect likely duplicates and broken internal links.

### CONTENT-002 — Rich import and export

Status: `Partial`

Delivered slice: bounded Markdown/text import; per-document Markdown export; a
self-contained printable HTML export (no external assets, provenance footer,
diagram placeholders); and the lumen.cards.v1 review-card interchange — export
carries authoring fields only, import validates the envelope, skips exact
prompt+answer duplicates, counts malformed entries honestly, and schedules
imported cards fresh in the new queue. PDF/EPUB/HTML/GitHub import, PDF export,
metadata preservation, and lossy-conversion reports remain open.

Acceptance criteria:

- Import Markdown, text, supported PDF/EPUB/HTML, and selected GitHub content with size limits and sanitization.
- Export selected content to Markdown, HTML, PDF, JSON, and review-card interchange formats.
- Preserve source metadata and report unsupported or lossy conversions.

## F. AI assistance

### AI-001 — Grounded curriculum tutor

Status: `Partial`

Delivered: a same-origin AI client/proxy and an integrated learner workspace with
explain, Socratic, quiz, flashcards, code-review, interview, summarize, and
study-plan modes.
The recommended path runs Qwen3.5 4B through local Ollama; On-device Lite runs a
separately consented Llama 3.2 1B q4f16 browser model in a dedicated worker.

The default **Library first** scope searches the complete local corpus before generation:
all 143 built-in lectures plus the supported maximum of 500 custom documents. Saved
edits replace stale built-in text, and per-lecture personal notes participate with
explicit provenance. The generated lexical index identifies candidates without loading
every lecture body; raw Markdown is loaded only for a bounded candidate set, divided at
source headings, diversified across documents, clipped to exact UTF-8 budgets, and
returned with stable document/revision/section/anchor identifiers. The learner can
instead select Current lesson, Choose sources, or No library. Both Mac and phone surfaces
show retrieval counts, confidence, truncation, and the reason a separate web fallback is
or is not recommended. This is answer-level retrieval and provenance, not proof that
every generated factual claim is supported.

Mac prose responses use the versioned `lumen.ai.ndjson.v1` stream: the active mobile response
card exposes phase/heartbeat progress, elapsed time, and Stop; copy, regenerate, evidence,
and Approach actions appear on the completed response. Source-free prose renders deltas as they arrive. Library/web-grounded
prose is released only after the terminal completion and all citations validate, preventing
an unsupported rejected draft from being shown or persisted. Structured quiz/card/plan
results remain buffered until their complete JSON can be schema-validated and are rendered
by dedicated structured components. Prose/Markdown output passes through one
DOMPurify-sanitized GFM renderer with tables, lists, links, blockquotes, code-copy controls,
KaTeX inline/display math, and fenced Mermaid diagrams. Diagrams load their renderer only
after a completed Markdown surface contains a compatible fence; Reader, Teaching Mode,
Mac-tutor, and phone-tutor surfaces share one serialized renderer. It preserves the
original definition for paper/dark/system theme rerenders and replaces parse/load failures
with a bounded diagnostic, source disclosure, copy, and retry controls. Fast, Balanced,
and Deep default to 900, 1,800, and 3,200 output tokens under the 4,096-token server ceiling.
Older complete request/answer pairs
are compacted deterministically into visible bounded memory while recent pairs remain
verbatim; compaction adds no second model request. Deep may use supported local-model
thinking internally, but provider thinking is discarded. The visible Approach is only
deterministic orchestration, retrieval, and evidence metadata, never private
chain-of-thought.

Both paths bound their serialized input and output; the phone path additionally reports
byte usage, history/source inclusion, and per-source characters retained. Incomplete,
malformed, uncited searched, and oversized outputs fail closed; requests support
cancellation/retry; selected generated cards enter review as labeled drafts. A real
Mac-local Qwen stream delivered 52 text deltas and completed in 8.338 seconds. This proves
incremental rendering on that run, not reduced total latency on every device or prompt.
Completed prose answers can be saved to the Notebook as labeled AI-origin clippings
with materialized web links and a plain-text library-source footer. Structured
quiz/flashcard/study-plan string fields render navigable [S#]/[W#] citations on both
the Mac and phone surfaces, and a personal-note citation opens the Reader's Notes
drawer and focuses the exact note editor. Explicit derivation/analogy/challenge
prompt strategies, claim-level grounding enforcement, stronger unsupported-inference
treatment, physical-iPhone evidence, and versioned grounded-quality/interview
evaluations remain.

Acceptance criteria:

- Offer Explain, Socratic, Quiz, Flashcards, Interview, Summarize, and Study-plan modes
  with explicit difficulty/depth controls; add code-review and explicit derivation,
  analogy, and challenge strategies where they materially differ from those modes.
- In library- or web-grounded modes, make every cited label resolvable and evaluate
  support at claim level. In No-library mode, clearly identify general-knowledge and
  evidence limitations rather than implying source grounding.
- Clearly label unsupported inference and never silently modify user data.
- Allow inserting an answer into notes or converting it into draft review items.

### AI-002 — Provider and privacy controls

Status: `Partial`

Delivered: no paid model provider, cloud-model key, arbitrary client-side provider URL,
or client-selected model is accepted. The recommended server path is fixed to local
Ollama/Qwen; capability probes verify that the configured installation exposes
completion and, before Mac search is offered, tool calling. The optional phone path is
fixed to WebLLM 0.2.82 plus an immutable Llama repository revision and WebAssembly
revision, with integrity checks for the selected config/WASM/tokenizer artifacts. Model
weights are not requested before an artifact-identity-bound large-download checkbox and
button. Named-cache status, bounded release, offline/direct deletion, and verified
consent revocation fail visibly if cleanup is incomplete. The UI ships the required
Llama attribution/license path and discloses that zero paid API fees do not eliminate
local hardware, electricity, storage, bandwidth, or public-search privacy costs.

The installed Qwen tag is also checked against an operator-approved SHA-256 Ollama
digest; a mismatch disables tutor readiness and direct inference before `/api/chat`.
The application server is stateless and enforces serialized request/context and output
budgets, origin/Host/body/rate/concurrency/deadline controls, sanitized errors, and
public no-storage/no-paid-API flags. Mac prose streams are bounded NDJSON with ordered
event validation, maximum line/response sizes, heartbeat and idle/overall deadlines,
backpressure propagation, client-disconnect cancellation, and exactly one terminal
event. Fast/Balanced/Deep own decreasing request-byte budgets as their 900/1,800/3,200
output allowances increase; the absolute configurable output ceiling defaults to 4,096.
The browser constructs a canonical body containing `conversationSummary`,
`responseFormat`, history, profile, output cap, web flag, and the remaining envelope before
measuring `JSON.stringify` UTF-8 bytes. Initial, retrieved, no-match, retrieval-failure,
structured, and retry branches fit and submit that exact body, so server normalization no
longer pushes a just-under-limit request over the advertised boundary.
Deep asks a thinking-capable local model to reason privately, but thinking tokens are
never returned, displayed, or persisted. A non-loopback serving profile requires TLS
and exact HTTPS origins; Ollama and SearXNG remain loopback-only. The documented local-CA
flow covers a stable Safari origin, fingerprint verification, CA-key custody, explicit
serial state, renewal, and trust removal. Before its first Mac-local request, the learner
acknowledges the local-model disclosure of data categories and limits; that acknowledgement is
remembered only in this browser until **Review again** is used or site storage is cleared. It is not permission
for the web. Each request or retry that may use current-web fallback requires a separate,
single-use authorization and warns that a Mac-planned public-engine query can reproduce
prompt/source fragments and is not separately previewed. Up to 50 normalized Mac-tutor
messages can be locally retained and deleted.
Older complete pairs can be replaced in an outbound request by a deterministic,
learner-visible summary capped at 3,000 characters; it is treated as untrusted source
material and is not a model-generated memory. Phone conversations are session-only. A
saved no-AI preference now hides AI navigation and the studio surface until the learner
re-enables it in Settings, without touching notes, reviews, or other study data. Mac
tutor history retention is configurable (up to 50/25/10 messages or session-only);
shrinking it trims immediately with tombstones so another tab cannot resurrect removed
messages, and session-only stops persistence entirely. The Deep profile is
capability-gated end to end: the server rejects a Deep request with a typed
`AI_PROFILE_UNSUPPORTED` error unless the installed model attests Ollama thinking
support, and the UI disables the Deep option with the capability reason and falls back
to Balanced. Learner pairing is delivered: `AI_AUTH=pairing` with an operator
`AI_PAIRING_CODE` guards the AI/search POST endpoints behind a stateless HMAC session
in an HttpOnly SameSite=Strict cookie, minted by `POST /api/auth/pair` after a
constant-time code check under a five-attempt per-client rate limit. Revocation is
code/secret rotation or a restart (the signing secret is ephemeral per boot unless
pinned via `AI_SESSION_SECRET`), configuration reports `auth.sessionActive`, the tutor
shows a pairing gate with typed rejection errors, and serving AI or search beyond
loopback fails closed at startup without pairing or the explicit
`AI_ALLOW_UNAUTHENTICATED_LAN=true` single-learner acknowledgment. Measured
latency/token/energy display, physical multi-device pairing evidence on a real LAN,
and trusted-HTTPS physical-iPhone model evidence remain open.

Acceptance criteria:

- Support an explicit no-AI preference, a Mac-hosted local model, and a feasible
  on-device model. Paid managed providers and BYOK are outside the current zero-cost
  product direction unless the learner later opts into a separately specified feature.
- Show exactly what content leaves the device before the first request.
- Provide deletion, retention, cost, token, model, and error information.
- Keep generated assessments in draft state until reviewed.
- Gate each response profile on the installed model capabilities it requires, and fail
  readiness with an actionable message when a configured model is incompatible.

### AI-003 — Free, consented current-information tool

Status: `Partial`

Delivered: a digest-pinned self-hosted SearXNG container is reachable only on Mac
loopback and runs non-root with a read-only root filesystem, dropped capabilities,
resource bounds, and a health check. Search is disabled per request by default. In the
default Library-first scope, consent only makes web fallback eligible: the local
retrieval trace must independently recommend it because the question is time-sensitive,
the index is unavailable, no passage matches, or query coverage/confidence is weak.
Strong local evidence keeps web egress off even when fallback permission is checked.
The server exposes exactly one allowlisted `search_web` schema to Qwen only after this
per-request opt-in; it bounds query/result count/result body/tool rounds/deadlines/origins/
concurrency, rejects redirects plus private, credentialed, and active result URLs, and
never opens a result page. If Qwen skips its required tool call, the server discards the
provisional answer and performs one bounded search derived deterministically from the
already authorized learner question; it does not silently omit the lookup. Structured
current-web work first retrieves without a response schema and then
performs a tool-free schema-final pass; fabricated final-phase tool calls are rejected.
If a planned query is empty and a disclosed round remains, one bounded learner-question
query may be used before failing. Feature-specific results must cover a majority of the
query's distinctive terms; generic product pages do not qualify solely because they share
one name. A searched response must cite only the retained evidence that actually reached
the model, and one buffered structured draft may receive explicit citation-placement
repair before the second failure is returned.

The same-origin phone gateway accepts exactly `{query}`. On-device Lite first plans
locally after both the learner opt-in and full-library fallback recommendation exist.
A valid planner query is preferred; an `answer` decision, malformed output, or other
non-cancellation planner failure instead yields a bounded, sanitized deterministic query
from the learner prompt, with the retrieval reason used in the disclosure. Either path
displays the exact query/reason and requires one single-use approval tap; no network call
occurs before that tap, and declined or expired proposals are consumed. This is a
schema-constrained local action planner with a deterministic proposal fallback, not a claim
that this 1B WebLLM model supports unrestricted/native function calling. Search evidence
is sanitized and returned as bounded public title/URL/snippet/source/date metadata.
Before the evidence reaches the model, tracking parameters and fragments are removed,
canonical URLs are deduplicated, and up to 96 candidates are reranked using transparent
query overlap, requested-site/domain, documentation/official-page, and date signals;
only the configured bounded top set is retained. This improves ordering but does not
fetch or verify the linked page and cannot repair missing or misleading engine snippets.
Missing usable evidence is a typed failure, not a searched answer. Public engines still
receive the approved/generated query and can rate-limit, challenge, omit recent pages,
or degrade independently. Repeatable claim-level retrieval/recency/citation-quality
evaluations, upstream-engine degradation evidence, a user-editable Mac query-preview
flow if adopted, and physical-iPhone search testing remain open.

Acceptance criteria:

- Use no paid search API and keep the metasearch service off the LAN/public internet.
- Keep search off by default and disclose that public engines receive the query.
- Expose only named, schema-validated, bounded tools; never arbitrary fetch, URL open,
  shell, filesystem, or background action.
- Show sanitized public evidence and fail clearly when current evidence is unavailable.
- Test prompt injection, SSRF, repeated tool calls, timeouts, empty results, consent,
  cancellation, and source-link integrity.

### AI-004 — Safe response presentation and stream integrity

Status: `Partial`

Delivered: the Mac contract uses bounded `lumen.ai.ndjson.v1` events with ordered
sequences, exact request identity, one terminal, body/line/text/source limits, timeouts,
backpressure, heartbeat progress, and cancellation. Source-free Markdown can display
provider deltas live. Library/web-grounded Markdown is withheld until terminal completion
and citation validation, then released in ordered deltas; structured JSON is never shown
partially. Missing/unknown completion terminals, post-terminal phone chunks, malformed
schema data, and invalid citations fail closed. Prose uses a DOMPurify-sanitized GFM/KaTeX
pipeline. Compatible Mermaid is lazy-rendered only after completion with source-preserving
theme rerenders, bounded sanitized SVG, and copy/retry/source diagnostics on failure.

Automated unit and browser fixtures pass, and structured-field citation labels are now
navigable inline controls on both the Mac and phone surfaces. Grounded output remains
deliberately not provider-token-live, and Mobile Safari, VoiceOver/live-region, real
model-generated diagram quality, interruption, and latency SLO evidence remain open. The visible Approach is deterministic orchestration/evidence metadata; exposing raw
provider reasoning or chain-of-thought is explicitly not a requirement.

Acceptance criteria:

- Sanitize Markdown, links, code, math, and diagram output before insertion into the DOM.
- Preserve exact ordered text, sources, request identity, and one strict terminal across
  stream, non-stream, cancellation, retry, and error paths.
- Never persist a draft that fails schema, terminal, citation, or grounding validation.
- State whether a response is source-free token-live, validation-buffered grounded prose,
  or buffered structured output; do not describe progress visibility as first-token latency.
- Make completed citation references navigable in prose and structured result surfaces.
- Verify malformed/XSS content, theme rerender, keyboard/VoiceOver status, Mobile Safari,
  slow consumer/backpressure, network interruption, and Stop behavior.

## G. Synchronization, collaboration, and teaching

### SYNC-001 — Optional encrypted synchronization

Status: `Backlog`

Acceptance criteria:

- Preserve local-first offline operation and optional account-free use.
- Encrypt private study data end to end with device authorization and recovery.
- Resolve concurrent edits without silent loss and expose revision/conflict history.
- Support selective sync, device removal, export, and account deletion.

### TEACH-001 — Teaching session controls

Status: `Partial`

Delivered slice: automatic section slides, navigation, timer, active-recall
conceal/reveal, narration, text sizing, swipe/keyboard controls, and fullscreen.
Authored decks, speaker notes, audience-safe views, templates, remote controls,
AirPlay evidence, and PDF export remain open.

Acceptance criteria:

- Create ordered decks, speaker notes, audience-safe views, and reusable teaching templates.
- Offer remote next/previous controls, AirPlay-friendly presentation, and PDF export.

### COLLAB-001 — Shared study and classroom sessions

Status: `Backlog`

Acceptance criteria:

- Share explicitly selected notes, boards, decks, or quizzes without exposing the private notebook.
- Define owner/editor/viewer permissions, revocation, moderation, and audit history.
- Implement only after synchronization and conflict handling are verified.

## H. Whiteboard roadmap

### BOARD-001 — Transform and organization tools

Status: `Partial`

Delivered slice: single-object select/move, recolor, stroke-size change, duplicate,
delete, and undo/redo. The multi-object, geometry-transform, layer, clipboard, snap,
and alignment acceptance set remains open.

Acceptance criteria:

- Add multi-select, lasso, resize, rotate, group, lock, layers, order, copy/paste, snap, and alignment guides.

### BOARD-002 — Structured learning objects

Status: `Backlog`

Acceptance criteria:

- Add attached connectors, formulas, Mermaid diagrams, images, tables, mind maps, frames, and system-design templates.
- Link objects to concepts/headings and convert sticky notes to review items.

### BOARD-003 — Navigation and interchange

Status: `Backlog`

Acceptance criteria:

- Add zoom/pan, optional infinite canvas, overview/minimap, searchable text, PDF/SVG export, and board import.

## I. Audio and accessibility

### AUDIO-001 — Long-form listening experience

Status: `Partial`

Delivered slice: all voices asynchronously reported by iOS are normalized, grouped
and filterable by language, with conservative on-device/network labels, matching-
language preview phrases, missing-voice recovery, and no server-audio fallback.
Voice, language, speed, pitch, volume, and reading scope persist locally. The reader
can queue the current sentence, current section, a captured selection, or the full
document into short sentence-oriented utterances with pause/resume/stop,
previous/next, speed presets, actionable errors, a compact player, and explicit
tap-to-resume behavior after background interruption. `audit:audio` verifies these
contracts — including multi-segment section/document queues and previous/next
transport with first-segment disabling — and iPhone-sized containment with four
mocked iOS voices. Spoken-text
highlighting, precise persisted resume, heading skip, audio bookmarks, timer,
playlists, pronunciation overrides, and physical-iPhone voice/routing/interruption
evidence remain open.

Acceptance criteria:

- Add a narration queue, spoken-sentence highlighting, precise resume, heading skip, bookmarks, and sleep timer.
- Support playlists for unfinished sections, clippings, mistakes, and due reviews.
- Provide pronunciation overrides for technical terminology.

### AUDIO-002 — Optional generated audio

Status: `Backlog`

Acceptance criteria:

- Make provider, voice, cost, privacy, storage, download, and deletion explicit.
- Never require generated audio for normal offline reading.

### A11Y-001 — Comprehensive accessibility modes

Status: `Partial`

Delivered slice: visible-control name/size checks, focus-visible styling, adjustable
reader text, themes, and reduced-motion CSS. VoiceOver and manual WCAG evidence,
robust large text, contrast/color-blind modes, diagram/chart alternatives, and
non-drag whiteboard operation remain open.

Acceptance criteria:

- Verify VoiceOver reading order, rotor headings, dialogs, status updates, charts, diagrams, and whiteboard alternatives.
- Add larger-text layouts, contrast/color-blind modes, reduced motion, and non-drag alternatives.
- Maintain WCAG 2.2 AA automated and manual audit evidence.

## J. Product guardrails

The following are explicitly out of scope until the learning loop and data
foundations are verified:

- mandatory registration;
- public social feed or public leaderboards;
- punitive streak mechanics;
- unreviewed AI-generated curriculum;
- automatic cloud upload of private work;
- full-scale model training on an iPhone;
- real-time collaboration before reliable sync/conflict resolution;
- bundling large AI models, datasets, Python runtimes, or audio into the default cache.

## Verification commands

```bash
npm run check:release
npm run check
npm run audit:controls
npm run audit:visual
npm run audit:workflow
npm run audit:review
npm run audit:annotations
npm run audit:audio
npm run audit:chunks
npm run audit:ai
npm run audit:ai-ui
npm run audit:phone-ai
npm run audit:phone-ai-ui
```

`npm run check:release` is the aggregate deterministic plus browser gate. `npm run
check` currently runs the notes, unit, scale, storage, backup-memory, AI,
production-build, and static PWA
checks; it does **not** invoke every browser or feature-specific audit above. A
requirement may cite an individual command as slice evidence, but it cannot become
`Verified` until all of its acceptance criteria are covered and the complete relevant
command set passes. Mobile Safari, Apple Pencil, VoiceOver, destructive recovery,
real local-model quality, trusted-HTTPS physical-iPhone execution, and other
manual/device claims also require dated evidence. The phone audits use mocked WebLLM,
WebGPU, Cache Storage, and search boundaries and intentionally do not download model
weights; they are not substitutes for the physical-device release gate recorded above.
