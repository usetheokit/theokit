# TheoClaw #1781 split

Issue #1781 (TheoClaw) must carry only TheoClaw changes. Work that had been
mixed into its branch is tracked separately.

## Split-out work

- `@theokit/host` package: scaffold merged to `workspace` in #1786. Further
  host utilities are pending in #2366.
- Presenter run-timeline (`fromRunTimelineEvent`): adapter merged to
  `workspace` in #1942. Further presenter enhancements are pending in #2366.
- Removal from the TheoClaw branch: #2353. `git diff
  origin/workspace...origin/factory/1781` holds only TheoClaw files.

## Follow-up issue

The dedicated follow-up for completing the host and presenter run-timeline
work outside TheoClaw is #2366 (branch `factory/2366`). #2375 is a duplicate
request for it; no second issue is opened.

## Status

- Host and presenter files on the TheoClaw branch are inherited from
  `workspace`. They are not TheoClaw changes and are not removed there.
- `@theokit/host` now also exports `createHostLifecycle` (ordered start with
  rollback, reverse-order stop), covered by `packages/host/tests/lifecycle.test.ts`.
  The presenter run-timeline adapter is covered by
  `packages/presenter/tests/from-run-timeline.test.ts`.
- Linking #2366 and this document from #1781 is a GitHub issue edit; `gh` is
  not available in the factory sandbox, so the owner must add both links on
  #1781. That is the only open step.
