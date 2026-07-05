---
'theokit': patch
---

Fix: a fresh `npx create-theokit` failed `npm install` with an `@theokit/ui` peer `ERESOLVE`. `theokit`'s optional `@theokit/ui` peer range (`^0.14.0 || ^0.18.0 || ^0.19.0`) did not include the published stable major `@theokit/ui@1.0.0` that the default template pins (`^1.0.0`). npm is strict on optional-peer conflicts (pnpm only warns, which is why the M6 pnpm dogfood missed it). The peer range now includes `^1.0.0`. Proven end-to-end: a fresh scaffold installs (0 vulnerabilities) and `theokit build` succeeds. Regression-guarded by the `@theokit/ui` peer-range tests.
