---
"@theokit/agents": minor
---

`deleteSession` re-checks protection immediately before unlinking, instead of trusting a snapshot taken before an await.

The protection check ran at the top of the function; control then left for as long as the caller's registry remover took — 30s by default, unbounded with `registryTimeoutMs: Infinity` — and only then was the transcript removed. Anything concluded before that await is a snapshot, and a user resuming the session during the window makes it false. The file was deleted anyway and `SessionInUseError` never fired, which is the outcome that error exists to prevent.

The batch path already treats this as non-negotiable: `transcript-gc.ts` invariant 4 is "the apply phase re-checks — a plan is a snapshot, and between snapshot and delete a user can resume a session". The single-session path skipped it, and it is the one with no later sweep to catch the mistake.

`SessionInUseError` gains `registryRemoved`. Refusing after the registry half has run leaves an orphan file — the recoverable direction the function already chose in its ordering — but the caller has to be told, or it retries a removal that is already done and reads the resulting `false` ("no entry to remove") as a failure. The constructor parameter is optional and defaults to `false`, so existing construction sites are unaffected.
