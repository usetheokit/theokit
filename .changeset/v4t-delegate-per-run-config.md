---
"@theokit/agents": minor
---

V4-T: `delegate()` carries the same per-run config surface as `AgentRunner.stream()`.

`DelegateOptions` gains optional `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`retry`/`reflection`, and `delegate()` forwards them to `createSdkAgentStream` (the model opt wins over the sub-agent's `@Agent` model) + the reflective loop (retry; custom reflection overriding the strategy-derived ladder/noop). The two on-ramps to the shared `runReflectiveLoop` driver now expose the same per-run surface, so a sub-agent inherits the parent's runtime config (providers, mode-selected permission plugin, working dir, pre-built SDK tools). Additive + backward-compatible: absent fields ⇒ byte-identical to before (decorator model only; strategy-derived reflection; no retry). The fields were already accepted by the adapter's `RuntimeOverrides` + the loop's `RunReflectiveLoopConfig` — pure forwarding, no new dependency (Rule 9). Unblocks an app delegating to a sub-agent without losing per-run config.
