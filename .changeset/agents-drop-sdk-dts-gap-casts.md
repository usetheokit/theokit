---
'@theokit/agents': patch
---

Dropped the casts written for the old SDK `.d.ts` gap and the hand-copied hook-approval and hook-context types; they now come from `@theokit/sdk`, and a build-time check fails if the SDK adds a compat surface the gate does not know.
