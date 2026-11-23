import { GatewayRunner, maskSecrets, redactSecrets } from '@theokit/gateway'
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
 * Start one `GatewayRunner` over every adapter that builds. The runner isolates the platforms
 * (`connectFailure: "isolate"`), bounds each connect, retries a transient failure in the background
 * and masks the configured values, so one platform that cannot connect silences only itself (D1).
 * An adapter that does not build is reported here and left out. Returns at once; `ready` settles
 * when every start has.
 */
export function startChannelLoop(options: ChannelLoopOptions): ChannelLoop {
  const started = new Map<PlatformName, StartedPlatform>()
  const failed: PlatformName[] = []
  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  let stopping = false

  // The configured values are masked BEFORE `redactSecrets`: it shortens some shapes to a head and
  // a tail, after which the whole value is no longer there to find, and the fragments would stay.
  const describeError = (error: unknown): string =>
    redactSecrets(
      maskSecrets(error instanceof Error ? error.message : String(error), options.secrets),
    )
  const fail = (platform: PlatformName, line: string): void => {
    if (!failed.includes(platform)) failed.push(platform)
    options.write(line)
  }

  const adapters: BasePlatformAdapter[] = []
  for (const { platform, build } of options.platforms) {
    try {
      adapters.push(build())
    } catch (error) {
      fail(platform, `${platform}: start failed: ${describeError(error)}`)
    }
  }
  const byPlatform = new Map(adapters.map((adapter) => [adapter.platform, adapter] as const))

  const runner = new GatewayRunner({
    adapters,
    handler: options.handler,
    hooks: options.hooks ?? [],
    connectFailure: 'isolate',
    connectTimeoutMs: timeoutMs,
    secrets: options.secrets,
    ...(options.retry === undefined
      ? {}
      : { reconnect: { initialDelayMs: options.retry.initialDelayMs, maxDelayMs: options.retry.maxDelayMs, maxAttempts: options.retry.maxAttempts, retryFalse: true } }),
    onAdapterState: (platform, state, reason) => {
      if (stopping) return
      if (state === 'connected') {
        const adapter = byPlatform.get(platform)
        if (adapter === undefined) return
        started.set(platform, { adapter })
        const index = failed.indexOf(platform)
        if (index >= 0) failed.splice(index, 1)
        options.write(`${platform}: connected`)
      } else if (state === 'failed') {
        fail(platform, `${platform}: start failed: ${describeError(reason ?? '')}`)
      } else if (state === 'timed_out') {
        fail(platform, `${platform}: start timed out after ${timeoutMs} ms`)
      } else {
        const attempt = /attempt (\d+) in (\d+)ms/.exec(reason ?? '')
        options.write(
          attempt === null || options.retry === undefined
            ? `${platform}: ${describeError(reason ?? 'retrying')}`
            : `${platform}: retry ${attempt[1]}/${options.retry.maxAttempts} in ${attempt[2]} ms`,
        )
      }
    },
  })

  const ready = runner.start().then(
    () => undefined,
    (error: unknown) => {
      for (const adapter of adapters)
        fail(adapter.platform, `${adapter.platform}: start failed: ${describeError(error)}`)
    },
  )

  return {
    started,
    failed,
    ready,
    async stopAll() {
      stopping = true
      // A stopped platform is no longer started: a route that looks it up answers 503 (D7).
      started.clear()
      await runner
        .stop()
        .catch((error: unknown) => options.write(`stop failed: ${describeError(error)}`))
    },
  }
}
