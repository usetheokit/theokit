---
'@theokit/agents': patch
---

`@theokit/agents/auth` adds `parseModelRef`, `isSubscriptionRoute`, `modelForCredential` and a `customProviders` option on `resolveAgentCredential`, so apps stop hard-coding the `openai-chatgpt/` route.
