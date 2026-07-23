---
"@theokit/agents": minor
---

Capability core for agent authoring (M52). `@theokit/agents` gains `Capability` — a two-member contract (`name`, `apply`) that enriches the EXISTING `CompiledAgentOptions` waist instead of inventing a parallel representation. Ships `ModelCapability` / `ToolsCapability` / `skills()`, a `CapabilityRegistry` (which unlocks declaring an agent from a config FILE, not only from code), `CapabilityPreset` (a preset behaves as one capability), typed fail-fast conflicts (`CapabilityConflictError`, whose message reports a value's SHAPE and never its content, since a config-built draft can carry tokens), and `provenance` so composition is auditable.

Proven zero-behavior: the capability path is deep-equal to BOTH the `defineAgent` compiler and the decorator `compileAgent` — the artifact M53 deletes — at the waist and through the shared `Agent.create` projection, including via the file/registry route, and confirmed end-to-end against a real provider. The proof also pins the waist fields no capability expresses yet (derived from the type, with a compile-time exhaustiveness check, verified to fail on over-claim as loudly as on omission) — that list is M53's entry criterion.

The agent decorators are untouched in this release; they are removed in M53.
