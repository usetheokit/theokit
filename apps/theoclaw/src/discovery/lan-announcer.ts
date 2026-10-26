import { hostname as osHostname } from 'node:os'

import { isLoopback } from '../control-plane/bind.js'
import type { ControlPlaneHandle } from '../control-plane/listener.js'
import { type DiscoveryMode, type PublisherFactory, type ServicePublisher, TheoClawDiscoveryError } from './publisher.js'

/** RFC 6763 § 4.1.1: an instance name is at most 63 UTF-8 bytes. */
const MAX_INSTANCE_NAME_BYTES = 63
/** How long one withdrawal step may wait for the library before the shutdown goes on without it. */
const STOP_STEP_BOUND_MS = 1000

export interface LanAnnouncement {
  /** Withdraw the service and release the publisher. Idempotent; never rejects and never hangs. */
  stop(): Promise<void>
}

export interface AnnounceOptions {
  readonly mode: DiscoveryMode
  readonly log: (line: string) => void
  /** Required, with no default: a test that forgot its fake must not reach a real socket (plan D2). */
  readonly createPublisher: PublisherFactory
  readonly hostname?: () => string
}

const NOTHING_ANNOUNCED: LanAnnouncement = { stop: () => Promise.resolve() }

/**
 * `TheoClaw on <host> port <port>`, with the host cut at its first dot (a naming choice: a browser
 * lists the short host name) and then shortened a code point at a time until the name fits 63
 * bytes. The port suffix is always kept, since it keeps two instances on one host apart (plan D4).
 */
export function serviceName(hostname: string, port: number): string {
  const host = Array.from(hostname.split('.')[0] ?? '')
  const name = (): string => `TheoClaw on ${host.join('')} port ${port}`
  while (Buffer.byteLength(name()) > MAX_INSTANCE_NAME_BYTES && host.length > 0) host.pop()
  return name()
}

function discoveryErrorOf(error: unknown, route: TheoClawDiscoveryError['route']): TheoClawDiscoveryError {
  return error instanceof TheoClawDiscoveryError ? error : new TheoClawDiscoveryError(error, route)
}

/** Run one withdrawal step, resolving once it settles or once the bound passes, whichever is first. */
async function bounded(step: () => Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  const settled = new Promise<void>((resolve, reject) => {
    step().then(resolve, reject)
  })
  try {
    await Promise.race([settled, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Publish `_theoclaw._tcp` for the socket the control plane already holds, reading its address and
 * port from the handle and never from the environment (FR-001). A loopback bind or
 * `THEOCLAW_MDNS=off` publishes nothing. Every discovery failure writes one line and stops the
 * publisher; the listener keeps serving (plan D3).
 */
export function announceOnLan(handle: Pick<ControlPlaneHandle, 'address'>, options: AnnounceOptions): LanAnnouncement {
  const { host, port } = handle.address()
  if (options.mode === 'off') {
    options.log('LAN discovery is off: THEOCLAW_MDNS=off')
    return NOTHING_ANNOUNCED
  }
  if (isLoopback(host)) {
    options.log(`LAN discovery is off: TheoClaw is bound to ${host}`)
    return NOTHING_ANNOUNCED
  }

  let publisher: ServicePublisher | undefined
  let failed = false
  let constructing = true
  let stopping: Promise<void> | undefined

  const fail = (error: TheoClawDiscoveryError): void => {
    if (failed) return
    failed = true
    options.log(
      `TheoClawDiscoveryError: LAN discovery stopped (${error.code}); TheoClaw keeps serving on ${host}:${port}`,
    )
    if (!constructing) void stop()
  }

  const withdraw = async (target: ServicePublisher): Promise<void> => {
    try {
      await bounded(() => target.unpublishAll(), STOP_STEP_BOUND_MS)
    } catch (error) {
      fail(discoveryErrorOf(error, 'send-respond'))
    }
    try {
      await bounded(() => target.destroy(), STOP_STEP_BOUND_MS)
    } catch (error) {
      fail(discoveryErrorOf(error, 'socket'))
    }
  }

  const stop = (): Promise<void> => {
    stopping ??= publisher === undefined ? Promise.resolve() : withdraw(publisher)
    return stopping
  }

  try {
    publisher = options.createPublisher({ onError: fail })
    // A publisher that reported a failure while it was being created is only released, never used.
    if (!failed) {
      const name = serviceName((options.hostname ?? osHostname)(), port)
      publisher.publish({ name, type: 'theoclaw', port, txt: { path: '/control' } })
      options.log(`LAN discovery: publishing "${name}" as _theoclaw._tcp`)
    }
  } catch (error) {
    fail(discoveryErrorOf(error, 'publish'))
  }
  constructing = false
  if (failed) void stop()
  return { stop }
}

/** Withdraw the service, then close the listener; the listener closes even if the withdrawal throws. */
export async function stopThenClose(
  announcement: LanAnnouncement,
  handle: Pick<ControlPlaneHandle, 'close'>,
): Promise<void> {
  try {
    await announcement.stop()
  } finally {
    await handle.close()
  }
}
