/**
 * Config schemas barrel.
 *
 * Per plan T2.3 (M2 mecânico): the previously-monolithic
 * `packages/theo/src/config/schema.ts` (504 LOC, 14 schemas) was split
 * into per-concern files here. `config/schema.ts` retains the role of
 * composer (assembles `theoConfigSchema` from these primitives).
 *
 * Astro-style organization (per blueprint Q5 reference):
 *   - leaf-most files (no intra-folder deps) live as direct exports
 *   - `security.ts` depends on `header-safe.ts` only
 *   - `storage.ts` carries its own internal `tlsConfigSchema` /
 *     `serverConfigSchema` cluster (not exported externally)
 *
 * The composer (`../schema.ts`) imports from THIS barrel — never from
 * individual schema files — so future additions stay in one place.
 */

export type { FormatErrorContext, FormatErrorHook } from './format-error.js'
export { rateLimitSchema } from './rate-limit.js'
export { uploadSchema } from './upload.js'
export { loggingSchema } from './logging.js'
export { cacheSchema } from './cache.js'
export { securityHeadersSchema, corsSchema, securitySchema } from './security.js'
export { storageSchema, type StorageConfig } from './storage.js'
