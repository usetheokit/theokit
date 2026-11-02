import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #1100 — on a Node that cannot strip types, `theo.config.ts` in a package without
 * `"type": "module"` is compiled by tsx as CommonJS, and the namespace comes back as
 * `{ default: { default: <config> } }`. `loadConfig` read the outer `default`, the schema dropped
 * the unknown `default` key, and every command ran on the defaults without a word.
 *
 * The module shape is simulated here because the test Node strips types natively and never takes
 * the tsx path; the shape itself was measured on Node 22.12.0 (see the issue).
 */
const loaded = vi.hoisted(() => ({ shape: {} as Record<string, unknown> }))

vi.mock('../../packages/theo/src/config/import-user-module.js', () => ({
  importUserModule: async () => loaded.shape,
}))

const { loadConfig } = await import('../../packages/theo/src/config/load-config.js')
const { TheoConfigError } = await import('../../packages/theo/src/config/errors.js')

describe('loadConfig with a CommonJS-wrapped default export', () => {
  let dir: string
  let nodeEnv: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theokit-cjs-config-'))
    writeFileSync(join(dir, 'theo.config.ts'), '// content is supplied by the mocked loader\n')
    nodeEnv = process.env.NODE_ENV
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the config inside the CommonJS wrapper', async () => {
    loaded.shape = {
      default: { default: { serverDir: 'src/server', agentsDir: 'src/server/agents' } },
    }

    const config = await loadConfig(dir)

    expect(config.serverDir).toBe('src/server')
    expect(config.agentsDir).toBe('src/server/agents')
  })

  it('reads the config inside a wrapper that also carries __esModule', async () => {
    loaded.shape = { default: { __esModule: true, default: { serverDir: 'src/server' } } }

    expect((await loadConfig(dir)).serverDir).toBe('src/server')
  })

  it('still reads a plain ESM default export', async () => {
    loaded.shape = { default: { serverDir: 'src/server' } }

    expect((await loadConfig(dir)).serverDir).toBe('src/server')
  })

  it('refuses a default export it cannot recognize instead of using the defaults', async () => {
    loaded.shape = { default: { default: { serverDir: 'src/server' }, port: 4000 } }

    const failure = loadConfig(dir)
    await expect(failure).rejects.toBeInstanceOf(TheoConfigError)
    await expect(loadConfig(dir)).rejects.toThrow(join(dir, 'theo.config.ts'))
  })
})
