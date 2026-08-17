---
slug: ecosystem-integration-guarantee
milestone_id: M48
created_at: 2026-07-15
goal: Ship the 5 FAANG-grade guarantee layers on the theokit↔@theokit/sdk seam
---

# Plan: Ecosystem integration guarantee — FAANG-grade theokit↔@theokit/sdk seam

> **Version 1.0** — The `@theokit/sdk` seam is the load-bearing one (the SDK is the ONLY agent runtime, per `sdk-runtime.md`/G2) yet it is the LEAST guarded of the three ecosystem seams: ~25 symbols consumed via structural types + a dynamic import, an un-tested local `CustomTool` mirror that already drifted from SDK 4.0.2 (`ctx.threadId`/`ctx.messages` missing), a stale proto-test hardcoding `major===3`, an open `@theokit/sdk-tools` peer range, a per-request (not fail-fast) missing-SDK error, and no seam doc. This plan mirrors the two EXISTING FAANG-grade seam patterns (theo-ui consumer+producer contract test; TheoCloud EC-7 drift guard) onto the SDK seam, closing all five DoD layers, so a future SDK bump that changes the consumed surface fails a gate in CI or at boot — never silently in production.

## Goal

> Enable the theokit↔@theokit/sdk seam to fail-fast on drift so that a change to any consumed SDK symbol is caught by a gate, measured by `pnpm test tests/integration/contract-sdk-seam.test.ts tests/type/custom-tool-mirror.test-d.ts` passing green AND an intentional mirror divergence making `tsc` fail.

## Context

