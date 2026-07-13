import 'reflect-metadata'

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { Controller, Get, Post, Body, Param } from '../../src/index.js'
import { createDecoratorHandler } from '../../src/bridge/create-server.js'

// Bun lacks emitDecoratorMetadata (same as esbuild); decorator tests need SWC via vitest.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

const zCreate = z.object({ title: z.string().min(3) })

@Controller('api/v2/things')
class ThingsCtrl {
  @Get(':id')
  findById(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return body
  }
}

describe.skipIf(!isVitest)('createDecoratorHandler', () => {
  const handle = createDecoratorHandler([ThingsCtrl])

  it('is a pure Web-Standard handler that dispatches POST with @Body (201)', async () => {
    const res = await handle(
      new Request('http://x/api/v2/things', {
        method: 'POST',
        body: JSON.stringify({ title: 'hello' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(201)
    expect(await res!.json()).toEqual({ title: 'hello' })
  })

  it('binds @Param on GET :id', async () => {
    const res = await handle(new Request('http://x/api/v2/things/42'))
    expect(res!.status).toBe(200)
    expect(await res!.json()).toEqual({ id: '42' })
  })

  it('returns a 422 typed validation error on an invalid @Body', async () => {
    const res = await handle(
      new Request('http://x/api/v2/things', {
        method: 'POST',
        body: JSON.stringify({ title: 'no' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res!.status).toBe(422)
  })

  it('returns null when no controller route matches (caller owns the 404)', async () => {
    const res = await handle(new Request('http://x/api/v2/unknown'))
    expect(res).toBeNull()
  })
})
