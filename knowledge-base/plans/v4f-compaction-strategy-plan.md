---
slug: v4f-compaction-strategy
milestone_id: V4-F
created_at: 2026-06-25
goal: Add a callable `CompactionStrategy` authoring layer to `@theokit/agents` whose `'token-budget'` default delegates to the SDK's `compactTranscript`, proven by `@theokit/agents` test suite passing with ≥ 4 new tests green.
---

# V4-F — `CompactionStrategy` + `@Compaction` (callable authoring layer)

> v1.1 (2026-06-25) — absorbed `/edge-case-plan` MUST-FIX EC-1 + SHOULD-TEST EC-2..EC-5 + DOCUMENT EC-6/EC-7. Unresolved Question resolved.

## Goal

Add a callable `CompactionStrategy` authoring layer to `@theokit/agents` whose `'token-budget'` default delegates to the SDK's `compactTranscript`, proven by the `@theokit/agents` test suite passing with ≥ 4 new tests green (`pnpm --filter @theokit/agents test`).

Single observable metric: `pnpm --filter @theokit/agents test` exits 0 with ≥ 4 new tests covering the strategy/decorator/resolver/builder surface.

## Context

V4-F is the next slice of the V4 declarative-authoring line (V4-B `AgentRunner` builder, V4-C `ReflectionStrategy` + reflection, V4-D `LoopStrategy` + the streaming reflective loop — all shipped, `@theokit/agents@0.7.0` + the uncommitted V4-D-stream slice `e1f73fb`). Today the only context-compaction surface in `@theokit/agents` is the `@ContextWindow` knob (`decorators/context-window.ts`), which `compileContextWindow` maps to the SDK's `ContextSettings.maxTokens` and otherwise reports as `metadataOnlyKnobs` (honest metadata-only, never runtime). There is **no named, callable compaction strategy** — so the reference app (`theocode`) hand-rolls `server/lib/compaction.ts` (150 LoC) wrapping the SDK's `compactTranscript`.

V4-F promotes the knob to a **named, callable** `CompactionStrategy` (Strategy pattern), mirroring the V4-C/V4-D precedent exactly: interface + zod config schema + a `'token-budget'` default + a `resolveCompactionStrategy(name, opts)` resolver + a `@Compaction(...)` decorator + `AgentRunnerBuilder.compaction(...)` exposing a public readonly `runner.compaction` field the app calls directly.

**Decision C (resolved with the user, 2026-06-25):** the `CompactionStrategy` is a **callable authoring layer**, NOT a loop transcript-owner. `sdk-runtime.md` locks "the SDK owns per-turn context"; the reflective loop does not maintain a client-side transcript. So the app keeps *when-to-compact* + the summarize callback, and replaces only its `compactTranscript`-wrapping shape with `runner.compaction.compact(...)`. Honest partial collapse — NOT the full 150 LoC (most of `theocode/server/lib/compaction.ts` is app policy: `SUMMARY_TEMPLATE`, `CHECKPOINT_MARKER`, `isOverflowError`).

