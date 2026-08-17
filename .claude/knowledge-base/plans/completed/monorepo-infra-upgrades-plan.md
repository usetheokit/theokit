# Plan: Monorepo Infrastructure Upgrades — Zod v4 + Turborepo + DTS Fix

> **Version 1.1** (2026-06-10) — Absorbed 5 edge cases from
> [`reviews/monorepo-infra-upgrades-edge-cases-2026-06-10.md`](../reviews/monorepo-infra-upgrades-edge-cases-2026-06-10.md).
> **2 MUST FIX absorbed inline:** EC-1 (`llm-runner.ts` has its own `._def.typeName`
> converter — added T1.3b to migrate it), EC-2 (`packages/theo/tsconfig.json` does NOT
> extend root — `stripInternal` must be added to BOTH tsconfigs). **2 SHOULD TEST
> added:** EC-3 (`additionalProperties:false` in `z.toJSONSchema()` output — test in
> T1.2), EC-4 (turbo `test` task requires script in each package.json — verify in T2.1).
> **1 DOCUMENT acknowledged:** EC-5 (`z.ZodType` generic parameter change — low risk,
> covered by T1.4).
>
> **Version 1.0** (2026-06-10) — Três melhorias de infraestrutura: (1) migrar Zod v3→v4 eliminando `zod-to-json-schema` e usando `z.toJSONSchema()` nativo, (2) adicionar Turborepo para builds incrementais com cache, (3) corrigir DTS build para packages com `@internal` JSDoc. Sem backward compatibility — sistema sem usuários externos.

## Goal

> Migrate the TheoKit monorepo to Zod v4, add Turborepo for cached incremental builds, and fix DTS emission for `@internal` symbols, measured by `npx turbo run build test typecheck` returning exit 0 with all 387+ tests GREEN and `zod-to-json-schema` removed from all `package.json` files.

## Context

CTO decision: investimento de infraestrutura independente de dor imediata. Três itens:

1. **Zod v4** — Zod 4.4.3 é latest stable. O monorepo usa v3.25.76 (pinned via pnpm override). Único uso de `zod-to-json-schema` é em `define-agent-tool.ts:2`. Zod v4 tem `z.toJSONSchema()` nativo — elimina 1 dependência. O converter `zod-to-openapi.ts` usa `._def.typeName` internals que mudaram no v4.

2. **Turborepo** — 4 packages buildáveis (theo, agents, http-decorators, create-theo). Builds são rápidos hoje (~15s cold) mas sem cache — rebuild total sempre. Turbo adiciona cache local (warm: ~6s) e prepara para remote cache em CI.

3. **DTS @internal** — `stripInternal` não está setado em nenhum tsconfig. 15 ocorrências de `@internal` JSDoc (todas test helpers como `__resetForTests()`) vazam nos `.d.ts` publicados.

**Evidência:** Audit explorers rodados nesta sessão confirmaram: 1 versão Zod resolvida, 0 erros de tipos atuais, `_def` introspection em 20+ linhas do converter, turbo.json inexistente, `stripInternal` absent.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `package.json` | 105 | `1964636` (2026-06-09) | Root workspace manifest + pnpm overrides | pnpm workspace protocol; scripts structure |
| `packages/theo/package.json` | 160 | `e7a98af` (2026-06-06) | Core framework manifest | exports map; peerDeps contract |
| `packages/agents/package.json` | 45 | `e0228e5` (2026-06-10) | Agent decorators manifest | peerDeps on zod + http-decorators |
| `packages/http-decorators/package.json` | 57 | `e0228e5` (2026-06-10) | HTTP decorators manifest | peerDeps on zod + theokit |
| `packages/create-theo/package.json` | 24 | `e0228e5` (2026-06-10) | Scaffold CLI manifest | No zod dep (template only) |
| `packages/theo/src/server/define/define-agent-tool.ts` | 142 | `b5af873` (2026-06-03) | Wraps SDK `defineTool` with Zod→JSON Schema conversion | `zodToJsonSchema()` call at L124 |
| `packages/theo/src/vite-plugin/openapi-emit/zod-to-openapi.ts` | 257 | `d6cbb42` (2026-06-02) | In-house Zod→OpenAPI converter using `._def` introspection | Handles 15+ Zod type names via switch |
| `packages/agents/src/bridge/llm-runner.ts` | 207 | `e0228e5` (2026-06-10) | Real LLM runner with own `._def.typeName` Zod→JSON Schema converter (EC-1) | `convertZodToJsonSchema()` at L176 uses `._def` |
| `fixtures/demo-faang/server/llm-agent-runner.ts` | ~207 | `e0228e5` (2026-06-10) | Fixture copy of LLM runner with same `._def` converter | Same pattern as llm-runner.ts |
| `packages/theo/tsup.config.ts` | 88 | `e7a98af` (2026-06-06) | Build config (29 entries, dts:true) | Multi-entry structure |
| `packages/agents/tsup.config.ts` | 14 | `8ca8411` (2026-06-10) | Build config (3 entries, dts:true) | — |
| `packages/http-decorators/tsup.config.ts` | 11 | `e0228e5` (2026-06-10) | Build config (4 entries, dts:true) | — |
| `tsconfig.json` | ~30 | `1964636` (2026-06-09) | Root TypeScript config | strict:true; paths; noEmit |
| `turbo.json` (NEW) | 0 | — | Turborepo config | — |
| `packages/theo/tsconfig.json` | ~15 | `e7a98af` (2026-06-06) | Package TS config | strict:true |
| `packages/agents/tests/unit/*.test.ts` | ~15 files | `8ca8411` (2026-06-10) | Agent tests using z.object/z.string | Test assertions don't check error messages |
| `packages/http-decorators/tests/**/*.test.ts` | ~9 files | `e0228e5` (2026-06-10) | Decorator tests with safeParse | No Zod message assertions found |
| `packages/create-theo/templates/default/package.json.tmpl` | 21 | `e0228e5` (2026-06-10) | Template package.json for scaffolded projects | zod version in deps |
| `packages/create-theo/templates/default/server/toolboxes/task.tools.ts` | ~58 | `e0228e5` (2026-06-10) | Template using Zod schemas | z.object/z.string patterns |
| `packages/create-theo/templates/default/server/controllers/tasks.controller.ts` | ~70 | `e0228e5` (2026-06-10) | Template using @Body(zodSchema) | safeParse pattern |

