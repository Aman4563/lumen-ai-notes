# Learning-platform research: synthesis and roadmap

> Repository copy prepared on 2026-10-22 for `docs/internal/research/`. Local paths to captures, probes and clones are replaced with "captured locally (not committed)"; screenshots are not included. REA evidence ids and citations are unchanged; code references (`path:line`) are to `main` at `01c7a89`, the research baseline, unless the text names another commit. Candidate ids in this report (N1, G1, Gap 1, …) are its own; `SYNTHESIS.md` maps every one of them to an issue draft, an existing issue, or a recorded deferral.


Date: 2026-10-22. Baseline: `main` at `45826f7`. The research and first synthesis ran at `01c7a89`; PR #145 merged during the independent review, and every reference was re-checked against `45826f7` (V-9).

This synthesis turns four verified research reports into a de-duplicated plan for Lumen AI Notes:
- `memory-srs.md`: spaced repetition and memory;
- `reading-listening.md`: reading, annotation and listening;
- `practice-mastery.md`: practice, mastery and study planning;
- `knowledge-visual.md`: knowledge tools and visual learning.

Every candidate from the four reports was checked against the current code and all 41 open issues. Each one now has exactly one destination:
- a new issue draft (#148–#189);
- an amendment comment on an open issue;
- "already covered" or "already shipped";
- an explicit deferral or rejection, with the reason.

**Keys and cross-references**
- Keys are in build order: defects first, then milestones v1.4.0 → v1.6.0, then impact, effort and dependencies within each milestone.
- The drafts and comments refer to one another by N-key. Replace each key with its issue number after the issues are created. The issue drafts and their manifest were prepared alongside this file (captured locally, not committed) and list the keys in creation order.

## 1. How the platforms were studied

All four studies followed the same rules:
- REA `capture_browser_scenario` (headless Chrome) was the primary tool, with robots.txt checked first.
- No logins, account creation, paywalls, CAPTCHAs or form filling.
- Page text was treated as data, and no prompt injection was observed.
- Proprietary pages were paraphrased, with only short attributed quotes.
- Open-source code was read for design and never copied.

| Report | Platforms | How | Stopped or blocked | Licences respected |
|---|---|---|---|---|
| Memory and spaced repetition | Anki, RemNote, Mochi, Quizlet, SuperMemo, Quantum Country, Orbit, Readwise | REA loads: Anki docs 14, RemNote 8, Mochi 4, SuperMemo guru 4, Quantum Country 3, Readwise 2, Orbit 1. Shallow clones of the Anki manual (commit 91f7485) and Orbit (ed5a530). Two read-only probes of Lumen's scheduler. | quizlet.com and help.quizlet.com served bot challenges, so Quizlet facts come from search summaries (lower confidence). help.supermemo.org showed a Cloudflare challenge; supermemo.guru was used instead. | Anki manual CC BY-SA 4.0: facts only. Orbit Apache-2.0 `core` and `web-component` read only; its AGPL/BUSL app and backend were not read. |
| Reading and listening | Readwise Reader, NotebookLM (now "Gemini Notebook"), Speechify, Kindle, Apple Books, Safari Listen to Page and iOS Read & Speak, Omnivore, Matter, LingQ | 25 REA captures plus 2 static analyses of Omnivore source; evidence ledger and page notes | www.amazon.com disallows Claude agents in robots.txt, and Kindle help returned an error, so neither was loaded. Kindle facts come from KDP help, aboutamazon.com and secondary sources. | Omnivore is AGPL-3.0 and was used for design only. Proprietary pages were paraphrased. |
| Practice and mastery | Khan Academy, Brilliant, Duolingo, LeetCode, Exercism, roadmap.sh, Educative, Math Academy | 28 REA loads across 11 hosts (at most 7 per host), mostly at 393×852. Clones of exercism/python, exercism/docs and developer-roadmap. 40 citations checked against DOI records and abstracts. | Khan's help centre and all of LeetCode showed Cloudflare checks; facts from them are marked secondary. The study stopped at Brilliant's onboarding and at roadmap.sh's login prompt. | exercism/python is MIT. exercism/docs has no licence and was summarised only. developer-roadmap is proprietary and nothing was copied. |
| Knowledge and visual learning | Obsidian (with the Spaced Repetition plugin and JSON Canvas), Logseq, Heptabase, Excalidraw, Zotero, incremental reading, Tana | 15 REA captures (labels in the report's evidence index). Clones of logseq, excalidraw and zotero/reader. | The Polar repository returns 404 and its domain redirects to an unrelated site, so the Incremental Reading Toolkit was used instead. help.supermemo.org was not accessed. | Excalidraw and JSON Canvas are MIT and are dependency candidates only. Logseq and Zotero are AGPL-3.0 and were used for design only. |

**This synthesis pass** added its own checks:
- Code on `main` (01c7a89) was read with grep and sed.
- Both scheduler probes were re-run, and both defects reproduce.
- A read-only Chrome probe served the existing `dist/` build (built 28 Sep; the link code is unchanged since 2 Sep). It reproduced three link defects (#150).
- All 41 open issues and their comments were re-read live through `git gh issue view`.
- An independent review then re-read every cited line on `45826f7`, corrected the drafts, and re-checked the open issues: #139 closed with PR #145, and the new #147 (Storage health error text) overlaps no draft. Its findings are V-9 to V-23 in §6.

## 2. Learning-science principles that recur

| Principle | Key sources | Where it drives the plan |
|---|---|---|
| Retrieval practice beats rereading | Roediger & Karpicke 2006; Karpicke & Blunt 2011; Dunlosky et al. 2013 | #149, #155, #164, #169, #172, #173, #182 |
| Spacing, set to the retention interval | Cepeda et al. 2006, 2008; FSRS (Ye et al. 2022; Su et al. 2023) | #148, #166, #170, #178 |
| Early repetitions add little | Pyc & Rawson 2009; Bjork & Bjork 2011 | #148, #164 |
| Re-test after an error in the same sitting | Rawson & Dunlosky 2011; Pashler et al. 2005; Kang et al. 2007 | #149, #153, #168 |
| Interleaving helps where categories are confusable | Rohrer & Taylor 2007; Kornell & Bjork 2008; Brunmair & Richter 2019 | #174 |
| Minimum information; interference | Wozniak 1999; Underwood 1957 | #165, #171, #115 comment |
| Generation and generative learning | Slamecka & Graf 1978; Bertsch et al. 2007; Fiorella & Mayer 2016 | #154, #157, #172, #180, #183, #185 |
| Self-explanation and elaboration | Chi et al. 1994; Bisra et al. 2018 | #156, #157, #185 |
| Build maps from memory | Blunt & Karpicke 2014; Schroeder et al. 2018; O'Day & Karpicke 2021 | #180, #182, #183 |
| Dual coding and contiguity | Paivio 1986; Clark & Paivio 1991; Mayer 2009; Ginns 2006 | #179, #181, #189 |
| Questions embedded in text | Rothkopf 1966; Hamaker 1986; Matuschak & Nielsen 2019 | #169 |
| Pretesting and forward testing | Richland et al. 2009; Chan et al. 2018; Yang et al. 2018 | #155, #118 comment |
| Calibration and metacognition | Koriat & Bjork 2005; Dunlosky & Rawson 2012 | #151, #175, #176 |
| Mastery learning; knowledge tracing | Bloom 1984; Kulik et al. 1990; Corbett & Anderson 1995 | #167, #175 |
| Attempt first, graduated help, elaborated feedback | Kapur 2008; Sinha & Kapur 2021; Aleven et al. 2003; Renkl et al. 2002; Shute 2008 | #168, #188 |
| Author signalling | Ponce, Mayer & Méndez 2022; Richter et al. 2016 | #184 |
| Motivation without punishment | Silverman & Barasch 2023; Sharif & Shu 2021; Deci et al. 1999; Sailer & Homner 2020 | #152; "deliberately not copied" list |
| Legibility, spacing and non-drag input | Zorzi et al. 2012; Wery & Diliberto 2017; WCAG 2.2 (1.4.12, 2.5.7) | #159, #160, #180 |
| Expertise reversal | Kalyuga et al. 2003 | #177 |

## 3. What Lumen already does well

Keep these. Several are ahead of the platforms studied.

- **Scheduling:**
  - FSRS-4.5 with per-learner calibration, a retention dial and a steady-state workload planner, on a par with Anki.
  - Daily limits, undo, bury, pause and archive.
- **Learning from mistakes:**
  - A free mistake notebook with corrective review. Duolingo charges for mistakes practice.
  - Mixed-format readiness checks with retry and source links.
- **Data integrity:**
  - Attempt-replay sync, an event-sourced model like Orbit's.
  - Quote-anchored highlights with relocation and a repair UI.
  - CSS Custom Highlight painting that never mutates the DOM. This is better than Omnivore's span wrapping.
- **Annotation:** highlights carry colour, purpose, comment and tags, which is richer than Readwise's tags-only model.
- **Listening:** offline device voices (Readwise's text-to-speech needs a connection), four narration scopes and pronunciation overrides.
- **Tutor and practice:**
  - A grounded local tutor with `[S#]` citations and a Socratic mode. This is the Khanmigo/Koji promise, free and on the learner's own machine.
  - Rubric-graded interview practice: 8 tracks and 76 questions.
- **Privacy and tone:** no account, no notifications, no leaderboards, no guilt mechanics. This is stricter than Orbit, RemNote, Readwise or Duolingo.
- **Accessibility:**
  - Review answers are rendered only after reveal, avoiding Quantum Country's pre-reveal accessibility leak.
  - An empty axe allowlist across three themes, with 320 px and 200% text audits.

## 4. Ranked roadmap of new issues

Effort is S, M or L. Impact is for a self-directed learner preparing for ML interviews on an iPhone. "Merges" lists report IDs, with sources defined in §7.

| Rank | Key | Issue | Merges | Milestone | Effort / impact | Depends on |
|---:|---|---|---|---|---|---|
| 1 | #148 | Classic early reviews multiply intervals (bug) | MS-N1, MS-A7, MS-R4, MS-O3, V-3, V-4 | v1.3.0 | S / High | — |
| 2 | #149 | Failed card not re-asked; step is 14.4 min (bug) | MS-N2, MS-A2, MS-M1, MS-O4, MS-Q1 (retest) | v1.3.0 | S / High | #148 |
| 3 | #150 | `#heading` links land at top, go Home, or leave the app (bug) | KV-G2 (heading fix), V-1, V-2 | v1.3.0 | S / High | — |
| 4 | #151 | Recall % counts Crunch, first and same-day grades (bug) | MS-N6 (true retention), MS-A9 | v1.3.0 | S / Medium | — |
| 5 | #152 | Streak tile resets after a rest day; PRD forbids it (bug) | PM-G8 | v1.3.0 | S / Medium | — |
| 6 | #153 | Mistake hints never shown or exported (bug) | PM-G9, V-5 | v1.3.0 | S / Medium | — |
| 7 | #154 | One-tap highlight; colours carry a purpose | RL-N1(a), RL-#157, KV Zotero locked mode | v1.4.0 | M / High | — |
| 8 | #155 | Resume primer | RL-N5 | v1.4.0 | M / High | — |
| 9 | #156 | "Mentioned in" and "Linked from" | KV-G2 (1–3), RL-N7(b) | v1.4.0 | M / High | #150 |
| 10 | #157 | Study note from my highlights | KV-G8, RL-#159 | v1.4.0 | M / High | #150 |
| 11 | #158 | Back to where you were | RL-N4 | v1.4.0 | S / Medium | #150 |
| 12 | #159 | Highlight without dragging handles; Find | RL-N1(b, c), RL-#161 (Find) | v1.4.0 | M / Medium | #154 |
| 13 | #160 | Reading comfort: spacing, hyperlegible font, line focus | RL-N6 | v1.4.0 | M / Medium | #107, #108 |
| 14 | #161 | Fuzzy re-anchoring of highlights | RL-N3 | v1.4.0 | M / Medium | — |
| 15 | #162 | Highlight what you just heard | RL-N2 (control) | v1.4.0 | S / Medium-high | #101, #102, #154 |
| 16 | #163 | Reading queue for imports | KV-G11, MS-S1, MS-S2 (reading) | v1.4.0 | M / Medium | — |
| 17 | #164 | Custom study, card search, batch actions | MS-N8, KV-G6 (scope), PM-G10, MS-M3, MS-A10, MS-R4 | v1.5.0 | M / High | #148 |
| 18 | #165 | Leech triage and card history | MS-N3, MS-A6, MS-R6, MS-S3 (tips), MS-N6 (card info) | v1.5.0 | M / High | — |
| 19 | #166 | Backlog rescue order; hold new cards | MS-N9 (backlog), MS-A3 | v1.5.0 | S / High | — |
| 20 | #167 | Save lab and interview-round results | PM-G2 | v1.5.0 | M / High | — |
| 21 | #168 | Labs: attempt first, step hints, second try | PM-G1 | v1.5.0 | M / High | #167 |
| 22 | #169 | Check yourself: prompts after sections | MS-N5, MS-O1 | v1.5.0 | M / High | — |
| 23 | #170 | Interview-date plan | MS-N4, MS-R3, V-6 | v1.5.0 | L / High | #148, #166 |
| 24 | #171 | Per-blank cloze, both directions, siblings | MS-N7, KV-G7(b), MS-A4, MS-M2, MS-R1 | v1.5.0 | M / Medium-high | — |
| 25 | #172 | Tap words to make a cloze | MS-#158, KV-G7(a), MS-W2 | v1.5.0 | S / Medium-high | #171 |
| 26 | #173 | Practise this chapter | PM-G4 | v1.5.0 | M / High | #167 |
| 27 | #174 | Interleave new cards; mixed readiness checks | MS-#162, PM-G5, KV-G6 (mix), MS-A3 (order) | v1.5.0 | M / Medium | #164 |
| 28 | #175 | Mastery ladder v2 with strength | PM-G3, MS-N6 (estimated knowledge) | v1.5.0 | M / High | #148, #167, #174 |
| 29 | #176 | Grade meanings, two-button mode, scheduler-fit report | MS-#159, MS-A11, MS-A1 (fit check), MS-R7, KV Logseq ratings | v1.5.0 | S / Medium | #151 |
| 30 | #177 | Glossary: looked-up list; I know this | RL-N7(a, c) | v1.5.0 | M / Medium-high | #117 |
| 31 | #178 | Fuzz, load balancing, Easy Days, 30-day forecast | MS-N9 (fuzz/LB), MS-A5, MS-A1 (simulator) | v1.5.0 | M / Medium | #148, #166 |
| 32 | #179 | Diagram recall and diagram cards | KV-G1 (1–2), MS-#161, MS-A8 | v1.6.0 | M / High | #171 |
| 33 | #180 | Board connectors, frames, add-connected-box | KV-G4, KV-G14 | v1.6.0 | L / High | — |
| 34 | #181 | Open a Mermaid flowchart on the board | KV-G5 | v1.6.0 | M / Medium-high | #180 |
| 35 | #182 | Rebuild a diagram from memory | KV-G1 (3) | v1.6.0 | M / High | #181 |
| 36 | #183 | Topic boards with source cards; board search | KV-G3, KV-G15 | v1.6.0 | L / High | — |
| 37 | #184 | Author-reviewed key passages | RL-N8 | v1.6.0 | L / High | — |
| 38 | #185 | Concept notes and "My concepts" | KV-G10 | v1.6.0 | M / Medium-high | — |
| 39 | #186 | Run SQL lab checks on the device (sql.js) | PM-G6 (phase 1) | v1.6.0* | L / High | #167, #168 |
| 40 | #187 | JSON Canvas export and import | KV-G9 | v1.6.0 | M / Medium | #180 |
| 41 | #188 | Mentor mode for code review | PM-G7 | v1.6.0 | M / Medium | — |
| 42 | #189 | Board images and links | KV-G13 | v1.6.0 | M / Medium | — |

**Milestone rule.** The task's mapping was:
- defects → v1.3.0;
- reading, highlighting, comfort and navigation → v1.4.0;
- review, practice, mastery and labs → v1.5.0;
- visual knowledge, boards, AI-heavy work and large items → v1.6.0.

Notes on the mapping:
- **Override.** *#186 is a lab, so the rule says v1.5.0. It is placed in v1.6.0 as a large item that adds a consented runtime download and needs device checks.
- **Follows a dependency.** #177 is reading-related, but it sits in v1.5.0 because its prerequisite #117 is in v1.5.0.
- **Ruled visual.** #179 (diagram recall) is a review card type, and was placed in v1.6.0 under "visual knowledge".

**The dependency edges the task called out:**
- board connectors before a diagram on the board: #180 → #181 → #182;
- per-blank cloze before #128's mapping: #171 → #128 comment, item 1;
- custom study before interleaving: #164 → #174.

**No hard prerequisite on v1.4.0 issues.** None of the new drafts depends hard on #109, #111 or #112. #170 needs neither #112 nor #111, because the target date and Parts are already editable on Home (`src/App.jsx:587`). They remain soft dependencies.

## 5. Amendments to open issues (comments)

| Issue | What the comment adds | Research IDs |
|---|---|---|
| #7 | Device checks: Safari Listen to Page spike; remote commands reaching a Home Screen app; Teaching Mode link tap; selection callout overlap; camera/HEIC and font rendering; per-draft checks for #159, #162, #176 and #186 | RL-#158, RL-N2 (gesture), V-2 |
| #113 | Section breadcrumb above the prompt; keep the parser and anchors reusable for #169, #156 and #184 | MS-R1 |
| #115 | Partial step cards ("Practise step k") after two stuck marks on the same step | MS-#163, MS-R2 |
| #116 | At most 2 of 5 per lecture; skip fragments; purpose, tag and Part chips | MS-W1, RL-N9 (filters), RL-B (#116) |
| #117 | Save the definition as a highlight; Define for a 1–3 word selection; hooks for #177 and #156 | RL-#161 (Define), RL-B (#117), RL-N7(b) |
| #118 | Slot rule with the resume primer; "Practise this chapter" in the exit ticket | RL-N5 (slot), PM-G4 (action) |
| #123 | "My highlights" smart playlist with Keep/Retire | RL-N9 (listen), RL-B (#123) |
| #125 | Per-recap "Not helpful" that evicts the cache, with local counts only | RL-B (#125) |
| #128 | Numbered cloze mapping after #171; `.canvas` boards (#187); W3C TextQuoteSelector highlights sidecar | MS-E9, MS-N7, KV-G9, KV-G16 |
| #129 | Optional headphone "highlight what I just heard" mapping (every `nexttrack` source, V-23) | RL-N2 (gesture) |

## 6. Covered, already shipped, deferred and rejected

### Covered by open issues; the research adds nothing that needs a change

- **Review flows:**
  - #114 typed answer and confidence (MS-E1);
  - #113 starter decks (MS-E4; also MS-Q2's test analogue);
  - #121 teach-back (MS-E8; RL-B #121);
  - #118 bookends (MS-E5; RL-B #118; PM-B);
  - #119 exercise tracking (PM-B);
  - #109 Today card and session runner (PM-B).
- **Planning:**
  - #120 study log (MS-E7; RL-B #120; PM-B);
  - #111 and #112 order, setup and target date (MS-E10; PM-B).
- **Listening:**
  - #122 listen and recall (MS-E6; RL-B #122);
  - #100, #101, #102 and #104 narration (RL-B rows, which confirm those issues' designs);
  - #124 ask while listening (RL-B #124). Kindle's position-scoped answers were noted, but no change is needed: the prepared prompt already carries the section and the sentence just heard.
  - #126 guided lesson (RL-B #126; keep 5–8 minutes);
  - #129, #130 and #132 studio voices (RL-B #129; Speechify HD voices).
- **Reading:** #107 and #108 text size and font stacks (RL-B #107/#108; spacing and fonts moved to #160).
- **Export:** #128 (RL-B #128; Readwise export templates add nothing).
- **On-device Lite:** #85 parity (PM-B; MS §5.3). #114's leaf module already gives Lite the same confidence scale, so no comment is needed.

### Already shipped (parity confirmed; no action)

MS-X, RL-A, PM-C and the KV "existing" rows:
- daily limits, undo, bury, pause and archive;
- FSRS with retention and calibration;
- the 7-day forecast;
- single-card cloze;
- the mistake notebook with corrective review;
- mixed-format readiness checks;
- timed interview rounds and labs;
- attempt-replay sync;
- quote-anchored highlights with purpose and tags;
- card-to-source links;
- interval previews on the grade buttons;
- collections and saved searches;
- Mermaid mind maps;
- Teaching Mode recall;
- Ask AI on a selection (verified: the Mac tutor reserves the open lesson for an Ask AI excerpt, `src/components/AiTutor.jsx:2409-2423`, so the research's "bare excerpt" concern isn't a grounding defect);
- offline voices and pronunciation overrides;
- no accounts and no notifications.

### Deferred, with the condition to revisit

| ID | Candidate | Why it is deferred, and when to revisit |
|---|---|---|
| MS-#157, MS-R5 | Part priorities, auto-postpone, per-priority retention | The interview plan (#170), backlog order (#166) and a batch "Pause" on `part:N` (#164) cover triage for this curriculum. Revisit if learners report overload across many Parts. |
| MS-#160 | Study day starts at 4 AM | Low–medium impact, and it changes `localDayKey`, which limits, plans, #116 and #120 all use. Revisit before #120 lands if night-time study shows double-counted limits. |
| MS-#164 | FSRS-5/6 engine | Gated on evidence. #176's scheduler-fit report will show whether actual retention departs from the target. The 4.5 engine is engine-exact and calibrated. |
| MS-R2 | Full RemNote list and set card types | Wozniak's rules 9–10 advise against sets and enumerations. #115 plus the partial-step comment covers derivations. |
| MS-S3 (rule 19) | "Last verified" date stamps on fast-moving facts | Content metadata with low impact. Revisit during #184's content review. |
| RL-#160, KV-G12 | Per-section state in the outline; a local "Connections" view | Needs #113's `sourceAnchor` and #111's edges, plus #156's mentions. Studying a given map helps only modestly (Schroeder et al. 2018). Revisit after those land. |
| RL-#162 | More narration skip rules | Low impact. Markdown links are spoken as their text, parentheses often carry definitions, and bare URLs cluster in 23 reference-heavy files. Revisit after #100 measures utterances. |
| RL-#158 | "Listen in Safari" handoff | Gated on evidence through the #7 comment. Build only if the device spike passes. |
| PM (later) | FIRe-style implicit review credit | Needs #111's `requires` graph. Revisit after #111 and #175. |
| PM-G6 interim | Parsons problems | Content authoring. Predict-the-output already exists as the `code-output` card type. Do it with #186's task schema. |
| PM-G6 phase 2 | Pyodide Python runtime | MPL-2.0, about 5.3 MB core. Needs an iPhone memory and load gate like #130. |
| MS-M1 | A separate "learn phase" for new cards | New cards already enter learning through the step, and #176 adds two-button grading. |
| KV design note | Mac-local embeddings through Ollama for related notes | Deferred by design in `docs/SEMANTIC_SEARCH_DESIGN.md`. Noted as a cheaper route when semantic search is revisited. |
| KV deferred | PDF reading and annotation | Deferred by design in `docs/IMPORT_DEFERRAL.md`. pdf.js (Apache-2.0) behind a consented download would be the route. |
| KV §1 fit note | Inline card syntax in the learner's own notes (`q::a`, `#card`) | It would duplicate card authoring. #185's fields make cards in one tap. Revisit if learners ask. |

### Not adopted, or deliberately not copied

| ID | Candidate | Reason |
|---|---|---|
| MS-O2 | Orbit's email review invitations | No email and no Web Push, by design (`docs/REMINDERS_DESIGN.md` §1.4). |
| MS-O3 (lapse) | Orbit's gentle lapse (interval ÷ 2.3) | Again stays a real lapse, and FSRS models stability after a lapse. Orbit's elapsed-time rule *is* adopted, in #148. |
| MS-W2 (scheduler) | Readwise half-life scheduling with three feedback levels | FSRS with four or two grades is more precise. |
| MS-Q1 (MCQ) | Quizlet's recognition-to-production progression | #113 deliberately avoids weak multiple-choice distractors. The re-test part is adopted in #149. |
| MS-M2 (typed) | Mochi typed cloze | Covered by #114's typed answers. |
| MS-R7 (per folder) | Per-folder schedulers | One scheduler per profile. Per-priority retention is deferred with MS-#157. |
| RL Ghostreader | Simplify and expand prompts | Already available through Ask AI and the local tutor. |
| RL NotebookLM | AI-generated mind maps | Studying a generated map is the weak form. #156 and #183 cover navigation and construction. |
| RL Omnivore | A second voice for blockquotes | Lumen's blockquotes are mostly formulas. |
| RL Kindle | Crowd "Popular Highlights" | Needs accounts and sharing. Author signalling is #184. |
| PM-D | Leaderboards, leagues, purchasable streak freezes, XP and gem economies, daily loss-aversion reminders, deadline resets, paywalled mistake practice, cosmetic rewards | Contradicted by the evidence (Hanus & Fox 2015; Shute 2008 Table 3; Deci et al. 1999; Silverman & Barasch 2023) and by Lumen's principles. |
| KV not recommended | A global force graph as a headline feature; block ids and transclusion in lectures; tldraw (licence key); full Excalidraw on the startup path; hosted AI (Heptabase, Excalidraw, Tana); third-party web embeds | Phone legibility, annotation offsets, licence, budget, privacy and offline use. |
| KV other | Logseq journals as the landing page; Excalidraw library, draw-to-shape and laser; Zotero related items and number-key tags | Low learning value. The Today card, #120, #154, #156 and #183 cover the useful parts. |

### Findings from this verification pass (not in the reports)

- **V-1** (#150). An in-page `#heading` link replaces the Reader with Home: `links.js:7` returns null, and `parseRoute` falls back to Home.
- **V-2** (#150). A lecture link in Teaching Mode navigates the whole page away. The slide has no click handler, and the server returns 404 for paths with an extension.
- **V-3** (#148). Crunch inflation also inflates the "Mastered" counts (`review.js:259`, `mastery.js:61`).
- **V-4** (#148). The Extra practice notice implies the schedule is untouched (`ReviewCenter.jsx:810`).
- **V-5** (#153). Mistake hints are also missing from the Markdown export.
- **V-6** (#170). The target date is already editable on Home (`App.jsx:587`), so the interview plan doesn't need #112.
- **V-7** (§6). Ask AI on a selection does reserve the open lesson in the Mac tutor. No defect.
- **V-8.** Several open issues still quote budget headroom from before #143. #114 cites install route screens at 891,828 of 900,000 B, and #113 cites 34,357 B of entry headroom. PR #143 measured startup at 618,566 B and install route screens at 685,498 B on 28 Sep; PR #145's notes (cbd4089) give 623,582 B and 690,571 B. The local `dist/` predates #143. Re-measure with `npm run size` before relying on any figure.

**Independent review of the drafts (V-9 to V-23)**

- **V-9** (all). `main` moved from `01c7a89` to `45826f7` during the review (PR #145, safe storage). Every file:line was remapped through the diff and re-read; none of the cited lines changed content. Web Storage in `src/` must now go through `src/lib/safeStorage.js` (`safeStorage.test.mjs` fails otherwise), so #155, #176, #186 and the #125 comment say so, and #155 no longer waits on #139.
- **V-10** (#150). The Reader must not import `linkAudit.js`: it is a warm tool, and `scripts/audit_app.mjs:112-115` fails the build if it joins the route screens. `linkTarget` moves to `links.js`.
- **V-11** (#180, #181, #183, #189). Every board load, backup, sync and import runs `normalizeBoardStrokes` (`src/lib/db.js:1081-1105`). It keeps only known fields, turns unknown tools into `pen` and drops objects without `points`. The drafts now name the fields they add and model source cards and images as `tool` objects with bounding points. #180 makes unknown tools inert (a deliberate change to `boardInterchange.test.mjs:57`, keeping its hostile-input checks), #181's provenance gains the `nodeId` #182 matches on, and shapes gain in-shape labels (rectangles and ellipses draw no text today).
- **V-12** (#189). Backups (`backup.js:259`, `:335-345`), vault sync (`syncVault.js:53`) and recovery (`App.jsx:168`) filter `board:` themselves, so `isOwnedDataKey` alone would not carry `board-asset:` records. Images are stored as base64 (about 270 KB per 200 KB image) and need reference-aware deletion.
- **V-13** (#174). `normalizeAssessments` drops records without an integer `partNumber` (`assessment.js:227`), so mixed checks use `partNumber: 0` plus `partNumbers`.
- **V-14** (#185). `marked` does not strip YAML front matter (the Reader would show a rule and a heading), so concept notes use tags.
- **V-15** (#154, #155, #169). `UndoStrip` moves focus to Undo on mount (`UndoStrip.jsx:22-25`), so the one-tap toast needs a non-focusing option. The Reader has no `onGrade`: #155 passes `gradeReview` in, and Forgot logs a mistake like any Again.
- **V-16** (#156, #160, #175). Corrected claims: no chapter links to another chapter (the one chapter link goes to a Part README); no spacing rule applies to `.markdown-body`, although UI CSS uses `letter-spacing` widely; `fsrsGrade` also reads retrievability.
- **V-17** (#178). A new Classic card graded Good gets 1 day, not 3, so the fuzz criterion now uses repetition-1 cards. `fuzzDays` joins the attempt normalizer and `reviewAttemptEvent`.
- **V-18** (#176, #178, #186). Settings has no Review or Labs section; review settings live in the Review center strip (`ReviewCenter.jsx:892`), and SQL consent sits on the Worksheet labs strip. #176's report is now the "scheduler-fit report", distinct from #114's confidence calibration.
- **V-19** (#186). sql.js 1.15.0 and 1.15.1 shipped on 14 and 19 Oct; the draft pins 1.14.2 (14 Aug: `sql-wasm.wasm` 658,410 B, 321,811 B gzipped). WebKit's CSP for module workers joins the #7 device checks.
- **V-20** (#188). On-device Lite validates against the server's `AI_TASKS` (`phoneLocalAi.js:67-68`, `:252`), so `code_mentor` becomes a valid Lite request; the UI still offers none.
- **V-21** (#156, #184). `audit:ai` globs only `server/*/` and `src/lib/`, so a `scripts/lib/*.test.mjs` file would never run; the tests move to `src/lib/`.
- **V-22** (scope). Two overlaps were cut rather than merged: #177's "Also in" line (owned by #156 and the #117 comment) and #183's concept cards (covered by #185). #183 and #189 share one `ref` shape and heading picker. #179 now depends on #171. No draft was dropped or merged; 42 remain.
- **V-23** (#129 comment). A page receives the same `nexttrack` from headphones, the lock screen and Control Center, so the optional remap changes all three.

## 7. Finding index

| ID | Destination |
|---|---|
| **memory-srs.md** | |
| MS-N1 | #148 |
| MS-N2 | #149 |
| MS-N3 | #165 |
| MS-N4 | #170 |
| MS-N5 | #169 |
| MS-N6 | #151 (definition), #175 (estimated knowledge), #165 (card info) |
| MS-N7 | #171; #128 comment |
| MS-N8 | #164 |
| MS-N9 | #166 (backlog, new-card hold), #178 (fuzz, load balancing, Easy Days) |
| MS-#157 | deferred |
| MS-#158 | #172 |
| MS-#159 | #176 |
| MS-#160 | deferred |
| MS-#161 | #179 |
| MS-#162 | #174 |
| MS-#163 | #115 comment |
| MS-#164 | deferred (evidence-gated) |
| MS-E1–E10 | covered: #114, #115 (comment), #116 (comment), #113, #118, #122, #120, #121, #128 (comment), #111/#112 |
| MS-X | shipped |
| MS-A1 | #176 (fit check, grade guidance), #178 (simulator); FSRS-5/6 deferred |
| MS-A2 | #149; day boundary deferred |
| MS-A3 | #166, #174 |
| MS-A4 | #171 |
| MS-A5 | #178 |
| MS-A6 | #165 |
| MS-A7 | #148, #164 |
| MS-A8 | #179 |
| MS-A9 | #151, #165, #175; calendar covered by #120 |
| MS-A10 | #164 |
| MS-A11 | #176 |
| MS-R1 | #171 (direction); #113 comment (context) |
| MS-R2 | #115 comment; list/set cards deferred |
| MS-R3 | #170 |
| MS-R4 | #148, #164 |
| MS-R5 | deferred with MS-#157 |
| MS-R6 | #165 |
| MS-R7 | #176; per-folder schedulers not adopted |
| MS-M1 | #149, #176; learn phase deferred |
| MS-M2 | #171; typed cloze covered by #114 |
| MS-M3 | #164 |
| MS-Q1 | #149 (re-test); MCQ progression not adopted |
| MS-Q2 | shipped (readiness checks) |
| MS-S1, MS-S2 | #163 |
| MS-S3 | #165 (tips); rule 19 deferred |
| MS-O1 | #169 |
| MS-O2 | not adopted |
| MS-O3 | #148; gentle lapse not adopted |
| MS-O4 | #149; event model shipped |
| MS-W1 | #116 comment |
| MS-W2 | #172; half-life not adopted |
| **reading-listening.md** | |
| RL-N1 | #154 (a), #159 (b, c) |
| RL-N2 | #162; gesture in #129 and #7 comments |
| RL-N3 | #161 |
| RL-N4 | #158 |
| RL-N5 | #155; #118 comment |
| RL-N6 | #160 |
| RL-N7 | #177 (a, c), #156 (b); #117 comment |
| RL-N8 | #184 |
| RL-N9 | #116 and #123 comments |
| RL-#157 | #154 |
| RL-#158 | #7 comment (evidence gate) |
| RL-#159 | #157 |
| RL-#160 | deferred |
| RL-#161 | #159 (Find); #117 comment (Define); tutor explain already shipped |
| RL-#162 | deferred |
| RL-A | shipped |
| RL-B | covered, plus comments on #116, #117, #123 and #125 |
| RL platform notes | §6 "not adopted" |
| **practice-mastery.md** | |
| PM-G1 | #168 |
| PM-G2 | #167 |
| PM-G3 | #175 |
| PM-G4 | #173; #118 comment |
| PM-G5 | #174 |
| PM-G6 | #186 (SQL); Parsons and Pyodide deferred |
| PM-G7 | #188 |
| PM-G8 | #152 |
| PM-G9 | #153 |
| PM-G10 | #164 |
| PM later (FIRe) | deferred |
| PM-B | covered |
| PM-C | shipped |
| PM-D | not copied |
| **knowledge-visual.md** | |
| KV-G1 | #179 (1–2), #182 (3) |
| KV-G2 | #150 (heading fix), #156 (mentions, backlinks) |
| KV-G3 | #183 |
| KV-G4 | #180 |
| KV-G5 | #181 |
| KV-G6 | #164 (scope), #174 (mix) |
| KV-G7 | #172 (a), #171 (b) |
| KV-G8 | #157 |
| KV-G9 | #187; #128 comment |
| KV-G10 | #185 |
| KV-G11 | #163 |
| KV-G12 | deferred |
| KV-G13 | #189 |
| KV-G14 | #180 |
| KV-G15 | #183 |
| KV-G16 | #128 comment |
| KV existing and issue rows | shipped or covered |
| KV deferred by design, not recommended, design notes | §6 |

## 8. Notes for the person creating the issues

- **Labels and milestones.** Use the exact names in the manifest. They match the repository: milestone titles use an em dash, and every label exists.
- **Creation order.** Create the issues in key order. Then replace N-keys with issue numbers in each body, in each comment's text, and in `depends_on`.
- **Comments.** The drafted comments are ready to post as written, after the same key substitution.
- **Device-only items.** Every issue's Notes section names its device-only checks. #7 collects them.
- **Local-only evidence.** Probes, captures and screenshots stay local and are not committed. These repository copies of the reports say "captured locally (not committed)" wherever a local path appeared.
