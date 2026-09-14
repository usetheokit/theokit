---
"@theokit/agents": minor
---

`settingSources: { user: true }` now reads the operator's roots instead of changing nothing.

The flag was accepted by the type, forwarded, and consulted by nobody. You could set it, see no
difference, and have no way to tell "this runtime does not read it" from "it read it and my value was
wrong" — the accepted-and-ignored failure this package removes everywhere else.

```ts
import { resolveOperatorRoots } from '@theokit/agents'

const { definitions, withheld } = resolveOperatorRoots({
  user: true,
  grants: ['claude-code'],   // only this admits the foreign root
})
```

**Two roots, one grant.** `~/.theokit/skills/` and `~/.theokit/agents/` are ours — `user: true` is
the whole permission. `~/.claude/skills/` and `~/.claude/agents/` belong to another product under a
shared home, and they pass the **same** `claude-code` dialect grant that already gates that product's
project surfaces. `user` says which machine; the dialect says whose format. Collapsing the two would
admit a foreign inventory on a flag that never mentioned it.

**Every definition carries its origin.** `origin: 'theokit' | 'claude-code'` — so you can tell a
definition you wrote for this product from one you wrote for another, at the point you use it rather
than by remembering which directory it came from.

**A withheld root is named, never counted.** `withheld` reports the path and the grant that would
admit it. Being told you lost something, without being told what, helps nobody.

**Nothing changes for `user` absent or false.** No filesystem walk happens at all — asserted on the
reported read count rather than on the empty result, because a read-everything-then-filter
implementation produces the same result at the cost of a walk on every run.

A root that exists and cannot be read raises `OperatorRootUnreadableError` rather than resolving to
empty: reporting it as empty would be indistinguishable from an operator who configured nothing.
