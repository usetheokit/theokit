/**
 * M33 Phase 1 — the in-process typed caller (`callProcedure`).
 *
 * The load-bearing seam for non-HTTP surfaces (TUI / Tauri / MCP): invoke a route's shared logic
 * with STRUCTURED input, WITHOUT synthesizing a full HTTP Request or going through the middleware
 * chain — validated by the SAME Zod schemas the HTTP path uses (one validation pipeline), returning
 * the raw result (not a Response) and throwing a typed error (not a 400) on invalid input.
 * Prior art: tRPC `callProcedure`/`createCallerFactory` (references/trpc/…router.ts:401,441).
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { route } from '../../packages/theo/src/server/define/index.js'
import {
  callProcedure,
  ProcedureInputError,
} from '../../packages/theo/src/server/http/in-process-caller.js'

describe('callProcedure — in-process typed caller (M33)', () => {
  it('runs a route handler with structured input, no HTTP Request synthesized by the author', async () => {
    const config = route()
      .body(z.object({ title: z.string(), n: z.number() }))
      .handler(({ body }) => ({ echoed: body.title, doubled: body.n * 2 }))
      .build()

    const result = await callProcedure(config, { body: { title: 'hi', n: 21 } })
    expect(result).toEqual({ echoed: 'hi', doubled: 42 })
  })

  it('validates query/body/params via the same Zod schemas; throws ProcedureInputError on bad input', async () => {
    const config = route()
      .params(z.object({ id: z.string() }))
      .handler(({ params }) => ({ id: params.id }))
      .build()

    await expect(
      callProcedure(config, { params: { id: 123 as unknown as string } }),
    ).rejects.toBeInstanceOf(ProcedureInputError)
  })

  it('forwards the ctx to the handler (typed request context)', async () => {
    const config = route()
      .handler(({ ctx }) => ({ user: (ctx as { user?: string }).user }))
      .build()
    const result = await callProcedure(config, {}, { user: 'ada' })
    expect(result).toEqual({ user: 'ada' })
  })

  it('validates the handler output against config.response (server-fault → throws)', async () => {
    const config = route()
      .response(z.object({ ok: z.boolean() }))
      // handler returns a drifting shape on purpose
      .handler(() => ({ ok: 'not-a-boolean' }) as unknown as { ok: boolean })
      .build()
    await expect(callProcedure(config, {})).rejects.toThrow()
  })

  it('a channel with no declared schema passes the raw input through', async () => {
    const config = route()
      .handler(({ body }) => ({ received: body }))
      .build()
    const result = await callProcedure(config, { body: { anything: true } })
    expect(result).toEqual({ received: { anything: true } })
  })
})
