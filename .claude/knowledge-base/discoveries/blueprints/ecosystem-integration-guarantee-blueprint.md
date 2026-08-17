---
slug: ecosystem-integration-guarantee
milestone_id: M48
date: 2026-07-15
status: shippable
generated_by: deep-research (2 parallel agents, file:line-cited)
---

# Blueprint — Ecosystem integration guarantee (M48): FAANG-grade theokit↔@theokit/sdk seam

## Objective

Bring the `theokit ↔ @theokit/sdk` seam to the drift-guaranteed posture the `theo-ui` and TheoCloud
seams already have: a cross-repo contract test (consumer + producer), a type-assignability gate on
the local `CustomTool` mirror, a closed peer range + boot-time fail-fast, and a seam manifest doc —
plus a parity audit of the other two seams. **Don't Reinvent** — mirror the two existing patterns.

## Baseline reality (discovered 2026-07-15 — reconciles the 2026-07-14 DoD to post-SDK-4)

| DoD text (2026-07-14) | Reality now (SDK 4.0 migration merged 2026-07-15) |
|---|---|
| close `@theokit/sdk` `>=3.5.0` → `^3.5.0` | **already `^4.0.1`** in `packages/{theo,agents}` (migration did it). Nothing to do here. |
| — | `@theokit/sdk-tools` peer **still open `>=0.11.0`** in `packages/agents/package.json:36` → close to `^0.11.0`. |
| CustomTool mirror `:29` | mirror at `packages/theo/src/server/define/define-agent-tool.ts:29-48`; diverges from SDK 4.0.2 (`ctx.threadId`, `ctx.messages` missing; handler return narrower). |
| `theokit-sdk#119` intentional divergence | #119 = `ctx.threadId`; mirror lacks it — the gate's canonical divergence case. |
| mirror `theokit-theocloud-integration.md` | **that doc does NOT exist on disk** (CLAUDE.md reference is dangling) → synthesize structure from CLAUDE.md prose. |
| stale CLAUDE.md "permanent workspace link" | confirmed stale — SDK is npm-registry consumed (`pnpm-workspace.yaml:19` removed sibling links 2026-06-10). |
| — | **STALE proto-test** `tests/integration/sdk-1-1-0-exports.test.ts` hardcodes `major === 3` (`:33`) + imports `FileSystemConversationStorage`/`InMemoryConversationStorage` — **removed in SDK 4.0** → reconcile/replace. |
| — | **Version drift already live:** root hoist resolves `@theokit/sdk@3.5.0`; `packages/{theo,agents}` resolve `4.0.2`; lockfile carries 2.20.0 + 3.5.0 + 4.0.2. The exact failure M48 guards. |

## Coverage Corner 1 — Integration Tests (the reference guarantee mechanisms)

**theo-ui consumer contract** (`tests/integration/contract-usetheo-ui-vite-plugin.test.ts`):
- imports the REAL dist via `await import(pathToFileURL(UI_DIST(...)).href)` (`:119`) — no mocks (ADR-0018 §B2).
- asserts export **shape** (factory → `Plugin|Plugin[]` each with `name:string`) via `isValidPlugin`/`normalizePluginReturn` (`:35-47`).
- **EC-7 hoist guard** (`:168-190`): resolved version MUST satisfy `packages/theo/package.json:peerDependencies` range, checked by inline `||`-aware `satisfiesCaretPrerelease` (`:66-105`) — deliberately no `semver` dep.

**theo-ui producer mirror** (`theokit-tools/theokit-ui/tests/contract/theokit-consumer.test.ts` — PRESENT):
- same shape checks; `describe.skipIf(!distBuilt)` (`:49-53`); `PKG_ROOT` via `fileURLToPath(import.meta.url)` (EC-1, `:24-27`).
- publish gate: `theokit-ui/package.json` `prepublishOnly: "pnpm build && pnpm test:contract && node scripts/validate-exports.mjs"`.

**TheoCloud EC-7 schema-drift** (`tests/unit/services-manifest-v2.test.ts:62-107`): producer-emitted version(s) (`buildManifest().version`) ⊆ consumer-accepted set (from external JSON Schema SoT), with **walk-up path resolution + skip-clean-if-absent** (`:68-81`).

## Coverage Corner 2 — Dependencies (the version surface)

- `@theokit/sdk` peer `^4.0.1` (theo `:134`, agents `:35`) — optional peer + `peerDependenciesMeta.optional` (correct, keep as range SoT / DRY).
- `@theokit/sdk-tools` peer `>=0.11.0` (agents `:36`) — **close to `^0.11.0`**.
- No new runtime dep. The contract/drift tests reuse the inline caret checker (no `semver`).
- Installed: theo/agents → 4.0.2; root hoist → 3.5.0; lockfile has 2.20.0/3.5.0/4.0.2 (transitive from create-theokit templates / older fixtures).

## Coverage Corner 3 — Tools

- **vitest** (already the runner) for the contract test + `vitest`'s `expectTypeOf` for the `.test-d.ts` type gate (type tests run under `vitest --typecheck` / `tsc`).
- **prepublishOnly** (pnpm/npm lifecycle) for the producer publish gate — the ONLY way to run the producer test given `theokit-sdk` GH Actions is billing-blocked (mirror theo-ui).
- No new tooling. `publint`/`attw` already in the ecosystem if needed for exports validation (theo-ui pattern) — out of scope unless trivial.

## Coverage Corner 4 — Techniques (the recipe to replicate)