### Current callers / dependents

- **Symbol:** `zodToJsonSchema()` in `define-agent-tool.ts:124`
  - **Callers (production):** Only this file
  - **Callers (tests):** `tests/unit/define-agent-tool.test.ts` (if exists)
  - **External:** No — internal to theokit package

- **Symbol:** `._def.typeName` pattern in `zod-to-openapi.ts`
  - **Callers (production):** Called from `emit.ts` in the same directory
  - **Callers (tests):** OpenAPI emit tests
  - **External:** No

- **Symbol:** `z.object`, `z.string`, `safeParse` across all packages
  - **Callers:** 52 source files, 17 test files
  - **External:** Consumer apps use Zod directly — we change our peerDep range

### Domain glossary

- **pnpm override** — forces a single version of a dep across all workspace packages
- **DTS** — TypeScript declaration files (`.d.ts`) emitted by tsup or tsc
- **stripInternal** — TypeScript compiler option that removes `@internal`-tagged symbols from `.d.ts`
- **turbo task** — a build/test/typecheck command cached by Turborepo based on input file hashes

### Architecture boundaries affected

- **No new module** — all changes are infrastructure (package.json, tsconfig, build tooling)
- **Zod conversion** touches `server/define/` and `vite-plugin/openapi-emit/` — both within `packages/theo/src/` (allowed per architecture.md v3)
- **Turborepo** is root-level tooling — no architectural boundary crossed

## Prior Art & Related Work

- **Zod v4 migration guide** — official Zod docs document breaking changes (z.toJSONSchema, `._def` renamed to `._zod`, error message format changes)
- **Zod v4 `./v3` compat export** — Zod v4 ships a `zod/v3` subpath for gradual migration (NOT used here — we do full migration since no users)
- **Turborepo docs** — standard monorepo cache config with `inputs`/`outputs`/`dependsOn`

(none identified in `knowledge-base/discoveries/blueprints/` for these topics)

## Objective

- [x] Remove `zod-to-json-schema` dependency — replaced by native `z.toJSONSchema()` from Zod v4
- [ ] Update all `package.json` to declare `zod: ^4.0.0`
- [ ] Adapt `zod-to-openapi.ts` converter from `._def.typeName` to Zod v4 introspection API
- [ ] Adapt `define-agent-tool.ts` from `zodToJsonSchema()` to `z.toJSONSchema()`
- [ ] Add `turbo.json` with cached build/test/typecheck tasks
- [ ] Update root scripts to use `turbo run`
- [ ] Enable `stripInternal: true` in tsconfig and verify DTS output
- [ ] All 387+ tests GREEN after migration

## ADRs

### D1 — Full Zod v4 migration (not gradual via `zod/v3`)

**Decision:** Migrate fully to Zod v4 API. Do not use the `zod/v3` compatibility export.

**Rationale:** No external users means zero backward compat cost. `zod/v3` adds complexity (two Zod APIs in the codebase) without benefit. KISS (Princípio 10).

**Alternatives considered:**
- *Gradual migration via `zod/v3` import* — rejected: doubles the API surface; no users to protect; cleanup debt accumulates.

**Consequences:** All Zod imports stay as `from 'zod'`. Templates must also use v4. Any future consumer starts with v4 from day 1.

### D2 — Replace `._def` introspection with Zod v4 public API

**Decision:** Rewrite `zod-to-openapi.ts` to use Zod v4's public introspection API (`z.toJSONSchema()` for simple cases; `schema._zod.def` for advanced type discrimination) instead of private `._def.typeName`.

**Rationale:** `._def` was private API in Zod v3; in v4, the internal structure changed to `._zod`. Using the public `toJSONSchema()` wherever possible reduces coupling to internals. Per DRY (Princípio 12) — Zod v4 already ships JSON Schema conversion.

**Alternatives considered:**
- *Keep `._def` pattern with v4's `._zod` rename* — rejected: still coupled to internals; brittle on patch updates.
- *Delete `zod-to-openapi.ts` entirely and use `z.toJSONSchema()` in the OpenAPI emitter* — considered viable; may simplify 257 LoC to ~50. Preferred if v4's output covers all our switch cases.

