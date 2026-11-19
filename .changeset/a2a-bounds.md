---
'@theokit/agents': minor
---

`createA2ATool` gains `timeoutMs`, composed with the caller's signal; a peer that does not answer in time rejects with the new `A2ATimeoutError`. `createA2AJsonRpcHandler` gains `maxInFlight` and `retryAfterSeconds`: a request over the limit answers 503 with `retry-after` before its body is read, and a slot is held until `respond` settles.
