---
'theokit': patch
'@theokit/agents': patch
'@theokit/host': patch
---

Generated Deno cron entries encode names, schedules and paths as string literals, and the foreign-surface reader checks and reads one open descriptor.
