# Plan: Production Readiness — Health Endpoints + Multi-Agent Orchestration Runtime

> **Version 1.1** (2026-06-10) — Absorbed 5 edge cases from
> [`reviews/production-readiness-gaps-edge-cases-2026-06-10.md`](../reviews/production-readiness-gaps-edge-cases-2026-06-10.md).
> **2 MUST FIX absorbed inline:** EC-1 (`delegate()` must auto-instantiate toolbox
> classes — added toolbox handling to T2.1), EC-2 (`DoneEvent` type missing `cost`
> field — added `cost?: number` to `agent-stream-events.ts` as pre-req in T2.1).
> **2 SHOULD TEST added:** EC-3 (sync-throw readiness check — test in T1.1),
> EC-4 (`crypto.randomUUID()` for session ID instead of `Date.now()` — test in T2.1).
> **1 DOCUMENT acknowledged:** EC-5 (health endpoint info disclosure — accepted risk).
>
> **Version 1.0** (2026-06-10) — Implementar 2 gaps críticos de production readiness: (1) endpoints GET /health e GET /ready built-in no TheoApp, (2) runtime de execução para @SubAgents (agent-to-agent calls com budget propagation). Nota: graceful shutdown e server-routes HMR já estão implementados — não são gaps.

## Goal

> Ship built-in health/readiness probe endpoints and a multi-agent orchestration runtime so that TheoKit apps are K8s-deployable and agents can delegate to sub-agents, measured by `GET /health` returning 200 in the default template AND `npx vitest run` passing 20+ new tests covering both features.

## Context

Gap analysis (2026-06-10) comparou TheoKit contra Next.js, NestJS, Hono, Fastify. Dois gaps bloqueiam adoção produção:

1. **Health/Ready endpoints** — K8s não pode determinar readiness sem `GET /health` (liveness) e `GET /ready` (readiness). Hoje, o framework tem CSRF readiness (`/__theo/csrf-readiness`) e healthcheck poller para services, mas nenhum endpoint de saúde do app principal. Score: 1.5/5.

2. **Multi-agent orchestration** — `@SubAgents` decorator existe e compila para SDK's `agents` map, mas não há runtime que execute sub-agents, propague budget, ou retorne resultado ao parent. Score: 2/5.

**Itens descartados (já implementados):**
- Graceful shutdown: `packages/theo/src/cli/commands/start/graceful-shutdown.ts` (73 LoC) — SIGTERM/SIGINT + agent eviction + storage drain + 25s timeout.
- Server routes HMR: `packages/theo/src/vite-plugin/server-routes-hmr.ts` (84 LoC) — 50ms debounce + module invalidation + full-reload.

