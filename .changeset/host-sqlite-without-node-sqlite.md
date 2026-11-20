---
'@theokit/host': patch
---

`backup` of a SQLite file on a Node without `node:sqlite` (22.12) now rejects with a `BackupError` naming Node 22.16, instead of the raw "No such built-in module" error.
