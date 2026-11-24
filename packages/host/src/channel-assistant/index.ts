import {
  GatewayRunner,
  createAccessPolicyHook,
  createWebhookHandler,
  maskSecrets,
  redactSecrets,
} from '@theokit/gateway'
import type {
  AccessPolicyOptions,
  BasePlatformAdapter,
  BuiltChannel,
  ChannelDescriptor,
  GatewayHook,
  MessageEvent,
  PlatformName,
  ReconnectPolicy,
} from '@theokit/gateway'
import { createAgentHandler } from '@theokit/gateway-agent'
import type { AgentHandlerOptions, TurnAgent } from '@theokit/gateway-agent'
import { Agent } from '@theokit/sdk'
import type { GenerationStore, SDKAgent, SessionPool } from '@theokit/sdk'

import { createAppHost } from '../app-host/app-host.js'
import type { AppHost, AppHostCloseResult, SignalSource } from '../app-host/app-host.js'

/** One platform the assistant serves. `build` runs once, at start, and may throw: that platform is then left out. */
export interface ChannelAssistantChannel {
  readonly platform: PlatformName
  readonly build: () => BasePlatformAdapter
  /** The gateway descriptor; present for a webhook platform, so the router can route to its adapter. */
  readonly descriptor?: ChannelDescriptor
}

/** The reply path: the hooks of `createAgentHandler` the app may set. */
export type ChannelAssistantReply = Pick<
  AgentHandlerOptions,
  | 'prompt'
  | 'ackEmoji'
  | 'progress'
  | 'decorateReply'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'noAnswerText'
  | 'errorText'
  | 'sendOptions'
>

export interface ChannelAssistantOptions {
  readonly channels: readonly ChannelAssistantChannel[]
  /** Builds the agent of one session key (the `agent` form of `Agent.sessionPool`); the pool disposes it. */
  readonly agent: (args: {
    key: string
    agentId: string
    context: MessageEvent
  }) => SDKAgent | Promise<SDKAgent>
  /** The session key of an event. Default: platform, channel type and channel id. */
  readonly sessionKey?: (event: MessageEvent) => string
  readonly sessions?: {
    readonly generations?: GenerationStore
    readonly idleMs?: number
    readonly maxOpen?: number
  }
  /** The access policy: options for `createAccessPolicyHook`, or a hook of the app's own. Runs after `preHooks`. */
  readonly access?: AccessPolicyOptions | GatewayHook
  /** Hooks that must run before the access policy (an app's e-mail trigger, say). */
  readonly preHooks?: readonly GatewayHook[]
  /** The app's hooks: run after the access policy and before `help`. */
  readonly hooks?: readonly GatewayHook[]
  /** The last hook, which answers `/help`. */
  readonly help?: GatewayHook
  readonly reply?: ChannelAssistantReply
  /** One factory for every event run (trigger, e-mail, webhook): a fresh agent per run, disposed after it. */
  readonly events?: { readonly agent: () => TurnAgent | Promise<TurnAgent> }
  /** Every value that must not leave in a reply or a written line. */
  readonly secrets?: readonly string[]
  /** Where lines go; every line is masked first. Default: nowhere. */
  readonly write?: (line: string) => void
  /** Per-adapter connect bound. */
  readonly startTimeoutMs?: number
  /** Background retry of a platform whose connect failed transiently. */
  readonly retry?: ReconnectPolicy
  /** `start()` resolves once the loop is running instead of when every platform has connected. */
  readonly background?: boolean
  readonly signals?: SignalSource
  readonly exit?: (code: number) => void
  readonly stopTimeoutMs?: number
}

export interface ChannelAssistant {
  /** Webhook routes of the built channels; a platform not started answers 503. */
  readonly router: (request: Request) => Promise<Response>
  /** The session pool; exists from the call. */
  readonly sessions: SessionPool<MessageEvent>
  /** Platforms that have connected. */
  readonly started: ReadonlyMap<PlatformName, BasePlatformAdapter>
  readonly failed: readonly PlatformName[]
  /** Settles once every platform has connected, failed or been abandoned (after `start()`). */
  readonly ready: Promise<void>
  /** Masks the configured values, then writes. */
  readonly write: (line: string) => void
  /** Runs `work` on one fresh event agent, then disposes the agent. */
  withEventAgent<R>(work: (agent: TurnAgent) => R | Promise<R>): Promise<R>
  start(): Promise<void>
  /** Stops the channels, then disposes the session agents, once. */
  close(): Promise<AppHostCloseResult>
}

const isHook = (value: AccessPolicyOptions | GatewayHook): value is GatewayHook =>
  'name' in value && typeof (value as { name?: unknown }).name === 'string' && !('owners' in value)