M48 (`ROADMAP.md:1100`) was authored 2026-07-14; its DoD text predates the SDK-4 migration merged 2026-07-15 (PR #134, `theokit@0.42.0`/`@theokit/agents@0.41.0`). Two of its five layers shifted: the `@theokit/sdk` peer is already `^4.0.1` (migration closed it), and the "mirror `docs/architecture/theokit-theocloud-integration.md`" target does not exist on disk. The intent — bring the SDK seam to parity with the theo-ui + TheoCloud seams — is unchanged. Filing `theokit-sdk#119` (`CustomTool` ctx lacks `threadId` → stateful tools like `todolist` leak across sessions) is the concrete trigger: when the SDK added `ctx.threadId`, theokit's hand-maintained mirror silently drifted and nothing caught it. This plan adds the gate that catches exactly that.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/server/define/define-agent-tool.ts` | 48 | `13f0776b` (2026-07-15) | Local `CustomTool` mirror (`:29-48`) keeps `@theokit/sdk` an optional peer (type-only, no value import) | Keeps the theokit-only `transform?` field (M18); stays a hand-maintained mirror (no `import type … CustomTool` hard dep) |
| `packages/theo/src/server/agent/sdk-compat.ts` (NEW) | 0 | — | Pure `||`-aware caret semver checker + supported-range constant, shared by boot check + tests | Web-Standards only (no `node:*` — G8/R3a); no new dep (no `semver`) |
| `packages/theo/src/cli/commands/start/assert-sdk-compatible.ts` (NEW) | 0 | — | Boot-time SDK presence + semver assertion (typed error) | Node/CLI layer (`node:*` allowed); throws typed error, never swallows |
| `packages/theo/src/cli/commands/start/bootstrap-stages.ts` | ~45 | (existing) | Boot stage that already `import('@theokit/sdk').catch(()=>null)` for registry (`:31-41`) | `configureAgentRegistryFromConfig` behavior unchanged; add the assert BEFORE it swallows |
| `packages/agents/package.json` | — | `13f0776b` (2026-07-15) | `@theokit/sdk-tools` peer is `>=0.11.0` (`:36`, open) | Close to `^0.11.0`; keep `peerDependenciesMeta.optional` |
| `package.json` (root) | — | (existing) | Root devDep `@theokit/sdk` is `^3.5.0` (`:51`, STALE) — source of the root 3.5.0 hoist that root tests resolve | Bump to `^4.0.1`; the only root test importing SDK is the stale proto-test (deleted in T2.1) |
| `tests/integration/contract-sdk-seam.test.ts` (NEW) | 0 | — | Consumer contract test vs REAL installed SDK dist + version-drift guard | Mirrors theo-ui recipe; no mocks; `skipIf` for absent SDK |
| `tests/integration/sdk-1-1-0-exports.test.ts` | ~72 | (existing, STALE) | Proto-contract test — hardcodes `major===3` (`:33`), imports removed 4.0 storage classes | REPLACED by contract-sdk-seam (delete after parity) |
| `tests/type/custom-tool-mirror.test-d.ts` (NEW) | 0 | — | Type-assignability gate: mirror `ctx` param `toEqualTypeOf` SDK `ctx` param | Fails `tsc` on any `ctx`-shape drift |
| `../theokit-sdk/packages/sdk/tests/contract/theokit-consumer.test.ts` (NEW, sibling repo) | 0 | — | Producer mirror — asserts theokit's consumed surface still exported | `skipIf(!distBuilt)`; `fileURLToPath(import.meta.url)` PKG_ROOT (EC-1) |
| `../theokit-sdk/packages/sdk/package.json` (sibling repo) | — | — | SDK package manifest — no `test:contract`/`prepublishOnly` today | Add both; `prepublishOnly` runs the producer test pre-publish |
| `docs/architecture/theokit-sdk-integration.md` (NEW) | 0 | — | Seam manifest doc (structure synthesized from CLAUDE.md prose) | Mirrored into `../theokit-sdk/docs/architecture/` (edit-one-diff-other) |
| `CLAUDE.md` | large | (existing) | Ecosystem table says SDK is a "permanent workspace link" — STALE | Correct to "npm registry; sibling links removed 2026-06-10" |
| `CHANGELOG.md` | large | `98b5b9a1` (2026-07-15) | Keep-a-Changelog | Add `[Unreleased]` entries |

### Current callers / dependents

- **Symbol:** `CustomTool` (interface) in `packages/theo/src/server/define/define-agent-tool.ts:29`
  - **Callers (production):** re-exported/consumed at `packages/theo/src/server/agent/acp-tool.ts:14`; the SDK-side `CustomTool` type is consumed at `packages/agents/src/bridge/sdk-adapter.ts:12`, `loop/agent-runner.ts:18`, `bridge/agent-orchestrator.ts:16`, `bridge/define-agent.ts:13`, `bridge/agent-builder.ts:18`, `a2a/a2a-client.ts:9`.
  - **Callers (tests):** the new `tests/type/custom-tool-mirror.test-d.ts`.
  - **External (public API consumed by other repos):** the mirror is theokit-internal; the SDK's `CustomTool` is the cross-repo contract.
- **Symbol:** `loadSdkRuntime()` / `SDK_NOT_INSTALLED` in `packages/agents/src/bridge/sdk-adapter.ts:197-215,509-516`
  - **Callers (production):** the stream async-iterator (`:509`). Runs per request.
  - **Callers (tests):** `packages/agents/tests/integration/*` runtime-overrides / basedir tests.
- **Symbol:** `configureAgentRegistryFromConfig` in `packages/theo/src/cli/commands/start/bootstrap-stages.ts:31-41`
  - **Callers (production):** `theokit start` boot sequence.
  - **External:** no.

### Domain glossary

- **Seam** — the artifact-on-disk contract surface between theokit and a sibling (here: the ~25 imported `@theokit/sdk` symbols + dynamic import).
- **Consumer contract test** — a test in the CONSUMER repo asserting the real published producer artifact still has the shape the consumer binds.
- **Producer contract test** — the mirror in the PRODUCER repo, gated by `prepublishOnly`, that fails the publish if the consumer's expectations break.
- **EC-7 (theo-ui)** — the hoist-drift guard: resolved version must satisfy the declared peerDep range.
- **Mirror (CustomTool)** — theokit's hand-maintained local copy of the SDK type, kept so the SDK stays an OPTIONAL peer (no value import at type sites).
- **Fail-fast** — surface a missing/incompatible SDK at boot (`theokit start`), not lazily at first request.

### Architecture boundaries affected

- `packages/theo/src/server/` — Web-Standards only (G8/R3a): `sdk-compat.ts` MUST use no `node:*` (pure string logic).
- `packages/theo/src/cli/` — adapter/CLI layer: `node:*` allowed (`assert-sdk-compatible.ts` resolves package.json).
- Cross-repo boundary: `../theokit-sdk/` (sibling) — the producer test + package.json edits cross into the sibling; kept in sync via the seam doc's edit-one-diff-other rule.
- G2/`sdk-runtime.md` — this plan adds GUARDS on the seam, reimplements NO runtime (no LLM loop, no storage, no streaming). Pure boundary hardening (ADR-0040 home/boundary carve-out).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/ecosystem-integration-guarantee-blueprint.md` (this cycle's discover output; §"Coverage Corner 1/4" for the recipe).
- **Reference seam 1 (theo-ui):** `tests/integration/contract-usetheo-ui-vite-plugin.test.ts` — consumer contract (`:119` real-dist import, `:66-105` inline caret checker, `:168-190` EC-7 hoist guard); producer mirror `../theokit-ui/tests/contract/theokit-consumer.test.ts` (`:24-27` PKG_ROOT, `:49-53` skipIf); `docs/adr/0018-usetheo-ui-vite-plugin-contract-versionado.md`.
- **Reference seam 2 (TheoCloud):** `tests/unit/services-manifest-v2.test.ts:62-107` — EC-7 schema-drift (producer-emitted ⊆ consumer-accepted; `:68-81` walk-up + skip-clean).
- **Patterns skills:** none applicable — see ADR D0 (override of `theokit-http-decorators-pattern-from-nestjs-patterns`).
- **External:** vitest `expectTypeOf` type-testing (stable API); npm/pnpm `prepublishOnly` lifecycle.

## Objective

- [ ] Layer 1 — Type-assignability gate on the `CustomTool` mirror + mirror synced to SDK 4.0.2 (`ctx.threadId`/`ctx.messages`).
- [ ] Layer 2 — Consumer contract test vs real SDK dist (replaces the stale proto-test) + version-drift guard.
- [ ] Layer 3 — Version gate: `@theokit/sdk-tools` peer closed `^0.11.0` + boot-time `assertSdkCompatible()` typed fail-fast.
- [ ] Layer 4 — Producer contract test in `theokit-sdk` + `prepublishOnly` publish gate.
- [ ] Layer 5 — Seam doc `docs/architecture/theokit-sdk-integration.md` (+ sibling mirror) + stale CLAUDE.md line fixed + parity audit of the other two seams recorded.

## ADRs

### D0 — Override: `theokit-http-decorators-pattern-from-nestjs-patterns` does not apply
- **Decision:** the only `*-patterns` skill present targets `@theokit/http-decorators` / NestJS decorator bridges / `theokit generate controller`; M48 is the SDK runtime seam (contract test + type gate + version gate), unrelated to HTTP decorators.
- **Rationale:** the skill's triggers (`@UseGuards`→`defineMiddleware`, DTO→Zod, `generate controller`) share no decision surface with the SDK seam. Citing it would be noise.
- **Alternatives considered:** cite it anyway — rejected (fabricated relevance violates honesty).
- **Consequences:** M48 does not consume any patterns skill; its prior art is the two internal reference seams.

### D1 — Reuse the theo-ui consumer+producer+prepublishOnly recipe verbatim (Don't Reinvent, parsimony rung 4)
- **Decision:** copy the theo-ui contract-test recipe (real-dist `await import`, shape asserts, `describe.skipIf`, `fileURLToPath` PKG_ROOT, inline `||`-aware caret checker, `prepublishOnly` gate) onto the SDK seam.
- **Rationale:** it is the proven FAANG-grade pattern already guarding a sibling seam; reinventing risks divergent guarantees.
- **Alternatives considered:** (a) bespoke SDK harness — rejected, reinvents a proven pattern; (b) rely only on `tsc` — rejected, misses runtime export-shape drift (a renamed export compiles at the type site but breaks the dynamic `import`).
- **Consequences:** all three seams share one mental model; the caret checker is duplicated by design (each seam self-contained), NOT extracted across repos.

### D2 — Type gate uses `toEqualTypeOf` on the `ctx` param, not `toMatchTypeOf` on the whole interface
- **Decision:** assert `expectTypeOf<Parameters<Sdk.CustomTool['handler']>[1]>().toEqualTypeOf<Parameters<Local.CustomTool['handler']>[1]>()`.
- **Rationale:** the handler param is contravariant — a NARROWER mirror `ctx` (missing `threadId`/`messages`) is still assignable to the SDK handler, so `toMatchTypeOf<Local>().<Sdk>()` on the interface is TOO WEAK and would NOT catch #119. Equality on the `ctx` param is the precise gate.
- **Alternatives considered:** (a) `toMatchTypeOf` on the interface — rejected (proven too weak by the research); (b) `type CustomTool = import('@theokit/sdk').CustomTool` — rejected (makes the type a hard SDK dependency, breaks optional-peer, drops the theokit-only `transform`).
- **Consequences:** the gate fails precisely when the SDK `ctx` gains/loses a field; the mirror must be kept in sync (which M48 does now).

### D3 — Sync the local mirror to SDK 4.0.2 (add `ctx.threadId?`, `ctx.messages?`; widen handler return) so the gate ships GREEN
- **Decision:** update `define-agent-tool.ts` `ctx` to `{ signal?, context?, messages?: readonly ToolContextMessage[], threadId?: string }` and the handler return to `string | ToolResultContentBlock[] | Promise<…>`, mirroring SDK 4.0.2.
- **Rationale:** the gate must be green on a correct baseline; #119/SE12/SE7 drift is real and should be closed, not asserted-as-broken.
- **Alternatives considered:** ship the gate red as a known-divergence marker — rejected (a red gate on `develop` violates "broken test = highest-priority bug").
- **Consequences:** tools may now read `ctx.threadId`; the widened return type is additive (existing `string`-returning tools unaffected).

### D4 — Boot-time `assertSdkCompatible()` in bootstrap-stages; KEEP the lazy request-path `SDK_NOT_INSTALLED`
- **Decision:** add a boot assertion (presence + `^4.0.1` semver, typed error listing found-vs-required) invoked from `bootstrap-stages.ts`; retain the per-request lazy event.
- **Rationale:** fail-fast at `theokit start` catches a missing/mis-versioned SDK before traffic; the lazy event stays as defense-in-depth for a post-boot dlopen failure.
- **Alternatives considered:** replace the lazy event entirely — rejected (request path still needs a graceful typed error if the SDK breaks after boot).
- **Consequences:** operators see the incompatibility at boot with a clear message; two layers guard the seam.

### D5 — Producer test runs via `prepublishOnly` (local), not a GH Actions workflow
- **Decision:** wire `test:contract` + `prepublishOnly` into `theokit-sdk/packages/sdk/package.json`.
- **Rationale:** `theokit-sdk` GH Actions is billing-blocked (local `pnpm validate` is the gate); a remote workflow would never run. Mirrors theo-ui exactly.
- **Alternatives considered:** remote workflow — rejected (never runs); no producer test — rejected (leaves the biggest gap open).
- **Consequences:** a contract-breaking SDK `dist/` cannot be published; the producer discovers breakage before publish.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Cross-repo edit into `theokit-sdk` sibling (producer test + package.json) may drift from theokit's consumer test | Medium | The seam doc's "edit-one-diff-other" rule + both tests assert the SAME symbol list; producer `prepublishOnly` gate makes drift block a publish | maintainer |
| Closing `@theokit/sdk-tools` to `^0.11.0` rejects an app pinning a newer tools major | Low | Intended guardrail; document the conscious-bump procedure in the seam doc (SE36→3.x precedent) | maintainer |
| Boot fail-fast could reject a valid app if version resolution is environment-fragile (monorepo hoist ambiguity) | Medium | Resolve via `@theokit/sdk/package.json` (the actually-loaded copy) not root hoist; skip-clean when SDK is an absent optional peer (api-only apps) | maintainer |
| The stale root-hoist `@theokit/sdk@3.5.0` may make the contract/drift test read the wrong version | Medium | Test resolves the version from the CONSUMER package dir (`packages/theo/node_modules`) like theo-ui's fixture-scoped resolution, not root | maintainer |
| Producer test can't run if the `theokit-sdk` sibling is absent on a solo checkout | Low | `describe.skipIf(!siblingPresent)` + walk-up resolution (TheoCloud EC-7 pattern) — green on solo checkout, hard-asserts in monorepo/CI | maintainer |

## Unresolved Questions

- Q1 — Should the version-drift guard read the peer range from `packages/theo/package.json` at test time (theo-ui EC-7 style) OR hardcode `^4.0.1`? (Resolved in T2.2: read from package.json — single source of truth, DRY.)
- Q2 — Does the SDK expose `ToolContextMessage`/`ToolResultContentBlock` as public exports for the mirror's type sync? (Resolved in T1.1: verify the export; if not public, mirror the structural shape inline with a comment citing the SDK `.d.ts` line.)
- Q3 — Where exactly in `bootstrap-stages.ts` does the assert run relative to the registry `.catch(()=>null)`? (Resolved in T3.2: BEFORE, so a missing SDK fails loud instead of being swallowed.)

## Dependency Graph

```
Phase 1 (type gate + mirror sync) ──▶ Phase 2 (consumer contract + drift guard)
                                          │
Phase 3 (version peer + boot fail-fast) ──┤  (P3 independent of P1/P2 code, parallel-safe)
                                          ▼
                                     Phase 4 (producer test + prepublishOnly, sibling repo)
                                          │
                                          ▼
                                     Phase 5 (seam doc + CLAUDE.md fix + parity audit)
                                          │
                                          ▼
                                 Final Phase: Integration Validation
```

Phase 3 (peer bump + boot check) is code-independent of Phases 1–2 and may run in parallel. Phase 4 depends on the consumed-symbol list finalized in Phase 2. Phase 5 documents the finished surface.

---

## Phase 1: Type-assignability gate + mirror sync

**Objective:** the local `CustomTool` mirror is provably structurally equal (on the `ctx` param) to SDK 4.0.2, enforced by a `.test-d.ts` gate.

### T1.1 — Sync the `CustomTool` mirror to SDK 4.0.2 + add the type-assignability gate

#### Objective
Add `ctx.threadId?`/`ctx.messages?` and widen the handler return in the mirror; add a `.test-d.ts` that fails `tsc` on `ctx`-shape drift.

#### Why this step (action + reasoning)
1. **What this step does** — updates `define-agent-tool.ts:29-48` `ctx` to include `messages?`/`threadId?` and the handler return to `string | ToolResultContentBlock[] | Promise<…>`, then adds `tests/type/custom-tool-mirror.test-d.ts` asserting the mirror's `ctx` param `toEqualTypeOf` the SDK's.
2. **Why necessary now** — per D2/D3 and the blueprint, the mirror already drifted (#119 `ctx.threadId` missing); the gate is the whole point of M48 layer 1, and it must ship GREEN on a synced mirror (a red gate on develop is forbidden).

#### Evidence
Divergence proven in the research: mirror `ctx` lacks `threadId?`/`messages?` (`define-agent-tool.ts:29-48` vs SDK `dist/run-*.d.ts:409-445`); `withRunContext` already spreads full `ctx` at runtime (`sdk-adapter.ts:424-432`) so only the TYPE was behind. `Blueprint §"Coverage Corner 4"`.

#### Files to edit
```
packages/theo/src/server/define/define-agent-tool.ts — add ctx.messages?/threadId?; widen handler return
tests/type/custom-tool-mirror.test-d.ts — RED type test added first (TDD)
```

#### Deep file dependency analysis
- `define-agent-tool.ts` today (Baseline row) is the type-only mirror keeping SDK an optional peer. Change: extend the `ctx` object type + handler return union. Downstream: `acp-tool.ts:14` and the SDK-typed consumers (`sdk-adapter.ts:12` etc.) are unaffected (additive optional fields).
- New `.test-d.ts` imports both the local mirror and `import type { CustomTool } from '@theokit/sdk'`.

#### Deep Dives
- Invariant: keep the theokit-only `transform?` field (M18) — the gate compares the `ctx` PARAM only, not the whole interface, so `transform` excess is fine.
- Edge case: if the SDK does not export `ToolContextMessage`/`ToolResultContentBlock` publicly (Q2), mirror the structural shape inline with a `// SDK dist/run-*.d.ts:NNN` citation comment.

#### Pseudo-code / Signatures
```typescript
// define-agent-tool.ts
export interface CustomTool {
  name: string; description: string; inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>, ctx?: {
    signal?: AbortSignal; context?: unknown
    messages?: readonly ToolContextMessage[]   // SE12
    threadId?: string                          // theokit-sdk#119
  }) => string | ToolResultContentBlock[] | Promise<string | ToolResultContentBlock[]>
  transform?: ToolTransform                     // theokit-only (M18)
}
// custom-tool-mirror.test-d.ts
type SdkCtx  = Parameters<import('@theokit/sdk').CustomTool['handler']>[1]
type LocalCtx = Parameters<CustomTool['handler']>[1]
expectTypeOf<LocalCtx>().toEqualTypeOf<SdkCtx>()   // fails tsc if ctx shapes diverge
```

#### Tasks
1. Verify the SDK 4.0.2 `CustomTool` `ctx` + return shape (`node -e require.resolve` from `packages/theo`; read the `.d.ts`).
2. Write `custom-tool-mirror.test-d.ts` asserting `ctx`-param equality (RED — fails on current mirror).
3. Update the mirror `ctx` + handler return (GREEN).
4. Confirm `transform?` retained.

#### TDD
```
RED:  custom-tool-mirror.test-d.ts — expectTypeOf<LocalCtx>().toEqualTypeOf<SdkCtx>() fails (mirror missing threadId/messages)
GREEN: sync the mirror ctx + return type
REFACTOR: None expected
VERIFY: pnpm --filter theokit exec tsc --noEmit -p tsconfig.json && pnpm vitest run tests/type/custom-tool-mirror.test-d.ts --typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run tests/type/custom-tool-mirror.test-d.ts --typecheck` exits 0; removing `threadId` from the mirror `ctx` makes `pnpm -F theokit exec tsc --noEmit` exit non-zero.
- [ ] `grep -c "transform" packages/theo/src/server/define/define-agent-tool.ts` returns ≥ 1 (M18 field retained).
- [ ] `pnpm lint packages/theo/src/server/define/define-agent-tool.ts` reports 0 warnings AND `wc -l < packages/theo/src/server/define/define-agent-tool.ts` returns ≤ 500.

#### DoD
- [ ] `tsc --noEmit` green; type test green; mirror synced.

---

## Phase 2: Consumer contract test + version-drift guard

**Objective:** a contract test binds the real installed SDK surface and fails on export-shape OR version drift; the stale proto-test is retired.

### T2.1 — Consumer contract test vs real SDK dist (replaces the stale proto-test)

#### Objective
`tests/integration/contract-sdk-seam.test.ts` imports the REAL installed `@theokit/sdk` and asserts every symbol/discriminant theokit binds; delete `sdk-1-1-0-exports.test.ts` after parity.

#### Why this step (action + reasoning)
1. **What this step does** — asserts `Agent.getOrCreate` is a function, `Tool.create` returns a `CustomTool`-shaped object, `AgentRunError` shape (`code`/`retriable`), and the 5 `InteractionUpdate` discriminants theokit consumes (`event-translator.ts:181-222`); replaces the stale test hardcoding `major===3` and importing removed 4.0 storage classes.
2. **Why necessary now** — per D1 and the blueprint, this is layer 2; the stale test is a live liability (references symbols deleted in SDK 4.0).

#### Evidence
Stale proto-test: `tests/integration/sdk-1-1-0-exports.test.ts:33` `major===3`; imports `FileSystemConversationStorage`/`InMemoryConversationStorage` removed in SDK 4.0 (migration PR #134). Consumed discriminants: `event-translator.ts:181-222`. `Blueprint §"Coverage Corner 4"`.

#### Files to edit
```
tests/integration/contract-sdk-seam.test.ts — NEW consumer contract test (real-dist import, skipIf absent)
tests/integration/sdk-1-1-0-exports.test.ts — DELETE after the new test covers its assertions
```

#### Deep file dependency analysis
- New test dynamically `await import('@theokit/sdk')` resolved from `packages/theo/node_modules` (consumer-scoped, avoids the root 3.5.0 hoist — see Drawbacks). Asserts value symbols (`Agent`, `Tool`) + constructs a tool via `Tool.create` and checks the returned shape.
- Deleting the stale test removes references to symbols that no longer exist (currently green only because root hoist still serves 3.5.0 — a latent break).

#### Deep Dives
- Import the REAL dist, no mocks (theo-ui ADR-0018 §B2). `describe.skipIf(!sdkPresent)` so api-only checkouts (SDK optional peer absent) skip clean.
- Assert `Tool.create({name,description,inputSchema,handler})` returns an object with `name/description/inputSchema/handler` (the `CustomTool` shape) — runtime shape, complementing the T1.1 type gate.

#### Pseudo-code / Signatures
```typescript
// EC-C: resolve the SDK the FRAMEWORK uses (packages/theo → 4.0.2), NOT the root hoist (3.5.0).
// Mirror theo-ui's fixture-scoped resolution (contract-usetheo-ui-vite-plugin.test.ts:30-31).
const consumerRequire = createRequire(pathToFileURL(join(REPO_ROOT, 'packages/theo/package.json')).href)
const sdkEntry = consumerRequire.resolve('@theokit/sdk')
const sdk = await import(pathToFileURL(sdkEntry).href)      // resolves 4.0.2 from packages/theo
expect(typeof sdk.Agent.getOrCreate).toBe('function')
const t = sdk.Tool.create({ name:'x', description:'d', inputSchema:{}, handler:()=> 'ok' })
expect(t).toMatchObject({ name:'x', description:'d' }); expect(typeof t.handler).toBe('function')
expect(sdk.AgentRunError).toBeTypeOf('function')            // typed-error base
// discriminant contract: the 5 InteractionUpdate.type strings theokit translates MUST be documented as consumed
```

#### Tasks
1. Write `contract-sdk-seam.test.ts` (RED against a deliberately-wrong assertion, then correct).
2. Port the still-valid assertions from `sdk-1-1-0-exports.test.ts`; drop the removed-storage-class + `major===3` bits.
3. Delete `sdk-1-1-0-exports.test.ts`.

#### TDD
```
RED:  contract-sdk-seam.test.ts::sdk_exports_Agent_getOrCreate_and_Tool_create — fails if written against a wrong symbol name first
GREEN: assert the real exported surface
REFACTOR: extract a `CONSUMED_SYMBOLS` list reused by the producer test (Phase 4)
VERIFY: pnpm vitest run tests/integration/contract-sdk-seam.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run tests/integration/contract-sdk-seam.test.ts` exits 0 against installed SDK 4.0.2.
- [ ] `test ! -f tests/integration/sdk-1-1-0-exports.test.ts` succeeds AND `pnpm test` exits 0.
- [ ] `pnpm lint tests/integration/contract-sdk-seam.test.ts` reports 0 warnings AND `wc -l < tests/integration/contract-sdk-seam.test.ts` returns ≤ 500.

#### DoD
- [ ] New contract test green; stale test removed; no reference to removed SDK symbols remains.

### T2.2 — Version-drift guard (EC-7 analog) inside the contract test

#### Objective
Assert the resolved `@theokit/sdk` version satisfies `packages/theo/package.json` peer range, using an inline `||`-aware caret checker (no `semver` dep).

#### Why this step (action + reasoning)
1. **What this step does** — reads the declared peer range + the resolved SDK version and asserts satisfaction, reusing a copied `satisfiesCaretPrerelease`-shaped checker placed in `packages/theo/src/server/agent/sdk-compat.ts` (shared with the boot check).
2. **Why necessary now** — per D1 and the live drift (peer `^4.0.1` vs root hoist `3.5.0`); this guard would have caught it.

#### Evidence
theo-ui EC-7 hoist guard `contract-usetheo-ui-vite-plugin.test.ts:168-190` + inline checker `:66-105`. Live drift documented in `Blueprint §"Baseline reality"`.

#### Files to edit
```
packages/theo/src/server/agent/sdk-compat.ts — NEW pure ||-aware caret checker + SUPPORTED_SDK_RANGE
tests/integration/contract-sdk-seam.test.ts — add the version-drift assertion
```

#### Deep file dependency analysis
- `sdk-compat.ts` is pure string logic (no `node:*` — G8/R3a safe); exports `satisfiesSdkRange(version, range)` + `SUPPORTED_SDK_RANGE`. Imported by the drift test AND (Phase 3) the boot check — Rule-of-3 satisfied (drift test + boot check + producer test optionally).
- The test reads the peer range from `packages/theo/package.json` (single source of truth, resolves Q1/DRY).

#### Deep Dives
- Checker splits `range` on `||`, passes if ANY caret clause satisfies (theo-ui `:70-74`). Handles `^4.0.1`.
- Invariant: no `semver` dependency added (parsimony rung 4 — reuse the proven inline pattern).

#### Pseudo-code / Signatures
```typescript
// sdk-compat.ts
export const SUPPORTED_SDK_RANGE = '^4.0.1'
export function satisfiesSdkRange(version: string, range: string): boolean { /* ||-aware caret */ }
// in the contract test:
const declared = require('packages/theo/package.json').peerDependencies['@theokit/sdk']
const actual = require('@theokit/sdk/package.json').version   // resolved from packages/theo
expect(satisfiesSdkRange(actual, declared)).toBe(true)
```

#### Tasks
1. Write `sdk-compat.ts` unit tests (RED): `satisfiesSdkRange('4.0.2','^4.0.1')===true`, `('3.5.0','^4.0.1')===false`, `||`-series.
2. Implement `satisfiesSdkRange` (GREEN).
3. Add the drift assertion to the contract test reading package.json.

#### TDD
```
RED:  sdk-compat.test.ts::satisfies_caret_and_rejects_below_floor — fails before impl
GREEN: implement satisfiesSdkRange
REFACTOR: None expected
VERIFY: pnpm vitest run packages/theo/src/server/agent/sdk-compat.test.ts tests/integration/contract-sdk-seam.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `satisfiesSdkRange` unit tests green (caret, below-floor, `||`-series, prerelease).
- [ ] Drift assertion green against 4.0.2; forcing a `3.x` version string makes it fail.
- [ ] No `semver` dep added (`git diff package.json` shows no new dep).

#### DoD
- [ ] Checker + drift guard green; DRY (range read from package.json).

---

## Phase 3: Version peer close + boot fail-fast

**Objective:** the `@theokit/sdk-tools` peer is closed and a boot-time typed assertion fails fast on a missing/incompatible SDK.

### T3.1 — Close the `@theokit/sdk-tools` peer range

#### Objective
`packages/agents/package.json` peer `@theokit/sdk-tools` `>=0.11.0` → `^0.11.0`.

#### Why this step (action + reasoning)
1. **What this step does** — closes the last open SDK-family peer range.
2. **Why necessary now** — DoD layer 3; the `@theokit/sdk` range is already `^4.0.1`, `sdk-tools` is the remaining open range (`packages/agents/package.json:36`).

#### Evidence
`packages/agents/package.json:36` peer `"@theokit/sdk-tools": ">=0.11.0"` (open); dev is already `^0.11.0` (`:52`).

#### Files to edit
```
packages/agents/package.json — peer @theokit/sdk-tools >=0.11.0 → ^0.11.0
package.json — root devDep @theokit/sdk ^3.5.0 → ^4.0.1 (EC-C MUST-FIX: root tests resolve the framework version, not the stale hoist)
```

#### Deep file dependency analysis
- Consumed only by `compile-project-context.ts:55,58,59` (`buildEnvContext`/`buildRepoMap`, optional). Closing the range is install-time only (EC-11 boundary — no runtime check for tools).

#### Deep Dives / Pseudo-code
Trivial one-line manifest edit; no signature.

#### Tasks
1. Close `packages/agents/package.json` peer `@theokit/sdk-tools` `>=0.11.0` → `^0.11.0`.
2. Bump the root `package.json` devDep `@theokit/sdk` `^3.5.0` → `^4.0.1` (EC-C: the root hoist currently serves 3.5.0 because the root devDep is stale — this makes root-level tests, incl. the new contract test, resolve the framework's 4.0.2). Note `fixtures/template-default` pins `^2.20.0` as a related drift (documented in the seam doc version-compat table; scaffold-template bump is a follow-up, not this task).
3. Run `pnpm install` to reconcile the lockfile.

#### TDD
```
RED:  a test asserting no open (>=) SDK-family peer remains — grep packages/*/package.json peerDependencies for '@theokit/sdk' with '>=' returns none
GREEN: close the range
REFACTOR: None expected
VERIFY: node -e "process.exit(/^>=/.test(require('./packages/agents/package.json').peerDependencies['@theokit/sdk-tools'])?1:0)"
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `node -e "process.exit(require('./packages/agents/package.json').peerDependencies['@theokit/sdk-tools']==='^0.11.0'?0:1)"` exits 0 AND `peerDependenciesMeta['@theokit/sdk-tools'].optional` stays `true`.
- [ ] `pnpm install --frozen-lockfile` exits 0 (lockfile reconciled and committed).

#### DoD
- [ ] `node -e "const p=require('./packages/agents/package.json').peerDependencies;process.exit(Object.entries(p).some(([k,v])=>k.startsWith('@theokit/sdk')&&v.startsWith('>='))?1:0)"` exits 0 (no open `>=` SDK-family peer remains).

### T3.2 — Boot-time `assertSdkCompatible()` typed fail-fast

#### Objective
A boot assertion resolves the installed SDK version, checks `SUPPORTED_SDK_RANGE`, and throws a typed error (found-vs-required); wired into `bootstrap-stages.ts` before the registry `.catch(()=>null)`.

#### Why this step (action + reasoning)
1. **What this step does** — adds `assert-sdk-compatible.ts` (resolves `@theokit/sdk/package.json` version, calls `satisfiesSdkRange`, throws a typed `SdkIncompatibleError` on mismatch / absent-but-required) and calls it at boot; keeps the lazy `SDK_NOT_INSTALLED` request event.
2. **Why necessary now** — per D4; today a missing/mis-versioned SDK is invisible until first request (`sdk-adapter.ts:509-516`).

#### Evidence
Lazy per-request failure: `sdk-adapter.ts:509-516`. Boot home that already imports SDK + swallows: `bootstrap-stages.ts:31-41` (`.catch(()=>null)`). `Blueprint §"Coverage Corner 4"`.

#### Files to edit
```
packages/theo/src/cli/commands/start/assert-sdk-compatible.ts — NEW boot assertion + typed error
packages/theo/src/cli/commands/start/bootstrap-stages.ts — call assertSdkCompatible() BEFORE registry .catch swallow
packages/theo/src/cli/commands/start/assert-sdk-compatible.test.ts — RED tests first
```

#### Deep file dependency analysis
- CLI layer → `node:*` allowed (resolve package.json via `createRequire`/`require.resolve`). Imports `satisfiesSdkRange`/`SUPPORTED_SDK_RANGE` from `sdk-compat.ts` (Phase 2, Rule-of-3).
- `bootstrap-stages.ts`: insert the call so a missing-required SDK throws instead of being swallowed by the registry `.catch`. Optional-peer/api-only apps: when the SDK is a legitimately-absent optional peer, the assertion returns cleanly (presence is only REQUIRED when an agent is mounted) — mirror the existing tolerance.

#### Deep Dives
- Typed error (error-handling.md): `class SdkIncompatibleError extends Error { code='SDK_INCOMPATIBLE'; found; required }` — message: `@theokit/sdk 3.5.0 does not satisfy required ^4.0.1 — run: pnpm add @theokit/sdk@^4.0.1`.
- Edge: version file unresolvable → treat as absent (graceful) unless an agent surface requires it.

#### Pseudo-code / Signatures
```typescript
export function assertSdkCompatible(opts?: { required?: boolean }): void {
  let version: string | undefined
  try { version = createRequire(import.meta.url).call... require('@theokit/sdk/package.json').version } catch { version = undefined }
  if (version === undefined) { if (opts?.required) throw new SdkIncompatibleError(undefined, SUPPORTED_SDK_RANGE); return }
  if (!satisfiesSdkRange(version, SUPPORTED_SDK_RANGE)) throw new SdkIncompatibleError(version, SUPPORTED_SDK_RANGE)
}
```

#### Tasks
1. Write `assert-sdk-compatible.test.ts` (RED): satisfies→no throw; below-floor→throws `SDK_INCOMPATIBLE`; absent+required→throws; absent+not-required→no throw.
2. Implement `assert-sdk-compatible.ts` (GREEN).
3. Wire the call into `bootstrap-stages.ts` before the registry swallow.

#### TDD
```
RED:  assert-sdk-compatible.test.ts::throws_typed_error_when_below_floor — fails before impl
RED:  assert-sdk-compatible.test.ts::no_throw_when_absent_and_not_required
GREEN: implement assertSdkCompatible + SdkIncompatibleError
REFACTOR: None expected
VERIFY: pnpm vitest run packages/theo/src/cli/commands/start/assert-sdk-compatible.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run packages/theo/src/cli/commands/start/assert-sdk-compatible.test.ts` exits 0 (below-floor version throws `SdkIncompatibleError` carrying found + required).
- [ ] The test file asserts absent-optional does NOT throw and absent-required throws (`grep -c "not.toThrow\|toThrow" assert-sdk-compatible.test.ts` ≥ 2, both green).
- [ ] `grep -n "assertSdkCompatible" packages/theo/src/cli/commands/start/bootstrap-stages.ts` shows the call before the registry `.catch`, AND `grep -c "SDK_NOT_INSTALLED" packages/agents/src/bridge/sdk-adapter.ts` returns ≥ 1 (lazy event retained).

#### DoD
- [ ] Boot fail-fast green; typed error; request-path event untouched.

## Failure scenarios (external I/O — filesystem/module resolution)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` (module resolution) | SDK absent (optional peer not installed) | mock `require('@theokit/sdk/package.json')` throws | boot: no throw when not required, typed `SDK_INCOMPATIBLE` when required; request: lazy `SDK_NOT_INSTALLED` event (unchanged) |
| `@theokit/sdk` (version) | installed below floor (`3.5.0` vs `^4.0.1`) | pass `'3.5.0'` to `satisfiesSdkRange` / stub the version file | boot throws `SdkIncompatibleError(found=3.5.0, required=^4.0.1)`; drift test fails |
| `theokit-sdk` sibling repo (filesystem) | sibling absent on solo checkout | producer test resolves sibling path, not found | `describe.skipIf(!siblingPresent)` → suite skips clean, green |

## Phase 4: Producer contract test + prepublishOnly gate (sibling repo)

**Objective:** the SDK repo cannot publish a `dist/` that breaks theokit's consumed surface.

### T4.1 — Producer mirror test + publish gate in `theokit-sdk`

#### Objective
Add `../theokit-sdk/packages/sdk/tests/contract/theokit-consumer.test.ts` asserting the consumed symbol list, and wire `test:contract` + `prepublishOnly` into that package.json.

#### Why this step (action + reasoning)
1. **What this step does** — mirrors theo-ui's producer test (same symbol asserts as T2.1's `CONSUMED_SYMBOLS`, `skipIf(!distBuilt)`, `fileURLToPath` PKG_ROOT) and gates publish via `prepublishOnly`.
2. **Why necessary now** — per D1/D5; the producer side is the single biggest missing guarantee (`theokit-sdk` package.json has NEITHER script today).

#### Evidence
theo-ui producer `../theokit-ui/tests/contract/theokit-consumer.test.ts:24-27,49-53` + `prepublishOnly` recipe. `Blueprint §"Coverage Corner 1"`.

#### Files to edit
```
../theokit-sdk/packages/sdk/tests/contract/theokit-consumer.test.ts — NEW producer mirror
../theokit-sdk/packages/sdk/package.json — add test:contract + prepublishOnly
```

#### Deep file dependency analysis
- Producer test validates the SDK's OWN `dist/` (built) exports the symbols theokit binds — the same `CONSUMED_SYMBOLS` list as T2.1 (kept in sync via the seam doc). `skipIf(!distBuilt)` so a fresh `pnpm test` (before build) skips clean.
- `prepublishOnly: "pnpm build && pnpm test:contract"` runs automatically before `changeset publish`.

#### Deep Dives
- PKG_ROOT via `fileURLToPath(import.meta.url)` (EC-1 — avoids `require.resolve` relative-path pitfall).
- Runs under `theokit-sdk`'s own Node-22 test baseline (memory: SDK tests need Node 22).

#### Pseudo-code / Signatures
```typescript
// theokit-consumer.test.ts (in theokit-sdk)
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const distBuilt = existsSync(join(PKG_ROOT, 'dist', 'index.js'))
describe.skipIf(!distBuilt)('theokit consumer contract', () => {
  it('exports the symbols theokit binds', async () => {
    const sdk = await import(pathToFileURL(join(PKG_ROOT,'dist','index.js')).href)
    for (const s of ['Agent','Tool','AgentRunError']) expect(sdk[s]).toBeDefined()
    expect(typeof sdk.Agent.getOrCreate).toBe('function')
  })
})
```

#### Tasks
1. Write the producer test in the sibling (RED if a symbol asserted is misspelled first).
2. Add `test:contract` + `prepublishOnly` to the sibling package.json.
3. Run `pnpm --filter @theokit/sdk build && pnpm --filter @theokit/sdk test:contract` locally to prove green.

#### TDD
```
RED:  theokit-consumer.test.ts::exports_the_symbols_theokit_binds — fails if run before build OR against a wrong symbol name
GREEN: assert the real built exports
REFACTOR: None expected
VERIFY: (in ../theokit-sdk) pnpm --filter @theokit/sdk build && pnpm --filter @theokit/sdk test:contract
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `(cd ../theokit-sdk && pnpm --filter @theokit/sdk build && pnpm --filter @theokit/sdk test:contract)` exits 0.
- [ ] `grep -q "test:contract" ../theokit-sdk/packages/sdk/package.json` matches the `prepublishOnly` script (a contract break blocks publish).
- [ ] Running `pnpm --filter @theokit/sdk test:contract` BEFORE build reports the suite skipped (exit 0, not failed).

#### DoD
- [ ] Producer test + publish gate wired in `theokit-sdk`; local run green.

## Phase 5: Seam doc + CLAUDE.md fix + parity audit

**Objective:** the seam is documented, the stale CLAUDE.md line is corrected, and the other two seams are recorded as still-guarded.

### T5.1 — Seam manifest doc + sibling mirror + CLAUDE.md fix + parity audit

#### Objective
Author `docs/architecture/theokit-sdk-integration.md` (mirrored into `../theokit-sdk/docs/architecture/`), fix the stale CLAUDE.md workspace-link line, and record the parity-audit check.

#### Why this step (action + reasoning)
1. **What this step does** — writes the seam doc (flow, ~25-symbol wire surface, typed-error cause chain, version-compat table, hardening invariants, consult-before-editing file list), mirrors it into the sibling, corrects the CLAUDE.md Ecosystem line to "npm registry; sibling links removed 2026-06-10", and records that `contract-usetheo-ui-vite-plugin.test.ts` + `services-manifest-v2.test.ts` EC-7 still pass.
2. **Why necessary now** — DoD layers 4/5; the CLAUDE.md reference to `docs/architecture/theokit-theocloud-integration.md` is dangling and the workspace-link claim is false.

#### Evidence
CLAUDE.md Ecosystem table row `@theokit/sdk` = "Workspace protocol (permanent link)"; `pnpm-workspace.yaml:19` "sibling links REMOVED (2026-06-10) … consumed via npm registry". `docs/architecture/theokit-theocloud-integration.md` absent. `Blueprint §"Baseline reality"`.

#### Files to edit
```
docs/architecture/theokit-sdk-integration.md — NEW seam manifest doc
../theokit-sdk/docs/architecture/theokit-sdk-integration.md — NEW mirror copy
CLAUDE.md — correct the @theokit/sdk "permanent workspace link" line to npm-registry reality
```

#### Deep file dependency analysis
- Doc is derived from the research symbol table + the two reference docs' structure. No code dependency. The CLAUDE.md edit touches only the one stale sentence in the Ecosystem table (preserve the rest).

#### Deep Dives
- Version-compat table: `theokit ≥ 0.42.0 → @theokit/sdk ^4.0.1` (the current supported mapping); note the `@theokit/sdk-tools ^0.11.0` floor.
- Parity audit is a RECORDED check (run the two reference tests, cite green), not new code.

#### Tasks
1. Write the seam doc following the synthesized structure.
2. Copy it into the sibling `docs/architecture/`.
3. Fix the CLAUDE.md line.
4. Run `pnpm vitest run tests/integration/contract-usetheo-ui-vite-plugin.test.ts tests/unit/services-manifest-v2.test.ts` and record the result in the doc's parity section.

#### TDD
```
RED:  (doc task — verification is the parity test run, not a unit test)
GREEN: seam doc + mirror + CLAUDE.md fix committed; parity tests green and cited
REFACTOR: None expected
VERIFY: test -f docs/architecture/theokit-sdk-integration.md && test -f ../theokit-sdk/docs/architecture/theokit-sdk-integration.md && pnpm vitest run tests/integration/contract-usetheo-ui-vite-plugin.test.ts tests/unit/services-manifest-v2.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `diff docs/architecture/theokit-sdk-integration.md ../theokit-sdk/docs/architecture/theokit-sdk-integration.md` reports no differences (both copies identical).
- [ ] `grep -c "permanent workspace link" CLAUDE.md` returns 0 for the `@theokit/sdk` row (corrected to npm-registry reality).
- [ ] `pnpm vitest run tests/integration/contract-usetheo-ui-vite-plugin.test.ts tests/unit/services-manifest-v2.test.ts` exits 0 (parity recorded in the doc).

#### DoD
- [ ] Doc (both copies) + CLAUDE.md fix + parity audit recorded.

---

## Coverage Matrix

| # | Gap / Requirement (DoD layer) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Contract test — consumer (real SDK) | T2.1 | `contract-sdk-seam.test.ts` asserts the consumed surface vs installed dist; stale proto-test deleted |
| 2 | Contract test — producer + prepublishOnly gate | T4.1 | producer mirror in `theokit-sdk` + `prepublishOnly` |
| 3 | Type-assignability gate on `CustomTool` mirror | T1.1 | `.test-d.ts` `toEqualTypeOf` on `ctx` param; mirror synced |
| 4 | Version gate — close ranges | T3.1 | `@theokit/sdk-tools` `>=0.11.0`→`^0.11.0` (`@theokit/sdk` already `^4.0.1`) |
| 5 | Version gate — fail-fast presence/semver | T3.2 | boot `assertSdkCompatible()` typed error + drift guard T2.2 |
| 6 | Version-drift guard (EC-7 analog) | T2.2 | resolved version ⊨ peer range, inline caret checker (no `semver`) |
| 7 | Seam manifest doc + sibling mirror | T5.1 | `docs/architecture/theokit-sdk-integration.md` (both repos) |
| 8 | Fix stale CLAUDE.md workspace-link line | T5.1 | corrected to npm-registry reality |
| 9 | Parity audit — theo-ui + TheoCloud seams still hold | T5.1 | recorded green run of both reference tests |
| 10 | Retire stale proto-test (`major===3`, removed classes) | T2.1 | deleted after contract test parity |
| 11 | EC-C — root hoist serves stale SDK 3.5.0 (root devDep `^3.5.0`) so root tests resolve the wrong version | T2.1, T3.1 | contract test resolves SDK consumer-scoped from `packages/theo`; root devDep bumped `^3.5.0`→`^4.0.1` |
| 12 | EC-B — type test must land where `vitest --typecheck` collects it | T1.1 | placed at `tests/type/custom-tool-mirror.test-d.ts` (existing convention) |

**Coverage: 12/12 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` (root) green
- [ ] Zero type errors — `pnpm -r exec tsc --noEmit` (incl. the `.test-d.ts` gate)
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected (per `rules/architecture.md` / G6 — ≤ 500 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved (mirror changes additive; peer close is intended guardrail)
- [ ] Plan-specific: the intentional-divergence proof (flip mirror `ctx` → `tsc` fails) demonstrated and reverted
- [ ] Plan-specific: producer `prepublishOnly` proven to run the contract test locally
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the five guarantee layers work together against the real installed SDK.

### Execution
```
pnpm test                                   # unit + integration (incl. contract-sdk-seam, sdk-compat)
pnpm -r exec tsc --noEmit                    # zero type errors incl. custom-tool-mirror.test-d.ts
pnpm lint                                    # zero warnings
# cross-repo producer gate (sibling):
(cd ../theokit-sdk && pnpm --filter @theokit/sdk build && pnpm --filter @theokit/sdk test:contract)
# failure-scenario pass:
pnpm vitest run packages/theo/src/cli/commands/start/assert-sdk-compatible.test.ts   # absent/below-floor typed errors
```

### Acceptance Criteria
- [ ] All suites green (root + sibling producer contract)
- [ ] Coverage ≥ 90% on changed files (critical: `sdk-compat.ts` 100%)
- [ ] Zero type errors (incl. the type gate)
- [ ] Zero lint warnings
- [ ] Failure scenarios exercised: SDK-absent + below-floor produce the typed errors; sibling-absent skips clean
- [ ] Parity: theo-ui contract + TheoCloud EC-7 tests green

### If Validation Fails
1. Separate plan-caused failures from pre-existing (`pnpm-11-compat` env-fail is known pre-existing).
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do NOT block.
