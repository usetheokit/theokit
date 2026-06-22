---
"theokit": minor
---

M7 (Tema F) — HTTP dual-surface consolidation for the convention/filesystem-route server.

- Typed errors / 404: `theokit/server/http` now exports `TheoError`, `fromUnknown`, `NotFoundError` (throw it for an ergonomic typed 404), `serverErrorToEnvelope`, and `envelopeCodeToStatus`. The legacy Node error path routes typed errors through the same envelope translator the web path uses (untyped errors keep the legacy `INTERNAL_ERROR` 500 + masking).
- Health/readiness: `theokit/server/define` ships `defineHealthRoute`/`defineReadyRoute`, served on the reserved `/__theo/health` (always 200 `{status:"ok"}`) and `/__theo/ready` (200/503 from your probe — a throwing probe is not-ready, never a 500) before the user catch-all.
- Programmatic boot: new `theokit/boot` subpath ships `createConventionFetchHandler({ reservedRoutes? })` returning a socketless `{ fetch, close }` handle.

Zero new runtime dependencies.
