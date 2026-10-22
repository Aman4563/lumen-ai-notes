# Knowledge and visual learning tools: what Lumen should learn

> Repository copy prepared on 2026-10-22 for `docs/internal/research/`. Local paths to captures, probes and clones are replaced with "captured locally (not committed)"; screenshots are not included. REA evidence ids and citations are unchanged; code references (`path:line`) are to `main` at `01c7a89`, the research baseline, unless the text names another commit. Candidate ids in this report (N1, G1, Gap 1, …) are its own; `SYNTHESIS.md` maps every one of them to an issue draft, an existing issue, or a recorded deferral.


Research date: 2026-10-22. Researcher: product research agent (read-only on the Lumen repo).
Question: how do the best personal-knowledge and visual-learning tools support a
self-directed learner of a technical curriculum, and what should Lumen AI Notes
(iPhone-first, local-first PWA, 23-part AI/ML curriculum) adopt?

## How to read this report

- **Evidence.** Every observation cites an REA evidence id (`ev_…`, from
  `capture_browser_scenario`), a public URL, or a source file read from a
  shallow clone. REA results, per-step accessibility text and screenshots were
  captured locally (not committed); file prefixes match the capture labels in the evidence index at the end.
- **Words.** All descriptions are my own paraphrase. Quotes are short and attributed.
  No code, text, image or asset from any studied product was copied into Lumen;
  nothing in the Lumen repo was edited.
- **Licences.** Excalidraw and JSON Canvas are MIT (dependency candidates, named as
  such). Logseq and Zotero are AGPL-3.0: studied for design only.
- **Gap labels.** `existing` = shipped in Lumen, with the code reference;
  `issue #N` = covered by an open GitHub issue in `Aman4563/lumen-ai-notes`
  (checked with `git gh issue list --state open`); `new` = neither. Items that the
  maintainer docs list as deferred but that have no open issue are marked
  `new (PRD backlog <ID>)` so it is clear they are known but untracked.

## Lumen today: the baseline this report compares against

Checked against `src/` at `01c7a89` (main):

| Capability | Lumen today | Where |
|---|---|---|
| Concept map | Part-level only: 23 Parts on a serpentine grid, one linear edge chain 1→2→…→23, mastery colour per Part, tap opens the Part | `src/lib/conceptMap.js:1-35`, `src/App.jsx:595-634` (labelled "Prerequisite path") |
| Links between notes | Relative Markdown `.md` links resolve and are audited for breakage; no wiki-links, no backlinks, no unlinked mentions, no block references, no transclusion (zero `src/` hits for backlink/wikilink/transclu/blockRef) | `src/lib/links.js:6-17`, `src/lib/linkAudit.js` |
| Highlights | Four colours, a purpose (important / definition / question / interview), comment, tags; anchored by quote plus 120-char prefix/suffix and relocated after edits | `src/components/AnnotationDialog.jsx:23-43`, `src/lib/annotations.js:107-108` |
| Notebook | Lists clippings, highlights, personal notes, bookmarks, uploads, mistakes; card from highlight or clipping; Markdown export of highlights | `src/components/Notebook.jsx` |
| Whiteboard | One board per document (`board:${documentId}`), up to 20 pages, canvas-drawn pen, highlighter, eraser, line, rectangle, ellipse, arrow, text, sticky; multi-select, lock, z-order, snap, rotate, zoom 1–4×, PNG/SVG/`lumen.board.v1` JSON. No images, no connectors bound to shapes, no embedded lecture content, no frames | `src/components/Whiteboard.jsx:86, 238-249, 658, 1662`; `src/App.jsx:3290` |
| Review | 8 card types, cloze (all blanks revealed together on one card), SM-2 or FSRS-4.5, queue = due cards by due date then new cards by creation date; "extra practice" mode is weakest-first; no deck/Part/tag scoping, no interleaving control | `src/lib/review.js:10-19, 206-231, 441-450` |
| Search | Ranked lexical search with `title:`, `part:`, `tag:`, `has:code`, `has:formula`, synonyms; semantic search designed but deferred | `src/lib/search.js:16-24`, `docs/SEMANTIC_SEARCH_DESIGN.md` |
| Imports | Markdown, text, HTML, EPUB; PDF deliberately deferred (bundle cost, no semantic structure) | `docs/IMPORT_DEFERRAL.md` |
| Diagrams in notes | Mermaid (including `mindmap`) renders in lectures, notes and tutor answers | `src/lib/mermaidDiagrams.js:3, 127` |
| AI tutor | Local only (Ollama on the Mac, or WebLLM on device); grounded citations; "Ask AI" on a selection | `src/components/Reader.jsx:916-917` |

Open issues that already cover parts of this space (read in full): #111 real
prerequisites and order, #113 starter decks from glossary/workbooks, #114
answer-and-confidence before reveal, #115 step-by-step derivation reveal, #116
daily highlight resurfacing ("Revisit 5"), #117 glossary popovers, #118 chapter
preview questions and exit ticket, #119 exercise tracking, #121 teach-back,
#128 Anki and Obsidian export.

## Learning-science sources used (each checked by search on 2026-10-22)

| Key | Source | Finding relied on |
|---|---|---|
| D13 | Dunlosky, Rawson, Marsh, Nathan & Willingham (2013), *Psychological Science in the Public Interest* 14(1), 4–58 | High utility: practice testing, distributed practice. Moderate: elaborative interrogation, self-explanation, interleaved practice. Low: summarising, highlighting, keyword mnemonic, mental imagery for text, rereading |
| RK06 | Roediger & Karpicke (2006), *Psychological Science* 17(3), 249–255 | Testing beats restudy on delayed tests even though restudy feels better |
| C06 | Cepeda, Pashler, Vul, Wixted & Rohrer (2006), *Psychological Bulletin* 132(3), 354–380 | Spacing benefit; optimal gap grows with the retention interval |
| KB11 | Karpicke & Blunt (2011), *Science* 331, 772–775 | Retrieval practice beat elaborative concept mapping, even on a concept-map final test |
| BK14 | Blunt & Karpicke (2014), *Journal of Educational Psychology* 106(3), 849–858 | Building a concept map **from memory** works as retrieval practice |
| OK21 | O'Day & Karpicke (2021), *Journal of Educational Psychology* 113, 986–997 | Mapping-then-retrieval gave no gain over retrieval alone despite more time |
| NA06 | Nesbit & Adesope (2006), *Review of Educational Research* 76(3), 413–448 | Concept/knowledge maps aid retention across 55 studies |
| S18 | Schroeder, Nesbit, Anguiano & Adesope (2018), *Educational Psychology Review* 30, 431–455 | Overall g = .58; constructing maps g = .72 vs studying given maps g = .43 |
| FM16 | Fiorella & Mayer (2016), *Educational Psychology Review* 28, 717–741 | Eight generative strategies: summarising, mapping, drawing, imagining, self-testing, self-explaining, teaching, enacting |
| B18 | Bisra, Liu, Nesbit, Salimi & Winne (2018), *Educational Psychology Review* 30, 703–725 | Prompted self-explanation, g = .55 across 69 effect sizes |
| C94 | Chi, de Leeuw, Chiu & LaVancher (1994), *Cognitive Science* 18(3), 439–477 | Prompting self-explanation while reading expository text improves understanding |
| BR19 | Brunmair & Richter (2019), *Psychological Bulletin* 145(11), 1029–1052 | Interleaving g = 0.42, larger when categories are similar to each other and material is complex |
| CP91 | Clark & Paivio (1991), *Educational Psychology Review* 3(3), 149–170 | Dual coding: verbal plus nonverbal representations support learning |
| VMG05 | Van Meter & Garner (2005), *Educational Psychology Review* 17(4), 285–325 | Learner-generated drawing as a select-organise-integrate strategy |
| W16 | Wammes, Meade & Fernandes (2016), *Quarterly Journal of Experimental Psychology* 69(9), 1752–1776 | Drawing to-be-remembered items beats writing them, not explained by elaboration or imagery alone |
| G06 | Ginns (2006), *Learning and Instruction* 16(6), 511–525 | Spatial and temporal contiguity: put related words and pictures together |
| SG78 | Slamecka & Graf (1978), *JEP: Human Learning and Memory* 4(6), 592–604 | Generation effect: self-generated items are remembered better than read ones |

Two findings shape every visual recommendation below. Building a map beats
looking at one (S18), and a map built **from memory** acts as retrieval practice
(BK14), but mapping as an open-book activity lost to plain retrieval (KB11, OK21).
So the strongest visual features are the ones that make the learner produce
structure from memory, then check it against the source. A pretty, read-only
graph of the curriculum is the weakest form.

