# Lecture Heading Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lecture links land on their heading. `other.md#heading` opens that lecture at the heading, `#heading` moves within the lecture without changing the route, and Teaching Mode follows lecture links inside the app instead of navigating away.

**Architecture:** One pure resolver, `linkTarget(currentPath, href)` in `src/lib/links.js`, classifies every link. The Reader's existing delegated click handler and a new one on the Teaching Mode slide act on its verdict. Heading ids come from the same source parse the link audit uses (`documentAnchorIds` moves into `links.js` and `linkAudit.js` re-exports it), so the audit and the app agree. `links.js` builds as its own small chunk that loads only with the Reader; `App.jsx` and `markdown.js` are startup code and are not touched.

**Tech Stack:** React 19, Vite 8 (rolldown), marked + DOMPurify, Node 26 `node:test`, Puppeteer browser audits.

**Spec:** https://github.com/Aman4563/lumen-ai-notes/issues/150 (issue body; no comments). Reproduced on a fresh build of main 45826f7 on 2026-10-23, served by the real Lumen server at 393×852: the coverage audit's `README.md#all-parts` opened README at `scrollTop` 0 with `#all-parts` 2,154 px below the top and focus on `MAIN`; an in-page `#all-parts` link (click and Enter) set the URL to `/#all-parts` and showed Home; Teaching Mode's `part-01-foundations/README.md` link navigated to a 404 page and the app shell was gone (the same with page offline emulation, which does not reach the service worker).

## Global Constraints

- Accessibility: axe WCAG 2.2 AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, best-practice) with `ALLOWLIST = []` in `scripts/a11y_audit.mjs`; theme tokens only (Paper, Night, Contrast, System); 44 px touch targets and ≥ 16 px form text on phones. This change adds no CSS.
- Budgets (`npm run check` → `audit:app`): startup entry < 750,000 B; install route screens < 900,000 B. Baseline on main: startup entry 623,582 B, route screens 690,571 B, Reader chunk 80,882 B, `links` chunk 252 B. "The change stays inside the Reader chunk": new code goes in `src/components/Reader.jsx`, `src/components/TeachingMode.jsx` and `src/lib/links.js` (a chunk only the Reader and the warm link audit load). Do not edit `src/App.jsx` or `src/lib/markdown.js`. The startup entry must not grow.
- The Reader and Teaching Mode must not import `src/lib/linkAudit.js` (a warm tool; `scripts/audit_app.mjs:112-115` fails the build if it joins the route screens).
- Local-first and private: no network calls, no cloud AI, no tracking.
- Persisted data: no new profile fields. (Any new field needs the `db.js` normalizer, the backup fixture, the `profileSync` merge and its test together.)
- Gate: Node 26 (`.nvmrc`); `npm run check` and the full `npm run check:browser`.
- Routes: hash routes stay `#/read/<id>`; a fragment is never encoded into the route; an in-page link never changes `location.hash`.
- Exact copy, shown with `onNotify(message, "warning")` (the polite live region):
  - a fragment no heading has: `That section isn't in this lecture.`
  - a relative link that is not a lecture or note: `That link isn't a lecture or note, so it can't open here.`
- External `http(s)` links keep `target="_blank" rel="noopener noreferrer"` (`src/lib/markdown.js:34`, unchanged). Any link with a scheme is left to the browser.
- Heading ids are the Reader's: `slugifyHeading(text, index)` over h2/h3 with `-2`, `-3` duplicate suffixes (`Reader.jsx:365-374`), mirrored from source by `documentAnchorIds`. Fragments are percent-decoded (`decodeURIComponent`, raw text on a malformed escape).
- Out of scope: #156, #157 and #158. Keep `linkTarget` pure and exported, in-page jumps going through `scrollToHeading`, and cross-lecture jumps through `onOpenDocument(id, { anchor })`; those issues build on them. Rewriting imported HTML anchors is out of scope (they now stay in place with the notice).
- Fixtures use plain-text headings. Source slugs can differ from DOM ids for inline HTML in a heading or a `##` line inside a fence; that is pre-existing and deferred.
- Every new check must fail against the pre-change code for the reason its step names. Record the failing output in the task report.
- Commits: concise imperative subject, short why-body, no trailers.

