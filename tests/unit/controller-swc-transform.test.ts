import 'reflect-metadata'

import { unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { walkControllerMetadata } from '../../packages/http/dist/index.js'
import { controllerSwcTransformPlugin } from '../../packages/theo/src/vite-plugin/controller-swc-transform.js'

// The transform never reads disk (Vite passes the source in), so `serverDir` is a
// virtual path used only for the `controllers/` scope match. The transformed
// output is written under `packages/theo/` so its bare imports (`@theokit/http`,
// `zod`) resolve via that package's node_modules — root has neither.
const THEO_PKG = resolve(__dirname, '../../packages/theo')
const FIXTURE_SERVER = join(THEO_PKG, '__controller_swc_test_server__')
const CONTROLLERS_DIR = join(FIXTURE_SERVER, 'controllers')

// Self-contained controller: parameter decorators (`@Body`, `@Param`) that esbuild
// cannot emit metadata for. Bare imports only, so the transformed module loads
// without any relative-import fixture wiring.
const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Body, Param } from '@theokit/http'

const zCreate = z.object({ title: z.string().min(3) })

@Controller('api/v2/things')
export class ThingsController {
  @Get(':id')
  findById(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return body
  }
}
`

interface TransformResult {
  code: string
  map?: unknown
}

async function callTransform(
  plugin: ReturnType<typeof controllerSwcTransformPlugin>,
  code: string,
  id: string,
): Promise<TransformResult | null | undefined> {
  const hook = plugin.transform
  const fn = typeof hook === 'function' ? hook : hook?.handler
  if (!fn) throw new Error('plugin has no transform hook')
  // Our transform ignores `this`; pass a minimal Rollup-style context.
  return (await fn.call({} as never, code, id)) as TransformResult | null | undefined
}

describe('controllerSwcTransformPlugin', () => {
  it('compiles a controller under controllers/ so parameter-decorator metadata survives', async () => {
    const plugin = controllerSwcTransformPlugin({ serverDir: FIXTURE_SERVER })
    const controllerId = join(CONTROLLERS_DIR, 'things.controller.ts')

    const result = await callTransform(plugin, CONTROLLER_SRC, controllerId)
    expect(result).not.toBeNull()
    expect(result!.code).not.toBe(CONTROLLER_SRC)
    expect(typeof result!.code).toBe('string')

    // Load the transformed output and assert the metadata esbuild would have dropped.
    // Written at the package root (exists on disk; the virtual controllers/ dir does not).
    const tmpPath = join(THEO_PKG, '__swc_transform_test__.mjs')
    writeFileSync(tmpPath, result!.code, 'utf-8')
    try {
      const url = pathToFileURL(tmpPath).href + `?t=${Date.now()}`
      const mod = (await import(url)) as { ThingsController: Function }
      const walks = walkControllerMetadata(mod.ThingsController)

      const postRoute = walks.find((w) => w.verb === 'POST' && w.fullPath === '/api/v2/things')
      expect(postRoute).toBeDefined()
      expect(postRoute!.bodySchema).toBeDefined()

      const getRoute = walks.find((w) => w.verb === 'GET' && w.fullPath === '/api/v2/things/:id')
      expect(getRoute).toBeDefined()
      // The @Param('id') parameter-decorator metadata only exists if swc compiled it.
      expect(getRoute!.paramEntries.some((p) => p.source === 'param' && p.key === 'id')).toBe(true)
    } finally {
      unlinkSync(tmpPath)
    }
  })

  it('leaves files outside controllers/ untouched (identity)', async () => {
    const plugin = controllerSwcTransformPlugin({ serverDir: FIXTURE_SERVER })
    const routeId = join(FIXTURE_SERVER, 'routes', 'things.ts')

    const result = await callTransform(plugin, CONTROLLER_SRC, routeId)
    expect(result == null).toBe(true)
  })

  it('throws a clear DX error naming @swc/core when swc is unavailable', async () => {
    const plugin = controllerSwcTransformPlugin({
      serverDir: FIXTURE_SERVER,
      loadSwcCore: async () => null,
    })
    const controllerId = join(CONTROLLERS_DIR, 'things.controller.ts')

    await expect(callTransform(plugin, CONTROLLER_SRC, controllerId)).rejects.toThrow(/@swc\/core/)
  })
})
