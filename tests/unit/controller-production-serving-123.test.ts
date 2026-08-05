import 'reflect-metadata'

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emitControllerArtifacts } from '../../packages/theo/src/cli/commands/build/emit-controllers.js'
import { createControllerDispatcher } from '../../packages/theo/src/server/http/controller-dispatch.js'

/**
 * theokit#123 — a decorator controller served in `theokit dev` must also be served after
 * `theokit build` + `theokit start`.
 *
 * #122 made controllers first-class in dev, where a Vite `enforce:'pre'` swc transform compiles
 * them on the fly (parameter decorators emit metadata esbuild cannot produce). Production has no
 * Vite and no transform, so an uncompiled `.controller.ts` could not load and its routes 404'd.
 * Working in dev and failing in prod is the worst shape for a gap: nothing in the development loop
 * can reveal it.
 *
 * ## What is asserted here
 *
 * The BUILD half — compilation into `dist` — and the SERVING half — that the compiled module
 * actually dispatches a request, with its `@Param` and `@Body` intact. The second is the one that
 * matters: emitting a file proves the build ran, not that production can serve from it, and the
 * decorator metadata is exactly what a naive compile would drop.
 *
 * A plain dynamic `import()` is used as the loader, matching production. Production must NOT need
 * `@swc/core`: it is a peer dependency and a native binary, and requiring it there would make every
 * deployed app carry a compiler to redo work the build already did — while turning a missing
 * optional peer into a runtime 404 rather than a build failure.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_prod_123_test__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const DIST_DIR = join(TEST_ROOT, '.theokit')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Body, Param } from '@theokit/http'

export const zCreate = z.object({ title: z.string().min(3) })

@Controller('api/v2/tasks')
export class TasksController {
  @Get(':id')
  findById(@Param('id') id: string) {
    return { id: Number(id), from: 'production' }
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return { created: body.title }
  }
}
`

async function loadCompiled(absPath: string): Promise<Record<string, unknown>> {
  const { pathToFileURL } = await import('node:url')
  return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>
}

describe('theokit#123 — controllers survive build and serve in production', () => {
  beforeAll(() => {
    mkdirSync(join(SERVER_DIR, 'controllers'), { recursive: true })
    mkdirSync(DIST_DIR, { recursive: true })
    writeFileSync(join(SERVER_DIR, 'controllers', 'tasks.controller.ts'), CONTROLLER_SRC)
  })
  afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

  it('test_build_compiles_controllers_into_dist_and_writes_a_manifest', async () => {
    const manifest = await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    expect(manifest, 'the build emitted nothing for an app that HAS a controller').not.toBeNull()
    expect(manifest?.modules).toEqual(['controllers/tasks.controller.mjs'])
    expect(existsSync(join(DIST_DIR, 'controllers', 'tasks.controller.mjs'))).toBe(true)
    expect(existsSync(join(DIST_DIR, 'controllers.json'))).toBe(true)
  })

  it('test_the_compiled_module_keeps_the_decorator_metadata', async () => {
    // The reason the build cannot just use esbuild/tsc. Parameter decorators are the whole point:
    // a compile that drops `design:paramtypes`/`__decorate` produces a module that loads fine and
    // then serves nothing, which is indistinguishable from the 404 this issue reports.
    await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    const js = readFileSync(join(DIST_DIR, 'controllers', 'tasks.controller.mjs'), 'utf-8')
    expect(js, 'the compiled output has no decorator application at all').toMatch(
      /__decorate|_ts_decorate/,
    )
    expect(js, 'parameter-decorator metadata was dropped').toMatch(/param|metadata/i)
  })

  it('test_a_request_is_SERVED_from_the_compiled_controller', async () => {
    // The half that matters. Emitting a file proves the build ran; only a dispatch proves
    // production can serve from it.
    await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    const dispatcher = await createControllerDispatcher({
      controllersDir: join(DIST_DIR, 'controllers'),
      loadModule: loadCompiled,
    })
    expect(dispatcher, 'no dispatcher was built from the compiled controllers').not.toBeNull()

    const res = await dispatcher!.dispatch(
      new Request('http://localhost/api/v2/tasks/7', { method: 'GET' }),
    )
    expect(res, 'the compiled controller did not own a route it owns in dev').not.toBeNull()
    expect(res!.status).toBe(200)
    // `@Param('id')` must have been bound — a metadata-less compile returns `undefined` here.
    expect(await res!.json()).toEqual({ id: 7, from: 'production' })
  })

  it('test_the_Body_schema_still_validates_in_the_compiled_controller', async () => {
    // Runtime validation is the guarantee `@Body(zod)` makes. If it were lost in compilation, the
    // production app would silently accept payloads dev rejects — worse than a 404, because it is
    // invisible.
    await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    const dispatcher = await createControllerDispatcher({
      controllersDir: join(DIST_DIR, 'controllers'),
      loadModule: loadCompiled,
    })
    const bad = await dispatcher!.dispatch(
      new Request('http://localhost/api/v2/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'xy' }), // min(3) — must be rejected
      }),
    )
    expect(
      bad!.status,
      'an invalid body was ACCEPTED by the compiled controller',
    ).toBeGreaterThanOrEqual(400)

    const good = await dispatcher!.dispatch(
      new Request('http://localhost/api/v2/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'valid title' }),
      }),
    )
    expect(good!.status).toBe(201)
    expect(await good!.json()).toEqual({ created: 'valid title' })
  })

  it('test_an_app_with_NO_controllers_emits_nothing', async () => {
    // ADR-5 posture: a routes-only app must pay nothing and its `dist` must stay byte-identical.
    // An empty manifest would also be "correct" and would make `theokit start` scan a directory
    // forever for an app that has no controllers.
    const emptyRoot = join(TEST_ROOT, 'empty')
    mkdirSync(join(emptyRoot, 'server'), { recursive: true })
    mkdirSync(join(emptyRoot, 'dist'), { recursive: true })
    const manifest = await emitControllerArtifacts({
      serverDir: join(emptyRoot, 'server'),
      distDir: join(emptyRoot, 'dist'),
    })
    expect(manifest).toBeNull()
    expect(existsSync(join(emptyRoot, 'dist', 'controllers.json'))).toBe(false)
    expect(existsSync(join(emptyRoot, 'dist', 'controllers'))).toBe(false)
  })
})
