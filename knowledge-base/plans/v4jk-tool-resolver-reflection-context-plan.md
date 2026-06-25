---
slug: v4jk-tool-resolver-reflection-context
milestone_id: V4-J
created_at: 2026-06-25
goal: Close the two @theokit/agents framework gaps blocking theocode's loop adoption — runtime tool override (V4-J) + stateful reflection context (V4-K) — proven by the @theokit/agents test suite passing with ≥ 4 new tests green.
---

# V4-J runtime tool override + V4-K ReflectionContext (framework-first)

> v1.0 (2026-06-25) — closes the 2 gaps the theocode loop-adoption discover surfaced (both verified `file:line`): (1) AgentRunner can't override tools at runtime; (2) ReflectionStrategy.reflect is stateless. Both are thin, backward-compatible hooks. NO app-specific policy leaks into the framework (the loop never name-matches "edit tools" — that stays in the consumer's custom strategy).

## Goal

Close the two `@theokit/agents` framework gaps blocking theocode's loop adoption — **V4-J** runtime tool override on `AgentRunner.stream()/run()` and **V4-K** a per-run mutable `ReflectionContext` threaded to `ReflectionStrategy.reflect()` — proven by the `@theokit/agents` test suite passing with ≥ 4 new tests green (`pnpm --filter @theokit/agents test`).

Single observable metric: `pnpm --filter @theokit/agents test` exits 0 with ≥ 4 new tests covering runtime tool override + ReflectionContext threading.

## Context

theocode's loop adoption (the ~128 LoC real collapse) is blocked on two `@theokit/agents` gaps (discover 2026-06-25):

1. **Runtime tools (V4-J)** — theocode selects tools per request by `mode`/permission; `AgentRunner.stream()` hardcodes `this.compiled.tools` (`agent-runner.ts:111`), so the tool set is fixed at `build()`. A per-run override unblocks it.
2. **Stateful reflection (V4-K)** — theocode's reflection ladder needs cumulative counters across rounds; `ReflectionStrategy.reflect(outcome)` is stateless (`reflection-strategy.ts:30`). A per-run mutable context unblocks it.

Both are thin hooks at known insertion points. **Honest scope (no app-leak):** the `ReflectionContext` is a GENERIC mutable scratch bag the consumer's strategy owns — the framework creates one per run and threads the SAME object each round, but NEVER writes app-specific fields (no "edits" counting, no `isEditToolName` in the loop — that is theocode's policy, kept in theocode's custom `ReflectionStrategy`). This is framework-first: ship the generic hooks; theocode adopts them later.

## Baseline Context

### Files that will be touched / mirrored

| File | LoC | Last touch (sha, date) | Role today / why it exists |
|---|---|---|---|
| `packages/agents/src/loop/agent-runner.ts` | 152 | (post-V4-F) | EDIT — add `tools?` to `AgentRunnerRunOptions`; `stream()` resolves `opts.tools ?? this.compiled.tools` before `createSdkAgentStream` (`:111`). |
| `packages/agents/src/loop/reflection-strategy.ts` | 78 | (post-V4-C) | EDIT — add `ReflectionContext` type + `reflect(outcome, ctx?)` signature; ladder/noop ignore `ctx`. |
| `packages/agents/src/loop/run-reflective-loop.ts` | 346 | (post-V4-D-stream) | EDIT — create one `ReflectionContext` per run; pass it to `reflection.reflect(outcome, ctx)` (`:309`). |
| `packages/agents/src/loop/index.ts` | ~40 | (post-V4-F) | EDIT — export `ReflectionContext`. |
| `packages/agents/src/index.ts` | 15 | (post-V4-F) | EDIT (if needed) — ensure `CompiledTool` is reachable at the root barrel (V4-J `opts.tools` type). |
| `packages/agents/tests/integration/runtime-tools.test.ts` | 0 (NEW) | — | NEW — V4-J: `opts.tools` overrides `compiled.tools` end-to-end. |
| `packages/agents/tests/unit/reflection-context.test.ts` | 0 (NEW) | — | NEW — V4-K: same ctx object threaded across rounds; a stateful strategy accumulates. |
| `packages/agents/src/bridge/agent-compiler.ts` | — | — | NOT edited — `CompiledTool` (`:21`) is the public tool shape `opts.tools` uses. |
| `packages/agents/src/bridge/sdk-adapter.ts` | — | — | NOT edited — `createSdkAgentStream(compiled, tools, ...)` already takes tools as a parameter (`:67`), so the override needs zero change here. |

