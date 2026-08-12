/**
 * Type declarations for `verify-publish-credential.mjs` (backlog B-M67-08).
 * Same pattern as the sibling release scripts.
 */

/** What the two read-only probes observed. */
export interface CredentialProbes {
  /** `npm whoami` — succeeds for ANY valid credential, including read-only ones. */
  readonly whoami: string | undefined
  /** Is an `_authToken` configured through an npmrc — the resolution the WRITE path uses? */
  readonly hasWritePathCredential: boolean
}

export interface CredentialDiagnosis {
  readonly publishable: boolean
  readonly reason: string
}

/** Turn the probes into a verdict. Pure — probes injected (DIP). */
export function diagnoseCredential(probes: CredentialProbes): CredentialDiagnosis
