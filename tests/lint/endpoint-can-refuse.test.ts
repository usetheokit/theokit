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

/**
 * A loopback server whose answer depends on the request, the way a real collector's does.
 *
 * `listening` answers one status to every method and every path, which leaves the guard's own
 * semantics unpinned: mutate `POST` to `GET`, or the absent path to the ingest path, and every
 * case stays green. This helper is what makes those mutants die.
 */
async function discriminating(
  reply: (req: { method: string; path: string; bodyLength: number }) => number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let bodyLength = 0
    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length
    })
    req.on('end', () => {
      res.writeHead(reply({ method: req.method ?? '', path: req.url ?? '', bodyLength }))
      res.end()
    })
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

  // The guard must probe with the SAME method the probe will use to deliver the span. Against a
  // receiver that accepts any POST and 404s a GET, mutating `POST` to `GET` made the guard return
  // true — approving exactly the receiver it exists to reject. Measured: original false, mutant
  // true. It is the only surviving mutant that failed OPEN; the others over-refuse, which is safe.
  it('refuses a receiver that accepts any POST, even when it would 404 a GET', async () => {
    const server = await discriminating(({ method }) => (method === 'POST' ? 200 : 404))
    try {
      expect(await endpointCanRefuse(server.url)).toBe(false)
    } finally {
      await server.close()
    }
  })

  // The guard must probe a path the collector does NOT serve. Against a receiver that serves
  // `/v1/traces` and 404s everything else — the shape of a correctly-behaving collector — probing
  // the ingest path instead would read 200 and refuse to measure a receiver that is in fact fine.
  // This is what kills a mutant that drops the pathname rewrite, or points it at the ingest path.
  it('probes a path the collector does not serve, not the ingest path', async () => {
    const server = await discriminating(({ path }) => (path === '/v1/traces' ? 200 : 404))
    try {
      expect(await endpointCanRefuse(server.url)).toBe(true)
    } finally {
      await server.close()
    }
  })

  // The guard must send a body. Against a permissive receiver that validates one — 200 to a POST
  // carrying content, 400 to an empty POST — dropping the body made the guard read 400 and APPROVE
  // the very receiver it exists to reject. Measured here by execution: original false, mutant true.
  // An audit of this file classified that mutant as failing toward over-refusal; it does not.
  it('sends a body, so a receiver that validates one is still seen as permissive', async () => {
    const server = await discriminating(({ bodyLength }) => (bodyLength > 0 ? 200 : 400))
    try {
      expect(await endpointCanRefuse(server.url)).toBe(false)
    } finally {
      await server.close()
    }
  })
})
