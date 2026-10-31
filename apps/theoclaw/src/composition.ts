import 'reflect-metadata'

import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'
import { redactSecrets } from '@theokit/gateway'
import type { BasePlatformAdapter, MessageEvent, PlatformName } from '@theokit/gateway'
import { teamsActivityVerifier } from '@theokit/gateway-teams'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'
import { Agent } from '@theokit/sdk'
import type { AgentOptions, CustomTool, SDKAgent } from '@theokit/sdk'

import { createOwnerPolicyHook } from './authorization/owner-policy-hook.js'
import { createPairingStore, type PairingStore } from './authorization/pairing-store.js'
import {
  type AuthorizationPolicy,
  isAuthenticatedSender,
  isPolicyOwner,
  parseAuthorizationPolicy,
} from './authorization/policy.js'
import { type AdapterBuildOptions, adapterBuilders } from './channels/adapter-factory.js'
import { createBroadcastGroups } from './channels/broadcast-groups.js'
import { maskSecrets, startChannelLoop } from './channels/channel-loop.js'
import { createGroupActivationHook } from './channels/group-activation-hook.js'
import type { ChannelLoop, PlatformBuild } from './channels/channel-loop.js'
import { installOutputMask, type MaskableStream } from './channels/output-mask.js'
import { type ConfiguredPlatform, resolvePlatforms } from './channels/platforms.js'
import { createReplyHandler, type TurnAgent } from './channels/reply-handler.js'
import { createChannelAgentFactory, sessionAgentOptions } from './control-plane/agent-factory.js'
import { controlOptions } from './control-plane/control-wiring.js'
import { type ControlPlaneHandle, listenControlPlane } from './control-plane/listener.js'
import { formatAddress, type HttpHandler, reportSurfacesOff, serveHandler } from './control-plane/serve.js'
import { type ControlPlaneSettings, readControlPlaneSettings } from './control-plane/settings.js'
import { installShutdown, type SignalSource } from './control-plane/shutdown.js'
import { createTurnRunner } from './control-plane/turn.js'
import { createBonjourPublisher } from './discovery/bonjour-publisher.js'
import { announceOnLan, type LanAnnouncement, stopThenClose } from './discovery/lan-announcer.js'
import { parseDiscoveryMode, type PublisherFactory } from './discovery/publisher.js'
import { NO_PROFILE, startLine, type TheoClawInstance } from './instance.js'
import { Generations } from './sessions/generations.js'
import { type SessionAgent, SessionAgents, type SessionLease } from './sessions/session-agents.js'
import { createSessionRouter } from './sessions/session-key.js'
import { readSessionSettings, type SessionSettings } from './sessions/session-settings.js'
import {
  type Handle,
  startedRoute,
  type WebhookDeps,
  type WebhookPlatform,
  webhookPlatform,
  withRoute,
} from './webhooks/platform-routes.js'
import { createWebhookRouter, type WebhookRoute } from './webhooks/router.js'
import type { TeamsVerifier } from './webhooks/teams.js'
import { controlAgentToolOptions, NO_TOOL_OPTIONS } from './tools/tool-registry.js'
import type { AgentToolOptions } from './tools/tool-registry.js'
import { checkHostToolsPosture, resolveToolSettings } from './tools/tool-settings.js'
import type { ToolDeps, ToolSettings } from './tools/tool-settings.js'
import { createWorkflowTools } from './workflows/workflow-tools.js'
import { WEBCHAT_ASSETS_DIR } from './webchat/page.js'
import { createWebchatRoutes } from './webchat/routes.js'

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
  /**
   * Builds the agent of one `/control` turn (one request boundary each), with the tool options the
   * start resolved: a fresh tool list per agent (plan D3). Chat replies never use it.
   */
  readonly agentFactory: (toolOptions: AgentToolOptions) => TurnAgent | Promise<TurnAgent>
  /**
   * The session generations, loaded from `<workspace>/.theoclaw/sessions.json`. `startTheoClaw`
   * loads them before anything starts, so a malformed file refuses the start; `composeTheoClaw`
   * loads them itself when it is called alone.
   */
  readonly generations?: Generations
  /**
   * Resolves a chat session's agent by id; default `Agent.getOrCreate`. `SessionAgents` calls it
   * once per agent id it opens, through `createChannelAgentFactory`, with `sessionAgentOptions`
   * (plan D5, T5.1).
   */
  readonly getOrCreate?: (id: string, options: AgentOptions) => Promise<SessionAgent>
  /** The session settings `startTheoClaw` already read; `composeTheoClaw` reads them itself when absent. */
  readonly sessionSettings?: SessionSettings
  /** Defaults to the ten real adapters; tests pass fakes. */
  readonly builders?: (configured: readonly ConfiguredPlatform[], options: AdapterBuildOptions) => PlatformBuild[]
  readonly write: (line: string) => void
  readonly startTimeoutMs?: number
  /** Who the instance serves, parsed from this same `env`; parsed here when absent (`startTheoClaw` parses it first). */
  readonly policy?: AuthorizationPolicy
  /**
   * The pairing store of `policy.stateDir`; built here when absent. `startTheoClaw` builds it before
   * anything is written or installed, since loading it can throw.
   */
  readonly pairing?: PairingStore
  /** Builds the Teams activity verifier, once (D4). Defaults to the package's `teamsActivityVerifier`. */
  readonly teamsVerifierFactory?: (options: TeamsActivityVerifierOptions) => TeamsVerifier
}

