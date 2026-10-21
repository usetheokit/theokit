import type { BasePlatformAdapter } from '@theokit/gateway'
import { normalizeTeamsActivity } from '@theokit/gateway-teams'
import type { TeamsActivityVerifyResult } from '@theokit/gateway-teams'

import { statusFor } from './status.js'

/** Verifies one Bot Framework request; built once by the composition from `teamsActivityVerifier`. */
export type TeamsVerifier = (request: Request) => Promise<TeamsActivityVerifyResult>

type Refusal = Extract<TeamsActivityVerifyResult, { ok: false }>['reason']

export interface TeamsRouteOptions {
  readonly verify: TeamsVerifier
  readonly adapter: Pick<BasePlatformAdapter, 'deliver'>
  /** The bot's display name, stripped from a mention; none is configured today. */
  readonly botDisplayName?: string
  readonly write: (line: string) => void
}

/**
 * Reasons that are the app's or the network's, not the sender's: each is written (D4). A malformed
 * body is the sender's and answers 400 unwritten: the package refuses it before any token check, so
 * writing it would give an unauthenticated caller a line per request.
 */
const WRITTEN: ReadonlySet<Refusal> = new Set(['validator_unavailable', 'key_set_unavailable', 'body_already_read'])

/** The status a refusal answers: 400 for a malformed body, 503 to retry, 500 for our fault, else 401. */
export function statusForRefusal(reason: Refusal): 400 | 401 | 500 | 503 {
  switch (reason) {
    case 'malformed_body':
      return 400
    case 'validator_unavailable':
    case 'key_set_unavailable':
      return 503
    case 'body_already_read':
      return 500
    default:
      return 401
  }
}

function answer(status: number): Response {
  return new Response(null, { status })
}

/**
 * The Teams webhook (FR-008): it delivers only what the package's verifier accepted (B-420), so the
 * app writes no token check of its own. A verifier that throws, despite promising not to, is a
 * refusal: a 500 would tell the Bot Framework to retry a forged activity.
 */
export function createTeamsRoute(options: TeamsRouteOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    let verdict: TeamsActivityVerifyResult
    try {
      verdict = await options.verify(request)
    } catch (error) {
      options.write(`teams: activity verification threw, refused: ${error instanceof Error ? error.message : String(error)}`)
      return answer(401)
    }
    if (!verdict.ok) {
      if (WRITTEN.has(verdict.reason)) options.write(`teams: activity refused (${verdict.reason}): ${verdict.message}`)
      return answer(statusForRefusal(verdict.reason))
    }
    // normalizeTeamsActivity does not look at the type; anything but a message is acknowledged.
    if (verdict.activity.type !== 'message') return answer(200)
    const event = normalizeTeamsActivity(verdict.activity, options.botDisplayName)
    return answer(statusFor([await options.adapter.deliver(event)]))
  }
}
