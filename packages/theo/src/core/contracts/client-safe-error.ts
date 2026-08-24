import type { TheoErrorEnvelope } from './error-envelope.js'

/**
 * What an error is allowed to tell the caller.
 *
 * Most error codes describe something the caller did and can fix, so their message is the useful
 * part of the response. An *internal* failure is the opposite: its message describes the server —
 * a connection string, an upstream host, a stack of internal names — and the caller can act on
 * none of it. In production it is redacted; in development it is exactly what makes the framework
 * debuggable, so it stays.
 *
 * This lives in one place because it was previously stated in two and missing from a third. The
 * Node runner redacted, the Web error builder redacted, and an exception escaping a Web handler
 * took a hand-built path that did neither — same route, same failure, more disclosure depending
 * on which transport served it. That is the "one contract, three transports" rule in
 * `rules/three-target-parity.md` being broken by duplication rather than by design.
 */

/** Both spellings the codebase uses for "this is our fault, and the detail is ours too". */
const INTERNAL_CODES: ReadonlySet<string> = new Set(['INTERNAL_ERROR', 'INTERNAL_SERVER_ERROR'])

const GENERIC_INTERNAL_MESSAGE = 'Internal server error'

function redacts(code: string): boolean {
  return INTERNAL_CODES.has(code) && process.env.NODE_ENV === 'production'
}

/** The message this code may carry to the caller. */
export function clientSafeErrorMessage(code: string, message: string): string {
  return redacts(code) ? GENERIC_INTERNAL_MESSAGE : message
}

/**
 * The envelope this code may carry to the caller.
 *
 * When it redacts, `cause`, `meta` and `ext` go with the message rather than being filtered
 * field by field: they exist to describe the failure, and the whole point is that this failure is
 * not describable to the caller. Keeping the code is what lets a client branch on it.
 */
export function clientSafeErrorEnvelope(envelope: TheoErrorEnvelope): TheoErrorEnvelope {
  if (!redacts(envelope.code)) return envelope
  return { code: envelope.code, message: GENERIC_INTERNAL_MESSAGE }
}
