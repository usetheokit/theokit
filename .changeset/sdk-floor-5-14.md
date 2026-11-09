---
'@theokit/agents': patch
'theokit': patch
'create-theokit': patch
---

The `@theokit/sdk` floor is now 5.14.0, in `@theokit/agents`, `theokit` and the `create-theokit` template. TheoClaw's plugin install (`installPlugin`, B-391) needs the SDK to import a trusted manifest entry, which 5.14.0 added; the bottom-of-range install now agrees with the root override.
