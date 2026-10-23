# Speakable ML Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listen reads an ML lecture the way a teacher would: one utterance per source sentence, headings and rows ending as sentences, formulas verbalised, code and diagrams announced, tables read row by row, and a built-in pronunciation pack the learner can override, skip and try out.

**Architecture:** Two layers with one contract between them. The DOM layer (`src/lib/speechContent.js` and `src/lib/mathSpeech.js`, Reader chunk) turns each readable block into speech units `{text, unit: {blockIndex, start, end}, map, section}`: MathML is walked, tables become row sentences, code and diagrams become announcements, and `<sub>`/`<sup>`/inline code are marked with private-use characters. The text layer (`src/lib/speakable.js`, `src/lib/spokenMap.js` and `src/lib/speech.js`, entry) applies one pass to every utterance (pronunciations, then Unicode math), chunks each unit on its own, composes the spoken↔source offset maps, and hands `useSpeech` a queue of `{text, unit, map, section}` entries that #101, #103 and #122 consume.

**Tech Stack:** React 19, Vite 8 (rolldown; JSON imported `with { type: "json" }`, verified on this tree), Web Speech API, Node 26 `node:test`, Puppeteer browser audits.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/100 (issue body; no comments). Prerequisites merged: #96 (positions, section rule, `.diagram-shell` exclusion), #97 (player, tokens), #95 (warm tier), #150 (`src/lib/links.js`). Measured on main 986b759 (2026-10-23): budgets startup entry 623,709 B and install route screens 692,990 B; the corpus has MathML in 9 Part-1 files (250 elements: 95 display, 155 inline; Pandoc output with one `mi` per letter, `mtext` words, `mover` accents and `<mi>.</mi>` sentence periods) and Unicode math in 47 files (− 346, ᵀ 135, ² 133, × 123, Σ 109, ∣ 96, θ 95, ‖ 95, → 113 prose lines, mostly flow arrows), plus 590 `<sub>` and 34 `<sup>` elements in prose formulas.

## Global Constraints

