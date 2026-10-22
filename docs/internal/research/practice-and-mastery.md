# Practice, mastery and study planning: what the best platforms do, and what Lumen should take

> Repository copy prepared on 2026-10-22 for `docs/internal/research/`. Local paths to captures, probes and clones are replaced with "captured locally (not committed)"; screenshots are not included. REA evidence ids and citations are unchanged; code references (`path:line`) are to `main` at `01c7a89`, the research baseline, unless the text names another commit. Candidate ids in this report (N1, G1, Gap 1, …) are its own; `SYNTHESIS.md` maps every one of them to an issue draft, an existing issue, or a recorded deferral.


Research date: 22 October 2026. Lumen baseline: `main` at `01c7a89` (README, `docs/guides/APP_GUIDE.md`, `src/lib/{mastery,plan,assessment,labs,interview,interviewTracks,review,fsrs,mistakes}.js`, `src/components/{ReviewCenter,AssessmentDialog}.jsx`, `src/data/{labs,interviewTracks}.v1.json`, `server/ai/ollama.mjs`, `docs/REMINDERS_DESIGN.md`, `docs/internal/PRODUCT_REQUIREMENTS.md`) and all 41 open GitHub issues (read with `git gh`). Nothing in the Lumen repository was changed.

## How this was researched

- **Primary tool: REA** `capture_browser_scenario` (headless Chrome 156, no login, cookies declined where possible). 28 page loads across 11 hosts (at most 7 on any host, `www.khanacademy.org`), plus robots.txt checks before each host. Every platform except LeetCode (blocked) was captured at least once at an iPhone-sized 393×852 viewport. Every capture's evidence id, URL and observations are in an evidence log, with parsed accessibility trees and screenshots (all captured locally, not committed).
- **Open source:** shallow clones (captured locally, not committed): `exercism/python` (MIT), `exercism/docs` (no licence file, so summarised only) and `kamranahmedse/developer-roadmap` (proprietary "personal use" licence; read, nothing copied). The Exercism website (AGPL) was not cloned or used. No code from any source is reproduced here.
- **Docs, blogs and papers** via WebSearch/WebFetch.
  - Every learning-science reference was checked against its Crossref/DOI record and an abstract on PubMed, ERIC, the publisher or an author page.
  - The Shute (2008) guideline quotes were read in the author's copy of the paper.
  - Two results could not be confirmed from an abstract and are marked in Sources (Attali 2015; Locke & Latham 2002).
- **Boundaries held:**
  - Khan Academy's help centre (`support.khanacademy.org`) and all of `leetcode.com` showed Cloudflare "Performing security verification" pages to the headless browser. I stopped on both hosts and did not try to get past the check. Their mechanics below come from search-index text of their official pages and are marked *secondary*.
  - Brilliant routes anonymous "Start" to an onboarding funnel (`/welcome/`) that leads to an account. I stopped at its first screen.
  - roadmap.sh's "Done" button opens "Login or Signup". I stopped there.
  - No LeetCode Run/Submit (both disallowed by robots.txt), and no Educative "Run".
- **Prompt injection:** none observed. Page text was treated as data. The only agent-related strings found were roadmap topic names that contain "LLM".

Evidence ids are abbreviated (KA-3 and so on); the full `ev_…` ids are in the evidence log.

---

## 1. Khan Academy

### Features that matter for a self-directed learner

1. **A unit is a loop of Learn, Practice, Quiz and Unit test.** The Statistics unit page lists 17 skills. Each lesson group is *Learn* (videos and articles), then *Practice* (skills, with an "Up next for you" marker), then a *Quiz* every few skills ("Level up on the above skills and collect up to 240 Mastery points"). The unit ends with a *Unit test* ("…collect up to 1,700 Mastery points!"). A legend shows Mastered / Proficient / Familiar / Attempted / Not started, plus Quiz and Unit test icons. **[KA-1]**
2. **Exercises are attempt-first with a graduated way out.** Before the first answer the bar shows only "Do 4 problems", Skip and Check, with no hint button. There is also a Calculator, "Draw on exercise" (a scratchpad), related videos and "Report a problem". **[KA-2]**
   - A wrong answer shows "Not quite yet… Give it another try!" with three choices: **Try again**, **Show a step** and **Hints**. **[KA-3]**
   - *Show a step* reveals only "Hint #1 1 / 3". A "Get another hint (1/3)" button appears and "Check again" stays available, so the learner can retry after one step. **[KA-6]**
   - *Hints*, with the tooltip "Show solution and move on", reveals the whole worked solution as numbered steps. The last step states the answer. **[KA-5]**
3. **Mastery is earned on mixed assessments and can go down** (*secondary*: help-centre text via the search index **[KA-S]**).
   - An exercise with 70–99% correct gives *Familiar*, and 100% gives *Proficient*.
   - *Mastered* is reachable only by answering correctly on a mixed-skill assessment (quiz, unit test or course challenge) while already Proficient.
   - Each skill is worth 100 mastery points (Familiar 50, Proficient 80, Mastered 100), and levels go "up (or down, if you miss any questions)".
   - The primary capture agrees: the 17-skill unit's test offers "up to 1,700 Mastery points", 17 × 100. **[KA-1]**
4. **The streak is weekly and outcome-based.** The onboarding tour asks learners to build weekly streaks, kept by reaching Proficient or higher in at least one skill each week. A third step offers "Jump back in… go directly to your next suggested skill". **[KA-5]** A missed week resets the count to 0 *(secondary, [KA-S])*.
5. **Khanmigo** (public page) sells a tutor that "never giv[es] you the answer", a "24/7 code reviewer" and voice. It also offers cosmetic rewards ("Redeem your energy points to give Khanmigo a new look"). It is paid ($4/month) because "Khanmigo uses GPT-4, and every interaction has costs". **[KM-1]**

### Learning science

- **Attempt before help.** Struggling with a problem before instruction can help later transfer. This is productive failure (Kapur 2008); a meta-analysis finds a moderate benefit (g = 0.36), larger with faithful designs (Sinha & Kapur 2021).
- **Hints after an attempt.** Learners often use on-demand help poorly (Aleven et al. 2003), including "gaming the system" by clicking through hints (Baker et al. 2004). Showing hints only after an attempt reduces both.
- **A graduated ladder ending in a worked solution.** Worked examples cut time and errors for novices (Sweller & Cooper 1985), and fading them gradually beat abrupt example-problem pairs on near transfer (Renkl et al. 2002). Multiple-try feedback on later, similar problems has been studied directly (Attali 2015; abstract unavailable, so cited for design only).
- **The caveat.** Shute's (2008) feedback guidelines say both "Provide feedback after learners have attempted a solution" (Table 2) and "Avoid using progressive hints that always terminate with the correct answer" unless there are "provisions to prevent their abuse" (Table 3). Khan's ladder does end in the answer. Its provisions are attempt-first and moving on to a new problem. Lumen needs equivalent provisions (Gap 1).
- **Mastery from mixed assessments with demotion** reflects mastery learning (Bloom 1984; Kulik et al. 1990), spaced retrieval (Roediger & Karpicke 2006) and interleaving (Rohrer & Taylor 2007; Rohrer et al. 2015). It treats mastery as an estimate that new evidence can lower, as knowledge tracing does (Corbett & Anderson 1995).
- **A weekly, outcome-based streak** is a specific, attainable goal with feedback (Locke & Latham 2002). It avoids daily loss framing (see Duolingo).

### Fit for Lumen

