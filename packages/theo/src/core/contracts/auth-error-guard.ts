/**
 * Shape-based guard for AuthRequiredError detection.
 *
 * Uses duck-type check ONLY — no class import from `server/auth/` to
 * preserve `core` INVARIANT 1 (core depends on nothing intra-monorepo).
 *
 * The `instanceof AuthRequiredError` check is intentionally omitted:
 * Vite HMR can duplicate class identity across module boundaries,
 * making `instanceof` unreliable. The shape check (`code` + `status`)
 * is the canonical detection path.
 *
 * Single source of truth — previously duplicated in handle-request-error.ts
 * and execute.ts (architecture-remediation plan T1.3, 2026-06-12).
 */
export function isAuthRequiredError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return e.code === 'AUTH_REQUIRED' && e.status === 401
}
