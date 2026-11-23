---
'@theokit/agents': minor
---

`settingsCandidates` accepts several own roots in order, `readSettingsFile` takes `throwOnMalformed` and treats a non-object `permissions` as absent, and `readManagedSettings` reads `managed-settings.json` from the platform paths (`MANAGED_SETTINGS_PATHS`) for a caller-supplied key set.
