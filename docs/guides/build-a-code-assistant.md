# Build a code assistant with TheoKit — end to end

By the end of this guide you have a real app: a chat where you type "find every place we call
`fetchUser` and show me the callers", and an agent that **reads your files, greps your code, and
proposes edits** — streaming its work into a browser UI and, when it wants to write a file or run a
command, **pausing for you to approve**. You can drive the same agent from your terminal, and ship it
on a real URL.

It is one app with one agent file at its core. Everything below builds outward from that.

> **How this guide stays honest.** Every API named here is verified against the shipped code
> (`@theokit/agents`, `theokit/server`, `theokit/client`, `@theokit/sdk-tools`) — not from memory.
> The tool-call path (`defineAgent({ tools })`) is exercised end-to-end in TheoKit's own dogfood.
> Where a step needs a live model, you supply the key; where a step is a compile-time contract, run
> `theokit build` to confirm it in your app.

---

## What you'll build

- **A chat surface** for the assistant (streaming text + tool-call cards), in ~1 agent file.
- **Code-aware tools** — read a file, list a directory, grep the repo, glob for files — from
  `@theokit/sdk-tools` (don't reinvent the file layer).
- **A human gate** on the dangerous tools (write a file, run a shell command): the run pauses and
  waits for your click before it touches disk.
- **A terminal mode** — the same agent, rendered to stdout.

## Prerequisites

- Node.js ≥ 22.12 and `pnpm` (or npm).
- An LLM provider key. OpenRouter is the smoothest (one key → many models):
  `OPENROUTER_API_KEY`. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` also work.

### Setup for real agent code

The scaffold targets the browser app; agent tool handlers use Node APIs, and the class surface uses
decorators. Add both once:

```bash
pnpm add -D @types/node
```

For the class agent surface (Step 6), enable decorators in `tsconfig.json`:

```jsonc
{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true } }
```

---

## Step 1 — Scaffold the app

```bash
npm create theokit@latest my-code-assistant
cd my-code-assistant
pnpm install
```

You get a Next-style app with `app/` (the UI), `agents/` (your agents), and a `theokit` CLI. The
default scaffold already ships a working chat agent at `agents/chat.ts` and a chat page at
`app/page.tsx` — we'll grow that chat into a code assistant.

## Step 2 — Give it a provider key

Create `.env` at the project root:

```bash
# .env  — pick ONE provider (OpenRouter routes to many models)
OPENROUTER_API_KEY=sk-or-v1-...
```

`theokit dev` loads `.env` automatically. The model id you set on the agent is prefixed with the
provider namespace (e.g. `anthropic/claude-sonnet-4-6`) so OpenRouter routes it upstream.

## Step 3 — The agent, in one file

An agent is a single top-level file under `agents/`. Two surfaces produce the same result — pick whichever fits how you think:

**`defineAgent` — fastest path (config object in, definition out):**

```ts
// agents/assistant.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'anthropic/claude-sonnet-4-6', // any OpenRouter model id
  system: [
    'You are a senior engineer working inside this repository.',
    'Prefer reading the actual code before answering. Cite file paths and line numbers.',
    'When you propose a change, show a minimal diff and explain why.',
  ].join(' '),
})
```

**`AgentBuilder.create()` builder — recommended when you want compile-time guarantees (M8):**

```ts
// agents/assistant.ts
import { AgentBuilder } from '@theokit/agents'

export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6')
  .system([
    'You are a senior engineer working inside this repository.',
    'Prefer reading the actual code before answering. Cite file paths and line numbers.',
    'When you propose a change, show a minimal diff and explain why.',
  ].join(' '))
  .build()
