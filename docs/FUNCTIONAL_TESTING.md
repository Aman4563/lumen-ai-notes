# Functional verification

Run `npm run check:release` for the deterministic release gate. It builds the
app and checks curriculum integrity, storage recovery, backup limits, request
contracts, model adapters, and browser workflows. Browser checks now start an
isolated app server automatically and continue after a failure so every suite
produces a result. Install Chrome or set `CHROME_PATH`. To check an already
running app, set `LUMEN_URL` instead.

The browser suites cover reading/editing, narration controls, annotations and
relocation, reviews and mistakes, imports, whiteboards and exports, backup and
restore, cross-tab sync, search, keyboard focus, mobile layouts, AI consent and
recovery, phone model lifecycle, diagrams, and stale application assets.
Synthetic speech/WebGPU fixtures check application behavior; they do not prove
audible output or GPU compatibility on a physical iPhone.

## Responsive regression checks

`npm run check:browser -- responsive` starts an isolated server and checks the
production build. Use `npm run audit:responsive` with `LUMEN_URL` to target a
running app. The same audit runs in the release gate and CI, which uploads its
JSON results and screenshots as `responsive-layout-results`.

The matrix covers 320, 360, 390, 430, 568, 768, 1024, 1280, and 1920px widths,
portrait and landscape, short viewports, and 200% text on phone and tablet.
Fresh browser profiles contain long document/collection names, unbroken links,
code, tables, notes, review cards, and AI history. The checks visit every main
route plus navigation, reader tools, teaching, whiteboard dialogs, annotations,
assessments, document dialogs, settings, and installation. They detect page
overflow, offscreen content, dialogs outside the viewport, an undersized
canvas, unreachable control centers, and uncaught browser errors. Wide code,
tables, and tool strips may scroll within a container that fits the viewport.

`LUMEN_LAYOUT_CASES=small-phone,phone-landscape` selects cases for diagnosis.
`LUMEN_LAYOUT_ARTIFACTS` chooses the results directory; by default it is
`lumen-responsive-results` in the OS temporary directory.
`LUMEN_LAYOUT_SCREENSHOTS=1` captures every surface, including passing checks.
An unfiltered run is required for acceptance. Short-viewport emulation checks
layout resilience; it does not reproduce a physical keyboard, Safari safe-area
behavior, or a real touch device.

The expanded checks also caught notifications intercepting narration taps and
dialog scroll locks unnecessarily rebuilding AI diagrams. Notification text
now lets taps through, narration notifications sit above the transport, and
diagram theme observers ignore unrelated root-style changes. The audio audit
checks the resume button's hit target; the AI audit opens settings, verifies
that the diagram survives, and switches the real theme setting. Both AI
renderers also keep the same sanitized HTML prop when the answer is unchanged,
preventing React from replacing completed diagrams during unrelated updates.

## Real model acceptance

Passing mocks does not prove that an installed model returns usable content.
Start Ollama with the configured model and run the integrated loopback server:

```sh
ollama serve
# In another terminal, after building:
npm run start:local-ai
# In another terminal:
npm run check:live
```

`check:live` runs three serial checks against `http://127.0.0.1:4187`:

- `audit:ai-live`: all ten tasks through JSON and NDJSON, plus Fast and Deep
  prose/structured cases. Uses the real browser client validators and rejects
  empty, incomplete, uncited, or malformed results.
- `audit:ai-live-ui`: all eight visible study modes with real inference; checks
  interactive quiz answers, card reveal/save, answer-to-notebook save, locked
  engine controls, mobile/wide layouts, and persistence after reload.
- `audit:ai-live-smoke`: unopened-library retrieval, real streamed answer bytes,
  inline citations, Markdown, display math, and a visible source panel.

