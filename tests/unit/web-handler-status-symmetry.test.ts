/**
 * routes-framework-contract T1.4 — Web runner honors `config.status` for
 * plain-object returns, matching the Node runner (ADR D3 — status asymmetry fix).
 *
 * Before this change, `toResponse` hardcoded 200 for plain objects while the
 * Node runner honored `rc.status ?? 200` (execute.ts). A `status: 201` plain
 * object would 200 under the Web runtime — the divergence the `response` slot
 * would amplify.
 */
import { describe, it, expect } from 'vitest'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

function req(): Request {
  return new Request('http://localhost/api/test', { method: 'GET' })
}

describe('Web runner — config.status symmetry for plain-object returns (T1.4)', () => {
  it('honors config.status:201 for a plain-object return', async () => {
    const route = { GET: defineRoute({ status: 201, handler: () => ({ created: true }) }) }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ created: true })
  })

  it('defaults to 200 when no config.status is set', async () => {
    const route = { GET: defineRoute({ handler: () => ({ ok: true }) }) }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(200)
  })

  it('keeps the 204 branch for an undefined return regardless of config.status', async () => {
    const route = { GET: defineRoute({ status: 201, handler: () => undefined }) }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(204)
  })
})
