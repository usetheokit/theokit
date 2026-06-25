---
"@theokit/agents": minor
---

V4-L.2: `AgentRunner.stream()/run()` accept three per-request overrides on `AgentRunnerRunOptions` (Axis-A / SWAP), each merge-over-compiled, parallel to the V4-J `tools` override.

- **`model`** — overrides the compiled model for this call (`opts.model ?? compiled.model ?? default`).
- **`cwd`** — forwarded into `Agent.create({ local: { cwd } })`, so the SDK populates `SystemPromptContext.cwd` (read by a V4-L.1 `SystemPromptResolver` / `@ProjectContext`). Absent ⇒ no `local.cwd`.
- **`maxIterations`** — overrides the reflective-loop ceiling for this call by re-resolving the loop strategy (zod-validated — `< 1` throws, never a silent unbounded loop); the build-time strategy is not mutated. Terminal `step_limit` when the override stops a would-continue round.

All three are backward-compatible (absent ⇒ build-time defaults); a `{ apiKey }`-only call and existing `tools` overrides behave exactly as before. No new dependency.