**Rules consultadas:** `architecture.md` (dependency direction — health endpoints em `server/`, orchestration em `agents/`), `testing.md` (TDD obrigatório).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/http-decorators/src/app.ts` | 434 | `264449e` (2026-06-10) | TheoApp class — auto-wires controllers + agents + routes | listen/close/handleRequest public API |
| `packages/http-decorators/tests/integration/theo-app.test.ts` | ~80 | `e0228e5` (2026-06-10) | TheoApp integration tests | Existing test patterns |
| `packages/http-decorators/tests/unit/health-endpoints.test.ts` (NEW) | 0 | — | Health endpoint tests | — |
| `packages/agents/src/bridge/agent-compiler.ts` | 130 | `8ca8411` (2026-06-10) | Compiles agent metadata into SDK-compatible options | `compileSubAgents()` returns `Record<string, CompiledSubAgent>` |
| `packages/agents/src/bridge/agent-orchestrator.ts` (NEW) | 0 | — | Multi-agent orchestration runtime | — |
| `packages/agents/src/bridge/agent-stream-events.ts` | ~150 | `8ca8411` (2026-06-10) | 14 typed SSE events (discriminated union) | EC-2: `DoneEvent` missing `cost` field — must add `cost?: number` |
| `packages/agents/src/bridge/llm-runner.ts` | ~180 | `264449e` (2026-06-10) | Real LLM runner with OpenRouter streaming | `createRealAgentStream()` signature |
| `packages/agents/tests/unit/agent-orchestrator.test.ts` (NEW) | 0 | — | Orchestrator tests | — |
| `packages/agents/src/bridge/index.ts` | ~20 | `e0228e5` (2026-06-10) | Bridge barrel export | Must export new orchestrator |
| `packages/agents/src/index.ts` | ~15 | `8ca8411` (2026-06-10) | Root barrel | Must export orchestrator |

### Current callers / dependents

- **Symbol:** `TheoApp.handleRequest()` in `app.ts`
  - **Callers (production):** Internal only (called by the node adapter via `createServer`)
  - **Callers (tests):** `theo-app.test.ts`

- **Symbol:** `compileSubAgents()` in `agent-compiler.ts`
  - **Callers (production):** `compileAgent()` in same file
  - **Callers (tests):** `agent-compiler.test.ts`, `walk-agent-metadata.test.ts`

- **Symbol:** `createRealAgentStream()` in `llm-runner.ts`
  - **Callers (production):** `TheoApp.autoWireAgents()` in `app.ts`
  - **Callers (tests):** None directly (tested via TheoApp integration)

### Domain glossary

- **Liveness probe** — K8s sends `GET /health` periodically; 200=alive, non-200=restart pod
- **Readiness probe** — K8s sends `GET /ready`; 200=accept traffic, non-200=remove from rotation
- **Sub-agent** — an agent invoked by another agent mid-conversation to handle a sub-task
- **Budget propagation** — parent agent's remaining budget passed to sub-agent; sub-agent cannot exceed it
- **Tool sharing** — sub-agent can access parent's compiled tools

### Architecture boundaries affected

- **Health endpoints** — added to `packages/http-decorators/src/app.ts` (TheoApp) — within allowed module
- **Orchestrator** — added to `packages/agents/src/bridge/` — within allowed module (agents → http-decorators unidirectional)
- **No new cross-package dependencies** — orchestrator uses existing `createRealAgentStream` within agents package

## Prior Art & Related Work

- **NestJS `@nestjs/terminus`** — health check module with `HealthCheckService.check([...indicators])` pattern. Indicators are composable (DB, Redis, HTTP). TheoKit adapts the indicator pattern but without a separate package.
- **Fastify `@fastify/under-pressure`** — monitors event loop lag + memory. Beyond scope here (YAGNI).
- **OpenAI Swarm** — multi-agent orchestration via handoffs. Agent returns `{ agent: nextAgent }` to transfer control. Simple, no budget tracking.
- **Anthropic multi-agent** — tool-use pattern where one agent's tool calls another agent. Budget is per-conversation. TheoKit adapts this pattern with per-sub-agent budget limits.

## Objective

- [ ] Add `GET /health` endpoint to TheoApp returning `{ status: 'ok', uptime, version }`
- [ ] Add `GET /ready` endpoint with optional readiness checks (DB, agents, custom)
- [ ] Make health endpoints configurable (enable/disable, custom path)
- [ ] Add `AgentOrchestrator.delegate()` runtime that invokes sub-agents
- [ ] Budget propagation: parent's remaining budget caps sub-agent spend
- [ ] Tool sharing: sub-agent inherits parent's compiled tools
- [ ] Result collection: parent receives sub-agent's final text + tool results
- [ ] 20+ new tests covering both features

## ADRs

### D1 — Health endpoints as built-in TheoApp routes (not plugin)

**Decision:** Health and readiness endpoints are built into TheoApp, mounted automatically unless disabled via config. Paths are `/__theo/health` and `/__theo/ready` (under the `__theo` namespace like CSRF readiness).

**Rationale:** Every production deployment needs these. Making them opt-in via plugin means most users forget. The `__theo` prefix avoids collision with user routes. Per KISS (Princípio 10) — an `if` in handleRequest is simpler than a plugin.

**Alternatives considered:**
- *Separate `@theokit/health` plugin* — rejected: extra dependency for a 20-line feature; violates "batteries included" DX.
- *User-space route (`server/routes/health.ts`)* — rejected: users must remember to create it; not standardized; K8s expects a consistent path.

**Consequences:** TheoApp always reserves `/__theo/health` and `/__theo/ready`. Users who want custom health logic add readiness checks via `TheoApp.create({ readinessChecks: [...] })`.

### D2 — Readiness checks as async functions (indicator pattern)

**Decision:** Readiness checks are async functions `() => Promise<{ name: string; healthy: boolean; message?: string }>`. TheoApp runs them in parallel on `GET /ready` and returns 200 only if ALL pass.

**Rationale:** NestJS terminus pattern (indicator-based) is proven. Pure functions are testable without DI. Parallel execution keeps latency low. Per DIP (Princípio 13.5) — checks are interfaces, not concrete classes.

**Alternatives considered:**
- *Sequential checks with short-circuit* — rejected: first failing check hides subsequent failures; parallel gives full picture.
- *Singleton health registry* — rejected: adds state; functions are simpler.

**Consequences:** Users write `readinessChecks: [checkDb, checkRedis, checkAgents]` in TheoApp config.

### D3 — Agent orchestrator as `delegate()` function (not class)

**Decision:** Multi-agent orchestration is a `delegate(subAgentClass, message, opts)` function that creates a sub-agent stream, collects its output, and returns the result to the parent. Not a separate `Orchestrator` class.

**Rationale:** The parent agent already has the context (budget, tools, session). A function that borrows these and runs a sub-agent is KISS. An Orchestrator class would add state management that duplicates TheoApp's existing agent wiring. Per YAGNI (Princípio 11) — start with the simplest primitive; upgrade to a class if 3+ patterns emerge.

**Alternatives considered:**
- *Full `Orchestrator` class with supervisor pattern* — rejected: over-engineering for v1; OpenAI Swarm proved that simple handoffs cover 80% of use cases.
- *Tool-based delegation (sub-agent as a tool)* — considered viable; may add later. But direct delegation is more explicit.

**Consequences:** Parent agent calls `await delegate(ResearchAgent, 'find papers on X', { budget: 0.50 })`. The result is a string (sub-agent's final response) + tool call log.

### D4 — Budget propagation via clamping (not inheritance)

**Decision:** Sub-agent budget is `min(parent_remaining_budget, explicit_sub_budget)`. If parent has $1.00 remaining and sub-agent requests $2.00, sub-agent gets $1.00.

**Rationale:** Prevents budget overruns. Parent always controls total spend. Per fail-fast (Princípio 8) — sub-agent hitting budget limit is an explicit error, not a silent truncation.

**Alternatives considered:**
- *Shared budget pool (parent + sub share one counter)* — rejected: race condition when multiple sub-agents run; hard to audit per-agent spend.
- *No budget propagation (sub-agent ignores parent)* — rejected: cost control is a production requirement; ignoring it defeats the purpose of @Budget.

**Consequences:** `delegate()` accepts optional `budget` param. If omitted, sub-agent inherits parent's full remaining budget.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Health endpoints add 2 routes to every TheoApp — slight overhead per request (path check) | Low | Early return before full routing; `/__theo` prefix checked before controller routes | Dev |
| Readiness checks that are slow (e.g., DB ping) block `GET /ready` response | Medium | 5s timeout per check; parallel execution; timeout returns `healthy: false` | Dev |
| Sub-agent delegation creates nested LLM calls — cost can compound | High | Budget clamping (D4); sub-agent budget logged in parent's cost tracker | Dev |
| Sub-agent streaming adds complexity to the main loop — harder to debug | Medium | Delegation result is a simple string + tool log; no nested SSE streams | Dev |

## Unresolved Questions

(none — every decision is resolved at plan time. Health endpoint pattern is well-established. Delegation pattern is minimal by design.)

## Dependency Graph

```
Phase 1 (Health) ──▶ Phase 2 (Orchestrator) ──▶ Phase 3 (Integration)
```

Phase 1 and Phase 2 could parallelize but are sequential for simplicity — Phase 1 is smaller and proves the TheoApp extension pattern used by Phase 2.

---

## Phase 1: Health & Readiness Endpoints

**Objective:** Add `GET /__theo/health` and `GET /__theo/ready` to TheoApp with configurable readiness checks.

### T1.1 — Add health/ready endpoints to TheoApp

#### Objective
Mount `/__theo/health` (liveness) and `/__theo/ready` (readiness) as built-in routes in TheoApp.handleRequest().

#### Why this step (action + reasoning)

**Action:** Add two route checks at the top of `handleRequest()` in `app.ts`, before controller/agent routing. `GET /__theo/health` returns `{ status: 'ok', uptime: process.uptime(), timestamp: Date.now() }`. `GET /__theo/ready` runs all registered readiness checks in parallel and returns 200 only if all pass, 503 otherwise.

**Reasoning:** Per D1, these are built-in (not plugins) because every K8s deployment needs them. The `__theo` prefix is already established by CSRF readiness (`/__theo/csrf-readiness`). Adding them at the top of handleRequest ensures minimal latency — no guard/interceptor overhead.

#### Evidence
- `app.ts:264` — `handleRequest()` already checks `request.method === 'GET'` for frontend HTML serving (same pattern)
- `app.ts:266-271` — Frontend HTML check is the precedent for built-in route interception
- No `/__theo/health` route exists today (grep confirmed)

#### Files to edit
```
packages/http-decorators/src/app.ts — add health/ready route handling in handleRequest(), add readinessChecks to TheoAppOptions
packages/http-decorators/tests/unit/health-endpoints.test.ts (NEW) — health endpoint tests
```

#### Deep file dependency analysis
- `app.ts` (434 LoC) — adding ~40 LoC for health routes. Total stays under 500 LoC budget.
- `TheoAppOptions` interface (L18-35) — adds `readinessChecks?: ReadinessCheck[]`
- `handleRequest()` (L264) — adds early return for `/__theo/health` and `/__theo/ready` before controller routing
- Downstream: no other file calls `handleRequest` directly (it's the node adapter callback)

#### Deep Dives
- `ReadinessCheck` type: `() => Promise<{ name: string; healthy: boolean; message?: string }>`
- Health response: `{ status: 'ok', uptime: number, timestamp: number }`
- Ready response: `{ status: 'ready'|'not_ready', checks: ReadinessCheckResult[] }`
- Timeout: 5s per check via `Promise.race([check(), timeout(5000)])`
- Non-200 on not ready: 503 Service Unavailable

#### Pseudo-code / Signatures

```typescript
// In TheoAppOptions
interface TheoAppOptions {
  // ... existing
  readinessChecks?: ReadinessCheck[]
  healthPath?: string   // default: '/__theo/health'
  readyPath?: string    // default: '/__theo/ready'
}

