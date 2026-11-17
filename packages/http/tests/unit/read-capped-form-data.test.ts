import { describe, expect, it } from 'vitest'

import {
  BadRequestException,
  PayloadTooLargeException,
  readCappedFormData,
} from '../../src/index.js'

function streamOf(chunks: Uint8Array[]) {
  const state = { pulls: 0, cancelled: false }
  let i = 0
  // highWaterMark 0: the stream pulls only when a reader asks, never on construction.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++
        const next = chunks[i++]
        if (next) controller.enqueue(next)
        else controller.close()
      },
      cancel() {
        state.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, state }
}

function streamRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request('http://x.test/up', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit)
}

describe('readCappedFormData', () => {
  it('returns the form with the original file bytes and filename under the cap', async () => {
    const fd = new FormData()
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 9])
    fd.set('file', new File([bytes], 'a.bin', { type: 'application/octet-stream' }))
    fd.set('note', 'hi')
    const req = new Request('http://x.test/up', { method: 'POST', body: fd })
    const out = await readCappedFormData(req, { maxBytes: 10_000 })
    const file = out.get('file') as File
    expect(file.name).toBe('a.bin')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(out.get('note')).toBe('hi')
  })

  it('reads urlencoded bodies', async () => {
    const req = new Request('http://x.test/up', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
    })
    const out = await readCappedFormData(req, { maxBytes: 100 })
    expect(out.get('b')).toBe('2')
  })

  it('refuses a streamed body over the cap with no Content-Length and cancels the source', async () => {
    const chunk = new Uint8Array(100)
    const { stream, state } = streamOf(Array.from({ length: 50 }, () => chunk))
    const req = streamRequest(stream, { 'content-type': 'multipart/form-data; boundary=x' })
    const err = await readCappedFormData(req, { maxBytes: 250 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PayloadTooLargeException)
    expect((err as PayloadTooLargeException).statusCode).toBe(413)
    expect((err as Error).message).toContain('250')
    expect((err as Error).message).toContain('300')
    await new Promise((r) => setTimeout(r, 10))
    expect(state.cancelled).toBe(true)
    expect(state.pulls).toBeLessThan(10)
  })

  it('refuses a declared Content-Length over the cap before any read', async () => {
    const { stream, state } = streamOf([new Uint8Array(10)])
    const req = streamRequest(stream, {
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': '5000',
    })
    await expect(readCappedFormData(req, { maxBytes: 100 })).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    )
    expect(state.pulls).toBe(0)
  })

  it('rejects a text/plain body with 400', async () => {
    const req = new Request('http://x.test/up', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    })
    const err = await readCappedFormData(req, { maxBytes: 100 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BadRequestException)
    expect((err as BadRequestException).statusCode).toBe(400)
  })

  it('rejects a malformed multipart body with 400', async () => {
    const req = new Request('http://x.test/up', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: 'not multipart at all',
    })
    await expect(readCappedFormData(req, { maxBytes: 1000 })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects an invalid maxBytes', async () => {
    const req = new Request('http://x.test/up', { method: 'POST', body: new FormData() })
    await expect(readCappedFormData(req, { maxBytes: Number.NaN })).rejects.toThrow(TypeError)
  })
})
