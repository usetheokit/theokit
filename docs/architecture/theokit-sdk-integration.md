# TheoKit ↔ `@theokit/sdk` integration seam

Canonical manifest for the `theokit ↔ @theokit/sdk` seam — the load-bearing one, since `@theokit/sdk`
is the **only** agent runtime (per `.claude/rules/sdk-runtime.md` / G2). This doc mirrors the structure
of the TheoCloud integration manifest and is **mirrored into** `../theokit-sdk/docs/architecture/theokit-sdk-integration.md`
(the sibling copy) — edit one, copy the diff to the other in the same change.

> **Consult this doc BEFORE editing** any seam file listed under § Consult-before-editing.

## 1 — How the two connect (end-to-end)

`@theokit/sdk` is consumed as an **optional, published npm peer** (NOT a workspace link — sibling links
were removed 2026-06-10; `pnpm-workspace.yaml` does not include `../theokit-sdk/`). TheoKit's
`@theokit/agents` bridge (`packages/agents/src/bridge/*`) compiles the `@Agent`/builder metadata into the
SDK's shape and drives the runtime via a **dynamic import** (`loadSdkRuntime()`), so an app that never
mounts an agent (api-only) needs no SDK installed. The seam is therefore a set of ~25 imported symbols +
one dynamic import — a surface that can silently drift when the SDK evolves. M48 closes that with four
guarantee layers (§ 4).

```
agents/<name>.ts  ──build/compile──▶  @theokit/agents bridge (compile-*, sdk-adapter)
                                             │  await import('@theokit/sdk')  (loadSdkRuntime)
                                             ▼
                                     @theokit/sdk runtime
                                     Agent.getOrCreate → send → stream()/wait()
                                     Tool.create · SkillReadTool.create · Retry.create
                                     native .jsonl transcript (SE40, SDK-owned persistence)
```

## 2 — Wire / contract surface (what theokit binds)

Runtime **value** binds (dynamic) — the drift-critical set the contract test pins:

| Symbol | Module | Consumed at | Used for |
|---|---|---|---|
| `Agent.getOrCreate` | `@theokit/sdk` | `agents/src/bridge/sdk-adapter.ts:635` | create/resume a run by `sessionId` |
| `Agent.registry.{configure,evictAll}` | `@theokit/sdk` | `theo/src/cli/commands/start/{bootstrap-stages,graceful-shutdown}.ts` | boot config + shutdown eviction |
| `Tool.create` | `@theokit/sdk` | `agents/src/bridge/sdk-adapter.ts:208,457` | build a `CustomTool` from a Zod spec |
| `SkillReadTool.create` | `@theokit/sdk` | `agents/src/bridge/sdk-adapter.ts:203,209` | inline-skill read tool (guarded with `in`) |
| `Retry.create` | `@theokit/sdk/retry` | `agents/src/loop/run-reflective-loop.ts:382` | wrap the stream open with retry |
| `compactTranscript` | `@theokit/sdk/compaction` | `agents/src/loop/compaction-strategy.ts` | token-budget compaction |
| `readProjectInstructions` | `@theokit/sdk/project` | `agents/src/bridge/compile-project-context.ts` | THEO.md read |
| `buildEnvContext`, `buildRepoMap` | `@theokit/sdk-tools` | `agents/src/bridge/compile-project-context.ts` | `@ProjectContext` resolver |

Type-only binds (~16, erased at runtime, keep the SDK an optional peer): `AgentDefinition`, `BudgetTracker`,
`CustomTool`, `InlineSkill`, `InteractionUpdate`, `Plugin`, `PluginsSettings`, `ProviderRoutingSettings`,
`SendOptions`, `SystemPromptResolver`, `ContextSettings`, `SkillsSettings`, `SettingSource`, `ModelSelection`,
`RetryOptions`, `CompressibleMessage`. The **local `CustomTool` mirror**
(`packages/theo/src/server/define/define-agent-tool.ts`) is hand-maintained (so the type compiles without the
SDK installed) and kept in sync by the § 4 type gate.

