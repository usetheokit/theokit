import 'reflect-metadata'

import { isIPv6 } from 'node:net'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'
import { redactSecrets } from '@theokit/gateway'
import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { teamsActivityVerifier } from '@theokit/gateway-teams'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'

import { createOwnerPolicyHook } from './authorization/owner-policy-hook.js'
import { createPairingStore } from './authorization/pairing-store.js'
import { parseAuthorizationPolicy } from './authorization/policy.js'
import type { AuthorizationPolicy } from './authorization/policy.js'
import { adapterBuilders, smsOptions } from './channels/adapter-factory.js'
import type { AdapterBuildOptions } from './channels/adapter-factory.js'
import { createBroadcastGroups } from './channels/broadcast-groups.js'
import { maskSecrets, startChannelLoop } from './channels/channel-loop.js'
import { createGroupActivationHook } from './channels/group-activation-hook.js'
import type { ChannelLoop, PlatformBuild } from './channels/channel-loop.js'
import { installOutputMask } from './channels/output-mask.js'
import type { MaskableStream } from './channels/output-mask.js'
import { resolvePlatforms } from './channels/platforms.js'
import type { ConfiguredPlatform, PlatformSettings } from './channels/platforms.js'
import { createReplyHandler } from './channels/reply-handler.js'
import type { TurnAgent } from './channels/reply-handler.js'
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from './control-plane/listener.js'
import { describeError } from './control-plane/errors.js'
import { readControlPlaneSettings } from './control-plane/settings.js'
import { installShutdown, type SignalSource } from './control-plane/shutdown.js'
import { createTurnRunner } from './control-plane/turn.js'
import { createBonjourPublisher } from './discovery/bonjour-publisher.js'
import { announceOnLan, type LanAnnouncement, stopThenClose } from './discovery/lan-announcer.js'
import { parseDiscoveryMode, type PublisherFactory } from './discovery/publisher.js'
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
  /** Builds the agent of one `/control` turn (one request boundary each). */
  readonly agentFactory: () => TurnAgent | Promise<TurnAgent>
  /**
   * Builds the agent of one chat reply, one per inbound message. Default `agentFactory`; the entry
   * passes `createChannelAgentFactory`, whose agents hold no tool, since anyone can message the bot.
   */
  readonly channelAgentFactory?: () => TurnAgent | Promise<TurnAgent>
  /** Defaults to the ten real adapters; tests pass fakes. */
  readonly builders?: (configured: readonly ConfiguredPlatform[], options: AdapterBuildOptions) => PlatformBuild[]
  readonly write: (line: string) => void
  readonly startTimeoutMs?: number
  /** Who the instance serves, parsed from this same `env`; parsed here when absent (`startTheoClaw` parses it first). */
  readonly policy?: AuthorizationPolicy
  /** Builds the Teams activity verifier, once (D4). Defaults to the package's `teamsActivityVerifier`. */
  readonly teamsVerifierFactory?: (options: TeamsActivityVerifierOptions) => TeamsVerifier
}

export interface ComposedTheoClaw {
  readonly loop: ChannelLoop
  readonly router: (request: Request) => Promise<Response>
}

type Handle = WebhookRoute['handle']

/** How one webhook platform's route is built from the adapter its runner holds. */
interface WebhookPlatform {
  readonly methods: WebhookRoute['methods']
  /** Throws when the adapter lacks what the route needs, which fails that platform's start. */
  readonly buildRoute: (adapter: BasePlatformAdapter) => Handle
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
    write(`teams: the activity verifier could not be built: ${describeError(error)}`)
    return undefined
  }
}

interface WebhookDeps {
  readonly write: (line: string) => void
  readonly verifierFactory: (options: TeamsActivityVerifierOptions) => TeamsVerifier
}

type WebhookPlatformFor<P extends PlatformName> = (settings: PlatformSettings<P>, deps: WebhookDeps) => WebhookPlatform

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
      if (!convertsEnvelopes(adapter)) throw new Error('the built adapter cannot convert a webhook envelope')
      return createWhatsAppRoute({ appSecret, verifyToken, adapter, write })
    },
  }),
  teams: (settings, { write, verifierFactory }) => {
    const verify = teamsVerifier(settings, verifierFactory, write)
    return {
      methods: ['POST'],
      buildRoute: (adapter) =>
        verify === undefined ? async () => new Response(null, { status: 503 }) : createTeamsRoute({ verify, adapter, write }),
    }
  },
  sms: (settings) => {
    const options = smsOptions(settings)
    return {
      methods: ['POST'],
      buildRoute: (adapter) => {
        if (!hasSignatureCheck(adapter)) throw new Error('the built adapter cannot verify a webhook signature')
        return createSmsRoute({ adapter, options })
      },
    }
  },
}

