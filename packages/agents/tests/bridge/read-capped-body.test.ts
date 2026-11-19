import { describe, expect, it } from 'vitest'
import { BodyTooLargeError, readCappedBody } from '../../src/bridge/read-capped-body.js'

function request(source: UnderlyingDefaultSource<Uint8Array>): Request {
  return new Request('http://127.0.0.1/x', {
    method: 'POST',
    body: new ReadableStream<Uint8Array>(source),
    duplex: 'half',
  } as RequestInit)
}

const big = (): Uint8Array => new Uint8Array(32).fill(1)

describe('readCappedBody cancellation', () => {
  it('throws BodyTooLargeError when cancel rejects', async () => {
    const req = request({
      pull: (c) => c.enqueue(big()),
      cancel: () => Promise.reject(new Error('cancel failed')),
    })
    await expect(readCappedBody(req, 16)).rejects.toBeInstanceOf(BodyTooLargeError)
  })

  it('throws BodyTooLargeError when cancel never settles', async () => {
    const req = request({
      pull: (c) => c.enqueue(big()),
      cancel: () => new Promise<void>(() => undefined),
    })
    await expect(readCappedBody(req, 16)).rejects.toBeInstanceOf(BodyTooLargeError)
  })

  it('still propagates a genuine read error', async () => {
    const req = request({ pull: (c) => c.error(new Error('broken')) })
    await expect(readCappedBody(req, 16)).rejects.toThrow('broken')
  })
})