- **Hint ladder.** All of it is authored, deterministic data, with no AI and no network. Khan's phone layout (a bottom bar with Hints and Try again, steps stacked inline) shows it works at 393 px. **[KA-6 screenshot]**
- **Mixed-assessment mastery** can be computed locally from data Lumen already stores.
- **Khanmigo.** Lumen's local Socratic mode, with Hint, "I'm stuck" and Wrap up, already covers it with no paid AI.

---

## 2. Brilliant

### Features that matter

1. **Dense practice per lesson.** "Introduction to Neural Networks" is "15 Lessons" and "112 Exercises", about 7 exercises per lesson, grouped into three Levels (Neural Networks, Neurons, Layers). A "Prerequisites and next steps" paragraph says what is assumed ("basic proficiency with algebra…"). **[BR-1]**
2. **Onboarding before practice.** For anonymous users, "Start" goes to `/welcome/` ("Hi, I'm Koji! I'll be your personal tutor."), not to a lesson. No lesson URL is exposed on the course page. **[BR-2]**
3. **What it claims** (company copy, not evidence of efficacy) **[BR-4]**:
   - Koji "never just gives you the answer" and works on a "shared interactive canvas… asks guiding questions… gives hints".
   - It tracks what the learner has mastered and missed, and builds the learning plan around the gaps.
   - "Mastery assessments… If you come up short, he creates targeted practice."
   - It "personalizes your practice and review sessions".

### Learning science

- **Frequent small problems inside a lesson** are retrieval and generation opportunities (Roediger & Karpicke 2006; Dunlosky et al. 2013).
- **Assessment that triggers targeted remediation** is classic mastery learning (Bloom 1984).
- Brilliant's efficacy claims could not be checked independently. Its lessons are not public, so I could not observe the interaction design itself.

### Fit for Lumen

