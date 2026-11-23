---
'@theokit/agents': minor
'@theokit/host': minor
'theokit': minor
---

Admit `@theokit/sdk` 6 through 9: the ranges are now `>=5.32.0 <10`, so npm installs these packages next to the current SDK without `--legacy-peer-deps`. The boot-time SDK compatibility check reads the bounded range, accepting 9 and refusing 10.
