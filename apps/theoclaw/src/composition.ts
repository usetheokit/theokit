import 'reflect-metadata'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'
import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import type { RuntimeAdapter, ServerHandle } from '@theokit/http/runtime/node'

import { adapterBuilders, smsOptions } from './channels/adapter-factory.js'
import { startChannelLoop } from './channels/channel-loop.js'
import type { ChannelLoop, PlatformBuild } from './channels/channel-loop.js'
import { TheoClawConfigError, installOutputMask } from './channels/output-mask.js'
import type { MaskableStream } from './channels/output-mask.js'
import { resolvePlatforms } from './channels/platforms.js'
import type { ConfiguredPlatform } from './channels/platforms.js'
import { createReplyHandler } from './channels/reply-handler.js'
import type { TurnAgent } from './channels/reply-handler.js'
import { installShutdown, parsePort, startServer } from './server.js'
import type { SignalSource } from './server.js'
import { createLineRoute } from './webhooks/line.js'
import { createWebhookRouter } from './webhooks/router.js'
import type { WebhookRoute } from './webhooks/router.js'
import { createSmsRoute } from './webhooks/sms.js'
import type { SmsRouteAdapter } from './webhooks/sms.js'
import { createWhatsAppRoute } from './webhooks/whatsapp.js'
import type { DeliverableWhatsAppAdapter } from './webhooks/whatsapp.js'

/**
 * The composition root — where concretes are wired into the container, and the only place that
 * happens (`rules/architecture.md` § 1: "Composition root is at the top… never deep inside
 * business code").
 *
 * **It exposes a request BOUNDARY rather than a resolve.** The container refuses a REQUEST-scoped
 * resolve outside one, with a typed error saying so:
 *
 *     ScopeViolationError: REQUEST scope requires container.runInRequest(...) to be active.
 *
 * That refusal is the reason this shape is what it is. A `resolveAgent()` that opened its own
 * boundary per call would make "one agent per request" mean "one agent per resolve", and two
 * collaborators serving the same inbound message would each get their own — which is the isolation
 * the scope exists to provide, inverted. The caller declares the request; everything resolved
 * inside it shares one agent.
 *
 * Decorators are deliberately absent. `@theokit/di-agent` publishes sixteen, and its own README
 * records — measured 2026-09-17 across every repository in the ecosystem — that fourteen are read
 * by nothing, anywhere; `@Workflow` and `@Step` are the two with a consumer, and that consumer
 * lives inside `di-agent` itself. A declaration this code carried would compile, record metadata,
 * and run nothing.
 */
export interface AgentCompositionOptions<TAgent> {
  /** How one agent is built. Called once per request boundary, never shared across two. */
  readonly factory: () => TAgent | Promise<TAgent>
}

export interface AgentComposition<TAgent> {
  /**
   * Run `work` inside one request. The agent it receives is that request's, and no other request
   * can observe it.
   */
  withAgent<R>(work: (agent: TAgent) => R | Promise<R>): Promise<R>
}

export function createContainer<TAgent>(
  options: AgentCompositionOptions<TAgent>,
): AgentComposition<TAgent> {
  const container = new Container()
  const provider = createAgentProvider<TAgent>({ factory: options.factory })

  container.register(provider)

  return {
    withAgent: (work) =>
      container.runInRequest(async () => work(await container.resolveAsync<TAgent>(provider.provide))),
  }
}

/** Everything the running app is made of, for the entry and for tests. */
export interface TheoClawOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** Builds one agent per inbound message (one request boundary each). */
  readonly agentFactory: () => TurnAgent | Promise<TurnAgent>
  /** Defaults to the ten real adapters; tests pass fakes. */
  readonly builders?: (configured: readonly ConfiguredPlatform[]) => PlatformBuild[]
  readonly write: (line: string) => void
  readonly startTimeoutMs?: number
}

export interface ComposedTheoClaw {
  readonly loop: ChannelLoop
  readonly router: (request: Request) => Promise<Response>
}

type RouteFor = (adapter: BasePlatformAdapter) => (request: Request) => Promise<Response>

/**
 * A route bound to the adapter inside the platform's started runner, looked up per request: the
 * router answers 503 before a platform starts, and a platform stopped since answers 503 here. A
 * request already past this lookup when shutdown disconnects the adapter can still be refused by
 * it (an SMS signature check answers false once disconnected); that only happens while stopping.
 */
function startedRoute(loop: ChannelLoop, platform: PlatformName, route: RouteFor): WebhookRoute['handle'] {
  return async (request) => {
    const adapter = loop.started.get(platform)?.adapter
    return adapter === undefined ? new Response(null, { status: 503 }) : route(adapter)(request)
  }
}

function hasSignatureCheck(adapter: BasePlatformAdapter): adapter is BasePlatformAdapter & SmsRouteAdapter {
  return typeof (adapter as { verifySignature?: unknown }).verifySignature === 'function'
}

function convertsEnvelopes(
  adapter: BasePlatformAdapter,
): adapter is BasePlatformAdapter & DeliverableWhatsAppAdapter {
  return typeof (adapter as { toDeliverableEvents?: unknown }).toDeliverableEvents === 'function'
}

