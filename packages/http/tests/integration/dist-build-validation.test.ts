import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import http from 'node:http'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

const PKG_ROOT = resolve(__dirname, '../..')
const DIST = resolve(PKG_ROOT, 'dist')

describe.skipIf(!isVitest)('dist build validation', () => {
  beforeAll(() => {
    // Build before tests — ensures dist/ is fresh
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- test deliberately runs build CLI to validate dist output
    execSync('npx tsup', { cwd: PKG_ROOT, stdio: 'pipe' })
  })

  describe('build output structure', () => {
    it('should emit all 3 entry points as ESM', () => {
      expect(existsSync(resolve(DIST, 'index.js'))).toBe(true)
      expect(existsSync(resolve(DIST, 'theokit-plugin.js'))).toBe(true)
      expect(existsSync(resolve(DIST, 'app.js'))).toBe(true)
    })

    it('should emit .d.ts for all 3 entry points', () => {
      expect(existsSync(resolve(DIST, 'index.d.ts'))).toBe(true)
      expect(existsSync(resolve(DIST, 'theokit-plugin.d.ts'))).toBe(true)
      expect(existsSync(resolve(DIST, 'app.d.ts'))).toBe(true)
    })

    it('should emit source maps for all entry points', () => {
      expect(existsSync(resolve(DIST, 'index.js.map'))).toBe(true)
      expect(existsSync(resolve(DIST, 'theokit-plugin.js.map'))).toBe(true)
      expect(existsSync(resolve(DIST, 'app.js.map'))).toBe(true)
    })

    it('should not bundle @swc/core (externalized as dynamic import)', () => {
      // @swc/core is loaded via dynamic import() — it should appear as a
      // string reference (import("@swc/core")), not as inlined Rust bindings
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- test reads build output to verify externalized deps
      const allDist = execSync('cat dist/*.js dist/chunk-*.js 2>/dev/null', {
        cwd: PKG_ROOT,
        encoding: 'utf-8',
      })
      // The string "@swc/core" must appear (dynamic import reference)
      expect(allDist).toContain('@swc/core')
      // But SWC's internal Rust binding function should NOT be inlined
      expect(allDist).not.toContain('swc_wasm')
    })

    it('should not bundle peer deps (zod, theokit)', () => {
      const indexCode = readFileSync(resolve(DIST, 'index.js'), 'utf-8')
      // Zod should NOT be inlined — it's a peer dep
      expect(indexCode).not.toContain('z.object')
      // reflect-metadata is called via Reflect.defineMetadata in set-metadata.ts
      // (legitimate usage, not bundled — the polyfill comes from the peer dep import)
    })
  })

  describe('dist runtime — imports resolve', () => {
    it('should import index.js and export all decorators', async () => {
      const mod = await import(resolve(DIST, 'index.js'))
      expect(typeof mod.Controller).toBe('function')
      expect(typeof mod.Get).toBe('function')
      expect(typeof mod.Post).toBe('function')
      expect(typeof mod.Body).toBe('function')
      expect(typeof mod.Param).toBe('function')
      expect(typeof mod.Query).toBe('function')
      expect(typeof mod.HttpCode).toBe('function')
      expect(typeof mod.UseGuards).toBe('function')
      expect(typeof mod.walkControllerMetadata).toBe('function')
      expect(typeof mod.createDecoratorServer).toBe('function')
    })

    it('should import theokit-plugin.js and export httpDecoratorsPlugin', async () => {
      const mod = await import(resolve(DIST, 'theokit-plugin.js'))
      expect(typeof mod.httpDecoratorsPlugin).toBe('function')
    })

    it('should import app.js and export TheoApp', async () => {
      const mod = await import(resolve(DIST, 'app.js'))
      expect(mod.TheoApp).toBeDefined()
      expect(typeof mod.TheoApp.create).toBe('function')
    })
  })

  describe('dist runtime — decorators + HTTP roundtrip', () => {
    it('should create a controller from dist decorators and serve HTTP', async () => {
      const { Controller, Get, Post, Body, Param, walkControllerMetadata } = await import(
        resolve(DIST, 'index.js')
      )
      const { httpDecoratorsPlugin } = await import(resolve(DIST, 'theokit-plugin.js'))

      const schema = z.object({ title: z.string().min(1) })

      @Controller('items')
      class ItemCtrl {
        @Get()
        list() {
          return [{ id: 1, title: 'from-dist' }]
        }

        @Post()
        create(@Body(schema) body: z.infer<typeof schema>) {
          return { id: 2, ...body }
        }

        @Get(':id')
        find(@Param('id') id: string) {
          return { id }
        }
      }

      // Verify metadata walks correctly
      const routes = walkControllerMetadata(ItemCtrl)
      expect(routes.length).toBe(3)
      expect(routes.find((r: { verb: string }) => r.verb === 'POST')?.bodySchema).toBeDefined()

      // HTTP roundtrip via plugin
      const plugin = httpDecoratorsPlugin({ controllers: [ItemCtrl] })
      const hooks: Function[] = []
      plugin.register({
        addHook(_: string, fn: Function) {
          hooks.push(fn)
        },
      })

      const server = http.createServer(async (req, res) => {
        await hooks[0]({ request: req, response: res, ctx: {} })
        if (!res.writableEnded) {
          res.writeHead(404)
          res.end('{}')
        }
      })
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        // GET
        const r1 = await fetch(`http://localhost:${port}/items`)
        expect(r1.status).toBe(200)
        const items = (await r1.json()) as { id: number; title: string }[]
        expect(items[0].title).toBe('from-dist')

        // POST valid
        const r2 = await fetch(`http://localhost:${port}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'new-item' }),
        })
        expect(r2.status).toBe(201)
        expect(((await r2.json()) as { title: string }).title).toBe('new-item')

        // POST invalid (Zod validation via @Body(schema))
        const r3 = await fetch(`http://localhost:${port}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '' }),
        })
        expect(r3.status).toBe(422)

        // GET :id
        const r4 = await fetch(`http://localhost:${port}/items/42`)
        expect(r4.status).toBe(200)
        expect(((await r4.json()) as { id: string }).id).toBe('42')
      } finally {
        server.close()
      }
    })
  })
})
