---
'@theokit/host': minor
---

`@theokit/host/backup` now exports `createStorageRegistry`: named storage locations that keep verified backups as one streamed archive, optionally sealed with AES-256-GCM under a key held in the registry file (0600). `store`, `fetchLatest`, `test` and `list` refuse a missing or wrong key, a damaged archive and an entry that leaves the target, with a `BackupError`.
