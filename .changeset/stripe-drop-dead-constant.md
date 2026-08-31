---
'theokit': patch
---

`stripe.ts` no longer ends in a dead constant justified by a comment that was not true of it.

`const __stripeInternalEnc = enc` was described as a re-export that kept `enc` from being an orphan
and pre-warmed a decoder. It was not exported, `enc` already had a consumer one function above, and
assigning a binding to another name runs no code. Nothing read it, in source or in the built
output. The cost was never the byte: a false rationale is more expensive to remove than none, which
is how it survived several passes over the file.
