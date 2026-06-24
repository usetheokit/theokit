# Blueprint: V4-D react-loop terminals — `no_progress` + `step_limit` for `LoopStrategy`

**Slug:** `v4d-react-loop-terminals` · **Date:** 2026-06-23 · **Sources:** codex (Rust), opencode (TS)
**Plan:** `.claude/knowledge-base/discoveries/plans/v4d-react-loop-terminals-plan.md` (v1.2, SHIPPABLE_WITH_CAVEATS 89)

## Executive summary

The V4-D delta after `@theokit/agents@0.6.0` is two loop terminals. The investigation of the two canonical agent loops the user designated splits cleanly: **opencode is the SOTA of `step_limit` handling** — at the step ceiling it does NOT hard-abort; it disables tools (`toolChoice: "none"`, no tool defs) and injects a `MAX_STEPS_PROMPT` that forces a text-only summary (graceful degradation, `opencode/packages/core/src/session/runner/llm.ts:193,202` + `max-steps.ts`). **Neither codex nor opencode implements `no_progress`** — codex's outer loop drains a pending-input queue and lets the inner `run_turn` stop on model completion (`codex/codex-rs/core/src/tasks/regular.rs:73-88`), and opencode explicitly lists "Bound … repeated identical tool calls" as an UNIMPLEMENTED checkbox (`llm.ts:51 [ ]`). So `no_progress` is a deliberate theokit value-add, to be derived from the theocode `classifyRoundOutcome` spec + first principles (NOT copied from a reference). Recommendation: adopt opencode's graceful-degradation pattern for `step_limit`; add a first-principles `no_progress` detector (between-round tool-call-set equality + empty-round, K-consecutive threshold) as a new `LoopFinishReason`.

## Context

`0.6.0` shipped the react multi-round foundation (`resolveLoopStrategy('react')`, `maxIterations` ceiling, `runReflectiveLoop`). The missing terminals: `no_progress` (terminate a stuck agent before burning `maxIterations`) and `step_limit` (surface "stopped at ceiling" distinctly from `stop`/done). `LoopOutcome.finishReason` today is only `'tool-calls'|'stop'|'length'|'error'` (`packages/agents/src/loop/loop-strategy.ts:19`). V3-4 (SDK continuation driver) is out of scope (app-policy) — the terminals live in `LoopStrategy`.

## Objective

Specify how `LoopStrategy`/`runReflectiveLoop` detect `no_progress` and surface `step_limit`, grounded in codex + opencode, without touching `@theokit/sdk`.

## Coverage Corner 1 — Integration Tests

### Q4 — How codex/opencode test loop terminals without a live LLM

**codex** (`codex/codex-rs/core/src/session/turn_tests.rs`): async `#[tokio]` tests with `pretty_assertions::assert_eq` (`:5`), e.g. `plan_mode_uses_contributed_turn_item_for_last_agent_message` (`:41`) asserts the `last_agent_message` returned by the turn against a fixture (`:62-63`). The model is faked at the client layer; the test asserts terminal turn-item state.

**opencode** (`opencode/packages/core/test/session-runner.test.ts`): `bun:test` + `effect`. It builds a fake provider via `OpenAIChat.route.with({ limits: { context, output } })` (`:102,107`) and a tool harness that records `maxActiveToolExecutions` (`:71,142`) with tools whose `execute` can `Effect.die("unexpected tool defect")` (`:151-154`). Round/terminal behavior is asserted against scripted provider output.

**Recipe for theokit:** identical to the existing `createMockAgentStream()` approach (`sdk-runtime.md` § "O que é permitido") already used by `runReflectiveLoop`'s tests — script a fake stream whose rounds repeat an identical tool-call (to trigger `no_progress`) or never terminate (to trigger `step_limit`), assert the terminal `finishReason` + round count. No new test infra needed.

## Coverage Corner 2 — Dependencies

### Q5 — Who owns the loop primitive

