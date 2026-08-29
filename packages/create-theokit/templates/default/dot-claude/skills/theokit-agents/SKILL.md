---
name: theokit-agents
description: TheoKit agent/LLM integration — agents/*.ts convention (AgentBuilder), the tool() builder, capabilities (advanced/DI), useAgent client hook
user-invocable: false
paths:
  - '**/*agent*'
  - '**/*Agent*'
  - '**/*tool*'
  - '**/*Tool*'
  - '**/*toolbox*'
  - '**/*Toolbox*'
---

# TheoKit Agents & Tools

## Server Surface — agents/\*.ts (zero-config convention)

Create an `agents/<name>.ts` file at the project root. It is automatically served at
`POST /api/agents/<name>` (dev + build) with no manual route wiring.

```typescript
// agents/chat.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'openrouter/openai/gpt-4o-mini',
  system: 'You are a helpful assistant.',
})
```

The endpoint streams the ai-sdk `UIMessageStream` that `useAgent` (client hook) consumes.
`@theokit/sdk` runs the agent; conversation turns auto-persist per session — the SDK owns storage.

**Provider resolution:** the FIRST segment of the model id picks the provider, and that decides
which key is needed — `openrouter/…` needs `OPENROUTER_API_KEY`, `anthropic/…` needs
`ANTHROPIC_API_KEY`, `openai/…` needs `OPENAI_API_KEY`. A bare vendor prefix is a selection of that
vendor, not a hint: reaching OpenAI's catalog through OpenRouter means naming the gateway first
(`openrouter/openai/gpt-4o-mini`). Set the matching key in `.env`.

## Advanced Surface — @Agent Decorator (DI / class-based)

When you need dependency injection or composition, build the agent from **capabilities**
(`@theokit/agents`). Each capability enriches the same compiled options; conflicts fail fast.

```typescript
// server/agents/assistant.agent.ts
import { applyCapabilities, AgentConfigCapability, ModelCapability } from '@theokit/agents'

export const assistantAgent = applyCapabilities([
  new ModelCapability('openrouter/openai/gpt-4o-mini'),
  new AgentConfigCapability({
    systemPrompt: 'You are a helpful assistant.',
    maxIterations: 5,
  }),
])
// The framework runs the LLM loop via @theokit/sdk.
```

## Tools — `tool()`

Declare a tool with the `tool()` builder from `theokit/server/define`, then chain it onto the agent
with `.tool(…)`. It is the same API `agents/tools/weather.ts` in this project uses — read that file
for a working one.

```typescript
// agents/tools/current-time.ts
import { tool } from 'theokit/server/define'
import { z } from 'zod'

export const currentTimeTool = tool('current_time')
  .describe('Return the current ISO timestamp')
  .input(z.object({}))
  .execute(async () => new Date().toISOString())
  .build()
```

```typescript
// agents/chat.ts
import { AgentBuilder } from '@theokit/agents'
import { z } from 'zod'

import { currentTimeTool } from './tools/current-time.js'

export default AgentBuilder.create()
  .input(z.object({ message: z.string() }))
  .model('openrouter/openai/gpt-4o-mini')
  .system('You are a helpful assistant.')
  .tool(currentTimeTool)
  .build()
```

A tool is pure metadata plus a handler: it describes a capability and does local or HTTP work, and
it NEVER calls an LLM — the agent decides when to invoke it.

**Import from `theokit/server/define`, not `theokit/server`.** The umbrella subpath still resolves
and prints a deprecation warning naming a removal release; every symbol lives under a domain
subpath (`define`, `auth`, `http`, `security`, …).

> **`defineAgentTool` does not exist.** Earlier versions of this skill taught it. The name is still
> declared in the published `.d.ts`, so an editor will autocomplete it and `tsc` will accept it —
> and there is no runtime export behind it on any subpath, so the call throws on the first request
> (usetheokit/theokit#542). If you find it in older code or in a generated snippet, replace it with
> the `tool()` builder above.

### Toolbox class (advanced — state + injected dependencies)

A toolbox declares its tools as DATA and keeps handlers as ordinary methods, so the class can hold
state and receive dependencies by constructor:

```typescript
import { ToolboxCapability, type ToolDeclaration } from '@theokit/agents'
import { z } from 'zod'

export class TaskTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'list_tasks',
      description: 'List all tasks, optionally filtered by status',
      input: z.object({ done: z.boolean().optional() }),
      method: 'listTasks',
    },
  ]

  constructor(private readonly db: Db) {}

  async listTasks({ done }: { done?: boolean }): Promise<string> {
    return JSON.stringify(this.db.select().from(tasks).all())
  }
}

// compose onto the agent:
//   new ToolboxCapability(new TaskTools(db), { namespace: 'tasks' })  → tasks.list_tasks
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

| Package              | What it provides                                                                                                                 | When to use                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@theokit/sdk`       | `Agent.create()`, `Tool.create()` (primitive), `Run.stream()`                                                                    | Core agent runtime — always installed                              |
| `@theokit/sdk-tools` | Ready-made tools: `createReadFileTool`, `createWriteFileTool`, `createSearchTextTool`, `createGlobTool`, `createShellTool`, etc. | **Check here FIRST** before writing custom tools for coding agents |
| `@theokit/di-agent`  | DI-powered agent with decorator injection                                                                                        | When using dependency injection pattern                            |
| `@theokit/di`        | Core DI container (`@Injectable`, `@Inject`)                                                                                     | When `@theokit/di-agent` needs explicit bindings                   |

**`Tool.create()` in `@theokit/sdk` is the primitive API.** For coding agents, `@theokit/sdk-tools` has batteries-included tools that wrap `Tool.create()` with file system access, search, shell execution, etc. Don't reimplement what `sdk-tools` already provides.

## Rules

- Tool `name` and `description` are ALWAYS explicit — never inferred from method names (G4)
- Tool `.input()` takes a Zod schema — same pattern as `route().body(…)`
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
