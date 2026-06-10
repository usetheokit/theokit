---
slug: theokit-agents-unified-decorator-runtime
created_at: 2026-06-09
goal: Ship @theokit/agents as a new package that extends the http-decorators pipeline to AI agents, where @Agent() compiles to SDK Agent.create() and @Tool() compiles to defineTool(), measured by pnpm --filter @theokit/agents test returning exit 0 with 40+ passing tests covering agent decorators, pipeline reuse, tool runtime, SSE streaming, and TheoApp integration.
---

# Plan: `@theokit/agents` — Unified Decorator Runtime

> **Version 1.1** (2026-06-09) — Absorbed 3 MUST FIX from edge-case review: EC-1 (missing @MainLoop validation), EC-2 (SSE write after disconnect guard), EC-3 (Toolbox instance undefined guard). Plus 4 SHOULD TEST items folded into TDD sections.
>
> **Version 1.0** — Create `@theokit/agents` as a new package that makes AI agents first-class citizens of the TheoKit decorator runtime. Agents reuse the SAME pipeline as HTTP controllers (Guards, Interceptors, Filters, Throttle, Reflector, ExecutionContext) — extended with agent loops, tools, memory, policies, and streaming. `@Agent()` is a macro over `@theokit/sdk`'s `Agent.create()`. `@Tool()` compiles to `defineTool()`. No runtime duplication — decorators are syntactic sugar over the proven SDK.

## Goal

> Ship `@theokit/agents` package with `@Agent`, `@MainLoop`, `@Toolbox`, `@Tool` decorators that compile to `@theokit/sdk` primitives and reuse the `@theokit/http-decorators` pipeline (guards, interceptors, filters, throttling), measured by `pnpm --filter @theokit/agents test` returning exit 0 with ≥ 47 passing tests covering decorator metadata, SDK compilation, pipeline reuse, SSE streaming, and `TheoApp.create({ agents: [...] })` integration.

## Context

The TheoKit ecosystem has two mature layers: `@theokit/sdk` (agent runtime — `Agent.create()`, `defineTool()`, providers, `Run.stream()`) and `@theokit/http-decorators` (NestJS-compatible pipeline — 30 decorators, `ExecutionContext`, `Reflector`, guards, interceptors, filters, exceptions). Today these are disconnected: wiring an SDK agent into an HTTP endpoint requires manual `defineRoute` + `Agent.create()` + SSE plumbing — ~50 LoC of boilerplate per agent.

`@theokit/agents` closes this gap. An `@Agent()` decorator is a MACRO over `@Controller()` + `Agent.create()` — it generates the HTTP endpoint, wires the SDK, and streams responses via SSE. The existing pipeline (auth guards, rate limiting, tracing interceptors, exception filters) applies UNCHANGED to agents. Tool calls go through the same guard/interceptor chain. The result: **HTTP routes, agent loops, tools, auth, RBAC, observability, and deploy live in the same declarative model.**

Pattern D3 from `theokit-http-decorators-pattern-from-nestjs-patterns` deferred Filters to v0.2.0 — now shipped. The same skill's D1 (Legacy decorators) and D2 (Zod SSoT) patterns apply unchanged to agent decorators.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/` (NEW package) | 0 | — | Package to be created | — |
| `packages/agents/src/decorators/agent.ts` (NEW) | 0 | — | `@Agent()` decorator | — |
| `packages/agents/src/decorators/tool.ts` (NEW) | 0 | — | `@Tool()` + `@Toolbox()` decorators | — |
| `packages/agents/src/decorators/main-loop.ts` (NEW) | 0 | — | `@MainLoop()` decorator | — |
| `packages/agents/src/decorators/policies.ts` (NEW) | 0 | — | `@RequiresApproval`, `@RequiresCapability`, `@Budget`, `@Policy` | — |
| `packages/agents/src/decorators/observability.ts` (NEW) | 0 | — | `@Trace`, `@Audit` | — |
| `packages/agents/src/decorators/index.ts` (NEW) | 0 | — | Decorator barrel | — |
| `packages/agents/src/bridge/agent-execution-context.ts` (NEW) | 0 | — | `AgentExecutionContext extends ExecutionContext` | — |
| `packages/agents/src/bridge/walk-agent-metadata.ts` (NEW) | 0 | — | Agent metadata walker (mirrors http-decorators walkControllerMetadata) | — |
| `packages/agents/src/bridge/agent-compiler.ts` (NEW) | 0 | — | Compile `@Agent` + `@Tool` metadata → SDK `Agent.create()` + `defineTool()` | — |
| `packages/agents/src/bridge/agent-sse-handler.ts` (NEW) | 0 | — | SSE streaming handler for agent responses | — |
| `packages/agents/src/bridge/agent-route-generator.ts` (NEW) | 0 | — | Auto-generate HTTP routes from `@Agent` metadata | — |
| `packages/agents/src/bridge/index.ts` (NEW) | 0 | — | Bridge barrel | — |
| `packages/agents/src/manifest/agent-manifest.ts` (NEW) | 0 | — | Generate `.theokit/agents.manifest.json` | — |
| `packages/agents/src/theokit-plugin.ts` (NEW) | 0 | — | `agentsPlugin()` for TheoKit integration | — |
| `packages/agents/src/index.ts` (NEW) | 0 | — | Public barrel | — |
| `packages/agents/src/types.ts` (NEW) | 0 | — | Shared types | — |
| `packages/agents/tests/` (NEW) | 0 | — | Test suite | — |
| `packages/http-decorators/src/app.ts` | 306 | recent | TheoApp.create() | Add `agents?: Function[]` option alongside `controllers` |
| `packages/http-decorators/src/bridge/execution-context.ts` | 63 | recent | ExecutionContext + CanActivate | Preserve existing interface — AgentExecutionContext extends it in agents package |

### Current callers / dependents

- **Symbol:** `ExecutionContext` in `packages/http-decorators/src/bridge/execution-context.ts`
  - **Callers (production):** `create-server.ts`, `theokit-plugin.ts`, `app.ts`
  - **Callers (tests):** 15+ test files
  - **Change:** No change — `AgentExecutionContext` EXTENDS it in the agents package

- **Symbol:** `CanActivate` in `packages/http-decorators/src/bridge/execution-context.ts`
  - **Callers:** All guard implementations across tests
  - **Change:** No change — agents reuse the same interface

- **Symbol:** `TheoApp.create()` in `packages/http-decorators/src/app.ts`
  - **Callers:** `tests/integration/theo-app.test.ts`, `examples/app.test.ts`
  - **Change:** Add optional `agents?: Function[]` to `TheoAppOptions`

- **Symbol:** `Agent.create()` in `theokit-sdk/packages/sdk/src/agent.ts`
  - **Callers:** SDK consumers, dogfood-app
  - **Change:** No change — `@Agent` decorator CALLS it, doesn't modify it

- **Symbol:** `defineTool()` in `theokit-sdk/packages/sdk/src/define-tool.ts`
  - **Callers:** SDK consumers
  - **Change:** No change — `@Tool` decorator CALLS it, doesn't modify it

### Domain glossary

