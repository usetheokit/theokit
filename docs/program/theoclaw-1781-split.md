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
- Linking #2366 from #1781 is a GitHub issue edit. It is not part of this
  repository change and must be done on GitHub (`gh` is not available in the
  factory sandbox), so it is still pending.
- Enhancements beyond the merged scaffold and adapter are not done yet.
