---
"@theokit/agents": minor
---

`AuthProvider` takes an optional third argument, `{ refreshBeforeMs }`: `ensureFresh` refreshes an OAuth credential when its stored access token has less than that many milliseconds left, instead of only within the SDK's one-minute skew. It is meant for a consumer that hands the token to a process that keeps it for a long time, so the token outlives the process. The margin is applied to the value re-read under the cross-process lock, so passing an earlier `expiresAt` was never a way to get it, and a credential that was not refreshed comes back with its real expiry. A negative or non-finite margin throws a `RangeError` at construction. The default stays the SDK's skew. The `AuthProviderOptions` type is exported from `@theokit/agents/auth`. (#1286)
