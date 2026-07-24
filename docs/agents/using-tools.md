# Using tools

Tools give agents capabilities beyond language generation — reading files, calling APIs,
searching code, running shell commands. The agent decides when to call a tool, provides
the required input, observes the result, and continues reasoning.

## When to use tools

Use tools when the agent needs information from outside its context window, or needs to
perform a concrete operation with a well-defined result. Things a model can't reliably
produce on its own: live data, file contents, command output, API responses.

---

## Quickstart

Import `defineAgentTool` from `theokit/server` and pass the tool to your agent's `tools`
array.

```ts
// agents/weather.ts
import { defineAgent } from '@theokit/agents'
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

const getWeather = defineAgentTool({
  name: 'get_weather',
  description: 'Get current weather for a city. Call when the user asks about weather.',
  inputSchema: z.object({
    city: z.string().describe('City name, e.g. "São Paulo"'),
  }),
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

`defineAgentTool` validates `name` against the LLM tool-name regex
(`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`), requires the `inputSchema` to be a
`z.object(...)`, and parses the LLM-supplied input through the schema before
calling your handler — bad input from the model surfaces as a `tool_result` error,
not a crash.

> **Keep descriptions sharp.** The model picks tools based on their `description`. A
> vague description degrades selection accuracy. One focused sentence beats three vague
> ones: "Get the current weather for a city" → good. "Performs weather-related
> operations" → bad.

---

## Handler context

The `handler` receives the parsed input as the first argument. The optional second argument
`ctx` provides the abort signal and the agent-level context (see
[Run context](./run-context.md)):

```ts
const readFile = defineAgentTool({
  name: 'read_file',
  description: 'Read a file from the project. path is relative to the project root.',
  inputSchema: z.object({ path: z.string() }),
  handler: async ({ path }, ctx) => {
    // ctx.signal — AbortSignal, fired when the user aborts the stream
    if (ctx?.signal?.aborted) throw new Error('Aborted')

    // ctx.context — the object from defineAgent({ context }) or agent().context()
    const root = (ctx?.context as { projectRoot: string } | undefined)?.projectRoot
                 ?? process.cwd()

    return fs.readFile(join(root, path), 'utf8')
  },
})
```

Existing one-argument handlers (`handler: async ({ path }) => { ... }`) keep working
unchanged — `ctx` is optional.

---

## Multiple tools

Pass as many tools as the task requires. The agent picks the right one (or none) based on
tool descriptions and the user's message.

```ts
export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a code assistant.',
  tools: [
    readFileTool,
    searchTextTool,
    globTool,
    runTestsTool,
  ],
})
```

Or with the fluent builder:

```ts
export default agent()
  .model('anthropic/claude-sonnet-4-6')
  .tool(readFileTool)
  .tool(searchTextTool)
  .tool(globTool)
  .build()
```

The builder accumulates tool names into a literal union type, which flows through to the
generated client — so `useAgent('coder')` knows which tools this agent can emit.

---

## Pre-built tools — `@theokit/sdk-tools`

For code assistant and file system use cases, install `@theokit/sdk-tools` instead of
writing file tools from scratch:

```bash
pnpm add @theokit/sdk-tools
```

All factories take `{ projectRoot }` — a security boundary that scopes every file
operation to that directory and prevents symlink escape:

```ts
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGlobTool,
  createEditFileTool,
  createWriteFileTool,
  createShellTool,
} from '@theokit/sdk-tools'

const root = process.cwd()

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a senior engineer.',
  tools: [
    createReadFileTool({ projectRoot: root }),
    createListDirTool({ projectRoot: root }),
    createSearchTextTool({ projectRoot: root, maxMatches: 100 }),
    createGlobTool({ projectRoot: root }),
    createEditFileTool({ projectRoot: root }),
    createWriteFileTool({ projectRoot: root }),
    createShellTool({ projectRoot: root }),   // runs shell commands inside projectRoot
  ],
})
```

| Tool | What it does |
|---|---|
| `createReadFileTool` | Read file contents (with line-range support) |
| `createListDirTool` | List directory entries |
| `createSearchTextTool` | Ripgrep-powered text search across files |
| `createGlobTool` | Find files by glob pattern |
| `createEditFileTool` | Apply targeted string replacements |
| `createWriteFileTool` | Write or overwrite a file |
| `createShellTool` | Run a shell command in projectRoot (use carefully) |

> `projectRoot` is baked in at creation time via closure — it's a security boundary, not
> a runtime parameter. See [Run context](./run-context.md) if you need per-run config
> that varies across requests.

---

## Tools on the `@Agent` class surface

On the class surface, a **toolbox** declares its tools as DATA and keeps the handlers as ordinary
methods — so the class can hold state and injected dependencies:

```ts
import {
  applyCapabilities,
  ModelCapability,
  ToolboxCapability,
  type ToolDeclaration,
} from '@theokit/agents'
import { z } from 'zod'

