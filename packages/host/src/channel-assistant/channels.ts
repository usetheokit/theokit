import { GatewayRunner, maskSecrets, redactSecrets } from '@theokit/gateway'
import type {
  BasePlatformAdapter,
  BuiltChannel,
  ChannelDescriptor,
  GatewayHandler,
  GatewayHook,
  PlatformName,
} from '@theokit/gateway'

/** One platform the assistant serves. `build` runs once, at start, and may throw: that platform is then left out. */
export interface ChannelAssistantChannel {
  readonly platform: PlatformName
  readonly build: () => BasePlatformAdapter
  /** The gateway descriptor; present for a webhook platform, so the router can route to its adapter. */
  readonly descriptor?: ChannelDescriptor
}

/** Retry of a platform whose connect failed transiently, in the background, with doubling delays. */
export interface ChannelRetryPolicy {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  /** Retries after the first failed start. */
  readonly maxAttempts: number
}

/** The running channels: what has connected, what failed, and the one stop. */
export interface ChannelSet {
  /** Grows as each platform connects, while slower ones are still connecting. */
  readonly started: ReadonlyMap<PlatformName, { readonly adapter: BasePlatformAdapter }>
  readonly failed: readonly PlatformName[]
  /** Settles once every platform has connected, failed or been abandoned. */
  readonly ready: Promise<void>
  /** Stops what has started, at once, and never waits for a pending start. Safe to call twice. */
  stop(): Promise<void>
}

export interface ChannelSetOptions {
  readonly channels: readonly ChannelAssistantChannel[]
  readonly handler: GatewayHandler
  readonly hooks: readonly GatewayHook[]
  readonly secrets: readonly string[]
  readonly write: (line: string) => void
  readonly startTimeoutMs: number
  readonly retry?: ChannelRetryPolicy
  /** Receives each adapter paired with its descriptor, as it is built. */
  readonly onBuilt: (built: BuiltChannel) => void
}

/** `GatewayRunner` over every adapter that builds: one platform that cannot connect silences only itself. */
export function startChannels(options: ChannelSetOptions): ChannelSet {
  const started = new Map<PlatformName, { readonly adapter: BasePlatformAdapter }>()
  const failed: PlatformName[] = []
  let stopping = false
  let stopped: Promise<void> | undefined

  // Configured values are masked BEFORE `redactSecrets`: it shortens some shapes to a head and a
  // tail, after which the whole value is no longer there to find.
  const describe = (error: unknown): string =>
    redactSecrets(
      maskSecrets(error instanceof Error ? error.message : String(error), options.secrets),
    )
  const fail = (platform: PlatformName, line: string): void => {
    if (!failed.includes(platform)) failed.push(platform)
    options.write(line)
  }

  const adapters: BasePlatformAdapter[] = []
  for (const { platform, build, descriptor } of options.channels) {
    try {
      const adapter = build()
      adapters.push(adapter)
      if (descriptor !== undefined) options.onBuilt({ descriptor, adapter })
    } catch (error) {
      fail(platform, `${platform}: start failed: ${describe(error)}`)
    }
  }
  const byPlatform = new Map(adapters.map((adapter) => [adapter.platform, adapter] as const))

  const onState = (platform: PlatformName, state: string, reason: string | undefined): void => {
    if (stopping) return
    if (state === 'connected') {
      const adapter = byPlatform.get(platform)
      if (adapter === undefined) return
      started.set(platform, { adapter })
      const index = failed.indexOf(platform)
      if (index >= 0) failed.splice(index, 1)
      options.write(`${platform}: connected`)
    } else if (state === 'failed') {
      fail(platform, `${platform}: start failed: ${describe(reason ?? '')}`)
    } else if (state === 'timed_out') {
      fail(platform, `${platform}: start timed out after ${String(options.startTimeoutMs)} ms`)
    } else {
      const attempt = /attempt (\d+) in (\d+)ms/.exec(reason ?? '')
      options.write(
        attempt === null || options.retry === undefined
          ? `${platform}: ${describe(reason ?? 'retrying')}`
          : `${platform}: retry ${attempt[1]}/${String(options.retry.maxAttempts)} in ${attempt[2]} ms`,
      )
    }
  }

  const runner = new GatewayRunner({
    adapters,
    handler: options.handler,
    hooks: options.hooks,
    connectFailure: 'isolate',
    connectTimeoutMs: options.startTimeoutMs,
    secrets: options.secrets,
    ...(options.retry === undefined ? {} : { reconnect: { ...options.retry, retryFalse: true } }),
    onAdapterState: onState,
  })
  const ready = runner.start().then(
    () => undefined,
    (error: unknown) => {
      for (const adapter of adapters)
        fail(adapter.platform, `${adapter.platform}: start failed: ${describe(error)}`)
    },
  )

  return {
    started,
    failed,
    ready,
    stop() {
      stopped ??= (async () => {
        stopping = true
        // A stopped platform is no longer started: a route that looks it up answers 503.
        started.clear()
        await runner.stop().catch((error: unknown) => {
          options.write(`stop failed: ${describe(error)}`)
        })
      })()
      return stopped
    },
  }
}
