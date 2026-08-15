---
'@theokit/agents': patch
---

`deleteSession` now refuses an async `removeFromRegistry` instead of reporting a delete that has not
happened.

The seam is synchronous by contract, and `options.removeFromRegistry?.(id) ?? false` sat at the
return: hand it an async remover and the field evaluated to a Promise — truthy — so `registryRemoved`
said the entry was gone before the removal occurred, and any rejection surfaced as an unhandled
rejection. That is not a corner case. `Agent.delete` returns `Promise<void>` and is the only agent
registry in the ecosystem, so every real caller has an async remover.

The check now runs BEFORE the transcript is unlinked, so a refused call leaves the session intact and
the caller can retry: await the registry removal first, then pass its outcome.