type ReadinessCheck = () => Promise<{ name: string; healthy: boolean; message?: string }>

// In handleRequest(), before controller/agent routing:
if (method === 'GET' && pathname === this.healthPath) {
  return jsonResponse(200, { status: 'ok', uptime: process.uptime(), timestamp: Date.now() })
}
if (method === 'GET' && pathname === this.readyPath) {
  const results = await Promise.all(this.readinessChecks.map(runWithTimeout))
  const allHealthy = results.every(r => r.healthy)
  return jsonResponse(allHealthy ? 200 : 503, { status: allHealthy ? 'ready' : 'not_ready', checks: results })
}
```

#### Tasks
1. Add `ReadinessCheck` type and `readinessChecks` option to `TheoAppOptions`
2. Add `healthPath` and `readyPath` to TheoApp constructor (with defaults)
3. Add health/ready route handling at top of `handleRequest()`
4. Add 5s timeout wrapper for readiness checks
5. Store `startTime` on TheoApp for uptime calculation

#### TDD
```
RED:     test_health_returns_200_ok() — GET /__theo/health returns { status: 'ok', uptime: number }
RED:     test_health_custom_path() — health at custom path returns 200
RED:     test_ready_all_healthy() — GET /__theo/ready with 2 passing checks returns 200
RED:     test_ready_one_failing() — GET /__theo/ready with 1 failing check returns 503
RED:     test_ready_no_checks() — GET /__theo/ready with no checks returns 200 (vacuously ready)
RED:     test_ready_check_timeout() — check that takes 10s times out at 5s and reports unhealthy
RED:     test_health_does_not_trigger_guards() — health endpoint bypasses @UseGuards
RED:     test_ready_check_sync_throw() — (EC-3) readiness check that throws synchronously returns { healthy: false } instead of crashing server
GREEN:   Implement health/ready in handleRequest (wrap each check in try-catch)
REFACTOR: Extract health handling into private method if handleRequest exceeds complexity
VERIFY:  cd packages/http-decorators && npx vitest run tests/unit/health-endpoints.test.ts
```

#### Concurrency tests
```
test_ready_checks_run_parallel() — 2 checks each taking 1s; total time < 1.5s (parallel, not sequential)
```

#### Acceptance Criteria
- [ ] `GET /__theo/health` returns 200 with `{ status: 'ok', uptime, timestamp }`
- [ ] `GET /__theo/ready` returns 200 when all checks pass, 503 when any fails
- [ ] Readiness checks run in parallel with 5s timeout
- [ ] Health endpoints bypass guards/interceptors
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `app.ts` ≤ 500 LoC
- [ ] Pass: coverage — 100% on health endpoint code paths

#### DoD
- [ ] 7+ tests pass — `npx vitest run tests/unit/health-endpoints.test.ts`
- [ ] Zero type errors — `npx tsc --noEmit`
- [ ] TheoApp existing tests still pass (201 total)

---

## Phase 2: Multi-Agent Orchestration Runtime

**Objective:** Add `delegate()` function that lets a parent agent invoke a sub-agent and receive its result.

### T2.1 — Implement AgentOrchestrator.delegate()

#### Objective
Create a `delegate()` function that runs a sub-agent with budget clamping, tool sharing, and result collection.

#### Why this step (action + reasoning)

**Action:** Create `packages/agents/src/bridge/agent-orchestrator.ts` with a `delegate()` function. It takes a sub-agent class + message + options, creates a stream via `createRealAgentStream`, collects all text_delta events into a response string, and returns `{ response: string, toolCalls: ToolCallLog[], cost: number }`.

**Reasoning:** Per D3, a function is KISS — no class state. Per D4, budget is clamped to parent's remaining. The function reuses existing `createRealAgentStream` (no new LLM integration code). Sub-agent inherits parent's compiled tools via the `compileAgent` chain.

#### Evidence
- `agent-compiler.ts:compileSubAgents()` already extracts sub-agent configs
- `llm-runner.ts:createRealAgentStream()` already creates LLM streams with tool calling
- `walk-agent-metadata.ts:175` already walks `subAgentClasses`
- `app.ts:autoWireAgents()` already wires sub-agents into the parent's compiled options

#### Files to edit
```
packages/agents/src/bridge/agent-stream-events.ts — (EC-2) add cost?: number to DoneEvent interface
packages/agents/src/bridge/agent-orchestrator.ts (NEW) — delegate() function with toolbox auto-instantiation (EC-1)
packages/agents/src/bridge/index.ts — export delegate
packages/agents/src/index.ts — re-export from bridge
packages/agents/tests/unit/agent-orchestrator.test.ts (NEW) — orchestrator tests
```

#### Deep file dependency analysis
- `agent-orchestrator.ts` (NEW) — imports `walkAgentMetadata`, `compileAgent`, `createRealAgentStream` from same package
- `index.ts` barrel — adds `delegate` export; no existing callers affected
- `llm-runner.ts` — `createRealAgentStream` already public; used by TheoApp.autoWireAgents

#### Deep Dives
- `delegate()` signature: `async delegate(SubAgentClass, message, opts?) => DelegationResult`
- `DelegationResult`: `{ response: string, toolCalls: { name: string, input: unknown, output: string }[], cost: number, tokens: number }`
- Budget clamping: `effectiveBudget = Math.min(opts.budget ?? Infinity, parentRemainingBudget)`
- Tool sharing: sub-agent's `compiledTools` merged with parent's tools (sub-agent's take precedence on name collision)
- Stream consumption: async iterator collected into response string + tool call log
- Error handling: sub-agent errors wrapped in `DelegationError` (typed, not generic)

#### Pseudo-code / Signatures

```typescript
export interface DelegateOptions {
  budget?: number          // max USD for this sub-agent call
  parentBudgetRemaining?: number  // parent's remaining budget (for clamping)
  parentTools?: CompiledTool[]    // parent's tools (for sharing)
  apiKey?: string          // LLM API key (inherited from parent)
  sessionId?: string       // isolation: sub-agent gets its own session
}

