---
'@theokit/agents': patch
'@theokit/host': patch
'@theokit/presenter': patch
'theokit': patch
---

Admit `@theokit/sdk` 9: the ranges are now `>=5.32.0 <10` (`>=5.3.0 <10` for the presenter peer), so npm installs these packages next to the current SDK. The boot-time SDK compatibility check accepts 9 and rejects 10.
