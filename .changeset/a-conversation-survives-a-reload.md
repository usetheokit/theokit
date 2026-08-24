---
'@theokit/agents': minor
---

A conversation survives a reload: `chatId` can be supplied and read.

`AgentClient` drew `#chatId` in its field declaration and offered no way to supply one or to read
the one it drew. The id is not decorative — the HTTP transport sends it as the top-level `id`, which
the server reads as the session id — so every `new AgentClient(...)` started a new conversation, and
reloading the page silently abandoned the thread the server still held.

```ts
const client = new AgentClient(transport, undefined, { chatId: localStorage.getItem('chat') ?? undefined })
localStorage.setItem('chat', client.chatId)
```

Both halves matter. Reading without supplying lets an application persist an id it can never
restore; supplying without reading leaves it nothing to persist.

The default is unchanged and deliberately so: two clients built with no id are still two
conversations. Sharing one by default would let two unrelated tabs write into the same thread, which
is the opposite defect and the more dangerous one.
