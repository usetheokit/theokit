---
"@theokit/agents": minor
---

`LivenessVerdict` now carries the `cwd` it is about, so a caller can act on the verdict instead of parsing a sentence.

`classifyProjects` PROBES a path to decide `alive` — it has it in hand at the moment it returns — and kept only a prose `reason`. That made the verdict unable to replace the function it was absorbed from: the consumer's GC uses the resolved cwd to consult the agent registry and the resumable pointer for that project (`all-sessions.ts:161,175`). Recovering it by string-matching `reason` would be exactly the fragile coupling this module exists to remove.

`alive` reports the member of the collision class that was found to EXIST, not the first one read — the class can hold a gone path and a live one, and sending a registry lookup to the gone sibling defeats the point. `dead` reports the recorded cwd that was checked and found missing. `undetermined` established no path, so the field is absent rather than an empty string a caller might mistake for one.

Additive and optional: no existing call site changes.
