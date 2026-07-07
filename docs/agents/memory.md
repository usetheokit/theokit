# Agent memory

TheoKit agents have two distinct memory layers:

| Layer | What it stores | When it's used |
|---|---|---|
| **Conversation history** | Messages, tool calls, and results from each turn | Always — the model needs previous messages to reason correctly |
| **Durable facts** | Extracted structured facts (preferences, goals, key data) | Opt-in — when the agent needs to remember things across separate conversations |

---

## Conversation history

Every `send()` call is part of a conversation. TheoKit persists all messages so the agent
remembers what was said — even after a restart.

By default, history is stored as append-only JSONL at:

```
.theokit/agents/<agent-id>/messages.jsonl
```

No configuration needed. Start the agent and history accumulates automatically.

### ConversationStorageAdapter

For production — serverless deploys, multi-host, TheoCloud — plug in a custom adapter:

```ts
import type { ConversationStorageAdapter, StoredMessage } from '@theokit/sdk'

class PostgresConversationStorage implements ConversationStorageAdapter {
  async getMessages(conversationId: string, opts?: { offset?: number; limit?: number }) {
    // Query your DB; return [] if conversationId doesn't exist
    return db.query('SELECT * FROM messages WHERE conversation_id = $1', [conversationId])
  }

  async appendMessage(conversationId: string, message: StoredMessage) {
    await db.query(
      'INSERT INTO messages (conversation_id, role, content, at) VALUES ($1, $2, $3, $4)',
      [conversationId, message.role, message.content, message.at ?? Date.now()]
    )
  }
}

const agent = await Agent.create({
  model: 'anthropic/claude-sonnet-4-6',
  conversationStorage: new PostgresConversationStorage(),
  local: { cwd: process.cwd() },
})
```

The adapter contract:
- `getMessages(id, opts?)` — return messages in insertion order; return `[]` (not throw) when the conversation doesn't exist. Accepts optional `{ offset, limit }` for pagination.
- `appendMessage(id, msg)` — append atomically. Create the conversation lazily.
- `appendMessages?(id, msgs)` — optional batch append for an entire turn in one operation.

### Scoping conversations per user

The `conversationId` identifies a conversation. For multi-user apps, encode user and thread
into the ID:

```ts
const conversationId = `user-${userId}-thread-${threadId}`

await agent.send('Hello', { conversationId })
```

Any string works — the SDK treats it as an opaque identifier. How you scope is your choice.

---

## Durable facts memory

When a user says "my timezone is UTC-3" or "I prefer TypeScript over JavaScript", the agent
should remember that across separate conversations — not just within one thread.

Enable durable memory on the agent:

```ts
import { defineAgent } from '@theokit/agents'

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  memory: {
    enabled: true,
    scope: 'user',      // 'agent' | 'user' | 'team'
    namespace: 'coder', // isolates facts from other agents
  },
})
```

Facts are stored as JSON under `.theokit/memory/<namespace>/<scope>-<userId>.json` and
auto-recalled at the start of each run as a `<memory>` block in the system prompt:

```xml
<memory>
  - Timezone: UTC-3
  - Preferred language: TypeScript
  - Last project: api-gateway
</memory>
```

### Memory scopes

| Scope | Stored per | Use when |
|---|---|---|
| `agent` | Agent instance | Facts global to this agent (shared by all users) |
| `user` | User ID | Personal preferences, history, goals |
| `team` | Team ID | Shared knowledge within a team |

### Memory search tools

When `memory.enabled` is true, the SDK registers two tools the model can call:

- `memory_search` — full-text search across stored facts
- `memory_get` — retrieve a fact by ID

The model uses these automatically to look up past context. You don't wire them
manually — they're injected alongside the agent's tools.

To disable tool injection (for example, when you want read-only fact recall):

```ts
memory: {
  enabled: true,
  scope: 'user',
  index: { tools: false },
}
```

---

## Semantic memory index

For deeper recall — searching across all past sessions, memory files, and wiki documents by
meaning rather than exact text — open a memory index:

```ts
import { Memory } from '@theokit/sdk'

const index = await Memory.openIndex({
  cwd: process.cwd(),
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
})

await index.sync()  // index all files under .theokit/memory/ + sessions + wiki/

const results = await index.search('user timezone preference', {
  maxResults: 5,
  sources: ['memory', 'sessions'],
})

console.log(results)
// [{ path: '...', snippet: '...', score: 0.92, citation: '...' }]

await index.close()
```

Supported embedding providers:

| Provider | Env var |
|---|---|
| `openai` | `OPENAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `voyage` | `VOYAGE_API_KEY` |
| `deepinfra` | `DEEPINFRA_API_KEY` |
| `ollama` | _(local, no key)_ `OLLAMA_HOST` for remote |

The default backend is SQLite + FTS5 (`sqlite-vec`). For large-scale deployments, switch to
LanceDB:

```ts
const index = await Memory.openIndex({
  cwd: process.cwd(),
  embedding: { provider: 'openai' },
  backend: 'lance',  // requires: pnpm add @lancedb/lancedb
})
```

### Dreaming sweep — fact consolidation

Over time, the memory accumulates redundant or contradictory facts. Run the dreaming sweep
to deduplicate and cluster:

```ts
const result = await Memory.runDreamingSweep({
  cwd: process.cwd(),
  embedding: { provider: 'openai', model: 'text-embedding-3-small' },
  dedupThreshold: 0.95,    // cosine similarity threshold for dedup
  clusterThreshold: 0.75,  // threshold for grouping related facts
})

console.log(result)
// {
//   status: 'ok',
//   factsBefore: 142,
//   factsAfter: 89,
//   duplicatesRemoved: 31,
//   clustersCreated: 7,
//   notesWritten: 7,
// }
```

Run this on a schedule (nightly cron, post-session) rather than on every request.

---

## What TheoKit doesn't have (yet)

**Background compression** — Mastra-style agents that automatically summarize and compress
long message history in the background are not in TheoKit. For very long conversations, paginate
via `getMessages(id, { limit: 50, offset: -50 })` to keep only recent context, or implement
compression in a custom `ConversationStorageAdapter`.

---

## Related

- [Overview](./overview.md) — agents, models, tools
- [Using tools](./using-tools.md) — add tool capabilities to your agent
- [Run context](./run-context.md) — pass per-run config (userId, tenantId) to tool handlers
- [Build a code assistant](../guides/build-a-code-assistant.md) — end-to-end tutorial
