<!-- Describe what was broken or missing and what changes, in plain prose. -->

Closes #

## Validation

- [ ] `npm run check` passes
- [ ] `npm run check:browser` passes (note any suite that passed only on retry)
- [ ] Each bug fixed has a regression check that fails without the fix
- [ ] Checked at 320 px and 393 px wide, and in Paper, Night and Contrast (UI changes)
- [ ] `npm run check:live` with a local model (AI tutor or server changes)

## Checklist

- [ ] ENGINEERING_HANDOFF.md section 18 invariants still hold
- [ ] No assertion was weakened; intentional test changes are explained above
- [ ] PRODUCT_REQUIREMENTS.md verification row and docs/FUNCTIONAL_TESTING.md entry added where relevant
- [ ] No secrets, `.env`, keys, certificates or learner data in the diff