### Current callers / dependents

- `AgentRunner.stream()` (`agent-runner.ts:105`) — calls `createSdkAgentStream(this.compiled, this.compiled.tools, opts.apiKey, this.compiled.model)` (`:109-114`). `run()` (`:126`) drains `stream()`. Test callers: `tests/integration/reflective-loop-stream.test.ts`, `tests/integration/compaction-runner.test.ts`, `tests/unit/agent-runner*.test.ts`.
- `createSdkAgentStream(compiled, compiledTools, apiKey, envModel)` (`sdk-adapter.ts:65`) — already accepts `compiledTools` as a parameter → the V4-J override is a one-line change at the call site only.
- `reflection.reflect(outcome)` (`run-reflective-loop.ts:309`) — the sole call site; inside the per-round loop after the round is consumed. `ladderReflectionStrategy`/`noopReflectionStrategy` (`reflection-strategy.ts:48,72`) implement `reflect`. `delegate()` (`agent-orchestrator.ts`) + `AgentRunner` both run through `runReflectiveLoopStream`.
- `CompiledTool` (`agent-compiler.ts:21`) — `{ name, description, inputSchema, handler }`; exported via `bridge/index.ts:20`. V4-J's `opts.tools` reuses this exact type.

### Domain glossary

- **Runtime tool override (V4-J)** — a per-`.stream()`/`.run()` `opts.tools?: readonly CompiledTool[]` that replaces the build-time `compiled.tools` for that call. Opt-in; absent ⇒ `compiled.tools` (unchanged).
- **ReflectionContext (V4-K)** — a mutable scratch object (`interface ReflectionContext { [key: string]: unknown }`) created ONCE per `runReflectiveLoopStream` run and passed to every `reflect(outcome, ctx)` call, so a stateful strategy can accumulate cumulative state (counters, one-shot flags) across rounds. The framework owns the lifecycle (create + thread the same ref); the STRATEGY owns the contents (the framework writes nothing app-specific).
- **CompiledTool** — the bridge's compiled tool shape `{ name, description, inputSchema, handler }` (`agent-compiler.ts:21`); the type of `opts.tools`.

### Architecture boundaries affected

- G1 (no cycle): both edits are within `loop/` + reuse existing `bridge` types (`CompiledTool`, already imported via `CompiledAgentOptions`). No new module edge.
- G2/sdk-runtime: the SDK stays the only runtime; V4-J just chooses WHICH compiled tools reach `createSdkAgentStream`; V4-K is pure between-round logic. No LLM call added.
- G11 (YAGNI) / no app-leak: `ReflectionContext` is generic; the framework MUST NOT add theocode-specific fields or name-match "edit" tools in the loop (that is consumer policy).
- INVARIANT #3 (barrels): `ReflectionContext` exported via `loop/index.ts`; `CompiledTool` reachable at the root barrel.

## Prior Art & Related Work

