import { createHostedChat, hashedSessionScope } from 'theokit/server/http'

import { bearerCheck, MIN_BEARER_TOKEN_LENGTH } from '@theokit/http/guards'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { MAX_MESSAGE_BYTES } from '../control-plane/limits.js'
import { TRUSTED_IDENTITY_HEADER } from '../control-plane/trusted-proxy.js'
import type { TurnRunner } from '../control-plane/turn.js'
import { createWebchatRun } from './create-run.js'
import { WEBCHAT_ASSETS } from './page.js'
import { WEBCHAT_ROUTE } from './paths.js'

export interface WebchatRoutesOptions {
  /** The WebChat token every chat post must carry; at least 32 characters. */
  readonly token: string
  /** Trusted-proxy mode is on: a chat post marked by the listener needs no bearer token. */
  readonly trustedProxy?: boolean
  /** Visitor access (OC-143): says whether a proxy-authenticated identity holds an unexpired grant. Default: every identity is let in. */
  readonly visitorAllowed?: (identity: string) => boolean
  /** The turn runner of one chat: its turns share the chat's session agent, and no other chat's. */
  readonly turnFor: (chatId: string) => TurnRunner
  /** Where the built page assets are (`build:web` writes them). */
  readonly assetsDir: string | URL
  /** Where a finished turn's usage line goes (B-400 FR-004). Default: nowhere. */
  readonly write?: (line: string) => void
}

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * The `/webchat` routes, mounted by the framework's hosted chat. A chat post is refused 401 before
 * anything is parsed and before any agent exists unless it carries the WebChat token (or, in
 * trusted-proxy mode, the listener's identity header, then 403 for an identity without a grant). A
 * token below the bearer minimum is refused here, at the gate's owner.
 */
export function createWebchatRoutes(
  options: WebchatRoutesOptions,
): (request: Request) => Promise<Response> {
  if (options.token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(
      `THEOCLAW_WEBCHAT_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`,
      {
        variable: 'THEOCLAW_WEBCHAT_TOKEN',
      },
    )
  }
  const accepts = bearerCheck(options.token)
  const { turnFor, write } = options
  return createHostedChat({
    route: WEBCHAT_ROUTE,
    createRun: (message, chatId, signal) => createWebchatRun(turnFor, signal, write)(message, chatId),
    auth: (request) => {
      const identity =
        options.trustedProxy === true ? (request.headers.get(TRUSTED_IDENTITY_HEADER) ?? '') : ''
      if (identity === '') {
        if (accepts(request.headers.get('authorization') ?? undefined)) return {}
        return new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer', ...NO_STORE },
        })
      }
      if (options.visitorAllowed?.(identity) === false) {
        return new Response(null, { status: 403, headers: NO_STORE })
      }
      return { identity }
    },
    assetsDir: options.assetsDir,
    maxBodyBytes: MAX_MESSAGE_BYTES,
    sessionScope: hashedSessionScope,
    assets: WEBCHAT_ASSETS,
    title: 'TheoClaw',
    missingBundleMessage: 'run the build:web script of the theoclaw package\n',
  })
}
