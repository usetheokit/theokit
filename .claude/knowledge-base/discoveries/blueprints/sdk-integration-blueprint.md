# Blueprint: SDK Integration — Replace llm-runner.ts with @theokit/sdk

**Date:** 2026-06-11
**Questions answered:** 6/6 (0 blocked)

---

## Coverage Corner 1 — Techniques

### Q1: Agent API shape

**Source:** `theokit-sdk/packages/sdk/src/agent.ts:107`, `types/agent.ts:582`, `types/messages.ts:161-170`

```typescript
// Create
const agent = await Agent.create({ apiKey, model, tools, conversationStorage })

// Send + Stream
const run = await agent.send('hello')
for await (const event of run.stream()) {
  // SDKMessage discriminated union:
  // system | user | assistant | thinking | tool_call | status | task | request | object_delta
}

// Cleanup
await agent.dispose()
```

**Key finding:** SDK uses `SDKMessage` types (system/assistant/tool_call/thinking) which are DIFFERENT from TheoKit's `AgentStreamEvent` types (run_started/text_delta/tool_call/done). An **adapter layer** must translate between the two.

### Q2: defineTool() compatibility

**Source:** `theokit-sdk/packages/sdk/src/define-tool.ts:17-60`

```typescript
// SDK's defineTool
const tool = defineTool({
  name: 'list_tasks',
  description: 'List all tasks',
  inputSchema: z.object({ query: z.string() }),
  handler: async (input) => JSON.stringify(tasks),
})
```

**Compatibility with TheoKit's @Tool:**

| TheoKit `compileTools()` | SDK `defineTool()` | Compatible? |
|---|---|---|
| `name: string` | `name: string` | ✅ Direct |
| `description: string` | `description: string` | ✅ Direct |
| `inputSchema: ZodType` | `inputSchema: ZodType` | ✅ Both Zod v4 |
| `handler: (input) => string` | `handler: (input) => string \| Promise<string>` | ✅ Superset |

**TheoKit's `compileTools()` output maps 1:1 to `defineTool()` input.** Zero adapter needed for tools.

### Q3: Budget tracking

**Source:** `theokit-sdk/packages/sdk/src/budget.ts:58-106`

Budget class is static facade: `Budget.create({ name, limits, mode })`. Deprecated in SDK 2.0 — migrating to `@theokit/sdk-budget`.

**TheoKit's `@Budget` decorator:** stores `{ maxCostUsd, window }` as metadata. Can delegate to `Budget.create()` at agent startup.

**Migration path:** `@Budget({ maxCostUsd: 1.00 })` → `Budget.create({ name: agentName, limits: [{ usd: 1.00, window: 'daily' }], mode: 'block' })`

## Coverage Corner 2 — Integration Tests

### Q4: SDK test patterns

**Source:** `theokit-sdk/packages/sdk/tests/agent-tool-hooks.test.ts:28-100`

Pattern: temp dir per test → `Agent.create({ apiKey: FIXTURE_KEY, model, local: { cwd } })` → `agent.send()` → `agent.dispose()`. Uses `clearAgentRegistry()` + `clearAllSessions()` for isolation.

**Reusable for TheoKit:** Same pattern applies — create agent with fixture key, send message, assert stream events, dispose.

## Coverage Corner 3 — Dependencies

### Q5: Provider support

**Source:** `theokit-sdk/packages/sdk/src/internal/providers/builtin/openrouter.ts:3-14`

SDK has 9 built-in providers including **OpenRouter** (`chat_completions` mode, `OPENROUTER_API_KEY` env var). TheoKit's `llm-runner.ts` currently calls OpenRouter directly — SDK already handles this with provider routing, fallback models, and auth.

**No compatibility issue.** SDK's OpenRouter provider uses the exact same API endpoint and auth header.

## Coverage Corner 4 — Tools

### Q6: ConversationStorage

**Source:** `theokit-sdk/packages/sdk/src/types/conversation-storage.ts:44-81`

```typescript
interface ConversationStorageAdapter {
  getMessages(conversationId: string): Promise<readonly StoredMessage[]>
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>
  deleteConversation(conversationId: string): Promise<void>
  listConversationIds?(opts?: { limit?: number }): Promise<readonly string[] | undefined>
  compact?(conversationId: string, maxTurns: number): Promise<void>
  dispose?(): Promise<void>
}
```

**TheoKit's `llm-runner.ts` session Map** → Replace with `InMemoryConversationStorage` (same behavior, SDK-maintained).

---

## ADR: SDK as Single Runtime

**Decision:** `@theokit/sdk` is the ONLY agent runtime. Rule codified at `.claude/rules/sdk-runtime.md`.

**Migration plan:**

### Phase 1: Adapter layer (~50 LoC)

Create `packages/agents/src/bridge/sdk-adapter.ts`:

```typescript
import { Agent, defineTool } from '@theokit/sdk'

export function createSdkAgentStream(walk, compiledTools, apiKey, model) {
  // 1. Convert TheoKit compiled tools → SDK defineTool format
  const sdkTools = compiledTools.map(t => defineTool({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    handler: t.handler,
  }))

  // 2. Create SDK agent
  return async (message, sessionId) => {
    const agent = await Agent.create({
      apiKey,
      model: { id: model },
      tools: sdkTools,
      // conversationStorage: InMemoryConversationStorage (per sessionId)
    })

    const run = await agent.send(message)

    // 3. Translate SDK events → TheoKit AgentStreamEvent
    return translateStream(run.stream())
  }
}
```

### Phase 2: Delete llm-runner.ts

Replace `createRealAgentStream` in `app.ts` and `agent-orchestrator.ts` with `createSdkAgentStream`.

### Phase 3: Delete session Map, budget reimplementation

SDK handles both via `ConversationStorage` + `Budget`.

### Files to delete

- `packages/agents/src/bridge/llm-runner.ts` (182 LoC)
- `fixtures/demo-faang/server/llm-agent-runner.ts` (copy)

### Files to create

- `packages/agents/src/bridge/sdk-adapter.ts` (~80 LoC)
- `packages/agents/src/bridge/event-translator.ts` (~40 LoC) — SDKMessage → AgentStreamEvent

### Files to modify

- `packages/http/src/app.ts` — change `createRealAgentStream` import to `createSdkAgentStream`
- `packages/agents/src/bridge/agent-orchestrator.ts` — same
- `packages/agents/src/bridge/index.ts` — export new adapter
- `packages/agents/package.json` — add `@theokit/sdk` as peerDep

---

## Event Translation Map

| SDK SDKMessage type | TheoKit AgentStreamEvent type | Translation |
|---|---|---|
| `system` | `run_started` | Extract agent_id, model |
| `assistant` (TextBlock) | `text_delta` | Extract text content |
| `assistant` (ToolUseBlock) | `tool_call` | Extract tool name + args |
| `tool_call` (completed) | `tool_result` | Extract result + duration |
| `thinking` | `thinking` | Pass through |
| `status` (done) | `done` | Add usage + cost |
| `status` (error) | `error` | Extract error message |
