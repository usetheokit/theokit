---
"create-theokit": patch
---

The scaffold declares `vitest ^5.1.0`. `^3.0.0` installed tinypool and `@vitest/mocker` versions with two critical advisories (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr, GHSA-82fw-gwwq-j7x9), so every fresh install reported `2 critical`. The scaffold's tests, typecheck and lint pass on the new version. (#1078)
