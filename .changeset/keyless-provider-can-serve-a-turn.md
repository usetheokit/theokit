---
'theokit': patch
---

A keyless provider can now actually serve a turn. Registering one (or using the builtin `ollama`) resolved correctly but the agent still refused to build with `missing_api_key`: the resolver reported an empty key, and the SDK treats an empty key as an absent one. Local models are reachable without any cloud credential.
