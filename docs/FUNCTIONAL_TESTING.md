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
