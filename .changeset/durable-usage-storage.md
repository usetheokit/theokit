---
'theokit': minor
---

Usage survives a restart. `SqliteUsageStorage` is the first durable `UsageStorageAdapter` in the framework.

The interface existed so a deployment could answer "what did this tenant cost last month", and every implementation in the organisation was in-memory — so no question spanning a process lifetime could be answered at all. For anything that bills, meters or caps per tenant, that is the whole reason to record usage (#459).

```ts
import { SqliteUsageStorage } from 'theokit/server/cost/sqlite'

const usage = new SqliteUsageStorage('./.data/usage.db')
```

Its **own subpath**, not the `theokit/server/cost` barrel. That barrel is Web-Standards — it has to import cleanly on Cloudflare Workers and Deno Deploy, where `node:sqlite` does not exist — so putting this behind it would have made the whole cost subtree unimportable on five of the seven deploy targets. The import path also states the cost at the call site: a deployment writing `theokit/server/cost/sqlite` has said it runs on Node.

Same two-method contract, same inclusive period boundaries as `InMemoryUsageStorage` — an adapter swap must not change an invoice, so that rule is asserted rather than assumed. Both record kinds are stored; `getUsage` sums only LLM rows, because a tool call has no token or cost dimension and counting it as a run would inflate the total.

Built on `node:sqlite` rather than a dependency: no install time, no native build step, and adding a native driver to a framework whose install weight is itself an open issue (#460) would have traded one problem for another. A deployment that wants Postgres implements the same interface — this is the durable default, not the only shape.

`dispose()` closes the handle, unlike the in-memory adapter's noop, so a graceful shutdown does not leave the WAL unmerged.

**It needs a Node newer than this package's floor.** `engines.node` is `>=22.12` and `node:sqlite` is not a built-in module there — it arrived unflagged later in 22.x. The module is loaded lazily, so importing the subpath is safe everywhere and constructing the adapter on a runtime without it fails with a message that names the reason and points at the interface. A deployment on 22.12 uses a different adapter; that is what opt-in behind its own subpath is for.
