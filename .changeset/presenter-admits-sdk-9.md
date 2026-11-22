---
'@theokit/presenter': minor
---

The optional `@theokit/sdk` peer is now `>=5.3.0 <10`, so npm installs the presenter next to SDK 6 through 9 without `--legacy-peer-deps`. The presenter imports only the `InteractionUpdate` and `BuiltinToolName` types from the SDK, and 9.1.0 still exports both.