- **Agent** — An AI-powered handler that receives user messages, plans actions, calls tools, and streams responses. Backed by an LLM provider via `@theokit/sdk`.
- **MainLoop** — The core execution strategy of an agent (e.g., plan-act-reflect, ReAct, simple-chat). Runs iteratively until a terminal response is produced.
- **Toolbox** — A class that groups related tools under a namespace (e.g., `SupportTools` with `search_tickets` + `refund_customer`).
- **Tool** — A function an agent can call to interact with external systems. Compiled to `defineTool()` from `@theokit/sdk`.
- **AgentExecutionContext** — Extended `ExecutionContext` that adds `getAgent()`, `getRun()`, `getToolCall()` — lets existing guards/interceptors work with agent-specific state.
- **Agent Manifest** — Build-time JSON file (`.theokit/agents.manifest.json`) listing all agents, their routes, tools, guards, and policies.

### Architecture boundaries affected

- **New package `packages/agents/`** — depends on `@theokit/http-decorators` (pipeline) + `@theokit/sdk` (agent runtime). Neither existing package depends on agents. Clean DAG: `agents → http-decorators, agents → sdk`. No cycles.
- **`http-decorators` boundary** — minimal touch: only `TheoAppOptions` gains `agents?` field. All agent logic lives in the agents package.
- **SDK boundary** — zero touch. `@Agent` calls `Agent.create()` as a consumer. No SDK code modified.

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md` — Pattern D1 (Legacy decorators), D2 (Zod SSoT), D3 (guards/interceptors pipeline). All apply unchanged to agent decorators.
- **Internal patterns skill:** `theokit-http-decorators-pattern-from-nestjs-patterns` — Pattern D3 explicitly deferred `@Catch` Filter (now shipped) and states "v0.2.0 follow-up plans" — agents are the next evolution.
- **Reference project:** `theokit-sdk` Agent.create() API (`theokit-sdk/packages/sdk/src/agent.ts`) — the runtime we compile to.
- **External:** NestJS `@nestjs/microservices` pattern — extends HTTP controllers to message-based services (same guards/interceptors). Our pattern mirrors this for AI agents instead of microservices.
- **External:** Mastra framework (mastra.ai) — decorator-based agent definition with tools. Validates the pattern but lacks pipeline reuse (no guards/interceptors on tools).

## Objective

- [ ] `@Agent()` decorator stores metadata and compiles to `Agent.create()` from `@theokit/sdk`
- [ ] `@MainLoop()` decorator marks the agent's execution strategy method
- [ ] `@Toolbox()` + `@Tool()` decorators group and define tools, compiling to `defineTool()`
- [ ] `@RequiresApproval`, `@RequiresCapability`, `@Budget`, `@Policy` agent-specific decorators
- [ ] `@Trace`, `@Audit` observability decorators
- [ ] `AgentExecutionContext extends ExecutionContext` with `getAgent()`, `getRun()`, `getToolCall()`
- [ ] Existing `@UseGuards`, `@UseInterceptors`, `@UseFilters`, `@Throttle` work on agents and tools
- [ ] SSE streaming handler for agent responses (`Run.stream()` → SSE events)
- [ ] `TheoApp.create({ agents: [...] })` registers agents alongside controllers
- [ ] `agentsPlugin()` for TheoKit dev-server integration
- [ ] Agent manifest generation (`.theokit/agents.manifest.json`)
- [ ] ≥ 47 tests GREEN

## ADRs

### D1 — @Agent as macro over SDK, not independent runtime

**Decision:** `@Agent()` compiles to `Agent.create()` from `@theokit/sdk`. The decorator stores metadata; the bridge reads metadata and calls the SDK. No agent execution logic lives in `@theokit/agents` — the SDK IS the runtime.

**Rationale:** The SDK has 29K+ LoC of battle-tested agent runtime (providers, streaming, conversation persistence, memory, MCP). Duplicating any of this violates Rule 9 (Don't Reinvent the Wheel) and DRY. The decorator is syntactic sugar that makes the SDK declarative.

**Alternatives considered:**
- (a) Independent runtime — would duplicate `Agent.create()`, provider routing, `Run.stream()`, tool execution. ~10K LoC of reimplementation. Rejected: Rule 9 violation, maintenance burden.

**Consequences:** `@theokit/agents` has `@theokit/sdk` as peerDep. Agent capabilities are bounded by what the SDK supports. New SDK features (e.g., new providers) automatically available to decorator users.

### D2 — AgentExecutionContext extends ExecutionContext (not replaces)

**Decision:** `AgentExecutionContext` extends `ExecutionContext` from `@theokit/http-decorators`, adding `getAgent()`, `getRun()`, `getToolCall()`, `getMemory()`. Existing guards that use `ExecutionContext` work unchanged with agents.

**Rationale:** LSP (Liskov Substitution Principle per CLAUDE.md §13.3) — a guard written for `ExecutionContext` must work when handed an `AgentExecutionContext`. Extension preserves this. Per `architecture.md`, dependency direction is `agents → http-decorators` (never reverse).

**Alternatives considered:**
- (a) Separate `AgentContext` without extending `ExecutionContext` — breaks guard reuse; every guard needs two implementations. Rejected: violates DRY and the core value proposition.

**Consequences:** Guards like `RolesGuard` work on both `@Controller` and `@Agent` without modification. Agent-specific guards can narrow to `AgentExecutionContext` for richer context.

### D3 — Tool metadata via @Tool decorator, compiled to defineTool()

**Decision:** `@Tool({ name, description, input: ZodSchema })` stores metadata on the Toolbox class method. The compiler reads this metadata and calls `defineTool()` from `@theokit/sdk`, producing `CustomTool[]` for `Agent.create({ tools })`.

**Rationale:** `defineTool()` already handles Zod → JSON Schema conversion, runtime validation, and type inference. Per Pattern D2 (Zod SSoT from patterns skill), validation schemas must be Zod. The decorator adds NestJS-style declarative ergonomics without changing the runtime.

**Alternatives considered:**
- (a) `@Tool()` has its own validation pipeline — duplicates defineTool's Zod→JSONSchema logic. Rejected: Rule 9.
- (b) No Toolbox class, just functions — loses the namespace grouping and DI injection. Rejected: poor DX for complex tool sets.

**Consequences:** Tool handler return type must be `string | Promise<string>` (SDK constraint from defineTool). Zod schema required per tool (not optional).

### D4 — SSE for agent streaming (not WebSocket)

**Decision:** Agent HTTP endpoints stream responses via Server-Sent Events (SSE). Each `Run.stream()` event maps to an SSE `data:` frame with JSON payload. WebSocket support deferred to M7+.

**Rationale:** SSE is unidirectional (server → client), aligns with the agent response model (agent sends, user waits). SSE auto-reconnects in browsers. WebSocket adds bidirectional complexity not needed for v1. The SDK's `Run.stream()` already yields `AsyncGenerator<SDKMessage>` — perfect for SSE.

**Alternatives considered:**
- (a) WebSocket-first — bidirectional but adds connection management, heartbeat, reconnection logic. Rejected for v1: YAGNI — SSE covers the use case.
- (b) HTTP long-polling — inferior to SSE in every metric. Rejected.

**Consequences:** Real-time tool approval callbacks require a separate mechanism (POST endpoint polled by client, or deferred to WebSocket in M7+).

### D5 — Agent routes auto-generated from @Agent metadata

**Decision:** `@Agent({ name, route })` auto-generates two HTTP endpoints:
- `POST {route}/chat` — send message, receive SSE stream
- `GET {route}/runs/:runId` — get run status/result

The bridge generates these routes at registration time, not via code generation files.

**Rationale:** Mirrors how `@Controller` auto-generates routes from decorator metadata. No generated files to maintain. The pattern is proven by http-decorators' `walkControllerMetadata()`.

**Alternatives considered:**
- (a) Code generation (emit `.ts` files) — adds build step complexity, file drift. Rejected: Pattern D4 from patterns skill recommends avoiding codegen when metadata-walk is sufficient.

**Consequences:** Routes are convention-based (`{route}/chat`, `{route}/runs/:runId`). Custom routes require falling back to `@Controller`.

### D6 — New package, not extension of http-decorators

**Decision:** `@theokit/agents` is a NEW package at `packages/agents/`. It depends on `@theokit/http-decorators` and `@theokit/sdk` but neither depends on it.

**Rationale:** Per `architecture.md` Invariant 2 (zero cycles), the agents package must be a LEAF in the dependency graph. Putting agent decorators inside http-decorators would force http-decorators to depend on the SDK (unwanted coupling). Separate package preserves clean DAG.

**Alternatives considered:**
- (a) Inside http-decorators — couples HTTP layer to SDK. Rejected: violates SRP + forces SDK peerDep on pure HTTP users.
- (b) Sub-path export (`@theokit/http-decorators/agents`) — same coupling problem at npm level. Rejected.

**Consequences:** Users install `@theokit/agents` separately. The package re-exports what it needs from http-decorators (no deep imports — barrel-only per architecture.md Invariant 3).

### D7 — @Toolbox guards apply to ALL tools in the class

**Decision:** `@UseGuards(AdminGuard)` on a `@Toolbox()` class applies the guard to every `@Tool()` method in that class. Method-level `@UseGuards` overrides (same NestJS composition: class-first, method-overrides).

**Rationale:** Mirrors http-decorators' guard composition (EC-9 convention). Tool authorization is the highest-value proposition — RBAC on tool calls. The same `Reflector.getAllAndOverride()` pattern applies.

**Alternatives considered:**
- (a) Guards only at agent level — too coarse; can't protect `refund_customer` differently from `search_tickets`. Rejected.

**Consequences:** Guard execution on tool calls adds latency (~1ms per guard). Acceptable for the security guarantee.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| SDK version coupling — agent package depends on SDK API surface; SDK breaking change breaks agents | Medium | peerDep range `>=1.7.0` with integration test suite that runs against SDK | Implementer |
| Decorator metadata overhead — reflect-metadata adds runtime cost per class registration | Low | Metadata walk happens once at startup, not per-request. Benchmark: http-decorators metadata walk is <5ms for 20 controllers | Implementer |
| SSE reconnection — client must handle stream interruption and resume | Medium | Use `lastEventId` from SDK's `tracked()` envelope pattern (G8 streaming). Document in README | Implementer |
| Tool guard latency — running RBAC guards on every tool call adds per-call overhead | Low | Guards are sync checks (~1ms). Cache guard results per-request via ExecutionContext. Profile in integration tests | Implementer |
| EC-8: Agent.create() is async — first-request latency ~50-200ms with lazy init | Low | Document in README. Eager init via TheoApp.create() absorbs into startup. agentsPlugin lazy-init adds latency to first request only | Implementer |
| EC-9: Guards on @Toolbox see Agent class via getClass(), not Toolbox class | Low | Document: "Use AgentExecutionContext.getToolCall() to identify the specific tool. getClass() returns the Agent class because guards run in the agent's HTTP handler context." | Implementer |

## Unresolved Questions

- Q1 — Should tool approval callbacks use a separate POST endpoint or WebSocket? Deferred to M7+ per D4.
- Q2 — How does agent memory (`@Memory()` decorator) map to SDK's `MemorySettings`? Needs /discover on SDK memory API before implementing M6+.
- Q3 — Should `agentsPlugin()` support `controllersGlob`-style lazy loading via SWC, or is direct class registration sufficient for v1?

## Dependency Graph

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
(scaffold)  (decorators) (pipeline)  (compiler)  (streaming)  (integration)
```

