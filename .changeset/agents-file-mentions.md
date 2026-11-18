---
'@theokit/agents': minor
---

Added `resolveFileMentions` and `findFileMentions` to `@theokit/agents/config`: attach `@file` mentions from a user message with the same grammar as `expandCommandTemplate`, contained to the working directory, with per-file and total token caps and a `skipped` list that says why a mention was not attached.
