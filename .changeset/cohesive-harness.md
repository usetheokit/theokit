---
"theokit": minor
"@theokit/agents": minor
---

Cohesive agent harness (M4, Eixo C) — make the shipped-but-dead `@HumanInTheLoop` + `@Checkpoint`
decorators functional as an adapter over `@theokit/sdk`, with no parallel runtime (ADR 0038).

- **`@HumanInTheLoop`** now pauses the run before a gated tool: the stream emits the ai-sdk-native
  `tool-approval-request` chunk and the run stays paused (the SDK's own awaited `pre_tool_call`
  hook) until `POST /api/agents/<name>/approve/<approvalId>` resolves it — approve runs the tool,
  deny/timeout surfaces the denial and the run continues.
- **`@Checkpoint({ storage: 'filesystem' })`** emits a transient `data-checkpoint` part and selects
  the SDK's durable `FileSystemConversationStorage`, so a same-session follow-up request resumes.
- The M2 file convention gathers a class agent's `@Mixin` toolboxes so a gated tool actually gates
  through the endpoint. `@theokit/agents` adds `createHitlPlugin`; `theokit` adds the approve route
  + in-process approval registry. Additive — the M2 surface is unchanged.
