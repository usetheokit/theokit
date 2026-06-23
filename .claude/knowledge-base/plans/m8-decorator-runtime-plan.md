---
slug: m8-decorator-runtime
milestone_id: M8
created_at: 2026-06-22
goal: Give SDK-backed runtime to the @ContextWindow, @ProjectContext and @Skills decorators so none stays metadata-only.
---

# Plan: M8 — Camada declarativa: dar runtime aos decorators (Tema F / Seção 6)

> **Version 1.1** (absorbed edge-case EC-1: settingSources for skills discovery) — The `@theokit/agents` decorators `@ContextWindow`, `@ProjectContext` and `@Skills` currently store config via `setMeta` but nothing ever reads it into the agent runtime (the "decorator-without-runtime" anti-pattern). This plan compiles each decorator's metadata into real `@theokit/sdk` `AgentOptions` fields (`skills` → `SkillsSettings`, `@ContextWindow` → `ContextSettings`, `@ProjectContext` → a composed `systemPrompt`) and wires them through `sdk-adapter.ts` into `Agent.create()`, honoring `sdk-runtime.md` (the SDK executes; the bridge only compiles). Knobs with no native SDK mapping emit an explicit `metadata-only` warning instead of silently lying. M8-4 ships a standalone ADR resolving the strategic future of di/gateways/plugins in light of the SDK's decorators-optional decision (`theokit-sdk` CLAUDE.md rule 9, 2026-06-18).

## Goal

> Enable `@theokit/agents` consumers to give SDK-backed runtime to the `@ContextWindow`, `@ProjectContext` and `@Skills` decorators so that each decorator's metadata compiles into a non-empty `@theokit/sdk` `AgentOptions` field executed by `Agent.create()`, measured by `pnpm --filter @theokit/agents test` passing with the new `tests/unit/m8-*.test.ts` + `tests/integration/m8-adapter-wiring.test.ts` suites green (zero of the three decorators remains metadata-only).

## Context

The roadmap's M8 (`gap-audit/ROADMAP.md` §"M8 — Camada declarativa") flags the "decorator sem runtime" anti-pattern: `@ContextWindow`/`@AutoSummarize`, `@ProjectContext`, and `@Skills` declare configuration but no code path executes it. The prerequisite primitives shipped in earlier milestones — M2 compaction (`@theokit/sdk/compaction`), M3 repo-map (`@theokit/sdk-tools`), M4 skills + project-instructions (`@theokit/sdk/skills`, `@theokit/sdk/project`) — are now released on npm (`@theokit/sdk@2.5.0`, `@theokit/sdk-tools@0.2.0`), so M8's dependencies are satisfied.

A grep of the `@theokit/agents` source confirms the gap: `getContextWindowConfig` and `getProjectContextConfig` are defined + exported but have **zero consumers** outside their own decorator file; `getSkillsConfig` IS walked (`walk-agent-metadata.ts:211`) and reaches `CompiledAgentOptions.skills`, but `sdk-adapter.ts` never passes `skills` to `Agent.create()` — so even the "walked" config dies before execution.

