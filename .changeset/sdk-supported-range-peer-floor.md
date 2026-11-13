---
'theokit': patch
---

`SUPPORTED_SDK_RANGE` now mirrors the `^5.17.0` peer floor, so `theokit start` refuses `@theokit/sdk` 4.x and 5.0 to 5.15.2 at boot instead of failing on the first agent request.
