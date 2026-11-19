---
'@theokit/agents': minor
---

`loadInstructionTree` gains `order: 'as-listed'` (blocks follow the `fileNames` array; a predicate throws a `ConfigurationError`) and `budget.maxCharsPerFile` (cuts each file with a `[truncated]` marker and flags the block `truncated`). A file that fails to read for any reason other than `ENOENT`, or a directory named like an instruction file, now goes to `onWarn`.
