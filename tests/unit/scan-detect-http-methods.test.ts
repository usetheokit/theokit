import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { detectExportedHttpMethods } from '../../packages/theo/src/server/scan/detect-http-methods.js'
import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import {
  generateManifest,
  loadManifest,
  writeManifest,
} from '../../packages/theo/src/server/scan/manifest.js'

let sandbox: string
let serverDir: string

function write(rel: string, content: string): string {
  const full = join(sandbox, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

beforeEach(() => {
  sandbox = join(
    tmpdir(),
    `theo-detect-http-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  serverDir = join(sandbox, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

describe('detectExportedHttpMethods (AST-based, EC-4)', () => {
  it('detects a single GET export', () => {
    const fp = write(
      'a.ts',
      `import { defineRoute } from 'theokit/server'\nexport const GET = defineRoute({ handler: () => ({}) })\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['GET'])
  })

  it('detects GET + POST + DELETE on same file', () => {
    const fp = write(
      'b.ts',
      `export const GET = () => ({})
export const POST = () => ({})
export const DELETE = () => ({})\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['DELETE', 'GET', 'POST'])
  })

  it('detects function declarations (export function GET)', () => {
    const fp = write(
      'c.ts',
      `export function GET() { return {} }
export async function POST() { return {} }\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['GET', 'POST'])
  })

  it('returns empty array for util-only files', () => {
    const fp = write(
      'd.ts',
      `import x from 'y'\nexport function helper() { return 1 }\nexport const foo = 'bar'\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual([])
  })

  it('ignores lowercase names (HTTP convention requires uppercase)', () => {
    const fp = write('e.ts', `export const get = () => ({})\nexport const post = () => ({})\n`)
    expect(detectExportedHttpMethods(fp)).toEqual([])
  })

  it('detects re-export with rename (EC-5: export { handler as GET })', () => {
    const fp = write(
      'f.ts',
      `export { handler as GET } from './shared.js'\nexport { other as POST } from './x.js'\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['GET', 'POST'])
  })

  it('detects re-export without rename (export { GET })', () => {
    const fp = write('g.ts', `const GET = () => ({})\nexport { GET }\n`)
    expect(detectExportedHttpMethods(fp)).toEqual(['GET'])
  })

  it('EC-4: ignores comment containing "export const GET ="', () => {
    const fp = write(
      'h.ts',
      `// Don't forget: export const GET = ...
export const POST = () => ({})
`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['POST'])
  })

  it('EC-4: ignores template literal containing "export const GET ="', () => {
    const fp = write(
      'i.ts',
      'const docSnippet = `export const GET = defineRoute({})`\nexport const POST = () => ({})\n',
    )
    expect(detectExportedHttpMethods(fp)).toEqual(['POST'])
  })

  it('detects all 7 supported HTTP methods', () => {
    const fp = write(
      'j.ts',
      `export const GET = 1
export const POST = 1
export const PUT = 1
export const PATCH = 1
export const DELETE = 1
export const HEAD = 1
export const OPTIONS = 1\n`,
    )
    expect(detectExportedHttpMethods(fp)).toEqual([
      'DELETE',
      'GET',
      'HEAD',
      'OPTIONS',
      'PATCH',
      'POST',
      'PUT',
    ])
  })

  it('accepts content override (no fs read) — pure unit testable', () => {
    const result = detectExportedHttpMethods('virtual.ts', `export const GET = 1\n`)
    expect(result).toEqual(['GET'])
  })
})

describe('scanServerRoutes propagates methods to ServerRouteNode', () => {
  it('populates methods for each route file', () => {
    write('server/routes/users.ts', 'export const GET = () => ({})\nexport const POST = () => ({})\n')
    write('server/routes/posts.ts', 'export const GET = () => ({})\n')
    write('server/routes/util.ts', `export const HELPER = 1\n`)
    const routes = scanServerRoutes(serverDir)
    const byPath = Object.fromEntries(routes.map((r) => [r.routePath, r.methods]))
    expect(byPath['/api/users']).toEqual(['GET', 'POST'])
    expect(byPath['/api/posts']).toEqual(['GET'])
    expect(byPath['/api/util']).toEqual([])
  })
})

describe('manifest round-trip with methods field', () => {
  it('generateManifest includes methods in route entries', () => {
    write('server/routes/x.ts', 'export const GET = () => ({})\nexport const DELETE = () => ({})\n')
    const manifest = generateManifest(serverDir)
    const x = manifest.routes.find((r) => r.routePath === '/api/x')
    expect(x?.methods).toEqual(['DELETE', 'GET'])
  })

  it('write + load preserves methods field', () => {
    write('server/routes/x.ts', 'export const GET = () => ({})\n')
    const manifest = generateManifest(serverDir)
    const distDir = join(sandbox, '.theo')
    writeManifest(manifest, distDir)
    const loaded = loadManifest(distDir, serverDir)
    const x = loaded.routes.find((r) => r.routePath === '/api/x')
    expect(x?.methods).toEqual(['GET'])
  })

  it('legacy manifest without methods loads with methods=undefined (backward-compat)', () => {
    const distDir = join(sandbox, '.theo')
    mkdirSync(distDir, { recursive: true })
    const legacy = {
      version: 1,
      generatedAt: '2026-05-30T00:00:00.000Z',
      routes: [{ filePath: 'routes/x.ts', routePath: '/api/x', paramNames: [] }],
      actions: [],
      websockets: [],
    }
    writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(legacy))
    const loaded = loadManifest(distDir, serverDir)
    expect(loaded.routes).toHaveLength(1)
    expect(loaded.routes[0].methods).toBeUndefined()
  })
})
