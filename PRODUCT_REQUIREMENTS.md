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
| LEARN-003 | Daily review queue with Again/Hard/Good/Easy scheduling | `Partial` | Durable local-day limits, four grades incl. direct Hard/Easy scheduling assertions, confidence, undo, bury/crunch/suspend queue exclusion, reload, spring-DST day keys, and explicit mutually exclusive queue classes (with overdue precedence) are tested; the calibrated complete-history scheduler remains |
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
| M1 | DATA-001 | `Partial` | Profile/backup v4 normalization; SHA-256/FNV integrity; restore preflight and recovery snapshot; v1-v3 compatibility; failure-injected fallback journal, tombstones, retry, and authoritative replacement | Independent stores and per-record schema versions; broader real-device migration/idempotence fixtures; complete concurrent-tab conflict evidence |
| M1 | DATA-002 | `Partial` | Usage/quota/persistence and last-backup health; profile/board/offline-cache breakdown; atomic 20 MiB/250-board backup-safe budget with typed failures; online-verified optional-cache cleanup; On-device Lite download/storage warning plus cache status/release/delete controls | Integrate measured WebLLM bytes into the main category breakdown; add audio/dataset categories when shipped; record Mobile Safari quota/eviction and model redownload evidence |
| M1 | DATA-003 | `Partial` | Recently opened document list and destructive-action confirmations | Local activity model, recoverable trash, document revisions/diff, and privacy-selective diagnostic export |
| M2 | PERF-001 | `Partial` | Metadata-only startup, 143 on-demand lecture chunks, separate search corpus, lazy Reader/Whiteboard/Mac AI/phone AI/WebLLM boundaries, proportional visited caching, single-index annotation paint, paginated review deck, automated 5k-highlight/10k-card/50k-attempt scale gates, and (2026-09-01) worker-side library search with a pre-normalized one-time corpus transfer, incremental custom-document updates, latest-wins correlation, main-thread fallback, and a 643-document worst-case scale gate | Physical-iPhone startup/interaction/memory/thermal budgets, including the optional phone model runtime |
| M5 | PERF-002 | `Partial` | Fast/Balanced/Deep budgets, live phases/heartbeats/cancellation, and several dated real-Qwen smokes with elapsed/token metadata | Define and measure versioned cold/warm p50/p95 time-to-progress, source-free time-to-first-token, grounded time-to-validated-answer, tokens/second, failure rate, memory, energy, and thermal SLOs on the reviewed Mac and physical iPhone |
| M3 | LEARN-001 | `Partial` | Anchored colored highlight creation, metadata, inline CSS painting, Reader/Notebook navigation and filtering, edit/delete, review conversion, persistence, and reload | Delivered 2026-09-01: deterministic relocation-semantics unit suite plus browser scenarios for relocation, orphan+relink repair, backup restore of annotations and linked cards, non-CSS-Highlight fallback, and Notebook copy/Markdown export. Remaining: decide whether relocated offsets should persist (cross-tab merge interaction) and record real-device evidence |
| M3 | LEARN-002 | `Partial` | Eight required item types; blank, clipping, annotation, and AI-card sources; exact duplicate detection; post-save edit/archive/restore; source provenance; safe Markdown/code preview | Add heading and mistake sources, MathML/Mermaid card preview, similarity-based duplicate review, and explicit backup-restore coverage |
| M3 | LEARN-003 | `Partial` | Deterministic due-before-new queue; durable local-day counters; four ratings with latency/confidence; pause, bury, undo, crunch; live clock; analytics/forecast; timezone/DST tests | Make overdue and learning queues explicit and mutually tested; replace the heuristic interval update with a calibrated complete-history scheduler and migration/evaluation evidence |
| M3 | LEARN-004 | `Partial` | Due, learning, mastered, suspended, and recent recall aggregates | Seven-state evidence ladder; review/assessment/lab/explanation evidence; concept/lecture/Part/role/prerequisite aggregation; state-change explanation and next action |
| M3 | LEARN-005 | `Partial` | Auto-capture from failed reviews with card/document links and derived categories, repeat merge with reopening, blur-committed corrections, category/corrected filters, corrective scheduling (due-now or new tagged card), 2,000-record bound, cross-tab merge, backup flow-through, a manual capture dialog with response/hints/category, per-category and most-repeated analytics, and unit + browser tests incl. sync-merge and backup round-trips | Assessment-driven capture (blocked on ASSESS-00x) |
| M4 | ASSESS-001 | `Backlog` | None | Versioned question schema, every required response type, scoring, explanation/source citation, retry behavior, and attempt persistence |
| M4 | ASSESS-002 | `Backlog` | None | Diagnostic/mastery pools, deterministic partial-credit rubrics, recommendations, and mastery/mistake integration |
| M4 | PLAN-001 | `Backlog` | Review queue is a prerequisite, not a learning-plan implementation | Goal/profile capture, prerequisite scheduler, 15/30/60-minute mixed sessions, reschedule/catch-up/pause, and missed-day recalculation tests |
| M4 | PLAN-002 | `Backlog` | None | Explicit opt-in, configurable quiet hours/categories/Focus behavior, predictable badges, denial/revocation paths, and ethical-copy review |
| M6 | LAB-001 | `Backlog` | None | Isolated Python worker, timeout/reset, curated packages/exercises, visible/hidden tests, hints/solutions/complexity, attempt storage, and cache-size gate |
| M6 | LAB-002 | `Backlog` | None | Local SQL engine, bounded dataset import, tables/plans/errors/result comparison, curated exercises, and persisted attempts |
| M6 | LAB-003 | `Backlog` | None | Safe parameterized ML/system simulations, intermediate-state visualizations, and explicit external-notebook handoff |
| M6 | INTERVIEW-001 | `Backlog` | Interview-oriented curriculum prose exists, but no product data model | Structured role/seniority/duration/concept/rubric mappings and coverage audit for every required track |
| M6 | INTERVIEW-002 | `Partially Implemented` | Timed interview rounds (30s prep / 2min answer countdowns) over a weak-first selection of interview-tagged and scenario/compare/debugging cards; misses log Interview-category mistakes linked to the card | Round templates per track, typed/recorded answers, rubric scoring, and per-dimension feedback |
| M2 | SEARCH-001 | `Partial` | Exact phrases, AND matching, ranking, Part/source filters, worker-side execution, one-edit typo tolerance for long terms, `-term` exclusions, saved searches (profile-synced) and device-local recents with one-tap chips, and highlighted snippets | Stemming/synonyms, field/content-type filters, and annotation/clipping/personal-note search within the unified library search (custom-document bodies are already searched via the worker) |
| M5 | SEARCH-002 | `Backlog` | None | Versioned embedding index, local/selected-provider controls, privacy/source disclosure, lexical evidence pairing, and relevance/privacy tests |
| M2 | GRAPH-001 | `Backlog` | None | Versioned concept/edge model, backlinks/path explanations, mastery overlay, weak-cluster UI, and integrity tests |
| M2 | CONTENT-001 | `Partial` | Custom-document tags, duplicate/delete, bookmarks, and editable local copies | Collections, rename/tag management, move/archive/restore/batch actions, revisions/diff, duplicate detection, and broken-link audit |
| M2 | CONTENT-002 | `Partial` | Bounded Markdown/text import, per-document Markdown export, and complete JSON backup path | Supported PDF/EPUB/HTML/GitHub import, selected HTML/PDF/JSON/card export, metadata preservation, lossy-conversion reports, and fixture tests |
| M5 | AI-001 | `Partial` | Integrated eight-mode Mac-local Qwen tutor (including code review) plus On-device Lite workspace; Library-first searches all 143 built-ins and the supported 500-document custom corpus, including authoritative edits and personal notes, then sends only bounded source-anchored passages; alternative current/selected/no-library scopes; confidence/provenance disclosure; token-live source-free prose and validation-buffered grounded prose; sanitized GFM + KaTeX Markdown; lazy source-preserving Mermaid rendering in reader, teaching, and completed prose surfaces; validated dedicated structured-result components; Fast/Balanced/Deep response profiles; deterministic visible conversation compaction; cancellation/retry; AI cards remain labeled drafts; answers can be saved as labeled AI-origin notebook clippings with durable provenance; phone structured-field and Mac structured-field citation labels are navigable; personal-note citations focus the exact note editor | Enforce and evaluate claim-level source support rather than only answer-level citations; decide whether derivation/analogy/challenge need distinct UX; strengthen unsupported-inference UX; run versioned grounded-answer/interview-quality evaluations across real Mac and phone models; record physical-iPhone evidence |
| M5 | AI-002 | `Partial` | Zero-paid-API architecture: fixed Ollama/Qwen host model with operator-pinned digest verification, optional pinned WebLLM/Llama phone model, no client/provider key or arbitrary provider/model URL path, stateless application server, canonical profile-aware UTF-8 input fitting plus bounded output/NDJSON streaming with cancellation/backpressure/deadlines, no returned provider thinking, capability probes, exact-origin/Host controls, private-LAN HTTPS/config attestation, a remembered local-only disclosure acknowledgement separated from one-request web authorization, history clear, verified phone cache deletion, session-only phone history, a saved no-AI preference that hides AI surfaces, configurable Mac history retention (50/25/10/session-only with immediate tombstoned trims), a Deep profile gated on attested model thinking support on both server and UI, and opt-in learner pairing (HMAC sessions, constant-time codes, pairing rate limit, fail-closed non-loopback startup) | Surface measured token/latency/energy budgets; record physical multi-device pairing evidence on a real LAN; and record trusted-HTTPS physical-iPhone model evidence |
| M5 | AI-003 | `Partial` | Pinned and hardened self-hosted loopback SearXNG; Library-first gates any consented Mac fallback on time-sensitivity or insufficient local confidence; one schema-validated `search_web` tool plus bounded approved-question fallback/refinement when Qwen skips or empties the planned query; exact query-only phone gateway with a deterministic proposal when the 1B planner vetoes or fails; query/result/body/round/time/URL bounds; feature-query lexical relevance filtering; no result-page fetch; canonical URL deduplication and transparent lexical/domain/recency reranking; sanitized retained evidence; mandatory resolved searched-answer citations; one buffered structured citation-repair attempt; phone exact-query one-shot approval; typed empty-evidence/ungrounded failures | A versioned deterministic retrieval-quality/adversarial-query suite now gates `npm run check` (`eval/fixtures/v1`, `audit:ai-eval`); still open: model-level claim/recency/citation-quality evaluations on the pinned models, upstream-engine degradation measurement, a user-editable Mac-local planned-query confirmation if exact-query approval is adopted there, and physical-iPhone search evidence |
| M5 | AI-004 | `Partial` | Strict NDJSON ordering/terminal checks, source-free token delivery, grounded/schema buffering, Stop/cancellation, bounded Markdown display, DOMPurify GFM/KaTeX, deferred sanitized Mermaid, theme rerender, and malformed-diagram diagnostics pass automated unit/browser audits | Define response-latency SLOs; verify VoiceOver/live-region behavior and Mobile Safari rendering/cancellation; add a real-host update/interruption matrix; decide and document whether any provisional grounded draft may ever be displayed |
| M8 | SYNC-001 | `Backlog` | Same-origin tabs now use atomic record-aware profile reconciliation, recovered conflict notes, monotonic reset/restore generations, and board merge foundations; this is local concurrency, not cross-device sync | End-to-end encryption, device authorization/recovery, selective cross-device sync, device removal/deletion/export, visible revision history, and adversarial recovery tests |
| M7 | TEACH-001 | `Partial` | Automatic section slides, navigation, timer, recall concealment, narration, text sizing, swipe/keyboard, and fullscreen | Authored ordered decks, speaker notes, audience-safe view, reusable templates, remote controls, AirPlay evidence, and PDF export |
| M8 | COLLAB-001 | `Backlog` | None; intentionally depends on verified synchronization | Explicit-item sharing, owner/editor/viewer permissions, revocation, moderation, audit history, and conflict/privacy tests |
| M7 | BOARD-001 | `Partial` | Single select/move, recolor, stroke-size change, duplicate/delete, and undo/redo | Multi-select/lasso, geometry resize, rotate, group, lock, layers/order, copy/paste, snap/guides, and touch/keyboard tests |
| M7 | BOARD-002 | `Backlog` | Primitive text, sticky, arrow, and shape objects do not satisfy this requirement | Attached connectors, formula/Mermaid/image/table/mind-map/frame/templates, source links, sticky-to-review conversion, import safety, and persistence tests |
| M7 | BOARD-003 | `Backlog` | Multi-page navigation and PNG export predate the listed acceptance set | Zoom/pan, optional infinite canvas, minimap, text search, PDF/SVG export, board import, and large-board performance tests |
| M7 | AUDIO-001 | `Partial` | iOS-reported voices grouped by language; on-device/network disclosure; async refresh and preview; persisted voice/language/rate/pitch/volume/scope; sentence/section/selection/document queues; presets; pause/resume/stop/previous/next; foreground-safe interruption recovery | Spoken-sentence highlighting, precise persisted resume, heading skip, bookmarks, sleep timer, required playlists, pronunciation overrides, and physical-iPhone voice/routing/interruption tests |
| M7 | AUDIO-002 | `Backlog` | None | Provider/voice/cost/privacy disclosure, generated-file storage/download/delete, offline independence, and DATA-002 quota integration |
| M0/M7 | A11Y-001 | `Partial` | Accessible-name/touch checks, focus-visible styles, text controls, themes, and reduced-motion CSS | VoiceOver/manual WCAG 2.2 AA evidence, rotor/dialog/status/chart/diagram checks, robust large-text, contrast/color-blind modes, and non-drag whiteboard alternatives |

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
headroom, cache/load state, and release/delete controls. The main breakdown does not
yet measure WebLLM cache bytes, and Mobile Safari eviction/redownload evidence remains.

