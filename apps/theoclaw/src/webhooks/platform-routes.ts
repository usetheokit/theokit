import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'

import { smsOptions } from '../channels/adapter-factory.js'
import type { ChannelLoop, PlatformBuild } from '../channels/channel-loop.js'
import type { PlatformSettings } from '../channels/platforms.js'
import { describeError } from '../control-plane/errors.js'
import { createLineRoute } from './line.js'
import type { WebhookRoute } from './router.js'
import { createSmsRoute } from './sms.js'
import type { SmsRouteAdapter } from './sms.js'
import { createTeamsRoute } from './teams.js'
import type { TeamsVerifier } from './teams.js'
import { createWhatsAppRoute } from './whatsapp.js'
import type { DeliverableWhatsAppAdapter } from './whatsapp.js'

/*
 * Which platforms deliver over a webhook, and how each one's route is built over the adapter its
 * runner holds. Moved out of the composition root unchanged; composition only wires it.
 */

export type Handle = WebhookRoute['handle']

/** How one webhook platform's route is built from the adapter its runner holds. */
export interface WebhookPlatform {
  readonly methods: WebhookRoute['methods']
  /** Throws when the adapter lacks what the route needs, which fails that platform's start. */
  readonly buildRoute: (adapter: BasePlatformAdapter) => Handle
}

function hasSignatureCheck(
  adapter: BasePlatformAdapter,
): adapter is BasePlatformAdapter & SmsRouteAdapter {
  return typeof (adapter as { verifySignature?: unknown }).verifySignature === 'function'
}

function convertsEnvelopes(
  adapter: BasePlatformAdapter,
): adapter is BasePlatformAdapter & DeliverableWhatsAppAdapter {
  return typeof (adapter as { toDeliverableEvents?: unknown }).toDeliverableEvents === 'function'
}

/**
 * The Teams verifier, built once, from the client id alone (ADR 0032): with a `tenantId` it refuses
 * every Bot Framework activity whose token carries no `tid` claim, and connector tokens carry none
 * (`@theokit/gateway-teams` README). A factory that throws fails the Teams route only, which then
 * answers 503, and the line says why.
 */
function teamsVerifier(
  settings: { readonly clientId: string },
  factory: (options: TeamsActivityVerifierOptions) => TeamsVerifier,
  write: (line: string) => void,
): TeamsVerifier | undefined {
  try {
    return factory({ clientId: settings.clientId })
  } catch (error) {
    write(`teams: the activity verifier could not be built: ${describeError(error)}`)
    return undefined
  }
}

export interface WebhookDeps {
  readonly write: (line: string) => void
  readonly verifierFactory: (options: TeamsActivityVerifierOptions) => TeamsVerifier
}

type WebhookPlatformFor<P extends PlatformName> = (
  settings: PlatformSettings<P>,
  deps: WebhookDeps,
) => WebhookPlatform

/**
 * Each platform's webhook, or `null` for one that has none. Keyed by every platform name, so a new
 * platform does not compile until it has a decision here (an unlisted one would answer 404).
 */
const WEBHOOK_PLATFORMS: { readonly [P in PlatformName]: WebhookPlatformFor<P> | null } = {
  telegram: null,
  discord: null,
  slack: null,
  matrix: null,
  mattermost: null,
  email: null,
  line: ({ channelSecret }) => ({
    methods: ['POST'],
    buildRoute: (adapter) => createLineRoute({ channelSecret, adapter }),
  }),
  whatsapp: ({ appSecret, verifyToken }, { write }) => ({
    methods: ['GET', 'POST'],
    buildRoute: (adapter) => {
      if (!convertsEnvelopes(adapter))
        throw new Error('the built adapter cannot convert a webhook envelope')
      return createWhatsAppRoute({ appSecret, verifyToken, adapter, write })
    },
  }),
  teams: (settings, { write, verifierFactory }) => {
    const verify = teamsVerifier(settings, verifierFactory, write)
    return {
      methods: ['POST'],
      buildRoute: (adapter) =>
        verify === undefined
          ? async () => new Response(null, { status: 503 })
          : createTeamsRoute({ verify, adapter, write }),
    }
  },
  sms: (settings) => {
    const options = smsOptions(settings)
    return {
      methods: ['POST'],
      buildRoute: (adapter) => {
        if (!hasSignatureCheck(adapter))
          throw new Error('the built adapter cannot verify a webhook signature')
        return createSmsRoute({ adapter, options })
      },
    }
  },
}

/** The route builder of one configured platform, or undefined for a platform with no webhook. */
export function webhookPlatform<P extends PlatformName>(
  entry: { readonly platform: P; readonly settings: PlatformSettings<P> },
  deps: WebhookDeps,
): WebhookPlatform | undefined {
  const forPlatform: WebhookPlatformFor<P> | null = WEBHOOK_PLATFORMS[entry.platform]
  return forPlatform === null ? undefined : forPlatform(entry.settings, deps)
}

/**
 * A webhook platform's build also builds its route, once, over the adapter it just built: a route
 * that cannot use the adapter fails that platform's start (the loop writes why), rather than every
 * request later.
 */
export function withRoute(
  build: PlatformBuild,
  webhook: WebhookPlatform | undefined,
  handles: WeakMap<BasePlatformAdapter, Handle>,
): PlatformBuild {
  if (webhook === undefined) return build
  return {
    platform: build.platform,
    build: () => {
      const adapter = build.build()
      handles.set(adapter, webhook.buildRoute(adapter))
      return adapter
    },
  }
}

/**
 * The route of the adapter inside the platform's started runner, looked up per request: the router
 * answers 503 before a platform starts, and a platform stopped since answers 503 here. A request
 * already past this lookup when shutdown disconnects the adapter can still be refused by it (an SMS
 * signature check answers false once disconnected); that only happens while stopping.
 */
export function startedRoute(
  loop: ChannelLoop,
  platform: PlatformName,
  handles: WeakMap<BasePlatformAdapter, Handle>,
): Handle {
  return async (request) => {
    const adapter = loop.started.get(platform)?.adapter
    const handle = adapter === undefined ? undefined : handles.get(adapter)
    return handle === undefined ? new Response(null, { status: 503 }) : handle(request)
  }
}
