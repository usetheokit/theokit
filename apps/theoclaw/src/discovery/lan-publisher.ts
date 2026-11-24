import { createBonjourPublisher as createHostBonjourPublisher } from '@theokit/host/discovery-bonjour'

import { type ServicePublisher, TheoClawDiscoveryError } from './publisher.js'

export interface BonjourPublisherOptions {
  onError(error: TheoClawDiscoveryError): void
  /** The interface the multicast socket binds; only the adapter's own tests set it. */
  readonly interface?: string
  /** The address packets are sent to; only the adapter's own tests set it. */
  readonly ip?: string
}

/** The shared `@theokit/host` adapter, with its errors reported as `TheoClawDiscoveryError`. */
export function createBonjourPublisher(options: BonjourPublisherOptions): ServicePublisher {
  const { onError, ...rest } = options
  return createHostBonjourPublisher({
    ...rest,
    onError: (error) => onError(new TheoClawDiscoveryError(error.cause, error.route)),
  })
}