- **theocode loop-adoption discover (2026-06-25)** — the cross-repo audit that surfaced both gaps with `file:line` + the insertion points (the `isEditToolName`-in-loop idea it sketched is REJECTED here as app-leak).
- **In-repo V4-C `ReflectionStrategy`** (`reflection-strategy.ts`) — the interface V4-K extends (the `reflect(outcome, ctx?)` BC change).
- **In-repo V4-D-stream `runReflectiveLoopStream`** (`run-reflective-loop.ts`) — the loop that threads the ctx + already passes a per-run accumulator (`acc`), the precedent for a per-run object.
- **In-repo V4-F `CompactionCallOptions`** (`compaction-strategy.ts`) — precedent for a per-call options object faithfully forwarded.
- **`knowledge-base/references/mastra`** — `stopWhen`/customizable strategy predicates; the prior art for pluggable per-run strategy state.
- Memory `[[project_v4f_compaction_reality]]` — names these 2 gaps as the loop-adoption blockers.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | (workspace) | npm | Existing config-schema SSoT; no new schema needed (ReflectionContext is a scratch bag, not serialized config). |
| `@theokit/sdk` | `>=2.9.0` | npm | The runtime; unchanged by this slice. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | | | | Pure in-package framework hooks; no new dependency. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Runtime tools via a per-run `opts.tools` override (not a builder method, not a decorator change)

**Decision:** Add `tools?: readonly CompiledTool[]` to `AgentRunnerRunOptions`; `stream()` uses `opts.tools ?? this.compiled.tools`. Decorators (`@Tool`/`@Agent`) and the compile path are untouched.

**Rationale:** theocode's tool set varies PER REQUEST (mode + permission), so the override belongs on the per-call options, not on the builder (which is per-agent) or the decorators (which are static). `createSdkAgentStream` already accepts tools as a parameter, so the override is a one-line call-site change — minimal, backward-compatible (absent ⇒ current behavior).

**Alternatives rejected:**
- **Builder `.tools(resolver)`** — REJECTED: builder state is per-agent, not per-request; theocode needs per-request variation.
- **Dynamic-tool decorator** — REJECTED: decorators are static metadata; runtime selection cannot live there (the gap itself).
- **Resolver function `(base) => tools`** — DEFERRED (YAGNI): a resolved list covers theocode's need (it builds the per-mode list); add a resolver only if a second consumer needs to filter the base (Rule of 3).

### D2 — `ReflectionContext` is a generic mutable scratch bag the strategy owns (no app policy in the framework)

**Decision:** `ReflectionContext` is `interface ReflectionContext { [key: string]: unknown }`. The loop creates ONE per run and passes the SAME ref to every `reflect(outcome, ctx)`. The framework writes NOTHING into it; the consumer's strategy owns its contents.

**Rationale:** stateful reflection (cumulative counters, one-shot flags) needs a per-run mutable object, but the framework cannot know app semantics (what an "edit" is). Putting theocode-specific counting in the loop would violate G2 (app policy in framework) + G11. A generic scratch bag is the correct abstraction (mirrors middleware context / a mutable ref): the framework owns the lifecycle, the strategy owns the data.