**Consequences:** The 15-case switch in `zod-to-openapi.ts` may shrink dramatically or be deleted entirely if `z.toJSONSchema()` covers all cases. Test coverage must verify all 15 Zod types still produce correct OpenAPI output.

### D3 — Turborepo with local cache only

**Decision:** Add Turborepo with local `.turbo/` cache. No remote cache setup.

**Rationale:** Local cache gives 6s warm builds (vs 15s cold). Remote cache adds infra complexity (Vercel account or self-hosted) — YAGNI until CI becomes a bottleneck.

**Alternatives considered:**
- *Nx instead of Turbo* — rejected: heavier setup, more config, Turbo is zero-config for standard pnpm workspaces.
- *No build orchestrator* — rejected: CTO explicitly requested this.

**Consequences:** `.turbo/` added to `.gitignore`. `pnpm build` becomes `turbo run build`. CI pipeline gains cache hits on unchanged packages.

### D4 — `stripInternal: true` at root tsconfig

**Decision:** Enable `stripInternal: true` in root `tsconfig.json`. All `@internal` JSDoc symbols are stripped from `.d.ts` output.

**Rationale:** 15 `@internal` test helpers (`__resetForTests()`, etc.) currently leak into published types. This violates ISP (Princípio 13.4) — consumers see methods they should never call.

**Alternatives considered:**
- *Remove `@internal` JSDoc and rename to `_private` convention* — rejected: `@internal` is the TS-native mechanism; renaming loses IDE integration.

**Consequences:** Test helpers become invisible in published `.d.ts`. Tests still access them via direct import (not through the barrel).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Zod v4 `._def` → `._zod` breaks the OpenAPI converter silently (wrong output, not crash) | High | Comprehensive test suite for all 15 Zod types; compare v3 vs v4 JSON Schema output side-by-side | Dev |
| `z.toJSONSchema()` output differs from `zod-to-json-schema` (extra `$schema`, `additionalProperties:false`) | Medium | Normalize output in tests; strip `$schema` if SDK doesn't expect it | Dev |
| Turborepo cache invalidation misses a file (stale build) | Low | Conservative `inputs` globs; `turbo clean` as escape hatch | Dev |
| `stripInternal` hides symbols that some internal test file imports via barrel | Medium | Tests import directly from source file, not barrel. Verify no test breaks after enabling. | Dev |

## Unresolved Questions

(none — every decision is resolved at plan time. Zod v4 is stable at 4.4.3. Turbo config is deterministic. `stripInternal` behavior is well-documented.)

## Dependency Graph

```
Phase 1 (Zod v4) ──▶ Phase 2 (Turbo) ──▶ Phase 3 (DTS) ──▶ Phase 4 (Integration)
```

All phases are sequential — Phase 1 changes deps that Phase 2's turbo needs to build, and Phase 3 validates DTS after both are in place.

---

## Phase 1: Zod v3 → v4 Migration

**Objective:** Replace Zod v3 with v4 across all packages, eliminate `zod-to-json-schema` dependency, adapt code to v4 API.

### T1.1 — Update all package.json Zod declarations

#### Objective
Bump Zod to v4 in root override, all peerDeps, all devDeps, and template files.

#### Why this step (action + reasoning)

**Action:** Update 5 package.json files (root + 4 packages) and 1 template file to declare `zod@^4.0.0`. Remove `zod-to-json-schema` from `packages/theo/package.json` dependencies.

**Reasoning:** This is the foundation — all subsequent tasks depend on Zod v4 being resolvable. Per D1, we do full migration. The pnpm override ensures a single resolved version. Template must match so scaffolded projects start on v4.

#### Evidence
- Root `package.json` has `"zod": "3.25.76"` in overrides (L105 area)
- `packages/theo/package.json` has `"zod-to-json-schema": "^3.24.0"` in deps
- All peer deps declare `^3.22.0` or `^3.24.0` or `^3.25.0`
- `packages/create-theo/templates/default/package.json.tmpl` has `"zod": "^3.22.0"`

#### Files to edit
```
package.json — update pnpm.overrides.zod to "^4.0.0", update devDeps zod to "^4.0.0"
packages/theo/package.json — peerDeps zod→"^4.0.0", remove zod-to-json-schema from deps
packages/agents/package.json — peerDeps + devDeps zod→"^4.0.0"
packages/http-decorators/package.json — peerDeps + devDeps zod→"^4.0.0"
packages/create-theo/templates/default/package.json.tmpl — deps zod→"^4.0.0"
```

#### Deep file dependency analysis
- `package.json` — root manifest. Override controls resolved version for entire workspace. Changing override triggers `pnpm install` which re-resolves all Zod imports.
- `packages/theo/package.json` — removing `zod-to-json-schema` means `define-agent-tool.ts` will fail to import it (fixed in T1.2).
- Template `package.json.tmpl` — scaffolded projects get v4 from day 1.

#### Deep Dives
- pnpm override `"zod": "^4.0.0"` resolves to latest stable (4.4.3 today)
- `^4.0.0` range allows patch/minor updates automatically

