---
'@theokit/http': minor
---

`TheoApp.create({ module })` now resolves providers and controllers through an `@theokit/di` `Container` instead of a private map built with `new`, so constructor dependencies, scopes and `@PreDestroy` work. New `container` option; `@theokit/di` is an optional peer dependency, required for `module`.
