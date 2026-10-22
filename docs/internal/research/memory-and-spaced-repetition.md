# Memory and spaced-repetition platforms: what Lumen should learn

> Repository copy prepared on 2026-10-22 for `docs/internal/research/`. Local paths to captures, probes and clones are replaced with "captured locally (not committed)"; screenshots are not included. REA evidence ids and citations are unchanged; code references (`path:line`) are to `main` at `01c7a89`, the research baseline, unless the text names another commit. Candidate ids in this report (N1, G1, Gap 1, …) are its own; `SYNTHESIS.md` maps every one of them to an issue draft, an existing issue, or a recorded deferral.


Research date: 2026-10-22. Scope: Anki, RemNote, Mochi Cards, Quizlet, SuperMemo, Quantum Country and Orbit (the mnemonic medium), plus one added platform, Readwise, whose highlight resurfacing is the model for Lumen issue #116. The question throughout: which memory features help a self-directed learner most, how they actually work, why they work, and how they fit Lumen (local-first, iPhone-first, no paid or cloud AI, an AI/ML interview curriculum).

Nothing in the Lumen repository was edited. Two read-only probes ran Lumen's own scheduler code outside the repository (Appendix A).

---

## 0. Top findings at a glance

| # | Finding | Platforms | Lumen status |
|---|---|---|---|
| 1 | Under the default Classic scheduler, early "Good" grades in Crunch multiply the interval by ease regardless of elapsed time (10 → 25 → 62.5 → 156 days in three passes). | Anki review-ahead, RemNote Practice All, Mochi cramming, Orbit elapsed-based growth | **New (defect)** |
| 2 | No learn-ahead: failing the last due card ends the session, the card returns about 14 minutes later (the "10-minute" step is rounded to 0.01 day), and Crunch never re-asks a failed card. | Anki learn-ahead limit, Mochi re-review, Orbit 10-minute retry | **New** |
| 3 | No leech detection or triage; Crunch drills the most-lapsed cards first. | Anki leeches, RemNote leech threshold | **New** (partial: tutor "Help me remember" starters) |
| 4 | Nothing reshapes card scheduling around an interview date; `goals.targetDate` only drives reading pace. | RemNote exam scheduler | **New** (date capture is #112) |
| 5 | Prompts embedded in the reading, answered in place and enrolled into review, are the core of the mnemonic medium. | Quantum Country, Orbit | **New** (partial: #118, #122 part B, #113) |
| 6 | "30-day recall" counts every attempt (Crunch, first-ever grades, relearning re-grades), so it cannot be compared with the target retention. | Anki true-retention table, retrievability stats | **New** |
| 7 | One card per cloze, all blanks revealed together; no reverse or concept cards; no sibling separation. | Anki, RemNote, Mochi, Orbit | **New** |
| 8 | No custom or filtered study by Part, tag or state, and no "practice without rescheduling"; deck search is a plain substring match. | Anki filtered decks and search, RemNote, Mochi saved views | **New** (#114 adds the `onlyIds` building block) |
| 9 | No fuzz, load balancing or easy days; the backlog is ordered by due date, not retrievability; new cards keep arriving during a backlog. | Anki 24.11+ | **New** |
| 10 | Typed answers and confidence before reveal, step reveal, highlight resurfacing and starter decks are confirmed by every platform studied. | RemNote, Mochi, Anki, Readwise, Quizlet | **Issues #114, #115, #116, #113** |

The full list (24 candidates) is in section 5.

---

## 1. Method, boundaries and evidence

### 1.1 Tools

All captures, notes, probes and clones were kept locally and are not committed.

- **REA `capture_browser_scenario`** (headless Chrome 156) was the primary tool: page loads, clicks and waits, with accessibility snapshots, DOM and screenshots. Results were parsed with small scripts in captured locally (not committed) (`extract.py`, `a11y2text.py`, `join.py`).
- **Public source.** The Anki manual (github.com/ankitects/anki-manual, CC BY-SA 4.0, commit 91f7485, 2026-10-06) and Orbit (github.com/andymatuschak/orbit, commit ed5a530, 2024-10-13) were shallow-cloned into captured locally (not committed) and read, not executed.
- **WebSearch** located help-centre URLs. **WebFetch** and one read-only GitHub API call (through the repo's `git gh` alias) read Anki's 24.11 release notes.
- **Lumen.** I read the code with grep and ran two read-only probes (Appendix A). Issues were read with `git gh issue list/view`.

### 1.2 robots.txt and access

| Host | robots.txt | Outcome |
|---|---|---|
| docs.ankiweb.net | 200; allows docs (`Content-Signal: ai-input=yes`) | Used |
| help.remnote.com | 200; `Crawl-delay: 1` | Used, with at least 2 s between loads |
| mochi.cards | 404 (no rules) | Used |
| quizlet.com | Bot challenge even for robots.txt (curl got a 403 CAPTCHA page; the REA browser got "One more step…", ev_10573b08) | **Stopped. Not bypassed.** |
| help.quizlet.com | 200 (allows /hc articles), but article pages return a Cloudflare "Performing security verification" page (ev_dd9cc4a6) and WebFetch gets 403 | **Stopped. Quizlet facts come from search-engine summaries of its help pages (lower confidence).** |
| help.supermemo.org | Cloudflare "Just a moment…" challenge on robots.txt | **Not loaded.** Used supermemo.guru (MediaWiki; robots allow /wiki/) and super-memory.com (robots 404) |
| quantum.country | 200; disallows /landing and /login only | Used; sign-in never touched |
| withorbit.com | Serves the SPA HTML (no rules) | Used once |
| docs.readwise.io | 200; Allow: / | Used |

No logins, no account or guest creation, no paywall or CAPTCHA bypass, no form filling.

### 1.3 Page loads per site

- docs.ankiweb.net: 14. One batch of 8 loads lost its content when REA's browser cleanup timed out, and 2 loads were in a run where I mistakenly captured URLs only. I then stopped loading that site and read the rest of the manual from its CC BY-SA source.
- help.remnote.com: 8.
- mochi.cards: 4.
- quizlet.com: 1 (challenged).
- help.quizlet.com: 2, plus 1 fetch (all challenged or refused).
- supermemo.guru: 4.
- super-memory.com: 1.
- quantum.country: 3.
- withorbit.com: 1.
- docs.readwise.io: 2.
- GitHub: 2 shallow clones, 2 release-notes fetches (one returned no answer) and 1 API read.

All loads were spaced at least 2–3 seconds apart, and none was rapid crawling.

### 1.4 Evidence index

| Evidence id (REA) | URL | Content |
|---|---|---|
| ev_b73682b15703666762c6da435c4252724eddaeeb8771b85e734cb182c28c2634 | docs.ankiweb.net/manual/deck-options | Anki deck options: limits, learning steps, display order, burying, Easy Days, FSRS, desired retention, simulator, advanced |
| ev_7621189a056ae4d1f3442127679f9d3567da5d93b79b93d624c818d61a567713 | docs.ankiweb.net/manual/leeches; /manual/filtered-decks | Leeches; filtered decks, custom study, reviewing ahead, rescheduling, catching up |
| ev_5eb2ec147d62dbc14f5526b6f83b7dc83642cf93f3dcc178bb0e4ceb2729bd4d | docs.ankiweb.net/manual/preferences | Next day starts at 4 AM; learn-ahead limit 20 min; timebox |
| (source) | anki-manual `src/studying.md`, `stats.md`, `searching.md`, `editing.md` @91f7485 | Answer buttons, fuzz factor, siblings and burying, statistics, search properties, image occlusion |
| (fetch) | github.com/ankitects/anki/releases/tag/24.11 (read via the GitHub API; text captured locally, not committed) | Load balancer, Easy Days, descending-retrievability sort for backlogs, true retention, estimated total knowledge |
| ev_9cc1f599e246e1b1be9d5963fb63e53a115e9d040ab39011556f3039c17835ce | help.remnote.com/en/articles/6025481, /9216774 | Card types (basic, concept, descriptor, cloze, multiple choice), context, multi-line list and set cards |
| ev_f04baad1e8a317ff1556dd2dabc872c6ac032cfafd27365e5018e72182b427b6 | help.remnote.com/en/articles/9101991, /6904503 | Exam scheduler; practising specific cards; practice modes |
| ev_fe2b9fbb2379ea8a1249abda6a4803ab0ab659225ed0a58f6916d960a69672ab | help.remnote.com/en/articles/9337171, /6958056 | Spaced-repetition theory and ratings; custom schedulers (SM-2, FSRS v6) |
| ev_6199d6f13a40bf2b7c4c6933de68f146affe2d8bbc68b8c24ff79ba75176c100 | help.remnote.com/en/articles/7950982, /7183408 | Priorities and disabling; leech handling |
| ev_2eabd12308a095105cea7db8ea5e05c270b3dfe2d07e48bc490412531a8e7211 | mochi.cards/docs/reviewing, /docs/reviewing/cloze-deletions/ | Mochi algorithm, learn phase, re-reviews; cloze groups, typed cloze, diagram cards |
| ev_036f8c846c94537ebbbfb7ee1832295af8b84aec8187412665e37a57dfb98155 | mochi.cards/docs/reviewing/cramming/, /fsrs/ | Cramming outside SRS; FSRS with binary grades |
| ev_10573b08bb54e8fc714b4bba961d63aa75f2fa5304032fd1abc5839d9a007b18 | quizlet.com/robots.txt | Bot challenge (documents the stop) |
| ev_dd9cc4a6118c62ba7eb1dbbab5ca1067f2d4aeea36816b89e74541dd8ad0b516 | help.quizlet.com Learn and Test articles | Cloudflare challenge (documents the stop) |
| ev_bbce8d28aea04d938da53afd11d8360b0d9aa91f5946fba47ade01890b613d35 | supermemo.guru/wiki/Incremental_reading, /Priority_queue | Incremental reading; priority queue |
| ev_12241c3cc6fdc274bf0e6716f6874b9ba9aac4a43216f766cafdc685e28a1429 | supermemo.guru/wiki/Incremental_reading_step_by_step; super-memory.com/articles/20rules.htm | Extract-to-cloze workflow; the 20 rules of formulating knowledge |
| ev_3f9efa268c687875a9c1af180cfec50a3d33a049d694cd2559c4c452bade7726 | supermemo.guru/wiki/Auto-postpone | Overload handling by priority |
| ev_3d7bb47d2f1f9795a1aa1f1127622183b132340dd59a701a9fe29da6d74a8494 | quantum.country/qcvc (393×852) | 18 embedded review sets, "Remembered" / "Didn't remember" |
| ev_b1379d56dfc4383379d82c6ed84ce1b37576a8fa77cd0201b0d50588b042a60d | quantum.country/qcvc (DOM) | Review-area structure: buttons disabled until reveal |
| ev_468d44df96a87ad0fb9959eb0a82d759cc8d48c5a0fd2d94d8ff7c7dd2ed3960 | quantum.country/qcvc (interaction) | Tap reveals the answer; schedule ladder; next prompt slides in; final accessibility snapshot shows the hidden answer exposed before reveal. Screenshots `captures/qc-3.step3.png`, `step5.png`, `step7.png` |
| ev_f654e959d78b9ac670f63a28c345b0d5307577ca2ac45d48bdfbeb1db79c3b31 | withorbit.com | Orbit's model and schedule as described to readers |
| (source) | orbit `packages/core`, `packages/web-component` (Apache-2.0) @ed5a530 | Scheduler, review queue, event model, prompt authoring |
| ev_8c3c0b463d08467defd7b70af9e53db0d388c2b99a0c638f6b44f37275376f89 | docs.readwise.io/readwise/guides/mastery; /docs/faqs/reviewing-highlights | Daily Review, frequency tuning, Mastery half-life scheduling, audio review |

### 1.5 Licences and copying

- **Anki manual:** CC BY-SA 4.0. It was read for facts only, and nothing here is copied text.
- **Orbit:** Apache-2.0, except `packages/app` and `packages/backend`, which are AGPL-3.0+ or BUSL-1.1. I read only the Apache-2.0 packages (core, web-component) and describe their design in my own words. No Orbit code should enter Lumen (MIT) in any form, and AGPL code never.
- **Proprietary pages** (RemNote, Mochi, Readwise, SuperMemo, Quantum Country) are paraphrased, with at most a few words quoted and attributed.

### 1.6 Untrusted content and prompt injection

All captured page text, DOM and code was treated as data. **No prompt-injection attempt was observed** in any captured page or file. RemNote articles carry a "Copy for LLM" button, which is an ordinary page feature and not an instruction. Anki's robots.txt carries a `Content-Signal: ai-input=yes` permission header.

---

## 2. Lumen today (baseline for the comparison)

From README.md, docs/guides/APP_GUIDE.md and the code:

- **Cards** (`src/lib/review.js`)
  - Eight card types: basic, cloze, formula, derivation, compare, debugging, code-output, production-scenario.
  - Fields: front and back, tags, source document, `sourceClippingId` and `sourceAnnotationId`, suspend, archive, bury-today.
  - Cloze uses `{{…}}`, and every blank is hidden and revealed together on a single card (`renderClozePrompt`, review.js:447).
  - No reverse cards and no note/sibling grouping.
- **Schedulers**
  - Classic, an SM-2 family (`intervalForRating`, review.js:264), is the default (`db.js:872`).
  - Adaptive is FSRS-4.5 (`src/lib/fsrs.js`). It is opt-in, with a target retention of 80, 85, 90 or 95%, per-learner calibration (`fsrsOptimizer.js`, needing at least 50 predictions and 5 lapses), and a migration that replays history.
  - Again gives a "10-minute" learning step.
- **Queue** (`buildReviewQueue`, review.js:206)
  - Per-local-day limits for new cards and reviews, split at midnight in the device time zone.
  - Due cards are sorted by due date, then weakest first; new cards by creation date. New cards are always appended up to the new-card limit (review.js:229).
  - "Crunch weak cards" practises up to 20 cards ordered by lapses, then ease, outside the daily limits.
- **Session:** a 1–5 confidence rating after reveal, Undo, Bury today, timed interview rounds and worksheet labs.
- **Analytics** (`reviewAnalytics`, review.js:353): 7- and 30-day recall, median answer time, streak, a 7-day forecast and a 12-week recall trend. With FSRS on, a retention-workload planner shows steady-state reviews per day (the sum of 1/I, `retentionPlanner.js`).
- **Learning loop**
  - A mistake notebook: Again auto-logs a mistake, repeats merge, corrections are written in the learner's own words, and "Schedule corrective review" makes the card due now.
  - Readiness checks with choice, cloze, numeric and self-graded questions.
  - A mastery ladder (`mastery.js`): a Part is "mastered" when 3 or more of its cards reach a 14-day interval.
  - A daily session plan of 15, 30 or 60 minutes.
- **Reader:** highlights in four colours with comments; a highlight or clipping becomes a card draft whose front says "Explain this excerpt…" and whose back is the quote (App.jsx:2409). Teaching mode can conceal each section for active recall.
- **AI:** tutor quizzes with confidence and confident-misses-first ordering, and tutor-generated flashcards marked as AI drafts.
- **Sync:** encrypted file-based sync that replays review attempts under the merged scheduler (`profileSync.js`).
- **Reminders:** per docs/REMINDERS_DESIGN.md, only an opt-in silent badge; no Web Push, no guilt mechanics.
- **Open learning-loop issues:** #111–#123, #128 and #85 (section 5.3).

---

## 3. Platform findings

For each feature: **Observed** (flow, settings, data model, defaults, with evidence), **Why it works** (learning science, references in section 7), and **Fit for Lumen**.

### 3.1 Anki

**A1. Desired retention, FSRS, optimizer, simulator and health check** (ev_b73682b1)

- **Observed**
  - FSRS is an alternative to SM-2 and is enabled globally.
  - Desired retention defaults to 90%. The manual calls it the most important FSRS setting and advises staying below 97% because the workload grows steeply.
  - Recent versions allow a separate desired retention per deck within one preset.
  - An "Optimize" button fits parameters to the learner's history (monthly is enough), and a slow optional health check reports how well FSRS fits.
  - "Help Me Decide" is a simulator. It uses the cards' real memory states, new cards per day, the review limit, the maximum interval, and optionally extra simulated cards, and it shows reviews or minutes per day at different retention levels.
  - "Compute minimum recommended retention" was removed in 25.07.
  - FSRS-5 can handle short-term (same-day) scheduling when the learning steps are left empty.
  - The manual repeatedly warns that pressing Hard when you have actually forgotten breaks FSRS: Hard counts as a pass.
- **Why it works.** Spacing and retrieval practice (Cepeda et al. 2006; Roediger & Karpicke 2006). FSRS is a fitted memory model (Ye et al. 2022; Su et al. 2023). Accurate grading matters because the model learns from the learner's own judgements.
- **Fit.** Lumen already has the dial, calibration and a steady-state planner, which is good parity. What is missing:
  - a time-based simulator (Lumen's planner shows only the steady state, not the next 30 days with new cards added);
  - a fit check after calibration;
  - guidance on the meaning of each grade (see #159);
  - FSRS-5/6 (Lumen is pinned to 4.5).

**A2. Learning steps, the learn-ahead limit and the day boundary** (ev_b73682b1, ev_5eb2ec14)

- **Observed**
  - Learning steps are a list of delays (for example 1m 10m). Again returns the card to the first step, Good advances it, and Hard on the first step averages the first two steps.
  - Steps that cross a day boundary are converted to days.
  - With FSRS, steps under a day are recommended, and repeating a card many times in one day adds little long-term memory.
  - "Learn ahead limit" (default 20 minutes): if nothing else is left, learning cards due within 20 minutes are shown early.
  - "Next day starts at" defaults to 4 AM, so studying around midnight does not get two days' cards.
  - Timeboxing periodically reports progress within a time limit.
- **Why it works.** Re-testing after an error, within the same session, strengthens the corrected memory (successive relearning: Rawson & Dunlosky 2011; feedback: Pashler et al. 2005; Kang et al. 2007).
- **Fit.** Lumen has the 10-minute step but no learn-ahead. Its days split at midnight, and its step is really 14.4 minutes because intervals are rounded to 0.01 day (review.js:313). This becomes N2 and #160.

**A3. Display order and backlog handling** (ev_b73682b1; 24.11 notes)

- **Observed**
  - Separate gather and sort orders for new cards: by deck, ascending position, random notes, and card type with siblings spread out.
  - New cards can be shown before, after or mixed with reviews.
  - Review sort options include due date then random (the default), intervals, ease, and "relative overdueness". The deck-options page recommends relative overdueness (FSRS equivalent: ascending retrievability) for a large backlog.
  - The newer 24.11 release notes add **descending retrievability** and say, in their words, that simulations have shown it is "a better choice when you have a backlog", likely to become the default. The two Anki sources disagree; the newer, simulation-backed advice is to rescue the cards you can still recall before they slip, rather than spend the backlog on cards that are probably already forgotten.
  - The manual warns that a fixed deck-by-deck order lets context give answers away.
  - By default the review limit also stops new cards ("New cards ignore review limit" is off), and the manual advises stopping new cards until a backlog clears.
- **Why it works.** When behind, ordering by retrievability decides which memories are saved. Interleaved order prevents learning answers from position (Rohrer & Taylor 2007; Brunmair & Richter 2019).
- **Fit.** Lumen sorts due cards by due date and always adds new cards, and new cards arrive in creation order, so cards made from one lecture appear as a block. This becomes N9 and #162.

**A4. Siblings and burying** (ev_b73682b1; `studying.md`)

- **Observed.** Cards generated from one note (forward and reverse cards, or different cloze numbers) are siblings. Burying hides a card's siblings until the next day, with separate switches for new, review and interday-learning siblings. Learning cards are never buried. A card cannot be both buried and suspended.
- **Why it works.** Siblings share content, so answering one makes the next trivially easy: massed rather than spaced retrieval of the same information (Cepeda et al. 2006).
- **Fit.** This only matters once Lumen has multi-card notes (N7). Orbit enforces the same rule structurally (3.6).

**A5. Fuzz, load balancer and Easy Days** (`studying.md`; 24.11 notes; ev_b73682b1)

- **Observed**
  - A small random fuzz stops cards added and graded together from always coming due on the same day, and learning cards get up to 5 minutes of extra delay. Fuzz cannot be turned off.
  - The 24.11 load balancer picks, within the fuzz range, the day with the fewest reviews.
  - Easy Days marks weekdays as Normal, Reduced or Minimum; intervals are adjusted slightly, existing cards are not changed retroactively, and setting every day to Reduced is the same as Normal.
- **Why it works.** The spacing benefit is broad around the optimal gap (Cepeda et al. 2008), so a day's shift costs almost nothing and keeps the workload predictable, which matters for sustaining a habit.
- **Fit.** Lumen has none of these, and its batch card creation (starter decks #113, AI flashcards) will create clumps. Fuzz must be deterministic because sync replays grades (N9).

**A6. Leeches** (ev_7621189a)

- **Observed**
  - Each lapse increments a counter. At 8 lapses Anki tags the note "leech" and suspends the card; the threshold and the suspend action are configurable. Warnings then repeat every half-threshold (12, 16, …).
  - Recommended handling: rewrite the card (often the information is too large or not understood; follow Wozniak's 20 rules or add a mnemonic), delete it, or wait out interference by suspending one of two confusable cards.
- **Why it works.** Repeated failure signals a badly formed card or interference (Underwood 1957; Wozniak 1999). Drilling a bad card wastes time; reformulating fixes the cause.
- **Fit.** Lumen has none (N3).

**A7. Filtered decks and custom study** (ev_7621189a)

- **Observed**
  - Custom Study presets: raise today's limits, review forgotten cards (Again within N days), review ahead, preview new cards, and study by state or tag.
  - Manual filtered decks take any search, a limit, an order (oldest seen, random, intervals, most lapses, added, due, relative overdueness or retrievability) and an optional second filter.
  - Cards return to their home deck after study.
  - "Reschedule cards based on my answers" can be turned off for preview-only practice.
  - **Reviewing ahead uses a special algorithm:** a card reviewed soon after its last review gets a new delay close to its previous one, so repeated review-ahead is called "not appropriate for repeated use".
  - The manual gives a backlog recipe: a "just due" deck plus an "overdue" deck worked through like new cards.
- **Why it works.** It allows targeted retrieval practice on weak or exam-relevant material (Dunlosky et al. 2013) without corrupting long-term schedules. Early reviews add little stability, because stability grows mainly after a delay (spacing).
- **Fit.** Lumen's Crunch is a single fixed filter (most lapses), and it does reschedule. Under Classic it reschedules without regard to earliness (N1, N8).

**A8. Image occlusion** (`editing.md`)

- **Observed.** Since 23.10 this is a built-in note type. Rectangle, ellipse or polygon masks; modes "Hide All, Guess One" or "Hide One, Guess One"; Header, Back Extra and Comments fields; one card per shape or group.
- **Why it works.** Dual coding and spatial retrieval (Paivio 1986; Mayer 2009). Wozniak's rule 8 treats graphic deletion as being as good as cloze deletion.
- **Fit.** Lumen's lectures have 79 Mermaid diagrams in 65 files. Because they are text, a "diagram card" can hide node labels without any image editing (#161). The tracker's LEARN-002 row already lists "diagram card rendering" as remaining work.

**A9. Statistics** (`stats.md`; 24.11 notes)

- **Observed**
  - Future due, with "daily load" computed as the sum of 1/interval.
  - A calendar heatmap; review counts and time by card maturity; an interval distribution.
  - FSRS stability, difficulty and retrievability distributions.
  - "Estimated total knowledge": average retrievability times the number of reviewed cards.
  - An hourly success breakdown; answer-button usage.
  - A **true retention table**, counting only the first review of each card per day, splitting young and mature cards (mature means an interval of 21 days or more), with Again a fail and Hard, Good and Easy passes. The manual expects true retention to be close to desired retention under FSRS.
  - Card info shows the full review history, and 24.11 adds a forgetting curve.
- **Why it works.** Metacognitive calibration. Learners misjudge their own retention (Koriat & Bjork 2005; Dunlosky & Rawson 2012), and a metric aligned with the scheduler's target makes the retention dial meaningful.
- **Fit.** Lumen's planner matches "daily load". Its recall percentages, however, include Crunch, first-ever grades and relearning re-grades (review.js:353 has no filter), and there is no per-card history view (N6).

**A10. Search and browse** (`searching.md`)

- **Observed.** State filters (`is:due`, `is:new`, `is:learn`, `is:suspended`, `is:buried`); properties (`prop:ivl>=10`, `prop:due=1`, `prop:lapses>3`, `prop:reps<10`, and for FSRS `prop:s>21`, `prop:d>0.3`, `prop:r<0.9`); history (`rated:7:1`, `introduced:1`). The same syntax feeds filtered decks.
- **Fit.** Lumen's library search already has a rich syntax (`title:`, `part:`, `tag:`, `has:`), but the deck search is a substring over front, back, type and tags (ReviewCenter.jsx:612). Reusing the library's parser for card state is natural (N8).

**A11. Answer-button guidance** (`studying.md`)

- **Observed.** Again for wrong or not recalled, "be strict"; Hard for correct but doubtful or slow; Good for correct with effort; Easy for effortless. Typical shares: Again 5–20%, Good 80–95%. Two-button use (Again and Good only) is explicitly fine.
- **Fit.** Lumen's rating panel shows labels and intervals but no meanings (#159).

### 3.2 RemNote

**R1. Card types and direction** (ev_9cc1f599)

- **Observed**
  - Basic cards are created with `>>`, with reverse and bidirectional variants. Concept cards (`::`) are bidirectional by default. Descriptor cards (`;;`) describe an attribute of their parent concept and are forward-only by default. Cloze uses `{{ }}`. Multiple choice uses `A)`. Image occlusion is created by Ctrl/Cmd-clicking an image. Any card can be disabled.
  - **Context:** during practice RemNote shows the card's ancestor bullets, so prompts need not repeat context. A descriptor's prompt shows its concept, and concept cards hide their back in that context.
  - Cloze with several occlusions can hide them all at once or one per card.
  - RemNote warns that cloze can be artificially easy because the surrounding sentence cues the answer.
  - Multiple choice is shuffled each time and recommended only for exam practice, not general learning.
- **Why it works.** Bidirectional practice: practise in the direction you will be tested (transfer-appropriate processing, Morris et al. 1977). An interview asks both "what is X?" and "which technique solves Y?". The minimum-information principle (Wozniak 1999). Production beats recognition (Kang et al. 2007).
- **Fit.** Lumen lacks direction and concept cards (N7). The ancestor context matches Lumen's planned source anchors (#113); a small breadcrumb above the prompt is cheap.

**R2. Multi-line list and set cards with per-item rating and partial cards** (ev_9cc1f599)

- **Observed**
  - A list card reveals items one at a time and the learner rates each. A set card reveals everything; the learner marks the forgotten items with an X, then rates the rest.
  - When specific items keep failing, RemNote creates **partial cards** that show the other items and ask for the missing one, and returns to the full list once those are mastered.
  - RemNote cautions that long lists are among the hardest things to remember, and that proofs are better learned as networks of reasons than as linear steps (citing Michael Nielsen).
- **Why it works.** The minimum-information principle: a list is scheduled as often as its hardest item, so per-item tracking isolates the weak link.
- **Fit.** This directly extends #115 (stepped derivations with "I got stuck here"). The partial-card refinement is new (#163).

**R3. Exam scheduler** (ev_f04baad1)

- **Observed**
  - Set an exam date on a document or folder, choose the study material, the date, whether more cards will be added (an estimate per week), how to handle unpractised cards, and an optional final review period.
  - The scheduler adds three periods: learning (new cards introduced; a card leaves this period after two repetitions), catch-up (a temporarily raised daily goal to clear a backlog before learning) and final review (every card shown one last time just before the exam).
  - Exam cards are prioritised over everything else.
  - The daily goal adjusts itself, small changes silently and large ones after asking.
  - There is an exam progress bar ("practices remaining") and an Exams tab with on-track status.
  - Per-exam limits: maximum cards per day, target repetitions per card, start date.
  - When new cards arrive the learner chooses the order: "in order" (when ideas build on each other) or "shuffled" (once each card stands alone).
- **Why it works.** The optimal gap depends on how long the material must be retained (Cepeda et al. 2008). With a known test date, the schedule should guarantee high retrievability on that date and a final retrieval close to it. Practice testing before an exam is a high-utility strategy (Dunlosky et al. 2013).
- **Fit.** This matches an interview-prep curriculum closely. Lumen stores `goals.targetDate` but uses it only for reading pace (plan.js:132), so this becomes N4. Notifications must become in-app status (REMINDERS_DESIGN).

**R4. Practising specific cards; practice modes** (ev_f04baad1)

- **Observed**
  - Practice from a document, folder, tag, filtered table, search portal or linked sources.
  - Modes: spaced repetition (due cards only); Practice All (every card, random order); Practice All in Order (Pro); and practice without recording answers.
  - Practice All records answers but **accounts for earliness**, so practising ten times in a row pushes due dates no further than practising once.
  - RemNote advises against in-order practice: context cues and no scheduling.
- **Why it works.** Stability grows mainly when retrieval follows a delay, so early repeats should add little (spacing; Pyc & Rawson 2009 on retrieval effort).
- **Fit.** This is the counterexample to Lumen's Classic Crunch (N1) and the template for custom study (N8).

**R5. Priorities and disabling** (ev_6199d6f1)

- **Observed**
  - Document priorities: Exam > Currently Studying > Maintaining > Paused > No Priority.
  - Maintaining cards appear only after Currently Studying cards are cleared.
  - Paused cards never appear, but their clocks keep running so relearning can be planned.
  - The effective priority comes from the closest prioritised document, and Exam beats everything except Paused.
  - Individual cards can be disabled, including from the queue's menu.
- **Why it works.** Under overload, time should go to the most valuable material (see SuperMemo, 3.5).
- **Fit.** This fits a 23-Part curriculum with target Parts (#112) and known Parts (#157).

**R6. Leech handling** (ev_6199d6f1)

- **Observed.** A warning after a card is relearned and forgotten 4 times (configurable). RemNote claims the hardest 5–10% of cards can take about half of study time. Options: disable the card; edit it (clarify the prompt, split a large card, add background, resolve interference by disabling one card, sharpening the prompts or adding a "distinguish X from Y" card); add a mnemonic or hint; or ignore it, which is rarely right.
- **Fit.** This is the concrete triage flow for N3. Lumen already has a "compare / contrast" card type for the distinguishing card.

**R7. Scheduler settings and theory** (ev_fe2b9fbb)

- **Observed**
  - Four ratings: Forgot, Partially recalled, Recalled with effort, Easily recalled. Each shows its next interval.
  - The end-of-session view shows the upcoming review points (5 days, 14 days, about 1 month, long term).
  - Reasonable desired retention is put at 70–97%. Below 70% you spend more time relearning than you save.
  - At a 90% target, a random card at a random time is recalled about 95% of the time.
  - Stability grows more after a hard success than an easy one, and early practice grows it less.
  - Schedulers (SM-2 or FSRS, including FSRS v6) can be assigned per document or folder and are inherited down the hierarchy.
- **Fit.** This supports descriptive grade labels (#159), per-Part retention (#157) and an FSRS upgrade (#164).

### 3.3 Mochi Cards

**M1. Algorithm, learn phase and re-review** (ev_2eabd123, ev_036f8c84)

- **Observed**
  - The default algorithm is binary: Remembered lengthens the interval and Forgot shortens it.
  - Card states: New, Learned, Archived. Archiving keeps the state and history.
  - New cards go through a **learn phase** until the learner decides to add them to the schedule.
  - **Re-review:** the first lapse in review sends the card to a re-review queue. A second miss there resets the interval and starts relearning; a pass keeps a short interval.
  - Mochi recommends at most about 10 new cards a day on average.
  - FSRS is optional. Binary grades map to Good and Again, and Mochi says this works well.
  - Mochi has no built-in optimizer; its `.mochi` export keeps the full review history for an external one.
- **Why it works.** Getting each card correct once before it enters the long-term schedule (Rawson & Dunlosky 2011); simple grading lowers decision cost on mobile.
- **Fit.** This supports binary-grade mode (#159) and in-session relearning (N2).

**M2. Cloze groups, typed cloze and diagram cards** (ev_2eabd123)

- **Observed**
  - `{{1::…}} {{2::…}}` groups produce separate review variants, each with its own schedule and history.
  - "Type hidden text" adds an answer box that is checked automatically.
  - Diagram cards (image occlusion) show one masked region at a time, and masks can be merged into one review unit.
- **Fit.** Per-blank cloze is N7; typed answers are #114.

**M3. Cramming** (ev_036f8c84)

- **Observed**
  - Cramming studies any subset regardless of due date (even archived cards). Answers **do not** change intervals or history.
  - Cards are selected by search (keywords, tags, linked concepts) and filters (tags, retention rate, status, flags), sorted by alphabet, review date, retention rate or creation date.
  - Views can be saved, for example "Low retention (below 60%)" or "Exam prep (#midterm)".
- **Why it works.** Short-term boosts before a test without corrupting the long-term model.
- **Fit.** This is the "practice only" mode Lumen's Crunch lacks (N1, N8).

### 3.4 Quizlet (limited access)

quizlet.com and help.quizlet.com served bot challenges (ev_10573b08, ev_dd9cc4a6), so I stopped. The following is from search-engine summaries of Quizlet's help pages ("Studying with Learn", "Studying with Test", "Studying with Write mode") and secondary guides; treat it as lower confidence.

**Q1. Learn**

- **Reported**
  - Learn builds a personalised path from the learner's goals and familiarity.
  - Options choose the answer side (term or definition) and the question types; Write and Spell are now part of Learn.
  - Questions are reported to progress from multiple choice to written answers as the learner answers correctly; after a miss in written mode the learner retypes the correct answer.
  - Items move from "remaining" to "familiar" to "known well" after repeated correct answers; missed items are re-tested at the end of each round.
  - Answer Streaks rewards consecutive correct answers.
  - Free users get a limited number of Learn rounds.
- **Why it works.** Moving from recognition to recall is a desirable-difficulty progression (Bjork 1994): recognition scaffolds early, and production then gives the stronger testing effect (Kang et al. 2007). Re-testing missed items to a criterion is successive relearning (Rawson & Dunlosky 2011). Retyping after a miss is corrective feedback (Butler & Roediger 2008).
- **Fit.** Lumen readiness checks already mix choice, cloze, numeric and self-graded questions. What Lumen lacks is relearning to a criterion within a session (N2). A recognition-first phase for brand-new cards is optional; Lumen's #113 deliberately avoids weak multiple-choice distractors, which is sound.

**Q2. Test**

- **Reported.** The learner chooses the number and types of questions and can limit the test to starred terms; submitting shows a score and a review. Progress is not saved if you leave, and free users get one practice test per set.
- **Fit.** This is equivalent to Lumen's readiness checks, which already exist.

### 3.5 SuperMemo

**S1. Incremental reading** (ev_bbce8d28, ev_12241c3c)

- **Observed**
  - A "funnel": import material, read it in portions, **extract** key passages (Alt+X), turn keywords in extracts into **cloze** items (Alt+Z), and review them with spaced repetition.
  - A long article can be split into many parts processed over time.
  - Low-priority articles can be sent to later dates or given a lower priority (Alt+P).
- **Why it works**
  - The generation effect: making your own items aids memory (Slamecka & Graf 1978).
  - Spacing applies to reading itself, since text is revisited over weeks.
  - Small items follow the minimum-information principle.
- **Fit**
  - Lumen has the funnel's first two stages: Reader highlights and clippings.
  - Lumen lacks a one-gesture "selection to cloze" step. Today's draft is a generic "Explain this excerpt" card (#158).
  - Re-reading highlights is #116.

**S2. Priority queue and auto-postpone** (ev_bbce8d28, ev_3f9efa26)

- **Observed.** All items sit in a queue ordered by priority, and learning and review start with the most important. Auto-postpone defers lower-priority reviews when time runs out, so top-priority material is not delayed.
- **Why it works.** Under overload, triage by value keeps the important material on schedule. It is the opposite of the "everything late" failure mode.
- **Fit.** This is #157, together with RemNote R5.

**S3. The 20 rules of formulating knowledge** (ev_12241c3c; Wozniak 1999)

- **Observed.** Wozniak's article sets out twenty rules for formulating knowledge. The ones most relevant to Lumen, paraphrased: understand before memorising; follow the minimum-information principle; use cloze and graphic deletion; avoid sets and enumerations; combat interference between similar items; optimise wording and let context cues shorten it; give sources; date-stamp time-sensitive facts; and prioritise.
- **Fit.** This is the reference for in-app authoring tips: the card editor hint, leech triage (N3) and tutor card reviews. Rule 19 (date stamps) suits fast-moving ML facts (model versions, library APIs). Lumen could show a "last verified" date on cards created from dated content.

### 3.6 Quantum Country and Orbit (the mnemonic medium)

**O1. In-text review, as observed** (ev_3d7bb47d, ev_b1379d56, ev_468d44df; iPhone 393×852)

- **Observed**
  - The essay contains 18 review sets placed after sections. Each is introduced by a short note asking the reader to think of the answer, tap to reveal, and mark whether they remembered.
  - Cards are large, with the question at the top. In the DOM (ev_b1379d56) the two bottom buttons ("Didn't remember", "Remembered") carry a disabled class until the answer is revealed.
  - In this run the first tap revealed the answer (screenshot `qc-3.step3.png`: "How many dimensions does the state space of a qubit have?" → "2").
  - Under the card is a five-stop progress track: **in-text → 1 week → 3 weeks → 3 months → long-term**.
  - After "Remembered" the next prompt (a cloze, "…two-dimensional v____") slides in, buttons disabled again. A sticky header shows the ladder with "1" at in-text (`qc-3.step7.png`).
  - Sign-in is optional ("Sign in" in the header) and only saves progress and sends reminders. I did not use it.
  - Cards render lazily: at page load each card container is empty (ev_b1379d56), and it fills when scrolled into view.
  - Once rendered, the question and ladder are exposed to assistive technology, with three accessibility problems Lumen should not copy (final accessibility snapshot of ev_468d44df):
    - the **still-hidden answer is in the accessibility tree before reveal** (the cloze card exposes "vector" right after its question);
    - the decorative "Click anywhere to reveal" watermark is exposed as about 45 repeated phrases;
    - the reveal is a tap anywhere on the card, not a named button.

    Lumen's review session renders the answer only after reveal (ReviewCenter.jsx:823) and should keep doing so.
- **Why it works**
  - Adjunct questions embedded in text improve learning of the tested material and beyond (Rothkopf 1966; Hamaker 1986).
  - An immediate retrieval attempt after reading counters the illusion of competence that rereading creates (Koriat & Bjork 2005; Karpicke & Blunt 2011).
  - The in-text answer is the first spaced repetition, so review continues without any authoring effort from the reader (Matuschak & Nielsen 2019).
- **Fit**
  - Lumen's Reader is the right host. Lumen already has authored questions (#113) and source anchors.
  - Binary, bottom-anchored buttons are the right iPhone pattern (44 px or more; the review area is one thumb zone).
  - Lumen must use a real "Show answer" button, keep the answer out of the DOM until reveal, and mark decorative elements `aria-hidden`.
  - This becomes N5.

**O2. What Orbit tells readers** (ev_f654e959)

- **Observed.** Orbit prompts readers with quick questions as they read. A few days later it emails an invitation to review; a remembered answer comes back in two weeks, then a month, then two months; a forgotten one contracts the schedule. Prompts are meant to go beyond facts to connections, implications, causes and consequences, reflection and synthesis.
- **Fit.** Lumen has no email by design. The equivalent is the Home "Today" card and the opt-in badge.

**O3. Orbit scheduler design** (`packages/core`, Apache-2.0; described, not copied)

- **Observed**
  - Outcomes are Remembered, Forgotten or Skipped.
  - The first interval is 5 days, and the interval grows by **2.3 times the actual elapsed time since the last repetition**. A review before the scheduled interval keeps at least the current interval and never inflates it from the scheduled value.
  - **Forgotten** divides the interval by 2.3 (floor 5 days) instead of resetting it to zero, and re-shows the card in about 10 minutes.
  - A deterministic jitter of up to 10 minutes keeps prompts from always appearing in the same order.
- **Why it works.** Basing growth on elapsed time is what makes early review harmless. A gentle lapse "limits how much is at stake", trading some efficiency for less frustration in a reader-facing medium.
- **Fit.** This is the design reference for fixing N1. Lumen's FSRS path already uses elapsed time; only Classic needs the fix.

**O4. Orbit queue, data model and authoring** (`packages/core`, `packages/web-component`)

- **Observed**
  - The review queue takes tasks due within a **16-hour look-ahead** (if a card is due later today, review it now), at most 50 per session, ordered by due time.
  - **Only one component per task** (for example one cloze deletion) is shown per session: structural sibling separation.
  - Data is **event-sourced**: task ingest, repetition (with a review-session id and outcome), reschedule, delete, spec, provenance and metadata events are reduced into task snapshots, which makes sync a merge of event logs.
  - Provenance carries a source identifier, URL, title and container title, and W3C-style selectors (text quote, text position, range, XPath) pointing to the passage.
  - Publishers embed prompts with `<orbit-reviewarea>` and `<orbit-prompt>` elements (question and answer, or single-brace cloze, with optional image attachments). The review UI loads in an iframe from withorbit.com.
- **Fit**
  - Lumen already replays attempts for sync (the same idea) and anchors highlights by quote. Existing.
  - The 16-hour look-ahead argues for N2.
  - One component per session is the sibling rule for N7.
  - Lumen's equivalent of `<orbit-prompt>` would be a Markdown prompt block in the notes, part of N5.

### 3.7 Readwise (added platform)

**W1. Daily Review of highlights** (ev_8c3c0b46)

- **Observed**
  - Highlights resurface daily by weighted sampling: a source's chance is its share of all highlights, and per-source "frequency tuning" can raise or lower it.
  - Each showing lowers that highlight's chance of reappearing.
  - Actions: Keep, Discard, Master, Favourite, Tag, Note, and "View in source".
  - Themed Reviews draw on chosen books, articles, notes and tags, and are delivered on chosen weekdays or monthly (FAQ, ev_8c3c0b46). Per a search summary of the Themed Reviews guide, not loaded, each review holds 1–15 highlights (default 5).
  - A "Highlight Quality Filter" drops fragments.
  - The whole review can be played aloud by text-to-speech.
- **Why it works.** Spaced re-exposure keeps material accessible. Paired with conversion to retrieval (W2), it moves from rereading to testing (Roediger & Karpicke 2006).
- **Fit**
  - Lumen #116 (Revisit 5) covers this closely: 5 a day, Keep, Make card, Retire, and Open in context.
  - Audio review is #122.
  - Two refinements from Readwise are worth adding to #116: weighting so lectures with many highlights do not dominate, and a minimum-length filter.

**W2. Mastery** (ev_8c3c0b46)

- **Observed**
  - Any highlight can become a Q&A or cloze card. On mobile the learner taps words to hide them, up to 12 words, and every occurrence is hidden.
  - Scheduling uses a recall half-life: Soon 7 days, Later 14, Someday 28. A card resurfaces once its predicted recall falls to 50% or below, lowest first.
  - After the first Mastery card exists, the Daily Review splits into unprocessed highlights, then Mastery cards.
- **Why it works.** Half-life regression is an established memory model (Settles & Meeder 2016). Converting a passage into a question is generative processing (Slamecka & Graf 1978).
- **Fit.** The tap-to-cloze gesture is #158. Readwise's three-level feedback is too coarse for Lumen's FSRS; keep four grades or two.

---

## 4. Learning-science map

| Mechanism | Principle | Key sources | Platforms |
|---|---|---|---|
| Testing instead of rereading | Retrieval practice | Roediger & Karpicke 2006; Karpicke & Roediger 2008; Karpicke & Blunt 2011 | All |
| Expanding intervals; desired retention | Spacing; forgetting-curve models | Ebbinghaus 1885; Cepeda et al. 2006, 2008; Ye et al. 2022; Su et al. 2023; Settles & Meeder 2016 | Anki, RemNote, Mochi, Orbit, Readwise |
| Early review adds little | Stability grows with delay; retrieval effort | Pyc & Rawson 2009; Bjork & Bjork 2011 | Anki review-ahead, RemNote, Orbit |
| Re-test misses within the session | Successive relearning; feedback | Rawson & Dunlosky 2011; Rawson et al. 2013; Pashler et al. 2005; Kang et al. 2007 | Anki steps and learn-ahead, Mochi re-review, Quizlet rounds |
| Mixed order; avoid positional cues | Interleaving | Rohrer & Taylor 2007; Kornell & Bjork 2008; Brunmair & Richter 2019 | Anki display order, RemNote shuffle |
| Recognition then production | Desirable difficulty; test format | Bjork 1994; Kang et al. 2007; Butler & Roediger 2008 | Quizlet Learn |
| Typed answer and confidence before reveal | Hypercorrection; calibration | Butterfield & Metcalfe 2001; Metcalfe 2017; Dunlosky & Rawson 2012; Koriat & Bjork 2005 | RemNote and Mochi typed answers; Lumen #114 |
| Pretest questions before reading | Pretesting effect | Richland et al. 2009; Kornell et al. 2009 | Lumen #118 |
| Questions embedded in text | Adjunct questions | Rothkopf 1966; Hamaker 1986; Matuschak & Nielsen 2019 | Quantum Country, Orbit |
| Small items; per-item tracking; leeches | Minimum information; interference | Wozniak 1999; Underwood 1957 | SuperMemo, RemNote, Anki |
| Explain in your own words | Self-explanation; elaboration | Chi et al. 1994; Pressley et al. 1987 | Lumen #121, #118 |
| Image and diagram masks | Dual coding | Paivio 1986; Mayer 2009 | Anki, Mochi, RemNote |
| Make your own items | Generation effect | Slamecka & Graf 1978 | SuperMemo, Readwise Mastery |
| Practise in the direction you will be tested | Transfer-appropriate processing | Morris et al. 1977 | RemNote concept cards, Anki reverse cards |

---

## 5. Gaps for Lumen

Effort: **S** is about 1–3 days (a pure module, tests and a small UI); **M** about one to two weeks (data model, sync and backup normalisers, UI, browser audits); **L** several weeks or content authoring. Every change touching review items or attempts must also update the `db.js` normaliser, the backup fixture, the `profileSync` merge and replay, and both review-stats assertions (the project's standing rule), and must keep the startup and offline budgets.

### 5.1 Classification

| ID | Candidate | Source | Lumen status | Effort | Impact |
|---|---|---|---|---|---|
| N1 | Early reviews must not inflate intervals (Classic and Crunch) | Anki, RemNote, Mochi, Orbit | **New (defect)** | S | High |
| N2 | Learn-ahead and in-session relearning; exact 10-minute step | Anki, Mochi, Orbit, Quizlet | **New** | S | High |
| N3 | Leech detection and triage | Anki, RemNote, SuperMemo | **New** (partial: `rankLapsedCards` feeds tutor starters only) | S–M | High |
| N4 | Interview-date plan: learning, catch-up and final-review periods | RemNote | **New** (#112 only captures the date; closed #9 and the `plan.js` header list "reschedule/catch-up" as remaining PLAN-001 work) | M | High |
| N5 | In-text review areas in the Reader | Quantum Country, Orbit | **New** (partial: #118 exit ticket, #122 part B narration checkpoints, #113 authored prompts) | M–L | High |
| N6 | True retention, estimated knowledge, per-card info | Anki | **New** | S–M | Medium–high |
| N7 | Per-blank cloze, reverse and concept cards, sibling separation | Anki, RemNote, Mochi, Orbit | **New** | M | Medium–high |
| N8 | Custom study (filtered sessions), card search syntax, batch actions | Anki, RemNote, Mochi | **New** (#114 adds `onlyIds`) | M | Medium–high |
| N9 | Fuzz, load balancing, Easy Days; backlog ordering; pause new cards during a backlog | Anki | **New** (catch-up is listed as remaining PLAN-001 work; no open issue) | S–M | Medium |
| #157 | Part priorities, auto-postpone, per-priority retention | SuperMemo, RemNote, Anki presets | **New** (relates to #111, #112) | M | Medium |
| #158 | One-gesture cloze from a Reader selection or highlight | SuperMemo, Readwise | **New** (LEARN-002 partial) | S | Medium |
| #159 | Grade meanings, a "Hard as fail" health check, optional two-button mode | Anki, RemNote, Mochi, Orbit, Quantum Country | **New** | S | Medium |
| #160 | Day boundary ("next day starts at", default 4 AM) | Anki | **New** | S–M | Low–medium |
| #161 | Mermaid diagram cards (occlusion of node labels) | Anki, Mochi, RemNote | **New** (tracker lists "diagram card rendering" as remaining; no issue) | M | Medium |
| #162 | Interleave new cards across lectures | Anki, RemNote | **New** | S | Low–medium |
| #163 | Partial step cards for derivations | RemNote | **New refinement of #115** | S–M | Medium |
| #164 | FSRS-5/6 engine | Anki, RemNote | **New** | M | Medium |
| E1 | Typed answer and confidence before reveal; calibration readout | RemNote, Mochi, Anki | **Issue #114** | — | High |
| E2 | Step-by-step reveal of derivations and formulas | RemNote | **Issue #115** | — | Medium–high |
| E3 | Resurface highlights daily | Readwise | **Issue #116** | — | Medium |
| E4 | Starter decks from glossary and workbooks; authored readiness questions | Quizlet sets, Quantum Country prompts | **Issue #113** | — | High |
| E5 | Preview questions and exit ticket | Pretesting literature; mnemonic medium | **Issue #118** | — | Medium |
| E6 | Listen-and-recall audio review | Readwise audio review | **Issue #122** | — | Medium |
| E7 | Study-time log and consistency calendar | Anki calendar and review time | **Issue #120** | — | Low–medium |
| E8 | Teach-back | Self-explanation | **Issue #121** | — | Medium |
| E9 | Export to Anki | Anki import format | **Issue #128** | — | Medium |
| E10 | Recommended order and prerequisites; first-run setup with target date | RemNote "in order" | **Issues #111, #112** | — | Medium |
| X | Daily limits, undo, bury, suspend/pause, archive, FSRS dial and calibration, daily load (sum of 1/I), forecast, cloze, mistake notebook with corrective review, mixed-format readiness checks, timed interview rounds, attempt-replay sync, source provenance | Anki, Mochi, RemNote, Orbit | **Existing** | — | — |

### 5.2 New proposals

#### N1. Early reviews must not inflate intervals

- **Problem.** `intervalForRating` (review.js:264) sets Good to `priorInterval × ease` whatever the actual elapsed time. Crunch grades cards that are not yet due through the same `gradeReviewItem` (App.jsx:2612); `crunch` only labels the attempt (review.js:343). Classic is the default scheduler (db.js:872).
  - Probe A1: a card with a 10-day interval, reviewed one day after its last review, grows to **25, 62.5 and 156.25 days** after three early Crunch "Good" grades (three separate Crunch sessions, since each session excludes cards already seen).
  - FSRS gives 13, 14 and 14 days, because it uses elapsed time.
  - A learner who crunches before an interview pushes weak cards months away.
- **Proposal**
  1. In Classic, base growth on elapsed time for early reviews, using Anki's review-ahead principle and Orbit's elapsed-based growth. If `elapsed < priorInterval`:
     - Good → `max(priorInterval, elapsed × ease)`
     - Hard → `max(priorInterval, elapsed × 1.2)`
     - Easy → `max(priorInterval, elapsed × ease × 1.3)`
     - Again unchanged.
  2. Give Crunch a "Practice only" default, as Mochi cramming and Anki preview mode do: the attempt is recorded (`crunch: true`) and the schedule is unchanged, except that **Again** still makes the card due today and logs the mistake. A switch, "Let practice change the schedule", uses the early-aware rule above.
  3. Sync replays attempts through `gradeReviewItem`, so add a scheduler-rule version to new attempts and replay older attempts with the old rule to stay deterministic.
- **Tests.** Unit tests for early Good, Hard and Easy and for Crunch practice-only; a replay-determinism test across versions in `profileSync.test.mjs`; `review_audit` for a Crunch session that leaves due dates unchanged.
- **Why it matters.** Spacing works only if intervals reflect real retention. Today the default scheduler rewards cramming with false long intervals, so cards are forgotten silently before the interview.

#### N2. Learn-ahead and in-session relearning

- **Problem**
  - The session ends when the queue is empty (ReviewCenter.jsx:640), but a card just graded Again is due later. Probe A2: the queue goes from 1 to 0 immediately after Again, and the card is due 14.4 minutes later.
  - In Crunch a failed card is excluded for the rest of the session (ReviewCenter.jsx:601, 654).
  - The step is stored as `Math.round(days × 100) / 100`, so 10 minutes (0.00694 day) becomes 0.01 day = **14.4 minutes**. The UI shows "14 min" while the code says 10 (review.js:313, fsrs.js:63).
- **Proposal**
  - `buildReviewQueue` gains `learnAheadMinutes` (default 20, Anki's default). When nothing else is due, include learning and relearning cards due within that window, earliest first.
  - Crunch re-queues each failed card once at the end of the session.
  - Store sub-day intervals at minute precision (round days only for intervals of a day or more), and migrate existing learning cards.
  - The session footer says "1 card to retry", and "Session complete" is announced only after the retry.
- **Tests.** A unit test that the queue keeps a card failed less than 20 minutes ago when nothing else remains; a step-length test of exactly 10 minutes; `review_audit` for an Again on the last card followed by a retry.
- **Why it matters.** A failure followed by a correct retrieval in the same sitting is the strongest correction (successive relearning). Many iPhone sessions are short, and the learner will not come back in 14 minutes.

#### N3. Leech detection and triage

- **Problem.** There is no leech concept anywhere in `src/`. `rankLapsedCards` (cards lapsed twice or more, tutorStarters.js:69) feeds only tutor suggestions, and Crunch sorts by lapses, so it drills the worst cards hardest.
- **Proposal**
  - A pure `leech.js`: `isLeech(card)` at 4 lapses (warning, RemNote) and 8 (tag `leech`, Anki), with a configurable threshold. Never auto-suspend by default; offer that as an option.
  - **In session**, after an Again that reaches the threshold, show an inline banner: "You've forgotten this N times." Actions:
    - *Edit and split*: open the editor with tips drawn from the 20 rules (one fact per card; turn sets into several cards; add context).
    - *Add a contrast card*: a prefilled `compare` card, "How does X differ from Y?", when the mistake notebook shows confusion.
    - *Pause card* (suspend).
    - *Ask the tutor to rewrite it*, only when AI is on: the local tutor gets the card and its mistake history and proposes a better prompt. Nothing is saved without the learner's tap.
    - *Keep going*.
  - The Review center gets a "Leeches (N)" filter (with N8).
  - Crunch skips leech-tagged cards unless they were edited after being tagged.
  - Analytics: "Leeches took X% of your review time in the last 30 days" (the sum of `elapsedMs`).
- **Data.** A `leechAt` timestamp on review items (normaliser, sync, backup).
- **Tests.** Threshold logic; Crunch exclusion; the banner flow in `review_audit`; an axe check of the banner state.
- **Why it matters.** Repeated failures are mostly badly formed or interfering cards (Wozniak 1999; RemNote; Anki). Fixing them recovers the most time per minute of effort.

#### N4. Interview-date plan

- **Problem.** `goals.targetDate` and `goals.targetParts` exist, but only `planPace` uses the date (plan.js:132). Card scheduling ignores the interview date.
- **Proposal: an "Interview plan" when both are set**
  1. **Learning period.** New cards from target Parts come first, with a daily new-card target of (remaining new target-Part cards) ÷ (days left − final-review days − 2).
  2. **Interval cap.** For target-Part cards, if the next due date falls after the interview and FSRS predicts R(interview day) below the target retention (SM-2: interval more than half the time remaining), cap the due date at the start of the final-review window.
  3. **Final review.** Default 3 days, adjustable from 2 to 7. Every active target-Part card not reviewed in the window becomes due once, lowest retrievability first. These reviews are early-aware (N1).
  4. **Catch-up.** If overdue cards exceed one day's limit, show an in-app suggestion to raise the review limit until the backlog clears.
  5. **After the interview,** caps are lifted and normal scheduling resumes.
- **UI.**
  - Home's Today card (#109) shows "Interview in 12 days · 46 cards to learn · final review from Oct 31".
  - An "Interview plan" sheet shows the three periods, like RemNote's chart.
  - No notifications (REMINDERS_DESIGN §1).
- **Tests.** Deterministic plan computation, cap logic, window membership, and post-date reset; `review_audit` with a seeded target date.
- **Why it matters.** Lumen's audience prepares for dated interviews. Retention on the day matters more than retention in a year (Cepeda et al. 2008).

#### N5. In-text review areas in the Reader (the mnemonic medium)

- **Problem.** The Reader is passive between highlights. #118 adds preview questions and an exit ticket at chapter end (free recall, not spaced items), and #122 part B adds recall checkpoints in narration. Neither puts spaced prompts in the reading itself.
- **Proposal**
  - After each H2 that has prompts, show a compact "Check yourself" area that is not part of the article text, so narration, find and annotation offsets are unaffected.
  - It holds up to 3 prompts:
    1. authored starter prompts anchored to that section (from #113's generated deck and source anchors);
    2. the learner's own cards whose `sourceAnchor` or source annotation falls in the section and are new or due.
  - Interaction follows Quantum Country, minus its accessibility faults:
    - The prompt is exposed accessibly, and the answer is not rendered until revealed.
    - "Show answer" is a named button, and decoration is `aria-hidden`.
    - Two large bottom buttons, Forgot and Remembered, map to Again and Good and are disabled until reveal.
    - The ladder shows in-text, then the next interval.
  - An in-text answer counts as a normal repetition: a new card's first review, through `gradeReviewItem`, with the daily new-card count updated.
  - Settings can turn it off, and the area is collapsed in Teaching mode.
- **Data.** Attempts gain `mode: "in-text"` (shared with #122's `mode` field).
- **Tests.** A layout test showing anchors are unchanged; grading through `review_audit`; axe; budget checks (a lazy chunk).
- **Why it matters.** Retrieval while reading is the mnemonic medium's core finding. It gets cards into review without separate authoring sessions, which is the step most learners skip.

#### N6. True retention, estimated knowledge, per-card info

- **Problem.** `reviewAnalytics` counts every attempt (review.js:353), including Crunch, first-ever grades of new cards and relearning re-grades. "Mastered" means 3 or more cards at a 14-day interval (mastery.js:25). There is no card history view.
- **Proposal**
  - "True retention" counts the first attempt per card per local day for cards already in review, excluding Crunch, in-text practice-only and learning steps. Split young (under 21 days) and mature (21 days or more).
  - With FSRS on, show it next to the target ("Target 90% · actual 86% (mature, 30 days)") and keep the 12-week trend on the same definition.
  - "Estimated knowledge" (FSRS): the sum of R(now) over reviewed cards, overall and per Part. Feed it to Home's mastery row as "≈ 37 of 52 cards recallable now".
  - A "Card info" sheet from the deck row: an attempt timeline (rating, elapsed, interval), current S, D and R, lapses, next due, source link, and leech state.
- **Tests.** Fixture counts in `review.scale.test.mjs` (the 50,000-attempt budget); assertion updates in both review-stats suites.
- **Why it matters.** Calibration: the learner and the retention dial need a number that means what it says (Anki's true-retention rationale; Dunlosky & Rawson 2012).

#### N7. Per-blank cloze, reverse and concept cards, sibling separation

- **Problem.** One card reveals all blanks (review.js:447), so the schedule cannot tell which blank was forgotten. #128 must therefore map every blank to `c1`. There is no direction control.
- **Proposal**
  - Accept `{{c1::…}}` and `{{1::…}}` numbering; a plain `{{…}}` stays one card, for compatibility.
  - Saving creates one review item per number, sharing a `noteId`.
  - Add a "Both directions" switch for basic and glossary (concept) cards, creating a reverse sibling, as RemNote's concept cards do.
  - Queue rule: at most one sibling per local day (Anki's sibling burying; Orbit's one component per session). On reveal only that blank's answer is emphasised.
  - Editing a note updates its siblings and keeps each schedule. Deleting asks whether to delete all siblings.
- **Data.** `noteId` and `clozeIndex` on items, through interchange, backup and sync.
- **Tests.** Parser cases (nested braces, `$…$` math, code); the sibling-bury rule in `buildReviewQueue`; a migration test that existing cards are unchanged.
- **Why it matters.** Minimum information (Wozniak 1999). Interview recall runs in both directions ("what is it" and "which one solves this").

#### N8. Custom study, card search syntax and batch actions

- **Problem.** Crunch is one fixed filter. Deck search is a substring match. There are no batch actions.
- **Proposal**
  - A "Custom study" sheet with:
    - **Scope:** Part, tag, card type, source lecture.
    - **State:** due, new, forgotten in the last N days, lapses of N or more, R below x, leeches, never reviewed.
    - **Order:** random (interleaved), lowest R, most lapses, oldest seen.
    - **Size:** 10–100.
    - **Mode:** practice only (default) or early-aware rescheduling (N1).
  - Saved views, for example "Part 8 before interview" or "Low retention" (as Mochi does).
  - Deck search reuses the library's query parser with card fields: `part:8 tag:interview type:derivation is:due is:suspended lapses>3 r<0.8 rated:7:again`.
  - Batch actions on the results: pause, resume, tag, archive, "due today".
  - Builds on #114's `onlyIds`.
- **Tests.** Parser tests, queue tests, and audits at 320 px and 393 px.
- **Why it matters.** Targeted practice for a coming round, without corrupting the schedule; deck hygiene at scale (the 10,000-card limit).

#### N9. Fuzz, load balancing, Easy Days, backlog ordering

- **Problem.** None of these exist. Due cards are sorted by due date. New cards are always added (review.js:229).
- **Proposal**
  - **Deterministic fuzz** (about ±5% for intervals of 3 days or more), seeded from the attempt id so sync replay is stable.
  - A **load balancer** that, within the fuzz range, picks the day with the fewest due cards, using a due-histogram helper and a deterministic tie-break.
  - **Easy Days:** per-weekday Normal, Reduced or Minimum, as Anki does.
  - **Backlog ordering:** when due cards exceed the remaining review limit, order FSRS cards by **descending R**, as Anki 24.11's simulations recommend, with ascending R as an option. Order Classic cards by relative overdueness (overdue days ÷ interval), as the manual recommends.
  - **New cards wait for the backlog** (Anki's default): no new cards while due cards exceed the review limit, overridable with "Add new anyway".
- **Tests.** Determinism of fuzz under replay; histogram balancing; ordering.
- **Why it matters.** A predictable workload sustains the habit, and the cards most at risk are rescued first.

#### #157. Part priorities, auto-postpone, per-priority retention

- **Proposal**
  - Each Part has a priority: Interview (from N4), Currently studying (target Parts), Maintaining (others, or "known" Parts from #112), or Paused (never queued; the clock keeps running).
  - When due cards exceed today's limit, fill the queue by priority, then by N9's backlog order; lower-priority cards beyond capacity are postponed, not lost (SuperMemo auto-postpone).
  - Optional retention per priority, for example 90% for Currently studying and 85% for Maintaining (Anki per-deck retention, RemNote per-folder schedulers).
- **Why it matters.** Lumen's curriculum is wide (23 Parts). Triage protects the material that matters this month.

#### #158. One-gesture cloze from the Reader

- **Problem.** A highlight becomes a Q&A draft ("Explain this excerpt…", App.jsx:2409); making a cloze means typing braces by hand.
- **Proposal.** Add "Make cloze" to the selection toolbar. The selected words are wrapped in `{{c1::…}}` within their sentence (the sentence is the front; the back holds the sentence and the source anchor). Each further selection in the same draft adds `c2`, `c3`… (with N7). The editor preview shows exactly what will be hidden.
- **Why it matters.** It removes the friction in the extract-to-item step (SuperMemo, Readwise) and creates small cards instead of paragraph-sized ones.

#### #159. Grade meanings, health check, two-button mode

- **Proposal**
  - One line under each grade:
    - Again: forgot or wrong.
    - Hard: recalled with real effort, still a pass.
    - Good: recalled.
    - Easy: instant.
  - A settings switch for **two-button mode** (Forgot and Remembered → Again and Good) for one-handed phone review. Mochi documents that FSRS works with binary grades; Orbit and Quantum Country use two buttons.
  - A calibration-time **health check**: if Hard is used often while Again is under 3% and true retention (N6) is below target, show Anki's "Hard is a pass" tip once.
- **Why it matters.** FSRS learns from grades, and mislabelled grades inflate intervals (Anki's warning).

#### #160. Day boundary

- **Proposal.** `settings.dayStartsAtHour` (default 4) applied inside `localDayKey`, with daylight-saving tests and a migration of session keys. Copy: "Your study day starts at 4 AM".
- **Why it matters.** Late-night study sessions are split across two days, which double-counts limits and breaks streaks.

#### #161. Mermaid diagram cards

- **Proposal.** A "Make diagram card" action on a Mermaid block in the Reader. It parses node labels and creates one card per chosen node: the front renders the diagram with that label replaced by "?" (Hide One, Guess One) or with every chosen label hidden (Hide All, Guess One); the back renders the original. Rendering reuses Lumen's lazy Mermaid pipeline, and the card stores the source text, so no images are involved.
- **Why it matters.** Pipelines, architectures and training loops in ML system design are spatial knowledge (dual coding). The notes already contain 79 diagrams.

#### #162. Interleave new cards across lectures

- **Proposal.** Gather new cards round-robin by source document, preserving order within each. A per-session "In order" choice for a chapter just read follows RemNote's guidance: in order while ideas build on each other, shuffled once each card stands alone.
- **Why it matters.** Interleaving improves discrimination between similar concepts (Brunmair & Richter 2019) and removes positional cues.

#### #163. Partial step cards for derivations (a refinement of #115)

- **Proposal.** When #115's "stuck at step k" is recorded twice for the same card, create a child card showing steps 1 to k−1 and asking for step k. It is scheduled separately and retired automatically once mature, as RemNote's partial list cards are.
- **Why it matters.** The schedule targets the broken link instead of re-drilling the whole chain.

#### #164. FSRS-5/6 engine

- **Proposal.** Add an FSRS-6 engine (same-day short-term model, trainable decay) behind the scheduler setting, validated against published reference vectors as 4.5 was. Migrate through the existing history replay, and keep 4.5 for reproducing old attempts.
- **Why it matters.** Lumen's learning steps would be modelled rather than fixed, and fits improve. Lower priority than N1–N9.

### 5.3 Covered by open issues (with what this research adds)

- **#114** (typed answer and confidence before reveal, calibration readout): confirmed by RemNote's "type in answer", Mochi's typed cloze and the hypercorrection literature. Add: the confident-miss list should feed the leech check (N3).
- **#115** (step reveal): RemNote's list cards rate each step. Add the partial cards of #163.
- **#116** (Revisit 5): matches Readwise Daily Review. Add weighting by highlights per lecture and a minimum-length filter.
- **#113** (starter decks and authored readiness questions): these give Lumen authored prompts like Quantum Country's. They are also the content supply for N5.
- **#118** (preview questions and exit ticket): pretesting (Richland et al. 2009). It complements N5.
- **#122** (listen and recall): Readwise has audio review. #122 part B's narration checkpoints are the audio form of N5.
- **#120** (study-time log and calendar): matches Anki's calendar and review-time graphs.
- **#121** (teach-back): self-explanation (Chi et al. 1994).
- **#128** (Anki export): N7 would let cloze numbers map properly instead of everything becoming `c1`.
- **#111** and **#112** (prerequisites, setup and target date): the inputs to N4 and #157.
- **#85** (On-device Lite parity): the quiz confidence flow should match #114's scale.

### 5.4 Already in Lumen (parity confirmed)

- Daily new and review limits, undo of the last grade, bury today, pause (suspend), archive.
- FSRS with a desired-retention dial and per-learner calibration; daily load as the sum of 1/I (`retentionPlanner.js`).
- A 7-day forecast and a 12-week trend.
- Cloze cards (single card per note).
- The mistake notebook with corrective review; this is beyond most platforms.
- Mixed-format readiness checks (Quizlet Test analogue); timed interview rounds and worksheet labs.
- Sync by replaying attempts (Orbit-like event sourcing); text-anchored highlights with relocation (Orbit-like provenance).
- No push reminders, which is stricter than Orbit, RemNote and Readwise, consistent with REMINDERS_DESIGN.

---

## 6. Recommended order

1. **N1 and N2:** small and high-impact correctness fixes in the default scheduler and session.
2. **N3 and N6:** leech triage and true retention, which make review time visibly efficient and honest.
3. **#114, then #113**, as planned. Then **N5**, which uses #113's anchored prompts.
4. **N4 and N9:** the interview plan and workload smoothing, which share the due-histogram and retrievability helpers.
5. **N7, N8 and #158:** the card-model work that unlocks #128's proper cloze mapping.
6. **#157, #159–#164** as capacity allows.

---

## 7. References

Learning science

- Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe & A. Shimamura (Eds.), *Metacognition: Knowing about knowing* (pp. 185–205). MIT Press.
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning. In *Psychology and the real world* (pp. 56–64). Worth.
- Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin, 145*(11), 1029–1052.
- Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing. *Memory & Cognition, 36*(3), 604–616.
- Butterfield, B., & Metcalfe, J. (2001). Errors committed with high confidence are hypercorrected. *JEP: Learning, Memory, and Cognition, 27*(6), 1491–1494.
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354–380.
- Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science, 19*(11), 1095–1102.
- Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. (1994). Eliciting self-explanations improves understanding. *Cognitive Science, 18*(3), 439–477.
- Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction, 22*(4), 271–280.
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest, 14*(1), 4–58.
- Ebbinghaus, H. (1885/1913). *Memory: A contribution to experimental psychology.*
- Hamaker, C. (1986). The effects of adjunct questions on prose learning. *Review of Educational Research, 56*(2), 212–242.
- Kang, S. H. K., McDermott, K. B., & Roediger, H. L. (2007). Test format and corrective feedback modify the effect of testing on long-term retention. *European Journal of Cognitive Psychology, 19*(4–5), 528–558.
- Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. *Science, 331*(6018), 772–775.
- Karpicke, J. D., & Roediger, H. L. (2008). The critical importance of retrieval for learning. *Science, 319*(5865), 966–968.
- Koriat, A., & Bjork, R. A. (2005). Illusions of competence in monitoring one's knowledge during study. *JEP: Learning, Memory, and Cognition, 31*(2), 187–194.
- Kornell, N., & Bjork, R. A. (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science, 19*(6), 585–592.
- Kornell, N., Hays, M. J., & Bjork, R. A. (2009). Unsuccessful retrieval attempts enhance subsequent learning. *JEP: Learning, Memory, and Cognition, 35*(4), 989–998.
- Mayer, R. E. (2009). *Multimedia learning* (2nd ed.). Cambridge University Press.
- Metcalfe, J. (2017). Learning from errors. *Annual Review of Psychology, 68*, 465–489.
- Morris, C. D., Bransford, J. D., & Franks, J. J. (1977). Levels of processing versus transfer appropriate processing. *Journal of Verbal Learning and Verbal Behavior, 16*(5), 519–533.
- Paivio, A. (1986). *Mental representations: A dual coding approach.* Oxford University Press.
- Pashler, H., Cepeda, N. J., Wixted, J. T., & Rohrer, D. (2005). When does feedback facilitate learning of words? *JEP: Learning, Memory, and Cognition, 31*(1), 3–8.
- Pressley, M., McDaniel, M. A., Turnure, J. E., Wood, E., & Ahmad, M. (1987). Generation and precision of elaboration: Effects on intentional and incidental learning. *JEP: Learning, Memory, and Cognition, 13*(2), 291–300.
- Pyc, M. A., & Rawson, K. A. (2009). Testing the retrieval effort hypothesis: Does greater difficulty correctly recalling information lead to higher levels of memory? *Journal of Memory and Language, 60*(4), 437–447.
- Rawson, K. A., & Dunlosky, J. (2011). Optimizing schedules of retrieval practice for durable and efficient learning: How much is enough? *Journal of Experimental Psychology: General, 140*(3), 283–302.
- Rawson, K. A., Dunlosky, J., & Sciartelli, S. M. (2013). The power of successive relearning: Improving performance on course exams and long-term retention. *Educational Psychology Review, 25*(4), 523–548.
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied, 15*(3), 243–257.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249–255.
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science, 35*(6), 481–498.
- Rothkopf, E. Z. (1966). Learning from written instructive materials: An exploration of the control of inspection behavior by test-like events. *American Educational Research Journal, 3*(4), 241–249.
- Slamecka, N. J., & Graf, P. (1978). The generation effect: Delineation of a phenomenon. *JEP: Human Learning and Memory, 4*(6), 592–604.
- Underwood, B. J. (1957). Interference and forgetting. *Psychological Review, 64*(1), 49–60.

Algorithms and the mnemonic medium

- Ye, J., Su, J., & Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. *KDD '22.*
- Su, J., Ye, J., Nie, L., Cao, Y., & Chen, Y. (2023). Optimizing spaced repetition schedule by capturing the dynamics of memory. *IEEE TKDE.*
- Settles, B., & Meeder, B. (2016). A trainable spaced repetition model for language learning. *ACL 2016.*
- Wozniak, P. A. (1999). *Effective learning: Twenty rules of formulating knowledge.* super-memory.com/articles/20rules.htm
- Matuschak, A., & Nielsen, M. (2019). *How can we develop transformative tools for thought?* numinous.productions/ttft
- Nielsen, M. (2018). *Augmenting long-term memory.* augmentingcognition.com/ltm.html

---

## Appendix A. Read-only probes of Lumen's scheduler

Both scripts import `src/lib/review.js` from outside the repository and write nothing to it. The scripts were captured locally (not committed).

- `crunch_probe.mjs` (captured locally, not committed): a card with a 10-day interval, last reviewed 1 day ago, graded "Good" in Crunch three times.
  - Output: `sm2: … 25 -> 62.5 -> 156.25 days`; `fsrs: … 13 -> 14 -> 14 days`.
- `learn_ahead_probe.mjs` (captured locally, not committed): one due card graded "Again".
  - Output: `queue before grading: 1; 2 s after "Again": 0 (session ends); due again at 2026-10-22T12:14:24.000Z; queue 11 min later: 0`.

## Appendix B. Artefacts

Captures (accessibility text, DOM, screenshots and metadata), the saved issue bodies, the Anki 24.11 release-notes text and the shallow clones of the Anki manual (CC BY-SA 4.0) and Orbit (Apache-2.0 core; AGPL/BUSL app and backend not read) were all captured locally (not committed). The screenshots cited above (`qc-3.step3.png`, `qc-3.step7.png`, `anki-deck-options.step1.png`) are not included. Nothing from these sources is to be copied into Lumen.
