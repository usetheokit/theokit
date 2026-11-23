---
'@theokit/agents': minor
---

Add `sessionCommands` to `@theokit/agents/commands` (the standard `/new`, `/stop`, `/steer`, `/compact`, `/model`, `/think` and `/status` commands, matched on the whole trimmed text) and `createSessionGenerations` to `@theokit/agents/session` (a persistent per-key generation counter). `CommandDefinition` gains an opt-in `exact` flag.
