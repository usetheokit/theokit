import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  scaffoldServices,
  buildServicesSnippet,
  injectServicesIntoConfig,
  injectHeyApiDep,
  parseBackendFlags,
} from '../../packages/create-theokit/src/scaffold-services.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'scaffold-services-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const BARE_THEO_CONFIG = `import { defineConfig } from 'theokit'
export default defineConfig({
  port: 3000,
})
`

const BARE_PACKAGE_JSON = JSON.stringify(
  {
    name: 'my-app',
    private: true,
    dependencies: {
      theokit: '^0.5.0',
    },
  },
  null,
  2,
)

describe('T4.1/T4.2 — scaffoldServices', () => {
  it('no-op when backends array is empty', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), BARE_THEO_CONFIG)
    writeFileSync(join(tmp, 'package.json'), BARE_PACKAGE_JSON)
    scaffoldServices({ targetDir: tmp, projectName: 'my-app', backends: [] })
    expect(existsSync(join(tmp, 'services'))).toBe(false)
    expect(readFileSync(join(tmp, 'theo.config.ts'), 'utf-8')).toBe(BARE_THEO_CONFIG)
  })

  it('--backend node scaffolds services/worker/src/index.ts using Hono', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), BARE_THEO_CONFIG)
    writeFileSync(join(tmp, 'package.json'), BARE_PACKAGE_JSON)
    scaffoldServices({ targetDir: tmp, projectName: 'app', backends: ['node'] })
    const indexPath = join(tmp, 'services', 'worker', 'src', 'index.ts')
    expect(existsSync(indexPath)).toBe(true)
    const content = readFileSync(indexPath, 'utf-8')
    expect(content).toContain("from 'hono'")
    expect(content).toContain('/health')
    expect(content).toContain('traceparent')
  })

  it('--backend node creates package.json with hono dep', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), BARE_THEO_CONFIG)
    writeFileSync(join(tmp, 'package.json'), BARE_PACKAGE_JSON)
    scaffoldServices({ targetDir: tmp, projectName: 'cool-app', backends: ['node'] })
    const pkgPath = join(tmp, 'services', 'worker', 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    expect(existsSync(`${pkgPath}.tmpl`)).toBe(false)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe('cool-app-agent-node')
    expect(pkg.dependencies.hono).toBeDefined()
  })

  // EC-10: inject @hey-api/client-fetch
  it('EC-10: --backend node injects @hey-api/client-fetch', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), BARE_THEO_CONFIG)
    writeFileSync(join(tmp, 'package.json'), BARE_PACKAGE_JSON)
    scaffoldServices({ targetDir: tmp, projectName: 'app', backends: ['node'] })
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@hey-api/client-fetch']).toBeDefined()
  })
})

describe('helper functions', () => {
  it('buildServicesSnippet empty selections returns empty string', () => {
    expect(buildServicesSnippet([])).toBe('')
  })

  it('buildServicesSnippet produces valid TypeScript record', () => {
    const snippet = buildServicesSnippet([
      {
        name: 'worker',
        entry: {
          runtime: 'node',
          port: 8002,
          proxy: '/api/worker',
          dev: 'pnpm dev',
          start: 'pnpm start',
        },
      },
    ])
    expect(snippet).toContain('services:')
    expect(snippet).toContain('worker:')
    expect(snippet).toContain("runtime: 'node'")
  })

  it('injectServicesIntoConfig is idempotent', () => {
    const src = BARE_THEO_CONFIG
    const snippet = '  services: { x: {} },\n'
    const first = injectServicesIntoConfig(src, snippet)
    const second = injectServicesIntoConfig(first, snippet)
    expect(first).toBe(second)
  })

  it('injectHeyApiDep adds dep if missing', () => {
    const updated = injectHeyApiDep(BARE_PACKAGE_JSON)
    const pkg = JSON.parse(updated) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@hey-api/client-fetch']).toBeDefined()
  })

  it('injectHeyApiDep is idempotent', () => {
    const once = injectHeyApiDep(BARE_PACKAGE_JSON)
    const twice = injectHeyApiDep(once)
    // version should not change between runs
    const a = JSON.parse(once) as { dependencies: Record<string, string> }
    const b = JSON.parse(twice) as { dependencies: Record<string, string> }
    expect(a.dependencies['@hey-api/client-fetch']).toBe(b.dependencies['@hey-api/client-fetch'])
  })
})

describe('parseBackendFlags', () => {
  it('returns empty array when no --backend flag', () => {
    expect(parseBackendFlags(['my-app'])).toEqual([])
  })

  it('parses --backend node', () => {
    expect(parseBackendFlags(['my-app', '--backend', 'node'])).toEqual(['node'])
  })

  it('parses --backend=node (= form)', () => {
    expect(parseBackendFlags(['my-app', '--backend=node'])).toEqual(['node'])
  })

  it('parses repeated --backend node', () => {
    expect(parseBackendFlags(['my-app', '--backend', 'node', '--backend', 'node'])).toEqual([
      'node',
      'node',
    ])
  })

  it('throws on unknown backend', () => {
    expect(() => parseBackendFlags(['my-app', '--backend', 'go'])).toThrow(/unknown.*go/i)
  })

  it('rejects python (node-only; python deferred)', () => {
    expect(() => parseBackendFlags(['my-app', '--backend', 'python'])).toThrow(/unknown.*python/i)
  })

  it('error message lists valid options (node)', () => {
    try {
      parseBackendFlags(['my-app', '--backend', 'rust'])
      throw new Error('should have thrown')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).toContain('node')
    }
  })
})