export interface ComposedTheoClaw {
  readonly loop: ChannelLoop
  readonly router: (request: Request) => Promise<Response>
  /** The chat sessions' agents; `disposeAll()` at stop is the only end of their lifetime (D2). */
  readonly sessions: SessionAgents
}

/** Where the session generations are kept. */
function sessionsFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'sessions.json')
}

/** The chat path's request boundary: it holds the request's event and leases that session's agent. */
type ChatBoundary = <R>(event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>) => Promise<R>

/**
 * The chat path's sessions and the request boundary over them. `@theokit/di-agent`'s factory takes
 * no argument and `runInRequest` takes no seed, so the event reaches the factory through an
 * `AsyncLocalStorage` set around the request: per request, which a shared variable would not be
 * once two sessions are dispatched at once. The lease the boundary resolves carries no dispose, so
 * the end of the request leaves the agent open (D2).
 */
function chatSessions(options: TheoClawOptions): { readonly sessions: SessionAgents; readonly withAgent: ChatBoundary } {
  const settings = options.sessionSettings ?? readSessionSettings(options.env, statSync)
  const open = options.getOrCreate ?? ((id: string, agentOptions: AgentOptions) => Agent.getOrCreate(id, agentOptions))
  const sessions = new SessionAgents({
    router: createSessionRouter(settings),
    // Opened by the chat path's own factory, whose protected options are applied last, so the
    // `shell` withholding and memory off hold whatever `optionsFor` returns (B-377 option A). Only
    // those two keys are re-pinned: a tool-bearing key added to `optionsFor` would pass through.
    getOrCreate: (id, sessionOptions) =>
      createChannelAgentFactory(options.env, (channel) => open(id, { ...sessionOptions, ...channel }))(),
    optionsFor: () => sessionAgentOptions(options.env, settings.workspace),
    generations: options.generations ?? Generations.load(sessionsFile(settings.workspace)),
    settings,
    write: options.write,
  })
  const currentEvent = new AsyncLocalStorage<MessageEvent>()
  const boundary = createContainer<SessionLease>({
    factory: () => {
      const event = currentEvent.getStore()
      if (event === undefined) throw new Error('a chat agent was resolved outside a message')
      return sessions.lease(event)
    },
  })
  return { sessions, withAgent: (event, work) => currentEvent.run(event, () => boundary.withAgent(work)) }
}

