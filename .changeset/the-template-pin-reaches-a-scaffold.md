---
"create-theokit": patch
---

Bump this package whenever the release corrects the framework pin in its scaffold template, so the
correction reaches a user rather than only the repository.

Measured 2026-09-18, end to end: minutes after `theokit@0.67.0` published the HITL approvals
scoping fix, `npm create theokit@latest` produced an app declaring `"theokit": "^0.66.0"` and
installing `theokit@0.66.1` — inside the affected range of the advisory that release closed. On a
`0.x` line `^0.66.0` means `>=0.66.0 <0.67.0`, so npm was right.

Every step was individually correct, which is why nothing reported it. `sync-template-pins.mjs`
wrote `^0.67.0` into the template inside the `Version Packages` commit, and `changeset publish` then
skipped this package and said why in its own words: *"create-theokit is not being published because
version 3.0.0 is already published on npm"*. Nothing bumped it, because the pin lives in a template
FILE and changesets reads dependencies.

The step that knows the pin changed now writes the bump the tool could not derive. The publish
already keys on "the local version is not on the registry", so the corrected pin ships by the
mechanism that was already there.
