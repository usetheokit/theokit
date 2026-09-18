---
"theokit": patch
---

Scope the HITL approvals listing to the caller. `GET /api/agents/{name}/approvals`
returned every pending approval in the process to any admitted caller, so one tenant
could read another tenant's approval ids, tool names and arguments — and, holding an
id, act on a decision that was never theirs to make.

The listing now filters by the subject the request resolved to. An approval whose owner
the registry does not know stays visible, because withholding it would break a
single-tenant application that never declared a policy; an approval with a known owner
is visible only to that owner.

The subject is resolved **once**, during admission, and reused. Resolving it again in the
listing branch would have run an application's `createContext` for urls the dispatcher
declines, which is the contract `resolveSubject` already had and the reason the admission
path returns the subject instead of recomputing it.