## Review Focus

1. Phone, outline sheet open, an in-page link tapped in the article (the article stays interactive behind the sheet): the sheet closes and focus lands on the heading. The link handler lives in an effect that does not re-run when the drawer opens, so it must not act on a stale `drawer`/`narrow`. Pinned by Task 2 case (g).
2. A same-lecture link written with the file name (`link-fixture.md#third-section`) jumps in place like `#third-section`: no route change, no reload. Pinned by Task 2 case (d).
3. `[Top](#)` and unknown fragments stay put with the notice, never Home; nothing writes `location.hash`. Pinned by Task 1 (`#` → `{ anchor: "" }`) and Task 2 case (c).
4. After a jump in Teaching Mode focus is on the slide heading; Space must still narrate, because a focused heading is not a control. Pinned by Task 3 case (c).
5. A Teaching Mode link to a heading on the current slide still moves focus there, although the slide index does not change. Pinned by Task 3 case (b).

---

### Task 1: The shared link rule in `links.js`

**Files:**
- Modify: `src/lib/links.js`
- Modify: `src/lib/linkAudit.js` (`documentAnchorIds` and its helpers move out; `auditDocumentLinks` classifies with `linkTarget`)
- Test: `src/lib/linkAudit.test.mjs`

**Interfaces:**
- Consumes: `resolveDocumentLink` (unchanged), `slugifyHeading` from `./markdown.js` (already startup code), `splitTeachingSections` (tests only).
- Produces, all exported from `src/lib/links.js`:
  - `linkTarget(currentPath: string, href: string) → { documentId: string, anchor: string } | { anchor: string } | { notADocument: true } | null` — a lecture or note link (anchor `""` without a fragment); an in-page link (`#…`, anchor may be `""`); a relative link that is neither; `null` for any link with a scheme (the browser's to follow).
  - `headingAnchors(markdown: string) → Array<{ id: string, line: number }>` — h2/h3 headings in order, 0-based source line, ``` fences blanked line for line so line numbers survive.
  - `documentAnchorIds(markdown: string) → string[]` — `headingAnchors(markdown)` ids. `linkAudit.js` re-exports this same function.
  - `teachingSlideForAnchor(sections: Array<{ markdown: string }>, anchor: string) → { index: number, ordinal: number } | null` — `sections` from `splitTeachingSections`; `ordinal` is the heading's position among that slide's h2/h3 headings.
  - `LINK_NOTICES = { missingSection, notADocument }` holding the two exact strings from Global Constraints.

- [ ] **Step 1: Write the failing tests** in `src/lib/linkAudit.test.mjs`, importing `{ documentAnchorIds as linkAnchorIds, headingAnchors, linkTarget, teachingSlideForAnchor }` from `./links.js` and `{ splitTeachingSections }` from `./markdown.js`:

```js
test("linkTarget names the lecture and the decoded heading a link points to", () => {
  assert.deepEqual(linkTarget("notes/01-advanced-curriculum-coverage-audit.md", "README.md#all-parts"), { documentId: "notes/README.md", anchor: "all-parts" });
  assert.deepEqual(linkTarget("notes/part-01/a.md", "#local-heading"), { anchor: "local-heading" });
  assert.deepEqual(linkTarget("notes/part-01/a.md", "./b.md"), { documentId: "notes/part-01/b.md", anchor: "" });
  assert.deepEqual(linkTarget("custom/x.md", "../notes/part-01/a.md#gradient-descent"), { documentId: "notes/part-01/a.md", anchor: "gradient-descent" });
  assert.deepEqual(linkTarget("notes/a.md", "#caf%C3%A9"), { anchor: "café" });
  assert.deepEqual(linkTarget("notes/a.md", "#100%"), { anchor: "100%" }, "a malformed escape keeps its raw text");
  assert.deepEqual(linkTarget("notes/a.md", "#"), { anchor: "" });
  for (const href of ["https://example.com/a.md#x", "mailto:a@b.c", "tel:+15551234"]) assert.equal(linkTarget("notes/a.md", href), null, href);
  for (const href of ["./image.png", "figure.png", "", "?q=1", "/assets/app.css", "//example.com/page"]) assert.deepEqual(linkTarget("notes/a.md", href), { notADocument: true }, href);
});

test("every heading id documentAnchorIds lists is a link target that lands on it", () => {
  const markdown = ["# Title", "## Gradient Descent", "### Learning **Rate** [link](x.md)", "## Gradient Descent", "## ???", "## 2. Second section"].join("\n");
  const ids = documentAnchorIds(markdown); // the linkAudit.js import
  assert.equal(documentAnchorIds, linkAnchorIds, "the audit re-exports the Reader-side function, not a copy");
  assert.deepEqual(ids, ["gradient-descent", "learning-rate-link", "gradient-descent-2", "section-4", "2-second-section"]);
  assert.deepEqual(headingAnchors(markdown).map((heading) => heading.line), [1, 2, 3, 4, 5]);
  for (const id of ids) {
    assert.deepEqual(linkTarget("notes/p/a.md", `#${id}`), { anchor: id });
    assert.deepEqual(linkTarget("notes/p/b.md", `a.md#${id}`), { documentId: "notes/p/a.md", anchor: id });
  }
  const known = new Set(["notes/p/a.md", "notes/p/b.md", "notes/p/x.md"]); // x.md: the link inside the h3
  const anchorsFor = (id) => (id === "notes/p/a.md" ? ids : ["real-section"]);
  const links = [...ids.map((id) => `[in page](#${id})`), "[encoded](./b.md#real%2Dsection)", "[cross](./b.md#real-section)"].join("\n");
  assert.deepEqual(auditDocumentLinks("notes/p/a.md", `${markdown}\n${links}`, known, anchorsFor), [], "a link the audit calls valid is one linkTarget resolves");
});

test("teaching slides find the heading a link names", () => {
  // splitTeachingSections is not fence-aware: it also starts a slide at the
  // fenced "## not a heading" line. The mapping must not drift past it.
  const source = ["", "# Fixture", "Intro", "## First section", "text", "```python", "## not a heading in a fence", "```", "## 2. Second section", "### Detail point", "## First section"].join("\n");
  const sections = splitTeachingSections(source);
  assert.equal(sections.length, 5);
  assert.deepEqual(teachingSlideForAnchor(sections, "first-section"), { index: 1, ordinal: 0 });
  assert.deepEqual(teachingSlideForAnchor(sections, "2-second-section"), { index: 3, ordinal: 0 });
  assert.deepEqual(teachingSlideForAnchor(sections, "detail-point"), { index: 3, ordinal: 1 });
  assert.deepEqual(teachingSlideForAnchor(sections, "first-section-2"), { index: 4, ordinal: 0 });
  assert.equal(teachingSlideForAnchor(sections, "not-a-heading-in-a-fence"), null);
  assert.equal(teachingSlideForAnchor(sections, "missing"), null);
});
```

The existing test "the link audit flags exactly what the reader cannot open" stays as it is and must keep passing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/linkAudit.test.mjs`
Expected: FAIL. On main the whole file fails to load with `SyntaxError: The requested module './links.js' does not provide an export named …`. Record that this is the mechanism; the individual cases are not reached.

- [ ] **Step 3: Implement in `src/lib/links.js`, then switch `src/lib/linkAudit.js` to it**

- `linkTarget` returns verdicts that match `auditDocumentLinks` (`linkAudit.js:48-74` on main): `#…` → `{ anchor }`; `resolveDocumentLink` non-null → `{ documentId, anchor }`; otherwise an href containing `:` → `null`; otherwise `{ notADocument: true }`.
- `headingAnchors` is the move of `documentAnchorIds`' loop (`linkAudit.js:13-36`) with `stripFences` replaced by a line-preserving blank (each fence's non-newline characters removed). Ids must stay identical.
- `teachingSlideForAnchor` maps by source line. Join `sections[].markdown` with `"\n"`; that is the source minus a dropped blank intro, which holds no heading. Take `headingAnchors` of it, find the section whose line range holds the target, and count the headings before it in that range.
- `linkAudit.js` imports `documentAnchorIds` and `linkTarget` from `./links.js` and re-exports `documentAnchorIds`. `auditDocumentLinks` keeps its finding shapes:
  - `null` → skip;
  - `notADocument` → `not-a-document`;
  - an unknown `documentId` → `missing-document` with `targetId`;
  - an in-page anchor (including `""`) that is not in `anchorsFor(documentId)` → `missing-anchor` without `targetId`;
  - a document link with a non-empty anchor that is not in `anchorsFor(targetId)` → `missing-anchor` with `targetId`.