- Accessibility: axe WCAG 2.2 AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, best-practice) with an empty allowlist in `scripts/a11y_audit.mjs`; theme tokens only (Paper, Night, Contrast, System), and `src/lib/themeContrast.test.mjs` fails on any undefined `var()`; 44 px touch targets and ≥ 16 px form text on phones (`@media (max-width: 740px), (pointer: coarse)`); check 320 px, 393×852, 200% text and phone landscape.
- Budgets (`npm run check` → `audit:app`): startup entry < 750,000 B; install route screens < 900,000 B. Placement is fixed by the spec: the verbalizer and the pack go in the entry (`speech.js` and the modules it imports); the DOM walkers go in the Reader chunk (`speechContent.js`, `mathSpeech.js`, imported only by `Reader.jsx` and `TeachingMode.jsx`). Never import `speechContent.js` or `mathSpeech.js` from `App.jsx`, `db.js`, `Settings.jsx` or any entry module. Record the `audit:app` headroom lines in the task report.
- Local-first and private: no network calls, no cloud or paid AI, no tracking; speech is the browser's own engine.
- Persisted data: the new profile settings `narrationCode` and `narrationTables` need the `db.js` normalizer, the backup round-trip fixture (`src/lib/backup.test.mjs`), a settings-merge case in `src/lib/profileSync.test.mjs`, and `scripts/cross_tab_audit.mjs` (they are edited in Settings), all in the same task.
- Gate: Node 26 (`.nvmrc`); `npm run check`, and every browser run through `/Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser [-- <suite>]` (set `LUMEN_BROWSER_RETRIES=0` when proving a failure or diagnosing). Never run a browser suite without the slot lock.
- Every new check must fail against the pre-change code for the reason its step names; quote the failing output in the task report. Never weaken an existing assertion; the assertions this plan changes on purpose are listed in their tasks and must be named in the commit body.
- Phrases are English for every voice. Exact strings fixed by the spec (copy them verbatim):
  - table header, once per table: `Table, 3 columns: Situation, First inspect, Safe action.`; a data row: `Row 1. Situation: …; First inspect: ….`; a row longer than 180 characters splits at cell boundaries;
  - code: `Python example, 6 lines.` (language from the `pre`'s `aria-label`, `markdown.js:24`); any block with box-drawing characters (U+2500–U+257F): `Text diagram, N lines.`;
  - diagrams: `Diagram: ` followed by `diagramDescriptionFor(node)`; `→` is spoken `leads to`;
  - MathML: `Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N`;
  - Teaching slide `ŷ = wᵀx + b` → `y hat equals w transpose x plus b`;
  - Unicode table: ᵀ `transpose`, ⁻¹ `inverse`, ² `squared`, ³ `cubed`, ŷ `y hat`, ŵ `w hat`, x̄ `x bar`, Σ/∑ `sum of`, ∇ `gradient of`, √ `square root of`, ∈ `in`, ≈ `approximately`, ≤ `less than or equal to`, ≥ `greater than or equal to`, ≠ `not equal to`, − `minus`, ∣ `given`, ‖x‖₂ `the L2 norm of x`, ℝᵐˣⁿ `R m by n`, 𝔼 `expected value of`, Greek letters by name, subscripts `x 1`, `x i`; ASCII `=` `equals`, `+` `plus`, `/` `over` only inside a formula run that holds a table symbol.
- Limits: `SPEECH_CHUNK_LIMIT` 180 characters (unchanged); no piece of a split sentence shorter than 3 words; overrides capped at 50 terms, term ≤ 60 and spoken ≤ 120 characters; the pack is `src/data/pronunciations.ml.v1.json`, about 120 entries.
- Settings: the card is titled `Narration`; `Code blocks`: `Announce` (default) / `Skip` / `Read aloud`, saved as `narrationCode`: `"announce"` / `"skip"` / `"read"`; `Tables`: `Read rows` (default) / `Announce only`, saved as `narrationTables`: `"rows"` / `"announce"`; `term =` means skip; a `Try it` field with a `Speak` button runs the exact text pipeline; the built-in pack is listed read-only in a `<details>`; the overrides toast appears only when the normalized list changes, keeping the wording `N pronunciation override(s) saved.`.
- Out of scope (later issues; keep their contracts): sentence and word highlighting, follow scrolling and Read from here (#101: consumes `queueUnits`, `readableBlocks`, `speechBlockText`, `collapseWithOffsets`, `sourceOffsetAt`); Teaching progress, sentence skip and auto-advance (#103); listen and recall (#122); speed range, voice ranking and the Now-playing sheet (#102); further skip rules (#162). No "Add pronunciation" selection action.
- Commits: concise imperative subject, short why-body, no trailers. Push the branch after every task (`git -C <worktree> push`). GitHub CLI only as `git -C <worktree> gh …`.

## Review Focus

1. **A lecture edited after a position was saved.** One inserted paragraph shifts every later `blockIndex`, so `{blockIndex, start}` can point at a different sentence. Resume must take the coordinates only when the stored snippet (or an equal queue length) confirms them, and otherwise fall back to the snippet and section rules. Pinned in Task 5 (`narrationPositions.test.mjs`, "shifted blocks").
2. **Inline code and URLs beside math.** `` `a/b` ``, `` `x = θ` `` and `https://x.org/a/b → b` must keep their slashes and equals signs (no "over", no "equals"), while pronunciations still apply inside code (`np.linalg.lstsq` → `np.linalg.least squares`). Pinned in Task 1 (text pass) and Task 3 (inline `code` marked plain).
3. **Irregular tables.** No header row, an empty header label, an empty cell, or a row with more cells than the header: no `undefined:` label, no `: ;` pair, correct column and row counts. Pinned in Task 3.
4. **Learner terms that overlap the pack or hold regex characters.** `C++ = C plus plus`, `relu = rectifier` against the pack's `ReLU`, and `QLoRA` beside `LoRA`: escaped, learner first, longest first, whole words only. Pinned in Task 1.
5. **Try it while a lecture is open.** Speaking in Settings over the Reader replaces the lecture's queue but must not write the lecture's resume position, must not toast "Open the lecture to listen again", and must stop cleanly with Stop. Pinned in Task 6 (browser case "Try it over the Reader").

---

## File Structure

- Create `src/lib/spokenMap.js` (entry): offset-map pieces and helpers. No imports.
- Create `src/lib/speakable.js` (entry): the text pass (pronunciations, Unicode math, markers). Imports `spokenMap.js` and the pack JSON.
- Create `src/data/pronunciations.ml.v1.json` (entry, via `speakable.js`).
- Modify `src/lib/speech.js` (entry): re-exports the text pass; `endSentence`, `TERMINAL_PUNCTUATION`; overrides parsing; chunking; `buildSpeechQueue`.
- Modify `src/lib/tutorMarkdown.js`: import `endSentence`/`TERMINAL_PUNCTUATION` from `speech.js`.
- Modify `src/hooks/useSpeech.js`: queue entries, `queueUnits`, per-call `pronunciations`.
- Create `src/lib/mathSpeech.js` (Reader chunk): the MathML walker against a minimal node interface.
- Modify `src/lib/speechContent.js` (Reader chunk): blocks, units, verbalizers, targets.
- Modify `src/lib/mermaidDiagrams.js`: `diagramDescriptionFor(node)`.
- Modify `src/lib/narrationPositions.js`, `src/lib/audioBookmarks.js`: entry objects; `{blockIndex, start}`.
- Modify `src/components/Reader.jsx`, `src/components/TeachingMode.jsx`: units, positions, block follow.
- Modify `src/lib/db.js`: settings defaults and normalizer.
- Modify `src/components/Settings.jsx`, `src/App.jsx`, `src/styles.css`: the Narration card.
- Modify `src/components/DeviceEvidence.jsx`: one human check.
- Tests: `src/lib/speech.test.mjs`, create `src/lib/speechContent.test.mjs`, `src/lib/mermaidDiagrams.test.mjs`, `src/lib/narrationPositions.test.mjs`, `src/lib/audioBookmarks.test.mjs`, `src/lib/backup.test.mjs`, `src/lib/profileSync.test.mjs`, `scripts/unit_audit.mjs`, `scripts/audio_audit.mjs`, `scripts/a11y_audit.mjs`, `scripts/cross_tab_audit.mjs`.

## Shared definitions (every task uses these names)

```js
// src/lib/spokenMap.js
/** One piece of an offset map: spoken [start, end) ↔ source [start, end). */
// MapPiece = { spoken: [number, number], source: [number, number] }
// A map is MapPiece[] sorted by spoken start, contiguous over the spoken text
// (piece[i].spoken[1] === piece[i + 1].spoken[0], first at 0, last at
// text.length), with non-decreasing, non-overlapping source ranges. A piece
// whose spoken and source lengths are equal is an identity piece (1:1
// characters); any other piece maps its whole spoken span to its whole
// source span. Removed source text (collapsed whitespace, a skipped term,
// .katex-html) is a gap between pieces. Inserted text ("Row 1. ") is a piece
// with an empty source range at its position.

// src/lib/speakable.js
export const SPEECH_MARK = Object.freeze({
  subOpen: "\uE000", subClose: "\uE001",     // <sub>…</sub>
  supOpen: "\uE002", supClose: "\uE003",     // <sup>…</sup>
  plainOpen: "\uE004", plainClose: "\uE005", // inline code: pronunciations only, no math
});

// Speech unit (DOM layer → text layer), before the text pass:
// { text, unit: { blockIndex, start, end }, map, section, sectionStart?, kind? }
//   text: the unit's pre-pass text (MathML already verbalised, markers kept)
//   unit.start/end: offsets in speechBlockText(block) (= cleanText(block.textContent))
//   map: MapPiece[] from `text` to those block offsets
//   kind: "text" (default) | "announcement" (start === end === 0, map []) |
//         "code" (a line read aloud: pronunciations only) | "row" (splits at "; " first)
// Queue entry (useSpeech.queueUnits[i]), after the text pass:
// { text, unit: { blockIndex, start, end } | null, map, section }
//   text: exactly what is spoken; map: MapPiece[] from entry.text to block offsets
//   unit is null and map [] on the text path (Selection, tutor, preview, Try it)
```

**The fixture lecture** (the spec's "heading, '6.' heading, table, Python code, ASCII art, `<br>` lines, Unicode math, one MathML block, one Mermaid block, a 250-character sentence"). Task 3 mirrors it as a stub DOM and Task 5 seeds it as a custom document; both assert the same utterances.

````js
const FIXTURE_MARKDOWN = `# Speakable fixture

## 6. Task taxonomy

Classification predicts a label.

| Situation | First inspect | Safe action |
|---|---|---|
| Disk full | df -h | Free space |
| High latency | p99 graphs | Roll back |

\`\`\`python
import numpy as np
X = np.ones((3, 2))
y = np.zeros(3)
w = np.linalg.lstsq(X, y, rcond=None)[0]
print(w)
print(w.shape)
\`\`\`

\`\`\`
name a ─┐
        ├──> list object
name b ─┘
\`\`\`

First line<br>Second line

The model predicts ŷ = wᵀx + b for each input.

<math display="block" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mtext mathvariant="normal">Accuracy</mtext><mo>=</mo><mfrac><mrow><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi></mrow><mrow><mi>T</mi><mi>P</mi><mo>+</mo><mi>T</mi><mi>N</mi><mo>+</mo><mi>F</mi><mi>P</mi><mo>+</mo><mi>F</mi><mi>N</mi></mrow></mfrac><mo>,</mo></mrow></semantics></math>

\`\`\`mermaid
flowchart LR
  A[Data] --> B[Model]
  B --> C[Prediction]
\`\`\`

Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight, and moving each weight a smaller step against its gradient until the loss stops improving.
`;

// Spoken with the defaults (code "announce", tables "rows"):
const FIXTURE_SPOKEN = [
  "Speakable fixture.",
  "6. Task taxonomy.",
  "Classification predicts a label.",
  "Table, 3 columns: Situation, First inspect, Safe action.",
  "Row 1. Situation: Disk full; First inspect: df -h; Safe action: Free space.",
  "Row 2. Situation: High latency; First inspect: P ninety-nine graphs; Safe action: Roll back.",
  "Python example, 6 lines.",
  "Text diagram, 3 lines.",
  "First line.",
  "Second line.",
  "The model predicts y hat equals w transpose x plus b for each input.",
  "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N.",
  "Diagram: Flowchart: Data leads to Model leads to Prediction.",
  "Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight,",
  "and moving each weight a smaller step against its gradient until the loss stops improving.",
];
// The other settings derive from it:
const CODE_LINES = ["import num pie as np", "X = np.ones((3, 2))", "y = np.zeros(3)", "w = np.linalg.least squares(X, y, rcond=None)[0]", "print(w)", "print(w.shape)"];
const fixtureSpoken = ({ code = "announce", tables = "rows" } = {}) => FIXTURE_SPOKEN
  .flatMap((line) => (line === "Python example, 6 lines." ? (code === "skip" ? [] : code === "read" ? [line, ...CODE_LINES] : [line]) : [line]))
  .flatMap((line) => (tables === "announce" ? (line.startsWith("Row ") ? [] : line.startsWith("Table,") ? ["Table, 3 columns, 2 rows: Situation, First inspect, Safe action."] : [line]) : [line]));
````

---

### Task 1: The text pass (`speakable`), the pack and the overrides rules

**Files:**
- Create: `src/lib/spokenMap.js`, `src/lib/speakable.js`, `src/data/pronunciations.ml.v1.json`
- Modify: `src/lib/speech.js` (exports below; `normalizePronunciations` allows an empty spoken form; delete `applyPronunciations`, whose only caller `useSpeech.js` moves to `buildSpeechQueue` in Task 2 — until then keep a one-line `applyPronunciations = (text, list) => speakable(text, { pronunciations: list })` shim so the app still builds, and delete it in Task 2)
- Modify: `src/lib/tutorMarkdown.js:286-291` (import `endSentence`, `TERMINAL_PUNCTUATION` from `./speech.js`; delete the local copies)
- Test: `src/lib/speech.test.mjs`

**Interfaces:**
- Produces (`src/lib/spokenMap.js`):
  - `createSpokenBuilder() → { append(text: string, sourceStart: number, sourceEnd: number): void, build(): { text: string, map: MapPiece[] } }` — collapses every whitespace run to one space, drops a leading space and trims at `build()`. An identity append (`sourceEnd - sourceStart === text.length`) emits identity pieces per non-space run, a kept single space maps to the first whitespace character of its run, and the other whitespace characters become source gaps.
  - `composeMaps(outer: MapPiece[], inner: MapPiece[]) → MapPiece[]` — `outer` maps spoken → middle, `inner` maps middle → source.
  - `sliceMap(map: MapPiece[], start: number, end: number) → MapPiece[]` — the pieces over spoken `[start, end)`, re-based to 0; an identity piece is cut exactly, any other piece keeps its whole source range.
  - `sourceOffsetAt(map: MapPiece[], spokenOffset: number) → number` — exact inside an identity piece; a non-identity piece's source start (its source end when `spokenOffset` is that piece's spoken end); `0` for an empty map.
  - `collapseWithOffsets(raw: string) → { text: string, offsets: number[] }` — `text` is `raw.replace(/\s+/gu, " ").trim()`; `offsets[i]` is the clean index of raw character `i` (a dropped character gets the clean index of the next kept one), `offsets[raw.length] === text.length`.
- Produces (`src/lib/speakable.js`, all re-exported by `speech.js`): `SPEECH_MARK`; `PRONUNCIATION_PACK` (the pack's entries, normalized, as `{ term, spoken, matchCase }`); `speakableWithMap(text: string, { pronunciations = [], math = true } = {}) → { text: string, map: MapPiece[] }` (map from the spoken text to `text`'s offsets; markers are consumed and speak nothing); `speakable(text, options) → string`; `stripSpeechMarks(text: string) → string`.
- Produces (`src/lib/speech.js`): re-exports of all of the above plus `sourceOffsetAt`, `composeMaps`, `sliceMap`, `collapseWithOffsets`; `TERMINAL_PUNCTUATION` (`/[.!?:;…)"”]$/u`, moved verbatim); `endSentence(text: string) → string` (moved verbatim); `normalizePronunciations(value) → Array<{ term: string, spoken: string }>` (term trimmed non-empty ≤ 60, spoken trimmed ≤ 120 and may be `""`, first of a case-insensitive duplicate wins, at most `MAX_PRONUNCIATIONS` = 50); `parsePronunciationLines(text: string) → Array<{ term, spoken }>` (split each line at its first `=`; a line without `=` or with an empty term is ignored; result normalized); `samePronunciations(a, b) → boolean` (equal after `normalizePronunciations`, order-sensitive); `PRONUNCIATION_TEST_LABEL = "Pronunciation test"`; `NARRATION_CODE_MODES = Object.freeze(["announce", "skip", "read"])`; `NARRATION_TABLE_MODES = Object.freeze(["rows", "announce"])`.

**The text pass, as specified (implement exactly this order):**

1. **Pronunciations, one pass.** Candidates are the learner's normalized overrides plus `PRONUNCIATION_PACK`; a pack entry is dropped when a learner term equals its term case-insensitively. Sort by term length, longest first (ties alphabetical). Build one alternation regex (memoize per list) with each term escaped; a term starting with a letter or digit gets `(?<![\p{L}\p{N}_])` in front, one ending with a letter or digit gets `(?![\p{L}\p{N}_])` behind; flags `giu`. On a match, use the first candidate whose term equals the match case-insensitively and, if it is `matchCase`, exactly; when none qualifies, leave the span as text. The replacement (possibly `""`) is protected: the math pass never reads it, and it splits formula runs. Spans between `plainOpen` and `plainClose` get pronunciations too.
2. **Unicode math, on unprotected text outside plain spans.** Tokens are maximal non-whitespace runs (a `sub`/`sup` marker group belongs to the token it touches, spaces inside it included). A token is *symbolic* when it holds any character from the readings below or a sub/sup marker. A token is *formula-compatible* when it is symbolic, or consists only of letters, digits and `_ . , ; : ! ? % ' " ( ) [ ] { } | * ^ = + - / < > ~ &` with no run of more than 3 letters, or starts with one of `log exp max min softmax sigmoid tanh sin cos tan det tr Var Cov lim clip sign`. A *formula run* is a maximal sequence of consecutive formula-compatible tokens; it is *active* when it holds a symbolic token. Then:
   - Constructs, in this order of precedence: a norm `‖…‖` (or `∥…∥`) → `the [squared ][Lp ]norm of <inner>` where `p` is a following subscript (Unicode run or sub group; `∞` reads `L infinity`) and `squared` comes from a following `²` or sup `2`; `ℝ` plus superscripts → `R <letters>` with `ˣ` read `by` (`ℝᵐˣⁿ` → `R m by n`, `ℝᵈ` → `R d`); a big operator `Σ ∑ ∏ ∫` (and `𝔼`) followed by a subscript and a superscript → `sum from <sub> to <sup> of`, by a subscript only → `sum over <sub> of`, alone → `sum of` (`∏` reads `product`, `∫` `integral`, `𝔼` `expected value`); `Σ` followed directly by a superscript is the letter (`Sigma inverse`).
   - Superscripts after a base, as a Unicode run or a sup group: exactly `ᵀ` or `⊤` or `T` (group) → `transpose`; `⁻¹` or `−1`/`-1` (group) → `inverse`; `²`/`2` → `squared`; `³`/`3` → `cubed`; `*` → `star`; `′` → `prime`; anything else → `to the power of <content>` with each superscript character read as its base character and `⁻` `minus`, `⁺` `plus`, `ᐟ` `over`.
   - Subscripts, as a Unicode run or a sub group → ` <content>` (`x₁` → `x 1`, `xᵢ` → `x i`, `₊` `plus`, `₋` `minus`); a sub group whose content has more than one token or an operator reads ` sub <content>` (`r` + sub `t+k+1` → `r sub t plus k plus 1`).
   - Combining marks after a letter: U+0302 `hat`, U+0304 and U+0305 `bar`, U+0303 `tilde`, U+0307 `dot`, U+20D7 `vector`; precomposed `ŷ` `y hat`, `Ŷ` `Y hat`, `ŵ` `w hat`, `Ŵ` `W hat`, `ᾱ` `alpha bar`.
   - Single symbols: the spec's table (Global Constraints) plus `×` `times`, `÷` `divided by`, `·` and `⋅` `times`, `±` `plus or minus`, `∓` `minus or plus`, `∞` `infinity`, `∂` `partial`, `′` `prime`, `″` `double prime`, `→` `leads to`, `←` `gets`, `⇒` `implies`, `⇔` `if and only if`, `∝` `proportional to`, `∼` `distributed as`, `≡` `equivalent to`, `≪` `much less than`, `≫` `much greater than`, `∉` `not in`, `∩` `intersection`, `∪` `union`, `⊂` `subset of`, `⊆` `subset of or equal to`, `∀` `for all`, `∃` `there exists`, `∅` `the empty set`, `⊙` `element-wise times`, `⊗` `tensor product`, `∘` `composed with`, `∧` `and`, `∨` `or`, `¬` `not`, `⟂` `perpendicular to`, `ℓ` `ell`, `½` `one half`, `¼` `one quarter`, `¾` `three quarters`, `ℕ` `N`, `ℤ` `Z`, `ℚ` `Q`, `ℂ` `C`; Greek lowercase α β γ δ ε ϵ ζ η θ ϑ ι κ λ μ ν ξ ο π ρ σ ς τ υ φ ϕ χ ψ ω as `alpha` … `omega`, capitals Γ Δ Θ Λ Ξ Π Φ Ψ Ω as `Gamma` … `Omega`.
   - Only inside an active run: a lone `=` (not beside `= < > !`) → `equals`; a lone `+` (not `++`) → `plus`; a lone `/` (not `//`) → `over`; a single letter, Greek letter or listed function name right before `(` gets ` of` before the `(` (`P(y ∣ x)` → `P of (y given x)`).
   - Spacing: a word reading gets a space before it unless it follows whitespace or `( [ {`, and after it unless it precedes whitespace, `, . ; : ! ? ) ] } %` or the end; the builder collapses the rest.
3. **Markers** are removed from the output and map to empty spans.

- [ ] **Step 1: Create the pack** `src/data/pronunciations.ml.v1.json` with exactly this content (119 entries; `matchCase` marks terms whose lowercase form is an ordinary word or another term):

```json
{
  "version": 1,
  "entries": [
    { "term": "ReLU", "spoken": "ray-loo" },
    { "term": "GELU", "spoken": "gee-loo" },
    { "term": "SwiGLU", "spoken": "swig-loo" },
    { "term": "tanh", "spoken": "tanch" },
    { "term": "softmax", "spoken": "soft max" },
    { "term": "argmin", "spoken": "arg min" },
    { "term": "argmax", "spoken": "arg max" },
    { "term": "lstsq", "spoken": "least squares" },
    { "term": "i.i.d.", "spoken": "I I D" },
    { "term": "iid", "spoken": "I I D" },
    { "term": "e.g.", "spoken": "for example" },
    { "term": "i.e.", "spoken": "that is" },
    { "term": "w.r.t.", "spoken": "with respect to" },
    { "term": "vs.", "spoken": "versus" },
    { "term": "p-value", "spoken": "P value" },
    { "term": "A/B", "spoken": "A B", "matchCase": true },
    { "term": "F1", "spoken": "F one" },
    { "term": "SGD", "spoken": "S G D" },
    { "term": "AdamW", "spoken": "Adam W" },
    { "term": "RMSprop", "spoken": "R M S prop" },
    { "term": "BatchNorm", "spoken": "batch norm" },
    { "term": "LayerNorm", "spoken": "layer norm" },
    { "term": "RMSNorm", "spoken": "R M S norm" },
    { "term": "MSE", "spoken": "M S E" },
    { "term": "RMSE", "spoken": "R M S E" },
    { "term": "MAE", "spoken": "M A E" },
    { "term": "MAPE", "spoken": "M A P E" },
    { "term": "AUC", "spoken": "A U C" },
    { "term": "ROC", "spoken": "R O C" },
    { "term": "PR-AUC", "spoken": "P R A U C" },
    { "term": "ROC-AUC", "spoken": "R O C A U C" },
    { "term": "NDCG", "spoken": "N D C G" },
    { "term": "mAP", "spoken": "mean average precision", "matchCase": true },
    { "term": "IoU", "spoken": "I O U" },
    { "term": "BLEU", "spoken": "blue" },
    { "term": "WER", "spoken": "W E R", "matchCase": true },
    { "term": "MLE", "spoken": "M L E" },
    { "term": "MAP", "spoken": "M A P", "matchCase": true },
    { "term": "KL", "spoken": "K L" },
    { "term": "ELBO", "spoken": "elbow" },
    { "term": "MCMC", "spoken": "M C M C" },
    { "term": "HMM", "spoken": "H M M", "matchCase": true },
    { "term": "SVM", "spoken": "S V M" },
    { "term": "PCA", "spoken": "P C A" },
    { "term": "t-SNE", "spoken": "tee snee" },
    { "term": "UMAP", "spoken": "you map" },
    { "term": "k-means", "spoken": "K means" },
    { "term": "DBSCAN", "spoken": "D B scan" },
    { "term": "k-NN", "spoken": "K N N" },
    { "term": "kNN", "spoken": "K N N" },
    { "term": "GRU", "spoken": "G R U" },
    { "term": "GAN", "spoken": "gan" },
    { "term": "VAE", "spoken": "V A E" },
    { "term": "ResNet", "spoken": "res net" },
    { "term": "U-Net", "spoken": "you net" },
    { "term": "ViT", "spoken": "V I T" },
    { "term": "BERT", "spoken": "bert" },
    { "term": "RoBERTa", "spoken": "ro-bert-uh" },
    { "term": "LLM", "spoken": "L L M" },
    { "term": "LLMs", "spoken": "L L Ms" },
    { "term": "LLaMA", "spoken": "llama" },
    { "term": "MoE", "spoken": "M O E" },
    { "term": "GQA", "spoken": "G Q A" },
    { "term": "MQA", "spoken": "M Q A" },
    { "term": "RoPE", "spoken": "rope" },
    { "term": "KV cache", "spoken": "K V cache" },
    { "term": "KV", "spoken": "K V", "matchCase": true },
    { "term": "vLLM", "spoken": "V L L M" },
    { "term": "TPOT", "spoken": "T P O T" },
    { "term": "BPE", "spoken": "B P E" },
    { "term": "TF-IDF", "spoken": "T F I D F" },
    { "term": "BM25", "spoken": "B M twenty-five" },
    { "term": "word2vec", "spoken": "word to vec" },
    { "term": "seq2seq", "spoken": "seek to seek" },
    { "term": "GloVe", "spoken": "glove" },
    { "term": "RAG", "spoken": "rag", "matchCase": true },
    { "term": "HNSW", "spoken": "H N S W" },
    { "term": "FAISS", "spoken": "face" },
    { "term": "ANN", "spoken": "A N N", "matchCase": true },
    { "term": "LoRA", "spoken": "lora" },
    { "term": "QLoRA", "spoken": "Q lora" },
    { "term": "PEFT", "spoken": "peft" },
    { "term": "SFT", "spoken": "S F T" },
    { "term": "RLHF", "spoken": "R L H F" },
    { "term": "DPO", "spoken": "D P O" },
    { "term": "PPO", "spoken": "P P O" },
    { "term": "GRPO", "spoken": "G R P O" },
    { "term": "PyTorch", "spoken": "pie torch" },
    { "term": "NumPy", "spoken": "num pie" },
    { "term": "SciPy", "spoken": "sigh pie" },
    { "term": "scikit-learn", "spoken": "sy kit learn" },
    { "term": "sklearn", "spoken": "S K learn" },
    { "term": "Matplotlib", "spoken": "mat plot lib" },
    { "term": "JAX", "spoken": "jacks" },
    { "term": "CUDA", "spoken": "koo-da" },
    { "term": "cuDNN", "spoken": "koo D N N" },
    { "term": "ONNX", "spoken": "onyx" },
    { "term": "TensorRT", "spoken": "tensor R T" },
    { "term": "XGBoost", "spoken": "X G boost" },
    { "term": "LightGBM", "spoken": "light G B M" },
    { "term": "MLOps", "spoken": "M L ops" },
    { "term": "FLOPs", "spoken": "flops" },
    { "term": "TFLOPS", "spoken": "tera flops" },
    { "term": "NCCL", "spoken": "nickel" },
    { "term": "p50", "spoken": "P fifty" },
    { "term": "p95", "spoken": "P ninety-five" },
    { "term": "p99", "spoken": "P ninety-nine" },
    { "term": "SLO", "spoken": "S L O" },
    { "term": "k8s", "spoken": "kubernetes" },
    { "term": "kubectl", "spoken": "kube control" },
    { "term": "CI/CD", "spoken": "C I C D" },
    { "term": "YAML", "spoken": "yammel" },
    { "term": "JSON", "spoken": "jay-son" },
    { "term": "JSONL", "spoken": "jay-son L" },
    { "term": "regex", "spoken": "rej-ex" },
    { "term": "stdout", "spoken": "standard out" },
    { "term": "stderr", "spoken": "standard error" },
    { "term": "GiB", "spoken": "gibibytes", "matchCase": true },
    { "term": "LaTeX", "spoken": "lay-tek" }
  ]
}
```

- [ ] **Step 2: Write the failing tests** in `src/lib/speech.test.mjs` (namespace import `speech`; add `import pack from "../data/pronunciations.ml.v1.json" with { type: "json" };`):

```js
test("the verbalizer reads Unicode math the issue's way", () => {
  const cases = [
    ["ŷ = wᵀx + b", "y hat equals w transpose x plus b"],
    ["ŵ = (XᵀX)⁻¹Xᵀy", "w hat equals (X transpose X) inverse X transpose y"],
    ["∇J = 2Xᵀ(Xw − y)", "gradient of J equals 2X transpose (Xw minus y)"],
    ["x² + y³", "x squared plus y cubed"],
    ["x̄ ≈ μ", "x bar approximately mu"],
    ["Σxᵢ", "sum of x i"],
    ["√d", "square root of d"],
    ["A ∈ ℝᵐˣⁿ", "A in R m by n"],
    ["a ≤ b ≥ c ≠ d", "a less than or equal to b greater than or equal to c not equal to d"],
    ["P(y ∣ x)", "P of (y given x)"],
    ["‖x‖₂", "the L2 norm of x"],
    ["½‖w‖²", "one half the squared norm of w"],
    ["𝔼[X]", "expected value of [X]"],
    ["θ, λ, σ", "theta, lambda, sigma"],
    ["x₁ + xᵢ", "x 1 plus x i"],
    ["rₜ₊₁", "r t plus 1"],
    ["e⁻ᶻ", "e to the power of minus z"],
    ["3 × 4 ÷ 2", "3 times 4 divided by 2"],
    ["∂L/∂b = p − y", "partial L over partial b equals p minus y"],
    ["σ(z) = 1 / (1 + e⁻ᶻ)", "sigma of (z) equals 1 over (1 plus e to the power of minus z)"],
    ["data → model", "data leads to model"],
  ];
  for (const [input, expected] of cases) assert.equal(speech.speakable(input), expected, input);
});

test("ASCII operators are words only inside a formula run with a math symbol", () => {
  assert.equal(speech.speakable("Gaussian + identity → linear regression"), "Gaussian + identity leads to linear regression");
  assert.equal(speech.speakable("stale read then write → version/ETag optimistic concurrency"), "stale read then write leads to version/ETag optimistic concurrency");
  assert.equal(speech.speakable("Use x = 5 and y/2 here."), "Use x = 5 and y/2 here.");
  assert.equal(speech.speakable("P(D ∣ +) = 95/590 ≈ 16.1%"), "P of (D given +) equals 95 over 590 approximately 16.1%");
  assert.equal(speech.speakable("See https://x.org/a/b → b"), "See https://x.org/a/b leads to b");
  assert.equal(speech.speakable("An intelligent product observes some context."), "An intelligent product observes some context.");
});

test("marked sub, sup and inline-code spans read as the DOM wrote them", () => {
  const { subOpen: so, subClose: sc, supOpen: po, supClose: pc, plainOpen, plainClose } = speech.SPEECH_MARK;
  assert.equal(speech.speakable(`Σ${so}i=1${sc}${po}n${pc} x${so}i${sc}`), "sum from i equals 1 to n of x i");
  assert.equal(speech.speakable(`x${po}2${pc}`), "x squared");
  assert.equal(speech.speakable(`X${po}T${pc}`), "X transpose");
  assert.equal(speech.speakable(`A${po}−1${pc}`), "A inverse");
  assert.equal(speech.speakable(`e${po}x${pc}`), "e to the power of x");
  assert.equal(speech.speakable(`d${so}model${sc}`), "d model");
  assert.equal(speech.speakable(`r${so}t+k+1${sc}`), "r sub t plus k plus 1");
  assert.equal(speech.speakable(`Run ${plainOpen}θ = a/b${plainClose} once.`), "Run θ = a/b once.");
  assert.equal(speech.speakable(`${plainOpen}np.linalg.lstsq(X, y)${plainClose}`), "np.linalg.least squares(X, y)");
  assert.equal(speech.stripSpeechMarks(`x${so}i${sc} and ${plainOpen}a${plainClose}`), "xi and a");
});

test("a learner's entry beats the pack and nothing is replaced twice", () => {
  assert.equal(speech.speakable("ReLU then tanh"), "ray-loo then tanch");
  assert.equal(speech.speakable("ReLU then tanh", { pronunciations: [{ term: "relu", spoken: "rectifier" }] }), "rectifier then tanch");
  assert.equal(speech.speakable("alpha beta", { pronunciations: [{ term: "alpha", spoken: "beta" }, { term: "beta", spoken: "gamma" }] }), "beta gamma");
  assert.equal(speech.speakable("QLoRA beats LoRA in KV cache use"), "Q lora beats lora in K V cache use");
  assert.equal(speech.speakable("CUDAx and xCUDA"), "CUDAx and xCUDA");
  assert.equal(speech.speakable("MAP and map and mAP"), "M A P and map and mean average precision");
  assert.equal(speech.speakable("C++ code", { pronunciations: [{ term: "C++", spoken: "C plus plus" }] }), "C plus plus code");
  assert.equal(speech.speakable("ReLU, tanh and lstsq"), "ray-loo, tanch and least squares");
});

test("term = skips a term, and overrides parse from Settings lines", () => {
  assert.deepEqual(speech.parsePronunciationLines("ReLU = ray loo\num =\n  = nothing\nno equals sign\nSQL = sequel = query"), [
    { term: "ReLU", spoken: "ray loo" },
    { term: "um", spoken: "" },
    { term: "SQL", spoken: "sequel = query" },
  ]);
  assert.equal(speech.speakable("So um this works", { pronunciations: [{ term: "um", spoken: "" }] }), "So this works");
  assert.equal(speech.speakable("ReLU", { pronunciations: [{ term: "ReLU", spoken: "" }] }), "");
  assert.deepEqual(speech.normalizePronunciations([{ term: " um ", spoken: "" }, { term: "UM", spoken: "x" }, { term: "", spoken: "y" }]), [{ term: "um", spoken: "" }]);
  assert.equal(speech.normalizePronunciations(Array.from({ length: 60 }, (_, index) => ({ term: `t${index}`, spoken: "x" }))).length, 50);
  assert.equal(speech.samePronunciations([{ term: "a", spoken: "b" }], [{ term: " a ", spoken: "b " }]), true);
  assert.equal(speech.samePronunciations([{ term: "a", spoken: "b" }], [{ term: "a", spoken: "c" }]), false);
});

test("speakableWithMap maps every spoken character back to its source", () => {
  const input = "The loss ŷ = b uses ReLU.";
  const { text, map } = speech.speakableWithMap(input);
  assert.equal(text, "The loss y hat equals b uses ray-loo.");
  assert.equal(map[0].spoken[0], 0);
  assert.equal(map.at(-1).spoken[1], text.length);
  map.forEach((piece, index) => {
    assert.ok(piece.source[0] <= piece.source[1]);
    if (index) {
      assert.equal(piece.spoken[0], map[index - 1].spoken[1]);
      assert.ok(piece.source[0] >= map[index - 1].source[1]);
    }
  });
  const sourceOf = (word) => speech.sourceOffsetAt(map, text.indexOf(word));
  assert.equal(input.slice(sourceOf("ray-loo"), sourceOf("ray-loo") + 4), "ReLU");
  assert.equal(input[sourceOf("y hat")], "ŷ");
  assert.equal(input.slice(sourceOf("uses"), sourceOf("uses") + 4), "uses");
  assert.deepEqual(speech.collapseWithOffsets("  a \n b"), { text: "a b", offsets: [0, 0, 0, 1, 2, 2, 2, 3] });
});

test("endSentence and TERMINAL_PUNCTUATION live in speech.js", () => {
  assert.equal(speech.endSentence("Ridge regression"), "Ridge regression.");
  assert.equal(speech.endSentence("Done!"), "Done!");
  assert.equal(speech.endSentence(""), "");
  assert.equal(speech.TERMINAL_PUNCTUATION.test("Note:"), true);
});

test("the built-in pack covers the issue's terms and lists nothing twice", () => {
  assert.equal(pack.version, 1);
  assert.ok(pack.entries.length >= 110 && pack.entries.length <= 130, `the pack has ${pack.entries.length} entries`);
  for (const term of ["ReLU", "tanh", "SGD", "NDCG", "PR-AUC", "k-NN", "LLM", "LoRA", "QLoRA", "vLLM", "KV cache", "i.i.d.", "argmin", "argmax", "p99", "lstsq", "PyTorch"]) {
    assert.ok(pack.entries.some((entry) => entry.term === term), `the pack has no ${term}`);
  }
  const keys = pack.entries.map((entry) => (entry.matchCase ? entry.term : entry.term.toLowerCase()));
  assert.equal(new Set(keys).size, keys.length, "a pack term is listed twice");
  for (const entry of pack.entries) assert.ok(entry.term.trim() && entry.spoken.trim() && entry.term.length <= 60 && entry.spoken.length <= 120, entry.term);
  assert.equal(speech.PRONUNCIATION_PACK.length, pack.entries.length);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test src/lib/speech.test.mjs`
Expected: FAIL — every new test fails with `TypeError: speech.speakable is not a function` (or `parsePronunciationLines`, `speakableWithMap`, `endSentence`, `PRONUNCIATION_PACK` undefined); the existing tests still pass.

- [ ] **Step 4: Implement** `spokenMap.js`, `speakable.js` and the `speech.js` exports as specified above, and move `endSentence`/`TERMINAL_PUNCTUATION` (tutorMarkdown imports them; behavior unchanged).

- [ ] **Step 5: Run to verify they pass**

Run: `node --test src/lib/speech.test.mjs src/lib/tutorMarkdown.test.mjs && npm run audit:unit && npm run build`
Expected: all pass; the build succeeds (the shim keeps `useSpeech.js` compiling). Note the `audit:app` startup-entry bytes from `npm run audit:app`.

- [ ] **Step 6: Commit and push**

```bash
git add src/lib/spokenMap.js src/lib/speakable.js src/data/pronunciations.ml.v1.json src/lib/speech.js src/lib/tutorMarkdown.js src/lib/speech.test.mjs
git commit -m "Verbalize math and apply a built-in pronunciation pack in one pass"
git push -u origin feat/speakable-ml-content
```

---

### Task 2: Chunking, the queue builder and `useSpeech`

**Files:**
- Modify: `src/lib/speech.js` (`chunkSpeechText`, new `isEnumeratorOnly`, `splitSpeechSentenceRanges`, `buildSpeechQueue`; delete the `applyPronunciations` shim)
- Modify: `src/hooks/useSpeech.js:295-355` (queue from `buildSpeechQueue`; entries; `queueUnits`; per-call `pronunciations`)
- Modify: `src/lib/narrationPositions.js:71-90` (`locatePosition` reads `entry.text` when the queue holds entries; strings keep working)
- Modify: `src/App.jsx` `onNotice` (a `PRONUNCIATION_TEST_LABEL` notice toasts its `plain` message; see below)
- Test: `src/lib/speech.test.mjs`, `src/lib/narrationPositions.test.mjs`

**Interfaces:**
- Consumes: Task 1's `speakable`, `speakableWithMap`, `composeMaps`, `sliceMap`, `sourceOffsetAt`, `endSentence`.
- Produces (`src/lib/speech.js`):
  - `MIN_PIECE_WORDS = 3`.
  - `isEnumeratorOnly(text: string) → boolean` — true for a whole sentence that is only an enumerator: `/^\(?(?:\d+(?:\.\d+)*|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.):]?$/u` that also contains a digit, a parenthesis, or ends with `.` (`6.`, `5.1`, `(a)`, `a)`, `iv.`).
  - `splitSpeechSentenceRanges(text: string, language = "auto") → Array<{ start: number, end: number }>` — `Intl.Segmenter` sentence segments as offsets into `text` (the regex fallback when the segmenter is missing or throws), trailing whitespace left with the earlier sentence, then enumerator-only segments joined to the next segment.
  - `chunkSpeechText(text, limit = SPEECH_CHUNK_LIMIT, language = "auto") → string[]` — the text path: sentences from `splitSpeechSentenceRanges`, consecutive whole sentences packed up to `limit` as today, an oversized sentence split by `splitSpokenSentence`.
  - `splitSpokenSentence(text: string, { limit = SPEECH_CHUNK_LIMIT, kind = "text" } = {}) → Array<{ start: number, end: number }>` — ranges (trimmed) into `text`, each ≤ `limit` characters. Boundary priority: for `kind: "row"`, after `; ` first, then after `, `, `: ` or `—`; otherwise after any of `, ; :` followed by whitespace, or after `—`; greedy (the furthest boundary that fits); a clause still over the limit splits at the furthest space that fits, then by characters. Then the 3-word rule: while a piece has fewer than `MIN_PIECE_WORDS` words and the sentence has at least `2 × MIN_PIECE_WORDS` words, merge it with its neighbour (the next one; the previous one for the last piece) when the merge fits, else re-split the merged pair at the space nearest its old seam that leaves at least 3 words on each side within the limit. Character-split pieces (no spaces) are exempt.
  - `buildSpeechQueue(input: string | SpeechUnit[], { pronunciations = [], language = "auto", sections = [] } = {}) → { queue: QueueEntry[], sectionStarts: Array<{ index: number, label: string }> }`.
    - Text path (`input` a string): when `sections.length > 1`, each section's text becomes its own run of entries labelled `section.label.slice(0, 80)` (a section that yields nothing is skipped, as today); otherwise the whole string with section `""`. For each run: sentences from `splitSpeechSentenceRanges` on the source, `speakable(sentence, { pronunciations })` per sentence, then whole spoken sentences packed up to the limit, an oversized one split by `splitSpokenSentence`. Entries are `{ text, unit: null, map: [], section }`. `sectionStarts` has one start per section run that produced entries, and is `[]` unless there are at least two.
    - Units path (`input` an array): each unit on its own, never merged with another. `kind: "announcement"` → `speakable(unit.text)`, split by `splitSpokenSentence`, entries keep the unit's `unit` (`start === end === 0`) and `map: []`. Any other kind → `speakableWithMap(unit.text, { pronunciations, math: unit.kind !== "code" })`, the map composed with `unit.map`, the spoken text split by `splitSpokenSentence(text, { kind: unit.kind })`; entry `k` gets `unit: { blockIndex, start: s_k, end: s_{k+1} }` where `s_0 = unit.unit.start`, `s_last = unit.unit.end` and each inner seam is `sourceOffsetAt(composed, pieceStart)`, and `map: sliceMap(composed, pieceStart, pieceEnd)`. `sectionStarts` starts at entry 0 and wherever a unit has `sectionStart: true` or a `section` different from the previous entry's.
    - Units whose text is empty after the pass produce no entry.
- Produces (`src/hooks/useSpeech.js`): `speak(input: string | SpeechUnit[], options)` — options as today plus `pronunciations` (overrides the hook's list for this call only; Try it in Task 6). The over-limit check sums `input.length` or every unit's `text.length` against `SPEECH_TEXT_LIMIT` before the queue is built. `queueRef.current` holds entries; `playIndex` speaks `entry.text`; `currentText` is `entry.text`; `resolveStart(queue, sectionStarts)` receives entries. The hook returns `queueUnits: QueueEntry[]` (state, set by `speak`, `[]` after `stop`/finish) and `currentIndex` (`progress.current`).
- Produces (`src/lib/narrationPositions.js`): `locatePosition(position, queue: Array<QueueEntry | string>, sectionStarts, options)` — unchanged rules, reading `typeof entry === "string" ? entry : entry?.text || ""`.
- App: in `useSpeech`'s `onNotice`, after the `sleep-ended` branch, `else if (notice.label === PRONUNCIATION_TEST_LABEL) notify(notice.plain, notice.severity === "error" ? "error" : "warning");` (import the label from `./lib/speech.js`).

Assertions changed on purpose: none in this task (the Reader still speaks text with sections, so `buildSpeechTarget` tests are untouched).

- [ ] **Step 1: Write the failing tests** in `src/lib/speech.test.mjs`:

```js
const SENTENCE_250 = "Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight, and moving each weight a smaller step against its gradient until the loss stops improving.";

test("an enumerator-only sentence joins the sentence after it", () => {
  assert.deepEqual(["6.", "5.1", "(a)", "a)", "iv.", "Done.", "6. Task", "Hi."].map(speech.isEnumeratorOnly), [true, true, true, true, true, false, false, false]);
  assert.deepEqual(chunkSpeechText("6. Task taxonomy"), ["6. Task taxonomy"]);
  assert.deepEqual(speech.splitSpeechSentenceRanges("5. Learning paradigms"), [{ start: 0, end: 21 }]);
  // The text path still packs whole sentences up to the limit (the tutors' first utterance).
  assert.deepEqual(chunkSpeechText("Holdout evaluation. A final holdout remains useful."), ["Holdout evaluation. A final holdout remains useful."]);
});

test("an oversized sentence splits at clauses and leaves no piece under three words", () => {
  assert.equal(SENTENCE_250.length, 250);
  assert.deepEqual(chunkSpeechText(SENTENCE_250), [
    "Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight,",
    "and moving each weight a smaller step against its gradient until the loss stops improving.",
  ]);
  const words = Array.from({ length: 20 }, (_, index) => `token${String(index).padStart(2, "0")}a`);
  const pieces = chunkSpeechText(`${words.join(" ")} succeeds.`);
  assert.deepEqual(pieces.map((piece) => piece.split(" ").length), [18, 3]);
  assert.equal(pieces[1], `${words[18]} ${words[19]} succeeds.`);
  const yes = `Yes, ${Array.from({ length: 40 }, (_, index) => `w${String(index).padStart(3, "0")}`).join(" ")}.`;
  const yesPieces = chunkSpeechText(yes);
  assert.ok(yesPieces.every((piece) => piece.split(" ").length >= 3 && [...piece].length <= 180), JSON.stringify(yesPieces));
  assert.equal(yesPieces.join(" "), yes);
  const row = `Row 1. A: ${"a".repeat(70)}; B: ${"b".repeat(70)}; C: ${"c".repeat(70)}.`;
  assert.deepEqual(speech.splitSpokenSentence(row, { kind: "row" }).map(({ start, end }) => row.slice(start, end)), [
    `Row 1. A: ${"a".repeat(70)}; B: ${"b".repeat(70)};`,
    `C: ${"c".repeat(70)}.`,
  ]);
});

test("units become queue entries without merging across units", () => {
  const units = [
    { text: "Optimization.", unit: { blockIndex: 0, start: 0, end: 12 }, map: [{ spoken: [0, 12], source: [0, 12] }, { spoken: [12, 13], source: [12, 12] }], section: "Optimization", sectionStart: true },
    { text: "Short.", unit: { blockIndex: 1, start: 0, end: 6 }, map: [{ spoken: [0, 6], source: [0, 6] }], section: "Optimization" },
    { text: "Table, 2 columns: A, B.", unit: { blockIndex: 2, start: 0, end: 0 }, map: [], section: "Optimization", kind: "announcement" },
    { text: "Momentum.", unit: { blockIndex: 3, start: 0, end: 8 }, map: [{ spoken: [0, 8], source: [0, 8] }, { spoken: [8, 9], source: [8, 8] }], section: "Momentum", sectionStart: true },
  ];
  const { queue, sectionStarts } = speech.buildSpeechQueue(units);
  assert.deepEqual(queue.map((entry) => entry.text), ["Optimization.", "Short.", "Table, 2 columns: A, B.", "Momentum."]);
  assert.deepEqual(queue.map((entry) => entry.unit), units.map((unit) => unit.unit));
  assert.deepEqual(queue[2].map, []);
  assert.deepEqual(queue.map((entry) => entry.section), ["Optimization", "Optimization", "Optimization", "Momentum"]);
  assert.deepEqual(sectionStarts, [{ index: 0, label: "Optimization" }, { index: 3, label: "Momentum" }]);
});

test("a long unit splits into entries whose source ranges tile the unit", () => {
  const unit = { text: SENTENCE_250, unit: { blockIndex: 4, start: 10, end: 260 }, map: [{ spoken: [0, 250], source: [10, 260] }], section: "S" };
  const { queue } = speech.buildSpeechQueue([unit]);
  assert.equal(queue.length, 2);
  const seam = 10 + SENTENCE_250.indexOf("and moving");
  assert.deepEqual(queue.map((entry) => [entry.unit.start, entry.unit.end]), [[10, seam], [seam, 260]]);
  for (const entry of queue) {
    assert.equal(entry.map[0].spoken[0], 0);
    assert.equal(entry.map.at(-1).spoken[1], entry.text.length);
  }
  assert.equal(queue[1].map[0].source[0], seam);
});

test("the text pass runs inside the queue on both paths", () => {
  const { queue } = speech.buildSpeechQueue("The model predicts ŷ = wᵀx + b for each input. ReLU helps.");
  assert.deepEqual(queue.map((entry) => entry.text), ["The model predicts y hat equals w transpose x plus b for each input. ray-loo helps."]);
  assert.equal(queue[0].unit, null);
  assert.deepEqual(queue[0].map, []);
  assert.equal(speech.buildSpeechQueue("ReLU helps.", { pronunciations: [{ term: "ReLU", spoken: "rectifier" }] }).queue[0].text, "rectifier helps.");
  const sectioned = speech.buildSpeechQueue("ignored", { sections: [{ label: "A", text: "First." }, { label: "B", text: "Second." }] });
  assert.deepEqual(sectioned.queue.map((entry) => [entry.text, entry.section]), [["First.", "A"], ["Second.", "B"]]);
  assert.deepEqual(sectioned.sectionStarts, [{ index: 0, label: "A" }, { index: 1, label: "B" }]);
  const code = { text: "w = np.linalg.lstsq(X, y)[0]", unit: { blockIndex: 0, start: 0, end: 28 }, map: [{ spoken: [0, 28], source: [0, 28] }], kind: "code" };
  assert.equal(speech.buildSpeechQueue([code]).queue[0].text, "w = np.linalg.least squares(X, y)[0]");
});

test("the tutor's Listen gets the same pass", async () => {
  const { tutorSpeechText } = await import("./tutorMarkdown.js");
  const spoken = tutorSpeechText("## Linear model\n\nŷ = wᵀx + b");
  assert.equal(speech.buildSpeechQueue(spoken.text, { sections: spoken.sections }).queue[0].text, "Linear model. y hat equals w transpose x plus b");
});
```

and in `src/lib/narrationPositions.test.mjs`:

```js
test("positions are found in a queue of entries", () => {
  const entry = (text) => ({ text, unit: null, map: [], section: "" });
  const queue = ["One.", "Two sentence here.", "Three.", "Four."].map(entry);
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 4, snippet: "Two sentence", section: "" }, queue, []), { index: 1, how: "exact" });
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 9, snippet: "Three.", section: "" }, queue, []), { index: 2, how: "snippet" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/speech.test.mjs src/lib/narrationPositions.test.mjs`
Expected: FAIL — `isEnumeratorOnly`, `splitSpeechSentenceRanges`, `splitSpokenSentence` and `buildSpeechQueue` are not functions; the clause test fails on today's word split (quote the pieces); `locatePosition` throws `queue[index].startsWith is not a function`. (`chunkSpeechText("6. Task taxonomy")` already returns one chunk today because packing merges the segmenter's `"6. "` with its heading; the line stays as a guard for the new enumerator rule.)

- [ ] **Step 3: Implement** the `speech.js` functions, switch `useSpeech.speak` to `buildSpeechQueue`, update `locatePosition`'s text read, and add App's `onNotice` branch, as specified in Interfaces.

- [ ] **Step 4: Run to verify they pass, and that the app still behaves**

Run: `node --test src/lib/speech.test.mjs src/lib/narrationPositions.test.mjs src/lib/audioBookmarks.test.mjs src/lib/tutorMarkdown.test.mjs && npm run check`
Expected: all pass. Then the suites that pin today's narration and tutor Listen:
Run: `npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- audio ai-ui phone-ai-ui`
Expected: `{"browserChecks":[…],"ok":true}` — the tutors' first utterances (`/^Holdout evaluation\. A final holdout/`, `/^Gradient descent\. Gradient descent follows/`) still pass because the text path packs sentences.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/speech.js src/hooks/useSpeech.js src/lib/narrationPositions.js src/App.jsx src/lib/speech.test.mjs src/lib/narrationPositions.test.mjs
git commit -m "Chunk speech per unit and build the queue from units or text"
git push
```

---

### Task 3: Speech units from the DOM (`speechContent.js`, `mathSpeech.js`, diagrams)

**Files:**
- Create: `src/lib/mathSpeech.js`
- Modify: `src/lib/speechContent.js` (blocks, units, verbalizers; `buildSpeechTarget` returns `units`; `buildSpeechSections` rebuilt on units)
- Modify: `src/lib/mermaidDiagrams.js` (export `diagramDescriptionFor`)
- Create: `src/lib/speechContent.test.mjs`
- Modify: `src/lib/speech.test.mjs` (six assertions changed on purpose, listed below), `src/lib/mermaidDiagrams.test.mjs`

**Interfaces:**
- Consumes: `splitSpeechSentenceRanges`, `endSentence`, `TERMINAL_PUNCTUATION`, `SPEECH_MARK`, `stripSpeechMarks`, `collapseWithOffsets`, `createSpokenBuilder`, `sliceMap` (Tasks 1–2); `describeMermaidDefinition` (existing).
- Produces (`src/lib/mathSpeech.js`): `verbalizeMath(math: Node) → { text: string, map: MapPiece[] }` — `map` sources are raw offsets into `math.textContent`. Written against a minimal node interface: `nodeType`, `localName`/`tagName`, `childNodes`, `textContent`, `getAttribute`.
- Produces (`src/lib/mermaidDiagrams.js`): `diagramDescriptionFor(node: Element) → string` — `node` is a `.diagram-shell` or its `.mermaid`. Source: the preserved definition in `sourceByNode` when present; else, when the `.mermaid`'s `data-diagram-status` is missing, `pending` or `rendering`, its `textContent`; else, when `rendered`, its `aria-label` (already `describeMermaidDefinition` of the source); else `""`. Returns `describeMermaidDefinition(source)` (or that aria-label), never diagnostic text.
- Produces (`src/lib/speechContent.js`):
  - `readableBlocks(root) → Element[]` (now exported; #101 uses it). Candidates, in document order: `h1, h2, h3, h4, p, li, blockquote, figcaption` (text blocks) and `tr, pre, .diagram-shell, math[display="block"]` (atomic blocks). Drop a candidate inside an atomic block; drop a text block inside another text block (the outer one reads it, with its inner block boundaries as sentence breaks); keep an atomic block inside a text block (code in a list item); drop a text block with no text outside its atomic descendants; drop any node with empty `cleanText(textContent)`. Fakes without `childNodes`, `classList` or `getAttribute` keep working (the existing `speech.test.mjs` fixtures).
  - `blockAt(root, index) → Element | null`; `speechBlockText(block) → string` (`cleanText(block.textContent)`, the coordinate space of every `unit.start/end`).
  - `buildSpeechUnits(root, { code = "announce", tables = "rows" } = {}) → SpeechUnit[]`, by block kind:
    - **Text blocks**: walk the child nodes, keeping raw offsets over every text node (skipped ones included, so offsets match `textContent`), into a builder string with a map into `speechBlockText` coordinates (`collapseWithOffsets`). Text nodes are identity; `br` and the boundary of any nested text block, `div`, `table` or atomic block is a hard break; nested atomic blocks, `.katex-html`, `annotation`, `annotation-xml` and `mphantom` speak nothing; an inline `math` is `verbalizeMath` (one atomic piece); inline `code` (not in `pre`) is wrapped in `plainOpen`/`plainClose`; `sub` and `sup` content is wrapped in their markers. Split each hard-break segment with `splitSpeechSentenceRanges`; a boundary inside an atomic piece (inline math, a marker group) moves to the piece's end. Each sentence is a unit; the last sentence of each segment gets `endSentence` (an inserted `.` with an empty source range at its end). Unit ranges tile the block: the first starts at 0, each starts where the previous ended, the last ends at `speechBlockText(block).length`.
    - **`tr`** (`kind: "row"`): a row whose cells are all `th` is the header: one announcement `Table, N columns: A, B, C.` (`Table, 1 column: A.`), or with `tables: "announce"` `Table, N columns, M rows: A, B, C.`, where `N` is the most cells in any row and `M` the table's non-header rows. A table without a header row announces `Table, N columns.` (or `Table, N columns, M rows.`) as an announcement unit on its first row's block. With `tables: "rows"`, data row `k` (1-based among the table's non-header rows) is one unit: `Row k. ` then, for each non-empty cell, `Label: ` (omitted when that header label is empty or missing) and the cell's inline text, cells joined by `; `, ending `.`; labels and separators are inserted pieces, cell text maps to the row's coordinates. With `tables: "announce"`, data rows give no units.
    - **`pre`**: lines = `textContent` without its trailing newlines, split at `\n`; `N` = their count (`1 line`, `N lines`). Any U+2500–U+257F character → announcement `Text diagram, N lines.` in every code mode. Otherwise the language is the `aria-label` minus ` code`: `python`/`py` Python, `js`/`javascript`/`jsx`/`mjs` JavaScript, `ts`/`typescript`/`tsx` TypeScript, `bash`/`sh`/`shell`/`zsh`/`console` Shell, `sql` SQL, `json` JSON, `yaml`/`yml` YAML, `html` HTML, `css` CSS, `c` C, `cpp`/`c++` C++, `go` Go, `rust`/`rs` Rust, `java` Java, `r` R, `dockerfile`/`docker` Dockerfile, `toml` TOML; `text`, `plaintext`, `txt` or none → `Code`; any other id uppercased when ≤ 3 letters, else capitalised. `announce` → announcement `<Name> example, N lines.`; `skip` → no unit; `read` → that announcement, then one `kind: "code"` unit per non-empty line (no `endSentence`), ranges tiling the block.
    - **`.diagram-shell`**: announcement `Diagram: <description>.` via `diagramDescriptionFor` (`endSentence`; when the description already starts with `Diagram`, it is the whole text; with no description, `Diagram.`).
    - **`math[display="block"]`**: one unit from `verbalizeMath`, a trailing `,` removed, then `endSentence`.
    - **Sections**: an H1–H3 starts a section labelled `speechBlockText(heading).slice(0, 80)`; text before the first heading is `Introduction`. Every unit carries `section`; the first unit of each section has `sectionStart: true`.
  - `buildSpeechSections(root, options) → Array<{ label, text }>` — per section, its units' `stripSpeechMarks(text)` joined with spaces (#122 and #125 read it).
  - `buildSpeechTarget({ scope, selectedText, article, scrollContainer, sourceText, language, code, tables })` — Selection unchanged (text only). Document: `{ available, scope: "document", label: "Full lecture", text, units, sections }`, where `sections` is `buildSpeechSections` over the same units (the Reader keeps speaking `text` with `sections`, so section skip still works, until Task 5 switches it to `units`). Section: the units of the blocks in today's section range (the #96 rule, now returning a block range). Sentence: the unit containing the reading-line offset in the block at the line; on a heading, the first unit of the next non-heading block (today's rule); on a block with no units, the first unit of the next block that has units. `text` is the units' `stripSpeechMarks(text)` joined with spaces; with no units, the target falls back to today's text (`cleanText(article.innerText || sourceText)`, no `units`).
- `verbalizeMath` readings (word order follows the DOM):
  - `mi`: Greek by name (as in Task 1), `ℓ` `ell`, `∞` `infinity`, `ℝ` `R`, `𝔼` `expected value of`, other text as written (one `mi` per letter reads `T P`); `mn` and `mtext` as written; `mspace` a space; `semantics` its first child; `annotation*` and `mphantom` nothing.
  - `mo`: `=` equals, `+` plus, `−`/`-` minus, `±` plus or minus, `×`/`·`/`⋅` times, `/` over, `÷` divided by, `<` less than, `>` greater than, `≤ ≥ ≠ ≈ ∈ ∉ ∝ → ⇒ ⇔ ∼ ∂ ∇ ′` as in Task 1, `∣` given, `|` `the absolute value of` with `form="prefix"`, nothing with `form="postfix"`, else `given`; `‖`/`∥` `the norm of` (prefix) or nothing (postfix); `∑` sum of, `∏` product of, `∫` integral of, `*` star, `!` factorial; U+2061–U+2064 nothing; `{` `}` nothing; `( ) [ ]` kept as characters; `, . ; :` attach to the previous word.
  - Function application: an `mi` (one letter, Greek, `ℓ`, or `log exp max min sin cos tan tanh det tr Var Cov softmax`) or an `msub`/`msup` with such a base, right before an `mo` `(`, gets `of` before the `(` (`f theta of (x)`).
  - `mfrac`: `<num> over <den>` when both are one token, else `<num>, over, <den>`.
  - `msup`: as Task 1's superscript readings (`T`/`⊤` transpose, `−1` inverse, `2` squared, `3` cubed, `*` star, `′` prime, else `to the power of <sup>`). `msub`: `<base> <sub>` for one token, else `<base> sub <sub>`. `msubsup`: `<base> <sub> <sup reading>`.
  - `munderover`/`munder`/`mover`: a base `∑ ∏ ∫ min max lim arg min arg max` or `𝔼`: `<op> from <under> to <over> of` / `<op> over <under>` (with ` of` after `∑ ∏ ∫ 𝔼`); an accent `mover` (U+0302 or `^` hat, `‾`/`¯`/U+0305 bar, `˜`/`~`/U+0303 tilde, `˙`/U+0307 dot, `→`/U+20D7 vector): `<base> <accent>` (`y hat`); any other `mover`: `<base> with <over> above`.
  - `msqrt`: `square root of <content>`; `mroot`: `root <index> of <base>` (one map piece for the whole construct); `mtable`: cells joined `, `, rows `; `.

Assertions changed on purpose in `src/lib/speech.test.mjs` (heading join → headings end as sentences; find each by its current text, and name them in the commit body):
- `"Optimization Gradient descent moves downhill. Learning rate controls each step. Momentum smooths updates."` → `"Optimization. Gradient descent moves downhill. Learning rate controls each step. Momentum smooths updates."`
- `"5. Learning paradigms 5.1 Supervised learning Labels guide the fit. A note Labels cost money. 5.2 Unsupervised learning Structure without labels."` → `"5. Learning paradigms. 5.1 Supervised learning. Labels guide the fit. A note. Labels cost money. 5.2 Unsupervised learning. Structure without labels."`
- `"5.1 Supervised learning Labels guide the fit. A note Labels cost money."` → `"5.1 Supervised learning. Labels guide the fit. A note. Labels cost money."`
- `"Chapter 1 1. Intelligence Products act on context. Artificial intelligence AI is the broad field."` → `"Chapter 1. 1. Intelligence. Products act on context. Artificial intelligence. AI is the broad field."`
- `"6. Task taxonomy Tasks differ by output."` → `"6. Task taxonomy. Tasks differ by output."`
- `"Title Intro text. Aside Aside text."` → `"Title. Intro text. Aside. Aside text."`

- [ ] **Step 1: Write the failing tests.** In `src/lib/speechContent.test.mjs`, first a stub DOM: `text(data)` and `el(tag, attrs, children)` build nodes with `nodeType`, `tagName` (upper case), `localName`, `childNodes`, `children`, `parentNode`/`parentElement`, a `textContent` getter, `getAttribute`/`hasAttribute`, `classList.contains`, `dataset` (from `data-*`), and `matches`/`closest`/`querySelector`/`querySelectorAll` for comma lists of `tag`, `.class`, `[attr="value"]` and their compounds (`math[display="block"]`); no layout, so sentence targets use their no-layout fallbacks. `fixture()` builds, as marked renders `FIXTURE_MARKDOWN` (Shared definitions; copy `FIXTURE_SPOKEN`, `CODE_LINES` and `fixtureSpoken` into the test file too): `article > h1, h2, p, table (thead > tr > th×3, tbody > tr > td×3 ×2, with "\n" text nodes between cells), div.code-shell > pre[aria-label="python code"] > code (the six lines and a trailing "\n"), div.code-shell > pre[aria-label="text code"] > code (the three ASCII-art lines), p (text, br, text), p (the Unicode sentence), p > math[display="block"] > semantics > mrow (the Accuracy MathML), div.diagram-shell[data-diagram-status="pending"] > div.mermaid[data-diagram-status="pending"] (the flowchart source as text), p (the 250-character sentence)`. Then:

```js
import { SPEECH_MARK, buildSpeechQueue } from "./speech.js";
import { blockAt, buildSpeechTarget, buildSpeechUnits, readableBlocks, speechBlockText } from "./speechContent.js";
import { verbalizeMath } from "./mathSpeech.js";

const spoken = (root, options) => buildSpeechQueue(buildSpeechUnits(root, options)).queue.map((entry) => entry.text);

test("the fixture lecture speaks exactly this in every code and table setting", () => {
  assert.deepEqual(spoken(fixture()), FIXTURE_SPOKEN);
  for (const code of ["announce", "skip", "read"]) {
    for (const tables of ["rows", "announce"]) assert.deepEqual(spoken(fixture(), { code, tables }), fixtureSpoken({ code, tables }), `${code}/${tables}`);
  }
});

test("every unit carries blockIndex, start, end and map, and text units tile their block", () => {
  const root = fixture();
  const blocks = readableBlocks(root);
  const units = buildSpeechUnits(root, { code: "read" });
  for (const unit of units) {
    const block = blocks[unit.unit.blockIndex];
    assert.ok(block, `unit “${unit.text}” names block ${unit.unit.blockIndex}`);
    if (unit.kind === "announcement") assert.deepEqual([unit.unit.start, unit.unit.end, unit.map], [0, 0, []]);
  }
  blocks.forEach((block, index) => {
    const own = units.filter((unit) => unit.unit.blockIndex === index && unit.kind !== "announcement");
    if (!own.length) return;
    assert.equal(own[0].unit.start, 0);
    own.forEach((unit, at) => { if (at) assert.equal(unit.unit.start, own[at - 1].unit.end); });
    assert.equal(own.at(-1).unit.end, speechBlockText(block).length);
  });
  assert.equal(blockAt(root, 2), blocks[2]);
  // A plain paragraph's units are its source sentences.
  const paragraph = el("p", {}, [text("Gradient descent moves downhill.  Learning rate\ncontrols each step.")]);
  const article = el("article", {}, [paragraph]);
  assert.deepEqual(buildSpeechUnits(article).map(({ unit }) => speechBlockText(paragraph).slice(unit.start, unit.end).trim()), ["Gradient descent moves downhill.", "Learning rate controls each step."]);
});

test("MathML is read aloud, once, by its structure", () => {
  const read = (node) => verbalizeMath(el("math", { display: "block" }, [el("semantics", {}, [el("mrow", {}, [node].flat())])])).text;
  const mi = (value) => el("mi", {}, [text(value)]);
  const mo = (value, attrs = {}) => el("mo", attrs, [text(value)]);
  const mn = (value) => el("mn", {}, [text(value)]);
  const row = (...children) => el("mrow", {}, children);
  assert.equal(read([el("mtext", {}, [text("Accuracy")]), mo("="), el("mfrac", {}, [row(mi("T"), mi("P"), mo("+"), mi("T"), mi("N")), row(mi("T"), mi("P"), mo("+"), mi("T"), mi("N"), mo("+"), mi("F"), mi("P"), mo("+"), mi("F"), mi("N"))])]), "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N");
  assert.equal(read([el("mover", {}, [mi("y"), mo("\u0302", { accent: "true" })]), mo("="), el("msub", {}, [mi("f"), mi("θ")]), mo("(", { form: "prefix" }), mi("x"), mo(")", { form: "postfix" }), mi(".")]), "y hat equals f theta of (x).");
  assert.equal(read(el("mfrac", {}, [mn("1"), mi("n")])), "1 over n");
  assert.equal(read([el("munderover", {}, [mo("∑"), row(mi("i"), mo("="), mn("1")), mi("n")]), el("msub", {}, [mi("x"), mi("i")])]), "sum from i equals 1 to n of x i");
  assert.equal(read([row(el("mi", { mathvariant: "normal" }, [text("arg")]), mo("\u2061")), el("munder", {}, [el("mi", { mathvariant: "normal" }, [text("min")]), mi("θ")])]), "arg min over theta");
  assert.equal(read(el("msup", {}, [mi("θ"), mo("*")])), "theta star");
  assert.equal(read(el("msup", {}, [mi("X"), mi("T")])), "X transpose");
  assert.equal(read(el("msup", {}, [mi("A"), row(mo("−"), mn("1"))])), "A inverse");
  assert.equal(read(el("msup", {}, [mi("γ"), mi("k")])), "gamma to the power of k");
  assert.equal(read(el("msub", {}, [mi("r"), row(mi("t"), mo("+"), mi("k"), mo("+"), mn("1"))])), "r sub t plus k plus 1");
  assert.equal(read(el("msqrt", {}, [mi("x")])), "square root of x");
  assert.equal(read([mi("P"), mo("(", { form: "prefix" }), mi("y"), mo("="), mn("1"), mo("∣"), mi("x"), mo(")", { form: "postfix" })]), "P of (y equals 1 given x)");
  assert.equal(verbalizeMath(el("math", {}, [el("semantics", {}, [row(mi("x")), el("annotation", { encoding: "application/x-tex" }, [text("x")])])])).text, "x");
});

test("an edited copy's KaTeX is read once and inline math joins its sentence", () => {
  const katex = el("span", { class: "katex" }, [
    el("span", { class: "katex-mathml" }, [el("math", {}, [el("semantics", {}, [el("mrow", {}, [el("mi", {}, [text("L")])]), el("annotation", { encoding: "application/x-tex" }, [text("L")])])])]),
    el("span", { class: "katex-html", "aria-hidden": "true" }, [text("L")]),
  ]);
  const paragraph = el("p", {}, [text("The loss "), katex, text(" is low. Next.")]);
  assert.deepEqual(spoken(el("article", {}, [paragraph])), ["The loss L is low.", "Next."]);
});

test("irregular tables read without empty labels", () => {
  const cell = (tag, value) => el(tag, {}, value ? [text(value)] : []);
  const table = (...rows) => el("table", {}, [el("tbody", {}, rows.map((cells) => el("tr", {}, cells)))]);
  assert.deepEqual(spoken(el("article", {}, [table([cell("td", "a"), cell("td", "b")], [cell("td", "c"), cell("td", "")])])), ["Table, 2 columns.", "Row 1. a; b.", "Row 2. c."]);
  const headed = el("table", {}, [
    el("thead", {}, [el("tr", {}, [cell("th", "Name"), cell("th", "")])]),
    el("tbody", {}, [el("tr", {}, [cell("td", "x"), cell("td", "y"), cell("td", "z")])]),
  ]);
  assert.deepEqual(spoken(el("article", {}, [headed])), ["Table, 3 columns: Name.", "Row 1. Name: x; y; z."]);
});

test("code is announced, skipped or read, and text diagrams are always announced", () => {
  const pre = (label, body) => el("div", { class: "code-shell" }, [el("pre", { "aria-label": `${label} code` }, [el("code", {}, [text(body)])])]);
  assert.deepEqual(spoken(el("article", {}, [pre("text", "context -> model\n")])), ["Code example, 1 line."]);
  assert.deepEqual(spoken(el("article", {}, [pre("js", "a()\nb()\n")])), ["JavaScript example, 2 lines."]);
  assert.deepEqual(spoken(el("article", {}, [pre("ini", "a=1\n")])), ["INI example, 1 line."]);
  assert.deepEqual(spoken(el("article", {}, [pre("haskell", "main = pure ()\n")])), ["Haskell example, 1 line."]);
  for (const code of ["announce", "skip", "read"]) assert.deepEqual(spoken(el("article", {}, [pre("text", "a ─┐\n  ├─> b\n")]), { code }), ["Text diagram, 2 lines."], code);
  const item = el("li", {}, [text("Run this first:"), pre("bash", "make test\n"), text(" then check.")]);
  assert.deepEqual(spoken(el("article", {}, [el("ul", {}, [item])])), ["Run this first:", "then check.", "Shell example, 1 line."]);
});

test("a diagram is described from its definition, never its diagnostic", () => {
  const shell = (status, inner, attrs = {}) => el("div", { class: "diagram-shell", "data-diagram-status": status }, [el("div", { class: "mermaid", "data-diagram-status": status, ...attrs }, inner)]);
  const definition = "flowchart LR\n  A[Data] --> B[Model]\n  B --> C[Prediction]";
  assert.deepEqual(spoken(el("article", {}, [shell("pending", [text(definition)])])), ["Diagram: Flowchart: Data leads to Model leads to Prediction."]);
  assert.deepEqual(spoken(el("article", {}, [shell("rendered", [el("svg", {}, [text("DataModelPrediction")])], { "aria-label": "Flowchart: Data → Model → Prediction" })])), ["Diagram: Flowchart: Data leads to Model leads to Prediction."]);
  assert.deepEqual(spoken(el("article", {}, [shell("error", [el("p", {}, [text("The Mermaid module could not be loaded.")]), el("pre", {}, [text(definition)])])])), ["Diagram."]);
});

test("<br> and nested blocks are sentence breaks; headings end as sentences", () => {
  assert.deepEqual(spoken(el("article", {}, [el("h2", {}, [text("6. Task taxonomy")]), el("p", {}, [text("First line"), el("br"), text("Second line")])])), ["6. Task taxonomy.", "First line.", "Second line."]);
  assert.deepEqual(spoken(el("article", {}, [el("blockquote", {}, [el("p", {}, [text("One idea")]), el("p", {}, [text("Another idea")])])])), ["One idea.", "Another idea."]);
  const units = buildSpeechUnits(el("article", {}, [el("p", {}, [text("Call "), el("code", {}, [text("a/b = c")]), text(" ≈ 2.")])]));
  assert.ok(units[0].text.includes(SPEECH_MARK.plainOpen));
  assert.deepEqual(buildSpeechQueue(units).queue.map((entry) => entry.text), ["Call a/b = c approximately 2."]);
});

test("the sentence target is one unit and the document target carries units", () => {
  const root = fixture();
  const documentTarget = buildSpeechTarget({ scope: "document", article: root });
  assert.equal(documentTarget.units.length, buildSpeechUnits(root).length);
  assert.ok(documentTarget.text.startsWith("Speakable fixture. 6. Task taxonomy."));
  const sentence = buildSpeechTarget({ scope: "sentence", article: root, scrollContainer: { getBoundingClientRect: () => ({ top: 0, height: 800 }) } });
  assert.equal(sentence.units.length, 1);
});
```

In `src/lib/mermaidDiagrams.test.mjs`:

```js
test("diagramDescriptionFor reads a pending diagram's definition and a drawn one's label", () => {
  const node = (status, textContent, label = "") => ({ dataset: { diagramStatus: status }, textContent, getAttribute: (name) => (name === "aria-label" ? label : null), classList: { contains: (name) => name === "mermaid" }, querySelector: () => null });
  assert.equal(diagramDescriptionFor(node("pending", "flowchart LR\n  A[Data] --> B[Model]")), "Flowchart: Data → Model");
  assert.equal(diagramDescriptionFor(node("rendering", "flowchart LR\n  A --> B")), "Flowchart: A → B");
  assert.equal(diagramDescriptionFor(node("rendered", "DataModel", "Flowchart: Data → Model")), "Flowchart: Data → Model");
  assert.equal(diagramDescriptionFor(node("error", "Diagram renderer unavailable The Mermaid module could not be loaded.")), "");
});
```

and update the six `speech.test.mjs` assertions listed above.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/speechContent.test.mjs src/lib/mermaidDiagrams.test.mjs src/lib/speech.test.mjs`
Expected: FAIL — `speechContent.test.mjs` cannot import `buildSpeechUnits`/`readableBlocks`/`blockAt`/`speechBlockText` (`does not provide an export named`) and `./mathSpeech.js` does not exist; `diagramDescriptionFor` is not exported; the six updated `speech.test.mjs` assertions fail with today's joined headings (quote one).

- [ ] **Step 3: Implement** `mathSpeech.js`, `diagramDescriptionFor`, and the `speechContent.js` changes as specified in Interfaces.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/speechContent.test.mjs src/lib/mermaidDiagrams.test.mjs src/lib/speech.test.mjs && npm run check`
Expected: all pass. In `npm run check`'s `audit:app` output the startup entry grows by at most 1 KB in this task (only `mermaidDiagrams.js` changed among entry modules) and the install route screens grow by the Reader chunk's new code; record both lines.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/mathSpeech.js src/lib/speechContent.js src/lib/mermaidDiagrams.js src/lib/speechContent.test.mjs src/lib/mermaidDiagrams.test.mjs src/lib/speech.test.mjs
git commit -m "Build speech units from the article: rows, code, diagrams and MathML"
git push
```

The commit body names the six `speech.test.mjs` assertions changed on purpose (headings now end as sentences).

---

### Task 4: Persist `narrationCode`, `narrationTables` and empty spoken forms

**Files:**
- Modify: `src/lib/db.js:919-943` (defaults), `:1419-1447` (normalizer)
- Test: `scripts/unit_audit.mjs`, `src/lib/backup.test.mjs`, `src/lib/profileSync.test.mjs`

**Interfaces:**
- Produces: `initialProfile.settings.narrationCode === "announce"`, `initialProfile.settings.narrationTables === "rows"`; `normalizeProfile` keeps `narrationCode` only when it is one of `"announce" | "skip" | "read"` and `narrationTables` only when one of `"rows" | "announce"` (literal arrays in `db.js`, as its other settings do; a test pins them equal to `NARRATION_CODE_MODES`/`NARRATION_TABLE_MODES`), else the defaults; `pronunciations` keeps an entry whose trimmed `spoken` is `""` (the skip rule) and still drops an empty term.
- The settings merge is already per key (`mergeObjectFields`, `profileSync.js:755`); this task only proves it for the new keys.

- [ ] **Step 1: Write the failing tests**
  - `scripts/unit_audit.mjs`, next to the existing `normalized.settings` checks (`:75-92`):

```js
const narration = normalizeProfile({ settings: { narrationCode: "read", narrationTables: "announce", pronunciations: [{ term: "um", spoken: "" }, { term: " ", spoken: "x" }, { term: "ReLU", spoken: " ray loo " }] } });
assert.equal(narration.settings.narrationCode, "read");
assert.equal(narration.settings.narrationTables, "announce");
assert.deepEqual(narration.settings.pronunciations, [{ term: "um", spoken: "" }, { term: "ReLU", spoken: "ray loo" }]);
const invalidNarration = normalizeProfile({ settings: { narrationCode: "verbatim", narrationTables: 3 } });
assert.equal(invalidNarration.settings.narrationCode, "announce");
assert.equal(invalidNarration.settings.narrationTables, "rows");
assert.equal(normalizeProfile({}).settings.narrationCode, "announce");
const { NARRATION_CODE_MODES, NARRATION_TABLE_MODES } = await import("../src/lib/speech.js");
for (const mode of NARRATION_CODE_MODES) assert.equal(normalizeProfile({ settings: { narrationCode: mode } }).settings.narrationCode, mode);
for (const mode of NARRATION_TABLE_MODES) assert.equal(normalizeProfile({ settings: { narrationTables: mode } }).settings.narrationTables, mode);
```

  - `src/lib/backup.test.mjs`: in `records()`, set `settings: { ...initialProfile.settings, narrationCode: "skip", narrationTables: "announce", pronunciations: [{ term: "ReLU", spoken: "ray loo" }, { term: "um", spoken: "" }] }`; in the v4 round-trip test assert `checked.data.profile.settings.narrationCode === "skip"`, `narrationTables === "announce"` and `deepEqual(checked.data.profile.settings.pronunciations, [{ term: "ReLU", spoken: "ray loo" }, { term: "um", spoken: "" }])`.
  - `src/lib/profileSync.test.mjs`:

```js
test("narration settings changed in two tabs merge per key", () => {
  const base = normalizeProfile(initialProfile);
  const local = normalizeProfile({ ...base, settings: { ...base.settings, narrationCode: "skip" } });
  const remote = normalizeProfile({ ...base, settings: { ...base.settings, narrationTables: "announce", pronunciations: [{ term: "um", spoken: "" }] } });
  const { profile } = mergeProfileVersions(base, local, remote, { now: NOW, writerId: "tab-a" });
  assert.equal(profile.settings.narrationCode, "skip");
  assert.equal(profile.settings.narrationTables, "announce");
  assert.deepEqual(profile.settings.pronunciations, [{ term: "um", spoken: "" }]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run audit:unit; node --test src/lib/backup.test.mjs src/lib/profileSync.test.mjs`
Expected: FAIL — `narrationCode` is `undefined` (the normalizer drops unknown keys) and the empty spoken form is dropped.

- [ ] **Step 3: Implement** the defaults and the normalizer lines.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run audit:unit && node --test src/lib/backup.test.mjs src/lib/profileSync.test.mjs && npm run audit:ai`
Expected: all pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/db.js scripts/unit_audit.mjs src/lib/backup.test.mjs src/lib/profileSync.test.mjs
git commit -m "Store the narration code and table choices and allow skipped terms"
git push
```

---

### Task 5: The Reader and Teaching Mode narrate units; positions use them

**Files:**
- Modify: `src/components/Reader.jsx` (`speechTarget` `:682-689`, `readSpeechTarget` `:697-722`, auto-narrate `:732-741`, block follow `:747-769`, position write `:774-781`, bookmarks `:976-999`, the `TeachingMode` element `:1252`)
- Modify: `src/components/TeachingMode.jsx` (`narrate` `:125-128`; new prop `narration`)
- Modify: `src/lib/narrationPositions.js` (`normalizePosition`, `locatePosition`), `src/lib/audioBookmarks.js` (`normalize`, `addAudioBookmark`)
- Test: `src/lib/narrationPositions.test.mjs`, `src/lib/audioBookmarks.test.mjs`, `scripts/audio_audit.mjs`

**Interfaces:**
- Consumes: `buildSpeechTarget(…, code, tables)` → `{ units }`, `buildSpeechUnits`, `blockAt`, `readableBlocks` (Task 3); `speech.queueUnits`, `speech.currentIndex` (Task 2); `settings.narrationCode`/`narrationTables` (Task 4).
- Reader: every `speechTarget()` call passes `code: settings.narrationCode, tables: settings.narrationTables`; every `speech.speak(target.text, …)` for a built target becomes `speech.speak(target.units?.length ? target.units : target.text, …)` (keep `sections: target.sections` only for the text fallback). Selection stays `speech.speak(selectedText, { label: "Selection" })`.
- Block follow (the AUDIO-001 effect, kept until #101 replaces it): while `speech.status === "speaking"` and the label is `Full lecture` or `Current section`, the block is `blockAt(article, entry.unit.blockIndex)` for `entry = speech.queueUnits[speech.currentIndex]`; the old needle search runs only when `entry?.unit` is null. Dependencies add `speech.currentIndex` and `speech.queueUnits`.
- Positions: `writePosition(document.id, { index, total, snippet, section, blockIndex, start })` with `blockIndex`/`start` from `speech.queueUnits[speech.currentIndex]?.unit` (omitted when null); `addAudioBookmark` gets the same two fields. `normalizePosition` and the bookmark `normalize` keep `blockIndex` and `start` when they are whole numbers. `locatePosition` tries them first: the candidate is the first entry with `unit.blockIndex === saved.blockIndex` and `unit.start <= saved.start < max(unit.end, unit.start + 1)`; it is used (`how: "unit"`) only when it is usable (never the last chunk unless `allowLast`) and either the stored snippet is empty, the entry's text starts with it, or `saved.total === queue.length`; otherwise the existing chain runs unchanged.
- TeachingMode: prop `narration = { code: "announce", tables: "rows" }` (the Reader passes `{ code: settings.narrationCode, tables: settings.narrationTables }`). `narrate()` builds `buildSpeechUnits(root, narration)` where `root` is `articleRef.current`, or, when the slide is concealed, the `content` of a `<template>` whose `innerHTML` is `renderReaderMarkdown(current.markdown)` (inert: loads no images). It speaks the units, or `""` when there are none (the existing "no readable text" message), with the label `Teaching section ${index + 1}`. `plainTextFromMarkdown` is no longer imported.

- [ ] **Step 1: Write the failing tests**
  - `src/lib/narrationPositions.test.mjs`:

```js
const unitEntry = (text, blockIndex, start, end, section = "S") => ({ text, unit: { blockIndex, start, end }, map: [], section });
test("a saved unit is tried first and confirmed by its snippet or the queue length", () => {
  const queue = [unitEntry("Title.", 0, 0, 5), unitEntry("First sentence.", 1, 0, 16), unitEntry("Second, reworded.", 1, 16, 34), unitEntry("End.", 2, 0, 4)];
  // Reworded by an override: same queue length, so the coordinates stand.
  assert.deepEqual(locatePosition({ v: 2, index: 0, total: 4, snippet: "Second sentence", section: "S", blockIndex: 1, start: 16 }, queue, []), { index: 2, how: "unit" });
  // Snippet confirms even when the length changed.
  assert.deepEqual(locatePosition({ v: 2, index: 9, total: 7, snippet: "Second, re", section: "S", blockIndex: 1, start: 20 }, queue, []), { index: 2, how: "unit" });
  // Shifted blocks: the coordinates point at another sentence, the length differs, so the snippet search decides.
  assert.deepEqual(locatePosition({ v: 2, index: 1, total: 9, snippet: "First sentence.", section: "S", blockIndex: 2, start: 0 }, queue, []), { index: 1, how: "exact" });
  // Never the last chunk.
  assert.equal(locatePosition({ v: 2, index: 0, total: 4, snippet: "", section: "S", blockIndex: 2, start: 0 }, queue, []).index !== 3, true);
  assert.deepEqual(normalizePosition({ index: 2, total: 4, snippet: "x", section: "S", blockIndex: 1, start: 16 }), { v: 2, index: 2, total: 4, snippet: "x", section: "S", blockIndex: 1, start: 16 });
  assert.deepEqual(normalizePosition({ index: 2, blockIndex: -1, start: 1.5 }), { v: 2, index: 2, total: 0, snippet: "", section: "" });
});
```

  - `src/lib/audioBookmarks.test.mjs`: a saved bookmark with `blockIndex: 3, start: 40` lists back with both fields; one saved without them lists without them.
  - `scripts/audio_audit.mjs`: an `issue100Failures` list and `issue100Case = narrationCase(issue100Failures)`, added to the final `narrationFailures` list as `["#100", issue100Failures]`, and the closing "Audio audit passed" line names the new checks. Helpers: `seedFixture(casePage, settings)` puts `FIXTURE_MARKDOWN` (Shared definitions; copy it, `FIXTURE_SPOKEN`, `CODE_LINES` and `fixtureSpoken` into the audit) into the stored profile as `{ id: "custom/speakable-fixture.md", title: "Speakable fixture", raw, createdAt, updatedAt, tags: [], collectionId: "", archived: false, pinned: false }` with `settings` merged into `profile.settings`, by the read-modify-write of `scripts/chunk_recovery_audit.mjs:143-156` after the first page load, then opens `#/read/custom%2Fspeakable-fixture.md` and reloads; `readFull(casePage)` opens the panel, chooses Full, reads, and returns `speakQueue(casePage)`.

  Cases (each in its own context):
  - (a) "the fixture in every code and table setting": for each of the six `{ narrationCode, narrationTables }` pairs, `readFull` equals `fixtureSpoken({ code, tables })`. While `Row 1.` is speaking, `.markdown-body tr.narration-active` exists (the block follow by `blockIndex`).
  - (b) "chapter 1 speaks per sentence": `readFull` on `notes/part-01-foundations/01-ai-ml-mental-model.md`; then in the page collect every `h1–h4` text (whitespace collapsed). Assert: every heading is its own utterance (some utterance equals `endSentence(speakable(heading))`, computed in Node by importing `src/lib/speech.js` into the audit); no utterance contains a heading's text followed by a space and a letter or digit (0 run-ins); no utterance matches `/^\(?(?:\d+(?:\.\d+)*|[A-Za-z]|[ivxlcdm]+)[.):]?\)?$/u` (0 enumerator-only); every utterance under 3 words equals, minus a final `.`, the collapsed text of some `.markdown-body` block (a whole heading or item, not a fragment); no utterance contains `context/state` or `->` (code is announced); log the counts.
  - (c) "diagrams are described in every state": the fixture with Mermaid (1) pending — intercept the `/assets/mermaid.core-` request and hold it until the case ends, assert `.diagram-shell[data-diagram-status="pending"], .diagram-shell[data-diagram-status="rendering"]` before reading; (2) rendered — wait for `[data-diagram-status="rendered"]`; (3) failed offline — the `prepare` of the existing "Mermaid unavailable" case (`:659-670`), wait for `[data-diagram-status="error"]`. Each time the queue holds `Diagram: Flowchart: Data leads to Model leads to Prediction.` and no utterance matches `/Mermaid module|Diagram renderer|flowchart LR|-->|Show Mermaid source|Retry diagram/u`.
  - (d) "Teaching Mode reads the slide's math": open Teach on the fixture, move to the slide holding the formula, press the narration control, end utterances until one is exactly `The model predicts y hat equals w transpose x plus b for each input.` (assert it was); then Stop, press `Hide teaching content for recall`, narrate again, and assert the same utterance is spoken from the concealed slide.
  - (e) "a saved unit resumes after the spoken text changed": read the fixture, step with Next to `Row 2.`, read `localStorage["lumen-narration-custom/speakable-fixture.md"]` and assert it holds `blockIndex` and `start`; Stop; overwrite the stored `snippet` with `"A snippet no entry has"` and `total` unchanged; Read again; assert the bar shows the same index and the utterance starts with `Row 2.`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/narrationPositions.test.mjs src/lib/audioBookmarks.test.mjs; npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- audio`
Expected: FAIL — the unit tests on `how: "unit"` and the kept fields; the audit's `issue #100 narration cases failed` with (a) the fixture's sentences packed together (the Reader still speaks the target's joined text), (b) headings not spoken as their own utterances, (c) no utterance that is exactly the `Diagram:` sentence, (d) the formula sentence never spoken on its own (Teaching still speaks `plainTextFromMarkdown`), (e) no `blockIndex` stored. Quote the failure lines. (Against main itself the same cases fail harder: run-ins, `6.`, flattened cells and symbols.)

- [ ] **Step 3: Implement** the Reader, Teaching Mode, positions and bookmarks changes as specified in Interfaces.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/narrationPositions.test.mjs src/lib/audioBookmarks.test.mjs && npm run check && npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- audio a11y`
Expected: all pass, including every #96 and #97 case unchanged (the first utterance `Chapter 1 — The AI/ML Mental Model.` is highlighted through `blockIndex`, so `:140` still finds `.narration-active`) and the a11y `narration-speaking` state. Record the `audit:app` lines.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/Reader.jsx src/components/TeachingMode.jsx src/lib/narrationPositions.js src/lib/audioBookmarks.js src/lib/narrationPositions.test.mjs src/lib/audioBookmarks.test.mjs scripts/audio_audit.mjs
git commit -m "Narrate lectures and slides by unit and resume by block and offset"
git push
```

---

### Task 6: The Narration card in Settings

**Files:**
- Modify: `src/components/Settings.jsx:117-137` (the card), its props
- Modify: `src/App.jsx:3325` (pass `speech={speech}` to `SettingsView`)
- Modify: `src/styles.css` (the card's rules, next to `.pronunciation-editor` `:8319-8321`, and the phone rule at `:8697-8700`)
- Modify: `src/components/DeviceEvidence.jsx` (`HUMAN_CHECKS`)
- Test: `scripts/audio_audit.mjs`, `scripts/a11y_audit.mjs`, `scripts/cross_tab_audit.mjs`

**Interfaces:**
- Consumes: `parsePronunciationLines`, `normalizePronunciations`, `samePronunciations`, `PRONUNCIATION_PACK`, `PRONUNCIATION_TEST_LABEL`, `NARRATION_CODE_MODES`, `NARRATION_TABLE_MODES`, `buildSpeechQueue` (entry modules only); `speech.speak(text, { label, pronunciations })`, `speech.stop`, `speech.status`, `speech.activeLabel`, `speech.supported` (Task 2).
- The card (`<section className="settings-card settings-narration" aria-labelledby="settings-narration-title">`), in this order:
  1. Heading `Narration`, subtitle `How code, tables and terms are read aloud.`
  2. `Code blocks`: a `role="radiogroup"` labelled by its visible label, three `role="radio"` buttons `Announce`, `Skip`, `Read aloud` (values from `NARRATION_CODE_MODES`) with the `.theme-choices` keyboard contract (one tab stop, arrows and Home/End move and select); a change calls `onSettingsChange({ narrationCode })`.
  3. `Tables`: the same with `Read rows`, `Announce only` → `narrationTables`.
  4. The editor, keeping `label.pronunciation-editor` and its `textarea` (and its `aria-label`): visible text `One override per line, as <code>term = spoken form</code>. <code>term =</code> skips the term.`; the textarea is uncontrolled as today but also tracks its draft in state on input. On blur, `next = parsePronunciationLines(event.target.value)`; when `samePronunciations(next, settings.pronunciations)`, nothing happens; otherwise `onSettingsChange({ pronunciations: next })` and the toast `` `${n} pronunciation override${n === 1 ? "" : "s"} saved.` `` (or `Pronunciation overrides cleared.` for an empty list).
  5. Microcopy: `Overrides apply to narration only, match whole words case-insensitively, take priority over the built-in list, and are limited to 50 terms. They sync with your profile.`
  6. `Try it`: a labelled text field (initial value `ReLU and tanh; ŷ = wᵀx + b.`), a `Speak` button (`Stop` while `speech.activeLabel === PRONUNCIATION_TEST_LABEL` and speaking or paused; disabled when unsupported or the field is blank) that calls `speech.speak(value, { label: PRONUNCIATION_TEST_LABEL, pronunciations: parsePronunciationLines(draft) })`, and a line `Heard as: <text>` showing `buildSpeechQueue(value, { pronunciations: parsePronunciationLines(draft) }).queue.map((entry) => entry.text).join(" ")` (plain text, not a live region).
  7. `<details className="narration-pack">` with `<summary>Built-in pronunciations (119)</summary>` (the count from `PRONUNCIATION_PACK.length`) and a list of `term` → `spoken`, the arrow `aria-hidden` with a visually hidden ` said as `.
- CSS: theme tokens only; the radio buttons, the summary and the Speak button are at least 44 px tall and the field and textarea text is `max(16px, 1rem)` under `@media (max-width: 740px), (pointer: coarse)` (add `.settings-narration` to the REV-10 rule); wraps without horizontal scroll at 320 px and 200% text.
- DeviceEvidence `HUMAN_CHECKS` gains `{ id: "voice-ml-terms", area: "Narration of formulas and terms (AUDIO-001, issue #100)", criterion: "In Settings → Narration, Try it read “ReLU and tanh; ŷ = wᵀx + b.” as “ray-loo and tanch; y hat equals w transpose x plus b.” with the voice you listen with, and a lecture's table, code block and diagram were announced as on screen. Note any built-in pronunciation this voice gets wrong." }`.

- [ ] **Step 1: Write the failing tests**
  - `scripts/audio_audit.mjs` (`issue100Case`; open Settings with `button[aria-label="Open settings"]` and wait for `.settings-drawer .settings-narration`):
    - (f) "Try it speaks the exact pipeline": the Heard-as line reads `Heard as: ray-loo and tanch; y hat equals w transpose x plus b.`; Speak makes `speechSynthesis.current.text` equal `ray-loo and tanch; y hat equals w transpose x plus b.`; the button then reads `Stop` and stops it.
    - (g) "an override, a skip and the toast": type `ReLU = rectifier` then a new line `um =` into the textarea with input events (not blur yet); set the Try-it field to `ReLU um works` → Heard as `rectifier works`; blur the textarea → exactly one `.toast` with `2 pronunciation overrides saved.`; focus and blur again unchanged → no new toast within 1 s (a bounded check that nothing happens); the stored profile (`pollValue`) holds both entries, the second with `spoken: ""`.
    - (h) "the Code and Tables choices": focus `Announce`, press ArrowRight → `Skip` is checked and focused; press End → `Read aloud`; choose `Skip` and `Announce only`; `pollValue` until the stored settings hold `narrationCode: "skip"`, `narrationTables: "announce"`; the fixture (seeded with no settings override) then reads `fixtureSpoken({ code: "skip", tables: "announce" })`.
    - (i) "Try it over the Reader": with chapter 1 reading in the Reader (position saved at index 4 or later), open Settings and Speak; assert the Reader's stored `lumen-narration-…` value is unchanged, no toast contains `Open the lecture`, and Stop clears the player.
    - (j) "the card fits phones": at 393×852 and 320×568, at 100% and 200% text, with the details open: `.settings-drawer` `scrollWidth <= clientWidth + 1`; every radio, the summary and Speak are ≥ 44 px tall; the textarea's and the field's computed `font-size` is ≥ 16 px.
  - `scripts/a11y_audit.mjs` `STATES`: `{ name: "settings-narration", route: ROUTES[0], setup: open Settings, open the details, type in Try it, ready: ".settings-narration details[open]", close: close Settings }`.
  - `scripts/cross_tab_audit.mjs`: after the theme step, tab B opens Settings and chooses `Skip` for Code blocks; tab A's stored profile reaches `narrationCode: "skip"` (`pollValue`); tab A then chooses `Announce only`; both stored profiles hold both values; extend its closing line.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- audio a11y sync`
Expected: FAIL — no `.settings-narration` (cases f–j, the a11y state "could not be scanned", the sync step); the toast appears on every blur today (g). Quote them.

- [ ] **Step 3: Implement** the card, the App prop, the CSS and the device-evidence check as specified.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/themeContrast.test.mjs && npm run check && LUMEN_BROWSER_RETRIES=0 /Users/macbookpro/Desktop/ML-learning/.claude/bin/gate-slot npm run check:browser -- audio a11y sync responsive controls`
Expected: all pass; axe reports nothing for `settings-narration` in Paper, Night and Contrast at phone and desktop. Record `audit:app`.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/Settings.jsx src/App.jsx src/styles.css src/components/DeviceEvidence.jsx scripts/audio_audit.mjs scripts/a11y_audit.mjs scripts/cross_tab_audit.mjs
git commit -m "Give narration a Settings card with code, table, skip and try-it controls"
git push
```

---

### Task 7: Documentation (after the full gate)

**Files:**
- Modify: `docs/internal/PRODUCT_REQUIREMENTS.md` — append one dated row (`date +%F`) to the verification log after the last row: `| <date> | Read-aloud speaks formulas, code, tables and diagrams (issue #100; AUDIO-001, A11Y-001 partials) | <evidence: unit and browser checks, the chapter-1 counts, gate results, budgets> |`; change a status row only if this genuinely changes it.
- Modify: `docs/FUNCTIONAL_TESTING.md` — append `## Bugs reproduced on <date>: read-aloud of ML content (#100)`: what each new check proved and how it failed before (quote Tasks 1–6).
- Modify: `docs/guides/APP_GUIDE.md` — where Listen is described: headings and rows end as sentences, formulas are read in words, code and diagrams are announced, the Narration card (Code blocks, Tables, overrides with `term =` to skip, Try it, the built-in list).
- Modify: `docs/DEVICE_TESTING.md` — `## Read-aloud of formulas and terms (issue #100)`: run the `voice-ml-terms` check in `#/device-evidence` with each voice you use; listen to a lecture table, a code block and a diagram on the iPhone.
- Modify: `docs/internal/ENGINEERING_HANDOFF.md` §9.1 — the unit contract (blocks are `readableBlocks`, `unit.start/end` in `speechBlockText` coordinates, announcement units `0/0` with an empty map, queue entries and `queueUnits`) for #101, #103 and #122.
- Never mention internal docs in README.md.

**Interfaces:**
- Consumes: the orchestrator's gate results (`npm run check`, the full `check:browser`, retries), the `audit:app` budget lines, and the failing-before quotes from Tasks 1–6.

- [ ] **Step 1: Write the five edits.** Append only; never rewrite earlier rows.
- [ ] **Step 2: Verify:** `git diff --check` is clean and `git diff --stat` shows only these five files.
- [ ] **Step 3: Commit and push:** `git commit -m "Record the read-aloud verbalization and its checks"`; `git push`.

---

## Decisions made while planning (rulings)

- Ruling: REA capture skipped — #100 depends on no reference platform's interaction flow, and the research doc already covers how Speechify, Omnivore and Apple handle code and pronunciations — costs little if wrong: a competitor's phrasing could differ from ours, which the issue fixes anyway.
- Ruling: the text path (Selection, tutor Listen, voice preview, Try it) keeps packing whole sentences up to 180 characters; only DOM units are one sentence each — the tutors' audits pin a first utterance that merges a heading and a sentence, and those paths have no highlight — if wrong, tutor utterances stay longer than lecture ones.
- Ruling: Code `Skip` speaks nothing for the block — "Skip" reads as silence — if wrong, a listener cannot tell code was there; a one-line announcement is a small change.
- Ruling: a block with box-drawing characters is `Text diagram, N lines.` in all three code modes, including Skip — it is a diagram, and diagrams are always described — if wrong, Skip listeners hear one extra line per text diagram.
- Ruling: a fence without a language reads `Code example, N lines.`; an unknown language is capitalised (uppercased up to 3 letters) — if wrong, a rare label sounds odd.
- Ruling: `Announce only` adds the row count (`Table, 3 columns, 2 rows: …`) — tells the listener how much was skipped — if wrong, one extra phrase per table.
- Ruling: a fraction of two single tokens reads `1 over n`; others keep the issue's `A, over, B` — the commas only help compound fractions — if wrong, simple fractions sound slightly different from compound ones.
- Ruling: the Unicode table is extended beyond the issue's (×, ÷, ·, ∂, ′, ∞, →, ⇒, ∝, ∼, the other operators listed in Task 1) and function application reads `of` inside formula runs — the corpus survey (× 123, ÷ 32, ∂ 57, → 113 prose lines) shows them in use — if wrong, a rare construct (a limit `x → 0`) reads awkwardly as `leads to`.
- Ruling: `→` reads `leads to` everywhere — most prose arrows are flow arrows and the issue fixes the diagram reading — if wrong, limits and mappings read awkwardly.
- Ruling: the existing spoken-block follow finds its block by the entry's `blockIndex` — the needle search fails once headings end with `.` and text is verbalised, and `audio_audit.mjs:140` would go red — if wrong, a small overlap with #101, which replaces the effect.
- Ruling: a saved `{blockIndex, start}` is used only when the snippet or an equal queue length confirms it — one inserted paragraph shifts every later block — if wrong, an edited and reworded sentence falls back to the snippet and section rules, as before.
- Ruling: Current section derives section skips within the section (H3s inside an H2) from the units' labels — the queue builder has one rule for every scope — if wrong, the player shows section skip buttons in a scope that had none.
- Ruling: pack terms match case-insensitively unless marked `matchCase` (MAP, mAP, RAG, ANN, HMM, KV, A/B, WER, GiB) — their lowercase forms are words or other terms — if wrong, a lowercase spelling of those terms is read as written.
- Ruling: Try it uses the editor's draft, before it is saved, and runs the text pass and chunker only — the learner tests before committing, and the DOM verbalizers live in the Reader chunk — if wrong, tables and MathML cannot be tried in Settings (they need a lecture).
- Ruling: the Code and Tables choices follow the audited `.theme-choices` radiogroup pattern — consistency with a control the audits already check — if wrong, a little more code than native radios.
- Ruling: a concealed Teaching slide is rendered into a `<template>` — inert, loads no images — no cost expected.
- Ruling: atomic blocks (rows, code, diagrams, display math) are blocks even inside a text block, and a text block with no text of its own is not a block — code inside a list item is announced instead of read verbatim — if wrong, text after nested code in a list item is read before the code's announcement.
- Ruling: the fixture lives only in the browser audit (and its mirror in the unit test), not in `notes/` — `audit:ai-eval` pins the corpus — no cost expected.
- Ruling: 16 px phone text and 44 px targets are applied to the Narration card only — other Settings fields are outside this issue — if wrong, the backup password field keeps its pre-existing iOS zoom.
