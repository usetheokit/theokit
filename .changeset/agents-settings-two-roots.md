---
'@theokit/agents': minor
---

`@theokit/agents/config` adds `settingsCandidates`, `readSettingsFile` and `firstSettingsFile` to read `settings.json` under an own root and the `.claude` root, reporting `ignored` and `unrecognised` keys and unsupported permission entries. `CLAUDE_SETTINGS_KEYS` and `FOREIGN_KEY_DECISIONS` are exported.
