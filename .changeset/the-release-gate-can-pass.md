---
'theokit': patch
---

The release gate can pass again.

`changeset version` bumps the scaffold template's `theokit` pin to the version the Version Packages
PR is what publishes, so in the window between the bump and the publish every job that installs a
scaffolded app failed on `ERR_PNPM_NO_MATCHING_VERSION`. Three of those are required checks on
`main`, which has `enforce_admins: true` — so the release could not be merged by anyone, and the
integration test's own failure message asked for the impossible: "publish the pending release and
re-run", when publishing requires the merge the failing check refuses.

Two changes. The `Scaffolded app typechecks` job scaffolds with `--skip-install`: the CLI's install
ran BEFORE the step that points the app at this working tree, so it resolved from npm — which also
means the job had been measuring the published package rather than this tree whenever the pin
happened to resolve, the defect #420 reports. The root install two steps later is what actually
links the app, so the CLI's was redundant here.

`tests/integration/pnpm-11-compat.test.ts` now skips that window instead of failing it, with the
pins named in the skip reason. Its subject is pnpm 11's build-approval behaviour, and a dependency
that cannot be resolved is not that subject. The decision is a pure function in
`scripts/unpublished-pins.ts` with six unit tests, deliberately narrow: only first-party names, and
only a range that names exactly one version — a missing third-party package still fails, and a range
it cannot parse is never read as missing.
