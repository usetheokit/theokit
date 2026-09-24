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
})
