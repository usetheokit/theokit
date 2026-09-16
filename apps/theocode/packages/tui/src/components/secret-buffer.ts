/**
 * B-047 — the pure half of `SecretInput`: what a keystroke does to the buffer, and what leaves it.
 *
 * Extracted so it can be tested. `useInput` needs raw-mode support that the test harness's stdin
 * does not report, so a component-level test of this behaviour cannot deliver a keypress at all —
 * a first attempt produced three assertions that all passed on `undefined`. The logic is pure, so
 * the honest place for it is here.
 */

/**
 * What is handed to `login()`, or `undefined` when there is nothing to submit.
 *
 * The raw buffer used to be submitted as-is, so a key pasted from a browser or a password manager
 * kept its surrounding whitespace. The failure is remote, delayed and opaque: the credential is
 * stored, and authentication fails later with a provider message that says nothing about
 * whitespace. Trimming belongs here, at the boundary, where the whitespace is known to be an
 * artifact of pasting rather than part of the secret.
 */
export function submittableSecret(buffer: string): string | undefined {
  const secret = buffer.trim()
  return secret.length === 0 ? undefined : secret
}
