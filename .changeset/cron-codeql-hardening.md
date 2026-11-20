---
'theokit': patch
'@theokit/agents': patch
---

Generated Deno cron entries encode names, schedules and paths as string literals, and the foreign-surface reader checks and reads one open descriptor.
