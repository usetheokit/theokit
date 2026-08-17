import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanWebSocketRoutes } from '../../packages/theo/src/server/scan/ws-scan.js'

/**
 * The server tree is built in a tmpdir by the test itself, so the cases below own their own
 * inputs.
 */
function makeServerDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'theokit-ws-scan-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('scanWebSocketRoutes', () => {
  const WS_HANDLER = 'export default { open() {}, message() {}, close() {} }\n'
  let withWs: string
  let withoutWs: string

  beforeAll(() => {
    withWs = makeServerDir({
      'ws/echo.ts': WS_HANDLER,
      'ws/notifications.ts': WS_HANDLER,
      'ws/README.md': '# not a route\n',
    })
    withoutWs = makeServerDir({ 'routes/health.ts': 'export function GET() {}\n' })
  })

  afterAll(() => {
    rmSync(withWs, { recursive: true, force: true })
    rmSync(withoutWs, { recursive: true, force: true })
  })

  it('should scan server/ws/ directory and return routes', () => {
    const routes = scanWebSocketRoutes(withWs)
    expect(routes.length).toBeGreaterThanOrEqual(2)
    const paths = routes.map((r) => r.wsPath)
    expect(paths).toContain('/ws/echo')
    expect(paths).toContain('/ws/notifications')
  })

  it('should return empty array when no ws/ directory', () => {
    const routes = scanWebSocketRoutes(withoutWs)
    expect(routes).toEqual([])
  })

  it('should return empty for non-existent server dir', () => {
    const routes = scanWebSocketRoutes('/nonexistent')
    expect(routes).toEqual([])
  })

  it('should have filePath pointing to actual files', () => {
    const routes = scanWebSocketRoutes(withWs)
    expect(routes.some((r) => r.filePath.endsWith('echo.ts'))).toBe(true)
  })

  it('should ignore non-ts files', () => {
    const routes = scanWebSocketRoutes(withWs)
    for (const route of routes) {
      expect(route.filePath).toMatch(/\.(ts|tsx|js|jsx)$/)
    }
  })
})