/**
 * Wire the app: the configured platforms, one runner each, the reply handler, and the routes.
 * Returns at once; the loop keeps starting slow platforms while the router already serves (EC-2).
 */
export function composeTheoClaw(options: TheoClawOptions): ComposedTheoClaw {
  // First: a bad authorization value stops the start before any adapter is built.
  const policy = options.policy ?? parseAuthorizationPolicy(options.env)
  const chat = chatSessions(options)
  const { configured, skipped, secrets } = resolvePlatforms(options.env)
  for (const { platform, missing } of skipped) {
    options.write(`${platform}: not configured (missing ${missing.join(', ')})`)
  }
  // Only `open` admits a sender no platform authenticates; under the rest such a channel serves nobody.
  if (policy.dmPolicy !== 'open') {
    for (const { platform } of configured.filter(
      (entry) => !isAuthenticatedSender(entry.platform),
    )) {
      options.write(
        `${platform}: no sender can be admitted under THEOCLAW_DM_POLICY=${policy.dmPolicy}: its sender id is not authenticated, so its messages are dropped without a reply`,
      )
    }
  }
  // What the routes and the router write can carry a configured value (a verifier's message, an
  // SDK error): masked here as the loop masks its own lines, whatever stream the caller writes to.
  const maskedWrite = (line: string): void => options.write(redactSecrets(maskSecrets(line, secrets)))
  // The store exists only with a state directory; the hook runs without one under the other policies.
  const pairing = options.pairing ?? pairingStoreFor(policy, maskedWrite)
  const ownerPolicy = createOwnerPolicyHook({
    policy,
    ...(pairing === undefined ? {} : { pairing }),
    write: maskedWrite,
  })
  // Runs after the owner policy, so only owners and paired senders reach it (FR-007).
  const groupActivation = createGroupActivationHook({
    isOwner: (platform, senderId) => isPolicyOwner(policy, platform, senderId),
    mode: policy.groupActivation,
    write: maskedWrite,
  })
  const deps: WebhookDeps = {
    write: maskedWrite,
    verifierFactory: options.teamsVerifierFactory ?? teamsActivityVerifier,
  }
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
      withAgent: chat.withAgent,
      reset: (event) => chat.sessions.reset(event),
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
  return { loop, router, sessions: chat.sessions }
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
  /**
   * The workspace: where the tool root `files/` is made and whose `.theokit` and `.theoclaw` the
   * path veto guards. Default the instance's workspace, else `process.cwd()`, where the agents work.
   * Outside tests it must be the directory the agent factory gives the SDK (`local.cwd` in the
   * entry), or the veto would guard a `.theokit` the SDK does not use; the entry passes none.
   */
  readonly cwd?: string
  /** What the tool tests inject (bubblewrap detection, fetch); the process passes nothing. */
  readonly toolDeps?: ToolDeps
  /** Which instance this process is (B-514); the process entry resolved and applied it. Default: no profile. */
  readonly instance?: TheoClawInstance
  /** Builds the tool-less agent of one `digest` call (B-387, D3). Absent: no workflow tool. */
  readonly draftAgentFactory?: () => Promise<SDKAgent>
  /** The SDK's live agent cache, turned off at start (D2). Default `Agent.registry`. */
  readonly agentRegistry?: { configure(options: { readonly maxAgents: number; readonly idleTimeoutMs: number }): void }
  /** Where the WebChat bundle is read from. Default `WEBCHAT_ASSETS_DIR`, where `build:web` writes it. */
  readonly webchatAssetsDir?: string | URL
}

/** The running process: the channel loop, its webhook router, and the one listener serving both. */
export interface RunningTheoClaw extends ComposedTheoClaw, ControlPlaneHandle {
  /** The `_theoclaw._tcp` service, or nothing on a loopback bind or with `THEOCLAW_MDNS=off`. */
  readonly announcement: LanAnnouncement
  /** The instance the start line named: its label is the authoritative one (`process.title` may be truncated). */
  readonly instance: TheoClawInstance
}