Acceptance criteria:

- Show estimated usage, quota, persistence, and last successful backup.
- Break down curriculum cache, documents, boards, audio, datasets, and local models.
- Allow safe removal and redownload of optional assets.
- Warn before large downloads and gracefully handle quota errors.

### DATA-003 — Activity and recovery history

Status: `Partial`

Delivered slice: recently opened documents and destructive-action confirmations.
There is no study-event ledger, recoverable trash, revision history, or
privacy-selective diagnostics export yet.

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
Custom-document bodies already participate through the worker; stemming/synonyms,
field/content-type filters, and annotation/clipping/personal-note search within
the unified library search remain open.

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

Status: `Backlog`

Acceptance criteria:

- Represent concepts, prerequisites, related concepts, formulas, labs, questions, and documents.
- Provide backlinks and explain blocked/recommended learning paths.
- Overlay user mastery and weak clusters.

### CONTENT-001 — Collections, tags, archive, and document history

Status: `Partial`

Delivered slice: custom-document tags, duplicate/delete, bookmarks, and editable
local copies. Collections, complete rename/tag management, move/archive/restore,
batch actions, revisions/diff, duplicate detection, and broken-link checks remain open.

Acceptance criteria:

- Create folders/collections; rename, tag, move, archive, restore, and batch-manage documents.
- Keep local document revisions and provide side-by-side comparison.
- Detect likely duplicates and broken internal links.

### CONTENT-002 — Rich import and export

Status: `Partial`

Delivered slice: bounded Markdown/text import, per-document Markdown export, and
versioned application JSON backup. The remaining formats, selected exports, metadata
preservation, lossy-conversion reports, and format fixtures remain open.

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