#### Tasks
1. Edit root `package.json`: set `pnpm.overrides.zod` to `"^4.0.0"`, update `devDependencies.zod` to `"^4.0.0"`
2. Edit `packages/theo/package.json`: set `peerDependencies.zod` to `"^4.0.0"`, delete `dependencies["zod-to-json-schema"]`
3. Edit `packages/agents/package.json`: set `peerDependencies.zod` and `devDependencies.zod` to `"^4.0.0"`
4. Edit `packages/http-decorators/package.json`: set `peerDependencies.zod` and `devDependencies.zod` to `"^4.0.0"`
5. Edit `packages/create-theo/templates/default/package.json.tmpl`: set `dependencies.zod` to `"^4.0.0"`
6. Run `pnpm install` to re-resolve

#### TDD
```
RED:     test_zod_v4_resolved() — assert `require('zod').version` starts with '4.'
GREEN:   Run pnpm install after package.json edits
REFACTOR: None expected
VERIFY:  node -e "console.log(require('zod').version)"
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm ls zod` shows single version starting with `4.`
- [ ] `zod-to-json-schema` no longer in any package.json
- [ ] `pnpm install` exits 0 with no peer dep warnings for zod
- [ ] Pass: lint — `npx eslint package.json` zero warnings
- [ ] Pass: size — all package.json ≤ 500 lines

#### DoD
- [ ] All package.json updated
- [ ] `pnpm install` exit 0
- [ ] `node -e "console.log(require('zod').version)"` prints `4.x.x`

---

### T1.2 — Migrate define-agent-tool.ts from zod-to-json-schema to z.toJSONSchema()

#### Objective
Replace the `zodToJsonSchema()` import with Zod v4's native `z.toJSONSchema()`.

#### Why this step (action + reasoning)

**Action:** Remove `import { zodToJsonSchema } from 'zod-to-json-schema'` and replace the call at L124 with Zod v4's built-in `z.toJSONSchema(schema)`.

**Reasoning:** Per D2, Zod v4 ships JSON Schema conversion natively. The external dep is now redundant. The call site is a single function (`zodToJsonSchema(spec.inputSchema, { ...opts })`). The v4 equivalent is `z.toJSONSchema(spec.inputSchema)`. Output format may differ slightly (`$schema` field, `additionalProperties`).

#### Evidence
- `define-agent-tool.ts:2` — `import { zodToJsonSchema } from 'zod-to-json-schema'`
- `define-agent-tool.ts:124` — `const rawSchema = zodToJsonSchema(spec.inputSchema, { ... })`
- Zod v4 API: `import { z } from 'zod'; z.toJSONSchema(schema)`

#### Files to edit
```
packages/theo/src/server/define/define-agent-tool.ts — replace zodToJsonSchema import+call with z.toJSONSchema
```

#### Deep file dependency analysis
- `define-agent-tool.ts` — 142 LoC. Wraps SDK's `defineTool`. Only caller of `zodToJsonSchema`. After change, no file imports `zod-to-json-schema`.
- Downstream: any test of `defineAgentTool` must pass with v4 JSON Schema output.

#### Deep Dives
- v4 `z.toJSONSchema(schema)` returns JSON Schema draft-07 with `$schema` key
- v3 `zodToJsonSchema(schema, {target:'jsonSchema7'})` returns similar but without `$schema`
- Difference: v4 may add `additionalProperties: false` by default on objects
- SDK `defineTool` sends the schema to LLM providers — `$schema` field is harmless (ignored by LLM APIs)

#### Pseudo-code / Signatures

```typescript
// BEFORE (Zod v3)
import { zodToJsonSchema } from 'zod-to-json-schema'
const rawSchema = zodToJsonSchema(spec.inputSchema, { target: 'jsonSchema7', $refStrategy: 'none' })

// AFTER (Zod v4)
import { z } from 'zod'
const rawSchema = z.toJSONSchema(spec.inputSchema)
```

#### Tasks
1. Remove `import { zodToJsonSchema } from 'zod-to-json-schema'` (L2)
2. Add `import { z } from 'zod'` if not already present (check type-only import exists at L1)
3. Replace `zodToJsonSchema(spec.inputSchema, { ... })` with `z.toJSONSchema(spec.inputSchema)`
4. Remove `$schema` from output if downstream code doesn't expect it (check SDK contract)

