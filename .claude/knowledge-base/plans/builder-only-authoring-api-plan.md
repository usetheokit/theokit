---
slug: builder-only-authoring-api
milestone_id: M31
created_at: 2026-07-08
goal: Make the fluent builder the ONLY authoring surface across all 8 define-surfaces and remove every define* + @theokit/agents decorator, with zero runtime regression.
---

# Plan — Builder-only authoring API (M31)

> Design depth lives in the DISCOVER blueprint:
> `.claude/knowledge-base/discoveries/blueprints/builder-only-authoring-api-blueprint.md`.
> This plan sequences the work into TDD phases with a Coverage Matrix + ADRs.

## Goal

The fluent builder (`x()…build()`) is the single authoring surface for all 8 define-surfaces
(agent · tool · route · action · websocket · middleware · config · plugin). Every `define*` export
and every `@theokit/agents` decorator is removed from the PUBLIC API (kept internal — `.build()`
delegates). `@theokit/http` `@Controller` untouched. Consumers migrated; `examples/` deleted. All
gates green + npm-strict dev smoke functional.

## Baseline Context

- **Proven template:** `packages/agents/src/bridge/agent-builder.ts` — `agent()` type-state builder,
  `.build()` → `defineAgent(config)`. UnsetMarker (tRPC). Test: `tests/type/agent-builder.test-d.ts`.
- **All 8 `define*` are identity/branded** (inventory, file:line in blueprint §2). Consumers read the
  plain shape → un-export + builder-delegation leaves the runtime untouched.
- **Agent capability gaps** (blueprint §5): 9 missing builder methods, each mapping to an existing
  `CompiledAgentOptions` field (`packages/agents/src/bridge/agent-compiler.ts`). `@Mixin` has no
  compiled field → dropped, `.use()` replaces it.
- **Migration surface:** ~110 call-sites after deleting examples (theo-code-v2 + create-theokit
  template + fixtures). Fixtures ARE the test suite.
- **Architecture boundaries:** builders are PURE metadata (G2/sdk-runtime.md — never call an LLM);
  live in `@theokit/agents` (agent/tool) + `theokit` core (route/action/ws/middleware/config/plugin).

## Coverage Matrix (every Goal claim → task)

| Goal claim | Task/Phase |
|---|---|
| Builder for all 8 surfaces; `.build()` emits existing shape | P1 (tool), P2 (agent ext), P3 (6 core) |
| agent() gains missing methods (guardrails/approvals/skills/checkpoint/subAgents/mainLoop/toolbox/memory/mcp) | P2 |
| Every define* + @theokit/agents decorator removed from public API | P4 |
| @theokit/http @Controller intact | P4 (grep-guard scoped to agents+core barrels) |
| Decorator-only capability → builder method OR ADR-drop | P2 + ADR-M31-2 |
| Consumers migrated (theo-code-v2, template, fixtures) | P5 |
| examples/ deleted | P6 |
| Gates green + npm-strict smoke + CHANGELOG migration guide | P7 |

## Phases (TDD — RED → GREEN → REFACTOR → WIRING → COMMIT per task)

### Phase 1 — Pilot: `tool()` builder (locks the grammar)
- **RED:** `tool('read').describe(d).input(z.object({path})).execute(fn).build()` returns a `CustomTool`
  structurally identical to `defineAgentTool({name:'read',description:d,inputSchema,handler:fn})`.
  Type test: `.build()` is a compile error if `.input()` or `.execute()` never called; input type of
  `execute` inferred from the Zod schema. `test_tool_builder_emits_customtool_shape`.
- **GREEN:** implement `tool()` in `packages/agents/src/bridge/tool-builder.ts` (or theo/server), pure
  type-state, `.build()` delegates to internal `defineAgentTool`.
- **WIRING:** migrate the 12 theo-code-v2 tools to `tool()`; agent still streams + runs `read` (evidence).

### Phase 2 — Extend `agent()` (capability parity)
- **RED per method:** `.guardrail/.approval/.skills/.checkpoint/.subAgent/.mainLoop/.toolbox/.memory/.mcp`
  each sets the corresponding `DefineAgentConfig`/compiled field; type tests assert accumulation.
  (Extends `DefineAgentConfig` where a field is missing — checkpoint/subAgents/mainLoop/memory/mcp.)