All phases are sequential — each builds on the previous. No parallelization in v1.

---

## Phase 1: Package Scaffold + Types

**Objective:** Create the `@theokit/agents` package with build tooling, types, and metadata keys.

### T1.1 — Package scaffold

#### Objective
Create `packages/agents/` with package.json, tsconfig, tsup, vitest config.

#### Why this step
**Action:** Bootstrap the npm package with correct peerDeps, ESM config, and build pipeline.
**Reasoning:** Every subsequent phase needs a working build. The package structure mirrors `packages/http-decorators/` (proven pattern). Per D6, this is a separate package with clean dependency direction.

#### Evidence
- `packages/http-decorators/package.json` — proven package structure to mirror
- `packages/http-decorators/tsup.config.ts` — build config pattern

#### Files to edit
```
packages/agents/package.json (NEW) — peerDeps: @theokit/sdk, @theokit/http-decorators, reflect-metadata, zod
packages/agents/tsconfig.json (NEW) — strict, experimentalDecorators, emitDecoratorMetadata
packages/agents/tsup.config.ts (NEW) — ESM output, dts, sourcemaps
packages/agents/vitest.config.ts (NEW) — vitest runner config
packages/agents/src/index.ts (NEW) — empty barrel
packages/agents/src/types.ts (NEW) — core type definitions
```

#### Deep file dependency analysis
- No existing files modified. New package only.
- `peerDependencies` link to existing packages without creating compile-time coupling.

#### Deep Dives

**Types to define in `types.ts`:**

```typescript
export interface AgentDefinition {
  name: string
  route: string
  model?: string
  stream?: boolean
  maxIterations?: number
  timeoutMs?: number
}

export interface AgentToolDefinition {
  name: string
  description: string
  input: ZodTypeAny
  risk?: 'low' | 'medium' | 'high'
}

export interface AgentMainLoopOptions {
  strategy?: 'simple-chat' | 'plan-act-reflect' | 'react'
  maxIterations?: number
  timeoutMs?: number
}

export interface AgentContext {
  agent: AgentDefinition
  run: { id: string; startedAt: Date }
  request: IncomingMessage
  response: ServerResponse
}
```

#### Tasks
1. Create `packages/agents/` directory
2. Write `package.json` with peerDeps and ESM config
3. Write `tsconfig.json` extending root config
4. Write `tsup.config.ts` mirroring http-decorators pattern
5. Write `vitest.config.ts`
6. Write `src/types.ts` with core interfaces
7. Write `src/index.ts` barrel
8. Verify `pnpm install` resolves without errors