export class SupportTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'lookup_order',
      description: 'Look up an order by ID. Call when the user asks about an order.',
      input: z.object({ orderId: z.string() }),
      method: 'lookupOrder',
    },
  ]

  constructor(private readonly db: Db) {} // dependências injetadas de verdade

  async lookupOrder({ orderId }: { orderId: string }): Promise<string> {
    const order = await this.db.orders.findById(orderId)
    return order ? JSON.stringify(order) : `Order ${orderId} not found`
  }
}

const compiled = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  new ToolboxCapability(new SupportTools(db), { namespace: 'support' }), // → support.lookup_order
])
```

The method receives the parsed input directly, bound to the instance. A typo in `method` fails at
**authoring** time, not when the model decides to call the tool.

> **Migrating from `@Tool`/`@Toolbox`?** The decorators were removed in `@theokit/agents` v1.0
> (M53). See [`MIGRATION.md`](../../MIGRATION.md).

---

## Error handling in tools

Return a string result on success. Throw (or reject) on failure — the SDK converts an
uncaught error to a `tool_result(isError: true)` that the model can reason about and
retry if appropriate.

```ts
handler: async ({ path }) => {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (err) {
    // Return a descriptive error string so the model can correct its input.
    // Throwing also works — both produce a tool_result(isError: true).
    return `Error reading file: ${(err as Error).message}`
  }
},
```

> **Don't swallow errors silently.** Returning an empty string or `"ok"` on failure
> misleads the model. Return a clear error message so the model can reason about what
> went wrong.

---

## Streaming tool events

When an agent calls a tool, the `useAgent` hook surfaces events before and after execution.
Use these to show the agent's reasoning live rather than waiting for the final answer:

```tsx
const { messages } = useAgent('coder')

// messages includes tool events as UIMessage parts:
// - type: 'tool-invocation' with state 'call'   → tool was invoked, input available
// - type: 'tool-invocation' with state 'result' → tool completed, output available
```

For CLI streaming: `theokit agent <name> "<message>"` prints tool calls and their results
inline as the agent runs.

---

## Controlling which tools run

Pass `activeTools` to restrict which tools are active for a specific request. This is
useful when you want the same agent definition to behave differently based on context
(e.g., read-only vs. read-write mode):

```ts
// Server-side — restrict tools for this specific request
const result = await sdk.run({
  agent: agentDef,
  input: { message },
  activeTools: ['read_file', 'glob_files'],  // search-only; no write/edit/shell
})
```

---

## Tool output shaping (M18)

A tool handler can return **rich data** for the app while the model sees a compact string.
`toModelOutput` maps the handler's result to what the model reads; `transform` formats it per
target for the UI or a saved transcript (never on the model wire).

```ts
const weather = defineAgentTool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: z.object({ city: z.string() }),
  handler: ({ city }) => ({ city, tempC: 21, humidity: 0.6 }), // rich object for the app
  toModelOutput: (r) => `${r.tempC}°C in ${r.city}`,           // compact string for the model
  transform: {
    display: (r) => ({ label: `${r.city}: ${r.tempC}°C` }),   // for the UI
    transcript: (r) => `weather(${r.city}) = ${r.tempC}°C`,   // for a saved transcript
  },
})
// applyTransform(tool, result, 'display' | 'transcript') applies it app-side.
```

A string handler with no `toModelOutput` is unchanged (backward-compatible). `theokit@0.17.0`.

## Workflows as tools (M26)

Wrap an SDK `Workflow` as a `CustomTool` the agent can invoke. THIN adapter — the workflow *engine*
stays in `@theokit/sdk`; TheoKit only exposes it.

```ts
import { createWorkflowTool } from 'theokit/server'

const runPipeline = createWorkflowTool(myWorkflow, {
  name: 'run_pipeline',
  description: 'Run the data pipeline',
  inputSchema: z.object({ id: z.string() }),
})
// Fails fast if the passed object is not a Workflow. `theokit@0.17.0`.
```

## Related

- [Run context](./run-context.md) — pass shared config (projectRoot, user info) to tool handlers
- [Agent surfaces](../guides/agent-surfaces.md) — `defineAgent`, `agent()` builder, `@Agent` class
- [Build a code assistant](../guides/build-a-code-assistant.md) — end-to-end tutorial using `@theokit/sdk-tools`
