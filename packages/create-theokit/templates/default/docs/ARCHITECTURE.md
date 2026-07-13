# Architecture

How this TheoKit app is organized. The layout puts the **agent at the center**: the agent file and the
folders it composes (prompts, tools, skills) live together under `agents/`, with clean names — the
"file = identity" convention agent frameworks like [Eve](https://eve.dev) use.

## Project structure

```
.
├── agents/                 # The agent, and what composes it
│   ├── chat.ts             #   the agent → POST /api/agents/chat, useAgent('chat')
│   ├── prompts/            #   system prompts / personas
│   │   └── instructions.ts
│   ├── tools/              #   tools the agent can call
│   │   └── weather.ts      #     tool('weather')…build()
│   └── skills/             #   Markdown procedures the agent (and you) can follow
│       └── getting-started.md
├── app/                    # Frontend (web surface). tui → tui/, desktop → frontend/
├── server/                 # Backend routes / actions (POST/GET handlers, jobs)
├── shared/                 # Code imported by more than one layer
│   └── agent.ts            #   branding (name, model, greeting) — one source of truth
├── types/                  # Framework ambient declarations (e.g. the job registry)
├── docs/                   # This folder
└── theo.config.ts          # App config (name, dirs, plugins)
```

## Clean names, no phantom routes

An agent is a file: `agents/<name>.ts` → `POST /api/agents/<name>`. But the framework's scanner is
**folder-semantic** — the conventional sub-folders under `agents/` (`prompts/`, `tools/`, `skills/`,
`lib/`, `hooks/`, `channels/`, `connections/`, `subagents/`, `schedules/`) are **that concern, not routes**.
So the names stay clean (`tools/`, not `_tools/`) and `agents/tools/weather.ts` never becomes a phantom
`/api/agents/tools/weather` endpoint. Markdown (`skills/*.md`) is never scanned either way. The
prompts/tools/skills are **shared** across every agent in `agents/`.

## Composition

`agents/chat.ts` is thin on purpose — it wires the pieces together:

```ts
export default agent()
  .input(z.object({ message: z.string() }))
  .model('openai/gpt-4o-mini')
  .system(BASE_INSTRUCTIONS)   // agents/prompts/instructions.ts
  .tool(weatherTool)           // agents/tools/weather.ts
  .build()
```

Grow the agent by editing its neighbours, not by inflating `chat.ts`: persona → `prompts/instructions.ts`,
a new capability → `tools/<name>.ts` (then `.tool(<name>Tool)`), a documented procedure →
`skills/<name>.md`. Add a **second agent** as another `agents/<name>.ts`.

## Surfaces

The same agent is reached from three interchangeable frontends — only the transport differs:

| Surface | Frontend dir | Transport |
|---------|--------------|-----------|
| web | `app/` | `HttpTransport` (`/api/agents/chat`) |
| tui | `tui/` | `InProcessTransport` |
| desktop | `frontend/` | `ChannelTransport` (`@theokit/tauri`) |

All three render the same `@theokit/ui` chat and read `shared/agent.ts` for the greeting + model label.

See also: [CUSTOMIZATION](./CUSTOMIZATION.md).
