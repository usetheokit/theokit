---
'theokit': patch
---

An internal failure now discloses the same amount over every transport.

The Node runner replaces an `INTERNAL_ERROR`'s message with a generic one in production, and so
does the Web runner's error builder. An exception escaping a Web handler travelled through neither:
it reached the client through a third path that built its `Response` by hand from the error
envelope, shipping `err.message` and `err.cause` verbatim. The same route, failing the same way,
disclosed a connection string over one transport and `"Internal server error"` over another — the
`rules/three-target-parity.md` "one contract, three transports" rule broken by duplication rather
than by design.

The rule is now stated once, in `core/contracts/client-safe-error.ts`, and all three paths ask it.
When it redacts, `cause`, `meta` and `ext` go with the message: they exist to describe the failure,
and the point is that this failure is not describable to the caller. The code stays, so a client
can still branch on it.

`proxyFetch` had the same shape in its own corner: a failed upstream `fetch` reports why it failed,
and the reason names the upstream — host, port, sometimes credentials — which it returned to the
caller as the `detail` of a 502. It now redacts in production too. It states the rule locally
rather than importing it, because `services/` is a declared leaf with no intra-package dependencies
(ADR-0001 v3); reaching across that boundary to save two lines would trade a real architectural
regression for a cosmetic one.

Development behaviour is deliberately unchanged everywhere: the message is what makes a framework
debuggable, and taking it away outside production buys nothing.
