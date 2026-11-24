---
'@theokit/agents': patch
---

`resolveAgentCredential` resolves a `openai-chatgpt/…` model from the stored OpenAI OAuth login only, so an API key in the environment cannot win over it; with no such login it throws `CredentialNotFoundError` naming the login, without any key value.
