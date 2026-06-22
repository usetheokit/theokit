/**
 * M7-1 — typed errors / 404 on the convention server's legacy Node path.
 *
 * The legacy `handleRequestError` must mirror `handleWebRequestError`: a thrown
 * `TheoError` yields its envelope code + the mapped HTTP status, an unknown
 * value coerces to 500, and `NotFoundError` maps to 404. The typed-error
 * primitives are reachable from the public `theokit/server/http` barrel.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'

import {
  envelopeCodeToStatus,
  handleRequestError,
  NotFoundError,
  serverErrorToEnvelope,
  TheoError,
} from '../../packages/theo/src/server/http/index.js'

interface CapturedResponse {
  status: number | undefined
  body: unknown
  res: ServerResponse
}

function mockRes(): CapturedResponse {
  const captured: CapturedResponse = { status: undefined, body: undefined, res: undefined as never }
  const res = {
    writableEnded: false,
    writeHead(status: number) {
      captured.status = status
      return res
    },
    end(body?: string) {
      if (body !== undefined) {
        captured.body = JSON.parse(body)
      }
      ;(res as { writableEnded: boolean }).writableEnded = true
      return res
    },
  }
  captured.res = res as unknown as ServerResponse
  return captured
}

function ctx(cap: CapturedResponse) {
  return {
    req: {} as IncomingMessage,
    res: cap.res,
    requestId: 'req-1',
    pluginRunner: undefined,
    buildPluginCtx: () => ({}) as never,
  }
}

describe('M7-1 handleRequestError (legacy Node path) — typed envelopes', () => {
  it('emits the typed envelope code + mapped status for a TheoError', async () => {
    const cap = mockRes()
    await handleRequestError(new TheoError({ code: 'FORBIDDEN', message: 'nope' }), ctx(cap))
    expect(cap.status).toBe(403)
    expect((cap.body as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect((cap.body as { error: { message: string } }).error.message).toBe('nope')
  })

  it('maps NotFoundError to 404 with code NOT_FOUND', async () => {
    const cap = mockRes()
    await handleRequestError(new NotFoundError('missing'), ctx(cap))
    expect(cap.status).toBe(404)
    expect((cap.body as { error: { code: string } }).error.code).toBe('NOT_FOUND')
  })

  it('coerces an unknown thrown value to a 500 (legacy INTERNAL_ERROR preserved)', async () => {
    // Untyped errors keep the battle-tested legacy code + masking path; only
    // typed TheoErrors get the new envelope code (M7-1 backward-compat).
    const cap = mockRes()
    await handleRequestError('boom-string', ctx(cap))
    expect(cap.status).toBe(500)
    const body = cap.body as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('NotFoundError envelope maps to 404 via the public primitives', () => {
    const env = serverErrorToEnvelope(new NotFoundError())
    expect(env.code).toBe('NOT_FOUND')
    expect(envelopeCodeToStatus(env.code)).toBe(404)
  })
})
