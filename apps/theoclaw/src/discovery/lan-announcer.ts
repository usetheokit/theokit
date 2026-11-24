import { hostname as osHostname } from 'node:os'

import { announceService, DiscoveryError, trimServiceName } from '@theokit/host/discovery'

import { isLoopback } from '../control-plane/bind.js'
import type { ControlPlaneHandle } from '../control-plane/listener.js'
import { type DiscoveryMode, type PublisherFactory, type ServicePublisher, TheoClawDiscoveryError } from './publisher.js'

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
  while (trimServiceName(name()) !== name() && host.length > 0) host.pop()
  return name()
}

function discoveryErrorOf(error: unknown, route: TheoClawDiscoveryError['route']): TheoClawDiscoveryError {
  if (error instanceof TheoClawDiscoveryError) return error
  if (error instanceof DiscoveryError) return new TheoClawDiscoveryError(error.cause, error.route)
  return new TheoClawDiscoveryError(error, route)
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

  let announcement: LanAnnouncement | undefined
  let failed = false

  const fail = (error: TheoClawDiscoveryError): void => {
    if (failed) return
    failed = true
    options.log(
      `TheoClawDiscoveryError: LAN discovery stopped (${error.code}); TheoClaw keeps serving on ${host}:${port}`,
    )
    // Before the announcement exists, the code below stops it once it does.
    if (announcement !== undefined) void announcement.stop()
  }

  // Reports a withdrawal failure, then rethrows it: announceService bounds and swallows the step.
  const guarded = (inner: ServicePublisher): ServicePublisher => ({
    // A publisher that reported a failure while it was being created is only released, never used.
    publish: (service) => {
      if (!failed) inner.publish(service)
    },
    unpublishAll: () =>
      inner.unpublishAll().catch((error: unknown) => {
        fail(discoveryErrorOf(error, 'send-respond'))
        throw error
      }),
    destroy: () =>
      inner.destroy().catch((error: unknown) => {
        fail(discoveryErrorOf(error, 'socket'))
        throw error
      }),
  })

  try {
    const publisher = guarded(options.createPublisher({ onError: fail }))
    const name = serviceName((options.hostname ?? osHostname)(), port)
    announcement = announceService({ type: 'theoclaw', name, port, txt: { path: '/control' }, host, publisher })
    if (!failed) options.log(`LAN discovery: publishing "${name}" as _theoclaw._tcp`)
  } catch (error) {
    fail(discoveryErrorOf(error, 'publish'))
  }
  if (failed) void announcement?.stop()
  return announcement ?? NOTHING_ANNOUNCED
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
