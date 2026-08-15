---
'@theokit/agents': minor
---

`loadInstructionTree` now accepts a predicate for `fileNames`, so a rules DIRECTORY can be walked.

`fileNames.includes(entry)` matched a basename, so the walk could only collect files the caller
could name in advance. A rules directory is the opposite shape: the user drops arbitrarily named
files in and expects all of them read. That is not one product's idiosyncrasy — Claude Code reads
`.claude/rules/` and Cursor reads `.cursor/rules/*.mdc`, both arbitrary-name directories.

Measured consequence of the gap: the closest consumer wrote its own 112-line walk — budget, depth
ceiling, cycle guard and all — to ask `entry.endsWith('.md')`. The walk was ours; only the question
was theirs.

Additive: `fileNames` still accepts an array, with unchanged semantics.
