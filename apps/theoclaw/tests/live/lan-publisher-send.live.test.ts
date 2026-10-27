import { randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { createBonjourPublisher } from '../../src/discovery/bonjour-publisher.js'
import type { ServicePublisher, TheoClawDiscoveryError } from '../../src/discovery/publisher.js'
import { type MdnsSocket, openMdnsSocket, querySrv } from './support/mdns-client.js'

/**
 * AC-018 (B-513): a send failure while answering a query reaches the adapter's `errorCallback`
 * route, which the library's default would rethrow and crash the worker on. `ip: 255.255.255.255`
 * makes every send fail with EACCES (no SO_BROADCAST). It needs a query delivered by multicast
 * loopback, so it runs only with THEOCLAW_LIVE=1.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const DEADLINE_MS = 5000
const QUERY_POLL_MS = 250

let publisher: ServicePublisher | undefined
let socket: MdnsSocket | undefined
let poll: NodeJS.Timeout | undefined

afterEach(async () => {
  clearInterval(poll)
  await publisher?.destroy()
  await socket?.close()
  publisher = undefined
  socket = undefined
})

describe.skipIf(!LIVE)('the adapter on a host that cannot send', () => {
  it('a send failure while answering a query reaches onError and the process lives', async () => {
    const name = `send-route-${randomUUID()}`
    let timer: NodeJS.Timeout | undefined
    const answered = new Promise<TheoClawDiscoveryError>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no EACCES with route answer reached onError within ${DEADLINE_MS} ms`)),
        DEADLINE_MS,
      )
      publisher = createBonjourPublisher({
        ip: '255.255.255.255',
        // Failed announcements arrive as send-respond and probes as send-query; only the answer route counts.
        onError: (error) => {
          if (error.route === 'answer') resolve(error)
        },
      })
    })
    publisher?.publish({ name, type: 'theoclaw', port: 40000, txt: { path: '/control' } })
    socket = await openMdnsSocket()
    const opened = socket
    // The records exist only once the probe is over, so the query repeats until one is answered.
    poll = setInterval(() => querySrv(opened, `${name}._theoclaw._tcp.local`), QUERY_POLL_MS)

    try {
      const error = await answered
      expect(error.code).toBe('EACCES')
    } finally {
      clearInterval(poll)
      clearTimeout(timer)
    }
  })
})
