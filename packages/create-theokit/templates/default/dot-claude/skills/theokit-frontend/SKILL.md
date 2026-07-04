---
name: theokit-frontend
description: TheoKit frontend — file-based routing, layouts, theoFetch typed client, useAgent, React patterns
user-invocable: false
paths:
  - "app/**"
---

# TheoKit Frontend (React + File-Based Routing)

## File-Based Routing

| File | URL | Purpose |
|------|-----|---------|
| `app/page.tsx` | `/` | Home page |
| `app/layout.tsx` | (wrapper) | Root layout (wraps all pages) |
| `app/error.tsx` | (error) | Error boundary |
| `app/loading.tsx` | (loading) | Suspense fallback |
| `app/not-found.tsx` | (404) | Not found page |
| `app/about/page.tsx` | `/about` | Nested route |
| `app/tasks/[id]/page.tsx` | `/tasks/:id` | Dynamic route |

## Typed API Client (theoFetch)

```typescript
import { theoFetch } from 'theokit/client'

// Typed fetch — params and response inferred from server routes
const tasks = await theoFetch('/api/tasks')
const task = await theoFetch('/api/tasks/:id', { params: { id: 1 } })

// POST with body
const created = await theoFetch('/api/tasks', {
  method: 'POST',
  body: { title: 'New task' },
})
```

## App Client (proxy-based)

```typescript
import { createAppClient } from 'theokit/client'

const client = createAppClient()

const tasks = await client.tasks.GET()
const task = await client.tasks[':id'].GET({ params: { id: 1 } })
const created = await client.tasks.POST({ body: { title: 'New' } })
```

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
import { db } from '@/server/db'          // @/ = project root
import { tasks } from '@/server/db/schema'
```

Configured in `tsconfig.json` — works in both server and app code.

## Anti-patterns

- NEVER use raw `fetch('/api/...')` — use `theoFetch` for type safety
- NEVER create pages outside `app/` — they won't be discovered by the router
- NEVER import server code directly in `app/` — use theoFetch or server actions
- NEVER use `useEffect` + `fetch` for data loading — use theoFetch or `useAgent`