- **GREEN:** add methods to `AgentBuilder` + runtime accumulator; extend `defineAgent`/`compileAgentDefinition`
  to carry the new config fields into `CompiledAgentOptions`.
- **WIRING:** theo-code-v2 agent uses `.approval()` (already gates write/edit/bash) via builder.

### Phase 3 — 6 core builders
- `route()/action()/websocket()/middleware()/config()/plugin()` — each: RED (build() emits the existing
  identity shape; required-field guards per blueprint §4), GREEN (delegate to internal define*), REFACTOR.
- `config()` uses hybrid grammar (setters + `.set(partial)`) — ADR-M31-3.

### Phase 4 — Un-export define* + decorators
- Remove from public barrels: `packages/theo/src/index.ts`, `server/define/*`, `@theokit/agents` index,
  `decorators/*`. Keep functions internal. RED: a test asserting the public entrypoints no longer export
  `defineRoute`/`defineAgent`/`@Agent`/… ; `@theokit/http` `@Controller` still exported.
- Grep-guard: `grep -rE "export .*\bdefine(Route|Action|Agent|AgentTool|WebSocket|Middleware|Config|Plugin|HealthRoute|ReadyRoute)\b" <public barrels>` → zero.

### Phase 5 — Migrate consumers
- theo-code-v2 (agent + 12 tools + 7 routes), create-theokit default template, fixtures. Each fixture
  rewrite keeps its test green (the shape is identical). RED-first where a fixture asserts behavior.

### Phase 6 — Delete examples/
- `git rm -r examples/code-assistant examples/agent-saas`. Confirm no dangling refs (grep imports).

### Phase 7 — Gates + evidence
- theokit: unit + integration + typecheck + lint. theo-code-v2: full suite + typecheck + lint.
- npm-strict dev smoke (tmux): web 200 + `/api/health` 200 + agent stream (real model) + TUI tool-call.
- CHANGELOG `[Unreleased]`: breaking-change entry + migration guide table (`define*({…})` → `x()…build()`).

## ADRs

- **ADR-M31-1 — Un-export, not delete.** Alt: physically delete define*/decorators (rejected: forces
  runtime rewrite, high risk, no benefit — the internal impl is the compile seam).
- **ADR-M31-2 — Decorator-only capability resolution.** Each `CompiledAgentOptions` field gets a builder
  method; `@Mixin` (no compiled field) dropped → `.use(preset)`. Alt: keep decorators for these (rejected:
  breaks "one pattern"); drop the capabilities (rejected: silent loss).
- **ADR-M31-3 — `config()` hybrid grammar.** Setters for common fields + `.set(partial)` escape. Alt: 30
  setters (rejected: worse DX than object); keep defineConfig object (rejected: breaks "all surfaces").
- **ADR-M31-4 — Handler-method naming.** `.execute()` (tool), `.handler()` (route/action), lifecycle
  (ws/plugin), `.handle()` (middleware). Alt: uniform `.handle()` everywhere (rejected: fights AI + HTTP
  ecosystem muscle-memory).

## Drawbacks & Risks

1. Breaking blast radius (~110 sites) + fixtures-are-tests → false green. Mitigation: identical branded
   shape (runtime untouched); surface-by-surface TDD; pilot first; fixtures last.
2. Decorator-only homelessness + config() weak-fit. Mitigation: §5 mapping + `.set()` escape; ADRs.
3. Scope is large (multi-phase). Mitigation: phases are independently shippable; each ends green.

## Unresolved Questions

(none — the two forks, out-of-scope overlap, and examples-delete were resolved in the grill;
decorator-only method set is finalized in P2 against the compiled-field list.)

## Prior Art

tRPC (UnsetMarker/set-once), Zod/Hono/Drizzle (fluent chaining), our `agent-builder.ts` (M8), Mastra
(`createTool`/`new Agent`), Vercel AI SDK (`tool()`/`ToolLoopAgent`). Full citations: blueprint §3.

## Test Plan

- Type tests (`.test-d.ts`) per builder: required-field guards, input-type inference, accumulation.
- Unit: each `.build()` output structurally equals the legacy `define*({…})` output (golden).
- Integration: build() output through the real scan/compile/loadConfig path.
- E2E: npm-strict dev smoke (web + health + agent stream + TUI) after migration.