export interface DelegationResult {
  response: string
  toolCalls: { name: string; input: unknown; output: string }[]
  cost: number
  tokens: number
}

export async function delegate(
  SubAgentClass: Function,
  message: string,
  opts: DelegateOptions = {},
): Promise<DelegationResult> {
  // 1. Walk + compile sub-agent (EC-1: auto-instantiate toolboxes)
  const walk = walkAgentMetadata(SubAgentClass, [])
  const toolboxInstances = new Map(walk.toolboxes.map(tb => [tb.class, new (tb.class as new () => object)()]))
  const compiled = compileAgent(walk, toolboxInstances)
  
  // 2. Merge parent tools (parent tools + sub-agent tools, sub wins on collision)
  const allTools = [...(opts.parentTools ?? []), ...compiled.tools]
  
  // 3. Budget clamping (D4)
  const budget = Math.min(opts.budget ?? Infinity, opts.parentBudgetRemaining ?? Infinity)
  
  // 4. Create stream + collect (EC-4: randomUUID for session isolation)
  const stream = createRealAgentStream(walk, allTools, opts.apiKey ?? '', walk.agentConfig.model)
  const iter = stream(message, opts.sessionId ?? `sub-${crypto.randomUUID()}`)
  
  let response = ''
  const toolCalls: { name: string; input: unknown; output: string }[] = []
  let cost = 0, tokens = 0
  
  for await (const event of iter) {
    if (event.type === 'text_delta') response += event.content
    if (event.type === 'tool_result') toolCalls.push({ name: event.toolName, input: event.input, output: event.output })
    if (event.type === 'done') { cost = event.cost ?? 0; tokens = event.usage?.totalTokens ?? 0 }
  }
  
  if (cost > budget) throw new BudgetExceededError(SubAgentClass.name, cost, budget)
  
  return { response, toolCalls, cost, tokens }
}
```

#### Tasks
1. (EC-2) Add `cost?: number` to `DoneEvent` interface in `agent-stream-events.ts`
2. Create `agent-orchestrator.ts` with `delegate()`, `DelegateOptions`, `DelegationResult`
3. (EC-1) Auto-instantiate toolbox classes: `new Map(walk.toolboxes.map(tb => [tb.class, new tb.class()]))`
4. (EC-4) Use `crypto.randomUUID()` for sub-agent session IDs (not `Date.now()`)
5. Add `BudgetExceededError` class
6. Implement stream collection (text_delta → response, tool_result → log, done → cost)
7. Implement budget clamping (D4)
8. Implement tool sharing (merge parent + sub tools)
9. Export from `bridge/index.ts` and root `index.ts`

#### TDD
```
RED:     test_delegate_returns_response() — delegate to mock agent, assert response string collected
RED:     test_delegate_collects_tool_calls() — assert tool call log captured
RED:     test_delegate_budget_clamping() — parent has $1, sub requests $2, effective = $1
RED:     test_delegate_budget_exceeded_throws() — sub-agent cost exceeds budget → BudgetExceededError
RED:     test_delegate_tool_sharing() — parent tools available to sub-agent
RED:     test_delegate_tool_collision_sub_wins() — same tool name → sub-agent's version used
RED:     test_delegate_own_session() — sub-agent gets isolated session ID
RED:     test_delegate_error_propagation() — sub-agent stream error → DelegationError
RED:     test_delegate_no_api_key() — missing key → error with clear message
RED:     test_delegate_concurrent_isolated_sessions() — (EC-4) two concurrent delegates get unique session IDs (no Date.now() collision)
RED:     test_delegate_auto_instantiates_toolboxes() — (EC-1) sub-agent toolbox classes auto-instantiated without DI
GREEN:   Implement delegate()
REFACTOR: Extract stream collection into helper if delegate exceeds 50 lines
VERIFY:  cd packages/agents && npx vitest run tests/unit/agent-orchestrator.test.ts
```

#### Concurrency tests
(none — single-threaded; delegate is sequential by design — parent awaits sub-agent completion)

#### Acceptance Criteria
- [ ] `delegate()` returns complete response from sub-agent
- [ ] Budget clamping works: `min(parent_remaining, sub_budget)`
- [ ] Tool sharing: sub-agent can use parent's tools
- [ ] `BudgetExceededError` thrown when cost exceeds budget
- [ ] Isolated session per delegation (no cross-contamination)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `agent-orchestrator.ts` ≤ 150 LoC
- [ ] Pass: coverage — 100% on delegate() code paths

#### DoD
- [ ] 9+ tests pass — `npx vitest run tests/unit/agent-orchestrator.test.ts`
- [ ] Zero type errors — `npx tsc --noEmit`
- [ ] Agents existing tests still pass (186 total)

---

## Phase 3: Integration Validation (MANDATORY)

**Objective:** Validate all changes work together — full build, full test suite, type check.

### Execution

```bash
turbo run build --filter='./packages/*' --force   # all packages build
turbo run test --filter='./packages/*'             # all tests GREEN
npx tsc --noEmit                                   # zero type errors
pnpm lint                                          # zero lint warnings
```

### Acceptance Criteria

- [ ] All test suites green (agents 186+ → 195+ with orchestrator tests; http-decorators 201+ → 208+ with health tests)
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] `GET /__theo/health` works in the default template (`npx tsx packages/create-theo/templates/default/app.ts`)
- [ ] `delegate()` exported from `@theokit/agents` barrel

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures
3. Re-run validation chain
4. Pre-existing issues documented in PR description

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | GET /health (liveness probe) | T1.1 | `/__theo/health` returns 200 + uptime |
| 2 | GET /ready (readiness probe) | T1.1 | `/__theo/ready` runs checks, returns 200/503 |
| 3 | Configurable health paths | T1.1 | `healthPath`/`readyPath` in TheoAppOptions |
| 4 | Readiness check timeout | T1.1 | 5s timeout per check |
| 5 | Multi-agent delegate() | T2.1 | `delegate(SubAgentClass, message, opts)` |
| 6 | Budget propagation | T2.1 | `min(parent_remaining, sub_budget)` clamping |
| 7 | Tool sharing | T2.1 | Parent tools merged into sub-agent |
| 8 | Result collection | T2.1 | `DelegationResult` with response + toolCalls + cost |
| 9 | DoneEvent cost field (EC-2) | T2.1 | `cost?: number` added to `DoneEvent` type |
| 10 | Toolbox auto-instantiation (EC-1) | T2.1 | `delegate()` auto-instantiates without DI |
| 11 | Session ID uniqueness (EC-4) | T2.1 | `crypto.randomUUID()` replaces `Date.now()` |
| 12 | Sync-throw readiness check (EC-3) | T1.1 | try-catch wrapper per check |
| 13 | Integration validation | Phase 3 | Full build + test + typecheck chain |

**Coverage: 13/13 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `turbo run test --filter='./packages/*'` green
- [ ] Zero type errors — `npx tsc --noEmit`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Health endpoints documented in getting-started.md
- [ ] `delegate()` exported and documented

## Failure scenarios

(none — no external I/O touched. Health endpoints are pure HTTP responses. Delegation reuses existing LLM runner. Readiness checks are user-provided functions with timeout.)

## Final Phase: Integration Validation

> See Phase 3 above — same section.