The `sdk-runtime.md` rule (INQUEBRÁVEL) governs the shape of the fix: decorators **describe**, they do not execute; `bridge/agent-compiler.ts` **compiles** metadata into a format the SDK accepts; the SDK is the only runtime. M8 therefore compiles metadata into `AgentOptions` fields the SDK already executes — it must NOT reimplement compaction/session/streaming in the bridge.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/decorators/skills.ts` | 36 | `efe63ed` (2026-06-11) | `@Skills` decorator: stores `{include, autoDiscover}` via `setMeta` | `getSkillsConfig(target)` signature stays; `SkillsOptions` shape unchanged |
| `packages/agents/src/decorators/context-window.ts` | 57 | `efe63ed` (2026-06-11) | `@ContextWindow` decorator: stores compaction strategy via `setMeta` | `getContextWindowConfig`, `ContextWindowOptions` exports stay backward-compatible |
| `packages/agents/src/decorators/project-context.ts` | 66 | `efe63ed` (2026-06-11) | `@ProjectContext` decorator: stores codebase-context config | `getProjectContextConfig`, `ProjectContextOptions` exports stay backward-compatible |
| `packages/agents/src/bridge/walk-agent-metadata.ts` | 252 | `efe63ed` (2026-06-11) | Walks decorator metadata into `AgentWalkResult`; emits `AgentWarningCode.*` for metadata-only knobs | `AgentWalkResult` is additive only; existing `skills`/`memory`/`mcpServers` fields keep meaning; WeakMap cache key stays AgentClass |
| `packages/agents/src/bridge/agent-compiler.ts` | 130 | `efe63ed` (2026-06-11) | Compiles `AgentWalkResult` → `CompiledAgentOptions` | `CompiledAgentOptions` additive only; existing fields unchanged |
| `packages/agents/src/bridge/sdk-adapter.ts` | 112 | `efe63ed` (2026-06-11) | The only allowed bridge: compiled options → `Agent.create()` + `Run.stream()` | Single-shot stream contract + `SDK_NOT_INSTALLED`/`SDK_ERROR` error events preserved; dynamic `import('@theokit/sdk')` stays |
| `packages/agents/src/bridge/index.ts` | ~60 | `efe63ed` (2026-06-11) | Public barrel of the bridge | Existing exports stay; additions are new named exports |
| `packages/agents/src/bridge/compile-skills.ts` (NEW) | 0 | — | (to create) compile `SkillsOptions` → SDK `SkillsSettings` | — |
| `packages/agents/src/bridge/compile-context-window.ts` (NEW) | 0 | — | (to create) compile `ContextWindowOptions` → SDK `ContextSettings` + metadata-only warnings | — |
| `packages/agents/src/bridge/compile-project-context.ts` (NEW) | 0 | — | (to create) compile `ProjectContextOptions` → `SystemPromptResolver` via sdk-tools primitives | — |
| `packages/agents/package.json` | 54 | `17430c1` (2026-06-19) | agents package manifest; peer-deps `@theokit/sdk` `>=1.5.0` | dependency direction agents→SDK only (never SDK→agents); ADR 0030 |
| `package.json` (root) | ~90 | — | workspace root; declares `@theokit/sdk@^2.0.1` | workspace install stays pnpm |
| `packages/theo/package.json` | ~160 | — | `theo` package; declares `@theokit/sdk@^2.0.1` | bump must not break theo build |
| `CHANGELOG.md` (root) | — | — | Keep-a-Changelog workspace changelog | `[Unreleased]` discipline (Unbreakable Rule 6) |
| `packages/agents/tests/unit/m8-skills-compile.test.ts` (NEW) | 0 | — | (to create) RED tests for M8-3 | — |
| `packages/agents/tests/unit/m8-context-window-compile.test.ts` (NEW) | 0 | — | (to create) RED tests for M8-1 | — |
| `packages/agents/tests/unit/m8-project-context-compile.test.ts` (NEW) | 0 | — | (to create) RED tests for M8-2 | — |
| `packages/agents/tests/integration/m8-adapter-wiring.test.ts` (NEW) | 0 | — | (to create) integration: compiled options reach `Agent.create()` | — |
| `.claude/knowledge-base/adrs/0031-m8-decorator-runtime-and-di-strategy.md` (NEW) | 0 | — | (to create) M8-4 strategic ADR | — |

### Current callers / dependents

- **Symbol:** `getSkillsConfig()` in `packages/agents/src/decorators/skills.ts`
  - Callers (production): `packages/agents/src/bridge/walk-agent-metadata.ts:211`; re-exported at `packages/agents/src/decorators/index.ts:16`
  - Callers (tests): `packages/agents/tests/unit/memory-skills-mcp-decorators.test.ts`
  - External (other repos): no — internal to `@theokit/agents`
- **Symbol:** `getContextWindowConfig()` in `packages/agents/src/decorators/context-window.ts`
  - Callers (production): **none** (only re-exported at `decorators/index.ts:21`) — confirms metadata-only
  - Callers (tests): `packages/agents/tests/unit/conversation-context-hitl-decorators.test.ts`
  - External: no
- **Symbol:** `getProjectContextConfig()` in `packages/agents/src/decorators/project-context.ts`
  - Callers (production): **none** (only re-exported at `decorators/index.ts:28`) — confirms metadata-only
  - Callers (tests): `packages/agents/tests/unit/code-assistant-decorators.test.ts`
  - External: no
- **Symbol:** `compileAgent()` in `packages/agents/src/bridge/agent-compiler.ts`
  - Callers (production): `packages/agents/src/bridge/agent-orchestrator.ts`; re-exported at `bridge/index.ts`
  - Callers (tests): `packages/agents/tests/unit/agent-compiler.test.ts`
  - External: yes — `compileAgent`/`CompiledAgentOptions` are part of the bridge's public barrel; changes MUST be additive
- **Symbol:** `walkAgentMetadata()` in `packages/agents/src/bridge/walk-agent-metadata.ts`
  - Callers (production): `bridge/agent-compiler.ts`, `bridge/agent-orchestrator.ts`
  - Callers (tests): `packages/agents/tests/unit/walk-agent-metadata.test.ts`, `agent-compiler.test.ts`
  - External: yes — public barrel; additive only

### Domain glossary

- **walk** — reading decorator metadata off a class via `getMeta`/`Reflector` into a plain `AgentWalkResult` object (`walk-agent-metadata.ts`).
- **compile** — transforming an `AgentWalkResult` into `CompiledAgentOptions` (the SDK-shaped DTO) — `agent-compiler.ts`.
- **bridge / adapter** — the only code allowed to call `@theokit/sdk` at runtime; `sdk-adapter.ts` turns compiled options into `Agent.create()` + `Run.stream()` (`sdk-runtime.md`).
- **metadata-only** — a decorator (or a decorator knob) that is stored but never executed. The existing `AgentWarningCode` enum names this category for interceptors/filters/top-level budget; M8 extends it.
- **SystemPromptResolver** — SDK type `(ctx: SystemPromptContext) => string | Promise<string>` accepted by `AgentOptions.systemPrompt`; the documented seam for dynamic prompt composition.
- **SkillsSettings** — SDK type `{ enabled?: string[]; autoInject?: boolean }`; when passed to `Agent.create`, the SDK internally discovers skills and injects a `<skills>` block.
- **ContextSettings** — SDK type `{ manager?; maxTokens?; maxBytesPerFile?; maxBytesTotal? }`; the SDK's native context-budget manager.

### Architecture boundaries affected

- **Direction agents → SDK (allowed):** `@theokit/agents` gains `@theokit/sdk-tools` as a dependency (for `buildRepoMap`/`buildEnvContext`) and bumps its `@theokit/sdk` peer floor. Per ADR 0030 the principal `theokit` package must never be a dependency of these library subpackages — this plan adds NO such edge; it only adds agents→sdk / agents→sdk-tools edges, which are the correct direction.
- **`sdk-runtime.md` (INQUEBRÁVEL):** the bridge compiles; the SDK executes. M8 stays inside the "adapter is the only bridge" allowance — no LLM `fetch`, no reimplemented compaction/session loop.
- **No `packages/theo/src` core-layering boundary is crossed** — all changes are inside `packages/agents` + two manifest version bumps.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md` §"Coverage Corner 1 — Integration Tests" — establishes the decorator→runtime compilation pattern (walk metadata → compile to a target dispatch) that M8 mirrors for the SDK target.
- **Internal blueprint** `knowledge-base/discoveries/blueprints/theokit-decorator-client-bridge-blueprint.md` §"Context" — the `scan → generate → emit` decorator-bridge pipeline; M8 reuses the same "metadata is walked once, compiled to the consumer format" discipline.
- **First-party SDK contracts (verified against published `.d.ts`)** — `@theokit/sdk@2.5.0` `types/agent.d.ts` `AgentOptions.{skills,context,systemPrompt}`; `SkillsSettings`/`ContextSettings`/`SystemPromptResolver` exported from the `@theokit/sdk` barrel; `@theokit/sdk/compaction` (`compactTranscript`, `shouldCompact`, `estimateTokens`, `isContextOverflowError`); `@theokit/sdk/project` (`readProjectInstructions`); `@theokit/sdk-tools` (`buildRepoMap`, `buildEnvContext`).
- **Existing in-repo pattern** — `walk-agent-metadata.ts` `AgentWarningCode` (`INTERCEPTOR_METADATA_ONLY`, `FILTER_METADATA_ONLY`, `BUDGET_TOP_LEVEL_METADATA_ONLY`): the canonical way this codebase signals "this knob is stored but not executed". M8 extends it rather than inventing a new mechanism (DRY).
- **SDK decorators-optional decision** (`theokit-sdk/CLAUDE.md` §"Inviolable rules" #9, rule 9) — revoked "decorators mandatory"; decorators are an OPTIONAL convenience layer. Drives the M8-4 strategic ADR (D5 below).

## Objective

- [ ] Sub-goal 1 (M8-3) — `@Skills` compiles to a non-empty `SkillsSettings` reaching `Agent.create()`.
- [ ] Sub-goal 2 (M8-1) — `@ContextWindow.maxTokens` compiles to `ContextSettings.maxTokens` reaching `Agent.create()`; unsupported knobs emit `THEO_AGENT_CONTEXT_STRATEGY_METADATA_ONLY`.
- [ ] Sub-goal 3 (M8-2) — `@ProjectContext` compiles to a `SystemPromptResolver` that prepends `buildEnvContext` + `buildRepoMap` + `readProjectInstructions` output to the agent's base prompt; unsupported knobs warn metadata-only.
- [ ] Sub-goal 4 — `sdk-adapter.ts` passes `skills`, `context`, and the composed `systemPrompt` into `Agent.create()` (the wiring caller).
- [ ] Sub-goal 5 (M8-4) — a standalone ADR resolves the di/gateways/plugins strategic question, citing the SDK decorators-optional decision (rule 9) + the local-first imperative direction.
- [ ] Sub-goal 6 — `@theokit/sdk` bumped to `^2.5.0` (root + `packages/theo`) and `@theokit/sdk-tools` added to `@theokit/agents`; workspace builds + tests stay green.

## ADRs

### D1 — Compile decorator metadata into native SDK `AgentOptions` fields (not a parallel runtime)
- **Decision:** Each decorator compiles into a field the SDK already executes: `@Skills`→`AgentOptions.skills`, `@ContextWindow`→`AgentOptions.context`, `@ProjectContext`→`AgentOptions.systemPrompt` (resolver). The bridge never runs an agent loop of its own.
- **Rationale:** `sdk-runtime.md` (INQUEBRÁVEL) mandates the SDK owns execution (tool loop, session/transcript storage, streaming). Compiling to `AgentOptions` keeps the bridge a pure translator.
- **Alternatives considered:** Drive `compactTranscript`/`shouldCompact` in a bridge-owned transcript loop — REJECTED: reimplements session/conversation storage that `sdk-runtime.md` §point 3 reserves for the SDK; would create a second source of truth for the transcript.
- **Consequences:** Enables real runtime with minimal new code; constrains M8 to the surface the SDK exposes (knobs without a native field cannot be silently honored → see D2/D3).

### D2 — `@ContextWindow` maps `maxTokens`→`ContextSettings.maxTokens`; strategy knobs warn metadata-only
- **Decision:** Compile `maxTokens` into `ContextSettings.maxTokens`. `compactionStrategy`, `preserveLastN`, `preserveToolResults`, `preserveSystemPrompt` have no native `AgentOptions` equivalent (the SDK manages transcript compaction internally), so emit `AgentWarningCode.CONTEXT_STRATEGY_METADATA_ONLY` once when any is set to a non-default.
- **Rationale:** Honesty (Unbreakable Rule 3 — no stubs / no silent no-ops): a knob that does nothing must say so, not pretend. Reuses the established `AgentWarningCode` pattern (DRY).
- **Alternatives considered:** (a) Silently ignore the unsupported knobs — REJECTED (silent lie). (b) Reimplement compaction in the bridge to honor them — REJECTED per D1.
- **Consequences:** `@ContextWindow` is no longer metadata-only (maxTokens drives runtime); the gap between declared and executed knobs is explicit and testable.

### D3 — `@ProjectContext` compiles to a `SystemPromptResolver` composing sdk-tools primitives
- **Decision:** Compile `@ProjectContext` into a `SystemPromptResolver` that, at send time, prepends `buildEnvContext(cwd)` + `buildRepoMap(cwd, { ignore: ignorePatterns })` + `readProjectInstructions(cwd)` output to the agent's base `systemPrompt`. `cwd` is taken from `SystemPromptContext.cwd` (falling back to `process.cwd()`). Knobs without a primitive mapping (`indexStrategy`, `relevanceStrategy`, `maxFilesInContext`, `includeExtensions`, `rootMarkers`) emit `AgentWarningCode.PROJECT_CONTEXT_KNOB_METADATA_ONLY`.
- **Rationale:** No native `AgentOptions` field carries a repo map; `systemPrompt` resolver is the documented composition seam (`AgentOptions.systemPrompt: string | SystemPromptResolver`). The primitives are first-party (`@theokit/sdk-tools`, `@theokit/sdk/project`) — Rule 9 (don't reinvent).
- **Alternatives considered:** Map onto `ContextSettings` (file-context manager) — REJECTED: `ContextSettings` governs context-file budgeting, not an on-demand repo map; semantics don't match. Build the repo map at create-time (eager) — REJECTED: resolver is lazy + receives the real `cwd`, avoiding an fs walk when the agent is only constructed.
- **Consequences:** `@ProjectContext` gains real runtime; adds `@theokit/sdk-tools` as an `@theokit/agents` dependency; repo-map cost is paid per send (mitigated by `buildRepoMap` being char-bounded + the resolver only running when the decorator is present).

### D4 — `@Skills` compiles to `SkillsSettings`; the SDK runs discovery/injection
- **Decision:** Compile `{include}`→`SkillsSettings.enabled`; `{autoDiscover:true}`→omit `enabled` (SDK enables all discovered) with `autoInject:true`. Pass through `sdk-adapter.ts` to `Agent.create({ skills })`.
- **Rationale:** `AgentOptions.skills` natively triggers the SDK's `discoverSkills`/`buildSkillsBlock` (verified in `@theokit/sdk/skills`). Compiling to the setting is the SDK-runtime-compliant way to "drive discoverSkills/buildSkillsBlock" (the roadmap action) without duplicating the SDK's work.
- **Alternatives considered:** Import `discoverSkills`/`buildSkillsBlock` into the bridge and inject manually — REJECTED: duplicates what `Agent.create({skills})` already does; two code paths for the same `<skills>` block.
- **Consequences:** `@Skills` runtime is one compiled field; the previously-dead `walkResult.skills` finally reaches `Agent.create()`.

### D5 — M8-4: di/gateways/plugins stay imperative-first; M8 wires only the 3 first-party agents decorators
- **Decision:** Document, in ADR `0031`, that the broader `@theokit/di` / gateways / `@theokit/orm` / `http-decorators` ecosystem remains an OPTIONAL, imperative-first convenience layer (per the SDK decorators-optional decision, rule 9), and that M8 gives runtime only to the three `@theokit/agents` decorators that have a concrete SDK mapping. No new IoC-container runtime is introduced.
- **Rationale:** The SDK decorators-optional decision (rule 9) already revoked "decorators mandatory"; investing decorator-runtime effort into a generic IoC layer would re-trigger the rejected Backend-DX scope creep (KISS + YAGNI). The strategic answer is "wire what maps cleanly to the SDK; leave the rest imperative".
- **Alternatives considered:** Build a generic decorator→runtime compiler for the whole di ecosystem — REJECTED (YAGNI, re-opens the rejected Backend-DX scope creep). Deprecate `@ContextWindow`/`@ProjectContext`/`@Skills` outright — REJECTED: they map cleanly to SDK fields, so runtime is cheap and valuable.
- **Consequences:** Closes M8-4 with a decision, not code; sets the boundary for any future decorator-runtime work.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Bumping `@theokit/sdk` `^2.0.1`→`^2.5.0` across root + `packages/theo` could surface a behavior/type change in `theo` | Medium | Run full workspace `pnpm -w build` + `pnpm -w test` after the bump (Phase 0 DoD); the bump is minor-only (2.x), API-additive | impl |
| Adding `@theokit/sdk-tools` dependency to `@theokit/agents` enlarges its dep tree | Low | sdk-tools is zero-runtime-dep + first-party; justified by Rule 9 in `## Dependencies`; only `buildRepoMap`/`buildEnvContext` imported | impl |
| `buildRepoMap` runs an fs walk per send when `@ProjectContext` is present — latency on large repos | Low | Resolver is lazy (only when decorator present); `buildRepoMap` is char-bounded + never-throws (M3-3 contract); document in ADR | impl |
| Metadata-only warnings could be noisy if emitted per send | Low | Emit context/project warnings at **walk/compile time** (once per class), not per send — mirrors existing `AgentWarningCode` emission site | impl |
| `SystemPromptContext.cwd` may be `undefined` (SDK type allows it) | Medium | Resolver falls back to `process.cwd()`; covered by a dedicated edge test | impl |

## Unresolved Questions

- Q1 — When `@ProjectContext` and a user-supplied `systemPrompt` resolver both exist, what is the composition order? (Resolved at plan time by D3: the M8 resolver wraps the base string prompt; if the agent already declares a resolver, M8 composes by calling the base first then prepending — see T3.1 Deep Dives.)
- Q2 — Should `@ContextWindow.maxTokens` default (100_000) be forwarded even when the user did not set it explicitly? (Resolved: only forward `maxTokens` when present in the merged options; the decorator always sets a default, so forward the effective value — the SDK treats it as a budget cap, which is safe.)
- Q3 — Does `buildRepoMap` need a `budget` cap wired from `maxFilesInContext`? (Resolved: `maxFilesInContext` has no `RepoMapOptions` equivalent → warned metadata-only per D3; `buildRepoMap`'s own `budget` default is used.)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `^2.5.0` | npm | Agent runtime (`Agent.create`); provides `SkillsSettings`/`ContextSettings`/`SystemPromptResolver` + `./compaction`/`./project` subpaths (bumped from `^2.0.1`; minor/additive) |
| `reflect-metadata` | `>=0.2.0` | npm | Decorator metadata storage (already a peer dep of `@theokit/agents`) |
| `zod` | `^4.0.0` | npm | Tool input schemas (already a peer dep) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `@theokit/sdk-tools` (NEW) | `^0.2.0` | npm | Evaluated: hand-roll a repo-map walker in the bridge (REJECTED — reimplements the published, char-bounded, never-throw `buildRepoMap` from M3-3, violating Rule 9 + `sdk-runtime.md` "feature goes to the SDK"); use raw `node:fs` (REJECTED — same reinvention, loses ignore-handling + budget bounding) | First-party, zero-runtime-dep; provides `buildRepoMap`/`buildEnvContext` consumed by the `@ProjectContext` resolver (D3). Direction agents→sdk-tools is allowed (ADR 0030 forbids only edges into principal `theokit`) |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

```
Phase 0 (dep bump) ──▶ Phase 1 (M8-3 skills) ──▶ Phase 4 (wire adapter) ──▶ Final (integration)
        │                                            ▲
        ├──▶ Phase 2 (M8-1 context-window) ──────────┤
        │                                            │
        └──▶ Phase 3 (M8-2 project-context) ─────────┘

Phase 5 (M8-4 ADR) — parallel, no code dependency
```

Phases 1, 2, 3 are independent compilers and can be implemented in any order after Phase 0. Phase 4 (adapter wiring) depends on all three compilers existing. Phase 5 (ADR) is parallel.

---

## Phase 0: Dependency alignment

**Objective:** Make the M8 SDK primitives resolvable in the workspace.

### T0.1 — Bump `@theokit/sdk` to `^2.5.0` and add `@theokit/sdk-tools`

#### Objective
Bump `@theokit/sdk` from `^2.0.1` to `^2.5.0` (root `package.json` + `packages/theo/package.json`); raise the `@theokit/agents` peer floor to `>=2.5.0`; add `@theokit/sdk-tools@^0.2.0` as an `@theokit/agents` dependency.

#### Why this step (action + reasoning)
1. **What this step does** — edits three manifests to make `@theokit/sdk/compaction|skills|project` + `@theokit/sdk-tools` importable, then `pnpm install`.
2. **Why it is necessary now** — the installed SDK is `2.0.1` (verified via `node_modules/@theokit/sdk -> ...@theokit+sdk@2.0.1`), which predates the `./compaction`, `./skills`, `./project` subpaths; without the bump every M8 import fails to resolve. Cite `## Baseline Context` rows for the three manifests.

#### Evidence
`node_modules/@theokit/sdk` symlinks to `@theokit+sdk@2.0.1`; `npm view @theokit/sdk version` → `2.5.0`; `npm view @theokit/sdk@2.5.0 exports` lists `./compaction`, `./skills`, `./project`, `./models`; `npm view @theokit/sdk-tools version` → `0.2.0`.

#### Files to edit
```
package.json — "@theokit/sdk": "^2.0.1" → "^2.5.0"
packages/theo/package.json — "@theokit/sdk": "^2.0.1" → "^2.5.0"
packages/agents/package.json — peer "@theokit/sdk": ">=1.5.0" → ">=2.5.0"; add dependency "@theokit/sdk-tools": "^0.2.0" (and peer if convention requires)
```

#### Deep file dependency analysis
- Root + theo manifests pin the workspace SDK version; bumping both keeps a single resolved version (pnpm dedupe). Downstream: `packages/theo` build + the `@theokit/agents` runtime both consume the new version.
- `packages/agents/package.json` peer floor must allow `2.5.0`; adding `@theokit/sdk-tools` introduces the agents→sdk-tools edge (correct direction; ADR 0030 forbids only edges INTO principal `theokit`).

#### Deep Dives
- Invariant: the bump is minor (2.0→2.5), so the public API is additive; `theo`'s existing SDK usage must keep compiling (verified in DoD).
- Edge case: pnpm peer-dep warnings are non-blocking; a real resolution failure blocks — caught by `pnpm install` exit code.

#### TDD
- **RED:** `tests/integration/m8-adapter-wiring.test.ts` (added in Phase 4) imports `@theokit/sdk-tools` (`buildRepoMap`) + `@theokit/sdk/compaction`; before the bump the dynamic import / type resolution fails. As a Phase-0-local proof, add a temporary resolution assertion `test_m8_sdk_primitives_resolve` in `tests/unit/m8-skills-compile.test.ts` that `await import('@theokit/sdk')` exposes `Agent` and `import('@theokit/sdk-tools')` exposes `buildRepoMap`.
- **GREEN:** the bump + install makes the imports resolve.
- **REFACTOR:** none (manifest edit).

#### Acceptance criteria
- `pnpm install` exits 0; `node -e "require('@theokit/sdk-tools')"` resolves from `packages/agents`.
- `pnpm -w build` and `pnpm -w test` stay green (no `theo` regression from the bump).

#### Concurrency tests
(none — single-threaded)

#### DoD
- `grep '"@theokit/sdk"' package.json packages/theo/package.json` shows `^2.5.0`.
- `packages/agents/package.json` lists `@theokit/sdk-tools`.
- Workspace build + test green.

---

## Phase 1: M8-3 — `@Skills` → `SkillsSettings`

**Objective:** Compile `@Skills` metadata into a `SkillsSettings` field on `CompiledAgentOptions`.

### T1.1 — `compileSkills(options)` → `SkillsSettings`

#### Objective
Add `compile-skills.ts` mapping `SkillsOptions` → SDK `SkillsSettings`, and surface the result on `CompiledAgentOptions.skills` (already carried) in the SDK shape.

#### Why this step (action + reasoning)
1. **What this step does** — introduces a pure `compileSkills(options: SkillsOptions): SkillsSettings` and uses it so the compiled `skills` field is SDK-shaped (`{enabled, autoInject}`) rather than the decorator-shaped `{include, autoDiscover}`.
2. **Why it is necessary now** — `walkResult.skills` already reaches `CompiledAgentOptions.skills` but in the WRONG shape (`{include}`), so `Agent.create({skills})` would ignore it. Per D4, the SDK field is `{enabled, autoInject}`. Cite `agent-compiler.ts:tail` (skills passthrough) + `walk-agent-metadata.ts:211`.

#### Evidence
`walk-agent-metadata.ts:211` `const skills = getSkillsConfig(AgentClass)`; `agent-compiler.ts` returns `skills: walkResult.skills`; SDK `SkillsSettings = { enabled?: string[]; autoInject?: boolean }` (verified `.d.ts`).

#### Files to edit
```
packages/agents/src/bridge/compile-skills.ts (NEW) — compileSkills(SkillsOptions): SkillsSettings
packages/agents/src/bridge/agent-compiler.ts — CompiledAgentOptions.skills typed as SkillsSettings; call compileSkills
packages/agents/src/bridge/index.ts — export compileSkills
packages/agents/tests/unit/m8-skills-compile.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- `agent-compiler.ts` currently types `skills?: SkillsOptions`; change to `skills?: SkillsSettings` (additive in meaning; the field already existed, the shape becomes SDK-correct). Callers: `agent-compiler.test.ts` (assert new shape), `sdk-adapter.ts` (Phase 4 consumer).
- `compile-skills.ts` is new + pure (no imports beyond the SDK type) → trivially unit-testable.

#### Deep Dives
- Mapping: `Array `include` → `enabled: include`; `autoDiscover:true` → omit `enabled`, set `autoInject:true`; `autoDiscover:false` (or absent) with `include` → `{enabled: include, autoInject:true}`.
- Edge case: empty `include` + `autoDiscover:false` → `{enabled: [], autoInject:true}` (explicitly no skills); document that `enabled: []` disables all (matches SDK "omitted = all").

#### Pseudo-code / Signatures
```ts
import type { SkillsSettings } from '@theokit/sdk'
export function compileSkills(o: SkillsOptions): SkillsSettings {
  if (o.autoDiscover) return { autoInject: true }          // enabled omitted ⇒ all discovered
  return { enabled: o.include, autoInject: true }
}
```

#### TDD
- **RED `test_skills_include_compiles_to_enabled`:** `compileSkills({include:['a','b']})` ⇒ `{enabled:['a','b'], autoInject:true}`.
- **RED `test_skills_autodiscover_omits_enabled`:** `compileSkills({include:[], autoDiscover:true})` ⇒ `{autoInject:true}` (no `enabled` key).
- **RED `test_compileAgent_emits_skillssettings`:** an `@Agent`+`@Skills(['x'])` class → `compileAgent(walk).skills` deep-equals `{enabled:['x'], autoInject:true}`.
- **GREEN:** implement `compileSkills` + wire into `compileAgent`.
- **REFACTOR:** ensure no duplicated mapping logic between walk + compile.

#### Acceptance criteria
- `compileAgent` output `.skills` is SDK-shaped for both include + autoDiscover modes.
- `SkillsOptions` public shape stays exactly `{include, autoDiscover}` — asserted by `test_skills_options_shape_unchanged` (deep-equal on Object.keys).

#### Concurrency tests
(none — single-threaded)

#### DoD
- `m8-skills-compile.test.ts` green; `agent-compiler.test.ts` updated + green.

---

## Phase 2: M8-1 — `@ContextWindow` → `ContextSettings`

**Objective:** Compile `@ContextWindow` into `ContextSettings`; warn on unsupported strategy knobs.

### T2.1 — `compileContextWindow(options)` → `{ context, warnings }`

#### Objective
Add `compile-context-window.ts` mapping `ContextWindowOptions.maxTokens` → `ContextSettings.maxTokens`, returning a metadata-only warning when strategy knobs are set; walk `@ContextWindow` in `walkAgentMetadata`; surface `context` on `CompiledAgentOptions`.

#### Why this step (action + reasoning)
1. **What this step does** — reads `getContextWindowConfig` in the walk, compiles `maxTokens`→`ContextSettings`, emits `AgentWarningCode.CONTEXT_STRATEGY_METADATA_ONLY` for non-default `compactionStrategy`/`preserveLastN`/`preserveToolResults`/`preserveSystemPrompt`, and adds `context?: ContextSettings` to `CompiledAgentOptions`.
2. **Why it is necessary now** — `getContextWindowConfig` has zero production callers (confirmed grep), so `@ContextWindow` is fully metadata-only; this is the step that gives it runtime. Per D1/D2 we compile to the native field and warn honestly. Cite `## Baseline Context` (zero callers) + `walk-agent-metadata.ts` AgentWarningCode pattern.

#### Evidence
`grep getContextWindowConfig` → only `decorators/index.ts:21` (re-export); SDK `ContextSettings.maxTokens` (verified `.d.ts`); existing `AgentWarningCode` enum at `walk-agent-metadata.ts:48-52`.

#### Files to edit
```
packages/agents/src/bridge/compile-context-window.ts (NEW) — compileContextWindow(ContextWindowOptions): { context: ContextSettings; metadataOnlyKnobs: string[] }
packages/agents/src/bridge/walk-agent-metadata.ts — add CONTEXT_STRATEGY_METADATA_ONLY to AgentWarningCode; walk getContextWindowConfig; emit warning once; add contextWindow to AgentWalkResult
packages/agents/src/bridge/agent-compiler.ts — add context?: ContextSettings to CompiledAgentOptions; populate from walk
packages/agents/src/bridge/index.ts — export compileContextWindow
packages/agents/tests/unit/m8-context-window-compile.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- `walk-agent-metadata.ts`: add `contextWindow?: ContextWindowOptions` to `AgentWalkResult` (additive); the WeakMap cache still keys on AgentClass. Callers (`agent-compiler.ts`, `agent-orchestrator.ts`) unaffected (additive field).
- `AgentWarningCode` gains one member — `tests/unit/walk-agent-metadata.test.ts` asserts existing codes; new code is additive.

#### Deep Dives
- Mapping: `{ maxTokens } → { maxTokens }`. Strategy knobs are "non-default" when they differ from the decorator defaults (`compactionStrategy:'summarize-oldest'`, `preserveLastN:10`, `preserveToolResults:true`, `preserveSystemPrompt:true`); since the decorator ALWAYS sets defaults, warn only when a knob's value indicates the user expects active behavior the SDK doesn't expose → simplest honest rule: warn whenever a `@ContextWindow` is present AND any strategy knob is set to a value the bridge cannot forward (i.e., always emit the metadata-only notice listing the un-forwarded knobs). Emit ONCE per class at walk time (not per send).
- Invariant: `maxTokens` always forwarded (decorator default 100_000 is a safe budget cap).
- Edge case: `@ContextWindow()` with no options → defaults applied by decorator → `context:{maxTokens:100000}` + warning listing the default strategy knobs as un-forwarded.

#### Pseudo-code / Signatures
```ts
import type { ContextSettings } from '@theokit/sdk'
export const CONTEXT_FORWARDED = ['maxTokens'] as const
export function compileContextWindow(o: ContextWindowOptions): { context: ContextSettings; metadataOnlyKnobs: string[] } {
  const context: ContextSettings = {}
  if (typeof o.maxTokens === 'number') context.maxTokens = o.maxTokens
  const metadataOnlyKnobs = ['compactionStrategy','preserveLastN','preserveToolResults','preserveSystemPrompt']
    .filter((k) => (o as Record<string, unknown>)[k] !== undefined)
  return { context, metadataOnlyKnobs }
}
```

#### TDD
- **RED `test_context_maxtokens_forwarded`:** `compileContextWindow({maxTokens:50000})` ⇒ `context.maxTokens===50000`.
- **RED `test_context_strategy_knobs_reported_metadata_only`:** `compileContextWindow({compactionStrategy:'truncate-oldest', preserveLastN:5})` ⇒ `metadataOnlyKnobs` contains both.
- **RED `test_walk_emits_context_strategy_warning_once`:** an `@Agent`+`@ContextWindow({compactionStrategy:'sliding-window'})` class triggers exactly one `console.warn` containing `THEO_AGENT_CONTEXT_STRATEGY_METADATA_ONLY` (spy on console.warn).
- **RED `test_compileAgent_emits_contextsettings`:** `compileAgent(walk).context.maxTokens` equals the decorator value.
- **GREEN:** implement compiler + walk wiring.
- **REFACTOR:** dedupe the warning-emission helper with the existing metadata-only emitters if trivially shared.

#### Acceptance criteria
- `compileAgent(walk).context.maxTokens` equals the decorator value — asserted by `test_compileAgent_emits_contextsettings`; the un-forwardable-knob `console.warn` fires exactly once — asserted by `test_walk_emits_context_strategy_warning_once`.
- `getContextWindowConfig` return type + `ContextWindowOptions` keys stay unchanged — asserted by `test_context_window_options_shape_unchanged`.

#### Concurrency tests
(none — single-threaded)

#### DoD
- `m8-context-window-compile.test.ts` green; existing `walk-agent-metadata.test.ts` still green.

---

## Phase 3: M8-2 — `@ProjectContext` → `SystemPromptResolver`

**Objective:** Compile `@ProjectContext` into a `SystemPromptResolver` composing sdk-tools + project primitives.

### T3.1 — `compileProjectContext(options, basePrompt)` → `SystemPromptResolver`

#### Objective
Add `compile-project-context.ts` returning a `SystemPromptResolver` that prepends `buildEnvContext(cwd)` + `buildRepoMap(cwd,{ignore})` + `readProjectInstructions(cwd)` to the base prompt; walk `@ProjectContext`; warn on unsupported knobs; surface a `projectContext` resolver factory on the compiled output.

#### Why this step (action + reasoning)
1. **What this step does** — composes a lazy `SystemPromptResolver` from the first-party primitives so that when an agent with `@ProjectContext` sends, the system prompt carries the env block + repo map + nearest `THEO.md` instructions.
2. **Why it is necessary now** — `getProjectContextConfig` has zero production callers (confirmed grep); this is the step that executes it. Per D3, `systemPrompt` resolver is the only seam that can carry a repo map. Cite `## Baseline Context` (zero callers) + SDK `SystemPromptResolver`/`SystemPromptContext` (`.d.ts`).

#### Evidence
`grep getProjectContextConfig` → only `decorators/index.ts:28`; SDK `SystemPromptResolver=(ctx:SystemPromptContext)=>string|Promise<string>`, `SystemPromptContext.cwd: string|undefined`; `@theokit/sdk-tools` `buildRepoMap(cwd,opts?)`/`buildEnvContext(cwd)`; `@theokit/sdk/project` `readProjectInstructions(cwd,options?)`.

#### Files to edit
```
packages/agents/src/bridge/compile-project-context.ts (NEW) — compileProjectContext(o, basePrompt?): SystemPromptResolver + metadataOnlyKnobs
packages/agents/src/bridge/walk-agent-metadata.ts — add PROJECT_CONTEXT_KNOB_METADATA_ONLY; walk getProjectContextConfig; add projectContext to AgentWalkResult
packages/agents/src/bridge/agent-compiler.ts — add projectContext?: ProjectContextOptions to CompiledAgentOptions (resolver built in adapter to keep compiler pure/sync)
packages/agents/src/bridge/index.ts — export compileProjectContext
packages/agents/tests/unit/m8-project-context-compile.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- The resolver imports `@theokit/sdk-tools` (`buildRepoMap`,`buildEnvContext`) + `@theokit/sdk/project` (`readProjectInstructions`) — agents→sdk-tools/sdk edges (correct direction).
- `compileAgent` carries `projectContext?: ProjectContextOptions` (raw) so the compiler stays pure/sync; the resolver (async, I/O) is constructed in `sdk-adapter.ts` at create-time (Phase 4) — keeps the compiler free of I/O (testability + SRP).

#### Deep Dives
- Resolver composition order (Q1): `resolver(ctx) = [envBlock, repoMap, instructions, basePrompt].filter(Boolean).join('\n\n')`. `basePrompt` is the agent's declared string `systemPrompt` (if any); if the agent declared its OWN resolver, M8 wraps by awaiting it first then prepending.
- `cwd` fallback (Q3/edge): `const cwd = ctx.cwd ?? process.cwd()`.
- Unsupported knobs → `metadataOnlyKnobs = ['indexStrategy','relevanceStrategy','maxFilesInContext','includeExtensions','rootMarkers'].filter(set)`; warn once at walk time.
- `ignorePatterns` → `buildRepoMap(cwd,{ignore: o.ignorePatterns})`.
- Invariant: resolver is never-throw — `buildRepoMap`/`buildEnvContext` are never-throw by contract (M3-3); wrap `readProjectInstructions` in try/catch returning `''` on failure so a missing `THEO.md` never breaks a send.

#### Pseudo-code / Signatures
```ts
import { buildRepoMap, buildEnvContext } from '@theokit/sdk-tools'
import { readProjectInstructions } from '@theokit/sdk/project'
import type { SystemPromptResolver } from '@theokit/sdk'
export function compileProjectContext(o: ProjectContextOptions, base?: string): SystemPromptResolver {
  return async (ctx) => {
    const cwd = ctx.cwd ?? process.cwd()
    const env = buildEnvContext(cwd)
    const map = buildRepoMap(cwd, { ignore: o.ignorePatterns })
    let instr = ''
    try { instr = (await readProjectInstructions(cwd)).content ?? '' } catch { /* never-throw */ }
    return [env, map, instr, base].filter(Boolean).join('\n\n')
  }
}
```

#### TDD
- **RED `test_project_context_resolver_prepends_repo_map`:** call the resolver with `{cwd: fixtureRepo}` (a temp dir with a `package.json`) ⇒ output contains the repo-map block + the base prompt.
- **RED `test_project_context_resolver_cwd_fallback`:** resolver with `ctx.cwd===undefined` uses `process.cwd()` and does not throw.
- **RED `test_project_context_missing_instructions_is_safe`:** temp dir without `THEO.md` ⇒ resolver returns env+map+base, no throw.
- **RED `test_project_context_unsupported_knobs_metadata_only`:** `@ProjectContext({indexStrategy:'tree-sitter'})` triggers one `THEO_AGENT_PROJECT_CONTEXT_KNOB_METADATA_ONLY` warning.
- **GREEN:** implement compiler + walk wiring.
- **REFACTOR:** extract the warn-once helper shared with T2.1.

#### Acceptance criteria
- The resolver returns a string containing the repo-map block and never throws — asserted by `test_project_context_resolver_prepends_repo_map` + `test_project_context_resolver_cwd_fallback`.
- `getProjectContextConfig` return type + `ProjectContextOptions` keys stay unchanged — asserted by `test_project_context_options_shape_unchanged`.

#### Concurrency tests
(none — single-threaded)

#### DoD
- `m8-project-context-compile.test.ts` green.

---

## Phase 4: Wire compiled options into `Agent.create()` (the caller)

**Objective:** `sdk-adapter.ts` passes `skills`, `context`, and the composed `systemPrompt` to `Agent.create()`.

### T4.1 — Pass `skills` + `context` + project-context resolver to `Agent.create`

#### Objective
Extend `createSdkAgentStream` to forward `compiled.skills`, `compiled.context`, and — when `compiled.projectContext` is present — a `compileProjectContext(projectContext, baseSystemPrompt)` resolver as `systemPrompt`, into the `Agent.create()` call.

#### Why this step (action + reasoning)
1. **What this step does** — the wiring caller: turns the new compiled fields into actual `Agent.create()` arguments so the SDK executes them.
2. **Why it is necessary now** — the three compilers (Phases 1–3) are inert until something passes them to the SDK. `sdk-adapter.ts` is the only allowed bridge (`sdk-runtime.md`). Cite `sdk-adapter.ts:75-82` (current minimal `Agent.create`).

#### Evidence
`sdk-adapter.ts` current `Agent.create({apiKey, model:{id:model}, tools:sdkTools, systemPrompt: agentWalk.agentConfig.systemPrompt})` — no `skills`/`context`/resolver.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — accept compiled options; pass skills, context, systemPrompt(resolver) to Agent.create
packages/agents/src/bridge/agent-orchestrator.ts — pass compiled options into createSdkAgentStream (if signature changes)
packages/agents/tests/integration/m8-adapter-wiring.test.ts (NEW) — integration test
```

#### Deep file dependency analysis
- `createSdkAgentStream(agentWalk, compiledTools, apiKey, envModel)` → add a `compiled: CompiledAgentOptions` param (or read from a passed `compileAgent` result). Caller `agent-orchestrator.ts` updated accordingly.
- The `Agent.create` options object grows by `skills?`, `context?`, and `systemPrompt` becomes `string | SystemPromptResolver`. The dynamic-import typing block in `sdk-adapter.ts` must widen to accept these (keep the `Record<string,unknown>` create signature already present).

#### Deep Dives
- Only include keys when present: spread `...(compiled.skills && {skills: compiled.skills})`, `...(compiled.context && {context: compiled.context})`.
- **EC-1 (settingSources):** `SkillsSettings.enabled` only yields a non-empty `<skills>` block if the SDK has a settings source active. When `compiled.skills` is present, also pass `local: { settingSources: ['project'] }` so the SDK discovers `.theokit/skills/<name>/SKILL.md` from the project dir; otherwise the skills setting is a silent no-op. The integration test asserts the create-options carry both `skills` AND the discovery source.
- systemPrompt: if `compiled.projectContext` present → `systemPrompt = compileProjectContext(compiled.projectContext, baseString)`; else keep the base string.
- Invariant: existing single-shot stream contract + `SDK_NOT_INSTALLED`/`SDK_ERROR` events unchanged.
- Runtime-metric / observability: emit a single `console.debug('[THEO_AGENT_M8_RUNTIME_APPLIED]', {skills:boolean, context:boolean, projectContext:boolean})` line when any field is applied — the observable proof the wiring fired (mirrors the warning-code observability discipline). Integration test asserts the create-options carry the fields.

#### TDD
- **RED `test_adapter_passes_skills_to_create`:** stub `@theokit/sdk` `Agent.create` (vi.mock) capturing its options; an `@Agent`+`@Skills(['x'])` flow ⇒ captured options `.skills` deep-equals `{enabled:['x'],autoInject:true}` AND `.local.settingSources` includes `'project'` (EC-1).
- **RED `test_adapter_passes_context_to_create`:** `@ContextWindow({maxTokens:42})` ⇒ captured `.context.maxTokens===42`.
- **RED `test_adapter_passes_project_resolver`:** `@ProjectContext({})` ⇒ captured `.systemPrompt` is a function; calling it yields a string containing the repo-map block.
- **RED `test_adapter_no_m8_fields_when_absent`:** plain `@Agent` (no M8 decorators) ⇒ captured options have no `skills`/`context` keys (backward compat).
- **GREEN:** wire the fields.
- **REFACTOR:** keep the option-assembly readable; no duplicated spreads.

#### Acceptance criteria
- The 4 `m8-adapter-wiring` integration assertions pass and the no-M8-decorator path yields create-options byte-identical to today — asserted by `test_adapter_no_m8_fields_when_absent`.
- `[THEO_AGENT_M8_RUNTIME_APPLIED]` observed in the integration test when fields applied.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` dynamic import | package absent | existing path: import throws | `SDK_NOT_INSTALLED` event (already covered) — M8 changes must not regress it |
| `buildRepoMap` (fs walk inside resolver) | unreadable cwd | resolver fixture points cwd at a non-existent dir | resolver returns env+base (repo-map empty), never throws (M3-3 never-throw contract) |

#### DoD
- `m8-adapter-wiring.test.ts` green; existing `sdk-real-llm`/`mock-stream` tests unaffected.

---

## Phase 5: M8-4 — Strategic ADR (di/gateways/plugins)

**Objective:** Resolve the di/gateways/plugins strategic question in a standalone ADR (no code).

### T5.1 — Write ADR `0031-m8-decorator-runtime-and-di-strategy.md`

#### Objective
Author the ADR documenting D5: the di/gateways/orm/http-decorators ecosystem stays imperative-first/optional (per the SDK decorators-optional decision, rule 9); M8 wires only the three first-party agents decorators that map cleanly to SDK fields.

#### Why this step (action + reasoning)
1. **What this step does** — writes the decision record closing M8-4.
2. **Why it is necessary now** — M8's DoD requires "existe ADR decidindo o futuro de di/gateways"; the decision is a prerequisite for declaring M8 done. Cite the SDK decorators-optional decision (`theokit-sdk/CLAUDE.md` rule 9).

#### Evidence
The SDK decorators-optional decision text in `theokit-sdk/CLAUDE.md` §"Inviolable rules" #9 (rule 9); existing ADR `0030-library-subpackages-never-depend-on-principal-theokit.md`.

#### Files to edit
```
.claude/knowledge-base/adrs/0031-m8-decorator-runtime-and-di-strategy.md (NEW)
```

#### Deep file dependency analysis
- Documentation only; no code dependency. Follows the existing ADR numbering (latest is `0030`).

#### Deep Dives
- ADR states: decision (imperative-first di stays optional; M8 wires 3 decorators), context (decorators-optional decision), consequences (boundary for future decorator-runtime work), alternatives (generic IoC runtime — rejected, YAGNI / rule 9).

#### TDD
- **RED:** N/A (documentation). Instead, an acceptance check: `test_adr_0031_exists` is not code; the DoD verifies the file exists + contains the required ADR sections (Decision/Rationale/Alternatives/Consequences). Documented here as a non-TDD task per `cycle-implement` (docs tasks have no executable RED).

#### Acceptance criteria
- ADR file exists with Decision + Rationale + ≥1 rejected Alternative + Consequences; references the decorators-optional decision (rule 9) + ADR 0030.

#### Concurrency tests
(none — single-threaded)

#### DoD
- File present; `grep -l "decorators-optional" .claude/knowledge-base/adrs/0031-*.md` resolves.

---

## Coverage Matrix

| # | Gap / Requirement (ROADMAP M8) | Task(s) | Resolution |
|---|---|---|---|
| 1 | M8-1 `@ContextWindow`/`AutoSummarize` sem runtime → compactTranscript/shouldCompact | T0.1, T2.1, T4.1 | Compile `maxTokens`→`ContextSettings`; un-forwardable knobs warn metadata-only; wired into `Agent.create` |
| 2 | M8-2 `@ProjectContext` sem executor → buildRepoMap/readProjectInstructions | T0.1, T3.1, T4.1 | Compile to `SystemPromptResolver` composing buildEnvContext+buildRepoMap+readProjectInstructions; wired as `systemPrompt` |
| 3 | M8-3 `@Skills` sem runtime → discoverSkills/buildSkillsBlock | T0.1, T1.1, T4.1 | Compile to `SkillsSettings`; SDK runs discovery/injection; wired into `Agent.create({skills})` |
| 4 | M8-4 decisão estratégica di/gateways/plugins → ADR | T5.1 | ADR 0031 documents imperative-first/optional di; M8 wires only the 3 mapped decorators |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1).
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green (incl. new `m8-*` suites) + `pnpm -w test` green.
- [ ] Zero type errors — `pnpm --filter @theokit/agents typecheck` (or `pnpm -w build`).
- [ ] Zero lint warnings — project lint clean on changed files.
- [ ] File-size budget respected (each new bridge file well under 500 LoC).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility preserved — `getSkillsConfig`/`getContextWindowConfig`/`getProjectContextConfig` + their option types unchanged; absent-decorator `Agent.create` options identical to today.
- [ ] Plan-specific: zero of the three decorators remains metadata-only — each compiles to a non-empty SDK `AgentOptions` field; un-forwardable knobs emit a stable warning code.
- [ ] **Runtime-metric proof** — `[THEO_AGENT_M8_RUNTIME_APPLIED]` observed in `m8-adapter-wiring.test.ts` when fields are applied (not just compiled).
- [ ] ADR 0031 present.
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR merges, move this plan to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` (dynamic import in adapter) | package not installed | mock import to throw | `SDK_NOT_INSTALLED` event — preserved, not regressed by M8 |
| `buildRepoMap` / `readProjectInstructions` (fs I/O in resolver) | unreadable / missing cwd or `THEO.md` | resolver fixture with non-existent dir / no `THEO.md` | resolver returns env+base, never throws (M3-3 never-throw + try/catch around instructions) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the compiled decorators reach the SDK in a real workload.

### Execution
```
pnpm --filter @theokit/agents test       # unit + integration (incl. m8-*)
pnpm -w build                            # zero type errors workspace-wide (theo bump regression check)
pnpm -w test                             # workspace tests green
```

### Acceptance Criteria
- [ ] All `@theokit/agents` suites green (unit + integration).
- [ ] Coverage ≥ 90% on the 3 new `compile-*.ts` files (pure functions → easy to hit).
- [ ] Zero type errors workspace-wide after the SDK bump.
- [ ] Zero lint warnings on changed files.
- [ ] Runtime-metric proof — `[THEO_AGENT_M8_RUNTIME_APPLIED]` observed in integration test.
- [ ] Failure scenarios green — resolver never-throw + `SDK_NOT_INSTALLED` both exercised.

### If Validation Fails
1. Separate M8-caused failures from pre-existing (the SDK bump may surface unrelated `theo` issues — document, don't necessarily fix in this PR unless M8-caused).
2. Fix all M8-caused failures; re-run the chain.
3. Log pre-existing issues in the PR description.
