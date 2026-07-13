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
│   │   ├── weather.ts      #     remote — current weather via open-meteo (HTTP)
│   │   └── current-time.ts #     local — date/time in an IANA timezone (no network)
│   └── skills/             #   procedures the model loads on demand (createSkill)
│       └── daily-briefing.ts    #   a real skill: time → weather → a one-line nudge
├── app/                    # Frontend (web surface). tui → tui/, desktop → frontend/
│   ├── page.tsx            #   the chat route — the VIEW (presentational, composes @theokit/ui)
│   ├── layout/error/loading/not-found.tsx  #   route surface (special files)
│   └── chat/               #   the chat feature's internals (never a route — holds no page file)
│       ├── use-transcript.ts   #     transcript STATE (history + streaming) — a hook
│       └── constants.ts        #     greeting + starter prompts (declarative config)
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
  .tool(currentTimeTool)       // agents/tools/current-time.ts
  .tool(defineSkillReadTool([dailyBriefingSkill]))  // agents/skills/daily-briefing.ts
  .build()
```

Grow the agent by editing its neighbours, not by inflating `chat.ts`: persona → `prompts/instructions.ts`,
a new capability → `tools/<name>.ts` (then `.tool(<name>Tool)`), a documented procedure → a
`createSkill(...)` in `skills/<name>.ts` (add it to the `defineSkillReadTool([...])` list). A **skill** is
loaded by the model on demand via the `skill_read` tool, so long procedures don't bloat every prompt. Add a
**second agent** as another `agents/<name>.ts`.

## Surfaces

The same agent is reached from three interchangeable frontends — only the transport differs:

| Surface | Frontend dir | Transport |
|---------|--------------|-----------|
| web | `app/` | `HttpTransport` (`/api/agents/chat`) |
| tui | `tui/` | `InProcessTransport` |
| desktop | `frontend/` | `ChannelTransport` (`@theokit/tauri`) |

All three render the same `@theokit/ui` chat and read `shared/agent.ts` for the greeting + model label.

## Frontend organization

The web `app/` follows the pattern every serious chat frontend converges on (Vercel's `ai-chatbot`, the
Vercel AI SDK docs): **the page is the presentational view; the transcript/streaming STATE lives in a
hook.** So `page.tsx` composes `@theokit/ui` components, `chat/use-transcript.ts` owns the message history +
in-flight merge, and `chat/constants.ts` holds the greeting + starter prompts. This keeps the tricky state
logic testable (`chat/use-transcript.test.ts`) and the view readable.

The structure separates two things **semantically**: the **route surface** (`page` / `layout` / `error` /
`loading` / `not-found`) stays at the `app/` root — those are the only files the router serves — and the
**chat feature's internals** live in a `chat/` folder. A folder becomes a route only when it contains a
`page` (or the other special files), so `chat/` — which holds only the feature's modules — is never served
(Next-style colocation). Grouping the feature's code in one folder (rather than scattering `hooks/` +
`lib/` with one file each) is feature-colocation: a second feature becomes its own `<feature>/` folder. Add
presentational components beside these when the view grows.

See also: [CUSTOMIZATION](./CUSTOMIZATION.md).
