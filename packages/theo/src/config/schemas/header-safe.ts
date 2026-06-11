import { z } from 'zod'

/**
 * EC-3 — CWE-113 HTTP Response Splitting mitigation.
 *
 * Every string that becomes a header value must reject CR/LF. Apps that
 * derive header values from untrusted input (feature flags, tenant config,
 * URL params) would otherwise let attackers inject Set-Cookie / Location
 * headers via `\r\n`. Apply this refinement to every header-bound string
 * field: permissionsPolicy, csp, hsts, referrerPolicy, CORS allow/expose.
 */
export const headerSafeString = z
  .string()
  .refine((s) => !/[\r\n]/.test(s), { message: 'Header value must not contain CR/LF' })
