---
"theokit": minor
---

An identity resolution that throws now answers `500 IDENTITY_UNAVAILABLE` instead of escaping the deploy entry. Previously a `createContext` that threw in `server/context.ts` propagated out of the handler, so what a caller received was whatever the runtime made of an unhandled rejection rather than the error envelope this framework produces everywhere else.

The new code exists so an operator can tell two things apart that used to look identical: **a caller who sent no credential** (`403 FORBIDDEN`, the policy refusing `subject: null`) and **the thing that reads credentials being broken** (`500 IDENTITY_UNAVAILABLE`). Absorbing the failure would have produced the first for the second, which is the worse of the two errors — a broken identity source reading, in a log, as a routine refusal.

Only the application's own resolution is shaped this way. A policy that throws, or a `policy` export of the wrong type, still surfaces as it did: those are a developer's mistake rather than a runtime outage, and one code for two problems helps nobody.
