/**
 * The disk half of the deno-deploy config emission.
 *
 * The pure parts are covered next door; these are the readers that decide WHAT those parts
 * are given, and they were reachable only through the build's defaults — so a test that
 * injected fakes proved the wiring and never the reading. What is exercised here is the
 * behaviour a project actually meets: a directory that is not there, a test file that must
 * not contribute a specifier, and a config file that already exists.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildDeno } from '../../packages/theo/src/adapters/deno-deploy.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

function projectAt(files: Record<string, string>): string {
  const root = mkdtempSync(resolve(tmpdir(), 'theokit-deno-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = resolve(root, relative)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const config = {
  port: 3000,
  serverDir: 'src/server',
  agentsDir: 'src/server/agents',
} as unknown as TheoConfig

async function emittedConfig(root: string): Promise<Record<string, unknown>> {
  const written = new Map<string, string>()
  await buildDeno(config, root, {
    runNodeBuild: async () => {},
    writeEntry: (path, content) => written.set(path, content),
    ensureDir: () => {},
  })
  return JSON.parse(written.get(resolve(root, 'deno.json')) ?? '{}') as Record<string, unknown>
}

describe('reading the project from disk', () => {
  it('maps a specifier a server route imports', async () => {
    const root = projectAt({
      'src/server/routes/health.ts': "import { defineRoute } from 'theokit/server/define'\n",
    })
    const imports = (await emittedConfig(root)).imports as Record<string, string>
    expect(imports['theokit/server/define']).toBe('npm:theokit/server/define')
  })

  it('maps a specifier the config file imports, which no route mentions', async () => {
    const root = projectAt({ 'theo.config.ts': "import { defineConfig } from 'theokit'\n" })
    const imports = (await emittedConfig(root)).imports as Record<string, string>
    expect(imports.theokit).toBe('npm:theokit')
  })

  it('leaves a test-only specifier out, because it never runs on the platform', async () => {
    const root = projectAt({
      'src/server/routes/health.test.ts': "import { describe } from 'vitest'\n",
      'src/server/routes/health.ts': "import { defineRoute } from 'theokit/server/define'\n",
    })
    const imports = (await emittedConfig(root)).imports as Record<string, string>
    expect(Object.keys(imports)).toEqual(['theokit/server/define'])
  })

  it('reads a nested directory, since routes are not flat', async () => {
    const root = projectAt({
      'src/server/agents/tools/weather.ts': "import { z } from 'zod'\n",
    })
    const imports = (await emittedConfig(root)).imports as Record<string, string>
    expect(imports.zod).toBe('npm:zod')
  })

  it('emits a config with no imports when a declared directory is absent', async () => {
    const root = projectAt({ 'package.json': '{}' })
    const emitted = await emittedConfig(root)
    expect(emitted.imports).toEqual({})
    // Still declared: the template's own `.js`-against-`.ts` imports need it whatever else
    // the project turns out to hold.
    expect(emitted.unstable).toContain('sloppy-imports')
  })

  it('preserves a config the project already wrote', async () => {
    const root = projectAt({
      'deno.json': JSON.stringify({ tasks: { dev: 'deno run -A main.ts' } }),
      'src/server/routes/health.ts': "import { z } from 'zod'\n",
    })
    const emitted = await emittedConfig(root)
    expect(emitted.tasks).toEqual({ dev: 'deno run -A main.ts' })
    expect((emitted.imports as Record<string, string>).zod).toBe('npm:zod')
  })

  it('refuses a config it cannot parse rather than replacing what the project wrote', async () => {
    const root = projectAt({ 'deno.json': '{ not json' })
    await expect(emittedConfig(root)).rejects.toThrow(/deno\.json exists and is not valid JSON/u)
  })
})
