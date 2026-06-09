import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadControllerWithSwc, loadControllersFromGlob } from '../../src/bridge/swc-loader.js'
import { walkControllerMetadata } from '../../src/bridge/walk-metadata.js'

const FIXTURE_ROOT = resolve(__dirname, '../../../../fixtures/decorator-fullstack')
const CONTROLLER_PATH = resolve(FIXTURE_ROOT, 'server/controllers/tasks.controller.ts')

describe('SWC Loader', () => {
  describe('loadControllerWithSwc', () => {
    it('should load a controller file with parameter decorators via SWC', async () => {
      const mod = await loadControllerWithSwc(CONTROLLER_PATH)
      expect(mod.TasksController).toBeDefined()
      expect(typeof mod.TasksController).toBe('function')
    })

    it('should emit decorator metadata (design:paramtypes) for @Body/@Param/@Query', async () => {
      const mod = await loadControllerWithSwc(CONTROLLER_PATH)
      const Controller = mod.TasksController as Function

      // walkControllerMetadata should succeed (no EC-4 throw)
      const walks = walkControllerMetadata(Controller)
      expect(walks.length).toBeGreaterThanOrEqual(7)

      // POST route should have bodySchema from @Body(zCreateTask)
      const postRoute = walks.find((w) => w.verb === 'POST' && w.fullPath === '/api/v2/tasks')
      expect(postRoute).toBeDefined()
      expect(postRoute!.bodySchema).toBeDefined()
    })

    it('should resolve relative imports from the controller file correctly', async () => {
      const mod = await loadControllerWithSwc(CONTROLLER_PATH)
      const Controller = mod.TasksController as Function

      // The controller imports taskStore — if imports failed, methods would throw
      const walks = walkControllerMetadata(Controller)
      const getRoute = walks.find((w) => w.verb === 'GET' && w.fullPath === '/api/v2/tasks')
      expect(getRoute).toBeDefined()
    })
  })

  describe('loadControllersFromGlob', () => {
    it('should discover and load controllers matching the glob pattern', async () => {
      const controllers = await loadControllersFromGlob(
        FIXTURE_ROOT,
        'server/controllers/**/*.controller.ts',
      )
      expect(controllers.length).toBe(1)
      expect((controllers[0] as { name: string }).name).toBe('TasksController')
    })

    it('should return empty array when no files match', async () => {
      const controllers = await loadControllersFromGlob(
        FIXTURE_ROOT,
        'nonexistent/**/*.controller.ts',
      )
      expect(controllers.length).toBe(0)
    })
  })

  describe('httpDecoratorsPlugin with controllersGlob', () => {
    it('should handle HTTP requests after lazy SWC initialization', async () => {
      const { httpDecoratorsPlugin } = await import('../../src/theokit-plugin.js')
      const http = await import('node:http')

      const originalCwd = process.cwd()
      process.chdir(FIXTURE_ROOT)
      try {
        const plugin = httpDecoratorsPlugin({
          controllersGlob: 'server/controllers/**/*.controller.ts',
        })

        // Simulate TheoKit register
        const hooks: Array<{ name: string; fn: Function }> = []
        plugin.register({
          addHook(name: string, fn: Function) {
            hooks.push({ name, fn })
          },
        } as never)

        // Create test server
        const server = http.createServer(async (req, res) => {
          await hooks[0].fn({ request: req, response: res, ctx: {} })
          if (!res.writableEnded) {
            res.writeHead(404)
            res.end('{}')
          }
        })
        await new Promise<void>((r) => server.listen(0, r))
        const port = (server.address() as { port: number }).port

        try {
          // GET — list tasks
          const r1 = await fetch(`http://localhost:${port}/api/v2/tasks`)
          expect(r1.status).toBe(200)
          const tasks = (await r1.json()) as unknown[]
          expect(Array.isArray(tasks)).toBe(true)

          // POST — create task with Zod validation
          const r2 = await fetch(`http://localhost:${port}/api/v2/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'SWC Test', priority: 'high' }),
          })
          expect(r2.status).toBe(201)

          // POST — validation error
          const r3 = await fetch(`http://localhost:${port}/api/v2/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'ab' }),
          })
          expect(r3.status).toBe(422)
        } finally {
          server.close()
        }
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