const NOTHING_TO_WITHDRAW: LanAnnouncement = { stop: () => Promise.resolve() }

function lineWriter(stream: MaskableStream | undefined): (line: string) => void {
  return (line) => void stream?.write(`${line}\n`)
}

/**
 * Every value the output mask hides: the channel credentials, both model keys, both bearer tokens
 * and the web search keys.
 */
function processSecrets(env: StartOptions['env'], settings: ControlPlaneSettings, tools: ToolSettings): string[] {
  const keys = [env.THEOKIT_API_KEY, env.OPENROUTER_API_KEY]
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '')
  const tokens = [settings.controlToken, settings.webchatToken].filter((token) => token !== undefined)
  return [...resolvePlatforms(env).secrets, ...keys, ...tokens, ...tools.secrets]
}

const SHELL_READ_LINE = 'tools: host tools are on; the shell can read every file the process user can read'

/** The tool settings, every refusal included, before anything opens (FR-008). */
function startToolSettings(options: StartOptions, policy: AuthorizationPolicy): ToolSettings {
  // A profiled instance's agents work in its workspace (B-514), so their tool root is made there.
  const cwd = options.cwd ?? options.instance?.workspace ?? process.cwd()
  const tools = resolveToolSettings(options.env, cwd, options.toolDeps)
  // The pairing list lives in the state directory: a shell that could write it could pair anyone.
  const protectedPaths =
    policy.stateDir === undefined ? [] : [{ path: policy.stateDir, variable: 'THEOCLAW_STATE_DIR' }]
  checkHostToolsPosture(tools, protectedPaths, options.toolDeps)
  return tools
}

/** The store of `policy.stateDir`, or none without one. Throws on a state file it cannot read. */
function pairingStoreFor(
  policy: AuthorizationPolicy,
  write: (line: string) => void,
): PairingStore | undefined {
  return policy.stateDir === undefined ? undefined : createPairingStore({ dir: policy.stateDir, write })
}

/** What the start says about the tools: each one left off and why, and the shell's reach when host tools are on. */
function writeToolLines(tools: ToolSettings, write: (line: string) => void): void {
  for (const line of tools.offLines) write(line)
  if (tools.hostTools) write(SHELL_READ_LINE)
}

/** Write the instance's start line, the first line of the start, and return the instance in effect. */
function announceInstance(given: TheoClawInstance | undefined, stderr: (line: string) => void): TheoClawInstance {
  const instance = given ?? NO_PROFILE
  stderr(startLine(instance))
  return instance
}

/** The `/control` agents' workflow tools: one request boundary per call over the draft factory. */
function workflowTools(factory: StartOptions['draftAgentFactory'], write: (line: string) => void): CustomTool[] {
  return createWorkflowTools({ write, ...(factory === undefined ? {} : { withDraftAgent: createContainer({ factory }).withAgent }) })
}

/**
 * The WebChat routes, or `undefined` while `THEOCLAW_WEBCHAT_TOKEN` is unset. WebChat is a chat
 * surface, so its agents hold no tool, as every chat agent (B-382): the tool options reach only the
 * `/control` turn's agents.
 */
function startWebchat(options: StartOptions, token: string | undefined): HttpHandler | undefined {
  if (token === undefined) return undefined
  const agents = createContainer<TurnAgent>({ factory: () => options.agentFactory(NO_TOOL_OPTIONS) })
  const assetsDir = options.webchatAssetsDir ?? WEBCHAT_ASSETS_DIR
  return createWebchatRoutes({ token, runTurn: createTurnRunner(agents.withAgent), assetsDir })
}