#### TDD
```
RED:     test_define_agent_tool_json_schema_v4() — assert output schema has correct properties for a z.object({name: z.string()}) input
RED:     test_toJSONSchema_additional_properties_accepted() — (EC-3) assert z.toJSONSchema() output for z.object is accepted by LLM APIs even if it includes additionalProperties:false
GREEN:   Implement the z.toJSONSchema() replacement
REFACTOR: Remove dead zodToJsonSchema options (target, $refStrategy)
VERIFY:  cd packages/theo && npx vitest run tests/unit/define-agent-tool.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `zodToJsonSchema` import removed
- [ ] `z.toJSONSchema()` produces valid JSON Schema for all tool input schemas
- [ ] No `zod-to-json-schema` in any import statement
- [ ] Pass: lint — `npx eslint packages/theo/src/server/define/define-agent-tool.ts` zero warnings
- [ ] Pass: size — file ≤ 500 lines

#### DoD
- [ ] Tests pass — `cd packages/theo && npx vitest run`
- [ ] Zero type errors — `npx tsc --noEmit`

---

### T1.3 — Migrate zod-to-openapi.ts converter from ._def to Zod v4 API

#### Objective
Rewrite the OpenAPI converter to use Zod v4's public introspection or replace entirely with `z.toJSONSchema()`.

#### Why this step (action + reasoning)

**Action:** The 257-line converter uses `._def.typeName` (private Zod v3 API) in a 15-case switch. Zod v4 renamed internals (`._def` → `._zod`). Instead of patching the private API access, replace the converter with Zod v4's `z.toJSONSchema()` + OpenAPI 3.0 adapter layer.

**Reasoning:** Per D2, coupling to internal Zod structure is fragile. Zod v4's `z.toJSONSchema()` handles all standard types natively. We only need a thin OpenAPI 3.0 wrapper (JSON Schema → OpenAPI differences: `nullable` handling, `$ref` strategy). This reduces 257 LoC to ~80 LoC.

#### Evidence
- `zod-to-openapi.ts:101-102` — `const def = (schema as unknown as { _def: { typeName?: string } })._def`
- 15 type names handled: ZodString, ZodNumber, ZodBoolean, ZodLiteral, ZodEnum, ZodArray, ZodObject, ZodUnion, ZodDiscriminatedUnion, ZodOptional, ZodNullable, ZodEffects, ZodDefault, ZodLazy, ZodRecord
- Zod v4 `z.toJSONSchema()` handles all of these natively

#### Files to edit
```
packages/theo/src/vite-plugin/openapi-emit/zod-to-openapi.ts — rewrite: replace ._def switch with z.toJSONSchema() + OpenAPI adapter
```

#### Deep file dependency analysis
- `zod-to-openapi.ts` — 257 LoC. Called by `emit.ts` in same directory. The `convert()` function is the only export used.
- `emit.ts` calls `convert(zodSchema)` and expects an OpenAPI 3.0 schema object (no `$schema`, `$ref` inlined, `nullable: true` for ZodNullable)
- Downstream: OpenAPI spec generation for Vite plugin dev tools

#### Deep Dives
- JSON Schema (z.toJSONSchema output) vs OpenAPI 3.0 differences:
  - JSON Schema uses `type: ["string", "null"]` for nullable; OpenAPI 3.0 uses `nullable: true`
  - JSON Schema may add `$schema` and `$ref` — OpenAPI 3.0 inlines definitions
- Adapter layer: post-process `z.toJSONSchema()` output to normalize for OpenAPI 3.0
- Edge case: ZodEffects/ZodTransform — z.toJSONSchema may return `{}` (any) for these since they're runtime-only

#### Pseudo-code / Signatures

```typescript
import { z } from 'zod'

export function convert(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema)
  return toOpenApi3(jsonSchema)
}

function toOpenApi3(js: Record<string, unknown>): Record<string, unknown> {
  // Remove $schema (not valid in OpenAPI 3.0)
  const { $schema, ...rest } = js
  // Convert nullable pattern: type:["string","null"] → type:"string", nullable:true
  if (Array.isArray(rest.type) && rest.type.includes('null')) {
    rest.type = rest.type.filter(t => t !== 'null')
    if (rest.type.length === 1) rest.type = rest.type[0]
    rest.nullable = true
  }
  // Recurse into properties, items, anyOf
  if (rest.properties) { /* recurse */ }
  if (rest.items) { /* recurse */ }
  return rest
}
```

#### Tasks
1. Replace the entire `convert()` function with `z.toJSONSchema()` + `toOpenApi3()` adapter
2. Remove all `._def` introspection code
3. Keep the same export signature (`convert(schema: z.ZodType): Record<string, unknown>`)
4. Handle nullable conversion (JSON Schema → OpenAPI 3.0)
5. Handle `$schema` removal
6. Recurse into nested schemas (properties, items, anyOf, oneOf)

#### TDD
```
RED:     test_convert_string() — z.string() → { type: 'string' }
RED:     test_convert_object() — z.object({...}) → { type: 'object', properties: {...} }
RED:     test_convert_nullable() — z.string().nullable() → { type: 'string', nullable: true }
RED:     test_convert_enum() — z.enum(['a','b']) → { type: 'string', enum: ['a','b'] }
RED:     test_convert_array() — z.array(z.number()) → { type: 'array', items: { type: 'number' } }
RED:     test_convert_union() — z.union([z.string(), z.number()]) → { anyOf: [...] }
RED:     test_convert_optional() — z.string().optional() → { type: 'string' } (not required)
RED:     test_convert_default() — z.string().default('x') → { type: 'string', default: 'x' }
RED:     test_convert_no_dollar_schema() — output does NOT contain $schema key
GREEN:   Implement converter rewrite
REFACTOR: Remove dead helper functions from old converter
VERIFY:  cd packages/theo && npx vitest run tests/unit/zod-to-openapi.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] No `._def` access in the file
- [ ] All 15 original Zod types produce correct OpenAPI 3.0 output
- [ ] Output never contains `$schema`
- [ ] Nullable uses OpenAPI 3.0 format (`nullable: true`)
- [ ] File ≤ 150 LoC (down from 257)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — ≤ 500 lines

#### DoD
- [ ] Tests pass — `cd packages/theo && npx vitest run`
- [ ] Zero type errors — `npx tsc --noEmit`

---

### T1.3b — Migrate llm-runner.ts `._def` converter to z.toJSONSchema() (EC-1 MUST FIX)

#### Objective
Replace the standalone `convertZodToJsonSchema()` in `llm-runner.ts` (and its fixture copy) with Zod v4's `z.toJSONSchema()`.

