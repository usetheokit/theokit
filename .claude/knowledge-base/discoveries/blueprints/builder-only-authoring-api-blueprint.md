# Blueprint — Builder-only authoring API (M31)

> DISCOVER phase output for ROADMAP M31. Evidence-grounded in the real code + the DX audit
> (Mastra + Vercel AI SDK, this cycle) + the 8-surface inventory. Staff-level design doc; the
> input to `/to-plan`.

## 1. Problem & goal

TheoKit ships **three** ways to author an agent (`@Agent` decorators, `defineAgent`, `agent()`
builder) and object-config `define*` for 7 other surfaces. The DX audit vs Mastra (`new Agent`/
`createTool`) + Vercel AI SDK (`ToolLoopAgent`/`tool()`) found this "paradox of choice" is a
real onboarding + docs + maintenance tax. Owner decision: **the fluent builder is THE single
pattern across all 8 surfaces; remove every `define*` + every `@theokit/agents` decorator.**

## 2. THE load-bearing architecture decision (de-risker)

`packages/agents/src/bridge/agent-builder.ts` proves the pattern: `agent()` is **pure type-state**;
its runtime is a plain `DefineAgentConfig` accumulator; **`.build()` delegates to `defineAgent(config)`**.

**Therefore "builder-only" = remove `define*`/decorators from the PUBLIC exports (barrels), keep
them as INTERNAL impl that each `.build()` calls.** The scan / discovery / `loadConfig` / compile /
SDK runtime are **100% untouched** — only the public authoring surface changes.

- All 8 core `define*` are **identity functions** (return the config unchanged): `defineRoute`,
  `defineAction`, `defineWebSocket(Web)`, `defineMiddleware`, `defineConfig`, `definePlugin`/
  `defineTheoPlugin`, `defineHealthRoute`/`defineReadyRoute` (evidence: inventory, all `file:line`).
- `defineAgentTool` returns the SDK `CustomTool` shape; `defineAgent` returns the branded
  `AgentDefinition`. Both consumed by the compile/scan path unchanged.

**Consequence:** each builder's `.build()` returns the exact shape the consumer already reads. This
is KISS + zero-runtime-regression. NO consumer of the *shape* changes — only the *authoring call*.

## 3. Prior art (cited)

| Source | Technique borrowed |
|---|---|
| tRPC `utils.ts:2-4` / `procedureBuilder.ts:362-379` | `UnsetMarker` brand + set-once `.model()` (collapse to `never`), zero-arg terminal guard via labeled-tuple error carrier |
| Zod, Hono, Drizzle query builder | immutable fluent chaining; each method returns a new advanced type |
| Our `agent-builder.ts` (M8) | **the in-repo proven template** — replicate its shape for the 7 other surfaces |
| Mastra `createTool({id,description,inputSchema,outputSchema,execute})` | tool field names; `execute` (not `handler`) is the AI-ecosystem term |
| Vercel AI SDK `tool({description,inputSchema,execute})` / `ToolLoopAgent` | `.execute()` terminal muscle-memory; keyed vs array tools |

## 4. Grammar — 8 surfaces (entry `x()` → setters → terminal `.build()`)

| Surface | Builder | `.build()` returns | Required-field guard |
|---|---|---|---|
| **tool** | `tool('read').describe(s).input(z).execute((i,ctx)=>…)` | `CustomTool` (via internal `defineAgentTool`) | name(arg)+input+execute required before build |
| **agent** | `agent()…` (EXISTS — extend) | `AgentDefinition` | `.model()` required (already) |
| **route** | `route().query(z).body(z).params(z).response(z).handler(({query,body,params})=>…)` | `RouteConfig` | `.handler()` required |
| **action** | `action().input(z).accept('form').handler(({input,ctx})=>…)` | `ActionConfig` | `.input()`+`.handler()` required |
| **websocket** | `websocket().onOpen(fn).onMessage(fn).onClose(fn).onError(fn)` | `WebSocketHandler(Web)` | none (all optional) |
| **middleware** | `middleware().handle((req,next)=>…)` | `MiddlewareHandler` fn | `.handle()` required |
| **config** | `config().serverDir(s)…​.set(partial)` | `TheoConfig` (Partial) | none |
| **plugin** | `plugin('cors').onRequest(fn).onResponse(fn)` | `TheoPlugin` | name(arg) required |

**Handler-method naming (locked):** `.execute()` for **tool** (AI-ecosystem muscle-memory), `.handler()`
for **route/action** (HTTP idiom), lifecycle names (`onOpen`/`onMessage`) for **websocket/plugin**,
`.handle()` for **middleware**. Terminal is always `.build()`.

**`config()` grammar decision (the weak-fit surface):** hybrid — chainable setters for the common
fields (`serverDir/appDir/agentsDir/port/host/ssr/…`) PLUS a `.set(partial: Partial<TheoConfig>)`
escape hatch for the long tail (rate-limit/security/upload/…), terminal `.build()`. Honest: config is
where the builder is least ergonomic; the `.set()` escape keeps parity with `defineConfig({})` without
30 setters. ADR to record this.

