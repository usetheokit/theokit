---
'@theokit/agents': minor
---

`deleteSession` accepts `isListedInRegistry` and measures `registryOutcome` from a listing before and after the removal. `RegistryOutcome` gained `still-present`.

When the id is still listed after the removal, the transcript is kept (`transcriptRemoved: false`).