const defaultSessionKey = (event: MessageEvent): string =>
  `${event.platform}:${event.channel.type}:${event.channel.id}`

/**
 * Assemble a channel assistant: the adapters, a session pool, the gateway hooks in a fixed order
 * (pre-hooks, access policy, app hooks, help), the reply handler, secret masking, the webhook
 * router and an ordered teardown. Nothing runs until `start()`.
 */
export function createChannelAssistant(options: ChannelAssistantOptions): ChannelAssistant {
  const secrets = options.secrets ?? []
  const write = (line: string): void => options.write?.(redactSecrets(maskSecrets(line, secrets)))
  const host: AppHost = createAppHost({
    ...(options.signals === undefined ? {} : { signals: options.signals }),
    ...(options.exit === undefined ? {} : { exit: options.exit }),
    ...(options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: options.stopTimeoutMs }),
    onError: (step, error) => {
      write(`stop ${step} failed: ${describe(error)}`)
    },
  })

  const sessions = Agent.sessionPool<MessageEvent>({
    agent: options.agent,
    ...(options.sessions?.generations === undefined
      ? {}
      : { generations: options.sessions.generations }),
    ...(options.sessions?.idleMs === undefined ? {} : { idleMs: options.sessions.idleMs }),
    ...(options.sessions?.maxOpen === undefined ? {} : { maxOpen: options.sessions.maxOpen }),
  })
  const keyOf = options.sessionKey ?? defaultSessionKey

  const started = new Map<PlatformName, BasePlatformAdapter>()
  const failed: PlatformName[] = []
  const built: BuiltChannel[] = []
  let ready: Promise<void> = Promise.resolve()

  const access =
    options.access === undefined
      ? []
      : [isHook(options.access) ? options.access : createAccessPolicyHook(options.access)]
  const hooks: GatewayHook[] = [
    ...(options.preHooks ?? []),
    ...access,
    ...(options.hooks ?? []),
    ...(options.help === undefined ? [] : [options.help]),
  ]

  const handler = createAgentHandler({
    ...options.reply,
    agentFor: async (event) => await sessions.lease(keyOf(event), event),
    secrets,
  })

  const router = createWebhookHandler({
    channels: built,
    isStarted: (platform) => started.has(platform),
    onError: (platform, error) => {
      write(`${platform}: webhook failed: ${describe(error)}`)
    },
  })

  // The pool is registered first, so reverse order disposes the agents after the channels stop.
  host.service(
    'sessions',
    () => sessions,
    async (pool) => {
      await pool.disposeAll()
    },
  )
  host.service(
    'channels',
    () => {
      const adapters: BasePlatformAdapter[] = []
      for (const channel of options.channels) {
        try {
          const adapter = channel.build()
          adapters.push(adapter)
          if (channel.descriptor !== undefined)
            built.push({ descriptor: channel.descriptor, adapter })
        } catch (error) {
          failed.push(channel.platform)
          write(`${channel.platform}: start failed: ${describe(error)}`)
        }
      }
      const runner = new GatewayRunner({
        adapters,
        handler,
        hooks,
        connectFailure: 'isolate',
        secrets,
        ...(options.startTimeoutMs === undefined
          ? {}
          : { connectTimeoutMs: options.startTimeoutMs }),
        ...(options.retry === undefined ? {} : { reconnect: options.retry }),
        onAdapterState: (platform, state, reason) => {
          const adapter = adapters.find((entry) => entry.platform === platform)
          if (state === 'connected' && adapter !== undefined) {
            started.set(platform, adapter)
            write(`${platform}: connected`)
          } else if (state === 'failed' || state === 'timed_out') {
            if (!failed.includes(platform)) failed.push(platform)
            write(
              `${platform}: ${state === 'failed' ? 'start failed' : 'start timed out'}: ${reason ?? ''}`,
            )
          }
        },
      })
      ready = runner.start().then(
        () => undefined,
        (error: unknown) => {
          write(`start failed: ${describe(error)}`)
        },
      )
      return { runner, ready }
    },
    async ({ runner }) => {
      started.clear()
      await runner.stop()
    },
  )

  return {
    router,
    sessions,
    started,
    failed,
    get ready() {
      return ready
    },
    write,
    async withEventAgent(work) {
      if (options.events === undefined)
        throw new Error('createChannelAssistant: no `events.agent` factory was given')
      const agent = await options.events.agent()
      try {
        return await work(agent)
      } finally {
        await (agent as { dispose?: () => unknown }).dispose?.()
      }
    },
    async start() {
      await host.start()
      if (options.background !== true) await ready
    },
    close: () => host.close(),
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
