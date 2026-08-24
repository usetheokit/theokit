---
'@theokit/agents': minor
---

A model that takes no credential can delegate.

`createDelegateTool` refused to construct when any target was a `SubAgentSpec` and
`defaults.apiKey` was empty, and `delegate()` refused the same way deeper in its own call stack.
Both read "non-empty string" as the definition of authenticated — a safe reading while every
provider held a key, and no longer one now that a keyless provider (a model on the developer's own
machine) is reachable.

`apiKey: null` says the provider takes no credential. It is a distinct value from `''` on purpose:
an empty string is also what an unset environment variable produces, so accepting THAT would turn a
typo into an unauthenticated run. `undefined` still means the caller supplied nothing and is still
refused — at startup rather than at the model's first call, which is what the guard was for.

The refusal now names the option, so a reader who hits it is not left choosing between a fabricated
value and giving up.