#### TDD
```
RED:     test_package_builds() — tsup exits 0 and dist/ contains index.js + index.d.ts
RED:     test_types_exported() — import { AgentDefinition } from '@theokit/agents' compiles
GREEN:   Create package files and types
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents build && pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents build` exits 0
- [ ] `test -f packages/agents/dist/index.js && test -f packages/agents/dist/index.d.ts` exits 0
- [ ] `node -e "require('./packages/agents/dist/index.js')"` exits 0 (ESM importable)
- [ ] `tsc --noEmit -p packages/agents/tsconfig.json` exits 0
- [ ] Pass: size — `wc -l packages/agents/src/types.ts` ≤ 100 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents build` exits 0
- [ ] `tsc --noEmit -p packages/agents/tsconfig.json` exits 0

---

## Phase 2: Core Decorators + Metadata

**Objective:** Implement `@Agent`, `@MainLoop`, `@Toolbox`, `@Tool` decorators with metadata storage using the same `setMeta`/`getMeta` pattern from http-decorators.

### T2.1 — Metadata keys + storage

#### Objective
Define Symbol.for metadata keys for agent decorators (mirrors http-decorators/src/metadata/keys.ts pattern).

#### Why this step
**Action:** Create metadata keys and re-export `setMeta`/`getMeta` from http-decorators.
**Reasoning:** All decorators need a shared metadata storage mechanism. Per http-decorators' proven pattern, `Symbol.for()` keys ensure cross-module safety with SWC loader. Reusing http-decorators' `setMeta`/`getMeta` avoids duplication (DRY).

#### Evidence
- `packages/http-decorators/src/metadata/keys.ts` — 10 existing Symbol.for keys, pattern proven
- `packages/http-decorators/src/metadata/storage.ts` — `setMeta`/`getMeta` using Reflect.defineMetadata

#### Files to edit
```
packages/agents/src/metadata/keys.ts (NEW) — Symbol.for keys for agent decorators
packages/agents/src/metadata/index.ts (NEW) — re-export from http-decorators + local keys
```

#### Deep file dependency analysis
- Depends on `@theokit/http-decorators` `setMeta`/`getMeta` — imported via barrel
- No existing files modified

#### Deep Dives

**Metadata keys:**
```typescript
export const AGENT_CONFIG = Symbol.for('theokit:agents:config')
export const AGENT_MAIN_LOOP = Symbol.for('theokit:agents:main-loop')
export const TOOLBOX_CONFIG = Symbol.for('theokit:agents:toolbox')
export const TOOL_CONFIG = Symbol.for('theokit:agents:tool')
export const TOOL_METHODS = Symbol.for('theokit:agents:tool-methods')
export const REQUIRES_APPROVAL = Symbol.for('theokit:agents:requires-approval')
export const REQUIRES_CAPABILITY = Symbol.for('theokit:agents:requires-capability')
export const BUDGET_CONFIG = Symbol.for('theokit:agents:budget')
export const POLICY_CONFIG = Symbol.for('theokit:agents:policy')
export const TRACE_CONFIG = Symbol.for('theokit:agents:trace')
export const AUDIT_CONFIG = Symbol.for('theokit:agents:audit')
```

#### Tasks
1. Create `packages/agents/src/metadata/keys.ts` with all Symbol.for keys
2. Create `packages/agents/src/metadata/index.ts` re-exporting `setMeta`/`getMeta` from http-decorators + local keys
3. Write unit tests

#### TDD
```
RED:     test_metadata_keys_are_unique_symbols() — all keys are Symbol instances with unique descriptions
RED:     test_setmeta_getmeta_reexport() — imported setMeta/getMeta work identically to http-decorators
GREEN:   Implement keys + barrel
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/metadata` exits 0
- [ ] Every key satisfies `typeof key === 'symbol' && Symbol.keyFor(key)?.startsWith('theokit:agents:')`
- [ ] `import { setMeta, getMeta } from '@theokit/agents'` compiles and round-trips metadata
- [ ] Pass: size — `keys.ts` ≤ 50 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0
- [ ] `tsc --noEmit` exits 0

### T2.2 — @Agent decorator

#### Objective
Implement `@Agent({ name, route, model, stream })` class decorator that stores `AgentDefinition` metadata.

#### Why this step
**Action:** Create the primary decorator that marks a class as an AI agent.
**Reasoning:** This is the entry point of the entire system. Like `@Controller()` in http-decorators, `@Agent()` is the class-level decorator that the metadata walker discovers. Per D1, it stores metadata — the compiler reads it later to call `Agent.create()`.

#### Evidence
- `packages/http-decorators/src/decorators/controller.ts` — `@Controller(prefix, opts)` pattern to mirror

#### Files to edit
```
packages/agents/src/decorators/agent.ts (NEW) — @Agent decorator
packages/agents/tests/unit/agent-decorator.test.ts (NEW) — unit tests
```

#### Deep file dependency analysis
- Imports: `setMeta` from local metadata, `AGENT_CONFIG` key
- Exports: `Agent` decorator function, `AgentOptions` interface, `getAgentConfig()` reader

#### Deep Dives

**Decorator signature:**
```typescript
export interface AgentOptions {
  name: string
  route: string
  model?: string
  stream?: boolean
  maxIterations?: number
  timeoutMs?: number
  systemPrompt?: string
}

export function Agent(options: AgentOptions): ClassDecorator {
  return (target: Function) => {
    setMeta(AGENT_CONFIG, target, options)
  }
}

export function getAgentConfig(target: Function): AgentOptions | undefined {
  return getMeta<AgentOptions>(AGENT_CONFIG, target)
}
```

#### Tasks
1. Write `@Agent()` decorator storing metadata via `setMeta`
2. Write `getAgentConfig()` reader
3. Write unit tests

#### TDD
```
RED:     test_agent_stores_config() — getAgentConfig returns the options object
RED:     test_agent_requires_name() — TS compile error if name missing (type check)
RED:     test_agent_defaults() — stream defaults to true, model defaults to undefined
GREEN:   Implement decorator
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-decorator` exits 0
- [ ] `getAgentConfig(DecoratedClass)` returns `{ name: 'test', route: '/api/agents/test' }`
- [ ] `@Agent({})` without `name` or `route` produces TypeScript compile error (`tsc --noEmit` fails)
- [ ] Pass: size — `wc -l packages/agents/src/decorators/agent.ts` ≤ 80 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0
- [ ] `tsc --noEmit` exits 0

### T2.3 — @MainLoop decorator

#### Objective
Implement `@MainLoop({ strategy, maxIterations, timeoutMs })` method decorator.

#### Why this step
**Action:** Mark which method on the agent class is the execution entry point.
**Reasoning:** An agent class may have multiple methods. `@MainLoop()` identifies THE method the runtime invokes when a message arrives. Analogous to `@Get()` identifying a route handler — but there's only one per agent.

#### Evidence
- `packages/http-decorators/src/decorators/methods.ts` — method decorator pattern

#### Files to edit
```
packages/agents/src/decorators/main-loop.ts (NEW) — @MainLoop decorator
packages/agents/tests/unit/main-loop-decorator.test.ts (NEW) — unit tests
```

#### Deep Dives

```typescript
export function MainLoop(options: AgentMainLoopOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    setMeta(AGENT_MAIN_LOOP, actualTarget, { propertyKey, ...options })
  }
}
```

#### Tasks
1. Write `@MainLoop()` decorator
2. Write `getMainLoop()` reader
3. Write unit tests

#### TDD
```
RED:     test_mainloop_stores_method_name() — getMainLoop returns { propertyKey: 'run', ... }
RED:     test_mainloop_default_strategy() — defaults to 'simple-chat'
RED:     test_only_one_mainloop_per_class() — second @MainLoop overwrites (last wins, with console.warn)
GREEN:   Implement decorator
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/main-loop-decorator` exits 0
- [ ] `getMainLoop(AgentClass)` returns `{ propertyKey: 'run', strategy: 'simple-chat' }`
- [ ] Second `@MainLoop()` on same class overwrites first (last-wins) with `console.warn` emitted
- [ ] Pass: size — `wc -l packages/agents/src/decorators/main-loop.ts` ≤ 60 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

### T2.4 — @Toolbox + @Tool decorators

#### Objective
Implement `@Toolbox({ namespace })` class decorator and `@Tool({ name, description, input, risk })` method decorator.

#### Why this step
**Action:** Create the tool grouping and definition decorators.
**Reasoning:** Per D3, `@Tool()` compiles to `defineTool()` from the SDK. The `@Toolbox()` provides namespace grouping and DI injection. `@UseGuards(AdminGuard)` on a Toolbox applies to all tools (D7).

#### Evidence
- `theokit-sdk/packages/sdk/src/define-tool.ts` — `defineTool()` signature to target

#### Files to edit
```
packages/agents/src/decorators/tool.ts (NEW) — @Toolbox + @Tool decorators
packages/agents/tests/unit/tool-decorator.test.ts (NEW) — unit tests
```

#### Deep Dives

```typescript
export interface ToolboxOptions {
  namespace?: string
}

