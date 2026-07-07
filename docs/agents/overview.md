# Agents

An agent in TheoKit is a file in `agents/` that maps to a live HTTP endpoint. You write the
logic — model, tools, instructions — and the framework serves it, streams it, and types the
client automatically.

```
agents/assistant.ts       →   POST /api/agents/assistant
agents/coder.ts           →   POST /api/agents/coder
```

The agent reasons about the user's goal, decides which tools to call, observes their results,
and iterates until it produces a final answer. You don't write the loop — that lives in
`@theokit/sdk`, the agent runtime TheoKit is built on.

---

## How it works

```
agents/assistant.ts          ← you write this
        ↓  (build-time scan)
.theokit/agents.d.ts         ← generated typed client
        ↓  (request)
POST /api/agents/assistant   ← served by the framework
        ↓  (@theokit/sdk)
LLM ←→ tool calls            ← runtime loop
        ↓  (UIMessageStream)
useAgent('assistant')        ← React hook, typed to your agent's input
```

Every agent goes through the same pipeline. The three ways to define an agent (see
[Agent surfaces](../guides/agent-surfaces.md)) all compile to the same `AgentDefinition` —
the scanner, the HTTP handler, and the client cannot tell them apart.

---

## Quickstart

Create a file in `agents/`:

```ts
// agents/assistant.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a helpful assistant.',
})
```

Run `theokit dev`. The agent is live at `POST /api/agents/assistant`. Use it from a React
component:

```tsx
import { useAgent } from '@theo/agents'  // generated — typed to your agents

export function Chat() {
  const { messages, send, status } = useAgent('assistant')

  return (
    <div>
      {messages.map(m => <p key={m.id}>{m.content as string}</p>)}
      <button onClick={() => send({ message: 'Hello' })} disabled={status === 'streaming'}>
        Send
      </button>
    </div>
  )
}
```

No URL, no fetch, no JSON typing by hand — `useAgent` is typed end-to-end from your
`input` schema to the component.

---

## Models

Models use `provider/model` format. The provider prefix determines which API key the SDK
reads from the environment.

| Prefix | Env var | Example |
|---|---|---|
| `anthropic/` | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-6` |
| `openai/` | `OPENAI_API_KEY` | `openai/gpt-4o` |
| `openrouter/` | `OPENROUTER_API_KEY` | `openrouter/meta-llama/llama-3.1-8b-instruct` |
| `ollama/` | _(local, no key)_ `OLLAMA_HOST` for remote | `ollama/llama3.2` |

For OpenRouter, any model on [openrouter.ai/models](https://openrouter.ai/models) works — a
single `OPENROUTER_API_KEY` gives you access to Anthropic, OpenAI, Meta, Mistral, and hundreds
more without managing multiple keys.

```ts
// Use any of these in model:
model: 'anthropic/claude-sonnet-4-6'
model: 'openai/gpt-4o'
model: 'openrouter/meta-llama/llama-3.1-8b-instruct'
model: 'ollama/llama3.2'           // local Ollama, no key needed
```

---

## Three ways to define an agent

TheoKit gives you three surfaces. Pick by how much compile-time safety you want.

| Surface | When to use |
|---|---|
| [`defineAgent`](../guides/agent-surfaces.md#1-defineagent--the-zero-config-shortcut) | Shortest path. No guarantees enforced at compile time. |
| [`agent()` builder](../guides/agent-surfaces.md#2-agent--the-fluent-builder-with-type-state) | Recommended. Missing model = compile error. Context and tool types checked. |
| [`@Agent` class](../guides/agent-surfaces.md#3-agent--the-classdI-surface) | DI, guards, mixins, human-in-the-loop, checkpoints. |

All three produce the same result at runtime. See [Agent surfaces](../guides/agent-surfaces.md)
for the full comparison and code examples.

---

## Tools

Tools give agents access to data and operations beyond language generation — reading files,
searching code, calling APIs. A tool has a name, a description, an input schema, and a handler.

```ts
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

const getWeather = defineAgentTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: z.object({ city: z.string() }),
  handler: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=3`)
    return res.text()
  },
})

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a weather assistant.',
  tools: [getWeather],
})
```

For file system tools (read, write, glob, search, edit), install `@theokit/sdk-tools`:

```ts
import { createReadFileTool, createGlobTool } from '@theokit/sdk-tools'

const tools = [
  createReadFileTool({ projectRoot: process.cwd() }),
  createGlobTool({ projectRoot: process.cwd() }),
]
```

See [Using tools](./using-tools.md) for the full tools reference.

---

## Shared context for tools (run-context)

Declare config once on the agent and every tool handler receives it as `ctx.context` — no
prop-drilling across tool definitions.

```ts
// agents/coder.ts
export default agent()
  .model('anthropic/claude-sonnet-4-6')
  .context({ projectRoot: process.cwd(), language: 'typescript' })
  .tool(readFileTool)  // receives ctx.context.projectRoot automatically
  .build()
```

```ts
// The tool reads from ctx.context
const readFileTool = defineAgentTool({
  name: 'read_file',
  description: 'Read a file relative to the project root',
  inputSchema: z.object({ path: z.string() }),
  handler: async ({ path }, ctx) => {
    const root = (ctx?.context as { projectRoot: string }).projectRoot
    return fs.readFile(join(root, path), 'utf8')
  },
})
```

See [Run context](./run-context.md) for per-run overrides and typed context patterns.

---

## Agents vs server actions vs routes

| Situation | Use |
|---|---|
| Open-ended goal — steps unknown in advance | **Agent** (`agents/`) |
| Deterministic server logic — fixed input → fixed output | **Server action** (`defineAction`) |
| Raw HTTP endpoint — REST, webhooks, file uploads | **Route** (`defineRoute`) |

Agents call tools in a loop until the model decides to stop. Server actions and routes run
once and return. When you know every step, use actions/routes; when the model should decide
the steps, use an agent.

---

## Streaming

Agents stream tokens as they generate. `useAgent` surfaces this through the `messages` array
(updated incrementally) and `status` (`idle` → `streaming` → `done`).

Tool calls are visible in the stream too — when the agent calls a tool, the UI receives
`tool-input-available` and `tool-output-available` events, so you can show the agent's
reasoning live instead of waiting for the final answer.

For CLI usage: `theokit agent <name> "<message>"` streams the agent's response to stdout.

---

## What's available

Beyond the basics documented here:

| Feature | Doc |
|---|---|
| Three definition surfaces + type-state builder | [Agent surfaces](../guides/agent-surfaces.md) |
| File system tools (read, write, glob, search) | [Using tools](./using-tools.md) |
| Shared context for tools | [Run context](./run-context.md) |
| Human-in-the-loop approval gates | `@HumanInTheLoop` on the `@Agent` surface |
| Checkpoints — pause and resume a run | `@Checkpoint` on the `@Agent` surface |
| Conversation memory | Persistence via `@theokit/sdk` conversation storage |
| Full tutorial: code assistant agent | [Build a code assistant](../guides/build-a-code-assistant.md) |

---

## Next steps

- **New to TheoKit agents?** Start with [Build a code assistant](../guides/build-a-code-assistant.md) — it walks from `npx create-theokit` to a working agent with file tools.
- **Choosing a definition surface?** Read [Agent surfaces](../guides/agent-surfaces.md).
- **Adding tools?** See [Using tools](./using-tools.md).