- Update the `links.js` header comment: it now holds link targets and heading anchors for the Reader and the audit, and imports `slugifyHeading`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/linkAudit.test.mjs && npm run audit:ai`
Expected: PASS, with no failures in either.

- [ ] **Step 5: Check the ids did not change and the chunks did not move**

- Compare the new `documentAnchorIds` with main's (`git show 45826f7:src/lib/linkAudit.js` saved under the scratchpad) on every `notes/**/*.md`, using a throwaway script outside the repo. Expected: 0 documents differ.
- Run `npm run build`. Expected:
  - `dist/offline-routes.json` lists `assets/links-*.js` in `files` and `assets/linkAudit-*.js` in `warm`;
  - `index.html` does not modulepreload `links-*`;
  - the startup entry is still 623,582 B.

- [ ] **Step 6: Commit**

```bash
git add src/lib/links.js src/lib/linkAudit.js src/lib/linkAudit.test.mjs
git commit -m "Resolve link targets and heading anchors in one place"
```

### Task 2: Reader — in-page and cross-lecture links

**Files:**
- Modify: `src/components/Reader.jsx` (`handleLink` at :379-403, `scrollToHeading` at :628-639, the `resolveDocumentLink` import at :46)
- Modify: `src/lib/content.js:89` — remove the `resolveDocumentLink` re-export only if nothing imports it afterwards (grep `src/` and `scripts/`)
- Test: `scripts/workflow_audit.mjs` — a new block placed immediately before `assert.equal(runtimeErrors.length, 0, …)` (:1748). That area is untouched by open PR #146. Add no imports at the top of the file: #146 rewrites lines 1–2.

**Interfaces:**
- Consumes: `linkTarget`, `LINK_NOTICES` (Task 1).
- Produces:
  - `scrollToHeading(id: string) → boolean`. It returns true when the article has an element with that id. It scrolls with `scrollBehavior()` and `block: "start"`, sets `tabindex="-1"`, and either hands focus to the heading through the phone sheet's close (only when `narrow && drawer`) or focuses it directly.
  - For Task 3: the workflow block's isolated `linkPage`, its `navigations` log, its `expectLink(condition, message)` helper, and the seeded note `custom/link-fixture.md` below.

**`handleLink` behavior:**
- `event.target.closest("a[href]")`, then `linkTarget(document.path, href)`.
- `null` → return.
- Otherwise call `event.preventDefault()` before any lookup, then:
  - `notADocument` → notice;
  - a `documentId` that is another lecture, or no anchor → `onOpenDocument(documentId, { anchor })`;
  - otherwise (an in-page or same-lecture fragment) → `scrollToHeading(anchor)`, and the missing-section notice when it returns false.
- An empty id returns false without querying (`#` + `CSS.escape("")` is an invalid selector).
- `handleLink` is attached in an effect that does not re-run when `drawer` or `narrow` changes, so the in-page jump must read their current values when it runs (for example through a ref); Review Focus 1.
- The code-copy branch is unchanged.
- **Ruling:** the Reader also keeps relative non-document links in the app (the issue lists this for Teaching Mode only), because in the Reader they leave the app the same way.