export function Toolbox(options: ToolboxOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(TOOLBOX_CONFIG, target, options)
  }
}

export interface ToolOptions {
  name: string
  description: string
  input: ZodTypeAny
  risk?: 'low' | 'medium' | 'high'
}

export function Tool(options: ToolOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    setMeta(TOOL_CONFIG, actualTarget, options, propertyKey)
    // Accumulate tool methods list
    const existing = getMeta<(string | symbol)[]>(TOOL_METHODS, actualTarget) ?? []
    setMeta(TOOL_METHODS, actualTarget, [...existing, propertyKey])
  }
}
```

#### Tasks
1. Write `@Toolbox()` class decorator
2. Write `@Tool()` method decorator with accumulated methods list
3. Write `getToolboxConfig()`, `getToolMethods()`, `getToolConfig()` readers
4. Write unit tests

#### TDD
```
RED:     test_toolbox_stores_namespace() — getToolboxConfig returns { namespace: 'support' }
RED:     test_tool_stores_config() — getToolConfig returns { name, description, input, risk }
RED:     test_tool_methods_accumulated() — getToolMethods returns ['searchTickets', 'refundCustomer']
RED:     test_tool_with_zod_schema() — input schema is preserved as ZodTypeAny
RED:     test_toolbox_with_guards() — @UseGuards on @Toolbox stores guard metadata (reuses http-decorators)
GREEN:   Implement decorators
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/tool-decorator` exits 0
- [ ] `getToolboxConfig(ToolboxClass)` returns `{ namespace: 'support' }`
- [ ] `getToolMethods(ToolboxClass)` returns `['searchTickets', 'refundCustomer']` (accumulated)
- [ ] `getToolConfig(ToolboxClass, 'searchTickets')` returns `{ name, description, input: ZodTypeAny, risk }`
- [ ] `@UseGuards(Guard)` on `@Toolbox` class stores guard metadata via http-decorators `USE_GUARDS` key
- [ ] Pass: size — `wc -l packages/agents/src/decorators/tool.ts` ≤ 120 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

### T2.5 — Policy + Observability decorators

#### Objective
Implement `@RequiresApproval`, `@RequiresCapability`, `@Budget`, `@Policy`, `@Trace`, `@Audit` decorators.

#### Why this step
**Action:** Create agent-native decorators that don't exist in http-decorators.
**Reasoning:** These are the decorators that differentiate agents from controllers. They use the same `setMeta` pattern but store agent-specific metadata (cost budgets, approval requirements, audit trails). Built with `createDecorator<T>()` from http-decorators where possible.

#### Evidence
- `packages/http-decorators/src/decorators/set-metadata.ts` — `createDecorator<T>()` pattern

#### Files to edit
```
packages/agents/src/decorators/policies.ts (NEW) — @RequiresApproval, @RequiresCapability, @Budget, @Policy
packages/agents/src/decorators/observability.ts (NEW) — @Trace, @Audit
packages/agents/tests/unit/policy-decorators.test.ts (NEW)
packages/agents/tests/unit/observability-decorators.test.ts (NEW)
```

#### Deep Dives

```typescript
// policies.ts — use createDecorator from http-decorators
import { createDecorator } from '@theokit/http-decorators'

export const RequiresApproval = createDecorator<{ reason: string }>()
export const RequiresCapability = createDecorator<string[]>()
export const Budget = createDecorator<{ maxCostUsd: number; window?: 'daily' | 'monthly' }>()
export const Policy = createDecorator<PolicyHandler[]>()

// observability.ts
export const Trace = createDecorator<boolean>()
export const Audit = createDecorator<boolean>()
```

#### Tasks
1. Write policy decorators using `createDecorator<T>()`
2. Write observability decorators
3. Write unit tests for all 6 decorators

#### TDD
```
RED:     test_requires_approval_on_tool() — metadata stored with reason
RED:     test_requires_capability_on_tool() — string[] stored
RED:     test_budget_on_agent_class() — { maxCostUsd, window } stored
RED:     test_budget_tool_overrides_agent() — Reflector.getAllAndOverride works
RED:     test_trace_on_toolbox() — boolean metadata stored
RED:     test_audit_on_tool() — boolean metadata stored
GREEN:   Implement decorators
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/policy-decorators tests/unit/observability-decorators` exits 0
- [ ] `reflector.get(RequiresApproval, ToolboxClass, 'refund')` returns `{ reason: 'Refunds affect billing' }`
- [ ] `reflector.get(RequiresCapability, ToolboxClass, 'refund')` returns `['billing:refund']`
- [ ] `reflector.getAllAndOverride(Budget, AgentClass, 'refund')` returns tool-level override over class-level
- [ ] `reflector.get(Trace, ToolboxClass)` returns `true`
- [ ] `reflector.get(Audit, ToolboxClass, 'refund')` returns `true`
- [ ] Pass: size — `policies.ts` ≤ 60 lines, `observability.ts` ≤ 30 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

---

## Phase 3: Pipeline Reuse + AgentExecutionContext

**Objective:** Make existing `@UseGuards`, `@UseInterceptors`, `@UseFilters`, `@Throttle` work on agents and tools via `AgentExecutionContext`.

### T3.1 — AgentExecutionContext

#### Objective
Create `AgentExecutionContext extends ExecutionContext` with agent-specific methods.

#### Why this step
**Action:** Extend the existing `ExecutionContext` interface so guards and interceptors receive agent-aware context.
**Reasoning:** Per D2 (LSP), `AgentExecutionContext` is a subtype of `ExecutionContext`. Any guard that accepts `ExecutionContext` continues working. Agent-specific guards can narrow to `AgentExecutionContext` for richer context. The dependency direction is correct: `agents → http-decorators`.

#### Evidence
- `packages/http-decorators/src/bridge/execution-context.ts` — interface to extend

#### Files to edit
```
packages/agents/src/bridge/agent-execution-context.ts (NEW)
packages/agents/tests/unit/agent-execution-context.test.ts (NEW)
```

#### Deep Dives

```typescript
import type { ExecutionContext } from '@theokit/http-decorators'
import type { AgentDefinition, AgentToolDefinition } from '../types.js'

