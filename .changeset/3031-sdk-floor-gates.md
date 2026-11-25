---
'@theokit/agents': patch
---

The SDK range test of `@theokit/agents` leaves out of its floor leg a manifest whose floor is above the installed SDK (the host's `>=12.0.0 <14`), and still refuses a range that excludes the installed version for another reason.
