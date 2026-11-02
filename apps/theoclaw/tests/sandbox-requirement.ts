/** Env flag that declares the sandbox must be enforced where the suite runs (CI sets it). */
export const REQUIRE_SANDBOX_FLAG = 'THEOCLAW_REQUIRE_SANDBOX'

/**
 * Decides what a sandbox-confinement test does on this machine: `run` when the sandbox is
 * enforced, `skip` when it is not and nothing requires it. When the flag declares it required and
 * it is not enforced, throws: a security test must fail loudly, not skip silently (B-624).
 */
export function sandboxRequirement(
  env: Readonly<Record<string, string | undefined>>,
  posture: { readonly enforced: boolean; readonly detail: string },
): 'run' | 'skip' {
  if (posture.enforced) return 'run'
  if (env[REQUIRE_SANDBOX_FLAG] === '1') {
    throw new Error(`${REQUIRE_SANDBOX_FLAG}=1 declares the sandbox must be enforced, but it is not: ${posture.detail}`)
  }
  return 'skip'
}
