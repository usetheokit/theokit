import { describe, it, expect, vi } from 'vitest'
import { createNodeAdapter } from '../../src/bridge/runtime/node.js'

const SECRET = 'db password rejected for postgres://app@10.0.0.5/prod'

async function hit(onError?: (e: unknown) => void) {
  const h = createNodeAdapter().createServer(
    () => {
      throw new Error(SECRET)
    },
    onError ? { onError } : undefined,
  )
  await new Promise<void>((r) => h.listen(0, r))
  const port = h.address()!.port
  const res = await fetch(`http://127.0.0.1:${port}/`)
  const body = await res.text()
  await new Promise<void>((r) => h.close(r))
  return { status: res.status, body }
}

describe('node adapter 500 redaction', () => {
  it('does not send the thrown message to the client and passes it to onError', async () => {
    const onError = vi.fn()
    const { status, body } = await hit(onError)
    expect(status).toBe(500)
    expect(body).not.toContain('postgres')
    expect(JSON.parse(body)).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    })
    expect((onError.mock.calls[0]![0] as Error).message).toBe(SECRET)
  })

  it('logs to console.error without a hook and survives a throwing hook', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await hit()).body).not.toContain(SECRET)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    const r = await hit(() => {
      throw new Error('hook')
    })
    expect(r.status).toBe(500)
  })
})
