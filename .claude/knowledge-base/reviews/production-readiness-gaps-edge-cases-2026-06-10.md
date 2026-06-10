# Edge Case Review — production-readiness-gaps

Date: 2026-06-10
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: delegate() calls compileAgent() without toolbox instances — tools with `this` binding throw

- **Affected task:** T2.1
- **Family:** State
- **Scenario:** `delegate()` pseudo-code calls `compileAgent(walk)` without passing `toolboxInstances`. `compileTools()` (agent-compiler.ts:31) requires a `Map<Function, object>` of instantiated toolbox classes. When a sub-agent's `@Toolbox` class uses `this.someService`, the compiled tool handler throws because the instance is not provided.
- **Impact:** Any sub-agent with injected services in its toolbox silently fails — `compileAgent` throws `Toolbox ${name} not instantiated — add to providers`.
- **Suggested fix:** `delegate()` must accept `toolboxInstances` in `DelegateOptions` OR auto-instantiate toolbox classes with `new ToolboxClass()` (no DI). Add to pseudo-code: `const instances = new Map(walk.toolboxes.map(tb => [tb.class, new (tb.class as new () => object)()]))`.

### EC-2: DoneEvent type does not declare `cost` field — plan pseudo-code references non-existent typed property

- **Affected task:** T2.1
- **Family:** Format / Boundary
- **Scenario:** `DoneEvent` interface (agent-stream-events.ts:65-73) declares `type`, `result`, `usage`, `durationMs` but NOT `cost`. The LLM runner (llm-runner.ts:166) emits `cost: session.totalCostUsd` as an extra runtime field. The plan's pseudo-code reads `event.cost` — this works at runtime but fails TypeScript strict checks and is type-unsafe.
- **Impact:** `delegate()` implementation using `event.cost` will cause a TS error with `strict: true` unless the event is cast to `any`. Budget tracking silently produces `undefined` if someone fixes the type mismatch by removing the untyped access.
- **Suggested fix:** Add `cost?: number` to `DoneEvent` interface in `agent-stream-events.ts`. One line fix. Then `event.cost` is type-safe.

## SHOULD TEST

### EC-3: Readiness check throws synchronously (not async rejection)

- **Affected task:** T1.1
- **Suggested test:** `test_ready_check_sync_throw()` — readiness check that does `throw new Error('boom')` instead of returning a rejected Promise. Assert: the endpoint returns 503 with `{ healthy: false, message: 'boom' }` instead of crashing the server. Fix: wrap each check call in try-catch inside the timeout wrapper.

### EC-4: Concurrent delegate() calls from same parent agent share session state

- **Affected task:** T2.1
- **Suggested test:** `test_delegate_concurrent_isolated_sessions()` — parent calls `delegate(AgentA, ...)` and `delegate(AgentB, ...)` in `Promise.all()`. Assert: each gets a unique session ID (no cross-contamination of conversation history). The plan says `sessionId: sub-${Date.now()}` but two calls in the same ms get the same ID. Fix: use `crypto.randomUUID()` instead of `Date.now()`.

## DOCUMENT

### EC-5: Health endpoint exposes uptime/timestamp — potential information disclosure

- **Accepted risk:** `GET /__theo/health` returns `uptime` and `timestamp`. In production behind a CDN/load balancer, this is benign (all health endpoints do this — K8s, Docker, AWS ALB). If the user deploys without auth, an attacker can infer server restart times. The `__theo` prefix reduces discoverability. The risk is accepted — users concerned about info disclosure can disable the endpoint via `healthPath: false`.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 1 | 1 |
| T2.1 | 3 | 2 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The 2 MUST FIX items are structural — EC-1 would cause sub-agent toolbox instantiation to crash at runtime, and EC-2 would cause a TypeScript compilation error or silent `undefined` cost. Both have trivial fixes (≤3 lines each).
