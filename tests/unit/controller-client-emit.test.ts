import 'reflect-metadata'

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import {
  emitClientDts,
  generateClientDts,
  shouldReemitForFile,
} from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import { collectControllerRouteData } from '../../packages/theo/src/vite-plugin/controller-client-emit.js'

// #122 T2.1 — typed client for decorator controllers. Codegen loads controllers via
// `loadControllerWithSwc` (no Vite server needed), so the controller + its temp `.mjs`
// live under `packages/theo/` where their bare imports resolve.
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_client_emit_test__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')
const DTS_OUT = join(TEST_ROOT, '.theokit', 'client.d.ts')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Body, Param } from '@theokit/http'

const zCreate = z.object({ title: z.string().min(3) })

@Controller('api/v2/things')
export class ThingsController {
  @Get()
  list() {
    return [{ id: 1, title: 'seed' }]
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return { id: Number(id), title: 'seed' }
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return { id: 2, title: body.title }
  }
}
`

const EMPTY_MANIFEST = {
  version: 1 as const,
  generatedAt: '2026-07-13T00:00:00.000Z',
  routes: [],
  actions: [],
  websockets: [],
}

beforeAll(() => {
  mkdirSync(CONTROLLERS_DIR, { recursive: true })
  writeFileSync(join(CONTROLLERS_DIR, 'things.controller.ts'), CONTROLLER_SRC, 'utf-8')
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('controller client emit — typed parity (ADR-2 fallback: body unknown)', () => {
  it('collects controller route data (path/verb/method/class/file)', async () => {
    const data = await collectControllerRouteData({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    expect(data.length).toBe(3)

    const post = data.find((d) => d.verb === 'POST' && d.fullPath === '/api/v2/things')
    expect(post).toBeDefined()
    expect(post!.methodName).toBe('create')
    expect(post!.className).toBe('ThingsController')
    expect(post!.filePath).toContain('things.controller.ts')

    const byId = data.find((d) => d.verb === 'GET' && d.fullPath === '/api/v2/things/:id')
    expect(byId).toBeDefined()
    expect(byId!.methodName).toBe('findById')
  })

  it('emits controller entries into the client d.ts (response-typed via ReturnType)', async () => {
    const data = await collectControllerRouteData({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
    })
    const dts = generateClientDts({
      manifest: EMPTY_MANIFEST,
      dtsOutPath: DTS_OUT,
      serverDir: TEST_ROOT,
      controllerRoutes: data,
    })

    expect(dts).toContain('things: {')
    expect(dts).toMatch(/\bget:/)
    expect(dts).toMatch(/\bpost:/)
    // import type of the controller class + response inference (ADR-2 checkpoint).
    expect(dts).toContain('ThingsController')
    expect(dts).toContain('Awaited<ReturnType<')
    // :id route surfaces typed params.
    expect(dts).toContain('params: { id: string }')
  })

  it('is byte-identical to routes-only when there are no controllers (ADR-5)', () => {
    const withEmpty = generateClientDts({
      manifest: EMPTY_MANIFEST,
      dtsOutPath: DTS_OUT,
      serverDir: TEST_ROOT,
      controllerRoutes: [],
    })
    const without = generateClientDts({
      manifest: EMPTY_MANIFEST,
      dtsOutPath: DTS_OUT,
      serverDir: TEST_ROOT,
    })
    expect(withEmpty).toBe(without)
  })

  it('emitClientDts on a routes-only app is byte-identical before/after #122 (ADR-5 end-to-end)', async () => {
    // A real emit on a serverDir with routes but NO controllers/ dir must produce
    // the exact same client.d.ts the pre-controller codegen did.
    const root = join(TEST_ROOT, 'routes-only-app')
    const serverDir = join(root, 'server')
    const distDir = join(root, '.theokit')
    mkdirSync(join(serverDir, 'routes'), { recursive: true })
    writeFileSync(join(serverDir, 'routes', 'ping.ts'), 'export const GET = () => ({ ok: true })\n')

    const r1 = await emitClientDts({ cwd: root, serverDir, distDir })
    const first = readFileSync(r1.path, 'utf-8')
    const r2 = await emitClientDts({ cwd: root, serverDir, distDir })
    expect(r2.changed).toBe(false) // idempotent — controllers path added zero drift
    expect(readFileSync(r2.path, 'utf-8')).toBe(first)
    expect(first).not.toContain('_c0') // no controller import alias leaked in
  })

  it('shouldReemitForFile ignores the swc temp .mjs (no HMR self-loop)', () => {
    const routesGlob = join(TEST_ROOT, 'server', 'routes').replace(/\\/g, '/')
    const controllersGlob = join(TEST_ROOT, 'server', 'controllers').replace(/\\/g, '/')
    // Real source edits DO trigger a re-emit.
    expect(
      shouldReemitForFile(`${controllersGlob}/tasks.controller.ts`, routesGlob, controllersGlob),
    ).toBe(true)
    expect(shouldReemitForFile(`${routesGlob}/ping.ts`, routesGlob, controllersGlob)).toBe(true)
    // The loadControllerWithSwc temp file MUST NOT (else emit→temp→watcher→emit loop).
    expect(
      shouldReemitForFile(
        `${controllersGlob}/tasks.__decorated__.mjs`,
        routesGlob,
        controllersGlob,
      ),
    ).toBe(false)
    // Unrelated paths never trigger.
    expect(shouldReemitForFile(`${TEST_ROOT}/app/page.tsx`, routesGlob, controllersGlob)).toBe(
      false,
    )
  })
})
