---
"theokit": minor
---

V3-2 — widen the optional `@theokit/ui` peer from `^0.14.0` to `^0.14.0 || ^0.18.0`. The old range caused an `ERESOLVE` when an app installed `theokit` alongside `@theokit/ui@0.18.x` (`peerOptional @theokit/ui@"^0.14.0" from theokit` conflicting with `@theokit/ui@0.14.4`), pinning consumers to the 0.14.x line — which transitively carried the HIGH-severity `valibot` ReDoS advisory GHSA-vqpr-j7v3-hqw9 (cleared in `@theokit/ui@0.18.x`). Widening the peer is additive: existing 0.14.x consumers are unaffected (guarded by `tests/unit/ui-peer-range.test.ts`), and 0.18.x now resolves without `--force`.
