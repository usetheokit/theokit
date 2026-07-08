/**
 * M33 Phase 1 — WIRING: the in-process caller and the HTTP path share ONE validation pipeline and
 * produce the SAME result from the same `RouteConfig`. Proves `callProcedure` is not a second,
 * divergent execution path (the risk the plan flagged).
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { route } from '../../packages/theo/src/server/define/index.js'
import { callProcedure } from '../../packages/theo/src/server/http/in-process-caller.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

describe('in-process caller ↔ HTTP path parity (M33)', () => {
  const config = route()
    .body(z.object({ title: z.string(), n: z.number() }))
    .handler(({ body }) => ({ echoed: body.title, doubled: body.n * 2 }))
    .build()

  it('HTTP and in-process produce the same result for valid input', async () => {
    // In-process: structured input, no Request synthesized by the author.
    const viaCaller = await callProcedure(config, { body: { title: 'hi', n: 21 } })

    // HTTP: same config, driven through executeWebRequest with a real Request (csrf off for the test).
    const request = new Request('http://x/api/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hi', n: 21 }),
    })
    const res = await executeWebRequest(request, { POST: config }, { csrfMode: 'off' })
    const viaHttp = await res.json()

    expect(viaCaller).toEqual({ echoed: 'hi', doubled: 42 })
    expect(viaHttp).toEqual(viaCaller)
  })

  it('both reject the same invalid body via the shared Zod pipeline', async () => {
    // In-process throws ProcedureInputError.
    await expect(
      callProcedure(config, { body: { title: 'hi', n: 'nope' as unknown as number } }),
    ).rejects.toThrow()

    // HTTP returns 400 for the same invalid body.
    const request = new Request('http://x/api/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hi', n: 'nope' }),
    })
    const res = await executeWebRequest(request, { POST: config }, { csrfMode: 'off' })
    expect(res.status).toBe(400)
  })
})
