---
'@theokit/agents': patch
---

`readSettingsFile` keeps a `permissions` list only when every entry is a string, and with `throwOnMalformed` throws a `SettingsFileError` (with `path` and `kind`) for an unreadable or malformed file; `translateSettingsDocument` applies the same key split to a document already in memory.