#### Why this step (action + reasoning)

**Action:** `packages/agents/src/bridge/llm-runner.ts:176-207` has a 10-case `._def.typeName` switch converter identical to the pattern in `zod-to-openapi.ts`. `fixtures/demo-faang/server/llm-agent-runner.ts:183` has a copy. Both break silently with Zod v4 — producing `{ type: 'string' }` for all schemas via the `default` case — making agent tool calling fail without errors.

**Reasoning:** EC-1 flagged this as MUST FIX because silent wrong output (not a crash) is the most dangerous failure mode. The fix is trivial: replace the 32-line `convertZodToJsonSchema()` + `walk()` with a 3-line wrapper over `z.toJSONSchema()`.

#### Evidence
- `llm-runner.ts:183` — `const d = (node as { _def?: Record<string, unknown> })._def`
- `llm-runner.ts:185` — `switch (d.typeName)` — 10 cases: ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray, ZodOptional, ZodDefault, ZodNullable
- `fixtures/demo-faang/server/llm-agent-runner.ts:183` — identical copy
- Zod v4: `._def` renamed to `._zod` → all cases hit `default: return { type: 'string' }`

#### Files to edit
```
packages/agents/src/bridge/llm-runner.ts — replace convertZodToJsonSchema() + walk() with z.toJSONSchema()
fixtures/demo-faang/server/llm-agent-runner.ts — same replacement
```

#### Deep file dependency analysis
- `llm-runner.ts` — 207 LoC. `convertZodToJsonSchema()` called at L65 to convert tool input schemas for OpenRouter API. After change, uses Zod v4 native conversion.
- `llm-agent-runner.ts` — fixture copy, same pattern. Used for demo only.
- Downstream: tool definitions sent to LLM via `parameters` field in OpenRouter `tools` array.

#### Deep Dives
- LLM APIs (OpenRouter, Anthropic) accept JSON Schema in tool `parameters`. `z.toJSONSchema()` produces valid JSON Schema draft-07.
- EC-3 concern: `additionalProperties: false` may be added by `z.toJSONSchema()`. OpenRouter accepts it — not a breaking change for LLM tool calling.
- The `$schema` key in output is ignored by LLM APIs (harmless).

#### Pseudo-code / Signatures

```typescript
// BEFORE (32 lines, Zod v3 ._def)
function convertZodToJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  return walk(schema)
}
function walk(node: unknown): Record<string, unknown> { /* 25-line switch on ._def.typeName */ }

// AFTER (3 lines, Zod v4)
import { z } from 'zod'
function convertZodToJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  return z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>
}
```

#### Tasks
1. In `llm-runner.ts`: replace L176-207 (`convertZodToJsonSchema` + `walk`) with 3-line `z.toJSONSchema()` wrapper
2. In `fixtures/demo-faang/server/llm-agent-runner.ts`: same replacement
3. Add `import { z } from 'zod'` if not present in either file

#### TDD
```
RED:     test_llm_runner_tool_schema_v4() — create a tool with z.object({name: z.string()}), assert generated schema has { type: 'object', properties: { name: { type: 'string' } } }
GREEN:   Replace convertZodToJsonSchema with z.toJSONSchema wrapper
REFACTOR: Remove dead walk() function
VERIFY:  cd packages/agents && npx vitest run tests/unit/llm-runner.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] No `._def` access in `llm-runner.ts`
- [ ] No `._def` access in `llm-agent-runner.ts` (fixture)
- [ ] Tool schemas sent to LLM are valid JSON Schema
- [ ] Pass: lint — zero warnings on changed files
- [ ] Pass: size — `llm-runner.ts` ≤ 500 lines (reduced from 207 to ~180)

#### DoD
- [ ] Tests pass — `cd packages/agents && npx vitest run`
- [ ] Fixture compiles — `npx tsx --eval "import './fixtures/demo-faang/server/llm-agent-runner.ts'"`

---

### T1.4 — Fix all test files for Zod v4 compatibility

#### Objective
Update any test that breaks due to Zod v4 API or behavior changes.

#### Why this step (action + reasoning)

**Action:** Run full test suite, identify and fix any Zod v4 incompatibilities in tests.

**Reasoning:** Audit found no tests asserting on error messages, but v4 may still break tests through behavior changes (e.g., default values, schema composition). This is the safety-net task.

#### Evidence
- Audit: 0 tests assert on Zod error message text
- Audit: 5 test files use `safeParse`/`ZodError` — potential v4 behavior changes
- `packages/http-decorators/tests/unit/dto-zod.test.ts` — DTO↔Zod bridge tests
- `packages/create-theo/templates/default/server/` — template files use Zod (updated in T1.1)

#### Files to edit
```
packages/agents/tests/**/*.test.ts — fix any v4 breaks (likely: zero changes needed)
packages/http-decorators/tests/**/*.test.ts — fix any v4 breaks
packages/create-theo/templates/default/server/**/*.ts — update Zod usage in templates if needed
fixtures/demo-faang/server/**/*.ts — update Zod usage in fixtures if needed
```

#### Deep file dependency analysis
- Test files import `z` from `'zod'` — after T1.1, this resolves to v4
- Template files are copied verbatim to scaffolded projects — must use v4 API
- Fixture files are run via `npx tsx` — must compile with v4

#### Tasks
1. Run `cd packages/agents && npx vitest run` — fix any failures
2. Run `cd packages/http-decorators && npx vitest run` — fix any failures
3. Run `cd packages/theo && npx vitest run` — fix any failures (after T1.2 + T1.3)
4. Verify templates compile: `npx tsc --noEmit packages/create-theo/templates/default/**/*.ts`
5. Verify fixture compiles: `npx tsc --noEmit fixtures/demo-faang/**/*.ts`

#### TDD
```
RED:     (run existing test suite — identify failures)
GREEN:   Fix each failure (minimal change to make test pass with v4)
REFACTOR: Remove any v3-specific workarounds
VERIFY:  npx vitest run (full suite across all packages)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] 186 agents tests GREEN
- [ ] 201 http-decorators tests GREEN
- [ ] theo tests GREEN
- [ ] All templates and fixtures compile

