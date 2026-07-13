import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, it, expect } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { createControllerDispatcher } from '../../packages/theo/src/server/http/controller-dispatch.js'

// Runtime-parity boundary for decorator controllers (#122, T1.2). `loadModule` is
// injected: here `loadControllerWithSwc` (swc-compiles the controller, mirroring the
// Task 1.1 Vite transform + `ssrLoadModule` in a real dev server). The controller +
// its temp `.mjs` live under `packages/theo/` so their bare imports (`@theokit/http`,
// `zod`) resolve — the repo root has neither.
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_dispatch_test__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Body, Param } from '@theokit/http'

const zCreate = z.object({ title: z.string().min(3) })
const store = [{ id: 1, title: 'seed' }]
let nextId = 2

@Controller('api/v2/things')
export class ThingsController {
  @Get(':id')
  findById(@Param('id') id) {
    return store.find((t) => t.id === Number(id))
  }

  @Post()
  create(@Body(zCreate) body) {
    const t = { id: nextId++, title: body.title }
    store.push(t)
    return t
  }
}
`

function post(body: unknown): Request {
  return new Request('http://x/api/v2/things', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeAll(() => {
  mkdirSync(CONTROLLERS_DIR, { recursive: true })
  writeFileSync(join(CONTROLLERS_DIR, 'things.controller.ts'), CONTROLLER_SRC, 'utf-8')
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('controller dispatch — runtime parity', () => {
  it('scans controllers/ and serves POST → 201 with the created resource', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    expect(dispatcher).not.toBeNull()

    const res = await dispatcher!.dispatch(post({ title: 'write tests' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(201)
    expect((await res!.json()).title).toBe('write tests')
  })

  it('rejects an invalid @Body with a typed 422', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    const res = await dispatcher!.dispatch(post({ title: 'no' })) // min(3) fails
    expect(res!.status).toBe(422)
  })

  it('binds @Param on GET /api/v2/things/:id', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    const res = await dispatcher!.dispatch(new Request('http://x/api/v2/things/1'))
    expect(res!.status).toBe(200)
    expect((await res!.json()).id).toBe(1) // seeded resource — proves :id bound + parsed
  })

  it('non-executing matches() probes without running the handler', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    expect(dispatcher!.matches('POST', '/api/v2/things')).toBe(true)
    expect(dispatcher!.matches('POST', '/api/v2/unrelated')).toBe(false)
  })

  it('dispatch returns null when no controller route matches (host owns the 404)', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    const res = await dispatcher!.dispatch(new Request('http://x/api/v2/unrelated'))
    expect(res).toBeNull()
  })

  it('returns a null dispatcher when the directory has no controllers', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: join(TEST_ROOT, '__none__'),
      loadModule: loadControllerWithSwc,
    })
    expect(dispatcher).toBeNull()
  })
})
