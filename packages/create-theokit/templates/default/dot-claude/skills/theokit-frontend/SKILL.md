---
name: theokit-frontend
description: TheoKit frontend — file-based routing, layouts, theoFetch typed client, useAgentStream, React patterns
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

Three client APIs, all from `theokit/client`:

### useAgentStream (React hook — most common)

```typescript
import { useAgentStream } from 'theokit/client'

function ChatUI() {
  const { status, events, send, reset } = useAgentStream('/api/agents/assistant')

  return (
    <div>
      {status === 'streaming' && <p>Thinking...</p>}
      {events.map(event => (
        <div key={event.id}>
          {event.type === 'message' && <p>{event.content}</p>}
          {event.type === 'tool_call' && <p>Using tool: {event.name}</p>}
        </div>
      ))}
      <button onClick={() => send({ message: 'Hello' })}>Send</button>
    </div>
  )
}
```

### consumeAgentStream (non-React, async iterable)

```typescript
import { consumeAgentStream } from 'theokit/client'

const stream = consumeAgentStream('/api/agents/assistant', {
  body: { message: 'Hello' },
})
for await (const event of stream) {
  console.log(event.type, event.content)
}
```

### parseSSEChunk (low-level SSE parser)

```typescript
import { parseSSEChunk } from 'theokit/client'

// Parse a single SSE line into an AgentEvent (or null)
const event = parseSSEChunk('data: {"type":"message","content":"Hello"}')
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
- NEVER use `useEffect` + `fetch` for data loading — use theoFetch or useAgentStream
