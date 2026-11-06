import 'reflect-metadata'

import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { redactSecrets } from '@theokit/gateway'
import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { teamsActivityVerifier } from '@theokit/gateway-teams'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'
import { Agent } from '@theokit/sdk'
import type { AgentOptions, CustomTool, SDKAgent } from '@theokit/sdk'

import { createContainer } from './agent-container.js'
import { createPairingStore, type PairingStore } from './authorization/pairing-store.js'
import {
  type AuthorizationPolicy,
  isAuthenticatedSender,
  parseAuthorizationPolicy,
} from './authorization/policy.js'
import { type AdapterBuildOptions, adapterBuilders } from './channels/adapter-factory.js'
import { createBroadcastGroups } from './channels/broadcast-groups.js'
import { maskSecrets, startChannelLoop } from './channels/channel-loop.js'
import { channelHooks } from './channel-hooks.js'
import { createUsageHook } from './channels/usage-hook.js'
import type { ChannelLoop, PlatformBuild } from './channels/channel-loop.js'
import { installOutputMask, type MaskableStream } from './channels/output-mask.js'
import { type ConfiguredPlatform, resolvePlatforms } from './channels/platforms.js'
import { createReplyHandler, type TurnAgent } from './channels/reply-handler.js'
import { createSdkChannelAgentFactory, webchatAgentFactory } from './control-plane/agent-factory.js'
import type { CreateAgent } from './control-plane/agent-factory.js'
import { controlOptions, devicePairingFor } from './control-plane/control-wiring.js'
import { type HttpHandler, serveHandler } from './control-plane/http-dispatch.js'
import { type ControlPlaneHandle, listenControlPlane } from './control-plane/listener.js'
import { readControlPlaneSettings, type ControlPlaneSettings } from './control-plane/settings.js'
import { processSecrets } from './secrets.js'
import { a2aLines, readA2ASettings } from './a2a/a2a-settings.js'
import { a2aRoute } from './a2a/a2a-route.js'
import { peerTools } from './a2a/peer-tools.js'
import { installShutdown, type SignalSource } from './control-plane/shutdown.js'
import { formatAddress, reportSurfacesOff } from './control-plane/start-output.js'
import { createTurnRunner } from './control-plane/turn.js'
import { heartbeatJob, readHeartbeatSettings } from './scheduler/heartbeat.js'
import { loadScheduleStore, type RunningScheduler, wireScheduler } from './scheduler/scheduler-wiring.js'
import { createBonjourPublisher } from './discovery/bonjour-publisher.js'
import { announceOnLan, type LanAnnouncement, stopThenClose } from './discovery/lan-announcer.js'
import { parseDiscoveryMode, type PublisherFactory } from './discovery/publisher.js'
import { NO_PROFILE, startLine, type TheoClawInstance } from './instance.js'
import { chatSessions, sessionsFile } from './sessions/chat-sessions.js'
import { Generations } from './sessions/generations.js'
import type { SessionAgent, SessionAgents } from './sessions/session-agents.js'
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
import { theoClawApiFor } from './http-api/api-routes.js'
import type { TeamsVerifier } from './webhooks/teams.js'
import { controlAgentToolOptions } from './tools/tool-registry.js'
import { triggerRoutes } from './triggers/trigger-route.js'
import { type EventSettings, readEventSettings } from './triggers/trigger-settings.js'
import type { AgentToolOptions } from './tools/tool-registry.js'
import { checkHostToolsPosture, hostToolsProtectedPaths, type ProtectedPath, resolveToolSettings } from './tools/tool-settings.js'
import type { ToolDeps, ToolSettings } from './tools/tool-settings.js'
import { createWorkflowTools } from './workflows/workflow-tools.js'
import { WEBCHAT_ASSETS_DIR } from './webchat/page.js'
import { createWebchatRoutes } from './webchat/routes.js'
import { configuredVoiceReplies, withVoiceReplies } from './voice/voice-replies.js'

