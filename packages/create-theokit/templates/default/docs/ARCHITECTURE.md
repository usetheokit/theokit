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
│   └── skills/             #   procedures the model loads on demand (Skill.create)
│       └── daily-briefing.ts    #   a real skill: time → weather → a one-line nudge
├── app/                    # Frontend (web surface). tui → tui/, desktop → frontend/
│   ├── page.tsx            #   the `/` route — composition root (lays out the components + the hook)
│   ├── layout.tsx          #   root layout — composes <Header/> over the routed page
│   ├── error/loading/not-found.tsx  #   route surface (special files)
│   ├── about/page.tsx      #   an EXAMPLE `/about` route — shows how screens grow (delete when done)
│   ├── components/         #   presentational UI (Tailwind, flat .tsx — no CSS modules)
│   │   ├── Header.tsx      #     the top bar (composes Nav + theme toggle)
│   │   ├── Nav.tsx         #     the navigation menu (a link per screen)
│   │   ├── ChatPanel.tsx   #     the transcript + streaming indicator + starter prompts
│   │   └── Composer.tsx    #     the input + error card + new-chat
│   ├── hooks/              #   custom hooks
│   │   └── use-transcript.ts  #     transcript STATE (history + streaming)
│   └── lib/                #   app modules / config
│       └── constants.ts    #     greeting + starter prompts
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
  .skills([dailyBriefingSkill])                 // agents/skills/daily-briefing.ts
  .build()
```

Grow the agent by editing its neighbours, not by inflating `chat.ts`: persona → `prompts/instructions.ts`,
a new capability → `tools/<name>.ts` (then `.tool(<name>Tool)`), a documented procedure → a
`Skill.create(...)` in `skills/<name>.ts` (add it to the `.skills([...])` list). A **skill** is
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

The web `app/` is organized **type-based**, the layout most React apps grow into:

| Folder | Holds | Example |
|---|---|---|
| `app/` root | the **route surface** — the only files the router serves | `page.tsx`, `layout.tsx`, `error/loading/not-found.tsx` |
| `components/` | presentational UI (flat `.tsx`; Tailwind, no CSS modules) | `Header`, `ChatPanel`, `Composer` |
| `hooks/` | custom hooks — where **state** lives | `use-transcript.ts` |
| `lib/` | app modules / config | `constants.ts` |

### Route files are not components

`page` · `layout` · `loading` · `error` · `not-found` are **route conventions**, not components. The
router binds them by **name + location**: matched by `^(page|layout|error|loading|not-found)\.(tsx|ts|jsx|js)$`
at a route segment (the `app/` root is the `/` route). `loading.tsx` becomes that route's Suspense
fallback, `error.tsx` its error boundary — *because they sit there, with that name*.

So `loading.tsx` looks like a component (it renders a spinner) but it is **not** one — move it into
`components/` and the router no longer finds it, and the route loses its loading UI. This is exactly the
Next.js App Router model TheoKit implements: the special files live at the route segment, and `components/`
/ `hooks/` / `lib/` sit alongside them. Having both at the `app/` root is the convention, not a mismatch.
(If a special file grows big, keep the thin route file and have it render a real component from
`components/` — e.g. `loading.tsx` → `<LoadingScreen/>`.)

Two rules make the rest work and keep it honest:

1. **State in a hook, view in components.** This is the pattern every serious chat frontend converges on
   (Vercel `ai-chatbot`, the AI SDK docs). `page.tsx` is a thin composition root — it lays out `<ChatPanel>`
   + `<Composer>` and pulls transcript state from `useChatTranscript`. The tricky history + in-flight merge
   is isolated + unit-tested (`hooks/use-transcript.test.ts`); the components are dumb and prop-driven.
2. **Folders aren't routes.** A folder is served only when it holds a `page`/`layout`/… file, so
   `components/`, `hooks/`, `lib/` are never routes (Next-style colocation). Add `utils/`, `styles/`,
   `assets/` when you actually have a helper, a global stylesheet, or an image — a scaffold ships the
   folders it *uses*, not empty placeholders (YAGNI).

The entry point is framework-owned — there is no `main.tsx`/`index.js`. Routes are files (`page.tsx`), not
a `pages/` folder you wire by hand: that's the Next.js-style convention TheoKit is built on.

### Adding a screen

Routing is **file-based**: a screen is a folder under `app/` with a `page.tsx`. The folder name is the URL
segment; the home screen is the flat `app/page.tsx`.

| You want | Create | Serves |
|---|---|---|
| a `/settings` screen | `app/settings/page.tsx` | `/settings` |
| a nested screen | `app/settings/billing/page.tsx` | `/settings/billing` |
| a dynamic screen | `app/users/[id]/page.tsx` | `/users/:id` (read the param with react-router's `useParams`) |
| a catch-all | `app/docs/[...slug]/page.tsx` | `/docs/*` |

The one-command way: **`theokit generate page settings`** creates `app/settings/page.tsx` for you. Each
screen can have its own `layout.tsx` / `loading.tsx` / `error.tsx` / `not-found.tsx` (the route special
files, scoped to that segment).

**Navigation + menus.** The routing runs on react-router (the same router `layout.tsx` renders via
`<Outlet/>`), but prefer TheoKit's own client primitives over the raw react-router ones:

```tsx
import { Link } from 'theokit/client'      // react-router Link + route prefetch (intent | viewport)
import { useLocation } from 'react-router'  // for active-link styling

<Link to="/settings" prefetch="intent">Settings</Link>
```

TheoKit's `theokit/client` gives you the Next-parity building blocks: **`Link`** (prefetch), **`Metadata`**
(set `<title>`/meta per route — used in `page.tsx` + `about/page.tsx`), **`Image`** (optimized `<img>`),
**`theoFetch`** + the **`theokit/react-query`** adapter (typed data fetching against your `server/`
routes), and **`useAgent`** (the chat stream). Reach for these instead of generic libraries.

The primary menu is `app/components/Nav.tsx` (TheoKit `Link` + `useLocation` for the active route). A worked
example ships as `app/about/page.tsx` (the `/about` route, linked from the `Nav`, with its own `Metadata`
title); it explains this and tells you to delete it once you've got the idea.

See also: [CUSTOMIZATION](./CUSTOMIZATION.md).
