import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { appTypedClientPlugin } from '../../packages/theo/src/vite-plugin/app-typed-client.js'

// ── Test ───────────────────────────────────────────────

let sandbox: string
let serverDir: string
let distDir: string

beforeEach(() => {
  sandbox = join(tmpdir(), `theo-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  serverDir = join(sandbox, 'server')
  distDir = join(sandbox, '.theo')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
  mkdirSync(join(serverDir, 'controllers'), { recursive: true })
})

function writeRoute(rel: string, content: string): void {
  const full = join(serverDir, 'routes', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('Decorator → Client Bridge (G1 integration)', () => {
  it('generates .d.ts with BOTH file-routes AND extraRoutes in same AppClient', () => {
    // File-based route
    writeRoute('users.ts', 'export const GET = () => ({})\n')

    // Controller file (needs to exist for import-path resolution in .d.ts)
    writeFileSync(
      join(serverDir, 'controllers', 'cats.controller.ts'),
      'export class CatsController { findAll() { return [] } }\n',
    )

    const plugin = appTypedClientPlugin({
      cwd: sandbox,
      serverDir,
      distDir,
      extraRoutes: [
        {
          filePath: 'controllers/cats.controller.ts',
          routePath: '/api/cats',
          methods: ['GET', 'POST'],
          paramNames: [],
        },
        {
          filePath: 'controllers/cats.controller.ts',
          routePath: '/api/cats/:id',
          methods: ['GET'],
          paramNames: ['id'],
        },
        {
          filePath: 'controllers/cats.controller.ts',
          routePath: '/api/cats/:id',
          methods: ['DELETE'],
          paramNames: ['id'],
        },
      ],
    })

    // Trigger codegen
    ;(plugin.configResolved as Function)({})

    const dts = join(distDir, 'client.d.ts')
    expect(existsSync(dts)).toBe(true)

    const content = readFileSync(dts, 'utf-8')

    // File-route present
    expect(content).toContain('users:')

    // Decorator-route present
    expect(content).toContain('cats:')

    // Both in same declared module
    expect(content).toContain("declare module '@theo/client'")

    // HTTP methods from extraRoutes
    expect(content).toMatch(/get:/)
    expect(content).toMatch(/post:/)
    expect(content).toMatch(/delete:/)
  })

  it('works with extraRoutes-only (no file-routes)', () => {
    writeFileSync(
      join(serverDir, 'controllers', 'cats.controller.ts'),
      'export class CatsController {}\n',
    )

    const plugin = appTypedClientPlugin({
      cwd: sandbox,
      serverDir,
      distDir,
      extraRoutes: [
        {
          filePath: 'controllers/cats.controller.ts',
          routePath: '/api/cats',
          methods: ['GET'],
          paramNames: [],
        },
      ],
    })

    ;(plugin.configResolved as Function)({})

    const content = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
    expect(content).toContain('cats:')
    expect(content).toContain("declare module '@theo/client'")
  })

  it('works with file-routes-only (no extraRoutes) — backward compat', () => {
    writeRoute('health.ts', 'export const GET = () => ({})\n')

    const plugin = appTypedClientPlugin({
      cwd: sandbox,
      serverDir,
      distDir,
      // NO extraRoutes
    })

    ;(plugin.configResolved as Function)({})

    const content = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
    expect(content).toContain('health:')
    expect(content).not.toContain('cats:')
  })

  it('extraRoutes with :id params produce typed params in .d.ts', () => {
    writeFileSync(
      join(serverDir, 'controllers', 'cats.controller.ts'),
      'export class CatsController {}\n',
    )

    const plugin = appTypedClientPlugin({
      cwd: sandbox,
      serverDir,
      distDir,
      extraRoutes: [
        {
          filePath: 'controllers/cats.controller.ts',
          routePath: '/api/cats/:id',
          methods: ['GET'],
          paramNames: ['id'],
        },
      ],
    })

    ;(plugin.configResolved as Function)({})

    const content = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
    // Should contain param type: { params: { id: string } }
    expect(content).toContain('id: string')
  })
})