**Fixture** — the seeded note's exact Markdown. `FILLER` is the sentence `Filler that keeps the page long enough for every heading to reach the top of the reading view.` repeated as 12 separate paragraphs:

```md
# Link fixture

[Jump to second](#2-second-section) · [Jump to detail](#detail-point) · [Missing](#no-such-heading) · [Top](#) · [Third by file name](link-fixture.md#third-section) · [Figure](figure.png) · [Docs](https://example.com/docs)

## First section

FILLER

## 2. Second section

FILLER

[Down to the detail](#detail-point)

### Detail point

FILLER

## Third section

FILLER
```

**Block setup:**
- `browser.createBrowserContext()`. Its storage is separate, so the audit's later custom-document counts (5, then 6) stay untouched. Close the context in a `finally`.
- `pageerror` and console errors go to `runtimeErrors`, prefixed `links: `.
- Viewport `{ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true }`, with `prefers-reduced-motion: reduce` emulated for the whole block.
- `navigations` collects `request.url()` for every request where `request.isNavigationRequest() && request.frame() === linkPage.mainFrame()`.
- Seed the note in the browser after the first lecture has been stored, as the readiness block does (`:1628-1667`): push `{ id: "custom/link-fixture.md", title: "Link fixture", raw, createdAt, updatedAt, tags: [], collectionId: "", archived: false, pinned: false }` into `profile.customDocuments`, `put` it, set the hash to `#/read/custom%2Flink-fixture.md`, then reload.
- **Placement:** the heading's top minus `.reader-scroll`'s top, compared with its computed `scroll-margin-top`. "At the top" means within 4 px.
- **Cases:** each case opens its own route first. A case that throws is recorded with `expectLink(false, …)`. The block asserts once, at its end, that nothing failed, so one run against the pre-change build reports every case.

