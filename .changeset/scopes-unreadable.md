---
'@theokit/agents': minor
---

`InstructionBlock.scopesUnreadable` — a declared `paths:` that yields nothing is no longer
indistinguishable from no scope at all.

`parsePathsScope` reads lines and never fails, so a `paths:` whose value it cannot extract returned
`[]` — the same value as a file that declared no scope. A consumer rendering `scopes` then turned a
rule written for one subtree into a rule applying everywhere, and nothing said so.

Widening a scope silently is the one frontmatter failure with a consequence: the model obeys a rule
outside the files it was written for. The flag lets a product with a fail-closed policy drop the
block instead of publishing it unscoped, and `onWarn` now reports the case.
