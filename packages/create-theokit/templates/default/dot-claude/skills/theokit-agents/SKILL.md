---
name: theokit-agents
description: TheoKit agent/LLM integration — @Agent, @Tool, @Toolbox decorators, streaming, memory
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

## @Agent Decorator

```typescript
import { Agent, MainLoop, Hook, Memory, Budget } from '@theokit/agents'

@Agent({
  model: 'openai/gpt-4o-mini',     // Required: LLM model
  systemPrompt: 'You are a helpful task assistant.',
})
@Memory({ provider: 'built-in', scope: 'per-user' })  // Optional
@Budget({ maxCostUsd: 1.00, window: 'daily' })         // Optional
export class AssistantAgent {
  @MainLoop({ strategy: 'react', maxIterations: 5 })
  async run() {
    // Framework handles the LLM loop
  }

  @Hook('before:llm-call')
  async onBeforeLLM(ctx) {
    // Intercept before each LLM call
  }
}
```

Convention: `AssistantAgent` class name maps to `GET/POST /api/agents/assistant`.

## @Tool Decorator

```typescript
import { Toolbox, Tool } from '@theokit/agents'
import { z } from 'zod'

@Toolbox()
export class TaskTools {
  @Tool({
    name: 'list_tasks',
    description: 'List all tasks, optionally filtered by status',
    input: z.object({
      done: z.boolean().optional(),
    }),
  })
  async listTasks({ done }: { done?: boolean }) {
    const all = db.select().from(tasks).all()
    return done !== undefined ? all.filter(t => t.done === done) : all
  }

  @Tool({
    name: 'create_task',
    description: 'Create a new task with a title',
    input: z.object({
      title: z.string().min(1),
    }),
  })
  async createTask({ title }: { title: string }) {
    return db.insert(tasks).values({ title }).returning().get()
  }
}
```

## Frontend — useAgentStream

```typescript
import { useAgentStream } from 'theokit/client'

function ChatUI() {
  const { status, events, send } = useAgentStream('/api/agents/assistant')

  return (
    <div>
      {events.map(e => <p key={e.id}>{e.content}</p>)}
      <button onClick={() => send({ message: 'Hello' })}>Send</button>
    </div>
  )
}
```

## Rules

- Tool `name` and `description` are ALWAYS explicit — never inferred from method names (G4)
- Tool `input` uses Zod schema — same pattern as defineRoute
- `@UseGuards()` works on agents (shared with HTTP pipeline)
- `@UseInterceptors()` and `@UseFilters()` on agents are metadata-only (emit warnings, not enforced at runtime)
- Agent runtime is `@theokit/sdk` — NEVER call LLM APIs directly via fetch

## Anti-patterns

- NEVER call OpenAI/Anthropic/OpenRouter APIs directly — use @Agent + @Tool
- NEVER reimplement tool calling loop — the SDK handles it
- NEVER store conversations manually — use @Memory
- NEVER infer tool capability from method name — always provide explicit `name` + `description`
