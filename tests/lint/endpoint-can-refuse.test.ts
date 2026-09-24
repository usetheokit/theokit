/**
 * The probe's own control, under test.
 *
 * `scripts/probe-otlp-delivery.ts` refuses to report a delivery unless the endpoint has first
 * demonstrated it can REFUSE one. Until this file existed nothing could tell whether that guard
 * worked: its failure branch is `return false`, the safe direction, so a broken guard would have
 * turned "could not measure" into "clean" with no signal.
 *
 * Three cases, three branches: permissive, refusing, unreachable. Each drives a real loopback
 * server and asserts the guard's decision — never the OTLP transport, which is a different claim.
 */
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { endpointCanRefuse } from '../../scripts/lib/endpoint-can-refuse.js'

/** A loopback server answering `status` to every path, on an OS-assigned port. */
async function listening(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(status)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port assigned')
  return {
    url: `http://127.0.0.1:${String(address.port)}/v1/traces`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('endpointCanRefuse', () => {
  it('refuses a receiver that answers 2xx on a path it does not serve', async () => {
    const server = await listening(200)
    try {
      expect(await endpointCanRefuse(server.url)).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('accepts a receiver that answers 4xx on an absent path', async () => {
    const server = await listening(404)
    try {
      expect(await endpointCanRefuse(server.url)).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('refuses when the request throws', async () => {
    expect(await endpointCanRefuse('http://127.0.0.1:1/v1/traces')).toBe(false)
  })

  // 400 is the status the guard's own comparison turns on, and it is the likely reply when a
  // collector receives `POST {}` where protobuf is expected. Without this case `> 400` and
  // `>= 401` both survive the suite — measured, 0 of 3 red — so the one boundary the guard
  // exists to draw was the one nothing pinned.
  it('accepts a receiver that answers exactly 400, the boundary it turns on', async () => {
    const server = await listening(400)
    try {
      expect(await endpointCanRefuse(server.url)).toBe(true)
    } finally {
      await server.close()
    }
  })

  // `new URL` sat outside the try, so a missing scheme threw out of the function and the probe
  // exited 1 with a stack instead of the designed exit 2 "NOT MEASURED". A caller keying on 2
  // could not tell "could not measure" from "crashed".
  it.each(['127.0.0.1:4318/v1/traces', '', '/v1/traces', 'not a url'])(
    'refuses an unparseable ingest rather than throwing: %j',
    async (ingest) => {
      expect(await endpointCanRefuse(ingest)).toBe(false)
    },
  )
})
