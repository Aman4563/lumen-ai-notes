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

The matrix covers 320, 360, 390, 430, 568, 768, 1024, 1225, 1280, and 1920px widths,
portrait and landscape, short viewports, and 200% text on phone and tablet.
Fresh browser profiles contain long document/collection names, unbroken links,
code, tables, notes, review cards, and AI history. The checks visit every main
route plus navigation, reader tools, teaching, whiteboard dialogs, annotations,
assessments, document dialogs, settings, and installation. They detect page
overflow, offscreen content, dialogs outside the viewport, an undersized
canvas, unreachable control centers, and uncaught browser errors. Wide code,
tables, and tool strips may scroll within a container that fits the viewport.

The `embedded-preview` and `theme-phone` cases also check the document canvas,
vertical scroll bounds, and navigation after scrolling a long page. They cover
Paper, Night, Contrast, and both light/dark System themes, collapse AI request
details, and resize a scrolled preview or rotate a phone. The preview matches
the editor screenshot's content dimensions in Chrome; production framing
protections stay enabled. These 80 checks catch theme gaps and stale scroll
positions that horizontal overflow checks miss. Native macOS rubber-band
animation still requires a manual check in the editor browser.

The cross-tab suite also keeps mobile navigation open while a second tab saves
a theme change. This reproduces the background-save race that previously
dismissed the menu when the document map was revalidated.
The responsive suite forces offline/online updates while a readiness control
has focus, then verifies Escape removes the dialog before testing other routes.

`LUMEN_LAYOUT_CASES=small-phone,phone-landscape` selects cases for diagnosis.
Use `LUMEN_LAYOUT_CASES=embedded-preview,theme-phone` for the scroll/theme cases.
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
Review and mistake dialogs likewise initialize only when opening a new draft;
background app updates retain their text and category. The review audit forces
an offline/online update while editing to reproduce this previously intermittent
failure. Layout measurements wait for finite entrance animations to settle.

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

The initial implementation passed 342 AI/data tests, the curriculum, unit,
scale, storage, backup, retrieval, and production/PWA checks, and all 12
browser suites. The responsive suite passed 327 layout checks and 342 control
hit checks across all 11 configurations with no uncaught browser errors.
The visual audit was corrected to change the real theme setting and passed
on its focused rerun. CI runs the complete gate for the pull request.

The screenshot follow-up passed 407 layout/theme checks and 342 control hit
checks with no uncaught browser errors, including the new readiness focus
regression at all 11 screen/text configurations. Workflow and cross-tab suites
passed with the navigation fixes; visual, controls, and AI UI checks also passed
during this follow-up. Both the menu-dismissal and readiness-focus regressions
were first reproduced against the preceding builds.

## Bugs reproduced on 2026-09-24

Reader audit (issue #53) on 320–430 px phones, a 768 px tablet, and 1024–1920 px
desktops in Paper, Night, and Contrast:

- On a phone, Clip, Highlight, and Ask AI existed only in the tool row at the
  top of the lecture, about 7,400 px above a mid-lecture selection, and the row
  scrolled Whiteboard and Actions off-screen with no cue. A selection now shows
  a toolbar (Highlight, Clip, Ask AI, Listen) pinned above the bottom
  navigation, and the tool row wraps.
- The closed phone outline/notes/highlights sheet kept 26+ off-screen controls
  in the Tab order and accessibility tree. Closed, it is now inert and hidden;
  open, it is a modal sheet (focus moves in, Tab wraps, Escape closes, focus
  returns). The same modal contract now covers revision history.
- A tutor citation opened the right lesson, but restoring the saved reading
  position cancelled the scroll to the cited section. A pending navigation
  target now owns the first scroll and stays pinned while diagrams render.
- Night theme drew the browser's button face under narration targets and
  highlight cards; the selected target measured 1.13:1. Those controls now
  draw their own theme colors.
- Phone Mermaid labels shrank to 4.8 px, and every diagram was announced only
  as "Rendered Mermaid diagram". Wide diagrams now keep 72% of their natural
  size and scroll inside their frame with an edge cue. Each accessible name
  lists nodes and edges from the preserved source.
- The minutes-left chip sat under the sticky toolbar; it now sits beside the
  progress percentage. Line length changed nothing below 1440 px; it now sets
  the text measure and explains when the window caps it. Below 1240 px the
  outline starts hidden, and Table of contents shows or hides it.
- Teaching Mode's focus trap counted controls hidden on phones, so Tab stuck on
  Next section and Shift+Tab left the dialog. The trap now uses rendered
  controls; the section picker and timer are back on phones.
- Editor Reset discarded unsaved typing without asking. It now confirms in the
  app and keeps the unsaved draft as its own revision. History markers now
  match what Load into editor restores or removes.
- Narration's Read button was below the fold; on a 320 px phone it sat 246 px
  below the sheet. It now follows the target picker, the sheet takes focus, and
  the mini player gives the sentence its own row.
- Wide code and tables could not be focused for keyboard scrolling, and cells
  split words at 135% text. They are now focusable named groups with edge cues,
  and cells keep whole words. Lecture text follows the browser text size, and a
  text-size change keeps the current passage in place.
- TeX in edited copies and uploads stayed raw. The reader now lazily loads the
  sanitized KaTeX path only for sources with TeX outside code.

Review of those fixes reproduced three follow-up bugs, now fixed:

- Export HTML printed every formula twice (the MathML and the unstyled KaTeX
  HTML). The export now shows the MathML copy only.
- A personal-note citation opened its lecture at the top instead of the saved
  reading place (0.00 against a saved 0.50), because the citation skipped the
  position restore without scrolling anywhere itself.
- During the re-anchoring hold after a text-size change or citation, late
  layout pulled Back to top, Find, outline, and narration jumps back to the old
  passage (scrollTop 9,097 after Back to top). Those jumps now end the hold.

Each fix has a regression check in the workflow, annotation, audio, control,
responsive, AI UI, or unit suites. The citation check fails on the previous
build: the cited heading was focused but 4,507 px below the viewport.

## Whiteboard bugs reproduced on 2026-09-24

Touch-emulated Chrome at 320–852px wide and desktop at 1280px reproduced
these defects before the fix (issue #55):

- On touch, Text and Sticky note opened their dialog and closed it at once:
  the tap's compatibility click landed on the new scrim. Placement now runs
  on the click that ends the tap; the workflow audit taps at 20% height.
- Points were fractions of whatever canvas showed them, so a square drawn on
  a phone became a 2.4:1 rectangle on a Mac. Pages now keep their authoring
  size and are letterboxed with one uniform scale. Legacy boards adopt the
  canvas they are first shown on without rewriting any point.
- Edge moves, nudges, and duplicates clamped each point and squashed shapes,
  rotated ones included, whose stored points clamped even when the turned
  shape still fit. The whole selection now moves by one delta, limited by
  both its rotated footprint and its stored points.
- The phone toolbar was a 1,228–1,480px strip with Undo, Redo, and Zoom off
  screen; landscape showed 13–73px of canvas above the bottom navigation.
  The responsive audit now measures the visible canvas, not the element box.
- Board chrome kept light colours in Night (1.85:1 actions); tools, colours,
  and backgrounds had no pressed state; objects could not be selected by
  keyboard; Delete acted from the page select and behind open dialogs.
- The eraser cut holes in the grid, wrapped text could only be selected by
  its first line, sticky notes hid overflow silently, placed text could not
  be edited, and SVG export scaled text and strokes differently from PNG.
