---
name: theokit-agents
description: TheoKit agent/LLM integration — two streaming surfaces (decorator vs manual), @Tool, @Toolbox, memory
user-invocable: false
paths:
  - "**/*agent*"
  - "**/*Agent*"
  - "**/*tool*"
  - "**/*Tool*"
  - "**/*toolbox*"
  - "**/*Toolbox*"
---

# TheoKit Agents & Tools

## Two Streaming Surfaces — pick one per endpoint

TheoKit ships two ways to create agent endpoints. Use ONE per endpoint, not both.

| Surface | Server | Events | Client | When to use |
|---------|--------|--------|--------|-------------|
| **Manual** (recommended for most apps) | `defineAgentEndpoint({ handler: async function* })` | `AgentEvent` (Message, ToolCall, Result, Error) | `useAgentStream()` / `consumeAgentStream()` | Full control over the LLM loop — you write the generator |
| **Decorator** (`@theokit/agents`) | `@Agent` class → auto-generated route | `AgentStreamEvent` (TextDelta, ToolCall, Done...) | (same client hooks work) | Declarative — framework manages LLM loop via `@MainLoop` |

### Surface 1: Manual (defineAgentEndpoint)

```typescript
// server/routes/agents/assistant.ts
import { defineAgentEndpoint } from 'theokit/server/define'
import type { AgentEvent } from 'theokit'

export const POST = defineAgentEndpoint({
  handler: async function* ({ body }): AsyncGenerator<AgentEvent> {
    // You control the LLM loop
    yield { type: 'message', content: 'Thinking...' }
    const result = await callLLM(body.message)
    yield { type: 'message', content: result }
  },
})
```

### Surface 2: Decorator (@Agent)

```typescript
// server/agents/assistant.agent.ts
import { Agent, MainLoop, Tool, Toolbox } from '@theokit/agents'

@Agent({
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You are a helpful assistant.',
})
export class AssistantAgent {
  @MainLoop({ strategy: 'react', maxIterations: 5 })
  async run() {
    // Framework handles the LLM loop via @theokit/sdk
  }
}
```

Convention: `AssistantAgent` → `POST /api/agents/assistant`

## @Tool Decorator

```typescript
import { Toolbox, Tool } from '@theokit/agents'
import { z } from 'zod'

@Toolbox()
export class TaskTools {
  @Tool({
    name: 'list_tasks',
    description: 'List all tasks, optionally filtered by status',
    input: z.object({ done: z.boolean().optional() }),
  })
  async listTasks({ done }: { done?: boolean }) {
    return db.select().from(tasks).all()
  }
}
```

## Client — useAgentStream (React hook)

Works with BOTH surfaces. Transport: `fetch` POST + `ReadableStream` (SSE).

```typescript
import { useAgentStream } from 'theokit/client'

function ChatUI() {
  const { status, events, send, reset } = useAgentStream('/api/agents/assistant')

  return (
    <div>
      {status === 'streaming' && <p>Thinking...</p>}
      {events.map(e => (
        <div key={e.id}>
          {e.type === 'message' && <p>{e.content}</p>}
          {e.type === 'tool_call' && <p>Using tool: {e.name}</p>}
        </div>
      ))}
      <button onClick={() => send({ message: 'Hello' })}>Send</button>
    </div>
  )
}
```

### Non-React: consumeAgentStream

```typescript
import { consumeAgentStream } from 'theokit/client'

const stream = consumeAgentStream('/api/agents/assistant', { body: { message: 'Hi' } })
for await (const event of stream) {
  console.log(event.type, event.content)
}
```

## Rules

- Tool `name` and `description` are ALWAYS explicit — never inferred from method names (G4)
- Tool `input` uses Zod schema — same pattern as defineRoute
- `@UseGuards()` works on agents (shared with HTTP pipeline)
- `@UseInterceptors()` and `@UseFilters()` on agents are metadata-only (emit warnings)
- Agent runtime is `@theokit/sdk` — NEVER call LLM APIs directly via fetch
- Pick ONE surface per endpoint — don't mix defineAgentEndpoint with @Agent for the same route

## Anti-patterns

- NEVER call OpenAI/Anthropic/OpenRouter APIs directly — use @Agent or defineAgentEndpoint
- NEVER reimplement tool calling loop — the SDK handles it
- NEVER store conversations manually — use @Memory (decorator) or SDK persistence
- NEVER infer tool capability from method name — always provide explicit `name` + `description`
- NEVER mix both surfaces for the same endpoint — pick manual OR decorator
