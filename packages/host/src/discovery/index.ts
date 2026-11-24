import { isIPv4 } from 'node:net'

/** RFC 6763 § 4.1.1: an instance name is at most 63 UTF-8 bytes. */
const MAX_NAME_BYTES = 63
/** How long one shutdown step may wait on the publisher before stop() goes on without it. */
const STOP_STEP_BOUND_MS = 1000

/** What a publisher is asked to announce. */
export interface PublishedService {
  readonly name: string
  readonly type: string
  readonly port: number
  readonly txt: Readonly<Record<string, string>>
}

/**
 * The DNS-SD backend, supplied by the caller. `@theokit/host` takes no multicast dependency;
 * `@theokit/host/discovery-bonjour` is an optional adapter over `bonjour-service`.
 */
export interface ServicePublisher {
  publish(service: PublishedService): void
  unpublishAll(): Promise<void>
  destroy(): Promise<void>
  /**
   * Optional. Subscribe to errors the backend raises after `publish` returned. Returns an
   * unsubscribe function. `announceService` subscribes before publishing when this exists.
   */
  onError?(listener: (error: unknown) => void): () => void
}

/** Which path delivered a library error. */
export type DiscoveryErrorRoute = 'socket' | 'answer' | 'send-respond' | 'send-query' | 'publish'

function codeOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }
    if (typeof code === 'string' && code !== '') return code
  }
  return 'UNKNOWN'
}

/** A DNS-SD failure; `code` is the cause's string `code` or `UNKNOWN`. */
export class DiscoveryError extends Error {
  readonly code: string
  readonly route: DiscoveryErrorRoute

  constructor(cause: unknown, route: DiscoveryErrorRoute) {
    const code = codeOf(cause)
    super(`LAN discovery failed: ${code} (${route})`, { cause })
    this.name = 'DiscoveryError'
    this.code = code
    this.route = route
  }
}

export interface AnnounceServiceOptions {
  /** Service type without the `_` and protocol, e.g. `theoclaw` for `_theoclaw._tcp`. */
  readonly type: string
  readonly name: string
  readonly port: number
  readonly txt?: Readonly<Record<string, string>>
  /** The address the service is bound to. A loopback host announces nothing. */
  readonly host: string
  readonly publisher: ServicePublisher
  /**
   * Called once, for the first failure the publisher reports after `publish` (needs a publisher
   * with `onError`). The announcement is stopped first. Never throws out of the callback's caller.
   */
  readonly onError?: (error: unknown) => void
}

export interface ServiceAnnouncement {
  /** False when nothing was announced (a loopback bind); `reason` says why. */
  readonly announced: boolean
  readonly reason?: 'loopback'
  /** The name actually published, after trimming. */
  readonly name?: string
  /** Withdraw the service and release the publisher. Idempotent; never rejects; bounded. */
  stop(): Promise<void>
}

/** `localhost`, `::1` and the IPv4 block 127.0.0.0/8. */
export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  return isIPv4(host) && host.startsWith('127.')
}

/** Trim `name` to at most 63 UTF-8 bytes, cutting on a character (code point) boundary. */
export function trimServiceName(name: string): string {
  const chars = Array.from(name)
  while (chars.length > 0 && Buffer.byteLength(chars.join('')) > MAX_NAME_BYTES) chars.pop()
  return chars.join('')
}

async function bounded(step: () => Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.resolve().then(step),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      }),
    ])
  } catch {
    // A failing step must not stop the next one.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Announce a service on the local network through the injected publisher. A loopback `host`
 * announces nothing and the result says so. The publisher is created by the caller, so this
 * cannot stop its construction, only its use.
 */
export function announceService(options: AnnounceServiceOptions): ServiceAnnouncement {
  const { publisher, host } = options
  if (isLoopbackHost(host)) {
    return { announced: false, reason: 'loopback', stop: () => Promise.resolve() }
  }
  const name = trimServiceName(options.name)
  let stopping: Promise<void> | undefined
  let unsubscribe: (() => void) | undefined
  const stop = (): Promise<void> => {
    unsubscribe?.()
    stopping ??= (async () => {
      await bounded(() => publisher.unpublishAll(), STOP_STEP_BOUND_MS)
      await bounded(() => publisher.destroy(), STOP_STEP_BOUND_MS)
    })()
    return stopping
  }
  let failed = false
  const fail = (error: unknown): void => {
    if (failed) return
    failed = true
    unsubscribe?.()
    void stop().then(() => {
      try {
        options.onError?.(error)
      } catch (thrown) {
        process.emitWarning(
          `announceService onError threw: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        )
      }
    })
  }
  try {
    unsubscribe = publisher.onError?.(fail)
    publisher.publish({ name, type: options.type, port: options.port, txt: { ...options.txt } })
  } catch (error) {
    // Release the publisher before reporting the failure.
    unsubscribe?.()
    void stop()
    throw error
  }
  return { announced: true, name, stop }
}
