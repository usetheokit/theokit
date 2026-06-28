---
"@theokit/agents": patch
---

fix(agents): stream incremental tokens, populate tool output, emit running tool_call

The SDK↔agents bridge (`createSdkAgentStream` + `translateToolCallEvent`) now forwards
the streaming + tool data the SDK already produces, fixing three SSE-DX defects:

- **#40 — token streaming.** `createSdkAgentStream` now passes `SendOptions.onDelta` to
  `agent.send` and merges the incremental `text_delta` tokens into the event stream
  (`mergeDeltaStream`), deduping the complete-assistant text (`sawDelta`) so it is not
  double-emitted. A provider that never calls `onDelta` falls back to the complete-assistant
  text (no loss). Previously the whole round was emitted at once at turn end.
- **#41 — tool output.** `translateToolCallEvent` now serializes a non-string tool `result`
  (`serializeToolOutput` → JSON, BigInt-safe) instead of dropping it via `asString(...,'')`,
  so object tool results (`{ ok, files }`) reach consumers instead of `''`.
- **#42 — running tool_call.** The `running` tool status now emits a `tool_call` StreamEvent
  (callId + toolName + input) so UIs can show a running card with args, instead of only the
  terminal `tool_result`.

Bridge-only; no SDK change, no runtime re-implementation (sdk-runtime.md/G2).