export { createContainer, type AgentComposition, type AgentCompositionOptions } from './agent-container.js'

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
  /** Every value a reply must not carry (`processSecrets`); the channel credentials when absent. */
  readonly secrets?: readonly string[]
  /** The triggers and approved hooks `startTheoClaw` already read; read here when absent (B-397). */
  readonly events?: EventSettings
  /** Builds one trigger run's agent, fresh per run: no tool, like a chat agent. Default: the channel factory. */
  readonly triggerAgentFactory?: () => Promise<TurnAgent>
}

export interface ComposedTheoClaw {
  readonly loop: ChannelLoop
  readonly router: (request: Request) => Promise<Response>
  /** The chat sessions' agents; `disposeAll()` at stop is the only end of their lifetime (D2). */
  readonly sessions: SessionAgents
}

/** The trigger routes (B-397): each run on a fresh tool-less agent in its own request boundary, replying through a started adapter, its reply masked (B-398 FR-006). */
function composedTriggers(
  options: TheoClawOptions,
  events: EventSettings,
  loop: ChannelLoop,
  write: (line: string) => void,
  secrets: readonly string[],
): ReadonlyMap<string, WebhookRoute> {
  const factory = options.triggerAgentFactory ?? createSdkChannelAgentFactory(options.env)
  return triggerRoutes(events.triggers, {
    adapterFor: (platform) => loop.started.get(platform)?.adapter,
    withAgent: createContainer<TurnAgent>({ factory }).withAgent,
    write,
    secrets,
  })
}

/** One line per platform left unconfigured, and per configured one no sender can reach under the DM policy. */
function reportUnservedPlatforms(
  skipped: ReturnType<typeof resolvePlatforms>['skipped'],
  configured: ReturnType<typeof resolvePlatforms>['configured'],
  policy: AuthorizationPolicy,
  write: (line: string) => void,
): void {
  for (const { platform, missing } of skipped) {
    write(`${platform}: not configured (missing ${missing.join(', ')})`)
  }
  // Only `open` admits a sender no platform authenticates; under the rest such a channel serves nobody.
  if (policy.dmPolicy !== 'open') {
    for (const { platform } of configured.filter(
      (entry) => !isAuthenticatedSender(entry.platform),
    )) {
      write(
        `${platform}: no sender can be admitted under THEOCLAW_DM_POLICY=${policy.dmPolicy}: its sender id is not authenticated, so its messages are dropped without a reply`,
      )
    }
  }
}

/**
 * Wire the app: the configured platforms, one runner each, the reply handler, and the routes.
 * Returns at once; the loop keeps starting slow platforms while the router already serves (EC-2).
 */
export function composeTheoClaw(options: TheoClawOptions): ComposedTheoClaw {
  // First: a bad authorization value stops the start before any adapter is built.
  const policy = options.policy ?? parseAuthorizationPolicy(options.env)
  const chat = chatSessions(options)
  const platforms = resolvePlatforms(options.env)
  const { configured, skipped } = platforms
  const secrets = [...(options.secrets ?? platforms.secrets), options.env.THEOCLAW_VOICE_OPENAI_API_KEY?.trim() ?? '']
  reportUnservedPlatforms(skipped, configured, policy, options.write)
  // What the routes and the router write can carry a configured value (a verifier's message, an
  // SDK error): masked here as the loop masks its own lines, whatever stream the caller writes to.
  const maskedWrite = (line: string): void => options.write(redactSecrets(maskSecrets(line, secrets)))
  // The store exists only with a state directory; the hook runs without one under the other policies.
  const pairing = options.pairing ?? pairingStoreFor(policy, maskedWrite)
  const usage = createUsageHook({ keyOf: chat.keyOf })
  const model = options.env.THEOCLAW_MODEL
  const deps: WebhookDeps = {
    write: maskedWrite,
    verifierFactory: options.teamsVerifierFactory ?? teamsActivityVerifier,
  }
  const webhooks = new Map<PlatformName, WebhookPlatform>()
  for (const entry of configured) {
    const webhook = webhookPlatform(entry, deps)
    if (webhook !== undefined) webhooks.set(entry.platform, webhook)
  }
  const events = options.events ?? readEventSettings(options.env, configured.map((entry) => entry.platform))
  const handles = new WeakMap<BasePlatformAdapter, Handle>()
  const loop = startChannelLoop({
    platforms: (options.builders ?? adapterBuilders)(configured, { requireMention: policy.groupActivation === 'mention' }).map((build) =>
      withRoute(build, webhooks.get(build.platform), handles),
    ),
    handler: withVoiceReplies(createReplyHandler({
      withAgent: chat.withAgent,
      reset: (event) => chat.sessions.reset(event),
      secrets,
      ...(model === undefined ? {} : { usage: { modeFor: usage.modeFor, model, write: maskedWrite } }),
      // `loop` is read per message, after it exists: a member whose platform has not started is
      // reported as not delivered.
      broadcast: {
        groups: createBroadcastGroups(policy.broadcastGroups),
        adapterFor: (platform) => loop.started.get(platform as PlatformName)?.adapter,
        write: maskedWrite,
      },
      goal: events.goal,
    }), configuredVoiceReplies(options.env)),
    hooks: channelHooks({ policy, ...(pairing === undefined ? {} : { pairing }), write: maskedWrite, ...(model === undefined ? {} : { usage: usage.hook }) }),
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
    triggers: composedTriggers(options, events, loop, maskedWrite, secrets),
  })
  return { loop, router, sessions: chat.sessions }
}