#### DoD
- [ ] All tests passing — `npx vitest run` across all packages
- [ ] Zero type errors — `npx tsc --noEmit`

---

## Phase 2: Turborepo Setup

**Objective:** Add Turborepo for cached incremental builds across all 4 packages.

### T2.1 — Add turbo.json configuration

#### Objective
Create `turbo.json` with build/test/typecheck tasks and proper input/output declarations.

#### Why this step (action + reasoning)

**Action:** Create `turbo.json` at monorepo root with 3 cached tasks (build, typecheck, test). Configure `inputs` to include only source-relevant files and `outputs` to cache `dist/` for builds.

**Reasoning:** Per D3, Turborepo gives cache-hit builds in ~6s (vs 15s cold). The config is declarative JSON — zero runtime code. `dependsOn: ["^build"]` ensures packages build in dependency order (http-decorators → agents → theo → create-theo).

#### Evidence
- No `turbo.json` exists today
- 4 packages with tsup builds: theo (88 LoC config, 29 entries), agents (14 LoC, 3 entries), http-decorators (11 LoC, 4 entries), create-theo (single CLI entry)
- Dependency order: agents depends on http-decorators; theo is standalone; create-theo is standalone

#### Files to edit
```
turbo.json (NEW) — Turborepo configuration
package.json — update build/test/typecheck scripts to use turbo
.gitignore — add .turbo/
```

#### Deep file dependency analysis
- `turbo.json` — NEW file. Read by `npx turbo run <task>`. Declares task graph.
- `package.json` scripts — currently `"build": "pnpm -r run build"`. Changed to `"build": "turbo run build"`.
- `.gitignore` — must exclude `.turbo/` cache directory.

#### Deep Dives
- `dependsOn: ["^build"]` means "build all dependencies first" — handles http-decorators → agents order
- `inputs: ["src/**", ...]` — turbo hashes these files to determine cache key
- `outputs: ["dist/**"]` — turbo caches this directory; on cache hit, restores it
- Packages without circular deps: verified in audit (agents → http-decorators is unidirectional)

