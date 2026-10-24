import 'reflect-metadata'

import { isIPv6 } from 'node:net'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'
import { redactSecrets } from '@theokit/gateway'
import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { teamsActivityVerifier } from '@theokit/gateway-teams'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'

import { adapterBuilders, smsOptions } from './channels/adapter-factory.js'
import { maskSecrets, startChannelLoop } from './channels/channel-loop.js'
import type { ChannelLoop, PlatformBuild } from './channels/channel-loop.js'
import { installOutputMask } from './channels/output-mask.js'
import type { MaskableStream } from './channels/output-mask.js'
import { resolvePlatforms } from './channels/platforms.js'
import type { ConfiguredPlatform } from './channels/platforms.js'
import { createReplyHandler } from './channels/reply-handler.js'
import type { TurnAgent } from './channels/reply-handler.js'
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from './control-plane/listener.js'
import { readControlPlaneSettings } from './control-plane/settings.js'
import { installShutdown, type SignalSource } from './control-plane/shutdown.js'
import { createTurnRunner } from './control-plane/turn.js'
import { createLineRoute } from './webhooks/line.js'
import { createWebhookRouter } from './webhooks/router.js'
import type { WebhookRoute } from './webhooks/router.js'
import { createSmsRoute } from './webhooks/sms.js'
import type { SmsRouteAdapter } from './webhooks/sms.js'
import { createTeamsRoute } from './webhooks/teams.js'
import type { TeamsVerifier } from './webhooks/teams.js'
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
  /** Builds the Teams activity verifier, once (D4). Defaults to the package's `teamsActivityVerifier`. */
  readonly teamsVerifierFactory?: (options: TeamsActivityVerifierOptions) => TeamsVerifier
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
    write(`teams: the activity verifier could not be built: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** The webhook routes of the configured webhook platforms; every other platform answers 404. */
function webhookRoutes(
  configured: readonly ConfiguredPlatform[],
  loop: ChannelLoop,
  write: (line: string) => void,
  verifierFactory: (options: TeamsActivityVerifierOptions) => TeamsVerifier,
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
    if (entry.platform === 'teams') {
      const verify = teamsVerifier(entry.settings, verifierFactory, write)
      routes.set('teams', {
        methods: ['POST'],
        handle:
          verify === undefined
            ? async () => new Response(null, { status: 503 })
            : startedRoute(loop, 'teams', (adapter) => createTeamsRoute({ verify, adapter, write })),
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
export function composeTheoClaw(
  options: TheoClawOptions,
  /** The request boundary the replies run in; `startTheoClaw` passes the one `/control` shares. */
  agents: AgentComposition<TurnAgent> = createContainer<TurnAgent>({ factory: options.agentFactory }),
): ComposedTheoClaw {
  const { configured, skipped, secrets } = resolvePlatforms(options.env)
  for (const { platform, missing } of skipped) {
    options.write(`${platform}: not configured (missing ${missing.join(', ')})`)
  }
  const handler = createReplyHandler({ withAgent: (work) => agents.withAgent(work) })
  const loop = startChannelLoop({
    platforms: (options.builders ?? adapterBuilders)(configured),
    handler,
    secrets,
    write: options.write,
    ...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
  })
  // What the routes write can carry a configured value (a verifier's message quotes a tenant id):
  // masked here as the loop masks its own lines, whatever stream the caller writes to.
  const routeWrite = (line: string): void => options.write(redactSecrets(maskSecrets(line, secrets)))
  const routes = webhookRoutes(
    configured,
    loop,
    routeWrite,
    options.teamsVerifierFactory ?? teamsActivityVerifier,
  )
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
  /** The streams the output mask wraps; `process.stdout` and `process.stderr` by default. */
  readonly streams?: readonly MaskableStream[]
  /** Where the listening lines go. Default: the first of `streams`. */
  readonly stdout?: (line: string) => void
  /** Where every other line goes. Default: the last of `streams`. */
  readonly stderr?: (line: string) => void
  /** How the listener starts. Default `listenControlPlane`; tests wrap it to count or hold calls. */
  readonly listen?: typeof listenControlPlane
}

/** The running process: the channel loop, its webhook router, and the one listener serving both. */
export interface RunningTheoClaw extends ComposedTheoClaw, ControlPlaneHandle {}

function formatAddress(address: { readonly host: string; readonly port: number }): string {
  return isIPv6(address.host) ? `[${address.host}]:${address.port}` : `${address.host}:${address.port}`
}

function lineWriter(stream: MaskableStream | undefined): (line: string) => void {
  return (line) => void stream?.write(`${line}\n`)
}

/** Every value the output mask hides: the channel credentials, both model keys and the control token. */
function processSecrets(env: StartOptions['env'], controlToken: string | undefined): string[] {
  const keys = [env.THEOKIT_API_KEY, env.OPENROUTER_API_KEY]
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '')
  return [...resolvePlatforms(env).secrets, ...keys, ...(controlToken === undefined ? [] : [controlToken])]
}

/** `GET /health` is the control plane's; every other path goes to the webhook router. */
function serveHealthAndWebhooks(router: ComposedTheoClaw['router']): (request: Request) => Promise<Response> {
  return (request) => (new URL(request.url).pathname === '/health' ? healthHandler(request) : router(request))
}

/**
 * Start TheoClaw in the order the settings, the mask and the shutdown need: read and check every
 * setting (a bad one throws before any socket opens, adapter exists or agent is built), mask the
 * output before any adapter writes, install shutdown before the loop starts, compose, then listen.
 * One listener serves `/health`, the `/webhooks/<platform>` routes and, with a control token, the
 * `/control` socket, on the bound address (`THEOCLAW_HOST`, loopback by default). The listening
 * line is read from the socket.
 */
export async function startTheoClaw(options: StartOptions): Promise<RunningTheoClaw> {
  const settings = readControlPlaneSettings(options.env)
  const streams = options.streams ?? [process.stdout, process.stderr]
  const mask = installOutputMask(processSecrets(options.env, settings.controlToken), streams)
  const stdout = options.stdout ?? lineWriter(streams[0])
  const stderr = options.stderr ?? lineWriter(streams[streams.length - 1])
  const flushOnExit = (): void => mask.flush()
  options.signals.on('exit', flushOnExit)
  let loop: ChannelLoop | undefined
  let serving: Promise<ControlPlaneHandle> | undefined
  const removeShutdown = installShutdown({
    signals: options.signals,
    stopAll: () => loop?.stopAll() ?? Promise.resolve(),
    closeServer: async () => (await serving)?.close(),
    exit: (code) => {
      mask.flush()
      options.exit(code)
    },
    write: stderr,
  })
  const agents = createContainer<TurnAgent>({ factory: options.agentFactory })
  const composed = composeTheoClaw({ ...options, write: stderr }, agents)
  loop = composed.loop
  const listen = options.listen ?? listenControlPlane
  serving = listen({
    handler: serveHealthAndWebhooks(composed.router),
    port: settings.port,
    host: settings.host,
    stderr,
    ...(settings.controlToken === undefined
      ? {}
      : { control: { token: settings.controlToken, runTurn: createTurnRunner(agents.withAgent) } }),
  })
  let handle: ControlPlaneHandle
  try {
    handle = await serving
  } catch (error) {
    // The listener never bound (a busy port, an address the host lacks): stop what started and let
    // the entry exit 1.
    removeShutdown()
    options.signals.off('exit', flushOnExit)
    await composed.loop.stopAll()
    // The mask stays: the entry writes this error and exits, and that line is masked too.
    mask.flush()
    throw error
  }
  stdout(`theoclaw: control plane listening on ${formatAddress(handle.address())}`)
  if (settings.controlToken === undefined) {
    stdout('theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)')
  }
  return { ...handle, ...composed }
}