- [ ] **Step 1: Write the failing cases**
  - (a) The coverage audit (`notes/01-advanced-curriculum-coverage-audit.md`): DOM-click `article a[href="README.md#all-parts"]`.
    - The hash becomes `#/read/notes%2FREADME.md`.
    - Within 10 s, `document.activeElement.id === "all-parts"` and the heading is at the top.
  - (b) The fixture, "Jump to second":
    - two animation frames after the click (reduced motion: instant), `h2#2-second-section` is at the top and focused;
    - the hash is still `#/read/custom%2Flink-fixture.md`;
    - `navigations` gained nothing.
  - (c) With `.reader-scroll` at 0, click "Missing", then "Top" (dismiss the toast between them). Each time:
    - a `.toast` contains `That section isn't in this lecture`;
    - the hash is unchanged;
    - `scrollTop` is unchanged (±1).
  - (d) "Third by file name": `h2#third-section` is at the top and focused, the hash is unchanged, and there are no navigations.
  - (e) Keyboard: with `.reader-scroll` at 0, focus the "Jump to detail" link and press Enter. `h3#detail-point` is at the top and focused, and the hash is unchanged.
  - (f) "Figure": a toast contains `That link isn't a lecture or note`, there are no navigations, and the hash is unchanged.
  - (g) With `.reader-scroll` at 0, click `button[aria-label="Table of contents"]`, wait for `#reader-side-panel.open`, then DOM-click "Jump to second" in the article. The panel loses `open`, and `h2#2-second-section` ends focused.

