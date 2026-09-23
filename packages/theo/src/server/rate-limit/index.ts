// B-027 — the deployed entries import `resolveClientIpFromRequest` / `resolveForwardedAddress`
// through this subpath, and the barrel listed four modules without this one. `rate-limited-guard.ts`
// reaches it by relative path, so the gap was invisible from inside the package and fatal from an
// emitted entry: `from 'theokit/server/rate-limit'` naming either resolver failed at load.
export * from './client-ip.js'
export * from './rate-limit.js'
export * from './rate-limit-store.js'
export * from './rate-limit-per-route.js'
export * from './rate-limited-guard.js'
// B-257 — the durable path, beside the sync facade rather than replacing it (ADR 0018).
export * from './rate-limit-durable.js'

// B-262 — the one builder a deployed entry calls. One signature, always async, so the emitted
// call site stops deciding whether to `await` based on what the config declared.
export { buildRateLimiter } from './build-rate-limiter.js'
