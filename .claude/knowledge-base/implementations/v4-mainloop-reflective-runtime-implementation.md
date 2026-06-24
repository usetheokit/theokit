# Implementation Contract — v4-mainloop-reflective-runtime

> Working contract for the `/implement` halt-loop. Source of truth for TDD detail is the plan:
> `.claude/knowledge-base/plans/v4-mainloop-reflective-runtime-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 88.8).
> Each task below: read the plan's matching `#### TDD` / `#### Files to edit` / `#### Acceptance criteria` / `#### DoD`.

**Plan verdict:** SHIPPABLE_WITH_CAVEATS 88.8 · **code-quality:** PASS · **deps-audit:** PASS · **edge-cases:** absorbed (EC-1 MUST FIX + EC-3/EC-4).
**Branch:** develop · **Package:** `packages/agents` · **Test runner:** `pnpm --filter @theokit/agents test` (vitest).

## Ordered task list (dependency-respecting)

| # | Task | Phase | Depends on | Status |
|---|---|---|---|---|
| T1.1 | `LoopStrategy` interface + `LoopOutcome` + Zod config + `resolveLoopStrategy` (NEW `src/loop/loop-strategy.ts`) | 1 | — | pending |
| T1.2 | `ReflectionStrategy` interface + Zod + `'ladder'` default (NEW `src/loop/reflection-strategy.ts`) | 1 | — | pending |
| T1.3 | `src/loop/index.ts` barrel + root barrel re-export (`runReflectiveLoop` stays internal) | 1 | T1.1, T1.2 | pending |
| T2.1 | `runReflectiveLoop()` driving `createSdkAgentStream` per round — round-count, reflection, `maxIterations` ceiling, typed-error surfacing, **EC-1 finishReason default-to-'stop'**, **EC-4 budget-across-rounds** (NEW `src/bridge/run-reflective-loop.ts`) | 2 | T1.3 | pending |
| T2.2 | Branch `delegate()` (+ orchestrator entry) on resolved `LoopStrategy` — `simple-chat` single-shot preserved (EC-2), budget clamp across rounds, runtime metric (`src/bridge/agent-orchestrator.ts`) | 2 | T2.1 | pending |
| T3.1 | `AgentRunner` + `AgentRunner.builder().reflection().stream().build().run()` imperative twin, D4 compile-parity (NEW `src/runner/agent-runner.ts`) | 3 | T2.2 | pending |
| T4.1 | End-to-end `reflective-loop-wiring.test.ts` proving N>1 rounds via BOTH on-ramps + runtime-metric + full chain | 4 | T3.1 | pending |

## Global DoD (from plan)
- [ ] `pnpm --filter @theokit/agents test` green (incl. new `tests/unit/main-loop-runtime.test.ts` + `tests/integration/reflective-loop-wiring.test.ts`)
- [ ] `tsc` 0 errors; lint 0
- [ ] Wiring triad per new public symbol (caller + integration test + metric where declared)
- [ ] Zero `@MainLoop` strategies remain metadata-only (integration test proves `plan-act-reflect` runs N>1 rounds)
- [ ] Direction `@theokit/agents → @theokit/sdk` preserved (no sdk→agents); barrel imports only (INVARIANT #3)
- [ ] CHANGELOG `[Unreleased]` updated (consumer-visible: `@MainLoop` now executes)

## Wiring triad targets (public symbols)
`resolveLoopStrategy`, `ladderReflectionStrategy`, `runReflectiveLoop` (internal — wired via delegate), `AgentRunner`. Metric: the plan's runtime metric (`THEO_AGENT_LOOP_*` / round-count log) — pillar (c) per plan DoD.
