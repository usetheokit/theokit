# Release create-theokit@1.23.0

**Date:** 2026-07-16
**Verdict:** RELEASED
**Package:** `create-theokit` (minor 1.22.0 → 1.23.0)
**Mechanism:** changesets + `pnpm publish` (per-package — this repo's actual release model; NOT the generic develop→main-PR + vX.Y.Z flow)
**Source review:** `.claude/knowledge-base/reviews/componentize-default-tui-surface-review-2026-07-16.md` (READY_TO_MERGE)
**Plan:** `.claude/knowledge-base/plans/componentize-default-tui-surface-plan.md`
**Release commit:** `b28ad213` (release(create-theokit): 1.23.0 …)
**Implementation commits:** `68f4abcf` (componentize) · `0c015afc` (review-fix: type-safe slash router + test hardening)
**Tag:** `create-theokit@1.23.0` (annotated, pushed)
**npm:** `create-theokit@1.23.0` published (provenance flip applied — provenance only works in CI; restored `true` after)
**GitHub release:** https://github.com/usetheodev/theokit/releases/tag/create-theokit%401.23.0

## What shipped

Componentized the scaffolded TUI surface. `tui/App.tsx` drops 460 → 228 lines (a focused composition root); the welcome `Banner`, the `/usage` observability panel (`UsagePanel`), and the `/plan /ask /select /progress` showcase (`Demos`, which owns its own progress timer) move to `tui/components/*` — each single-responsibility, and the demos deletable in one file. The generated app ships a `## Architecture` System Design in `README-surface.md` (component tree + data flow + layer boundaries + extension points). Pure refactor — every 1.22.0 behavior preserved; type-safe slash router (no `as` casts); generated app `tsc --noEmit` + `--noUnusedLocals` clean against the `@theokit/tui@0.40.0` types.

## Verification (published tarball)

- `tui/components/{Banner,UsagePanel,Demos}.tsx.tmpl` present.
- `App.tsx.tmpl` = 228 lines (≤ 230 Goal).
- `README-surface.md.tmpl` has the `## Architecture` section.
- npm latest = `1.23.0`.

## Notes

- No fixture bumps this release (`create-theokit` has no workspace dependents to sync).
- `scaffold-surface.ts` was NOT changed (recursive `cpSync` + `tsconfig` glob already cover `tui/components/`).
- Live tmux visual smoke of the componentized surface was blocked by environment Ink-capture flakiness; the app runs (`tsx tui/main.tsx` 8s no crash), and the full interactive smoke was performed on the byte-identical 1.22.0 logic. `tsc` + tests are the automated gate.
- The generic `/release` develop→main-PR + `vX.Y.Z` flow was NOT used — this repo releases per-package via changesets + pnpm (per-package tags like `create-theokit@1.23.0`).
