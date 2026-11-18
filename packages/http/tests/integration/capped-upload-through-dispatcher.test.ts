import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import { Controller, Post, Req, readCappedFormData } from '../../src/index.js'
import { createDecoratorHandler } from '../../src/bridge/create-server.js'
import { Public } from '../../src/decorators/public.js'
import { PayloadTooLargeException } from '../../src/exceptions/index.js'

// Decorator tests need SWC via vitest (same as create-decorator-handler.test.ts).
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

@Public()
@Controller('api/upload')
class UploadCtrl {
  @Post()
  async upload(@Req() request: Request) {
    try {
      const form = await readCappedFormData(request, { maxBytes: 250 })
      return { keys: [...form.keys()] }
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        return new Response(JSON.stringify({ code: error.code }), { status: error.statusCode })
      }
      throw error
    }
  }
}

describe.skipIf(!isVitest)('an upload controller behind the dispatcher', () => {
  it('cancels an oversized streamed upload without pulling the whole body', async () => {
    const state = { pulls: 0, cancelled: false }
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          state.pulls++
          if (state.pulls > 50) controller.close()
          else controller.enqueue(new Uint8Array(100))
        },
        cancel() {
          state.cancelled = true
        },
      },
      { highWaterMark: 0 },
    )
    const handle = createDecoratorHandler([UploadCtrl])
    const res = await handle(
      new Request('http://x/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    )
    expect(res).not.toBeNull()
    if (!res) throw new Error('expected a response')
    expect(res.status).toBe(413)
    await new Promise((r) => setTimeout(r, 10))
    expect(state.cancelled).toBe(true)
    expect(state.pulls).toBeLessThan(10)
  })

  it('hands a urlencoded body to the handler unread', async () => {
    const handle = createDecoratorHandler([UploadCtrl])
    const res = await handle(
      new Request('http://x/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1&b=2',
      }),
    )
    expect(await res?.json()).toEqual({ keys: ['a', 'b'] })
  })
})
