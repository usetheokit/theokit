---
'@theokit/agents': patch
---

The real-provider live tests send their model with the `openrouter/` prefix, so the SDK routes the job's OpenRouter model id to OpenRouter and not to the Google provider.
