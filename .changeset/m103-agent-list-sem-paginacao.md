---
'@theokit/agents': major
---

**BREAKING:** `Agent.list` no longer accepts `limit` or `cursor`, and its result no longer declares `nextCursor`.

The SDK's type promises all three; the runtime references none of them — `Agent.list` reads only `options.runtime`. A caller that writes `limit: 500` against a 688-entry registry believes it asked for a bounded page and silently gets the whole set, and on the day the runtime starts honouring the parameter that *same* line silently gets a truncated one instead. Both directions are silent, and the consumer that motivated this change feeds the result into a NEVER-delete guard of a session garbage collector: a truncated list there means deleting a transcript the guard should have protected.

This is a type-only change — the exported value is still the SDK's `Agent`, asserted by identity in `tests/unit/agent-list-narrowed.test.ts`. Every other static (`create`, `getOrCreate`, `get`, `delete`, `archive`, `unarchive`, `rename`, `compact`, `listRuns`, `getRun`, `registry`) keeps its shape, asserted in `tests/type/agent-list-narrowed.test-d.ts`.

Migration is one line per call site: delete the `limit`/`cursor` property. The result is the full population, which is what the runtime was already returning.

Exit criterion, written in `src/index.ts` next to the narrowing: when the SDK runtime actually honours `limit`/`cursor`/`cwd`, delete the block and restore the plain re-export.