**Empirically-corrected dependency reality (this overturns the ROADMAP's "no new dependency" framing):** the installed `@theokit/sdk@2.5.0` that theokit consumes exposes `compactTranscript` with ONLY `keepRecent` + `summarize` — `keepTokens` (the token-budget mode `'token-budget'` needs) DOES NOT EXIST until `@theokit/sdk@2.9.0` (the version theocode already runs). Therefore V4-F REQUIRES catching theokit's lockfile up to `@theokit/sdk@2.9.0` (already inside the existing `^2.5.0` range — a `pnpm update`, not a range-widening) AND tightening the agents peer floor `>=2.5.0` → `>=2.9.0` AND adding a NEW runtime import of `@theokit/sdk/compaction` (today agents imports `@theokit/sdk` for TYPES only). Phase 0 makes this dependency change a first-class, `/deps-audit`-gated step.

## Baseline Context

### Files that will be touched / mirrored

| File | LoC | Last touch (sha, date) | Role today / why it exists |
|---|---|---|---|
| `packages/agents/src/loop/compaction-strategy.ts` | 0 (NEW) | — | NEW — the `CompactionStrategy` interface + `'token-budget'` default + zod schema + `resolveCompactionStrategy`. |
| `packages/agents/src/decorators/compaction.ts` | 0 (NEW) | — | NEW — `@Compaction(name, opts)` class decorator + `getCompactionConfig`. |
| `packages/agents/tests/unit/compaction-strategy.test.ts` | 0 (NEW) | — | NEW — unit TDD for the strategy/resolver/decorator. |
| `packages/agents/tests/integration/compaction-runner.test.ts` | 0 (NEW) | — | NEW — integration: `runner.compaction.compact(...)` delegates to a mocked `@theokit/sdk/compaction`. |
| `packages/agents/src/loop/reflection-strategy.ts` | 77 | `157c2fd` 2026-06-23 | TEMPLATE to mirror: interface + default + zod `*ConfigSchema`. Not edited. |
| `packages/agents/src/loop/loop-strategy.ts` | 86 | `58e6e30` 2026-06-23 | TEMPLATE to mirror: `resolveLoopStrategy(name, opts)` resolver shape. Not edited. |
| `packages/agents/src/loop/agent-runner.ts` | 142 | `e1f73fb` 2026-06-25 | EDIT: add `AgentRunnerBuilder.compaction(name, opts)` + `AgentRunner` readonly `compaction` field (mirrors `.reflection()` + readonly `reflectionStrategy`). |
| `packages/agents/src/loop/index.ts` | ~30 | `58e6e30` 2026-06-23 | EDIT: export the new `CompactionStrategy` surface from the barrel (INVARIANT #3). |
| `packages/agents/src/decorators/index.ts` | ~? | — | EDIT: export `@Compaction` + `getCompactionConfig`. |
| `packages/agents/src/bridge/walk-agent-metadata.ts` | 306 | `704bce5` 2026-06-22 | EDIT: surface `@Compaction` config on the walk result (mirrors how `contextWindow` is surfaced at lines 262/278). |
| `packages/agents/src/decorators/context-window.ts` | 57 | `efe63ed` 2026-06-11 | TEMPLATE to mirror: `setMeta`/`getMeta` decorator metadata pattern. NOT edited (backward-compatible — stays). |
| `packages/agents/package.json` | 62 | `bbf059f` 2026-06-23 | EDIT: peer `@theokit/sdk` `>=2.5.0` → `>=2.9.0`; dev `^2.5.0` → `^2.9.0`. |
| `package.json` (root) | — | — | EDIT (if `pnpm update` rewrites): `@theokit/sdk` resolves to 2.9.0 in lockfile. |
| `.changeset/v4f-compaction-strategy.md` | 0 (NEW) | — | NEW — minor bump for `@theokit/agents`. |

### Current callers / dependents

- `AgentRunner` / `AgentRunnerBuilder` — production callers: `packages/agents/src/loop/index.ts` (barrel re-export); consumed by `delegate()`/app code. Test callers: `packages/agents/tests/integration/reflective-loop-stream.test.ts` (`e1f73fb`), `tests/unit/agent-runner*.test.ts`.
- `compactTranscript` — NO current caller inside `packages/agents` (grep returned 0). theokit's only `@theokit/sdk` imports in agents are `import type` (`sdk-adapter.ts:9`, `compile-context-window.ts:12`, `agent-compiler.ts:9`, `compile-project-context.ts:17`, `compile-skills.ts:15`). V4-F adds the FIRST runtime import.
- `@ContextWindow` / `getContextWindowConfig` / `compileContextWindow` — surfaced in `walk-agent-metadata.ts:262,278` + `warnUnmappedDecoratorKnobs` (`:264`). UNCHANGED by V4-F (backward-compatible).
- Cross-repo consumer: `theocode/server/lib/compaction.ts` `compactHistory` wraps `sdkCompactTranscript({ keepTokens, summarize, marker, summaryTemplate, failSafe })` (theocode on `@theokit/sdk@2.9.0`). This is the shape V4-F's `runner.compaction.compact(...)` lets theocode replace — adoption is a SEPARATE downstream slice, NOT this plan.

### Domain glossary

- **CompactionStrategy** — a named, pluggable object `{ name; compact(messages, options): Promise<messages> }` (Strategy pattern). The agents-layer authoring interface; the SDK owns the algorithm.
- **`'token-budget'`** — the default strategy name; delegates to `compactTranscript({ keepTokens })` (SDK ≥ 2.9.0 token-budget mode: keeps the trailing turns whose accumulated tokens fit the budget).
- **`compactTranscript`** — the SDK public primitive (`@theokit/sdk/compaction`): `compactTranscript(messages: CompressibleMessage[], options?): Promise<CompressibleMessage[]>`. Never mutates input. Summarization delegated to a caller-supplied `summarize` callback.
- **CompressibleMessage** — the SDK's transcript message type, re-exported from `@theokit/sdk/compaction`.
- **keepTokens vs keepRecent** — `keepRecent` (turn COUNT, default 6, in 2.5.0+); `keepTokens` (token BUDGET, takes precedence, 2.9.0+). V4-F's `'token-budget'` needs `keepTokens` → SDK ≥ 2.9.0.

### Architecture boundaries affected

- `architecture.md` / G1 dependency direction: `agents` may import `@theokit/sdk` (external npm package — the runtime). Adding `import { compactTranscript } from '@theokit/sdk/compaction'` is a NEW runtime edge to the SDK, NOT an intra-`agents` cross-module deep import — no cycle (`agents → @theokit/sdk` is the sanctioned direction; G2 forbids reimplementing the SDK, not importing it).
- G1 (between-packages): `@theokit/agents` does NOT import `theokit` core — unaffected.
- G2/`sdk-runtime.md`: the SDK owns compaction; V4-F DELEGATES to `compactTranscript`, never reimplements it.
- INVARIANT #3 (barrels): new public symbols flow through `loop/index.ts` + `decorators/index.ts`.

## Prior Art & Related Work

- **In-repo `ReflectionStrategy`** (`packages/agents/src/loop/reflection-strategy.ts`, `157c2fd`) — the exact interface + default + zod `reflectionStrategyConfigSchema` template V4-F mirrors.
- **In-repo `resolveLoopStrategy`** (`packages/agents/src/loop/loop-strategy.ts:70`, `58e6e30`) — the `resolve<Strategy>(name, opts)` resolver template.
- **In-repo `AgentRunnerBuilder.reflection()` + `AgentRunner.reflectionStrategy`** (`packages/agents/src/loop/agent-runner.ts`, `e1f73fb`) — the builder-method + readonly-field template.
- **In-repo `@ContextWindow`** (`packages/agents/src/decorators/context-window.ts`, `efe63ed`) — the `setMeta`/`getMeta` decorator-metadata template.
- **SDK `@theokit/sdk/compaction`** (`compactTranscript`, published 2.9.0) — the delegated algorithm; type surface read from `node_modules/.pnpm/@theokit+sdk@.../dist/compaction.d.ts`.
- **theocode `server/lib/compaction.ts`** — ground truth of what the app currently hand-rolls; V4-F lets it replace the `compactHistory` wrapper (adoption is a downstream slice).
- **Memory `[[project_v2_2_adoption_reality]]`** — the lesson that the ROADMAP overstates adoptable surface; applied here (partial LoC collapse, corrected dependency).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | (workspace pin) | npm | Config schema SSoT (type-safety.md / G3). Already a dep. |

### Changed — version bump (the empirically-required correction)

| Package | From | To | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|---|
| `@theokit/sdk` | `>=2.5.0` (peer) / `^2.5.0` (dev) | `>=2.9.0` (peer) / `^2.9.0` (dev) | npm | Evaluated: (a) reimplement token-budget selection in agents — REJECTED, violates G2/sdk-runtime (don't reimplement SDK compaction); (b) ship `'token-budget'` as turn-count `keepRecent` only — REJECTED, contradicts the strategy name + the theocode-proven token-budget semantics; (c) bump to the SDK version exposing `keepTokens` — CHOSEN. | `@theokit/sdk@2.9.0` is the published version exposing `compactTranscript({keepTokens})` AND is the version theocode already runs in production (proven-good floor). `^2.5.0` already permits 2.9.0 — this is a lockfile catch-up + peer-floor tighten, not a range widening. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none — `@theokit/sdk` already a dependency; only the runtime import path `@theokit/sdk/compaction` is new) | | | | |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — `CompactionStrategy` is a callable authoring layer, not a loop transcript-owner

**Decision:** `CompactionStrategy.compact(messages, options)` is invoked by the APP (exposed via `runner.compaction`), not auto-invoked between rounds by the reflective loop.

**Rationale:** `sdk-runtime.md` locks "the SDK owns per-turn context/transcript". The reflective loop (`run-reflective-loop.ts`) streams via the SDK session and does NOT maintain a client-side transcript to compact. Making the loop own a transcript mirror would contradict that invariant and balloon the slice well past effort-S. Mirrors how `theocode` already decides *when* to compact at the app layer. Resolved with the user (2026-06-25, option C).

**Alternatives rejected:**
- **AgentRunner owns transcript** (option B) — the loop maintains a message mirror + compacts between rounds. REJECTED: contradicts `sdk-runtime.md` (SDK owns transcript), G2 tension, exceeds effort-S, rework risk.
- **Compile-to-knob only** (option A) — `@Compaction` compiles `keepTokens` → `ContextSettings.maxTokens`; agents never calls `compactTranscript`. REJECTED by the user: smallest LoC collapse, doesn't reuse `compactTranscript` (contradicts the ROADMAP intent), reduces V4-F to sugar over the existing knob.

### D2 — `'token-budget'` delegates to the SDK `compactTranscript`, never reimplements compaction

**Decision:** The `'token-budget'` strategy's `compact()` calls `compactTranscript(messages, { keepTokens, summarize })` from `@theokit/sdk/compaction`.

**Rationale:** G2 + `sdk-runtime.md` — the SDK owns the compaction algorithm; agents provides the named-strategy authoring interface only. Reusing the SDK primitive is also DRY (no second algorithm) and keeps provider/version parity.

**Alternatives rejected:**
- **Reimplement token-budget windowing in agents** — REJECTED: direct G2 violation; duplicates `selectCompressionWindow` the SDK already ships.
- **Estimate tokens + map to `keepRecent`** — REJECTED: that IS reimplementing the selection algorithm with a worse approximation; also `keepRecent` is turn-count, not token-budget.

### D3 — Config schema is a zod SSoT; the strategy is pure of I/O except the delegated SDK call

**Decision:** `compactionStrategyConfigSchema` (zod) is the single source of truth for `{ name, keepTokens? }`; the strategy performs no I/O of its own — it forwards `summarize` (an app-supplied callback) to the SDK.

**Rationale:** type-safety.md / G3 (zod SSoT, no manual duplicate types, no `any`). Mirrors `reflectionStrategyConfigSchema` / `loopStrategyConfigSchema`. Keeping the strategy free of its own I/O preserves testability (mock the SDK module) and honesty (G10 — the `summarize` callback is the app's, surfaced explicitly, never a silent no-op).

**Alternatives rejected:**
- **Hand-written TS interface for config** — REJECTED: G3 forbids manual types duplicating a zod schema.

## Dependency Graph

```
Phase 0 (SDK bump + deps-audit)
   ↓ (blocks all — keepTokens must resolve before 'token-budget' can delegate)
Phase 1 (CompactionStrategy interface + 'token-budget' default + resolver)
   ↓
Phase 2 (@Compaction decorator + walk surfacing)   ── can parallelize with Phase 3 after Phase 1
   ↓
Phase 3 (AgentRunnerBuilder.compaction() + AgentRunner.compaction field + barrels)
   ↓
Phase 4 (Integration Validation)
```

## Phases

### Phase 0 — SDK dependency catch-up (keepTokens floor)

#### Task T0.1 — Bump `@theokit/sdk` to expose `keepTokens`

**Files to edit:** `packages/agents/package.json` (peer `>=2.5.0`→`>=2.9.0`, dev `^2.5.0`→`^2.9.0`); root `package.json` + `pnpm-lock.yaml` (via `pnpm update @theokit/sdk`).

**Deep file dependency analysis:** `packages/theo/package.json` also pins `@theokit/sdk@^2.5.0`; `pnpm update` will move theo to 2.9.0 too (already in-range). Agents' existing `import type` usages (`ContextSettings`, `SkillsSettings`, `SystemPromptResolver`) must remain type-compatible across 2.5→2.9 (validated by Phase 4 typecheck + full theo suite).

**Why this step:** `compactTranscript({keepTokens})` does not exist before 2.9.0 (empirically verified: installed 2.5.0 `CompactTranscriptOptions` has only `keepRecent`+`summarize`). Without this bump, ADR D2's delegation cannot compile (`keepTokens` is not a valid option). This action precedes all code because the type surface the strategy imports is gated on it.

#### TDD
- RED: a probe test `test_sdk_exposes_keepTokens_option` that imports `CompactTranscriptOptions` from `@theokit/sdk/compaction` and asserts (via a typed object literal `{ keepTokens: 8000 }` compiling) the option exists — fails on 2.5.0, passes on 2.9.0. (Type-level assertion via `expectTypeOf` or a compiling fixture.)
- GREEN: `pnpm update @theokit/sdk` + package.json edits.
- REFACTOR: none (dependency change).

#### Concurrency tests
(none — single-threaded; dependency/version change only.)

#### Acceptance criteria
- `node -e "require('@theokit/sdk/package.json').version"` reports `2.9.0` (or higher in-range).
- `grep keepTokens node_modules/@theokit/sdk/dist/compaction.d.ts` resolves.
- `/deps-audit v4f-compaction-strategy` verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`} (no HIGH/CRITICAL CVE on the bumped dep).

#### DoD
- `pnpm install` clean; `pnpm --filter @theokit/agents test` + `pnpm --filter theokit test` stay green (no regression from the SDK bump). Verify: `pnpm --filter @theokit/agents test && pnpm --filter theokit test`.

### Phase 1 — `CompactionStrategy` interface + `'token-budget'` default + resolver

#### Task T1.1 — Define the strategy interface, zod schema, default, and resolver

**Files to edit:** `packages/agents/src/loop/compaction-strategy.ts` (NEW); `packages/agents/tests/unit/compaction-strategy.test.ts` (NEW).

**Deep file dependency analysis:** Mirrors `reflection-strategy.ts` (`157c2fd`) for the interface+default+schema and `loop-strategy.ts:70` (`58e6e30`) for `resolve*`. Imports `compactTranscript`, `type CompressibleMessage`, `type CompactTranscriptOptions` from `@theokit/sdk/compaction` (the FIRST runtime SDK import in agents — see Baseline Context callers).

**Why this step:** The interface + default + resolver are the load-bearing authoring surface; everything else (decorator, builder) wires into them. Action: create the Strategy abstraction. Reasoning: the Strategy pattern + named-default + resolver is the precedent the whole V4 line uses (ADR D1/D2/D3); reusing the shape keeps the API consistent and the resolver gives `@Compaction`/builder a single resolution point (DRY).

#### TDD
- RED: `test_token_budget_strategy_delegates_to_compactTranscript` — `vi.mock('@theokit/sdk/compaction')`; call `tokenBudgetCompactionStrategy.compact(msgs, { keepTokens: 8000, summarize })`; assert the mock received `(msgs, { keepTokens: 8000, summarize })` and the strategy returns the mock's result. Given a transcript + keepTokens, When `compact` is called, Then `compactTranscript` is invoked with the same args and its result returned.
- RED: `test_resolveCompactionStrategy_returns_token_budget_by_name` — `resolveCompactionStrategy('token-budget', { keepTokens: 8000 }).name === 'token-budget'`.
- RED: `test_unknown_compaction_name_throws_typed_error_at_build` (EC-5) — `resolveCompactionStrategy('toke-budget' as never, {})` throws a typed zod error naming the bad value (mirrors `resolveLoopStrategy`'s enum parse — `loop-strategy.ts:74`).
- RED: `test_token_budget_requires_keepTokens` (EC-2, resolves Unresolved Question) — `compactionStrategyConfigSchema` REQUIRES `keepTokens` (positive int) when `name === 'token-budget'`; parsing `{ name:'token-budget' }` (no keepTokens) OR `keepTokens <= 0` throws a typed error — fail-fast, NEVER silent degradation to turn-count (G10). Use a zod `.refine`/discriminated shape.
- RED: `test_compact_empty_and_below_budget_passthrough` (EC-3) — `compact([], { keepTokens: 8000, summarize })` resolves to `[]`; a below-budget transcript returns unchanged (delegation; `compactTranscript` never mutates and no-ops below budget).
- GREEN: implement interface `CompactionStrategy { readonly name; compact(messages, options): Promise<CompressibleMessage[]> }`, `compactionStrategyConfigSchema` (keepTokens required for `'token-budget'`), `tokenBudgetCompactionStrategy`, `resolveCompactionStrategy`. JSDoc on `compact()` notes EC-6: consumers with richer roles (e.g. `'tool'`) cast to `CompressibleMessage[]` at the call site (the SDK's type contract, as theocode does today).
- REFACTOR: SRP/file < 500 LoC, fn < 50; check against SOLID/DRY.

#### Concurrency tests
(none — single-threaded; `compact` is `async` but performs no shared-state mutation; `compactTranscript` never mutates input per its contract.)

#### Acceptance criteria
- Unit suite green; `compact()` is a pure delegation (no logic beyond forwarding + returning).
- No `any`, no `@ts-ignore` (G3); zod is the only type source for config.
- `tokenBudgetCompactionStrategy` exported and reachable (G7 — exercised by tests; production caller arrives T3.1).

#### DoD
- `pnpm --filter @theokit/agents test tests/unit/compaction-strategy.test.ts` green; `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.

### Phase 2 — `@Compaction` decorator + walk surfacing

#### Task T2.1 — `@Compaction(name, opts)` decorator + `getCompactionConfig` + walk surfacing

**Files to edit:** `packages/agents/src/decorators/compaction.ts` (NEW); `packages/agents/src/decorators/index.ts` (export); `packages/agents/src/bridge/walk-agent-metadata.ts` (surface config); `packages/agents/tests/unit/compaction-strategy.test.ts` (extend).

**Deep file dependency analysis:** Mirrors `decorators/context-window.ts` (`efe63ed`) `setMeta`/`getMeta` with a fresh `Symbol.for('theokit:agents:compaction')`. `walk-agent-metadata.ts` already surfaces `contextWindow` at `:262`/`:278` — add a parallel `compaction` field on `AgentWalkResult` (`:66`).

**Why this step:** The decorator is the declarative on-ramp (`@Compaction('token-budget', { keepTokens })`); surfacing it on the walk lets the builder/compiler read it. Action: add metadata decorator + walk field. Reasoning: matches the existing `@ContextWindow`→walk pattern, keeping declaration consistent (a junior already knows the shape).

#### TDD
- RED: `test_Compaction_decorator_stores_config` — `getCompactionConfig(DecoratedClass)` returns `{ name:'token-budget', keepTokens:8000 }`.
- RED: `test_walk_surfaces_compaction_config` — `walkAgentMetadata(DecoratedClass, [])` result has `compaction: { name:'token-budget', keepTokens:8000 }`; absent decorator ⇒ `compaction: undefined`.
- GREEN: implement decorator + `getCompactionConfig` + walk field.
- REFACTOR: keep decorator < 50 LoC.

#### Concurrency tests
(none — single-threaded; decorator metadata is set at class-eval time.)

#### Acceptance criteria
- Decorator config validated through `compactionStrategyConfigSchema` (G3 SSoT, reused from T1.1).
- `@ContextWindow` path untouched (backward-compatible — its tests stay green).

#### DoD
- Unit suite green; barrel `decorators/index.ts` exports `Compaction` + `getCompactionConfig`; `npx tsc --noEmit` exit 0.

### Phase 3 — `AgentRunnerBuilder.compaction()` + `AgentRunner.compaction` (the wiring triad caller)

#### Task T3.1 — Builder method + public readonly field + barrel exports

**Files to edit:** `packages/agents/src/loop/agent-runner.ts` (EDIT); `packages/agents/src/loop/index.ts` (export the `CompactionStrategy` surface); `packages/agents/tests/integration/compaction-runner.test.ts` (NEW).

**Deep file dependency analysis:** Mirrors `AgentRunnerBuilder.reflection()` + the readonly `reflectionStrategy` field (`agent-runner.ts`, `e1f73fb`). `build()` resolves the compaction strategy with **explicit precedence (EC-1): the `.compaction()` builder override WINS over the `@Compaction` decorator** (mirrors `this.reflectionOverride ?? walk-based`), and when NEITHER is set the field is `undefined` (compaction is opt-in — see resolved Unresolved Question). When set, resolution goes through `resolveCompactionStrategy`; the result is passed to the `AgentRunner` constructor as an **optional** readonly `compaction?: CompactionStrategy` field. The app calls `runner.compaction?.compact(...)`.

**Why this step:** This is the wiring-triad caller (pillar a) — without a production caller, `CompactionStrategy` is a dead export (code-quality `dead_public_export` FAIL_HARD). Exposing `runner.compaction` is the app-facing on-ramp decided in ADR D1. Action: add builder method + optional field + barrel. Reasoning: parity with `.reflection()`/`reflectionStrategy` keeps the builder coherent; the readonly field is the callable surface theocode adopts.

#### TDD
- RED: `test_builder_compaction_resolves_token_budget` — `AgentRunner.builder(Agent).compaction('token-budget', { keepTokens: 8000 }).build().compaction?.name === 'token-budget'`.
- RED: `test_Compaction_decorator_flows_to_runner` — an `@Compaction(...)`-decorated agent built WITHOUT `.compaction()` exposes the decorated config on `runner.compaction`.
- RED: `test_builder_compaction_overrides_decorator` (EC-1, MUST FIX) — an `@Compaction('token-budget',{keepTokens:8000})` agent built WITH `.compaction('token-budget',{keepTokens:2000})` exposes `keepTokens:2000` (builder wins).
- RED: `test_runner_compaction_undefined_when_unset` (EC-4) — a bare agent (no decorator, no builder call) ⇒ `runner.compaction === undefined`; JSDoc documents the field is optional and the app MUST null-check (`runner.compaction?.compact(...)`).
- RED: `test_runner_compaction_compact_delegates_end_to_end` — `vi.mock('@theokit/sdk/compaction')`; `await runner.compaction!.compact(msgs, { keepTokens: 8000, summarize })` calls the mocked `compactTranscript` and returns its result (integration: builder → resolver → strategy → SDK).
- GREEN: implement `.compaction()` + optional constructor field + `build()` resolution (builder-override precedence, undefined-when-unset) + barrel exports.
- REFACTOR: agent-runner.ts stays < 500 LoC (currently 142; well within budget).

#### Concurrency tests
(none — single-threaded; build() is synchronous, compact() is delegated async with no shared state.)

#### Failure scenarios (external module boundary — `@theokit/sdk/compaction`)
- Covered in `## Failure scenarios` below.

#### Acceptance criteria
- `runner.compaction` is a public readonly `CompactionStrategy` reachable from the package barrel (G7: production caller present).
- `.reflection()`/`.stream()` builder behavior unchanged (regression: existing `agent-runner` + `reflective-loop-stream` tests stay green).
- `code-quality` reports NO `dead_public_export` for the new symbols.

#### DoD
- `pnpm --filter @theokit/agents test` green (full suite, ≥ 4 new tests); barrel exports verified; `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.

## Coverage Matrix

| # | Requirement (from Goal/Context) | Source | Task(s) |
|---|---|---|---|
| G1 | `CompactionStrategy` interface + zod config schema | Goal / D3 | T1.1 |
| G2 | `'token-budget'` default delegates to SDK `compactTranscript` | Goal / D2 | T1.1, T3.1 |
| G3 | `resolveCompactionStrategy(name, opts)` resolver | Context | T1.1 |
| G4 | `@Compaction(name, opts)` decorator + walk surfacing | Context | T2.1 |
| G5 | `AgentRunnerBuilder.compaction()` + `AgentRunner.compaction` callable field | D1 | T3.1 |
| G6 | Backward-compat `@ContextWindow` untouched | Context | T2.1, T3.1 |
| G7 | SDK `keepTokens` available (dependency reality) | Context | T0.1 |
| G8 | No-reimplementation of SDK compaction (G2 guardrail) | D2 | T1.1 |
| G9 | Barrel exports (INVARIANT #3) | architecture.md | T2.1, T3.1 |
| G10 | ≥ 4 new tests green (Goal metric) — 12 planned | Goal | T1.1, T2.1, T3.1 |
| G11 | Edge-case absorption (EC-1..EC-5) | edge-cases report | T1.1, T3.1 |
| G12 | Changeset (minor `@theokit/agents`) | Global DoD | T4.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| SDK bump 2.5.0→2.9.0 ripples to `packages/theo` (shared lockfile) and could regress the theo suite | MEDIUM | `^2.5.0` already permits 2.9.0 (sanctioned range); Phase 0 DoD runs BOTH `@theokit/agents` AND `theokit` suites; if theo regresses, `/implement` halts BLOCKED and surfaces it (no silent proceed). | implementer |
| `'token-budget'` strategy is callable but NOT auto-applied in the loop — a consumer may expect the loop to compact automatically (it does not, per ADR D1) | MEDIUM | JSDoc on `runner.compaction` states explicitly "the app decides when to call compact()"; G10 honesty (documented, not a silent no-op); the integration test documents the call-site shape. | implementer |
| Partial LoC collapse in theocode (most of the 150 LoC is app policy) may read as V4-F "under-delivering" vs ROADMAP | LOW | Context section states the honest partial-collapse expectation up-front ([[project_v2_2_adoption_reality]] lesson); adoption is a separate downstream slice with its own honest accounting. | author |
| New runtime import `@theokit/sdk/compaction` is the first runtime SDK edge in agents — a future dual-package/ESM-CJS hazard (cf. [[project_theokit_sdk_dual_package_instanceof]]) | LOW | Import the FUNCTION (`compactTranscript`) + TYPES from the documented subpath barrel `@theokit/sdk/compaction` (not `/internal`); no `instanceof` across entry points; covered by the integration test that imports the real path. | implementer |

## Unresolved Questions

- (RESOLVED by `/edge-case-plan` EC-2/EC-4, 2026-06-25) Default when neither `@Compaction` nor `.compaction()` is set: **`runner.compaction` is `undefined`** — compaction is opt-in (unlike reflection's meaningful no-op default), because a callable strategy with no app intent has nothing to compact. The app null-checks (`runner.compaction?.compact(...)`); tested by `test_runner_compaction_undefined_when_unset` (T3.1). Relatedly, `'token-budget'` REQUIRES `keepTokens` (no silent turn-count fallback) — tested by `test_token_budget_requires_keepTokens` (T1.1).

(none — every decision is resolved at plan time)

## Failure scenarios

External module boundary: `@theokit/sdk/compaction` (in-process async; no network/DB/queue).

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `compactTranscript` (SDK) | throws (e.g., malformed message, summarize callback rejects) | `vi.mock` makes `compactTranscript` reject | `compact()` propagates the rejection unchanged (no swallow — fail-fast per error-handling discipline); the app handles it (it owns when-to-compact). |
| `summarize` callback (app-supplied) | rejects / omitted | test passes a rejecting `summarize`; test omits `summarize` (SDK drops the older window instead) | rejection propagates; omitted ⇒ SDK drops older window (documented SDK contract), `compact()` resolves with the dropped-window result. |

## Global DoD

- `pnpm --filter @theokit/agents test` exits 0 with ≥ 4 new tests green (Goal metric).
- `pnpm --filter theokit test` stays green (no regression from the SDK bump).
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0 (G3 — no `any`/`@ts-ignore`).
- `npx eslint packages/agents --max-warnings=0` clean.
- `npx depcruise packages/agents/src --config .dependency-cruiser.cjs` — 0 violations (no new cycle from the SDK runtime import).
- `/code-quality v4f-compaction-strategy` verdict ∉ {`FAIL_HARD`, `INVALID`} (no dead export, no symbol fabrication).
- `/deps-audit v4f-compaction-strategy` verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`}.
- Every new file < 500 LoC; every new function < 50 LoC (G6).
- CHANGELOG/changeset: `.changeset/v4f-compaction-strategy.md` minor bump for `@theokit/agents`.

## Final Phase: Integration Validation

### Task T4.1 — Changeset + full integration validation

**Files to edit:** `.changeset/v4f-compaction-strategy.md` (NEW).

**Deep file dependency analysis:** The changeset declares the `@theokit/agents` minor bump (new public `CompactionStrategy`/`@Compaction`/`runner.compaction` surface). Mirrors `.changeset/v4d-stream-reflective-loop.md` (the V4-D-stream slice).

**Why this step:** changesets is theokit's release mechanism (not `/release` semver) — the changeset file IS the changelog entry. Without it, the release CI cannot version the new surface. Action: write the changeset + run the full validation chain. Reasoning: this is the "eat your own cooking" gate — the slice is not done until typecheck/lint/suite/depcruise all pass on the integrated tree.

#### TDD
- RED: the validation chain below is itself the executable assertion — each command must exit 0. (No new unit test; this task is the integration gate, not new behavior.)
- GREEN: write the changeset; run the chain; fix any breakage surfaced.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded; validation/release-metadata only.)

#### Acceptance criteria
- `.changeset/v4f-compaction-strategy.md` declares `"@theokit/agents": minor`.
- The full validation chain (items 1–8 below) passes.

#### DoD
- All 8 validation items below exit clean.

The plan is NOT complete until:

1. `pnpm install` clean after the SDK bump.
2. `pnpm --filter @theokit/agents test` green (full suite + ≥ 4 new tests).
3. `pnpm --filter theokit test` green (SDK-bump regression gate).
4. `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
5. `npx eslint packages/agents --max-warnings=0` clean.
6. `npx depcruise packages/agents/src --config .dependency-cruiser.cjs` 0 violations.
7. The failure-scenarios tests (compactTranscript rejects; summarize rejects/omitted) pass.
8. Changeset written.
