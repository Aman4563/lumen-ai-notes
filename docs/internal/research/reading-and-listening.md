# Reading, annotation and listening: what the best tools do, and what Lumen should take

> Repository copy prepared on 2026-10-22 for `docs/internal/research/`. Local paths to captures, probes and clones are replaced with "captured locally (not committed)"; screenshots are not included. REA evidence ids and citations are unchanged; code references (`path:line`) are to `main` at `01c7a89`, the research baseline, unless the text names another commit. Candidate ids in this report (N1, G1, Gap 1, …) are its own; `SYNTHESIS.md` maps every one of them to an issue draft, an existing issue, or a recorded deferral.


Research date: 2026-10-22. Lumen baseline: `main` at 01c7a89 (all `path:line` references are to `src/` on that commit).

Scope: Readwise Reader and Readwise, NotebookLM (now branded "Gemini Notebook"), Speechify,
Kindle, Apple Books with Safari Listen to Page and iOS Read & Speak, Omnivore (open source),
plus two additions: Matter (eyes-free highlighting while listening) and LingQ (vocabulary state
while reading).

Evidence conventions:
- `REA ev_xxxxxxxx` is a `capture_browser_scenario` run (headless Chrome 156, accessibility tree
  plus final URL) or an `analyze_javascript_application` run. The first eight hex digits are quoted
  here; the full ids, URLs, artifact hashes and a one-line digest of each capture are in an evidence
  ledger, and paraphrased page notes were kept alongside it (both captured locally, not committed).
- "Secondary" marks a fact taken from search-engine snippets or third-party pages rather than a page
  this study loaded.
- Gap classes: **existing** (already in `src/`), **issue #N** (an open GitHub issue already specifies
  it), **new** (found in neither `src/`, `docs/`, nor any open or closed issue).

---

## Method and boundaries

**Tools.** REA was the primary tool: 25 browser captures (accessibility trees, which carried all the
text evidence, so no screenshots were needed) and 2 static analyses of Omnivore source. WebSearch was
used for URL discovery and literature; nothing was fetched from a page that robots.txt disallows.
Omnivore was shallow-cloned (clone captured locally, not committed)
and read with grep/sed only (no install, build or execution). Nothing in the Lumen repository was edited;
issue data came from `git gh issue list/view` (41 open, 32 closed).

**robots.txt and load budget (every host checked before loading).**

| Host | robots.txt verdict | Pages loaded |
|---|---|---|
| docs.readwise.io | `Allow: /` | 5 |
| support.google.com | only `/*/search`, `/*/api*` disallowed | 5 |
| speechify.com | Claude-User allowed except `/api/`; `/onboarding/` and `?landing=` avoided | 4 |
| support.apple.com | only search, product docs and PDF manuals disallowed | 4 |
| mcmw.abilitynet.org.uk | no robots.txt (404) | 1 |
| kdp.amazon.com | `User-agent: *` allowed (images only disallowed) | 2 |
| www.aboutamazon.com | `User-agent: *` allowed, `Crawl-delay: 10` (sequential runs were far slower) | 1 |
| www.getmatter.com | no rules | 1 |
| lingq-support.groovehq.com | `/help` explicitly allowed | 2 |
| **www.amazon.com** | **`Disallow: /` for Claude-User, ClaudeBot, Claude-Web, Claude-SearchBot** | **0 (not loaded)** |
| digprjsurvey.amazon.com (Kindle help) | robots.txt returned an error page | 0 (not loaded) |
| github.com | `git clone --depth 1` plus one unauthenticated API call | n/a |

No login, account, paywall or CAPTCHA was touched. Kindle features are therefore documented from
robots-permitted author-side KDP help, Amazon's news site, and secondary sources, and are labelled
"not directly observed".

**Facts that differ from the brief.**
- NotebookLM's help centre now redirects `support.google.com/notebooklm/*` to `/gemininotebook/*`
  and calls the product "Gemini Notebook" (REA ev_36090667).
- The Omnivore repository is **not archived**: the GitHub API reports `archived: false`, last push
  2026-10-22 (commit 9060477, "fix: fix .env issues"). The hosted service closed in 2024; the repo
  still receives self-hosting commits. Licence: AGPL-3.0 (one package's `package.json` says
  Apache-2.0; treated as AGPL throughout). No Omnivore code is reproduced here.
- Apple's iPhone User Guide is already on iOS 27, and iOS 26+ adds an "Accessibility Reader".

---

## 1. Readwise Reader and Readwise

### Features that matter most for a self-directed learner
1. **Near-zero-cost capture**: auto-highlighting, keyboard paragraph focus (H to highlight), stylus
   highlighting on touch, drag handles to resize or merge highlights.
2. **Resurfacing that turns highlights into retrieval**: Daily Review, Mastery cards (cloze and Q&A),
   per-source frequency tuning, Themed Reviews, and listening to a review.
3. **Ghostreader prompts scoped by selection size**: define-in-context and "internal x-ray" for 1-3
   words, simplify/expand for passages, "Pick up where I left off", questions before reading and
   takeaways after.
4. **Quick Lookup**: a bottom sheet that explains a 1-3 word selection without leaving the page.
5. **Learner-led text-to-speech**: follow-along that yields to the reader's scrolling, with Return and
   Jump, and headphone gestures that can create highlights.

### How they work (observed)
- **Highlighting** (REA ev_0fa4b91b). On the web, Up/Down move a focus ring paragraph by paragraph;
  H highlights it, T tags, N notes; notes and tags show in the margin on wide screens. Keyboard
  highlighting is paragraph-only ("on our roadmap" to go finer). Auto-highlighting turns any selection
  into a highlight at once (toggle: Shift+H on web, the ... menu on mobile; Alt/Option suspends it
  to copy). Highlight boundaries are adjusted, or two highlights merged, by dragging handles. Reader
  **deliberately has no highlight colours**: users who treat colours as a system are told to use
  highlight tags instead. Highlight tags and document tags are separate; a per-tag notebook view lists
  highlights by document with arrow-key navigation and Markdown export through an editable template;
  on mobile a document icon jumps from a highlight to its place in the source.
- **Daily Review** (REA ev_87e0cfcc). Frequency Tuning per source type or per document (from settings,
  the library row, or the review card). Selection is weighted by highlight count, and each showing
  sharply lowers a highlight's resurfacing probability. Review Mode shows one highlight at a time and
  prioritises unprocessed ones; arrows only skip, Keep/Discard process. Defaults: a "Highlight Quality
  Filter" (on) keeps sentence fragments out of reviews; a bonus recommendation card (on). Mastery uses a
  decaying recall-probability half-life rather than dates: initial half-life 7 days (Soon), 14 (Later)
  or 28 (Someday); a card becomes a candidate once predicted recall falls to 50% or below, lowest first,
  in the second half of the review. A play button reads the whole review aloud with speed and 15 s
  jumps; the docs suggest Themed Review + audio as "your own highlight-based podcast". Markdown inside a
  highlight supports a "hyperhighlight" (`__text__`) for the one line that mattered.
- **Ghostreader** (REA ev_a1d667dc). Word-level prompts (1-3 words): dictionary definition sent with the
  surrounding sentence as context; encyclopedia lookup; "Internal x-ray" (what the term means *in this
  document*, e.g. "monotonically" in a maths text); translation. Paragraph-level (>3 words): simplify,
  expand a core concept briefly "so you return to reading", "Pick up where I left off" (summarises the
  chunk before your position). Document-level: three questions to ask before reading; key takeaways
  from your own highlights and notes after reading. Automatic summary on save (on); auto-tagging is
  experimental and off by default. Default model GPT-5 Mini; prompts are editable templates.
