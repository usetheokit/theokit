---
'@theokit/agents': minor
'theokit': patch
---

`@theokit/agents/commands` exports `sessionsGcCommand`, `parseSessionsGcArgs`, `formatGcPlan` and `formatGcJson`: the `sessions gc` command with a dry-run default, `--apply`, age and keep bounds, and a JSON or human report. `theokit agent sessions gc` now uses it.
