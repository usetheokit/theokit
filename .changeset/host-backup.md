---
'@theokit/host': minor
---

Add `@theokit/host/backup`: `backup` copies named directories with a sha256 manifest (consistent SQLite snapshots without sidecars, no symbolic links, private modes, optional exclusions and lock), and `restore` verifies every file before writing, stages each root, and puts earlier targets back if a later placement fails. Adds `BackupError`.
