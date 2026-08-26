---
'theokit': minor
---

Usage survives a restart. `SqliteUsageStorage` is the first durable `UsageStorageAdapter` in the framework.

The interface existed so a deployment could answer "what did this tenant cost last month", and every implementation in the organisation was in-memory — so no question spanning a process lifetime could be answered at all. For anything that bills, meters or caps per tenant, that is the whole reason to record usage (#459).

```ts
import { SqliteUsageStorage } from 'theokit/server/cost'

const usage = new SqliteUsageStorage('./.data/usage.db')
```

Same two-method contract, same inclusive period boundaries as `InMemoryUsageStorage` — an adapter swap must not change an invoice, so that rule is asserted rather than assumed. Both record kinds are stored; `getUsage` sums only LLM rows, because a tool call has no token or cost dimension and counting it as a run would inflate the total.

Built on `node:sqlite` rather than a dependency: the engine is already `>=22.12`, the module ships with Node, and adding a native driver to a framework whose install weight is itself an open issue (#460) would have traded one problem for another. A deployment that wants Postgres implements the same interface — this is the durable default, not the only shape.

`dispose()` closes the handle, unlike the in-memory adapter's noop, so a graceful shutdown does not leave the WAL unmerged.
