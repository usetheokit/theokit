import { describe, it, expect } from 'vitest'
import { bunAdapter, buildBun, renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { VALID_TARGETS } from '../../packages/theo/src/adapters/types.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const baseConfig: TheoConfig = {
  appDir: 'app',
  serverDir: 'server',
  port: 4242,
  ssr: false,
  serialization: 'json',
} as TheoConfig

describe('Bun adapter — shape', () => {
  it('exposes the DeployAdapter contract', () => {
    expect(bunAdapter.name).toBe('bun')
    expect(typeof bunAdapter.build).toBe('function')
  })

  it('is listed in VALID_TARGETS', () => {
    expect(VALID_TARGETS).toContain('bun')
  })
})

describe('renderBunEntry — template output', () => {
  it('embeds the configured port', () => {
    const out = renderBunEntry(5555)
    expect(out).toContain('5555')
  })

  it('embeds the dev-mode guard (EC-1)', () => {
    const out = renderBunEntry(3000)
    expect(out).toMatch(/NODE_ENV.+production/)
    expect(out).toMatch(/TheoBunAdapter is production-only/)
  })

  it('embeds the Bun version check (>= 1.1)', () => {
    const out = renderBunEntry(3000)
    expect(out).toMatch(/Bun.version/)
    expect(out).toMatch(/requires Bun >= 1\.1/)
  })

  it('uses Bun.serve and Bun.file (no node:http)', () => {
    const out = renderBunEntry(3000)
    expect(out).toContain('Bun.serve')
    expect(out).toContain('Bun.file')
    expect(out).not.toMatch(/from 'node:http'/)
  })

  it('imports the scanners by their narrow public subpath', () => {
    // Was `from 'theokit/server'`. B-316 moved every adapter off the umbrella: it re-exports the
    // whole server half, and `@swc/core`'s native `.node` addon is down that graph, which no bundler
    // can follow. `scanServerRoutes` and `scanWebSocketRoutes` both live in `theokit/server/scan`,
    // resolved by importing the built subpath rather than by reading an index file.
    const out = renderBunEntry(3000)

    expect(out).toContain("from 'theokit/server/scan'")
    expect(out).not.toContain("from 'theokit/server'")
  })
})

describe('buildBun — orchestration', () => {
  it('runs node build before writing the Bun entry', async () => {
    const calls: string[] = []
    await buildBun(baseConfig, '/cwd', {
      runNodeBuild: async () => {
        calls.push('node-build')
      },
      writeEntry: () => {
        calls.push('write')
      },
      ensureDir: () => {},
    })
    expect(calls).toEqual(['node-build', 'write'])
  })

  it('writes server.mjs in .theokit/bun/', async () => {
    let writtenPath = ''
    await buildBun(baseConfig, '/test-cwd', {
      runNodeBuild: async () => {},
      writeEntry: (p) => {
        writtenPath = p
      },
      ensureDir: () => {},
    })
    expect(writtenPath).toContain('/.theokit/bun/server.mjs')
  })

  it('propagates node build errors', async () => {
    await expect(
      buildBun(baseConfig, '/cwd', {
        runNodeBuild: async () => {
          throw new Error('Vite blew up')
        },
        writeEntry: () => {},
        ensureDir: () => {},
      }),
    ).rejects.toThrow(/Vite blew up/)
  })

  it('embeds the port from the config', async () => {
    let captured = ''
    await buildBun({ ...baseConfig, port: 9999 }, '/cwd', {
      runNodeBuild: async () => {},
      writeEntry: (_p, content) => {
        captured = content
      },
      ensureDir: () => {},
    })
    expect(captured).toContain('9999')
  })
})
