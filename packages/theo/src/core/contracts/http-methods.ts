/**
 * Canonical HTTP method set used by the typed client codegen + Proxy runtime.
 * Kept here (under `server/scan/`) because the SCAN is the first consumer —
 * `vite-plugin/app-typed-client.ts` (Phase 2) and `client/app-client.ts` (Phase 3)
 * import from here to ensure a single source of truth.
 *
 * Lowercase variants are derived via `.toLowerCase()` at call sites; we do not
 * export them separately to avoid drift between the two lists.
 */

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export const HTTP_METHOD_LOWERCASE = HTTP_METHODS.map((m) => m.toLowerCase()) as readonly string[]
