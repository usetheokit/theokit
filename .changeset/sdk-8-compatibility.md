---
'@theokit/agents': minor
'@theokit/host': minor
'@theokit/presenter': minor
'theokit': minor
---

Admit `@theokit/sdk` 8: the ranges are now `>=5.32.0 <9` (`>=5.3.0 <9` for the presenter peer), so npm installs these packages next to the current SDK without `--legacy-peer-deps`. The boot-time SDK compatibility check understands the bounded range. The test suite runs on SDK 8.0.1.
