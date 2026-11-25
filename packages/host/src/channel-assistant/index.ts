import {
  createAccessPolicyHook,
  createWebhookHandler,
  maskSecrets,
  redactSecrets,
} from '@theokit/gateway'
import type {
  AccessPolicyOptions,
  BasePlatformAdapter,
  BuiltChannel,
  GatewayHandler,
  GatewayHook,
  MessageEvent,
  PlatformName,
} from '@theokit/gateway'
import { Agent, Security } from '@theokit/sdk'
import type { GenerationStore, SDKAgent, SessionPool } from '@theokit/sdk'

import { createAppHost } from '../app-host/app-host.js'
import type { AppHost, AppHostCloseResult, SignalSource } from '../app-host/app-host.js'

import { startChannels } from './channels.js'
import type { ChannelAssistantChannel, ChannelRetryPolicy, ChannelSet } from './channels.js'

export { startChannels } from './channels.js'
export type {
  ChannelAssistantChannel,
  ChannelRetryPolicy,
  ChannelSet,
  ChannelSetOptions,
} from './channels.js'

/** The part of an agent the assistant uses for an event run; an SDK agent or a fake fits. */
export interface TurnAgent {
  send(prompt: string, options?: Record<string, unknown>): Promise<unknown>
}

/** A session agent on loan for one turn: `release` hands it back to the pool. */
export interface AgentLease {
  readonly agent: TurnAgent
  release(): void | Promise<void>
}

/**
 * Builds the reply handler over the owned pool, for example with `createAgentHandler` from
 * `@theokit/gateway-agent`: `({ agentFor, secrets }) => createAgentHandler({ agentFor, secrets, ...reply })`.
 */
export type ReplyHandlerFactory = (args: {
  readonly agentFor: (event: MessageEvent) => Promise<AgentLease>
  readonly secrets: readonly string[]
}) => GatewayHandler

/** What the assistant needs of a session store it is given: which agents it holds, and the end of them. */
export interface SessionHost {
  heldIds(): readonly string[]
  disposeAll(): Promise<unknown>
}

/** The assistant builds the pool: one agent per session key, through the `agent` form of `Agent.sessionPool`. */
export interface OwnedSessions {
  readonly agent: (args: {
    key: string
    agentId: string
    context: MessageEvent
  }) => SDKAgent | Promise<SDKAgent>
  /** The session key of an event. Default: platform, channel type and channel id. */
  readonly sessionKey?: (event: MessageEvent) => string
  readonly generations?: GenerationStore
  readonly idleMs?: number
  readonly maxOpen?: number
}

/** The app owns the sessions (it wraps its agents); the assistant disposes them last, once. `handler` is then required. */
export interface GivenSessions {
  readonly pool: SessionHost
}

/** Something started and stopped with the assistant. */
export interface AssistantService {
  readonly name: string
  start(): Promise<void> | void
  stop?(): Promise<void> | void
}

export interface ChannelAssistantOptions {
  readonly channels: readonly ChannelAssistantChannel[]
  readonly sessions: OwnedSessions | GivenSessions
  /**
   * Who may talk to the assistant. Exactly one of `access` (options for `createAccessPolicyHook`) and
   * `accessHook` (a hook of the app's own) is required: an assistant with no policy is refused, not
   * opened. To serve everyone, say so: `access: { dm: 'open', owners: new Set(), isAuthenticated: () => false }`.
   */
  readonly access?: AccessPolicyOptions
  readonly accessHook?: GatewayHook
  /** Hooks that run before the access policy (an app's e-mail trigger, say). */
  readonly preHooks?: readonly GatewayHook[]
  /** The app's hooks: run after the access policy and before `help`. */
  readonly hooks?: readonly GatewayHook[]
  /** The last hook, which answers `/help`. */
  readonly help?: GatewayHook
  /** The reply handler. Required with `sessions.pool`. */
  readonly handler?: GatewayHandler
  /** The reply handler over the owned pool. With owned sessions, one of `handler` and `replyHandler` is required. */
  readonly replyHandler?: ReplyHandlerFactory
  /** One factory for every event run (trigger, e-mail, webhook): a fresh agent per run, disposed after it. */
  readonly events?: { readonly agent: () => TurnAgent | Promise<TurnAgent> }
  /** Every value that must not leave in a reply or a written line. */
  readonly secrets?: readonly string[]
  /** Streams that carry no configured value: installed first at `start()`, released at `close()`. */
  readonly maskStreams?: readonly NodeJS.WritableStream[]
  /** Where lines go; every line is masked first. Default: nowhere. */
  readonly write?: (line: string) => void
  /**
   * The transcript sweeper: called at `start()`, after the sessions exist, with the ids the pool
   * holds; stopped before the sessions are disposed.
   */
  readonly transcripts?: {
    start(heldIds: () => readonly string[]): { stop(): Promise<void> | void }
  }
  /** Extra services, started after the channels are running and stopped before them, in reverse. */
  readonly services?: readonly AssistantService[]
  /** Which platform a webhook URL names. Default: the last path segment after `/webhooks/`. */
  readonly platformFor?: (url: URL) => PlatformName | undefined
  /** Per-adapter connect bound. Default 30 000 ms. */
  readonly startTimeoutMs?: number
  readonly retry?: ChannelRetryPolicy
  /** `start()` resolves once the channels are running instead of when every platform has connected. */
  readonly background?: boolean
  readonly signals?: SignalSource
  readonly exit?: (code: number) => void
  readonly stopTimeoutMs?: number
}