## 5. Agent builder — full capability coverage (no silent loss)

The `agent()` builder today covers: `input/model/system/reasoningEffort/context/tool/use`. Missing
methods needed for **capability parity** once decorators are removed (each maps to an existing
`CompiledAgentOptions` field — thin setter, zero new runtime):

| Missing method | Compiled field (agent-compiler.ts) | Source decorator today |
|---|---|---|
| `.guardrail(g)` / `.guardrails([…])` | `guardrails` | `@Guardrails` / `defineAgent({guardrails})` |
| `.approval(name,opts)` / `.approvals(map)` | `hitl` | `@HumanInTheLoop` / `defineAgent({approvals})` |
| `.skills(sel)` | `skills`/`skillsResolver` | `@Skills` / `defineAgent({skills})` |
| `.checkpoint(opts)` | `checkpoint?` (line 168) | `@Checkpoint` — **decorator-only today** |
| `.subAgent(name,def)` / `.subAgents(map)` | `agents` | `@SubAgents` — **decorator-only today** |
| `.mainLoop(opts)` / `.maxIterations(n)` | `maxIterations`/loop-strategy | `@MainLoop` — **decorator-only today** |
| `.toolbox(namespace,[tools])` | `tools` (namespaced `ns.tool`) | `@Toolbox` — sugar over namespaced tools |
| `.memory(opts)` | `memory?` | `@Memory` — decorator-only |
| `.mcp(servers)` | `mcpServers?` | `@Mcp` — decorator-only |

**Resolution (no capability loss):** every decorator-only capability with a compiled field gets a
builder method (thin setter). `@Mixin` (class-composition sugar) has no compiled field → replaced by
the existing `.use(preset)` composition + ADR documenting the drop of class-mixin semantics. This
closes risk #2. The exact method set is finalized in `/to-plan`; the ADR records each decision.

## 6. Migration strategy (phases → the plan will sequence these)

1. **Pilot `tool()`** — new builder, TDD, `.build()`→internal `defineAgentTool`. Migrate the 14 tool
   call-sites (12 in theo-code-v2 + 2 examples-bound, but examples get deleted). Locks the grammar.
2. **Extend `agent()`** — add the 9 missing methods (§5), TDD each, type-state tests.
3. **6 core builders** — `route/action/websocket/middleware/config/plugin`, each TDD, `.build()`→internal define*.
4. **Un-export** — remove `define*` + decorators from public barrels (`index.ts`, `server/define`,
   `@theokit/agents` index, decorators). Keep internal. Grep-guard: zero public `define*`/decorator export.
5. **Migrate consumers** — theo-code-v2 (agent + 12 tools + 7 routes), create-theokit default template,
   fixtures (**they ARE the tests** — migrate carefully, they now validate the builder). 
6. **Delete `examples/`** — `rm -rf examples/{code-assistant,agent-saas}` (removes 7 hardest decorator sites).
7. **Gates** — theokit unit+integration+typecheck+lint; theo-code-v2 full suite+typecheck+lint;
   npm-strict dev smoke (web + `/api/health` + agent stream + TUI); CHANGELOG breaking + migration guide.

## 7. DoD coverage map

| DoD bullet (M31) | Covered by phase |
|---|---|
| Builder for all 8 surfaces; `.build()` emits existing shape; agent gains 3 methods | 1,2,3 |
| Every `define*` + `@theokit/agents` decorator removed from public API; `@theokit/http` intact | 4 |
| Decorator-only capabilities get a builder method OR ADR-drop | 2 (§5) + ADR |
| Consumers migrated; examples deleted | 5,6 |
| Green gates + npm-strict smoke + CHANGELOG migration guide | 7 |

## 8. Risks (from grill) + mitigations

1. **Breaking blast radius (~110 sites) + fixtures-are-tests.** Mitigation: `.build()` emits identical
   shape (runtime untouched); surface-by-surface TDD; pilot `tool()` first; fixtures migrated last.
2. **Decorator-only homelessness + `config()` weak-fit.** Mitigation: §5 mapping (every compiled field →
   builder method) + `.set()` escape for config; ADR per decorator-only feature (`@Mixin` drop documented).

## 9. Coverage corners

- **Integration tests:** each builder `.build()` output fed through the real scan/compile path (route
  through `execute.ts`, agent through `compileAgentDefinition`, config through `loadConfig`).
- **Dependencies:** none new (builders are pure TS over existing internals). No new npm dep (parsimony).
- **Tools:** the 8 builders themselves + the un-export grep-guard.
- **Techniques:** tRPC UnsetMarker type-state; identity-shape delegation; barrel un-export.

## 10. ADRs to write in the plan

- **ADR-M31-1:** builder-only = un-export (not delete) define*/decorators; `.build()` delegates internally.
- **ADR-M31-2:** decorator-only capability resolution (per-feature builder-method vs drop; `@Mixin` dropped → `.use()`).
- **ADR-M31-3:** `config()` hybrid grammar (setters + `.set(partial)` escape).
- **ADR-M31-4:** handler-method naming per surface (`execute`/`handler`/lifecycle/`handle`).