#### Pseudo-code / Signatures

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsup.config.ts", "tsconfig.json", "package.json"],
      "outputs": ["dist/**"],
      "outputLogs": "errors-only"
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "tsconfig.json", "package.json"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "vitest.config.ts", "package.json"],
      "outputs": []
    }
  }
}
```

#### Tasks
1. Create `turbo.json` with build/typecheck/test tasks
2. Update root `package.json` scripts: `build`, `test`, `typecheck` to use `turbo run`
3. Add `.turbo/` to `.gitignore`
4. Install turbo as devDependency: `pnpm add -Dw turbo`
5. (EC-4) Verify every package that should run tests has a `"test"` script in its `package.json`. Add `"test": "vitest run"` to any package missing it (turbo silently skips packages without matching script).
6. Run `npx turbo run build` — verify all 4 packages build
7. Run `npx turbo run build` again — verify cache hit (output: "FULL TURBO")

#### TDD
```
RED:     test_turbo_build_cache_hit() — second run of turbo build completes in <10s
GREEN:   Create turbo.json and update scripts
REFACTOR: None expected
VERIFY:  npx turbo run build test typecheck
```

#### Concurrency tests
(none — single-threaded; turbo parallelism is process-level, not thread-level)

#### Acceptance Criteria
- [ ] `turbo.json` exists with valid schema
- [ ] `npx turbo run build` builds all 4 packages
- [ ] Second `npx turbo run build` hits cache ("FULL TURBO" or ">>> FULL TURBO")
- [ ] `npx turbo run test` runs all tests
- [ ] `.turbo/` in `.gitignore`
- [ ] Pass: size — `turbo.json` ≤ 50 lines

#### DoD
- [ ] `npx turbo run build test typecheck` exit 0
- [ ] Cache hit confirmed on second run

---

## Phase 3: DTS @internal Fix

**Objective:** Enable `stripInternal` to hide test helpers from published `.d.ts` files.

### T3.1 — Enable stripInternal and verify DTS output

#### Objective
Add `stripInternal: true` to root tsconfig, rebuild, verify `@internal` symbols are stripped from `.d.ts`.

#### Why this step (action + reasoning)

**Action:** Add `"stripInternal": true` to `tsconfig.json` compilerOptions. Rebuild all packages. Verify that `__resetForTests()` and similar `@internal` symbols do not appear in `dist/*.d.ts`.

**Reasoning:** Per D4, 15 `@internal` test helpers leak into published types. `stripInternal` is the TypeScript-native solution. Since tsup uses tsc internally for DTS generation, the flag propagates.

#### Evidence
- `packages/theo/src/cli/cleanup/cleanup.ts:124` — `@internal` on `__resetForTests()`
- `packages/theo/src/server/agent/configure-agent-registry.ts:67` — `@internal`
- `packages/theo/src/server/cost/track-agent-tools.ts:162` — `@internal`
- Total: 15 occurrences across 7 files in `packages/theo/src/`
- `stripInternal` NOT SET in any tsconfig today

#### Files to edit
```
tsconfig.json — add "stripInternal": true to compilerOptions
packages/theo/tsconfig.json — add "stripInternal": true (EC-2: this file does NOT extend root, so root change alone has zero effect)
```

#### Deep file dependency analysis
- `tsconfig.json` — root config inherited by agents and http-decorators (both `"extends": "../../tsconfig.json"`)
- `packages/theo/tsconfig.json` — standalone (NO `"extends"` field). ALL 15 `@internal` occurrences are in `packages/theo/src/`. Without adding `stripInternal` here, the fix is a no-op. (EC-2 MUST FIX)
- tsup reads the package-local tsconfig for DTS generation — `stripInternal` must be in the tsconfig that tsup sees
- Tests import `@internal` symbols directly from source files (not barrels) — unaffected by DTS stripping

#### Deep Dives
- `stripInternal: true` removes from `.d.ts` any declaration preceded by `/** @internal */` JSDoc
- Runtime JS is NOT affected — only type declarations
- Tests that import `__resetForTests()` use direct path (`from '../src/cli/cleanup/cleanup'`), not the barrel (`from 'theokit'`) — they will still work because the JS module is unchanged

#### Tasks
1. Add `"stripInternal": true` to `tsconfig.json` compilerOptions
2. Add `"stripInternal": true` to `packages/theo/tsconfig.json` compilerOptions (EC-2: this is the one that actually matters — all `@internal` symbols are here)
3. Run `npx turbo run build` (uses turbo from Phase 2)
3. Verify: `grep -r "__resetForTests\|@internal" packages/theo/dist/*.d.ts` returns empty
4. Verify: `grep -r "__resetForTests" packages/theo/src/` still finds the symbols (source unchanged)
5. Run tests to confirm nothing breaks

#### TDD
```
RED:     test_dts_no_internal_symbols() — grep packages/theo/dist/**/*.d.ts for @internal symbols, expect 0 matches
GREEN:   Add stripInternal: true
REFACTOR: None expected
VERIFY:  npx turbo run build && grep -r "__resetForTests" packages/theo/dist/ | wc -l (expect 0)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `stripInternal: true` in root tsconfig
- [ ] Zero `@internal` symbols in any `dist/*.d.ts`
- [ ] All tests still pass (tests access source, not dist)
- [ ] Pass: size — tsconfig ≤ 500 lines

#### DoD
- [ ] `npx turbo run build` exit 0
- [ ] `grep -r "__resetForTests" packages/theo/dist/` returns empty
- [ ] All tests pass

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** Validate all changes work together — full build, full test suite, type check.

### Execution

```bash
npx turbo run build                # all packages build with Zod v4 + cache
npx turbo run typecheck            # zero type errors
npx turbo run test                 # 387+ tests GREEN
npx tsc --noEmit                   # root-level type check
pnpm lint                          # zero lint warnings
```

### Acceptance Criteria

- [ ] All test suites green (agents 186 + http-decorators 201 + theo tests)
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] `zod-to-json-schema` not in any package.json
- [ ] `.turbo/` cache works (second build is fast)
- [ ] No `@internal` symbols in published `.d.ts`

### If Validation Fails

1. Identify which failures are caused by Zod v4 vs pre-existing
2. Fix all plan-caused failures
3. Re-run validation chain
4. Pre-existing issues documented in PR description

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Zod v3→v4 version declarations | T1.1 | All package.json updated to ^4.0.0 |
| 2 | Remove zod-to-json-schema dependency | T1.1 + T1.2 | Dep removed from package.json; import replaced with z.toJSONSchema() |
| 3 | Adapt define-agent-tool.ts | T1.2 | zodToJsonSchema() → z.toJSONSchema() |
| 4 | Adapt zod-to-openapi.ts converter | T1.3 | ._def introspection → z.toJSONSchema() + OpenAPI adapter |
| 4b | Adapt llm-runner.ts converter (EC-1) | T1.3b | ._def converter → z.toJSONSchema() wrapper |
| 5 | Fix test compatibility | T1.4 | All tests pass with Zod v4 |
| 6 | Add Turborepo | T2.1 | turbo.json + scripts + .gitignore |
| 7 | Fix DTS @internal leak | T3.1 | stripInternal: true in tsconfig |
| 8 | Integration validation | Phase 4 | Full build+test+typecheck chain |

**Coverage: 9/9 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx turbo run test` green
- [ ] Zero type errors — `npx turbo run typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] `zod-to-json-schema` removed from all package.json
- [ ] Turbo cache operational
- [ ] No `@internal` in published `.d.ts`

## Failure scenarios

(none — no external I/O touched. All changes are build-time infrastructure: package versions, build config, TypeScript compiler options.)

## Final Phase: Integration Validation

> See Phase 4 above — same section.
