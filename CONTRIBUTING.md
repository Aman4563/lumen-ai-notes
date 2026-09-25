# Contributing to Lumen AI Notes

Thanks for helping. Lumen is an iPhone-first, local-first study app and a
curriculum. Most changes touch one of three things: the app (`src/`,
`server/`), its browser and unit audits (`scripts/`, `src/lib/*.test.mjs`), or
the curriculum notes (`notes/`). This guide covers the workflow, the gates a
change must pass, and the constraints that are easy to break by accident.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security problems privately as described in [SECURITY.md](SECURITY.md),
never in a public issue.

## Getting set up

You need Node.js 26 to run the release gate, the same version CI uses
(`.nvmrc`); on older versions the AI timeout and deadline tests are cancelled
and `npm run check` fails. The app itself builds and runs on Node.js 20.19 or
newer. You also need Google Chrome for the browser audits (or set
`CHROME_PATH`) and Ruby for the curriculum audit.

```sh
npm ci
npm run dev        # Vite dev server on 127.0.0.1
npm run build      # production build into dist/
npm run preview    # serve dist/ on http://127.0.0.1:4173
```

The Mac local AI tutor needs a local model server (Ollama). On-device Lite runs
in the browser through WebLLM, and the rest of the app works without either.
To develop against a local [Ollama](https://ollama.com) model, see
[AI_SERVER.md](AI_SERVER.md) and run `npm run dev:ai` alongside `npm run dev`.
No paid AI API is used or accepted. On-device Lite (WebLLM) is documented in
[PHONE_LOCAL_AI.md](PHONE_LOCAL_AI.md). Never commit `.env`, anything under
`.local/`, certificates or keys, or learner backups.

## Workflow

1. Open or pick an issue that describes the problem and its acceptance
   criteria. Security reports are the exception; see SECURITY.md.
2. Branch from `main` (for example `fix/reader-phone-tools` or
   `feat/tutor-follow-ups`) and keep one coherent change per pull request.
3. Write concise, imperative commit subjects ("Place whiteboard text on the
   tap's pointerup") with a short body explaining why when it is not obvious.
4. Open a pull request against `main` using the template, and link the issue
   with `Closes #N`. CI runs the full release gate on every pull request.
5. Keep the branch up to date with `main` before merging; pull requests are
   merged with a merge commit and the branch is deleted automatically.

## The release gate

Run both parts before asking for review:

```sh
npm run check           # curriculum, unit, scale, storage, backup, AI/data suites,
                        # retrieval evaluation, production build and app audit
npm run check:browser   # 13 browser suites against an isolated server
```

`npm run check:release` runs both in order. `check:browser` starts its own
server from `dist/`, so no manual preview is needed; set `LUMEN_URL` to test an
already running app, or pass suite names (`npm run check:browser -- ai-ui
responsive`) to narrow a run. A failed suite is retried once and reported as
"Passed only on retry"; treat a repeat as a bug to fix, and set
`LUMEN_BROWSER_RETRIES=0` when diagnosing. [docs/FUNCTIONAL_TESTING.md](docs/FUNCTIONAL_TESTING.md)
summarizes what the browser suites cover.

Changes to the AI tutor or server should also pass the real-model acceptance
run: build, run `npm run start:local-ai` with Ollama running, then
`npm run check:live`, as described under "Real model acceptance" in
docs/FUNCTIONAL_TESTING.md.

Add a regression check for every bug you fix, and make sure it fails against
the code before your fix. Never weaken an existing assertion to make a change
pass; update an assertion only when the behaviour changed on purpose, and say
so in the pull request.

## Constraints to respect

- **Invariants.** [ENGINEERING_HANDOFF.md](ENGINEERING_HANDOFF.md) section 18
  lists the data, AI, grounding, phone-model, rendering and privacy invariants
  every change must preserve (for example: never persist an incomplete AI
  answer as complete, citations resolve only to supplied evidence, API
  responses are never cached by the service worker).
- **Accessibility.** The accessibility audit (`scripts/a11y_audit.mjs`) runs
  axe (WCAG 2.2 AA) on every route in Paper, Night and Contrast at phone and
  desktop widths with an empty allowlist. Use the theme tokens in
  `src/styles.css` rather than hard-coded colours; `src/lib/themeContrast.test.mjs`
  fails on any undefined `var()` or a text/focus pair below AA.
- **Phone first.** Check layouts at 320 px and 393 px wide, at 200% text, and
  in phone landscape. The browser audits check these in CI: the responsive
  audit covers 320 px, 200% text and phone landscape, and the accessibility
  and AI audits use a 393 px phone.
- **Budgets.** The startup script must stay under 750 KB and the precached
  offline route screens under 900 KB (both enforced by `npm run check`). Load
  new screens and large features lazily, and never import from a lazily
  loaded screen in `src/App.jsx`.
- **The AI request contract.** `src/lib/aiContract.js` (the browser client)
  and `server/ai/contracts.mjs` (the server) must change together, and
  `npm run audit:ai` must pass.
- **The retrieval evaluation.** `npm run audit:ai-eval` scores
  `eval/fixtures/v1/retrieval.json` against the generated notes corpus and
  pins its document count. Changing cases or thresholds means re-baselining
  the fixture and bumping `suiteVersion` (see [eval/README.md](eval/README.md)).
- **Persisted data.** A new profile field needs the `normalizeProfile`
  normalizer in `src/lib/db.js`, the backup round-trip fixture in
  `src/lib/backup.test.mjs`, and the `mergeProfileVersions` merge in
  `src/lib/profileSync.js` with a case in `src/lib/profileSync.test.mjs`, all
  updated together. Extend `scripts/cross_tab_audit.mjs` (`npm run audit:sync`)
  when the field is edited in the UI.

## Tracking status

[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) is the status authority.
When a change ships or verifies a requirement, append a dated row to its
verification log (never rewrite earlier rows), and add a short dated entry to
docs/FUNCTIONAL_TESTING.md for bugs you reproduced and how they are now
checked.

## Curriculum notes

The notes live in `notes/`, one folder per part (`part-NN-topic/`) with a
`README.md` index and numbered chapters (`NN-topic.md`). Every chapter must be
linked from its part index and every part from [notes/README.md](notes/README.md).
`npm run audit:notes` checks local links, structure and Mermaid fences, and
rejects LaTeX: write equations as MathML or readable Unicode with
`<sub>`/`<sup>`, never `$$`, `\[`, `\(` or TeX commands such as `\frac`.
Adding or removing a notes file also changes the corpus that
`npm run audit:ai-eval` pins; update `corpus.expectedDocuments` in
`eval/fixtures/v1/retrieval.json` and bump `suiteVersion` in the same pull
request.

Corrections are very welcome: open a "Curriculum content" issue or a pull
request that names the chapter and section, explains what is wrong, and cites
a source where one applies. Keep the layered depth (beginner, practitioner,
advanced) described in the [README](README.md). Notes contributions are
licensed under CC BY 4.0 ([LICENSE-NOTES.md](LICENSE-NOTES.md)); code
contributions under MIT ([LICENSE](LICENSE)).
