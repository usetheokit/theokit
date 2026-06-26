---
"@theokit/agents": minor
---

V4-N: the reflective loop now exposes faithful per-round tool calls + split token usage, so a custom `ReflectionStrategy` (and `DelegationResult` consumers) can read the tool-call command, correlate by id, and map split usage.

- `LoopOutcome.toolCalls` / `DelegationResult.toolCalls` entries now carry `{ id, name, input, output }` — `input` is the tool-call args (correlated from the `tool_call` event by callId), no longer always `{}`, and `id` is the call id.
- `DelegationResult` now carries `tokensInput` / `tokensOutput` (accumulated across rounds); `tokens` (total) is preserved.

Additive + backward-compatible (existing fields unchanged; new fields are optional on `DelegationResult`). `consumeOneRound` correlates each round's `tool_call` events (which carry the input/command) with their `tool_result` events (which carry the output) by callId; an unmatched result degrades to `input: {}` (no worse than before). The tool-call id+input half flows on the real SDK path. NOTE: the split-usage half is plumbing — the SDK adapter must emit real per-turn token counts on the `done` event for `tokensInput`/`tokensOutput` to be non-zero (today it emits zeros, unchanged from before; a follow-up). Unblocks a consumer's verify-before-finish / fix-failed-test ladder + tool persistence that need the command and the id.