---

## 1. Obsidian (with the Spaced Repetition plugin and JSON Canvas)

**Access and licence.** Public help at `obsidian.md/help` (robots: allow all);
the app is proprietary freeware. JSON Canvas is an open spec published by
Obsidian (`jsoncanvas.org`, repo `obsidianmd/jsoncanvas`, MIT). The Spaced
Repetition plugin docs are at `stephenmwangi.com/obsidian-spaced-repetition/`.
Evidence: `ev_3c80342b1c459830215fece0f0949309fbe6006f39b9bb17459febf4ed1676fb`
(7 help pages: graph, canvas, backlinks, links, embeds, bases, properties);
`ev_c3d7ced5e7b5bb188831d4f4f816cf14acc26da3c65470633d56b2c14966a96c`
(7 plugin pages plus the JSON Canvas 1.0 spec).

### Features that matter most for a self-directed technical learner

1. **Backlinks with linked and unlinked mentions.** For the open note, a panel
   lists every note that links to it, and separately every place its *name*
   appears without a link, each with the surrounding paragraph (step
   `backlinks-settle`). For a curriculum this is the "where else does
   *covariate shift* come up?" question, answered without the learner building
   links by hand.
2. **Heading and block links.** `[[Note#Heading]]` and `[[Note#^block-id]]`
   address a section or a single paragraph or list item; typing `^` suggests
   blocks, and `[[## term]]` / `[[^^term]]` search headings or blocks across the
   vault (step `links-settle`). Obsidian notes that block ids are not standard
   Markdown and do not work outside the app.
3. **Embeds (transclusion).** `![[Note#Heading]]` shows that section inline and
   stays current when the source changes; the same syntax embeds images, PDFs
   (with `#page=N`), audio and canvases (step `embeds-settle`).
4. **Canvas.** An infinite board whose cards are text, a note (optionally
   narrowed to one heading or block), media, a web page, a base view, or a folder.
   Cards connect with lines that attach to a card side, carry a label, a colour
   and a direction (none, one-way, two-way); cards group into labelled regions;
   align/distribute and snap-to-grid/objects; "Follow connection" jumps along a
   line; "Jump to group" navigates big boards; zoom to fit (Shift+1) or to
   selection (Shift+2) (step `canvas-settle`). Text cards convert to real notes,
   and only note cards count as backlinks.
5. **Local graph with depth.** The global graph sizes nodes by inbound links and
   offers filters (search, tags, orphans), colour groups by search query, and a
   time-lapse of note creation; the *local* graph shows only notes around the
   active one, with a depth slider (step `graph`).
6. **Properties and Bases.** Typed front-matter (text, list, number, checkbox,
   date, tags) plus Bases: saved table, list, cards, kanban or map views over notes
   filtered and grouped by property, stored as plain files (steps `bases-settle`,
   `properties-settle`).
7. **Spaced repetition inside notes (community plugin).** Cards are written
   inline in ordinary notes: `question::answer`, `a:::b` (both directions),
   multi-line `?`/`??`, and cloze with `==text==` (one card per deletion, with
   optional hints and ordering; a "generalised overlapping" mode controls which
   deletions are asked, hidden or shown on each card). Decks come from tags
   (hierarchical `#flashcards/ml/optim`) or folders. Sibling cards from one note
   can be buried until the next day. A separate **note review** queue schedules
   whole notes tagged `#review` for re-reading, rated Easy/Good/Hard. The default
   algorithm is an SM-2 variant whose initial ease is weighted by how linked a note
   is (PageRank); FSRS is listed as planned (steps `qa`, `cloze`, `decks`, `notes`,
   `algorithms`).

### How it works (data model and defaults)

- Everything is a Markdown file; links are text; the index (links, backlinks,
  block ids) is derived locally. Renames rewrite links by default.
- A canvas is a `.canvas` JSON file: `nodes[]` ordered by z-index, each with
  `id`, `type` (`text` | `file` | `link` | `group`), integer `x`, `y`, `width`,
  `height`, optional `color`; file nodes carry `file` and optional `subpath`
  (`#heading` or `#^block`); edges carry `fromNode`/`toNode`, optional
  `fromSide`/`toSide` (top/right/bottom/left), end shapes (`none`/`arrow`,
  default arrow at the end), `color` and `label`. Colours are hex or six presets
  ("1"–"6") whose actual values each app chooses (step `jsoncanvas-settle`).
- Flashcard scheduling data is written back into the note as an HTML comment
  next to the card; wrapping a card in a comment hides it from review.

### Why it works

- Backlinks and unlinked mentions prompt **elaboration and connecting ideas**:
  the learner meets a concept again in a new context, which is what elaborative
  interrogation and self-explanation exploit (D13 rates both moderate; B18).
- Canvas cards with labelled links are a **concept map** the learner constructs,
  the stronger form (S18: constructing g = .72 vs studying g = .43). Labelled
  links force the learner to name the relation, which is the generative step
  (FM16).
- Inline cards keep **retrieval practice** next to the source (RK06, D13), and
  sibling burying spreads related cards apart (C06).
- Note review is spaced re-reading. It is cheap, but re-reading alone is low
  utility (D13); it earns its place only when it leads to a retrieval action.

### Fit for Lumen

- **Adopt** an "unlinked mentions" panel for a lecture or glossary term. Lumen
  already has a ranked search index over all 143 lectures and custom notes, so
  "Mentioned in" can be computed offline with no authoring. High value, no
  network, no new storage.