- **Quick Lookup** (REA ev_6d327f46). Mobile only, on by default for 1-3 word selections: a panel slides
  up with Define / Lookup (in context) / Translate tabs and opens on the most relevant one. Nothing is
  saved unless the reader taps Highlight, which saves the selection with the explanation as its note.
  Needs a connection.
- **Text-to-speech** (REA ev_8f0f2461). Play starts at the paragraph centred on screen. Pause keeps the
  bar and place; Stop hides it and forgets. When the reader scrolls, auto-follow stops and the 15 s
  buttons turn into **Return** (scroll back, resume following) and **Jump** (restart playback where the
  reader is now). Headphone gestures: double tap = jump forward, triple tap = jump back by default; either
  can be remapped to "highlight". Keys: P, Shift+P, arrows, comma/period for speed. **TTS cannot work
  offline** (speech is generated on request).

### Learning-science reason
- Highlighting by itself is a low-utility technique (Dunlosky et al., 2013). A meta-analysis found
  learner-generated highlighting improves memory modestly (g = 0.36) but not comprehension (g = 0.20,
  n.s.), while instructor-provided highlighting helps both (g = 0.44) (Ponce, Mayer & Méndez, 2022).
  Readwise's real learning engine is therefore what happens *after* capture: spaced re-exposure
  (Cepeda et al., 2006) and conversion into retrieval prompts (testing effect; Roediger & Karpicke, 2006;
  Karpicke & Blunt, 2011). Resurfacing near the forgetting threshold is a desirable difficulty.
- The quality filter is sound: fragments make poor retrieval cues.
- Ghostreader's "questions before reading" are prequestions, which improve later learning of the
  answered content (Richland, Kornell & Kao, 2009; review in Pan & Carpenter, 2023). "Expand" is
  elaboration (elaborative interrogation: moderate utility, Dunlosky et al., 2013). "Pick up where I
  left off" reactivates prior material; it would be stronger as retrieval-first (forward testing effect:
  Chan, Meissner & Davis, 2018; Yang, Potts & Shanks, 2018).
- Yielding auto-scroll to the reader preserves learner control; Return keeps position tracking (a
  signalling function) without fighting the learner.

### Fit for Lumen
- Lumen already exceeds Readwise on annotation structure (four colours **and** four purposes, comments,
  tags; `AnnotationDialog.jsx:5-17`), converts highlights to cards including cloze (`App.jsx:2409`,
  `review.js:447`), and schedules with FSRS, which is more transparent than Readwise's half-life model.
