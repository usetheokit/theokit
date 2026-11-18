---
'@theokit/presenter': minor
---

Mark the `@theokit/sdk` and `zod` peers optional so the UI kits can import the root entry, which loads neither at runtime. Only `@theokit/presenter/wire` needs `zod`.
