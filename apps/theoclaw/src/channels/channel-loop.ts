import { startChannels } from '@theokit/host/channel-assistant'
import type { BasePlatformAdapter, GatewayHandler, GatewayHook, PlatformName } from '@theokit/gateway'

/** One platform the loop may start: building the adapter can throw, and only fails that platform. */
export interface PlatformBuild {
  readonly platform: PlatformName
  build(): BasePlatformAdapter
}

export interface ChannelLoopOptions {
  readonly platforms: readonly PlatformBuild[]
  readonly handler: GatewayHandler
  /** Registered on the runner, in order, before the handler sees a message (the owner policy, FR-009). */
  readonly hooks?: readonly GatewayHook[]
  /** Every configured credential value; none of them is ever written (D9). */
  readonly secrets: readonly string[]
  readonly write: (line: string) => void
  /** How long one platform may take to connect before it is abandoned. Default 30 000 ms. */
  readonly startTimeoutMs?: number
  /** Reconnect a platform whose connect failed transiently, in the background, with doubling delays. Absent: give up after one try. */
  readonly retry?: RetryPolicy
}

export interface RetryPolicy {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  /** Retries after the first failed start. */
  readonly maxAttempts: number
}

/** A platform that connected: the routes and the senders deliver through `adapter`. */
export interface StartedPlatform {
  readonly adapter: BasePlatformAdapter
}

export interface ChannelLoop {
  /** Grows as each platform connects, while slower ones are still connecting (EC-2). */
  readonly started: ReadonlyMap<PlatformName, StartedPlatform>
  readonly failed: readonly PlatformName[]
  /** Settles once every platform has started, failed or been abandoned. */
  readonly ready: Promise<void>
  /** Stops what has started, at once; never waits for a pending start (EC-3). */
  stopAll(): Promise<void>
}

const DEFAULT_START_TIMEOUT_MS = 30_000

/**
 * Start one `GatewayRunner` over every adapter that builds, through the framework's channel set
 * (`@theokit/host/channel-assistant`): the platforms are isolated, each connect is bounded, a
 * transient failure is retried in the background and the configured values are masked, so one
 * platform that cannot connect silences only itself (D1). An adapter that does not build is
 * reported and left out. Returns at once; `ready` settles when every start has.
 */
export function startChannelLoop(options: ChannelLoopOptions): ChannelLoop {
  const set = startChannels({
    channels: options.platforms,
    handler: options.handler,
    hooks: options.hooks ?? [],
    secrets: options.secrets,
    write: options.write,
    startTimeoutMs: options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    onBuilt: () => undefined,
  })
  return { started: set.started, failed: set.failed, ready: set.ready, stopAll: () => set.stop() }
}
