/**
 * `classifyTurnFailure` ships from `@theokit/agents/errors`, not from the root entry.
 *
 * With it in the root, `dist/index.js` measured 46 332 bytes against its 42 000-byte cap (ADR 0033): the
 * classifier and its default hints are 4 684 bytes of it. It had not been published from the root yet, so it
 * moved to its own subpath before its first release rather than raising the cap.
 *
 * Both halves are read from the BUILT output, and without a build the test skips rather than passing, for the
 * reason `bundle-size.test.ts` gives.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = resolve(__dirname, '../../dist')

describe('the turn-failure subpath', () => {
  it('keeps the classifier out of the root bundle', (ctx) => {
    const path = resolve(distDir, 'index.js')
    if (!existsSync(path)) {
      ctx.skip()
      return
    }
    const root = readFileSync(path, 'utf8')
    expect(root).not.toContain('classifyTurnFailure')
    expect(root).not.toContain('DEFAULT_TURN_FAILURE_HINTS')
  })

  it('exports the classifier, the description and the default hints from dist/errors.js', async (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    const path = resolve(distDir, 'errors.js')
    expect(existsSync(path), `${path} was not built`).toBe(true)
    const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>
    expect(typeof mod.classifyTurnFailure).toBe('function')
    expect(typeof mod.describeTurnFailure).toBe('function')
    expect(typeof mod.createTurnRetries).toBe('function')
    expect(mod.DEFAULT_TURN_FAILURE_HINTS).toBeTypeOf('object')
  })
})
