---
'@theokit/agents': minor
'@theokit/host': minor
'@theokit/presenter': minor
'theokit': minor
---

Admit `@theokit/sdk` 6 through 9: the ranges are now `>=5.32.0 <10` (`>=5.3.0 <10` for the presenter peer), so npm installs these packages next to the current SDK without `--legacy-peer-deps`. The boot-time SDK compatibility check understands the bounded range.
