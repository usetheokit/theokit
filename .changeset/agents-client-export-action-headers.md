---
'@theokit/agents': minor
---

`@theokit/agents/client` exports `AGENT_ACTION_HEADERS` and `agentRequestHeaders`, so a plain `fetch` to an agent route can send the `X-Theo-Action` header its CSRF gate requires.
