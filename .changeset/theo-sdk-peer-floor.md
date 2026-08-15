---
'theokit': patch
---

`theokit` now requires `@theokit/sdk@^4.52.1` as a peer (was `^4.49.0`).

The old floor was already unreachable: `@theokit/agents` depends on `^4.52.1` and `theokit` depends
on `agents`, so no real install tree ever resolved 4.49.x. The manifest advertised a combination
nobody tested — the exact divergence the peer-range suite exists to catch.