- [ ] **Step 2: Run against the pre-change build to verify the cases fail**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow`
Expected: FAIL in the new block:
- (a) focus not on `all-parts` (`scrollTop` 0);
- (b), (c) and (d) the hash changed (Home shown);
- (e) the same by keyboard;
- (f) a navigation request to `/figure.png`;
- (g) the hash changed.

Quote the failure lines in the report.

- [ ] **Step 3: Implement `handleLink` and `scrollToHeading` as specified above**

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow`
Expected: `Workflow audit passed.` Then run `npm run audit:ai` (still green) and `npm run build`. The startup entry must be unchanged and the Reader chunk grows only by the handler.

- [ ] **Step 5: Commit**

```bash
git add src/components/Reader.jsx src/lib/content.js scripts/workflow_audit.mjs
git commit -m "Open lecture links at their heading and keep in-page links in the Reader"
```

### Task 3: Teaching Mode follows links inside the app

**Files:**
- Modify: `src/components/TeachingMode.jsx` (props, a delegated click handler on the slide `<article>` at :116, the slide jump, the Space rule at :92)
- Modify: `src/components/Reader.jsx:1225` (pass the new props)
- Test: `scripts/workflow_audit.mjs` (extend Task 2's block), `scripts/a11y_audit.mjs` (append one `STATES` entry after `teaching-mode-error`, :166)

**Interfaces:**
- Consumes: `linkTarget`, `teachingSlideForAnchor`, `LINK_NOTICES` (Task 1); the Reader's `onOpenDocument(id, { anchor })` and `onNotify`; Task 2's block helpers and fixture.
- Produces: `TeachingMode({ title, source, documentId, onClose, onOpenDocument, onNotify, speech })`.

**Behavior:**
- On a click on `a[href]` in the slide article, `linkTarget(documentId, href)` decides:
  - `null` → leave the browser default;
  - otherwise `preventDefault()`, then:
    - `notADocument` → notice;
    - another lecture, or no anchor → `close()` (stops speech, exits fullscreen), then `onOpenDocument(documentId, { anchor })`;
    - otherwise → the slide jump.
- **Slide jump:**
  - `teachingSlideForAnchor(sections, anchor)` returning `null` → the missing-section notice, and the slide stays.
  - Otherwise → `speech.stop()`, `setConcealed(false)`, `setIndex(index)`.
  - Once that slide has rendered, the `ordinal`-th `h2, h3` of the article gets `tabindex="-1"`, `scrollIntoView({ behavior: scrollBehavior(), block: "start" })` and `focus({ preventScroll: true })`.
  - This must also work when `index` is already the current slide.
- **Space** narrates when the keydown target is `document.body` or a slide heading a jump focused.
- **Focus after a cross-lecture link:** implement the direct call first; cases (g) and (h) decide. If (h) ends with focus on the Reader's Teach button, defer the open on the Reader side until Teaching Mode has unmounted, and say so in the report. The suspected cause: App's route focus runs while the reader is still inert under the dialog, then the dialog's frame-later restore lands on its opener.

- [ ] **Step 1: Write the failing cases**

Before navigating, the block's page installs the main page's speech mock (`:183-206`) with `evaluateOnNewDocument`.

  - (a) The fixture, Teach, "Jump to second" on slide 1:
    - `.teach-section-label` contains `2. Second section`;
    - `document.activeElement` is the slide's `h2` with that text;
    - `.teach-mode` is still open;
    - the hash is unchanged, and there are no navigations.
  - (b) On that slide, focus "Down to the detail" and press Enter (keyboard activation in Teaching Mode): the label is unchanged, and the active element is the slide's `h3` `Detail point`.
  - (c) Press Space: `window.speechSynthesis.current` is set. Then stop narration.
  - (d) Back on slide 1 (`button[aria-label="Previous section"]` or the section select), "Missing": a toast contains `That section isn't in this lecture`, the label still names slide 1, and `.teach-mode` is open.
  - (e) "Figure": a toast contains `That link isn't a lecture or note`, `.teach-mode` is open, and there are no navigations.
  - (f) "Docs": the link has `target="_blank"`. A window bubble `click` listener records `defaultPrevented === false` and then cancels the click, so no tab opens.
  - (g) The coverage audit, Teach: press "Next section" until `.teach-mode a[href="README.md#all-parts"]` exists, then click it.
    - `.teach-mode` is gone and the hash is `#/read/notes%2FREADME.md`;
    - the active element is `#all-parts`, at the top;
    - there are no navigations.
  - (h) Open `notes/part-01-foundations/README.md` once, so its source is in memory. Then open `notes/README.md`, Teach, and step to `a[href="part-01-foundations/README.md"]`. Call `setOfflineMode(true)`, clear `navigations`, and click.
    - No main-frame navigation request is issued, `location.pathname` is `/`, and `#main-content` exists.
    - `.teach-mode` is gone and the hash is `#/read/notes%2Fpart-01-foundations%2FREADME.md`.
    - The active element is that lecture's `.markdown-body h1`.
    - Then call `setOfflineMode(false)`.
    - The assertion message says that page offline emulation does not reach the service worker, so the absence of a navigation request is the proof that the app holds offline.

  - Append to `STATES` in `scripts/a11y_audit.mjs`:
    - `name: "teaching-mode-link-jump"`, `route: ROUTES[2]`.
    - `setup`:
      - read `id` of `document.querySelectorAll(".reader-view article.markdown-body:not(.teaching-markdown) h2")[2]`;
      - click Teach and wait for `.teach-mode .teaching-markdown`;
      - prepend `<a href="#<id>">Jump to section</a>` to that slide article and `click()` it.
    - `ready: ".teach-mode .teaching-markdown h2:focus"`.
    - `close`: Escape, then wait for `.teach-mode` hidden.
    - The comment says the link is injected because built-in lectures have no in-page links, and its target is on a later slide so the focus-inside-dialog check means something.

- [ ] **Step 2: Run against the pre-change build to verify the cases fail**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow a11y`
Expected: FAIL.
- workflow:
  - (a), (b) and (d) the hash changed and Teaching Mode closed;
  - (e) a navigation to `/figure.png`;
  - (g) and (h) a main-frame navigation request (404).
- a11y: `teaching-mode-link-jump: the state could not be scanned` in every theme and viewport.

Case (f) is a guard: it passes before and after. Quote the lines.

- [ ] **Step 3: Implement the behavior above; the Reader passes `documentId={document.id}`, `onOpenDocument={onOpenDocument}` and `onNotify={onNotify}`**

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && LUMEN_BROWSER_RETRIES=0 npm run check:browser -- workflow a11y`
Expected: `Workflow audit passed.` and `Accessibility audit passed: …` with `teaching-mode-link-jump` in the state list.

- [ ] **Step 5: Commit**

```bash
git add src/components/TeachingMode.jsx src/components/Reader.jsx scripts/workflow_audit.mjs scripts/a11y_audit.mjs
git commit -m "Follow lecture links inside Teaching Mode"
```

### Task 4: Documentation (after the full gate)

**Files:**
- Modify: `docs/internal/PRODUCT_REQUIREMENTS.md`: append one dated row to the verification log, after the 2026-10-22 row. Use three columns: `| <date +%F> | Lecture links land on their heading (issue #150; CONTENT-001, TEACH-001, A11Y-001 partials) | <evidence> |`. No status row changes.
- Modify: `docs/FUNCTIONAL_TESTING.md`: append `## Bugs reproduced on <date +%F>: lecture links (#150)` at the end. It holds the reproduction (the numbers in the Spec line), each new check and how it failed before, and the offline-emulation note.
- Modify: `docs/guides/APP_GUIDE.md`: one or two sentences where reading and Teaching Mode are described. A link to a section opens at that section; links in Teaching Mode open the lecture in the Reader or move to the slide.
- Modify: `docs/DEVICE_TESTING.md`: add `## Lecture links that need a device (issue #150)`. Steps: in the Home Screen app, tap a lecture link in Teaching Mode and stay in the app (#7); follow a section link with VoiceOver and hear the heading.

**Interfaces:**
- Consumes: the orchestrator's gate results (`npm run check` and `npm run check:browser` outcomes, retries, load), the budget numbers from `audit:app`, and the failing-before quotes from Tasks 1–3.

- [ ] **Step 1: Write the four edits.** Append only; never rewrite earlier rows. Keep README.md untouched.
- [ ] **Step 2: Verify:** `git diff --check` is clean, and `git diff --stat` shows only the four docs.
- [ ] **Step 3: Commit:** `git commit -m "Record the lecture link fix and its checks"`

## As executed

Execution changed the plan in six places. The text above is as it was written; each ruling below gives what the plan said, what was built and why.

- **The `content.js` re-export went in Task 1, not Task 2.** The plan listed `src/lib/content.js:89` under Task 2 ("remove the `resolveDocumentLink` re-export only if nothing imports it afterwards"). Once `links.js` imported `markdown.js`, which has load-time side effects, the unused re-export stopped being tree-shaken: rolldown pulled `links.js` into the startup entry and split DOMPurify into its own preloaded chunk. Task 1 therefore made the Reader import `resolveDocumentLink` from `links.js` and dropped the re-export, which keeps `links.js` a lazy chunk and the startup entry unchanged (+0 B against main in the final gate).
- **CRLF headings.** The plan moved `documentAnchorIds`' loop as it was ("Ids must stay identical"). That loop never matched a `##` line ending in `\r`, so a lecture saved with CRLF line endings had no heading ids: the audit flagged every anchored link in it, and Teaching Mode would have said the section is not there. `headingAnchors` now ignores one trailing `\r` per line; line numbers and the ids of LF sources are unchanged. The same commit pins, as a guard, the in-page missing-anchor finding that the `linkTarget` rewrite moved.
- **The Teaching Mode deferral.** Task 3 said to call `onOpenDocument` after `close()` and to defer the open on the Reader side only if case (h) ended with focus on the Teach button. It did: the reader was still inert under the dialog when App moved focus to the new lecture's heading, and the dialog's cleanup then returned focus to Teach. The Reader's `openAfterTeaching` now opens the lecture once Teaching Mode has unmounted, and a comment in `TeachingMode.jsx` says why the parent must do so.
- **The a11y state's lecture and target.** The plan scanned `ROUTES[2]` (Part 5 linear regression) after a jump to its third `h2`. That slide is longer than its scroller and holds nothing tabbable, so axe's `scrollable-region-focusable` fails on it whether it is reached by a jump or with Next. The gap predates the link work and is added to #98's scope. The state now opens `notes/part-05-supervised-learning/03-trees-and-ensembles.md` and picks, as it runs, the first `h2` whose section holds a link, code, a table or a diagram (here a diagram). It waits for that lecture's title before choosing and for every diagram to finish drawing before axe runs, and it fails as "could not be scanned" when no section qualifies or a diagram never settles. The choice relies on that first section not being a table, because Teaching Mode's table headers fail `color-contrast` (also #98).
- **The leading-scheme rule.** The plan returned `null`, leaving the link to the browser, for any href containing `:`. A relative link with a colon after its path or query, such as `figure.png#fig:1`, `page.html?t=10:30`, `notes/a:b.png` or `//example.com:8080/page`, counted as a link with a scheme, so the Reader and Teaching Mode left it to the browser, which navigated the tab away. Only a leading URL scheme returns `null` now; every other relative link that opens no lecture is `{ notADocument: true }` and shows the notice. Links with a scheme, and `.md` links that resolve as documents, behave as before.
- **Case (d)'s failure on main.** Step 2 predicted that (b), (c) and (d) would fail with the hash changed and Home shown. (d), "Third by file name" (`link-fixture.md#third-section`), fails differently: the pre-change Reader reopens the same note without its fragment, so the hash is unchanged and focus ends on the lecture's H1 at the top. The check is right; the plan's prediction was not.