`send({ onDelta })` → `InteractionUpdate` discriminants theokit translates (`agents/src/bridge/event-translator.ts:181-222`):
`text-delta` · `thinking-delta` · `tool-call-started` · `partial-tool-call` · `tool-call-completed` (5 of the SDK's 15).

## 3 — Typed-error cause chain

- Missing/incompatible SDK at **boot** → `SdkIncompatibleError` (`code: 'SDK_INCOMPATIBLE'`, names found-vs-required) — `theo/src/cli/commands/start/assert-sdk-compatible.ts`.
- Missing SDK at **first request** → stream `{ type: 'error', code: 'SDK_NOT_INSTALLED' }` — `agents/src/bridge/sdk-adapter.ts:509`.
- SDK run failure → the SDK's `AgentRunError` / `ToolError` / `TheokitAgentError` surface through the bridge.

## 4 — The four guarantee layers (M48 hardening invariants)

| # | Layer | Where |
|---|---|---|
| 1 | **Consumer contract test** vs the REAL installed SDK (consumer-scoped resolution from `packages/theo`, no mocks) | `tests/integration/contract-sdk-seam.test.ts` |
| 2 | **Producer contract test** in the SDK repo, gated by `prepublishOnly` (a break blocks publish) | `../theokit-sdk/packages/sdk/tests/theokit-consumer-contract.test.ts` |
| 3 | **Type-assignability gate** — the local `CustomTool` mirror's handler `ctx` is `toEqualTypeOf` the SDK's; return is `toExtend` (mirror ⊆ SDK) | `tests/type/custom-tool-mirror.test-d.ts` |
| 4 | **Version gate** — closed peer ranges (`@theokit/sdk ^4.0.1`, `@theokit/sdk-tools ^0.11.0`) + a boot-time semver fail-fast + a contract-test drift guard | `packages/{theo,agents}/package.json`, `assert-sdk-compatible.ts`, `sdk-compat.ts` |

The range single-source-of-truth is the `package.json` peer floor; `SUPPORTED_SDK_RANGE` in `sdk-compat.ts`
mirrors it. Install-time gate (peer range) + runtime gate (boot check) + CI gate (contract + type tests) are
independent layers — none replaces another.

## 5 — Version-compatibility table

| theokit | requires `@theokit/sdk` | `@theokit/sdk-tools` |
|---|---|---|
| ≥ 0.42.0 | `^4.0.1` | `^0.11.0` |

A future SDK major is a **conscious** theokit bump (the SE36 → 3.x / SE40 → 4.x precedents): close the new
range, sync the `CustomTool` mirror until the type gate is green, update this table. Known drift to watch:
`fixtures/template-default` still pins `@theokit/sdk ^2.20.0` (scaffold-template bump is a separate follow-up).

## 6 — Consult-before-editing

`packages/theo/src/server/define/define-agent-tool.ts` (the `CustomTool` mirror) ·
`packages/theo/src/server/agent/sdk-compat.ts` (range SoT) ·
`packages/theo/src/cli/commands/start/assert-sdk-compatible.ts` (boot fail-fast) ·
`packages/agents/src/bridge/sdk-adapter.ts` (`loadSdkRuntime` + the bound surface) ·
`packages/{theo,agents}/package.json` (peer ranges) ·
`tests/integration/contract-sdk-seam.test.ts` + `tests/type/custom-tool-mirror.test-d.ts` (the gates) ·
`../theokit-sdk/packages/sdk/tests/theokit-consumer-contract.test.ts` (the producer mirror).

## 7 — Parity audit (all three ecosystem seams accounted for)

Recorded 2026-07-15 — the other two seams' guards still hold:

- **`@theokit/ui` seam:** `tests/integration/contract-usetheo-ui-vite-plugin.test.ts` — PASS (6 checks incl. the EC-7 hoist guard).
- **TheoCloud seam:** `tests/unit/services-manifest-v2.test.ts` EC-7 (schema-version drift) — PASS.
- **`@theokit/sdk` seam:** the four layers above — PASS (this milestone).

All three seams now have a cross-repo contract + a version/drift guard; none reinvents the runtime.
