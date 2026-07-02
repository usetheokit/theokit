---
"@theokit/agents": minor
---

Surface the SDK's `partial-tool-call` update as a typed `PartialToolCallEvent` (`type: 'partial_tool_call'`) on the `AgentStreamEvent` stream, so consumers can render tool arguments progressively as the model generates them (closes theokit-sdk#70).

Previously `translateInteractionUpdate` dropped `partial-tool-call`, forcing downstream apps to wait for the complete `tool_call` (args committed) — visible "dead air" for large Write/Edit tool bodies. The new event is emitted at a **distinct** lifecycle point (arg-streaming) and never duplicates `tool_call`: the same `callId` correlates the partials to the later committed `tool_call` and `tool_result`. Adds `isPartialToolCall` type-guard. Non-breaking union growth — existing consumers ignore the new variant.
