# Agent-to-Agent (A2A)

Let another system discover your agent and call it — and let your agent call agents living on other
systems. A2A is an HTTP standard: every agent advertises a card at a well-known URL, and any
A2A-aware client can invoke it.

---

## Advertise your agent (agent cards)

Every agent in `agents/` is served as an A2A agent card at:

```
GET /.well-known/<agent-name>/agent-card.json
```

The card declares the agent's name, its endpoint URL, streaming capability, and each of its tools as
an A2A skill — built from the agent manifest by `buildAgentCard` and served by the dev/prod handler.

```json
{
  "name": "support-agent",
  "description": "TheoKit agent \"support-agent\".",
  "url": "https://app.example.com/api/agents/support-agent",
  "version": "1.0",
  "capabilities": { "streaming": true, "pushNotifications": false, "stateTransitionHistory": false },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [{ "id": "search_docs", "name": "search_docs", "description": "Search the knowledge base" }]
}
```

Other systems read this to learn what your agent can do — no shared code, just the card.

---

## Call a remote agent (A2A client)

`createA2ATool` wraps a remote A2A agent as a tool your agent can call — cross-network delegation:

```ts
import { defineAgent, createA2ATool } from '@theokit/agents'

const remoteResearcher = createA2ATool({
  url: 'https://research.example.com/api/agents/researcher',
  name: 'ask_researcher',
  description: 'Delegate a research question to the remote research agent.',
  auth: { bearer: process.env.RESEARCH_TOKEN! },
})

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  tools: [remoteResearcher],
})
```

The model calls `ask_researcher` with a `{ message }`; the tool POSTs it to the remote agent and
returns its response. The call uses `fetch` (Web Standards) — the target is a remote agent, not an
LLM provider, so it does not touch the SDK-runtime boundary.

**Auth** — `auth: { bearer }` sends `Authorization: Bearer <token>`; `auth: { apiKey: { header, value } }`
sends a custom header. A non-2xx response throws a typed error.

---

## How it works

`buildAgentCard(entry, { baseUrl, description? })` and `wellKnownCardPath(name)` (in `@theokit/agents`)
are pure generators — no LLM, no runtime. The framework serves the card over HTTP; `createA2ATool`
is the client side. Cross-network delegation composes with everything else: the remote result flows
back as a normal tool result the model reasons about.

---

## Related

- [Multi-agent](./multi-agent.md) — in-process delegation (`delegate`, `defineSubAgent`)
- [MCP](./mcp.md) — expose your agent as an MCP server (a different interop protocol)
- [Feature backlog](./feature-backlog.md) — parity tracker (M15)