export interface StartOptions extends Omit<TheoClawOptions, 'write'> {
  readonly signals: SignalSource
  readonly exit: (code: number) => void
  /** The streams the output mask wraps; `process.stdout` and `process.stderr` by default. */
  readonly streams?: readonly MaskableStream[]
  /** Receives operational lines after the same secret masking as local output. */
  readonly telemetryLog?: (line: string) => void
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
  /** The migration import's line (FR-010, D1), computed by the entry and written after the instance line. */
  readonly importedLine?: string
  /** Every `/control` agent's workers, which an import must not reach (FR-009); WebChat's go through `createChatAgent`. Default: `agentFactory`. */
  readonly importFreeAgentFactory?: StartOptions['agentFactory']
  /** The processes an import starts outside the sandbox (`importedMcpPaths`), protected with host tools on. */
  readonly importedPaths?: readonly ProtectedPath[]
  /** The import's env and header values (`importedMcpSecrets`), hidden by the output mask with the others. */
  readonly importedSecrets?: readonly string[]
  /** Builds the tool-less agent of one `digest` call (B-387, D3). Absent: no workflow tool. */
  readonly draftAgentFactory?: () => Promise<SDKAgent>
  /** The SDK's live agent cache, turned off at start (D2). Default `Agent.registry`. */
  readonly agentRegistry?: { configure(options: { readonly maxAgents: number; readonly idleTimeoutMs: number }): void }
  /** Where the WebChat bundle is read from. Default `WEBCHAT_ASSETS_DIR`, where `build:web` writes it. */
  readonly webchatAssetsDir?: string | URL
  /** Creates a WebChat turn's agent from the chat options `webchatAgentFactory` pins. Default: the SDK's, as `/control`'s. */
  readonly createChatAgent?: CreateAgent
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

const SHELL_READ_LINE = 'tools: host tools are on; the shell can read every file the process user can read'

/** The tool settings, every refusal included, before anything opens (FR-008). */
function startToolSettings(options: StartOptions, policy: AuthorizationPolicy): ToolSettings {
  // A profiled instance's agents work in its workspace (B-514), so their tool root is made there.
  const cwd = options.cwd ?? options.instance?.workspace ?? process.cwd()
  const tools = resolveToolSettings(options.env, cwd, options.toolDeps)
  checkHostToolsPosture(tools, hostToolsProtectedPaths(options.env, policy.stateDir, tools, options.importedPaths ?? []), options.toolDeps)
  return tools
}

/** The store of `policy.stateDir`, or none without one. Throws on a state file it cannot read. */
function pairingStoreFor(
  policy: AuthorizationPolicy,
  write: (line: string) => void,
): PairingStore | undefined {
  return policy.stateDir === undefined ? undefined : createPairingStore({ dir: policy.stateDir, write })
}

/** What the start says about the tools: what is off and why, the shell's reach, the external tools by name. */
function writeToolLines(tools: ToolSettings, write: (line: string) => void): void {
  for (const line of tools.offLines) write(line)
  if (tools.hostTools) write(SHELL_READ_LINE)
  if (tools.external.startLine !== undefined) write(tools.external.startLine)
}

/** Write the instance's start line, the first line of the start, then any import line, and return the instance. */
function announceInstance(given: TheoClawInstance | undefined, stderr: (line: string) => void, imported?: string): TheoClawInstance {
  const instance = given ?? NO_PROFILE
  for (const line of [startLine(instance), ...(imported === undefined ? [] : [imported])]) stderr(line)
  return instance
}

/** The `/control` agents' workflow tools: one request boundary per call over the draft factory. */
function workflowTools(factory: StartOptions['draftAgentFactory'], write: (line: string) => void): CustomTool[] {
  return createWorkflowTools({ write, ...(factory === undefined ? {} : { withDraftAgent: createContainer({ factory }).withAgent }) })
}

/**
 * The WebChat routes, or `undefined` while `THEOCLAW_WEBCHAT_TOKEN` is unset. WebChat is a chat
 * surface, so its agents are built through the chat path's factory, as every chat agent: no tool
 * (B-382), no `shell` and memory off (B-377), whatever the `/control` turn's options become.
 */
function startWebchat(options: StartOptions, settings: ControlPlaneSettings, secrets: readonly string[], write: (line: string) => void): HttpHandler | undefined {
  const token = settings.webchatToken
  if (token === undefined) return undefined
  const agents = createContainer<TurnAgent>({ factory: webchatAgentFactory(options.env, options.createChatAgent) })
  const assetsDir = options.webchatAssetsDir ?? WEBCHAT_ASSETS_DIR
  return createWebchatRoutes({ token, runTurn: createTurnRunner(agents.withAgent, secrets, settings.model), assetsDir, write })
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
  const platforms = resolvePlatforms(options.env).configured.map((entry) => entry.platform)
  const events = readEventSettings(options.env, platforms)
  const sessionSettings = readSessionSettings(options.env, statSync)
  const generations = Generations.load(sessionsFile(sessionSettings.workspace))
  const scheduleStore = loadScheduleStore(sessionSettings.workspace)
  const heartbeat = readHeartbeatSettings(options.env, platforms)
  const a2a = readA2ASettings(options.env)
  // `SessionAgents` alone decides when a session's agent is disposed: the SDK's cache and its idle
  // sweep know nothing of a turn in flight. `Agent.create` never reads the cache, so `/control`
  // turns are unaffected.
  ;(options.agentRegistry ?? Agent.registry).configure({ maxAgents: 0, idleTimeoutMs: 0 })
  // Created here with 0700, before anything is installed that a failure would have to undo, so the
  // SDK never creates the transcript directory with the umask's mode (D6); one that exists is left
  // as the operator set it. Under a profile the workspace is the profile's own (`instance.ts`).
  mkdirSync(join(sessionSettings.workspace, '.theoclaw'), { recursive: true, mode: 0o700 })
  const streams = options.streams ?? [process.stdout, process.stderr]
  const secretValues = processSecrets(options, settings, tools, events, a2a)
  const logged = (write: (line: string) => void) => (line: string): void => {
    write(line)
    if (options.telemetryLog !== undefined) options.telemetryLog(redactSecrets(maskSecrets(line, secretValues)))
  }
  const stderr = logged(options.stderr ?? lineWriter(streams[streams.length - 1]))
  // Loaded before the start line, the mask and the shutdown: an unreadable pairing file leaves nothing behind.
  const secrets = resolvePlatforms(options.env).secrets
  const pairing = pairingStoreFor(policy, (line) => stderr(redactSecrets(maskSecrets(line, secrets))))
  // First, once every setting is checked: the line holds a label and a directory, never a secret.
  const instance = announceInstance(options.instance, stderr, options.importedLine)
  const mask = installOutputMask(secretValues, streams)
  const stdout = logged(options.stdout ?? lineWriter(streams[0]))
  const flushOnExit = (): void => mask.flush()
  options.signals.on('exit', flushOnExit)
  let composedApp: ComposedTheoClaw | undefined
  let scheduled: RunningScheduler | undefined
  let serving: Promise<ControlPlaneHandle> | undefined
  // Bound once the listener resolves; the shutdown hook reads it late, as it reads `serving`.
  let announcement: LanAnnouncement | undefined
  const removeShutdown = installShutdown({
    signals: options.signals,
    // The scheduler, then the loop, so no run or turn starts once the agents are being disposed.
    stopAll: async () => {
      await scheduled?.stop()
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
  for (const line of a2aLines(a2a)) stderr(line)
  // The composition gets the raw factory: chat agents hold no tool, only `/control` agents do.
  const composed = composeTheoClaw({
    ...options,
    policy,
    sessionSettings,
    generations,
    events,
    ...(pairing === undefined ? {} : { pairing }),
    write: stderr,
    secrets: secretValues,
  })
  // `/control` agents hold `run_code` and `delegate_all`; their read-only workers carry no import.
  const buildWorker = options.importFreeAgentFactory ?? options.agentFactory
  const beat = heartbeat === undefined ? {} : { heartbeat: heartbeatJob(sessionSettings.workspace, heartbeat) }
  scheduled = wireScheduler({ store: scheduleStore, loop: composed.loop, buildRunAgent: buildWorker, tools, platforms, ...beat, write: stderr, secrets: secretValues })
  const extraTools = [...workflowTools(options.draftAgentFactory, stderr), ...scheduled.scheduleTools, ...peerTools(a2a.peers)]
  const buildControlAgent = async (): Promise<TurnAgent> =>
    options.agentFactory(controlAgentToolOptions(tools, buildWorker, extraTools))
  const { withAgent } = createContainer<TurnAgent>({ factory: buildControlAgent })
  composedApp = composed
  const devices = devicePairingFor(policy.stateDir, settings.controlToken, stderr)
  // A chat completion is a chat surface: its agent is a chat agent, holding no tool (B-382), so
  // `/tools/invoke` is the only way to the `/control` set, built by the same call as that agent's.
  const chatAgents = createContainer<TurnAgent>({ factory: webchatAgentFactory(options.env, options.createChatAgent) })
  const api = theoClawApiFor(settings.controlToken, {
    model: settings.model,
    withAgent: chatAgents.withAgent,
    toolSettings: tools,
    controlTools: () => controlAgentToolOptions(tools, buildWorker, extraTools).tools,
    stderr,
  })
  const listen = options.listen ?? listenControlPlane
  serving = listen({
    handler: serveHandler(
      composed.router,
      startWebchat(options, settings, secretValues, stderr),
      devices,
      api,
      a2a.token === undefined ? undefined : a2aRoute({ token: a2a.token, buildWorker, tools, secrets: secretValues, write: stderr }),
    ),
    port: settings.port,
    host: settings.host,
    stderr,
    ...(settings.controlToken === undefined
      ? {}
      : { control: controlOptions(settings.controlToken, withAgent, buildControlAgent, stderr, secretValues, devices, settings.model) }),
  })
  let handle: ControlPlaneHandle
  try {
    handle = await serving
  } catch (error) {
    // The listener never bound (a busy port, an address the host lacks): stop what started and let
    // the entry exit 1.
    removeShutdown()
    options.signals.off('exit', flushOnExit)
    await scheduled.stop()
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
  // Last: a shutdown that began during the start has already stopped it, and then this registers nothing.
  await scheduled.start()
  // `close` withdraws the announcement first, as the shutdown does: a caller that closes the
  // running instance directly must not leave the service advertised.
  const close = async (): Promise<void> => {
    await scheduled?.stop()
    await stopThenClose(announcement, handle)
  }
  return { ...handle, ...composed, announcement, instance, close }
}
