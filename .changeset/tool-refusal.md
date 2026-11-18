---
'@theokit/agents': minor
'@theokit/presenter': minor
---

A tool result the SDK reported as `permission_denied` now carries a typed `refusal` (`ToolRefusal`: `by`, `reason?`). `@theokit/presenter` adds `ToolRefusal`, `AgentToolResultEvent.refusal` and the transient `WIRE_TOOL_REFUSAL_PART` (`data-tool-refusal`); `readMessageStream` sets `refusal` on the tool part. `@theokit/agents` maps the SDK `source` (`file_hook` → `hook`; `plugin`, `fork_whitelist` → `plugin`) onto `ToolResultEvent.refusal`. The message the model reads is unchanged.