1. **Consumer contract test** `tests/integration/contract-sdk-seam.test.ts`: `await import('@theokit/sdk')` against real installed dist; assert `Agent.getOrCreate` shape, `Tool.create`→`CustomTool`, the `send({onDelta})` `InteractionUpdate` discriminants theokit consumes (`text-delta`/`thinking-delta`/`tool-call-started`/`partial-tool-call`/`tool-call-completed` — `event-translator.ts:181-222`), + `AgentRunError` shape. Fold in / replace the stale `sdk-1-1-0-exports.test.ts` (reconcile `major===3`→`^4.0.1`; drop removed storage-class imports).
2. **Version-drift guard** (EC-7 analog) inside the contract test: resolved `@theokit/sdk/package.json:version` MUST satisfy `packages/theo/package.json:peerDependencies["@theokit/sdk"]`, using a copied inline `||`-aware caret checker (no `semver` dep). Also guard `@theokit/sdk-tools`.
3. **Type-assignability gate** `*.test-d.ts`: assert the local `CustomTool` mirror's `ctx` param **equals** the SDK's — `expectTypeOf<Parameters<Sdk.CustomTool['handler']>[1]>().toEqualTypeOf<Parameters<Local.CustomTool['handler']>[1]>()`. NOTE (critical): a one-directional `toMatchTypeOf` on the whole interface is **too weak** (contravariance makes the narrower mirror assignable). The `ctx`-param `toEqualTypeOf` is what fails on the missing `ctx.threadId`/`ctx.messages`. → M48 also **updates the mirror to add `threadId?`/`messages?`** so the gate is GREEN, then a fixture divergence proves it fails on drift.
4. **Boot-time fail-fast** `assertSdkCompatible()` invoked from `packages/theo/src/cli/commands/start/bootstrap-stages.ts:31-41` (already imports SDK at boot, currently swallows with `.catch(()=>null)`): resolve `@theokit/sdk/package.json` version, check `^4.0.1`, throw a **typed** error (found-vs-required) — turning the per-request lazy `SDK_NOT_INSTALLED` (`sdk-adapter.ts:509-516`) into a loud boot failure. Keep the lazy event too (defense in depth for the request path).
5. **Producer mirror** in `theokit-tools/theokit-sdk/packages/sdk/tests/contract/theokit-consumer.test.ts` + wire `test:contract` + `prepublishOnly` into that package.json (**currently NEITHER exists** — the biggest missing guarantee).
6. **Seam doc** `docs/architecture/theokit-sdk-integration.md` (structure synthesized from CLAUDE.md prose): flow diagram, wire/contract surface (~25 symbols), typed-error cause chain (`AgentRunError`), version-compat table, hardening invariants, "consult-before-editing" file list; mirror into `theokit-sdk/docs/architecture/` (same "edit one, diff the other" rule). Fix the stale CLAUDE.md workspace-link line.
7. **Parity audit** (breadth): the seam doc records that `contract-usetheo-ui-vite-plugin.test.ts` (theo-ui) + `services-manifest-v2.test.ts` EC-7 (TheoCloud) still pass — all three seams accounted for.

## ADRs

### D1 — Reuse the theo-ui consumer+producer+prepublishOnly recipe verbatim (Don't Reinvent, rung 4)
Alternatives: (a) bespoke SDK-specific test harness — rejected, reinvents a proven pattern; (b) rely only on tsc — rejected, doesn't catch runtime export-shape drift. Chosen: copy the theo-ui recipe (shape helpers, `skipIf(!distBuilt)`, `fileURLToPath` PKG_ROOT, inline caret checker, prepublishOnly gate).

### D2 — Type gate uses `toEqualTypeOf` on the `ctx` param, not `toMatchTypeOf` on the interface
Alternatives: (a) `toMatchTypeOf<Local>().<Sdk>()` — rejected as TOO WEAK (contravariant handler param makes a narrower mirror assignable; would NOT catch missing `ctx.threadId`). Chosen: `toEqualTypeOf` on `Parameters<handler>[1]`.

### D3 — Update the local CustomTool mirror to add `ctx.threadId?`/`ctx.messages?` (close #119 drift) so the gate is GREEN
The mirror is deliberately hand-maintained (keeps `@theokit/sdk` an optional peer — no value import). M48 syncs it to SDK 4.0.2 + adds the type gate that keeps it synced. Alternative: `type CustomTool = import('@theokit/sdk').CustomTool` — rejected, would make the type a hard SDK dependency (breaks optional-peer, and the mirror carries the theokit-only `transform` field).

### D4 — Boot-time `assertSdkCompatible()` in bootstrap-stages, keep the lazy request-path event
Alternative: replace the lazy event entirely — rejected (the request path still needs a graceful error if the SDK is dlopen-failed post-boot). Chosen: fail-fast at boot AND keep the lazy `SDK_NOT_INSTALLED` (defense in depth).

### D5 — Producer test runs via prepublishOnly (local), not GH Actions
Forced by reality: `theokit-sdk` CI is billing-blocked. Mirrors theo-ui. Alternative: a remote workflow — rejected, never runs.

## Key reusable code lessons (copy, don't rewrite)
`isValidPlugin`/`normalizePluginReturn` shape helpers; inline `||`-aware `satisfiesCaretPrerelease` (no `semver` dep); `fileURLToPath(import.meta.url)` PKG_ROOT (EC-1); `describe.skipIf(!distBuilt)`; walk-up-candidate-paths + early-return-skip cross-repo SoT resolution.

## What this blueprint hands to /to-plan
The 7-technique recipe above maps 1:1 to the 5 DoD layers (contract test = #1/#2/#5; type gate = #3; version gate + fail-fast = #2/#4; seam doc = #6; parity audit = #7). Every layer has a named reference implementation to mirror. No external SOTA needed — references are the two internal FAANG-grade seams.
