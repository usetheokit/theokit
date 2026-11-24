---
'@theokit/agents': patch
'@theokit/host': patch
---

`ForeignImportError` and `SettingsFileError` extend `TheokitAgentError` with a stable `code` and an explicit `isRetryable`, so `isTransientError` sees them. `@theokit/host` now declares `@theokit/sdk` `>=12.0.0`: the channel assistant uses the `agent` form of `Agent.sessionPool` and the mask handle's `flush()`, which SDK 12 added.
