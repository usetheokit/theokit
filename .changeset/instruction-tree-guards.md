---
'@theokit/agents': patch
---

Two silent failures in the instruction-tree walk.

`paths: [unclosed` produced the scope `unclose`. The inline branch did
`inline.slice(1, inline.lastIndexOf(']'))`, and `lastIndexOf` returns -1 when the bracket never
arrives — so the slice quietly dropped the last character and handed back a scope nobody wrote.
Worse than an empty list, because a scope that exists suppresses `scopesUnreadable`: the block looked
correctly scoped, to a path matching nothing, so the rule stopped applying anywhere and said nothing.

The depth ceiling stopped in silence. The file ceiling already announced itself
(`instruction budget: stopped at N files`) and this one was a bare `return false` — indistinguishable
from a directory that had nothing left in it, which sends the reader looking for a typo in a filename
that is spelled correctly.
