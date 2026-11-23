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
 * The DNS-SD backend, supplied by the caller (for example a wrapper over `bonjour-service`).
 * `@theokit/host` ships none, so it takes no multicast dependency.
 */
export interface ServicePublisher {
  publish(service: PublishedService): void
  unpublishAll(): Promise<void>
  destroy(): Promise<void>
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
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      await bounded(() => publisher.unpublishAll(), STOP_STEP_BOUND_MS)
      await bounded(() => publisher.destroy(), STOP_STEP_BOUND_MS)
    })()
    return stopping
  }
  try {
    publisher.publish({ name, type: options.type, port: options.port, txt: { ...options.txt } })
  } catch (error) {
    // Release the publisher before reporting the failure.
    void stop()
    throw error
  }
  return { announced: true, name, stop }
}