- Lumen's device voices work offline, which Readwise's TTS cannot: keep that as a selling point.
- Gaps: capture friction (Lumen always opens a dialog: `Reader.jsx:908-914`), resurfacing (#116),
  Return/Jump (#101), size-scoped lookup (#117 plus new #161), and a resume primer (new N5).
- Ghostreader runs on a paid cloud model; in Lumen the equivalents must come from the local tutor (Mac or
  On-device Lite) or from deterministic data (glossary, chapter questions).

---

## 2. NotebookLM (help centre now "Gemini Notebook")

### Features that matter most for a self-directed learner
1. **Source-grounded chat** with quote citations that open in context, and a choice of which sources answer.
2. **Audio Overviews** in four formats, with length, language and a focus prompt, and an interactive
   mode in which the listener joins the conversation.
3. **Flashcards and quizzes** generated from sources, with difficulty, an Explain button and "only the
   cards you missed".
4. **Mind maps and reports** (study guide, briefing, interactive "Learning Overview") as overviews.

### How they work (observed)
- **Chat** (REA ev_d6598a4e). Answers cite "direct quotes, text, and images" from sources; hovering a
  citation shows the full quote and selecting it opens the quote in context. The learner selects which
  sources the model may use; answers come only from sources. Styles: Default, **Learning Guide** ("for
  educational content"), or a custom role; response length is configurable. Save to note keeps tables and
  clickable citations. Mobile offers a live voice conversation (18+).
- **Audio Overview** (REA ev_36090667). Formats: Deep Dive (default; two hosts), **The Brief** (one
  speaker, key takeaways "in under two minutes"), The Critique, The Debate. Options: 80+ languages,
  Shorter/Default/Longer (English only), and a prompt to focus topics or adjust the expertise level.
  Generation runs in the background; the listener can browse quotes and citations while listening;
  playback speed and thumbs feedback; "View custom prompt" on earlier overviews. **Interactive mode**:
  tap Join, ask by voice when the hosts call on you; they answer from the sources and then resume the
  overview (English only, new overviews only, voice not stored).
- **Flashcards and quizzes** (REA ev_c53ebef7). Difficulty easy/medium/hard and a free prompt; count
  fewer/standard/more; Explain on any card or answer; flashcards are self-marked "Got it!" or "Missed it!"
  and progress is remembered; at the end, practise Same / All / Only cards you missed; quizzes add Hint;
  CSV download. No spaced scheduling is described.
- **Mind maps** (REA ev_bba4019a). Branching overview generated from a chat chip and saved as a note;
  expand/collapse branches; tap a node to ask about it. **Not supported in the mobile app.**
- **Reports** (REA ev_2b1f0886). Interactive reports (web only) use a "Learning Overview" template that
  embeds suggested artifacts; document reports use templates whose names the page does not list
  (secondary: Briefing Doc, Study Guide with key terms, a short-answer quiz with answer key and essay
  questions, Blog Post, custom). Every surface carries an inaccuracy warning.

### Learning-science reason
- Grounding plus inspectable quotes supports verification and calibrated trust, which matters when an
  AI explains technical material.
- Conversational audio draws on the personalisation principle: conversational style improved retention
  (d = 0.30) and transfer (d = 0.54), but effects were small and non-significant in sessions over about
  35 minutes (Ginns, Martin & Marsh, 2013). Short formats are the right default. Modern synthetic voices
  need not cost learning relative to a human voice (Craig & Schroeder, 2017).
- The modality effect is largest for short, system-paced material (Ginns, 2005; boundary conditions in
  later re-analysis), which suits short audio summaries but not long technical lectures, where learner
  pacing and visible text matter.
- Interactive mode puts the learner's own questions at the point of need (generative, self-explanation).
- Flashcards give retrieval practice, but binary within-session marking without spacing forgoes the
  spacing benefit (Cepeda et al., 2006).
- Mind maps and study guides act as advance organisers and signalling; reading a generated summary is
  still passive (Dunlosky et al., 2013 rate summarisation and rereading low).

### Fit for Lumen
- **Existing:** grounded `[S1]` citations and source scope (Library first / Current lesson / Choose
  sources / No library, `AiTutor.jsx:222-225`); AI quiz and flashcards with confidence, misses saved to
  the mistake notebook and FSRS scheduling, which is stronger than NotebookLM's binary flashcards.
- **Issues:** The Brief maps to #125/#131 (recaps), Deep Dive to #126 (assembled, labelled guided lesson),
  Interactive mode to #124, Critique to #121 (teach-back), non-AI flashcards to #113.
- **New:** a deterministic lecture study sheet (#159) and a section map with learner state (#160), which
  would also cover NotebookLM's mobile gap.
- NotebookLM is cloud Gemini with server-rendered audio; Lumen must use Ollama or WebLLM and device or
  Mac voices. #126's decision not to have the model script a two-host dialogue keeps every spoken line
  traceable, which the research supports.

---

## 3. Speechify

### Features that matter most for a self-directed learner
1. Speed control with **automatic speed ramping**.
2. Word and line highlighting, **tap a word to start there**, 15 s skips.
3. **Enhanced Skipping** of content categories.
4. Highlights and notes (added September 2025).

### How they work (observed)
- **Skipping** (REA ev_7fe9fda0, 2025-09-16). One "Enhanced Skipping" switch, or per-category toggles:
  headers, footers, footnotes, braces, citations, parentheses, brackets, URLs (iOS/Android ... menu; web
  Settings). The article's own embedded player defaults to **1.2×**.
- **Playback** (REA ev_747c989a, iOS help). 15 s rewind/forward per tap; scroll and tap any word to
  start reading there; lines and words highlighted as read.
- **Speed** (REA ev_5db2749b, vendor blog 2026-03-27). Automatic ramping raises speed "slightly every few
  minutes or after a set amount of text"; claimed ranges 200 to 900 wpm (marketing, no study cited); the
  blog concedes that dense material may need slower speeds. Secondary: the App Store listing claims up to
  4.5× (900 wpm).
- **Notes** (REA ev_c8121e03, 2025-09-15). Select or drag across text, choose a colour, Add a Note; review
  everything under Pencil > Highlights & Notes. No way to highlight the spoken sentence is described.

### Learning-science reason
- **Speed:** for 13-15 minute lecture videos, 1.5× and 2× cost little comprehension while 2.5× did
  (Murphy et al., 2022); the authors caution that complexity changes this. A 2× ceiling is defensible;
  ramping is plausible but unstudied.
- **Listening versus reading:** across 46 studies the difference was not reliable (g = 0.07), but
  self-paced reading beat listening (g = 0.13) (Clinton-Lisell, 2022). Reading while listening added only
  a trivial benefit (g = 0.18), and none when reading was self-paced (Clinton-Lisell, 2023). Follow-along
  highlighting earns its place as position tracking and signalling, not as a comprehension booster; in
  technical instruction, redundant on-screen text alongside identical speech can even interfere
  (Kalyuga, Chandler & Sweller, 2004).
- **Skipping** applies the coherence principle (remove extraneous material; Mayer, 2021). In technical
  prose, though, parentheses often carry definitions, so skipping must be opt-in.

### Fit for Lumen
- **Issues:** speeds to 2× and the ramp are #102 (its 0.05× every 2 minutes matches Speechify's
  description); tap-to-start and word highlighting are #101; code and table handling is #100.
- **New (low):** further skip rules (#162).
- Speechify's HD voices are cloud and paid; Lumen stays on device voices, with #129 (Mac `say`), #132
  (Kokoro on the Mac) and the #130 on-device spike as upgrade paths.

---

## 4. Kindle (from robots-permitted KDP help, Amazon's news site and secondary sources; not directly observed)

### Features that matter most for a self-directed learner
1. **Popular Highlights**: passages that many readers marked.
2. **X-Ray** and **Word Wise**: term explanations in place, with adjustable hint density.
3. **Vocabulary Builder**: every look-up saved with its sentence, practised as flashcards.
4. **Assistive Reader**: TTS with word highlighting.
5. **Recaps / Story So Far** and **Ask this Book**, both scoped to the reader's position.

### How they work
- **X-Ray** (REA ev_c6a66b92, KDP). Press and hold a term to learn about "a character, topic, event,
  place, or any other term". Entries are generated from public sources, machine learning, manual review
  and book excerpts, then curated or rewritten by authors; English only. (Secondary, not verified here:
  X-Ray also lists the passages where an entry occurs.)
- **Recaps** (REA ev_9c088197, KDP). A "Previously on…" refresher of the last book in a series, created
  by Amazon with moderators; always on.
- **Story So Far and Ask this Book** (REA ev_b57a90a0, aboutamazon.com, updated 2026-07-02). Story So Far
  recaps the book "up to where you've read" from a Read recap button or the in-book menu. Ask this Book
  answers questions on plot, characters and themes up to the current reading position (whole-book scope
  optional), starting from a highlighted passage, with suggested questions and follow-ups. US, best-selling
  English titles.
- **Secondary:** Vocabulary Builder saves each looked-up word with its dictionary entry and the sentence
  where it was met, offers flashcards with "See Definition" and "Mark as Mastered", and has no spaced
  repetition (users export `vocab.db` to Anki). Popular Highlights underline passages where at least three
  distinct readers' highlights overlap, anonymously. Word Wise shows short hints above harder words, with a
  slider for more or fewer hints. Assistive Reader offers play, pause, speed, skip back 30 s and word
  highlighting, and **pauses automatically when a highlight or note is created**.

### Learning-science reason
- Popular Highlights is crowd signalling. For an authored curriculum, the stronger analogue is the
  author's own signalling: instructor-provided highlighting outperformed learner highlighting on both
  memory and comprehension (Ponce et al., 2022), and signalling cues aid retention (Schneider et al., 2018;
  Richter, Scheiter & Eitel, 2016, r = 0.17).
- Glosses and look-ups support incidental vocabulary learning, especially when words recur (Hulstijn,
  Hollander & Greidanus, 1996). Fading hints as the learner improves follows the expertise reversal effect:
  support that helps novices can hinder experts (Kalyuga et al., 2003). Saving the context sentence gives
  each later retrieval a cue; Vocabulary Builder's lack of spacing is its weakness.
- Recaps reactivate prior learning before new learning; a retrieval-first recap would add the forward
  testing benefit (Chan et al., 2018; Yang et al., 2018).
- Position-scoped answers keep explanations within what the learner has read, which in a curriculum
  means within prerequisites already met.

### Fit for Lumen
- **Issue:** #117 covers tap-to-define for glossary terms.
- **New:** look-up history, "where else it appears" and known-term fading (N7); author-signalled key
  passages (N8); a resume primer (N5). Position scoping is a small refinement for #124/#125.
- Kindle's AI features are cloud; Lumen's must be deterministic or use the local tutor.

---

## 5. Apple Books, Safari Listen to Page and iOS Read & Speak

### Features that matter most for a self-directed learner
1. **Safari Listen to Page**: sentence skip, speed, background play with lock-screen controls.
2. **Read & Speak**: Speak Screen, Speak Selection, word/sentence highlighting, Speak on Touch, and a
   Pronunciations editor.
3. **Accessibility Reader**: reading themes with spacing presets, high-legibility characters and a
   playback scrubber.
4. **Books**: one-tap highlighting, a highlights list, search from a selection, "go back to previous
   location", Line Guide, spacing sliders, reading goals.

### How they work (observed)
- **Listen to Page** (REA ev_21971479, AbilityNet guide for iOS 26). Safari's Reader button > Listen to
  Page; a Listen button in the address bar then opens rate, play/pause, and rewind/forward that move by
  **sentence**; unsupported pages fall back to Speak Screen. Secondary (Guiding Tech; Orion forum): playback
  continues in the background with lock-screen controls and time remaining.
- **Read & Speak** (REA ev_891ab019, iOS 27 guide). Settings > Accessibility > Read & Speak: Speak Screen
  (two-finger swipe down) with highlight style, colour and selection options; Speak Selection; a controller
  with pause, rate, forward/back and Speak on Touch; voices, default language, Detect Languages, speaking
  rate, and **Pronunciations** ("dictate or spell out" how phrases should be spoken).
- **Accessibility Reader** (REA ev_6e07eb29). A full-screen read/listen view for any app (triple-click
  shortcut, Control Center, or Share). Theme editor: text and background colour, size, font, **High
  Legibility Characters**, bold, and **line, word and character spacing**, each Default/Loose/Open;
  playback highlighting style; named themes. Listening: play/pause, skip, rate menu, **time scrubber**,
  hide audio controls, Autoplay. Apple Intelligence (iPhone 15 Pro and later) adds Summarize, Translate,
  Cleanup.
- **Books, reading** (REA ev_ebbc6df9). Daily reading goals; a **rounded arrow returns to the previous
  reading location** after a jump (and forward again); Search Book; Contents with press-and-drag scrubbing;
  Themes & Settings with font choice, bold, sliders for line, character and word spacing and margins,
  justify, reset; automatic place saving; **Line Guide** dims everything but the current line.
- **Books, annotating** (REA ev_f281d834). Touch and hold, adjust grab points, tap **Highlight**: the
  highlight exists immediately; tap it later to change colour or switch to underline. Add Note; a
  highlights list jumps to locations; multi-select to share or delete; the selection menu also offers
  Translate, **Search** (the book, for the selection) and Copy.

### Learning-science reason
- Spacing and legibility settings are accessibility features first. Extra letter spacing improved reading
  speed and accuracy in dyslexic children (Zorzi et al., 2012); the OpenDyslexic font showed no benefit
  (Wery & Diliberto, 2017). Offer spacing and a hyperlegible face rather than a "dyslexia font", and claim
  comfort, not learning gains, for typical readers. Line guides have little direct evidence.
- One-tap highlighting lowers capture cost. The generation effect (Slamecka & Graf, 1978; meta-analysis
  Bertsch et al., 2007) says the learner's own words are what add value, so the note should stay one tap
  away rather than mandatory up front.
- Returning to the previous location after a jump removes the extraneous work of re-finding one's place.
- Reading goals support regular, distributed sessions; Lumen's reminders design already rules out guilt
  mechanics.

### Fit for Lumen
- **Existing:** sentence prev/next, four narration scopes (`speech.js:4-9`), pronunciation overrides
  (`speech.js:194`), themes, text size, line height and width (`db.js:891-895`).
- **Issues:** #107 (follow iPhone Text Size), #108 (real font stacks), #104 (wake lock), #129 (lock screen),
  #102 (scrubber), #120 (study time and goals).
- **New:** one-tap highlighting (N1), return to previous location (N4), spacing, font choice and line focus
  (N6), search from a selection (#161), and a Listen-to-Page handoff experiment (#158, unverified).

---

## 6. Omnivore (open source, AGPL-3.0; designs described in prose, nothing copied)

### Features that matter most for a self-directed learner
1. Text-to-speech in which every utterance maps back to a page element and a word count.
2. Highlight anchors that survive edits to the text.
3. A notebook view (highlights plus one document note), labels, and export integrations.
4. Reader typography with OpenDyslexic and Atkinson Hyperlegible.
5. Native iOS lock-screen audio, and an AI "Digest" built from chaptered audio.

### How they work (code study)
- **TTS units** (REA ev_fe62765c, parent ev_64585d9e; `packages/content/text-to-speech/src/htmlToSsml.ts`).
  The server stamps every article element with a sequential DOM-order anchor index, the same numbering the
  web reader uses, so an utterance, a reading-progress value and a DOM node share one key. Utterances are cut
  per top-level block (paragraph, blockquote, heading, list item, or any element with significant text). Each
  carries the block's index, its text, a running word offset and a word count (which give global progress and
  time left). Scripts, styles, images, figures, captions, iframes and **code are skipped**. A sentence
  tokenizer packs sentences into chunks of at most 256 characters without splitting one. **Blockquotes are
  voiced by a secondary voice.** The title is spoken first. Audio was rendered in the cloud (Azure, or OpenAI
  for "ultra realistic" voices) with a JSON sidecar of word and bookmark timings; OpenAI voices return no
  timings, so word highlighting is lost with them.
- **Highlight anchors** (REA ev_b9dfc9d1, parent ev_1c3fdf93; `packages/web/lib/highlights/highlightGenerator.ts`).
  A highlight's location is a diff-match-patch patch between the whole article text and the same text with
  boundary markers. On load the patch is applied **fuzzily** to the current text, so small edits inside or
  around the quote still re-anchor. Prefix, quote and suffix are kept for checking; interpolation search maps
  offsets to text nodes; the maximum length is 6,000 characters. Highlights are drawn by wrapping text in spans
  (DOM mutation); the default colour is yellow.
- **Reader settings** (`components/templates/article/ReaderSettingsControl.tsx`): font list including
  OpenDyslexic and Atkinson Hyperlegible, justify, high-contrast text, margin width, size and line height.
- **iOS audio** (`mobile/apple/OmnivoreKit/Sources/Services/AudioSession/AudioController.swift`):
  lock-screen play/pause, skip forward/back with preferred intervals of 15/30/60 s, scrubbing, next/previous
  item, elapsed time in Now Playing, preferred voice per language, persisted rate, duration estimates per
  speed, optional prefetch.
- **Digest** (`packages/api/src/services/digest.ts`): chapters (one per summarised saved item) with one speech
  file each; feedback is collected separately for ranking, summary, voice and music quality.

### Learning-science reason
- Block-anchored utterances make precise signalling possible (highlight what is being read) and word offsets
  give an honest time-left estimate that supports planning.
- Fuzzy anchors protect learner-generated annotations, the effortful part of reading (generation effect), from
  being silently lost when the text changes.
- Separate feedback per stage is a cheap way to evaluate AI summaries before trusting them.

### Fit for Lumen
- #100/#101 already specify a per-block unit with a spoken-to-source offset map. Omnivore's design is close to
  it, which validates the issues' direction.
- Lumen paints highlights with the CSS Custom Highlight API and does not mutate the DOM, which keeps text
  offsets stable. That is better than Omnivore's span wrapping; keep it.
- Lumen relocates a highlight only when the exact quote still exists (`annotations.js:175-204`): a
  one-character fix inside a highlighted sentence orphans it. Fuzzy re-anchoring is new (N3). Implement it
  independently or with Google's Apache-2.0 diff-match-patch library, never by porting Omnivore code.
- Do not copy the second voice for blockquotes: Lumen's blockquotes are mostly Unicode formulas.
- Per-recap thumbs feedback is a small refinement for #125.

---

## 7. Matter and LingQ (added)

### Features that matter most for a self-directed learner
- **Matter: Audio Highlights**, which capture a highlight while listening without looking at the screen.
- **LingQ: vocabulary state while reading.** Every word is new, learning or known; meanings are saved with
  the phrase where the word was met, and a known-word count tracks progress.

### How they work (observed)
- **Matter** (REA ev_75c7bee3). The update states the problem plainly: "you can't highlight if you're not
  looking at the screen". Squeezing both volume buttons, or triple-tapping AirPods, creates a highlight of what
  is playing.
- **LingQ** (REA ev_efd869ef, ev_36ce8768). New words show blue with a per-lesson count. Tapping one offers up
  to three meanings; the chosen meaning is saved "along with the phrase in which you first found the word" (a
  "LingQ", yellow until known). K marks Known and X ignores. **By default, turning the page marks all remaining
  blue words Known** (configurable). A known-word count shows progress; a daily email and the Vocabulary
  section provide flashcards.

### Learning-science reason
- Capture without leaving the listening flow avoids task-switching costs, so more of a listening session becomes
  reviewable material.
- Tracking which terms are known gives a mastery signal and lets support fade (expertise reversal), but
  LingQ's silent "page turn = known" default invites overconfidence. A technical curriculum should require an
  explicit "I know this".

### Fit for Lumen
- **Matter:** Lumen's audio bookmarks save positions, not highlights (`audioBookmarks.js:57`); #102 adds
  Highlight only from the bookmark list. Eyes-free capture is new (N2). Media Session gestures need real audio,
  so they depend on #129.
- **LingQ:** maps to #117 plus the known-term fading and look-up history in N7.

---

## Gaps for Lumen

### A. Already in Lumen (no new work)

| Capability | Seen in | Lumen evidence |
|---|---|---|
| Highlights with colour, purpose, comment and tags | Readwise (tags only), Apple Books, Speechify | `AnnotationDialog.jsx:5-17`, `:43` |
| Highlight → review card, including cloze | Readwise Mastery | `App.jsx:2409`, `review.js:447` |
| Clippings, one private note per lecture, Notebook search with purpose filter and Markdown export | Readwise notebook/document note/export, Apple Books list | `Reader.jsx:904`, `Notebook.jsx:73`, `:109` |
| Grounded tutor with `[S1]` citations and a source scope | NotebookLM chat | `AiTutor.jsx:222-225` |
| AI quiz/flashcards with confidence, misses to the mistake notebook, FSRS scheduling | NotebookLM flashcards (binary, unscheduled) | README "Remember and practise"; `ReviewCenter.jsx` |
| Card links back to its source | NotebookLM Explain, Readwise "View in Source" | `ReviewCenter.jsx` `onOpenSource` (e.g. `:788`, `:822`) |
| Narration scopes (sentence/section/selection/full) with sentence and section skip | Safari Listen to Page (sentence skip), Speechify | `speech.js:4-9` |
| Audio bookmarks (up to 100), sleep timer, next-chapter auto-advance | Readwise, Speechify | `audioBookmarks.js:14`, `:57`; `useSpeech.js:500`; `App.jsx:1492` |
| Pronunciation overrides | Apple Pronunciations | `speech.js:194` |
| Speed presets 0.8/1/1.25 (clamped 0.6-1.6) | Speechify, Apple | `NarrationPanel.jsx:175`, `useSpeech.js:203` |
| Offline device voices | Readwise TTS needs a connection | APP_GUIDE "Listen with different voices" |
| Active-recall conceal in Teaching Mode | none of the studied tools | `TeachingMode.jsx:16`, `:116` |

### B. Covered by open issues (with what this research adds)

| Candidate | Seen in (evidence) | Issue | What the research adds |
|---|---|---|---|
| Learner-led follow-along, Return/Jump, Read from here, opt-in word highlight | Readwise ev_8f0f2461; Speechify ev_747c989a; Safari ev_21971479 | #101 | Readwise swaps its 15 s buttons for Return and Jump when the reader scrolls away, a compact pattern for 320 px. Because reading-while-listening gains are trivial (Clinton-Lisell, 2023), sentence highlighting as the default is right. |
| Speak maths, code, tables and diagrams; skip code | Speechify ev_7fe9fda0; Omnivore ev_fe62765c | #100 | Omnivore skips code outright; Apple lets users dictate pronunciations (ev_891ab019), which supports #100's "Try it" field. |
| 2× speed, ramp, scrubber, time left, Media Session, keys | Speechify ev_5db2749b; Apple ev_6e07eb29; Readwise ev_8f0f2461 | #102 | Murphy et al. (2022) supports the 2× ceiling; Speechify ramps "every few minutes" (close to #102's 0.05× per 2 min); Omnivore estimates durations per speed. |
| Keep listening across screens, wake lock | Safari background play (secondary) | #104 | none |
| Daily highlight resurfacing | Readwise ev_87e0cfcc | #116 | Readwise's half-lives (7/14/28 days), resurfacing at 50% predicted recall, and a fragment filter; consider the filter and per-Part frequency. |
| Tap a term for its definition | Kindle (secondary), Readwise ev_6d327f46, LingQ ev_36ce8768 | #117 | Quick Lookup's Highlight button stores the explanation as the highlight's note; further extensions are N7. |
| Questions before reading, recall after | Ghostreader ev_a1d667dc; NotebookLM ev_2b1f0886 | #118 | Prequestion evidence (Richland et al., 2009; Pan & Carpenter, 2023). |
| Teach-back | NotebookLM "Critique" ev_36090667 | #121 | none |
| Cards and mistakes by ear; recall checkpoints in narration | Readwise audio review; NotebookLM "Only cards you missed" ev_c53ebef7 | #122 | none |
| Listening queue and smart playlists | Readwise themed review as a podcast | #123 | #123 includes clippings but not highlights (see N9). |
| Ask while listening, then resume | NotebookLM Interactive ev_36090667; Kindle Ask this Book ev_b57a90a0 | #124 | Kindle scopes answers to the reading position; consider "up to what I've heard" in the prepared prompt. |
| Short AI recaps read aloud | NotebookLM The Brief; Kindle Recaps ev_9c088197 | #125, #131 | A single speaker and under two minutes supports #125's 2-4 sentences per section; add thumbs feedback as Omnivore and NotebookLM do. |
| Guided two-voice audio lesson | NotebookLM Deep Dive | #126 | The personalisation effect fades past about 35 minutes (Ginns et al., 2013), so keep #126's 5-8 minutes. |
| Anki and Obsidian export | Readwise export template; Kindle vocab → Anki | #128 | none |
| Lock-screen and background audio | Omnivore iOS; Safari Listen to Page | #129, #130, #132 | Mirror Omnivore's lock-screen set (15/30/60 s skip, scrub, next/previous section) in #129's Media Session. |
| Follow iPhone Text Size; real font stacks | Apple Books, Accessibility Reader | #107, #108 | Spacing and font choice are not covered (see N6). |
| Study time and goals | Apple Books goals ev_ebbc6df9 | #120 | none |

### C. New (not in `src/`, `docs/`, or any open or closed issue)

Search basis: 41 open and 32 closed issue bodies scanned for fuzzy, orphan, one-tap, headphone, AirPods,
spacing, dyslexia, line guide, return/back, key passage, X-Ray, look-up, Word Wise, recap, Listen to Page,
parentheses, themed, mind map, study guide and colour filter; `src/` and `docs/` (PRODUCT_REQUIREMENTS,
ENGINEERING_HANDOFF, design notes, guides) grepped for the same features. Two items touch an existing PRD
requirement without any open issue, and are labelled so: N3 (LEARN-001's "restore anchors after moderate
source changes", PRD:427-459) and N6 (inside A11Y-001's "comprehensive accessibility modes", PRD:1092-1104,
which does not name spacing or fonts). The mind maps in PRD BOARD-002 are whiteboard objects, not #160.

**N1. One-tap highlighting and sentence or paragraph targets.** *Seen in:* Readwise auto-highlighting and
paragraph H (ev_0fa4b91b); Apple Books one-tap Highlight (ev_f281d834). *Lumen today:* "Highlight" always
opens a dialog and needs a second tap on "Create highlight" (`Reader.jsx:908-914`, toolbar `:1221`).
*Proposal:* (a) tapping Highlight saves at once with the last-used colour and purpose and shows an UndoStrip
toast ("Highlighted · Add note · Change · Undo"); the dialog opens only from "Add note/Change" or a long-press,
with a setting to keep today's always-ask behaviour. (b) When the selection is a single word, replace Clip and
Listen in the toolbar (which is full at 320 px, per #100) with "Sentence" and "Paragraph" buttons that expand
the selection using the narration sentence splitter, so iPhone users avoid dragging handles. (c) On desktop,
arrow-key paragraph focus plus H. *Why:* capture friction on iPhone limits how much reaches Revisit (#116) and
cards; the research says the value comes later, so keep "Add note" one tap away. *Effort:* S for (a), M for
(b) and (c). *Impact:* high.

**N2. Capture what you just heard.** *Seen in:* Matter Audio Highlights (ev_75c7bee3); Readwise headphone
gestures (ev_8f0f2461); Kindle Assistive Reader pauses when a highlight is made (secondary). *Lumen today:* the
mini player's bookmark saves a narration position, not a highlight (`Reader.jsx:1230`, `audioBookmarks.js:57`);
#102 adds Highlight only inside the bookmark list. *Proposal:* a 44 px "Highlight this sentence" control in the
mini player and in #102's Now-playing sheet that creates a real highlight of the current sentence (using #101's
Range, or an audio bookmark until #101 lands), purpose "question" by default, with a toast offering "Add note".
Narration keeps playing. Once #129 provides an `<audio>` element and Media Session, add an off-by-default option
mapping one remote command (for example AirPods double-tap, which normally arrives as next track) to the same
capture; whether a Home Screen web app receives that command is unverified and belongs in #7's device checks.
*Why:* it turns walks and commutes into reviewable highlights. *Effort:* S for the control, M for the gesture.
*Impact:* medium-high.

**N3. Fuzzy re-anchoring of highlights.** *Class:* no open issue; PRD LEARN-001 (Partial) already asks to
"restore anchors after moderate source changes", which today holds only when the quote itself is untouched.
*Seen in:* Omnivore's patch-based anchors (ev_b9dfc9d1). *Lumen today:* exact quote match, else orphaned
(`annotations.js:183-190`). Lumen ships curriculum updates and editable
copies, so a typo fix inside a highlighted sentence orphans the learner's work. *Proposal:* when the exact quote
and quote search both fail, search a bounded window around the stored offset and the stored prefix and suffix for
the best approximate match (normalised edit distance or Bitap), and accept it only at 85% similarity or better
with context agreement. Mark the result "relocated (approximate)" with a "Check this highlight" badge offering
Accept and Relink, and write back the new offsets through the existing reconcile path. Use an independent
implementation or Apache-2.0 diff-match-patch, with its notice. *Tests:* a typo fix, an inserted word,
punctuation changes, and two near-identical sentences that must not cross-match. *Effort:* M. *Impact:* medium.

**N4. Return to where you were.** *Seen in:* Apple Books' back arrow (ev_ebbc6df9). *Lumen today:* table-of-contents
jumps (`Reader.jsx:634-645`), find matches (`:657`) and highlight opening (`:936`) scroll without recording a
return point. *Proposal:* before any programmatic jump, push the current scroll position and block index onto a
small stack and show a 44 px "Back to where you were" chip until the learner scrolls or 30 seconds pass. Apply the
same to citation and link targets that open another lecture. *Why:* technical lectures send learners to
definitions and derivations and back; losing one's place is pure extraneous load. *Effort:* S. *Impact:* medium.

**N5. Resume primer ("where you left off").** *Seen in:* Kindle Recaps and Story So Far (ev_9c088197, ev_b57a90a0);
Ghostreader "Pick up where I left off" (ev_a1d667dc). *Lumen today:* nothing; #104's Home tile only resumes.
*Proposal:* when a lecture is reopened at 10-95% progress after two or more days, show a dismissible card above the
article. It asks first: one retrieval prompt, either a due card from this lecture (the review queue filtered by
`documentId`) or "In one sentence, what was the main idea of §X?" with Reveal showing the learner's own highlight or
the heading. Then it lists the last two or three headings read and up to three of the learner's highlights from
them, and offers "Continue at §Y" (the exact saved position). An AI recap from #125's cache can be added, labelled
as AI. Deterministic and offline. It shares the slot above the article with #118's "Before you read"
disclosure, so show the primer only when the lecture has been started and the preview only when it has not. *Why:* retrieval before new material improves its learning (forward testing
effect; Chan et al., 2018), and asking before telling beats a passive summary. *Effort:* S-M. *Impact:* high.

**N6. Reading comfort: spacing, a hyperlegible font and line focus.** *Class:* no open issue; would extend PRD
A11Y-001, which lists contrast and colour-blind modes but not spacing or fonts. *Seen in:* Accessibility Reader spacing
presets and High Legibility Characters (ev_6e07eb29); Books spacing sliders and Line Guide (ev_ebbc6df9); Omnivore's
Atkinson Hyperlegible and OpenDyslexic. *Lumen today:* only theme, text size, line height and width are persisted
(`db.js:891-895`); #107 and #108 cover system text size and font stacks only. *Proposal:* letter spacing and word
spacing presets (Default/Loose/Open), a font choice of System, Serif or a bundled Atkinson Hyperlegible WOFF2 (SIL
OFL; lazy-loaded within the #95 budget, as the CSP only allows self-hosted fonts), and an optional line-focus band
that dims all but the paragraph at the reading line (static under reduced motion). Persist through the settings
normaliser and include them in Reading appearance. Do **not** ship OpenDyslexic as a fix (Wery & Diliberto, 2017).
*Why:* spacing helps readers with dyslexia (Zorzi et al., 2012). This is accessibility, not a learning-gain claim.
*Effort:* S-M. *Impact:* medium.

**N7. Glossary beyond definitions (extends #117).** *Seen in:* Kindle Vocabulary Builder, X-Ray and Word Wise
(ev_c6a66b92 plus secondary); LingQ (ev_36ce8768, ev_efd869ef); Readwise Quick Lookup (ev_6d327f46). *Lumen today:*
#117 plans a definition popover with "Open in glossary" and "Make card" only. *Proposal:*
(a) **Terms you looked up**: each popover opening logs the term, lecture and sentence; a Notebook list shows them
with context, and "Make cards" creates "Define: term (as in: '…')" cards.
(b) **Where else it appears**: the popover lists the chapters that use the term, from the existing search index, with
the defining chapter marked and a tap opening the first occurrence.
(c) **I know this**: a per-term Known toggle removes its underline everywhere, a density control offers All, Only new
to me, or Off, and a reset restores all marks. Never mark terms known silently (unlike LingQ's page-turn default).
*Why:* look-ups mark knowledge gaps worth retrieving; glosses aid vocabulary learning when terms recur (Hulstijn et
al., 1996); support should fade with expertise (Kalyuga et al., 2003); linking a term's uses across chapters is
elaboration. *Effort:* M. *Impact:* high for a jargon-dense interview curriculum.

**N8. Author-signalled key passages (a local "Popular Highlights").** *Seen in:* Kindle Popular Highlights
(secondary). *Lumen today:* none, and the notes have no consistent "key ideas" or summary convention (a grep of
`notes/` found almost no Summary or Key-idea headings or callouts). *Proposal:* a build-time
`key-passages.v1.json` with 3-7 key sentences per chapter (document id, heading anchor, quote, one-line "why"),
drafted offline (a local model is fine) and reviewed by the maintainer, as X-Ray mixes generated and curated
entries. The Reader can show them with a non-colour cue (dotted underline plus margin marker, via CSS Highlights).
Add a "Key ideas" list in the outline, "Add to Revisit/cards" in one tap, and an optional spoken "Key idea." cue in
#100's units. Cap density per section. Generate the JSON with the same `scripts/lib/` content pipeline that
#113 (starter cards) and #117 (glossary) add to `generate_content_index.mjs`, so anchors come from
`documentAnchorIds`. *Why:* instructor-provided highlighting improved memory and comprehension
(g = 0.44) more than learner highlighting (Ponce et al., 2022); signalling aids retention (Schneider et al., 2018).
*Effort:* L (content for about 116 chapters). *Impact:* high.

**N9. Themed Revisit and listening to highlights (extends #116 and #123).** *Seen in:* Readwise Themed Reviews and
audio review (ev_87e0cfcc). *Lumen today:* #116 has no filter, and #123's smart playlists include clippings but not
highlights. *Proposal:* filter chips on the Revisit strip (purpose such as Interview, Definition or Question; tag;
Part), for example "Interview highlights before a mock round". Add a "Listen" action that reads the set aloud (quote,
then the learner's comment, then the source) with large Keep and Retire buttons, reusing #122's session shell
without grading. *Why:* spaced re-exposure aimed at a goal, usable away from the screen. *Effort:* S-M. *Impact:* medium.

**#157. Colours that mean something.** *Seen in:* Readwise rejects colours as an unstated system (ev_0fa4b91b).
*Lumen today:* colour and purpose are independent (`AnnotationDialog.jsx:5-17`), and the Notebook filters by purpose
only (`Notebook.jsx:109`). *Proposal:* default each colour to a purpose (Important = gold, Definition = teal,
Question = coral, Interview = violet), show a legend in the dialog and highlights panel, add a colour filter, and keep
manual override. This is backward compatible; pair each colour with a non-colour cue (purpose icon) so it also
serves A11Y-001's colour-blind requirement. *Why:* colour only helps if it carries meaning. *Effort:* S.
*Impact:* low-medium.

**#158. "Listen in Safari" handoff (experiment; unverified).** *Seen in:* Safari Listen to Page plays locked with
lock-screen controls and sentence skip (ev_21971479 plus secondary). *Lumen today:* Web Speech stops when the app is
hidden (APP_GUIDE); #129 needs the Mac. *Proposal:* first a device spike recorded in #7. Open a built-in lecture's
read-only view in Safari (not the Home Screen app) and check that Reader and Listen to Page are offered, that playback
continues when locked, and how formulas and code are read. If it passes, add "Listen in Safari (keeps playing when
locked)" to #102's sheet for built-in lectures only, since custom notes live in the app's separate storage. *Why:* a
zero-cost background-listening bridge before #129 and #130. *Risks:* Safari may not offer Reader for the app's pages;
#100's verbalisation will not apply. *Effort:* S (spike) plus S. *Impact:* medium if verified.

**#159. A lecture study sheet.** *Seen in:* NotebookLM study guide and briefing (ev_2b1f0886); Ghostreader takeaways
(ev_a1d667dc). *Lumen today:* lecture export (Markdown/HTML/PDF) and highlight export exist, but nothing assembles a
review page; #128 is an export to other tools. *Proposal:* a "Study sheet" in Lecture actions that renders one
printable, exportable page: outline, glossary terms in the lecture (#117 data), authored questions (#118/#119), the
learner's highlights grouped by purpose, their note, open mistakes and due cards for the lecture, and key passages
(N8), with an optional "Quiz me on this sheet" tutor bridge. Deterministic and offline. *Why:* a self-testing scaffold
for revision and interview preparation (practice testing is high utility; Dunlosky et al., 2013). *Effort:* M.
*Impact:* medium.

**#160. Section map with learner state.** *Seen in:* NotebookLM mind maps (ev_bba4019a), which its own mobile app lacks.
*Lumen today:* the outline panel lists headings only (`Reader.jsx:1061`); the concept map is Part-level. *Proposal:* a
collapsible H2/H3 tree with per-section read status, highlight count, and due cards or mistakes (via #113's
`sourceAnchor`), plus actions (Read from here #101, Explain it back #121, Ask). *Why:* an advance organiser and a
revision map in one. *Effort:* M. *Impact:* low-medium.

**#161. Lookup and search scoped to the selection size.** *Seen in:* Ghostreader word-level prompts and Quick Lookup
(ev_a1d667dc, ev_6d327f46); Apple Books "Search" in the selection menu (ev_f281d834). *Lumen today:* the toolbar
offers Highlight, Clip, Ask AI and Listen for any selection (`Reader.jsx:1221`); Ask AI sends a bare excerpt to the
tutor (`App.jsx:2654-2660`). *Proposal:* for 1-3 words, show "Define" (the #117 glossary match offline, otherwise
"Explain as used here" through the local tutor, with the sentence as context) and "Find" (in this lecture, or library
search), and offer "Highlight and save the definition as a note". Swap buttons by selection size rather than adding
them. *Effort:* S-M. *Impact:* medium.

**#162. More narration skip rules (extends #100's settings).** *Seen in:* Speechify Enhanced Skipping (ev_7fe9fda0).
*Proposal:* opt-in "Skip parenthetical asides", "Skip URLs and citation markers", and "Treat Exercises sections as
recall pauses" (with #122 Part B). Default off, because parentheses in technical prose often carry definitions.
*Effort:* S. *Impact:* low.

### Priority order
1. High impact, low effort: N1 (one-tap capture), N5 (resume primer), N2 (capture while listening, after #101).
2. High impact, larger: N7 (glossary extensions, with #117) and N8 (key passages; content work).
3. Medium: N3, N4, N6, N9, #159, #161, and #158 once a device spike passes.
4. Low: #157, #160, #162.

Within the open issues, the research most strongly supports doing #101 and #102 first (they unblock N2), then #116
and #117 (they host N7 and N9), and keeping #126's sessions short.

---

## Untrusted-content log

- No prompt-injection attempt or agent-directed instruction was seen in any of the 25 captured pages or in the
  Omnivore source that was read.
- Present and ignored: sign-up and onboarding calls to action (Speechify), notification and newsletter prompts
  (aboutamazon.com), a cookie banner (AbilityNet), and sign-in links (Google, KDP). No links were followed beyond
  the planned URLs.
- Omnivore code was treated as data: not installed, built or executed, and not reproduced.

## Sources

### Platform evidence (full evidence ids in the ledger, captured locally, not committed)
- Readwise: [Reader TTS FAQ](https://docs.readwise.io/reader/docs/faqs/text-to-speech) (ev_8f0f2461);
  [Highlights, Tags, and Notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes) (ev_0fa4b91b);
  [Ghostreader default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts) (ev_a1d667dc);
  [Reviewing your highlights](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights) (ev_87e0cfcc);
  [Quick Lookup](https://docs.readwise.io/reader/guides/ghostreader/quick-lookup) (ev_6d327f46).
- NotebookLM / Gemini Notebook: [Audio Overview](https://support.google.com/notebooklm/answer/16212820) (ev_36090667);
  [Flashcards or Quizzes](https://support.google.com/gemininotebook/answer/16958963) (ev_c53ebef7);
  [Mind Maps](https://support.google.com/gemininotebook/answer/16212283) (ev_bba4019a);
  [Reports](https://support.google.com/gemininotebook/answer/18323649) (ev_2b1f0886);
  [Chat](https://support.google.com/gemininotebook/answer/16179559) (ev_d6598a4e).
  Secondary (report templates): AVID Open Access and Google for Education pages, via search.
- Speechify: [Autoskip](https://speechify.com/blog/how-to-autoskip-content-in-speechify/) (ev_7fe9fda0);
  [Listening features](https://speechify.com/blog/listening-features/) (ev_747c989a);
  [How to listen faster](https://speechify.com/blog/how-to-listen-faster/) (ev_5db2749b);
  [Notes](https://speechify.com/blog/how-to-take-notes-within-speechify/) (ev_c8121e03);
  App Store listing claims (secondary).
- Kindle: [KDP X-Ray for Authors](https://kdp.amazon.com/en_US/help/topic/G202187230) (ev_c6a66b92);
  [KDP Recaps](https://kdp.amazon.com/en_US/help/topic/GHY9YRK5N6ZQJTNJ) (ev_9c088197);
  [Amazon: Recaps, Story So Far, Ask this Book](https://www.aboutamazon.com/news/books-and-authors/kindle-recaps-feature-ebook-series-refreshers) (ev_b57a90a0).
  Secondary: Vocabulary Builder (Dummies; nerdschalk; Goodreads author blog), Popular Highlights (BetaNews quoting
  Amazon; Project MUSE), Word Wise and Assistive Reader (The eBook Reader blog, 2024-06-14; Amazon help snippets),
  Ask this Book (Engadget; Tom's Guide).
- Apple: [Hear iPhone speak the screen](https://support.apple.com/guide/iphone/hear-whats-on-the-screen-or-typed-iph96b214f0/ios) (ev_891ab019);
  [Accessibility Reader](https://support.apple.com/guide/iphone/read-listen-text-apps-accessibility-reader-iph406a46ab8/27/ios/27) (ev_6e07eb29);
  [Read books](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/ios) (ev_ebbc6df9);
  [Annotate books](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27) (ev_f281d834);
  [AbilityNet: Listen to web pages in iOS 26](https://mcmw.abilitynet.org.uk/how-to-listen-to-web-pages-in-ios-26-on-your-iphone-or-ipad) (ev_21971479).
  Secondary (lock-screen behaviour): Guiding Tech; Orion feedback forum.
- Matter: [Audio Highlights](https://www.getmatter.com/updates/audio-highlights) (ev_75c7bee3).
- LingQ: [Which words are new to me](https://lingq-support.groovehq.com/help/how-do-you-know-which-words-are-new-to-me) (ev_efd869ef);
  [How do I create LingQs](https://lingq-support.groovehq.com/help/how-do-i-create-lingqs) (ev_36ce8768).
- Omnivore: github.com/omnivore-app/omnivore at 9060477 (AGPL-3.0); REA ev_fe62765c / ev_64585d9e (text-to-speech)
  and ev_b9dfc9d1 / ev_1c3fdf93 (highlights).

### Learning science
- Bertsch, S., Pesta, B. J., Wiscott, R., & McDaniel, M. A. (2007). The generation effect: A meta-analytic review. *Memory & Cognition, 35*(2), 201-210.
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks. *Psychological Bulletin, 132*(3), 354-380.
- Chan, J. C. K., Meissner, C. A., & Davis, S. D. (2018). Retrieval potentiates new learning: A theoretical and meta-analytic review. *Psychological Bulletin, 144*(11), 1111-1146.
- Clark, J. M., & Paivio, A. (1991). Dual coding theory and education. *Educational Psychology Review, 3*(3), 149-210.
- Clinton-Lisell, V. (2022). Listening ears or reading eyes: A meta-analysis of reading and listening comprehension comparisons. *Review of Educational Research* (online 2021-12-29).
- Clinton-Lisell, V. (2023). Reading while listening versus reading only: a meta-analysis. *Educational Research: Theory and Practice*.
- Craig, S. D., & Schroeder, N. L. (2017). Reconsidering the voice effect when learning from a virtual human (journal not confirmed from a primary source; findings via secondary summaries).
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest, 14*(1), 4-58.
- Ginns, P. (2005). Meta-analysis of the modality effect. *Learning and Instruction, 15*(4), 313-331.
- Ginns, P., Martin, A. J., & Marsh, H. W. (2013). Designing instructional text in a conversational style: A meta-analysis. *Educational Psychology Review, 25*(4), 445-472.
- Hulstijn, J. H., Hollander, M., & Greidanus, T. (1996). Incidental vocabulary learning by advanced foreign language students: The influence of marginal glosses, dictionary use, and reoccurrence of unknown words. *The Modern Language Journal, 80*(3), 327-339.
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist, 38*(1), 23-31.
- Kalyuga, S., Chandler, P., & Sweller, J. (2004). When redundant on-screen text in multimedia technical instruction can interfere with learning. *Human Factors, 46*(3), 567-581.
- Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. *Science, 331*, 772-775.
- Mayer, R. E. (2021). *Multimedia Learning* (3rd ed.). Cambridge University Press (coherence, signalling, segmenting, personalisation principles).
- Murphy, D. H., Hoover, K. M., Agadzhanyan, K., Kuehn, J. C., & Castel, A. D. (2022). Learning in double time: The effect of lecture video speed on immediate and delayed comprehension. *Applied Cognitive Psychology*.
- Pan, S. C., & Carpenter, S. K. (2023). Prequestioning and pretesting effects: A review. *Educational Psychology Review* (doi 10.1007/s10648-023-09805-6).
- Ponce, H. R., Mayer, R. E., & Méndez, E. E. (2022). Effects of learner-generated highlighting and instructor-provided highlighting on learning from text: A meta-analysis. *Educational Psychology Review* (doi 10.1007/s10648-021-09654-1).
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied, 15*(3), 243-257.
- Richter, J., Scheiter, K., & Eitel, A. (2016). Signaling text-picture relations in multimedia learning: A comprehensive meta-analysis. *Educational Research Review*.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science, 17*(3), 249-255.
- Schneider, S., Beege, M., Nebel, S., & Rey, G. D. (2018). A meta-analysis of how signaling affects learning with media. *Educational Research Review* (as cited in secondary sources; primary not retrieved).
- Slamecka, N. J., & Graf, P. (1978). The generation effect. *Journal of Experimental Psychology: Human Learning and Memory, 4*(6), 592-604.
- Wery, J. J., & Diliberto, J. A. (2017). The effect of a specialized dyslexia font, OpenDyslexic, on reading rate and accuracy. *Annals of Dyslexia, 67*(2), 114-127.
- Yang, C., Potts, R., & Shanks, D. R. (2018). Enhancing learning and retrieval of new information: A review of the forward testing effect. *npj Science of Learning, 3*, 8.
- Zorzi, M., et al. (2012). Extra-large letter spacing improves reading in dyslexia. *PNAS, 109*(28), 11455-11459.
- Practitioner note (not peer reviewed): Andy Matuschak's notes argue cloze prompts build less understanding than question-and-answer prompts.
