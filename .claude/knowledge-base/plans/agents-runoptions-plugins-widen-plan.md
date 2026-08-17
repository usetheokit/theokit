---
slug: agents-runoptions-plugins-widen
created_at: 2026-06-26
goal: Widen @theokit/agents AgentRunnerRunOptions.plugins to accept a Plugin array so consumers stop casting.
---

# Plan: @theokit/agents plugins option widen (RADAR #90-B / #90.3 agents-side)

> **Version 1.0** — One additive, backward-compatible typing fix: `@theokit/agents` `AgentRunnerRunOptions.plugins` (and the internal `createSdkAgentStream` options mirror) is typed `PluginsSettings` but the runtime forwards plugins via a `Record<string, unknown>` duck-typed `Agent.create`, and the underlying SDK runtime accepts an array of code `Plugin` objects (the `@theokit/sdk` `AgentOptions.plugins` type-lie fixed in RADAR #90.3a). Widen to `PluginsSettings | readonly Plugin[]` so the reference app (TheoCode) can drop its `as unknown as PluginsSettings` cast. Compiles against the currently-installed `@theokit/sdk@2.9.0` because `Plugin` + `PluginsSettings` already exist there and the forward path is `Record<string, unknown>` — NOT gated on the #90.3a sdk publish.

## Goal

> "Enable `@theokit/agents` consumers to pass a `readonly Plugin[]` to `AgentRunner.stream`/`run` via `AgentRunnerRunOptions.plugins` so that TheoCode drops its `as unknown as PluginsSettings` cast, measured by `pnpm test` passing a new `tests/unit/agent-runner-plugins-type.test-d.ts` (array form compiles) and `pnpm typecheck` exiting 0."

## Context

RADAR #90.3 (the alignment audit) found TheoCode `server/lib/agent-stream.ts` casts a real `Plugin[]` with `as unknown as PluginsSettings` when building `AgentRunnerRunOptions`. The root cause (empirically confirmed via a `tsc` probe): `AgentRunnerRunOptions.plugins?: PluginsSettings` (`packages/agents/src/loop/agent-runner.ts:80`) and the internal `CreateSdkAgentStreamOptions.plugins?: PluginsSettings` (`packages/agents/src/bridge/sdk-adapter.ts:80`) declare only the `{ enabled }` settings shape, but the SDK runtime accepts a `Plugin[]` (fixed type-side in `@theokit/sdk` RADAR #90.3a). The `@theokit/agents` forward to the SDK is duck-typed (`buildExtraCreateOptions(overrides): Record<string, unknown>` at `sdk-adapter.ts`, `extra.plugins = overrides.plugins`), so widening the agents-side option types does NOT require the widened `@theokit/sdk` to be published — it compiles against the installed `@theokit/sdk@2.9.0` (which already exports both `Plugin` and `PluginsSettings`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/agent-runner.ts` | 284 | `6d02c56` (2026-06-26) | `AgentRunner` + `AgentRunnerBuilder` + `AgentRunnerRunOptions` (per-run override surface, V4-L.3) | Every other `AgentRunnerRunOptions` field unchanged; `AgentRunner.run`/`.stream` signatures unchanged; the `plugins` forward semantics unchanged |
| `packages/agents/src/bridge/sdk-adapter.ts` | 302 | `6ec6124` (2026-06-26) | `createSdkAgentStream` + `RuntimeOverrides`/`CreateSdkAgentStreamOptions` + duck-typed `Agent.create` bridge | `buildExtraCreateOptions` returns `Record<string, unknown>` (the duck-typed forward) unchanged; only the `plugins?` field type widens |
| `tests/unit/agent-runner-plugins-type.test-d.ts` (NEW) | 0 | — | (type test to be created) | — |
| `.changeset/agents-runoptions-plugins-widen.md` (NEW) | 0 | — | (changeset for the @theokit/agents minor) | — |

Every file in any task's `#### Files to edit` appears above.

### Current callers / dependents

- **Symbol:** `AgentRunnerRunOptions` (type) in `packages/agents/src/loop/agent-runner.ts`
  - **Callers (production):** exported via `@theokit/agents` public barrel (`packages/agents/src/loop/index.ts:10` → `src/index.ts`). External consumer: TheoCode `server/lib/agent-stream.ts` (builds `runOpts: AgentRunnerRunOptions`, passes to `runner.stream`).
  - **Callers (tests):** agents tests that exercise `AgentRunner` (V4 loop tests).
  - **External (public API):** yes — `@theokit/agents`. Widening a field to a UNION is backward-compatible (existing `PluginsSettings` callers still satisfy it).
- **Symbol:** `CreateSdkAgentStreamOptions.plugins` (internal) in `packages/agents/src/bridge/sdk-adapter.ts:80`
  - **Callers (production):** `AgentRunner` (forwards `opts.plugins` into `createSdkAgentStream`). `buildExtraCreateOptions` reads it into a `Record<string, unknown>`.
  - **External:** internal to `@theokit/agents` (not a barrel export) — but its field type must match the widened `AgentRunnerRunOptions.plugins` for the internal forward to typecheck.

### Domain glossary

- **`AgentRunnerRunOptions`** — the per-run override object passed to `AgentRunner.run`/`.stream` (V4-L.3 Axis-A SWAP); fields like `plugins`, `providers`, `agents`, `model` override the compiled agent's defaults for one run.
- **`PluginsSettings`** — `@theokit/sdk` type `{ enabled?: string[] }` (named plugin discovery).
- **`Plugin`** — `@theokit/sdk` public type: a code plugin object (discriminated union general/model-provider/memory).
- **duck-typed forward** — `buildExtraCreateOptions` returns `Record<string, unknown>`; the SDK `Agent.create` is referenced through a local structural type, so the plugins value is forwarded without the SDK's `AgentOptions.plugins` type constraining it at the agents boundary.

### Architecture boundaries affected

Per theokit `rules/system-design-guardrails.md` G1 (dependency direction: `@theokit/agents` depends on `@theokit/sdk` via the bridge only — preserved; no new edge) + G3 (Zod/types SSoT — `Plugin`/`PluginsSettings` reused from `@theokit/sdk`, no duplication) + G7 (every export has a consumer — the widened type is consumed by TheoCode + the new type test). KISS: widen an existing union, no new symbol (YAGNI — no `plugins`-builder method added).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `^2.9.0` (installed, peerDep) | npm | `Plugin` + `PluginsSettings` types already exported at 2.9.0; the widen reuses them (no republish needed for the agents typecheck — the forward is `Record<string, unknown>`) |

### New — to be introduced

(none — zero new dependencies.)

### Removed

(none)

## Prior Art & Related Work

- **In-repo (the paired fix):** RADAR #90.3a widened `@theokit/sdk` `AgentOptions.plugins` to `PluginsSettings | readonly Plugin[]` (theokit-sdk PR #38) — this plan applies the same union to the `@theokit/agents` per-run mirror so the two layers agree.
- **In-repo precedent:** the `sdkTools?: readonly CustomTool[]` field (`agent-runner.ts:98`, `sdk-adapter.ts:98`, V4-Q) is the existing pattern for a raw SDK-typed per-run field forwarded through the duck-typed bridge — `plugins` follows the same shape.
- **Empirical evidence:** a `tsc` probe in TheoCode (removing the `as unknown as PluginsSettings` cast) produced `TS2559: Type 'Plugin[]' has no properties in common with type 'PluginsSettings'`, and the SDK runtime `extractCodePlugins(value): Plugin[]` (`@theokit/sdk` `local-agent-plugins.ts`) confirms the array form is accepted — the type, not the runtime, was wrong.

## Objective

- [ ] `AgentRunnerRunOptions.plugins` widened to `PluginsSettings | readonly Plugin[]` (import `Plugin` from `@theokit/sdk`).
- [ ] `CreateSdkAgentStreamOptions.plugins` (sdk-adapter mirror) widened identically so the internal forward typechecks.
- [ ] The duck-typed `buildExtraCreateOptions` forward (`Record<string, unknown>`) is unchanged and accepts the wider union.
- [ ] Backward compatibility: existing `PluginsSettings` callers + tests unchanged and green; `pnpm typecheck` 0 against installed `@theokit/sdk@2.9.0`.
- [ ] A changeset declares the `@theokit/agents` minor bump.

## ADRs

### D1 — Widen to a UNION (`PluginsSettings | readonly Plugin[]`), not replace
- **Decision:** Add `readonly Plugin[]` as a union member to the existing `PluginsSettings` type on both fields.
- **Rationale:** Backward compatibility (existing `{ enabled }` callers keep compiling) + KISS (mirror the SDK #90.3a union exactly). Cites theokit `rules/type-safety.md` (reuse `@theokit/sdk` types, no duplication) + G7 (the union has a real consumer: TheoCode + the type test).
- **Alternatives considered:** (a) Replace `PluginsSettings` with `readonly Plugin[]` — rejected: breaks `{ enabled }` callers (a breaking change for a minor). (b) Leave it `PluginsSettings` and have TheoCode keep the cast — rejected: that is the reimplementation/cast the radar removes (the type lies about what the runtime accepts).
- **Consequences:** Enables TheoCode to drop the cast; the two layers (`@theokit/sdk` AgentOptions + `@theokit/agents` AgentRunnerRunOptions) now agree on the plugins shape. Constrains future agents code to handle both shapes (already handled — forward is `Record<string, unknown>`).

### D2 — Compile against installed `@theokit/sdk@2.9.0` (do NOT gate on the #90.3a sdk publish)
- **Decision:** Implement + verify against the currently-installed `@theokit/sdk@2.9.0`; do not bump the peerDep or wait for the #90.3a publish.
- **Rationale:** YAGNI/honesty — the forward is duck-typed (`Record<string, unknown>`), so the agents typecheck does not consume the SDK's `AgentOptions.plugins` type; `Plugin`/`PluginsSettings` already exist in 2.9.0. Gating on the publish would be a false dependency.
- **Alternatives considered:** (a) Bump peerDep to `^2.10.0` + wait for the sdk publish — rejected: unnecessary (the agents code compiles + behaves correctly against 2.9.0; the runtime already accepts `Plugin[]`). (b) `pnpm link` the local sdk to verify — rejected: not needed (compiles against 2.9.0); avoids destabilizing the Turborepo workspace.
- **Consequences:** #90-B ships independently of PR #38; TheoCode's cast removal (#90-C) consumes the published `@theokit/agents` minor.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Widening a public-barrel type could shift inference for an existing `AgentRunnerRunOptions` caller | Low | Union widening is additive; existing `PluginsSettings` literals still satisfy it. `pnpm typecheck` across the monorepo + a `.test-d` type test asserting both forms compile. | agents |
| The agents-side type now permits `Plugin[]` but a hypothetical future non-duck-typed forward would break | Low | Documented: the forward is `Record<string, unknown>` (`buildExtraCreateOptions`); any future tightening must preserve the union. The SDK runtime (`extractCodePlugins`) accepts the array. | agents |
| Two-layer type drift if `@theokit/sdk` `AgentOptions.plugins` is later narrowed | Low | The paired #90.3a fix widened the SDK side; both reference the same `Plugin`/`PluginsSettings` from `@theokit/sdk`. A narrowing would fail TheoCode's typecheck (caught downstream). | sdk |

## Unresolved Questions

- Q1 — Should `AgentRunnerBuilder` gain a `.plugins(...)` method too? Resolved at plan time: NO (YAGNI) — the per-run `AgentRunnerRunOptions.plugins` is the evidenced need; no consumer asked for a builder method. Documented, not built.
- Q2 — Does any agents test assert `plugins` is exactly `PluginsSettings`? Verified at plan time: the type test added here asserts the union; if an existing test narrows it, it surfaces in `pnpm typecheck` and becomes a MUST-FIX. `(none expected — the field is forwarded as Record<string, unknown>)`.

## Dependency Graph

```
Phase 1 (widen both plugins fields) ──▶ Phase 2 (changeset + integration validation)

Single-package change; phases sequential.
```

---

## Phase 1: Widen the `plugins` option type

### T1.1 — Widen `AgentRunnerRunOptions.plugins` + `CreateSdkAgentStreamOptions.plugins` to `PluginsSettings | readonly Plugin[]`

#### Objective
Accept a `Plugin[]` on the per-run plugins option, mirroring the SDK #90.3a union.

#### Why this step (action + reasoning)
1. **What this step does** — imports `Plugin` from `@theokit/sdk` into both files and changes `plugins?: PluginsSettings` → `plugins?: PluginsSettings | readonly Plugin[]` on `AgentRunnerRunOptions` (`agent-runner.ts:80`) and `CreateSdkAgentStreamOptions` (`sdk-adapter.ts:80`).
2. **Why it is necessary now** — D1: it is the whole fix; TheoCode cannot drop its cast until the agents option accepts `Plugin[]`. The forward is already duck-typed (D2), so no further change is needed.

#### Evidence
`packages/agents/src/loop/agent-runner.ts:80` (`readonly plugins?: PluginsSettings`); `packages/agents/src/bridge/sdk-adapter.ts:80` (`plugins?: PluginsSettings`); the duck-typed forward `buildExtraCreateOptions(overrides): Record<string, unknown>` with `extra.plugins = overrides.plugins` (`sdk-adapter.ts`); both files already import `PluginsSettings`/`CustomTool` from `@theokit/sdk` (`agent-runner.ts:18-19`, `sdk-adapter.ts:14-15`).

#### Files to edit
```
packages/agents/src/loop/agent-runner.ts — import Plugin; widen AgentRunnerRunOptions.plugins
packages/agents/src/bridge/sdk-adapter.ts — import Plugin; widen CreateSdkAgentStreamOptions.plugins
tests/unit/agent-runner-plugins-type.test-d.ts — RED type test (both forms compile)
```

#### Deep file dependency analysis
- `agent-runner.ts` (Baseline row 1) — add `Plugin` to the `@theokit/sdk` import; widen the one field. `AgentRunner.run`/`.stream` signatures + all other fields unchanged.
- `sdk-adapter.ts` (Baseline row 2) — add `Plugin` to the import; widen the mirror field. `buildExtraCreateOptions` (`Record<string, unknown>`) unchanged — it already accepts any value.

#### Deep Dives
- Data structures: `plugins?: PluginsSettings | readonly Plugin[]` on both interfaces. `Plugin`, `PluginsSettings` both from `@theokit/sdk` (public exports).
- Invariants: forward is `Record<string, unknown>` (untouched); existing `{ enabled }` callers still valid (union superset).
- Edge cases: omitted `plugins` → undefined (unchanged); `Plugin[]` value → forwarded raw to the duck-typed `Agent.create` (the SDK runtime `extractCodePlugins` handles it).

#### Pseudo-code / Signatures
```pseudocode
// agent-runner.ts + sdk-adapter.ts
import type { Plugin, PluginsSettings, CustomTool, ... } from '@theokit/sdk'
interface AgentRunnerRunOptions { ... readonly plugins?: PluginsSettings | readonly Plugin[] ... }
interface CreateSdkAgentStreamOptions { ... plugins?: PluginsSettings | readonly Plugin[] ... }
// buildExtraCreateOptions unchanged: extra.plugins = overrides.plugins  (Record<string, unknown>)

# Example
runner.stream(msg, { plugins: [aCodePlugin] })   // now typechecks (was: required `as unknown as`)
runner.stream(msg, { plugins: { enabled: ["x"] } }) // still typechecks (backward-compatible)
```

#### Tasks
1. Add `Plugin` to the `@theokit/sdk` type import in both files.
2. Widen both `plugins?` fields to `PluginsSettings | readonly Plugin[]`.

#### TDD
```
RED:     test_agent_runner_run_options_accepts_plugin_array (.test-d) — expectTypeOf<readonly Plugin[]> assignable to AgentRunnerRunOptions['plugins'] (FAILS before the widen)
RED:     test_agent_runner_run_options_still_accepts_plugins_settings (.test-d) — PluginsSettings still assignable (regression)
GREEN:   widen both fields + import Plugin
REFACTOR: None expected
VERIFY:  pnpm test -- agent-runner-plugins-type && pnpm typecheck
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Pure type-surface change; no runtime/concurrency behavior altered (the forward path is unchanged).

#### Acceptance Criteria
- [ ] `Plugin[]` form compiles — `pnpm test -- agent-runner-plugins-type` exits 0 (the `.test-d` type test passes)
- [ ] `PluginsSettings` form still compiles (backward-compat) — `pnpm test -- agent-runner-plugins-type` exits 0
- [ ] No inference regression across the monorepo — `pnpm typecheck` exits 0
- [ ] Both fields widened — `grep -n "PluginsSettings | readonly Plugin\[\]" packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/sdk-adapter.ts` returns 2 hits
- [ ] Pass: lint — `pnpm lint` exits 0 on changed files; Pass: size — `wc -l packages/agents/src/loop/agent-runner.ts` reports ≤ 500

#### DoD
- [ ] `pnpm test -- agent-runner-plugins-type` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0 on changed files
- [ ] `wc -l packages/agents/src/bridge/sdk-adapter.ts` reports ≤ 500

---

## Phase 2: Changeset + Integration Validation

### T2.1 — Changeset for the `@theokit/agents` minor

#### Objective
Declare the `@theokit/agents` minor bump via changesets.

#### Why this step (action + reasoning)
1. **What this step does** — writes `.changeset/agents-runoptions-plugins-widen.md` declaring an `@theokit/agents` minor with a consumer-facing summary.
2. **Why it is necessary now** — theokit publishes via changesets; the changeset is the release contract. (Do NOT run `version-packages` in the feature commit.)

#### Evidence
theokit `.changeset/config.json` (changesets, baseBranch main); `@theokit/agents` 0.20.0; `AgentRunnerRunOptions` is a public barrel export (`loop/index.ts:10`).

#### Files to edit
```
.changeset/agents-runoptions-plugins-widen.md (NEW) — @theokit/agents minor
```

#### Deep file dependency analysis
- New changeset file only; no code dependency.

#### Deep Dives
- Format: frontmatter `"@theokit/agents": minor` + a one-line summary ("`AgentRunnerRunOptions.plugins` now also accepts a `readonly Plugin[]`, not only `PluginsSettings`").

#### Tasks
1. Write the changeset file with the minor bump + summary.

#### TDD
```
RED:     n/a (changeset is metadata)
GREEN:   create .changeset/agents-runoptions-plugins-widen.md
REFACTOR: None expected
VERIFY:  test -f .changeset/agents-runoptions-plugins-widen.md && grep -q "@theokit/agents" .changeset/agents-runoptions-plugins-widen.md
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Changeset exists with an `@theokit/agents` minor — `grep -A2 '\-\-\-' .changeset/agents-runoptions-plugins-widen.md | grep -q "@theokit/agents"`
- [ ] No version consumed in the feature commit — `git diff --name-only` does NOT include `packages/agents/package.json` version bump

#### DoD
- [ ] Changeset file present and well-formed
- [ ] Feature commit does NOT run `version-packages`

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `AgentRunnerRunOptions.plugins` rejects `Plugin[]` (forces the TheoCode cast) | T1.1 | Widen to `PluginsSettings | readonly Plugin[]` (+ sdk-adapter mirror) |
| 2 | Backward compatibility for existing `PluginsSettings` callers | T1.1 + Final Phase | Union widening; full `pnpm typecheck` + suite green |
| 3 | Release declared without consuming the changeset | T2.1 | Changeset with `@theokit/agents` minor |
| 4 | No regression in the agents loop / bridge | T1.1 + Final Phase: Integration Validation | `pnpm test` + `pnpm typecheck` + `pnpm lint` green |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` exits 0 (from theokit root)
- [ ] Zero type errors — `pnpm typecheck` exits 0 (compiles against installed `@theokit/sdk@2.9.0`)
- [ ] Zero lint warnings — `pnpm lint` exits 0
- [ ] File-size budget respected (per `rules/system-design-guardrails.md` G6 — both files ≤ 500 LoC)
- [ ] CHANGELOG handled via changeset (theokit uses changesets)
- [ ] Backward compatibility preserved — existing `AgentRunnerRunOptions` callers + tests unchanged and green
- [ ] Plan-specific criteria: the widen is a union (additive); the duck-typed forward is untouched
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

(none — no external I/O touched)
This plan changes two TypeScript interface field types + a changeset. No HTTP/DB/queue/socket/filesystem. The duck-typed forward (`Record<string, unknown>`) is unchanged.

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the additive type widen against the full agents suite + monorepo typecheck, compiling against the installed `@theokit/sdk@2.9.0`.

### Execution
```
pnpm test          # full vitest suite (incl. the new .test-d type test)
pnpm typecheck     # tsc --noEmit across the monorepo (proves the widen compiles against sdk 2.9.0)
pnpm lint          # eslint . --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green (incl. the new `agent-runner-plugins-type.test-d.ts` + pre-existing agents loop/bridge tests) — `pnpm test` exits 0
- [ ] Coverage ≥ 90% on changed files (the type change has no new runtime branch — N/A for runtime coverage; the type test covers the contract)
- [ ] Zero type errors — `pnpm typecheck` exits 0 (the proof the union compiles against `@theokit/sdk@2.9.0` via the duck-typed forward)
- [ ] Zero lint warnings — `pnpm lint` exits 0
- [ ] Runtime-metric proof — n/a (no counters)
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Distinguish plan-caused failures (inference shift from the union) from pre-existing.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description; do not block.