// Calling .build() without .model() is a compile error — not a first-request runtime surprise.
// Calling .model() twice is also a compile error. The compiler catches both before you run anything.
```

Both are complete, streaming agents. TheoKit auto-serves either at **`POST /api/agents/assistant`**
over the ai-sdk `UIMessageStream` wire — no manual route, no manual client wiring. `@theokit/sdk`
runs it and persists each conversation turn per session (the SDK owns storage).

Right now it can only talk. Next we give it hands.

## Step 4 — Code-aware tools (don't reinvent the file layer)

A code assistant needs to read files, list directories, and search the repo. **These already
exist** — `@theokit/sdk-tools` ships purpose-built, boundary-checked coding tools. Add it:

```bash
pnpm add @theokit/sdk-tools
```

Wire the read-only tools into the agent. Declare `context` once at the agent level (M7) — it reaches
every custom tool handler as `ctx.context` so you never have to thread config through each tool
individually. `@theokit/sdk-tools` factories also accept `projectRoot` at construction time:

```ts
// agents/assistant.ts
import { defineAgent } from '@theokit/agents'
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGlobTool,
} from '@theokit/sdk-tools'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'anthropic/claude-sonnet-4-6',
  context: { projectRoot: process.cwd() }, // set ONCE — reaches every custom tool handler as ctx.context
  system: [
    'You are a senior engineer working inside this repository.',
    'Use read_file / list_dir / search_text / glob to ground every answer in the real code.',
    'Cite file paths and line numbers. Never invent a symbol you have not seen.',
  ].join(' '),
  tools: [
    createReadFileTool({ projectRoot: process.cwd() }),
    createListDirTool({ projectRoot: process.cwd() }),
    createSearchTextTool({ projectRoot: process.cwd(), maxMatches: 100 }),
    createGlobTool({ projectRoot: process.cwd() }),
  ],
})
```

Run it:

```bash
pnpm dev   # theokit dev
```

Open the app, and ask: *"Where do we define the HTTP client, and who imports it?"* The assistant
greps, reads, and answers with real paths — each tool call renders as an expandable card in the UI.

> `@theokit/sdk-tools` also ships `createEditFileTool`, `createWriteFileTool`, `createApplyPatchTool`,
> `createShellTool` (with a catastrophic-command guardrail on by default), `createGitDiffTool`, and
> `buildRepoMap`. We add the **write/shell** ones behind a human gate in Step 6 — never ungated.

## Step 5 — A custom tool (when sdk-tools doesn't cover it)

For anything the toolkit doesn't provide, declare your own with `defineAgentTool`. The contract is
`name` + `description` + a Zod `inputSchema` + a `handler` that returns a **string** (what the model
sees back):

```ts
// agents/assistant.ts (add near the top)
import { defineAgentTool } from 'theokit/server'

const countLinesTool = defineAgentTool({
  name: 'count_lines',
  description: 'Count the non-blank lines in a file relative to the project root.',
  inputSchema: z.object({ path: z.string() }),
  // ctx.context carries whatever you declared in defineAgent({ context }) — no need to thread
  // projectRoot through each factory separately (M7 run-context DI).
  handler: async ({ path }, ctx) => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const root = (ctx?.context as { projectRoot?: string })?.projectRoot ?? process.cwd()
    const text = await readFile(resolve(root, path), 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0).length
    return `${path}: ${lines} non-blank lines`
  },
})
```

Then add `countLinesTool` to the `tools: [...]` array. That's the whole custom-tool surface — a
name, a schema, a function. (The tool name must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`.)

## Step 6 — Human-in-the-loop for the dangerous tools

Reading is safe. **Writing files and running commands is not** — an agent should ask before it
mutates your repo. TheoKit's harness gives you exactly that: mark a tool `@HumanInTheLoop` and the
run **pauses** before that tool executes; the stream emits an approval request; a human approves (or
denies) and the run continues coherently. This is the class-based agent surface — use it when you
need gates and resume.

Create `agents/coder.ts`:

```ts
// agents/coder.ts
import {
  applyCapabilities,
  AgentConfigCapability,
  ModelCapability,
  ToolboxCapability,
  checkpoint,
  type ToolDeclaration,
} from '@theokit/agents'
import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

class WriteTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'write_file',
      description: 'Write UTF-8 content to a path relative to the project root.',
      input: z.object({ path: z.string(), content: z.string() }),
      method: 'writeFile',
      hitl: {
        question: 'Approve writing this file?',
        timeout: 300_000,
        onTimeout: 'abort', // a timed-out approval is a denial — never write on silence
      },
    },
  ]

  async writeFile(input: { path: string; content: string }): Promise<string> {
    await writeFile(resolve(process.cwd(), input.path), input.content, 'utf8')
    return `Wrote ${input.path} (${input.content.length} bytes).`
  }
}

export default applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  new AgentConfigCapability({
    systemPrompt:
      'You are a coding agent. Read before you write. When you write a file, keep the diff minimal ' +
      'and explain the change — the human will review your write before it lands.',
    maxIterations: 10,
  }),
  new ToolboxCapability(new WriteTools(), { namespace: 'fs' }), // seu tool com `hitl` vira um gate
  checkpoint({ storage: 'filesystem', strategy: 'after-tool-call' }),
])
```

What you get at `POST /api/agents/coder`, with zero extra wiring:

- **The gate.** Before `fs.write_file` runs, the run pauses and the stream emits a
  `tool-approval-request`. Approve it with
  `POST /api/agents/coder/approve/<approvalId>` (the `approvalId` arrives on the stream). On approve
  the tool runs; on deny or timeout the model receives the denial and carries on.
- **Resume.** `checkpoint({ storage: 'filesystem' })` persists the conversation; a follow-up request
  with the same session id replays the prior turns instead of starting over.
- **A bounded loop.** The runner's `plan-act-reflect` strategy with `maxIterations: 10` runs a real
  read→plan→act→reflect loop, capped so it can never spin forever.

> **`@theokit/sdk` stays the only runtime.** These decorators are *metadata* the harness adapts —
> no file here calls an LLM, dispatches a tool, or runs a second loop. Mix `@theokit/sdk-tools`'
> `createShellTool` / `createEditFileTool` into the same `@Toolbox` to gate shell and edits the same
> way.

