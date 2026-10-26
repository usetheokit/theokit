import { afterEach, describe, expect, it } from 'vitest'

import { createBonjourPublisher } from '../src/discovery/bonjour-publisher.js'
import type { ServicePublisher, TheoClawDiscoveryError } from '../src/discovery/publisher.js'

/** An address reserved for documentation (RFC 5737): no host owns it, so binding it fails. */
const UNOWNED_INTERFACE = '192.0.2.1'
const DEADLINE_MS = 5000

let publisher: ServicePublisher | undefined

afterEach(async () => {
  await publisher?.destroy()
  publisher = undefined
})

/** FR-006 (B-513): the real library's bind error reaches onError instead of Node's unhandled path. */
describe('createBonjourPublisher', () => {
  it('a bind failure of the real library reaches onError and the process lives', async () => {
    let timer: NodeJS.Timeout | undefined
    const reported = new Promise<TheoClawDiscoveryError>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no EADDRNOTAVAIL reached onError within ${DEADLINE_MS} ms`)),
        DEADLINE_MS,
      )
      publisher = createBonjourPublisher({ interface: UNOWNED_INTERFACE, onError: resolve })
    })

    try {
      const error = await reported
      expect(error.name).toBe('TheoClawDiscoveryError')
      expect(error.code).toBe('EADDRNOTAVAIL')
      expect(error.route).toBe('socket')
    } finally {
      clearTimeout(timer)
    }
  })
})
