---
name: theokit-agents
description: TheoKit agent/LLM integration — agents/*.ts convention (defineAgent), @Agent decorator (advanced/DI), defineAgentTool, useAgent client hook
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

## Server Surface — agents/*.ts (zero-config convention)

Create an `agents/<name>.ts` file at the project root. It is automatically served at
`POST /api/agents/<name>` (dev + build) with no manual route wiring.

```typescript
// agents/chat.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'openai/gpt-4o-mini',
  system: 'You are a helpful assistant.',
})
```

The endpoint streams the ai-sdk `UIMessageStream` that `useAgent` (client hook) consumes.
`@theokit/sdk` runs the agent; conversation turns auto-persist per session — the SDK owns storage.

**Provider resolution:** `OPENROUTER_API_KEY` (preferred — routes to many models) OR
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Set one in `.env`.

## Advanced Surface — @Agent Decorator (DI / class-based)

When you need dependency injection or class-based composition, use the `@Agent` class
decorator from `@theokit/agents`. The class name determines the route:
`AssistantAgent` → `POST /api/agents/assistant`.

```typescript
// server/agents/assistant.agent.ts
import { Agent, MainLoop } from '@theokit/agents'

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

## Tools — defineAgentTool

Declare typed tools with `defineAgentTool` (from `theokit/server`) and pass them to
`defineAgent`'s `tools` array.

```typescript
// agents/chat.ts
import { defineAgent } from '@theokit/agents'
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

const currentTimeTool = defineAgentTool({
  name: 'current_time',
  description: 'Return the current ISO timestamp',
  inputSchema: z.object({}),
  handler: async () => new Date().toISOString(),
})

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'openai/gpt-4o-mini',
  system: 'You are a helpful assistant.',
  tools: [currentTimeTool],
})
```

### @Tool Decorator (advanced / class-based)

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

## Client — useAgent (React hook)

```typescript
import { useAgent } from 'theokit/client'

function ChatUI() {
  const { messages, status, send, reset } = useAgent<{ message: string }>('/api/agents/chat')

  return (
    <div>
      {status === 'streaming' && <p>Thinking...</p>}
      {messages.map(message => (
        <div key={message.id}>
          {message.parts.map((part, i) => (
            part.type === 'text'
              ? <p key={i}>{part.text}</p>
              : part.type === 'dynamic-tool'
                ? <p key={i}>Using tool: {part.toolName}</p>
                : null
          ))}
        </div>
      ))}
      <button onClick={() => send({ message: 'Hello' })}>Send</button>
    </div>
  )
}
```

`messages` is `UIMessage[]` (ai-sdk). Render `message.parts` — text parts
(`part.type === 'text'`, `part.text`) and tool parts (`part.type === 'dynamic-tool'`,
`part.toolName`, `part.state`, `part.output`). Do NOT switch on an `events`/`event.type`
pattern — the wire is `UIMessageStream`, not SSE events.

### Non-React: consumeUIMessageStream

```typescript
import { consumeUIMessageStream } from 'theokit/client'

const response = await fetch('/api/agents/chat', {
  method: 'POST',
  body: JSON.stringify({ message: 'Hello' }),
})
consumeUIMessageStream(response, (message) => {
  console.log(message.parts)
})
```

## SDK Ecosystem — "you are here" map

Before writing custom tools, check if they already exist:

| Package | What it provides | When to use |
|---------|-----------------|-------------|
| `@theokit/sdk` | `Agent.create()`, `defineTool()` (primitive), `Run.stream()` | Core agent runtime — always installed |
| `@theokit/sdk-tools` | Ready-made tools: `createReadFileTool`, `createWriteFileTool`, `createSearchTextTool`, `createGlobTool`, `createShellTool`, etc. | **Check here FIRST** before writing custom tools for coding agents |
| `@theokit/di-agent` | DI-powered agent with decorator injection | When using dependency injection pattern |
| `@theokit/di` | Core DI container (`@Injectable`, `@Inject`) | When `@theokit/di-agent` needs explicit bindings |

**`defineTool()` in `@theokit/sdk` is the primitive API.** For coding agents, `@theokit/sdk-tools` has batteries-included tools that wrap `defineTool()` with file system access, search, shell execution, etc. Don't reimplement what `sdk-tools` already provides.

## Rules

- Tool `name` and `description` are ALWAYS explicit — never inferred from method names (G4)
- Tool `input` uses Zod schema — same pattern as defineRoute
- `@UseGuards()` works on agents (shared with HTTP pipeline)
- `@UseInterceptors()` and `@UseFilters()` on agents are metadata-only (emit warnings)
- Agent runtime is `@theokit/sdk` — NEVER call LLM APIs directly via fetch
- Check `@theokit/sdk-tools` BEFORE writing custom tools — it may already exist

## Anti-patterns

- NEVER call OpenAI/Anthropic/OpenRouter APIs directly — use `defineAgent` or `@Agent`
- NEVER reimplement tool calling loop — the SDK handles it
- NEVER reimplement file/search/shell tools — use `@theokit/sdk-tools` (readFile, writeFile, search, etc.)
- NEVER store conversations manually — SDK persistence is automatic (the SDK owns storage)
- NEVER infer tool capability from method name — always provide explicit `name` + `description`