export interface ChannelAssistant {
  /** Webhook routes of the built channels; a platform not started answers 503. */
  readonly router: (request: Request) => Promise<Response>
  readonly sessions: SessionHost
  /** Platforms that have connected. */
  readonly started: ReadonlyMap<PlatformName, { readonly adapter: BasePlatformAdapter }>
  readonly failed: readonly PlatformName[]
  /** Settles once every platform has connected, failed or been abandoned (or at `close()` if never started). */
  readonly ready: Promise<void>
  /** Masks the configured values, then writes. */
  readonly write: (line: string) => void
  /** Releases what the stream mask holds, keeping it installed. */
  flushMask(): void
  /** Stops the channels alone, at once; `close()` does it too, and the rest. */
  stopChannels(): Promise<void>
  /** Runs `work` on one fresh event agent, then disposes the agent. */
  withEventAgent<R>(work: (agent: TurnAgent) => R | Promise<R>): Promise<R>
  start(): Promise<void>
  /** Stops the services, the channels, the sweeper, then disposes the session agents, once. */
  close(): Promise<AppHostCloseResult>
}

const DEFAULT_START_TIMEOUT_MS = 30_000
const NO_CHANNELS: ReadonlyMap<PlatformName, { readonly adapter: BasePlatformAdapter }> = new Map()

const defaultSessionKey = (event: MessageEvent): string =>
  `${event.platform}:${event.channel.type}:${event.channel.id}`

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function accessHookOf({ access, accessHook }: ChannelAssistantOptions): GatewayHook {
  if (access !== undefined && accessHook === undefined) return createAccessPolicyHook(access)
  if (access === undefined && accessHook !== undefined) return accessHook
  throw new TypeError(
    'createChannelAssistant: give exactly one of `access` and `accessHook`; an assistant with no access policy is refused',
  )
}

interface Sessions {
  readonly host: SessionHost
  readonly handler: GatewayHandler
}

function sessionsOf(options: ChannelAssistantOptions, secrets: readonly string[]): Sessions {
  if ('pool' in options.sessions) {
    if (options.handler === undefined) {
      throw new TypeError('createChannelAssistant: `sessions.pool` needs a `handler` that uses it')
    }
    return { host: options.sessions.pool, handler: options.handler }
  }
  const owned = options.sessions
  const pool: SessionPool<MessageEvent> = Agent.sessionPool<MessageEvent>({
    agent: owned.agent,
    ...(owned.generations === undefined ? {} : { generations: owned.generations }),
    ...(owned.idleMs === undefined ? {} : { idleMs: owned.idleMs }),
    ...(owned.maxOpen === undefined ? {} : { maxOpen: owned.maxOpen }),
  })
  const keyOf = owned.sessionKey ?? defaultSessionKey
  let { handler } = options
  if (handler === undefined) {
    if (options.replyHandler === undefined) {
      throw new TypeError(
        'createChannelAssistant: owned `sessions` need a `handler` or a `replyHandler`',
      )
    }
    handler = options.replyHandler({
      agentFor: async (event) => (await pool.lease(keyOf(event), event)),
      secrets,
    })
  }
  return { host: pool, handler }
}