/** The route builder of one configured platform, or undefined for a platform with no webhook. */
function webhookPlatform<P extends PlatformName>(
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
function withRoute(build: PlatformBuild, webhook: WebhookPlatform | undefined, handles: WeakMap<BasePlatformAdapter, Handle>): PlatformBuild {
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
function startedRoute(loop: ChannelLoop, platform: PlatformName, handles: WeakMap<BasePlatformAdapter, Handle>): Handle {
  return async (request) => {
    const adapter = loop.started.get(platform)?.adapter
    const handle = adapter === undefined ? undefined : handles.get(adapter)
    return handle === undefined ? new Response(null, { status: 503 }) : handle(request)
  }
}

/**
 * Wire the app: the configured platforms, one runner each, the reply handler, and the routes.
 * Returns at once; the loop keeps starting slow platforms while the router already serves (EC-2).
 */
export function composeTheoClaw(options: TheoClawOptions): ComposedTheoClaw {
  // First: a bad authorization value stops the start before any adapter is built.
  const policy = options.policy ?? parseAuthorizationPolicy(options.env)
  const agents = createContainer<TurnAgent>({ factory: options.channelAgentFactory ?? options.agentFactory })
  const { configured, skipped, secrets } = resolvePlatforms(options.env)
  for (const { platform, missing } of skipped) {
    options.write(`${platform}: not configured (missing ${missing.join(', ')})`)
  }
  // What the routes and the router write can carry a configured value (a verifier's message, an
  // SDK error): masked here as the loop masks its own lines, whatever stream the caller writes to.
  const maskedWrite = (line: string): void => options.write(redactSecrets(maskSecrets(line, secrets)))
  // The store exists only with a state directory; the hook runs without one under the other policies.
  const pairing = policy.stateDir === undefined ? undefined : createPairingStore({ dir: policy.stateDir, write: maskedWrite })
  const ownerPolicy = createOwnerPolicyHook({ policy, ...(pairing === undefined ? {} : { pairing }), write: maskedWrite })
  // Runs after the owner policy, so only owners and paired senders reach it (FR-007).
  const groupActivation = createGroupActivationHook({ owners: policy.owners, mode: policy.groupActivation, write: maskedWrite })
  const deps: WebhookDeps = { write: maskedWrite, verifierFactory: options.teamsVerifierFactory ?? teamsActivityVerifier }
  const webhooks = new Map<PlatformName, WebhookPlatform>()
  for (const entry of configured) {
    const webhook = webhookPlatform(entry, deps)
    if (webhook !== undefined) webhooks.set(entry.platform, webhook)
  }
  const handles = new WeakMap<BasePlatformAdapter, Handle>()
  const loop = startChannelLoop({
    platforms: (options.builders ?? adapterBuilders)(configured, { requireMention: policy.groupActivation === 'mention' }).map((build) =>
      withRoute(build, webhooks.get(build.platform), handles),
    ),
    handler: createReplyHandler({
      withAgent: (work) => agents.withAgent(work),
      // `loop` is read per message, after it exists: a member whose platform has not started is
      // reported as not delivered.
      broadcast: {
        groups: createBroadcastGroups(policy.broadcastGroups),
        adapterFor: (platform) => loop.started.get(platform as PlatformName)?.adapter,
        write: maskedWrite,
      },
    }),
    hooks: [ownerPolicy, groupActivation],
    secrets,
    write: options.write,
    ...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
  })
  const routes = new Map<PlatformName, WebhookRoute>(
    [...webhooks].map(([platform, { methods }]) => [platform, { methods, handle: startedRoute(loop, platform, handles) }]),
  )
  const router = createWebhookRouter({
    routes,
    isStarted: (platform) => loop.started.has(platform),
    write: maskedWrite,
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
  /** Builds the LAN publisher. Default `createBonjourPublisher`; tests pass a fake (plan D2). */
  readonly createPublisher?: PublisherFactory
}

/** The running process: the channel loop, its webhook router, and the one listener serving both. */
export interface RunningTheoClaw extends ComposedTheoClaw, ControlPlaneHandle {
  /** The `_theoclaw._tcp` service, or nothing on a loopback bind or with `THEOCLAW_MDNS=off`. */
  readonly announcement: LanAnnouncement
}

const NOTHING_TO_WITHDRAW: LanAnnouncement = { stop: () => Promise.resolve() }

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
 * line is read from the socket. Once it is, the instance is announced on the LAN (`THEOCLAW_MDNS`),
 * and the shutdown withdraws that announcement before it closes the listener.
 */
export async function startTheoClaw(options: StartOptions): Promise<RunningTheoClaw> {
  const settings = readControlPlaneSettings(options.env)
  const discovery = parseDiscoveryMode(options.env)
  // Read before the mask and the shutdown are installed, so a missing owner leaves nothing behind.
  const policy = parseAuthorizationPolicy(options.env)
  const streams = options.streams ?? [process.stdout, process.stderr]
  const mask = installOutputMask(processSecrets(options.env, settings.controlToken), streams)
  const stdout = options.stdout ?? lineWriter(streams[0])
  const stderr = options.stderr ?? lineWriter(streams[streams.length - 1])
  const flushOnExit = (): void => mask.flush()
  options.signals.on('exit', flushOnExit)
  let loop: ChannelLoop | undefined
  let serving: Promise<ControlPlaneHandle> | undefined
  // Bound once the listener resolves; the shutdown hook reads it late, as it reads `serving`.
  let announcement: LanAnnouncement | undefined
  const removeShutdown = installShutdown({
    signals: options.signals,
    stopAll: () => loop?.stopAll() ?? Promise.resolve(),
    closeServer: async () => {
      const handle = await serving
      if (handle !== undefined) await stopThenClose(announcement ?? NOTHING_TO_WITHDRAW, handle)
    },
    exit: (code) => {
      mask.flush()
      options.exit(code)
    },
    write: stderr,
  })
  const composed = composeTheoClaw({ ...options, policy, write: stderr })
  const agents = createContainer<TurnAgent>({ factory: options.agentFactory })
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
  announcement = announceOnLan(handle, {
    mode: discovery,
    log: stderr,
    createPublisher: options.createPublisher ?? createBonjourPublisher,
  })
  if (settings.controlToken === undefined) {
    stdout('theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)')
  }
  return { ...handle, ...composed, announcement }
}
