---
'@theokit/http': minor
---

`@theokit/http` now declares `@theokit/di` `>=0.3.1 <0.4` as its peer (it was `>=0.2.1 <0.3`). The rest of the ecosystem already moved to di 0.3 (`@theokit/di-agent` 0.6 requires it), so an app that installed both got a peer dependency outside http's range. A project still on di 0.2 has to upgrade it to 0.3.1 with this release.
