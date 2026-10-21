import { GatewayRunner, redactSecrets } from '@theokit/gateway'
import type { BasePlatformAdapter, GatewayHandler, PlatformName } from '@theokit/gateway'

/** One platform the loop may start: building the adapter can throw, and only fails that platform. */
export interface PlatformBuild {
  readonly platform: PlatformName
  build(): BasePlatformAdapter
}

export interface ChannelLoopOptions {
  readonly platforms: readonly PlatformBuild[]
  readonly handler: GatewayHandler
  /** Every configured credential value; none of them is ever written (D9). */
  readonly secrets: readonly string[]
  readonly write: (line: string) => void
  /** How long one platform may take to connect before it is abandoned. Default 30 000 ms. */
  readonly startTimeoutMs?: number
}

/** A platform whose runner connected: the routes deliver to `adapter`, shutdown stops `runner`. */
export interface StartedPlatform {
  readonly adapter: BasePlatformAdapter
  readonly runner: GatewayRunner
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
const MASK = '[redacted]'

/** Replace every occurrence of every value with `[redacted]`, longest first, so a value containing another is masked whole. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, secret) => masked.split(secret).join(MASK), text)
}

type StartOutcome =
  | { readonly kind: 'connected' }
  | { readonly kind: 'rejected'; readonly error: unknown }
  | { readonly kind: 'timed_out' }

/** Race a start against the timeout; the timer is cleared as soon as the start settles. */
function settleWithin(start: Promise<unknown>, timeoutMs: number): Promise<StartOutcome> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<StartOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs)
  })
  const settled = start.then(
    (): StartOutcome => ({ kind: 'connected' }),
    (error: unknown): StartOutcome => ({ kind: 'rejected', error }),
  )
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Start one `GatewayRunner` per platform, each on its own, so one platform that cannot connect
 * silences only itself (D1). Returns at once; `ready` settles when every start has.
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
    failed.push(platform)
    options.write(line)
  }
  const stopQuietly = (platform: PlatformName, runner: GatewayRunner): Promise<void> =>
    runner.stop().catch((error: unknown) => options.write(`${platform}: stop failed: ${describeError(error)}`))

  const startOne = async ({ platform, build }: PlatformBuild): Promise<void> => {
    let adapter: BasePlatformAdapter
    let runner: GatewayRunner
    try {
      adapter = build()
      runner = new GatewayRunner({ adapters: [adapter], handler: options.handler })
    } catch (error) {
      fail(platform, `${platform}: start failed: ${describeError(error)}`)
      return
    }
    const start = runner.start()
    const outcome = await settleWithin(start, timeoutMs)
    if (outcome.kind === 'timed_out') {
      fail(platform, `${platform}: start timed out after ${timeoutMs} ms`)
      // Abandoned: if it connects later, stop it, so nothing stays connected unseen.
      void start.then(
        () => stopQuietly(platform, runner),
        (error: unknown) =>
          options.write(`${platform}: abandoned start failed: ${describeError(error)}`),
      )
      return
    }
    if (outcome.kind === 'rejected') {
      fail(platform, `${platform}: start failed: ${describeError(outcome.error)}`)
      return
    }
    if (stopping) {
      await stopQuietly(platform, runner)
      return
    }
    started.set(platform, { adapter, runner })
  }

  const ready = Promise.allSettled(options.platforms.map(startOne)).then(() => undefined)

  return {
    started,
    failed,
    ready,
    async stopAll() {
      stopping = true
      const toStop = [...started]
      // A stopped platform is no longer started: a route that looks it up answers 503 (D7).
      started.clear()
      await Promise.all(toStop.map(([platform, { runner }]) => stopQuietly(platform, runner)))
    },
  }
}
