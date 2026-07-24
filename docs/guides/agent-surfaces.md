# Three ways to define an agent — one definition

TheoKit gives you **three surfaces** to define an agent. They are not three runtimes — they all
compile to the **same branded `AgentDefinition`**, scanned from `agents/*.ts`, served at
`POST /api/agents/<name>`, and run through the same `@theokit/sdk` runtime (ADR-B1, "one runtime,
N syntaxes"). Pick the one that fits how you think; the app behaves identically.

A convergence test (`packages/agents/tests/integration/agent-builder-runtime.test.ts`) proves the
builder and `defineAgent` produce equal definitions and equal compiled options — the scanner,
manifest, and runtime cannot tell them apart.

## 1. `defineAgent` — the zero-config shortcut

The fastest way to ship an agent. A config object in, a definition out.

```ts
// agents/chat.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a helpful assistant.',
  tools: [/* … */],
})
```

**Use it when:** you want the shortest path and don't need compile-time guarantees about the shape
of the agent.

## 2. `AgentBuilder.create()` — the fluent builder with type-state

A composable builder that accumulates **type-state** the way Zod, tRPC, and Hono do. The compiler
catches mistakes before the first request:

```ts
// agents/assistant.ts
import { AgentBuilder, ContextualTool } from '@theokit/agents'

export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6') // required — `.build()` is a compile error without it
  .system('You are a senior engineer working inside this repository.')
  .context({ projectRoot: process.cwd() }) // set shared config ONCE (run-context, M7)
  .tool(readFileTool) // its required context is checked against `.context()` at compile time
  .build()
```

Compile-time guarantees (each proven by `@ts-expect-error` type tests):

- Calling `.build()` without `.model()` is a **compile error** — not a first-request runtime error.
- Calling `.model()` twice is a **compile error** (set-once).
- Adding a tool whose required run-context isn't provided via `.context()` is a **compile error**.
- Tool names accumulate into a union that reaches the generated client
  (`.theokit/agents.d.ts` → `useAgent('assistant')`).

`.use(preset)` applies a reusable partial chain (Spring-Boot-style) and preserves the accumulated
type-state:

```ts
const withRepoContext = <B extends ReturnType<typeof agent>>(b: B) =>
  b.context({ projectRoot: process.cwd() }).system('Ground every answer in the real code.')

export default AgentBuilder.create().model('…').use(withRepoContext).tool(readFileTool).build()
```

**Use it when:** you want compile-time guarantees, reusable partial chains, or a typed tool-name
union in the client. This is the recommended surface for anything beyond a one-liner.

## 3. `@Agent` — the class/DI surface

Composable **capabilities** — for dependency injection, toolboxes with state, and the advanced
harness (human-in-the-loop, checkpoints).

```ts
// agents/support.ts
import {
  applyCapabilities,
  ModelCapability,
  ToolboxCapability,
  type ToolDeclaration,
} from '@theokit/agents'

class SupportTools {
  static readonly tools: ToolDeclaration[] = [
    { name: 'lookup', description: '…', input: /* zod */, method: 'lookup' },
  ]
  constructor(private readonly db: Db) {} // DI real, por construtor
  async lookup(): Promise<string> {/* … */}
}

export const support = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  new ToolboxCapability(new SupportTools(db), { namespace: 'support' }),
])
```

**Use it when:** you need DI, toolboxes com estado, gates de human-in-the-loop (`hitl`) ou resume
por checkpoint — é onde o harness avançado vive. Cada capability é composta, não herdada.

> **Migrando de decorators?** `@Agent`/`@Tool`/`@Toolbox`/`@MainLoop` foram removidos em
> `@theokit/agents` v1.0 (M53). Veja [`MIGRATION.md`](../../MIGRATION.md).

## Which one should I use?

| You are… | Use | Why |
|---|---|---|
| Shipping a quick agent, no ceremony | `defineAgent` | Shortest path; a config object is enough. |
| Building something real, want the compiler on your side | **`AgentBuilder.create()` builder** | Type-state: forgotten model / unsatisfied tool-context / tool-name union are all compile-time. Recommended default. |
| Using DI, guards, mixins, HITL, or checkpoints | `@Agent` class | The advanced surface; decorators wire the harness. |

All three land on the same `AgentDefinition`. Mixing them across different `agents/*.ts` files is
fine — the scanner treats every file's default export identically.