export interface AgentExecutionContext extends ExecutionContext {
  getAgent(): AgentDefinition
  getRun(): { id: string; startedAt: Date }
  getToolCall(): AgentToolDefinition | null
  isAgentContext(): true
}

export function createAgentExecutionContext(
  base: ExecutionContext,
  agent: AgentDefinition,
  run: { id: string; startedAt: Date },
  toolCall?: AgentToolDefinition,
): AgentExecutionContext {
  return {
    ...base,
    getAgent: () => agent,
    getRun: () => run,
    getToolCall: () => toolCall ?? null,
    isAgentContext: () => true,
  }
}
```

#### Tasks
1. Define `AgentExecutionContext` interface extending `ExecutionContext`
2. Implement `createAgentExecutionContext()` factory
3. Write tests verifying LSP (a guard accepting `ExecutionContext` receives `AgentExecutionContext`)

#### TDD
```
RED:     test_extends_execution_context() — AgentExecutionContext has getRequest, getResponse, getClass, getMethodName
RED:     test_agent_specific_methods() — getAgent, getRun, getToolCall return correct values
RED:     test_lsp_guard_compatibility() — CanActivate guard works with AgentExecutionContext
RED:     test_is_agent_context_type_guard() — isAgentContext() returns true for narrowing
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-execution-context` exits 0
- [ ] `agentCtx.getRequest()` returns `IncomingMessage` (same as base ExecutionContext)
- [ ] `agentCtx.getAgent()` returns `AgentDefinition` with `name`, `route`
- [ ] `agentCtx.getRun()` returns `{ id: string, startedAt: Date }`
- [ ] `agentCtx.getToolCall()` returns `AgentToolDefinition | null`
- [ ] `agentCtx.isAgentContext()` returns `true` (type guard for narrowing)
- [ ] A guard `implements CanActivate` with `canActivate(ctx: ExecutionContext)` compiles and runs with `AgentExecutionContext` argument (LSP)

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

### T3.2 — Walk agent metadata

#### Objective
Implement `walkAgentMetadata()` that mirrors `walkControllerMetadata()` for agents.

#### Why this step
**Action:** Create the agent metadata walker that collects `@Agent`, `@MainLoop`, tools, guards, interceptors, filters from a decorated agent class.
**Reasoning:** The metadata walker is the bridge between decorators and runtime. Http-decorators' `walkControllerMetadata()` is the proven pattern. The agent version collects the same pipeline metadata (guards, interceptors, filters) PLUS agent-specific metadata (config, main loop, toolboxes).

#### Evidence
- `packages/http-decorators/src/bridge/walk-metadata.ts` — pattern to mirror

#### Files to edit
```
packages/agents/src/bridge/walk-agent-metadata.ts (NEW)
packages/agents/tests/unit/walk-agent-metadata.test.ts (NEW)
```

#### Deep Dives

```typescript
export interface AgentWalkResult {
  agentConfig: AgentOptions
  mainLoop: { propertyKey: string | symbol; options: AgentMainLoopOptions }
  toolboxes: ToolboxWalkResult[]
  guards: Function[]
  interceptors: Function[]
  filters: Function[]
  route: string
}

export interface ToolboxWalkResult {
  namespace: string
  tools: ToolWalkResult[]
  guards: Function[]
}

export interface ToolWalkResult {
  propertyKey: string | symbol
  config: ToolOptions
  guards: Function[]
  approval?: { reason: string }
  capabilities?: string[]
  budget?: { maxCostUsd: number }
  trace: boolean
  audit: boolean
}

export function walkAgentMetadata(AgentClass: Function, toolboxes?: Function[]): AgentWalkResult
```

#### Tasks
1. Implement `walkAgentMetadata()` reading all decorator metadata
2. Collect guards/interceptors/filters from class level (reusing http-decorators metadata keys)
3. Walk toolbox classes and their tools
4. Write comprehensive tests

#### TDD
```
RED:     test_walk_agent_basic() — returns agentConfig, mainLoop, route
RED:     test_walk_agent_with_guards() — class-level @UseGuards collected
RED:     test_walk_toolbox_tools() — tools accumulated with config, guards, policies
RED:     test_walk_tool_with_approval() — @RequiresApproval metadata collected
RED:     test_walk_tool_with_budget() — @Budget metadata collected with override hierarchy
RED:     test_walk_agent_missing_mainloop_throws() — EC-1: @Agent without @MainLoop → descriptive error
RED:     test_walk_agent_duplicate_route_throws() — EC-4: two agents with same route → error at registration
GREEN:   Implement walker
REFACTOR: Extract helpers if > 200 LoC
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/walk-agent-metadata` exits 0
- [ ] `walkAgentMetadata(AgentClass, [ToolboxClass]).agentConfig.name` === `'support-agent'`
- [ ] `result.mainLoop.propertyKey` === `'run'`
- [ ] `result.guards` contains `AuthGuard` (from class-level `@UseGuards`)
- [ ] `result.toolboxes[0].tools.length` matches `@Tool()` count on ToolboxClass
- [ ] Missing `@MainLoop()` → throws descriptive error citing the class name (EC-1)
- [ ] Duplicate route across agents → throws descriptive error (EC-4)
- [ ] Pass: size — `wc -l packages/agents/src/bridge/walk-agent-metadata.ts` ≤ 300 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

---

## Phase 4: Agent Compiler (Decorator → SDK)

**Objective:** Compile `@Agent` + `@Tool` metadata into SDK `Agent.create()` + `defineTool()` calls.

### T4.1 — Tool compiler

#### Objective
Compile `@Tool()` metadata into `defineTool()` calls from `@theokit/sdk`.

#### Why this step
**Action:** Transform tool decorator metadata into the SDK's `CustomTool` objects.
**Reasoning:** Per D3, `@Tool()` is syntactic sugar. The compiler reads metadata from `walkAgentMetadata()` and produces the `CustomTool[]` array that `Agent.create({ tools })` expects. The SDK's `defineTool()` handles Zod → JSON Schema conversion.

#### Evidence
- `theokit-sdk/packages/sdk/src/define-tool.ts` — `defineTool()` API to target

#### Files to edit
```
packages/agents/src/bridge/agent-compiler.ts (NEW)
packages/agents/tests/unit/agent-compiler.test.ts (NEW)
```

#### Deep Dives

```typescript
import { defineTool } from '@theokit/sdk'