- Lumen chapters are mostly prose with no embedded questions (116 chapters, median 5 minutes of reading, per #120's measurement).
- The Brilliant lesson suggests a question every few minutes of reading. Lumen's notes already contain the questions: 61 chapter files end in "Exercises", "Check your understanding" or "Exit questions". Issues **#118** (preview questions and exit ticket) and **#119** (exercise tracking) are the right vehicle.
- Assessment → targeted practice already exists: readiness-check misses go to the mistake notebook.

---

## 3. Duolingo

### Features that matter

1. **Difficulty-matched sessions (Birdbrain).** Birdbrain "makes an educated guess about whether a learner will get a given exercise right". The Session Generator then picks exercises "at just the right difficulty level for this specific learner". A/B tests showed learners "learn more" and come back more, and it "helps you automatically skip the topics you feel good about". **[DU-1]** (Oct 2020)
2. **Visible decay (strength meters).** Each skill's meter falls as predicted recall falls, and "once the meter slips to half-full… it's time to practice". A "Practice Weak Skills" button picks for you.
   - The model is half-life regression, with p = 2^(−lag/half-life) (Settles & Meeder 2016).
   - In A/B tests it raised next-day practice retention by 9.5% and overall activity by 12%.
   - **[DU-3]** (Dec 2016)
3. **Review and challenge modes on the path** **[DU-5]**:
   - review a completed node (+5 XP);
   - **Legendary**, "more challenging exercises and no hints" (the node turns gold);
   - a Practice Hub with mistakes practice, which is a *paid* Super feature;
   - timed Side Quests and leaderboard "Match Madness".
   - Completed sections stay reviewable, and each shows a "Duolingo Score" mapped to the CEFR scale. **[DU-4]**
4. **Streak mechanics, in the company's words** **[DU-2]** (Jan 2022):
   - A streak counts consecutive days with a lesson, and "we tap into 'loss aversion'". The post justifies it with habit research (Ouellette & Wood 1998).
   - The post admits that breaking a streak "can… feel quite demotivating" and that "the fear of losing a streak could prevent learners from even attempting one".
   - Streak Freezes (up to two equipped, refilled for 400 gems) raised daily actives by 0.38%. Milestone animations raised 7-day retention by 1.7%.
   - Learners who reach a 7-day streak are "3.6 times more likely to complete their course". That figure is correlational.
   - The full gamification stack across the posts: streaks, purchasable freezes, XP, gems, chests, leagues and leaderboards, and timed challenges.

### Learning science and the case against the harmful parts

- **Good:**
  - spacing (Cepeda et al. 2006);
  - practice kept at a level the learner can just reach — for some learning algorithms training is fastest at about 85% accuracy (Wilson et al. 2019, a theoretical model);
  - harder, no-hint retrieval as a desirable difficulty (Bjork 1994; Bjork & Bjork 2011).
- **Harmful parts:**
  - Duolingo's published outcomes are *app retention*, not learning.
  - Independent work finds that once a tracked streak breaks, people engage less than they do while it is intact. Letting them repair the streak softened the drop (Silverman & Barasch 2023).
  - In one course comparison, badges and leaderboards lowered intrinsic motivation and final-exam scores (Hanus & Fox 2015; a 2018 corrigendum exists).
  - Feedback guidelines advise "Do not give normative comparisons" (Shute 2008, Table 3), which is what leaderboards are.
  - Expected, tangible, contingent rewards undermine intrinsic motivation in laboratory experiments, though positive feedback raised it (Deci et al. 1999).
  - Gamification's effects on learning are small, and only the cognitive effect held up in methodologically rigorous studies (Sailer & Homner 2020).
  - The useful idea inside the freeze is *slack*: people whose goal included "emergency reserves" kept going after missing a subgoal more often (Sharif & Shu 2021, the study Duolingo links).

### Fit for Lumen

- Lumen already has a modern, local scheduler: an opt-in FSRS-4.5 "Adaptive" mode with per-learner calibration, beside Classic SM-2. HLR was Duolingo's published 2016 model. Lumen's mistake notebook is free and local, and it has no notifications or leaderboards (`docs/REMINDERS_DESIGN.md` §1.3 bans guilt mechanics).
- Two gaps:
  - **No strength meter.** FSRS retrievability is computed (`fsrs.js:40`) but only the optimizer uses it.
  - **A daily, resettable review streak tile.** "Current streak" with a flame icon sits at `ReviewCenter.jsx:870`, and #120 explicitly leaves it out of scope.
- Legendary's "no hints" check is what Lumen's readiness check already is.

---

## 4. LeetCode (secondary evidence: the site is behind a bot check)

### Features that matter

- Problems carry difficulty, acceptance rate, topic tags, an ordered list of hints, an editorial for some problems, and similar questions (third-party dataset descriptions). **[LC-S]**
- robots.txt lists separate `/problems/*/interpret_solution` (run on samples) and `/problems/*/submit` (judge) endpoints. **[robots, LC-1]**
- **Study plans.** The original release unlocked the next day's set at midnight UTC and **reset progress if the deadline was missed**, with a badge on completion. The official advice was to try each problem first, then read the official solution. **[LC-S]**

### Learning science

- Attempt first, then solution (Kapur 2008).
- A deadline that resets progress is a loss frame with the same risks as a broken streak (Silverman & Barasch 2023).
- Topic-blocked plans build a schema, but discrimination between problem types needs later mixed practice (Rohrer & Taylor 2007; Brunmair & Richter 2019).

### Fit for Lumen

- Lumen's eight interview tracks (76 authored questions with rubrics, seniority and round types) already form a study plan.
- What is missing is **visible, persistent progress per track**: rounds are not stored (see Gap 2). Never copy the reset.

---

## 5. Exercism (open source)

### Features that matter

1. **Syllabus of concepts.** Python's "Your journey" is a connected tree of 17 concept nodes. These match the 17 concepts taught by the track's beta-status concept exercises; 3 more exercises are work in progress, and the config defines 67 concepts in all. On a phone the tree collapses to a vertical chain. **[EX-1, EX-C1]**
   - A concept page has an explainer, then one **Learning Exercise** (for Lists: Card Games). Below that, "Practicing is locked / Unlock 5 more exercises to practice Lists" lists practice exercises tagged Easy or Medium. **[EX-2]**
   - The track has 21 concept exercises, 142 practice exercises (difficulty 1–9, mostly 1–4) and 67 concepts. Each practice exercise lists the concepts it `practices` and its `prerequisites`. **[EX-C1]**
2. **Learning Mode versus Practice Mode.** In the default Learning Mode, completing learning exercises unlocks more. Practice Mode unlocks everything, and the learner can switch at any time. A concept exercise should take a fluent developer 5–10 minutes. **[EX-C2]**
3. **Per-task hints and task-tagged tests.**
   - Each concept exercise has `introduction.md`, `instructions.md` (numbered tasks) and `hints.md` (a General section plus one section per task), a stub and an exemplar.
   - Tests are tagged with a task number, so results map to tasks. **[EX-C1]**
4. **Test-runner contract.** The runner writes a results file with per-test pass, fail or error and a human-readable message. User output is capped at 500 characters, `task_id` is optional and the run times out at 20 s. For concept exercises it shows the test code. **[EX-C2]**
5. **Automated feedback** comes in four comment types: *essential* (soft-blocks completion), *actionable*, *informative* and *celebratory*. **[EX-C2]**
6. **Mentoring rules.** "Don't just give the solution away". Aim "somewhere between" hints and explanations. Give "the most important one to three pieces of feedback" per iteration, then iterate. **[EX-C2]**

### Learning science

- Explainer, then a scaffolded exercise, then unscaffolded practice is worked-example → completion → problem fading (Renkl & Atkinson 2003).
- The opt-out Practice Mode respects the expertise reversal effect (Kalyuga et al. 2003).
- Immediate, specific, elaborated test feedback outperforms right/wrong feedback (Shute 2008; Van der Kleij et al. 2015).
- One to three points per iteration follows Shute's (2008) guideline to "Present elaborated feedback in manageable units", in "small enough pieces so that it is not overwhelming". The learner still makes the fix (Table 2). Feedback effects vary with the type of feedback and how it is given (Hattie & Timperley 2007).

### Fit for Lumen

- **Per-task hints** map directly onto `labs.v1.json` tasks.
- **The results contract** is a ready design for a local sql.js runner (Gap 6).
- **The mentoring rules** contrast with Lumen's `code_review` prompt (`server/ai/ollama.mjs:41`). That prompt asks for every finding in priority order, each with a proposed fix and snippet: right for an audit, wrong for practice (Gap 7).
- **Practice Mode** matches Lumen's "nothing is locked" principle and #112's "already comfortable with".

---

## 6. roadmap.sh (content open; licence proprietary)

### Features that matter

- **Per-node status in a topic drawer.** A drawer has three statuses (**Learning / Done / Skip**), a short summary, "Learn with AI" (Quick Explain, Teach Me, Quiz me), free and premium resources, and an ask box. **[RM-2]**
- **Progress is account-bound.** "Done" without an account opens "Login or Signup: You must be logged in to perform this action". Local storage holds only analytics keys. **[RM-3]**
- **The map is phone-hostile.** It is one large SVG, unreadable at 393 px without zoom, half-covered by a cookie dialog. **[RM-1]**
- The public repo now holds only content: one markdown file per topic, keyed by a stable node id. **[RM-C]**

### Learning science

- Self-reported status supports goal monitoring (Locke & Latham 2002).
- But "Done" is a judgement, not evidence. Inaccurate, overconfident self-evaluations undermine retention (Dunlosky & Rawson 2012). Status should sit beside performance evidence, not replace it.

### Fit for Lumen

- Lumen already does better on privacy: progress needs no account and stays on the device.
- "Skip / I know this" is planned as #112's `goals.known`, with #113's placement check to back it with evidence.
- roadmap.sh's phone map confirms #111's decision to draw a chain and list the full graph as text.
- "Learn with AI" per node exists in Lumen as Ask AI and tutor modes.

---

## 7. Educative

### Features that matter

- **What a course includes.** "Grokking the Coding Interview Patterns" lists:
  - "1125 lessons across 31 modules";
  - "579 quizzes with instant feedback";
  - "17 AI mock interviews with scoring rubrics";
  - "AI Tutor on every lesson".
  - Its roadmap is organised **by pattern** ("Two Pointers", "Fast and Slow Pointers"…). Each pattern is an "Introduction to <pattern>" lesson, then problems tagged easy/med/hard.
  - "Optimize My Roadmap" tailors it to "your preferred company and role". **[ED-1]**
- **A free lesson** **[ED-2]**:
  - prose, formula images and read-only snippets;
  - a **runnable code widget** ("main.py", "Run", "How to view complete output", "Run the code and notice the change after each iteration");
  - each chapter ends in a "Playground (…)" and a "Quiz: …";
  - a course progress percentage with "Reset course progress".
- **On a phone (393 px)** the lesson opens with a collapsible "We'll cover the following…" preview of objectives and a floating "Ask" (AI) button. Code blocks run off the right edge and must be scrolled sideways. **[ED-2 screenshot]**

### Learning science

- Runnable worked examples keep the worked-example benefit (Sweller & Cooper 1985) and let the learner check a prediction by running it.
- A quiz per chapter is retrieval practice (Roediger & Karpicke 2006; Adesope et al. 2017).
- Pattern grouping builds schemas, but needs later interleaving to learn *which* pattern applies (Rohrer et al. 2015).

### Fit for Lumen

- Lumen already has rubric-graded AI interview practice and timed rounds.
- It lacks a code runner (Gap 6) and links from a chapter to its practice (Gap 4).
- The objectives preview supports #118's "Before you read" disclosure.
- The sideways-scrolling code on a phone is a caution for Gap 6: on an iPhone, prefer short edits, Parsons and predict-the-output tasks, and keep full editing for iPad or Mac.

---

## 8. Math Academy (added: the clearest public account of mastery-based study planning)

### Features that matter

- **Placement.** An adaptive diagnostic (30–45 minutes, splittable) measures "mastery and automaticity". Its report gives placement, foundational gaps, mastery per topic and **"estimated course completion dates with a variety of daily XP goals"**. **[MA-1]**
- **Lessons and mastery rule.** Lessons are split into knowledge points. Each starts with a **fully worked example**, followed by up to five problems: **two correct in a row** to move on, otherwise more problems. "Every question has an explanation". **[MA-1]**
- **Quizzes.** A quiz comes every 150 XP and covers a variety of recent topics. It is timed and closed-book, and missed topics are "immediately assigned as review topics", with an optional retake. **[MA-1]**
- **Effort accounting and leagues.** 1 XP is about 1 minute of focused effort, against an adjustable daily XP goal. Weekly leagues give "each week… a fresh start". **[MA-1]**
- **Ordering and memory.** It practises **non-interference** (new concepts taught alongside dissimilar material) and **layering**. The knowledge graph is shaded by memory stability.
  - FIRe: reviewing an advanced topic gives fractional review credit to the simpler topics it "encompasses", and failures send penalties upward. **[MA-1, MA-2]**

### Learning science

- The design is a direct application of:
  - mastery learning (Bloom 1984);
  - worked examples and fading (Sweller & Cooper 1985; Renkl et al. 2002);
  - retrieval (Roediger & Karpicke 2006) and spacing (Cepeda et al. 2006);
  - interleaving, whose benefit depends on the material and on how confusable the categories are (Brunmair & Richter 2019). Math Academy's non-interference rule applies to introducing *new* concepts; mixing in review is a separate step;
  - knowledge tracing (Corbett & Anderson 1995).
- The FIRe claims are the company's own, with no independent evaluation found.

### Fit for Lumen

- **Transferable now:**
  - the two-in-a-row rule for labs and checks (Gaps 1 and 3);
  - checks that mix recent Parts (Gap 5);
  - strength shading on the curriculum map (Gap 3);
  - completion-date estimates per daily time (#112 / #120).
- **Later:** implicit review credit along #111's requirement graph.

---

## Gaps for Lumen

Effort: **S** ≤ 2 days, **M** 3–7 days, **L** > 1 week (each including tests and audits). Impact is for a self-directed learner preparing for ML interviews on an iPhone.

### A. New: no open issue covers these (verified with grep and a keyword search of all 41 open issue bodies)

#### Gap 1. Attempt-first hint ladder and retries in worksheet labs — new (M, high)

The effort is M, not S, because of the hint authoring plus the review-audit updates.

**Seen at:** Khan [KA-3/5/6], Exercism per-task `hints.md` [EX-C1], Math Academy's two-in-a-row rule [MA-1], LeetCode's ordered hints [LC-S].

**Lumen today:**
- `LabBench` (`ReviewCenter.jsx:301-357`) allows one check per task, then locks the input.
- A miss instantly shows "Expected **X**…" with the explanation and logs a mistake.
- There are no hints and no retry, and the worked solution appears only at the end.

**Proposal:**
- Add optional `hints` (1–3 strings, at most 500 characters each; the last may be a worked step) and `attempts` (default 2) to each lab task. `normalizeLabBank` keeps them.
- Before the first check, show no hint button: attempt first.
- After a miss, show "Not yet." with **Try again** (the input stays editable), **Show a step (1/3)** (appends "Step 1 of 3" below the task) and **Show solution** (today's reveal).
- Record each task's outcome as *independent* (right first time, no hints), *recovered* (right after a retry or hints) or *revealed*.
- Only an *independent* outcome counts as mastery evidence (Gaps 2 and 3). A *revealed* outcome logs the mistake, as today, with `hintsUsed`.
- The authoring is about 30 short hints for the 15 tasks in the 4 labs.

**Why:**
- A stepwise presentation "gives learners sufficient information to correct errors on their own" (Shute 2008, Table 2). Multiple-try feedback on similar later problems is studied directly in Attali (2015), cited for design only.
- A graduated path to a worked solution avoids today's all-or-nothing cliff.
- Attempt-first limits hint abuse (Aleven et al. 2003; Baker et al. 2004) and follows "Provide feedback after learners have attempted a solution" (Shute 2008, Table 2).
- Shute (Table 3) warns against hint ladders that always end in the answer without safeguards. The safeguards here:
  - attempt-first;
  - a capped number of tries;
  - no mastery credit once a step or the solution has been shown;
  - hints written as prompts and cues ("Which rows survive the WHERE?"), not partial answers.

**Fit:** offline, deterministic, no AI, and a phone-sized bottom bar like Khan's.

#### Gap 2. Practice outcomes are not stored, so no per-track or per-lab progress — new (M, high)

**Seen at:** LeetCode study-plan progress [LC-S], Educative course % [ED-2], Khan mastery points per quiz [KA-1], Exercism's unlocked and completed exercises [EX-2].

**Lumen today:**
- Lab results live only in component state (`LabBench` `useState`).
- Interview rounds keep only misses, as mistakes. There is no `labAttempts` or interview-history field in the profile (`db.js:851-890`).
- `trackCoverage` is used only by a test. The track strip has a track select, a round select and Start, with no progress.

**Proposal:**
- **Data:** a bounded `profile.practiceAttempts` list (newest 5,000) of `{id, kind: lab|interview|rubric, itemId, taskId?, documentId, outcome, hintsUsed, at}`.
  - The outcome is one of *independent*, *recovered*, *revealed*, *answered-well* or *missed*.
  - It goes through the `db.js` normalizer, `profileSync` merge by id, and backups.
- **Track progress:** the track strip shows, for example, "MLE · 9 of 12 practised · 2 to revisit · system design 0/3".
- **Lab progress:** each lab shows its last result ("3/4 independent · 12 Oct").
- **Interview rounds:** "Answered well" also writes an attempt. Today only misses are kept.
- **Closing old misses:** when a question with an open mistake is later answered well, offer "Mark the earlier miss corrected?". Today `buildTrackRound` keeps putting it first until the learner corrects the mistake by hand (`interviewTracks.js`, missed-first ordering).

**Why:** progress feedback on a specific goal improves persistence and performance (Locke & Latham 2002). Without stored outcomes, mastery cannot use practice evidence.

**Fit:** local-only data, merges like `mistakes`, about 100 B per attempt.

#### Gap 3. Evidence-based mastery that can fall, with a strength meter — new (M, high)

Adjacent issues: #118 adds a `recalledChapters` count without changing the ladder, #113 adds authored checks, and #109 trims the Home rows.

**Seen at:** Khan's levels earned on mixed assessments that can drop [KA-1, KA-S], Duolingo's strength meters [DU-3], Math Academy's stability shading and quizzes whose misses become review [MA-1].

**Lumen today:**
- `masteryByPart` (`mastery.js`) uses only scroll progress and card intervals: "mastered" means three cards at 14+ days and nothing overdue.
- The last readiness-check score is shown ("last check 62%") but never used.
- `retrievability` (`fsrs.js:40`) is computed but only the optimizer uses it. No decay is shown.

**Proposal:**
- **Ladder v2:**
  - *Read*;
  - *Practising*: any independent practice, or a check ≥ 60%;
  - *Proficient*: latest check ≥ 80% within 60 days, or two independent lab or interview successes;
  - *Mastered*: Proficient, plus a passed **mixed** check (Gap 5), plus mean predicted recall ≥ 0.85.
- **Demotion and copy:**
  - A failed check (< 60%) or strength below 0.7 lowers the state.
  - The reason line says why, for example "Strength fell to 64% · 5 cards overdue".
  - The copy is neutral and nothing is ever locked.
- **Strength** is the mean FSRS retrievability over the Part's active cards. SM-2 cards approximate stability with `intervalDays`, and the label says so. It shows as a bar on each Part row and as shading on the curriculum map.

**Why:**
- Mastery learning works when the mastery bar is real (Bloom 1984; Kulik et al. 1990).
- Spacing reliably helps retention, at least in verbal recall (Cepeda et al. 2006), and a visible strength estimate is how Duolingo tells learners when to review (Settles & Meeder 2016).
- Self-evaluation is unreliable, and inaccurate self-evaluations undermine retention (Dunlosky & Rawson 2012). So the ladder should rest on performance, not on scroll depth.

**Fit:** a pure function over local data. Merge it with #118 and #109's Home changes so the mastery row changes once.

#### Gap 4. Learn → Practice pairing: a practice block in the daily plan and "Practise this chapter" links — new (M, high)

The effort is M because it touches two surfaces, the plan and the Reader, each with its own audits.

PRD PLAN-001 lists mixing labs and interview practice as remaining. #109 and #118 do not cover it.

**Seen at:** Khan's Learn → Practice → Quiz per lesson group [KA-1], Exercism's concept → learning exercise → practice [EX-2], Educative's Playground and Quiz per chapter [ED-2].

**Lumen today:**
- `buildDailySession` has only *review*, *mistakes* and *reading* blocks (`plan.js:58-123`).
- The 76 authored interview questions already anchor 56 chapters by `documentId`, and the 4 labs anchor 4, two of them chapters the questions also anchor (58 chapters in all).
- No screen offers "practise this chapter". #118's exit-ticket actions are card, starter cards, AI quiz and next chapter.

**Proposal:**
- **Daily plan:** a *practice* block (≤ 10 min) when a chapter finished in the last 14 days has an anchored lab or question not yet practised (from Gap 2). For example: "Practise: bias–variance (MLE · junior · 2 min)".
- **End of chapter:** a "Practise this chapter: 2 interview questions · 1 lab" row at the end of the Reader and in #118's ticket. It opens `TutorPractice` or a 1–3 question `InterviewRound` filtered by `documentId`.

**Why:** applying a concept soon after studying it, then retrieving it later, beats rereading (Roediger & Karpicke 2006; Dunlosky et al. 2013).

**Fit:**
- The content already exists. The plan math is deterministic.
- Rubric grading needs AI. The self-graded timed round and labs work without it.

#### Gap 5. Mixed cumulative checks and interleaved new cards — new (M, medium)

Impact is medium because the benefit depends on the material (see Why).

**Seen at:** Khan's unit tests and course challenge as the only route to *Mastered* [KA-1, KA-S], Math Academy's quizzes every 150 XP over recent topics plus non-interference [MA-1].

**Lumen today:**
- `buildAssessment` is single-Part by design.
- `buildReviewQueue` orders new cards by `createdAt` (`review.js:228`), so a batch made from one chapter arrives together (blocked).
- There is no interleaving logic anywhere in `src/` (grep for `interleav|mixed|shuffle`).

**Proposal:**
- **`buildMixedCheck(parts, {limit: 10})`:** round-robin across 2–5 practised Parts, from own cards or #113's authored items, never two items in a row from the same Part.
  - Scores are reported per Part and feed Gap 3, and misses go to the mistake notebook.
  - It is offered on Home once two or more Parts are *Practising*, and at most weekly in the plan.
- **New cards:** introduced round-robin by `documentId`, keeping creation order within each chapter.
- **Similar concepts:** don't introduce very similar new concepts on the same day (non-interference). Do mix them in review.

**Why:**
- Interleaving improves delayed tests when problem types must be told apart (Rohrer & Taylor 2007; Rohrer et al. 2015).
- A meta-analysis finds a moderate overall benefit (g = 0.42) that depends on similarity, while blocking was better for word learning (Brunmair & Richter 2019).
- So interleave scenario, derivation and interview items, and leave glossary-definition cards blocked if that proves simpler.

**Fit:** local, deterministic, and reuses `AssessmentDialog`.

#### Gap 6. A local code runner, starting with SQL — new (L, high for Parts 3 and 7)

The PRD lists LAB-001/002 as "deferred by design" (issue #10 closed with that deferral). There is no open issue.

**Seen at:** Exercism's test-runner contract [EX-C2], Educative's Run widget [ED-2], LeetCode's run/submit endpoints [LC-1].

**Lumen today:** labs say "work in your own editor, check here", and checks are literal comparisons (`labs.js:53-60`).

**Proposal:**
- **Phase 1:** sql.js (MIT). `sql-wasm.wasm` is 685 KB, 335 KB gzipped [RT-1].
  - Downloaded only on consent, cached outside the default offline set (the On-device Lite pattern), and run in a Worker with a 5 s timeout.
  - Lab tasks gain `checks` (an expected result table) and report per-task pass/fail with message and output ≤ 500 characters (Exercism's contract).
- **Phase 2:** Pyodide (MPL-2.0, used unmodified). The core is about 5.3 MB compressed before NumPy [RT-1]. Gate it on a physical-iPhone memory and load-time check like #130's go/no-go.
- **Meanwhile, with no runtime:** Parsons problems (reorder lines) and predict-the-output tasks, which suit a phone and take less time for similar learning gains (Ericson et al. 2017).

**Why:** immediate, specific feedback from tests (Shute 2008; Van der Kleij et al. 2015) on the coding Lumen's SQL and Python labs teach.

**Fit:** fully local after one consented download. Keep the runtime out of the install route (the byte budget from closed #95) and measure Safari memory on a real iPhone.

#### Gap 7. A mentor-style Code review option — new (M, medium)

The effort is M because a prompt change needs the ai-eval fixture cascade.

**Seen at:** Exercism's mentoring rules and typed analyzer comments [EX-C2]; Khanmigo's "never gives you the answer" [KM-1].

**Lumen today:** the `code_review` prompt (`server/ai/ollama.mjs:41`) asks for every finding in priority order, each with a concrete fix and snippet.

**Proposal:**
- **Response:** a "Mentor" variant (the default from labs and practice) gives the top 1–3 points.
  - Each point is typed *essential*, *actionable*, *informative* or *celebratory*, and opens with a question or hint.
  - A fix appears only behind "Show a fix".
- **Iteration:** "Review my next iteration" re-reviews the changed code.
- **Keep the existing mode** as "Full review".
- Add eval fixtures (the ai-eval cascade).

**Why:**
- Elaborated feedback "in manageable units", given after the learner's own attempt (Shute 2008, Table 2).
- A stepwise presentation "gives learners sufficient information to correct errors on their own" (Shute 2008, Table 2).

**Fit:** Mac local only, since On-device Lite has no Code review.

#### Gap 8. Reframe the review "Current streak" tile — new (S, medium)

#120 explicitly leaves this tile out of scope.

**Seen at:** Duolingo's admitted loss aversion and paid freezes [DU-2], versus Khan's weekly outcome goal [KA-5] and Math Academy's "fresh start" weeks [MA-1].

**Lumen today:**
- `reviewAnalytics` counts consecutive review days and resets on a missed day.
- `ReviewCenter.jsx:870` shows it with a flame icon.
- REMINDERS_DESIGN §1.3 already bans streak counters and loss framing in reminders.
- The PRD's PLAN-002 acceptance criterion reads "No guilt messaging, punitive streak loss, or dark-pattern permission prompts" (`PRODUCT_REQUIREMENTS.md:586`). A counter that drops to 0 after one rest day is the mildest form of punitive streak loss.

**Proposal:**
- Replace it with "Active days: 5 of the last 7 · 18 of 30", a rolling count that never drops to zero. Use no flame and allow rest days.
- Optionally add a weekly outcome ("This week: 1 Part reached Proficient"), and a Settings switch to hide it.

**Why:**
- A broken tracked streak lowers later engagement (Silverman & Barasch 2023).
- Slack ("emergency reserves") increases persistence after a miss (Sharif & Shu 2021).
- Lumen's own PRD forbids punitive streak loss.

**Fit:** a one-file UI change plus analytics.

#### Gap 9. Learner-written mistake hints are never shown — new (S, low; close to a bug)

**Seen at:** the Khan and Exercism hint ladders.

**Lumen today:**
- The manual mistake dialog collects "Hints" (`ReviewCenter.jsx:169, 232, 253`), and `mistakes.js` normalises up to 5 hints.
- No component renders them, and `scheduleCorrectiveReview` (`App.jsx:2747-2775`) leaves them off the corrective card.

**Proposal:** render them as "Show hint 1 of n" disclosures on the mistake entry and on the corrective card, before the expected answer.

**Why:** showing the learner's own cue before the answer turns rereading into a cued retrieval attempt (Roediger & Karpicke 2006). It is also a stepwise presentation (Shute 2008, Table 2), and it honours data the learner already took the trouble to enter.

**Fit:** S, local.

#### Gap 10. "Stretch" extra practice at a target difficulty — new (S, low)

**Seen at:** Duolingo Birdbrain [DU-1].

**Lumen today:** "Crunch weak cards" sorts weakest-first by lapses (`review.js:210-215`), so a crunch session can be mostly misses.

**Proposal:** an option that selects cards whose predicted recall is 0.6–0.85.

**Why:** practice at a reachable but non-trivial level (Wilson et al. 2019, a theoretical model; Bjork 1994).

**Fit:** S, local.

*Later, not now:* FIRe-style implicit credit, where reviewing Part 21 cards adds partial strength to the Parts it requires. It needs #111's `requires` graph first (L, low until then).

### B. Covered by an open issue (the research supports keeping them)

| Improvement | Seen at | Issue |
|---|---|---|
| Prerequisite-aware order, "Before this chapter" note, chain map plus text graph | Exercism syllabus [EX-1/2], Math Academy graph [MA-1], roadmap.sh unreadable phone map [RM-1] | **#111** |
| Setup with role, known background ("skip") and daily time, with an estimated finish | Math Academy placement and completion dates [MA-1], roadmap.sh Skip [RM-2], Exercism Practice Mode [EX-C2] | **#112** |
| Authored question pools and a placement check | Khan unit tests [KA-1], Math Academy diagnostic [MA-1] | **#113** |
| Confidence before reveal and a calibration readout | (metacognition; Dunlosky & Rawson 2012) | **#114** |
| Step-by-step reveal of derivations (faded worked examples in review) | Khan "Show a step" [KA-6], Math Academy worked examples [MA-1] | **#115** |
| Preview questions and exit ticket per chapter | Brilliant's dense exercises [BR-1], Educative's objectives preview and quiz per chapter [ED-2]; pretesting effect (Richland et al. 2009) | **#118** |
| Tracking chapter exercises, with optional AI feedback | Exercism practice exercises [EX-2] | **#119** |
| Study-time log, consistency calendar and a minutes-based pace | Math Academy XP ≈ minutes and daily goal [MA-1] | **#120** |
| Teach-back (self-explanation checked by the tutor) | Koji and Khanmigo guided explanation [BR-4, KM-1]; Chi et al. 1989; Bisra et al. 2018 | **#121** |
| Today-first Home and a session runner with a clear end | Duolingo's short sessions [DU-5], Khan's "Jump back in" [KA-5] | **#109** |
| On-device Lite parity for study flows | (all tutor platforms) | **#85** |

### C. Already in Lumen (no action)

- **Socratic tutor that holds back the answer:** Hint, "I'm stuck", Wrap up. This is the Khanmigo and Koji promise, locally.
- **Rubric-graded AI interview practice and timed rounds:** Educative's "AI mock interviews with scoring rubrics".
- **Scheduling:** an opt-in FSRS-4.5 scheduler with per-learner calibration, a newer model than the half-life regression Duolingo published in 2016.
- **A free mistake notebook with corrective scheduling.** Duolingo charges for mistakes practice.
- **Readiness checks** with retry and source links. They give most feedback at the end of the check, which delayed-feedback research supports for later retention (Butler et al. 2007; Shute 2008, Table 4). Labs keep immediate feedback, as suits procedural tasks.
- **Goal pace and a 15/30/60 daily plan.**
- **A local-first curriculum map and progress with no account.** roadmap.sh requires login.
- **No notifications, leaderboards or purchasable mechanics.**

### D. Deliberately not copied

These contradict the evidence above or Lumen's principles:
- leaderboards and leagues;
- purchasable streak freezes, gems and XP economies;
- daily loss-aversion reminders;
- study plans whose deadlines reset progress;
- paywalled mistakes practice;
- cosmetic rewards for activity.

---

## Appendix: evidence index

Short ids used above, with each full REA evidence id (`n/a` for clones, web search or WebFetch) and the URL or file. Observations for each row are in the evidence log (captured locally, not committed).

| Id | Host or source | REA evidence id | URL / file |
|---|---|---|---|
| KA-0 | www.khanacademy.org | ev_33dc723a3b70b808b05273ff9a5ce36730feb27e3456df6ae79a5bae80f6ec7f | https://www.khanacademy.org/robots.txt |
| KA-1 | www.khanacademy.org | ev_b5c5dd72033407361e919b417abce0cd6ed4c7b8fe7081edb6da70a021c465b1 | https://www.khanacademy.org/math/statistics-probability/summarizing-quantitative-data (393x852) |
| KA-2 | www.khanacademy.org | ev_2a37cc67e601154b5ed992f865b6863621c416bc7357230ef18f824882bbe87e | .../e/calculating-the-mean (393x852) |
| KA-3 | www.khanacademy.org | ev_875211425f34e9681e50e9acc206e56a6f2cc0701342b80aa696d630c0262ca6 | same, wrong answer "5" then Check |
| KA-4 | www.khanacademy.org | ev_b9383e6ea251a37b2c63285b19e56d2db271560dc5396494423f9b386bd1262b | same |
| KA-5 | www.khanacademy.org | ev_5280b8135372921ebf65f21554df268db28eace38098eb16ee718210bf5acede | same, levels tour + Hints |
| KA-6 | www.khanacademy.org | ev_0ef63ba05b8dd3fe45070e609e9fbd088f0922be9b9670e626a97a80ff9f3ba0 | same, second wrong answer then "Show a step" |
| KA-H1 | support.khanacademy.org | ev_c099496dec748c379c418beb6a0740dc1bd45cc21ff1409666f353879b457518 | https://support.khanacademy.org/hc/en-us/articles/5548760867853 |
| KM-1 | www.khanmigo.ai | ev_af3c69f715bced5c6ff58ad0de92c2a47848ab8eada6bbbf44df980504d0d8ab | https://www.khanmigo.ai/learners (393x852) |
| KA-S | (web search index of support.khanacademy.org) | n/a | https://support.khanacademy.org/hc/en-us/articles/5548760867853 ; .../28805978448269 ; .../28717667146893 |
| BR-1 | brilliant.org | ev_be045725e53a24b89ab203f60e860c7d2b3df28acb1482e9c09d4689eeb76893 | https://brilliant.org/courses/intro-neural-networks/ (393x852) |
| BR-2 | brilliant.org | ev_954e3c96211049a12063afa405c99b7e0233e01109b2a6da2f3e59ffe5e33b0f | same, click Start |
| BR-3 | brilliant.org | ev_1d96811a96e698af71595f9c51fdc6f119726443208b5146e1ce5a52f3f913b1 | https://brilliant.org/welcome/ |
| BR-4 | brilliant.org | ev_f7a15ebef1c39834c582a0472c28ee54b1a450f153acc8cdbcf04d1332dd7a2e | https://brilliant.org/ (393x852) |
| DU-1 | blog.duolingo.com | ev_5932d281410490be2978bb8d43175a2796a32654e413a55a648286520ab8fc30 | https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/ (Oct 7 2020, Bicknell & Brust) |
| DU-2 | blog.duolingo.com | ev_b0a0133a9d9aae6f88806dd86a1ca9348dbe0d0df6db61d87b7a3d3610cce22e | https://blog.duolingo.com/how-duolingo-streak-builds-habit/ (Jan 31 2022, Osman Mansur) |
| DU-3 | blog.duolingo.com | ev_08b10a90ea220ddc90b3e560e1c4e2a1a3f5ade5c20afa5933e822dbb8f0ad12 | https://blog.duolingo.com/how-we-learn-how-you-learn/ (Dec 14 2016, Burr Settles) |
| DU-4 | blog.duolingo.com | ev_6f7135e1d3feec48a54e15924f1564cc8c04d6fcebda226cdfae7fad8ab84ffc | https://blog.duolingo.com/how-to-review-lessons-on-duolingo/ (Oct 1 2026) |
| DU-5 | blog.duolingo.com | ev_a242e82fd88c5177ebcbdaef5403ca799db9f1fec1dc14f8ed581773b0728339 | https://blog.duolingo.com/ways-to-practice-in-duolingo/ (Dec 16 2025) |
| DU-6 | www.duolingo.com | ev_93663a76c1bb8b67d0fee11e48a6f92b7910ee4e33f3fe28d53d96879c3e9556 | https://www.duolingo.com/approach (393x852) |
| LC-1 | leetcode.com | ev_c01709b935f7b4ba2a28353c7265210b422dd3814368c9af59ed68829866bc2a | https://leetcode.com/problems/two-sum/description/ |
| LC-S | (web search index of official LeetCode discuss posts) | n/a | https://leetcode.com/discuss/post/1422121/Introducing-New-Feature-Study-Plan/ ; https://leetcode.com/discuss/post/1901748/new-study-plans-released-binary-search/ ; https://leetcode.com/discuss/post/2163754/study-plan-75-questions-till-interview-ready/ |
| EX-1 | exercism.org | ev_a559046e0828ed8396304209851c10fdeb70df218807c3e32370b51d345e4655 | https://exercism.org/tracks/python/concepts (393x852) |
| EX-2 | exercism.org | ev_8cf9a9074cc595aaedb36162faf1bcd0d2131ecf5c3dd7f6d4589932ff33586d | https://exercism.org/tracks/python/concepts/lists |
| EX-C1 | github.com/exercism/python (MIT, HEAD shallow clone 2026-10-22) | n/a | config.json; exercises/concept/card-games/.docs/hints.md; lists_test.py |
| EX-C2 | github.com/exercism/docs (no licence file at root; summarised only, nothing copied) | n/a | building/product/unlocking-exercises.md, concept-exercises.md, practice-exercises.md, building/tooling/test-runners/interface.md, building/tooling/analyzers/interface.md, mentoring/how_to_give_great_feedback.md |
| RM-1 | roadmap.sh | ev_3789ba4edbb01c84a910804a7eec6d37d031677515bb53dabb0b1501e4fa010f | https://roadmap.sh/machine-learning (393x852) |
| RM-2 | roadmap.sh | ev_d037d6a44b3e6bbd6b264025782ea7305faf982c05b328a24799e5c0b3e024b1 | same, desktop, click node "ML Engineer vs AI Engineer" |
| RM-3 | roadmap.sh | ev_255a0ec80dab9f7866e6393bb5e94e86f388a18c399a1b05057c4bfececd8dba | same, click Done |
| RM-C | github.com/kamranahmedse/developer-roadmap (proprietary licence: "protected by the copyright laws... personal use" only; HEAD 46aa6a6, 2026-10-20; sparse clone) | n/a | roadmaps/<name>/content/<topic>@<nodeId>.md |
| ED-1 | www.educative.io | ev_79252640a063ef2130b59b83ec1db402990249659590c267bddf7a21ef08dd7f | https://www.educative.io/courses/grokking-coding-interview (393x852) |
| ED-2 | www.educative.io | ev_c6bccf7410d68b7267242d9d56f75945a0f6eddeacf80d7e6b2a992f107442fd | https://www.educative.io/courses/fundamentals-of-machine-learning-for-software-engineers/gradient-descent (393x852) |
| MA-1 | www.mathacademy.com (no robots.txt: 404) | ev_0ca346d6f23e6e39f80955afca9f5117b3389fbb921bd6f7574c21124835ebca | https://www.mathacademy.com/how-it-works (393x852) |
| MA-2 | www.justinmath.com (WebFetch) | n/a | https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures (J. Skycak, Oct 5 2023) |
| RT-1 | unpkg.com / cdn.jsdelivr.net (HEAD/size probes, 2026-10-22) | n/a | https://unpkg.com/sql.js@1.15.1/dist/sql-wasm.wasm ; https://cdn.jsdelivr.net/pyodide/v0.28.3/full/ |

## Sources

### Platform pages, posts and repositories

All primary page captures are listed with their evidence ids in the appendix above. Other platform sources:

- Khan Academy help centre articles, read as search-index text only (the host shows a bot check):
  - https://support.khanacademy.org/hc/en-us/articles/5548760867853 (mastery levels)
  - https://support.khanacademy.org/hc/en-us/articles/28805978448269 (keeping a streak)
  - https://support.khanacademy.org/hc/en-us/articles/28717667146893 (what a streak is)
- Official LeetCode study-plan posts, read as search-index text only (the host shows a bot check):
  - https://leetcode.com/discuss/post/1422121/Introducing-New-Feature-Study-Plan/
  - https://leetcode.com/discuss/post/1901748/new-study-plans-released-binary-search/
- Duolingo blog, captured: https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/ , /how-duolingo-streak-builds-habit/ , /how-we-learn-how-you-learn/ , /how-to-review-lessons-on-duolingo/ , /ways-to-practice-in-duolingo/
- Skycak, J. (2023, Oct 5). Individualized spaced repetition in hierarchical knowledge structures. https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures
- Exercism (summarised in my own words; nothing copied):
  - https://github.com/exercism/python (MIT)
  - https://github.com/exercism/docs (no licence file)
- roadmap.sh: https://github.com/kamranahmedse/developer-roadmap (proprietary licence; nothing copied)
- Runtime sizes and licences:
  - https://unpkg.com/sql.js@1.15.1/dist/sql-wasm.wasm (sql.js, MIT)
  - https://cdn.jsdelivr.net/pyodide/v0.28.3/full/ (Pyodide, MPL-2.0)
  - https://pypi.org/project/pyodide-pack/ (package sizes)

### Learning science

Each reference was checked against its Crossref/DOI record, and its claim against an abstract (PubMed, ERIC, the publisher, or an author or institution page). The confirming link is given where it is not the DOI.

- Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research, 87*(3), 659–701. https://doi.org/10.3102/0034654316689306 (ERIC EJ1141817)
- Aleven, V., Stahl, E., Schworm, S., Fischer, F., & Wallace, R. (2003). Help seeking and help design in interactive learning environments. *Review of Educational Research, 73*(3), 277–320. https://doi.org/10.3102/00346543073003277 (ERIC EJ782605)
- Attali, Y. (2015). Effects of multiple-try feedback and question type during mathematics problem solving on performance in similar problems. *Computers & Education, 86*, 260–267. https://doi.org/10.1016/j.compedu.2015.08.011. The citation is verified, but no abstract could be retrieved. It is cited for the study design only.
- Baker, R. S., Corbett, A. T., Koedinger, K. R., & Wagner, A. Z. (2004). Off-task behavior in the cognitive tutor classroom: When students "game the system." In *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems* (pp. 383–390). ACM. https://doi.org/10.1145/985692.985741
- Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). Inducing self-explanation: A meta-analysis. *Educational Psychology Review, 30*(3), 703–725. https://doi.org/10.1007/s10648-018-9434-x (g = 0.55; ERIC EJ1186664)
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning. In M. A. Gernsbacher, R. W. Pew, L. M. Hough, & J. R. Pomerantz (Eds.), *Psychology and the real world* (pp. 56–64). Worth. The page range comes from listings; the 2nd edition is pp. 59–68.
- Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe & A. P. Shimamura (Eds.), *Metacognition: Knowing about knowing* (pp. 185–205). MIT Press. https://doi.org/10.7551/mitpress/4561.003.0011. MIT Press's record gives pp. 185–206. This is the commonly cited origin of "desirable difficulties".
- Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group instruction as effective as one-to-one tutoring. *Educational Researcher, 13*(6), 4–16. https://doi.org/10.3102/0013189X013006004 (ERIC EJ303699)
- Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin, 145*(11), 1029–1052. https://doi.org/10.1037/bul0000209 (PubMed 31556629)
- Butler, A. C., Karpicke, J. D., & Roediger, H. L., III. (2007). The effect of type and timing of feedback on learning from multiple-choice tests. *Journal of Experimental Psychology: Applied, 13*(4), 273–281. https://doi.org/10.1037/1076-898X.13.4.273 (PubMed 18194050)
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354–380. https://doi.org/10.1037/0033-2909.132.3.354 (PubMed 16719566)
- Chi, M. T. H., Bassok, M., Lewis, M. W., Reimann, P., & Glaser, R. (1989). Self-explanations: How students study and use examples in learning to solve problems. *Cognitive Science, 13*(2), 145–182. https://doi.org/10.1207/s15516709cog1302_1
- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. *User Modeling and User-Adapted Interaction, 4*(4), 253–278. https://doi.org/10.1007/BF01099821. The issue is dated December 1994; Crossref gives 1995.
- Deci, E. L., Koestner, R., & Ryan, R. M. (1999). A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin, 125*(6), 627–668. https://doi.org/10.1037/0033-2909.125.6.627 (PubMed 10589297)
- Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction, 22*(4), 271–280. https://doi.org/10.1016/j.learninstruc.2011.08.003 (ERIC EJ964388)
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques: Promising directions from cognitive and educational psychology. *Psychological Science in the Public Interest, 14*(1), 4–58. https://doi.org/10.1177/1529100612453266 (PubMed 26173288)
- Ericson, B. J., Margulieux, L. E., & Rick, J. (2017). Solving Parsons problems versus fixing and writing code. In *Proceedings of the 17th Koli Calling International Conference on Computing Education Research* (pp. 20–29). ACM. https://doi.org/10.1145/3141880.3141895
- Hanus, M. D., & Fox, J. (2015). Assessing the effects of gamification in the classroom: A longitudinal study on intrinsic motivation, social comparison, satisfaction, effort, and academic performance. *Computers & Education, 80*, 152–161. https://doi.org/10.1016/j.compedu.2014.08.019. Corrigendum: *Computers & Education, 127*, 298 (2018), https://doi.org/10.1016/j.compedu.2018.09.019.
- Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1), 81–112. https://doi.org/10.3102/003465430298487 (ERIC EJ782448)
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist, 38*(1), 23–31. https://doi.org/10.1207/S15326985EP3801_4
- Kapur, M. (2008). Productive failure. *Cognition and Instruction, 26*(3), 379–424. https://doi.org/10.1080/07370000802212669 (ERIC EJ800999)
- Kulik, C.-L. C., Kulik, J. A., & Bangert-Drowns, R. L. (1990). Effectiveness of mastery learning programs: A meta-analysis. *Review of Educational Research, 60*(2), 265–299. https://doi.org/10.3102/00346543060002265 (ERIC EJ415887)
- Locke, E. A., & Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation: A 35-year odyssey. *American Psychologist, 57*(9), 705–717. https://doi.org/10.1037/0003-066X.57.9.705 (PubMed 12237980). The citation is verified, but the abstract only lists topics, so the claim used here (goals work better with progress feedback) is the standard summary of the theory, not checked against the full text.
- Ouellette, J. A., & Wood, W. (1998). Habit and intention in everyday life: The multiple processes by which past behavior predicts future behavior. *Psychological Bulletin, 124*(1), 54–74. https://doi.org/10.1037/0033-2909.124.1.54
- Renkl, A., & Atkinson, R. K. (2003). Structuring the transition from example study to problem solving in cognitive skill acquisition: A cognitive load perspective. *Educational Psychologist, 38*(1), 15–22. https://doi.org/10.1207/S15326985EP3801_3
- Renkl, A., Atkinson, R. K., Maier, U. H., & Staley, R. (2002). From example study to problem solving: Smooth transitions help learning. *The Journal of Experimental Education, 70*(4), 293–315. https://doi.org/10.1080/00220970209599510 (ERIC EJ658398)
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied, 15*(3), 243–257. https://doi.org/10.1037/a0016496 (PubMed 19751074)
- Roediger, H. L., III, & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x (PubMed 16507066)
- Rohrer, D., Dedrick, R. F., & Stershic, S. (2015). Interleaved practice improves mathematics learning. *Journal of Educational Psychology, 107*(3), 900–908. https://doi.org/10.1037/edu0000001 (ERIC EJ1071568)
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science, 35*(6), 481–498. https://doi.org/10.1007/s11251-007-9015-8 (ERIC EJ786797)
- Sailer, M., & Homner, L. (2020). The gamification of learning: A meta-analysis. *Educational Psychology Review, 32*(1), 77–112. https://doi.org/10.1007/s10648-019-09498-w (ERIC EJ1245270)
- Settles, B., & Meeder, B. (2016). A trainable spaced repetition model for language learning. In *Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers)* (pp. 1848–1858). https://doi.org/10.18653/v1/P16-1174
- Sharif, M. A., & Shu, S. B. (2021). Nudging persistence after failure through emergency reserves. *Organizational Behavior and Human Decision Processes, 163*, 17–29. https://doi.org/10.1016/j.obhdp.2019.01.004. This is the "slack" study the Duolingo streak post links (ScienceDirect pii S0749597818304187). A related paper: Sharif & Shu (2017), *Journal of Marketing Research, 54*(3), 495–509, https://doi.org/10.1509/jmr.15.0231.
- Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research, 78*(1), 153–189. https://doi.org/10.3102/0034654307313795. The guideline quotes are from Tables 2–4, pp. 177–179, read in the author's copy: https://myweb.fsu.edu/vshute/pdf/shute%202008_b.pdf
- Silverman, J., & Barasch, A. (2023). On or off track: How (broken) streaks affect consumer decisions. *Journal of Consumer Research, 49*(6), 1095–1117. https://doi.org/10.1093/jcr/ucac029
- Sinha, T., & Kapur, M. (2021). When problem solving followed by instruction works: Evidence for productive failure. *Review of Educational Research, 91*(5), 761–798. https://doi.org/10.3102/00346543211019105 (ERIC EJ1308129)
- Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction, 2*(1), 59–89. https://doi.org/10.1207/s1532690xci0201_3
- Van der Kleij, F. M., Feskens, R. C. W., & Eggen, T. J. H. M. (2015). Effects of feedback in a computer-based learning environment on students' learning outcomes: A meta-analysis. *Review of Educational Research, 85*(4), 475–511. https://doi.org/10.3102/0034654314564881 (ERIC EJ1081708)
- Wilson, R. C., Shenhav, A., Straccia, M., & Cohen, J. D. (2019). The eighty five percent rule for optimal learning. *Nature Communications, 10*, 4646. https://doi.org/10.1038/s41467-019-12552-4. This is a theoretical result for gradient-descent learners on binary classification.