function registerMask(
  host: AppHost,
  options: ChannelAssistantOptions,
  secrets: readonly string[],
): () => void {
  let flush = (): void => undefined
  if (options.maskStreams === undefined || secrets.length === 0)
    return () => {
      flush()
    }
  const streams = options.maskStreams
  host.service(
    'output-mask',
    () => {
      const mask = Security.createMask(secrets, { minLength: 1 })
      const handle = mask.wrapStreams(streams)
      flush = () => {
        handle.flush()
      }
      return handle
    },
    (handle) => {
      flush = () => undefined
      handle.flush()
      handle()
    },
  )
  return () => {
    flush()
  }
}

function registerTranscripts(
  host: AppHost,
  options: ChannelAssistantOptions,
  held: SessionHost,
): void {
  const { transcripts } = options
  if (transcripts === undefined) return
  host.service(
    'transcripts',
    () => transcripts.start(() => held.heldIds()),
    async (sweeper) => {
      await sweeper.stop()
    },
  )
}

function registerServices(host: AppHost, services: readonly AssistantService[]): void {
  for (const service of services) {
    host.service(
      service.name,
      async () => {
        await service.start()
      },
      async () => {
        await service.stop?.()
      },
    )
  }
}

/**
 * Assemble a channel assistant: a session pool (or the app's own), the gateway hooks in a fixed
 * order (pre-hooks, access policy, app hooks, help), the reply handler, secret masking of replies,
 * lines and optionally output streams, the webhook router, a transcript sweeper and an ordered
 * teardown. Nothing runs until `start()`.
 */
export function createChannelAssistant(options: ChannelAssistantOptions): ChannelAssistant {
  const secrets = options.secrets ?? []
  const write = (line: string): void => {
    options.write?.(redactSecrets(maskSecrets(line, secrets)))
  }
  const hooks: GatewayHook[] = [
    ...(options.preHooks ?? []),
    accessHookOf(options),
    ...(options.hooks ?? []),
    ...(options.help === undefined ? [] : [options.help]),
  ]
  const sessions = sessionsOf(options, secrets)
  const host = createAppHost({
    ...(options.signals === undefined ? {} : { signals: options.signals }),
    ...(options.exit === undefined ? {} : { exit: options.exit }),
    ...(options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: options.stopTimeoutMs }),
    onError: (step, error) => {
      write(`stop ${step} failed: ${describe(error)}`)
    },
  })

  const built: BuiltChannel[] = []
  let channelSet: ChannelSet | undefined
  let resolveReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const flushMask = registerMask(host, options, secrets)
  host.service(
    'sessions',
    () => sessions.host,
    async (held) => {
      await held.disposeAll()
    },
  )
  registerTranscripts(host, options, sessions.host)
  host.service(
    'channels',
    () => {
      channelSet = startChannels({
        channels: options.channels,
        handler: sessions.handler,
        hooks,
        secrets,
        write,
        startTimeoutMs: options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
        ...(options.retry === undefined ? {} : { retry: options.retry }),
        onBuilt: (channel) => built.push(channel),
      })
      void channelSet.ready.then(resolveReady)
      return channelSet
    },
    async (set) => {
      await set.stop()
    },
  )
  registerServices(host, options.services ?? [])

  // The webhook handler reads the built channels once, so it is made after the channels are built.
  let webhooks: ((request: Request) => Promise<Response>) | undefined
  const router = (request: Request): Promise<Response> => {
    const handle =
      webhooks ??
      createWebhookHandler({
        channels: built,
        isStarted: (platform) => channelSet?.started.has(platform) ?? false,
        ...(options.platformFor === undefined ? {} : { platformFor: options.platformFor }),
        onError: (platform, error) => {
          write(`${platform}: webhook failed: ${describe(error)}`)
        },
      })
    if (channelSet !== undefined) webhooks = handle
    return handle(request)
  }

  return {
    router,
    sessions: sessions.host,
    get started() {
      return channelSet?.started ?? NO_CHANNELS
    },
    get failed() {
      return channelSet?.failed ?? []
    },
    ready,
    write,
    flushMask,
    stopChannels: async () => {
      await channelSet?.stop()
    },
    async withEventAgent(work) {
      if (options.events === undefined) {
        throw new Error('createChannelAssistant: no `events.agent` factory was given')
      }
      const agent = await options.events.agent()
      try {
        return await work(agent)
      } finally {
        await (agent as { dispose?: () => unknown }).dispose?.()
      }
    },
    async start() {
      try {
        await host.start()
      } catch (error) {
        // A start that rolled back leaves no channel to wait for.
        resolveReady()
        throw error
      }
      if (options.background !== true) await ready
    },
    async close() {
      try {
        return await host.close()
      } finally {
        resolveReady()
      }
    },
  }
}