- **Adopt** JSON Canvas as the board interchange format for a new *topic board*
  that spans lectures (MIT spec; nodes map to Lumen notes via `file` + `subpath`
  heading anchors that Lumen already generates). It also makes Obsidian export
  (#128) visual rather than text-only.
- **Adopt** block-level addressing only where Lumen already has anchors: heading
  ids exist; highlights already have stable ids and quote anchors, so "link to a
  highlight" and "embed a highlight" are cheaper than general block ids.
- **Avoid** the global force-directed graph as a headline feature on a phone: it
  is hard to read at 393 px and is the "study a given map" form (S18). A local
  graph (depth 1–2 around the current lecture) is the useful part.
- Inline card syntax is valuable for the learner's *own notes*; for built-in
  lectures, #113 (authored starter cards) is the right route.

---

## 2. Logseq

**Access and licence.** AGPL-3.0, read for design only. Two lines now exist:
`logseq/logseq` master is the database ("DB") version (shallow sparse clone at
`05c3ae73`, 2026-10-21), and the file-based version lives on as `logseq/og`
(the public demo links to its releases). Public docs `docs.logseq.com` and the
no-login demo `demo.logseq.com` (robots: content-signal comments only, no
disallow rules). Evidence: `ev_f53db6eac5bfdb72b206f1ec50c8d7f9540e8bbfdd8ace51ce34bcd0ffa3226c`
(docs flashcards, all pages), `ev_217e5c171aebf592baeafe915a48890ffa8a6c527c7c68c039727705e6a39698`
(docs whiteboards, embeds, clozes), `ev_b01ca50129bb4a238bdfd6bb1de36216eed68c1e822b9349256ba06bcc6b9050`
(demo landing), `ev_bfd8c47ece6057db8dbf1756ce80d2bc3ffa5cc214237b1dde3fd3ec265125b2`
(demo flow: write a cloze card, open Flashcards, reveal).

### Features that matter most

1. **Flashcards are just tagged blocks.** Any outline block with `#card` (DB
   version: the built-in *Card* tag or any tag that extends it) is a card;
   `{{cloze …}}` hides spans; child blocks are the answer. In the demo, typing
   `Adam combines {{cloze momentum}} with per-parameter {{cloze adaptive learning
   rates}} #card` into a journal block made the left-sidebar Flashcards count read
   1 straight away; the review dialog showed the block with its source (the
   journal date) above it, a deck picker ("All"), a 1/1 counter, a shuffle toggle,
   and three plain-language ratings with single-key shortcuts: "Forgotten" (f),
   "Took a while to recall" (t), "Remembered" (r) (`ev_bfd8c47e…`, screenshot
   `logseqcard.answer-shown.png`).
2. **Decks are saved queries.** `{{cards [[Logseq]]}}` reviews only cards that
   reference a page, `{{cards (not [[Logseq]])}}` excludes one (docs, `ev_f53db6ea…`).
   In the DB version a *Cards* block stores a query; the review dialog's
   combobox switches between "All" and each saved set, a "+" creates a new set,
   and "Practice again" reviews the set even when nothing is due
   (`src/main/frontend/extensions/fsrs.cljs`, `src/main/frontend/worker/handler/flashcard.cljs`,
   e2e `clj-e2e/test/logseq/e2e/flashcards_basic_test.clj`).
3. **FSRS in the DB version** with four ratings (again/hard/good/easy, keys 1–4),
   each button showing when the card would next be due (hidden on phones); cloze cards reveal in two
   phases (clozes first, then the answer children); phone layouts use full-width
   48 px rating buttons (`fsrs.cljs`, read for design only).
4. **Block references and embeds edit the source.** `((uuid))` references a block
   (`deps/common/src/logseq/common/util/block_ref.cljs`); the demo's tutorial
   says edits made through a reference change the referenced block, and the docs
   define block and page embeds (transclusion) the same way (`ev_217e5c17…`).
5. **Linked and unlinked references on every page**, as in Obsidian (every docs
   page ends with both lists, `ev_217e5c17…`).
6. **Journals as the landing page.** The app opens on today's dated page
   ("Oct 22nd, 2026" in the demo), so capture has a default home and every note
   is timestamped by context (`ev_b01ca501…`).
7. **Whiteboards with "portals" (OG version).** A board embeds live blocks,
   pages or other boards found by search ("Quick Add" by double-clicking the
   canvas), so the board stays connected to the notes (`ev_217e5c17…`). The DB
   master contains no whiteboard implementation (no tldraw files in the tree,
   only review rules and test fixtures), so whiteboards are not carried forward
   there at this commit.
8. **Local semantic search (DB desktop).** An optional sidecar runs a
   sentence-transformers model (default all-MiniLM-L6-v2) on the user's machine
   and serves embeddings over a loopback HTTP endpoint
   (`sidecar/embedding_server.py`, `src/electron/electron/embedding_server.cljs`).

### How it works

- Outliner: every bullet is a block with a stable UUID; pages are blocks too.
  References are stored by id, so moving or editing text keeps links valid.
- Card scheduling state lives as properties on the card block (DB:
  `:logseq.property.fsrs/state`, `:logseq.property.fsrs/due`); a block without
  state is new and due at creation.
- Defaults: Flashcards in the left nav with a due badge; review opens as a modal;
  `t c` toggles cards on desktop.

### Why it works

- Turning a note into a card at the moment of reading is a low-friction
  **retrieval practice** hook (RK06) and a **generative** act: the learner chooses
  what to blank out (SG78, FM16).
- Query-scoped decks make **interleaving** a choice: review "all optimisation cards
  across Parts 5, 7 and 18" mixed, which is where interleaving helps most —
  similar, confusable categories (BR19).
- Showing the source context above the card supports error correction: a miss
  sends the learner back to the passage, not to a bare answer.
- Plain-language ratings ("Took a while to recall") make self-grading easier for
  novices than abstract labels.

### Fit for Lumen

- **Adopt** scoped review: "Review cards from this Part / tag / collection /
  lecture", plus an *interleave* toggle that mixes related Parts. `buildReviewQueue`
  (`src/lib/review.js:206-231`) already filters and sorts; scoping is a filter
  before it. No issue covers this.
- **Adopt** "make a card from this paragraph" with the blank chosen in place
  (Lumen has highlight → card; a one-tap cloze from a selection is the missing step).
- **Consider** the Mac-local embedding idea: Lumen's Node server already fronts
  Ollama, which can serve embedding models; that would let "related notes" and
  semantic search run on the Mac without the 24–45 MB phone download that
  `docs/SEMANTIC_SEARCH_DESIGN.md` defers. (Design note, not a top-10 item.)
- **Avoid** a general outliner and arbitrary block UUIDs inside built-in lectures:
  Lumen lectures are long-form Markdown, and annotation offsets are fragile to
  inserted markup (see #117's analysis). Use existing heading anchors and highlight
  ids as the addressable units.
- **Avoid** tldraw as a dependency: current tldraw SDK releases need a production
  licence key (tldraw.dev "License key" and v4.0 release notes), which conflicts
  with Lumen's free, account-free model. Excalidraw (MIT) is the realistic option.

---

## 3. Heptabase

**Access and licence.** Proprietary, subscription, cloud-synced; studied only
through public pages (`wiki.heptabase.com`, no robots file). `heptabase.com/learning`
now returns 404 (step `learning`). Evidence:
`ev_ef8649e056bb3f5a84840164aece5d6215e9e8f53066c376a3af71cf8fe2e2d8`
(wiki home, getting started, use case and workflow; `section` and `mindmap` are
now "Page Not Found") and `ev_47e4ce5ac8e171b77cc3ca1d13392f47bbf220fa7a69c536bdf912fd1c858629`
("Learn & research a topic", PDF annotation, fundamental elements, knowledge lifecycle).

### Features that matter most, and how they work

1. **A five-step "learn a topic" method built into the tool** (step `readings`,
   the founder's own write-up): (1) highlight important paragraphs and collect
   them into one card per book or lecture; (2) dissect that card into
   single-concept cards by dragging blocks out onto a whiteboard; (3) connect
   related concept cards, merging duplicates and splitting oversized ones;
   (4) group them into named sections; (5) integrate them with concept cards from
   earlier sources on a new topic board. Each concept card's **title is one full
   sentence stating the idea**, not a label; the page gives the example of
   replacing a two-word title with the whole claim so the board can be recalled
   from titles alone. After mapping, links to the concept cards are pasted back
   into the source card, so the source becomes an index of its ideas.
2. **Cards live in a library; boards only place them.** "Whiteboards do not own
   cards"; one card can sit on many boards, and the card's info panel lists every
   board it appears on and jumps to its position there (step `elements-settle`).
3. **Whiteboard objects for structure**: cards, text, sections (named groups),
   mind maps, journals, sub-whiteboards, arrows, and search limited to the board;
   right-click to recolour, tag, move to another board or view edit history.
4. **Highlights become cards.** Highlighting a PDF creates "Highlight Cards" that
   can be dragged onto boards, embedded in notes, and located back in the source
   (step `pdf-settle`). Imports cover PDFs, Readwise, Zotero, web articles, video
   and podcast transcripts.
5. **`@` mentions with block-level backlinks** inside cards.
6. **AI chat with citations and AI actions** (summaries, mind maps) whose answers
   can be dragged onto the board. These use hosted models under a subscription.

The public pages I read describe no built-in spaced review: "retention" appears
as a goal of the method, but recall is left to revisiting boards.

### Why it works

- Steps 2–4 are **generative learning** in Fiorella and Mayer's sense:
  summarising (one-sentence titles), mapping, and organising (FM16). Constructing
  the map, not viewing it, carries the benefit (S18).
- One-sentence claim titles are a form of **self-explanation**: the learner must
  state what the concept *says*, not what it is called (B18, C94).
- Reusing a card on several topic boards is **elaborative integration**: the
  same idea is connected to different prior knowledge.
- The gap: without retrieval, a finished board is mostly re-read later, and
  re-reading is low utility (D13). Mapping as an open-book activity lost to plain
  retrieval in controlled tests (KB11, OK21). Pairing Heptabase-style mapping
  with a build-from-memory check (BK14) is the improvement Lumen can make.

### Fit for Lumen

- **Adopt** the method's data model in a local-first way: *topic boards* that are
  not tied to one lecture, holding **source cards** that point at a lecture
  section, a highlight, a card or a custom note (one object, many boards).
- **Adopt** "one-sentence title" as the default prompt for a concept card and for
  board text cards ("What does this idea claim?").
- **Adopt** "source card becomes an index": a lecture's outline can show which
  boards and concept cards reference each section.
- **Skip** the hosted-AI features; Lumen's local tutor can do the optional bits
  (suggest a one-sentence title, propose links) with confirmation.

---

## 4. Excalidraw

**Access and licence.** MIT (repo `excalidraw/excalidraw`, shallow sparse clone at
`1d4dc2c0`, 2026-10-21; npm `@excalidraw/excalidraw` 0.18.0, MIT, React peer
dependency, 46.8 MB unpacked across 1,029 files; `@excalidraw/mermaid-to-excalidraw`
2.2.2, MIT, about 330 KB unpacked, depends on `mermaid`). The public editor at
`excalidraw.com` needs no sign-in; robots allows the root URL. Evidence:
`ev_9d5434325e875e660177df617b7ae334d29076ab50705a1059326cd46b67962e` (landing),
`ev_429725178a01ec3eb86d9909ec9ecda0ada6df1917546a4f5d9d3b455877e856` (More tools,
Library; the Help click timed out),
`ev_d330fb7ab2af05e4ce6d32915572bebc38672e8778d17d0bc72c7824141fb9d4`
(Mermaid to Excalidraw flow, Help dialog via `?`),
`ev_baa13c1284fa8eefa50363a8228d6cda6339e2831d287cfc89adbec147883c3b`
(393×852 phone viewport).

### Features that matter most, and how they work

1. **Mermaid to editable drawing.** More tools → Generate → "Mermaid to
   Excalidraw" opens a two-pane dialog (code left, live preview right); Insert
   placed the sample flowchart as separate, selectable rectangles, a diamond, text
   labels and bound arrows with edge labels, all editable (screenshots
   `excalidraw2.mermaid-dialog.png`, `excalidraw2.inserted.png`). The dialog
   states that flowchart, sequence, class and entity-relationship diagrams
   convert, and other types are inserted as an image.
2. **Connectors that stay attached.** Arrows bind to shapes
   (`startBinding`/`endBinding` with a fixed attachment point and a bind mode),
   text can live inside a shape (`containerId`), and elbow arrows route around
   shapes (`packages/element/src/types.ts`). The Help dialog lists "Create a
   flowchart from a generic element" (Cmd+Arrow) and "Navigate a flowchart"
   (Option+Arrow): select a box and press an arrow key to add the next connected box.
3. **Frames.** A frame element clips and moves its children (`frameId` on every
   element; `packages/element/src/frame.ts`), usable as slides or named regions.
4. **Library.** A sidebar of reusable element groups; empty by default with a link
   to a public library catalogue; a library file holds versioned `libraryItems`
   (`packages/excalidraw/data/types.ts`).
5. **Other tools** in the More tools menu (`ev_42972517…`, step `more-tools-open`):
   Insert image, Frame tool, Web Embed (domain allowlist: YouTube, Vimeo, Figma and
   others in `packages/element/src/embeddable.ts`), Draw to shape (Shift+X turns a
   rough sketch into a clean shape), Laser pointer, Bucket fill, Lasso selection;
   plus two AI items ("Text to diagram", "Wireframe to code") that call a hosted
   service.
6. **Keyboard and view inventory** from Help: links on shapes (Cmd K), find on
   canvas (Cmd F), zoom to fit/selection (Shift 1/2), view mode, zen mode, snap to
   objects, lock, group, align, copy/paste styles.
7. **Local-first defaults.** The empty canvas tells the user drawings are saved in
   browser storage, that this can be cleared, and to save to a file regularly.
8. **Phone layout.** At 393×852 the top toolbar becomes a bottom bar of eight
   tools (hand, select, draw, eraser, rectangle, arrow, text, image) plus More;
   undo/redo sit above it; menu and library are in the top corners
   (`excalidraw-phone.settle.png`).

### Why it works

- Turning an expert diagram into editable parts invites **reorganising and
  annotating it**, a generative act (FM16), and **learner-generated drawing**
  supports selecting, organising and integrating ideas (VMG05). Drawing
  to-be-remembered content beat writing it in free recall (W16).
- **Dual coding**: a diagram plus its verbal labels gives two linked codes (CP91),
  and labels placed on the diagram follow the contiguity principle (G06). Note
  that D13 rates *mental imagery* for text learning low; the benefit is in
  producing or manipulating an external diagram, not imagining one.
- Attached, labelled connectors are what make a board a **concept map** rather
  than a picture (S18), and they make a **rebuild-from-memory** exercise
  checkable (BK14).

### Fit for Lumen

- Lumen's curriculum already contains **79 Mermaid diagrams in 65 lecture files**
  (75 flowcharts, 2 sequence, 2 state; counted with `grep` over `notes/`), so 77 of
  79 are in types Excalidraw's converter handles. Lumen also already lazy-loads
  Mermaid 11.17.0 (the `mermaid.core` chunk is about 95 KB in `dist/assets`).
- **Dependency candidates (MIT):** `@excalidraw/excalidraw` as a full board engine
  is heavy next to the `Whiteboard` chunk in the current `dist/` (about 64 KB)
  and the 750 KB startup budget; it would have to be a separately cached, consented download like the
  WebLLM model. `@excalidraw/mermaid-to-excalidraw` is the more realistic
  candidate, or a small Lumen converter for flowcharts written against the
  Mermaid parser Lumen already ships.
- **Adopt the model, not necessarily the package**: bound arrows with labels,
  frames, images, links on objects, and "add connected box" are the four ideas
  Lumen's board most lacks (`src/components/Whiteboard.jsx` has none of them).
- **Phone**: Lumen's board should keep a bottom tool bar with few tools and put
  structure tools (connect, frame) behind one tap, as Excalidraw does.
- **Skip** the AI generators (hosted service) and Web Embed (third-party iframes
  conflict with offline use and Lumen's privacy model).

---

## 5. Zotero

**Access and licence.** AGPL-3.0 (desktop and the `zotero/reader` repo, shallow
sparse clone at `4bfd82ee`, 2026-10-07; `COPYING` states AGPLv3). Read for design
only. Public documentation at `www.zotero.org/support` (robots disallows only
`/trac/`, `/people/`, follower pages and `/google-docs/`). Evidence:
`ev_2d6202fcad8d9b197fb2c1801ebe96823973a230634c226789c30678f5d37cc0`
(PDF reader and note editor, notes, related items, collections and tags, iOS,
searching).

### Features that matter most, and how they work

1. **Highlight modes.** With nothing selected, selecting text pops up colours;
   "locked mode" makes every selection an instant highlight in the chosen colour,
   for fast passes (step `pdf-reader`).
2. **Note from annotations.** One command turns every annotation in a document
   into a note ("Add Note from Annotations"), or merges several documents'
   annotations into one standalone note. Each quote in the note keeps a link back
   to its page and a citation; "Show on Page" reopens the PDF at the passage;
   colours can be shown or hidden; templates control the layout.
3. **Annotation record** (`src/common/types.ts`): type (highlight, underline, note,
   image area, text, ink), colour, `sortIndex` (reading order), `pageLabel`,
   `position`, quoted `text`, `comment`, `tags`. EPUB and web-snapshot annotations
   use W3C Web Annotation selectors (`TextQuoteSelector` with exact, prefix and
   suffix; `TextPositionSelector`; `CssSelector`; `FragmentSelector`, each
   refinable) (`src/dom/common/lib/selector.ts`).
4. **Related items**: manual, symmetric links between any two items (A↔B), not
   transitive; suggested for connecting a standalone note to what it discusses.
5. **Colored tags**: up to nine tags get colours and number keys for one-key
   tagging; emoji tags display inline. **Saved searches** behave as smart
   collections.
6. **iOS app**: highlight, note, image and ink annotations on PDFs, Share-sheet
   capture from Safari, DOI and barcode scanning, full dark mode.
7. A read-aloud annotation popup in the reader code suggests highlighting during
   text-to-speech (`src/common/components/utility-popup/read-aloud-annotation-popup.js`);
   I did not observe it in use.

### Why it works

- Gathering highlights into a note is the hinge between low-utility highlighting
  (D13) and higher-value **summarising and self-explaining** (FM16, B18): the
  quotes arrive, and the learner writes around them.
- "Show on Page" keeps every claim **checkable against its source**, so a learner
  who recalls something wrong can see the original at once. (RK06 found a testing
  benefit even without feedback; a one-tap route back to the source adds the
  correction step on top.)
- Fast colour-coded passes plus later processing match the **extract-then-process**
  pattern of incremental reading (section 6).

### Fit for Lumen

- Lumen already anchors highlights the same way (quote plus 120-character prefix
  and suffix, `src/lib/annotations.js:107-108`), so a **W3C TextQuoteSelector
  export** is cheap interoperability.
- The biggest borrowable flow is **"study note from my highlights"**: Lumen exports
  highlights only as a downloaded Markdown file (`exportAnnotations`, `src/App.jsx`),
  not as an editable in-app note with back-links.
- Opening a highlight in context from outside the Reader is planned in #116.
- Highlighting during narration is planned in #102 (Highlight and Make card from
  audio bookmarks).
- **PDF annotation stays deferred by design** (`docs/IMPORT_DEFERRAL.md`: bundle
  cost and no semantic structure). If it is revisited, pdf.js (Apache-2.0) behind
  the consented-download pattern would be the route; this report does not count it
  as a gap.

---

## 6. Incremental reading (Polar and maintained alternatives)

**Polar status.** The Polar Bookshelf GitHub repository URL I tried
(`github.com/burtonator/polar-bookshelf`) returns HTTP 404, and `getpolarized.io`
now redirects to an unrelated site (`osclass.org`, not followed). I treat Polar as
unmaintained and studied the pattern elsewhere.

**Open-source alternative found (likely maintained; see the date caveat below).**
*Incremental Reading Toolkit*, an
Obsidian community plugin (`github.com/kja140/incremental-reading`, MIT, 39
commits, desktop-only because its reader relies on Electron and Node APIs; read via
WebFetch). The repository page showed no commit or release dates, so its recent
activity was not confirmed from the repository itself (a third-party plugin listing
surfaced in search mentions July 2026). Also relevant: the Obsidian SR plugin's
**note review** queue (section 1)
and SuperMemo's description of the method (`supermemo.guru/wiki/Incremental_reading`,
practitioner source; `help.supermemo.org` sits behind a Cloudflare challenge and was
not accessed).

### Features that matter most, and how they work

1. **Sources, extracts, topics.** Long material is a *source* read in portions;
   passages pulled out are *extracts* linked back to the source; both are *topics*
   scheduled in a reading queue (IR Toolkit README).
2. **Priority plus progress-aware intervals.** Each topic has a priority, and the
   interval depends on how much of the source remains (pages or seconds), so a long
   book resurfaces in manageable slices.
3. **A daily queue you step through** ("Next element"), showing overdue work, new
   material and active topics.
4. **Extract → cloze → spaced review.** SuperMemo's pipeline: selection, extracts
   of key passages, keywords turned into cloze deletions, then spaced review until
   stable; its page claims faster reading with better comprehension and
   retention, and also notes that adoption was still poor around 2020.
5. **Cards linked to their source**, scheduled with FSRS-6 in the IR Toolkit.

### Why it works

- **Spacing** applies to reading as well as cards (C06); re-meeting a source in
  slices is spaced study.
- **Extract-then-cloze** turns passive reading into generation and retrieval
  (SG78, RK06).
- Caveat: incremental reading as a whole has little controlled-experiment evidence
  of its own; its parts (spacing, retrieval, generation) are what is supported.

### Fit for Lumen

- Lumen imports long material (EPUB books fan out into chapters, HTML, Markdown),
  but the daily plan schedules only started lectures and unread built-in chapters
  (`src/lib/plan.js:26-41`), with no priority or resurfacing for imported sources.
  A small reading queue for imports, with extracts = highlights and one-tap cards,
  fits Lumen's existing pieces (reading position, highlights, review).

---

## 7. Tana (extra: supertags)

**Access and licence.** Proprietary, cloud. Public docs (robots allow all; the
docs now redirect to `outliner.tana.inc/learn/...`). Evidence:
`ev_126281c5a5b1126774bf91474b4a8f232f1ccb3d7e503795a461cbbd0bae97b5`
(supertags, fields).

### Features that matter most, and how they work

1. **A tag that types the node.** A supertag means the note *is* a thing (a Task, a
   Person), not merely related to it, and it fills the note with a template of
   fields; all nodes with the tag form a collection shown as a table on the tag's
   page (step `supertags`).
2. **Inheritance.** A supertag can extend another, inheriting its fields while
   adding its own.
3. **Typed fields**: plain, options, options drawn from another supertag's
   instances (a relation), date, number, URL, checkbox; fields can be required,
   hidden, auto-initialised, and marked "Part of" (step `fields-settle`).

### Why it works

- Field templates are standing **elaborative-interrogation and self-explanation
  prompts** ("why does this hold?", "when does it fail?") (D13 moderate; B18).
- Typing ("this *is a* loss function") supports **categorisation**, which is what
  interleaving of similar categories trains (BR19).

### Fit for Lumen

- Lumen's README already defines mastery as five abilities: explain without jargon,
  derive or interpret the formula, choose it in a realistic scenario, identify when
  it fails, connect it to production. A **concept note template** with exactly those
  fields, collected into a "My concepts" table, is a local, AI-free way to make every
  learner note generative. No cloud or Tana dependency is needed.

---

## Gaps for Lumen

Effort uses Lumen's own delivery norms (unit tests, browser audits, a11y and
393 px checks, startup and offline budgets): **S** ≈ a few days, **M** ≈ one to
two weeks, **L** ≈ three weeks or more. Impact is for a self-directed learner of
this curriculum on an iPhone.

### Status of every candidate

| ID | Candidate | Status | Effort | Impact |
|---|---|---|---|---|
| G1 | Diagram recall: hide a diagram's labels, reveal by tap, review as cards, later rebuild on a board | **new** (PRD LEARN-002 lists Mermaid card rendering as open; masking for recall is not specified) | M | High |
| G2 | "Mentioned in" (unlinked mentions) for chapters and terms, backlinks for own notes, and `#heading` links that land on the heading | **new** (PRD backlog GRAPH-001 lists backlinks) | M (anchor fix S) | High |
| G3 | Topic boards that span lectures, holding live source cards | **new** (PRD backlog BOARD-002) | L | High |
| G4 | Connectors that stay attached and carry a label; named frames | **new** (PRD backlog BOARD-002) | M | High |
| G5 | "Open diagram on board": Mermaid to editable board objects | **new** | M (after G4) | Medium-high |
| G6 | Scoped review (Part, lecture, tag, collection, saved filter) and a "mix related topics" interleave option | **new** | S–M | High |
| G7 | One-tap cloze from a selection; one card per numbered blank with sibling burying | **new** (plain cloze exists) | S + M | High |
| G8 | "Study note from my highlights": an editable note with back-links and own-words prompts | **new** (file export exists; #116 adds open-in-context) | S–M | High |
| G9 | JSON Canvas export and import for boards | **new** (complements #128) | S–M | Medium |
| G10 | Concept note template whose fields are the README's five mastery checks, plus a "My concepts" table | **new** (PRD LEARN-004 lists concept-level aggregation as open) | M | Medium-high |
| G11 | Reading queue for imported long sources (incremental reading) | **new** | M | Medium |
| G12 | Local "Connections" view around the open lecture | **new** (PRD backlog GRAPH-001; needs #111) | M | Medium |
| G13 | Images and links on board objects | **new** (PRD backlog BOARD-002) | M | Medium |
| G14 | "Add connected box" handles on the board | **new** (after G4) | S–M | Medium |
| G15 | Find text on a board | **new** (PRD backlog BOARD-003) | S | Low |
| G16 | W3C `TextQuoteSelector` export for highlights | **new** | S | Low |
| — | Interval preview on rating buttons | **existing** (`src/components/ReviewCenter.jsx:797`, `previewReviewIntervals`) | — | — |
| — | Review card links to its source lecture | **existing** (`src/components/ReviewCenter.jsx:822`, lecture top only); section anchor in **#113** | — | — |
| — | Highlights with colour, purpose, comment, tags | **existing** (`src/components/AnnotationDialog.jsx:23-43`) | — | — |
| — | Collections, tags, field filters, saved and recent searches (a "Bases-lite") | **existing** (`src/lib/search.js:16-24`, Notebook) | — | — |
| — | Mind maps inside notes | **existing** (Mermaid `mindmap`, `src/lib/mermaidDiagrams.js:127`) | — | — |
| — | Active recall by concealing a section (teaching mode); Ask AI on a selection | **existing** (`src/components/TeachingMode.jsx:116`, `src/components/Reader.jsx:1128-1130`) | — | — |
| — | Resurface highlights daily; open a highlight in context from Notebook or Review | **issue #116** | — | — |
| — | Tap a term for its glossary definition | **issue #117** (G2 can add "Mentioned in" to the same popover) | — | — |
| — | Step-by-step reveal of derivations (the SR plugin's "overlapping cloze" need) | **issue #115** | — | — |
| — | Answer and confidence before reveal | **issue #114** | — | — |
| — | Authored starter cards with source anchors | **issue #113** | — | — |
| — | Real prerequisites and recommended order (graph edges G12 needs) | **issue #111** | — | — |
| — | Explain a section back and have the tutor check it | **issue #121** | — | — |
| — | Preview questions and exit ticket; exercise tracking | **issues #118, #119** | — | — |
| — | Study log and consistency calendar (the journal-like history) | **issue #120** | — | — |
| — | Highlight or make a card from the sentence being read aloud (Zotero read-aloud annotation) | **issue #102** | — | — |
| — | Export cards to Anki and notes to Obsidian | **issue #128** (add G9 boards and G7 blank numbering) | — | — |
| — | PDF reading and annotation | **deferred by design** (`docs/IMPORT_DEFERRAL.md`), not counted as a gap | — | — |
| — | Semantic "related notes" | **deferred by design** (`docs/SEMANTIC_SEARCH_DESIGN.md`); Logseq's local sidecar suggests serving embeddings from the Mac server through Ollama as a cheaper route (design note) | — | — |

### Proposals for the new items

#### G1. Diagram recall ("hide the labels, then rebuild")

- **Today.** The 79 Mermaid diagrams (65 lecture files; 75 flowcharts) render as
  static SVG. `grep -ri occlusion src` finds nothing.
- **Proposal.**
  1. In the Reader and Teaching mode, a **Recall** toggle on each flowchart masks
     node and edge labels; tap a node to reveal it, or Reveal all. Masking acts on
     the rendered SVG inside `.diagram-shell`, which the annotation index already
     skips (`src/lib/annotations.js:7`), so highlights and their offsets are
     untouched.
  2. **Make diagram card** stores the lecture, the diagram's index and source hash,
     and a node group to hide. Review shows the diagram with that group masked;
     several groups from one diagram are siblings, buried for the rest of the day
     once one is reviewed.
  3. After G4/G5, **Rebuild on board** places the diagram's nodes shuffled without
     edges; the learner connects them, then **Check** marks correct, missing and
     extra links against the source.
- **Phone.** Steps 1–2 are tap-only; step 3 uses G4's tap-to-connect.
- **Why.** Building a map from memory works as retrieval practice (BK14), while
  open-book mapping lost to plain retrieval (KB11, OK21); diagrams with labels are
  dual coded (CP91). Excalidraw's converter shows the nodes and edges are
  recoverable as objects (`ev_d330fb7a…`).
- **Effort/impact.** M for 1–2, another M for 3. High.

#### G2. "Mentioned in", backlinks and heading links

- **Today.** The 116 chapter files contain **one** link to another chapter; the
  other 189 internal links come from the navigator, Part indexes, the roadmap and
  the coverage audits. Concepts recur
  without links: *softmax* appears in 21 chapters across 12 Parts, *attention* 27
  across 15, *quantization* 17 across 11, *distribution shift* 12 across 7,
  *KV cache* 7 across 5 (`grep` over `notes/`, chapter files only). `src/` has no
  backlink code, and cross-document links open the target at its top because the
  Reader drops the `#fragment` (`src/components/Reader.jsx:400` calls
  `onOpenDocument(targetId)` although `openDocument(id, target)` accepts a target,
  `src/App.jsx:1574`).
- **Proposal.**
  1. Build step (`scripts/generate_content_index.mjs`): for each glossary term
     (reuse #117's `forms`) and each chapter's key terms, record where it occurs
     outside code and math as `{documentId, headingAnchor, snippet}`.
  2. Reader: a closed `<details>` **"Mentioned in"** after the article (outside
     `<article>`, like #118's preview, so narration, find and annotation offsets are
     unchanged), grouped by Part, each row opening at the section. Add the same list
     to #117's popover.
  3. Own notes and edited copies: index outgoing `.md` links (reuse the link audit's
     parser) to show **"Linked from"**.
  4. Pass the `#heading` fragment through to `openDocument` (S).
- **Why.** Meeting an idea again in a new context is elaboration and
  self-explanation fuel (D13 rates both moderate; B18). Obsidian's linked and
  unlinked mentions (`ev_3c80342b…`, step `backlinks-settle`) and Logseq's linked
  and unlinked references (`ev_217e5c17…`) answer exactly "where else does this
  come up?"
- **Effort/impact.** M (heading fix S). High.

#### G3. Topic boards with live source cards

- **Today.** One board per document (`board:${documentId}`,
  `src/components/Whiteboard.jsx:658`, `src/App.jsx:3290`), holding drawing
  primitives only.
- **Proposal.** "New topic board" (stored as its own board key, listed in the
  Notebook) plus a **source card** object `{ref: {documentId, anchor | annotationId
  | reviewItemId | customNoteId}, title, excerpt}`. Cards are added with "Add to
  board…" from a highlight, clipping, card or outline heading; tapping one opens the
  Reader at the anchor. A card can sit on several boards, and the Reader outline
  shows "On boards: …" per section. Give concept cards a one-sentence-title prompt
  (Heptabase). Reuse the three-way board merge and backup normaliser for the new
  key type.
- **Why.** Heptabase's library-and-boards model and five-step method
  (`ev_47e4ce5a…`), Obsidian Canvas note cards narrowed to a heading or block
  (`ev_3c80342b…`), Logseq whiteboard portals (`ev_217e5c17…`). Constructing maps
  is the strong form (S18, g = .72), and organising is generative (FM16).
- **Effort/impact.** L. High.

#### G4. Attached, labelled connectors and frames

- **Today.** Arrows are free lines (`shapeTools`, `src/components/Whiteboard.jsx:86`);
  arrows carry no label; there are no frames.
- **Proposal.** Arrows get optional `from`/`to` `{objectId, side}` that follow
  move, resize and rotate; double-tap an arrow to label it, with quick relation chips
  ("requires", "causes", "is a", "trades off with", "contrasts with"); a **frame**
  is a named region whose members move with it. On phones, a **Connect** mode: tap
  the source, then the target, with no precise drag.
- **Why.** A concept map's value lies in named relations (S18); Excalidraw binds
  arrows and frames in its element model (`packages/element/src/types.ts`,
  `frame.ts`); Obsidian Canvas edges attach to a card side and carry labels and
  direction; Heptabase sections name groups. G1 step 3, G5 and G14 depend on this.
- **Effort/impact.** M. High.

#### G5. Open a diagram on the board

- **Proposal.** A diagram's menu gains **Open on board**: flowchart nodes become
  rectangles, diamonds and text, edges become bound, labelled arrows (needs G4);
  other diagram types are not offered (or insert as an image after G13). Use the
  Mermaid parser Lumen already lazy-loads; **dependency candidate:**
  `@excalidraw/mermaid-to-excalidraw` 2.2.2 (MIT) for its parse-to-skeleton logic,
  or an in-house converter for flowcharts only (75 of 79 diagrams).
- **Why.** Reorganising and annotating an expert diagram is generative (FM16,
  VMG05), and labels sit on the diagram (G06). Observed flow: `ev_d330fb7a…`.
- **Effort/impact.** M after G4. Medium-high.

#### G6. Scoped review and interleaving

- **Today.** `buildReviewQueue` takes due cards by due date, then new cards by
  creation date (`src/lib/review.js:206-231`); extra practice is weakest-first over
  every card; the deck browser's text filter is for browsing only
  (`src/components/ReviewCenter.jsx:611-615`). Readiness checks are per Part, but
  scheduled review is always global.
- **Proposal.** A **Review…** chooser on the Review hero: Today (default), This Part,
  This lecture, Tag, Collection, or a saved filter written in the search syntax Lumen
  already has (`part:8 tag:attention`). A **Mix related topics** toggle reorders the
  scoped queue so cards from different Parts or tags alternate. **Practice this set**
  works when nothing is due (scoped extra practice). Daily limits and analytics stay
  as they are.
- **Why.** Logseq card sets are saved queries, with a switcher and "Practice again"
  (`fsrs.cljs`, e2e `flashcards_basic_test.clj`, docs `{{cards [[Logseq]]}}`,
  `ev_f53db6ea…`); the SR plugin builds decks from tags (`ev_c3d7ced5…`).
  Interleaving helps most for similar, confusable categories (BR19, g = 0.42; D13
  moderate), which is exactly what a mixed Part 5/7/18 optimisation set provides.
- **Effort/impact.** S–M. High.

#### G7. One-tap cloze and per-blank cards

- **Today.** Cloze cards use `{{…}}` and reveal every blank at once on one card
  (`src/lib/review.js:441-450`); highlight → card exists with the quote as the back.
- **Proposal.** The Reader's selection toolbar (Clip selection, Highlight selection,
  Ask AI at `src/components/Reader.jsx:1128-1130`) gains
  **Blank this**: it creates a cloze card from the surrounding sentence with the
  selection blanked, anchored like a highlight. In the card editor, optional
  `{{c1::…}}` / `{{c2::…}}` numbering makes one review item per number, with
  siblings buried for the day after one is seen. This matches #128's Anki mapping.
- **Why.** Generation effect (SG78) and retrieval (RK06); spacing between siblings
  (C06). Logseq turns any block into a card with `{{cloze}} #card` instantly
  (`ev_bfd8c47e…`); the SR plugin makes one card per deletion and buries siblings
  (`ev_c3d7ced5…`).
- **Effort/impact.** S for "Blank this", M for numbered siblings. High.

#### G8. Study note from my highlights

- **Today.** Highlights export only as a downloaded Markdown file (`exportAnnotations`,
  `src/App.jsx`); nothing turns them into an editable note in the app.
- **Proposal.** **Make study note from highlights** (lecture actions and Notebook)
  creates a custom note "Notes on ⟨lecture⟩": headings follow the lecture's H2s;
  each highlight is a blockquote with the learner's comment and a link back (#116's
  annotation target); each section gets an empty "In my own words:" line, and the
  top gets "One-sentence summary:". Running it again appends only new highlights.
- **Why.** Highlighting alone is low utility (D13); turning quotes into summaries
  and self-explanations is the generative step (FM16, B18). Zotero's "Add Note from
  Annotations" with "Show on Page" (`ev_2d6202fc…`) and Heptabase's step 1 → 2
  (`ev_47e4ce5a…`) are this flow.
- **Effort/impact.** S–M. High.

#### G9. JSON Canvas interchange

- **Proposal.** Export a board page as `.canvas` (text and sticky → text nodes;
  source cards → file nodes with `subpath` = `#heading`; frames → groups; arrows →
  edges with label, sides and colour preset) and import the same subset. Include
  boards in #128's Obsidian zip.
- **Why.** An open, MIT-licensed format (`ev_c3d7ced5…`, step `jsoncanvas-settle`)
  keeps visual work portable, in line with Lumen's local-first promise.
- **Effort/impact.** S–M. Medium.

#### G10. Concept note template and "My concepts"

- **Proposal.** New note → **Concept**. The title prompt is "State the idea in one
  sentence." Fields: *Explain it without jargon*; *The formula, and what each symbol
  means*; *When I would choose it*; *How it fails*; *A production constraint*;
  *Prerequisites* (pick lectures or other concepts); *Sources*. Any filled field
  becomes a card in one tap. The Notebook gets a **My concepts** table (title, Part,
  fields done out of five, linked cards due).
- **Why.** These are the README's five mastery checks; Tana's supertags show the
  pattern of a typed template with an automatic table (`ev_126281c5…`); Heptabase's
  one-sentence titles (`ev_47e4ce5a…`). Field prompts drive self-explanation and
  elaborative interrogation (B18, C94, D13).
- **Effort/impact.** M. Medium-high.

#### G11. Reading queue for imported sources

- **Proposal.** On an imported book or long note, **Add to reading queue** with a
  priority (High, Normal, Low). Home's plan then offers one slice a day from the
  queue, resuming at the saved position; the interval grows with what remains and
  shrinks with priority. A "To process" count lists highlights not yet turned into
  a card or note (feeding #116, G7 and G8).
- **Why.** Incremental reading's extract → cloze → spaced review pipeline
  (supermemo.guru), the MIT Incremental Reading Toolkit's priorities and
  progress-aware intervals, and the SR plugin's note review; spacing applies to
  reading (C06).
- **Effort/impact.** M. Medium (high for learners who import books).

#### G12. Local connections view

- **Proposal.** A **Connections** tab in the Reader outline: a small node-link view
  (radius 1–2) of #111's prerequisites and next steps, G2's mentions, and the
  learner's boards and concept notes that cite the lecture, with a plain list for
  VoiceOver. No global force graph.
- **Why.** Obsidian's local graph with a depth slider (`ev_3c80342b…`, step `graph`).
  Studying a given map helps only modestly (S18, g = .43), so this is navigation;
  the learning value lives in G1, G3 and G4.
- **Effort/impact.** M. Medium.

#### G13–G16 (smaller items)

- **G13 Images and links on board objects.** Insert an image from Photos or the
  camera (downscaled, stored in IndexedDB, counted in Storage health) and **Link**
  any object to a lecture anchor or URL. Dual coding (CP91); Excalidraw Insert image
  and Cmd K links. M, medium.
- **G14 Add connected box.** A selected box shows four "+" handles; tapping one adds
  a connected box with a bound arrow ready to label (Excalidraw's Cmd+Arrow flowchart
  builder, Help in `ev_d330fb7a…`). S–M after G4, medium.
- **G15 Find on board.** Search board text and zoom to the match (Excalidraw Cmd F,
  Heptabase whiteboard search). S, low.
- **G16 Highlight interop.** Export highlights with W3C `TextQuoteSelector`
  (`exact`, `prefix`, `suffix`), which Lumen's anchors already contain
  (`src/lib/annotations.js:107-108`) and Zotero's reader uses. S, low.

### Not recommended

- A global force-directed graph as a headline feature: hard to read at 393 px, and
  the weakest "study a given map" form (S18).
- Arbitrary block ids or transclusion inside built-in lectures: inserted markup
  shifts annotation offsets (see #117's analysis), and Obsidian itself notes block
  ids do not work outside the app. Use heading anchors and highlight ids.
- tldraw as a dependency (current releases need a production licence key), or the
  full Excalidraw package on the startup path.
- Hosted-AI features (Heptabase AI chat and actions, Excalidraw's AI generators,
  Tana's AI) and third-party web embeds on boards: they break Lumen's no-paid-AI,
  offline and privacy model.

---

## Top 10 findings and a suggested order

Ranked by impact for this learner, weighed against effort and fit. All ten are
`new` (no open issue covers them); where an issue is adjacent it is named.

| # | Finding → proposal | Platforms and evidence | Status | Effort / impact |
|---:|---|---|---|---|
| 1 | Review cannot be scoped or mixed: add Part / lecture / tag / collection / saved-filter sessions and a "mix related topics" interleave (G6) | Logseq query card sets (`fsrs.cljs`, e2e test, `ev_f53db6ea…`); SR plugin tag decks (`ev_c3d7ced5…`); BR19, D13 | new | S–M / High |
| 2 | Highlights stop at the highlight: one action should turn a lecture's highlights into an editable study note with back-links and own-words prompts (G8) | Zotero "Add Note from Annotations" + "Show on Page" (`ev_2d6202fc…`); Heptabase step 1→2 (`ev_47e4ce5a…`); D13, FM16, B18 | new (adjacent #116) | S–M / High |
| 3 | Making a card is slower than reading: "Blank this" from a selection, plus numbered blanks as sibling cards (G7) | Logseq `{{cloze}} #card` flow (`ev_bfd8c47e…`); SR plugin per-deletion clozes and sibling burying (`ev_c3d7ced5…`); SG78, RK06, C06 | new (cloze exists; adjacent #128) | S + M / High |
| 4 | The curriculum's concepts recur across Parts with almost no links (1 chapter-to-chapter link in 116 chapters): add "Mentioned in", backlinks for own notes, and make `#heading` links land (G2) | Obsidian linked/unlinked mentions (`ev_3c80342b…`); Logseq references (`ev_217e5c17…`); D13, B18 | new (PRD GRAPH-001 backlog; adjacent #117) | M / High |
| 5 | 79 Mermaid diagrams are read-only pictures: add a label-hiding recall mode and diagram cards, later "rebuild on board" (G1) | Excalidraw shows diagrams decompose into objects (`ev_d330fb7a…`); BK14, KB11, OK21, CP91 | new (PRD LEARN-002 backlog: Mermaid card rendering) | M / High |
| 6 | Board arrows don't attach or carry labels, so boards can't be concept maps: bound, labelled connectors and named frames, with tap-to-connect on phones (G4) | Excalidraw bindings and frames (source); Obsidian Canvas edges and groups (`ev_3c80342b…`); Heptabase sections; S18 | new (PRD BOARD-002 backlog) | M / High |
| 7 | Boards are locked to one lecture: topic boards holding live source cards for sections, highlights and cards, reusable across boards (G3) | Heptabase library-and-boards and five-step method (`ev_47e4ce5a…`); Obsidian Canvas note cards; Logseq portals; S18, FM16 | new (PRD BOARD-002 backlog) | L / High |
| 8 | Expert diagrams can't be remixed: "Open diagram on board" converting Mermaid flowcharts to editable objects (G5) | Excalidraw Mermaid flow (`ev_d330fb7a…`); MIT dependency candidate `@excalidraw/mermaid-to-excalidraw` 2.2.2; FM16, VMG05, G06 | new | M / Medium-high |
| 9 | Own notes have no shape: a concept note template built from the README's five mastery checks, with one-tap cards and a "My concepts" table (G10) | Tana supertags and fields (`ev_126281c5…`); Heptabase one-sentence titles; B18, C94 | new (adjacent PRD LEARN-004) | M / Medium-high |
| 10 | Imported books have no reading rhythm: a prioritised reading queue for imports, feeding highlights into processing (G11); and JSON Canvas export/import so boards stay portable (G9) | Incremental Reading Toolkit (MIT plugin), supermemo.guru, SR plugin note review; JSON Canvas spec (`ev_c3d7ced5…`); C06 | new (G9 complements #128) | M and S–M / Medium |

**Suggested order.** Quick wins first: G2's heading-link fix, G6, G7 "Blank this",
G8. Then the board foundation G4, which unlocks G5, G14 and G1's rebuild step;
then G1's reader recall and diagram cards; then G3 topic boards with G9
interchange; G10 and G11 can run in parallel with the board track. G12 waits for
#111's prerequisite data.

**Already covered (do not re-propose):** #116 revisit highlights and open in
context, #117 glossary popovers, #115 step reveal, #114 answer before reveal,
#113 starter cards with anchors, #111 prerequisites, #121 teach-back,
#118/#119 bookends and exercises, #120 study log, #102 highlight from narration,
#128 Anki and Obsidian export. Interval previews, card source links, rich
highlights, collections and saved searches, Mermaid mind maps, teaching-mode
recall and Ask AI on a selection already ship.

---

## Evidence index

REA scenario captures (files captured locally, not committed; prefix = label; each `<label>.json` is the full REA result):

| Label | Evidence id | What it covers |
|---|---|---|
| `obsidian` | `ev_3c80342b1c459830215fece0f0949309fbe6006f39b9bb17459febf4ed1676fb` | obsidian.md/help: plugins/graph, plugins/canvas, plugins/backlinks, links, embeds, bases, properties |
| `srplugin` | `ev_c3d7ced5e7b5bb188831d4f4f816cf14acc26da3c65470633d56b2c14966a96c` | SR plugin: flashcards overview, Q&A cards, cloze cards, decks, reviewing, notes, algorithms; jsoncanvas.org/spec/1.0 |
| `logseqdocs` | `ev_f53db6eac5bfdb72b206f1ec50c8d7f9540e8bbfdd8ace51ce34bcd0ffa3226c` | docs.logseq.com: contents, flashcards, all pages |
| (inline result) | `ev_217e5c171aebf592baeafe915a48890ffa8a6c527c7c68c039727705e6a39698` | docs.logseq.com: whiteboards, embed, clozes (block references and journals pages do not exist under those names) |
| `logseqdemo` | `ev_b01ca50129bb4a238bdfd6bb1de36216eed68c1e822b9349256ba06bcc6b9050` | demo.logseq.com landing (OG file version, today's journal) |
| (failed runs) | `ev_8a6206cff28023d70b2a8290043861758a859a3b09d24f5f3d9a09af4b1a19b7`, `ev_42e05096b6ca176a7f72f80f636830d464bd9b09ad78324603b29f97ed8ba84f` | demo flow attempts: textarea locator ambiguity, then Flashcards link hidden in the collapsed sidebar |
| `logseqcard` | `ev_bfd8c47ece6057db8dbf1756ce80d2bc3ffa5cc214237b1dde3fd3ec265125b2` | demo flow: write a cloze `#card`, open Flashcards, reveal; ratings and deck picker |
| `heptabase` | `ev_ef8649e056bb3f5a84840164aece5d6215e9e8f53066c376a3af71cf8fe2e2d8` | heptabase.com/learning (404), wiki home, getting started, section and mindmap (not found), use case and workflow |
| `heptabase2` | `ev_47e4ce5ac8e171b77cc3ca1d13392f47bbf220fa7a69c536bdf912fd1c858629` | wiki: learn and research a topic, PDF annotation, fundamental elements, knowledge lifecycle |
| `excalidraw0` | `ev_9d5434325e875e660177df617b7ae334d29076ab50705a1059326cd46b67962e` | excalidraw.com landing, control inventory |
| `excalidraw1` | `ev_429725178a01ec3eb86d9909ec9ecda0ada6df1917546a4f5d9d3b455877e856` | More tools menu, Library panel (Help click timed out) |
| `excalidraw2` | `ev_d330fb7ab2af05e4ce6d32915572bebc38672e8778d17d0bc72c7824141fb9d4` | Mermaid to Excalidraw dialog and insert; Help dialog via `?` |
| `excalidraw-phone` | `ev_baa13c1284fa8eefa50363a8228d6cda6339e2831d287cfc89adbec147883c3b` | 393×852 phone layout |
| `zotero` | `ev_2d6202fcad8d9b197fb2c1801ebe96823973a230634c226789c30678f5d37cc0` | zotero.org/support: pdf_reader, notes, related, collections_and_tags, ios, searching |
| `tana` | `ev_126281c5a5b1126774bf91474b4a8f232f1ccb3d7e503795a461cbbd0bae97b5` | Tana docs: supertags, fields (redirected to outliner.tana.inc/learn) |

Source read from shallow sparse clones (captured locally, not committed; design reading only; no code copied):

- `logseq/` — `logseq/logseq` at `05c3ae73` (AGPL-3.0): `src/main/frontend/extensions/fsrs.cljs`,
  `src/main/frontend/worker/handler/flashcard.cljs`, `src/main/frontend/extensions/srs/handler.cljs`,
  `deps/common/src/logseq/common/util/block_ref.cljs`, `clj-e2e/test/logseq/e2e/flashcards_basic_test.clj`,
  `.agents/skills/logseq-review-workflow/rules/modules/whiteboard.md`, `sidecar/embedding_server.py`.
- `excalidraw/` — `excalidraw/excalidraw` at `1d4dc2c0` (MIT): `packages/element/src/types.ts`,
  `binding.ts`, `frame.ts`, `embeddable.ts`; `packages/excalidraw/data/types.ts`, `data/library.ts`,
  `mermaid.ts`, `package.json`.
- `zotero-reader/` — `zotero/reader` at `4bfd82ee` (AGPL-3.0): `src/common/types.ts`,
  `src/dom/common/lib/selector.ts`, `src/common/components/utility-popup/read-aloud-annotation-popup.js`.

Other sources: WebFetch of `github.com/logseq/og`, `github.com/kja140/incremental-reading`,
`github.com/burtonator/polar-bookshelf` (404), `getpolarized.io` (redirect to an unrelated
site, not followed), `supermemo.guru/wiki/Incremental_reading`; npm registry metadata for
`@excalidraw/excalidraw@0.18.0` and `@excalidraw/mermaid-to-excalidraw@2.2.2`; WebSearch
to verify every learning-science citation and tldraw's licence (tldraw.dev "License key"
and v4.0 release notes).

Lumen facts were checked with `grep`/`sed` over `src/`, `docs/` and `notes/` at `01c7a89`,
and open issues with `git gh issue list --state open --limit 100` and `git gh issue view`.

### Page loads per site (budget ≤ 15)

obsidian.md 10 (robots ×2, sitemap, 7 pages) · stephenmwangi.com 10 (robots, 2 sitemaps,
7 pages) · jsoncanvas.org 2 · docs.logseq.com 9 (robots plus 8 navigations, mostly hash
routes in one SPA) · demo.logseq.com 5 · logseq.com 1 · heptabase.com 2 ·
wiki.heptabase.com 10 · excalidraw.com 6 · www.zotero.org 7 · tana.inc 3 (plus the robots file of its redirect host outliner.tana.inc, which allows all) · github.com 3
web fetches plus 3 shallow git clones · registry.npmjs.org 2 · supermemo.guru 1 ·
getpolarized.io 1 · help.remnote.com and docs.excalidraw.com 1 each (robots only).
No logins, sign-ups, paywalls or challenge pages were used; `help.supermemo.org` serves a
Cloudflare challenge and was not accessed.

### Untrusted content and prompt-injection check

All page text, accessibility trees, screenshots and source files were treated as data.
No page or file asked me to run, install, download or send anything, and no instruction
in page content was followed. The only agent-addressed text seen was in robots files:
Tana's robots.txt says the site "welcomes AI agents and crawlers" and points to an
`llms.txt` index (not fetched), and the Logseq demo's robots.txt carries Cloudflare
content-signal comments. Both are crawler policy, not instructions, and neither changed
what I did.
