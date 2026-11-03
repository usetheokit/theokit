---
'create-theokit': patch
---

The default scaffold installs `@theokit/sdk` ^5.13.0, the floor `theokit` now declares. At the old pin (^5.11.0) a lockfile resolved at the template's floor did not satisfy the peer range (#1130, #1131).
