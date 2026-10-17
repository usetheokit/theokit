/**
 * `runAgentEvals` ships from `@theokit/agents/evals`, not from the root entry (B-413).
 *
 * The root bundle sits about 2.6 KB under its 42 000-byte cap, and evaluating an agent is
 * development-time work most apps never import, so the runner gets its own subpath the way the A2A
 * client did (`the-a2a-tool-ships-on-its-own-subpath.test.ts`).
 *
 * Both halves are read from the BUILT output. The subpath is resolved through the package's own
 * `exports` map rather than through a hard-coded `dist/evals.js`, so a missing or misspelled export
 * fails here instead of in the consumer's import. Without a build the tests skip rather than pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(__dirname, '../..')
const distDir = resolve(packageRoot, 'dist')

describe('the evals subpath', () => {
  it('keeps runAgentEvals out of the root bundle', (ctx) => {
    const path = resolve(distDir, 'index.js')
    if (!existsSync(path)) {
      ctx.skip()
      return
    }
    expect(readFileSync(path, 'utf8')).not.toContain('runAgentEvals')
  })

  it('gives a callable runAgentEvals through the ./evals export', async (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { import?: string } | string>
    }
    const entry = manifest.exports['./evals']
    expect(entry, 'package.json has no ./evals export').toBeDefined()
    const target = typeof entry === 'string' ? entry : (entry?.import ?? '')
    expect(target, './evals has no import target').not.toBe('')
    const path = resolve(packageRoot, target)
    expect(existsSync(path), `${path} was not built`).toBe(true)
    const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>
    expect(typeof mod.runAgentEvals).toBe('function')
  })
})
