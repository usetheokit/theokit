---
"@theokit/agents": patch
---

**Fix #145 — a namespaced toolbox produced a tool name the SDK rejects.**

`toolRuntimeName` joined namespace and tool with `.`, which is outside the charset `@theokit/sdk`
accepts (`/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`). Every namespaced toolbox therefore failed at
`Agent.create` — a **documented** path that never worked against a real provider, unnoticed since M4
because the suites mock the SDK.

- Separator is now `_` (`ops_deploy`). No consumer had the old form working, so the break is
  theoretical; update any hardcoded gate key or allow-list entry.
- The name is validated at **authoring** time: a namespace that cannot mint a valid name throws a
  typed `ConfigurationError` instead of exploding when the model calls the tool.
- `ToolboxCapability` no longer duplicates the HITL key construction — that duplication is what let
  the gate drift from the tool (silently ungating a gated tool when the separator changed).

The regression test does **not** mock `@theokit/sdk`: it calls the real `Agent.create`, whose name
validation runs before any network.
