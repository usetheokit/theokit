---
name: theokit-frontend
description: TheoKit frontend — file-based routing, layouts, theoFetch typed client, useAgent, React patterns
user-invocable: false
paths:
  - 'src/app/**'
---

# TheoKit Frontend (React + File-Based Routing)

## File-Based Routing

| File                      | URL          | Purpose                       |
| ------------------------- | ------------ | ----------------------------- |
| `app/page.tsx`            | `/`          | Home page                     |
| `app/layout.tsx`          | (wrapper)    | Root layout (wraps all pages) |
| `app/error.tsx`           | (error)      | Error boundary                |
| `app/loading.tsx`         | (loading)    | Suspense fallback             |
| `app/not-found.tsx`       | (404)        | Not found page                |
| `app/about/page.tsx`      | `/about`     | Nested route                  |
| `app/tasks/[id]/page.tsx` | `/tasks/:id` | Dynamic route                 |

## Typed API Client (theoFetch)

```typescript
import { theoFetch } from 'theokit/client'

// The URL is used literally — build it yourself for a dynamic route.
const tasks = await theoFetch('/api/tasks')
const task = await theoFetch(`/api/tasks/${id}`)

// POST with body. `method` is REQUIRED when the route declares one.
const created = await theoFetch('/api/tasks', {
  method: 'POST',
  body: { title: 'New task' },
})
```

`theoFetch` has **no `params` option.** Its options are `RequestInit` minus `body`/`method`, plus a
conditional `query` and `body` — nothing interpolates a `:id` segment for you. Reach for the
generated client below when you want that; it is the half that knows your route tree.

## App Client (proxy-based)

```typescript
import { createAppClient } from 'theokit/client'

const client = createAppClient()

const tasks = await client.tasks.get()
const task = await client.tasks.id.get({ params: { id: '42' } }) // → GET /api/tasks/42
const created = await client.tasks.post({ body: { title: 'New' } })
```

Three details the generator decides for you, and each is easy to guess wrong:

- **methods are lowercase** — `get`, `post`; the export in your route file stays `GET`
- **a dynamic segment loses its colon** — `app/tasks/[id]` is reached as `client.tasks.id`, not
  `client.tasks[':id']`
- **`params` values are strings** — `{ id: '42' }`; a URL segment has no other type

Segments are otherwise kept **literal**, so a hyphenated route needs bracket access:
`client['agents-config'].get()`. The client mirrors your URLs rather than prettifying them — a
camelCased key once produced a request to a path no route served.

## Agent Streaming

Two client APIs from `theokit/client`:

### useAgent (React hook — most common)

```typescript
import { useAgent } from 'theokit/client'

function ChatUI() {
  const { messages, status, send, reset } = useAgent<{ message: string }>('/api/agents/chat')

  return (
    <div>
      {status === 'streaming' && <p>Thinking...</p>}
      {messages.map(message => (
        <div key={message.id}>
          {message.parts.map((part, i) =>
            part.type === 'text' ? <p key={i}>{part.text}</p> : null
          )}
        </div>
      ))}
      <button onClick={() => send({ message: 'Hello' })}>Send</button>
    </div>
  )
}
```

`messages` is `UIMessage[]` (ai-sdk). Render `message.parts`: text parts
(`part.type === 'text'`, `part.text`) and tool parts (`part.type === 'dynamic-tool'`,
`part.toolName`, `part.state`, `part.output`). Do NOT switch on an `events`/`event.type`
pattern — the wire is `UIMessageStream`, not SSE events.

### consumeUIMessageStream (non-React)

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

## Path Aliases

```typescript
import { db } from '@/server/db' // @/ = project root
import { tasks } from '@/server/db/schema'
```

Configured in `tsconfig.json` — works in both server and app code.

## Anti-patterns

- NEVER use raw `fetch('/api/...')` — use `theoFetch` for type safety
- NEVER create pages outside `app/` — they won't be discovered by the router
- NEVER import server code directly in `app/` — use theoFetch or server actions
- NEVER use `useEffect` + `fetch` for data loading — use theoFetch or `useAgent`