**Alternatives rejected:**
- **Framework pre-fills `edits`/`verifyReflectionUsed` (the discover's sketch)** — REJECTED: app-policy leak; the loop would name-match tool names it has no business knowing.
- **Typed context with framework-computed generic fields** — DEFERRED (YAGNI): no current consumer needs framework-provided cumulative facts; `LoopOutcome` already carries per-round data. Add typed fields when a real need appears (Rule of 3).
- **Generic on `ReflectionStrategy<TState>`** — REJECTED: complicates the interface for every implementer; the index-signature bag is simpler and sufficient.

### D3 — Both signature changes are backward-compatible (optional/additive)

**Decision:** `opts.tools?` is optional; `reflect(outcome, ctx?)` makes `ctx` optional. Existing strategies/callers compile + behave identically.

**Rationale:** `@theokit/agents@0.8.0` is published; existing `ReflectionStrategy` implementers (and `AgentRunnerRunOptions` callers) must not break. Optional params are additive (minor bump). Shipped `ladderReflectionStrategy`/`noopReflectionStrategy` ignore `ctx`.

**Alternatives rejected:**
- **Required `ctx` param** — REJECTED: breaks published-API implementers of `ReflectionStrategy`.

## Dependency Graph

```
T1.1 (V4-J: opts.tools override + CompiledTool root export)
   ↓ (independent of V4-K)
T2.1 (V4-K: ReflectionContext type + reflect(outcome, ctx?) + thread in loop)
   ↓
T3.1 (Integration validation: suite + typecheck + lint + depcruise + changeset)
```
(T1.1 and T2.1 are independent and may be implemented in either order; T3.1 gates both.)

## Phases

### Phase 1 — V4-J runtime tool override

#### Task T1.1 — `opts.tools` override on `AgentRunner.stream()/run()`

**Files to edit:** `packages/agents/src/loop/agent-runner.ts`; `packages/agents/src/index.ts` (export `CompiledTool` at root if not already); `packages/agents/tests/integration/runtime-tools.test.ts` (NEW).

**Deep file dependency analysis:** `AgentRunnerRunOptions` (`agent-runner.ts:33`) gains `readonly tools?: readonly CompiledTool[]`. `stream()` (`:105`) computes `const tools = opts.tools ?? this.compiled.tools` and passes `tools` to `createSdkAgentStream` (`:111`). `CompiledTool` imported from `../bridge/agent-compiler.js` (already the source of `CompiledAgentOptions`). `createSdkAgentStream` (`sdk-adapter.ts:65`) unchanged (already param-based).

**Why this step:** closes the runtime-tools gap. Action: add the optional field + resolve at the call site. Reasoning: the SDK adapter already accepts tools as a parameter, so the only rigidity is the hardcoded `this.compiled.tools` — a one-line `??` override removes it without touching decorators/compile (ADR D1), per-request as theocode needs.

#### TDD
- RED: `test_stream_uses_opts_tools_when_provided` — `vi.mock('../../src/bridge/sdk-adapter.js')` capturing the `compiledTools` arg; build a runner; call `runner.run('go', { apiKey:'k', tools: [FAKE_TOOL] })`; assert `createSdkAgentStream` received `[FAKE_TOOL]` (not `compiled.tools`). Fails before the override (it always passes `compiled.tools`).
- RED: `test_stream_falls_back_to_compiled_tools_when_opts_tools_absent` — call without `tools`; assert `createSdkAgentStream` received `this.compiled.tools` (BC).
- GREEN: add `tools?` + the `??` resolve.
- REFACTOR: keep `stream()` < 50 LoC; ensure `CompiledTool` reachable at root barrel for the public option type.

#### Concurrency tests
(none — single-threaded; per-call option selection, no shared state.)

#### Acceptance criteria
- `grep -n "tools?: readonly CompiledTool\[\]" packages/agents/src/loop/agent-runner.ts` returns the new field (exit 0).
- `node --input-type=module -e "import('@theokit/agents').then(a=>process.exit(a.AgentRunner?1:1))"` — the public surface still loads (exit 0).
- `pnpm --filter @theokit/agents test tests/integration/runtime-tools.test.ts` exits 0 (override + fallback both proven).
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0.

#### DoD
- The 2 new V4-J tests green; existing `agent-runner`/`reflective-loop-stream` tests stay green (BC). Verify: `pnpm --filter @theokit/agents test`.

### Phase 2 — V4-K ReflectionContext

#### Task T2.1 — `ReflectionContext` type + `reflect(outcome, ctx?)` + per-run threading

**Files to edit:** `packages/agents/src/loop/reflection-strategy.ts`; `packages/agents/src/loop/run-reflective-loop.ts`; `packages/agents/src/loop/index.ts`; `packages/agents/tests/unit/reflection-context.test.ts` (NEW).

**Deep file dependency analysis:** `reflection-strategy.ts` gains `export interface ReflectionContext { [key: string]: unknown }` + the signature `reflect(outcome: LoopOutcome, ctx?: ReflectionContext): ReflectionResult`; `ladderReflectionStrategy`/`noopReflectionStrategy` add an ignored `_ctx?` param. `run-reflective-loop.ts` creates `const reflectionContext: ReflectionContext = {}` once before the loop (near `acc`, `:274`-ish) and changes the call at `:309` to `reflection.reflect(outcome, reflectionContext)`. `loop/index.ts` exports `ReflectionContext`.

**Why this step:** closes the stateful-reflection gap. Action: add the generic ctx type + thread the same object each round. Reasoning: a per-run mutable object is the minimal way to let a strategy accumulate cumulative state; making it generic (D2) keeps app policy out of the framework; optional param keeps BC (D3).

#### TDD
- RED: `test_reflect_receives_same_context_object_across_rounds` — a custom strategy records `ctx` each round + writes `ctx.n = (ctx.n ?? 0) + 1`; mock a 3-round SDK stream; assert the SAME ctx ref is passed every round AND `ctx.n === 3` at the end (cumulative state survives). Fails before threading (no 2nd arg).
- RED: `test_stateful_strategy_can_accumulate_and_terminate` — a strategy that continues while `ctx.count < 2` then stops; assert the loop terminates after the strategy's cumulative condition fires (proves stateful control).
- RED: `test_shipped_ladder_and_noop_ignore_ctx` — `ladderReflectionStrategy.reflect(outcome, {})` + `noopReflectionStrategy.reflect(outcome, {})` behave identically to the no-ctx call (BC).
- GREEN: add the type + signature + threading.
- REFACTOR: `run-reflective-loop.ts` stays < 500 LoC; framework writes NOTHING into ctx (assert by code review — no app-field writes in the loop).

#### Concurrency tests
(none — single-threaded; the ctx is per-run, not shared across runs; each `runReflectiveLoopStream` call creates its own.)

#### Acceptance criteria
- `grep -n "ctx?: ReflectionContext" packages/agents/src/loop/reflection-strategy.ts` returns the new signature (exit 0).
- `grep -n "reflect(outcome, reflectionContext)" packages/agents/src/loop/run-reflective-loop.ts` returns the threaded call (exit 0).
- The loop creates exactly ONE `ReflectionContext` per run (the same ref every round) — proven by `test_reflect_receives_same_context_object_across_rounds`.
- The framework writes no app-specific field into ctx — `grep -nE "reflectionContext\.[a-zA-Z]" packages/agents/src/loop/run-reflective-loop.ts` returns 0 (only the bare object is created + passed).
- `ReflectionContext` exported: `grep -n "ReflectionContext" packages/agents/src/loop/index.ts` returns the export (exit 0).

#### DoD
- The 3 new V4-K tests green; existing reflection/loop tests stay green (BC). Verify: `pnpm --filter @theokit/agents test`.

## Coverage Matrix

| # | Requirement (from Goal/Context) | Source | Task(s) |
|---|---|---|---|
| G1 | `opts.tools?: readonly CompiledTool[]` overrides `compiled.tools` per run | D1 | T1.1 |
| G2 | Absent `opts.tools` ⇒ `compiled.tools` (backward-compatible) | D3 | T1.1 |
| G3 | `CompiledTool` reachable at the root barrel (public option type) | Baseline | T1.1 |
| G4 | `ReflectionContext` generic mutable bag; one per run; same ref each round | D2 | T2.1 |
| G5 | `reflect(outcome, ctx?)` backward-compatible (ladder/noop ignore ctx) | D3 | T2.1 |
| G6 | Framework writes NO app-specific field into ctx (no app-leak) | D2 | T2.1 |
| G7 | `ReflectionContext` exported from the loop barrel | INVARIANT #3 | T2.1 |
| G8 | No new dependency; no cycle (depcruise 0) | architecture.md | T3.1 |
| G9 | ≥ 4 new tests green (Goal metric) — 5 planned | Goal | T1.1 (2), T2.1 (3) |
| G10 | Changeset (minor @theokit/agents) | Global DoD | T3.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `ReflectionContext = { [k]: unknown }` is loosely typed (no compile-time safety on the strategy's own fields) | MEDIUM | Intentional (D2) — the framework cannot type app fields; documented as a strategy-owned scratch bag. A consumer can narrow it locally (`ctx as MyState`). Future: a generic `ReflectionStrategy<TState>` if a real need appears (Rule of 3). | author |
| `opts.tools` exposes the bridge `CompiledTool` shape on the public API | LOW | `CompiledTool` is already the documented compiled tool type (exported via bridge barrel); reusing it avoids a parallel type (DRY). Consumers building it is acceptable (same as the SDK's tool shape). | implementer |
| Signature change to `ReflectionStrategy.reflect` could surprise published-0.8.0 implementers | LOW | `ctx?` is OPTIONAL — existing implementers compile + run unchanged (D3); covered by `test_shipped_ladder_and_noop_ignore_ctx`. | implementer |
| Scope: 2 features in one slice | LOW | They are independent thin hooks (T1.1 ⫫ T2.1); a single changeset documents both; each has its own tests. | author |

## Unresolved Questions

- Whether to also expose a resolver-function form of `opts.tools` (`(base) => tools`): DEFERRED (YAGNI / Rule of 3) — a resolved list covers theocode; revisit when a second consumer needs base-filtering. Resolved at plan time.

(none — every decision is resolved at plan time)

## Failure scenarios

(none — no external I/O touched. Both hooks are pure in-process logic: V4-J selects which already-built tools reach the existing SDK-adapter parameter; V4-K threads an in-memory object. The SDK call boundary is unchanged from V4-D-stream, whose failure scenarios already cover the stream/error/budget paths.)

## Global DoD

- `pnpm --filter @theokit/agents test` exits 0 with ≥ 4 new tests green (Goal metric; 5 planned).
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0 (G3 — no any/@ts-ignore beyond the documented `{[k]:unknown}` index signature).
- `npx eslint packages/agents --max-warnings=0` clean.
- `npx depcruise packages/agents/src --config .dependency-cruiser.cjs` — 0 violations (no new cycle).
- `/code-quality v4jk-tool-resolver-reflection-context` verdict ∉ {FAIL_HARD, INVALID}.
- Every touched file < 500 LoC; every new/changed function < 50 LoC (G6).
- No app-specific policy in the framework loop (D2 — manual review + the `grep` acceptance check).
- Changeset: `.changeset/v4jk-tool-resolver-reflection-context.md` minor bump for `@theokit/agents`.

## Final Phase: Integration Validation

### Task T3.1 — Changeset + full validation

**Files to edit:** `.changeset/v4jk-tool-resolver-reflection-context.md` (NEW).

**Deep file dependency analysis:** changesets is theokit's release mechanism; the changeset declares the `@theokit/agents` minor bump (new `opts.tools` + `ReflectionContext`). Mirrors `.changeset/v4f-compaction-strategy.md`.

**Why this step:** the "eat your own cooking" gate — the slice is not done until typecheck/lint/suite/depcruise pass on the integrated tree and the new surface is release-recorded. Reasoning: both hooks are backward-compatible additions; the changeset versions them for theocode to later consume.

#### TDD
- RED: the validation chain is the executable assertion (each command exits 0).
- GREEN: write the changeset; run the chain; fix any breakage.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded; release metadata + validation only.)

#### Acceptance criteria
- `.changeset/v4jk-tool-resolver-reflection-context.md` declares `"@theokit/agents": minor`.
- The full validation chain (below) passes.

#### DoD
- All validation items below exit clean.

The plan is NOT complete until:
1. `pnpm --filter @theokit/agents test` green (full suite + ≥ 4 new tests).
2. `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
3. `npx eslint packages/agents --max-warnings=0` clean.
4. `npx depcruise packages/agents/src --config .dependency-cruiser.cjs` 0 violations.
5. Changeset written.