For web-enabled deployments, also run `npm run audit:ai-live-search`. It checks
the exact-query gateway and real model tool use for prose and flashcards.
Docker/SearXNG must be running; unavailable search is a failure, not a skipped
success. Synthetic questions used by this audit are sent to search engines.
Set `LUMEN_SEARCH_QUERY` to reproduce a particular exact-query failure. The
default `Ollama` query checks available public evidence; it does not establish
that every engine or domain-qualified query works. On 2026-09-14 the stricter
`site:docs.ollama.com thinking message content` probe returned no usable
evidence: several upstream engines were blocked and Bing's results did not
match the requested domain. The gateway retains the user's exact query and
rejects unrelated results. Upstream availability remains a deployment limit.

The live checks use fresh browser profiles and never access the user's normal
Chrome profile. They require real local compute and can take several minutes.
Use `LUMEN_AI_PROFILES=deep` or `LUMEN_AI_TASKS=socratic` to narrow endpoint
diagnosis. Do not replace the full acceptance run with a filtered result.

## Bugs reproduced on 2026-09-14

- Deep Qwen generation consumed its full token budget on private thinking,
  then repeated the same failure on retry: no answer after 211.8 seconds.
  A bounded 768-token first pass now falls back once to direct completion.
  The equivalent live request completed in 35.5 seconds. Neither unfinished
  prose nor private thinking is accepted as a completed answer.
- Socratic and Interview source checks rejected questions without citations.
  Every grounded request now names its exact allowed source labels and
  requires citations for questions as well as claims. Socratic also has an
  explicit question format; Interview respects a request for one question.
  The live endpoint prompts deliberately contain no extra citation coaching.
- Flashcard repair repeated uncited JSON when only system instructions
  changed. A single explicit correction turn now requests the supplied labels
  in supported answers; the exact failing live prompt recovered. Both
  transports check the repair and keep unvalidated drafts out of the UI.
- Starting Ollama after opening the tutor left a failed readiness check stale.
  The visible page now retries the check; a manual refresh is also available.
- Mac engine switching could cancel an active answer; engine controls now lock
  during both Mac and phone operations.
- An unrelated app render reset highlight form fields because an unstable
  close callback retriggered initialization. The regression changes network
  state during editing and checks that the chosen color and comment survive.
- Completed AI history used the normal typing debounce and could be lost on
  an immediate reload. AI history now schedules a save without that delay;
  live acceptance verifies the IndexedDB commit and the restored answer.
- Mobile controls could overlap the fixed bottom navigation after reducing
  instruction text. The AI page reserves space and scroll margins for it.

Readiness still depends on the configured Ollama and optional SearXNG services
running. Physical Safari/WebGPU, iOS backgrounding, LAN pairing, and audible
narration require the device checks in [DEVICE_TESTING.md](DEVICE_TESTING.md).

## Verified checkpoint: 2026-09-14

Local Chrome and the configured `qwen3.5:4b` passed:

| Check | Result |
| --- | --- |
| Release gate | Build, static/PWA, unit, scale, storage, backup, retrieval evaluation, and all 11 browser suites passed |
| Final AI/data suite | 341 passed |
| Real endpoint matrix | 24/24 across ten tasks, JSON/NDJSON, and Fast/Balanced/Deep |
| Configured HTTPS endpoint | JSON and NDJSON responses passed with the local CA trusted by the client |
| Real browser workflows | 8/8 modes; quiz interaction, card/note saving, reload persistence; no runtime errors |
| HTTPS library smoke | Unopened-lecture retrieval, streamed response bytes, source links, Markdown/math rendering, and mobile layout passed |
| Real web paths | Exact `Ollama` query, streamed explanation, and structured flashcards passed with five returned sources |

The domain-qualified search limitation above remains reproducible; a passing
general search does not imply that every upstream engine is healthy. These
results also do not replace physical iPhone/WebGPU and audio evidence.

## Responsive checkpoint: 2026-09-15

The final implementation passed 342 AI/data tests, the curriculum, unit,
scale, storage, backup, retrieval, and production/PWA checks, and all 12
browser suites. The responsive suite passed 327 layout checks and 342 control
hit checks across all 11 configurations with no uncaught browser errors.
The visual audit was corrected to change the real theme setting and passed
on its focused rerun. CI runs the complete gate for the pull request.
