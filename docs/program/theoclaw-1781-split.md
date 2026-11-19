# TheoClaw #1781 split: `@theokit/host` and presenter run-timeline

Issue #1781 (TheoClaw) stays limited to TheoClaw-only changes. The
unrelated `@theokit/host` package and the presenter run-timeline features
are tracked separately:

- #1781: TheoClaw work (this stays TheoClaw-only).
- #2353: removed the unrelated workspace and host package changes from the
  #1781 branch.
- #2366: dedicated follow-up for `@theokit/host` and presenter run-timeline
  features (branch `factory/2366`).

## Current state

- `packages/host`: `@theokit/host` scaffold (package, `src`, `tests`).
- `packages/presenter/src/source/from-run-timeline.ts`: run-timeline source
  adapter, with tests in `packages/presenter/tests/from-run-timeline.test.ts`
  and a changeset in `.changeset/presenter-run-timeline.md`.

## Scope of #2366

- Grow `@theokit/host` beyond the scaffold.
- Extend the presenter run-timeline features.
- Do not mix either with TheoClaw changes; any TheoClaw consumer lands in
  #1781 only after this follow-up is merged.
