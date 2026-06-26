# Blueprint — V4-N: preserve tool-call fidelity + split usage in the loop outcome

**Slug:** v4n-loop-outcome-fidelity · **Date:** 2026-06-25 · **Status:** SHIPPABLE (discover, file:line verified)
**Question:** Why can't theocode's verify-fix ladder + tool persistence + usage analytics port onto AgentRunner.stream()?

## The gap (confirmed)
`AgentRunner.stream()` flattens per-round data that theocode's tested subsystems need:
- `LoopOutcome.toolCalls` = `{name, input, output}` but `consumeOneRound` (run-reflective-loop.ts) builds it from `tool_result` events → `input` is ALWAYS `{}` (tool_result has no input; the tool_call event's command is dropped) and there is NO `id`.
- `translateToolCallEvent` (event-translator.ts) emits `ToolResultEvent.output = asString(msg.result,'')` (flattened string) and REGENERATES `callId` when absent (discards the SDK `call_id` + structured envelope).
- `DelegationResult` = `{cost:number, tokens:number}` — single summed token count; `consumeOneRound` keeps only `DoneEvent.usage.totalTokens`, dropping the input/output split (and reasoning/cache).

Consequences for theocode adoption: `ranVerification`/`lastVerificationOutcome` (need the tool command + the structured `{stdout,stderr,exit_code}` envelope + id-pairing) cannot run from `LoopOutcome`; the prompt-route tool persistence (id+data) + usage analytics (split tokens, honest-null cost) regress. → verify_before_finish + fix_failed_test (load-bearing for the SWE-bench harness) unbuildable consumer-side without a regression.

## V4-N scope (the fix)
1. `event-translator.ts translateToolCallEvent`: preserve `msg.call_id` on `ToolResultEvent.callId` (stop regenerating); keep the structured result reachable (output as the faithful payload string/JSON).
2. `run-reflective-loop.ts consumeOneRound`: CORRELATE `tool_call` events (carry callId + input/command) with `tool_result` events (carry callId + output) → build `LoopOutcome.toolCalls` entries `{id, name, input, output}` faithfully (input from the tool_call, output from the tool_result).
3. `loop-strategy.ts`: `LoopOutcome.toolCalls` entry gains `id` (additive).
4. `delegation-types.ts` + `consumeOneRound`: `DelegationResult` gains split usage (`tokensInput`/`tokensOutput`); capture `DoneEvent.usage.{inputTokens,outputTokens}` per round.

Backward-compatible (additive fields + a callId passthrough fix). Unblocks the full theocode adoption (ports the verify ladder + tool persistence + usage faithfully).

## Key files
theokit `packages/agents/src/bridge/event-translator.ts` (translateToolCallEvent), `src/loop/run-reflective-loop.ts` (consumeOneRound, DoneEvent usage capture), `src/loop/loop-strategy.ts` (LoopOutcome.toolCalls type), `src/bridge/delegation-types.ts` (DelegationResult).
theocode (consumers needing it): `server/lib/agent-loop.ts` (ranVerification/lastVerificationOutcome), `server/lib/sdk-mappers.ts:111-123` (toolCallToEvent preserves data+id — the fidelity to match), `server/routes/session/[id]/prompt.ts:212-251` (tool persistence + usage).