**opencode**: the loop is built on `@opencode-ai/llm` (`workspace:*`, `opencode/packages/core/package.json`) + the `effect` runtime (`llm.ts:1-20` imports `Cause, DateTime, Effect, FiberSet, …`). The step limit is opencode's own code (`isLastStep`), NOT an external `stopWhen` lib.

**codex**: hand-rolled Rust — `async-channel`, `codex-async-utils`, `codex-utils-stream-parser`, tokio streams (`codex/codex-rs/core/Cargo.toml`). No external agent-loop dependency.

**Relevance:** both own their loop primitive (no third-party loop lib). theokit is the same — `runReflectiveLoop` is self-owned. So `no_progress`/`step_limit` are added in-house with ZERO new dependency. Confirms the V4-D slice adds no dep (clean `/deps-audit`).

## Coverage Corner 3 — Tools

### Q6 — How the loop is exercised locally

**opencode**: root `test` is disabled (`opencode/package.json`: `"test": "echo 'do not run tests from root' && exit 1"`); tests run per-package with `bun test` (the suite uses `bun:test`). Typecheck: `bun turbo typecheck`.

**codex**: `codex/justfile:77 test *args` → `cargo test`; scoped run `cargo test -p codex-core` (`codex/codex-rs/Cargo.toml` is a Cargo workspace).

**Relevance:** theokit already has `pnpm --filter @theokit/agents test` (vitest) — no tooling change; the new terminal tests are vitest unit/integration like the 0.6.0 suite.

## Coverage Corner 4 — Techniques

### Q1 — opencode `step_limit`: graceful degradation, NOT hard abort

`opencode/packages/core/src/session/runner/llm.ts:193`:
```ts
const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(...)   // :194 — no tools on last step
const request = LLM.request({
  messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])], // :202
  tools: toolMaterialization?.definitions ?? [],
  toolChoice: isLastStep ? "none" : undefined,   // :205 — tools forbidden on last step
})
```
`MAX_STEPS_PROMPT` (`max-steps.ts`) instructs: "MAXIMUM STEPS REACHED … Tools are disabled … MUST provide a text response summarizing work done so far … List of any remaining tasks … Recommendations for what should be done next." So the step limit produces a **useful final answer**, not a truncated/aborted run. This is the SOTA pattern for `step_limit`.

### Q2 — codex turn loop: model-completion + queue-drain, no step counter at the outer layer

`codex/codex-rs/core/src/tasks/regular.rs:73-88`:
```rust
loop {
    let last_agent_message = run_turn(sess, ctx, …, next_input, …).await?;
    if !sess.input_queue.has_pending_input(&sess.active_turn).await {
        return Ok(last_agent_message);   // terminate when no queued input remains
    }
    next_input = Vec::new();
}
```
The OUTER loop re-enters only to drain queued user input; the agentic tool loop lives INSIDE `run_turn` (`session/turn.rs`, 2458 LoC), which terminates on model completion. Cancellation is via `cancellation_token.child_token()` → `context/turn_aborted.rs`. **codex has no outer step-count or no-progress terminal** — it relies on the model deciding to stop calling tools.

### Q3 — `no_progress`: NOT present in either reference (honest verdict)

- **opencode**: `llm.ts:51` lists `- [ ] Bound provider retries and repeated identical tool calls.` — an explicitly UNIMPLEMENTED checkbox. The "Duplicate tool call" guards in `publish-llm-event.ts:316,341` are protocol-level event-id dedup (`Effect.die` on a duplicate event id), NOT a stuck-loop detector.
- **codex**: grep for `repeated|duplicate|no_progress|stuck|stall` in `session/` returned only MCP plugin-install telemetry — no no-progress detector.

**Verdict:** neither reference detects no-progress; both accept the stuck-loop risk bounded only by step/turn count (opencode) or model completion (codex). Therefore `no_progress` is derived from the theocode `classifyRoundOutcome` spec (ROADMAP-v3 § V3-4) + first principles, NOT copied. The honest signal: compare round N's tool-call set + text delta to round N-1; if identical (or empty) for K consecutive rounds → `no_progress`.

## Cross-cutting Comparison