/**
 * Start TheoClaw in the order the settings, the mask and the shutdown need: read and check every
 * setting, the tool settings included (a bad one throws before any socket opens, adapter exists,
 * tool root changes beyond its creation, or agent is built), mask the
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
  const tools = startToolSettings(options, policy)
  const sessionSettings = readSessionSettings(options.env, statSync)
  const generations = Generations.load(sessionsFile(sessionSettings.workspace))
  // `SessionAgents` alone decides when a session's agent is disposed: the SDK's cache and its idle
  // sweep know nothing of a turn in flight. `Agent.create` never reads the cache, so `/control`
  // turns are unaffected.
  ;(options.agentRegistry ?? Agent.registry).configure({ maxAgents: 0, idleTimeoutMs: 0 })
  // Created here with 0700, before anything is installed that a failure would have to undo, so the
  // SDK never creates the transcript directory with the umask's mode (D6); one that exists is left
  // as the operator set it. Under a profile the workspace is the profile's own (`instance.ts`).
  mkdirSync(join(sessionSettings.workspace, '.theoclaw'), { recursive: true, mode: 0o700 })
  const streams = options.streams ?? [process.stdout, process.stderr]
  const stderr = options.stderr ?? lineWriter(streams[streams.length - 1])
  // Loaded before the start line, the mask and the shutdown: an unreadable pairing file leaves nothing behind.
  const secrets = resolvePlatforms(options.env).secrets
  const pairing = pairingStoreFor(policy, (line) => stderr(redactSecrets(maskSecrets(line, secrets))))
  // First, once every setting is checked: the line holds a label and a directory, never a secret.
  const instance = announceInstance(options.instance, stderr)
  const mask = installOutputMask(processSecrets(options.env, settings, tools), streams)
  const stdout = options.stdout ?? lineWriter(streams[0])
  const flushOnExit = (): void => mask.flush()
  options.signals.on('exit', flushOnExit)
  let composedApp: ComposedTheoClaw | undefined
  let serving: Promise<ControlPlaneHandle> | undefined
  // Bound once the listener resolves; the shutdown hook reads it late, as it reads `serving`.
  let announcement: LanAnnouncement | undefined
  const removeShutdown = installShutdown({
    signals: options.signals,
    // The loop first, so no turn starts once the agents are being disposed.
    stopAll: async () => {
      await composedApp?.loop.stopAll()
      await composedApp?.sessions.disposeAll()
    },
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
  writeToolLines(tools, stderr)
  // The raw factory goes to the composition, which hands chat agents no tool; only the `/control`
  // turn's agents get the tool options.
  const composed = composeTheoClaw({
    ...options,
    policy,
    sessionSettings,
    generations,
    ...(pairing === undefined ? {} : { pairing }),
    write: stderr,
  })
  const extraTools = workflowTools(options.draftAgentFactory, stderr)
  // `/control` agents also hold `run_code` and `delegate_all`; their workers come from the same factory.
  // Session agents come from the same call, so a session turn holds the same tools.
  const buildControlAgent = async (): Promise<TurnAgent> =>
    options.agentFactory(controlAgentToolOptions(tools, options.agentFactory, extraTools))
  const agents = createContainer<TurnAgent>({ factory: buildControlAgent })
  composedApp = composed
  const listen = options.listen ?? listenControlPlane
  serving = listen({
    handler: serveHandler(composed.router, startWebchat(options, settings.webchatToken)),
    port: settings.port,
    host: settings.host,
    stderr,
    ...(settings.controlToken === undefined
      ? {}
      : { control: controlOptions(settings.controlToken, agents.withAgent, buildControlAgent, stderr) }),
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
    await composed.sessions.disposeAll()
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
  reportSurfacesOff(settings, stdout)
  // `close` withdraws the announcement first, as the shutdown does: a caller that closes the
  // running instance directly must not leave the service advertised.
  return { ...handle, ...composed, announcement, instance, close: () => stopThenClose(announcement, handle) }
}
