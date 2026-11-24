import { DiscoveryError, type DiscoveryErrorRoute } from '@theokit/host/discovery'

import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * The port between the LAN announcer and the library that speaks DNS-SD (plan D2). This file
 * imports no library and no UDP module: the announcer is tested against a fake that opens no
 * socket, and `lan-publisher.ts` wraps the one adapter, `@theokit/host/discovery-bonjour`.
 */

/** The one DNS-SD service TheoClaw publishes: `_theoclaw._tcp` with the bound port. */
export interface PublishedService {
  readonly name: string
  readonly type: 'theoclaw'
  readonly port: number
  /** Exactly the control path; no token and no setting value ever reaches the TXT record (NFR-003). */
  readonly txt: { readonly path: '/control' }
}

export interface ServicePublisher {
  publish(service: PublishedService): void
  /** Withdraw every published service (goodbye records); rejects when the goodbye send fails. */
  unpublishAll(): Promise<void>
  /** Close the library's socket. */
  destroy(): Promise<void>
}

export type PublisherFactory = (options: { onError(error: TheoClawDiscoveryError): void }) => ServicePublisher

export type { DiscoveryErrorRoute }

/** A LAN discovery failure. Discovery stops and TheoClaw keeps serving on its listener (plan D3). */
export class TheoClawDiscoveryError extends DiscoveryError {
  constructor(cause: unknown, route: DiscoveryErrorRoute) {
    super(cause, route)
    this.name = 'TheoClawDiscoveryError'
  }
}

export type DiscoveryMode = 'on' | 'off'

/**
 * `THEOCLAW_MDNS`, trimmed: unset, empty or `on` announces, `off` does not, anything else stops the
 * start. Case-sensitive, so `ON` is refused like B-372's `YES`. The message never carries the value.
 */
export function parseDiscoveryMode(env: Readonly<Record<string, string | undefined>>): DiscoveryMode {
  const value = (env.THEOCLAW_MDNS ?? '').trim()
  if (value === '' || value === 'on') return 'on'
  if (value === 'off') return 'off'
  throw new TheoClawConfigError('THEOCLAW_MDNS must be on or off', { variable: 'THEOCLAW_MDNS' })
}
