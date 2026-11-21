import { describe, expect, it } from 'vitest'
import { BodyTooLargeError, readCappedBody } from '../../src/bridge/read-capped-body.js'

function oversized(cancel: () => Promise<void>): Request {
  const chunk = new Uint8Array(64).fill(0x78)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk)
    },
    cancel,
  })
  return new Request('http://127.0.0.1/x', { method: 'POST', body, duplex: 'half' } as RequestInit)
}

describe('readCappedBody cancellation', () => {
  it('throws BodyTooLargeError when cancelling the body rejects', async () => {
    let cancelled = false
    const request = oversized(() => {
      cancelled = true
      return Promise.reject(new Error('cancel failed'))
    })
    await expect(readCappedBody(request, 100)).rejects.toBeInstanceOf(BodyTooLargeError)
    expect(cancelled).toBe(true)
  })

  it('throws BodyTooLargeError without waiting on a cancel that never settles', async () => {
    let cancelled = false
    const request = oversized(() => {
      cancelled = true
      return new Promise<void>(() => {})
    })
    await expect(readCappedBody(request, 100)).rejects.toBeInstanceOf(BodyTooLargeError)
    expect(cancelled).toBe(true)
  }, 2000)
})