export function compileTools(
  toolboxes: ToolboxWalkResult[],
  toolboxInstances: Map<Function, object>,
): CustomTool[] {
  const tools: CustomTool[] = []
  for (const tb of toolboxes) {
    for (const tool of tb.tools) {
      const instance = toolboxInstances.get(tb.class)!
      const handler = (instance as Record<string | symbol, Function>)[tool.propertyKey]
      const name = tb.namespace
        ? `${tb.namespace}.${tool.config.name}`
        : tool.config.name
      tools.push(defineTool({
        name,
        description: tool.config.description,
        inputSchema: tool.config.input,
        handler: (input) => handler.call(instance, input),
      }))
    }
  }
  return tools
}
```

#### Tasks
1. Implement `compileTools()` — toolbox metadata → `defineTool()` calls
2. Handle namespace prefixing
3. Bind handler to toolbox instance (`this` context)
4. Write tests with mock SDK

#### TDD
```
RED:     test_compile_single_tool() — produces CustomTool with correct name, description, handler
RED:     test_compile_namespaced_tools() — namespace.toolName format
RED:     test_handler_bound_to_instance() — handler call preserves `this` context
RED:     test_zod_schema_passed_through() — input schema forwarded to defineTool
RED:     test_compile_missing_toolbox_instance_throws() — EC-3: toolbox not in instances map → descriptive error
RED:     test_compile_tool_empty_schema() — EC-5: z.object({}) compiles correctly, handler receives {}
GREEN:   Implement with instance guard: if (!instance) throw new Error(`Toolbox ${name} not instantiated`)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-compiler` exits 0
- [ ] `compileTools(toolboxes, instances)` returns `CustomTool[]` with `name`, `description`, `handler`
- [ ] Namespaced tool: `name === 'support.search_tickets'` (dot-separated)
- [ ] `handler.call(instance, input)` preserves `this` context — `instance.db` accessible
- [ ] Missing instance in map → throws `Error('Toolbox SupportTools not instantiated')` (EC-3)
- [ ] `z.object({})` input schema compiles without error (EC-5)

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

### T4.2 — Agent compiler

#### Objective
Compile `@Agent` metadata into `Agent.create()` call from `@theokit/sdk`.

#### Why this step
**Action:** Transform agent decorator metadata into an SDK agent instance.
**Reasoning:** Per D1, the decorator is a macro. The compiler assembles `AgentOptions` from metadata (model, systemPrompt, tools) and calls `Agent.create()`. The result is a live SDK agent instance.

#### Evidence
- `theokit-sdk/packages/sdk/src/agent.ts` — `Agent.create()` API

#### Files to edit
```
packages/agents/src/bridge/agent-compiler.ts — add compileAgent()
packages/agents/tests/unit/agent-compiler.test.ts — add tests
```

#### Tasks
1. Implement `compileAgent()` — metadata → `Agent.create()` options
2. Wire compiled tools into agent options
3. Write tests

#### TDD
```
RED:     test_compile_agent_basic() — AgentOptions assembled from @Agent metadata
RED:     test_compile_agent_with_tools() — tools[] from compiled toolboxes
RED:     test_compile_agent_with_system_prompt() — systemPrompt from metadata
RED:     test_compile_agent_no_tools() — EC-7: agent without toolboxes compiles with tools: []
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-compiler` exits 0
- [ ] `compileAgent(metadata)` returns `AgentOptions` with `model`, `systemPrompt`, `tools[]`
- [ ] Agent without toolboxes compiles with `tools: []` (EC-7)

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

---

## Phase 5: SSE Streaming Handler

**Objective:** Create HTTP SSE handler that streams `Run.stream()` events to the client.

### T5.1 — SSE handler

#### Objective
Implement SSE handler that converts `Run.stream()` AsyncGenerator into Server-Sent Events.

#### Why this step
**Action:** Create the HTTP transport layer for agent responses.
**Reasoning:** Per D4, SSE is the v1 transport. `Run.stream()` yields `SDKMessage` events (discriminated union). Each event becomes a `data:` SSE frame with JSON payload. Standard `text/event-stream` content type.

#### Evidence
- SDK `Run.stream()` returns `AsyncGenerator<SDKMessage>`
- G8 streaming shipped SSE encoder in `@theokit/sdk/subscription` — pattern available

#### Files to edit
```
packages/agents/src/bridge/agent-sse-handler.ts (NEW)
packages/agents/tests/unit/agent-sse-handler.test.ts (NEW)
packages/agents/tests/integration/agent-sse-roundtrip.test.ts (NEW)
```

#### Deep Dives

```typescript
export async function streamAgentResponse(
  res: ServerResponse,
  run: { stream(): AsyncGenerator<SDKMessage> },
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  })

  try {
    for await (const event of run.stream()) {
      if (res.destroyed) break // EC-2: client disconnected
      const data = JSON.stringify(event)
      res.write(`event: ${event.type}\ndata: ${data}\n\n`)
    }
  } finally {
    if (!res.destroyed) res.end()
  }
}
```

#### Tasks
1. Implement `streamAgentResponse()` — AsyncGenerator → SSE
2. Handle client disconnect (res.destroyed check)
3. Handle errors mid-stream (send error event, then close)
4. Write unit tests with mock stream
5. Write integration test with real HTTP server

#### TDD
```
RED:     test_sse_headers() — response has text/event-stream, no-cache, keep-alive
RED:     test_sse_event_format() — each SDKMessage becomes event: {type}\ndata: {json}\n\n
RED:     test_sse_client_disconnect() — EC-2: no crash when client drops; res.destroyed check before each write
RED:     test_sse_error_mid_stream() — error event sent, stream closed
RED:     test_sse_roundtrip() — real HTTP server + EventSource client receives events
RED:     test_sse_large_event() — EC-6: single event >1MB written correctly
GREEN:   Implement with res.destroyed guard before every res.write()
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
```
test_sse_concurrent_streams() — 3 parallel clients streaming simultaneously via Promise.all, each receives its own isolated events; assert no cross-contamination between streams
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-sse-handler.test.ts` exits 0
- [ ] SSE response headers: `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`
- [ ] Each SDKMessage yields `event: {type}\ndata: {json}\n\n` format
- [ ] `res.destroyed` checked before every `res.write()` — no ERR_STREAM_WRITE_AFTER_END
- [ ] Error mid-stream produces `event: error\ndata: {json}\n\n` then closes
- [ ] Pass: size — `agent-sse-handler.ts` ≤ 100 lines

#### DoD
- [ ] All SSE tests passing including integration roundtrip
- [ ] `tsc --noEmit` green

---

## Phase 6: Integration (TheoApp + Plugin)

**Objective:** Wire agents into `TheoApp.create({ agents })` and create `agentsPlugin()` for TheoKit dev-server.

### T6.1 — TheoApp agents integration

#### Objective
Add `agents?: Function[]` to `TheoAppOptions` and wire agent lifecycle into TheoApp.

#### Why this step
**Action:** Extend TheoApp.create() to accept agent classes alongside controllers.
**Reasoning:** This is the "eat your own cooking" integration. `TheoApp.create({ controllers, agents })` creates a unified app where HTTP controllers and AI agents coexist, sharing the same guards, interceptors, and DI container.

#### Evidence
- `packages/http-decorators/src/app.ts` — current TheoApp implementation

#### Files to edit
```
packages/http-decorators/src/app.ts — add agents? to TheoAppOptions
packages/agents/src/bridge/agent-route-generator.ts (NEW) — auto-generate agent routes
packages/agents/tests/integration/theo-app-agents.test.ts (NEW)
```

#### Tasks
1. Add `agents?: Function[]` to `TheoAppOptions`
2. In `TheoApp.create()`: walk agent metadata, compile tools, register SSE routes
3. Implement `agent-route-generator.ts` — per D5, auto-generate `POST {route}/chat` + `GET {route}/runs/:runId`
4. Write integration test with TheoApp + agent + controller