## Step 7 — The chat UI

The scaffold's `app/page.tsx` already binds to an agent with the `useAgent` hook and renders the
stream with `@theokit/ui` components. Point it at your assistant:

```tsx
// app/page.tsx (the load-bearing lines)
'use client'
import { useAgent } from 'theokit/client'
import { ChatThread, ChatMessage, ToolCallCard, ChatComposer, AgentStreaming } from '@theokit/ui'

export default function Page() {
  const { messages, send, status } = useAgent<{ message: string }>('/api/agents/assistant')
  // messages is the reconstructed ai-sdk UIMessage[] — text parts → ChatMessage,
  // tool parts → ToolCallCard. status === 'streaming' → <AgentStreaming />.
  // Call send({ message }) from your <ChatComposer onSubmit>.
  // ...
}
```

`useAgent` consumes the `UIMessageStream`, reconstructs the assistant's messages (text + tool +
reasoning parts), and handles abort + StrictMode cleanup for you. The scaffold's page already wires
`ChatThread` / `ChatMessage` / `ToolCallCard` / `ChatComposer` — you only change the endpoint path.

## Step 8 — Run it in the terminal

You don't need the browser to iterate. The terminal harness runs a scanned agent and renders the
stream — text, `▸ tool(input)` cards with results, and an inline `Approve <tool>? (y/N)` prompt when
it hits a `@HumanInTheLoop` gate:

```bash
theokit agent assistant "list the top-level folders and summarize what each is for"
theokit agent coder "add a JSDoc header to src/index.ts"   # will prompt before writing
```

A message argument is required. In a non-interactive terminal the approval prompt auto-denies
(fail-safe) — the same gate as the web route, rendered to stdout.

## Step 9 — Make it think before it answers

For hard reasoning (multi-file refactors, tricky bugs), turn on extended thinking. It's one field on
either surface:

```ts
// functional surface
export default defineAgent({ /* … */ reasoningEffort: 'high' })

// class surface
new ModelCapability('anthropic/claude-sonnet-4-6', 'high')
```

Valid values: `'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` (or any provider-specific string).
The reasoning renders as a distinct block in the UI; the SDK validates the value against the model.

## Step 10 — Build and ship

```bash
theokit build              # builds the app + server; scans agents/ into the manifest
theokit build --target theo-cloud   # bundle for TheoCloud, the primary deploy target
```

`theokit dev` and the built server mount agents through one shared wiring point, so the endpoint you
tested locally is the endpoint that ships.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Agent replies but never calls a tool | Check the tool `description` — it drives selection. Be specific about *when* to use it. |
| `ctx.context` is `undefined` in a custom tool | Confirm the agent declares `context: { … }` in `defineAgent` (or `.context()` in the builder). Only `defineAgentTool` handlers receive it; `@theokit/sdk-tools` factories take `{ projectRoot }` at construction time. |
| `theokit agent <name>` errors "a message is required" | Pass the message: `theokit agent assistant "…"`. |
| Provider errors | Confirm the key is in `.env` and the `model` id is namespaced (`anthropic/…`, `openai/…`). |

## What's real vs. what you verify

- **Verified against shipped code (v1.0.0):** `defineAgent({ input, model, system, context, reasoningEffort, tools })`;
  `AgentBuilder.create().model().system().context().tool().use().build()` fluent builder (M8);
  `defineAgentTool({ name, description, inputSchema, handler(input, ctx) })` from `theokit/server` —
  `ctx.context` carries the agent-level context declared in `defineAgent`/`.context()` (M7);
  `@Agent / @Tool / @Toolbox / @HumanInTheLoop / @Checkpoint / @Mixin / @MainLoop` surface;
  `useAgent` from `theokit/client`; `theokit agent <name> "<msg>"`; `@theokit/sdk-tools`
  exports (`createReadFileTool`, `createListDirTool`, `createSearchTextTool`, `createGlobTool`,
  `createEditFileTool`, `createWriteFileTool`, `createShellTool`, `createGitDiffTool`, `buildRepoMap`,
  each returning a `CustomTool`). `@theokit/sdk` is the only agent runtime.
- **Proven by executing this guide:** `npm create theokit` → `pnpm install` →
  `pnpm add @theokit/sdk-tools` resolves cleanly; `theokit build` compiles **both**
  `agents/assistant.ts` (sdk-tools + custom `defineAgentTool`) and `agents/coder.ts` (HITL
  decorators), scans them into the manifest as `POST /api/agents/assistant` + `/coder`, and
  generates the typed client `.theokit/agents.d.ts`.
- **You verify in your app:** the exact model behavior (needs your provider key).

## Where to go next

- Gate `createShellTool` behind `@HumanInTheLoop` and let the assistant run tests it wrote.
- Add `createGitDiffTool` so it can review its own changes before proposing them.
- Use `buildRepoMap` in the system prompt to give the agent a map of the repo on turn one.