/** The webhook routes of the configured webhook platforms; every other platform answers 404. */
function webhookRoutes(
  configured: readonly ConfiguredPlatform[],
  loop: ChannelLoop,
  write: (line: string) => void,
): Map<PlatformName, WebhookRoute> {
  const routes = new Map<PlatformName, WebhookRoute>()
  for (const entry of configured) {
    if (entry.platform === 'line') {
      const { channelSecret } = entry.settings
      routes.set('line', {
        methods: ['POST'],
        handle: startedRoute(loop, 'line', (adapter) => createLineRoute({ channelSecret, adapter })),
      })
    }
    if (entry.platform === 'whatsapp') {
      const { appSecret, verifyToken } = entry.settings
      routes.set('whatsapp', {
        methods: ['GET', 'POST'],
        handle: startedRoute(loop, 'whatsapp', (adapter) => {
          if (!convertsEnvelopes(adapter)) {
            throw new Error('whatsapp: the started adapter cannot convert a webhook envelope')
          }
          return createWhatsAppRoute({ appSecret, verifyToken, adapter, write })
        }),
      })
    }
    if (entry.platform === 'sms') {
      const options = smsOptions(entry.settings)
      routes.set('sms', {
        methods: ['POST'],
        handle: startedRoute(loop, 'sms', (adapter) => {
          if (!hasSignatureCheck(adapter)) throw new Error('sms: the started adapter cannot verify a signature')
          return createSmsRoute({ adapter, options })
        }),
      })
    }
  }
  return routes
}

/**
 * Wire the app: the configured platforms, one runner each, the reply handler, and the routes.
 * Returns at once; the loop keeps starting slow platforms while the router already serves (EC-2).
 */
export function composeTheoClaw(options: TheoClawOptions): ComposedTheoClaw {
  const { configured, skipped, secrets } = resolvePlatforms(options.env)
  for (const { platform, missing } of skipped) {
    options.write(`${platform}: not configured (missing ${missing.join(', ')})`)
  }
  const agents = createContainer<TurnAgent>({ factory: options.agentFactory })
  const handler = createReplyHandler({ withAgent: (work) => agents.withAgent(work) })
  const loop = startChannelLoop({
    platforms: (options.builders ?? adapterBuilders)(configured),
    handler,
    secrets,
    write: options.write,
    ...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
  })
  const routes = webhookRoutes(configured, loop, options.write)
  const router = createWebhookRouter({
    routes,
    isStarted: (platform) => loop.started.has(platform),
    write: options.write,
  })
  return { loop, router }
}

export interface StartOptions extends Omit<TheoClawOptions, 'write'> {
  readonly signals: SignalSource
  readonly exit: (code: number) => void
  readonly runtime?: RuntimeAdapter
  /** The streams the output mask wraps; `process.stdout` and `process.stderr` by default. */
  readonly streams?: readonly MaskableStream[]
}

export interface RunningTheoClaw extends ComposedTheoClaw {
  readonly server: ServerHandle
}

function closeServer(server: ServerHandle | undefined): Promise<void> {
  return new Promise((resolve) => (server === undefined ? resolve() : server.close(() => resolve())))
}

/**
 * Start the app in the order EC-2 and EC-3 need: check the settings, mask the output before any
 * adapter exists, install shutdown before the loop starts, compose, then serve.
 */
export async function startTheoClaw(options: StartOptions): Promise<RunningTheoClaw> {
  const port = parsePort(options.env.THEOCLAW_PORT)
  if ((options.env.THEOCLAW_MODEL ?? '').trim() === '') {
    throw new TheoClawConfigError('THEOCLAW_MODEL must name the model the agent runs')
  }
  const streams = options.streams ?? [process.stdout, process.stderr]
  // The SDK reads its key from THEOKIT_API_KEY itself; it is masked like every channel credential.
  const apiKey = (options.env.THEOKIT_API_KEY ?? '').trim()
  const secrets = [...resolvePlatforms(options.env).secrets, ...(apiKey === '' ? [] : [apiKey])]
  const mask = installOutputMask(secrets, streams)
  const errorStream = streams[streams.length - 1]
  const write = (line: string): void => {
    errorStream?.write(`${line}\n`)
  }
  const flushOnExit = (): void => mask.flush()
  options.signals.on('exit', flushOnExit)
  let loop: ChannelLoop | undefined
  let serving: Promise<ServerHandle> | undefined
  const removeShutdown = installShutdown({
    signals: options.signals,
    stopAll: () => loop?.stopAll() ?? Promise.resolve(),
    closeServer: async () => closeServer(await serving),
    exit: (code) => {
      mask.flush()
      options.exit(code)
    },
    write,
  })
  const composed = composeTheoClaw({ ...options, write })
  loop = composed.loop
  serving = startServer({
    handler: composed.router,
    port,
    write,
    ...(options.runtime ? { runtime: options.runtime } : {}),
  })
  try {
    return { ...composed, server: await serving }
  } catch (error) {
    // The server never listened (an address in use): stop what started and let the entry exit 1.
    removeShutdown()
    options.signals.off('exit', flushOnExit)
    await composed.loop.stopAll()
    // The mask stays: the entry writes this error and exits, and that line is masked too.
    mask.flush()
    throw error
  }
}
