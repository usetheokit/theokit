---
'@theokit/agents': patch
---

`HttpTransport` now treats a caller header that differs from one of its defaults only in letter case as the same header. A header such as `x-theo-action: 0` used to travel beside the default `X-Theo-Action: 1`, and `fetch` sent the joined value `1, 0`; the caller's value now replaces the default, as it already did in `createA2ATool`. Both clients build their headers in one place, so the two cannot drift again. (B-407)
