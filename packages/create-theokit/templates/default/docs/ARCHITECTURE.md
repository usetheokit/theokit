# Architecture

How this TheoKit app is organized. The layout puts the **agent at the center** and keeps a clean split
between the agent, the backend, the frontend, and cross-layer code.

## Project structure

```
.
├── agents/                 # The agent lives here (auto-served at POST /api/agents/<name>)
│   ├── chat.ts             #   the agent — composed from its neighbours below
│   ├── _lib/               #   internal helpers (underscore = NOT a route)
│   │   └── instructions.ts #     the system prompt / persona
│   ├── _tools/             #   tools the agent can call (underscore = NOT a route)
│   │   └── weather.ts      #     example: tool('weather')…build()
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

## Why `_lib/` and `_tools/` have an underscore

The framework turns **every `.ts` under `agents/` into a `POST /api/agents/<name>` endpoint** (that is the
zero-config convention that lets `useAgent('chat')` bind with no manual wiring). Files that are *not*
agents — the persona, the tools — would otherwise become phantom endpoints, so they live in
underscore-prefixed folders, which the route scanner skips (the same convention Next.js uses for private
folders). `skills/` needs no underscore because Markdown is never scanned.

## Composition

`agents/chat.ts` is thin on purpose — it wires the pieces together:

```ts
export default agent()
  .input(z.object({ message: z.string() }))
  .model('openai/gpt-4o-mini')
  .system(BASE_INSTRUCTIONS)   // agents/_lib/instructions.ts
  .tool(weatherTool)           // agents/_tools/weather.ts
  .build()
```

Grow the agent by editing its neighbours, not by inflating `chat.ts`: persona → `_lib/instructions.ts`,
a new capability → `_tools/<name>.ts` (then `.tool(<name>Tool)`), a documented procedure → `skills/<name>.md`.

## Surfaces

The same agent is reached from three interchangeable frontends — only the transport differs:

| Surface | Frontend dir | Transport |
|---------|--------------|-----------|
| web | `app/` | `HttpTransport` (`/api/agents/chat`) |
| tui | `tui/` | `InProcessTransport` |
| desktop | `frontend/` | `ChannelTransport` (`@theokit/tauri`) |

All three render the same `@theokit/ui` chat and read `shared/agent.ts` for the greeting + model label.

See also: [CUSTOMIZATION](./CUSTOMIZATION.md).
