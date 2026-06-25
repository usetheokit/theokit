# Blueprint — theocode loop adoption: the history-replay gap + the streamToCompletion finding

**Slug:** theocode-loop-adoption-gap
**Date:** 2026-06-25
**Status:** SHIPPABLE (discover finding; decision-grade, file:line verified)
**Question:** Can theocode's `runCodeAgent` outer loop be adopted onto `@theokit/agents` `AgentRunner.stream()` on the shipped framework (@theokit/agents@0.12.0 / @theokit/sdk@2.9.0)?

## Verdict: NO — full adoption onto AgentRunner is BLOCKED; but the SDK already ships theocode's loop

## The blocking gap (confirmed)

theocode's `runCodeAgent` (`server/lib/agent-stream.ts:146-263`) is a continuation loop that REPLAYS accumulated round events as history into each next round: `history: buildContinuationHistory(history, accumulated, budgetChars)` (line 176), window-bounded by `contextWindowFor(model)`. The per-round primitive `defaultLlmStream` (297-412) creates a FRESH agent + `agent.send(formatTranscript(history, prompt))` + `agent.close()` — and theocode replays history MANUALLY because the fresh agent has no memory (`continuation-history.ts`).

`@theokit/agents` `runReflectiveLoopStream` (`run-reflective-loop.ts:120-129,283-324`):
- forwards ONLY `message + [reflection] feedback` to round N+1 — NOT the accumulated tool-result/assistant transcript (`acc.*` accumulates into the RESULT only, never the next prompt).
- `createSdkAgentStream` (`sdk-adapter.ts:101,165-171,199`) IGNORES `sessionId`, sets no `agentId`, and `dispose()`s every round → every round is a memoryless ephemeral agent.
- `AgentRunnerBuilder` has NO custom-`LoopStrategy` hook (only `.reflection()`) — theocode's cap-hit continuation (`classifyRoundOutcome`, continue only when round hit `SDK_INNER_STEP_CAP=8`) can't be injected; and the cap signal `RunResult.stoppedAtIterationLimit` is discarded by the bridge (`deriveFinishReason` only knows error/tool-calls/stop).

**Adopting onto AgentRunner.stream() as shipped would regress the code agent to memoryless rounds** (round 2 wouldn't see what round 1 read/edited). Structural; unfixable from the consumer side.

## The finding that reframes everything: the SDK already ships theocode's loop

`@theokit/sdk@2.9.0` exports (all `@public`, in the barrel `index.d.ts:2189`), and the persistence docstring says they were **extracted FROM theocode's SWE-bench harness** (`persistence.d.ts:9-13`):

- **`SDKAgent.streamToCompletion(message, opts)` / `runToCompletion`** (`types/agent.d.ts:619-650`) — a STATEFUL continuation loop: re-sends a continuation prompt when a send stops at the iteration cap, over a session that PRESERVES conversation, until `done` / `step_limit` (maxRounds) / `no_progress` (two empty rounds). `RunToCompletionOptions`: `maxRounds`, `continuationPrompt`, `onTruncated`, `signal`, `sendOptions.maxIterations`. `RunToCompletionResult.terminal: "done"|"step_limit"|"no_progress"` — IDENTICAL terminal vocabulary to theocode.
- **`Agent.getOrCreate(agentId, options)`** + `AgentOptions.agentId` + default `FileSystemConversationStorage` (`<cwd>/.theokit/agents/<id>/messages.jsonl`) — persisted, auto-reloaded history by id.
- **`buildReplayHistory(base, events, options)`** (`index.d.ts:1142-1180`) — the stateless, SDK-owned equivalent of theocode's `buildContinuationHistory`.

## Full-adoption delta (COVERED / GAP)

| theocode behavior | Status |
|---|---|
| accumulated-history replay across rounds | **GAP (blocker)** — AgentRunner forwards feedback only; SDK has the primitives, the agents bridge uses none |
| cap-hit continuation (continue only at 8 tools) | **GAP** — react continues on any tool round; cap signal discarded by bridge |
| reflection ladder (no_edit→verify→fix, counters) | **COVERED** — maps to a custom `ReflectionStrategy` + `ReflectionContext` (V4-K) |
| no_progress (2 empty rounds vs 2 same-signature) | DIVERGENT (approximation) |
| step_limit/no_progress USER notices | PARTIAL — AgentRunner sets finishReason, emits no message |
| usage aggregation (honest-null cost) | PARTIAL — app-specific (documented SDK divergence) |
| SSE event mapping (`AgentEvent` vs `StreamEvent`) | GAP — translation layer needed |
| transient-retry at stream start | GAP — AgentRunner has no retry |
| cancellation (signal) | COVERED |

## Three forward paths

- **A — Framework-first V4-M, then adopt onto AgentRunner.** Thread `sessionId → agentId` + `Agent.getOrCreate` in `sdk-adapter.ts` (stop per-round dispose), closing the history gap via `FileSystemConversationStorage`; optionally delegate round continuation to the SDK's `streamToCompletion`. Then theocode adopts `AgentRunner.stream()`. Most aligned with the @theokit/agents declarative thesis. Largest path (framework slice + release + adoption). Remaining deltas (SSE translation, retry, notices, cost) are normal consumer work.
- **B — theocode adopts the SDK's `streamToCompletion` directly.** Collapse `runCodeAgent`'s outer loop onto the SDK primitive that was extracted FROM theocode (Rule 9 — don't reinvent; the SDK is the runtime per `sdk-runtime.md`). No framework gap, biggest LoC collapse, history preserved natively. Risk: preserving theocode's reflection LADDER (selectReflection) — needs `onTruncated`/hooks or keep the ladder app-side; bypasses `@theokit/agents` AgentRunner.
- **C — Partial adoption now (ladder-only).** Port `selectReflection` to a custom `@theokit/agents` `ReflectionStrategy` + `ReflectionContext`; keep theocode's outer loop/history. Lands on shipped V4-L (READY_TO_MERGE for that scope); does NOT collapse the loop.

## Recommendation
The honest call is **A or B, not a forced AgentRunner adoption now** (that would be a memoryless-rounds workaround — forbidden). B is the most KISS + Rule-9-aligned (reuse the SDK's own extracted loop); A is the most thesis-aligned (theocode on `@theokit/agents`). The user owns this strategic fork.

## Key files
theocode `server/lib/agent-stream.ts:146-263,297-412`, `continuation-history.ts`, `agent-loop.ts:14,109-185,243-257`; theokit `packages/agents/src/loop/run-reflective-loop.ts:120-129`, `bridge/sdk-adapter.ts:101,165-171,199`, `loop/agent-runner.ts:191-248`; SDK `agent.d.ts` (getOrCreate/streamToCompletion), `types/agent.d.ts:304,452-468,619-650`, `run-D22b53SU.d.ts:696-743`, `index.d.ts:1142-1180,2189`.
