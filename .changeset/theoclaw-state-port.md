---
'theoclaw': patch
---

`theoclaw state port --to <postgres url> [--force]` copies the scheduled jobs from the current engine to PostgreSQL, refuses a target that already holds jobs unless `--force`, prints the rows copied per store, and never deletes the source. (#1640)
