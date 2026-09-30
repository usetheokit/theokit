import { describe, it, expect } from 'vitest'
import {
  denoDeployAdapter,
  buildDeno,
  renderDenoEntry,
} from '../../packages/theo/src/adapters/deno-deploy.js'
import { VALID_TARGETS } from '../../packages/theo/src/adapters/types.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const baseConfig: TheoConfig = {
  appDir: 'app',
  serverDir: 'server',
  port: 8000,
  ssr: false,
  serialization: 'json',
} as TheoConfig

describe('Deno Deploy adapter — shape', () => {
  it('exposes the DeployAdapter contract', () => {
    expect(denoDeployAdapter.name).toBe('deno-deploy')
    expect(typeof denoDeployAdapter.build).toBe('function')
  })

  it('is listed in VALID_TARGETS', () => {
    expect(VALID_TARGETS).toContain('deno-deploy')
  })
})

describe('renderDenoEntry — template', () => {
  it('embeds the configured port', () => {
    const out = renderDenoEntry(7777)
    expect(out).toContain('7777')
  })

  it('uses Deno.serve (no Node http import)', () => {
    const out = renderDenoEntry(8000)
    expect(out).toContain('Deno.serve')
    expect(out).not.toMatch(/from 'node:http'/)
  })

  it('reads env via Deno.env', () => {
    const out = renderDenoEntry(8000)
    expect(out).toContain('Deno.env')
  })

  it('guards the runtime — fails fast when Deno global is absent', () => {
    const out = renderDenoEntry(8000)
    expect(out).toContain('typeof Deno')
  })

  it('imports theokit via npm: specifier (Deno Deploy compat)', () => {
    // The policy this case defends is the `npm:` PREFIX, which Deno Deploy needs to resolve a bare
    // npm package. It was checked by pinning `from 'npm:theokit/server'` — the umbrella — which the
    // framework itself deprecates with a removal scheduled, so the assertion held the entry on an
    // import that will stop loading (B-335). The prefix is asserted here without requiring the
    // umbrella, and the second half of the case now states the rule instead of implying it.
    const out = renderDenoEntry(8000)

    expect(out).toContain("from 'npm:theokit/server/")
    expect(out).toContain("from 'npm:theokit/adapters/web-shim'")
    expect(
      out,
      'the entry is back on the deprecated umbrella, which the framework schedules for removal',
    ).not.toContain("from 'npm:theokit/server'")
  })

  it('wires the full executeRoute pipeline through the shim', () => {
    const out = renderDenoEntry(8000)
    expect(out).toContain('createWebShim')
    expect(out).toContain('executeRoute')
    expect(out).toContain('matchRoute')
  })
})

describe('buildDeno — orchestration', () => {
  it('runs node build before writing the Deno entry', async () => {
    const calls: string[] = []
    await buildDeno(baseConfig, '/cwd', {
      runNodeBuild: async () => {
        calls.push('node-build')
      },
      writeEntry: (path) => {
        calls.push(path.endsWith('deno.json') ? 'write-config' : 'write-entry')
      },
      ensureDir: () => {},
      readProjectSources: () => [],
      readDenoConfig: () => undefined,
    })
    // The config is written too, and after the entry. Both are build output; asserting only
    // the entry is what let the config's absence go unnoticed until a deploy failed.
    expect(calls).toEqual(['node-build', 'write-entry', 'write-config'])
  })

  /*
   * The path left `.theokit/` on 2026-09-30, measured against the real platform with a
   * control: a dot directory is never uploaded. `./.theokit/deno/probe.ts` failed the
   * revision where the byte-identical `./visible/probe.ts` served HTTP 200 — so the entry
   * the build reported writing was one the deploy could never see, and the build said
   * nothing either way.
   */
  it('writes the entry where the platform upload can reach it', async () => {
    const written: string[] = []
    await buildDeno(baseConfig, '/test', {
      runNodeBuild: async () => {},
      writeEntry: (p) => {
        written.push(p)
      },
      ensureDir: () => {},
      readProjectSources: () => [],
      readDenoConfig: () => undefined,
    })
    expect(written).toContain('/test/theokit-deploy/server.ts')
    expect(written.some((w) => w.includes('/.theokit/'))).toBe(false)
  })

  it('writes the Deno config at the upload root, the only place the platform reads it', async () => {
    const contents = new Map<string, string>()
    await buildDeno(baseConfig, '/test', {
      runNodeBuild: async () => {},
      writeEntry: (path, content) => contents.set(path, content),
      ensureDir: () => {},
      readProjectSources: () => ["import { defineRoute } from 'theokit/server/define'"],
      readDenoConfig: () => undefined,
    })
    const config = JSON.parse(contents.get('/test/deno.json') ?? '{}')
    expect(config.imports['theokit/server/define']).toBe('npm:theokit/server/define')
    expect(config.unstable).toContain('sloppy-imports')
  })

  it('propagates node build errors', async () => {
    await expect(
      buildDeno(baseConfig, '/cwd', {
        runNodeBuild: async () => {
          throw new Error('Vite failed')
        },
        writeEntry: () => {},
        ensureDir: () => {},
      }),
    ).rejects.toThrow(/Vite failed/)
  })
})
