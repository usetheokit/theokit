---
'@theocode/agent': patch
---

A Claude Code `managed-settings.json` is read as a foreign-root settings file: `permissions` rules are enforced, unknown keys are reported rather than fatal, a malformed file warns with its path, and the settings report lists it.
