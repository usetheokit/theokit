# Edge Case Review — theokit-agents-unified-decorator-runtime

Date: 2026-06-09
Tasks analyzed: 13
Edge cases found: 9 (MUST FIX: 3, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: @Agent class missing @MainLoop — runtime crash at compile time
- **Affected task:** T4.2 (Agent compiler)
- **Family:** Input / Boundary
- **Scenario:** User decorates a class with `@Agent()` but forgets `@MainLoop()` on any method. `walkAgentMetadata()` returns `mainLoop: undefined`. The compiler tries to access `mainLoop.propertyKey` and crashes with `TypeError: Cannot read properties of undefined`.
- **Impact:** Crash at server startup — no useful error message.
- **Suggested fix:** In `walkAgentMetadata()`, throw a descriptive error: `if (!mainLoop) throw new Error(\`Agent ${AgentClass.name} missing @MainLoop() — decorate exactly one method\`)`

### EC-2: SSE write after client disconnect — ERR_STREAM_WRITE_AFTER_END
- **Affected task:** T5.1 (SSE handler)
- **Family:** I/O / Resource
- **Scenario:** Client disconnects mid-stream (browser tab closed, network drop). The `for await` loop continues iterating on `Run.stream()`. Next `res.write()` throws `ERR_STREAM_WRITE_AFTER_END`.
- **Impact:** Unhandled exception crashes the request handler. If no exception filter wraps it, the process may crash.
- **Suggested fix:** Check `res.destroyed` before every `res.write()`: `if (res.destroyed) { run.abort?.(); return }`

### EC-3: Tool handler `this` context lost when compiled via defineTool
- **Affected task:** T4.1 (Tool compiler)
- **Family:** State / Binding
- **Scenario:** `@Tool` method references `this.someService` injected via constructor. The compiler does `handler: (input) => handler.call(instance, input)` — this works. BUT if the Toolbox is instantiated WITHOUT DI (no `instance` in the map), `toolboxInstances.get(tb.class)` returns `undefined` and `.call(undefined, input)` makes `this` = `undefined` in strict mode.
- **Impact:** `TypeError: Cannot read properties of undefined (reading 'someService')` at tool execution time — not at startup.
- **Suggested fix:** Guard in `compileTools()`: `if (!instance) throw new Error(\`Toolbox ${tb.class.name} not instantiated — add to providers or pass instances\`)`

## SHOULD TEST

### EC-4: Multiple @Agent classes with same route
- **Affected task:** T3.2 (Walk agent metadata) + T6.1 (TheoApp integration)
- **Suggested test:** `test_duplicate_agent_route_throws()` — register two agents with `route: '/api/agents/support'`, expect descriptive error at registration time (not at request time where the first-match-wins ambiguity hides the bug)

### EC-5: @Tool with empty Zod schema (z.object({}))
- **Affected task:** T2.4 (Tool decorators) + T4.1 (Tool compiler)
- **Suggested test:** `test_tool_with_empty_schema()` — `@Tool({ input: z.object({}) })` should compile correctly (SDK's defineTool accepts it). The handler receives `{}`. Verify no crash.

### EC-6: SSE with very large tool output (>1MB single event)
- **Affected task:** T5.1 (SSE handler)
- **Suggested test:** `test_sse_large_event()` — stream a single SDKMessage with 2MB string content. Verify the SSE frame is written correctly (no chunking issues with Node's `res.write()`). Node handles this fine but the test documents the behavior.

### EC-7: Agent with zero toolboxes (chat-only agent)
- **Affected task:** T4.2 (Agent compiler)
- **Suggested test:** `test_compile_agent_no_tools()` — `@Agent()` with `@MainLoop()` but no `@Toolbox` classes. Agent should compile with `tools: []`. The SDK supports tool-less agents (pure chat).

## DOCUMENT

### EC-8: SDK Agent.create() is async — startup latency
- **Accepted risk:** `Agent.create()` is async (returns `Promise<SDKAgent>`). The compiler must `await` it. For lazy-init (first-request) this adds ~50-200ms to the first request. For eager-init (TheoApp.create), it's absorbed into startup. The plan's D5 auto-route already implies eager init. Document in README: "First agent request may have higher latency when using agentsPlugin with lazy loading."

### EC-9: Guards on @Toolbox see AgentExecutionContext, not tool-specific context
- **Accepted risk:** When a guard runs on a Toolbox tool, the `ExecutionContext.getClass()` returns the AGENT class (the HTTP handler), not the Toolbox class. This is because the HTTP request handler is the agent's chat endpoint — the toolbox guard runs inside the agent's tool execution callback, not at HTTP level. The guard CAN use `AgentExecutionContext.getToolCall()` to see which tool is being called, but `getClass()` won't return the Toolbox. Document this behavior clearly: "Guards on @Toolbox methods receive AgentExecutionContext where getClass() returns the Agent class. Use getToolCall() to identify the specific tool."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 1 | 0 | 1 (EC-5) | 0 |
| T2.5 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-4) | 0 |
| T4.1 | 1 | 1 (EC-3) | 0 | 0 |
| T4.2 | 2 | 1 (EC-1) | 1 (EC-7) | 1 (EC-8) |
| T5.1 | 2 | 1 (EC-2) | 1 (EC-6) | 0 |
| T6.1 | 1 | 0 | 1 (EC-4) | 0 |
| T6.2 | 0 | 0 | 0 | 0 |
| T6.3 | 0 | 0 | 0 | 0 |
| — (cross-cutting) | 1 | 0 | 0 | 1 (EC-9) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items need to be absorbed as sub-tasks before implementation.
