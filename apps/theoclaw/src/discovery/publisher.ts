import { DiscoveryError, type DiscoveryErrorRoute, type ServicePublisher } from '@theokit/host/discovery'

import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * The port between the LAN announcer and the library that speaks DNS-SD (plan D2). This file
 * imports no library and no UDP module: the announcer is tested against a fake that opens no
 * socket, and `lan-publisher.ts` wraps the one adapter, `@theokit/host/discovery-bonjour`.
 */

export type { PublishedService, ServicePublisher } from '@theokit/host/discovery'

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
