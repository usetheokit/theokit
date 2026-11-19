---
'@theokit/agents': patch
---

`deleteSession` keeps the transcript (`transcriptRemoved: false`) when `isListedInRegistry` reports the id is still listed after the removal, so the registry entry is not left pointing at a deleted file.
