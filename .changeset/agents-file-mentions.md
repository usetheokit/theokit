---
'@theokit/agents': minor
---

`@theokit/agents/config` now exports `resolveFileMentions` and `findFileMentions`: `@file` mentions in a user message are found with the same grammar as `expandCommandTemplate` (a trailing `.` or `,` is not part of the path), resolved inside `cwd`, capped per file and in total, and reported as `attached` or `skipped` with a reason.
