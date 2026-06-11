# Getting Started

Create a TheoKit app and run it locally.

## Quick Start

```bash
npx create-theokit my-app --yes
cd my-app
npm run dev
```

Visit `http://localhost:3000`. You'll see a task manager with an AI chat assistant.

## What You Get

The default template includes:

```
my-app/
├── app.ts                    # Entry — TheoApp.create()
├── app/
│   ├── layout.tsx            # Root layout (<html>, <head>)
│   └── page.tsx              # Home page
├── server/
│   ├── controllers/          # HTTP API (@Controller, @Get, @Post)
│   ├── agents/               # AI agents (@Agent, @MainLoop)
│   ├── toolboxes/            # Agent tools (@Toolbox, @Tool)
│   ├── guards/               # Auth/RBAC (@UseGuards)
│   ├── interceptors/         # Request transforms
│   ├── filters/              # Error formatting
│   └── store.ts              # In-memory data
├── public/
│   └── index.html            # Frontend with chat UI
├── AGENTS.md                 # Guide for coding agents
├── eslint.config.mjs         # ESLint 9 flat config
├── .prettierrc               # Prettier config
└── tsconfig.json             # TypeScript (strict, @/* aliases)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server (tsx --watch) |
| `npm run dev:bun` | Start with Bun (faster) |
| `npm run build` | Build for production (tsup) |
| `npm run start` | Run production build |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |
| `npm run typecheck` | TypeScript type check |

## Create a Controller

```typescript
// server/controllers/users.controller.ts
import { Controller, Get, Post, Body, Param } from '@theokit/http'
import { z } from 'zod'

const zCreateUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller('api/users')
export class UsersController {
  @Get()
  list() {
    return [{ id: 1, name: 'Alice' }]
  }

  @Post()
  create(@Body(zCreateUser) body: z.infer<typeof zCreateUser>) {
    return { id: 2, ...body }
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return { id: Number(id), name: 'Alice' }
  }
}
```

Register in `app.ts`:

```typescript
import { UsersController } from './server/controllers/users.controller.js'

const app = await TheoApp.create({
  controllers: [TasksController, UsersController],
  // ...
})
```

## Create an Agent

```typescript
// server/agents/research.agent.ts
import { Agent, MainLoop, Mixin } from '@theokit/agents'

@Agent({
  name: 'research',
  route: '/api/agents/research',
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You are a research assistant.',
})
@Mixin(MyTools)
export class ResearchAgent {
  @MainLoop({ strategy: 'react', maxIterations: 5 })
  async run() {}
}
```

## Environment Variables

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE
```

Get a key at [openrouter.ai](https://openrouter.ai).

## TypedClient (Frontend)

```typescript
import { createTypedClient } from '@theokit/http'

const api = createTypedClient('http://localhost:3000')
const users = await api.get('/api/users')
const newUser = await api.post('/api/users', { name: 'Bob', email: 'bob@test.com' })
```

## Health Probes

Built-in for Kubernetes:

- `GET /__theo/health` → `{ status: 'ok', uptime, timestamp }`
- `GET /__theo/ready` → `{ status: 'ready', checks: [...] }`

## API Documentation

Built-in Scalar UI: visit `GET /__theo/openapi/docs` in the dev server.

## Next Steps

- [Database Guide](guides/database.md) — Connect Postgres or SQLite
- [Deployment Guide](guides/deploy.md) — Deploy to Docker, Vercel, or AWS