#### TDD
```
RED:     test_theoapp_agents_option() — TheoApp.create accepts agents[] without error
RED:     test_agent_route_registered() — POST /agents/support/chat returns 200
RED:     test_agent_sse_stream() — POST /agents/support/chat returns SSE stream
RED:     test_agent_alongside_controller() — both /api/users and /agents/support work
RED:     test_agent_guards_applied() — @UseGuards on agent enforced at HTTP level
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded; TheoApp.create is a synchronous registration step, concurrent requests are handled by Node's event loop without shared mutable state)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/integration/theo-app-agents.test.ts` exits 0
- [ ] `TheoApp.create({ agents: [SupportAgent] })` registers agent routes alongside controller routes
- [ ] `POST /agents/support/chat` returns SSE stream with `content-type: text/event-stream`
- [ ] `@UseGuards(AuthGuard)` on agent enforced — unauthenticated request returns 403
- [ ] Controller routes (`/api/users`) coexist without interference
- [ ] Pass: size — `agent-route-generator.ts` ≤ 200 lines

#### DoD
- [ ] All integration tests passing
- [ ] `tsc --noEmit` green

### T6.2 — agentsPlugin() for TheoKit

#### Objective
Create `agentsPlugin()` mirroring `httpDecoratorsPlugin()` for TheoKit dev-server integration.

#### Why this step
**Action:** Create the TheoKit plugin that mounts agent routes in the dev-server.
**Reasoning:** Mirrors http-decorators' plugin pattern. Structural `{ name, register }` shape per Pattern D6.

#### Evidence
- `packages/http-decorators/src/theokit-plugin.ts` — plugin pattern to mirror

#### Files to edit
```
packages/agents/src/theokit-plugin.ts (NEW)
packages/agents/tests/integration/theokit-plugin.test.ts (NEW)
```

#### Tasks
1. Implement `agentsPlugin({ agents, agentsGlob?, toolboxes })` 
2. Register `onRequest` hook for agent routes
3. Write integration tests

#### TDD
```
RED:     test_plugin_registers_hook() — addHook called with 'onRequest'
RED:     test_plugin_routes_agent() — POST /agents/support/chat handled
RED:     test_plugin_falls_through() — non-agent routes pass through
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/integration/theokit-plugin` exits 0
- [ ] `app.addHook` called with `'onRequest'` exactly once
- [ ] `POST /agents/support/chat` returns `200` with `content-type: text/event-stream`
- [ ] `GET /api/non-agent` falls through (plugin returns without writing response)
- [ ] Pass: size — `wc -l packages/agents/src/theokit-plugin.ts` ≤ 200 lines

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

### T6.3 — Agent manifest generation

#### Objective
Generate `.theokit/agents.manifest.json` from decorated agent classes.

#### Why this step
**Action:** Create the build-time manifest that describes all agents, tools, guards, and policies.
**Reasoning:** The manifest feeds CLI commands (`theokit agents list/inspect`), TheoCloud deploy, and UI agent consoles. Same pattern as `.theo/services.json` for the TheoCloud adapter.

#### Files to edit
```
packages/agents/src/manifest/agent-manifest.ts (NEW)
packages/agents/tests/unit/agent-manifest.test.ts (NEW)
```

#### Tasks
1. Implement `generateAgentManifest(agents, toolboxes)` → JSON
2. Write tests verifying manifest structure

#### TDD
```
RED:     test_manifest_structure() — JSON has agents[], each with name, route, tools[], guards[]
RED:     test_manifest_tool_details() — each tool has name, risk, approval, capabilities
RED:     test_manifest_serializable() — JSON.stringify succeeds (no circular refs, no Functions)
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test -- tests/unit/agent-manifest` exits 0
- [ ] `JSON.parse(generateAgentManifest(agents, toolboxes))` succeeds (valid JSON, no circular refs)
- [ ] `manifest.agents[0].name === 'support-agent'` and `manifest.agents[0].route === '/api/agents/support'`
- [ ] `manifest.agents[0].tools[0].name === 'support.search_tickets'` with `risk: 'low'`
- [ ] Tools with `@RequiresApproval` have `approval: true` in manifest

#### DoD
- [ ] `pnpm --filter @theokit/agents test` exits 0

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | @Agent decorator | T2.2 | Class decorator storing AgentOptions metadata |
| 2 | @MainLoop decorator | T2.3 | Method decorator identifying execution entry point |
| 3 | @Toolbox + @Tool decorators | T2.4 | Tool grouping + definition, compiled to defineTool() |
| 4 | @RequiresApproval, @RequiresCapability, @Budget, @Policy | T2.5 | Agent-native policy decorators via createDecorator |
| 5 | @Trace, @Audit | T2.5 | Observability decorators via createDecorator |
| 6 | AgentExecutionContext extends ExecutionContext | T3.1 | LSP-compliant extension for agent guards |
| 7 | Pipeline reuse (Guards, Interceptors, Filters on agents) | T3.1 + T3.2 | Same metadata keys + AgentExecutionContext |
| 8 | @Tool() → defineTool() compilation | T4.1 | Compiler bridges decorator metadata to SDK API |
| 9 | @Agent() → Agent.create() compilation | T4.2 | Compiler bridges decorator metadata to SDK API |
| 10 | SSE streaming for agent responses | T5.1 | Run.stream() → text/event-stream |
| 11 | TheoApp.create({ agents }) | T6.1 | Unified app with controllers + agents |
| 12 | agentsPlugin() for TheoKit | T6.2 | Dev-server plugin |
| 13 | Agent manifest | T6.3 | Build-time JSON manifest |

**Coverage: 13/13 gaps covered (100%)**

## Global Definition of Done

- [ ] All 6 phases completed
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green (≥ 47 tests)
- [ ] Zero type errors — `tsc --noEmit` on agents package
- [ ] Zero lint warnings — `pnpm --filter @theokit/agents lint`
- [ ] File-size budget respected — every file ≤ 500 LoC
- [ ] CHANGELOG.md updated under `[Unreleased]` with `Added` entries
- [ ] Backward compatibility — http-decorators tests still pass (199/199)
- [ ] SDK not modified — all interaction via peerDep consumer pattern
- [ ] `@UseGuards`, `@UseInterceptors`, `@UseFilters`, `@Throttle` work on agents and tools
- [ ] SSE streaming works end-to-end in integration test
- [ ] Agent manifest generates valid JSON
- [ ] README.md with usage examples

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| LLM provider (via SDK) | API key missing or invalid | Mock SDK to throw `AuthenticationError` | Exception filter catches, returns 401 JSON |
| LLM provider (via SDK) | Rate limit (429) | Mock SDK to yield error event | SSE error event sent to client with retry-after |
| SSE stream | Client disconnects mid-stream | Close HTTP connection during stream | Server-side for-await exits cleanly, no crash |
| Tool execution | Tool handler throws | Mock tool handler to throw Error | Tool result event with `is_error: true` |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the entire agents package works end-to-end.

### Execution

```bash
pnpm --filter @theokit/agents test          # unit + integration tests
pnpm --filter @theokit/agents build         # dist output
tsc --noEmit -p packages/agents/tsconfig.json  # type check
pnpm --filter @theokit/http-decorators test # regression check (199 tests stay green)
```

### Acceptance Criteria

- [ ] All test suites green (≥ 47 tests)
- [ ] Coverage ≥ 90% on all source files
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] http-decorators regression: 199/199 GREEN
- [ ] SSE roundtrip works in integration test
- [ ] Manifest generates valid JSON
- [ ] TheoApp.create({ agents }) works alongside controllers