| Dimension | opencode | codex | theokit target (V4-D) |
|---|---|---|---|
| Step limit | `currentStep >= agent.info.steps` (`llm.ts:193`) | none at outer loop (model completion) | `maxIterations` ceiling (shipped 0.6.0) → surface as `step_limit` |
| At step limit | graceful: disable tools + `MAX_STEPS_PROMPT` summary (`llm.ts:202,205`) | n/a | **adopt** graceful degradation (recommended) |
| No-progress detection | UNIMPLEMENTED TODO (`llm.ts:51`) | none | **new** first-principles detector |
| Loop ownership | self (`@opencode-ai/llm` + effect) | self (hand-rolled Rust) | self (`runReflectiveLoop`) — no new dep |
| Terminal signal | step count | model finishReason | `LoopFinishReason` enum (extend) |

## Recommendations

1. **`step_limit` — extend `LoopFinishReason` + adopt graceful degradation.** Add `'step_limit'` to `LoopFinishReason` (`loop-strategy.ts:19`). When `runReflectiveLoop` stops because `round >= maxIterations` (not a natural `stop`), set `finishReason: 'step_limit'`. Adopt opencode's pattern: on the final round, the reflection feedback instructs a tools-off text summary (the bridge can pass a "final" hint; the SDK already runs the model). This makes "ran out of steps" observable + produces a useful answer instead of a silent truncation.
2. **`no_progress` — new first-principles detector in the loop driver.** Add `'no_progress'` to `LoopFinishReason`. In `runReflectiveLoop`, after each round compute a progress signal = (round's tool-call set, responseText). If it equals the prior round's (or the round is empty) for K (default 2) consecutive rounds → terminate with `finishReason: 'no_progress'`. Bounded, pure, testable. Label it explicitly as a theokit enhancement beyond codex/opencode.
3. **No new dependency** — both terminals are in-house in `packages/agents/src/loop/`, no SDK change, no V3-4 (clean `/deps-audit`).
4. **Tests** — vitest, `createMockAgentStream`-style: a stuck script (repeat identical tool_result) asserts `no_progress` at round K; a never-terminating script asserts `step_limit` at `maxIterations`.

## ADRs

### D1 — `no_progress` is derived, not copied (honest provenance)

**Decision:** implement `no_progress` from the theocode `classifyRoundOutcome` spec + first principles, documented as a theokit value-add.

**Rationale:** Q3 verdict — neither codex nor opencode has a no-progress detector (opencode `llm.ts:51 [ ]` TODO; codex none). Claiming a reference for it would be a fabricated citation. Alternatives considered: copy opencode (impossible — unimplemented), skip no_progress (rejected — it is the V4-D value-add that protects budget on stuck loops).

**Consequences:** the blueprint honestly attributes `no_progress` to first principles; the implementation owns its correctness via tests, not a reference port.

### D2 — `step_limit` adopts opencode's graceful degradation

**Decision:** at the `maxIterations` ceiling, surface `finishReason: 'step_limit'` and degrade gracefully (tools-off final summary), modeled on opencode `llm.ts:193,202,205` + `MAX_STEPS_PROMPT`.

**Rationale:** opencode is the SOTA here — a hard abort wastes the work done; a forced text summary is strictly more useful. Alternative (plain terminal, no summary) rejected as worse UX.

**Consequences:** `step_limit` is observable + produces a usable answer; one new enum value + a final-round hint in `runReflectiveLoop`.

### D3 — V3-4 out of scope; terminals live in `LoopStrategy`

**Decision:** no `@theokit/sdk` change; both terminals are pure `LoopStrategy`/`runReflectiveLoop` concerns.

**Rationale:** ROADMAP-v3 § V3-4 says the SDK continuation driver may stay app-policy; Q5 confirms theokit owns its loop primitive (like codex/opencode). No dep, no SDK edit.

**Consequences:** the slice stays inside `packages/agents`; G1/G2 boundaries untouched.

## Blocked questions (if any)

None — all 6 questions answered with verified citations. Q3 returned an honest "not present in either reference" verdict (not a block — the halt-loop honesty gate was satisfied).
